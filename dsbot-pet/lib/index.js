/**
 * dsbot-pet —— 桌宠安装/更新/启停/卸载、桌宠对话、目的机制桌宠载体、`pet/host.json` 心跳
 *
 * 由旧单体插件 dsbot 拆出的**独立、自包含**插件：只 import 包内文件与 Node 内置。
 * 依赖的旧代码在 lib/vendor/（由 tools/vendor.mjs 按仓库相对结构原样复制，未手改）。
 *
 * 路由：
 *   · `/dsh-dsbot-pet/api/*`      —— 设置页（走 DSH 会话鉴权，由本文件的 route() 挡一层）
 *   · `/dsh-dsbot/pet-api/*`      —— 桌宠 Electron 专用（**前缀保留原名**；回环 + x-pet-token）
 *   · `/dsh-dsbot-pet/health`     —— 存活探针
 *
 * 数据（唯一写者，见 SPLIT-ARCHITECTURE §4.1）：
 *   · `~/.dsh/dsbot/pet/**`                   安装目录 / host.json / host-token / 对话 / focus.json
 *   · `~/.dsh/dsbot/token-usage-pet.jsonl`    桌宠对话用量（append-only，token 包汇总）
 *   · `<dsbot>/config.json` 的 `purpose.*`     与 QQ 桥接共享，只写这一棵子树（config-lock）
 *   只读：`characters/current-role.json`、`memory/memory-card-prompt-qq.md`、`token-usage-daily.json`。
 */
import './bootstrap.js'; // 必须第一：先定好 DSBOT_ROOT，vendored paths 才能解析
import fs from 'node:fs';
import path from 'node:path';
import {
  STATE_DIR, MEMORY_DIR, BACKUP_DIR, UNIFIED_FILE, QQ_CONFIG, PLUGIN_LOG, ensureDirs, maskPath,
} from './vendor/plugins/dsbot/lib/paths.js';
import { json, readBody, isLoopbackReq, sameOrigin } from './vendor/plugins/dsbot/lib/http-guard.js';
import { readJson, updateJsonFile } from './config-lock.js';
import { readQqConfig } from './vendor/plugins/dsbot/lib/store.js';
import {
  createPetService, detectElectronPath, installElectronRuntime, ELECTRON_VERSION, electronDownloadUrl,
} from './vendor/plugins/dsbot/lib/pet.js';
import { createPetChatService } from './vendor/plugins/dsbot/lib/pet-chat.js';
import { createPetPurposeService } from './vendor/plugins/dsbot/lib/pet-purpose.js';
import { createPetApiService } from './vendor/plugins/dsbot/lib/pet-api.js';
import { createPetTokenUsage } from './token-usage-pet.js';
import { bridgeStatus, callBridge } from './bridge-call.js';
import { readPurposeConfig, writePurposeConfig } from './purpose-config.js';
import { PACKAGE_ROOT } from './bootstrap.js';

export const name = 'dsbot-pet';
export const inject = ['webServer', 'connection'];
export const API_PREFIX = '/dsh-dsbot-pet/api';
/** 桌宠 Electron 从 pet/host.json 读这个前缀，**保留旧名**（SPLIT-ARCHITECTURE §8）。 */
export const PET_API_PREFIX = '/dsh-dsbot/pet-api';
export const HEALTH_PATH = '/dsh-dsbot-pet/health';

const VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')).version || '0.1.0'; } catch { return '0.1.0'; }
})();

/** 官方桌宠安装包（桌宠是仓库外的 Electron 工程，本包只负责安装/更新）。 */
export const PET_ZIP_URL = 'https://github.com/Mieksido/surfpet/releases/latest/download/pet-pack.zip';

function clampInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 桌宠对话参数白名单（只改统一配置的 `pet.chat` 子树）。 */
const CHAT_CONFIG_KEYS = {
  enabled: (v) => v !== false,
  remember: (v) => v !== false,
  maxReplyChars: (v) => clampInt(v, 40, 800),
  voiceMaxChars: (v) => clampInt(v, 20, 300),
  historyTurns: (v) => clampInt(v, 2, 60),
  temperature: (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(2, Math.max(0, n)) : 1;
  },
  reasoningEffort: (v) => (['off', 'low', 'high', 'max'].includes(String(v)) ? String(v) : 'low'),
};

function safeLog(...args) {
  const line = `[${new Date().toISOString()}] [${name}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  try { console.log(line); } catch {}
  try {
    ensureDirs();
    // 和旧插件一样：超过 2MB 滚一代，避免 plugin.log 无限增长。
    try {
      const stat = fs.statSync(PLUGIN_LOG);
      if (stat.size > 2 * 1024 * 1024) fs.renameSync(PLUGIN_LOG, `${PLUGIN_LOG}.1`);
    } catch {}
    fs.appendFileSync(PLUGIN_LOG, `${line}\n`);
  } catch {}
}

/** 读一个 JSON 请求体；空体返回 {}，非法 JSON 抛错（调用方回 400）。 */
async function readJsonBody(req, limit) {
  const raw = await readBody(req, limit ?? 512 * 1024);
  if (!String(raw ?? '').trim()) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求体必须是 JSON 对象');
  return parsed;
}

/**
 * 生成宿主半边服务。`apply()` 与测试都走这里，便于在测试里拿到 petChat/petApi 做细粒度断言。
 */
export function createRuntime(ctx) {
  const petUsage = createPetTokenUsage({ log: safeLog });

  const currentDshUrl = () => {
    try {
      const ws = ctx.get('webServer');
      if (ws?.port) return `${ws.protocol || 'http:'}//127.0.0.1:${ws.port}`;
    } catch {}
    return String(process.env.DSH_WEB_URL ?? '').trim();
  };

  // 旧 pet.js 的 getSubprocess 参数实际没用到（见 SUBSYSTEM-PET §1.2 第 5 条），照着传，保持行为一致。
  const petService = createPetService({
    stateDir: STATE_DIR,
    pluginLog: safeLog,
    getSubprocess: () => ctx.get('subprocess'),
  });
  // 用量适配器：vendored pet-chat 只认 recordExternalUsage/block 两个方法；
  // 真正的落盘改成 append token-usage-pet.jsonl（新契约），不再碰 token 包的状态文件。
  const petChat = createPetChatService({
    ctx,
    stateDir: STATE_DIR,
    pluginLog: safeLog,
    tokenBudget: petUsage.adapter,
  });
  const petPurpose = createPetPurposeService({
    chat: petChat,
    tokenBudget: petUsage.adapter,
    pluginLog: safeLog,
    callBridge,
  });
  const petApi = createPetApiService({
    chat: petChat,
    purpose: petPurpose,
    petService,
    stateDir: STATE_DIR,
    currentDshUrl,
    pluginLog: safeLog,
    version: VERSION,
  });

  return { petUsage, petService, petChat, petPurpose, petApi, currentDshUrl };
}

const __state = { runtime: null };

export function apply(ctx) {
  ensureDirs();
  const runtime = createRuntime(ctx);
  __state.runtime = runtime;
  const { petService, petChat, petPurpose, petApi, petUsage } = runtime;
  const disposers = [];

  /** Electron 运行时下载任务（进度条用；只有用户点「下载 Electron」才产生）。 */
  let electronJob = null;

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
          safeLog('API 失败：', String(error?.message ?? error));
          try { json(res, 500, { ok: false, error: String(error?.message ?? error) }); } catch {}
        }
      },
    }));
  }

  // ── 桌宠安装 / 启停（旧 index.js handlePet 的剪切版）─────────────────────
  function petStatusPayload() {
    const petStatus = petService.status();
    const chatStatus = petChat.status();
    const cfgPet = String(readQqConfig().config?.pet?.appDir || '').trim();
    const detected = detectElectronPath({
      cfgPath: petService.status().electronPath || '',
      appDir: cfgPet,
      stateDir: STATE_DIR,
    });
    return {
      ...petStatus,
      installing: petStatus.installing || electronJob || null,
      chat: chatStatus.chat,
      role: chatStatus.role,
      proactive: chatStatus.proactive,
      presence: chatStatus.presence,
      voice: chatStatus.voice,
      llm: chatStatus.llm,
      focus: chatStatus.focus,
      events: { ...chatStatus.events, hostFile: petApi.hostFile },
      lastError: chatStatus.lastError,
      defaults: {
        zipUrl: PET_ZIP_URL,
        electronUrl: electronDownloadUrl(),
        electronVersion: ELECTRON_VERSION,
      },
      electronDetected: detected,
    };
  }

  async function handlePet(req, res, url) {
    const suffix = url.pathname.slice(`${API_PREFIX}/pet`.length) || '/status';
    const method = String(req.method || 'GET').toUpperCase();
    try {
      if (suffix === '/status' && method === 'GET') { json(res, 200, petStatusPayload()); return; }
      if (suffix === '/list' && method === 'GET') {
        const st = petService.status();
        json(res, 200, { ok: true, installed: st.installed, running: st.running, dir: st.dir, skins: st.skins ?? [] });
        return;
      }
      if (suffix === '/config' && method === 'GET') {
        const st = petService.status();
        json(res, 200, {
          ok: true,
          source: st.source,
          electronPath: st.electronPath,
          appDir: st.appDir,
          mirror: st.mirror,
          installed: st.installed,
          running: st.running,
          dir: st.dir,
        });
        return;
      }
      if (method !== 'POST') { json(res, 405, { ok: false, error: '只支持 POST' }); return; }
      const body = await readJsonBody(req, 256 * 1024);
      if (suffix === '/config') { json(res, 200, { ok: true, ...petService.configure(body) }); return; }
      if (suffix === '/chat-config') {
        // 桌宠对话参数归本包 UI；只改统一配置里的 `pet.chat` 子树（锁内读改写，备份）。
        const patch = body?.chat && typeof body.chat === 'object' && !Array.isArray(body.chat) ? body.chat : {};
        const next = updateJsonFile(UNIFIED_FILE, (cfg) => {
          const root = cfg && typeof cfg === 'object' ? cfg : {};
          const pet = root.pet && typeof root.pet === 'object' && !Array.isArray(root.pet) ? root.pet : {};
          const chat = pet.chat && typeof pet.chat === 'object' && !Array.isArray(pet.chat) ? pet.chat : {};
          const merged = { ...chat };
          for (const [key, value] of Object.entries(patch)) {
            const normalize = CHAT_CONFIG_KEYS[key];
            if (!normalize) continue;
            merged[key] = normalize(value);
          }
          pet.chat = merged;
          root.pet = pet;
          return root;
        }, { backupLabel: 'pet-chat' });
        json(res, 200, { ok: true, chat: next?.pet?.chat ?? {} });
        return;
      }
      if (suffix === '/focus') {
        const state = petChat.setFocus(body.enabled === true, body.source || 'settings');
        json(res, 200, { ok: true, focus: state });
        return;
      }
      if (suffix === '/electron-detect') {
        const cfgPet = String(readQqConfig().config?.pet?.appDir || '').trim();
        const found = detectElectronPath({
          cfgPath: petService.status().electronPath || '',
          appDir: cfgPet,
          stateDir: STATE_DIR,
        });
        if (found) { try { petService.configure({ electronPath: found }); } catch {} }
        json(res, 200, {
          ok: Boolean(found),
          electronPath: found,
          error: found ? '' : '本机没找到 Electron，可点「下载 Electron」自动装',
        });
        return;
      }
      if (suffix === '/electron-install') {
        // ⚠️ 会真实下载 Electron（约 125MB）。测试里绝不调用这条分支。
        electronJob = { phase: '准备下载 Electron', progress: 0, error: null, key: 'electron' };
        const onProgress = (pct, phase) => {
          if (!electronJob) return;
          electronJob = { ...electronJob, progress: pct, phase: phase || electronJob.phase, updatedAt: Date.now() };
        };
        const src = ['github', 'mirror'].includes(String(body.source ?? '')) ? String(body.source) : 'auto';
        let result;
        try {
          result = await installElectronRuntime({
            stateDir: STATE_DIR,
            log: (m) => safeLog(m),
            source: src,
            onProgress,
          });
          electronJob = { ...electronJob, phase: '完成', progress: 100 };
        } catch (error) {
          electronJob = { ...electronJob, phase: '失败', error: String(error?.message ?? error) };
          throw error;
        } finally {
          setTimeout(() => { electronJob = null; }, 60_000).unref?.();
        }
        try { if (result.electronPath) petService.configure({ electronPath: result.electronPath }); } catch {}
        json(res, 200, result);
        return;
      }
      if (suffix === '/install') {
        // 安装请求本身就是一次落盘（source/appDir/electronPath），不要用户先点保存。
        const result = await petService.install(body?.source, {
          source: body?.source,
          appDir: body?.appDir,
          electronPath: body?.electronPath,
        });
        json(res, 200, result);
        return;
      }
      if (suffix === '/update') {
        // 只接受**本地** zip（更新包的下载/校验归 dsbot-core 的组件更新）；这里负责换目录。
        const zipPath = String(body?.zipPath ?? '').trim();
        if (!zipPath) { json(res, 400, { ok: false, error: '缺少 zipPath（本包只做本地安装包更新）' }); return; }
        if (!fs.existsSync(zipPath)) { json(res, 400, { ok: false, error: `找不到安装包：${zipPath}` }); return; }
        json(res, 200, await petService.updateFromZip(zipPath));
        return;
      }
      if (suffix === '/remove') { json(res, 200, await petService.remove()); return; }
      if (suffix === '/clean') { json(res, 200, await petService.cleanAppDir()); return; }
      if (suffix === '/start') {
        if (typeof body?.electronPath === 'string' && body.electronPath.trim()) {
          try { petService.configure({ electronPath: body.electronPath.trim() }); } catch {}
        }
        json(res, 200, await petService.start());
        return;
      }
      if (suffix === '/stop') { json(res, 200, await petService.stop()); return; }
      if (suffix === '/chat-test') {
        const result = await petChat.chat({
          text: body.text || '在吗',
          modality: body.modality === 'voice' ? 'voice' : 'text',
        });
        // 设置页发的测试也推给桌宠气泡，否则用户不知道通没通。
        if (result.ok && result.reply) {
          petChat.emit({
            type: 'reply',
            text: result.reply.text,
            modality: result.reply.modality,
            audioKey: result.reply.audio?.key || '',
            messageId: result.reply.id,
          });
        }
        json(res, result.ok ? 200 : 400, result);
        return;
      }
      json(res, 404, { ok: false, error: `未知桌宠接口：${suffix}` });
    } catch (error) {
      json(res, 400, { ok: false, error: String(error?.message ?? error) });
    }
  }

  // ── 目的机制（设置页「目的」）：按当前载体路由到桥接或本包 ──────────────
  async function purposeAvailability() {
    const petStatus = petService.status();
    const online = petChat.online();
    let bridge = null;
    try { bridge = await bridgeStatus(); } catch (error) {
      bridge = { ok: false, running: false, mode: null, error: String(error?.message ?? error) };
    }
    return {
      pet: {
        installed: Boolean(petStatus.installed),
        running: Boolean(petStatus.running),
        online: Boolean(online.online),
        lastPollAt: online.lastSeenAt || 0,
        roleName: petChat.roleInfo().name,
      },
      qq: {
        running: Boolean(bridge?.running),
        mode: bridge?.mode || null,
        ok: bridge?.ok !== false,
        error: bridge?.error || '',
      },
    };
  }

  async function handlePurpose(req, res, url) {
    const suffix = url.pathname.slice(`${API_PREFIX}/purpose`.length) || '/status';
    const method = String(req.method || 'GET').toUpperCase();
    const carrier = readPurposeConfig().carrier;
    const availability = await purposeAvailability();
    try {
      if (suffix === '/config' && method === 'GET') {
        const cfg = readPurposeConfig();
        json(res, 200, {
          ok: true,
          purpose: cfg.purpose,
          carrier: cfg.carrier,
          modality: cfg.modality,
          fallbackToQQ: cfg.fallbackToQQ,
          availability,
        });
        return;
      }
      if (suffix === '/config' && method === 'POST') {
        const body = await readJsonBody(req, 256 * 1024);
        const patch = body?.purpose && typeof body.purpose === 'object' && !Array.isArray(body.purpose) ? body.purpose : body;
        const result = writePurposeConfig(patch);
        safeLog('purpose 配置已更新：', JSON.stringify(result.changed));
        json(res, 200, { ok: true, ...result, availability });
        return;
      }
      if (suffix === '/status' && method === 'GET') {
        if (carrier === 'pet') {
          const st = petPurpose.status();
          json(res, 200, {
            ok: true,
            source: 'pet',
            carrier: 'pet',
            availability,
            enabled: st.enabled,
            modality: st.modality,
            fallbackToQQ: st.fallbackToQQ,
            ownerUin: st.ownerUin,
            ownerName: st.ownerName,
            focus: st.focus,
            config: st.config,
            state: st.state,
            online: st.online,
            lastTickAt: st.lastTickAt,
            lastError: st.lastError,
            lastFallback: st.lastFallback,
            tokenGate: petUsage.gateStatus(),
          });
          return;
        }
        if (!availability.qq.running) {
          json(res, 200, {
            ok: false,
            source: 'qq',
            carrier: 'qq',
            availability,
            focus: petChat.focusEnabled(),
            error: 'QQ 桥接没在运行：先在「DSBot · QQ」启动，或者把载体切到桌宠',
            config: readPurposeConfig().purpose,
            state: null,
            tokenGate: petUsage.gateStatus(),
          });
          return;
        }
        const remote = await callBridge('/api/purpose/status', { timeoutMs: 8000 });
        const data = remote?.data ?? {};
        json(res, remote?.status || 200, {
          ...data,
          source: 'qq',
          carrier: 'qq',
          availability,
          focus: petChat.focusEnabled(),
          ok: data.ok !== false,
          error: data.ok === false ? (data.error || '读取目的状态失败') : '',
        });
        return;
      }
      if (suffix === '/preview' && method === 'POST') {
        if (carrier === 'pet') {
          const result = await petPurpose.preview();
          json(res, result.ok ? 200 : 400, { ...result, source: 'pet', carrier: 'pet', availability });
          return;
        }
        if (!availability.qq.running) {
          json(res, 409, { ok: false, error: 'QQ 桥接没在运行，无法预览 QQ 载体的目的回合', availability });
          return;
        }
        const remote = await callBridge('/api/purpose/preview', { method: 'POST', body: {}, timeoutMs: 20000 });
        json(res, remote?.status || 200, { ...(remote?.data ?? {}), source: 'qq', carrier: 'qq', availability });
        return;
      }
      if (suffix === '/run' && method === 'POST') {
        const body = await readJsonBody(req, 256 * 1024);
        if (carrier === 'pet') {
          const result = await petPurpose.run({ force: body.force !== false });
          json(res, result.ok ? 200 : 409, { ...result, source: 'pet', carrier: 'pet', availability });
          return;
        }
        if (!availability.qq.running) {
          json(res, 409, { ok: false, error: 'QQ 桥接没在运行，无法让 QQ 载体出发', availability });
          return;
        }
        const remote = await callBridge('/api/purpose/run', {
          method: 'POST',
          body: { force: body.force !== false },
          timeoutMs: 30000,
        });
        json(res, remote?.status || 200, { ...(remote?.data ?? {}), source: 'qq', carrier: 'qq', availability });
        return;
      }
      if (suffix === '/pet-chat' && method === 'POST') {
        // 设置页「目的」页里的桌宠对话测试（不占主动搭话额度）。
        const body = await readJsonBody(req, 256 * 1024);
        const result = await petChat.chat({
          text: body.text || '在吗',
          modality: body.modality === 'voice' ? 'voice' : 'text',
        });
        json(res, result.ok ? 200 : 400, result);
        return;
      }
      json(res, 404, { ok: false, error: `未知目的接口：${suffix}` });
    } catch (error) {
      json(res, 500, { ok: false, error: String(error?.message ?? error) });
    }
  }

  // ── 路由注册 ─────────────────────────────────────────────────────────────
  route('prefix', API_PREFIX, async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const tail = url.pathname.slice(API_PREFIX.length).replace(/^\/+/, '');
    const method = String(req.method || 'GET').toUpperCase();
    if (tail === 'status') {
      if (method !== 'GET') { json(res, 405, { ok: false, error: '只支持 GET' }); return; }
      const petStatus = petService.status();
      const cfg = readPurposeConfig();
      json(res, 200, {
        ok: true,
        plugin: name,
        version: VERSION,
        paths: {
          stateDir: maskPath(STATE_DIR),
          memoryDir: maskPath(MEMORY_DIR),
          backupDir: maskPath(BACKUP_DIR),
        },
        files: {
          unified: fs.existsSync(UNIFIED_FILE),
          qqConfig: fs.existsSync(QQ_CONFIG),
          hostJson: fs.existsSync(petApi.hostFile),
        },
        pet: { installed: Boolean(petStatus.installed), running: Boolean(petStatus.running) },
        purpose: { carrier: cfg.carrier, modality: cfg.modality, fallbackToQQ: cfg.fallbackToQQ },
        tokenGate: petUsage.gateStatus(),
        api: {
          prefix: API_PREFIX,
          petPrefix: PET_API_PREFIX,
          hostFile: maskPath(petApi.hostFile),
          health: HEALTH_PATH,
        },
      });
      return;
    }
    if (tail === 'pet' || tail.startsWith('pet/')) { await handlePet(req, res, url); return; }
    if (tail === 'purpose' || tail.startsWith('purpose/')) { await handlePurpose(req, res, url); return; }
    json(res, 404, { ok: false, error: `未知接口：${url.pathname}` });
  });

  // 桌宠专用本地接口：独立前缀 + 自己的回环/令牌校验（前缀保留旧名，见 SPLIT-ARCHITECTURE §8）。
  route('prefix', PET_API_PREFIX, async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    await petApi.handle(req, res, url);
  });

  route('exact', HEALTH_PATH, async (_req, res) => {
    json(res, 200, { ok: true, name, version: VERSION });
  });

  // 桌宠发现文件（端口漂移 / 令牌由它兜底）：启动强制写一次，之后每 2 分钟对一次。
  try { petApi.writeHostFile(true); } catch (error) { safeLog('[pet-api] 启动写 host.json 失败：', String(error?.message ?? error)); }
  const petHostTimer = setInterval(() => { try { petApi.writeHostFile(false); } catch {} }, 120_000);
  petHostTimer.unref?.();

  // 目的机制（桌宠载体）：carrier=pet 时这里每 60 秒 tick；carrier=qq 时 tick 立即返回（互斥）。
  try { petPurpose.start(); } catch (error) { safeLog('[pet-purpose] 启动失败：', String(error?.message ?? error)); }

  ctx.effect(() => () => {
    if (petHostTimer) clearInterval(petHostTimer);
    try { petPurpose.stop?.(); } catch {}
    for (const dispose of disposers.splice(0)) { try { dispose(); } catch {} }
    __state.runtime = null;
  });

  safeLog(`已激活 v${VERSION}；stateDir=${maskPath(STATE_DIR)}；petApi=${PET_API_PREFIX}`);
}

/** 仅供 scripts/test-smoke.mjs 使用（浏览器运行时不引用宿主文件）。 */
export const __test = {
  get runtime() { return __state.runtime; },
  PET_ZIP_URL,
  ELECTRON_VERSION,
  VERSION,
};

export default { name, inject, apply };
