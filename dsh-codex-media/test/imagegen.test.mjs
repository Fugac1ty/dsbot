// Unit tests for the image-generation helpers: prompt building, Codex JSONL
// event parsing, output-path policy, and placing/discovering the generated
// image. No Codex process or network is involved.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import {
  ImageGenError,
  buildImageGenPrompt,
  findNewestImage,
  parseImageGenEvents,
  pickGeneratedImage,
  placeGeneratedImage,
  resolveOutputPath,
} from '../lib/imagegen.mjs'

const TINY_PNG = await readFile(new URL('./fixtures/tiny.png', import.meta.url))

const scratchDirs = []

/** @returns {Promise<string>} */
async function scratch() {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-codex-media-imagegen-test-'))
  scratchDirs.push(dir)
  return dir
}

after(async () => {
  for (const dir of scratchDirs) await rm(dir, { recursive: true, force: true })
})

describe('buildImageGenPrompt', () => {
  it('includes the request, target path and image_gen requirements', () => {
    const prompt = buildImageGenPrompt({ request: '一只戴墨镜的鲸鱼', outputPath: '/work/output/imagegen/a.png' })
    assert.match(prompt, /一只戴墨镜的鲸鱼/)
    assert.match(prompt, /\/work\/output\/imagegen\/a\.png/)
    assert.match(prompt, /image_gen/)
    assert.match(prompt, /DONE/)
    assert.doesNotMatch(prompt, /transparent background/)
    assert.doesNotMatch(prompt, /参考图/)
  })

  it('mentions references and transparent background when requested', () => {
    const prompt = buildImageGenPrompt({
      request: '把背景改成晚霞',
      outputPath: '/work/out.png',
      referenceCount: 2,
      transparentBackground: true,
    })
    assert.match(prompt, /随附 2 张参考图/)
    assert.match(prompt, /transparent background/)
  })
})

describe('parseImageGenEvents', () => {
  it('extracts savedPath from app-server style notifications', () => {
    const stdout = [
      '{"jsonrpc":"2.0","method":"item/completed","params":{"item":{"type":"imageGeneration","savedPath":"/home/u/.codex/generated_images/a.png","revisedPrompt":"a whale","status":"completed"}}}',
      '{"jsonrpc":"2.0","method":"turn/completed","params":{}}',
    ].join('\n')
    const parsed = parseImageGenEvents(stdout)
    assert.deepEqual(parsed.savedPaths, ['/home/u/.codex/generated_images/a.png'])
    assert.equal(parsed.revisedPrompt, 'a whale')
    assert.equal(parsed.eventCount, 2)
    assert.equal(parsed.failures.length, 0)
  })

  it('extracts camelCase and snake_case paths from exec --json envelopes', () => {
    const stdout = [
      '{"type":"item.completed","item":{"type":"image_generation","saved_path":"/tmp/x.png"}}',
      '{"type":"item.completed","item":{"type":"image_generation","savedPath":"/tmp/y.png"}}',
    ].join('\n')
    const parsed = parseImageGenEvents(stdout)
    assert.deepEqual(parsed.savedPaths, ['/tmp/x.png', '/tmp/y.png'])
  })

  it('decodes inline base64 image results and reports failures', () => {
    const base64 = TINY_PNG.toString('base64')
    const stdout = [
      `{"type":"item.completed","item":{"type":"image_generation_call","result":"${base64}","status":"completed"}}`,
      '{"type":"item.completed","item":{"type":"imageGeneration","failure":{"type":"usageLimitExceeded","limitId":"img","resetsAt":1790000000000}}}',
    ].join('\n')
    const parsed = parseImageGenEvents(stdout)
    assert.equal(parsed.inlineImages.length, 1)
    assert.deepEqual([...parsed.inlineImages[0]], [...TINY_PNG])
    assert.equal(parsed.failures.length, 1)
    assert.match(parsed.failures[0], /usageLimitExceeded/)
  })

  it('ignores non-JSON lines and empty input', () => {
    assert.deepEqual(parseImageGenEvents(''), { savedPaths: [], inlineImages: [], failures: [], eventCount: 0 })
    const parsed = parseImageGenEvents('not json\n{"ok":true}\n\n')
    assert.equal(parsed.eventCount, 1)
    assert.deepEqual(parsed.savedPaths, [])
  })
})

describe('resolveOutputPath', () => {
  it('defaults inside <cwd>/output/imagegen with a .png name', async () => {
    const cwd = await scratch()
    const target = await resolveOutputPath({ cwd })
    assert.equal(path.dirname(target.outputPath), path.join(cwd, 'output', 'imagegen'))
    assert.match(path.basename(target.outputPath), /^codex-.*\.png$/)
    assert.equal(target.relativePath, path.relative(cwd, target.outputPath))
    assert.equal(target.defaulted, true)
  })

  it('accepts a relative .png path inside the workspace', async () => {
    const cwd = await scratch()
    const target = await resolveOutputPath({ cwd, requested: 'art/hero.png' })
    assert.equal(target.outputPath, path.join(cwd, 'art', 'hero.png'))
    assert.equal(target.defaulted, false)
  })

  it('rejects paths outside the workspace, non-.png and empty-ish requests', async () => {
    const cwd = await scratch()
    await assert.rejects(resolveOutputPath({ cwd, requested: '../escape.png' }), (error) => {
      assert.ok(error instanceof ImageGenError)
      assert.equal(error.code, 'OUTPUT_OUTSIDE_WORKSPACE')
      return true
    })
    await assert.rejects(resolveOutputPath({ cwd, requested: '/tmp/absolute.png' }), (error) => {
      assert.equal(error.code, 'OUTPUT_OUTSIDE_WORKSPACE')
      return true
    })
    await assert.rejects(resolveOutputPath({ cwd, requested: 'art/hero.jpg' }), (error) => {
      assert.equal(error.code, 'INVALID_OUTPUT')
      return true
    })
    await assert.rejects(resolveOutputPath({ cwd, requested: 'art/hero.webp' }), (error) => {
      assert.equal(error.code, 'INVALID_OUTPUT')
      assert.match(error.message, /只支持 .png/)
      return true
    })
  })

  it('versions an existing file instead of overwriting, unless overwrite is enabled', async () => {
    const cwd = await scratch()
    await mkdir(path.join(cwd, 'art'), { recursive: true })
    await writeFile(path.join(cwd, 'art', 'hero.png'), 'existing')
    const versioned = await resolveOutputPath({ cwd, requested: 'art/hero.png' })
    assert.equal(versioned.outputPath, path.join(cwd, 'art', 'hero-v2.png'))
    const overwritten = await resolveOutputPath({ cwd, requested: 'art/hero.png', overwrite: true })
    assert.equal(overwritten.outputPath, path.join(cwd, 'art', 'hero.png'))
  })
})

describe('findNewestImage', () => {
  it('returns the newest image after `since` and skips skipped directories', async () => {
    const cwd = await scratch()
    const oldFile = path.join(cwd, 'old.png')
    const newFile = path.join(cwd, 'nested', 'new.png')
    await mkdir(path.dirname(newFile), { recursive: true })
    await mkdir(path.join(cwd, 'node_modules'), { recursive: true })
    await writeFile(oldFile, TINY_PNG)
    await writeFile(newFile, TINY_PNG)
    await writeFile(path.join(cwd, 'node_modules', 'ignored.png'), TINY_PNG)
    const now = Date.now()
    const oldTime = new Date(now - 60_000)
    await import('node:fs/promises').then(({ utimes }) => utimes(oldFile, oldTime, oldTime))
    const found = await findNewestImage({ cwd, since: now - 30_000 })
    assert.equal(found, newFile)
  })
})

describe('placeGeneratedImage', () => {
  it('writes an inline buffer atomically and sniffs its media type', async () => {
    const cwd = await scratch()
    const outputPath = path.join(cwd, 'out.png')
    const placed = await placeGeneratedImage({ buffer: TINY_PNG, outputPath, maxBytes: 1_000_000 })
    assert.equal(placed.mediaType, 'image/png')
    assert.equal(placed.bytes, TINY_PNG.length)
    assert.deepEqual([...(await readFile(outputPath))], [...TINY_PNG])
  })

  it('rejects non-image bytes and oversized files', async () => {
    const cwd = await scratch()
    await assert.rejects(
      placeGeneratedImage({ buffer: Buffer.from('not an image'), outputPath: path.join(cwd, 'bad.png'), maxBytes: 1000 }),
      (error) => {
        assert.equal(error.code, 'IMAGE_INVALID')
        return true
      },
    )
    await assert.rejects(
      placeGeneratedImage({ buffer: TINY_PNG, outputPath: path.join(cwd, 'big.png'), maxBytes: 10 }),
      (error) => {
        assert.equal(error.code, 'IMAGE_TOO_LARGE')
        return true
      },
    )
  })

  it('rejects a non-image source file', async () => {
    const cwd = await scratch()
    const source = path.join(cwd, 'fake.png')
    await writeFile(source, 'plain text')
    await assert.rejects(
      placeGeneratedImage({ sourcePath: source, outputPath: path.join(cwd, 'final.png'), maxBytes: 1000 }),
      (error) => {
        assert.equal(error.code, 'IMAGE_INVALID')
        return true
      },
    )
  })
})

describe('pickGeneratedImage', () => {
  it('prefers an inline base64 result over everything else', async () => {
    const cwd = await scratch()
    const outputPath = path.join(cwd, 'out.png')
    const result = await pickGeneratedImage({
      parsed: { savedPaths: [], inlineImages: [TINY_PNG], failures: [], eventCount: 1 },
      startedAt: Date.now(),
      cwd,
      outputPath,
      maxBytes: 1_000_000,
    })
    assert.equal(result.mediaType, 'image/png')
    await stat(outputPath)
  })

  it('copies the savedPath reported by Codex', async () => {
    const cwd = await scratch()
    const saved = path.join(cwd, 'codex-home', 'generated_images', 'g.png')
    await mkdir(path.dirname(saved), { recursive: true })
    await writeFile(saved, TINY_PNG)
    const outputPath = path.join(cwd, 'final.png')
    const result = await pickGeneratedImage({
      parsed: { savedPaths: [saved], inlineImages: [], failures: [], eventCount: 1 },
      startedAt: Date.now() - 1000,
      cwd,
      outputPath,
      maxBytes: 1_000_000,
    })
    assert.equal(result.sourcePath, saved)
    assert.deepEqual([...(await readFile(outputPath))], [...TINY_PNG])
  })

  it('accepts a file Codex already copied to the target path and otherwise scans the workspace', async () => {
    const cwd = await scratch()
    const outputPath = path.join(cwd, 'already-there.png')
    await writeFile(outputPath, TINY_PNG)
    const first = await pickGeneratedImage({
      parsed: { savedPaths: [], inlineImages: [], failures: [], eventCount: 0 },
      startedAt: Date.now() - 1000,
      cwd,
      outputPath,
      maxBytes: 1_000_000,
    })
    assert.equal(first.mediaType, 'image/png')

    const outputPath2 = path.join(cwd, 'scan', 'picked.png')
    await mkdir(path.dirname(outputPath2), { recursive: true })
    const discovered = path.join(cwd, 'discovered.png')
    await writeFile(discovered, TINY_PNG)
    const second = await pickGeneratedImage({
      parsed: { savedPaths: [], inlineImages: [], failures: [], eventCount: 0 },
      startedAt: Date.now() - 5000,
      cwd,
      outputPath: outputPath2,
      maxBytes: 1_000_000,
    })
    assert.equal(second.mediaType, 'image/png')
    await stat(outputPath2)
  })

  it('reports IMAGE_GEN_FAILED when Codex reported a failure and produced nothing', async () => {
    const cwd = await scratch()
    await assert.rejects(
      pickGeneratedImage({
        parsed: { savedPaths: [], inlineImages: [], failures: ['生图额度用尽'], eventCount: 1 },
        startedAt: Date.now(),
        cwd,
        outputPath: path.join(cwd, 'out.png'),
        maxBytes: 1_000_000,
      }),
      (error) => {
        assert.equal(error.code, 'IMAGE_GEN_FAILED')
        assert.match(error.message, /额度/)
        return true
      },
    )
  })

  it('reports NO_IMAGE with a hint when Codex produced nothing at all', async () => {
    const cwd = await scratch()
    await assert.rejects(
      pickGeneratedImage({
        parsed: { savedPaths: [], inlineImages: [], failures: [], eventCount: 0 },
        startedAt: Date.now(),
        cwd,
        outputPath: path.join(path.dirname(cwd), 'outside.png'),
        maxBytes: 1_000_000,
      }),
      (error) => {
        assert.equal(error.code, 'NO_IMAGE')
        assert.match(error.message, /Codex 没有产出/)
        return true
      },
    )
  })
})
