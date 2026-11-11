#!/usr/bin/env node
/**
 * vendor.mjs —— 把旧单体插件（surfcore）里需要的模块「原样」复制进新插件包。
 *
 * 设计要点：**保持仓库相对结构**。
 *   源：  <surfcore>/plugins/surfcore/lib/store.js
 *   目标：<新包>/lib/vendor/plugins/surfcore/lib/store.js
 * 源文件里的相对导入（如 `../../../src/admin-identity.js`）在目标里被解析到
 *   <新包>/lib/vendor/src/admin-identity.js —— 只要闭包内所有文件都按同样结构复制，
 *   **一行 import 都不用改**。这是本工具最重要的性质。
 *
 * 用法：
 *   node tools/vendor.mjs --pkg surfcore-token \
 *        --roots plugins/surfcore/lib/token-budget.js,plugins/surfcore/lib/token-usage-pure.js
 *
 *   node tools/vendor.mjs --pkg surfcore-qq --roots ... --check   # 只校验是否与源一致
 *
 * 选项：
 *   --pkg <dir>        新插件包目录（相对当前目录或绝对路径；必须已存在）
 *   --roots <a,b,c>    入口模块，路径相对 surfcore 仓库根
 *   --src <dir>        surfcore 仓库根（默认：../../surfcore，相对本工具所在插件工作区）
 *   --check            不写文件，只校验 lib/vendor 与源闭包是否完全一致（含数量/哈希）
 *   --dry-run          只打印将复制什么
 *
 * 退出码：0 成功；1 用法/校验失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGINS_ROOT = path.resolve(HERE, '..');
const DEFAULT_SRC = path.resolve(PLUGINS_ROOT, '..', 'surfcore');

/** ESM/CJS 里可能出现的相对说明符。`?rev=` 之类的查询串要剥掉再找文件。 */
const SPEC_RE = /(?:^|[\s;({])(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function parseArgs(argv) {
  const out = { src: DEFAULT_SRC, check: false, dryRun: false, roots: [], copyDirs: [], pkg: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pkg') out.pkg = argv[++i] ?? '';
    else if (a === '--roots') out.roots = String(argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--src') out.src = path.resolve(argv[++i] ?? '');
    else if (a === '--copy-dir') out.copyDirs.push(String(argv[++i] ?? '').trim());
    else if (a === '--check') out.check = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  return out;
}

/** 找到说明符对应的真实文件（补 .js/.mjs、剥查询串）。 */
function resolveSpec(fromFile, spec) {
  const clean = spec.split('?')[0];
  if (!clean.startsWith('.')) return null; // 裸说明符＝npm 包，不 vendored
  const base = path.resolve(path.dirname(fromFile), clean);
  const candidates = [base, `${base}.js`, `${base}.mjs`, path.join(base, 'index.js'), path.join(base, 'index.mjs')];
  for (const candidate of candidates) {
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch {}
  }
  return null;
}

/** 读一个文件的全部相对说明符。 */
function relSpecs(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const specs = new Set();
  let m;
  SPEC_RE.lastIndex = 0;
  while ((m = SPEC_RE.exec(text))) {
    const spec = m[1] ?? m[2];
    if (spec) specs.add(spec);
  }
  return [...specs];
}

/** 从 roots 出发求相对导入闭包（只收仓库内的文件）。 */
export function closureOf(srcRoot, roots) {
  const seen = new Set();
  const stack = roots.map((r) => path.resolve(srcRoot, r));
  const missing = [];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    if (!fs.existsSync(file)) { missing.push(file); continue; }
    seen.add(file);
    for (const spec of relSpecs(file)) {
      const next = resolveSpec(file, spec);
      if (next) stack.push(next);
    }
  }
  if (missing.length) throw new Error(`入口/依赖不存在：\n  ${missing.join('\n  ')}`);
  return [...seen].sort();
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function manifestPath(pkgDir) {
  return path.join(pkgDir, 'lib', 'vendor', 'MANIFEST.json');
}

function walkAll(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkAll(p));
    else out.push(p);
  }
  return out;
}

function buildTargets(srcRoot, pkgDir, roots, copyDirs = []) {
  // 种子 = 显式 roots + copy-dir 里的全部文件；然后统一求相对导入闭包
  // （copy-dir 里的文件也参与闭包，例如 B站 tools 里有一处 import ../../../../src/identity-guard.js）。
  const seeds = [...roots];
  for (const dir of copyDirs) {
    const abs = path.resolve(srcRoot, dir);
    if (!fs.existsSync(abs)) throw new Error(`--copy-dir 目录不存在：${dir}`);
    for (const file of walkAll(abs)) seeds.push(path.relative(srcRoot, file).split(path.sep).join('/'));
  }
  const files = closureOf(srcRoot, seeds).sort();
  return files.map((abs) => {
    const rel = path.relative(srcRoot, abs).split(path.sep).join('/');
    const dest = path.join(pkgDir, 'lib', 'vendor', ...rel.split('/'));
    return { rel, src: abs, dest };
  });
}

function readManifest(pkgDir) {
  try { return JSON.parse(fs.readFileSync(manifestPath(pkgDir), 'utf8')); } catch { return null; }
}

function checkPkg({ srcRoot, pkgDir, roots, copyDirs = [] }) {
  const problems = [];
  const expected = buildTargets(srcRoot, pkgDir, roots, copyDirs);
  const manifest = readManifest(pkgDir);
  if (!manifest) {
    problems.push('缺少 lib/vendor/MANIFEST.json（从未 vendor 过）');
  } else {
    const wantRoots = [...roots].sort().join(',');
    const haveRoots = [...(manifest.roots ?? [])].sort().join(',');
    const wantDirs = [...copyDirs].sort().join(',');
    const haveDirs = [...(manifest.copyDirs ?? [])].sort().join(',');
    if (wantDirs !== haveDirs) problems.push(`copyDirs 不一致：期望 ${wantDirs}，实际 ${haveDirs}`);
    if (wantRoots !== haveRoots) problems.push(`roots 不一致：期望 ${wantRoots}，实际 ${haveRoots}`);
  }
  const want = new Map(expected.map((e) => [e.rel, e]));
  const manifestFiles = new Map((manifest?.files ?? []).map((f) => [f.rel, f]));
  for (const [rel, e] of want) {
    if (!fs.existsSync(e.dest)) { problems.push(`缺少 vendored 文件：${rel}`); continue; }
    const have = sha256(e.dest);
    if (have !== sha256(e.src)) problems.push(`内容与源不一致：${rel}`);
    const recorded = manifestFiles.get(rel);
    if (!recorded) problems.push(`MANIFEST 未登记：${rel}`);
    else if (recorded.sha256 !== have) problems.push(`MANIFEST 哈希过期：${rel}`);
  }
  for (const rel of manifestFiles.keys()) {
    if (!want.has(rel)) problems.push(`MANIFEST 多出文件（闭包已不需要）：${rel}（重跑 vendor 会清掉）`);
  }
  return problems;
}

function writeVendor({ srcRoot, pkgDir, roots, copyDirs = [] }) {
  const targets = buildTargets(srcRoot, pkgDir, roots, copyDirs);
  const vendorDir = path.join(pkgDir, 'lib', 'vendor');
  // 每次全量重建：闭包缩小的时候不会留下孤儿文件。
  fs.rmSync(vendorDir, { recursive: true, force: true });
  const files = [];
  for (const t of targets) {
    fs.mkdirSync(path.dirname(t.dest), { recursive: true });
    fs.copyFileSync(t.src, t.dest);
    files.push({ rel: t.rel, bytes: fs.statSync(t.dest).size, sha256: sha256(t.dest) });
  }
  const manifest = {
    generator: '插件/tools/vendor.mjs',
    generatedAt: new Date().toISOString(),
    sourceRoot: srcRoot,
    roots: [...roots],
    copyDirs: [...copyDirs],
    files,
  };
  fs.writeFileSync(manifestPath(pkgDir), `${JSON.stringify(manifest, null, 2)}\n`);
  return files;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.pkg || !args.roots.length) {
    console.log(`用法：node tools/vendor.mjs --pkg <新包目录> --roots <rel,rel,...> [--copy-dir <rel>]... [--src <surfcore 根>] [--check|--dry-run]

例：node tools/vendor.mjs --pkg surfcore-token \\
      --roots plugins/surfcore/lib/token-budget.js,plugins/surfcore/lib/token-usage-pure.js`);
    process.exit(args.help ? 0 : 1);
  }
  const srcRoot = path.resolve(args.src);
  const pkgDir = path.resolve(args.pkg);
  if (!fs.existsSync(path.join(srcRoot, 'package.json'))) throw new Error(`--src 不像 surfcore 仓库根：${srcRoot}`);
  if (!fs.existsSync(pkgDir)) throw new Error(`新包目录不存在：${pkgDir}`);

  if (args.check) {
    const problems = checkPkg({ srcRoot, pkgDir, roots: args.roots, copyDirs: args.copyDirs });
    if (problems.length) {
      console.error(`✗ ${path.basename(pkgDir)} vendor 校验失败：`);
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log(`✓ ${path.basename(pkgDir)} vendor 与源一致`);
    return;
  }

  const targets = buildTargets(srcRoot, pkgDir, args.roots, args.copyDirs);
  if (args.dryRun) {
    console.log(`将复制 ${targets.length} 个文件 → ${path.join(pkgDir, 'lib/vendor')}`);
    for (const t of targets) console.log(`  ${t.rel}`);
    return;
  }
  const files = writeVendor({ srcRoot, pkgDir, roots: args.roots, copyDirs: args.copyDirs });
  console.log(`✓ ${path.basename(pkgDir)}: vendored ${files.length} 个文件（${(files.reduce((n, f) => n + f.bytes, 0) / 1024).toFixed(0)} KB）`);
  for (const f of files) console.log(`  ${f.rel}`);
}

main();
