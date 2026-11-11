/**
 * 最小桥接控制台客户端（只读探活 + 目的机制回落用）。
 *
 * 拆分后 `surfcore-qq` 才是桥接的启停方；本包**不 vendor 整个 bridge.js**（那是
 * 15k 行进程 + 一堆启停逻辑），只保留跨包需要的两个只读动作：
 *   · `bridgeStatus()` —— 目的页显示 QQ 载体是否可用；
 *   · `callBridge('/api/purpose/...')` —— 桌宠离线时的回落（purpose.petFallbackToQQ）。
 *
 * 协议与旧 `lib/bridge.js` 完全一致：控制台 `127.0.0.1:<consolePort>`，
 * 请求头 `x-console-token`（config.json 的 consoleToken 或 state/console-token 文件），
 * 写操作强制 `application/json`（桥接侧 415 防 CSRF）。
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { QQ_CONFIG, QQ_STATE_DIR } from './vendor/plugins/surfcore/lib/paths.js';
import { readJson } from './vendor/plugins/surfcore/lib/store.js';

/** 桥接控制台端口：config.json 的 consolePort，旧默认 3100。 */
export function consolePort() {
  const cfg = readJson(QQ_CONFIG, {}) ?? {};
  return Number(cfg.consolePort) || 3100;
}

/** 控制台令牌：优先 config.json 的 consoleToken，其次 state/console-token。 */
export function consoleToken() {
  const cfg = readJson(QQ_CONFIG, {}) ?? {};
  const configured = String(cfg.consoleToken ?? '').trim();
  if (configured) return configured;
  try { return fs.readFileSync(path.join(QQ_STATE_DIR, 'console-token'), 'utf8').trim(); } catch { return ''; }
}

/** 端口是否有人监听（桥接没跑时不要发请求，避免 IP 面板上留垃圾）。 */
export function portOpen(port = consolePort(), host = '127.0.0.1', timeout = 900) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/**
 * 调桥接控制台。返回 `{ ok, status, data, error }`（永不抛）。
 * 与旧 lib/bridge.js 的 callBridge 同语义：POST 无 body 时也要发 `{}`。
 */
export async function callBridge(pathname, { method = 'GET', body, timeoutMs = 4000 } = {}) {
  const token = consoleToken();
  const isWrite = String(method).toUpperCase() !== 'GET';
  const payload = body === undefined ? (isWrite ? {} : null) : body;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${consolePort()}${pathname}`, {
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

/** 目的页要的「QQ 载体可用性」；桥接没跑就返回 running:false，不抛。 */
export async function bridgeStatus() {
  const port = consolePort();
  const open = await portOpen(port);
  if (!open) {
    return { ok: false, running: false, port, mode: null, error: 'QQ 桥接没在运行：先在「SurfCore · QQ」里启动，或把载体切到桌宠' };
  }
  const result = await callBridge('/api/status', { timeoutMs: 1500 });
  const data = result?.data && typeof result.data === 'object' ? result.data : {};
  const ok = Boolean(result.ok) && data.ok !== false;
  return {
    ok,
    running: true,
    port,
    mode: data.mode ?? data?.status?.mode ?? null,
    error: ok ? '' : (data.error || result.error || `桥接状态读取失败（HTTP ${result.status}）`),
  };
}
