// Integration tests for the dsh-codex-media plugin's `apply()` and both tools
// (`codex_imagegen`, `codex_vision`), driven through a fake `codex` executable.
// These tests exercise the real tool definitions and the real image-source /
// codex-exec / imagegen modules; only the Codex process is faked, so no OpenAI
// credentials or network are needed.
import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, afterEach, describe, it } from 'node:test'

import { apply } from '../lib/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const TINY_PNG_PATH = join(HERE, 'fixtures', 'tiny.png')
const TINY_PNG = readFileSync(TINY_PNG_PATH)
const TINY_PNG_BASE64 = TINY_PNG.toString('base64')
const FAKE_CODEX = join(HERE, 'fixtures', 'fake-codex.mjs')

const scratchDirs = []
const envBaseline = new Map()
const servers = []

/** @returns {string} a fresh scratch directory. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-codex-media-plugin-test-'))
  scratchDirs.push(dir)
  return dir
}

/** Set a process environment variable and remember how to restore it. */
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

after(async () => {
  for (const server of servers) await new Promise((resolve) => server.close(resolve))
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true })
})

/** Start a fake OneBot v11 HTTP endpoint that records requests. */
async function startOneBot() {
  const requests = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    requests.push({ url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 777 } }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, requests }
}

/** Create an Aurabot data-dir fixture pointing at the fake OneBot endpoint. */
async function makeAurabotDir(baseUrl, sessionId, chatId = 'group:123456') {
  const dir = scratch()
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ enabled: true, dryRun: false, snowluma: { httpUrl: baseUrl, httpToken: 'tok' } }))
  writeFileSync(join(dir, 'sessions.json'), JSON.stringify({ chats: { [chatId]: { sessionId } } }))
  return dir
}

try {
  chmodSync(FAKE_CODEX, 0o755)
} catch {
  // The fixture may be missing while another workstream is still writing it;
  // affected tests then fail with a clear ENOENT instead of crashing imports.
}

/**
 * Build a stub Cordis context that captures every registered tool.
 * @param {{ cwd?: string, attachments?: boolean }} [options]
 */
function makeContext(options = {}) {
  /** @type {Map<string, any>} */
  const registered = new Map()
  const ctx = {
    tools: {
      register(definition) {
        registered.set(definition.name, definition)
        return () => {}
      },
    },
    logger: { info() {}, warn() {}, error() {} },
    get(service) {
      if (service === 'workingDirectory' && options.cwd !== undefined) {
        return { async ensure() { return options.cwd } }
      }
      if (service === 'attachments' && options.attachments === true) {
        return {
          async saveImage({ data, mediaType, name }) {
            return { attachmentId: 'att-test-1', mediaType, bytes: data.length, width: 2, height: 3, name }
          },
        }
      }
      return undefined
    },
  }
  return {
    ctx,
    tool(name) {
      const definition = registered.get(name)
      assert.ok(definition, `expected tool ${name} to be registered; got ${[...registered.keys()].join(', ')}`)
      return definition
    },
    names() {
      return [...registered.keys()]
    },
  }
}

/** Config that routes every Codex call through the repository's fake codex. */
function baseConfig(overrides = {}) {
  return {
    command: process.execPath,
    prefixArgs: [FAKE_CODEX],
    extraArgs: [],
    model: '',
    codexHome: '',
    env: {},
    sandbox: 'read-only',
    timeoutMs: 30000,
    maxImages: 6,
    maxImageBytes: 20 * 1024 * 1024,
    allowUrls: true,
    allowDataUrls: true,
    allowPrivateUrls: false,
    defaultPrompt: 'describe',
    imageSandbox: 'workspace-write',
    imageTimeoutMs: 30000,
    maxReferenceImages: 4,
    maxGeneratedBytes: 50 * 1024 * 1024,
    outputDir: 'output/imagegen',
    overwriteOutput: false,
    ...overrides,
  }
}

/** Minimal tool execution context. */
function execContext(signal = new AbortController().signal) {
  return { signal, callId: 'test-call' }
}

/**
 * Environment for a fake Codex call that "generates" the given source image by
 * reporting a savedPath in a JSONL event.
 * @param {string|null} savedPath
 * @param {{ revisedPrompt?: string, argsPath?: string, answer?: string }} [options]
 */
function fakeImageGenEnv(savedPath, options = {}) {
  if (options.argsPath !== undefined) setEnv('FAKE_CODEX_ARGS_PATH', options.argsPath)
  setEnv('FAKE_CODEX_ANSWER', options.answer ?? 'DONE')
  if (savedPath === null) {
    setEnv('FAKE_CODEX_STDOUT_EXTRA', '')
    return
  }
  const event = {
    type: 'item.completed',
    item: {
      type: 'imageGeneration',
      savedPath,
      ...(options.revisedPrompt === undefined ? {} : { revisedPrompt: options.revisedPrompt }),
      status: 'completed',
    },
  }
  setEnv('FAKE_CODEX_STDOUT_EXTRA', JSON.stringify(event))
}

describe('plugin registration', () => {
  it('registers exactly codex_imagegen and codex_vision with documented arguments', () => {
    const { ctx, tool, names } = makeContext()
    apply(ctx, baseConfig())
    assert.deepEqual(names().sort(), ['codex_imagegen', 'codex_vision'])

    const imagegen = tool('codex_imagegen')
    assert.match(imagegen.description, /image_gen/)
    assert.deepEqual(Object.keys(imagegen.parameters.properties), ['prompt', 'output', 'reference_images', 'transparent_background'])
    assert.ok(imagegen.parameters.required.includes('prompt'))
    assert.equal(imagegen.isConcurrencySafe({ prompt: 'x' }), false)

    const vision = tool('codex_vision')
    assert.match(vision.description, /Codex/)
    assert.deepEqual(Object.keys(vision.parameters.properties), ['images', 'prompt', 'model'])
    assert.ok(vision.parameters.required.includes('images'))
    assert.equal(vision.isConcurrencySafe({ images: ['x'] }), true)
  })

  it('emits the boot marker only when its environment gate is set', () => {
    const messages = []
    const original = console.log
    console.log = (...args) => messages.push(args.join(' '))
    try {
      apply(makeContext().ctx, baseConfig())
      assert.equal(messages.length, 0)
      setEnv('DSH_CODEX_MEDIA_BOOT_MARKER', '1')
      apply(makeContext().ctx, baseConfig())
    } finally {
      console.log = original
    }
    assert.ok(messages.some((line) => line.includes('[dsh-codex-media]') && line.includes('codex_imagegen') && line.includes('codex_vision')))
  })
})

describe('codex_vision execution', () => {
  it('passes an absolute image path and the composed prompt to Codex and returns the answer', async () => {
    const argsPath = join(scratch(), 'args.json')
    setEnv('FAKE_CODEX_ARGS_PATH', argsPath)
    setEnv('FAKE_CODEX_ANSWER', '一只 1x1 的透明像素。')

    const { ctx, tool } = makeContext()
    apply(ctx, baseConfig())
    const result = await tool('codex_vision').execute(
      { images: [TINY_PNG_PATH], prompt: '图里有什么？' },
      execContext(),
    )

    assert.equal(result.answer, '一只 1x1 的透明像素。')
    assert.equal(result.images.length, 1)
    assert.equal(result.images[0].kind, 'file')
    assert.equal(result.images[0].mediaType, 'image/png')
    assert.equal(result.images[0].bytes, TINY_PNG.length)
    assert.equal(result.model, undefined)

    const recorded = JSON.parse(readFileSync(argsPath, 'utf8'))
    assert.ok(recorded.argv.includes('-i'))
    assert.ok(recorded.argv.includes(TINY_PNG_PATH))
    assert.ok(recorded.argv.includes('--ephemeral'))
    assert.ok(recorded.argv.includes('--skip-git-repo-check'))
    assert.ok(recorded.argv.includes('read-only'))
    assert.equal(recorded.argv.at(-1), '-')
    assert.match(recorded.stdin, /视觉识别器/)
    assert.match(recorded.stdin, /图里有什么？/)
  })

  it('resolves relative image paths against the session working directory', async () => {
    setEnv('FAKE_CODEX_ANSWER', 'relative ok')
    const { ctx, tool } = makeContext({ cwd: HERE })
    apply(ctx, baseConfig())
    const result = await tool('codex_vision').execute({ images: ['fixtures/tiny.png'] }, execContext())
    assert.equal(result.images[0].kind, 'file')
    assert.equal(result.answer, 'relative ok')
  })

  it('reports a missing local image as a NOT_FOUND tool error', async () => {
    const { ctx, tool } = makeContext()
    apply(ctx, baseConfig())
    await assert.rejects(
      tool('codex_vision').execute({ images: [join(scratch(), 'missing.png')] }, execContext()),
      (error) => {
        assert.match(error.message, /NOT_FOUND/)
        assert.match(error.message, /codex_vision/)
        return true
      },
    )
  })

  it('rejects empty and over-limit image lists', async () => {
    const { ctx, tool } = makeContext()
    apply(ctx, baseConfig({ maxImages: 1 }))
    await assert.rejects(tool('codex_vision').execute({ images: [] }, execContext()), /至少需要 1 个/)
    await assert.rejects(tool('codex_vision').execute({ images: [TINY_PNG_PATH, TINY_PNG_PATH] }, execContext()), /最多 1 张/)
  })

  it('surfaces the unauthenticated-Codex diagnosis and the exit code', async () => {
    setEnv('FAKE_CODEX_EXIT_CODE', '1')
    setEnv('FAKE_CODEX_STDERR', 'Not logged in')
    const { ctx, tool } = makeContext()
    apply(ctx, baseConfig())
    await assert.rejects(
      tool('codex_vision').execute({ images: [TINY_PNG_PATH] }, execContext()),
      (error) => {
        assert.match(error.message, /EXIT_NONZERO/)
        assert.match(error.message, /exit=1/)
        assert.match(error.message, /Not logged in/)
        assert.match(error.message, /codex login/)
        return true
      },
    )
  })
})

describe('codex_imagegen execution', () => {
  it('generates an image, copies it to the workspace and returns path + inline attachment', async () => {
    const cwd = scratch()
    const generated = join(cwd, 'codex-home', 'generated_images', 'whale.png')
    mkdirSync(dirname(generated), { recursive: true })
    writeFileSync(generated, TINY_PNG)
    const argsPath = join(cwd, 'args.json')
    fakeImageGenEnv(generated, { argsPath, revisedPrompt: '一只戴着墨镜的鲸鱼' })

    const { ctx, tool } = makeContext({ cwd, attachments: true })
    apply(ctx, baseConfig())
    const result = await tool('codex_imagegen').execute({ prompt: '一只戴墨镜的鲸鱼' }, execContext())

    assert.ok(result.path.startsWith(join(cwd, 'output', 'imagegen')), `unexpected path ${result.path}`)
    assert.ok(existsSync(result.path))
    assert.deepEqual([...readFileSync(result.path)], [...TINY_PNG])
    assert.equal(result.mediaType, 'image/png')
    assert.equal(result.bytes, TINY_PNG.length)
    assert.equal(result.revisedPrompt, '一只戴着墨镜的鲸鱼')
    assert.deepEqual(result.attachment, {
      attachmentId: 'att-test-1',
      mediaType: 'image/png',
      bytes: TINY_PNG.length,
      width: 2,
      height: 3,
      name: result.path.split('/').at(-1),
    })

    const recorded = JSON.parse(readFileSync(argsPath, 'utf8'))
    assert.ok(recorded.argv.includes('--json'), 'imagegen must request JSONL events')
    assert.ok(recorded.argv.includes('workspace-write'))
    assert.equal(recorded.argv.at(-1), '-')
    assert.match(recorded.stdin, /一只戴墨镜的鲸鱼/)
    assert.match(recorded.stdin, new RegExp(result.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

    const rendered = tool('codex_imagegen').output.render({ prompt: 'x' }, result)
    assert.equal(rendered[0].type, 'text')
    assert.match(rendered[0].text, /已生成图片/)
    assert.equal(rendered[1].type, 'image')
    assert.equal(rendered[1].attachment.attachmentId, 'att-test-1')
    assert.match(rendered[0].text, /聊天发送/)
    assert.ok(rendered[0].text.includes(`![图片](${result.path})`), 'tool result must carry the QQ/Aurabot image-reply line with the absolute path')
  })

  it('passes reference images to Codex and reports them', async () => {
    const cwd = scratch()
    const generated = join(cwd, 'gen.png')
    writeFileSync(generated, TINY_PNG)
    const argsPath = join(cwd, 'args.json')
    fakeImageGenEnv(generated, { argsPath })

    const { ctx, tool } = makeContext({ cwd })
    apply(ctx, baseConfig())
    const result = await tool('codex_imagegen').execute(
      { prompt: '把背景改成晚霞', reference_images: [TINY_PNG_PATH] },
      execContext(),
    )

    assert.equal(result.references.length, 1)
    assert.equal(result.references[0].kind, 'file')
    assert.equal(result.attachment, undefined, 'no attachment store, so text-only result')
    const recorded = JSON.parse(readFileSync(argsPath, 'utf8'))
    assert.ok(recorded.argv.includes('-i'))
    assert.ok(recorded.argv.includes(TINY_PNG_PATH))
    assert.match(recorded.stdin, /随附 1 张参考图/)
  })

  it('honours an explicit output path and versions an existing file', async () => {
    const cwd = scratch()
    mkdirSync(join(cwd, 'art'), { recursive: true })
    writeFileSync(join(cwd, 'art', 'hero.png'), TINY_PNG)
    const generated = join(cwd, 'gen.png')
    writeFileSync(generated, TINY_PNG)
    const argsPath = join(cwd, 'args.json')
    fakeImageGenEnv(generated, { argsPath })

    const { ctx, tool } = makeContext({ cwd })
    apply(ctx, baseConfig())
    const result = await tool('codex_imagegen').execute(
      { prompt: '一张海报', output: 'art/hero.png' },
      execContext(),
    )
    assert.equal(result.path, join(cwd, 'art', 'hero-v2.png'))
    assert.equal(result.relativePath, join('art', 'hero-v2.png'))
    assert.ok(existsSync(result.path))
    assert.deepEqual([...readFileSync(join(cwd, 'art', 'hero.png'))], [...TINY_PNG], 'existing file must not be overwritten')
  })

  it('rejects output paths outside the workspace and non-.png targets before calling Codex', async () => {
    const cwd = scratch()
    const { ctx, tool } = makeContext({ cwd })
    apply(ctx, baseConfig())
    await assert.rejects(
      tool('codex_imagegen').execute({ prompt: 'x', output: '../escape.png' }, execContext()),
      (error) => {
        assert.match(error.message, /OUTPUT_OUTSIDE_WORKSPACE/)
        return true
      },
    )
    await assert.rejects(
      tool('codex_imagegen').execute({ prompt: 'x', output: 'art/hero.jpg' }, execContext()),
      (error) => {
        assert.match(error.message, /INVALID_OUTPUT/)
        return true
      },
    )
  })

  it('pushes the generated image straight into the current QQ chat when qqDelivery is enabled', async () => {
    const cwd = scratch()
    const generated = join(cwd, 'gen.png')
    writeFileSync(generated, TINY_PNG)
    fakeImageGenEnv(generated)
    const { baseUrl, requests } = await startOneBot()
    const aurabotDir = await makeAurabotDir(baseUrl, 'session-qq-1')

    const { ctx, tool } = makeContext({ cwd })
    apply(ctx, baseConfig({ qqDelivery: { enabled: true, aurabotDataDir: aurabotDir } }))
    const result = await tool('codex_imagegen').execute(
      { prompt: '一只鲸鱼' },
      { signal: new AbortController().signal, callId: 'qq-call', agent: { session: { id: 'session-qq-1' } } },
    )

    assert.deepEqual(result.delivery, { chatId: 'group:123456', kind: 'group', messageId: 777 })
    assert.equal(result.deliveryNote, undefined)
    const rendered = tool('codex_imagegen').output.render({ prompt: 'x' }, result)
    assert.match(rendered[0].text, /已直接发到 QQ：group:123456/)
    assert.ok(!rendered[0].text.includes('![图片]'), 'no markdown fallback after a successful direct send')

    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, '/send_group_msg')
    assert.equal(requests[0].body.group_id, 123456)
    assert.equal(requests[0].headers.authorization, 'Bearer tok')
    assert.equal(requests[0].body.message[0].type, 'image')
  })

  it('keeps the markdown fallback and explains the skip when the session is not an Aurabot chat', async () => {
    const cwd = scratch()
    const generated = join(cwd, 'gen.png')
    writeFileSync(generated, TINY_PNG)
    fakeImageGenEnv(generated)
    const { baseUrl, requests } = await startOneBot()
    const aurabotDir = await makeAurabotDir(baseUrl, 'some-other-session')

    const { ctx, tool } = makeContext({ cwd })
    apply(ctx, baseConfig({ qqDelivery: { enabled: true, aurabotDataDir: aurabotDir } }))
    const result = await tool('codex_imagegen').execute(
      { prompt: '一只鲸鱼' },
      { signal: new AbortController().signal, callId: 'qq-call', agent: { session: { id: 'session-qq-1' } } },
    )
    assert.equal(result.delivery, undefined)
    assert.equal(result.deliveryNote, 'not-an-aurabot-chat')
    assert.equal(requests.length, 0)
    const rendered = tool('codex_imagegen').output.render({ prompt: 'x' }, result)
    assert.ok(rendered[0].text.includes('![图片]('))
    assert.match(rendered[0].text, /未自动发到 QQ/)
  })

  it('asks image_gen for a transparent background when requested', async () => {
    const cwd = scratch()
    const generated = join(cwd, 'gen.png')
    writeFileSync(generated, TINY_PNG)
    const argsPath = join(cwd, 'args.json')
    fakeImageGenEnv(generated, { argsPath })
    const { ctx, tool } = makeContext({ cwd })
    apply(ctx, baseConfig())
    await tool('codex_imagegen').execute({ prompt: '透明背景的贴纸', transparent_background: true }, execContext())
    const recorded = JSON.parse(readFileSync(argsPath, 'utf8'))
    assert.match(recorded.stdin, /transparent background/)
  })

  it('reports IMAGE_GEN_FAILED when Codex reports an image_gen failure', async () => {
    const cwd = scratch()
    setEnv('FAKE_CODEX_ANSWER', 'FAILED usage limit')
    setEnv('FAKE_CODEX_STDOUT_EXTRA', JSON.stringify({
      type: 'item.completed',
      item: { type: 'imageGeneration', failure: { type: 'usageLimitExceeded', limitId: 'img' } },
    }))
    const { ctx, tool } = makeContext({ cwd })
    apply(ctx, baseConfig())
    await assert.rejects(
      tool('codex_imagegen').execute({ prompt: '一只鲸鱼' }, execContext()),
      (error) => {
        assert.match(error.message, /IMAGE_GEN_FAILED/)
        assert.match(error.message, /usageLimitExceeded/)
        return true
      },
    )
  })

  it('reports NO_IMAGE with the Codex answer when no image was produced', async () => {
    const cwd = scratch()
    setEnv('FAKE_CODEX_ANSWER', '内置 image_gen 不可用')
    setEnv('FAKE_CODEX_STDOUT_EXTRA', '')
    const { ctx, tool } = makeContext({ cwd })
    apply(ctx, baseConfig())
    await assert.rejects(
      tool('codex_imagegen').execute({ prompt: '一只鲸鱼' }, execContext()),
      (error) => {
        assert.match(error.message, /NO_IMAGE/)
        assert.match(error.message, /内置 image_gen 不可用/)
        return true
      },
    )
  })

  it('rejects empty prompts and over-limit reference images', async () => {
    const cwd = scratch()
    const { ctx, tool } = makeContext({ cwd })
    apply(ctx, baseConfig({ maxReferenceImages: 1 }))
    await assert.rejects(tool('codex_imagegen').execute({ prompt: '   ' }, execContext()), /prompt 不能为空/)
    await assert.rejects(
      tool('codex_imagegen').execute({ prompt: 'x', reference_images: [TINY_PNG_PATH, TINY_PNG_PATH] }, execContext()),
      /参考图最多 1 张/,
    )
  })

  it('surfaces the unauthenticated-Codex diagnosis for imagegen too', async () => {
    const cwd = scratch()
    setEnv('FAKE_CODEX_EXIT_CODE', '1')
    setEnv('FAKE_CODEX_STDERR', 'Not logged in')
    const { ctx, tool } = makeContext({ cwd })
    apply(ctx, baseConfig())
    await assert.rejects(
      tool('codex_imagegen').execute({ prompt: '一只鲸鱼' }, execContext()),
      (error) => {
        assert.match(error.message, /EXIT_NONZERO/)
        assert.match(error.message, /codex login/)
        return true
      },
    )
  })
})
