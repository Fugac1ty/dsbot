/**
 * 跨插件配置锁 + 原子写 + 备份（每个拆分包自带一份，协议相同）。
 *
 * 拆分后多个插件会读写同一批 JSON 文件（~/.dsh/surfcore/config.json、
 * <surfcore>/config.json、bili.config.json …）。协议只有三条：
 *
 *   1. **写前拿锁**：`<STATE_DIR>/config.lock` 目录（mkdir 是原子的）。
 *      锁内 <10s 未释放视为陈旧可抢占；拿不到锁最多等 10s 后报错（绝不静默丢写）。
 *   2. **锁内完成整轮 读-改-写**：只改自己负责的键，其它键原样写回。
 *      不允许「锁外读、锁内写」。
 *   3. **覆盖前备份**：`<STATE_DIR>/backups/<文件名>.<时间戳>`，只留最近 40 份；
 *      写临时文件再 rename，进程被杀不会留下半截 JSON。
 *
 * ⚠️ 旧单体插件不认识这把锁：**迁移期不要同时运行新旧两边**（见 docs/MIGRATION.md）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR, BACKUP_DIR, ensureDirs } from './vendor/plugins/surfcore/lib/paths.js';

const LOCK_DIR = path.join(STATE_DIR, 'config.lock');
const LOCK_WAIT_MS = 10_000;
const LOCK_STALE_MS = 10_000;
const BACKUP_KEEP = 40;

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* 极端环境不支持就忙等 */ }
}

/** 在配置锁内执行 fn（同步函数，返回什么就返回什么）。 */
export function withConfigLock(fn, { waitMs = LOCK_WAIT_MS, label = 'config' } = {}) {
  ensureDirs();
  const started = Date.now();
  let held = false;
  for (;;) {
    try {
      fs.mkdirSync(LOCK_DIR);
      held = true;
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        const stat = fs.statSync(LOCK_DIR);
        stale = Date.now() - stat.mtimeMs > LOCK_STALE_MS;
      } catch { stale = true; }
      if (stale) {
        try { fs.rmSync(LOCK_DIR, { recursive: true, force: true }); } catch {}
        continue;
      }
      if (Date.now() - started > waitMs) throw new Error(`等待配置锁超时（${label}）：${LOCK_DIR}`);
      sleepSync(25);
    }
  }
  try {
    return fn();
  } finally {
    if (held) { try { fs.rmSync(LOCK_DIR, { recursive: true, force: true }); } catch {} }
  }
}

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function safeStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

/** 覆盖前备份（保留最近 BACKUP_KEEP 份），返回备份路径或空串。 */
export function backupFile(file, label = '') {
  try {
    if (!fs.existsSync(file)) return '';
    ensureDirs();
    const base = path.basename(file);
    const name = `${base}${label ? `.${String(label).replace(/[^\w.-]+/g, '-')}` : ''}.${safeStamp()}`;
    const dest = path.join(BACKUP_DIR, name);
    fs.copyFileSync(file, dest);
    pruneBackups();
    return dest;
  } catch { return ''; }
}

export function pruneBackups(keep = BACKUP_KEEP) {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .map((name) => ({ name, mtime: fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const file of files.slice(keep)) {
      try { fs.rmSync(path.join(BACKUP_DIR, file.name), { force: true }); } catch {}
    }
  } catch {}
}

export function writeJsonAtomic(file, value, { mode = 0o600 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, mode); } catch {}
}

/**
 * 锁内 读-改-写 一个 JSON 文件。
 * mutator 收到当前对象（可能是 fallback），返回新对象或就地修改后返回它。
 * 返回最终写下的对象。
 */
export function updateJsonFile(file, mutator, { fallback = {}, backupLabel = '', mode = 0o600 } = {}) {
  return withConfigLock(() => {
    const current = readJson(file, null) ?? JSON.parse(JSON.stringify(fallback));
    const next = mutator(current) ?? current;
    backupFile(file, backupLabel);
    writeJsonAtomic(file, next, { mode });
    return next;
  }, { label: path.basename(file) });
}

/** 锁内只读（避免读到别的插件写了一半的旧值）。 */
export function readJsonLocked(file, fallback = null) {
  return withConfigLock(() => readJson(file, fallback), { label: path.basename(file) });
}

export { LOCK_DIR, BACKUP_KEEP };
