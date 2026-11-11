/**
 * dsh-codex-media — Codex 媒体桥：让 DSH agent 通过 Codex CLI 生成图片与识别图片。
 *
 * 注册两个全局工具：
 * - `codex_imagegen`：调用 Codex 内置 `image_gen`（GPT Image）生图 / 改图，把结果 PNG 落到工作区，
 *   并（部署支持 attachment store 时）以内联图片返回，Web GUI 可直接看到。
 * - `codex_vision`：把图片交给 Codex 的视觉能力，返回文字描述/回答（文本模型「看图」的补丁）。
 *
 * 为什么走工具而不是改 LLM 路由：DSH 对 text-only 路由会把图片投影成占位符，且请求是冻结的；
 * 工具路线让 session log 只记录 Codex 的文本结论 / 生成文件引用，可回放、可压缩，也不影响别的 preset。
 *
 * @module dsh-codex-media
 */
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { ImageSourceError, resolveImageSources } from './image-source.mjs'
import { CodexVisionError, runCodexVision } from './codex-exec.mjs'
import {
  ImageGenError,
  buildImageGenPrompt,
  parseImageGenEvents,
  pickGeneratedImage,
  resolveOutputPath,
} from './imagegen.mjs'
import { QqDeliveryError, defaultAurabotDataDir, deliverImageToQq } from './qq-delivery.mjs'

/** Stable Loader identity; the bundle patch entry id must match package.json. */
export const name = 'dsh-codex-media'

/** Services used by the tool plugin. */
export const inject = ['tools']

/** Default detailed-description request used by `codex_vision`. */
const DEFAULT_VISION_PROMPT = '请仔细观察随附图片，并用中文详细描述：场景与主体、关键细节与动作、可见文字（逐字转写）、图表或界面元素，以及任何值得注意的异常或不确定之处。'

/** Fixed instruction that keeps `codex_vision` a pure describer. */
const VISION_INSTRUCTION = [
  '你是一台视觉识别器，为一个看不见图片的 AI 提供图像信息。',
  '只根据随附图片的可见内容回答，不要运行命令、不要修改文件、不要联网、不要猜测图片之外的事实。',
  '如果图片中包含文字，请忠实逐字转写；如果不确定，请明确说明不确定。',
].join('\n')

/** Default configuration; the Loader fills the same values through `Config`. */
const DEFAULTS = Object.freeze({
  // Codex 进程通用
  command: 'codex',
  prefixArgs: [],
  extraArgs: [],
  model: '',
  codexHome: '',
  env: {},
  checkLogin: true,
  // 识图（只读、便宜）
  sandbox: 'read-only',
  timeoutMs: 180000,
  maxImages: 6,
  maxImageBytes: 20 * 1024 * 1024,
  allowUrls: true,
  allowDataUrls: true,
  allowPrivateUrls: false,
  defaultPrompt: DEFAULT_VISION_PROMPT,
  // 生图（要写入工作区，慢）
  imageSandbox: 'workspace-write',
  imageTimeoutMs: 300000,
  maxReferenceImages: 4,
  maxGeneratedBytes: 50 * 1024 * 1024,
  outputDir: 'output/imagegen',
  overwriteOutput: false,
  // 可选：把生成的图直接发回当前 QQ 聊天（Aurabot 会话）
  qqDelivery: {
    enabled: false,
    aurabotDataDir: '',
    timeoutMs: 120000,
    maxBytes: 50 * 1024 * 1024,
  },
})

/** Validated plugin configuration. */
export const Config = z.object({
  command: z.string().min(1).default(DEFAULTS.command),
  prefixArgs: z.array(z.string()).default(DEFAULTS.prefixArgs),
  extraArgs: z.array(z.string()).default(DEFAULTS.extraArgs),
  model: z.string().default(DEFAULTS.model),
  codexHome: z.string().default(DEFAULTS.codexHome),
  env: z.dict(z.string()).default(DEFAULTS.env),
  checkLogin: z.boolean().default(DEFAULTS.checkLogin),
  sandbox: z.string().min(1).default(DEFAULTS.sandbox),
  timeoutMs: z.number().step(1).min(5000).default(DEFAULTS.timeoutMs),
  maxImages: z.number().step(1).min(1).max(16).default(DEFAULTS.maxImages),
  maxImageBytes: z.number().step(1).min(1024).default(DEFAULTS.maxImageBytes),
  allowUrls: z.boolean().default(DEFAULTS.allowUrls),
  allowDataUrls: z.boolean().default(DEFAULTS.allowDataUrls),
  allowPrivateUrls: z.boolean().default(DEFAULTS.allowPrivateUrls),
  defaultPrompt: z.string().default(DEFAULTS.defaultPrompt),
  imageSandbox: z.string().min(1).default(DEFAULTS.imageSandbox),
  imageTimeoutMs: z.number().step(1).min(30000).default(DEFAULTS.imageTimeoutMs),
  maxReferenceImages: z.number().step(1).min(0).max(8).default(DEFAULTS.maxReferenceImages),
  maxGeneratedBytes: z.number().step(1).min(1024).default(DEFAULTS.maxGeneratedBytes),
  outputDir: z.string().min(1).default(DEFAULTS.outputDir),
  overwriteOutput: z.boolean().default(DEFAULTS.overwriteOutput),
  qqDelivery: z.object({
    enabled: z.boolean().default(DEFAULTS.qqDelivery.enabled),
    aurabotDataDir: z.string().default(DEFAULTS.qqDelivery.aurabotDataDir),
    timeoutMs: z.number().step(1).min(1000).default(DEFAULTS.qqDelivery.timeoutMs),
    maxBytes: z.number().step(1).min(1024).default(DEFAULTS.qqDelivery.maxBytes),
  }).default(DEFAULTS.qqDelivery),
})

const VISION_TOOL_DESCRIPTION = [
  'Look at one or more images with Codex (OpenAI\'s vision-capable coding agent) and return its textual answer.',
  'Use it when you need to understand an image you cannot see directly: screenshots, photos, charts, diagrams, UI mockups, scanned documents, or images referenced by a path or URL.',
  'Accepts local file paths (including image files saved by attachment/read tools), http(s) image URLs, and data:image/...;base64 payloads.',
  'Read-only: Codex runs no shell and writes no files.',
].join(' ')

const IMAGEGEN_TOOL_DESCRIPTION = [
  'Generate or edit a raster image with Codex\'s built-in image_gen (GPT Image) and save the result as a PNG inside the workspace.',
  'Use it when the user asks to draw/generate/create/design an image — photos, illustrations, posters, logo concepts, UI mockups, icons, sprites, stickers, infographics — or to edit/restyle an existing image by passing reference_images.',
  'Requires Codex to be installed and signed in (codex login); no OPENAI_API_KEY is needed for the built-in image_gen path.',
  'Returns the saved file path plus an inline preview when the deployment supports durable attachments. The session working directory must be writable by Codex.',
  'In chat bridges that support Markdown image replies (for example Aurabot/QQ), the final reply can send the image by including the exact absolute path: ![image](</absolute/path.png>).',
].join(' ')

const IMAGE_INFO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source: { type: 'string', required: true },
    kind: { type: 'string', required: true, enum: ['file', 'url', 'data'] },
    mediaType: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
  },
}

const VISION_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    answer: { type: 'string', required: true, description: 'Codex\'s answer about the images, as plain text.' },
    model: { type: 'string', description: 'The Codex model used for this call (reported when set).' },
    elapsedMs: { type: 'integer', required: true, description: 'Wall-clock duration of the Codex call in milliseconds.' },
    images: {
      type: 'array',
      required: true,
      description: 'The images that were inspected, in request order.',
      items: IMAGE_INFO_SCHEMA,
    },
  },
}

const IMAGEGEN_ATTACHMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: true,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    name: { type: 'string' },
  },
}

const IMAGEGEN_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true, description: 'Absolute path of the saved PNG file.' },
    relativePath: { type: 'string', required: true, description: 'Path relative to the session working directory.' },
    mediaType: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
    elapsedMs: { type: 'integer', required: true },
    revisedPrompt: { type: 'string', description: 'The prompt image_gen actually used, when reported.' },
    references: {
      type: 'array',
      description: 'Reference images that were supplied to Codex.',
      items: IMAGE_INFO_SCHEMA,
    },
    attachment: IMAGEGEN_ATTACHMENT_SCHEMA,
    delivery: {
      type: 'object',
      additionalProperties: false,
      description: 'Present when the image was pushed straight into the current QQ chat (Aurabot session).',
      properties: {
        chatId: { type: 'string', required: true },
        kind: { type: 'string', required: true, enum: ['group', 'private'] },
        messageId: { type: 'integer' },
      },
    },
    deliveryNote: {
      type: 'string',
      description: 'Why the optional direct QQ delivery did not happen (only set when qqDelivery is enabled and skipped/failed).',
    },
  },
}

/**
 * Resolve the session working directory used for relative paths.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {{ agent?: unknown, signal: AbortSignal }} exec - tool execution.
 * @returns {Promise<string>} absolute working directory.
 */
async function resolveCwd(ctx, exec) {
  const service = ctx.get?.('workingDirectory')
  if (service !== undefined && typeof service.ensure === 'function') {
    try {
      const cwd = await service.ensure(exec.agent, exec.signal)
      if (typeof cwd === 'string' && cwd.length > 0) return cwd
    } catch {
      // Fall through to the process directory; a real path problem surfaces later
      // with a more specific error from image resolution or output placement.
    }
  }
  return process.cwd()
}

/** Keep a tool result small enough for the model context while keeping the diagnosis useful. */
function tailText(text, maxBytes) {
  if (typeof text !== 'string' || text.length === 0) return ''
  const trimmed = text.trim()
  if (Buffer.byteLength(trimmed) <= maxBytes) return trimmed
  const buffer = Buffer.from(trimmed)
  return `…${buffer.subarray(buffer.length - maxBytes).toString('utf8')}`
}

/**
 * Convert a module error into a model-facing tool error. Tool bodies throw
 * ordinary Errors: the registry records a failed tool result, keeps the turn
 * alive, and shows this message to the model on its next step.
 * @param {unknown} error
 * @param {string} tool - tool name used in the message prefix.
 * @returns {Error}
 */
function formatToolError(error, tool) {
  if (error instanceof ImageSourceError) {
    return new Error(`${tool}: 读取图片失败 [${error.code}] ${error.message}`, { cause: error })
  }
  if (error instanceof ImageGenError) {
    return new Error(`${tool}: 生图失败 [${error.code}] ${error.message}`, { cause: error })
  }
  if (error instanceof CodexVisionError) {
    const details = []
    if (error.exitCode !== undefined) details.push(`exit=${error.exitCode}`)
    const stderr = tailText(error.stderr, 1500)
    if (stderr.length > 0) details.push(`stderr:\n${stderr}`)
    const suffix = details.length > 0 ? `\n${details.join('\n')}` : ''
    return new Error(`${tool}: Codex 调用失败 [${error.code}] ${error.message}${suffix}`, { cause: error })
  }
  const message = error instanceof Error ? error.message : String(error)
  return new Error(`${tool}: ${message}`, { cause: error })
}

/**
 * Save a generated image into the deployment's durable attachment store so the
 * Web GUI can render it inline. Returns undefined when no store is mounted or
 * admission rejects the image (the tool still succeeds; text only).
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {string} outputPath
 * @param {string} mediaType
 * @param {AbortSignal} signal
 * @returns {Promise<{ attachmentId: string, mediaType: string, bytes: number, width: number, height: number, name?: string }|undefined>}
 */
async function admitAttachment(ctx, outputPath, mediaType, signal) {
  const attachments = ctx.get?.('attachments')
  if (attachments === undefined || typeof attachments.saveImage !== 'function') return undefined
  signal?.throwIfAborted()
  try {
    const data = await readFile(outputPath)
    const ref = await attachments.saveImage({ data, mediaType, name: path.basename(outputPath) })
    return {
      attachmentId: ref.attachmentId,
      mediaType: ref.mediaType,
      bytes: ref.bytes,
      width: ref.width,
      height: ref.height,
      ...(ref.name === undefined ? {} : { name: ref.name }),
    }
  } catch {
    return undefined
  }
}

/**
 * Register `codex_vision` and `codex_imagegen`.
 * @param {import('@deepseek-ai/cordis').Context} ctx - agent-scoped services.
 * @param {Partial<typeof DEFAULTS>} [config] - resolved plugin configuration.
 */
export function apply(ctx, config) {
  const cfg = { ...DEFAULTS, ...config }

  ctx.tools.register(defineTool({
    name: 'codex_vision',
    description: VISION_TOOL_DESCRIPTION,
    parameters: {
      images: {
        type: 'array',
        required: true,
        description: 'One to a few images to inspect, in order: local paths, http(s) URLs, or data:image/...;base64 payloads.',
        items: { type: 'string' },
      },
      prompt: {
        type: 'string',
        description: 'What to ask about the image(s). Be specific (e.g. "transcribe all text" or "what UI element is highlighted?"). Omit for a detailed general description.',
      },
      model: {
        type: 'string',
        description: 'Optional Codex model override for this call; omit to use the deployment default.',
      },
    },
    output: {
      schema: VISION_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: value.answer }],
      presentationMeta: (_args, value) => ({
        images: value.images.map((image) => ({ source: image.source, mediaType: image.mediaType, bytes: image.bytes })),
      }),
    },
    timeoutMs: cfg.timeoutMs + 30000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const sources = (args.images ?? []).map((source) => source.trim()).filter((source) => source.length > 0)
      if (sources.length === 0) throw new Error('codex_vision: images 至少需要 1 个非空路径 / URL / data URL')
      if (sources.length > cfg.maxImages) throw new Error(`codex_vision: 一次最多 ${cfg.maxImages} 张图片，收到 ${sources.length} 张`)

      const request = (args.prompt ?? '').trim() || cfg.defaultPrompt
      const prompt = `${VISION_INSTRUCTION}\n\n请求：\n${request}`
      const model = (args.model ?? '').trim() || cfg.model
      const cwd = await resolveCwd(ctx, exec)

      let resolved
      try {
        resolved = await resolveImageSources(sources, {
          cwd,
          maxImages: cfg.maxImages,
          maxBytes: cfg.maxImageBytes,
          allowUrls: cfg.allowUrls,
          allowDataUrls: cfg.allowDataUrls,
          allowPrivateUrls: cfg.allowPrivateUrls,
          signal: exec.signal,
        })
      } catch (error) {
        throw formatToolError(error, 'codex_vision')
      }

      try {
        const startedAt = Date.now()
        const result = await runCodexVision({
          imagePaths: resolved.images.map((image) => image.path),
          prompt,
          ...(model.length > 0 ? { model } : {}),
          signal: exec.signal,
          command: cfg.command,
          prefixArgs: cfg.prefixArgs,
          extraArgs: cfg.extraArgs,
          ...(cfg.codexHome.length > 0 ? { codexHome: cfg.codexHome } : {}),
          env: cfg.env,
          checkLogin: cfg.checkLogin,
          timeoutMs: cfg.timeoutMs,
          sandbox: cfg.sandbox,
        })
        return {
          answer: result.answer,
          ...(model.length > 0 ? { model } : {}),
          elapsedMs: Date.now() - startedAt,
          images: resolved.images.map((image) => ({
            source: image.source,
            kind: image.kind,
            mediaType: image.mediaType,
            bytes: image.bytes,
          })),
        }
      } catch (error) {
        throw formatToolError(error, 'codex_vision')
      } finally {
        await resolved.cleanup()
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'codex_imagegen',
    description: IMAGEGEN_TOOL_DESCRIPTION,
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'What to generate or how to edit the reference image(s). Describe subject, style, composition, lighting and any literal text; this is passed to image_gen as the creative brief.',
      },
      output: {
        type: 'string',
        description: 'Optional .png destination path inside the session working directory (relative paths allowed). Defaults to output/imagegen/codex-<timestamp>.png; an existing file gets a -v2 suffix unless overwriteOutput is enabled.',
      },
      reference_images: {
        type: 'array',
        description: 'Optional reference or edit-target images: local paths, http(s) URLs, or data:image/...;base64 payloads. The first image is the edit target when the request is an edit.',
        items: { type: 'string' },
      },
      transparent_background: {
        type: 'boolean',
        description: 'Ask image_gen for a genuinely transparent background (alpha channel).',
      },
    },
    output: {
      schema: IMAGEGEN_OUTPUT_SCHEMA,
      render: (_args, value) => {
        const size = value.attachment === undefined ? '' : `，${value.attachment.width}x${value.attachment.height} px`
        const lines = [`已生成图片：${value.relativePath}（${value.mediaType}，${value.bytes} 字节${size}）`]
        if (value.delivery !== undefined) {
          lines.push(`已直接发到 QQ：${value.delivery.chatId}`)
        } else {
          lines.push('聊天发送：如果当前是 QQ / Aurabot 这类支持图片回复的聊天，把下面这一行原样放进最终回复即可把图发出去（这是客户端发图专用语法，不算 Markdown 格式，不要改写路径）：')
          lines.push(`![图片](${value.path})`)
        }
        if (value.deliveryNote !== undefined) lines.push(`（未自动发到 QQ：${value.deliveryNote}）`)
        const blocks = [{ type: 'text', text: lines.join('\n') }]
        if (value.attachment !== undefined) {
          blocks.push({
            type: 'image',
            attachment: {
              attachmentId: value.attachment.attachmentId,
              mediaType: value.attachment.mediaType,
              bytes: value.attachment.bytes,
              width: value.attachment.width,
              height: value.attachment.height,
              ...(value.attachment.name === undefined ? {} : { name: value.attachment.name }),
            },
          })
        }
        return blocks
      },
      presentationMeta: (_args, value) => ({
        path: value.path,
        relativePath: value.relativePath,
        mediaType: value.mediaType,
        bytes: value.bytes,
        ...(value.revisedPrompt === undefined ? {} : { revisedPrompt: value.revisedPrompt }),
      }),
    },
    timeoutMs: cfg.imageTimeoutMs + 60000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const request = (args.prompt ?? '').trim()
      if (request.length === 0) throw new Error('codex_imagegen: prompt 不能为空')
      if (request.length > 12000) throw new Error('codex_imagegen: prompt 过长（上限 12000 字符），请精简描述')

      const referenceSources = (args.reference_images ?? []).map((source) => source.trim()).filter((source) => source.length > 0)
      if (referenceSources.length > cfg.maxReferenceImages) {
        throw new Error(`codex_imagegen: 参考图最多 ${cfg.maxReferenceImages} 张，收到 ${referenceSources.length} 张`)
      }

      const cwd = await resolveCwd(ctx, exec)
      const startedAt = Date.now()

      let references
      try {
        references = referenceSources.length === 0
          ? { images: [], cleanup: async () => {} }
          : await resolveImageSources(referenceSources, {
            cwd,
            maxImages: cfg.maxReferenceImages,
            maxBytes: cfg.maxImageBytes,
            allowUrls: cfg.allowUrls,
            allowDataUrls: cfg.allowDataUrls,
            allowPrivateUrls: cfg.allowPrivateUrls,
            signal: exec.signal,
          })
      } catch (error) {
        throw formatToolError(error, 'codex_imagegen')
      }

      try {
        let target
        try {
          target = await resolveOutputPath({
            requested: args.output,
            cwd,
            outputDir: cfg.outputDir,
            overwrite: cfg.overwriteOutput,
          })
          await mkdir(path.dirname(target.outputPath), { recursive: true })
        } catch (error) {
          throw formatToolError(error, 'codex_imagegen')
        }

        const prompt = buildImageGenPrompt({
          request,
          outputPath: target.outputPath,
          referenceCount: references.images.length,
          transparentBackground: args.transparent_background === true,
        })

        let codexResult
        try {
          codexResult = await runCodexVision({
            imagePaths: references.images.map((image) => image.path),
            prompt,
            ...(cfg.model.trim().length > 0 ? { model: cfg.model } : {}),
            signal: exec.signal,
            command: cfg.command,
            prefixArgs: cfg.prefixArgs,
            extraArgs: cfg.extraArgs,
            ...(cfg.codexHome.length > 0 ? { codexHome: cfg.codexHome } : {}),
            env: cfg.env,
            checkLogin: cfg.checkLogin,
            timeoutMs: cfg.imageTimeoutMs,
            sandbox: cfg.imageSandbox,
            cwd,
            json: true,
            captureStdout: true,
          })
        } catch (error) {
          throw formatToolError(error, 'codex_imagegen')
        }

        const parsed = parseImageGenEvents(codexResult.stdout ?? '')
        let placed
        try {
          placed = await pickGeneratedImage({
            parsed,
            startedAt,
            cwd,
            outputPath: target.outputPath,
            maxBytes: cfg.maxGeneratedBytes,
            signal: exec.signal,
          })
        } catch (error) {
          const hint = tailText(codexResult.answer, 600)
          const annotated = error instanceof ImageGenError && hint.length > 0
            ? new ImageGenError(error.code, `${error.message}（Codex 最终回复：${hint}）`, { cause: error })
            : error
          throw formatToolError(annotated, 'codex_imagegen')
        }

        const attachment = await admitAttachment(ctx, target.outputPath, placed.mediaType, exec.signal)

        // 可选：直接发回当前 QQ 聊天（Aurabot 会话）。失败不影响图片产出，交给模型用文字语法兜底。
        const qq = { ...DEFAULTS.qqDelivery, ...(cfg.qqDelivery ?? {}) }
        let delivery
        let deliveryNote
        if (qq.enabled) {
          const sessionId = exec.agent?.session?.id
          try {
            const result = await deliverImageToQq({
              sessionId,
              imagePath: target.outputPath,
              dataDir: qq.aurabotDataDir.length > 0 ? qq.aurabotDataDir : defaultAurabotDataDir(),
              timeoutMs: qq.timeoutMs,
              maxBytes: qq.maxBytes,
              signal: exec.signal,
            })
            if (result.status === 'sent') delivery = { chatId: result.chatId, kind: result.kind, ...(result.messageId === undefined ? {} : { messageId: result.messageId }) }
            else deliveryNote = result.reason
          } catch (error) {
            deliveryNote = error instanceof QqDeliveryError ? `${error.code}: ${error.message}` : (error instanceof Error ? error.message : String(error))
          }
        }

        return {
          path: target.outputPath,
          relativePath: target.relativePath,
          mediaType: placed.mediaType,
          bytes: placed.bytes,
          elapsedMs: Date.now() - startedAt,
          ...(parsed.revisedPrompt === undefined ? {} : { revisedPrompt: parsed.revisedPrompt }),
          ...(references.images.length === 0 ? {} : {
            references: references.images.map((image) => ({
              source: image.source,
              kind: image.kind,
              mediaType: image.mediaType,
              bytes: image.bytes,
            })),
          }),
          ...(attachment === undefined ? {} : { attachment }),
          ...(delivery === undefined ? {} : { delivery }),
          ...(deliveryNote === undefined ? {} : { deliveryNote }),
        }
      } finally {
        await references.cleanup()
      }
    },
  }))

  // Startup marker: DSH's cordis logger has no console exporter in a stock
  // deployment, so a plain console line is the only reliable boot evidence.
  // Gated by an environment variable to keep production logs quiet.
  if (process.env.DSH_CODEX_MEDIA_BOOT_MARKER === '1') {
    console.log(`[dsh-codex-media] bundle loaded: registered tools codex_imagegen, codex_vision (command=${cfg.command}, imageSandbox=${cfg.imageSandbox})`)
  }
}
