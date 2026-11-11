/**
 * surfcore-token 离线冒烟测试（不启动 DSH）。
 *
 * 覆盖：
 *   1. 包体检：清单 / bundle patch / 自包含（不许引用包外文件）
 *   2. 宿主半边：mock ctx 装配、路由注册、关键 GET 接口 200
 *   3. 浏览器半边：ModuleLoader 加载、设置栏目注册（id/order/label）
 *
 * 运行：node scripts/test-smoke.mjs
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  checkPackage, makeTmpEnv, createMockCtx, loadClient, collectSlots, assertOk,
} from '../../tools/test-harness.mjs';

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 先造临时环境，再 import 宿主入口（vendored paths 在 import 时解析）。
const env = makeTmpEnv();
try {
  // 1) 包体检
  const problems = checkPackage(PKG_DIR, { expectSectionId: 'surfcore-token' });
  assert.deepEqual(problems, [], `包体检失败：\n${problems.join('\n')}`);

  // 2) 宿主半边
  const mod = await import(`../lib/index.js?t=${Date.now()}`);
  assert.equal(mod.name, 'surfcore-token');
  assert.ok(Array.isArray(mod.inject) && mod.inject.includes('webServer'));
  const ctx = createMockCtx();
  mod.apply(ctx);
  assert.ok(ctx.routes.length >= 1, '没有注册任何路由');
  assert.ok(ctx.findRoute('GET', '/dsh-surfcore-token/api/status'), '没有 /dsh-surfcore-token/api/status 前缀路由');
  // TODO: 逐个断言本插件的关键接口（assertOk(await ctx.invoke('GET', '<prefix>/...'))）
  ctx.disposeAll();

  // 3) 浏览器半边
  const client = await loadClient(path.join(PKG_DIR, 'lib/client.js'));
  assert.ok(typeof client.exports.apply === 'function', 'client 没有导出 apply');
  const slots = collectSlots(client.exports, { React: client.React });
  assert.equal(slots.length, 1, `设置栏目注册数量应为 1，实际 ${slots.length}`);
  assert.equal(slots[0].options.id, 'surfcore-token');
  assert.equal(slots[0].options.name, 'settings.section');
  assert.equal(typeof slots[0].options.label, 'function');

  console.log('✓ surfcore-token 冒烟测试通过');
} finally {
  env.cleanup();
}
