/**
 * dsbot-qq —— QQ 桥接进程控制、qq-mode 命名空间、白名单、SnowLuma、QQ 参数
 *
 * 由旧单体插件 dsbot 拆出的**独立、自包含**插件：只 import 包内文件与 Node 内置。
 * 依赖的旧代码在 lib/vendor/（由 tools/vendor.mjs 按仓库相对结构原样复制）。
 *
 * 负责：
 *   · QQ 桥接进程（<dsbot>/src/bridge.js，外部程序）的探活 / 启停 / 重启 / 日志；
 *   · 2 分钟自愈轮询（端口漂移自动重启）+ 读 character 包写的
 *     state/needs-bridge-restart.json 意图文件（架构文档 §4.2）；
 *   · <dsbot>/config.json 的读写（唯一写者；ownerQQ / admin 由 core 写、
 *     socialV2.voice* 由 voice 写、biliBridge* 由 bili 写 —— 本包写前会剥掉这些键）；
 *   · qq-mode settings 命名空间的读写（命名空间本体是同目录 qq-mode.js 那条 loader entry）；
 *   · 白名单 / 黑名单 / 鱼群保护状态 / SnowLuma 检测与启动 / 主人审计只读。
 *
 * 不负责：B站 调度与分享、记忆/角色/额度、管理员身份编辑（core 负责，本包只读展示）。
 *
 * 路由前缀：/dsh-dsbot-qq/api
 * 设置栏目 id：dsbot-qq（浏览器半边见 lib/client.js）
 */
import './bootstrap.js'; // 必须第一：先定好 DSBOT_ROOT，vendored paths 才能解析
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  BACKUP_DIR, BRIDGE_SUPERVISOR_LOG, PLUGIN_LOG, QQ_CONFIG, QQ_STATE_DIR,
  QQBOT_ROOT, STATE_DIR, UNIFIED_FILE, ensureDirs, maskPath,
} from './vendor/plugins/dsbot/lib/paths.js';
import { json, readBody, isLoopbackReq, sameOrigin } from './vendor/plugins/dsbot/lib/http-guard.js';
import {
  deepMerge, listBackups, normalizeQqConfig, pathSummary, readQqConfig, readUnified,
  redactForUi, restoreMaskedSecrets,
} from './vendor/plugins/dsbot/lib/store.js';
import {
  bridgeLogTail, callBridge, restart as restartBridge, start as startBridge,
  status as bridgeStatus, stop as stopBridge,
} from './vendor/plugins/dsbot/lib/bridge.js';
import {
  findSnowLumaInstall as findSnowLumaInstallIn, normalizeSnowLumaInstall, snowLumaMissingReport,
} from './vendor/plugins/dsbot/lib/snowluma-install.js';
import { summarizeQqFishGuard } from './vendor/plugins/dsbot/lib/qq-fish-guard.js';
import { adminFromSources, adminSummary } from './vendor/src/admin-identity.js';
import { readJson, updateJsonFile, writeJsonAtomic } from './config-lock.js';

export const name = 'dsbot-qq';
export const inject = ['webServer', 'connection'];
export const API_PREFIX = '/dsh-dsbot-qq/api';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.resolve(HERE, '..', 'package.json'), 'utf8')).version || '0.0.0-dev'; }
  catch { return '0.0.0-dev'; }
})();

const MODES = ['chat', 'closed-agent', 'reserved', 'reserved2', 'simulation'];

/** 桥接自愈意图文件（character 包在切换角色后写）。 */
export const BRIDGE_RESTART_INTENT = path.join(QQ_STATE_DIR, 'needs-bridge-restart.json');
/** 意图文件最长有效期：超过 30 分钟视为过期（架构文档 §4.2）。 */
export const BRIDGE_RESTART_INTENT_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * 这几个键有别的唯一写者（见 SPLIT-ARCHITECTURE §4.1），本包即使收到也不写：
 *   · ownerQQ / admin   → 「DSBot · 核心」是管理员身份唯一写者；
 *   · socialV2.voice    → 「DSBot · 语音」负责；
 *   · biliBridge        → 「DSBot · B站」负责。
 * 只剥这几个键，其它键（含未知键）原样保留 —— 拆分后多包写同一文件时的护栏。
 */
const FOREIGN_QQ_KEYS = ['ownerQQ', 'admin', 'socialV2.voice', 'biliBridge'];

const log = (...args) => {
  const line = `[${new Date().toISOString()}] [${name}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  try { console.log(line); } catch {}
  try {
    ensureDirs();
    // 旧插件的教训（2026-10-22 审计）：只 append 不轮转会无限增长。超过 2MB 滚一份 .1。
    try {
      const stat = fs.statSync(PLUGIN_LOG);
      if (stat.size > 2 * 1024 * 1024) fs.renameSync(PLUGIN_LOG, `${PLUGIN_LOG}.1`);
    } catch {}
    fs.appendFileSync(PLUGIN_LOG, `${line}\n`);
  } catch {}
};

// ── 小工具（对应旧 index.js:125-169 的公共辅助）────────────────────────────

function readTextFile(file, fallback = '') {
  try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; }
}

/** 只读文件尾部（默认 512KB）：日志接口不能因为日志变大就一次读进内存。 */
function readTextTail(file, maxBytes = 512 * 1024) {
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch { return ''; }
}

function mtimeIso(file) {
  try { return fs.statSync(file).mtime.toISOString(); } catch { return null; }
}

function fileInfo(file) {
  try {
    const stat = fs.statSync(file);
    return { exists: true, bytes: stat.size, mtime: stat.mtime.toISOString() };
  } catch {
    return { exists: false, bytes: 0, mtime: null };
  }
}

/** 配置版本戳（复用旧 src/config-stamps.js 的判据：mtime+size）。 */
function fileStamp(file) {
  try {
    const stat = fs.statSync(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch { return ''; }
}

function isStale(provided, current) {
  if (!provided || !current) return false;
  return String(provided) !== String(current);
}

/** state/mode.json 的本地模式（桥接写、插件只读；与 qq-mode settings 是两处）。 */
function parseModeState() {
  const local = readJson(path.join(QQ_STATE_DIR, 'mode.json'), {}) ?? {};
  return { localMode: local.mode ?? null, localRole: local.role ?? null };
}

function platformStartState() {
  const start = readUnified().config.platforms?.start ?? {};
  return { qq: start.qq !== false, bili: start.bili !== false };
}

function platformStartEnabled(id) {
  return platformStartState()[id] !== false;
}

/** 当前 DSH Web 地址（桥接要连的地址；DSH 重启后端口会变）。 */
function currentDshUrl(ctx) {
  try {
    const ws = ctx?.get?.('webServer');
    if (ws?.port) return `${ws.protocol || 'http:'}//127.0.0.1:${ws.port}`;
  } catch {}
  return String(process.env.DSH_WEB_URL ?? '').trim();
}

/** 桥接是不是「上一轮 DSH 的」：旧版本不报 root/dshBaseUrl，或者端口已经变了。 */
function bridgeStaleReason(status, expectedDshUrl = '') {
  if (!status?.running) return '';
  const runningRoot = status.root ? path.resolve(String(status.root)) : '';
  if (!runningRoot || runningRoot !== path.resolve(QQBOT_ROOT)) {
    return `桥接还在旧目录（root=${status.root ?? '未知'}）`;
  }
  const expected = String(expectedDshUrl ?? '').replace(/\/+$/, '');
  const actual = String(status.dshBaseUrl ?? '').trim().replace(/\/+$/, '');
  if (!actual) return '桥接是旧版本，无法报告 DSH 地址';
  if (expected && actual !== expected) return `桥接还连着旧 DSH（${actual} ≠ ${expected}）`;
  return '';
}

function portOpen(port, timeout = 600) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function deletePath(object, dotted) {
  const keys = String(dotted).split('.');
  let cur = object;
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (!cur || typeof cur !== 'object') return;
    cur = cur[keys[i]];
  }
  if (cur && typeof cur === 'object') delete cur[keys[keys.length - 1]];
}

/** 写前剥掉别的包负责的键；返回被剥掉的键（用于给 UI 一句提示）。 */
function stripForeignKeys(incoming) {
  const patch = incoming && typeof incoming === 'object' ? incoming : {};
  const stripped = [];
  for (const dotted of FOREIGN_QQ_KEYS) {
    const head = dotted.split('.')[0];
    if (Object.prototype.hasOwnProperty.call(patch, head)) {
      stripped.push(dotted);
      deletePath(patch, dotted);
    }
  }
  return { patch, stripped };
}

/**
 * 锁内 读-改-写 <dsbot>/config.json。写前剥掉 FOREIGN_QQ_KEYS（调用方已剥）。
 * 注意：不再调用 vendored store.js 的 saveQqConfig()——它不拿锁；这里必须走 config-lock。
 */
function saveQqConfigLocked(incomingPatch) {
  let result = null;
  updateJsonFile(QQ_CONFIG, () => {
    // 锁内读：避免「锁外读、锁内写」。readQqConfig() 只是合并模板默认值 + 磁盘文件。
    const current = readQqConfig().config;
    const restored = restoreMaskedSecrets(incomingPatch, current);
    const next = normalizeQqConfig(deepMerge(current, restored));
    result = { config: redactForUi(next) };
    return next;
  }, { backupLabel: 'qq-config' });
  return result;
}

// ── 桥接自愈：2 分钟轮询 + 意图文件 ────────────────────────────────────────

/** 读意图文件（不消费）。返回 { kind: 'none'|'valid'|'expired'|'invalid', ... }。 */
export function inspectRestartIntent({ now = Date.now(), file = BRIDGE_RESTART_INTENT } = {}) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { kind: 'none' }; }
  let raw = null;
  try { raw = JSON.parse(text); } catch { return { kind: 'invalid', reason: '不是合法 JSON' }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { kind: 'invalid', reason: '不是对象' };
  if (String(raw.action ?? '') !== 'restart-bridge') return { kind: 'invalid', reason: `未知 action：${String(raw.action ?? '')}` };
  const at = Date.parse(String(raw.at ?? ''));
  if (!Number.isFinite(at)) return { kind: 'invalid', reason: 'at 不是合法时间' };
  const age = now - at;
  // 允许 5 分钟时钟偏差（另一进程/时区写入）；超过 30 分钟 = 过期。
  if (age < -5 * 60 * 1000) return { kind: 'invalid', reason: 'at 在未来 5 分钟以外' };
  if (age > BRIDGE_RESTART_INTENT_MAX_AGE_MS) return { kind: 'expired', ageMs: age, raw };
  return { kind: 'valid', ageMs: age, raw };
}

function removeRestartIntent(file = BRIDGE_RESTART_INTENT) {
  try { fs.rmSync(file, { force: true }); return true; } catch { return false; }
}

let bridgeRepairBusy = false;

/**
 * 桥接自愈 tick（每 2 分钟）。拆成可注入依赖的纯异步函数，测试里能完全不碰子进程：
 *
 *   1. character 包写的 state/needs-bridge-restart.json 意图文件：有效就重启桥接并删除；
 *      过期 / 不合法就忽略（顺手清掉，避免每 2 分钟刷一条日志）；
 *   2. 平台启动开关 `platforms.start.qq`（core 写、本包只读）关着 → 不自启、不重启；
 *   3. 桥接在跑但「还是上一轮 DSH 的」→ 自动重启（端口漂移/换目录）；
 *   4. 桥接没在跑 → 尝试启动。
 *
 * @param {object} deps 可注入依赖（默认用真实实现；测试全部 mock 掉）。
 */
export async function tickBridgeSelfHeal(deps = {}) {
  const {
    status = bridgeStatus,
    start = startBridge,
    restart = restartBridge,
    now = Date.now(),
    dshWebUrl = '',
    ignoreSkipEnv = false,
    platformEnabled = platformStartEnabled,
    log: logFn = log,
    intentFile = BRIDGE_RESTART_INTENT,
  } = deps;

  if (process.env.DSBOT_SKIP_AUTOSTART === '1' && !ignoreSkipEnv) {
    return { ok: true, skipped: 'env', reason: 'DSBOT_SKIP_AUTOSTART=1' };
  }
  if (bridgeRepairBusy) return { ok: true, skipped: 'busy' };
  bridgeRepairBusy = true;
  try {
    const qqEnabled = platformEnabled('qq');

    // ── 意图文件优先：切角色后桥接必须重新读人格卡 ────────────────────────
    const intent = inspectRestartIntent({ now, file: intentFile });
    if (intent.kind === 'valid') {
      if (!qqEnabled) {
        removeRestartIntent(intentFile);
        logFn('收到桥接重启意图，但 QQ 启动开关已关闭：忽略并清除（下次手动启动会读新角色）');
        return { ok: true, skipped: 'platform-disabled', intent: 'ignored' };
      }
      logFn(`收到桥接重启意图（reason=${intent.raw.reason ?? '?'} role=${intent.raw.roleId ?? '?'}，${Math.round(intent.ageMs / 1000)}s 前）：重启桥接`);
      let result;
      try {
        result = await restart({ dshWebUrl });
      } catch (error) {
        result = { ok: false, error: String(error?.message ?? error) };
      }
      if (result?.ok === false) {
        // 失败时保留文件，下一轮 tick 再试（桥接反复起不来时用户能在日志里看到连续失败）。
        logFn('按意图重启桥接失败（保留意图文件，下一轮重试）：', result.error || result.message || '');
        return { ok: false, intent: 'failed', result };
      }
      removeRestartIntent(intentFile);
      logFn('按意图重启桥接成功，意图文件已删除');
      return { ok: true, intent: 'restarted', result };
    }
    if (intent.kind === 'expired' || intent.kind === 'invalid') {
      removeRestartIntent(intentFile);
      logFn(`忽略桥接重启意图（${intent.kind === 'expired' ? `已过期 ${Math.round(intent.ageMs / 60000)} 分钟` : intent.reason}），已清除`);
    }

    if (!qqEnabled) {
      return { ok: true, skipped: 'platform-disabled', reason: 'platforms.start.qq = false' };
    }

    // ── 自动启动 / 端口漂移自愈 ──────────────────────────────────────────
    let current = null;
    try { current = await status(); } catch (error) { current = { ok: false, running: false, error: String(error?.message ?? error) }; }
    if (current?.running) {
      const stale = bridgeStaleReason(current, dshWebUrl);
      if (stale) {
        logFn(`桥接自愈：${stale}，自动重启`);
        const restarted = await restart({ dshWebUrl });
        logFn('桥接自愈重启结果：', restarted.message || restarted.error || '');
        return { ok: restarted.ok !== false, stale, restarted };
      }
      return { ok: true, running: true, stale: '' };
    }
    logFn('桥接自愈：桥接未运行，尝试启动');
    const started = await start({ dshWebUrl });
    logFn('桥接自愈启动结果：', started.message || started.error || '');
    return { ok: started.ok !== false, started };
  } catch (error) {
    logFn('桥接自愈失败：', String(error?.message ?? error));
    return { ok: false, error: String(error?.message ?? error) };
  } finally {
    bridgeRepairBusy = false;
  }
}

// ── SnowLuma（只打开本机已安装程序，不安装、不部署、不代扫码）──────────────

function resolveSnowLumaLauncher(cfg) {
  const explicit = String(cfg?.launchScript ?? '').trim();
  if (explicit) return path.isAbsolute(explicit) ? explicit : path.resolve(QQBOT_ROOT, explicit);
  const base = String(cfg?.launcherPath ?? '').trim();
  if (!base) return '';
  const root = path.isAbsolute(base) ? base : path.resolve(QQBOT_ROOT, base);
  const candidates = [
    path.join(root, 'app', 'launcher.bat'),
    path.join(root, 'launcher.bat'),
    path.join(root, 'SnowLuma.exe'),
  ];
  return candidates.find((file) => { try { return fs.existsSync(file); } catch { return false; } }) ?? '';
}

/** SnowLuma 没有原生窗口，界面是 WebUI（默认 http://127.0.0.1:5100）；端口读它自己的 runtime.json。 */
function snowLumaWebui(cfg) {
  const port = (() => {
    try {
      const root = String(cfg?.launcherPath ?? '').trim();
      if (!root) return 5100;
      const runtime = JSON.parse(fs.readFileSync(path.join(root, 'app', 'config', 'runtime.json'), 'utf8'));
      return Number(runtime?.webuiPort) > 0 ? Number(runtime.webuiPort) : 5100;
    } catch { return 5100; }
  })();
  return { port, url: `http://127.0.0.1:${port}` };
}

function findSnowLumaInstall(cfg, extraPaths = []) {
  return findSnowLumaInstallIn({ snowluma: cfg ?? {}, extraPaths });
}

/** SnowLuma 连不上时到底卡在哪一步：进程没起 / 停在登录页 / token 或端口不对。 */
async function diagnoseSnowLuma(cfg, bridgeSnow = {}) {
  if (bridgeSnow.connected === true) return { state: 'ok', hint: '' };
  const webui = snowLumaWebui(cfg);
  const onebot = (await portOpen(3000)) || (await portOpen(3001));
  const webuiUp = await portOpen(webui.port);
  if (onebot) {
    return {
      state: 'onebot-rejected',
      hint: 'OneBot 端口在监听但桥接连不上：多半是 accessToken 不匹配（对齐 config.json 的 snowluma.accessToken），或 httpUrl 指到了 WebSocket 端口',
    };
  }
  if (webuiUp) {
    return { state: 'needs-login', hint: `SnowLuma 已启动但还没登录：打开 ${webui.url} 扫码/登录` };
  }
  return { state: 'not-running', hint: 'SnowLuma 没在运行：点「启动 SnowLuma」（会按需打开控制台）' };
}

// 只用系统默认浏览器打开本地回环地址；URL 由端口拼出，不接受外部输入。
function openLocalUrl(url) {
  if (process.env.DSBOT_SKIP_AUTOSTART === '1') return false;
  if (process.platform !== 'win32') return false;
  if (!/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(String(url))) return false;
  try {
    spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', '""', `"${url}"`], {
      detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true,
    }).unref();
    return true;
  } catch {
    return false;
  }
}

async function launchSnowLuma(cfg) {
  if (process.env.DSBOT_SKIP_AUTOSTART === '1') {
    return { ok: true, skipped: true, message: '测试环境：跳过打开 SnowLuma' };
  }
  if (cfg.allowLaunch !== true) {
    return { ok: false, error: '未开启「允许插件打开 SnowLuma」：在 QQ → SnowLuma 里打开并保存' };
  }
  const webui = snowLumaWebui(cfg);

  // 已登录（OneBot 3000/3001 在听）：什么都不用做，也别弹窗口。
  if ((await portOpen(3000)) || (await portOpen(3001))) {
    return { ok: true, already: true, opened: false, message: 'SnowLuma 已在运行且已登录' };
  }
  // 进程在、但 OneBot 没起 → 多半停在登录页：直接把 WebUI 打开让人扫码。
  if (await portOpen(webui.port)) {
    const opened = openLocalUrl(webui.url);
    return {
      ok: true,
      needsLogin: true,
      opened,
      webui: webui.url,
      message: opened ? `SnowLuma 在登录页，已打开控制台 ${webui.url}` : `SnowLuma 在登录页：请打开 ${webui.url} 扫码`,
    };
  }
  const launcher = resolveSnowLumaLauncher(cfg);
  if (!launcher) {
    return { ok: false, error: '找不到 SnowLuma 启动脚本：请在设置里填「SnowLuma 安装目录」或「启动脚本」' };
  }
  try {
    const cwd = path.dirname(launcher);
    const lower = launcher.toLowerCase();
    if (lower.endsWith('.bat') || lower.endsWith('.cmd')) {
      // 2026-10-22 审计：旧写法把 basename 拼进 cmd 命令串，路径里带 `&` 可注入命令。
      // 现在整条路径作为「verbatim 参数」交给 cmd，并且拒绝含引号/换行的路径。
      if (/["\r\n]/.test(launcher)) return { ok: false, error: '启动脚本路径含引号或换行，拒绝执行' };
      spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', '""', `"${launcher}"`], {
        cwd, detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: true,
      }).unref();
    } else {
      spawn(launcher, [], { cwd, detached: true, stdio: 'ignore', windowsHide: false }).unref();
    }
    // 等 WebUI 端口起来（最多 10 秒）：起来了就打开浏览器；没起来也给出地址让用户自己点。
    const until = Date.now() + 10_000;
    while (Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (await portOpen(webui.port)) {
        const opened = openLocalUrl(webui.url);
        return {
          ok: true,
          started: true,
          opened,
          webui: webui.url,
          launcher,
          message: opened ? `已启动 SnowLuma 并打开控制台 ${webui.url}` : `已启动 SnowLuma：${webui.url}`,
        };
      }
    }
    return { ok: true, started: true, pending: true, webui: webui.url, launcher, message: `已启动 SnowLuma，控制台稍后可访问：${webui.url}` };
  } catch (error) {
    return { ok: false, error: `打开 SnowLuma 失败：${error?.message ?? error}` };
  }
}

// ── 插件装配 ───────────────────────────────────────────────────────────────

export function apply(ctx) {
  ensureDirs();
  const disposers = [];
  let bridgeRepairTimer = null;

  /** 四层准入 + 统一 500，与旧插件 lib/index.js 的 route() 语义一致。 */
  function route(kind, pathname, handler) {
    disposers.push(ctx.webServer.register({
      kind,
      path: pathname,
      handler: async (req, res) => {
        const trusted = (() => {
          try {
            const list = readQqConfig().config?.httpGuard?.trustedProxyHosts;
            return Array.isArray(list) ? list : [];
          } catch { return []; }
        })();
        if (!isLoopbackReq(req, trusted)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return; }
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

  /** 当前 DSH settings 里的 qq-mode 值（读失败返回 null）。 */
  function readDshMode() {
    try {
      const settings = ctx.get('settings');
      if (settings?.describe) {
        const rows = settings.describe({ redactSecrets: true });
        const row = (rows ?? []).find((item) => item.ns === 'qq-mode');
        if (row) return row.value ?? null;
      }
    } catch {}
    return null;
  }

  async function readBridgeStatus() {
    try { return await bridgeStatus(); } catch (error) { return { ok: false, running: false, error: String(error?.message ?? error) }; }
  }

  // ── 概览 ────────────────────────────────────────────────────────────────
  async function overview() {
    const qqState = readQqConfig();
    const unifiedState = readUnified();
    const qq = qqState.config;
    const snow = qq.snowluma ?? {};
    const bridge = await readBridgeStatus();
    const snowDiag = await diagnoseSnowLuma(snow, bridge?.snowluma ?? {}).catch(() => ({ state: 'unknown', hint: '' }));
    const mode = parseModeState();
    const dshSetting = readDshMode();
    const dshMode = dshSetting?.mode ?? null;
    const admin = adminSummary(adminFromSources({
      unified: unifiedState.hasAdmin ? unifiedState.config : { ...unifiedState.config, admin: undefined },
      qq,
    }));
    return {
      ok: true,
      plugin: name,
      version: PLUGIN_VERSION,
      bridge,
      mode: {
        local: mode.localMode,
        dsh: dshMode,
        effective: dshMode || mode.localMode,
        role: mode.localRole,
        ownerQQ: admin.qq || qq.ownerQQ || null,
        allowGroups: qq.allow?.groups?.length ?? 0,
        allowPrivate: qq.allow?.private?.length ?? 0,
      },
      // 平台启动开关由 core 包写；本包只读并展示（关闭时不自启、不参与一键启动）。
      platformStart: platformStartState(),
      // 管理员身份只读展示（编辑入口在「DSBot · 核心」）。
      admin,
      snowluma: {
        launcherPath: String(snow.launcherPath ?? ''),
        launchScript: String(snow.launchScript ?? ''),
        allowLaunch: snow.allowLaunch === true,
        downloadUrl: String(snow.downloadUrl ?? 'https://github.com/SnowLuma/SnowLuma/releases/latest'),
        detected: findSnowLumaInstall(snow).ok,
        webui: snowLumaWebui(snow),
        diagnosis: snowDiag,
      },
      paths: pathSummary(),
      files: {
        qqConfig: fileInfo(QQ_CONFIG),
        unified: fileInfo(UNIFIED_FILE),
        pluginLog: fileInfo(PLUGIN_LOG),
        bridgeSupervisorLog: fileInfo(BRIDGE_SUPERVISOR_LOG),
        modeState: fileInfo(path.join(QQ_STATE_DIR, 'mode.json')),
      },
    };
  }

  // ── 配置读写（<dsbot>/config.json，QQ 唯一写者）───────────────────────
  async function handleConfig(req, res) {
    if (req.method === 'GET') {
      const qqState = readQqConfig();
      const unifiedState = readUnified();
      const admin = adminSummary(adminFromSources({
        unified: unifiedState.hasAdmin ? unifiedState.config : { ...unifiedState.config, admin: undefined },
        qq: qqState.config,
      }));
      json(res, 200, {
        ok: true,
        qq: redactForUi(qqState.config),
        hasUserFile: { qq: qqState.hasUserFile },
        admin,
        platformStart: platformStartState(),
        paths: pathSummary(),
        backups: listBackups(20),
        // 保存时回传这些戳：服务端据此判断「加载之后配置有没有被别处改过」（乐观并发）。
        stamps: { qq: fileStamp(QQ_CONFIG) },
      });
      return;
    }

    let body = null;
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch {
      json(res, 400, { ok: false, error: '请求体不是合法 JSON' });
      return;
    }
    if (!body || typeof body !== 'object' || !body.qq || typeof body.qq !== 'object' || Array.isArray(body.qq)) {
      json(res, 400, { ok: false, error: '缺少 qq 配置对象' });
      return;
    }

    // 乐观并发：设置页加载后如果 config.json 被控制台/别的窗口改过，拒绝整份回写。
    const currentStamps = { qq: fileStamp(QQ_CONFIG) };
    const baseStamp = body.baseStamp && typeof body.baseStamp === 'object' ? body.baseStamp : null;
    if (baseStamp && isStale(baseStamp.qq, currentStamps.qq)) {
      json(res, 409, {
        ok: false,
        code: 'CONFIG_STALE',
        error: '配置已被别处修改（qq），本次保存未执行',
        hint: '点「重新读取」拿到最新配置后再改；直接覆盖会丢掉别人的修改',
        stamps: currentStamps,
      });
      return;
    }

    const warnings = [];
    const { patch, stripped } = stripForeignKeys(body.qq);
    if (stripped.length) {
      warnings.push(`以下键由其它插件负责写入，本次已跳过（原值保留）：${stripped.join('、')}`);
    }
    if (body.unified && typeof body.unified === 'object') {
      warnings.push('统一配置（~/.dsh/dsbot/config.json，含「启动 QQ」开关）由「DSBot · 核心」栏目负责写入，本包未写。');
    }

    const saved = saveQqConfigLocked(patch);
    const result = {
      ok: true,
      saved: { qq: true },
      qq: saved?.config ?? null,
      warnings,
      platformStart: platformStartState(),
      stamps: { qq: fileStamp(QQ_CONFIG) },
    };

    if (body.restartBridge === true) {
      if (process.env.DSBOT_SKIP_AUTOSTART === '1') {
        result.bridge = { ok: true, skipped: true, message: '测试环境：跳过重启桥接' };
      } else if (!platformStartEnabled('qq')) {
        warnings.push('QQ 启动开关已关闭：已跳过「保存并重启 QQ 桥接」。');
      } else {
        const restart = await restartBridge({ dshWebUrl: currentDshUrl(ctx) });
        result.bridge = restart;
        if (!restart.ok) warnings.push(`桥接重启失败：${restart.error ?? restart.message ?? '未知'}`);
      }
    }
    if (!result.bridge) {
      warnings.push('QQ 配置已保存；桥接只在启动时读 config.json，需要「重启桥接」才会全部生效。');
    }
    json(res, 200, result);
  }

  // ── 模式（本地 mode.json + DSH qq-mode 命名空间 + 通知桥接）───────────────
  async function handleMode(req, res) {
    if (req.method === 'GET') {
      json(res, 200, { ok: true, ...parseModeState(), dshSetting: readDshMode() });
      return;
    }
    let body = null;
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch {
      json(res, 400, { ok: false, error: '请求体不是合法 JSON' });
      return;
    }
    const mode = body?.mode ? String(body.mode) : null;
    if (mode && !MODES.includes(mode)) {
      json(res, 400, { ok: false, error: `mode 必须是 ${MODES.join(' / ')}` });
      return;
    }
    if (!mode) {
      json(res, 400, { ok: false, error: '缺少 mode' });
      return;
    }
    const warnings = [];
    if (body.ownerQQ !== undefined) {
      warnings.push('管理员身份（ownerQQ）的编辑入口在「DSBot · 核心」栏目；本包只读展示，本次未写。');
    }

    const stateFile = path.join(QQ_STATE_DIR, 'mode.json');
    const current = readJson(stateFile, {}) ?? {};
    writeJsonAtomic(stateFile, { ...current, mode });

    const settings = ctx.get('settings');
    if (settings?.update) {
      try {
        await settings.update('qq-mode', { mode });
      } catch (error) {
        warnings.push(`写 DSH qq-mode 设置失败（本地 mode.json 已写）：${String(error?.message ?? error)}`);
        log('写 DSH qq-mode 设置失败（本地 mode.json 已写）：', String(error?.message ?? error));
      }
    } else {
      warnings.push('DSH settings 服务不可用：只写了本地 state/mode.json，qq-mode 命名空间未更新。');
    }

    if (process.env.DSBOT_SKIP_AUTOSTART !== '1') {
      try { await callBridge('/api/mode', { method: 'POST', body: { mode } }); } catch (error) {
        log('通知桥接切换模式失败（下次启动生效）：', String(error?.message ?? error));
      }
    }
    json(res, 200, {
      ok: true,
      mode,
      ownerQQ: readDshMode()?.ownerQQ ?? null,
      warnings,
      note: '若桥接未运行，下次启动时生效。',
    });
  }

  // ── 桥接控制 ────────────────────────────────────────────────────────────
  async function handleBridge(req, res) {
    if (req.method === 'GET') {
      json(res, 200, { ok: true, status: await readBridgeStatus() });
      return;
    }
    let body = null;
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch {
      json(res, 400, { ok: false, error: '请求体不是合法 JSON' });
      return;
    }
    const action = String(body?.action ?? 'status');
    const skip = process.env.DSBOT_SKIP_AUTOSTART === '1';
    const dshWebUrl = currentDshUrl(ctx);

    if (action === 'status') { json(res, 200, { ok: true, status: await readBridgeStatus() }); return; }

    if (action === 'start' || action === 'restart' || action === 'start-qq') {
      if (!platformStartEnabled('qq')) {
        json(res, 409, { ok: false, error: 'QQ 启动开关已关闭：去「DSBot · 核心」栏目打开「启动 QQ」并保存' });
        return;
      }
      if (skip) { json(res, 200, { ok: true, skipped: true, message: `测试环境：跳过 ${action === 'restart' ? '重启' : '启动'}桥接` }); return; }
      if (action === 'start') { json(res, 200, await startBridge({ dshWebUrl })); return; }
      if (action === 'restart') { json(res, 200, await restartBridge({ dshWebUrl })); return; }
      // start-qq：桥接 + 按需打开 SnowLuma（仍是用户显式点击，不自动弹）。
      const bridge = await startBridge({ dshWebUrl });
      const snowluma = await launchSnowLuma(readQqConfig().config?.snowluma ?? {});
      json(res, 200, {
        ok: bridge?.ok !== false,
        message: [bridge?.message, snowluma?.message || snowluma?.error].filter(Boolean).join('；'),
        bridge,
        snowluma,
      });
      return;
    }
    if (action === 'stop') {
      if (skip) { json(res, 200, { ok: true, skipped: true, message: '测试环境：跳过停止桥接（不会杀任何进程）' }); return; }
      json(res, 200, await stopBridge());
      return;
    }
    if (action === 'logs') {
      const lines = Math.max(10, Math.min(500, Number(body?.lines) || 120));
      json(res, 200, {
        ok: true,
        plugin: readTextTail(PLUGIN_LOG).split('\n').slice(-lines).join('\n'),
        bridge: bridgeLogTail(lines),
        paths: { pluginLog: maskPath(PLUGIN_LOG), bridgeLog: maskPath(path.join(QQ_STATE_DIR, 'bridge.log')) },
      });
      return;
    }
    json(res, 400, { ok: false, error: `未知 action：${action}` });
  }

  // ── SnowLuma 检测 / 启动 / 打开控制台 ─────────────────────────────────────
  async function handleSnowluma(req, res, url) {
    const cfg = readQqConfig().config?.snowluma ?? {};
    if (req.method === 'GET') {
      const found = findSnowLumaInstall(cfg);
      const webui = snowLumaWebui(cfg);
      const diagnosis = await diagnoseSnowLuma(cfg).catch(() => ({ state: 'unknown', hint: '' }));
      json(res, 200, {
        ok: true,
        found: {
          ok: found.ok === true,
          root: found.root ?? '',
          launcher: found.launcher ?? '',
          // 候选目录可能很多，只回最近 12 个（失败提示用）
          tried: (found.tried ?? []).slice(-12).map((item) => item.path),
        },
        config: {
          launcherPath: String(cfg.launcherPath ?? ''),
          launchScript: String(cfg.launchScript ?? ''),
          homeDir: String(cfg.homeDir ?? ''),
          allowLaunch: cfg.allowLaunch === true,
        },
        webui,
        diagnosis,
        downloadUrl: String(cfg.downloadUrl ?? 'https://github.com/SnowLuma/SnowLuma/releases/latest'),
      });
      return;
    }

    let body = null;
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch {
      json(res, 400, { ok: false, error: '请求体不是合法 JSON' });
      return;
    }
    const action = String(body?.action ?? '');

    if (action === 'detect') {
      const picked = String(body?.path ?? '').trim();
      const direct = picked ? normalizeSnowLumaInstall(picked) : null;
      const found = picked
        ? (direct ? { ok: true, ...direct, tried: [{ path: picked, ok: true }] } : { ok: false, tried: [{ path: picked, ok: false }] })
        : findSnowLumaInstall(cfg);
      if (!found.ok) {
        // 失败必须有结构化报告：code + 人读的 error + 下一步 hint + 试过的路径（AGENTS 1.7）。
        const report = snowLumaMissingReport({ picked, tried: (found.tried ?? []).map((x) => x.path).slice(0, 12) });
        json(res, 200, { ok: false, code: report.code, title: report.title, error: report.error, hint: report.hint, tried: report.tried });
        return;
      }
      const saved = saveQqConfigLocked({ snowluma: { launcherPath: found.root, allowLaunch: true } });
      json(res, 200, {
        ok: true,
        found: true,
        path: found.root,
        launcher: found.launcher,
        qq: saved?.config ?? null,
        message: `已找到 SnowLuma：${found.root}`,
      });
      return;
    }

    if (action === 'save') {
      // 只接受 SnowLuma 自己的键（不碰别的包负责的键）。
      const patch = {};
      for (const key of ['launcherPath', 'launchScript', 'homeDir']) {
        if (typeof body[key] === 'string') patch[key] = body[key].trim();
      }
      if (typeof body.allowLaunch === 'boolean') patch.allowLaunch = body.allowLaunch;
      if (!Object.keys(patch).length) { json(res, 400, { ok: false, error: '没有可保存的 SnowLuma 参数' }); return; }
      const saved = saveQqConfigLocked({ snowluma: patch });
      json(res, 200, { ok: true, qq: saved?.config ?? null });
      return;
    }

    if (action === 'launch') {
      const result = await launchSnowLuma(cfg);
      json(res, 200, { ok: result.ok !== false, ...result, ...(result.ok === false ? {} : {}) });
      return;
    }

    if (action === 'open') {
      const webui = snowLumaWebui(cfg);
      const opened = openLocalUrl(webui.url);
      json(res, 200, {
        ok: true,
        opened,
        webui: webui.url,
        message: opened ? `已打开 ${webui.url}` : `请手动打开 ${webui.url}`,
        hint: opened ? '' : '自动打开仅支持 Windows；测试环境（DSBOT_SKIP_AUTOSTART=1）也会跳过。',
      });
      return;
    }

    json(res, 400, { ok: false, error: `未知 action：${action}` });
  }

  // ── QQ 鱼群保护（设置页「最近触发」）────────────────────────────────────
  function handleQqFishGuard(res) {
    try {
      const file = path.join(QQ_STATE_DIR, 'social-v2.json');
      const data = readJson(file, {}) ?? {};
      const summary = summarizeQqFishGuard(data, { now: Date.now() });
      json(res, 200, {
        ok: true,
        file: maskPath(file),
        now: new Date().toISOString(),
        ...summary,
        config: readQqConfig().config?.fishGuard ?? {},
      });
    } catch (error) {
      json(res, 500, { ok: false, error: String(error?.message ?? error) });
    }
  }

  // ── 主人特权操作审计（只读桥接写好的 state/owner-audit.jsonl）─────────────
  async function handleOwnerAudit(req, res, url) {
    if (req.method === 'GET') {
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 50));
      const result = await callBridge(`/api/owner-audit?limit=${limit}`, { timeoutMs: 8000 });
      if (result.ok && result.data) {
        json(res, 200, result.data);
        return;
      }
      json(res, 200, {
        ok: true,
        available: false,
        entries: [],
        error: result.error || result.data?.error || '桥接不可用',
        hint: '主人特权审计由桥接进程写进 state/owner-audit.jsonl；先启动 QQ 桥接再刷新。',
      });
      return;
    }
    if (req.method === 'POST') {
      let body = null;
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch {
        json(res, 400, { ok: false, error: '请求体不是合法 JSON' });
        return;
      }
      // 只支持「打开所在文件夹」；路径固定，不接受任何用户输入。
      if (body?.action !== 'open') { json(res, 400, { ok: false, error: '未知 action' }); return; }
      if (process.platform !== 'win32') { json(res, 200, { ok: false, error: '只有 Windows 支持打开文件夹' }); return; }
      if (process.env.DSBOT_SKIP_AUTOSTART === '1') { json(res, 200, { ok: false, error: '测试环境：跳过打开文件夹' }); return; }
      try {
        spawn('explorer.exe', [QQ_STATE_DIR], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
        json(res, 200, { ok: true, path: maskPath(QQ_STATE_DIR) });
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message ?? error) });
      }
      return;
    }
    json(res, 405, { ok: false, error: 'method not allowed' });
  }

  // ── 路由分派 ────────────────────────────────────────────────────────────
  route('prefix', API_PREFIX, async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname;
    if (pathname === `${API_PREFIX}/overview`) { json(res, 200, await overview()); return; }
    if (pathname === `${API_PREFIX}/config`) { await handleConfig(req, res); return; }
    if (pathname === `${API_PREFIX}/mode`) { await handleMode(req, res); return; }
    if (pathname === `${API_PREFIX}/bridge`) { await handleBridge(req, res); return; }
    if (pathname === `${API_PREFIX}/snowluma`) { await handleSnowluma(req, res, url); return; }
    if (pathname === `${API_PREFIX}/fish-guard/qq`) {
      if (req.method !== 'GET') { json(res, 405, { ok: false, error: '只支持 GET' }); return; }
      handleQqFishGuard(res);
      return;
    }
    if (pathname === `${API_PREFIX}/owner-audit`) { await handleOwnerAudit(req, res, url); return; }
    if (pathname === `${API_PREFIX}/status`) {
      const bridge = await readBridgeStatus();
      json(res, 200, {
        ok: true,
        plugin: name,
        version: PLUGIN_VERSION,
        bridge: { running: Boolean(bridge?.running), ok: bridge?.ok !== false },
        platformStart: platformStartState(),
        paths: {
          stateDir: maskPath(STATE_DIR),
          qqRoot: maskPath(QQBOT_ROOT),
          backupDir: maskPath(BACKUP_DIR),
          qqConfig: maskPath(QQ_CONFIG),
          unified: maskPath(UNIFIED_FILE),
        },
        files: {
          qqConfig: fs.existsSync(QQ_CONFIG),
          unified: fs.existsSync(UNIFIED_FILE),
          bridgeRestartIntent: fs.existsSync(BRIDGE_RESTART_INTENT),
        },
        autoStart: {
          enabled: platformStartEnabled('qq'),
          skippedByEnv: process.env.DSBOT_SKIP_AUTOSTART === '1',
          intentFile: maskPath(BRIDGE_RESTART_INTENT),
        },
      });
      return;
    }
    json(res, 404, { ok: false, error: `未知接口：${pathname}` });
  });

  route('exact', '/dsh-dsbot-qq/health', async (_req, res) => {
    json(res, 200, { ok: true, name, version: PLUGIN_VERSION });
  });

  // ── 启动后异步做的事（不阻塞插件激活）──────────────────────────────────
  // 桥接自愈：启动时检查一次，之后每 2 分钟（含角色切换意图文件）。
  const runSelfHeal = () => { void tickBridgeSelfHeal({ dshWebUrl: currentDshUrl(ctx) }); };
  runSelfHeal();
  bridgeRepairTimer = setInterval(runSelfHeal, 120_000);
  bridgeRepairTimer.unref?.();

  ctx.effect(() => () => {
    if (bridgeRepairTimer) { clearInterval(bridgeRepairTimer); bridgeRepairTimer = null; }
    for (const dispose of disposers.splice(0)) { try { dispose(); } catch {} }
  });

  log(`已激活 v${PLUGIN_VERSION}；dsbot=${maskPath(QQBOT_ROOT)}；stateDir=${maskPath(STATE_DIR)}`);
}

export default { name, inject, apply };
