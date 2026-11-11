// 一次性验证脚本：在 Node 里用最小 mock ctx 跑 dsh-tide-badge 的宿主半边，
// 真实调用 /plugins/tide-badge/state 的处理函数，检查「峰谷判定 + 余额」返回。
import { readFileSync } from 'node:fs'
import { apply } from './candidates/dsh-tide-badge/lib/index.js'

const creds = readFileSync('/home/ubuntu/dsh-agentchat/dsh-0.2-home/.credentials.yaml', 'utf8')
const key = creds.match(/DEEPSEEK_API_KEY:\s*(\S+)/)?.[1]
if (!key) throw new Error('no key')

let handler = null
const registered = []
const ctx = {
  logger: { warn: (...a) => console.log('[warn]', ...a) },
  get: () => undefined,
  credentials: { resolve: async (name) => (name === 'DEEPSEEK_API_KEY' ? { value: key } : null) },
  inject: (deps, cb) => cb({
    effect: (fn) => fn(),
    webServer: {
      register: (route) => {
        registered.push({ kind: route.kind, path: route.path })
        handler = route.handler
        return () => {}
      },
    },
  }),
}

apply(ctx)
console.log('routes:', registered)
if (!handler) throw new Error('route not registered')

const req = { headers: { host: '127.0.0.1:3102' }, url: '/plugins/tide-badge/state' }
const chunks = []
const res = {
  writeHead(status, headers) { this.status = status; this.headers = headers },
  end(body) { chunks.push(body) },
}
const t0 = Date.now()
await handler(req, res)
const body = JSON.parse(chunks.join(''))
console.log('elapsed_ms:', Date.now() - t0)
console.log('http_status:', res.status)
console.log('season:', JSON.stringify(body.season, null, 2))
console.log('balance:', JSON.stringify(body.balance, null, 2))
