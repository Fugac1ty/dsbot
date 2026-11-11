/**
 * dsbot-token —— 每日 token 额度与用量采集（由旧合体插件 dsbot 拆出）。
 *
 * 拆出来的这一块是「唯一能同时看到 QQ / B站 / 黑话学习会话的地方」：
 *   · 用 ctx.on('session/event') 实时累计所有已提交 assistant usage；
 *   · 按事件时间计价、按本地自然日归零、按会话 id/标题归类到 QQ / B站 / 其他 / 总额；
 *   · 启动回填「插件起来之前今天已经花掉的」；
 *   · 把每日快照写进 ~/.dsh/dsbot/token-usage-daily.json，供 B站 调度器做闸门只读判断。
 *
 * 自包含：只 import 包内文件 + Node 内置；旧代码在 lib/vendor/（tools/vendor.mjs 原样复制，
 * 保持仓库相对结构，所以 vendor 文件内部一行 import 都没改）。
 *
 * 跨包契约（见 docs/SPLIT-ARCHITECTURE.md §4）：
 *   · 本包独占写 token-budget.json / token-usage-state.json / token-usage-daily.json；
 *   · 桌宠（dsbot-pet）把用量 append 到 token-usage-pet.jsonl，本包按字节水位消费，
 *     计入「其他」口径；水位存 token-usage-pet.ingest.json（本包独占）。
 */
import './bootstrap.js'; // 必须第一：先定好 DSBOT_ROOT，vendored paths 才能解析
import fs from 'node:fs';
import path from 'node:path';
import {
  DSH_HOME, QQ_STATE_DIR, QQ_CONFIG, STATE_DIR, ensureDirs, maskPath,
} from './vendor/plugins/dsbot/lib/paths.js';
import { json, readBody, isLoopbackReq, sameOrigin } from './vendor/plugins/dsbot/lib/http-guard.js';
import { createTokenBudgetService } from './vendor/plugins/dsbot/lib/token-budget.js';
import { localDayKey } from './vendor/plugins/dsbot/lib/token-usage-pure.js';
import { readJson, backupFile } from './config-lock.js';

export const name = 'dsbot-token';
export const inject = ['webServer', 'connection'];
export const API_PREFIX = '/dsh-dsbot-token/api';

/** 桌宠对话用量（append-only，由 dsbot-pet 写）与本包的消费水位。 */
const PET_USAGE_FILE = path.join(STATE_DIR, 'token-usage-pet.jsonl');
const PET_USAGE_WATERMARK = path.join(STATE_DIR, 'token-usage-pet.ingest.json');

const log = (...args) => {
  const line = `[${new Date().toISOString()}] [${name}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  try { console.log(line); } catch {}
  try {
    ensureDirs();
    fs.appendFileSync(path.join(STATE_DIR, 'plugin.log'), `${line}\n`);
  } catch {}
};

export function apply(ctx) {
  ensureDirs();

  const tokenBudget = createTokenBudgetService({
    ctx,
    dshHome: DSH_HOME,
    qqStateDir: QQ_STATE_DIR,
    // 只读 QQ 配置：价目表、默认模型、额度兜底值都在里面。读不需要锁。
    getQqConfig: () => readJson(QQ_CONFIG, {}) ?? {},
    log: (message) => log(String(message)),
  });

  // ── 实时采集 ────────────────────────────────────────────────────────────
  // 注册失败只记日志，不让整个插件起不来（旧插件同样的取舍）。
  let sessionEventOff = null;
  try {
    if (typeof ctx.on === 'function') {
      sessionEventOff = ctx.on('session/event', (session, event) => {
        try { tokenBudget.ingestEvent(session, event); }
        catch (error) { log('token 用量采集失败：', String(error?.message ?? error).slice(0, 160)); }
      });
    }
  } catch (error) {
    log('token 用量采集监听注册失败：', String(error?.message ?? error));
  }

  // ── 桌宠用量消费（新契约）──────────────────────────────────────────────
  // dsbot-pet 只 append 到 token-usage-pet.jsonl；本包按字节水位读取，
  // 每条只记一次，然后计入「其他」。文件被截断/轮转时水位归零重读。
  let petIngestState = { offset: 0, lastAt: null, ingested: 0 };
  try { petIngestState = { ...petIngestState, ...(readJson(PET_USAGE_WATERMARK, {}) ?? {}) }; } catch {}

  function petUsageStatus() {
    let size = 0;
    try { size = fs.statSync(PET_USAGE_FILE).size; } catch {}
    return {
      file: maskPath(PET_USAGE_FILE),
      bytes: size,
      offset: Math.min(Number(petIngestState.offset) || 0, size),
      ingested: Number(petIngestState.ingested) || 0,
      lastAt: petIngestState.lastAt ?? null,
    };
  }

  function savePetWatermark() {
    try {
      const tmp = `${PET_USAGE_WATERMARK}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(petIngestState, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, PET_USAGE_WATERMARK);
    } catch (error) { log('写桌宠用量水位失败：', String(error?.message ?? error)); }
  }

  function ingestPetUsage() {
    let stat;
    try { stat = fs.statSync(PET_USAGE_FILE); } catch { return { ingested: 0, reason: 'no-file' }; }
    const offset = Number(petIngestState.offset) || 0;
    if (stat.size < offset) { // 被截断/轮转：从头再读（已消费的行本来也不会重复记到同一天）
      petIngestState.offset = 0;
    }
    const from = Number(petIngestState.offset) || 0;
    if (stat.size <= from) return { ingested: 0, reason: 'up-to-date' };
    let text = '';
    try {
      const fd = fs.openSync(PET_USAGE_FILE, 'r');
      try {
        const buf = Buffer.alloc(stat.size - from);
        fs.readSync(fd, buf, 0, buf.length, from);
        text = buf.toString('utf8');
      } finally { fs.closeSync(fd); }
    } catch (error) {
      log('读桌宠用量失败：', String(error?.message ?? error));
      return { ingested: 0, reason: 'read-failed' };
    }
    // 只消费到最后一个换行：半行留到下一次，避免把写到一半的 JSON 记进去。
    const lastNewline = text.lastIndexOf('\n');
    if (lastNewline < 0) return { ingested: 0, reason: 'partial-line' };
    const consumable = text.slice(0, lastNewline + 1);
    const today = localDayKey(Date.now());
    let ingested = 0;
    for (const line of consumable.split('\n')) {
      const raw = line.trim();
      if (!raw) continue;
      let row;
      try { row = JSON.parse(raw); } catch { continue; }
      const at = Number(row?.at) || Date.now();
      // 只记「今天」的：跨天的旧行记进当天会污染当日额度（recordExternalUsage 按 at 归日）。
      if (localDayKey(at) !== today) continue;
      try {
        const ok = tokenBudget.recordExternalUsage({
          category: 'other',
          sessionId: String(row?.sessionId || 'pet-chat'),
          model: String(row?.model || ''),
          usage: row?.usage ?? row?.buckets ?? null,
          at,
          label: String(row?.label || '桌宠对话'),
        });
        if (ok) ingested++;
      } catch (error) {
        log('桌宠用量记账失败：', String(error?.message ?? error).slice(0, 160));
      }
    }
    petIngestState.offset = from + Buffer.byteLength(consumable, 'utf8');
    petIngestState.ingested = (Number(petIngestState.ingested) || 0) + ingested;
    petIngestState.lastAt = new Date().toISOString();
    savePetWatermark();
    return { ingested, reason: 'ok' };
  }

  // 启动先消费一次，之后每分钟兜底（桌宠是另一个进程，append 没有回调可挂）。
  let petIngestTimer = null;
  try { ingestPetUsage(); } catch (error) { log('启动消费桌宠用量失败：', String(error?.message ?? error)); }
  petIngestTimer = setInterval(() => { try { ingestPetUsage(); } catch {} }, 60_000);
  petIngestTimer.unref?.();

  // ── 路由 ────────────────────────────────────────────────────────────────
  const disposers = [];

  /** 四层准入 + 统一 500，与旧插件 lib/index.js 的 route() 语义一致。 */
  function route(kind, pathname, handler) {
    disposers.push(ctx.webServer.register({
      kind,
      path: pathname,
      handler: async (req, res) => {
        const trusted = (() => {
          try {
            const list = readJson(QQ_CONFIG, {})?.httpGuard?.trustedProxyHosts;
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

  // GET  : 额度 + 今日四口径用量 + 比例 + 当天唯一的 80% 提醒（取走即落盘）
  // POST : { limits } 整体保存 / { add:{scope,unit,amount} } 快捷加额度 / { reset:true } 清空
  async function handleTokenBudget(req, res, url) {
    if (req.method === 'GET') {
      const takeAlertFlag = url?.searchParams?.get('alert') !== '0';
      // 读之前顺手消费一次桌宠用量，保证看板与闸门看到的是同一份。
      try { ingestPetUsage(); } catch {}
      json(res, 200, await tokenBudget.status({ takeAlertFlag }));
      return;
    }
    if (req.method !== 'POST') { json(res, 405, { ok: false, error: '只支持 GET / POST' }); return; }
    let body;
    try {
      body = JSON.parse((await readBody(req)) || '{}');
    } catch {
      json(res, 400, { ok: false, error: '请求体不是合法 JSON' });
      return;
    }
    try {
      if (body?.reset === true) {
        backupFile(tokenBudget.budgetFile, 'token-budget-before-reset');
        tokenBudget.resetLimits();
      } else if (body?.add && typeof body.add === 'object') {
        backupFile(tokenBudget.budgetFile, 'token-budget-before-add');
        tokenBudget.addLimit(body.add.scope, body.add.unit, body.add.amount);
      } else if (body?.limits !== undefined) {
        backupFile(tokenBudget.budgetFile, 'token-budget-before-save');
        tokenBudget.saveLimits(body.limits);
      } else {
        throw new Error('缺少 limits，或 add / reset');
      }
      json(res, 200, await tokenBudget.status({ takeAlertFlag: false }));
    } catch (error) {
      json(res, 400, { ok: false, error: `保存额度失败：${String(error?.message ?? error)}` });
    }
  }

  route('prefix', API_PREFIX, async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const tail = url.pathname.slice(API_PREFIX.length).replace(/^\/+/, '');
    if (tail === 'token-budget') { await handleTokenBudget(req, res, url); return; }
    if (tail === 'token-usage') {
      // 明细视图：状态 + 每个会话的归类 + 价目表版本（旧设置页「用量明细」用的就是这些）。
      const status = await tokenBudget.status({ takeAlertFlag: false });
      const peek = tokenBudget._peek?.() ?? {};
      json(res, 200, {
        ok: true,
        day: status.day,
        usage: status.usage,
        ratios: status.ratios,
        blocked: status.blocked,
        sessions: peek.state?.sessions ?? {},
        priceTable: status.priceTable,
        petUsage: petUsageStatus(),
      });
      return;
    }
    if (tail === 'pet-usage') {
      json(res, 200, { ok: true, ...petUsageStatus(), ingest: ingestPetUsage() });
      return;
    }
    if (tail === 'status') {
      json(res, 200, {
        ok: true,
        plugin: name,
        version: '0.1.0',
        day: localDayKey(Date.now()),
        collecting: typeof sessionEventOff === 'function',
        paths: {
          stateDir: maskPath(STATE_DIR),
          qqStateDir: maskPath(QQ_STATE_DIR),
          budgetFile: maskPath(tokenBudget.budgetFile),
          dailyFile: maskPath(tokenBudget.dailyFile),
          petUsageFile: maskPath(PET_USAGE_FILE),
        },
        petUsage: petUsageStatus(),
      });
      return;
    }
    json(res, 404, { ok: false, error: `未知接口：${url.pathname}` });
  });

  route('exact', '/dsh-dsbot-token/health', async (_req, res) => {
    json(res, 200, { ok: true, name, version: '0.1.0' });
  });

  // ── 卸载 ────────────────────────────────────────────────────────────────
  ctx.effect(() => () => {
    try { sessionEventOff?.(); } catch {}
    if (petIngestTimer) clearInterval(petIngestTimer);
    try { ingestPetUsage(); } catch {}   // 最后一次落账
    try { tokenBudget.dispose(); } catch {}  // 落盘最后一份用量
    for (const dispose of disposers.splice(0)) { try { dispose(); } catch {} }
  });

  log(`已激活；stateDir=${maskPath(STATE_DIR)}；qqStateDir=${maskPath(QQ_STATE_DIR)}；采集=${typeof sessionEventOff === 'function'}`);
}

export default { name, inject, apply };
