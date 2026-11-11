/**
 * `lib/qq-delivery.mjs` — 可选：把生成的图片直接发回当前 QQ 聊天。
 *
 * 为什么需要：Aurabot（QQ 桥）只把**最终文字回复**发到 QQ，工具结果里的图片不会自动
 * 转发。Aurabot 的回复语法 `![图片](绝对路径)` 能发图，但人格卡禁止 Markdown，模型未必照做。
 * 这个模块在插件里直接复用 Aurabot 自己的 OneBot 连接（snowluma.httpUrl + token）和它的
 * `sessions.json`（DSH session → QQ 聊天映射），把图发回**当前这一轮所在的聊天**，不依赖模型输出。
 *
 * 只在配置 `qqDelivery.enabled: true` 时启用；只发往 sessions.json 里存在的、且 sessionId 精确
 * 匹配当前会话的聊天，不接受外部传入聊天号。Aurabot 总开关关闭或试运行时同样跳过。
 *
 * @module dsh-codex-media/qq-delivery
 */
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

/** 投递失败时的错误。 */
export class QqDeliveryError extends Error {
  /**
   * @param {string} code 稳定错误码
   * @param {string} message 可读错误
   * @param {{ cause?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'QqDeliveryError'
    this.code = code
  }
}

/** 默认 Aurabot 数据目录（与 Aurabot 的 dataDir 规则一致）。 */
export function defaultAurabotDataDir(env = process.env) {
  if (typeof env.AURABOT_DATA_DIR === 'string' && env.AURABOT_DATA_DIR.length > 0) return env.AURABOT_DATA_DIR
  const home = env.DSH_HOME
  if (typeof home !== 'string' || home.length === 0) return undefined
  return path.join(home, 'plugins-data', 'aurabot')
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** @param {string} file @returns {Promise<Record<string, any>|undefined>} */
async function readJsonFile(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * 在当前 DSH 会话对应的 QQ 聊天里，用 Aurabot 的 OneBot 连接发送一张本地图片。
 *
 * @param {object} options
 * @param {string} options.sessionId 当前 agent 会话 id（`exec.agent.session.id`）
 * @param {string} options.imagePath 本地图片绝对路径
 * @param {string} [options.dataDir] Aurabot 数据目录（默认 `$DSH_HOME/plugins-data/aurabot`）
 * @param {number} [options.maxBytes=52428800] 允许发送的最大字节数
 * @param {number} [options.timeoutMs=120000] HTTP 请求超时
 * @param {boolean} [options.respectAurabotState=true] 尊重 Aurabot 的 enabled / dryRun
 * @param {AbortSignal} [options.signal]
 * @param {typeof fetch} [options.fetchImpl] 测试注入
 * @returns {Promise<
 *   | { status: 'sent', chatId: string, kind: 'group'|'private', messageId?: number }
 *   | { status: 'skipped', reason: string }
 * >}
 */
export async function deliverImageToQq(options) {
  const {
    sessionId,
    imagePath,
    dataDir = defaultAurabotDataDir(),
    maxBytes = 50 * 1024 * 1024,
    timeoutMs = 120_000,
    respectAurabotState = true,
    signal,
    fetchImpl = fetch,
  } = options

  if (typeof sessionId !== 'string' || sessionId.length === 0) return { status: 'skipped', reason: 'no-session-id' }
  if (typeof dataDir !== 'string' || dataDir.length === 0) return { status: 'skipped', reason: 'no-aurabot-dir' }

  const config = await readJsonFile(path.join(dataDir, 'config.json'))
  if (config === undefined) return { status: 'skipped', reason: 'no-aurabot-config' }
  if (respectAurabotState) {
    if (config.enabled === false) return { status: 'skipped', reason: 'aurabot-disabled' }
    if (config.dryRun === true) return { status: 'skipped', reason: 'aurabot-dry-run' }
  }

  const sessions = await readJsonFile(path.join(dataDir, 'sessions.json'))
  const chats = isRecord(sessions?.chats) ? sessions.chats : {}
  let chatId
  for (const [id, entry] of Object.entries(chats)) {
    if (isRecord(entry) && entry.sessionId === sessionId) {
      chatId = id
      break
    }
  }
  if (chatId === undefined) return { status: 'skipped', reason: 'not-an-aurabot-chat' }

  const [kind, rawId] = chatId.split(':')
  if ((kind !== 'group' && kind !== 'private') || !/^\d+$/.test(rawId ?? '')) {
    return { status: 'skipped', reason: 'unsupported-chat-id' }
  }

  const connection = isRecord(config.snowluma) ? config.snowluma : {}
  const baseUrl = typeof connection.httpUrl === 'string' && connection.httpUrl.length > 0 ? connection.httpUrl.replace(/\/+$/, '') : undefined
  if (baseUrl === undefined) return { status: 'skipped', reason: 'no-onebot-http' }

  const info = await stat(imagePath).catch(() => undefined)
  if (info === undefined || !info.isFile() || info.size <= 0) throw new QqDeliveryError('IMAGE_MISSING', `要发到 QQ 的图片不存在或为空：${imagePath}`)
  if (info.size > maxBytes) throw new QqDeliveryError('IMAGE_TOO_LARGE', `图片 ${info.size} 字节超过 QQ 发送上限 ${maxBytes} 字节`)

  let data
  try {
    data = await readFile(imagePath)
  } catch (error) {
    throw new QqDeliveryError('IMAGE_MISSING', `读取要发到 QQ 的图片失败：${imagePath}`, { cause: error })
  }

  const payload = kind === 'group'
    ? { group_id: Number(rawId), message: [{ type: 'image', data: { file: `base64://${data.toString('base64')}` } }] }
    : { user_id: Number(rawId), message: [{ type: 'image', data: { file: `base64://${data.toString('base64')}` } }] }
  const endpoint = `${baseUrl}/${kind === 'group' ? 'send_group_msg' : 'send_private_msg'}`
  const headers = { 'content-type': 'application/json' }
  if (typeof connection.httpToken === 'string' && connection.httpToken.length > 0) {
    headers.authorization = `Bearer ${connection.httpToken}`
  }

  const signals = [AbortSignal.timeout(timeoutMs)]
  if (signal !== undefined) signals.push(signal)
  let response
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: signal === undefined ? AbortSignal.timeout(timeoutMs) : AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]),
    })
  } catch (error) {
    if (signal?.aborted) throw new QqDeliveryError('ABORTED', '发到 QQ 的操作被取消', { cause: error })
    throw new QqDeliveryError('HTTP_FAILED', `连接 OneBot 发送失败（${baseUrl}）：${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }

  let body
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  if (!response.ok || !isRecord(body) || body.retcode !== 0) {
    const retcode = isRecord(body) ? body.retcode : undefined
    const detail = isRecord(body) && isinstanceText(body.message) ? body.message : ''
    throw new QqDeliveryError(
      'SEND_REJECTED',
      `OneBot 拒绝发送到 ${chatId}（HTTP ${response.status}${retcode === undefined ? '' : `，retcode ${retcode}`}${detail ? `：${detail}` : ''}）`,
    )
  }

  const messageId = isRecord(body.data) && Number.isFinite(body.data.message_id) ? body.data.message_id : undefined
  return { status: 'sent', chatId, kind, ...(messageId === undefined ? {} : { messageId }) }
}

/** @param {unknown} value @returns {value is string} */
function isinstanceText(value) {
  return typeof value === 'string'
}
