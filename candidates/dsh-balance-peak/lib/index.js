// dsh-balance-peak host half.
// 1) Registers a same-origin `/api/balance` proxy so the browser never sees the
//    DeepSeek API key: the key is resolved through DSH's own credential seam
//    (ctx.credentials) and only the normalized readout leaves the server.
// 2) Registers the `balance-peak` settings namespace so the plugin's config
//    card appears in Settings → Plugins. DSH's settings/schema libraries are
//    resolved through the profile anchor (ctx.baseUrl) because this plugin is
//    an out-of-tree directory that cannot resolve the @deepseek-ai/* packages
//    from its own location.

import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-balance-peak'
export const inject = ['webServer', 'credentials']

/** Public DeepSeek API root (matches dsh-llm-deepseek's PUBLIC_BASE_URL). */
const PUBLIC_BASE_URL = 'https://api.deepseek.com'

/** Credential ref environment-variable name (matches dsh-llm-deepseek default). */
const API_KEY_ENV = 'DEEPSEEK_API_KEY'

/** Settings namespace (lowercase kebab-case). */
const SETTINGS_NS = 'balance-peak'

/** Default config published to the settings page. */
const DEFAULT_CONFIG = { refreshSeconds: 60, showPeak: true, showBalance: true, offsetX: 0, offsetY: 8 }

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

/** Normalize `GET /user/balance` into a small, browser-safe readout. */
function normalizeBalance(body) {
  if (body === null || typeof body !== 'object') return null
  const infos = Array.isArray(body.balance_infos) ? body.balance_infos : []
  const info = infos[0]
  if (info === undefined) return null
  const amount = info.total_balance ?? info.balance ?? info.topped_up_balance ?? null
  if (amount === null || amount === undefined) return null
  return {
    available: body.is_available === true,
    amount: String(amount),
    currency: String(info.currency ?? 'CNY'),
  }
}

/** Register the `balance-peak` settings namespace, best-effort. */
function registerSettingsSection(ctx) {
  const baseUrl = typeof ctx.baseUrl === 'string' ? ctx.baseUrl : undefined
  if (baseUrl === undefined) {
    ctx.logger?.warn?.('[balance-peak] skipped settings section: ctx.baseUrl is unset')
    return
  }
  try {
    // ctx.baseUrl is the config-tree base URL (a file: URL for a profile dir).
    // Convert it to a real directory before anchoring createRequire.
    const basePath = baseUrl.startsWith('file:') ? fileURLToPath(baseUrl) : baseUrl
    const req = createRequire(join(basePath, 'package.json'))
    const { installSettingsSection, settingsNamespace } = req('@deepseek-ai/dsh-settings')
    const z = req('@deepseek-ai/schemastery')
    installSettingsSection(
      ctx,
      settingsNamespace(SETTINGS_NS),
      z.object({
        refreshSeconds: z.number().min(5).max(3600).default(60),
        showPeak: z.boolean().default(true),
        showBalance: z.boolean().default(true),
        offsetX: z.number().min(-400).max(400).default(0),
        offsetY: z.number().min(-200).max(600).default(8),
      }),
      DEFAULT_CONFIG,
      // The plugin consumes this config only in the browser; host-side there is
      // nothing to react to, so the hooks are inert.
      { setSource: () => {}, onChange: () => {} },
    )
  } catch (err) {
    ctx.logger?.warn?.('[balance-peak] failed to register settings section: ' + (err instanceof Error ? err.message : String(err)))
  }
}

export function apply(ctx) {
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/balance',
    handler: async (_req, res) => {
      try {
        const hit = await ctx.credentials.resolve(API_KEY_ENV)
        if (hit === undefined || !hit.value) {
          return sendJson(res, 503, {
            ok: false,
            error: 'missing-credential',
            message: `${API_KEY_ENV} 未配置，无法读取 DeepSeek 余额`,
          })
        }
        const upstream = await fetch(`${PUBLIC_BASE_URL}/user/balance`, {
          headers: {
            authorization: `Bearer ${hit.value}`,
            accept: 'application/json',
          },
          signal: AbortSignal.timeout(8000),
        })
        const text = await upstream.text()
        let body = null
        try { body = JSON.parse(text) } catch { /* non-JSON upstream */ }
        if (!upstream.ok) {
          const reason = body?.error?.message ?? `upstream ${upstream.status}`
          return sendJson(res, 502, { ok: false, error: 'upstream', status: upstream.status, message: reason })
        }
        const data = normalizeBalance(body)
        if (data === null) {
          return sendJson(res, 200, { ok: false, error: 'unexpected-shape', message: '无法解析余额响应' })
        }
        return sendJson(res, 200, { ok: true, ...data })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return sendJson(res, 500, { ok: false, error: 'internal', message })
      }
    },
  })

  registerSettingsSection(ctx)
}
