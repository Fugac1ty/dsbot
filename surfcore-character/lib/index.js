/**
 * surfcore-character —— 角色包创建/切换/存档回档、人格卡解析与编辑、角色迁移
 *
 * 由旧单体插件 surfcore 拆出的**独立、自包含**插件：只 import 包内文件与 Node 内置。
 * 依赖的旧代码在 lib/vendor/（由 tools/vendor.mjs 按仓库相对结构原样复制）。
 *
 * 路由前缀：/dsh-surfcore-character/api
 * 设置栏目 id：surfcore-character（浏览器半边见 lib/client.js）
 *
 * ── 拆分后的关键降级（2026-11-03，见 docs/SPLIT-ARCHITECTURE.md §4.2）────────
 * 旧版 `switchCharacterEverywhere()`（旧 index.js:454-537）会直接停 QQ 桥接会话、
 * 停进程、停 B站 生物钟，再重启它们。拆分后角色包**不允许跨包操作进程**：
 *   · 只写 `<surfcore>/state/needs-bridge-restart.json` 意图文件，由 surfcore-qq 的
 *     自愈 tick 读到后重启桥接并删除标记（消费方负责幂等 + 过期清理）；
 *   · B站/记忆/桌宠各自下一次 tick 读 `characters/current-role.json` 生效。
 * 旧版切换时还会把桥接的 sessions.json/social-v2.json 归档（防旧人格上下文串台）；
 * 拆分后 `<surfcore>/state/*` 归桥接进程所有，本包只读，不再动这两个文件。
 */
import './bootstrap.js'; // 必须第一：先定好 SURFCORE_ROOT，vendored paths 才能解析
import fs from 'node:fs';
import path from 'node:path';
import {
  STATE_DIR, BACKUP_DIR, MEMORY_DIR, UNIFIED_FILE, QQ_CONFIG, BILI_CONFIG, BILI_DIR,
  QQBOT_ROOT, ensureDirs, maskPath,
} from './vendor/plugins/surfcore/lib/paths.js';
import { json, readBody, isLoopbackReq, sameOrigin } from './vendor/plugins/surfcore/lib/http-guard.js';
import { updateJsonFile } from './config-lock.js';
import {
  autoSnapshot, beforeSwitchSnapshot, characterDetail, characterOverview,
  createCharacterFromPayload, deleteCharacter, manualSnapshot, migrateIfNeeded,
  restoreCharacterSnapshot, switchToCharacter, updateCharacterFromPayload,
} from './vendor/plugins/surfcore/lib/characters.js';
import {
  CHARACTERS_DIR, characterPaths, characterPersonaMeta, listSnapshots,
  readCurrentCharacter, removeSnapshot, touchCharacter,
} from './vendor/src/character-persona.js';
import { resolvePersonaFile } from './vendor/plugins/surfcore/lib/persona.js';
import {
  backupFile as backupFileStore, listBackups, readBiliConfig, readJson,
  readUnified, writeJsonAtomic, writeTextAtomic,
} from './vendor/plugins/surfcore/lib/store.js';
import { scanText } from './vendor/plugins/surfcore/lib/privacy.js';
import { roleCharStats, roleSectionReport } from './vendor/src/role-card.js';
import {
  normalizeSelfCard, readQqSelfIdentity, selfCardConfigured, selfIdentityPath,
} from './vendor/src/self-identity.js';

export const name = 'surfcore-character';
export const inject = ['webServer', 'connection'];
export const API_PREFIX = '/dsh-surfcore-character/api';

const VERSION = '0.1.0';
const MAX_PERSONA_BYTES = 64 * 1024;
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const AUTO_SAVE_INITIAL_MS = 10_000;
const AUTO_SAVE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const AUTO_AGE_DAYS = [180, 90, 60, 30, 15, 10, 7, 5, 3, 2, 1];

export const log = (...args) => {
  const line = `[${new Date().toISOString()}] [${name}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  try { console.log(line); } catch {}
  try {
    ensureDirs();
    fs.appendFileSync(path.join(STATE_DIR, 'plugin.log'), `${line}\n`);
  } catch {}
};

/** 旧版 index.js 的 `QQ_STATE_DIR()`：桥接状态目录 = QQ config.json 同级的 state/。 */
function qqStateDir() {
  return path.join(path.dirname(QQ_CONFIG), 'state');
}

/** 跨包意图文件：切换角色后写，surfcore-qq 消费并删除（§4.2）。 */
function bridgeRestartIntentFile() {
  return path.join(qqStateDir(), 'needs-bridge-restart.json');
}

function readTextFile(file, fallback = '') {
  try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; }
}

function mtimeIso(file) {
  try { return fs.statSync(file).mtime.toISOString(); } catch { return null; }
}

function safeBackupName(value) {
  const base = path.basename(String(value ?? ''));
  if (!base || base !== String(value)) return '';
  return base;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 写「桥接需要重启」意图文件（只写文件，不做任何跨包动作）。
 * 格式严格按 docs/SPLIT-ARCHITECTURE.md §4.2：
 *   { action: "restart-bridge", reason: "character-switched", roleId, at }
 * 用临时文件 + rename，避免消费方读到半截 JSON。
 */
function writeBridgeRestartIntent(roleId, reason = 'character-switched') {
  const file = bridgeRestartIntentFile();
  const payload = {
    action: 'restart-bridge',
    reason,
    roleId: String(roleId ?? ''),
    at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
  log(`已写桥接重启意图：${maskPath(file)}（roleId=${payload.roleId}，reason=${reason}）`);
  return { file, ...payload };
}

/** 读意图文件（只读展示；消费与删除是 qq 包的责任）。 */
function readBridgeRestartIntent() {
  const file = bridgeRestartIntentFile();
  const raw = readJson(file, null);
  if (!raw || typeof raw !== 'object') return { file, pending: false, expired: false, intent: null };
  const at = Date.parse(String(raw.at ?? ''));
  const expired = Number.isFinite(at) ? Date.now() - at > 30 * 60 * 1000 : true;
  return { file, pending: !expired, expired, intent: raw };
}

/**
 * 写「当前角色」指针（两份，兼容旧数据 + 新跨包契约）：
 *   1. `<surfcore>/state/current-role.json` —— 旧版桥接/桌宠读的 {role, mode}；
 *   2. `~/.dsh/surfcore/characters/current-role.json` —— 拆分后的跨包只读契约，
 *      带 id / epoch / 人格卡与记忆、B站 账本路径（见 SPLIT-ARCHITECTURE §4.2）。
 * 旧版写 1 时只保留 mode，这里保持一致；2 是新增，旧进程不认识但也不会读。
 */
function writeCharacterRolePointer() {
  const cur = readCurrentCharacter();
  if (!cur) return { ok: true, written: [] };
  const written = [];
  const paths = characterPaths(cur.id);
  const legacyFile = path.join(qqStateDir(), 'current-role.json');
  const old = readJson(legacyFile, {}) ?? {};
  const mode = old.mode === 'silent' ? 'silent' : 'active';
  try {
    writeJsonAtomic(legacyFile, { role: cur.name, mode });
    written.push(legacyFile);
  } catch (error) {
    log('写 state/current-role.json 失败：', String(error?.message ?? error));
  }
  try {
    // 合并而非覆盖：旧文件可能被用户手改过其它字段。
    const crossFile = path.join(CHARACTERS_DIR, 'current-role.json');
    const previous = readJson(crossFile, {}) ?? {};
    writeJsonAtomic(crossFile, {
      ...previous,
      id: cur.id,
      name: cur.name,
      role: cur.name,
      epoch: cur.epoch,
      switchedAt: cur.switchedAt,
      personaFile: paths.persona,
      memoryDir: paths.memoryDir,
      biliDir: paths.biliDir,
      dir: paths.dir,
      mode,
      at: new Date().toISOString(),
    });
    written.push(crossFile);
  } catch (error) {
    log('写 characters/current-role.json 失败：', String(error?.message ?? error));
  }
  return { ok: true, written };
}

/** 旧布局有没有真正要迁的东西：目录存在但为空不算（ensureDirs 会建空目录）。 */
function hasLegacyCharacterData() {
  const nonEmpty = (dir) => {
    try { return fs.readdirSync(dir).length > 0; } catch { return false; }
  };
  return nonEmpty(MEMORY_DIR) || nonEmpty(BILI_DIR);
}

/**
 * 角色迁移（旧记忆/旧 B站 账本 → 第一个角色）。幂等；旧目录保留作冷备份。
 *
 * 2026-11-03 拆分修正：旧版 `migrateIfNeeded()` 只判断目录是否存在，而 apply() 一开始
 * `ensureDirs()` 就会建出空的 MEMORY_DIR / BILI_DIR —— 全新安装也会被误判成「有旧数据」。
 * 这里先做「目录非空」判定，只有真的有旧记忆/旧 B站 账本才迁移首个角色。
 */
function ensureCharacterSystem() {
  if (process.env.SURFCORE_DISABLE_CHARACTER_MIGRATION === '1') {
    return { ok: true, skipped: true, reason: 'disabled' };
  }
  try {
    const existing = readCurrentCharacter();
    if (existing) return { ok: true, skipped: true, reason: 'already-migrated', current: existing };
    if (!hasLegacyCharacterData()) return { ok: true, skipped: true, reason: 'no-legacy-data' };
    const result = migrateIfNeeded({
      personaFile: resolvePersonaFile(),
      memoryDir: MEMORY_DIR,
      biliDir: BILI_DIR,
      stateDir: qqStateDir(),
    });
    if (result.migrated) {
      writeCharacterRolePointer();
      try {
        writeBridgeRestartIntent(result.character?.id ?? result.current?.id, 'character-switched');
      } catch (error) {
        log('角色迁移后写重启意图失败（桥接会继续用旧路径）：', String(error?.message ?? error));
      }
      log(`角色系统：已从旧数据迁移出「${result.character?.name ?? result.current?.name}」（备份 ${maskPath(result.backupDir)}）`);
    }
    return result;
  } catch (error) {
    log('角色系统迁移失败（继续用旧布局）：', String(error?.message ?? error));
    return { ok: false, error: String(error?.message ?? error) };
  }
}

/**
 * 切换角色（拆分版）：只做「旧角色存档 → 原子换指针 → 写两份 current-role → 写重启意图」。
 * 不再停/启桥接进程与 B站 调度器（那是 qq / bili 包的事）。
 */
async function switchCharacterEverywhere(id) {
  const current = readCurrentCharacter();
  if (current && current.id === id) {
    return { ok: true, already: true, current, bridgeRestartRequested: false };
  }
  const target = characterDetail(id).character;
  const warnings = [];
  if (current) {
    try { beforeSwitchSnapshot(current.id); }
    catch (error) { warnings.push(`旧角色切换前存档失败：${String(error?.message ?? error)}`); }
  }
  const switched = switchToCharacter(id);
  const pointer = writeCharacterRolePointer();
  let intent = null;
  try { intent = writeBridgeRestartIntent(id, 'character-switched'); }
  catch (error) {
    warnings.push(`写桥接重启意图失败（桥接不会自动重启）：${String(error?.message ?? error)}`);
  }
  log(`角色已切换：${current?.name ?? '（无）'} → ${target.name}（epoch ${switched.current?.epoch}）`);
  return {
    ok: true,
    current: switched.current,
    previous: current,
    bridgeRestartRequested: Boolean(intent),
    bridgeRestartIntent: intent,
    pointer,
    warnings,
    // 兼容旧 UI 字段：拆分后没有 bridge/scheduler 可操作。
    bridgeRestarted: false,
    scheduler: null,
  };
}

/**
 * 回档（拆分版）：先给当前状态拍 pre-restore，再覆盖人格卡/衰减卡/B站 账本。
 * 全量记忆 append-only，不截断。回档后 epoch +1，并请求桥接重启。
 */
async function restoreEverywhere(id, slot) {
  const current = readCurrentCharacter();
  if (!current || current.id !== id) {
    throw new Error('只能回档当前角色；先加载这个角色再回档');
  }
  const restored = restoreCharacterSnapshot(id, slot);
  writeCharacterRolePointer();
  let intent = null;
  try { intent = writeBridgeRestartIntent(id, 'character-switched'); }
  catch (error) { log('回档后写重启意图失败：', String(error?.message ?? error)); }
  log(`角色已回档：${current.name} → ${restored.restored}（epoch +1，备份 ${restored.backupSlot}）`);
  return {
    ...restored,
    bridgeRestartRequested: Boolean(intent),
    bridgeRestartIntent: intent,
    bridgeRestarted: false,
    scheduler: null,
  };
}

/** 角色自动存档：首 10 秒跑一次，之后每 6 小时（每天最多一份 + 11 个年龄档轮换）。 */
function startCharacterAutoSave() {
  const run = () => {
    try {
      const cur = readCurrentCharacter();
      if (!cur) return;
      const result = autoSnapshot(cur.id);
      if (result?.pruned?.length) log(`角色自动存档：${cur.name} 清理 ${result.pruned.length} 个旧档`);
    } catch (error) {
      log('角色自动存档失败：', String(error?.message ?? error));
    }
  };
  const initial = setTimeout(run, AUTO_SAVE_INITIAL_MS);
  initial.unref?.();
  const timer = setInterval(run, AUTO_SAVE_INTERVAL_MS);
  timer.unref?.();
  return () => {
    try { clearTimeout(initial); } catch {}
    try { clearInterval(timer); } catch {}
  };
}

/** 人格卡文本解析（模式标记/小节/字数）：给设置页做预览，不改任何文件。 */
function parsePersona(text) {
  const source = String(text ?? '');
  try {
    return {
      chars: source.length,
      stats: roleCharStats(source),
      sectionsV1: roleSectionReport(source, 'v1'),
      sectionsV2: roleSectionReport(source, 'v2'),
    };
  } catch (error) {
    return { chars: source.length, stats: null, error: String(error?.message ?? error) };
  }
}

/** 自我认同锚点（只读）：人格名 + QQ/B站 身份，来源分别是角色包 / 桥接落盘 / bili 配置。 */
function readIdentity() {
  const cur = readCurrentCharacter();
  const meta = cur ? characterPersonaMeta(cur.id) : null;
  const qqSelfPath = selfIdentityPath(qqStateDir());
  const qqSelf = readQqSelfIdentity(qqStateDir());
  let biliSelf = { mid: '', name: '' };
  try { biliSelf = { mid: '', name: '', ...(readBiliConfig().config?.self ?? {}) }; } catch {}
  const card = normalizeSelfCard({
    qqNickname: qqSelf.nickname,
    qqUin: qqSelf.userId,
    biliName: biliSelf.name,
    biliMid: biliSelf.mid,
    personaName: meta?.name ?? cur?.name ?? '',
  });
  return {
    ok: true,
    configured: selfCardConfigured(card),
    card,
    sources: {
      persona: cur ? characterPaths(cur.id).persona : '',
      qqSelf: qqSelfPath,
      qqSelfUpdatedAt: qqSelf.updatedAt,
      bili: BILI_CONFIG,
    },
    character: cur
      ? { id: cur.id, name: cur.name, epoch: cur.epoch, personaName: meta?.name ?? cur.name }
      : null,
    note: '只读锚点：QQ 昵称/号来自桥接登录时落的 state/self-identity.json；B站 身份来自 bili.config.json self。',
  };
}

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

  /** 读 JSON 请求体；失败时已写响应并返回 null。 */
  async function readJsonBody(req, res, limit = MAX_BODY_BYTES) {
    let text = '';
    try { text = await readBody(req, limit); }
    catch (error) {
      json(res, 413, { ok: false, error: `请求体过大或读取失败：${String(error?.message ?? error)}` });
      return null;
    }
    if (!String(text).trim()) return {};
    try { return JSON.parse(text); }
    catch { json(res, 400, { ok: false, error: '请求体不是合法 JSON' }); return null; }
  }

  // 角色迁移：启动时一次（SURFCORE_DISABLE_CHARACTER_MIGRATION=1 可关）。
  let characterMigration = ensureCharacterSystem();

  // ── 角色 ────────────────────────────────────────────────────────────────
  async function handleCharacters(req, res, url) {
    if (req.method === 'GET') {
      const id = String(url.searchParams.get('id') ?? '').trim();
      try {
        json(res, 200, id ? characterDetail(id) : { ...characterOverview(), migration: characterMigration });
      } catch (error) {
        json(res, 404, { ok: false, error: String(error?.message ?? error) });
      }
      return;
    }
    if (req.method !== 'POST') { json(res, 405, { ok: false, error: '只支持 GET / POST' }); return; }
    const body = await readJsonBody(req, res);
    if (body === null) return;
    const action = String(body.action ?? '');
    const id = String(body.id ?? readCurrentCharacter()?.id ?? '').trim();
    try {
      if (action === 'create') {
        const created = createCharacterFromPayload(body);
        if (body.load === true) {
          const switched = await switchCharacterEverywhere(created.character.id);
          json(res, 200, { ok: true, created, switched });
        } else {
          json(res, 200, created);
        }
        return;
      }
      if (action === 'load') {
        if (!id) throw new Error('缺少角色 id');
        json(res, 200, await switchCharacterEverywhere(id));
        return;
      }
      if (action === 'update') {
        if (!id) throw new Error('缺少角色 id');
        const result = updateCharacterFromPayload(id, body);
        const cur = readCurrentCharacter();
        if (cur && cur.id === id) writeCharacterRolePointer();
        json(res, 200, result);
        return;
      }
      if (action === 'snapshot') {
        if (!id) throw new Error('缺少角色 id');
        json(res, 200, manualSnapshot(id, { label: String(body.label ?? '') }));
        return;
      }
      if (action === 'auto-snapshot') {
        if (!id) throw new Error('缺少角色 id');
        json(res, 200, autoSnapshot(id, { force: body.force === true }));
        return;
      }
      if (action === 'restore') {
        if (!id) throw new Error('缺少角色 id');
        json(res, 200, await restoreEverywhere(id, String(body.slot ?? '')));
        return;
      }
      if (action === 'migrate') {
        characterMigration = ensureCharacterSystem();
        json(res, 200, characterMigration);
        return;
      }
      if (action === 'delete') {
        if (!id) throw new Error('缺少角色 id');
        json(res, 200, deleteCharacter(id));
        return;
      }
      json(res, 400, { ok: false, error: `未知 action：${action}` });
    } catch (error) {
      json(res, 400, { ok: false, error: String(error?.message ?? error) });
    }
  }

  // ── 存档 / 回档 ─────────────────────────────────────────────────────────
  async function handleSnapshots(req, res, url) {
    if (req.method === 'GET') {
      const wanted = String(url.searchParams.get('id') ?? '').trim();
      const cur = readCurrentCharacter();
      const id = wanted || cur?.id || '';
      if (!id) { json(res, 200, { ok: true, id: '', current: false, snapshots: [], autoAgeDays: AUTO_AGE_DAYS }); return; }
      try {
        json(res, 200, {
          ok: true,
          id,
          current: Boolean(cur && cur.id === id),
          snapshots: listSnapshots(id),
          autoAgeDays: AUTO_AGE_DAYS,
        });
      } catch (error) {
        json(res, 404, { ok: false, error: String(error?.message ?? error) });
      }
      return;
    }
    if (req.method !== 'POST') { json(res, 405, { ok: false, error: '只支持 GET / POST' }); return; }
    const body = await readJsonBody(req, res);
    if (body === null) return;
    const action = String(body.action ?? '');
    const id = String(body.id ?? readCurrentCharacter()?.id ?? '').trim();
    try {
      if (!id) throw new Error('缺少角色 id');
      if (action === 'snapshot' || action === 'manual') {
        json(res, 200, manualSnapshot(id, { label: String(body.label ?? '') }));
        return;
      }
      if (action === 'auto-snapshot' || action === 'auto') {
        json(res, 200, autoSnapshot(id, { force: body.force === true }));
        return;
      }
      if (action === 'restore') {
        json(res, 200, await restoreEverywhere(id, String(body.slot ?? '')));
        return;
      }
      if (action === 'delete') {
        const slot = String(body.slot ?? '');
        if (!slot) throw new Error('缺少 slot');
        json(res, 200, { ok: true, removed: removeSnapshot(id, slot), slot });
        return;
      }
      if (action === 'list') {
        json(res, 200, { ok: true, id, current: readCurrentCharacter()?.id === id, snapshots: listSnapshots(id) });
        return;
      }
      json(res, 400, { ok: false, error: `未知 action：${action}` });
    } catch (error) {
      json(res, 400, { ok: false, error: String(error?.message ?? error) });
    }
  }

  // ── 人格卡 ──────────────────────────────────────────────────────────────
  async function handlePersona(req, res) {
    if (req.method === 'GET') {
      const file = resolvePersonaFile();
      const text = readTextFile(file);
      const cur = readCurrentCharacter();
      const meta = cur ? characterPersonaMeta(cur.id) : null;
      let configured = {};
      try { configured = { ...(readUnified().config?.persona ?? {}) }; } catch {}
      json(res, 200, {
        ok: true,
        path: file,
        text,
        chars: text.length,
        mtime: mtimeIso(file),
        backups: listBackups(80).filter((item) => String(item.name).startsWith('persona')),
        parse: parsePersona(text),
        source: cur ? 'character' : (String(configured.file ?? '').trim() ? 'config' : 'default'),
        activeCharacter: cur
          ? { id: cur.id, name: cur.name, epoch: cur.epoch, personaName: meta?.name ?? cur.name }
          : null,
        // unified.persona 只是兼容路径：有当前角色时人格卡唯一真相是角色包里的 persona.md。
        config: configured,
        note: 'QQ 与 B站 共用这一张人格卡；有当前角色时唯一真相是角色包内的 persona.md（unified.persona.file 仅作旧路径兼容）。',
      });
      return;
    }
    if (req.method !== 'POST') { json(res, 405, { ok: false, error: '只支持 GET / POST' }); return; }
    const body = await readJsonBody(req, res);
    if (body === null) return;
    try {
      // action=restore：从 backups/persona-* 恢复
      if (body.action === 'restore') {
        const backupName = safeBackupName(body.name);
        if (!backupName) { json(res, 400, { ok: false, error: '备份名非法' }); return; }
        const source = path.join(BACKUP_DIR, backupName);
        if (!fs.existsSync(source)) { json(res, 404, { ok: false, error: '备份不存在' }); return; }
        const target = resolvePersonaFile();
        const backup = backupFileStore(target, 'persona');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
        const cur = readCurrentCharacter();
        if (cur) touchCharacter(cur.id);
        writeCharacterRolePointer();
        json(res, 200, { ok: true, restored: backupName, backup, path: target, text: readTextFile(target) });
        return;
      }
      // action=config：只改 unified config 的 persona 键（走 config-lock，不动别的键）
      if (body.action === 'config' || body.persona !== undefined || body.personaFile !== undefined) {
        const patch = isPlainObject(body.persona) ? body.persona : {};
        if (body.personaFile !== undefined) patch.file = body.personaFile;
        if (body.file !== undefined) patch.file = body.file;
        if (body.injectInBili !== undefined) patch.injectInBili = body.injectInBili;
        if (body.compactChars !== undefined) patch.compactChars = body.compactChars;
        if (typeof patch.file === 'string' && patch.file.length > 2048) {
          json(res, 400, { ok: false, error: 'persona.file 路径过长' }); return;
        }
        const next = updateJsonFile(UNIFIED_FILE, (cfg) => {
          const persona = isPlainObject(cfg.persona) ? cfg.persona : (cfg.persona = {});
          if (patch.file !== undefined) persona.file = String(patch.file ?? '').trim();
          if (patch.injectInBili !== undefined) persona.injectInBili = patch.injectInBili !== false;
          if (patch.compactChars !== undefined) {
            const n = Math.round(Number(patch.compactChars));
            persona.compactChars = Number.isFinite(n) && n > 0 ? Math.min(20_000, n) : 2200;
          }
          return cfg;
        }, { backupLabel: 'persona', fallback: {} });
        json(res, 200, {
          ok: true,
          config: { ...(next.persona ?? {}) },
          note: '已写入 unified config 的 persona 键（走 config-lock，其它键未动）。有当前角色时这只作为兼容路径。',
        });
        return;
      }
      // 默认：保存人格卡文本
      const text = String(body.text ?? '');
      if (text.length < 50) { json(res, 400, { ok: false, error: '人设卡太短（至少 50 字）' }); return; }
      if (Buffer.byteLength(text, 'utf8') > MAX_PERSONA_BYTES) { json(res, 400, { ok: false, error: '人设卡超过 64KB' }); return; }
      const scan = scanText(text);
      const severe = scan.secrets.length > 0 || scan.pii.some((hit) => hit.severe);
      if (severe) {
        json(res, 400, {
          ok: false,
          error: '人设卡里命中密钥/密码/身份证/住址规则，拒绝保存',
          labels: [...new Set([...scan.secrets, ...scan.pii.filter((hit) => hit.severe)].map((hit) => hit.label))],
        });
        return;
      }
      const target = resolvePersonaFile();
      const backup = backupFileStore(target, 'persona');
      writeTextAtomic(target, text.endsWith('\n') ? text : `${text}\n`);
      const cur = readCurrentCharacter();
      if (cur) touchCharacter(cur.id);
      writeCharacterRolePointer();
      json(res, 200, { ok: true, chars: text.length, backup, path: target, mtime: mtimeIso(target) });
    } catch (error) {
      json(res, 400, { ok: false, error: String(error?.message ?? error) });
    }
  }

  // ── 自检 / 身份 ─────────────────────────────────────────────────────────
  function handleStatus(res) {
    const cur = readCurrentCharacter();
    const intent = readBridgeRestartIntent();
    let counts = { characters: 0, snapshots: 0 };
    try {
      const overview = characterOverview();
      counts = { characters: overview.characters.length, snapshots: cur ? overview.snapshots.length : 0 };
    } catch {}
    json(res, 200, {
      ok: true,
      plugin: name,
      version: VERSION,
      apiPrefix: API_PREFIX,
      paths: {
        stateDir: maskPath(STATE_DIR),
        memoryDir: maskPath(MEMORY_DIR),
        charactersDir: maskPath(CHARACTERS_DIR),
        backupDir: maskPath(BACKUP_DIR),
        qqStateDir: maskPath(qqStateDir()),
        qqbotRoot: maskPath(QQBOT_ROOT),
      },
      files: {
        unified: fs.existsSync(UNIFIED_FILE),
        qqConfig: fs.existsSync(QQ_CONFIG),
        biliConfig: fs.existsSync(BILI_CONFIG),
        persona: fs.existsSync(resolvePersonaFile()),
      },
      current: cur
        ? { id: cur.id, name: cur.name, epoch: cur.epoch, switchedAt: cur.switchedAt, dir: maskPath(cur.dir) }
        : null,
      counts,
      migration: characterMigration,
      persona: {
        path: maskPath(resolvePersonaFile()),
        source: cur ? 'character' : 'config-or-default',
      },
      autoSave: { initialDelayMs: AUTO_SAVE_INITIAL_MS, intervalMs: AUTO_SAVE_INTERVAL_MS },
      bridgeRestart: {
        pending: intent.pending,
        expired: Boolean(intent.expired),
        file: maskPath(intent.file),
        // 本包不直接操作桥接：只写意图，由 surfcore-qq 的自愈 tick 消费。
        owner: 'surfcore-qq',
      },
      capabilities: {
        characters: true,
        snapshots: true,
        persona: true,
        personaParse: true,
        identity: true,
        bridgeRestartIntent: true,
      },
    });
  }

  // ── 路由 ────────────────────────────────────────────────────────────────
  route('prefix', API_PREFIX, async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname;
    if (pathname === `${API_PREFIX}/characters`) { await handleCharacters(req, res, url); return; }
    if (pathname === `${API_PREFIX}/characters/snapshot`) { await handleSnapshots(req, res, url); return; }
    if (pathname === `${API_PREFIX}/persona`) { await handlePersona(req, res); return; }
    if (pathname === `${API_PREFIX}/identity`) {
      if (req.method !== 'GET') { json(res, 405, { ok: false, error: '只支持 GET' }); return; }
      json(res, 200, readIdentity());
      return;
    }
    if (pathname === `${API_PREFIX}/status`) { handleStatus(res); return; }
    json(res, 404, { ok: false, error: `未知接口：${pathname}` });
  });

  route('exact', '/dsh-surfcore-character/health', async (_req, res) => {
    json(res, 200, { ok: true, name, version: VERSION });
  });

  // 角色自动存档：首 10 秒、之后 6 小时；.unref() + ctx.effect 清理。
  ctx.effect(() => {
    const stop = startCharacterAutoSave();
    return () => { try { stop(); } catch {} };
  });

  // 卸载：清路由。
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) { try { dispose(); } catch {} }
  });

  log(`已激活；stateDir=${maskPath(STATE_DIR)}；当前角色=${readCurrentCharacter()?.name ?? '（无）'}`);
}

export default { name, inject, apply };
