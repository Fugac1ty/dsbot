#!/usr/bin/env node
/**
 * 可执行的假 `codex` CLI，供 `test/codex-exec.test.mjs` 使用。
 *
 * 契约（`docs/CONTRACT.md` 第 2 节）：
 * - 解析 argv，找到 `exec` 位置、所有 `-i <file>`、以及 `-o <file>`；从 stdin 读完整 prompt。
 * - 若设置 `FAKE_CODEX_ARGS_PATH`，把 `{ argv, stdin, cwd }` 以 JSON 写入该路径
 *   （另外附带 `pid` / `outputPath` / `images` 便于断言，不影响契约字段）。
 * - `FAKE_CODEX_ANSWER`（默认 `fake description`）写入 `-o` 指定的文件；
 *   `FAKE_CODEX_STDOUT` 打到 stdout。
 * - `FAKE_CODEX_EXIT_CODE` 非 0 时：向 stderr 写 `FAKE_CODEX_STDERR`（默认 `fake failure`），
 *   以该码退出（不写 answer）。
 * - `FAKE_CODEX_DELAY_MS` 存在时先 sleep 再输出（用于超时/中止测试；被 SIGTERM/SIGKILL
 *   杀死时不会写 answer）。
 *
 * 本文件零依赖，只用 `node:*`，并且必须保持可执行（`chmod +x`）。
 */

import { readFileSync, writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)

// 登录探测分支：`codex login status`（供 runCodexVision 的 checkLogin 预检使用）。
if (argv[0] === 'login' && argv[1] === 'status') {
  const status = process.env.FAKE_CODEX_LOGIN_STATUS ?? ''
  if (status) process.stdout.write(status)
  const statusCode = Number.parseInt(process.env.FAKE_CODEX_LOGIN_STATUS_EXIT ?? '0', 10) || 0
  process.exit(statusCode)
}

/**
 * 读取 stdin 上的完整 prompt。
 * @returns {string}
 */
function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

/** @type {string | null} */
let outputPath = null
/** @type {string[]} */
const images = []
let execIndex = -1

for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index]
  if (arg === 'exec' && execIndex === -1) {
    execIndex = index
  } else if (arg === '-o' && index + 1 < argv.length) {
    outputPath = argv[index + 1]
    index += 1
  } else if (arg === '-i' && index + 1 < argv.length) {
    images.push(argv[index + 1])
    index += 1
  }
}

const stdin = readStdin()

const argsPath = process.env.FAKE_CODEX_ARGS_PATH
if (argsPath) {
  writeFileSync(
    argsPath,
    JSON.stringify({
      argv,
      stdin,
      cwd: process.cwd(),
      // 以下为测试辅助字段（契约只要求 argv/stdin/cwd）。
      pid: process.pid,
      execIndex,
      outputPath,
      images,
    }),
  )
}

const delayMs = Number.parseInt(process.env.FAKE_CODEX_DELAY_MS ?? '', 10)
if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs))
}

const stdoutText = process.env.FAKE_CODEX_STDOUT
if (stdoutText) {
  process.stdout.write(stdoutText)
}

// 追加的 stdout（生图测试用它注入 JSONL 事件）；确保以换行结束，方便按行解析。
const stdoutExtra = process.env.FAKE_CODEX_STDOUT_EXTRA
if (stdoutExtra) {
  process.stdout.write(stdoutExtra.endsWith('\n') ? stdoutExtra : `${stdoutExtra}\n`)
}

const rawExitCode = process.env.FAKE_CODEX_EXIT_CODE
const exitCode = rawExitCode === undefined || rawExitCode === '' ? 0 : Number.parseInt(rawExitCode, 10) || 0

if (exitCode !== 0) {
  process.stderr.write(process.env.FAKE_CODEX_STDERR ?? 'fake failure')
  process.exit(exitCode)
}

const answer = process.env.FAKE_CODEX_ANSWER ?? 'fake description'
if (outputPath) {
  writeFileSync(outputPath, answer)
}
