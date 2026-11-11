/**
 * surfcore-voice 离线冒烟测试（不启动 DSH、不连 QQ、不启动 TTS 引擎）。
 *
 * 覆盖（对应 PLAN.md §6）：
 *   1. 包体检：清单 / bundle patch / 自包含（checkPackage）
 *   2. 宿主半边：mock ctx 装配；status / voice/health / voice/tts / voice/packs 代理 /
 *      voice/cloud 代理 / 两个本地动作
 *   3. 写入语义：POST /voice/tts 只改 socialV2.voice* 与 voicePacks.*，其它键（含别的
 *      业务键与 socialV2 下的其它键）原样保留；走 config-lock（有备份）
 *   4. 桥接不可达时所有代理接口 502 + 可读 error/hint（不是 500 堆栈）
 *   5. 浏览器半边：ModuleLoader 加载、注册 1 个 settings.section（id=surfcore-voice）
 *
 * 运行：node scripts/test-smoke.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 注意：tools/ 在工作区（插件/）而不是本包内。test-smoke 属于**测试脚本**，不是插件运行时代码；
// checkPackage 的自包含检查会把「包内 JS 的相对 import」一律视为运行时依赖，因此这里用
// 变量形式的动态 import 引 harness（避免把测试脚本的路径当成插件运行时引用）。
const HARNESS = new URL('../../tools/test-harness.mjs', import.meta.url).href;
const {
  checkPackage, makeTmpEnv, createMockCtx, loadClient, collectSlots, assertOk,
} = await import(HARNESS);

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── 临时环境（绝不碰真实 ~/.dsh / 真实 surfcore 配置）────────────────────────
const env = makeTmpEnv();
const FAKE_CONSOLE_PORT = 59999; // 一个确定没人监听的端口，避免误连本机真实桥接
const PACK_DIR = path.join(env.base, 'voice-packs');

try {
  // 假语音包：给 readPackCharacters() 提供 [voice.characters] 角色名
  fs.mkdirSync(path.join(PACK_DIR, 'voice-local'), { recursive: true });
  fs.writeFileSync(
    path.join(PACK_DIR, 'voice-local', 'config.toml'),
    '[voice.characters]\nxiaoyu = "xiaoyu"\n',
    'utf8',
  );

  // 预置 QQ 配置：故意放一批**不属于本包**的键，验证写 voice 键时原样保留
  const original = {
    version: 1,
    consolePort: FAKE_CONSOLE_PORT,
    consoleToken: 'test-console-token',
    keepMe: { untouched: true, nested: [1, 2, 3] },
    allow: { groups: [123456], private: [] },
    socialV2: {
      enabled: false,
      voice: {
        enabled: false,
        dir: 'audio',
        maxSeconds: 300,
        tts: { enabled: false, route: 'local', character: '', endpoints: { local: 'http://127.0.0.1:8765' } },
        trigger: { who: 'owner' },
      },
    },
    voicePacks: { dir: PACK_DIR, keep: 'keep-this' },
  };
  fs.writeFileSync(env.qqConfig, `${JSON.stringify(original, null, 2)}\n`, 'utf8');

  // ── 1) 包体检 ──────────────────────────────────────────────────────────
  const problems = checkPackage(PKG_DIR, { expectSectionId: 'surfcore-voice' });
  assert.deepEqual(problems, [], `包体检失败：\n${problems.join('\n')}`);

  // ── 2) 宿主半边装配 ─────────────────────────────────────────────────────
  const mod = await import(`../lib/index.js?t=${Date.now()}`);
  assert.equal(mod.name, 'surfcore-voice');
  assert.ok(Array.isArray(mod.inject) && mod.inject.includes('webServer'));
  const ctx = createMockCtx();
  mod.apply(ctx);
  assert.ok(ctx.routes.length >= 2, '没有注册路由');
  assert.ok(ctx.findRoute('GET', '/dsh-surfcore-voice/api/status'), '没有 status 前缀路由');
  assert.ok(ctx.findRoute('GET', '/dsh-surfcore-voice/health'), '没有存活探针路由');

  // status
  const status = assertOk(await ctx.invoke('GET', '/dsh-surfcore-voice/api/status'), 'GET status');
  assert.equal(status.plugin, 'surfcore-voice');
  assert.ok(status.paths?.stateDir, 'status 缺少 paths.stateDir');
  assert.equal(status.bridge.consoleReachable, false, '假端口应该不可达');
  assert.equal(status.voice.route, 'local');
  assert.ok(Array.isArray(status.ports) && status.ports.length === 3);
  assert.ok('lastSelfCheck' in status);

  // 存活探针
  const probe = assertOk(await ctx.invoke('GET', '/dsh-surfcore-voice/health'), 'GET /health');
  assert.equal(probe.name, 'surfcore-voice');

  // ── 3) /voice/health：无服务时 200 + open:false，不抛错 ───────────────────
  const health = assertOk(await ctx.invoke('GET', '/dsh-surfcore-voice/api/voice/health'), 'GET /voice/health');
  assert.equal(health.engine, 'bridge');
  assert.equal(health.ports.length, 3);
  for (const port of health.ports) {
    assert.equal(typeof port.port, 'number');
    assert.equal(port.open, false, `${port.label}(${port.port}) 在测试环境不应有服务监听`);
  }
  assert.equal(health.healthy, false);
  assert.equal(health.config.route, 'local');
  assert.ok(Array.isArray(health.hints) && health.hints.length >= 1, '没有服务时应给出可读提示');

  // ── 4) 桥接不可达：代理接口 502 + ok:false + hint ────────────────────────
  const packs = await ctx.invoke('GET', '/dsh-surfcore-voice/api/voice/packs');
  assert.equal(packs.status, 502, `GET /voice/packs 应为 502，实际 ${packs.status}`);
  assert.equal(packs.json?.ok, false);
  assert.equal(packs.json?.code, 'BRIDGE_UNREACHABLE');
  assert.ok(packs.json?.error && packs.json?.hint, '502 需要可读 error + hint');

  const cloud = await ctx.invoke('GET', '/dsh-surfcore-voice/api/voice/cloud');
  assert.equal(cloud.status, 502);
  assert.equal(cloud.json?.ok, false);

  const rules = await ctx.invoke('POST', '/dsh-surfcore-voice/api/voice/rules', { triggerWho: 'owner' });
  assert.equal(rules.status, 502);
  assert.equal(rules.json?.ok, false);

  // ── 5) GET /voice/tts：读 QQ 配置的语音键 + 包内角色 ─────────────────────
  const ttsInfo = assertOk(await ctx.invoke('GET', '/dsh-surfcore-voice/api/voice/tts'), 'GET /voice/tts');
  assert.equal(ttsInfo.voice.tts.route, 'local');
  assert.deepEqual(ttsInfo.voicePacks, { dir: PACK_DIR });
  assert.deepEqual(ttsInfo.characters, ['xiaoyu']);
  assert.equal(ttsInfo.validation.ok, true);

  // 角色名填成音色 id 时必须拦下（旧 index.js:838-870 的语义）
  const badChar = await ctx.invoke('POST', '/dsh-surfcore-voice/api/voice/tts', {
    voice: { tts: { character: 'loli12-gsv' } },
  });
  assert.equal(badChar.status, 400, `非法角色名应 400，实际 ${badChar.status} ${badChar.body.slice(0, 200)}`);
  assert.equal(badChar.json?.code, 'INVALID_CHARACTER');
  assert.match(String(badChar.json?.error), /音色 id|不存在/);

  // ── 6) POST /voice/tts：只改自己的键 + 走 config-lock（有备份）───────────
  const saved = assertOk(await ctx.invoke('POST', '/dsh-surfcore-voice/api/voice/tts', {
    voice: {
      enabled: true,
      tts: { character: 'xiaoyu', route: 'cloud', maxChars: 150 },
      trigger: { who: 'anyone' },
    },
    voicePacks: { dir: 'D:/voice-packs-new' },
  }), 'POST /voice/tts');
  assert.equal(saved.voice.tts.character, 'xiaoyu');
  assert.equal(saved.voice.tts.maxChars, 150);
  assert.equal(saved.voice.tts.route, 'cloud');
  assert.deepEqual(saved.voicePacks, { dir: 'D:/voice-packs-new' });

  const onDisk = JSON.parse(fs.readFileSync(env.qqConfig, 'utf8'));
  // 只改了本包负责的键
  assert.equal(onDisk.socialV2.voice.tts.character, 'xiaoyu');
  assert.equal(onDisk.socialV2.voice.tts.maxChars, 150);
  assert.equal(onDisk.socialV2.voice.enabled, true);
  assert.equal(onDisk.voicePacks.dir, 'D:/voice-packs-new');
  // 其它键原样保留（含 socialV2 下的别的键、socialV2.voice 下别的子键）
  assert.deepEqual(onDisk.keepMe, { untouched: true, nested: [1, 2, 3] });
  assert.equal(onDisk.consolePort, FAKE_CONSOLE_PORT);
  assert.equal(onDisk.consoleToken, 'test-console-token');
  assert.deepEqual(onDisk.allow, { groups: [123456], private: [] });
  assert.equal(onDisk.socialV2.enabled, false);
  assert.equal(onDisk.socialV2.voice.dir, 'audio');
  assert.equal(onDisk.socialV2.voice.maxSeconds, 300);
  assert.deepEqual(onDisk.socialV2.voice.tts.endpoints, { local: 'http://127.0.0.1:8765' }, 'tts 子对象应合并而不是整体替换');
  assert.equal(onDisk.socialV2.voice.trigger.who, 'anyone');
  assert.equal(onDisk.voicePacks.keep, 'keep-this');
  // config-lock 的备份
  const backups = fs.readdirSync(path.join(env.stateDir, 'backups')).filter((n) => n.startsWith('config.json.voice-tts'));
  assert.ok(backups.length >= 1, `没有看到 config-lock 备份文件：${fs.readdirSync(path.join(env.stateDir, 'backups')).join(',')}`);

  // 读回接口与盘上一致
  const ttsAfter = assertOk(await ctx.invoke('GET', '/dsh-surfcore-voice/api/voice/tts'), 'GET /voice/tts 复核');
  assert.equal(ttsAfter.voice.tts.character, 'xiaoyu');
  assert.equal(ttsAfter.voice.tts.route, 'cloud');

  // 空 patch 必须 400（避免无意义整份写盘）
  const empty = await ctx.invoke('POST', '/dsh-surfcore-voice/api/voice/tts', {});
  assert.equal(empty.status, 400);
  assert.equal(empty.json?.code, 'EMPTY_PATCH');

  // ── 7) 两个本地动作（非 Windows 返回可读错误码，而不是抛栈）─────────────
  const netdisk = await ctx.invoke('POST', '/dsh-surfcore-voice/api/voice/packs/netdisk');
  if (process.platform !== 'win32') {
    assert.equal(netdisk.status, 200);
    assert.equal(netdisk.json?.ok, false);
    assert.equal(netdisk.json?.code, 'OPEN_URL_UNSUPPORTED');
    assert.ok(String(netdisk.json?.hint || '').includes('https://pan.quark.cn/'), 'hint 里应有手动链接');
  } else {
    assert.equal(netdisk.status, 200);
    assert.equal(netdisk.json?.ok, true);
  }
  // 非 POST 一律 405
  const netdiskGet = await ctx.invoke('GET', '/dsh-surfcore-voice/api/voice/packs/netdisk');
  assert.equal(netdiskGet.status, 405);
  assert.equal(netdiskGet.json?.code, 'METHOD_NOT_ALLOWED');

  // sample-open：桥接不可达 → 502（不是 500 堆栈）
  const sampleOpen = await ctx.invoke('POST', '/dsh-surfcore-voice/api/voice/packs/sample-open', { id: 'voice-cloud' });
  assert.equal(sampleOpen.status, 502, `sample-open 桥接不可达应 502，实际 ${sampleOpen.status}`);
  assert.equal(sampleOpen.json?.ok, false);

  // ── 8) 卸载：定时器/路由都清掉，不抛错 ─────────────────────────────────
  ctx.disposeAll();
  assert.equal(ctx.routes.length, 0, '卸载后路由应被清理');

  // ── 9) 浏览器半边：1 个设置栏目（id=surfcore-voice）────────────────────
  const client = await loadClient(path.join(PKG_DIR, 'lib/client.js'));
  assert.ok(typeof client.exports.apply === 'function', 'client 没有导出 apply');
  const slots = collectSlots(client.exports, { React: client.React });
  assert.equal(slots.length, 1, `设置栏目注册数量应为 1，实际 ${slots.length}`);
  assert.equal(slots[0].options.id, 'surfcore-voice');
  assert.equal(slots[0].options.name, 'settings.section');
  assert.equal(typeof slots[0].options.label, 'function');
  assert.equal(client.exports.__test.CSS_TAG, 'surfcore-voice/console.css', 'CSS_TAG 必须是 <包名>/console.css');
  assert.equal(client.exports.__test.API, '/dsh-surfcore-voice/api');

  console.log('✓ surfcore-voice 冒烟测试通过');
} finally {
  env.cleanup();
}
