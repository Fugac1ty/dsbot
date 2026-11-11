/**
 * surfcore-voice —— 语音包安装/启停/健康检查、TTS 路由、角色音色与云端凭据
 *
 * 由旧单体插件 surfcore 拆出的**独立、自包含**插件：只 import 包内文件与 Node 内置。
 * 依赖的旧代码在 lib/vendor/（由 tools/vendor.mjs 按仓库相对结构原样复制）。
 *
 * 职责边界（见 docs/SPLIT-ARCHITECTURE.md §1）：
 *   · 语音**服务本体在桥接进程里**（<surfcore>/src/bridge.js 的 /api/voice/*）。
 *     本包不起 TTS、不 vendor 语音引擎，只做三件事：
 *       1) 带控制台令牌把面板请求代理给桥接（安装/启停/试听/规则/云端配额）；
 *       2) 维护本包唯一拥有的 QQ 配置键 socialV2.voice* / voicePacks.*（走 config-lock）；
 *       3) 端口/链路健康检查（8765 voxd、8767 云端包、9880 GPT-SoVITS）。
 *   · 两个**本地动作**（旧 lib/index.js:1900-1982 原样语义）：
 *       POST /voice/packs/netdisk      —— 用系统浏览器打开网盘离线包地址
 *       POST /voice/packs/sample-open  —— 用资源管理器打开云端包参考音频
 *     非 Windows 一律返回可读的 OPEN_URL_UNSUPPORTED / OPEN_FOLDER_UNSUPPORTED（200 + hint）。
 *   · 不负责：语音消息的发送（桥接/桌宠各自做）、QQ 其它参数。
 *
 * 路由前缀：/dsh-surfcore-voice/api
 * 设置栏目 id：surfcore-voice（浏览器半边见 lib/client.js）
 */
import './bootstrap.js'; // 必须第一：先定好 SURFCORE_ROOT，vendored paths 才能解析
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import {
  STATE_DIR, MEMORY_DIR, BACKUP_DIR, UNIFIED_FILE, QQ_CONFIG, BILI_CONFIG, QQBOT_ROOT,
  ensureDirs, maskPath,
} from './vendor/plugins/surfcore/lib/paths.js';
import { json, readBody, isLoopbackReq, sameOrigin } from './vendor/plugins/surfcore/lib/http-guard.js';
import {
  callBridge, consoleBase, consoleToken, portOpen,
} from './vendor/plugins/surfcore/lib/bridge.js';
import { readQqConfig, redactForUi } from './vendor/plugins/surfcore/lib/store.js';
import { VOICE_PORTS, readPackCharacters, validateCharacter } from './vendor/plugins/surfcore/lib/voice-health.js';
import { readJson, updateJsonFile } from './config-lock.js';

export const name = 'surfcore-voice';
export const inject = ['webServer', 'connection'];
export const API_PREFIX = '/dsh-surfcore-voice/api';
export const VERSION = '0.1.0';

/** 网盘离线包（写死，不接受用户输入 —— 避免变成任意 URL 打开器；旧 index.js:1908）。 */
const NETDISK_URL = 'https://pan.quark.cn/s/ec6cf2b123de?pwd=sxUZ';

const log = (...args) => {
  const line = `[${new Date().toISOString()}] [${name}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  try { console.log(line); } catch {}
  try {
    ensureDirs();
    fs.appendFileSync(path.join(STATE_DIR, 'plugin.log'), `${line}\n`);
  } catch {}
};

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

/** 语音包默认安装目录（桥接侧同一口径：config.json 的 voicePacks.dir 可覆盖）。 */
function defaultPacksDir() {
  return path.join(QQBOT_ROOT, 'state', 'voice-packs');
}

function packsDirFromConfig(cfg) {
  const configured = String(cfg?.voicePacks?.dir ?? '').trim();
  return configured ? path.resolve(configured) : defaultPacksDir();
}

/** 桥接控制台端口（用于 /status 里的可达性探测；consoleBase() 形如 http://127.0.0.1:3100）。 */
function consolePort() {
  try { return Number(new URL(consoleBase()).port) || 3100; } catch { return 3100; }
}

/** 端口探测（探测本身不抛错；无服务就是 open:false）。 */
async function probePorts(timeoutMs = 700) {
  return Promise.all(VOICE_PORTS.map(async (item) => ({
    ...item,
    open: await portOpen(item.port, '127.0.0.1', timeoutMs),
  })));
}

/** 读 QQ 配置里本包负责的语音键（合并 config.example 默认值，只用于展示/校验）。 */
function readVoiceConfig() {
  const cfg = readQqConfig().config ?? {};
  return { cfg, voice: isPlainObject(cfg.socialV2?.voice) ? cfg.socialV2.voice : {} };
}

/** 角色音色校验用的可用角色（读已安装语音包的 config.toml；读不到就是空，不拦保存）。 */
function packCharacters(cfg) {
  return readPackCharacters(packsDirFromConfig(cfg));
}

/** 启动时自检一次（旧 index.js:2903-2916 的语义）：结果缓存在这里给 /status 展示。 */
let lastSelfCheck = null;

async function runVoiceSelfCheck() {
  try {
    const { cfg, voice } = readVoiceConfig();
    const tts = isPlainObject(voice.tts) ? voice.tts : {};
    const ports = await probePorts(800);
    const get = (key) => ports.find((p) => p.key === key) || { open: false };
    const route = tts.route === 'cloud' ? 'cloud' : 'local';
    const hints = [];
    if (!get('voxd').open) {
      hints.push('8765（voxd）没监听：发语音会失败，先跑 voice-local/run.bat');
    } else if (tts.enabled === true && route === 'local' && !get('gsv').open) {
      // 2026-10-27 实测：只起 8765 时发语音全 503，用户以为插件坏了。
      hints.push(`8765 在跑但 9880（GPT-SoVITS）没起：角色 ${tts.character || '(空)'} 走本地音色会 503，先跑 voice-local/gsv.bat 等约 40 秒（也可切到云端）`);
    }
    if (route === 'cloud' && !get('cloud').open) {
      hints.push('当前 TTS 路由是云端，但 8767 没监听：先启动云端语音包');
    }
    lastSelfCheck = {
      at: new Date().toISOString(),
      ports,
      hints,
      tts: { enabled: tts.enabled === true, route, character: String(tts.character ?? '') },
      packsDir: maskPath(packsDirFromConfig(cfg)),
    };
    log(`语音链路自检：${ports.map((p) => `${p.label}(${p.port})=${p.open ? '开' : '关'}`).join(' ')}`
      + (hints.length ? `；提示：${hints.join('；')}` : tts.enabled === true ? '（链路正常）' : '（TTS 未开启）'));
  } catch (error) {
    log('语音链路自检失败：', String(error?.message ?? error));
  }
}

export function apply(ctx) {
  ensureDirs();
  const disposers = [];
  let selfCheckTimer = null;

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

  const methodNotAllowed = (res, allowed = 'GET') => json(res, 405, {
    ok: false, code: 'METHOD_NOT_ALLOWED', error: `只支持 ${allowed}`,
  });

  /** 502：桥接没跑时所有代理接口的统一出口（旧 handleVoice 的 catch 分支）。 */
  const bridgeUnreachable = (res, error) => json(res, 502, {
    ok: false,
    code: 'BRIDGE_UNREACHABLE',
    error: `语音服务不可达（桥接是否在运行？）：${String(error?.message ?? error ?? '连接被拒绝')}`,
    hint: '语音服务由 QQ 桥接进程提供：先到「SurfCore · QQ」栏目启动桥接，再回来重试。',
  });

  async function parseJsonBody(req, res) {
    const text = await readBody(req);
    if (!String(text ?? '').trim()) return {};
    try {
      const body = JSON.parse(text);
      return isPlainObject(body) ? body : null;
    } catch {
      json(res, 400, { ok: false, code: 'INVALID_JSON', error: '请求体不是合法 JSON' });
      return null;
    }
  }

  // ── 本地动作 1：网盘离线包入口（旧 index.js:1905-1922）─────────────────────
  async function openNetdisk(req, res) {
    if (String(req.method).toUpperCase() !== 'POST') { methodNotAllowed(res, 'POST'); return; }
    // 网盘离线包入口：Electron 里 target=_blank 会被拦，统一由宿主打开浏览器。
    if (process.platform !== 'win32') {
      json(res, 200, {
        ok: false, code: 'OPEN_URL_UNSUPPORTED',
        error: '当前系统不支持自动打开浏览器',
        hint: `手动打开：${NETDISK_URL}`, url: NETDISK_URL,
      });
      return;
    }
    try {
      // start 的第一个空参数是窗口标题，不能省；URL 里无 & 之外的 shell 元字符。
      const child = spawn('cmd.exe', ['/c', 'start', '', NETDISK_URL], { detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', (error) => log('打开网盘失败：', String(error?.message ?? error)));
      child.unref();
      json(res, 200, { ok: true, url: NETDISK_URL });
    } catch (error) {
      json(res, 500, {
        ok: false, code: 'OPEN_URL_FAILED',
        error: `打开浏览器失败：${String(error?.message ?? error).slice(0, 120)}`,
        hint: `手动打开：${NETDISK_URL}`, url: NETDISK_URL,
      });
    }
  }

  // ── 本地动作 2：打开云端包参考音频所在目录（旧 index.js:1923-1952）──────────
  async function openSampleFolder(req, res) {
    if (String(req.method).toUpperCase() !== 'POST') { methodNotAllowed(res, 'POST'); return; }
    try {
      const body = await parseJsonBody(req, res);
      if (body === null) return; // 非法 JSON 已经回过 400
      const id = String(body.id || 'voice-cloud');
      const listed = await callBridge('/api/voice/packs', { timeoutMs: 8000 });
      if (listed.status === 0) { bridgeUnreachable(res, listed.error); return; }
      const pack = (listed.data?.packs || []).find((p) => p.id === id);
      if (!pack?.dir) {
        json(res, 404, {
          ok: false, code: 'SAMPLE_PACK_NOT_FOUND',
          error: '语音包还没安装，找不到参考音频',
          hint: '先安装/导入云端语音包，再点「打开所在目录」。',
        });
        return;
      }
      const dir = path.join(pack.dir, 'voicepack');
      const files = await fs.promises.readdir(dir).catch(() => []);
      const fileName = files.find((f) => /\.(wav|mp3|m4a)$/i.test(f));
      if (!fileName) {
        json(res, 404, { ok: false, code: 'SAMPLE_FILE_NOT_FOUND', error: '包内没有参考音频文件', hint: `检查目录：${dir}` });
        return;
      }
      const file = path.join(dir, fileName);
      if (process.platform !== 'win32') {
        json(res, 200, {
          ok: false, code: 'OPEN_FOLDER_UNSUPPORTED',
          error: '当前系统不支持自动打开目录',
          hint: `手动打开：${dir}`, path: file, dir,
        });
        return;
      }
      execFile('explorer.exe', ['/select,', file], { windowsHide: true }, () => {});
      json(res, 200, { ok: true, path: file, dir });
    } catch (error) {
      json(res, 502, {
        ok: false, code: 'OPEN_FOLDER_FAILED',
        error: `打开参考音频目录失败：${String(error?.message ?? error)}`,
        hint: '桥接/文件管理器是否可用；也可以手动打开语音包目录下的 voicepack。',
      });
    }
  }

  // ── 代理：把 /dsh-surfcore-voice/api/voice/* 原样转发给桥接 /api/voice/* ────
  // 语义照搬旧 handleVoice 的尾段：带 x-console-token、保留 query、二进制照传。
  async function proxyVoice(req, res, url) {
    const suffix = url.pathname.slice(`${API_PREFIX}/voice`.length) || '';
    const target = `${consoleBase()}/api/voice${suffix}${url.search || ''}`;
    const method = String(req.method || 'GET').toUpperCase();
    const headers = { 'x-console-token': consoleToken() };
    const init = { method, signal: AbortSignal.timeout(120_000) };
    if (method !== 'GET' && method !== 'HEAD') {
      // 桥接的写操作强制 application/json；空 body 也要发 `{}`（否则 415）。
      const raw = await readBody(req);
      init.body = String(raw ?? '').trim() ? raw : '{}';
      headers['content-type'] = 'application/json';
    }
    init.headers = headers;
    try {
      const response = await fetch(target, init);
      const buf = Buffer.from(await response.arrayBuffer());
      res.writeHead(response.status, {
        'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8',
        ...(response.headers.get('content-disposition')
          ? { 'content-disposition': response.headers.get('content-disposition') }
          : {}),
      });
      res.end(buf);
    } catch (error) {
      bridgeUnreachable(res, error);
    }
  }

  // ── GET/POST /voice/tts —— 本包唯一写者：QQ 配置 socialV2.voice* / voicePacks.* ──
  // 旧版这些键由 /config 整份读写；拆分后只允许本包碰它们，且必须走 config-lock。
  async function handleVoiceTts(req, res) {
    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'GET') {
      const { cfg, voice } = readVoiceConfig();
      const chars = packCharacters(cfg);
      const tts = isPlainObject(voice.tts) ? voice.tts : {};
      json(res, 200, {
        ok: true,
        voice: redactForUi(voice),
        voicePacks: { dir: String(cfg.voicePacks?.dir ?? '') },
        packsDir: maskPath(packsDirFromConfig(cfg)),
        characters: chars.characters,
        sources: chars.sources.map((s) => ({ id: s.id, file: maskPath(s.file), characters: s.characters })),
        validation: validateCharacter(tts.character, chars.characters),
        ports: VOICE_PORTS,
      });
      return;
    }
    if (method !== 'POST') { methodNotAllowed(res, 'GET/POST'); return; }
    const body = await parseJsonBody(req, res);
    if (body === null) return;
    const voicePatch = isPlainObject(body.voice) ? clone(body.voice) : (isPlainObject(body.tts) ? { tts: clone(body.tts) } : null);
    const packsPatch = isPlainObject(body.voicePacks) ? clone(body.voicePacks) : null;
    if (!voicePatch && !packsPatch) {
      json(res, 400, { ok: false, code: 'EMPTY_PATCH', error: '请求体里没有 voice / tts / voicePacks 可写字段' });
      return;
    }
    // 角色名校验（旧 index.js:838-870 的语义）：必须是 [voice.characters] 里的名字，不能是音色 id。
    const incomingCharacter = voicePatch?.tts?.character;
    if (incomingCharacter !== undefined) {
      const { cfg } = readVoiceConfig();
      const chars = packCharacters(cfg).characters;
      const check = validateCharacter(incomingCharacter, chars);
      if (!check.ok) {
        json(res, 400, {
          ok: false, code: 'INVALID_CHARACTER', error: check.reason,
          hint: check.characters.length ? `可用角色：${check.characters.join('、')}` : '还没检测到已安装语音包的角色；先安装/启动语音包，或留空交给运行时',
          characters: check.characters,
        });
        return;
      }
    }
    let written;
    try {
      written = updateJsonFile(QQ_CONFIG, (cfg) => {
        cfg.socialV2 = isPlainObject(cfg.socialV2) ? cfg.socialV2 : {};
        if (voicePatch) {
          const cur = isPlainObject(cfg.socialV2.voice) ? cfg.socialV2.voice : {};
          const merged = { ...cur, ...clone(voicePatch) };
          // 嵌套对象只合并、不整体替换：一次只改 tts.character 时不能把 endpoints/timeoutMs 冲掉。
          for (const sub of ['tts', 'trigger', 'cloud', 'sticker']) {
            if (isPlainObject(voicePatch[sub]) && isPlainObject(cur[sub])) {
              merged[sub] = { ...cur[sub], ...clone(voicePatch[sub]) };
              if (sub === 'tts' && isPlainObject(voicePatch[sub].endpoints) && isPlainObject(cur[sub]?.endpoints)) {
                merged[sub].endpoints = { ...cur[sub].endpoints, ...clone(voicePatch[sub].endpoints) };
              }
            }
          }
          cfg.socialV2.voice = merged;
        }
        if (packsPatch) {
          cfg.voicePacks = { ...(isPlainObject(cfg.voicePacks) ? cfg.voicePacks : {}), ...clone(packsPatch) };
        }
        return cfg;
      }, { backupLabel: 'voice-tts' });
    } catch (error) {
      json(res, 500, { ok: false, code: 'CONFIG_WRITE_FAILED', error: `写 QQ 配置失败：${String(error?.message ?? error)}` });
      return;
    }
    log(`已写入 QQ 配置 voice 键（备份在 ${maskPath(BACKUP_DIR)}）：voice=${Boolean(voicePatch)} voicePacks=${Boolean(packsPatch)}`);
    const cfg = written ?? readJson(QQ_CONFIG, {}) ?? {};
    const voice = isPlainObject(cfg.socialV2?.voice) ? cfg.socialV2.voice : {};
    const chars = readPackCharacters(packsDirFromConfig(cfg));
    json(res, 200, {
      ok: true,
      voice: redactForUi(voice),
      voicePacks: { dir: String(cfg.voicePacks?.dir ?? '') },
      characters: chars.characters,
      validation: validateCharacter(isPlainObject(voice.tts) ? voice.tts.character : '', chars.characters),
    });
  }

  // ── GET/POST /voice/cloud —— 云端凭据与额度（组合代理桥接的 cloud-config/cloud-stats）──
  async function handleVoiceCloud(req, res) {
    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'GET') {
      const [config, stats] = await Promise.all([
        callBridge('/api/voice/packs/cloud-config?id=voice-cloud', { timeoutMs: 6000 }),
        callBridge('/api/voice/packs/cloud-stats?id=voice-cloud', { timeoutMs: 6000 }),
      ]);
      if (config.status === 0 && stats.status === 0) {
        bridgeUnreachable(res, config.error || stats.error);
        return;
      }
      json(res, 200, {
        ok: true,
        engine: 'bridge',
        config: config.data ?? null,
        stats: stats.data ?? null,
        statuses: { config: config.status, stats: stats.status },
      });
      return;
    }
    if (method !== 'POST') { methodNotAllowed(res, 'GET/POST'); return; }
    const body = await parseJsonBody(req, res);
    if (body === null) return;
    const result = await callBridge('/api/voice/packs/cloud-config', {
      method: 'POST',
      body: { id: 'voice-cloud', ...clone(body) },
      timeoutMs: 10_000,
    });
    if (result.status === 0) { bridgeUnreachable(res, result.error); return; }
    const payload = result.data && typeof result.data === 'object' ? result.data : {};
    if (!result.ok) {
      json(res, result.status >= 400 ? result.status : 502, {
        ok: false,
        code: payload.code || 'CLOUD_CONFIG_FAILED',
        error: payload.error || `云端配置保存失败（HTTP ${result.status}）`,
      });
      return;
    }
    json(res, 200, { ok: true, engine: 'bridge', result: payload });
  }

  // ── GET /voice/health —— 端口/链路自检（无服务也返回 200 + open:false）──────
  async function handleVoiceHealth(req, res) {
    if (String(req.method || 'GET').toUpperCase() !== 'GET') { methodNotAllowed(res, 'GET'); return; }
    const { cfg, voice } = readVoiceConfig();
    const tts = isPlainObject(voice.tts) ? voice.tts : {};
    const route = tts.route === 'cloud' ? 'cloud' : 'local';
    const ports = await probePorts(700);
    const get = (key) => ports.find((p) => p.key === key) || { open: false };
    const chars = packCharacters(cfg);
    const validation = validateCharacter(tts.character, chars.characters);
    const hints = [];
    if (!get('voxd').open) hints.push('8765（voxd）没监听：语音包没启动，发语音会失败');
    if (tts.enabled === true && route === 'local' && !get('gsv').open) hints.push('本地音色还需要 GPT-SoVITS 9880：先跑 voice-local/gsv.bat 等约 40 秒');
    if (route === 'cloud' && !get('cloud').open) hints.push('TTS 路由是云端，但 8767 没监听：先启动云端语音包');
    if (!validation.ok) hints.push(String(validation.reason ?? '角色音色配置有问题'));
    json(res, 200, {
      ok: true,
      checkedAt: new Date().toISOString(),
      engine: 'bridge',
      ports,
      healthy: Boolean(get('voxd').open && (route === 'cloud' ? get('cloud').open : get('gsv').open)),
      bridge: { consoleBase: consoleBase(), reachable: await portOpen(consolePort(), '127.0.0.1', 700), tokenConfigured: Boolean(consoleToken()) },
      config: {
        enabled: voice.enabled === true,
        ttsEnabled: tts.enabled === true,
        route,
        character: String(tts.character ?? ''),
        baseUrl: String(tts.baseUrl ?? ''),
        endpoints: isPlainObject(tts.endpoints) ? tts.endpoints : {},
      },
      packsDir: maskPath(packsDirFromConfig(cfg)),
      characters: chars.characters,
      validation,
      hints,
    });
  }

  // ── 路由分派（前缀 /dsh-surfcore-voice/api）────────────────────────────────
  route('prefix', API_PREFIX, async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname;
    const tail = pathname.slice(API_PREFIX.length).replace(/^\/+/, '');

    if (tail === 'status') {
      if (String(req.method || 'GET').toUpperCase() !== 'GET') { methodNotAllowed(res, 'GET'); return; }
      const { cfg, voice } = readVoiceConfig();
      const tts = isPlainObject(voice.tts) ? voice.tts : {};
      json(res, 200, {
        ok: true,
        plugin: name,
        version: VERSION,
        engine: 'bridge-proxy',
        paths: {
          stateDir: maskPath(STATE_DIR),
          backupDir: maskPath(BACKUP_DIR),
          memoryDir: maskPath(MEMORY_DIR),
          surfcoreRoot: maskPath(QQBOT_ROOT),
          qqConfig: maskPath(QQ_CONFIG),
          packsDir: maskPath(packsDirFromConfig(cfg)),
        },
        files: {
          unified: fs.existsSync(UNIFIED_FILE),
          qqConfig: fs.existsSync(QQ_CONFIG),
          biliConfig: fs.existsSync(BILI_CONFIG),
        },
        bridge: {
          consoleBase: consoleBase(),
          consolePort: consolePort(),
          consoleReachable: await portOpen(consolePort(), '127.0.0.1', 500),
          tokenConfigured: Boolean(consoleToken()),
        },
        voice: {
          enabled: voice.enabled === true,
          ttsEnabled: tts.enabled === true,
          route: tts.route === 'cloud' ? 'cloud' : 'local',
          character: String(tts.character ?? ''),
        },
        ports: VOICE_PORTS,
        lastSelfCheck,
      });
      return;
    }

    if (tail === 'voice/health') { await handleVoiceHealth(req, res); return; }
    if (tail === 'voice/tts') { await handleVoiceTts(req, res); return; }
    if (tail === 'voice/cloud') { await handleVoiceCloud(req, res); return; }
    if (pathname === `${API_PREFIX}/voice/packs/netdisk`) { await openNetdisk(req, res); return; }
    if (pathname === `${API_PREFIX}/voice/packs/sample-open`) { await openSampleFolder(req, res); return; }
    // 其余 /voice/* 全部代理给桥接（安装/启停/导入/试听/规则/云端配置/额度…）。
    if (pathname.startsWith(`${API_PREFIX}/voice/`)) { await proxyVoice(req, res, url); return; }

    json(res, 404, { ok: false, error: `未知接口：${pathname}` });
  });

  // 存活探针：不经过 DSH 鉴权（与其余拆分包一致）。
  route('exact', '/dsh-surfcore-voice/health', async (_req, res) => {
    json(res, 200, { ok: true, name, version: VERSION });
  });

  // 语音链路自检：启动后跑一次（不阻塞插件激活），结果写日志并给 /status 展示。
  selfCheckTimer = setTimeout(() => { void runVoiceSelfCheck(); }, 0);
  selfCheckTimer.unref?.();

  // 卸载：清定时器 / 取消路由注册。
  ctx.effect(() => () => {
    if (selfCheckTimer) clearTimeout(selfCheckTimer);
    selfCheckTimer = null;
    for (const dispose of disposers.splice(0)) { try { dispose(); } catch {} }
  });

  log(`已激活 v${VERSION}；surfcore=${maskPath(QQBOT_ROOT)}；packsDir=${maskPath(packsDirFromConfig(readVoiceConfig().cfg))}`);
}

/** 仅供测试/诊断读取最近一次启动自检结果。 */
export function getLastSelfCheck() {
  return lastSelfCheck;
}

export default { name, inject, apply };
