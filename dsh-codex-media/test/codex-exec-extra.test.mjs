// Extra `runCodexVision` coverage added by the Lead: JSONL mode, stdout capture,
// empty image lists, and the fast `codex login status` preflight. Uses the
// shared fake-codex fixture; no network, credentials, or real Codex process.
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, afterEach, describe, it } from 'node:test'

import { CodexVisionError, runCodexVision } from '../lib/codex-exec.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TINY_PNG = join(HERE, 'fixtures', 'tiny.png')
const FAKE_CODEX = join(HERE, 'fixtures', 'fake-codex.mjs')

const scratchDirs = []
const envBaseline = new Map()

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-codex-media-exec-extra-'))
  scratchDirs.push(dir)
  return dir
}

function setEnv(key, value) {
  if (!envBaseline.has(key)) envBaseline.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined)
  process.env[key] = value
}

afterEach(() => {
  for (const [key, value] of envBaseline) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  envBaseline.clear()
})

after(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true })
})

try {
  chmodSync(FAKE_CODEX, 0o755)
} catch {
  // fixture may be mid-write during parallel development; tests fail clearly then.
}

/** Config that routes codex through the fake executable. */
function baseOptions(overrides = {}) {
  return {
    imagePaths: [TINY_PNG],
    prompt: 'describe the image',
    command: process.execPath,
    prefixArgs: [FAKE_CODEX],
    timeoutMs: 30000,
    ...overrides,
  }
}

describe('runCodexVision JSON/stdout extensions', () => {
  it('inserts --json right after exec and still parses the last message', async () => {
    const argsPath = join(scratch(), 'args.json')
    setEnv('FAKE_CODEX_ARGS_PATH', argsPath)
    setEnv('FAKE_CODEX_ANSWER', 'ok')
    const result = await runCodexVision(baseOptions({ json: true, captureStdout: true }))
    assert.equal(result.answer, 'ok')
    const recorded = JSON.parse(readFileSync(argsPath, 'utf8'))
    const execIndex = recorded.argv.indexOf('exec')
    assert.notEqual(execIndex, -1)
    assert.equal(recorded.argv[execIndex + 1], '--json')
    assert.equal(recorded.argv.at(-1), '-')
  })

  it('captures the full stdout and appends the fixture stdout extra', async () => {
    setEnv('FAKE_CODEX_STDOUT', 'progress-line\n')
    setEnv('FAKE_CODEX_STDOUT_EXTRA', '{"type":"item.completed","item":{"type":"imageGeneration","savedPath":"/tmp/x.png"}}')
    const result = await runCodexVision(baseOptions({ json: true, captureStdout: true }))
    assert.ok(result.stdout.includes('progress-line'))
    assert.ok(result.stdout.includes('savedPath'))
    assert.equal(result.stdoutTruncated, false)
  })

  it('flags truncated stdout when it exceeds maxStdoutBytes', async () => {
    setEnv('FAKE_CODEX_STDOUT', 'x'.repeat(200))
    const result = await runCodexVision(baseOptions({ captureStdout: true, maxStdoutBytes: 32 }))
    assert.equal(result.stdoutTruncated, true)
    assert.ok(Buffer.byteLength(result.stdout) <= 32)
  })

  it('accepts an empty imagePaths array (generation without reference images)', async () => {
    const argsPath = join(scratch(), 'args.json')
    setEnv('FAKE_CODEX_ARGS_PATH', argsPath)
    setEnv('FAKE_CODEX_ANSWER', 'generated')
    const result = await runCodexVision(baseOptions({ imagePaths: [] }))
    assert.equal(result.answer, 'generated')
    const recorded = JSON.parse(readFileSync(argsPath, 'utf8'))
    assert.equal(recorded.argv.includes('-i'), false)
  })
})

describe('runCodexVision login preflight', () => {
  it('fails fast with NOT_LOGGED_IN when codex login status reports a logged-out state', async () => {
    setEnv('FAKE_CODEX_LOGIN_STATUS', 'Not logged in')
    setEnv('FAKE_CODEX_LOGIN_STATUS_EXIT', '1')
    const startedAt = Date.now()
    await assert.rejects(
      runCodexVision(baseOptions({ checkLogin: true })),
      (error) => {
        assert.ok(error instanceof CodexVisionError)
        assert.equal(error.code, 'NOT_LOGGED_IN')
        assert.match(error.message, /codex login/)
        return true
      },
    )
    assert.ok(Date.now() - startedAt < 5000, 'preflight must fail well before the exec timeout')
  })

  it('proceeds normally when login status succeeds', async () => {
    setEnv('FAKE_CODEX_LOGIN_STATUS', 'Logged in as test@example.com')
    setEnv('FAKE_CODEX_ANSWER', 'ok after probe')
    const result = await runCodexVision(baseOptions({ checkLogin: true }))
    assert.equal(result.answer, 'ok after probe')
  })

  it('does not probe by default (checkLogin false)', async () => {
    setEnv('FAKE_CODEX_LOGIN_STATUS', 'Not logged in')
    setEnv('FAKE_CODEX_LOGIN_STATUS_EXIT', '1')
    setEnv('FAKE_CODEX_ANSWER', 'ran anyway')
    const result = await runCodexVision(baseOptions())
    assert.equal(result.answer, 'ran anyway')
  })
})

describe('runCodexVision validation for new options', () => {
  it('rejects non-boolean json/checkLogin and negative maxStdoutBytes', async () => {
    for (const overrides of [{ json: 'yes' }, { captureStdout: 1 }, { checkLogin: 'no' }, { maxStdoutBytes: -1 }]) {
      await assert.rejects(runCodexVision(baseOptions(overrides)), (error) => {
        assert.ok(error instanceof CodexVisionError)
        assert.equal(error.code, 'INVALID_CONFIG')
        return true
      })
    }
  })
})

// Keep a dummy write so an accidentally empty test file still creates a scratch dir.
it('scratch helper works', () => {
  const dir = scratch()
  writeFileSync(join(dir, 'marker'), 'ok')
  assert.equal(readFileSync(join(dir, 'marker'), 'utf8'), 'ok')
})
