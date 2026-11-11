/**
 * `lib/imagegen.mjs` — 生图链路里与 Codex 无关的纯逻辑：
 * 提示词构造、`codex exec --json` 事件解析、输出路径解析、把生成结果落到目标文件。
 *
 * 设计：Codex 内置 `image_gen` 工具把图片存到 `$CODEX_HOME/generated_images/...`，
 * app-server / exec 的 JSONL 事件里会带 `savedPath`。本模块优先用事件里的路径，
 * 其次接受 Codex 自己复制到目标路径的文件，最后兜底扫描工作区新增图片。
 * 全部是零依赖、可单测的函数；index.js 负责 spawn Codex 与返回工具结果。
 *
 * @module dsh-codex-media/imagegen
 */
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { sniffImageMediaType } from './image-source.mjs'

/** 生成图片识别到的错误。 */
export class ImageGenError extends Error {
  /**
   * @param {string} code 稳定错误码
   * @param {string} message 面向模型/用户的可读错误
   * @param {{ cause?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ImageGenError'
    this.code = code
  }
}

/** 允许的输出扩展名（内置 image_gen 输出 PNG；不在这里做格式转换）。 */
const OUTPUT_EXTENSION = '.png'
/** 默认输出目录（相对 session 工作目录）。 */
export const DEFAULT_OUTPUT_DIR = 'output/imagegen'
/** 扫描兜底时跳过的目录。 */
const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', '.cache', '.dsh', '__pycache__'])
/** 视为图片的扩展名（扫描兜底用）。 */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
/** base64 图片前缀（避免把普通长文本误判成图片）。 */
const BASE64_PREFIXES = ['iVBORw0KGgo', '/9j/', 'UklGR', 'R0lGOD']

/**
 * 构造交给 Codex 的生图提示词。要求它真的调用 image_gen、把结果复制到目标路径，
 * 并且只回复一行状态。
 * @param {object} options
 * @param {string} options.request 用户/模型给出的生图需求
 * @param {string} options.outputPath 目标文件绝对路径
 * @param {number} [options.referenceCount=0] 随附参考图数量
 * @param {boolean} [options.transparentBackground=false] 是否要求透明背景
 * @returns {string}
 */
export function buildImageGenPrompt({ request, outputPath, referenceCount = 0, transparentBackground = false }) {
  const lines = [
    '你是一个图片生成器，使用内置的 `image_gen` 工具生成位图。',
    '',
    '用户需求：',
    request,
  ]
  if (referenceCount > 0) {
    lines.push('', `随附 ${referenceCount} 张参考图（按对话中的顺序）。如果需求是“编辑/修改”，把第 1 张图当作编辑目标；否则把它们当作风格/构图/主体参考。`)
  }
  lines.push(
    '',
    '执行要求：',
    '1. 必须实际调用内置 `image_gen` 工具生成位图；禁止用 SVG / HTML / canvas / 代码占位图代替。',
    '2. 如果需求里包含具体的文字，要求 image_gen 逐字渲染；不要添加需求之外的水印或标语。',
    ...(transparentBackground
      ? ['3. 要求 image_gen 输出真正的透明背景（transparent background），并保留 alpha 通道。']
      : []),
    `${transparentBackground ? 4 : 3}. 生成完成后，把最终选中的图片文件复制到下面这个路径（父目录已存在；若文件已存在则覆盖）：`,
    `   ${outputPath}`,
    `${transparentBackground ? 5 : 4}. 除了这个输出文件，不要修改仓库里的任何其它文件；不要运行无关命令。`,
    `${transparentBackground ? 6 : 5}. 最终只回复一行：DONE ${outputPath}；如果 image_gen 不可用或生成失败，只回复一行：FAILED <原因>。`,
  )
  return lines.join('\n')
}

/**
 * 把 `failure` 对象转成一句可读原因。
 * @param {unknown} failure
 * @returns {string}
 */
function summarizeFailure(failure) {
  if (typeof failure === 'string') return failure
  if (failure === null || typeof failure !== 'object') return '未知生图失败'
  const record = /** @type {Record<string, unknown>} */ (failure)
  const type = typeof record.type === 'string' ? record.type : undefined
  if (type === 'usageLimitExceeded') {
    const reset = record.resetsAt
    return typeof reset === 'number' ? `生图额度用尽（usageLimitExceeded，重置于 ${new Date(reset).toISOString()}）` : '生图额度用尽（usageLimitExceeded）'
  }
  if (type !== undefined) {
    const detail = typeof record.message === 'string' ? `：${record.message}` : ''
    return `${type}${detail}`
  }
  return JSON.stringify(failure).slice(0, 300)
}

/**
 * 尝试把 base64 图片字符串解码成 Buffer；不像图片就返回 undefined。
 * @param {unknown} value
 * @returns {Buffer|undefined}
 */
function decodeBase64Image(value) {
  if (typeof value !== 'string') return undefined
  const compact = value.replace(/\s+/g, '')
  if (compact.length < 64) return undefined
  if (!BASE64_PREFIXES.some((prefix) => compact.startsWith(prefix))) return undefined
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return undefined
  try {
    const buffer = Buffer.from(compact, 'base64')
    return sniffImageMediaType(buffer) === undefined ? undefined : buffer
  } catch {
    return undefined
  }
}

/**
 * 解析 `codex exec --json` 的 JSONL stdout，收集生图相关事件。
 * 对事件封套不敏感：递归扫描 `savedPath` / `saved_path`、`revisedPrompt`、
 * `image_generation` 节点的 `result`（base64）与 `failure`。
 * @param {string} stdout
 * @returns {{
 *   savedPaths: string[],
 *   inlineImages: Buffer[],
 *   failures: string[],
 *   revisedPrompt?: string,
 *   eventCount: number,
 * }}
 */
export function parseImageGenEvents(stdout) {
  const savedPaths = []
  const inlineImages = []
  const failures = []
  let revisedPrompt
  let eventCount = 0

  const visit = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (node === null || typeof node !== 'object') return
    const record = /** @type {Record<string, unknown>} */ (node)
    if (typeof record.savedPath === 'string' && record.savedPath.trim().length > 0) savedPaths.push(record.savedPath.trim())
    if (typeof record.saved_path === 'string' && record.saved_path.trim().length > 0) savedPaths.push(record.saved_path.trim())
    if (typeof record.revisedPrompt === 'string' && revisedPrompt === undefined) revisedPrompt = record.revisedPrompt
    if (typeof record.revised_prompt === 'string' && revisedPrompt === undefined) revisedPrompt = record.revised_prompt
    if (record.failure !== undefined && record.failure !== null) failures.push(summarizeFailure(record.failure))
    const isImageGenNode = typeof record.type === 'string' && /image_?gen/i.test(record.type)
    if (isImageGenNode && record.result !== undefined) {
      const decoded = decodeBase64Image(record.result)
      if (decoded !== undefined) inlineImages.push(decoded)
    }
    for (const value of Object.values(record)) visit(value)
  }

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || (line[0] !== '{' && line[0] !== '[')) continue
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    eventCount += 1
    visit(parsed)
  }

  return { savedPaths, inlineImages, failures, ...(revisedPrompt === undefined ? {} : { revisedPrompt }), eventCount }
}

/**
 * 解析输出路径：默认 `<cwd>/output/imagegen/codex-<时间戳>-<随机>.png`；
 * 显式路径必须落在工作区内、且扩展名为 `.png`；已存在时默认生成兄弟版本名。
 * @param {object} options
 * @param {string|undefined} options.requested 模型传入的 output 参数
 * @param {string} options.cwd session 工作目录（绝对路径）
 * @param {string} [options.outputDir=DEFAULT_OUTPUT_DIR] 默认输出目录（相对 cwd）
 * @param {boolean} [options.overwrite=false] 已存在时是否覆盖
 * @param {Date} [options.now=new Date()] 测试注入时间
 * @returns {Promise<{ outputPath: string, relativePath: string, defaulted: boolean }>}
 */
export async function resolveOutputPath({ requested, cwd, outputDir = DEFAULT_OUTPUT_DIR, overwrite = false, now = new Date() }) {
  const base = path.resolve(cwd)
  let outputPath
  let defaulted = false
  if (typeof requested !== 'string' || requested.trim().length === 0) {
    defaulted = true
    const stamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
    const random = Math.random().toString(36).slice(2, 8)
    outputPath = path.join(base, outputDir, `codex-${stamp}-${random}.png`)
  } else {
    const requestedPath = requested.trim()
    outputPath = path.resolve(base, requestedPath)
    const relative = path.relative(base, outputPath)
    if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new ImageGenError('OUTPUT_OUTSIDE_WORKSPACE', `output 必须位于当前工作目录内：${requestedPath}`)
    }
    if (path.extname(outputPath).toLowerCase() !== OUTPUT_EXTENSION) {
      throw new ImageGenError('INVALID_OUTPUT', `output 目前只支持 .png（内置 image_gen 输出 PNG，插件不做格式转换）：${requestedPath}`)
    }
  }

  if (!overwrite) outputPath = await uniqueSibling(outputPath)
  return {
    outputPath,
    relativePath: path.relative(base, outputPath),
    defaulted,
  }
}

/**
 * 已存在时返回 `name-v2.png`、`name-v3.png`…
 * @param {string} target
 * @returns {Promise<string>}
 */
async function uniqueSibling(target) {
  const directory = path.dirname(target)
  const extension = path.extname(target)
  const stem = path.basename(target, extension)
  let candidate = target
  for (let version = 2; version < 1000; version += 1) {
    if (!(await fileExists(candidate))) return candidate
    candidate = path.join(directory, `${stem}-v${version}${extension}`)
  }
  throw new ImageGenError('INVALID_OUTPUT', `无法为 ${target} 找到可用的版本化文件名`)
}

/**
 * @param {string} target
 * @returns {Promise<boolean>}
 */
async function fileExists(target) {
  try {
    const info = await stat(target)
    return info.isFile()
  } catch {
    return false
  }
}

/**
 * 读取文件头做图片嗅探。
 * @param {string} target
 * @returns {Promise<{ mediaType?: string, bytes: number }>}
 */
async function inspectFile(target) {
  const info = await stat(target)
  if (!info.isFile()) throw new ImageGenError('NO_IMAGE', `${target} 不是普通文件`)
  if (info.size === 0) throw new ImageGenError('NO_IMAGE', `${target} 是空文件`)
  const handle = await open(target, 'r')
  try {
    const head = Buffer.alloc(16)
    const { bytesRead } = await handle.read(head, 0, head.length, 0)
    return { mediaType: sniffImageMediaType(head.subarray(0, bytesRead)), bytes: info.size }
  } finally {
    await handle.close()
  }
}

/**
 * 原子地放置生成结果：buffer 直接写，文件则复制到同目录临时文件后 rename。
 * @param {object} options
 * @param {Buffer|undefined} options.buffer 直接内容（优先）
 * @param {string|undefined} options.sourcePath 来源文件
 * @param {string} options.outputPath 目标文件
 * @param {number} options.maxBytes 体积上限
 * @returns {Promise<{ mediaType: string, bytes: number, sourcePath?: string }>}
 */
export async function placeGeneratedImage({ buffer, sourcePath, outputPath, maxBytes }) {
  await mkdir(path.dirname(outputPath), { recursive: true })
  let mediaType
  let bytes
  const temporary = `${outputPath}.tmp-${process.pid}-${Date.now()}`
  try {
    if (buffer !== undefined) {
      mediaType = sniffImageMediaType(buffer)
      bytes = buffer.length
      if (mediaType === undefined) throw new ImageGenError('IMAGE_INVALID', 'image_gen 返回的字节不是 PNG/JPEG/WebP/GIF 图片')
      if (bytes > maxBytes) throw new ImageGenError('IMAGE_TOO_LARGE', `生成图片 ${bytes} 字节，超过上限 ${maxBytes} 字节`)
      await writeFile(temporary, buffer)
      await rename(temporary, outputPath)
      return { mediaType, bytes }
    }
    if (typeof sourcePath !== 'string' || sourcePath.length === 0) {
      throw new ImageGenError('NO_IMAGE', '没有可用的生成图片')
    }
    const inspected = await inspectFile(sourcePath)
    if (inspected.mediaType === undefined) throw new ImageGenError('IMAGE_INVALID', `生成文件不是受支持的图片：${sourcePath}`)
    if (inspected.bytes > maxBytes) throw new ImageGenError('IMAGE_TOO_LARGE', `生成图片 ${inspected.bytes} 字节，超过上限 ${maxBytes} 字节`)
    mediaType = inspected.mediaType
    bytes = inspected.bytes
    if (path.resolve(sourcePath) !== path.resolve(outputPath)) {
      await writeFile(temporary, await readFile(sourcePath))
      await rename(temporary, outputPath)
    }
    return { mediaType, bytes, sourcePath }
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

/**
 * 在工作区里找 `since` 之后新增的图片文件（兜底：Codex 自己把图存到了别处）。
 * @param {object} options
 * @param {string} options.cwd
 * @param {number} options.since 毫秒时间戳
 * @param {number} [options.maxDepth=6]
 * @returns {Promise<string|undefined>} 最新（mtime 最大）的候选文件
 */
export async function findNewestImage({ cwd, since, maxDepth = 6 }) {
  /** @type {{ path: string, mtimeMs: number }|undefined} */
  let best
  const walk = async (directory, depth) => {
    if (depth > maxDepth) return
    let entries
    try {
      entries = await import('node:fs/promises').then(({ readdir }) => readdir(directory, { withFileTypes: true }))
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await walk(target, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (!IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
      let info
      try {
        info = await stat(target)
      } catch {
        continue
      }
      if (info.size <= 0 || info.mtimeMs < since) continue
      if (best === undefined || info.mtimeMs > best.mtimeMs) best = { path: target, mtimeMs: info.mtimeMs }
    }
  }
  await walk(path.resolve(cwd), 0)
  return best?.path
}

/**
 * 从一轮 Codex 输出里确定最终图片并放到输出路径。
 * 优先级：事件内联 base64 > 事件 savedPath > Codex 已复制到目标路径 > 工作区新增图片。
 * @param {object} options
 * @param {ReturnType<typeof parseImageGenEvents>} options.parsed 事件解析结果
 * @param {number} options.startedAt 开始时间（毫秒）
 * @param {string} options.cwd 工作目录
 * @param {string} options.outputPath 目标绝对路径
 * @param {number} options.maxBytes 体积上限
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ mediaType: string, bytes: number, sourcePath?: string }>}
 */
export async function pickGeneratedImage({ parsed, startedAt, cwd, outputPath, maxBytes, signal }) {
  signal?.throwIfAborted()
  const attempts = []

  for (const buffer of parsed.inlineImages) {
    try {
      return await placeGeneratedImage({ buffer, outputPath, maxBytes })
    } catch (error) {
      attempts.push(error instanceof Error ? error.message : String(error))
    }
  }

  for (const savedPath of parsed.savedPaths) {
    try {
      signal?.throwIfAborted()
      if (await fileExists(savedPath)) return await placeGeneratedImage({ sourcePath: savedPath, outputPath, maxBytes })
    } catch (error) {
      attempts.push(error instanceof Error ? error.message : String(error))
    }
  }

  try {
    signal?.throwIfAborted()
    if (await fileExists(outputPath)) return await placeGeneratedImage({ sourcePath: outputPath, outputPath, maxBytes })
  } catch (error) {
    attempts.push(error instanceof Error ? error.message : String(error))
  }

  const discovered = await findNewestImage({ cwd, since: startedAt - 2000 })
  if (discovered !== undefined) {
    try {
      return await placeGeneratedImage({ sourcePath: discovered, outputPath, maxBytes })
    } catch (error) {
      attempts.push(error instanceof Error ? error.message : String(error))
    }
  }

  const failureText = parsed.failures.length > 0 ? parsed.failures.join('；') : undefined
  if (failureText !== undefined) {
    throw new ImageGenError('IMAGE_GEN_FAILED', `Codex 报告生图失败：${failureText}`)
  }
  const detail = attempts.length > 0 ? `（已尝试：${attempts.slice(0, 3).join('；')}）` : ''
  throw new ImageGenError('NO_IMAGE', `Codex 没有产出可用的图片文件${detail}。确认 Codex 已登录且内置 image_gen 可用。`)
}
