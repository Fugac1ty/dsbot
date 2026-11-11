#!/usr/bin/env node
/**
 * dsbot-qq 冒烟测试（离线，不启动 DSH、不连 QQ、不写真实 ~/.dsh）。
 *
 * 覆盖：
 *   1. 包体检：清单 / bundle patch（两行 loader entry）/ 自包含 / 设置栏目注册；
 *   2. vendor 校验（lib/vendor/MANIFEST.json 记录的 roots 与闭包一致）；
 *   3. 宿主半边：apply() 装配 → status/health/config/mode/bridge/snowluma/fish-guard/owner-audit/overview；
 *   4. 写配置只走 config-lock、只改自己的键（别的包负责的键原样保留）；
 *   5. 桥接自愈：意图文件 state/needs-bridge-restart.json 的有效 / 过期 / 不合法分支
 *      （spawn/重启全部用注入的假实现，**绝不真的拉起桥接**）；
 *   6. 浏览器半边：ModuleLoader 能加载，注册 1 个 settings.section（id = dsbot-qq）。
 *
 * 运行：node scripts/test-smoke.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  checkPackage, makeTmpEnv, createMockCtx, loadClient, collectSlots,
  assertOk, assertNoProblems, ensureDepOnPath,
} from '../../tools/test-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(HERE, '..');
const VENDOR_ROOTS = [
  'plugins/dsbot/lib/bridge.js',
  'plugins/dsbot/lib/qq-mode.js',
  'plugins/dsbot/lib/qq-fish-guard.js',
  'plugins/dsbot/lib/snowluma-install.js',
  'plugins/dsbot/lib/doctor.js',
  'plugins/dsbot/lib/store.js',
  'plugins/dsbot/lib/paths.js',
  'plugins/dsbot/lib/http-guard.js',
];

const results = [];
function ok(name, detail = '') { results.push({ name, detail }); }

async function main() {
  // ── 1. 静态体检 ──────────────────────────────────────────────────────────
  const manifest = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'lib', 'vendor', 'MANIFEST.json'), 'utf8'));
  assert.deepEqual([...manifest.roots].sort(), [...VENDOR_ROOTS].sort(), 'vendor roots 与 PLAN 不一致');

  const problems = checkPackage(PKG_DIR, { expectSectionId: 'dsbot-qq', vendorRoots: manifest.roots });
  assertNoProblems(problems, 'dsbot-qq');
  ok('checkPackage', `${manifest.files.length} 个 vendored 文件，清单/patch/自包含通过`);

  // 先造临时环境，再 import 宿主模块（vendored paths 在 import 时解析路径）。
  const env = makeTmpEnv({ qqStart: true, biliStart: true });
  ok('makeTmpEnv', `${env.base}`);

  // 预置一份「用户已有」的 QQ 配置：含别的包负责的键 + 秘密 + 未知键。
  const initialQq = {
    version: 1,
    ownerQQ: '3287064288',
    consolePort: 3100,
    consoleToken: 'secret-console-token',
    snowluma: { wsUrl: 'ws://127.0.0.1:3001', httpUrl: 'http://127.0.0.1:3000', accessToken: 'secret-onebot-token' },
    allow: { groups: ['111111111'], private: ['3287064288'] },
    deny: { users: [], groups: [], private: [] },
    socialV2: {
      enabled: true,
      voice: { enabled: true, dir: 'state/voice-packs', maxSeconds: 30 },
      tools: { sendMessage: true, reply: true },
    },
    // 这两块归别的包写（本包写前必须剥掉、原样保留）：
    biliBridge: { enabled: true, share: { enabled: true, times: ['07:00', '19:00'], groups: ['222222222'] } },
    unknownFutureKey: { keep: 'me' },
  };
  fs.writeFileSync(env.qqConfig, `${JSON.stringify(initialQq, null, 2)}\n`);

  // ── 2. qq-mode（第二个 loader entry）────────────────────────────────────
  // 它依赖 @deepseek-ai/schemastery（CJS）。包里没有 node_modules：测试从本机已安装位置借一份
  // （运行时仍靠本包 package.json 声明的 dependencies 安装）。
  ensureDepOnPath(['@deepseek-ai/schemastery']);
  try { Module._initPaths?.(); } catch {} // NODE_PATH 只在 CJS 初始化时生效（createRequire 走它）
  const qqMode = await import(`../lib/qq-mode.js?t=${Date.now()}`);
  assert.equal(qqMode.Config?.type, 'object', 'qq-mode 必须导出 schemastery Config');
  assert.ok(qqMode.Config.dict?.mode, 'qq-mode Config 必须有 mode 字段');
  assert.ok(qqMode.Config.dict?.ownerQQ, 'qq-mode Config 必须有 ownerQQ 字段');
  ok('qq-mode loader entry', 'Config(mode/ownerQQ) 可用');

  // ── 3. 导入宿主半边并装配 ────────────────────────────────────────────────
  const settingsCalls = [];
  const { apply, name, tickBridgeSelfHeal, inspectRestartIntent } = await import(`../lib/index.js?t=${Date.now()}`);
  assert.equal(name, 'dsbot-qq');

  const ctx = createMockCtx({
    services: {
      settings: {
        describe: () => [{ ns: 'qq-mode', value: { mode: 'reserved2', ownerQQ: '3287064288' } }],
        update: async (ns, value) => { settingsCalls.push({ ns, value }); return {}; },
      },
    },
  });
  apply(ctx);
  ok('apply(mockCtx)', `注册 ${ctx.routes.length} 条路由`);

  const API = '/dsh-dsbot-qq/api';

  // ── 4. status / health / 404 ─────────────────────────────────────────────
  const status = assertOk(await ctx.invoke('GET', `${API}/status`), 'GET /status');
  assert.equal(status.plugin, 'dsbot-qq');
  assert.equal(status.files.qqConfig, true);
  assert.equal(status.platformStart.qq, true);
  assert.equal(status.autoStart.skippedByEnv, true, '测试环境应标记 DSBOT_SKIP_AUTOSTART');
  ok('GET /status', '200 ok');

  const health = assertOk(await ctx.invoke('GET', '/dsh-dsbot-qq/health'), 'GET health');
  assert.equal(health.name, 'dsbot-qq');
  ok('GET /dsh-dsbot-qq/health', '200 ok');

  assert.equal((await ctx.invoke('GET', `${API}/nope`)).status, 404, '未知接口要 404');
  ok('GET 未知接口', '404');

  // ── 5. /config 读取：脱敏 ────────────────────────────────────────────────
  const cfgGet = assertOk(await ctx.invoke('GET', `${API}/config`), 'GET /config');
  assert.equal(cfgGet.qq.consoleToken, '********', 'consoleToken 必须脱敏');
  assert.equal(cfgGet.qq.snowluma.accessToken, '********', 'snowluma.accessToken 必须脱敏');
  assert.deepEqual(cfgGet.qq.allow.groups, ['111111111']);
  assert.ok(cfgGet.stamps?.qq, '应返回 qq 配置戳');
  assert.equal(cfgGet.admin.qq, '3287064288', '管理员身份只读展示');
  ok('GET /config', '脱敏 + 配置戳 + 管理员只读');

  // ── 6. /config 写入：只改自己的键、保留其它键、走锁、乐观并发 ────────────
  let post = assertOk(await ctx.invoke('POST', `${API}/config`, {
    qq: { allow: { groups: ['123456789', '987654321'] }, sendDelayMs: 500 },
    baseStamp: cfgGet.stamps,
  }), 'POST /config');
  assert.equal(post.saved.qq, true);

  let disk = JSON.parse(fs.readFileSync(env.qqConfig, 'utf8'));
  assert.deepEqual(disk.allow.groups, ['123456789', '987654321']);
  assert.equal(disk.sendDelayMs, 500);
  assert.deepEqual(disk.biliBridge, initialQq.biliBridge, 'biliBridge（B站 包负责）必须原样保留');
  assert.deepEqual(disk.socialV2.voice, initialQq.socialV2.voice, 'socialV2.voice（语音包负责）必须原样保留');
  assert.deepEqual(disk.unknownFutureKey, { keep: 'me' }, '不认识的键要原样保留');
  assert.equal(disk.ownerQQ, '3287064288', 'ownerQQ（core 负责）必须原样保留');
  ok('POST /config（只改自己的键）', 'biliBridge / socialV2.voice / ownerQQ / 未知键原样');

  // 把别的包负责的键塞进请求体：必须被剥掉并提示。
  post = assertOk(await ctx.invoke('POST', `${API}/config`, {
    qq: {
      allow: { groups: ['123456789'] },
      ownerQQ: '999999',
      socialV2: { voice: { enabled: false } },
      biliBridge: { enabled: false },
    },
  }), 'POST /config（含外部键）');
  disk = JSON.parse(fs.readFileSync(env.qqConfig, 'utf8'));
  assert.equal(disk.ownerQQ, '3287064288', 'ownerQQ 不能被本包写');
  assert.equal(disk.socialV2.voice.enabled, true, 'socialV2.voice 不能被本包写');
  assert.equal(disk.biliBridge.enabled, true, 'biliBridge 不能被本包写');
  assert.ok(post.warnings.some((w) => w.includes('其它插件')), '应提示跳过了别的包的键');
  ok('POST /config（剥掉别人的键）', 'ownerQQ / voice / biliBridge 均未被写');

  // 乐观并发：过期的戳 → 409，且不落盘。
  const groupsBefore = disk.allow.groups;
  const stale = await ctx.invoke('POST', `${API}/config`, {
    qq: { allow: { groups: ['000000000'] } },
    baseStamp: { qq: '0:0' },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, 'CONFIG_STALE');
  disk = JSON.parse(fs.readFileSync(env.qqConfig, 'utf8'));
  assert.deepEqual(disk.allow.groups, groupsBefore, '409 时不能写文件');
  ok('POST /config 乐观并发', '409 CONFIG_STALE，未落盘');

  // 非 JSON 写请求 → 415；缺少 qq → 400。
  assert.equal((await ctx.invoke('POST', `${API}/config`, '{"qq":{}}', { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await ctx.invoke('POST', `${API}/config`, { unified: {} })).status, 400);
  ok('POST /config 准入', '415 非 JSON / 400 缺参数');

  // 备份目录里应至少有一份 qq-config 备份（覆盖前备份）。
  const backups = fs.readdirSync(path.join(env.stateDir, 'backups'));
  assert.ok(backups.some((f) => f.includes('config.json.qq-config')), `应有配置备份：${backups.join(', ')}`);
  ok('config-lock 备份', `${backups.length} 份备份`);

  // ── 7. /mode ────────────────────────────────────────────────────────────
  const modeGet = assertOk(await ctx.invoke('GET', `${API}/mode`), 'GET /mode');
  assert.equal(modeGet.dshSetting.mode, 'reserved2');
  const modePost = assertOk(await ctx.invoke('POST', `${API}/mode`, { mode: 'reserved', ownerQQ: '999999' }), 'POST /mode');
  assert.equal(modePost.mode, 'reserved');
  const modeState = JSON.parse(fs.readFileSync(path.join(env.dsbotRoot, 'state', 'mode.json'), 'utf8'));
  assert.equal(modeState.mode, 'reserved', 'state/mode.json 要写入');
  assert.equal(settingsCalls.length, 1, 'settings.update 应被调用一次');
  assert.equal(settingsCalls[0].ns, 'qq-mode');
  assert.deepEqual(settingsCalls[0].value, { mode: 'reserved' });
  disk = JSON.parse(fs.readFileSync(env.qqConfig, 'utf8'));
  assert.equal(disk.ownerQQ, '3287064288', 'mode 接口不能写 ownerQQ（core 负责）');
  assert.ok(modePost.warnings.some((w) => w.includes('核心')), '应提示管理员身份去 core 改');
  ok('POST /mode', '写 mode.json + settings.update("qq-mode") 一次');

  assert.equal((await ctx.invoke('POST', `${API}/mode`, { mode: 'nope' })).status, 400);
  ok('POST /mode 非法值', '400');

  // ── 8. /bridge（不真的启停进程）──────────────────────────────────────────
  const bridgeGet = assertOk(await ctx.invoke('GET', `${API}/bridge`), 'GET /bridge');
  assert.equal(typeof bridgeGet.status, 'object', '桥接没跑时也要返回可读状态');
  assert.ok('running' in bridgeGet.status);

  const stop = assertOk(await ctx.invoke('POST', `${API}/bridge`, { action: 'stop' }), 'POST /bridge stop');
  assert.equal(stop.skipped, true, '测试环境必须跳过停止桥接（不杀进程）');
  const start = assertOk(await ctx.invoke('POST', `${API}/bridge`, { action: 'start' }), 'POST /bridge start');
  assert.equal(start.skipped, true, '测试环境必须跳过启动桥接（不 spawn）');
  const logs = assertOk(await ctx.invoke('POST', `${API}/bridge`, { action: 'logs', lines: 20 }), 'POST /bridge logs');
  assert.equal(typeof logs.plugin, 'string');
  assert.equal(typeof logs.bridge, 'string');
  ok('POST /bridge stop/start/logs', '全部 mock/跳过，无子进程');

  // ── 9. /snowluma ────────────────────────────────────────────────────────
  const snowGet = assertOk(await ctx.invoke('GET', `${API}/snowluma`), 'GET /snowluma');
  assert.equal(typeof snowGet.found, 'object');
  assert.equal(typeof snowGet.diagnosis, 'object');
  assert.ok(snowGet.webui?.url?.startsWith('http://127.0.0.1:'));
  ok('GET /snowluma', `非 Windows 也可读：found=${snowGet.found.ok} state=${snowGet.diagnosis.state}`);

  // 造一个假安装目录（不启动任何程序）。
  const fakeSnow = path.join(env.base, 'SnowLuma2');
  fs.mkdirSync(path.join(fakeSnow, 'app'), { recursive: true });
  fs.writeFileSync(path.join(fakeSnow, 'app', 'launcher.bat'), '@echo off\r\n');
  const detected = assertOk(await ctx.invoke('POST', `${API}/snowluma`, { action: 'detect', path: fakeSnow }), 'POST /snowluma detect');
  assert.equal(detected.found, true);
  assert.equal(detected.path, fakeSnow);
  disk = JSON.parse(fs.readFileSync(env.qqConfig, 'utf8'));
  assert.equal(disk.snowluma.launcherPath, fakeSnow, '检测成功要保存安装目录');
  assert.equal(disk.snowluma.allowLaunch, true);
  assert.equal(disk.snowluma.accessToken, 'secret-onebot-token', '保存安装目录不能弄丢 accessToken');

  const notFound = await ctx.invoke('POST', `${API}/snowluma`, { action: 'detect', path: path.join(env.base, 'nope') });
  assert.equal(notFound.status, 200);
  assert.equal(notFound.json.ok, false);
  assert.ok(notFound.json.hint, '检测失败必须给下一步提示');
  ok('POST /snowluma detect', '成功保存 / 失败带 hint');

  const launch = assertOk(await ctx.invoke('POST', `${API}/snowluma`, { action: 'launch' }), 'POST /snowluma launch');
  assert.equal(launch.skipped, true, '测试环境必须跳过打开 SnowLuma（不 spawn）');
  const opened = assertOk(await ctx.invoke('POST', `${API}/snowluma`, { action: 'open' }), 'POST /snowluma open');
  assert.equal(opened.opened, false);
  ok('POST /snowluma launch/open', '测试环境跳过，无子进程');

  // ── 10. /fish-guard/qq ──────────────────────────────────────────────────
  const socialV2 = {
    conversations: {
      'group:123456789': {
        fishGuardLog: [{
          at: Date.now() - 60_000, reason: 'fish-count', fishCount: 5, fishMessages: 9, totalMessages: 12,
          fishRatio: 0.75, consecutiveFish: 5, groupName: '摸鱼群',
        }],
        fishGuard: { at: Date.now() - 60_000, reason: 'fish-count', until: Date.now() + 300_000, fishCount: 5 },
      },
    },
  };
  fs.writeFileSync(path.join(env.dsbotRoot, 'state', 'social-v2.json'), JSON.stringify(socialV2, null, 2));
  const fish = assertOk(await ctx.invoke('GET', `${API}/fish-guard/qq`), 'GET /fish-guard/qq');
  assert.ok(Array.isArray(fish.items) && fish.items.length >= 1);
  assert.equal(fish.items[0].groupName, '摸鱼群');
  assert.equal(fish.active, 1);
  assert.ok(fish.config && typeof fish.config === 'object');
  ok('GET /fish-guard/qq', `${fish.items.length} 条触发记录`);

  // ── 11. /owner-audit（桥接没跑 → 可读的空结果，不抛错）───────────────────
  const audit = assertOk(await ctx.invoke('GET', `${API}/owner-audit?limit=10`), 'GET /owner-audit');
  assert.ok(Array.isArray(audit.entries));
  assert.equal(audit.available, false);
  assert.ok(audit.hint, '桥接不可用时要给 hint');
  ok('GET /owner-audit', '只读、桥接不可用时可读');

  // ── 12. /overview ───────────────────────────────────────────────────────
  const overview = assertOk(await ctx.invoke('GET', `${API}/overview`), 'GET /overview');
  assert.equal(overview.plugin, 'dsbot-qq');
  assert.equal(typeof overview.bridge, 'object');
  assert.equal(overview.platformStart.qq, true);
  assert.equal(overview.admin.qq, '3287064288');
  assert.equal(overview.mode.effective, 'reserved2');
  assert.equal(overview.mode.allowGroups, 1);
  assert.ok(overview.paths.qqConfig);
  assert.ok(overview.snowluma.detected, '已保存的假安装目录应被检测到');
  ok('GET /overview', '桥接/SnowLuma/模式/白名单/平台开关/管理员（只读）');

  // ── 13. 桥接自愈：意图文件（全部注入假实现，绝不 spawn）──────────────────
  const intentPath = path.join(env.dsbotRoot, 'state', 'needs-bridge-restart.json');
  const writeIntent = (value) => fs.writeFileSync(intentPath, typeof value === 'string' ? value : JSON.stringify(value));

  // ① DSBOT_SKIP_AUTOSTART=1 → 完全不动（测试环境默认保护）。
  writeIntent({ action: 'restart-bridge', reason: 'character-switched', roleId: 'r1', at: new Date().toISOString() });
  const skipped = await tickBridgeSelfHeal({
    status: async () => ({ running: false }),
    start: async () => ({ ok: true }),
    restart: async () => { throw new Error('不该被调用'); },
  });
  assert.equal(skipped.skipped, 'env');
  assert.ok(fs.existsSync(intentPath), 'env 跳过时不应消费意图文件');

  delete process.env.DSBOT_SKIP_AUTOSTART;
  try {
    // ② 合法意图 → 重启一次并删除文件。
    const calls = [];
    let result = await tickBridgeSelfHeal({
      status: async () => ({ running: false }),
      start: async () => { calls.push('start'); return { ok: true }; },
      restart: async () => { calls.push('restart'); return { ok: true, message: 'stub-restart' }; },
      dshWebUrl: '',
    });
    assert.equal(result.intent, 'restarted', JSON.stringify(result));
    assert.deepEqual(calls, ['restart'], '应只重启一次，且不再继续走自动启动');
    assert.equal(fs.existsSync(intentPath), false, '成功后必须删除意图文件');
    ok('意图文件：合法', '重启一次 + 删除文件');

    // ③ 过期意图（>30 分钟）→ 忽略并清理，不重启。
    writeIntent({ action: 'restart-bridge', reason: 'character-switched', at: new Date(Date.now() - 40 * 60 * 1000).toISOString() });
    assert.equal(inspectRestartIntent().kind, 'expired');
    const expiredCalls = [];
    await tickBridgeSelfHeal({
      status: async () => ({ running: false }),
      start: async () => ({ ok: true }),
      restart: async () => { expiredCalls.push('restart'); return { ok: true }; },
    });
    assert.deepEqual(expiredCalls, [], '过期意图不能触发重启');
    assert.equal(fs.existsSync(intentPath), false, '过期意图应被清理');
    ok('意图文件：过期', '忽略 + 清理');

    // ④ 内容不合法 → 忽略并清理，不重启。
    writeIntent('{not json');
    assert.equal(inspectRestartIntent().kind, 'invalid');
    const badCalls = [];
    await tickBridgeSelfHeal({
      status: async () => ({ running: false }),
      start: async () => ({ ok: true }),
      restart: async () => { badCalls.push('restart'); return { ok: true }; },
    });
    assert.deepEqual(badCalls, []);
    assert.equal(fs.existsSync(intentPath), false, '不合法意图应被清理');
    ok('意图文件：不合法', '忽略 + 清理');

    // ⑤ 意图重启失败 → 保留文件，下一轮重试。
    writeIntent({ action: 'restart-bridge', reason: 'character-switched', at: new Date().toISOString() });
    result = await tickBridgeSelfHeal({
      status: async () => ({ running: false }),
      start: async () => ({ ok: true }),
      restart: async () => ({ ok: false, error: 'stub-fail' }),
    });
    assert.equal(result.intent, 'failed');
    assert.ok(fs.existsSync(intentPath), '重启失败要保留意图文件，等下一轮重试');
    fs.rmSync(intentPath, { force: true });
    ok('意图文件：重启失败', '保留文件重试');

    // ⑥ 普通自愈：桥接没跑 → start；平台启动开关关闭 → 不启动。
    const autoCalls = [];
    await tickBridgeSelfHeal({
      status: async () => ({ running: false }),
      start: async () => { autoCalls.push('start'); return { ok: true }; },
      restart: async () => { autoCalls.push('restart'); return { ok: true }; },
    });
    assert.deepEqual(autoCalls, ['start'], '桥接没跑时应尝试启动');
    ok('自愈：未运行→启动', 'start 一次');

    fs.writeFileSync(path.join(env.stateDir, 'config.json'), JSON.stringify({ platforms: { start: { qq: false } } }, null, 2));
    const disabledCalls = [];
    const disabled = await tickBridgeSelfHeal({
      status: async () => ({ running: false }),
      start: async () => { disabledCalls.push('start'); return { ok: true }; },
      restart: async () => { disabledCalls.push('restart'); return { ok: true }; },
    });
    assert.equal(disabled.skipped, 'platform-disabled');
    assert.deepEqual(disabledCalls, [], '平台启动开关关闭时不能自启');
    fs.rmSync(path.join(env.stateDir, 'config.json'), { force: true });
    ok('自愈：平台开关关闭', '不自启');
  } finally {
    process.env.DSBOT_SKIP_AUTOSTART = '1';
  }

  // ── 14. 卸载：ctx.effect 清理（清定时器 + 路由），之后请求 404 ────────────
  ctx.disposeAll();
  assert.equal(ctx.routes.length, 0, 'disposeAll 后路由应被清掉');
  ok('ctx.effect 清理', '定时器/路由已清理');

  // ── 15. 浏览器半边 ───────────────────────────────────────────────────────
  const clientFile = path.join(PKG_DIR, 'lib', 'client.js');
  const { exports: clientExports, React } = await loadClient(clientFile);
  assert.equal(typeof clientExports.apply, 'function');
  const slots = collectSlots(clientExports, { React });
  assert.equal(slots.length, 1, '必须恰好注册 1 个设置栏目');
  assert.equal(slots[0].options.id, 'dsbot-qq');
  assert.equal(slots[0].options.name, 'settings.section');
  assert.equal(typeof slots[0].options.label, 'function');
  const label = slots[0].options.label();
  assert.ok(label.includes('QQ'), `栏目名应含 QQ：${label}`);
  ok('client.js', `注册 1 个栏目：${label}`);

  env.cleanup();

  // ── 结果汇总 ─────────────────────────────────────────────────────────────
  console.log('\ndsbot-qq 冒烟测试通过：');
  for (const item of results) console.log(`  ✓ ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
  console.log(`\n共 ${results.length} 项断言组通过（vendor ${manifest.files.length} 个文件）。`);
}

main().catch((error) => {
  console.error('\n✗ dsbot-qq 冒烟测试失败：');
  console.error(error?.stack ?? error);
  process.exit(1);
});
