/**
 * `lib/codex-exec.mjs` — 调用 `codex exec` 把图片交给 Codex（OpenAI 视觉模型），
 * 拿到最终回答文本。
 *
 * 契约见 `docs/CONTRACT.md` 第 2 节。本模块零外部依赖，只使用 `node:*`。
 *
 * 设计要点：
 * - 提示词通过 stdin 写入（最后一个位置参数固定为 `-`），避免以 `-` 开头的提示词被当成 CLI 参数；
 * - 子进程以独立进程组启动（POSIX `detached`），超时/中止时对整组先 SIGTERM、约 2s 后 SIGKILL；
 * - 工作目录与 `-o`（last-message.txt）默认放在本次调用专属的临时目录里，`finally` 递归删除；
 *   若调用方显式给了 `options.cwd`，则使用它作为 `-C`，临时文件用完即删，绝不留下痕迹；
 * - stdout/stderr 只保留尾部 `maxDiagnosticBytes` 字节，stdout 不返回，stderr 只进错误对象。
 */

import { spawn as nodeSpawn } from 'node:child_process'
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** 默认超时（毫秒）。 */
const DEFAULT_TIMEOUT_MS = 180_000
/** 默认诊断输出尾部保留字节数。 */
const DEFAULT_MAX_DIAGNOSTIC_BYTES = 65_536
/** captureStdout 时完整 stdout 的默认上限（8 MiB）。 */
const DEFAULT_MAX_STDOUT_BYTES = 8 * 1024 * 1024
/** SIGTERM 之后等待多久再 SIGKILL（毫秒）。 */
const KILL_GRACE_MS = 2_000
/** 临时工作目录前缀。 */
const TEMP_PREFIX = 'dsh-codex-vision-'
/** `-o` 指定文件在本次工作目录中的固定文件名。 */
const LAST_MESSAGE_FILENAME = 'last-message.txt'

/** 认证类 stderr 的启发式匹配。 */
const AUTH_ERROR_PATTERN = /not logged in|login|401|unauthorized|invalid.api.?key|authentication/i
/** 追加在认证失败消息末尾的中文提示。 */
const AUTH_HINT =
  'Codex 未登录：请先在 DSH 宿主机执行 codex login（或 printenv OPENAI_API_KEY | codex login --with-api-key）后重试。'

/** 去除 ANSI 转义序列（CSI / OSC 等）的正则。 */
const ANSI_ESCAPE_PATTERN =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g

/** 错误消息里塞 stderr 时的最大字符数（error.stderr 属性本身不截断）。 */
const MESSAGE_STDERR_LIMIT = 4_000

/**
 * 本模块抛出的所有错误的基类。
 */
export class CodexVisionError extends Error {
  /**
   * @param {string} code 错误码，见 `docs/CONTRACT.md` 第 2.10 节
   * @param {string} message 面向模型/用户的可读错误
   * @param {{ stderr?: string, exitCode?: number, command?: string, cause?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'CodexVisionError'
    this.code = code
    this.stderr = options.stderr
    this.exitCode = options.exitCode
    this.command = options.command
  }
}

/**
 * 去除字符串里的 ANSI 转义序列。
 * @param {string} text
 * @returns {string}
 */
function stripAnsi(text) {
  return text.replace(ANSI_ESCAPE_PATTERN, '')
}

/**
 * 截断长文本，用于错误消息。
 * @param {string} text
 * @param {number} limit
 * @returns {string}
 */
function truncateForMessage(text, limit = MESSAGE_STDERR_LIMIT) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/**
 * 从 `AbortSignal` 里尽量取出可读的中止原因。
 * @param {AbortSignal | undefined} signal
 * @returns {string}
 */
function abortReasonText(signal) {
  if (!signal || signal.reason === undefined || signal.reason === null) return ''
  const { reason } = signal
  if (typeof reason === 'string') return reason
  if (reason instanceof Error) return reason.message || String(reason)
  try {
    return String(reason)
  } catch {
    return ''
  }
}

/**
 * 一个只保留尾部 `maxBytes` 字节的缓冲区，防止子进程刷屏导致内存膨胀。
 * @param {number} maxBytes
 * @returns {{ push: (chunk: Buffer | string) => void, toString: () => string }}
 */
function createTailBuffer(maxBytes) {
  /** @type {Buffer} */
  let tail = Buffer.alloc(0)
  return {
    push(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      if (maxBytes <= 0) {
        tail = Buffer.alloc(0)
        return
      }
      if (buffer.length >= maxBytes) {
        tail = Buffer.from(buffer.subarray(buffer.length - maxBytes))
        return
      }
      const combined = Buffer.concat([tail, buffer])
      tail = combined.length > maxBytes ? combined.subarray(combined.length - maxBytes) : combined
    },
    toString() {
      return tail.toString('utf8')
    },
  }
}

/**
 * 校验 `runCodexVision` 的入参，非法时抛 `INVALID_CONFIG`。
 * @param {any} options
 */
function validateOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new CodexVisionError('INVALID_CONFIG', 'runCodexVision 需要一个 options 对象。')
  }

  const { imagePaths, prompt } = options
  if (!Array.isArray(imagePaths)) {
    throw new CodexVisionError(
      'INVALID_CONFIG',
      'imagePaths 必须是本地图片绝对路径数组（可以为空数组）。',
      { command: typeof options.command === 'string' ? options.command : undefined },
    )
  }
  if (!imagePaths.every((item) => typeof item === 'string' && item.trim() !== '')) {
    throw new CodexVisionError('INVALID_CONFIG', 'imagePaths 里的每一项都必须是非空字符串路径。', {
      command: typeof options.command === 'string' ? options.command : undefined,
    })
  }
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new CodexVisionError('INVALID_CONFIG', 'prompt 必须是非空字符串。', {
      command: typeof options.command === 'string' ? options.command : undefined,
    })
  }
  if (options.model !== undefined && (typeof options.model !== 'string' || options.model.trim() === '')) {
    throw new CodexVisionError('INVALID_CONFIG', 'model 必须是非空字符串（或省略）。', {
      command: typeof options.command === 'string' ? options.command : undefined,
    })
  }
  const command = options.command ?? 'codex'
  if (typeof command !== 'string' || command.trim() === '') {
    throw new CodexVisionError('INVALID_CONFIG', 'command 必须是非空字符串（默认 "codex"）。')
  }
  for (const key of ['prefixArgs', 'extraArgs']) {
    const value = options[key]
    if (value !== undefined && (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))) {
      throw new CodexVisionError('INVALID_CONFIG', `${key} 必须是字符串数组。`, { command })
    }
  }
  if (
    options.codexHome !== undefined &&
    (typeof options.codexHome !== 'string' || options.codexHome.trim() === '')
  ) {
    throw new CodexVisionError('INVALID_CONFIG', 'codexHome 必须是非空字符串（或省略）。', { command })
  }
  if (
    options.env !== undefined &&
    (options.env === null || typeof options.env !== 'object' || Array.isArray(options.env))
  ) {
    throw new CodexVisionError('INVALID_CONFIG', 'env 必须是 Record<string, string> 对象。', { command })
  }
  if (options.env !== undefined) {
    for (const [key, value] of Object.entries(options.env)) {
      if (value !== undefined && typeof value !== 'string') {
        throw new CodexVisionError('INVALID_CONFIG', `env.${key} 必须是字符串。`, { command })
      }
    }
  }
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new CodexVisionError('INVALID_CONFIG', 'timeoutMs 必须是大于 0 的有限数字。', { command })
  }
  if (
    options.maxDiagnosticBytes !== undefined &&
    (!Number.isInteger(options.maxDiagnosticBytes) || options.maxDiagnosticBytes < 0)
  ) {
    throw new CodexVisionError('INVALID_CONFIG', 'maxDiagnosticBytes 必须是 >= 0 的整数。', { command })
  }
  for (const key of ['json', 'captureStdout', 'checkLogin']) {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') {
      throw new CodexVisionError('INVALID_CONFIG', `${key} 必须是 boolean。`, { command })
    }
  }
  if (
    options.maxStdoutBytes !== undefined &&
    (!Number.isInteger(options.maxStdoutBytes) || options.maxStdoutBytes < 0)
  ) {
    throw new CodexVisionError('INVALID_CONFIG', 'maxStdoutBytes 必须是 >= 0 的整数。', { command })
  }
  if (options.sandbox !== undefined && (typeof options.sandbox !== 'string' || options.sandbox.trim() === '')) {
    throw new CodexVisionError('INVALID_CONFIG', 'sandbox 必须是非空字符串。', { command })
  }
  if (options.cwd !== undefined && (typeof options.cwd !== 'string' || options.cwd.trim() === '')) {
    throw new CodexVisionError('INVALID_CONFIG', 'cwd 必须是非空字符串（或省略）。', { command })
  }
  if (options.spawnImpl !== undefined && typeof options.spawnImpl !== 'function') {
    throw new CodexVisionError('INVALID_CONFIG', 'spawnImpl 必须是一个函数。', { command })
  }
  if (options.signal !== undefined && options.signal !== null) {
    const { signal } = options
    if (typeof signal !== 'object' || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function') {
      throw new CodexVisionError('INVALID_CONFIG', 'signal 必须是 AbortSignal。', { command })
    }
  }
}

/**
 * 杀掉子进程所在的整个进程组：先 SIGTERM，宽限约 2s 后 SIGKILL。
 * @param {import('node:child_process').ChildProcess} child
 * @param {{ killTimer: ReturnType<typeof setTimeout> | null }} state
 */
function terminateProcessTree(child, state) {
  if (!child) return
  if (child.exitCode !== null || child.signalCode !== null) return
  const { pid } = child
  if (!pid) {
    try {
      child.kill('SIGKILL')
    } catch {
      // 已经退出或无法 kill，忽略。
    }
    return
  }
  if (process.platform === 'win32') {
    try {
      child.kill('SIGKILL')
    } catch {
      // 忽略
    }
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {
      // 忽略
    }
  }
  if (state.killTimer) clearTimeout(state.killTimer)
  state.killTimer = setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        child.kill('SIGKILL')
      } catch {
        // 忽略
      }
    }
  }, KILL_GRACE_MS)
  state.killTimer.unref?.()
}

/**
 * 启动子进程并收集结果。永远 resolve（不 reject），把 spawn 失败/退出码/终止原因交给调用方判断。
 *
 * @param {object} params
 * @param {Function} params.spawnImpl
 * @param {string} params.command
 * @param {string[]} params.argv
 * @param {string} params.cwd
 * @param {Record<string, string | undefined>} params.env
 * @param {string} params.prompt
 * @param {number} params.timeoutMs
 * @param {number} params.maxDiagnosticBytes
 * @param {boolean} [params.captureStdout=false]
 * @param {number} [params.maxStdoutBytes]
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<{
 *   code: number | null,
 *   signal: NodeJS.Signals | null,
 *   spawnError: Error | null,
 *   termination: 'timeout' | 'abort' | null,
 *   stdout: string,
 *   stdoutFull?: string,
 *   stdoutTruncated?: boolean,
 *   stderr: string,
 * }>}
 */
async function executeChild(params) {
  const {
    spawnImpl,
    command,
    argv,
    cwd,
    env,
    prompt,
    timeoutMs,
    maxDiagnosticBytes,
    captureStdout = false,
    maxStdoutBytes = DEFAULT_MAX_STDOUT_BYTES,
    signal,
  } = params

  let child
  try {
    child = spawnImpl(command, argv, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })
  } catch (error) {
    return {
      code: null,
      signal: null,
      spawnError: error instanceof Error ? error : new Error(String(error)),
      termination: null,
      stdout: '',
      stderr: '',
    }
  }

  const stdoutTail = createTailBuffer(maxDiagnosticBytes)
  const stderrTail = createTailBuffer(maxDiagnosticBytes)
  /** @type {Buffer[]} */
  const stdoutChunks = []
  let stdoutBytes = 0
  let stdoutTruncated = false

  return await new Promise((resolve) => {
    const killState = { killTimer: null }
    let settled = false
    /** @type {'timeout' | 'abort' | null} */
    let termination = null
    /** @type {Error | null} */
    let spawnError = null
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timeoutTimer = null

    /**
     * @param {{ code: number | null, signal: NodeJS.Signals | null, spawnError: Error | null }} outcome
     */
    const settle = (outcome) => {
      if (settled) return
      settled = true
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (killState.killTimer) clearTimeout(killState.killTimer)
      if (signal) signal.removeEventListener('abort', onAbort)
      resolve({
        code: outcome.code,
        signal: outcome.signal,
        spawnError: outcome.spawnError,
        termination,
        stdout: stdoutTail.toString(),
        ...(captureStdout
          ? {
            stdoutFull: Buffer.concat(stdoutChunks).toString('utf8'),
            stdoutTruncated,
          }
          : {}),
        stderr: stderrTail.toString(),
      })
    }

    /** 处理超时/中止：标记终止原因并杀掉进程组。 */
    const terminate = (kind) => {
      if (settled || termination) return
      termination = kind
      terminateProcessTree(child, killState)
    }

    const onAbort = () => terminate('abort')

    child.stdout?.on('data', (chunk) => {
      stdoutTail.push(chunk)
      if (!captureStdout) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      const room = maxStdoutBytes - stdoutBytes
      if (room <= 0) {
        stdoutTruncated = true
        return
      }
      const take = buffer.length <= room ? buffer : buffer.subarray(0, room)
      stdoutChunks.push(take)
      stdoutBytes += take.length
      if (take.length < buffer.length) stdoutTruncated = true
    })
    child.stderr?.on('data', (chunk) => stderrTail.push(chunk))
    // 子进程提前退出时写 stdin/读 stdout 可能触发 EPIPE，这里静默吞掉，避免未处理错误事件。
    child.stdout?.on('error', () => {})
    child.stderr?.on('error', () => {})
    child.stdin?.on('error', () => {})

    // spawn 失败（如 ENOENT）：child.pid 为 undefined，此时不会真的启动进程，直接结算。
    child.once('error', (error) => {
      spawnError = error instanceof Error ? error : new Error(String(error))
      if (child.pid === undefined) {
        settle({ code: null, signal: null, spawnError })
      }
    })

    // 正常退出 / 被信号杀死：等 stdout/stderr 关闭后再结算，确保不泄漏子进程。
    child.once('close', (code, childSignal) => {
      settle({ code, signal: childSignal, spawnError })
    })

    timeoutTimer = setTimeout(() => terminate('timeout'), timeoutMs)

    if (signal) {
      if (signal.aborted) {
        // spawn 后瞬间被中止（调用前的检查在 runCodexVision 里已有，这里兜底）。
        terminate('abort')
      } else {
        signal.addEventListener('abort', onAbort, { once: true })
      }
    }

    if (child.stdin) {
      try {
        child.stdin.end(prompt)
      } catch {
        try {
          child.stdin.destroy()
        } catch {
          // 忽略
        }
      }
    }
  })
}

/**
 * 快速探测 Codex 登录状态（`codex login status`），避免未登录时在 exec 里空等网络重试。
 * 探测失败（命令不存在等）不视为错误，交给主调用处理。
 *
 * @param {object} options
 * @param {typeof import('node:child_process').spawn} [options.spawnImpl]
 * @param {string} options.command
 * @param {string[]} [options.prefixArgs]
 * @param {Record<string,string>} [options.env]
 * @param {string} [options.codexHome]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeoutMs=15000]
 * @returns {Promise<{ available: boolean, loggedOut: boolean, aborted: boolean, output: string }>}
 */
async function probeLoginStatus(options) {
  const {
    spawnImpl = nodeSpawn,
    command,
    prefixArgs = [],
    env,
    codexHome,
    signal,
    timeoutMs = 15_000,
  } = options
  return await new Promise((resolve) => {
    let child
    try {
      child = spawnImpl(command, [...prefixArgs, 'login', 'status'], {
        env: {
          ...process.env,
          ...(env ?? {}),
          NO_COLOR: '1',
          ...(codexHome ? { CODEX_HOME: codexHome } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      })
    } catch {
      resolve({ available: false, loggedOut: false, aborted: false, output: '' })
      return
    }
    const chunks = []
    const stderrChunks = []
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve(result)
    }
    const outputText = () => Buffer.concat([...chunks, ...stderrChunks]).toString('utf8')
    const kill = () => {
      if (child.pid === undefined) return
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        try { child.kill('SIGTERM') } catch { /* ignore */ }
      }
    }
    const onAbort = () => { kill(); finish({ available: true, loggedOut: false, aborted: true, output: outputText() }) }
    const timer = setTimeout(() => { kill(); finish({ available: true, loggedOut: false, aborted: false, output: outputText() }) }, timeoutMs)
    timer.unref?.()
    child.stdout?.on('data', (chunk) => { if (chunks.length < 8) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))) })
    child.stderr?.on('data', (chunk) => { if (stderrChunks.length < 8) stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))) })
    child.stdout?.on('error', () => {})
    child.stderr?.on('error', () => {})
    child.once('error', () => finish({ available: false, loggedOut: false, aborted: false, output: outputText() }))
    child.once('close', () => {
      const text = outputText()
      const loggedOut = /not logged in|login required|no credentials|not authenticated/i.test(text)
      finish({ available: true, loggedOut, aborted: false, output: text })
    })
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

/**
 * 调用 Codex CLI（`codex exec`）并返回最终回答文本。
 *
 * @param {object} options
 * @param {string[]} options.imagePaths 已解析好的本地图片绝对路径（可为空数组）
 * @param {string} options.prompt 给 Codex 的完整提示词（非空）
 * @param {string} [options.model] `--model` 覆盖
 * @param {AbortSignal} [options.signal]
 * @param {string} [options.command='codex'] 可执行文件（PATH 名或绝对路径）
 * @param {string[]} [options.prefixArgs=[]] 插在 `exec` 之前的参数（测试注入 node 脚本时有用）
 * @param {string[]} [options.extraArgs=[]] 追加在 `-o`/`--model` 之后、prompt 之前的参数
 * @param {string} [options.codexHome] 非空时作为子进程 `CODEX_HOME`
 * @param {Record<string, string>} [options.env] 额外环境变量（覆盖进程环境）
 * @param {number} [options.timeoutMs=180000]
 * @param {string} [options.sandbox='read-only']
 * @param {string} [options.cwd] 非空时作为工作目录（不创建、不删除；last-message.txt 用完即删）
 * @param {number} [options.maxDiagnosticBytes=65536]
 * @param {boolean} [options.json=false] 为 true 时在 exec 之后加 `--json`（JSONL 事件输出）
 * @param {boolean} [options.captureStdout=false] 为 true 时完整保留 stdout（最多 maxStdoutBytes）并返回
 * @param {boolean} [options.checkLogin=false] 为 true 时先跑 `codex login status`，未登录则快速失败
 * @param {number} [options.maxStdoutBytes=8388608]
 * @param {typeof import('node:child_process').spawn} [options.spawnImpl] 测试注入（可选）
 * @returns {Promise<{ answer: string, exitCode: number, durationMs: number, command: string,
 *   stdout?: string, stdoutTruncated?: boolean }>}
 */
export async function runCodexVision(options) {
  const opts = options ?? {}
  validateOptions(opts)

  const {
    imagePaths,
    prompt,
    model,
    signal,
    command = 'codex',
    prefixArgs = [],
    extraArgs = [],
    codexHome,
    env,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    sandbox = 'read-only',
    cwd,
    maxDiagnosticBytes = DEFAULT_MAX_DIAGNOSTIC_BYTES,
    json = false,
    captureStdout = false,
    maxStdoutBytes = DEFAULT_MAX_STDOUT_BYTES,
    checkLogin = false,
    spawnImpl = nodeSpawn,
  } = opts

  if (signal?.aborted) {
    throw new CodexVisionError('ABORTED', `Codex 调用已中止：${abortReasonText(signal) || 'signal 已中止'}`, {
      command,
    })
  }

  // 未登录时 `codex exec` 会先做网络重试（可能几十秒~数分钟），这里先快速探测登录状态。
  // 显式配置了 OPENAI_API_KEY 的用户跳过探测（API key 模式不依赖 auth.json 登录态）。
  const apiKeyConfigured = (env?.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY) !== undefined
  if (checkLogin && !apiKeyConfigured) {
    const probe = await probeLoginStatus({ spawnImpl, command, prefixArgs, env, codexHome, signal })
    if (probe.aborted) {
      throw new CodexVisionError('ABORTED', `Codex 调用已中止：${abortReasonText(signal) || '收到中止信号'}`, { command })
    }
    if (probe.available && probe.loggedOut) {
      throw new CodexVisionError('NOT_LOGGED_IN', AUTH_HINT, { command, stderr: probe.output })
    }
  }

  const startedAt = Date.now()
  const providedCwd = typeof cwd === 'string' && cwd.trim() !== ''

  let tempDir
  try {
    tempDir = providedCwd ? undefined : await mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX))
  } catch (error) {
    throw new CodexVisionError('SPAWN_FAILED', `无法创建 Codex 临时工作目录：${error?.message ?? error}`, {
      command,
      cause: error,
    })
  }

  const effectiveWorkdir = providedCwd ? path.resolve(cwd) : /** @type {string} */ (tempDir)
  const effectiveLastMessagePath = path.join(effectiveWorkdir, LAST_MESSAGE_FILENAME)

  const argv = [
    ...prefixArgs,
    'exec',
    ...(json ? ['--json'] : []),
    '--ephemeral',
    '--skip-git-repo-check',
    '--color',
    'never',
    '--sandbox',
    sandbox,
    '-C',
    effectiveWorkdir,
    ...imagePaths.flatMap((imagePath) => ['-i', imagePath]),
    '-o',
    effectiveLastMessagePath,
    ...(model ? ['--model', model] : []),
    ...extraArgs,
    '-',
  ]

  const childEnv = {
    ...process.env,
    ...(env ?? {}),
    NO_COLOR: '1',
    ...(codexHome ? { CODEX_HOME: codexHome } : {}),
  }

  try {
    const outcome = await executeChild({
      spawnImpl,
      command,
      argv,
      cwd: effectiveWorkdir,
      env: childEnv,
      prompt,
      timeoutMs,
      maxDiagnosticBytes,
      captureStdout,
      maxStdoutBytes,
      signal,
    })

    if (outcome.termination === 'abort') {
      throw new CodexVisionError('ABORTED', `Codex 调用已中止：${abortReasonText(signal) || '收到中止信号'}`, {
        command,
        stderr: outcome.stderr,
        cause: signal?.reason,
      })
    }

    if (outcome.termination === 'timeout') {
      const stderrTail = truncateForMessage(outcome.stderr.trim())
      throw new CodexVisionError(
        'TIMEOUT',
        `Codex 调用超时（${timeoutMs}ms），已终止进程。${stderrTail ? `stderr：${stderrTail}` : ''}`.trim(),
        { command, stderr: outcome.stderr },
      )
    }

    if (outcome.spawnError) {
      const error = outcome.spawnError
      if (error.code === 'ENOENT') {
        throw new CodexVisionError(
          'COMMAND_NOT_FOUND',
          `找不到命令 "${command}"。请确认已安装 Codex CLI 并加入 PATH，或先在 DSH 宿主机执行 codex login 完成登录。`,
          { command, cause: error },
        )
      }
      throw new CodexVisionError(
        'SPAWN_FAILED',
        `启动命令 "${command}" 失败：${error.message ?? String(error)}`,
        { command, cause: error },
      )
    }

    const exitCode = outcome.code ?? 0
    if (exitCode !== 0) {
      const stderr = outcome.stderr
      const stderrTail = truncateForMessage(stderr.trim())
      const authHint = AUTH_ERROR_PATTERN.test(stderr) ? `\n${AUTH_HINT}` : ''
      throw new CodexVisionError(
        'EXIT_NONZERO',
        `codex 退出码 ${exitCode}${stderrTail ? `：${stderrTail}` : ''}${authHint}`,
        { command, stderr, exitCode },
      )
    }

    let rawAnswer = ''
    try {
      rawAnswer = await readFile(effectiveLastMessagePath, 'utf8')
    } catch {
      rawAnswer = ''
    }
    const answer = stripAnsi(rawAnswer).trim()
    if (!answer) {
      throw new CodexVisionError(
        'NO_OUTPUT',
        'Codex 未返回任何文本输出（last-message.txt 为空）。请重试，或检查提示词与 --model 配置。',
        { command, exitCode, stderr: outcome.stderr },
      )
    }

    return {
      answer,
      exitCode,
      durationMs: Date.now() - startedAt,
      command,
      ...(captureStdout
        ? {
          stdout: outcome.stdoutFull ?? '',
          stdoutTruncated: outcome.stdoutTruncated === true,
        }
        : {}),
    }
  } finally {
    if (providedCwd) {
      // 调用方显式给了 cwd：不动这个目录，但删掉本次调用写入的 last-message.txt。
      await unlink(effectiveLastMessagePath).catch(() => {})
    } else {
      await rm(/** @type {string} */ (tempDir), { recursive: true, force: true }).catch(() => {})
    }
  }
}
