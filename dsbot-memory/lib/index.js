/**
 * dsbot-memory —— 衰减记忆卡、双向脱敏记忆、身份对齐、隐私闸门与主人审计
 *
 * 由旧单体插件 dsbot 拆出的**独立、自包含**插件：只 import 包内文件与 Node 内置。
 * 依赖的旧代码在 lib/vendor/（由 tools/vendor.mjs 按仓库相对结构原样复制）。
 *
 * 路由前缀：/dsh-dsbot-memory/api
 * 设置栏目 id：dsbot-memory（浏览器半边见 lib/client.js）
 */
import './bootstrap.js'; // 必须第一：先定好 DSBOT_ROOT，vendored paths 才能解析
import fs from 'node:fs';
import path from 'node:path';
import {
  STATE_DIR, MEMORY_DIR, BACKUP_DIR, UNIFIED_FILE, QQ_CONFIG, BILI_CONFIG, ensureDirs, maskPath,
} from './vendor/plugins/dsbot/lib/paths.js';
import { json, readBody, isLoopbackReq, sameOrigin } from './vendor/plugins/dsbot/lib/http-guard.js';
import { readJson, updateJsonFile, backupFile } from './config-lock.js';

export const name = 'dsbot-memory';
export const inject = ['webServer', 'connection'];
export const API_PREFIX = '/dsh-dsbot-memory/api';

const log = (...args) => {
  const line = `[${new Date().toISOString()}] [${name}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  try { console.log(line); } catch {}
  try {
    ensureDirs();
    fs.appendFileSync(path.join(STATE_DIR, 'plugin.log'), `${line}\n`);
  } catch {}
};

export function apply(ctx) {
  ensureDirs();
  const disposers = [];

  /** 四层准入 + 统一 500，与旧插件 lib/index.js 的 route() 语义一致。 */
  function route(kind, pathname, handler) {
    disposers.push(ctx.webServer.register({
      kind,
      path: pathname,
      handler: async (req, res) => {
        const trusted = (() => { try { return readJson(QQ_CONFIG, {})?.httpGuard?.trustedProxyHosts ?? []; } catch { return []; } })();
        if (!isLoopbackReq(req, Array.isArray(trusted) ? trusted : [])) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return; }
        if (req.method !== 'GET' && !sameOrigin(req)) { json(res, 403, { ok: false, error: '跨站请求被拒绝' }); return; }
        if (req.method !== 'GET' && !String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
          json(res, 415, { ok: false, error: '写操作必须是 application/json' }); return;
        }
        try {
          const conn = ctx.get('connection');
          if (conn && typeof conn.requestRejection === 'function') {
            const code = conn.requestRejection(req);
            if (code !== undefined && code !== null && code !== false) {
              res.statusCode = typeof code === 'number' ? code : 403;
              res.end();
              return;
            }
          }
          await handler(req, res);
        } catch (error) {
          log('API 失败：', String(error?.message ?? error));
          try { json(res, 500, { ok: false, error: String(error?.message ?? error) }); } catch {}
        }
      },
    }));
  }

  // ── 路由 ─────────────────────────────────────────────────────────────────
  route('prefix', API_PREFIX, async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const tail = url.pathname.slice(API_PREFIX.length).replace(/^\/+/, '');
    if (tail === 'status') {
      json(res, 200, {
        ok: true,
        plugin: name,
        version: '0.1.0',
        paths: {
          stateDir: maskPath(STATE_DIR),
          memoryDir: maskPath(MEMORY_DIR),
          backupDir: maskPath(BACKUP_DIR),
        },
        files: {
          unified: fs.existsSync(UNIFIED_FILE),
          qqConfig: fs.existsSync(QQ_CONFIG),
          biliConfig: fs.existsSync(BILI_CONFIG),
        },
      });
      return;
    }
    json(res, 404, { ok: false, error: `未知接口：${url.pathname}` });
  });

  route('exact', '/dsh-dsbot-memory/health', async (_req, res) => {
    json(res, 200, { ok: true, name, version: '0.1.0' });
  });

  // 卸载：清定时器 / 定时任务在这里登记。
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) { try { dispose(); } catch {} }
  });

  log(`已激活；stateDir=${maskPath(STATE_DIR)}`);
}

export default { name, inject, apply };
