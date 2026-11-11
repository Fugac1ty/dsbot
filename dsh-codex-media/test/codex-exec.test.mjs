/**
 * `test/codex-exec.test.mjs` — `lib/codex-exec.mjs` 的单元测试。
 *
 * 全部用 `test/fixtures/fake-codex.mjs` 假 codex 跑，不依赖真实 codex CLI、不访问网络。
 * 契约见 `docs/CONTRACT.md` 第 2 节。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CodexVisionError, runCodexVision } from '../lib/codex-exec.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(HERE, 'fixtures', 'fake-codex.mjs')
const TINY_PNG = path.join(HERE, 'fixtures', 'tiny.png')

/** 契约要求的认证提示文案。 */
const AUTH_HINT =
  'Codex 未登录：请先在 DSH 宿主机执行 codex login（或 printenv OPENAI_API_KEY | codex login --with-api-key）后重试。'

/**
 * 建一个测试专用目录，结束后递归清理。
 * @param {import('node:test').TestContext} t
 * @returns {Promise<string>}
 */
async function createSandbox(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-codex-vision-test-'))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  return dir
}

/**
 * 组装一次「用假 codex 跑」的调用。
 * @param {string} sandbox
 * @param {Record<string, string>} [env]
 * @param {Record<string, unknown>} [overrides]
 */
function fakeInvocation(sandbox, env = {}, overrides = {}) {
  const argsPath = path.join(sandbox, `fake-args-${randomUUID()}.json`)
  return {
    argsPath,
    options: {
      imagePaths: [TINY_PNG],
      prompt: '请详细描述这张图片。',
      command: process.execPath,
      prefixArgs: [FIXTURE],
      timeoutMs: 20_000,
      env: { FAKE_CODEX_ARGS_PATH: argsPath, ...env },
      ...overrides,
    },
  }
}

/** @param {string} argsPath */
async function readArgs(argsPath) {
  return JSON.parse(await readFile(argsPath, 'utf8'))
}

/**
 * 取 argv 中某个 flag 的全部值（如 `-i a -i b` → ['a','b']）。
 * @param {string[]} argv
 * @param {string} flag
 * @returns {string[]}
 */
function flagValues(argv, flag) {
  const values = []
  for (let index = 0; index < argv.length - 1; index += 1) {
    if (argv[index] === flag) values.push(argv[index + 1])
  }
  return values
}

/**
 * 等待 promise 拒绝并返回错误对象；不拒绝则让测试失败。
 * @param {Promise<unknown>} promise
 * @returns {Promise<any>}
 */
async function captureError(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('期望 Promise 拒绝，但它成功返回了。')
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** @param {number} pid */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/**
 * 注入用的假 spawn：捕获参数，然后立刻发一个 spawn error（child.pid 为 undefined）。
 * @param {string} code 例如 'ENOENT' / 'EACCES'
 */
function createMockSpawn(code) {
  const calls = []
  /** @type {any} */
  const spawnImpl = (command, argv, spawnOptions) => {
    calls.push({ command, argv, options: spawnOptions })
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.stdin = new PassThrough()
    child.pid = undefined
    child.exitCode = null
    child.signalCode = null
    child.kill = () => true
    process.nextTick(() => {
      const error = Object.assign(new Error(`spawn ${command} ${code}`), { code })
      child.emit('error', error)
    })
    return child
  }
  return { spawnImpl, calls }
}

test('fake-codex 夹具可执行（chmod +x），可直接作为 command 运行', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows 上不检查可执行位')
    return
  }
  const info = await stat(FIXTURE)
  assert.ok((info.mode & 0o111) !== 0, `fixture 应可执行，实际 mode=${info.mode.toString(8)}`)

  const sandbox = await createSandbox(t)
  const argsPath = path.join(sandbox, `fake-args-${randomUUID()}.json`)
  const result = await runCodexVision({
    imagePaths: [TINY_PNG],
    prompt: 'direct fixture',
    command: FIXTURE,
    env: {
      FAKE_CODEX_ARGS_PATH: argsPath,
      PATH: `${path.dirname(process.execPath)}:${process.env.PATH ?? ''}`,
    },
    timeoutMs: 20_000,
  })
  assert.equal(result.answer, 'fake description')
  assert.equal(result.command, FIXTURE)
  assert.equal((await readArgs(argsPath)).stdin, 'direct fixture')
})

test('成功：返回 answer/exitCode/durationMs/command；argv 与 stdin 符合契约，临时目录被清理', async (t) => {
  const sandbox = await createSandbox(t)
  const { argsPath, options } = fakeInvocation(sandbox, {
    FAKE_CODEX_ANSWER: '一只戴帽子的鲸鱼',
    FAKE_CODEX_STDOUT: 'thinking...\n',
  })
  options.imagePaths = [TINY_PNG, TINY_PNG]
  options.prompt = '这两张图有什么区别？'

  const result = await runCodexVision(options)

  assert.equal(result.answer, '一只戴帽子的鲸鱼')
  assert.equal(result.exitCode, 0)
  assert.equal(result.command, process.execPath)
  assert.equal(typeof result.durationMs, 'number')
  assert.ok(result.durationMs >= 0)

  const args = await readArgs(argsPath)
  assert.equal(args.stdin, options.prompt, 'prompt 必须经 stdin 传入')
  assert.equal(args.execIndex, 0, 'fake 应看到位置参数 exec')

  assert.deepEqual(args.argv.slice(0, 8), [
    'exec',
    '--ephemeral',
    '--skip-git-repo-check',
    '--color',
    'never',
    '--sandbox',
    'read-only',
    '-C',
  ])
  const workdir = args.argv[8]
  assert.equal(args.cwd, workdir, '子进程 cwd 必须是 -C 指定的临时工作目录')
  assert.deepEqual(args.argv.slice(9, 13), ['-i', TINY_PNG, '-i', TINY_PNG])
  assert.equal(args.argv[13], '-o')
  const lastMessagePath = args.argv[14]
  assert.equal(path.basename(lastMessagePath), 'last-message.txt')
  assert.equal(path.dirname(lastMessagePath), workdir, 'last-message.txt 必须位于本次工作目录内')
  assert.equal(args.argv[15], '-', '最后一个位置参数必须是 -（prompt 走 stdin）')
  assert.equal(args.argv.length, 16)
  assert.deepEqual(args.images, [TINY_PNG, TINY_PNG])

  // 默认临时工作目录必须在 finally 中被清理。
  assert.equal(existsSync(workdir), false, '临时工作目录应在成功后删除')
})

test('model / extraArgs / sandbox 的 argv 顺序固定', async (t) => {
  const sandbox = await createSandbox(t)
  const { argsPath, options } = fakeInvocation(sandbox)
  Object.assign(options, {
    model: 'gpt-5-codex',
    extraArgs: ['--search', '--json'],
    sandbox: 'workspace-write',
  })

  const result = await runCodexVision(options)
  assert.equal(result.answer, 'fake description')

  const args = await readArgs(argsPath)
  const workdir = args.argv[8]
  const lastMessagePath = path.join(workdir, 'last-message.txt')
  assert.deepEqual(args.argv, [
    'exec',
    '--ephemeral',
    '--skip-git-repo-check',
    '--color',
    'never',
    '--sandbox',
    'workspace-write',
    '-C',
    workdir,
    '-i',
    TINY_PNG,
    '-o',
    lastMessagePath,
    '--model',
    'gpt-5-codex',
    '--search',
    '--json',
    '-',
  ])
})

test('env 覆盖 / codexHome / prefixArgs 位置：注入 spawnImpl 捕获', async () => {
  const { spawnImpl, calls } = createMockSpawn('ENOENT')
  const error = await captureError(
    runCodexVision({
      imagePaths: [TINY_PNG],
      prompt: 'p',
      command: '/fake/codex',
      prefixArgs: ['--prefix-arg'],
      extraArgs: [],
      env: { FOO: 'bar' },
      codexHome: '/tmp/fake-codex-home',
      spawnImpl,
    }),
  )

  assert.equal(error.code, 'COMMAND_NOT_FOUND')
  assert.equal(error.command, '/fake/codex')
  assert.equal(calls.length, 1)

  const call = calls[0]
  assert.equal(call.command, '/fake/codex')
  assert.deepEqual(call.argv.slice(0, 7), [
    '--prefix-arg',
    'exec',
    '--ephemeral',
    '--skip-git-repo-check',
    '--color',
    'never',
    '--sandbox',
  ], 'prefixArgs 必须插在 exec 之前')
  assert.equal(call.options.cwd, call.argv[9], '-C 必须与子进程 cwd 一致')
  assert.equal(call.options.env.NO_COLOR, '1')
  assert.equal(call.options.env.CODEX_HOME, '/tmp/fake-codex-home')
  assert.equal(call.options.env.FOO, 'bar')
  assert.equal(call.options.env.PATH, process.env.PATH, '未覆盖的进程环境变量应保留')
  assert.equal(call.options.detached, process.platform !== 'win32')
  assert.deepEqual(call.options.stdio, ['pipe', 'pipe', 'pipe'])

  // 未设置 codexHome 时不应污染 CODEX_HOME。
  const second = createMockSpawn('ENOENT')
  const originalCodexHome = process.env.CODEX_HOME
  await captureError(
    runCodexVision({
      imagePaths: [TINY_PNG],
      prompt: 'p',
      command: '/fake/codex',
      env: {},
      spawnImpl: second.spawnImpl,
    }),
  )
  assert.equal(second.calls[0].options.env.CODEX_HOME, originalCodexHome)
})

test('spawn 失败（非 ENOENT）→ SPAWN_FAILED', async () => {
  const error = await captureError(
    runCodexVision({
      imagePaths: [TINY_PNG],
      prompt: 'p',
      command: '/fake/codex',
      spawnImpl: () => {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      },
    }),
  )
  assert.equal(error.code, 'SPAWN_FAILED')
  assert.equal(error.command, '/fake/codex')
  assert.ok(error.message.includes('EACCES'))
})

test('command 不存在 → COMMAND_NOT_FOUND，消息含命令与登录/安装提示', async () => {
  const missing = path.join(os.tmpdir(), `definitely-missing-codex-${randomUUID()}`)
  const error = await captureError(
    runCodexVision({ imagePaths: [TINY_PNG], prompt: 'p', command: missing, timeoutMs: 10_000 }),
  )
  assert.ok(error instanceof CodexVisionError)
  assert.equal(error.code, 'COMMAND_NOT_FOUND')
  assert.equal(error.command, missing)
  assert.ok(error.message.includes(missing))
  assert.ok(/codex login/.test(error.message))
  assert.ok(/安装|install/i.test(error.message))
})

test('非 0 退出 → EXIT_NONZERO（stderr/exitCode/command 属性齐全），临时目录被清理', async (t) => {
  const sandbox = await createSandbox(t)
  const { argsPath, options } = fakeInvocation(sandbox, {
    FAKE_CODEX_EXIT_CODE: '7',
    FAKE_CODEX_STDERR: 'boom: model unavailable',
  })

  const error = await captureError(runCodexVision(options))
  assert.ok(error instanceof CodexVisionError)
  assert.equal(error.name, 'CodexVisionError')
  assert.equal(error.code, 'EXIT_NONZERO')
  assert.equal(error.exitCode, 7)
  assert.equal(error.command, process.execPath)
  assert.equal(typeof error.stderr, 'string')
  assert.ok(error.stderr.includes('boom: model unavailable'))
  assert.ok(error.message.includes('boom: model unavailable'))
  assert.ok(!error.message.includes('Codex 未登录'), '普通失败不应追加登录提示')

  const args = await readArgs(argsPath)
  assert.equal(existsSync(args.cwd), false, '失败时临时工作目录也应被清理')
})

test('认证类 stderr → EXIT_NONZERO 消息末尾追加中文登录提示', async (t) => {
  const sandbox = await createSandbox(t)
  const { options } = fakeInvocation(sandbox, {
    FAKE_CODEX_EXIT_CODE: '1',
    FAKE_CODEX_STDERR: 'Error: not logged in. Run `codex login` first.',
  })

  const error = await captureError(runCodexVision(options))
  assert.equal(error.code, 'EXIT_NONZERO')
  assert.ok(error.stderr.includes('not logged in'))
  assert.ok(error.message.includes(AUTH_HINT))
  assert.ok(error.message.endsWith(AUTH_HINT), '登录提示应追加在消息末尾')
})

test('last-message 为空 → NO_OUTPUT', async (t) => {
  const sandbox = await createSandbox(t)
  const { options } = fakeInvocation(sandbox, { FAKE_CODEX_ANSWER: '' })

  const error = await captureError(runCodexVision(options))
  assert.equal(error.code, 'NO_OUTPUT')
  assert.ok(error.message.includes('last-message.txt'))
})

test('answer 去除 ANSI 转义并 trim', async (t) => {
  const sandbox = await createSandbox(t)
  const { options } = fakeInvocation(sandbox, {
    FAKE_CODEX_ANSWER: '\u001b[32mhello\u001b[0m 鲸鱼\n\n',
  })

  const result = await runCodexVision(options)
  assert.equal(result.answer, 'hello 鲸鱼')
})

test('stderr 只保留尾部 maxDiagnosticBytes 字节', async (t) => {
  const sandbox = await createSandbox(t)
  const fullStderr = `HEAD-${'x'.repeat(5_000)}-TAIL-MARKER`
  const { options } = fakeInvocation(
    sandbox,
    { FAKE_CODEX_EXIT_CODE: '2', FAKE_CODEX_STDERR: fullStderr },
    { maxDiagnosticBytes: 64 },
  )

  const error = await captureError(runCodexVision(options))
  assert.equal(error.code, 'EXIT_NONZERO')
  assert.equal(error.stderr.length, 64)
  assert.equal(error.stderr, fullStderr.slice(-64))
  assert.ok(error.stderr.endsWith('-TAIL-MARKER'))
})

test('stdout 很大时依然成功（stdout 不返回、不占内存）', async (t) => {
  const sandbox = await createSandbox(t)
  const { options } = fakeInvocation(sandbox, {
    // Linux 单个 env 字符串上限约 128KB，这里取 100KB 模拟「刷屏 stdout」。
    FAKE_CODEX_STDOUT: 'x'.repeat(100_000),
    FAKE_CODEX_ANSWER: '大 stdout 下的答案',
  })

  const result = await runCodexVision(options)
  assert.equal(result.answer, '大 stdout 下的答案')
})

test('超时 → TIMEOUT，进程被杀死、未写答案、临时目录被清理', async (t) => {
  const sandbox = await createSandbox(t)
  const timeoutMs = 500
  const { argsPath, options } = fakeInvocation(
    sandbox,
    { FAKE_CODEX_DELAY_MS: '30000' },
    { timeoutMs },
  )

  const startedAt = Date.now()
  const error = await captureError(runCodexVision(options))
  const elapsed = Date.now() - startedAt

  assert.equal(error.code, 'TIMEOUT')
  assert.ok(error.message.includes(String(timeoutMs)))
  assert.ok(elapsed < 5_000, `超时后应尽快返回，实际 ${elapsed}ms`)

  const args = await readArgs(argsPath)
  const outputPath = flagValues(args.argv, '-o')[0]
  assert.equal(existsSync(outputPath), false, '被超时杀掉的子进程不应写出答案')

  await sleep(150)
  assert.equal(isProcessAlive(args.pid), false, '超时后子进程必须已退出')
  assert.equal(existsSync(args.cwd), false, '超时后临时工作目录必须被清理')
})

test('中止 → ABORTED，进程被杀、临时目录被清理', async (t) => {
  const sandbox = await createSandbox(t)
  const { argsPath, options } = fakeInvocation(
    sandbox,
    { FAKE_CODEX_DELAY_MS: '30000' },
    { timeoutMs: 60_000 },
  )
  const controller = new AbortController()
  const abortTimer = setTimeout(() => controller.abort(new Error('user cancel')), 250)
  t.after(() => clearTimeout(abortTimer))
  options.signal = controller.signal

  const delta = Date.now()
  const error = await captureError(runCodexVision(options))
  const elapsed = Date.now() - delta

  assert.equal(error.code, 'ABORTED')
  assert.ok(error.message.includes('user cancel'))
  assert.ok(elapsed < 5_000, `中止后应尽快返回，实际 ${elapsed}ms`)

  const args = await readArgs(argsPath)
  const outputPath = flagValues(args.argv, '-o')[0]
  assert.equal(existsSync(outputPath), false)
  await sleep(150)
  assert.equal(isProcessAlive(args.pid), false, '中止后子进程必须已退出')
  assert.equal(existsSync(args.cwd), false, '中止后临时工作目录必须被清理')
})

test('signal 已中止 → 立即 ABORTED，不启动子进程', async (t) => {
  const sandbox = await createSandbox(t)
  const { argsPath, options } = fakeInvocation(sandbox)
  const controller = new AbortController()
  controller.abort(new Error('already gone'))
  options.signal = controller.signal

  const error = await captureError(runCodexVision(options))
  assert.equal(error.code, 'ABORTED')
  assert.ok(error.message.includes('already gone'))
  assert.equal(existsSync(argsPath), false, '不应启动子进程')
})

test('超时杀整个进程组：SIGTERM 被忽略时约 2s 后 SIGKILL（含孙进程）', async (t) => {
  const sandbox = await createSandbox(t)
  const wrapperPath = path.join(sandbox, 'group-wrapper.mjs')
  const pidPath = path.join(sandbox, 'wrapper.pid')
  const argsPath = path.join(sandbox, `fake-args-${randomUUID()}.json`)

  // 包装器忽略 SIGTERM 并拉起 fake-codex（孙进程）；只有整个进程组被 SIGKILL 才能真正结束。
  await writeFile(
    wrapperPath,
    `import { spawn } from 'node:child_process'\n` +
      `import { writeFileSync } from 'node:fs'\n` +
      `writeFileSync(process.env.WRAPPER_PID_PATH, String(process.pid))\n` +
      `process.on('SIGTERM', () => {})\n` +
      `spawn(process.execPath, [process.env.FAKE_CODEX_SCRIPT, ...process.argv.slice(2)], { stdio: 'inherit' })\n` +
      `setInterval(() => {}, 1000)\n`,
  )

  const startedAt = Date.now()
  const error = await captureError(
    runCodexVision({
      imagePaths: [TINY_PNG],
      prompt: 'group kill',
      command: process.execPath,
      prefixArgs: [wrapperPath],
      timeoutMs: 500,
      env: {
        WRAPPER_PID_PATH: pidPath,
        FAKE_CODEX_SCRIPT: FIXTURE,
        FAKE_CODEX_ARGS_PATH: argsPath,
        FAKE_CODEX_DELAY_MS: '30000',
      },
    }),
  )
  const elapsed = Date.now() - startedAt

  assert.equal(error.code, 'TIMEOUT')
  // SIGTERM（500ms 时发出）被忽略，必须等约 2s 后的 SIGKILL 才 close。
  assert.ok(elapsed >= 1_800, `应等待 SIGKILL 宽限期后返回，实际 ${elapsed}ms`)
  assert.ok(elapsed < 8_000, `不应无限等待，实际 ${elapsed}ms`)

  await sleep(150)
  const wrapperPid = Number.parseInt(await readFile(pidPath, 'utf8'), 10)
  assert.equal(isProcessAlive(wrapperPid), false, '包装进程必须已退出')

  const args = await readArgs(argsPath)
  assert.equal(isProcessAlive(args.pid), false, '进程组里的孙进程也必须已退出')
  assert.equal(existsSync(args.cwd), false, '临时工作目录必须被清理')
})

test('提供 options.cwd：作为 -C，不创建也不删除目录，且不留 last-message.txt', async (t) => {
  const sandbox = await createSandbox(t)
  const cwdDir = path.join(sandbox, 'project')
  await mkdir(cwdDir, { recursive: true })
  const { argsPath, options } = fakeInvocation(sandbox)
  options.cwd = cwdDir

  const result = await runCodexVision(options)
  assert.equal(result.answer, 'fake description')

  const args = await readArgs(argsPath)
  assert.equal(path.resolve(args.argv[8]), path.resolve(cwdDir), '-C 必须是提供的 cwd')
  assert.equal(path.resolve(args.cwd), path.resolve(cwdDir), '子进程 cwd 必须是提供的 cwd')
  assert.equal(existsSync(cwdDir), true, '提供的 cwd 不能被删除')
  assert.deepEqual(await readdir(cwdDir), [], '不应在用户 cwd 留下 last-message.txt')
})

test('INVALID_CONFIG：非法参数被拒绝', async () => {
  const base = { imagePaths: [TINY_PNG], prompt: 'p' }
  const cases = [
    [undefined, 'undefined options'],
    [{}, '缺少 imagePaths/prompt'],
    [{ ...base, imagePaths: 'nope' }, 'imagePaths 非数组'],
    [{ ...base, imagePaths: [''] }, 'imagePaths 空字符串'],
    [{ ...base, prompt: '' }, '空 prompt'],
    [{ ...base, prompt: '   ' }, '空白 prompt'],
    [{ ...base, timeoutMs: 0 }, 'timeoutMs=0'],
    [{ ...base, timeoutMs: Number.NaN }, 'timeoutMs=NaN'],
    [{ ...base, extraArgs: 'nope' }, 'extraArgs 非数组'],
    [{ ...base, prefixArgs: [1] }, 'prefixArgs 含非字符串'],
    [{ ...base, maxDiagnosticBytes: -1 }, 'maxDiagnosticBytes 负数'],
    [{ ...base, sandbox: '' }, 'sandbox 空'],
    [{ ...base, cwd: '' }, 'cwd 空'],
    [{ ...base, signal: {} }, '非法 signal'],
    [{ ...base, spawnImpl: 'nope' }, '非法 spawnImpl'],
    [{ ...base, json: 'yes' }, 'json 非 boolean'],
    [{ ...base, captureStdout: 1 }, 'captureStdout 非 boolean'],
    [{ ...base, maxStdoutBytes: -1 }, 'maxStdoutBytes 负数'],
  ]

  for (const [opts, label] of cases) {
    const error = await captureError(runCodexVision(opts))
    assert.ok(error instanceof CodexVisionError, `${label}: 应抛 CodexVisionError`)
    assert.equal(error.code, 'INVALID_CONFIG', `${label}: 错误码应为 INVALID_CONFIG`)
  }
})
