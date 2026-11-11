/**
 * 桌宠对话用量（拆分包版本，**新契约**）。
 *
 * 旧单体插件里 `pet-chat.js` 直接调 `tokenBudget.recordExternalUsage()`，把用量
 * 记进 `token-usage-state.json`。拆分后 `~/.dsh/dsbot/token-usage-*.json` 归
 * `dsbot-token` 独占（见 SPLIT-ARCHITECTURE §4.1），所以本包改成：
 *
 *   1. **append-only** 写 `~/.dsh/dsbot/token-usage-pet.jsonl`，一行一次模型调用，
 *      每行至少含 `at` / `day` / `model` / `usage`（token 包按这四个字段汇总进「其他」）。
 *   2. 额度闸门降级为**读快照**：`token-usage-daily.json`（token 包写）+ `token-budget.json`
 *      （额度）。读不到 / 不是今天 = 不拦（fail-open），并在 `/status` 里报
 *      `tokenGate: 'unavailable'`——绝不因为另一个包没装就把桌宠聊死。
 *
 * `pet-chat.js` / `pet-purpose.js` 是 vendored 原样代码，它们只认
 * `tokenBudget.recordExternalUsage()` 与 `tokenBudget.block(scope)` 这两个形状；
 * 这里导出的 `adapter` 就是给它们用的兼容壳（不改 vendor）。见 lib/index.js。
 */
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from './vendor/plugins/dsbot/lib/paths.js';

/** append-only 用量文件（本包唯一写者）。 */
export const PET_USAGE_FILE_NAME = 'token-usage-pet.jsonl';
/** token 包写的当日快照（本包只读）。 */
export const DAILY_FILE_NAME = 'token-usage-daily.json';
/** 额度文件（本包只读）。 */
export const BUDGET_FILE_NAME = 'token-budget.json';

const UNITS = ['cny', 'tokens'];

function pad(n) {
  return String(n).padStart(2, '0');
}

/** 本地日键（与 token 包的 localDayKey 同口径：自然日，不是 UTC 日）。 */
export function localDayKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * 把 DSH llm 的 usage（`inputTokens`/`outputTokens`/`cacheReadTokens`…）归一成
 * token 包的五个桶（cacheMiss/cacheHit/cacheWrite/output/reasoning）。
 * 与 `src/model-prices.js` 的 normalizeUsage 同口径，但本包不 vendor 那个文件。
 */
export function normalizePetUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const pick = (...keys) => {
    for (const key of keys) {
      const v = Number(usage?.[key]);
      if (Number.isFinite(v) && v > 0) return Math.round(v);
    }
    return 0;
  };
  return {
    cacheMiss: pick('cacheMiss', 'uncachedInputTokens', 'inputTokens'),
    cacheHit: pick('cacheHit', 'cacheReadTokens'),
    cacheWrite: pick('cacheWrite', 'cacheWriteTokens'),
    output: pick('output', 'outputTokens'),
    reasoning: pick('reasoning', 'reasoningTokens'),
  };
}

export function totalOfBuckets(buckets) {
  const b = buckets ?? {};
  return num(b.cacheMiss) + num(b.cacheHit) + num(b.cacheWrite) + num(b.output);
}

/**
 * @param {object} opts
 * @param {string} [opts.stateDir]  ~/.dsh/dsbot（默认取 vendored paths.js）
 * @param {(msg:string,...args:any[])=>void} [opts.log]
 * @param {() => number} [opts.now]
 */
export function createPetTokenUsage({ stateDir = STATE_DIR, log = () => {}, now = () => Date.now() } = {}) {
  const usageFile = path.join(stateDir, PET_USAGE_FILE_NAME);
  const dailyFile = path.join(stateDir, DAILY_FILE_NAME);
  const budgetFile = path.join(stateDir, BUDGET_FILE_NAME);
  let appended = 0;
  let lastError = '';

  function ensureDir() {
    try { fs.mkdirSync(path.dirname(usageFile), { recursive: true }); } catch {}
  }

  /** 追加一行用量。返回是否写成功（写失败只记日志，不影响对话本身）。 */
  function append(record) {
    const buckets = normalizePetUsage(record?.usage);
    if (!buckets || totalOfBuckets(buckets) === 0) return false;
    const at = Number(record?.at) || now();
    const line = {
      at,
      day: localDayKey(at),
      model: String(record?.model ?? ''),
      usage: buckets,
      tokens: totalOfBuckets(buckets),
      category: 'other',
      sessionId: String(record?.sessionId ?? 'pet-chat'),
      label: String(record?.label ?? '桌宠对话'),
      source: 'dsbot-pet',
    };
    try {
      ensureDir();
      const first = !fs.existsSync(usageFile);
      fs.appendFileSync(usageFile, `${JSON.stringify(line)}\n`, { encoding: 'utf8', mode: 0o600 });
      if (first) { try { fs.chmodSync(usageFile, 0o600); } catch {} }
      appended += 1;
      lastError = '';
      return true;
    } catch (error) {
      lastError = String(error?.message ?? error).slice(0, 160);
      log('[token-usage-pet] 追加用量失败：', lastError);
      return false;
    }
  }

  function readDaily() {
    const raw = readJson(dailyFile, null);
    if (!raw || typeof raw !== 'object') return null;
    if (raw.day !== localDayKey(now())) return null;
    return raw;
  }

  function readLimits() {
    const raw = readJson(budgetFile, null);
    const limits = raw && typeof raw === 'object' && raw.limits && typeof raw.limits === 'object' ? raw.limits : null;
    return limits;
  }

  function ratioOf(used, limit) {
    const l = Number(limit);
    if (!Number.isFinite(l) || l <= 0) return null;
    const u = Number(used);
    return (Number.isFinite(u) && u > 0 ? u : 0) / l;
  }

  /** 该口径（含 total）是否已经用满。只有 token 包写的快照可读时才判断。 */
  function evaluate(scope) {
    const daily = readDaily();
    if (!daily) return { available: false, blocked: false, hits: [] };
    const limits = readLimits();
    // 没有额度文件 = 默认不限（token 包不在装时也必须 fail-open）。
    if (!limits) return { available: true, blocked: false, hits: [] };
    const hits = [];
    for (const name of [scope, 'total']) {
      if (!name) continue;
      const limit = limits[name];
      if (!limit || typeof limit !== 'object') continue;
      const usedEntry = name === 'total' ? daily.total : daily[name];
      const used = usedEntry && typeof usedEntry === 'object' ? usedEntry : {};
      for (const unit of UNITS) {
        const ratio = ratioOf(used[unit], limit[unit]);
        if (ratio !== null && ratio >= 1) hits.push({ scope: name, unit, ratio, used: num(used[unit]), limit: Number(limit[unit]) });
      }
    }
    return { available: true, blocked: hits.length > 0, hits };
  }

  /**
   * 与旧 `tokenBudget.block(scope)` 兼容的闸门。
   * 返回 `{ blocked, message, available, hits }`；读不到快照一律不拦。
   */
  async function block(scope = 'other') {
    const result = evaluate(scope);
    if (!result.available) return { ...result, message: '' };
    const unitLabel = { cny: '元', tokens: 'token' };
    const message = result.blocked
      ? result.hits.map((h) => `${h.scope}/${unitLabel[h.unit] ?? h.unit} 已到上限`).join('；')
      : '';
    return { ...result, message };
  }

  /** 给 vendored pet-chat / pet-purpose 用的兼容壳（形状与旧 tokenBudget 一致）。 */
  const adapter = {
    recordExternalUsage: (record = {}) => append(record),
    block,
  };

  return {
    usageFile,
    dailyFile,
    budgetFile,
    adapter,
    append,
    block,
    /** `/status` 里报的闸门状态：快照可读 = file-snapshot，否则 unavailable（fail-open）。 */
    gateStatus() {
      return readDaily() ? 'file-snapshot' : 'unavailable';
    },
    stats() {
      return { appended, lastError, usageFile };
    },
  };
}
