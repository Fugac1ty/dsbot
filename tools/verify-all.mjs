#!/usr/bin/env node
/**
 * verify-all.mjs —— 一键体检本工作区里所有拆分包。
 *
 * 对每个含 package.json 的子目录：
 *   1. checkPackage()：清单 / bundle patch / 自包含 / 设置栏目注册
 *   2. vendor --check（如果有 lib/vendor/MANIFEST.json）
 *   3. 跑它自己的 scripts/test-smoke.mjs（子进程，隔离环境变量）
 *
 * 用法：
 *   node tools/verify-all.mjs            # 全套
 *   node tools/verify-all.mjs --quick    # 跳过各包的冒烟测试（只做静态检查）
 *   node tools/verify-all.mjs dsbot-qq dsbot-token   # 指定包
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkPackage, PLUGINS_ROOT } from './test-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(PLUGINS_ROOT, '..', 'dsbot');

const argv = process.argv.slice(2);
const quick = argv.includes('--quick');
const only = argv.filter((a) => !a.startsWith('--'));

function packageDirs() {
  return fs.readdirSync(PLUGINS_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && e.name !== 'tools' && e.name !== 'docs' && e.name !== 'templates')
    .map((e) => path.join(PLUGINS_ROOT, e.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'package.json')))
    .filter((dir) => !only.length || only.includes(path.basename(dir)))
    .sort();
}

function runNode(script, cwd) {
  return spawnSync(process.execPath, [script], { cwd, encoding: 'utf8', timeout: 180_000 });
}

function vendorRootsOf(pkgDir) {
  const manifestFile = path.join(pkgDir, 'lib/vendor/MANIFEST.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    return Array.isArray(manifest.roots) ? manifest.roots : null;
  } catch {
    return null;
  }
}

let failed = 0;
for (const pkgDir of packageDirs()) {
  const name = path.basename(pkgDir);
  const problems = [];
  try {
    problems.push(...checkPackage(pkgDir, { expectSectionId: name, vendorRoots: vendorRootsOf(pkgDir) ?? undefined }));
  } catch (error) {
    problems.push(`体检异常：${String(error?.message ?? error)}`);
  }

  if (!quick && fs.existsSync(path.join(pkgDir, 'scripts/test-smoke.mjs'))) {
    const result = runNode(path.join('scripts', 'test-smoke.mjs'), pkgDir);
    if (result.status !== 0) {
      problems.push(`冒烟测试失败（exit ${result.status}）：\n${(result.stdout ?? '').slice(-1500)}${(result.stderr ?? '').slice(-1500)}`);
    }
  }

  if (problems.length) {
    failed++;
    console.error(`✗ ${name}`);
    for (const p of problems) console.error(`  - ${p}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

if (!packageDirs().length) {
  console.error('没有找到任何拆分包（每个子目录要有 package.json）');
  process.exit(1);
}
console.log(failed ? `\n${failed} 个包未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
