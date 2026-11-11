/**
 * 目的机制的配置读 / 写（`<dsbot>/config.json` 的 `purpose.*`）。
 *
 * 为什么由本包写：拆分后「目的」页在桌宠栏目里（PLAN §3），载体在桌宠/QQ 之间切换、
 * 节奏参数、桌宠形式、离线回落都在这里改。`purpose.*` 是 QQ 配置里的**共享子树**：
 * QQ 桥接只读它，桌宠包只改这一段。写必须走 config-lock：锁内读-改-写，只碰 `purpose`
 * 这一棵树，其它键（ownerQQ / socialV2 / …）原样写回，覆盖前备份。
 *
 * ⚠️ 已知跨包约定：SPLIT-ARCHITECTURE §4.1 把 `<dsbot>/config.json` 的写者写成
 * dsbot-qq（voice/biliBridge 为已登记例外）。目的是 qq/pet 共享配置，本包按「只写
 * purpose 子树 + 走锁」的方式处理，已在交付报告里标注，待架构文档补登例外。
 */
import { QQ_CONFIG } from './vendor/plugins/dsbot/lib/paths.js';
import { readJson, updateJsonFile } from './config-lock.js';

/** 数值型键（单位见注释；只做范围收敛，不阻断保存）。 */
const NUMBER_KEYS = new Map([
  ['gapMinMs', [5 * 60_000, 24 * 60 * 60_000]],
  ['gapMaxMs', [5 * 60_000, 24 * 60 * 60_000]],
  ['initialDelayMinMs', [60_000, 720 * 60_000]],
  ['dailyMax', [0, 24]],
  ['idleThresholdMs', [0, 720 * 60_000]],
  ['materialWindowHours', [1, 336]],
  ['biliWindowDays', [1, 60]],
  ['maxMaterials', [6, 80]],
  ['minMaterials', [0, 20]],
  ['maxCandidates', [3, 10]],
  ['retryMs', [60_000, 360 * 60_000]],
  ['maxAttempts', [1, 10]],
  ['promptMaxChars', [4000, 30_000]],
]);

const TEXT_KEYS = new Set(['quietStart', 'quietEnd', 'ownerUin']);
const ENUM_KEYS = new Map([
  ['carrier', ['pet', 'qq']],
  ['petModality', ['text', 'voice']],
]);
const BOOLEAN_KEYS = new Set(['enabled', 'petFallbackToQQ']);

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** 只读：当前 purpose 配置（原始值，不做 normalize；UI 自己带默认值兜底）。 */
export function readPurposeConfig() {
  const qq = readJson(QQ_CONFIG, {}) ?? {};
  const raw = qq?.purpose && typeof qq.purpose === 'object' && !Array.isArray(qq.purpose) ? qq.purpose : {};
  return {
    purpose: raw,
    carrier: raw.carrier === 'pet' ? 'pet' : 'qq',
    modality: raw.petModality === 'voice' ? 'voice' : 'text',
    fallbackToQQ: raw.petFallbackToQQ !== false,
  };
}

/**
 * 锁内只改 `purpose` 子树。返回 `{ ok, purpose, changed }`。
 * 未知键一律忽略（防止表单把 UI 状态写进配置）；非法枚举值报错（不静默改错载体）。
 */
export function writePurposeConfig(patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('purpose 必须是 JSON 对象');
  }
  let changed = [];
  const next = updateJsonFile(QQ_CONFIG, (cfg) => {
    const root = cfg && typeof cfg === 'object' ? cfg : {};
    const current = root.purpose && typeof root.purpose === 'object' && !Array.isArray(root.purpose) ? root.purpose : {};
    const merged = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      if (ENUM_KEYS.has(key)) {
        const allowed = ENUM_KEYS.get(key);
        if (!allowed.includes(value)) throw new Error(`${key} 只能是 ${allowed.join(' / ')}`);
        merged[key] = value;
        changed.push(key);
        continue;
      }
      if (BOOLEAN_KEYS.has(key)) {
        merged[key] = value !== false;
        changed.push(key);
        continue;
      }
      if (NUMBER_KEYS.has(key)) {
        const n = Number(value);
        if (!Number.isFinite(n)) throw new Error(`${key} 必须是数字`);
        const [min, max] = NUMBER_KEYS.get(key);
        merged[key] = Math.round(clamp(n, min, max));
        changed.push(key);
        continue;
      }
      if (TEXT_KEYS.has(key)) {
        merged[key] = String(value ?? '').trim().slice(0, 64);
        changed.push(key);
        continue;
      }
      // 未知键：忽略（UI 可能带 __draft 之类的临时字段）。
    }
    root.purpose = merged;
    return root;
  }, { backupLabel: 'purpose' });
  changed = [...new Set(changed)];
  return { ok: true, purpose: next.purpose ?? {}, changed };
}
