/**
 * 本机 HTTP 接口的通用护栏 —— 设置页 API（`/dsh-dsbot/api/*`）与
 * 桌宠 API（`/dsh-dsbot/pet-api/*`）共用**同一份**实现。
 *
 * 为什么单独一个模块：这两套接口的准入条件（只接受回环 Host、写操作必须同源、
 * 响应头固定）曾经在两个文件里各抄了一遍。安全判据复制多份的后果不是"重复代码不好看"，
 * 而是**将来只修一处**：放宽/收紧回环名单时漏掉另一份，缺口就会静默存在。
 * 所以这里只做一件事：把「这个请求能不能进」的判据收敛成唯一实现，改一处两处同时生效。
 *
 * 这些函数都**只读请求**、没有副作用，便于单测（`scripts/test-http-guard.mjs`）。
 */
import { timingSafeEqual } from 'node:crypto';

/** 统一的 JSON 响应（响应头固定 no-store；res 已关闭时不抛，交给上层日志）。 */
export function json(res, code, value) {
  try {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  } catch {}
}

/** 读取请求体（有上限，超限直接断开）。默认 512KB（设置页 API 的既有口径；桌宠 API 传更小的 256KB）。 */
export function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Host 头里的主机名：`[::1]:8080` → `[::1]`，`127.0.0.1:3100` → `127.0.0.1`。 */
function hostName(host) {
  // IPv6 字面量在 Host 里是 `[::1]:8080`：`split(':')[0]` 只会拿到 `[`，
  // 于是原本写好的 `[::1]` / `::1` 分支成了永远走不到的死代码
  // （2026-10-26 审计：单测第一次跑出这个洞；DSH 若绑到 ::1，整套接口会 403）。
  return host.startsWith('[')
    ? (host.includes(']') ? host.slice(0, host.indexOf(']') + 1) : '')
    : host.split(':')[0];
}

const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * 这个 TCP 连接是不是从本机发起的。
 *
 * 可信反代那条分支必须同时满足「Host 在白名单」+「对端是本机」：反代（Caddy）
 * 就蹲在 127.0.0.1，公网请求到后端时对端就是回环。而 DSH Web 本身只绑回环，
 * 所以远端能进来的唯一路径就是那台反代。少了这一条，等于把白名单变成
 * 「任何本机能连到 3102 的进程都能伪装成公网入口」——虽然本机进程本来就
 * 被当成可信，但判据还是要写全，否则将来 DSH 改绑 0.0.0.0 时会静默失守。
 */
function isLoopbackPeer(req) {
  const addr = String(req.socket?.remoteAddress ?? '');
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/**
 * 只接受本机回环访问。
 *
 * 判据是 **Host 请求头**而不是对端地址：DNS rebinding 场景下，页面把 evil.com
 * 解析到 127.0.0.1 时对端地址就是回环，只有 Host 还能认出真实来源。
 * 浏览器无法伪造 Host，所以这一层挡得住网页；挡不住本机进程——那一层由
 * DSH 的 `connection.requestRejection`（设置页 API）与 `x-pet-token`（桌宠 API）负责。
 *
 * `trustedHosts`（config.json → `httpGuard.trustedProxyHosts`，默认空）是给
 * **本机反代**留的口子：DSH Web 挂在公网域名后面时，反代会把 Host 改写成
 * 公网域名（`header_up Host {hostport}`），回环判据必然不认，整套设置页 API
 * 会 403「只接受本机回环访问」。把那个域名显式写进白名单即放行，
 * 且**仍要求对端是本机**、仍要过 DSH 会话鉴权；默认空数组 = 老行为不变。
 *
 * 注意别把这里放宽成「X-Forwarded-Host 命中就放行」：那个头谁都能伪造。
 */
export function isLoopbackReq(req, trustedHosts = []) {
  const host = String(req.headers?.host ?? '').trim().toLowerCase();
  if (!host) return false;
  if (LOOPBACK_NAMES.has(hostName(host)) || host === '::1') return true;
  if (!Array.isArray(trustedHosts) || trustedHosts.length === 0) return false;
  if (!isLoopbackPeer(req)) return false;
  return trustedHosts.some((entry) => String(entry ?? '').trim().toLowerCase() === host);
}

/**
 * 写操作的同源校验：带了 Origin 就必须与 Host 一致；**没带 Origin 视为通过**。
 *
 * 没带 Origin 的是非浏览器客户端（curl / 桌宠主进程）。浏览器对跨站 POST 一定会带
 * Origin，所以"浏览器发起的跨站写"必然落在这条判断里被拒。
 */
export function sameOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) return true;
  try {
    const originHost = new URL(String(origin)).host.toLowerCase();
    return originHost === String(req.headers?.host ?? '').toLowerCase();
  } catch {
    return false;
  }
}

/** 定长比较令牌：`!==` 会在第一个不同字符处短路，可被本机进程用响应时延逐字节试探。 */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  // 空令牌永不通过：`timingSafeEqual` 对两个空 buffer 返回 true，
  // 那样"还没生成令牌"就会被当成"令牌正确"。失败关闭。
  if (left.length === 0 || right.length === 0) return false;
  if (left.length !== right.length) return false;
  try {
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}
