/**
 * surfcore-core —— 配置模型 / 统一配置读写 / 管理员身份投影 / 概览与诊断 /
 *                  扩展宿主 / 平台注册表 / 组件更新 / 备份 / 日志 / 原生浏览
 *
 * 由旧单体插件 surfcore 拆出的**独立、自包含**插件：只 import 包内文件与 Node 内置。
 * 依赖的旧代码在 lib/vendor/（由 tools/vendor.mjs 按仓库相对结构原样复制）。
 *
 * 路由前缀：/dsh-surfcore-core/api
 * 设置栏目 id：surfcore-core（浏览器半边见 lib/client.js）
 *
 * 边界（见 docs/SPLIT-ARCHITECTURE.md §4.1）：
 *   · `~/.dsh/surfcore/config.json`     —— 本包唯一写者，但只写自己负责的键
 *     （admin / extensions / platforms / updates / ui / qqbotRoot）；bridge / persona /
 *     memory / alignment / memoryCard 由对应拆分包写，这里读得到但不回写。
 *   · `<surfcore>/config.json` 的 ownerQQ、`bili.config.json` 的 owner
 *     —— **管理员身份唯一写者**：保存 admin 时投影到这两份旧格式文件（各自加锁）。
 *   · 扩展状态 `~/.dsh/surfcore/extensions.json`、备份目录、plugin.log —— 本包负责。
 *   · QQ / B站 的运行态、启停、业务参数 —— 分别由 surfcore-qq / surfcore-bili 负责，
 *     本包只读展示（读 state/* 文件）并给一句「到对应栏目处理」的提示。
 */
import { PACKAGE_ROOT, SURFCORE_ROOT } from './bootstrap.js'; // 必须第一：先定好 SURFCORE_ROOT，vendored paths 才能解析
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  ALIGN_FILE, BACKUP_DIR, BILI_ALIGNMENT_FILE, BILI_CONFIG, BILI_CRED, BILI_MJS,
  DSH_HOME, EXTENSIONS_DIR, EXT_STATE_FILE, MEMORY_DIR, PLUGIN_LOG, QQ_CONFIG,
  QQ_STATE_DIR, QQBOT_ROOT, STATE_DIR, UNIFIED_FILE, ensureDirs, maskPath,
} from './vendor/plugins/surfcore/lib/paths.js';
import { json, isLoopbackReq, readBody, sameOrigin } from './vendor/plugins/surfcore/lib/http-guard.js';
import {
  clone, deepMerge, isPlainObject, listBackups, pathSummary,
  readAll, readBiliConfig, readQqConfig, readUnified, redactForUi, restoreMaskedSecrets,
} from './vendor/plugins/surfcore/lib/store.js';
import { PRIVACY_POLICY_VERSION } from './vendor/plugins/surfcore/lib/privacy.js';
import { PlatformRegistry, PLATFORM_CAPABILITIES } from './vendor/plugins/surfcore/lib/platforms.js';
import { ExtensionHost } from './vendor/plugins/surfcore/lib/extensions.js';
import { createUpdatesService, resumePendingApply } from './vendor/plugins/surfcore/lib/updates.js';
import { buildInstallChecks, installOk, planDoctorFix } from './vendor/plugins/surfcore/lib/doctor.js';
import { findSnowLumaInstall as findSnowLumaInstallIn } from './vendor/plugins/surfcore/lib/snowluma-install.js';
import { adminFromSources, adminSummary, normalizeAdmin, projectAdminSave } from './vendor/src/admin-identity.js';
import { fileStamp, isStale } from './vendor/src/config-stamps.js';
import { backupFile, readJson, updateJsonFile, withConfigLock, writeJsonAtomic } from './config-lock.js';

export const name = 'surfcore-core';
export const inject = ['webServer', 'connection'];
export const API_PREFIX = '/dsh-surfcore-core/api';
export const EXT_PREFIX = '/dsh-surfcore-core/ext';

/** 本包负责写的统一配置键（其余键由对应拆分包负责，这里只读、不回写）。 */
const OWNED_UNIFIED_KEYS = ['admin', 'extensions', 'platforms', 'updates', 'ui', 'qqbotRoot'];

/**
 * 旧插件 pluginLog 的等价物（名字里带包名，方便多插件共用一个 plugin.log 时过滤）。
 * 2026-10-22 审计：只 append 不轮转会无限增长。超过 2MB 就滚一份 .1（保留一代）。
 */
const log = (...args) => {
  const line = `[${new Date().toISOString()}] [${name}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  try { console.log(line); } catch {}
  try {
    ensureDirs();
    try {
      const stat = fs.statSync(PLUGIN_LOG);
      if (stat.size > 2 * 1024 * 1024) fs.renameSync(PLUGIN_LOG, `${PLUGIN_LOG}.1`);
    } catch {}
    fs.appendFileSync(PLUGIN_LOG, `${line}\n`);
  } catch {}
};

function version() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')).version || '0.0.0-dev';
  } catch {
    return '0.0.0-dev';
  }
}
const VERSION = version();

// ── 小工具（旧 index.js:125-169 原样搬，pluginLog 已换成本包 log）────────────
function safeBackupName(fileName) {
  const base = path.basename(String(fileName ?? ''));
  if (!base || base !== String(fileName)) return '';
  return base;
}

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

/** 本机回环端口探活（旧 index.js:1634-1643）。只读探测，不启动任何东西。 */
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

/** 读 bridge.lock（纯数字 PID）判断桥接进程是否还活着；读不到 = 未知（null）。 */
function lockPid() {
  try {
    const pid = Number(fs.readFileSync(path.join(QQ_STATE_DIR, 'bridge.lock'), 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

export function apply(ctx) {
  ensureDirs();
  const disposers = [];

  // 上次的"退出后应用"可能没跑起来（Electron 宿主没带 ELECTRON_RUN_AS_NODE）：
  // 这里重新排队，用户下次退出 DSH 就会应用（2026-10-28 反馈：点几次都还是旧版本）。
  try { resumePendingApply({ stateDir: STATE_DIR, pluginLog: log }); } catch (error) { log('[updates] 启动重试失败：', String(error?.message ?? error)); }

  // ── 平台注册表 + 扩展宿主 ───────────────────────────────────────────────
  // 平台注册表是本包唯一实例（QQ/B站 是内置项，贴吧预留）；运行态探针一律只读。
  const platforms = new PlatformRegistry();
  platforms.setStatus('qq', () => qqStateSummary());
  platforms.setStatus('bili', () => biliStateSummary());

  // ExtensionHost 需要 memory / align / bridge 三组能力回调。拆分后这三块分别归
  // surfcore-memory / surfcore-qq，本包只提供「说明性错误」而不是假装成功：
  // 扩展真的调用它们时会拿到明确提示，而不是静默拿到空数据。
  const notOwnedByCore = (what) => async () => ({ ok: false, error: `${what}由对应拆分包负责（记忆 → surfcore-memory，桥接 → surfcore-qq）` });
  const extensionHost = new ExtensionHost({
    platforms,
    memory: {
      memoryStatus: notOwnedByCore('记忆状态'),
      previewQqForBili: notOwnedByCore('QQ→B站 记忆预览'),
      syncQqToBili: notOwnedByCore('QQ→B站 记忆同步'),
      refreshBiliToQq: notOwnedByCore('B站→QQ 记忆刷新'),
      biliToQqStatus: notOwnedByCore('B站→QQ 记忆状态'),
      auditTail: notOwnedByCore('记忆审计尾部'),
    },
    align: {
      listLinks: notOwnedByCore('身份对齐列表'),
      listCandidates: notOwnedByCore('身份对齐候选'),
      addLink: notOwnedByCore('身份对齐新增'),
      updateLink: notOwnedByCore('身份对齐修改'),
      removeLink: notOwnedByCore('身份对齐删除'),
      approveCandidate: notOwnedByCore('身份对齐确认'),
      rejectCandidate: notOwnedByCore('身份对齐否定'),
      stats: notOwnedByCore('身份对齐统计'),
    },
    bridge: {
      status: notOwnedByCore('桥接状态'),
      start: notOwnedByCore('桥接启动'),
      stop: notOwnedByCore('桥接停止'),
      restart: notOwnedByCore('桥接重启'),
      call: notOwnedByCore('桥接调用'),
    },
    log,
  });

  // 通过 POST /platforms {action:'register'} 临时登记的平台适配器（扩展走 ExtensionHost 自己的通道）。
  const registeredPlatforms = new Map();

  // ── 组件更新 ────────────────────────────────────────────────────────────
  // 拆分后目录结构变了：更新器只负责「旧 SurfCore 仓库 + 语音包目录 + 桌宠目录 +
  // 用户登记的组件」。8 个拆分包本身由 DSH 的 bundle 安装/升级管理（不在本包职责内，
  // 也不去猜它们的安装目录）。
  const updates = createUpdatesService({
    stateDir: STATE_DIR,
    pluginLog: log,
    githubToken: () => String(readUnified().config?.updates?.githubToken ?? ''),
    components: updateComponents,
  });

  // ── 只读运行态（供 overview / platforms.statusAll 使用）─────────────────
  function qqStateSummary() {
    const mode = readJson(path.join(QQ_STATE_DIR, 'mode.json'), {}) ?? {};
    const pid = lockPid();
    return {
      source: 'file',
      running: pid ? pidAlive(pid) : null,
      pid,
      mode: mode.mode ?? null,
      role: mode.role ?? null,
      lastLogAt: mtimeIso(path.join(QQ_STATE_DIR, 'bridge.log')),
      note: 'QQ 桥接的启停 / 自愈 / 白名单由 surfcore-qq 负责；本包只读展示。',
    };
  }

  function biliStateSummary() {
    return {
      source: 'file',
      available: fs.existsSync(BILI_CONFIG),
      hasCookie: fs.existsSync(BILI_CRED),
      configMtime: mtimeIso(BILI_CONFIG),
      credentialMtime: mtimeIso(BILI_CRED),
      note: 'B站 生物钟 / 调度 / 参数由 surfcore-bili 负责；本包只读展示。',
    };
  }

  function parseModeState() {
    const local = readJson(path.join(QQ_STATE_DIR, 'mode.json'), {}) ?? {};
    return { localMode: local.mode ?? null, localRole: local.role ?? null };
  }

  // ── 平台启动开关（2026-10-24 用户要求：不是所有用户都想同时开 QQ / B站）──
  // 唯一真相在统一 config.json 的 platforms.start.{qq,bili}。本包写这个键，
  // 「真的去启动/停止」由 surfcore-qq / surfcore-bili 读它执行。
  function platformStartState() {
    const start = readUnified().config.platforms?.start ?? {};
    return { qq: start.qq !== false, bili: start.bili !== false };
  }

  function trustedProxyHosts() {
    try {
      const list = readQqConfig()?.config?.httpGuard?.trustedProxyHosts;
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function currentDshUrl() {
    try {
      const ws = ctx.get('webServer');
      if (ws?.port) return `${ws.protocol || 'http:'}//127.0.0.1:${ws.port}`;
    } catch {}
    return String(process.env.DSH_WEB_URL ?? '').trim();
  }

  // ── 路由：四层准入（与旧插件 lib/index.js:661-689 语义一致）────────────
  //   ① 回环 Host（含可信反代白名单）
  //   ② 写操作同源
  //   ③ 写操作 application/json
  //   ④ DSH 的 connection.requestRejection
  const disposersForRoutes = [];
  function route(kind, pathname, handler) {
    disposersForRoutes.push(ctx.webServer.register({
      kind,
      path: pathname,
      handler: async (req, res) => {
        if (!isLoopbackReq(req, trustedProxyHosts())) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return; }
        if (req.method !== 'GET' && !sameOrigin(req)) { json(res, 403, { ok: false, error: '跨站请求被拒绝' }); return; }
        if (req.method !== 'GET' && !String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
          json(res, 415, { ok: false, error: '写操作必须是 application/json' });
          return;
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
          log('API 失败：', error?.message ?? error);
          try { json(res, 500, { ok: false, error: String(error?.message ?? error) }); } catch {}
        }
      },
    }));
  }

  /** 读 JSON 请求体；不合法时返回 null（调用方回 400）。 */
  async function readJsonBody(req) {
    try {
      const text = await readBody(req);
      if (!text) return {};
      const parsed = JSON.parse(text);
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return null;
    }
  }

  function badRequest(res, error, extra = {}) {
    json(res, 400, { ok: false, error, ...extra });
  }

  function saveStamps() {
    return {
      qq: fileStamp(QQ_CONFIG),
      bili: fileStamp(BILI_CONFIG),
      unified: fileStamp(UNIFIED_FILE),
    };
  }

  // ── 管理员身份：唯一写者（两份旧格式文件各自加锁）───────────────────────
  // 2026-10-29 用户反馈：只投影 ownerQQ 时桥接读不到称呼。所以 QQ 侧连 admin 对象
  // 一起投影（displayName / biliName / gentle 都在里面）。
  function surfcoreRootUsable() {
    return fs.existsSync(QQ_CONFIG) || fs.existsSync(path.join(QQBOT_ROOT, 'src', 'bridge.js'));
  }

  function saveAdminEverywhere(adminInput) {
    const admin = normalizeAdmin(adminInput);
    const warnings = [];
    updateJsonFile(UNIFIED_FILE, (current) => {
      const next = isPlainObject(current) ? current : {};
      next.version = 1;
      next.admin = admin;
      return next;
    }, { backupLabel: 'admin' });

    let qqWrote = false;
    if (surfcoreRootUsable()) {
      updateJsonFile(QQ_CONFIG, (current) => {
        const next = isPlainObject(current) ? current : {};
        next.ownerQQ = admin.qq || null;
        next.admin = { ...admin };
        return next;
      }, { backupLabel: 'admin-qq-projection' });
      qqWrote = true;
    } else {
      warnings.push(`没找到 surfcore 仓库根（${maskPath(QQBOT_ROOT)}）：QQ config.json 的 ownerQQ 暂时没法投影。`);
    }

    let biliWrote = false;
    try {
      updateJsonFile(BILI_CONFIG, (current) => {
        const next = isPlainObject(current) ? current : {};
        const owner = isPlainObject(next.owner) ? next.owner : {};
        next.owner = { ...owner, mid: admin.biliMid, name: admin.biliName };
        return next;
      }, { backupLabel: 'admin-bili-projection' });
      biliWrote = true;
    } catch (error) {
      warnings.push(`B站 配置投影失败：${String(error?.message ?? error).slice(0, 160)}`);
    }

    log(`管理员身份已保存并投影（qq=${admin.qq ? '已设置' : '空'}，bili=${admin.biliMid ? '已设置' : '空'}）`);
    return { admin, warnings, wrote: { unified: true, qq: qqWrote, bili: biliWrote } };
  }

  /** 启动时补一次投影（有变化才写）：旧版数据里 displayName/gentle 可能只在 unified。 */
  function ensureAdminProjection() {
    try {
      const qqState = readQqConfig();
      const unifiedState = readUnified();
      const biliState = readBiliConfig();
      const unifiedAdmin = unifiedState.hasAdmin ? unifiedState.config?.admin : undefined;
      const sourceAdmin = unifiedAdmin ?? qqState.config?.admin;
      const current = adminFromSources({
        unified: { admin: sourceAdmin },
        qq: qqState.config,
        bili: biliState.config,
      });
      if (!current.qq && !current.biliMid) return;
      const next = normalizeAdmin(current);
      const prev = normalizeAdmin(qqState.config?.admin);
      if (JSON.stringify(prev) === JSON.stringify(next)) return;
      // 启动补投影只修「QQ 侧缺失的称呼字段」；unified 里已经有 admin 的不动（避免无意义备份）。
      if (unifiedState.hasAdmin) {
        if (!surfcoreRootUsable()) return;
        updateJsonFile(QQ_CONFIG, (cfg) => {
          const live = isPlainObject(cfg) ? cfg : {};
          live.ownerQQ = next.qq || null;
          live.admin = { ...next };
          return live;
        }, { backupLabel: 'admin-qq-projection' });
      } else {
        saveAdminEverywhere(next);
      }
      log('管理员称呼已补齐到 QQ config.json（桥接重启后生效）');
    } catch (error) {
      log('管理员称呼投影失败（继续使用现有配置）：', error?.message ?? error);
    }
  }

  // ── 概览 ────────────────────────────────────────────────────────────────
  // 保留：系统/配置/平台/扩展/更新/备份。QQ/B站 运行状态改为只读（各自的栏目负责展示），
  // 「一键启动 / 启动 QQ / 启动 B站」整块删除（由 qq / bili 包提供）。
  function dshProfileWithSurfcore() {
    const root = path.join(DSH_HOME, 'profiles');
    let names = [];
    try { names = fs.readdirSync(root).filter((n) => { try { return fs.statSync(path.join(root, n)).isDirectory(); } catch { return false; } }); } catch { return ''; }
    for (const item of names) {
      // 两种都能作为"已装进 DSH"的证据：
      //   ① profile package.json 的 dsh.profile.bundles 里有 surfcore 系 bundle（旧包 surfcore / 新包 surfcore-core …）；
      //   ② cordis.patch.yml 里有我们托管的条目（不同版本写的是不同 id）。
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, item, 'package.json'), 'utf8'));
        const bundles = pkg?.dsh?.profile?.bundles;
        if (Array.isArray(bundles) && bundles.some((bundle) => /^surfcore(-|$)/.test(String(bundle)))) return item;
      } catch {}
      try {
        const patch = fs.readFileSync(path.join(root, item, 'cordis.patch.yml'), 'utf8');
        if (/surfcore|mcp-snowluma/.test(patch)) return item;
      } catch {}
    }
    return '';
  }

  // SnowLuma 没有原生窗口，它的界面是 WebUI（默认 http://127.0.0.1:5100）。
  // 端口从 SnowLuma 自己的 runtime.json 读，读不到就回退 5100。
  function snowLumaWebui() {
    const cfg = readQqConfig().config?.snowluma ?? {};
    let port = 5100;
    try {
      const root = String(cfg.launcherPath ?? '').trim();
      if (root) {
        const runtime = JSON.parse(fs.readFileSync(path.join(root, 'app', 'config', 'runtime.json'), 'utf8'));
        if (Number(runtime?.webuiPort) > 0) port = Number(runtime.webuiPort);
      }
    } catch {}
    return { port, url: `http://127.0.0.1:${port}` };
  }

  // SnowLuma 连不上时到底卡在哪一步：进程没起 / 停在登录页 / token 或端口不对。
  // 桥接的 goodError 只有一句 fetch failed，光看它没法给用户任何可执行的信息。
  async function diagnoseSnowLuma(bridgeSnow = {}) {
    if (bridgeSnow.connected === true) return { state: 'ok', hint: '' };
    const webui = snowLumaWebui();
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
    return { state: 'not-running', hint: 'SnowLuma 没在运行：到「SurfCore · QQ」栏目的概览里一键启动（会按需打开控制台）' };
  }

  // SnowLuma 安装位置识别：规则在 snowluma-install.js（「检测」与「浏览…」共用同一套，
  // 避免两边各猜各的）。这里只负责把当前 QQ 配置喂进去。
  function findSnowLumaInstall(extraPaths = []) {
    const snow = readQqConfig().config?.snowluma ?? {};
    return findSnowLumaInstallIn({ snowluma: snow, extraPaths });
  }

  async function overview() {
    const all = readAll();
    const unifiedState = readUnified();
    const qqCfg = readQqConfig().config ?? {};
    const mode = parseModeState();
    let dshMode = null;
    try {
      const settings = ctx.get('settings');
      if (settings?.describe) {
        const rows = settings.describe({ redactSecrets: true });
        const row = rows.find((item) => item.ns === 'qq-mode');
        dshMode = row?.value?.mode ?? null;
      }
    } catch {}
    let snowDiag = { state: 'unknown', hint: '' };
    try { snowDiag = await diagnoseSnowLuma({}); } catch {}
    const snow = qqCfg.snowluma ?? {};
    const backUps = listBackups(50);
    return {
      ok: true,
      plugin: name,
      version: VERSION,
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
      apiPrefix: API_PREFIX,
      admin: adminSummary(all.unified?.admin),
      platforms: platforms.list(),
      platformStart: platformStartState(),
      extensions: extensionHost.describe(),
      updates: updates.status(),
      qq: qqStateSummary(),
      bili: biliStateSummary(),
      scheduler: { running: null, ownedBy: 'surfcore-bili', note: 'B站 生物钟由 surfcore-bili 负责' },
      snowluma: {
        launcherPath: String(snow.launcherPath ?? ''),
        allowLaunch: snow.allowLaunch === true,
        downloadUrl: String(snow.downloadUrl ?? 'https://github.com/SnowLuma/SnowLuma/releases/latest'),
        detected: findSnowLumaInstall().ok,
        diagnosis: snowDiag,
      },
      mode: {
        local: mode.localMode,
        dsh: dshMode,
        effective: dshMode || mode.localMode,
        role: mode.localRole,
      },
      files: {
        pluginLog: fileInfo(PLUGIN_LOG),
        unified: fileInfo(UNIFIED_FILE),
        qqConfig: fileInfo(QQ_CONFIG),
        biliConfig: fileInfo(BILI_CONFIG),
        extensionsState: fileInfo(EXT_STATE_FILE),
        extensionsDir: fileInfo(EXTENSIONS_DIR),
      },
      backups: {
        dir: maskPath(BACKUP_DIR),
        count: backUps.length,
        latest: backUps[0] ? { name: backUps[0].name, bytes: backUps[0].bytes, mtime: backUps[0].mtime } : null,
      },
      paths: {
        ...maskedPathSummary(),
        stateDir: maskPath(STATE_DIR),
        memoryDir: maskPath(MEMORY_DIR),
        backupDir: maskPath(BACKUP_DIR),
        extensionsDir: maskPath(EXTENSIONS_DIR),
        packageRoot: maskPath(PACKAGE_ROOT),
        surfcoreRoot: maskPath(QQBOT_ROOT || SURFCORE_ROOT),
      },
      env: {
        node: process.versions.node,
        platform: process.platform,
        dshHome: maskPath(DSH_HOME),
        dshUrl: currentDshUrl() ? maskPath(currentDshUrl()) : '',
      },
      // 拆分包相关：方便诊断时确认「装的是哪几块」（只读目录探测，不读它们的配置）。
      splitPackages: {
        standalone: true,
        managedBy: 'DSH bundle 安装 / 升级（不在本包更新器里）',
        sections: ['surfcore-core', 'surfcore-qq', 'surfcore-bili', 'surfcore-memory', 'surfcore-character', 'surfcore-token', 'surfcore-pet', 'surfcore-voice'],
      },
    };
  }

  function maskedPathSummary() {
    const summary = pathSummary();
    const out = {};
    for (const [key, value] of Object.entries(summary)) {
      out[key] = typeof value === 'string' ? maskPath(value) : value;
    }
    return out;
  }

  // ── 统一配置读写（handleConfig）─────────────────────────────────────────
  // GET：三份配置都脱敏返回（qq/bili 只读展示，供「全部参数」页看完整树）。
  // POST：**只写本包负责的键**（admin/extensions/platforms/updates/ui/qqbotRoot）；
  //       其它键（bridge / persona / memory / alignment / memoryCard）与 qq/bili 配置
  //       原样保留，不在本包里回写。写前带时间戳乐观并发检查（2026-10-29 事故：
  //       整份回写会把控制台刚改的语音开关覆盖回 false）。
  async function handleConfig(req, res) {
    if (req.method === 'GET') {
      json(res, 200, {
        ok: true,
        ...readAll(),
        paths: maskedPathSummary(),
        backups: listBackups(20),
        stamps: saveStamps(),
        ownership: {
          ownedUnifiedKeys: OWNED_UNIFIED_KEYS,
          readOnly: {
            qq: 'QQ 配置由 surfcore-qq 负责；本包只读展示（管理员投影例外）',
            bili: 'B站 配置由 surfcore-bili 负责；本包只读展示（管理员投影例外）',
            unifiedOtherKeys: 'bridge / persona / memory / alignment / memoryCard 由对应拆分包负责',
          },
          adminProjection: { qq: maskPath(QQ_CONFIG), bili: maskPath(BILI_CONFIG) },
        },
      });
      return;
    }

    const body = await readJsonBody(req);
    if (!body) { badRequest(res, '请求体不是合法 JSON'); return; }

    // 乐观并发：设置页加载后配置被控制台/别的窗口改过 → 拒绝整份回写。
    const baseStamp = isPlainObject(body.baseStamp) ? body.baseStamp : null;
    const currentStamps = saveStamps();
    if (baseStamp) {
      const stale = ['qq', 'bili', 'unified'].filter((key) => isStale(baseStamp[key], currentStamps[key]));
      if (stale.length) {
        json(res, 409, {
          ok: false,
          code: 'CONFIG_STALE',
          error: `配置已被别处修改（${stale.join(' / ')}），本次保存未执行`,
          hint: '点「重新读取」拿到最新配置后再改；直接覆盖会丢掉别人的修改',
          stamps: currentStamps,
        });
        return;
      }
    }

    const result = { ok: true, saved: {}, warnings: [], ignored: [], stamps: currentStamps };
    if (body.qq || body.bili) {
      result.warnings.push('QQ / B站 配置由 surfcore-qq / surfcore-bili 负责写入：本包不整份回写（只读展示 + 管理员投影例外）。');
    }

    const unifiedState = readUnified();
    const currentUnifiedRaw = readJson(UNIFIED_FILE, {}) ?? {};
    const incoming = isPlainObject(body.unified) ? body.unified : {};

    // 保存时 `********` 保持原值（沿用旧 store.js 语义）。
    const restored = restoreMaskedSecrets(incoming, unifiedState.config);
    const ownedIncoming = {};
    for (const key of OWNED_UNIFIED_KEYS) {
      if (restored[key] !== undefined) ownedIncoming[key] = restored[key];
    }
    result.ignored = Object.keys(incoming).filter((key) => !OWNED_UNIFIED_KEYS.includes(key));

    // 管理员：合体层 admin 是唯一真相；这里合并（管理员卡片优先）后投影到两份旧格式。
    const currentUnifiedForAdmin = unifiedState.hasAdmin
      ? unifiedState.config
      : { ...unifiedState.config, admin: undefined };
    const currentAdmin = adminFromSources({
      unified: currentUnifiedForAdmin,
      qq: readQqConfig().config,
      bili: readBiliConfig().config,
    });
    const planned = projectAdminSave({ current: currentAdmin, unified: { admin: ownedIncoming.admin } });
    if (planned.conflict) {
      result.warnings.push('管理员卡片与高级参数同时改了 ownerQQ / owner.mid：已按管理员卡片对齐。');
    }
    const adminTouched = ownedIncoming.admin !== undefined;

    // 平台启动开关归一：只收布尔，缺省 true；旧字段 bridge.autoStart 同步镜像一次
    // （让降级回旧版 / 手工读配置的人看到同一份选择）。
    if (ownedIncoming.platforms !== undefined) {
      const source = isPlainObject(ownedIncoming.platforms) ? ownedIncoming.platforms : {};
      const start = isPlainObject(source.start) ? source.start : {};
      ownedIncoming.platforms = { ...source, start: { qq: start.qq !== false, bili: start.bili !== false } };
    }

    if (Object.keys(ownedIncoming).length) {
      updateJsonFile(UNIFIED_FILE, (current) => {
        // 锁内整轮读-改-写：只改本包负责的键，其它键（可能刚被别的插件写过）原样保留。
        const next = isPlainObject(current) ? current : clone(currentUnifiedRaw);
        next.version = 1;
        for (const key of ['extensions', 'platforms', 'updates', 'ui']) {
          if (ownedIncoming[key] === undefined) continue;
          const base = isPlainObject(next[key]) ? next[key] : {};
          next[key] = deepMerge(base, ownedIncoming[key]);
        }
        if (ownedIncoming.qqbotRoot !== undefined) next.qqbotRoot = String(ownedIncoming.qqbotRoot ?? '');
        if (ownedIncoming.platforms !== undefined) {
          const mirror = isPlainObject(next.platforms.start) ? next.platforms.start : {};
          next.bridge = isPlainObject(next.bridge) ? next.bridge : {};
          next.bridge.autoStart = mirror.qq !== false;
        }
        if (adminTouched || planned.changed) next.admin = planned.admin;
        return next;
      }, { backupLabel: 'unified-config' });
      result.saved.unified = true;
      result.unified = readAll().unified;
    } else if (adminTouched) {
      // 只有 admin 变化也走同一条锁内写路径。
      updateJsonFile(UNIFIED_FILE, (current) => {
        const next = isPlainObject(current) ? current : {};
        next.version = 1;
        next.admin = planned.admin;
        return next;
      }, { backupLabel: 'admin' });
      result.saved.unified = true;
      result.unified = readAll().unified;
    }

    // 管理员投影（两个文件各自加锁，不一个锁写两个文件）。
    if (adminTouched || planned.changed) {
      const projected = saveAdminEverywhere(planned.admin);
      result.saved.admin = true;
      result.admin = adminSummary(projected.admin);
      result.warnings.push(...projected.warnings);
    }

    result.platformStart = platformStartState();
    if (result.saved.platforms || ownedIncoming.platforms !== undefined) {
      result.warnings.push('平台启动开关已保存；实际启动 / 停止由 surfcore-qq / surfcore-bili 读取该开关执行。');
    }
    if (result.ignored.length) {
      result.warnings.push(`已忽略不属于本包的键：${result.ignored.join('、')}（由对应拆分包负责）`);
    }
    result.stamps = saveStamps();
    json(res, 200, result);
  }

  /** POST /admin —— 管理员身份保存（唯一编辑入口）并投影到两份旧格式配置。 */
  async function handleAdmin(req, res) {
    if (req.method === 'GET') {
      const all = readAll();
      json(res, 200, { ok: true, admin: adminSummary(all.unified?.admin) });
      return;
    }
    const body = await readJsonBody(req);
    if (!body) { badRequest(res, '请求体不是合法 JSON'); return; }
    const source = isPlainObject(body.admin) ? body.admin : body;
    const saved = saveAdminEverywhere(source);
    json(res, 200, {
      ok: true,
      admin: adminSummary(saved.admin),
      wrote: saved.wrote,
      warnings: saved.warnings,
      stamps: saveStamps(),
    });
  }

  // ── 扩展 ────────────────────────────────────────────────────────────────
  async function handleExtensions(req, res) {
    if (req.method === 'GET') {
      json(res, 200, {
        ok: true,
        extensions: extensionHost.describe(),
        platforms: platforms.list(),
        dir: maskPath(EXTENSIONS_DIR),
        note: '扩展默认关闭；开启等于允许它在本机执行代码，只打开你信得过的。',
      });
      return;
    }
    const body = await readJsonBody(req);
    if (!body) { badRequest(res, '请求体不是合法 JSON'); return; }
    const action = String(body.action ?? '');
    const id = String(body.id ?? '');
    try {
      if (action === 'toggle') {
        const result = await extensionHost.setEnabled(id, body.enabled === true);
        json(res, 200, { ok: true, result, extensions: extensionHost.describe() });
        return;
      }
      if (action === 'config') {
        const config = extensionHost.setConfig(id, isPlainObject(body.config) ? body.config : {});
        json(res, 200, { ok: true, config, extensions: extensionHost.describe() });
        return;
      }
      if (action === 'reload') {
        await extensionHost.deactivate(id);
        const result = await extensionHost.activate(id);
        json(res, 200, { ok: true, result, extensions: extensionHost.describe() });
        return;
      }
      badRequest(res, `未知 action：${action || '（空）'}`);
    } catch (error) {
      badRequest(res, String(error?.message ?? error));
    }
  }

  // ── 平台注册表 / 启动开关 ───────────────────────────────────────────────
  async function handlePlatforms(req, res) {
    if (req.method === 'GET') {
      json(res, 200, {
        ok: true,
        platforms: await platforms.statusAll(),
        capabilities: [...PLATFORM_CAPABILITIES],
        starts: platformStartState(),
      });
      return;
    }
    const body = await readJsonBody(req);
    if (!body) { badRequest(res, '请求体不是合法 JSON'); return; }
    const action = String(body.action ?? '');

    if (action === 'start') {
      const id = String(body.id ?? '');
      if (!['qq', 'bili'].includes(id)) { badRequest(res, 'id 必须是 qq 或 bili'); return; }
      const enabled = body.enabled !== false;
      updateJsonFile(UNIFIED_FILE, (current) => {
        const next = isPlainObject(current) ? current : {};
        next.version = 1;
        next.platforms = isPlainObject(next.platforms) ? next.platforms : {};
        const start = isPlainObject(next.platforms.start) ? next.platforms.start : {};
        next.platforms.start = { ...start, [id]: enabled };
        if (id === 'qq') {
          next.bridge = isPlainObject(next.bridge) ? next.bridge : {};
          next.bridge.autoStart = enabled;
        }
        return next;
      }, { backupLabel: 'platforms-start' });
      json(res, 200, {
        ok: true,
        starts: platformStartState(),
        note: '本包只写启动开关；真正的启停由对应拆分包（surfcore-qq / surfcore-bili）执行。',
      });
      return;
    }

    if (action === 'register') {
      const adapter = isPlainObject(body.adapter) ? body.adapter : body.platform;
      try {
        const dispose = platforms.register(adapter, 'core-api');
        registeredPlatforms.set(String(adapter?.id ?? ''), dispose);
        json(res, 200, { ok: true, platforms: platforms.list() });
      } catch (error) {
        badRequest(res, String(error?.message ?? error));
      }
      return;
    }
    if (action === 'unregister') {
      const id = String(body.id ?? '');
      const dispose = registeredPlatforms.get(id);
      if (!dispose) { badRequest(res, `没有通过本接口登记的平台：${id}`); return; }
      dispose();
      registeredPlatforms.delete(id);
      json(res, 200, { ok: true, platforms: platforms.list() });
      return;
    }
    badRequest(res, `未知 action：${action || '（空）'}`);
  }

  // ── 组件更新 ────────────────────────────────────────────────────────────
  async function handleUpdates(req, res) {
    if (req.method === 'GET') { json(res, 200, updates.status()); return; }
    const body = await readJsonBody(req);
    if (!body) { badRequest(res, '请求体不是合法 JSON'); return; }
    const action = String(body.action ?? '');
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    if (action === 'check') { json(res, 200, await updates.check({ fetch: body.fetch !== false })); return; }
    if (action === 'apply') { json(res, 200, await updates.apply(ids)); return; }
    if (action === 'set-token' || action === 'clear-token') {
      try {
        updateJsonFile(UNIFIED_FILE, (current) => {
          const next = isPlainObject(current) ? current : {};
          next.version = 1;
          next.updates = isPlainObject(next.updates) ? next.updates : {};
          if (action === 'clear-token') delete next.updates.githubToken;
          else next.updates.githubToken = String(body.token ?? '').trim();
          return next;
        }, { backupLabel: 'updates-token' });
        const configured = action === 'set-token' && Boolean(String(body.token ?? '').trim());
        json(res, 200, { ok: true, configured });
      } catch (error) {
        json(res, 500, {
          ok: false,
          code: 'token.save-failed',
          error: `保存 token 失败：${String(error?.message ?? error).slice(0, 160)}`,
          hint: '检查 config.json 是否可写；也可以稍后重试',
        });
      }
      return;
    }
    if (action === 'rollback') {
      const target = String(body.id ?? ids[0] ?? '').trim();
      json(res, 200, await updates.rollback(target));
      return;
    }
    if (action === 'dismiss') { json(res, 200, updates.dismiss(ids)); return; }
    if (action === 'reset') { json(res, 200, updates.resetDismissed()); return; }
    badRequest(res, `未知 action：${action || '（空）'}`);
  }

  // ── 新手体检（只读）＋ 一键配置 ─────────────────────────────────────────
  // 目标：新人装完点一下就知道"还差什么、在哪补"，不用去翻文档。
  async function installChecks() {
    const all = readAll();
    const qqCfg = readQqConfig().config ?? {};
    const snow = qqCfg.snowluma ?? {};
    let snowState = { state: 'unknown', hint: '' };
    try { snowState = await diagnoseSnowLuma(snow); } catch {}
    const bridgeSrc = path.join(QQBOT_ROOT, 'src', 'bridge.js');
    return buildInstallChecks({
      nodeVersion: process.versions.node,
      hasUnified: readUnified().hasUserFile,
      unifiedMasked: maskPath(UNIFIED_FILE),
      ownerQQ: String(all.unified?.admin?.qq ?? '').trim(),
      groups: Array.isArray(qqCfg.allow?.groups) ? qqCfg.allow.groups : [],
      privates: Array.isArray(qqCfg.allow?.private) ? qqCfg.allow.private : [],
      snow,
      snowState,
      bridgeSrc: fs.existsSync(bridgeSrc),
      bridgeMasked: maskPath(bridgeSrc),
      profile: dshProfileWithSurfcore(),
      token: String(qqCfg.consoleToken ?? '').trim(),
    });
  }

  /** 一键配置：只补"缺失项"，绝不覆盖已有值。控制台令牌归 surfcore-qq，这里只提示。 */
  function doctorFix(body) {
    const all = readAll();
    const qqCfg = readQqConfig().config ?? {};
    const actions = planDoctorFix({
      hasUnified: readUnified().hasUserFile,
      hasToken: Boolean(String(qqCfg.consoleToken ?? '').trim()),
      ownerQQ: body?.ownerQQ,
      currentOwnerQQ: all.unified?.admin?.qq,
    });
    const changed = [];
    const warnings = [];
    for (const action of actions) {
      if (action.startsWith('生成统一配置')) {
        updateJsonFile(UNIFIED_FILE, (current) => {
          const next = isPlainObject(current) ? current : {};
          next.version = 1;
          return next;
        }, { backupLabel: 'unified-init' });
        changed.push(action);
      } else if (action.startsWith('写入管理员 QQ')) {
        const current = adminFromSources({
          unified: readUnified().hasAdmin ? readUnified().config : { ...readUnified().config, admin: undefined },
          qq: readQqConfig().config,
          bili: readBiliConfig().config,
        });
        saveAdminEverywhere({ ...current, qq: String(body.ownerQQ).trim() });
        changed.push(action);
      } else if (action.startsWith('生成控制台令牌')) {
        warnings.push('控制台令牌由 surfcore-qq 包生成（本包不写 QQ 配置，管理员投影除外）。');
      }
    }
    return { changed, warnings };
  }

  // ── 备份 / 恢复 ─────────────────────────────────────────────────────────
  const BACKUP_TARGETS = [
    ['unified-config', UNIFIED_FILE],
    ['qq-config', QQ_CONFIG],
    ['bili-config', BILI_CONFIG],
    ['extensions', EXT_STATE_FILE],
  ];

  function backupAll() {
    const created = [];
    for (const [label, file] of BACKUP_TARGETS) {
      const out = backupFile(file, label);
      if (out) created.push({ label, file: maskPath(out) });
    }
    return created;
  }

  /**
   * 备份名 → 目标文件。两代命名都要认：
   *   · config-lock.js（本包/新拆分包）：`config.json.<label>.<stamp>`、`extensions.json.<stamp>`
   *   · store.js（旧单体）：`<label>-<stamp>.json`
   */
  function restoreTargetOf(backupName) {
    const fileName = String(backupName ?? '');
    if (/^qq-config-\d{4}-/.test(fileName)) return { file: QQ_CONFIG, label: 'qq-config' };
    if (/^bili-config-\d{4}-/.test(fileName)) return { file: BILI_CONFIG, label: 'bili-config' };
    if (/^unified-config-\d{4}-/.test(fileName)) return { file: UNIFIED_FILE, label: 'unified-config' };
    if (/^extensions-\d{4}-/.test(fileName)) return { file: EXT_STATE_FILE, label: 'extensions' };
    if (/^config\.json\.[a-z0-9-]+\.\d{4}-\d{2}-\d{2}T/.test(fileName)) {
      const label = /^config\.json\.([a-z0-9-]+)\./.exec(fileName)?.[1] ?? '';
      if (/bili/.test(label)) return { file: BILI_CONFIG, label };
      if (/qq/.test(label)) return { file: QQ_CONFIG, label };
      return { file: UNIFIED_FILE, label: label || 'unified-config' };
    }
    if (/^extensions\.json\./.test(fileName)) return { file: EXT_STATE_FILE, label: 'extensions' };
    if (/^bili\.config\.json\./.test(fileName)) return { file: BILI_CONFIG, label: 'bili-config' };
    return null;
  }

  /** 恢复：先给当前文件留一份备份，再锁内整份写回（保持"写前备份 + 原子写"协议）。 */
  function restoreBackup(backupName) {
    const safe = safeBackupName(backupName);
    if (!safe) return { status: 400, body: { ok: false, error: '备份名非法' } };
    const source = path.join(BACKUP_DIR, safe);
    if (!fs.existsSync(source)) return { status: 404, body: { ok: false, error: '备份不存在' } };
    const target = restoreTargetOf(safe);
    if (!target) {
      return { status: 400, body: { ok: false, error: '这个备份不支持一键恢复（请手动复制）', hint: '只支持统一配置 / QQ 配置 / B站 配置 / 扩展状态的 JSON 备份' } };
    }
    const content = readJson(source, null);
    if (content === null || !isPlainObject(content)) {
      return { status: 400, body: { ok: false, error: '备份不是合法 JSON 对象' } };
    }
    const backup = withConfigLock(() => {
      const created = backupFile(target.file, 'before-restore');
      writeJsonAtomic(target.file, content);
      return created;
    }, { label: path.basename(target.file) });
    log(`已从备份恢复：${safe} → ${maskPath(target.file)}`);
    return { status: 200, body: { ok: true, restored: safe, target: maskPath(target.file), previousBackup: backup ? maskPath(backup) : '' } };
  }

  async function handleBackups(req, res) {
    if (req.method === 'GET') {
      json(res, 200, {
        ok: true,
        dir: maskPath(BACKUP_DIR),
        backups: listBackups(50).map((item) => ({ ...item, target: restoreTargetOf(item.name) ? 'restorable' : 'manual' })),
      });
      return;
    }
    const body = await readJsonBody(req);
    if (!body) { badRequest(res, '请求体不是合法 JSON'); return; }
    const result = restoreBackup(body.name);
    json(res, result.status, result.body);
  }

  // ── 诊断 ────────────────────────────────────────────────────────────────
  async function handleDiagnostics(req, res) {
    if (req.method === 'GET') {
      const checks = [];
      const add = (checkName, ok, detail = '', extra = {}) => checks.push({ name: checkName, level: ok ? 'ok' : 'fail', ok: Boolean(ok), detail, fix: '', ...extra });
      add('插件目录', fs.existsSync(PACKAGE_ROOT), maskPath(PACKAGE_ROOT));
      add('surfcore 根目录', fs.existsSync(QQ_CONFIG), maskPath(QQ_CONFIG));
      add('QQ 桥接源码', fs.existsSync(path.join(QQBOT_ROOT, 'src', 'bridge.js')), 'src/bridge.js');
      add('统一配置', fs.existsSync(UNIFIED_FILE), maskPath(UNIFIED_FILE));
      add('备份目录', fs.existsSync(BACKUP_DIR), maskPath(BACKUP_DIR));
      add('扩展目录', fs.existsSync(EXTENSIONS_DIR), maskPath(EXTENSIONS_DIR));
      add('B站配置', fs.existsSync(BILI_CONFIG), maskPath(BILI_CONFIG));
      add('B站 cookie', fs.existsSync(BILI_CRED), fs.existsSync(BILI_CRED) ? '已写入（不回显内容）' : '未写入');
      add('B站工具链', fs.existsSync(BILI_MJS), `${maskPath(BILI_MJS)}（由 surfcore-bili 包携带，本包只探测）`, { level: fs.existsSync(BILI_MJS) ? 'ok' : 'warn' });
      add('身份对齐表', fs.existsSync(ALIGN_FILE), maskPath(ALIGN_FILE), { level: fs.existsSync(ALIGN_FILE) ? 'ok' : 'warn' });
      add('B站→QQ 对齐简报', fs.existsSync(BILI_ALIGNMENT_FILE), maskPath(BILI_ALIGNMENT_FILE), { level: fs.existsSync(BILI_ALIGNMENT_FILE) ? 'ok' : 'warn' });
      add('隐私策略', PRIVACY_POLICY_VERSION >= 3, `v${PRIVACY_POLICY_VERSION}（私信/密钥/PII 一律不跨平台）`);

      let install = [];
      try { install = await installChecks(); } catch (error) { log('体检失败：', String(error?.message ?? error)); }
      // 同名检查只留一条（installChecks 与上面的 checks 有重叠，比如"QQ 桥接源码"）。
      const seen = new Set();
      const allChecks = [...install, ...checks].filter((item) => (seen.has(item.name) ? false : (seen.add(item.name), true)));
      const ok = allChecks.every((item) => item.level ? item.level !== 'fail' : item.ok);
      json(res, 200, {
        ok,
        checks: allChecks,
        installOk: installOk(install),
        backups: listBackups(20),
        paths: maskedPathSummary(),
        privacyPolicyVersion: PRIVACY_POLICY_VERSION,
        note: 'QQ/B站 的运行状态与业务体检由各自栏目负责；这里是本包（配置/扩展/更新/备份）的体检。',
      });
      return;
    }

    const body = await readJsonBody(req);
    if (!body) { badRequest(res, '请求体不是合法 JSON'); return; }
    const action = String(body.action ?? '');
    if (action === 'doctor-fix') {
      const result = doctorFix(body);
      json(res, 200, { ok: true, changed: result.changed, warnings: result.warnings, restartRequired: result.changed.length > 0 });
      return;
    }
    if (action === 'backup') {
      json(res, 200, { ok: true, created: backupAll() });
      return;
    }
    if (action === 'restore') {
      const result = restoreBackup(body.name);
      json(res, result.status, result.body);
      return;
    }
    badRequest(res, `未知 action：${action || '（空）'}`);
  }

  // ── 日志 ────────────────────────────────────────────────────────────────
  // 插件日志（本包也 append 到这里）+ 桥接日志尾部（只读；桥接归 surfcore-qq）。
  function handleLogs(res, url) {
    const lines = Math.max(10, Math.min(500, Number(url.searchParams.get('lines')) || 120));
    const plugin = readTextTail(PLUGIN_LOG).split('\n').slice(-lines).join('\n');
    const bridgeFile = path.join(QQ_STATE_DIR, 'bridge.log');
    const bridge = readTextTail(bridgeFile).split('\n').slice(-lines).join('\n');
    json(res, 200, {
      ok: true,
      plugin,
      bridge,
      paths: { pluginLog: maskPath(PLUGIN_LOG), bridgeLog: maskPath(bridgeFile) },
    });
  }

  // ── 原生「浏览目录 / 选择文件」──────────────────────────────────────────
  // 浏览器拿不到绝对路径，只能由宿主进程弹 Windows 对话框。
  // 仅 Windows 且 DSH 跑在本机时有意义；其它情况返回可读错误，前端提示手动填。
  //
  // 路径不能走 PowerShell stdout：Windows PowerShell 5.1 重定向时用 OEM/GBK 编码，
  // Node 按 UTF-8 解码，中文目录会变成 `�`，后端 fsp.stat 直接 ENOENT（2026-10-29 反馈）。
  // 改成：PowerShell 把选中路径写进临时 UTF-8 文件，Node 读文件后删除；彻底绕开控制台编码。
  async function handleBrowse(req, res, url) {
    const mode = url.searchParams.get('mode') === 'file' ? 'file' : 'dir';
    const title = url.searchParams.get('title') || (mode === 'file' ? '选择文件' : '选择目录');
    if (process.platform !== 'win32') {
      json(res, 200, { ok: false, error: '只有 Windows 支持原生选择框，请手动填路径' });
      return;
    }
    const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;
    const outFile = path.join(os.tmpdir(), `surfcore-browse-${process.pid}-${randomUUID()}.txt`);
    const writeOut = (expr) => `[System.IO.File]::WriteAllText(${psQuote(outFile)}, ${expr}, (New-Object System.Text.UTF8Encoding -ArgumentList $false))`;
    const ps = mode === 'file'
      ? `Add-Type -AssemblyName System.Windows.Forms;
$d = New-Object System.Windows.Forms.OpenFileDialog;
$d.Title = ${psQuote(title)};
$d.Filter = '可执行文件 (*.exe)|*.exe|所有文件 (*.*)|*.*';
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { ${writeOut('$d.FileName')} }`
      : `Add-Type -AssemblyName System.Windows.Forms;
$d = New-Object System.Windows.Forms.FolderBrowserDialog;
$d.Description = ${psQuote(title)};
$d.ShowNewFolderButton = $true;
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { ${writeOut('$d.SelectedPath')} }`;
    const child = execFile('powershell.exe', ['-STA', '-NoProfile', '-Command', ps], { windowsHide: true, timeout: 180_000 }, (error) => {
      let picked = '';
      try { picked = String(fs.readFileSync(outFile, 'utf8')).replace(/^\uFEFF/, '').trim(); } catch {}
      try { fs.unlinkSync(outFile); } catch {}
      if (error && !picked) json(res, 200, { ok: false, error: `选择框打不开：${String(error.message || error).slice(0, 160)}` });
      else if (!picked) json(res, 200, { ok: false, cancelled: true, error: '已取消' });
      else json(res, 200, { ok: true, path: picked });
    });
    child.on('error', () => {
      try { fs.unlinkSync(outFile); } catch {}
      json(res, 200, { ok: false, error: '无法启动 PowerShell（可能不在本机桌面）' });
    });
  }

  // ── 组件清单（更新器用）────────────────────────────────────────────────
  function updateComponents() {
    const list = [];
    let updCfg = {};
    let qqCfg = {};
    try { updCfg = readUnified().config?.updates ?? {}; } catch {}
    try { qqCfg = readQqConfig().config ?? {}; } catch {}

    // 1) 旧单体 SurfCore 仓库（桥接源码树）：拆分后仍然要能更新它。
    try {
      if (fs.existsSync(path.join(QQBOT_ROOT, 'package.json'))) {
        list.push({ id: 'surfcore', name: 'SurfCore 本体（旧仓库）', dir: QQBOT_ROOT, kind: 'git', branch: 'main', versionRepo: 'Mieksido/surfcore' });
      }
    } catch {}

    // 2) 语音包（bridge 管理的安装目录；config.json 的 voicePacks.dir 可覆盖）
    //    是 git clone 就走 git；不是则看有没有配版本清单（updates.voice.*VersionUrl）
    try {
      const packsDir = String(qqCfg?.voicePacks?.dir || path.join(QQBOT_ROOT, 'state', 'voice-packs'));
      const voice = updCfg.voice ?? {};
      const packs = [
        { id: 'surfvoice-local', name: '语音包（本地）', sub: 'voice-local', versionRepo: 'Mieksido/surfvoicelocal', versionUrl: voice.localVersionUrl || '' },
        { id: 'surfvoice-cloud', name: '语音包（云端）', sub: 'voice-cloud', versionRepo: 'Mieksido/surfvoicecloud', versionUrl: voice.cloudVersionUrl || '' },
      ];
      for (const pack of packs) {
        const dir = path.join(packsDir, pack.sub);
        if (!fs.existsSync(dir)) continue;
        list.push({ id: pack.id, name: pack.name, dir, kind: 'auto', branch: 'main', versionUrl: pack.versionUrl, versionRepo: pack.versionRepo });
      }
    } catch {}

    // 3) 桌宠目录（构建产物，走版本清单 zip；安装/更新交给 surfcore-pet）
    try {
      const petCfg = readJson(path.join(STATE_DIR, 'pet', 'config.json'), {}) ?? {};
      const petDir = String(petCfg.appDir || '').trim() || path.join(STATE_DIR, 'pet', 'app');
      if (fs.existsSync(path.join(petDir, 'package.json'))) {
        list.push({
          id: 'surfpet',
          name: '桌宠',
          dir: petDir,
          kind: 'release',
          versionUrl: updCfg.pet?.versionUrl || '',
          versionFile: 'package.json',
        });
      }
    } catch {}

    // 4) 用户/未来扩展登记的组件：unified config 的 updates.components[]
    try {
      const custom = updCfg.components;
      if (Array.isArray(custom)) {
        for (const item of custom) {
          if (!item || typeof item !== 'object' || !item.id || !item.dir) continue;
          list.push({
            id: String(item.id).slice(0, 60),
            name: String(item.name ?? item.id).slice(0, 80),
            dir: String(item.dir),
            kind: ['git', 'release', 'auto'].includes(item.kind) ? item.kind : 'auto',
            branch: item.branch ? String(item.branch).slice(0, 60) : undefined,
            versionUrl: item.versionUrl ? String(item.versionUrl) : '',
          });
        }
      }
    } catch {}

    // 去重（同 id 只留第一个）
    const seen = new Set();
    return list.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
  }

  // ── 路由：API 前缀 ──────────────────────────────────────────────────────
  route('prefix', API_PREFIX, async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname;

    if (pathname === `${API_PREFIX}/status`) { json(res, 200, buildStatus()); return; }
    if (pathname === `${API_PREFIX}/overview`) { json(res, 200, await overview()); return; }
    if (pathname === `${API_PREFIX}/config`) { await handleConfig(req, res); return; }
    if (pathname === `${API_PREFIX}/admin`) { await handleAdmin(req, res); return; }
    if (pathname === `${API_PREFIX}/extensions`) { await handleExtensions(req, res); return; }
    if (pathname === `${API_PREFIX}/platforms`) { await handlePlatforms(req, res); return; }
    if (pathname === `${API_PREFIX}/updates`) { await handleUpdates(req, res); return; }
    if (pathname === `${API_PREFIX}/diagnostics`) { await handleDiagnostics(req, res); return; }
    if (pathname === `${API_PREFIX}/diagnostics/fix`) {
      if (req.method !== 'POST') { json(res, 405, { ok: false, error: '只支持 POST' }); return; }
      await handleDiagnostics(req, res);
      return;
    }
    if (pathname === `${API_PREFIX}/backups`) { await handleBackups(req, res); return; }
    if (pathname === `${API_PREFIX}/backups/restore`) {
      if (req.method !== 'POST') { json(res, 405, { ok: false, error: '只支持 POST' }); return; }
      await handleBackups(req, res);
      return;
    }
    if (pathname === `${API_PREFIX}/logs`) { handleLogs(res, url); return; }
    if (pathname === `${API_PREFIX}/browse`) { await handleBrowse(req, res, url); return; }
    json(res, 404, { ok: false, error: `未知接口：${pathname}` });
  });

  function buildStatus() {
    return {
      ok: true,
      plugin: name,
      version: VERSION,
      apiPrefix: API_PREFIX,
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
      paths: {
        stateDir: maskPath(STATE_DIR),
        memoryDir: maskPath(MEMORY_DIR),
        backupDir: maskPath(BACKUP_DIR),
        extensionsDir: maskPath(EXTENSIONS_DIR),
        packageRoot: maskPath(PACKAGE_ROOT),
        surfcoreRoot: maskPath(QQBOT_ROOT || SURFCORE_ROOT),
      },
      files: {
        unified: fs.existsSync(UNIFIED_FILE),
        qqConfig: fs.existsSync(QQ_CONFIG),
        biliConfig: fs.existsSync(BILI_CONFIG),
        extensionsState: fs.existsSync(EXT_STATE_FILE),
        pluginLog: fs.existsSync(PLUGIN_LOG),
      },
      admin: adminSummary(readAll().unified?.admin),
      platformStart: platformStartState(),
      platforms: platforms.list(),
      extensions: { total: extensionHost.describe().length, active: extensionHost.describe().filter((item) => item.active).length },
      updates: { components: updateComponents().map((item) => ({ id: item.id, name: item.name, kind: item.kind })), lastCheckAt: updates.status().lastCheckAt ?? null },
      ownership: {
        unifiedWriter: true,
        ownedUnifiedKeys: OWNED_UNIFIED_KEYS,
        adminProjection: ['qq.ownerQQ', 'bili.owner'],
      },
    };
  }

  // 扩展自定义路由：/dsh-surfcore-core/ext/<id>/<path>
  route('prefix', EXT_PREFIX, async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const rest = url.pathname.slice(EXT_PREFIX.length + 1);
    const [id, ...parts] = rest.split('/');
    if (!id) { json(res, 404, { ok: false, error: '缺少扩展 id' }); return; }
    const routePath = `/${parts.join('/')}`;
    const record = extensionHost.routeFor(id, req.method, routePath);
    if (!record) { json(res, 404, { ok: false, error: `扩展 ${id} 没有注册 ${req.method} ${routePath}` }); return; }
    await record.handler(req, res, { url, extensionId: id });
  });

  route('exact', '/dsh-surfcore-core/health', async (_req, res) => {
    json(res, 200, { ok: true, name, version: VERSION, privacyPolicyVersion: PRIVACY_POLICY_VERSION });
  });

  // ── 启动时的自动动作（不阻塞插件激活）──────────────────────────────────
  ensureAdminProjection();
  void (async () => {
    try {
      if (readUnified().config.extensions?.enabled === false) return;
      const results = await extensionHost.activateEnabled();
      if (results.length) log(`扩展启用结果：${JSON.stringify(results)}`);
    } catch (error) {
      log('扩展启用失败：', error?.message ?? error);
    }
  })();
  // 组件更新检查：DSH 起来后延迟 20 秒查一次，之后每 6 小时一次（结果缓存在 updates.json）。
  try {
    const updCfg = readUnified().config?.updates ?? {};
    updates.startAutoCheck({
      delayMs: Number(updCfg.startDelayMs ?? 20_000),
      intervalMs: Number(updCfg.intervalMs ?? 6 * 60 * 60 * 1000),
      enabled: updCfg.enabled !== false && updCfg.checkOnStart !== false,
    });
  } catch (error) {
    log('[updates] 启动检查失败：', String(error?.message ?? error));
  }

  // 卸载：清定时器 / 停扩展 / 注销路由（保证插件停用后不残留）。
  ctx.effect(() => () => {
    try { updates.dispose(); } catch {}
    try { for (const dispose of registeredPlatforms.values()) dispose(); } catch {}
    registeredPlatforms.clear();
    void extensionHost.deactivateAll().catch(() => {});
    try { platforms.dispose(); } catch {}
    for (const dispose of disposersForRoutes.splice(0)) { try { dispose(); } catch {} }
    for (const dispose of disposers.splice(0)) { try { dispose(); } catch {} }
  });

  log(`已激活 v${VERSION}；surfcore=${maskPath(QQBOT_ROOT || SURFCORE_ROOT)}；state=${maskPath(STATE_DIR)}；privacy=v${PRIVACY_POLICY_VERSION}`);
}

export default { name, inject, apply };
