/**
 * 最小桥接控制台客户端（只用于「触发桥接自己做的工作」）。
 *
 * 归属说明（拆分契约，见 docs/SPLIT-ARCHITECTURE.md §1/§4.2）：
 *   · QQ 桥接进程的**启停/自愈**归 `dsbot-qq` 包，本包不碰；
 *   · 记忆包只需要两个桥接能力：刷新 B站→QQ 记忆、记忆卡容量告警私聊管理员。
 *     旧单体插件是用 `lib/bridge.js` 的 `callBridge()` 走 HTTP 控制台实现的，
 *     这里**只保留那几个纯 HTTP 调用**（照旧的多写 `{}`、content-type、x-console-token
 *     约定，见旧 bridge.js 2026-10-23 事故注释），不做进程管理。
 *
 * 也就是说：本文件没有第二份 spawn / 状态映射，只是「按旧契约发一个 HTTP 请求」。
 * 桥接没跑时返回 { ok:false, status:0, error }，调用方把它翻译成「桥接控制不可用」。
 */
import fs from 'node:fs';
import path from 'node:path';
import { QQ_CONFIG, QQ_STATE_DIR } from './vendor/plugins/dsbot/lib/paths.js';
import { readJson } from './vendor/plugins/dsbot/lib/store.js';

/** 控制台端口：config.json 的 consolePort，默认 3100（与旧 bridge.js 一致）。 */
export function consolePort() {
  const cfg = readJson(QQ_CONFIG, {}) ?? {};
  return Number(cfg.consolePort) || 3100;
}

export function consoleBase() {
  return `http://127.0.0.1:${consolePort()}`;
}

/** 控制台令牌：config.json → consoleToken，否则读桥接写的 state/console-token。 */
export function consoleToken() {
  const cfg = readJson(QQ_CONFIG, {}) ?? {};
  const configured = String(cfg.consoleToken ?? '').trim();
  if (configured) return configured;
  try { return fs.readFileSync(path.join(QQ_STATE_DIR, 'console-token'), 'utf8').trim(); } catch { return ''; }
}

/**
 * 调桥接控制台（旧 `callBridge()` 的契约，逐字保留事故注释）：
 *   桥接控制台的写操作强制 application/json（CSRF 防护）。
 *   POST 不带参数时也必须发 `{}` —— 否则 content-type 缺失，桥接直接 415
 *   「请求必须是 application/json」，调用方只会看到一句莫名其妙的失败
 *   （「立即分享一次」就这么哑过一次，2026-10-23）。
 */
export async function callBridge(pathname, { method = 'GET', body, timeoutMs = 4000 } = {}) {
  const token = consoleToken();
  const isWrite = String(method).toUpperCase() !== 'GET';
  const payload = body === undefined ? (isWrite ? {} : null) : body;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${consoleBase()}${pathname}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(token ? { 'x-console-token': token } : {}),
        ...(payload ? { 'content-type': 'application/json' } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, status: 0, error: String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}
