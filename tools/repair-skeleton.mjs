#!/usr/bin/env node
/**
 * repair-skeleton.mjs —— 修复脚手架早期版本的已知缺陷（就地、幂等）。
 *
 * 背景：第一版 `templates/client-kit.js` 抽取边界错了（browseNative 少一个 `}`、
 * CSS_TAG 重复声明），导致 new-plugin 生成的 8 个包 `lib/client.js` 全部语法错误；
 * 同一版生成器的 `scripts/test-smoke.mjs` harness 导入路径多了一级。
 *
 * 本工具只做两件事，**不碰你写的组件代码**：
 *   1. 把 `lib/client.js` 里「API/CSS_TAG 声明 + 公共 UI 套件」这一段替换为正确版本
 *      （范围：`const API = "` 那一行 到 `// ── 本插件的状态与数据` 那一行之前）。
 *   2. 把 `scripts/test-smoke.mjs` 的 `'../../../tools/test-harness.mjs'`
 *      改成 `'../../tools/test-harness.mjs'`。
 * 最后用 `node --check` 校验 client.js；仍不通过会明确报错。
 *
 * 用法：
 *   node tools/repair-skeleton.mjs --pkg surfcore-qq
 *   node tools/repair-skeleton.mjs --all
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGINS_ROOT = path.resolve(HERE, '..');
const KIT_FILE = path.join(PLUGINS_ROOT, 'templates', 'client-kit.js');
const MARKER = '// ── 本插件的状态与数据';

function kitBody() {
  const text = fs.readFileSync(KIT_FILE, 'utf8');
  // 去掉模板文件头的说明注释（套件正文从第一个 "    // ──" 开始）
  const idx = text.search(/^ {4}\/\/ ──/m);
  return `${text.slice(idx).trimEnd()}\n`;
}

function repairClient(pkgDir) {
  const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const name = pkgJson.name;
  const clientFile = path.join(pkgDir, pkgJson?.exports?.['./client'] ?? 'lib/client.js');
  if (!fs.existsSync(clientFile)) return { changed: false, note: '没有 client.js' };
  const lines = fs.readFileSync(clientFile, 'utf8').split('\n');

  const apiIdx = lines.findIndex((line) => /^\s*const API = "/.test(line));
  const markerIdx = lines.findIndex((line) => line.includes(MARKER));
  if (apiIdx < 0) return { changed: false, note: '找不到 const API 行，跳过（可能已被手工重写）' };
  if (markerIdx < 0) return { changed: false, note: '找不到「本插件的状态与数据」标记行，跳过（可能已被手工重写）' };

  const apiLine = lines[apiIdx].trimEnd();
  const region = [
    apiLine,
    `    const CSS_TAG = "${name}/console.css";`,
    '',
    kitBody().trimEnd(),
    '',
  ];

  const next = [...lines.slice(0, apiIdx), ...region, ...lines.slice(markerIdx)];
  const text = next.join('\n');
  const before = fs.readFileSync(clientFile, 'utf8');
  if (text === before) return { changed: false, note: '已经是正确版本' };
  fs.writeFileSync(clientFile, text);
  return { changed: true, note: '已替换公共 UI 套件区' };
}

function repairHostIndex(pkgDir) {
  const file = path.join(pkgDir, 'lib', 'index.js');
  if (!fs.existsSync(file)) return { changed: false, note: '没有 lib/index.js' };
  const before = fs.readFileSync(file, 'utf8');
  // 早期脚手架把 config-lock 写成 './lib/config-lock.js'（index.js 本身就在 lib/ 里）。
  const after = before.replace(/(['"])\.\/lib\/config-lock\.js\1/g, "'./config-lock.js'");
  if (after === before) return { changed: false, note: '导入路径已正确' };
  fs.writeFileSync(file, after);
  return { changed: true, note: "已修 './lib/config-lock.js' → './config-lock.js'" };
}

function repairSmoke(pkgDir) {
  const file = path.join(pkgDir, 'scripts', 'test-smoke.mjs');
  if (!fs.existsSync(file)) return { changed: false, note: '没有 test-smoke.mjs' };
  const before = fs.readFileSync(file, 'utf8');
  const after = before
    .replace(/(['"])\.\.\/\.\.\/\.\.\/tools\/test-harness\.mjs\1/g, "'../../tools/test-harness.mjs'")
    .replace(/(['"])\.\.\/\.\.\/\.\.\/\.\.\/tools\/test-harness\.mjs\1/g, "'../../tools/test-harness.mjs'");
  if (after === before) return { changed: false, note: '导入路径已正确' };
  fs.writeFileSync(file, after);
  return { changed: true, note: '已修 harness 导入路径' };
}

function syntaxCheck(file) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  return result.status === 0 ? '' : (result.stderr || result.stdout || '').split('\n').slice(0, 4).join('\n');
}

function repairPackage(pkgDir) {
  const name = path.basename(pkgDir);
  const client = repairClient(pkgDir);
  const smoke = repairSmoke(pkgDir);
  const host = repairHostIndex(pkgDir);
  const clientFile = path.join(pkgDir, 'lib', 'client.js');
  let problem = '';
  if (fs.existsSync(clientFile)) problem = syntaxCheck(clientFile);
  console.log(`${problem ? '✗' : '✓'} ${name}`);
  console.log(`   client.js: ${client.changed ? '已修复' : '未改动'}（${client.note}）`);
  console.log(`   test-smoke.mjs: ${smoke.changed ? '已修复' : '未改动'}（${smoke.note}）`);
  console.log(`   index.js: ${host.changed ? '已修复' : '未改动'}（${host.note}）`);
  if (problem) {
    console.error(`   node --check 失败：\n${problem}`);
    return false;
  }
  return true;
}

const argv = process.argv.slice(2);
if (argv.includes('--all')) {
  let ok = true;
  for (const entry of fs.readdirSync(PLUGINS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const dir = path.join(PLUGINS_ROOT, entry.name);
    if (!fs.existsSync(path.join(dir, 'package.json'))) continue;
    ok = repairPackage(dir) && ok;
  }
  process.exit(ok ? 0 : 1);
} else {
  const i = argv.indexOf('--pkg');
  const target = i >= 0 ? argv[i + 1] : '';
  if (!target) {
    console.error('用法：node tools/repair-skeleton.mjs --pkg <包目录> | --all');
    process.exit(1);
  }
  const dir = path.isAbsolute(target) ? target : path.join(PLUGINS_ROOT, target);
  if (!fs.existsSync(path.join(dir, 'package.json'))) { console.error(`不是插件包：${dir}`); process.exit(1); }
  process.exit(repairPackage(dir) ? 0 : 1);
}
