#!/usr/bin/env node
/**
 * test-harness.mjs —— 拆分后每个插件包的离线上线前检查工具（不启动 DSH）。
 *
 * 提供四类能力：
 *   1. checkPackage(pkgDir)      静态体检：包清单、bundle patch、自包含（不许引用包外文件）
 *   2. makeTmpEnv()              临时 DSH_HOME / dsbot 根，绝不碰真实 ~/.dsh
 *   3. createMockCtx()           假 ctx + 假 req/res + 路由匹配，用来装配宿主半边
 *   4. loadClient()              用假 window/React 加载 lib/client.js，验证设置栏目注册
 *
 * 一个包的标准测试（scripts/test-smoke.mjs）长这样：
 *
 *   import assert from 'node:assert/strict';
 *   import { checkPackage, makeTmpEnv, createMockCtx, loadClient } from '../../tools/test-harness.mjs';
 *   const env = makeTmpEnv();                       // 必须在 import 宿主模块之前
 *   const { apply } = await import(`../lib/index.js?t=${Date.now()}`);
 *   const ctx = createMockCtx();
 *   apply(ctx);
 *   const r = await ctx.invoke('GET', '/dsh-dsbot-token/api/status');
 *   assert.equal(r.status, 200);
 *
 * 注意：本文件是 ESM 工具，不依赖任何 DSH 包。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PLUGINS_ROOT = path.resolve(HERE, '..');

// ─────────────────────────────────────────────────────────────────────────────
// 1. 静态体检
// ─────────────────────────────────────────────────────────────────────────────

const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'crypto', 'dns', 'events', 'fs', 'http', 'https', 'net',
  'os', 'path', 'process', 'readline', 'stream', 'string_decoder', 'timers', 'tty', 'url',
  'util', 'v8', 'vm', 'worker_threads', 'zlib', 'perf_hooks', 'module', 'inspector', 'async_hooks',
  'node:assert', 'node:buffer', 'node:child_process', 'node:crypto', 'node:dns', 'node:events',
  'node:fs', 'node:http', 'node:https', 'node:net', 'node:os', 'node:path', 'node:process',
  'node:readline', 'node:stream', 'node:string_decoder', 'node:timers', 'node:tty', 'node:url',
  'node:util', 'node:v8', 'node:vm', 'node:worker_threads', 'node:zlib', 'node:perf_hooks',
  'node:module', 'node:inspector', 'node:async_hooks', 'node:test',
]);

/** 浏览器半边（client.js）允许 require 的外部模块。 */
const CLIENT_ALLOWED_REQUIRES = new Set(['react', 'react/jsx-runtime', 'react-dom']);

const SPEC_RE = /(?:^|[\s;({])(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function listFiles(dir, out = [], depth = 0) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    // scripts/ 是测试代码（要 import tools/test-harness.mjs），不属于「运行时自包含」范围。
    if (depth === 0 && e.name === 'scripts') continue;
    if (e.name === 'node_modules' || e.name === '.git') {
      // vendor 是 vendored 的旧代码，结构保持，单独校验（见 checkVendorSelfContained）；
      // 但 vendor 里的文件本身仍需留在包内 —— 一并收集，由 checkSelfContained 判定。
    }
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out, depth + 1);
    else if (/\.(m?js)$/.test(e.name)) out.push(p);
  }
  return out;
}

function specsOf(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const specs = [];
  let m;
  SPEC_RE.lastIndex = 0;
  while ((m = SPEC_RE.exec(text))) {
    const spec = m[1] ?? m[2];
    if (spec) specs.push(spec);
  }
  return specs;
}

function resolveRel(fromFile, spec) {
  const clean = spec.split('?')[0];
  const base = path.resolve(path.dirname(fromFile), clean);
  for (const c of [base, `${base}.js`, `${base}.mjs`, path.join(base, 'index.js'), path.join(base, 'index.mjs')]) {
    try { if (fs.statSync(c).isFile()) return c; } catch {}
  }
  return null;
}

/**
 * 自包含检查：包内任何 JS 的相对 import 都必须落在包目录内。
 * 裸说明符必须是 node 内建、包自己 package.json 声明的依赖，或浏览器半边允许的 react。
 */
export function checkSelfContained(pkgDir) {
  const problems = [];
  const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const deps = { ...(pkgJson.dependencies ?? {}), ...(pkgJson.peerDependencies ?? {}) };
  const depNames = new Set(Object.keys(deps).map((d) => d.startsWith('@') ? d.split('/').slice(0, 2).join('/') : d.split('/')[0]));
  const root = path.resolve(pkgDir);
  for (const file of listFiles(pkgDir)) {
    const isClient = path.basename(file) === 'client.js';
    for (const spec of specsOf(file)) {
      if (spec.startsWith('.')) {
        const resolved = resolveRel(file, spec);
        const rel = path.relative(root, file);
        if (!resolved) { problems.push(`${rel}: 相对导入解析不到 → ${spec}`); continue; }
        const within = !path.relative(root, resolved).startsWith('..');
        if (!within) problems.push(`${rel}: 引用了包外文件 → ${spec}（解析为 ${resolved}）`);
      } else {
        const bare = spec.startsWith('node:') ? spec : spec.split('/')[0];
        if (NODE_BUILTINS.has(spec) || NODE_BUILTINS.has(`node:${bare}`)) continue;
        if (depNames.has(bare) || deps[spec]) continue;
        if (isClient && CLIENT_ALLOWED_REQUIRES.has(spec)) continue;
        problems.push(`${path.relative(root, file)}: 未声明的外部依赖 → ${spec}`);
      }
    }
  }
  return problems;
}

/** bundle patch 里必须有一个 id 等于包名的 insert 行。 */
export function checkPatch(pkgDir, pkgJson) {
  const problems = [];
  const patchFiles = pkgJson?.dsh?.bundle?.patch ?? [];
  if (!patchFiles.length) problems.push('package.json 缺少 dsh.bundle.patch');
  for (const rel of patchFiles) {
    const file = path.join(pkgDir, rel);
    if (!fs.existsSync(file)) { problems.push(`dsh.bundle.patch 指向的文件不存在：${rel}`); continue; }
    if (rel.endsWith('cordis.patch.yml') || rel.endsWith('cordis.patch.yaml')) {
      const text = fs.readFileSync(file, 'utf8');
      if (!new RegExp(`id:\\s*['"]?${escapeRe(pkgJson.name)}['"]?`).test(text)) {
        problems.push(`cordis.patch.yml 没有 id: ${pkgJson.name} 的行`);
      }
      if (!/insert:\s*/.test(text)) problems.push('cordis.patch.yml 没有 insert: 段');
    }
  }
  return problems;
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * 包级体检。返回 problems 数组（空数组＝通过）。
 * opts.expectSectionId  设置栏目 id（client 半边的 settings.section id）
 * opts.vendorRoots      期望的 vendor roots（传了就跑一次 vendor --check 的等价校验）
 */
export function checkPackage(pkgDir, opts = {}) {
  const problems = [];
  const abs = path.resolve(pkgDir);
  const pkgJsonFile = path.join(abs, 'package.json');
  if (!fs.existsSync(pkgJsonFile)) return [`缺少 package.json：${abs}`];
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonFile, 'utf8'));
  const dirName = path.basename(abs);
  if (pkgJson.name !== dirName) problems.push(`package.json name（${pkgJson.name}）与目录名（${dirName}）不一致`);
  if (!pkgJson.type === 'module') problems.push('package.json 缺 "type": "module"');
  if (pkgJson.type !== 'module') problems.push('package.json 必须 "type": "module"');
  for (const key of ['.', './client']) {
    const rel = pkgJson?.exports?.[key];
    if (!rel) { problems.push(`package.json exports 缺少 "${key}"`); continue; }
    if (!fs.existsSync(path.resolve(abs, rel))) problems.push(`exports["${key}"] 指向的文件不存在：${rel}`);
  }
  if (!pkgJson.main) problems.push('package.json 缺少 main');
  else if (!fs.existsSync(path.resolve(abs, pkgJson.main))) problems.push(`main 指向的文件不存在：${pkgJson.main}`);
  if (!pkgJson?.dsh?.client) problems.push('package.json 缺少 dsh.client 声明');
  else if (pkgJson.dsh.client.platform !== 'web') problems.push('dsh.client.platform 必须是 "web"');
  if (!fs.existsSync(path.join(abs, 'icon.svg'))) problems.push('缺少 icon.svg（插件列表要显示图标）');
  for (const loc of ['locale/zh.json', 'locale/en.json']) {
    if (!fs.existsSync(path.join(abs, loc))) problems.push(`缺少 ${loc}`);
  }
  problems.push(...checkPatch(abs, pkgJson));
  problems.push(...checkSelfContained(abs));
  if (opts.expectSectionId) {
    const clientFile = path.join(abs, pkgJson?.exports?.['./client'] ?? 'lib/client.js');
    if (fs.existsSync(clientFile)) {
      const text = fs.readFileSync(clientFile, 'utf8');
      if (!text.includes(`"${opts.expectSectionId}"`) && !text.includes(`'${opts.expectSectionId}'`)) {
        problems.push(`lib/client.js 没有注册设置栏目 id "${opts.expectSectionId}"`);
      }
      if (!text.includes('window.__ModuleLoader__.load')) problems.push('lib/client.js 没有用 window.__ModuleLoader__.load 包装');
    }
  }
  if (opts.vendorRoots?.length) {
    const manifestFile = path.join(abs, 'lib', 'vendor', 'MANIFEST.json');
    if (!fs.existsSync(manifestFile)) problems.push('缺少 lib/vendor/MANIFEST.json');
    else {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      const want = [...opts.vendorRoots].sort().join(',');
      const have = [...(manifest.roots ?? [])].sort().join(',');
      if (want !== have) problems.push(`vendor roots 不一致：期望 ${want}，实际 ${have}`);
    }
  }
  return problems;
}

/**
 * 把一个 npm 依赖挂到 NODE_PATH 上（仅测试用）。
 *
 * 有些拆分包确实需要 npm 依赖（例如 qq-mode 要 @deepseek-ai/schemastery），
 * 但离线开发时包里没有 node_modules。测试里调用本函数，从本机已安装的位置
 * （DSH profile / DSH 安装目录 / 旧 dsbot 仓库）借一份；**运行时仍然靠
 * 包自己 package.json 声明的依赖**，所以这不违反自包含（不是包外代码引用）。
 */
export function ensureDepOnPath(names) {
  const candidates = [
    process.env.DSH_PROFILE_DIR && path.join(process.env.DSH_PROFILE_DIR, 'node_modules'),
    process.env.DSH_HOME && path.join(process.env.DSH_HOME, 'node_modules'),
    path.resolve(PLUGINS_ROOT, '..', 'dsh-0.2-trial', 'node_modules'),
    path.resolve(PLUGINS_ROOT, '..', 'dsbot', 'node_modules'),
    path.resolve(PLUGINS_ROOT, '..', 'dsh-0.2-home', 'profiles', 'web', 'node_modules'),
  ].filter(Boolean);
  const found = [];
  for (const name of names) {
    const hit = candidates.find((dir) => fs.existsSync(path.join(dir, name, 'package.json')));
    if (hit) found.push(hit);
  }
  if (found.length) {
    const extra = [...new Set(found)].join(path.delimiter);
    process.env.NODE_PATH = process.env.NODE_PATH ? `${extra}${path.delimiter}${process.env.NODE_PATH}` : extra;
    // NODE_PATH 只对 CJS require 生效；createRequire 会读它。
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 临时运行环境
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 造一个临时 DSH_HOME + dsbot 根并写进环境变量。
 * 必须在动态 import 宿主模块**之前**调用（vendored paths.js 在 import 时解析路径）。
 * 返回 { home, dsbotRoot, cleanup() }。
 */
export function makeTmpEnv({ qqStart = true, biliStart = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsbot-split-'));
  const home = path.join(base, 'dsh-home');
  const dsbotRoot = path.join(base, 'dsbot');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(dsbotRoot, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dsbotRoot, 'state'), { recursive: true });
  // 让 vendored paths.js 的探针认得这是「桥接仓库根」。
  fs.writeFileSync(path.join(dsbotRoot, 'config.json'), `${JSON.stringify({
    version: 1,
    platforms: { start: { qq: qqStart, bili: biliStart } },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(dsbotRoot, 'src', 'bridge.js'), '// probe only\n');
  fs.mkdirSync(path.join(home, 'dsbot'), { recursive: true });
  process.env.DSH_HOME = home;
  process.env.USERPROFILE = home;
  process.env.DSBOT_ROOT = dsbotRoot;
  process.env.DSBOT_SKIP_AUTOSTART = '1';
  process.env.DSBOT_DISABLE_CHARACTER_MIGRATION = '1';
  process.env.DSBOT_DISABLE_MEMORY_TIMER = '1';
  return {
    base,
    home,
    dsbotRoot,
    stateDir: path.join(home, 'dsbot'),
    qqConfig: path.join(dsbotRoot, 'config.json'),
    cleanup() {
      try { fs.rmSync(base, { recursive: true, force: true }); } catch {}
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 假 ctx / 假 req-res / 路由匹配
// ─────────────────────────────────────────────────────────────────────────────

export function createMockCtx(extra = {}) {
  const routes = [];
  const effects = [];
  const listeners = new Map();
  const disposers = [];

  const services = {
    connection: { requestRejection: () => false },
    settings: {
      describe: async () => ({}),
      update: async () => ({}),
    },
    subprocess: {
      spawn: () => { throw new Error('测试环境不真的起子进程'); },
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    },
    sessionController: {
      inspect: async () => ({ events: [] }),
      create: async () => ({ id: 'test-session' }),
      prompt: async () => ({ accepted: true }),
      cancel: async () => ({}),
      list: async () => [],
    },
    sessions: { get: () => undefined },
    permissionPresets: { current: () => null, set: async () => ({}) },
    slots: { inject: (_name, fn) => fn(), register: (options, _component) => () => {} },
    ...extra.services,
  };

  const ctx = {
    routes,
    effects,
    disposers,
    get(name) { return services[name] ?? null; },
    effect(fn) {
      effects.push(fn);
      const dispose = typeof fn === 'function' ? fn() : undefined;
      if (typeof dispose === 'function') disposers.push(dispose);
      return () => { try { dispose?.(); } catch {} };
    },
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      const off = () => listeners.get(name)?.delete(fn);
      disposers.push(off);
      return off;
    },
    emit(name, ...args) { for (const fn of listeners.get(name) ?? []) fn(...args); },
    webServer: {
      register(route) {
        routes.push(route);
        const dispose = () => {
          const i = routes.indexOf(route);
          if (i >= 0) routes.splice(i, 1);
        };
        disposers.push(dispose);
        return dispose;
      },
    },
  };
  Object.assign(ctx, extra.ctx ?? {});
  // webServer 允许被覆盖（例如要测 port/protocol）
  if (extra.webServer) ctx.webServer = { ...ctx.webServer, ...extra.webServer };

  /** 卸载：跑完所有 disposer（模拟插件被停用）。 */
  ctx.disposeAll = () => { for (const d of disposers.splice(0)) { try { d(); } catch {} } };

  /** 按 DSH 的匹配语义找路由：exact 优先，prefix 取最长。 */
  ctx.findRoute = (method, url) => {
    const pathname = new URL(url, 'http://127.0.0.1').pathname;
    const exact = routes.find((r) => (r.kind ?? 'exact') === 'exact' && r.path === pathname);
    if (exact) return exact;
    const prefixed = routes
      .filter((r) => r.kind === 'prefix' && pathname.startsWith(r.path))
      .sort((a, b) => b.path.length - a.path.length)[0];
    return prefixed ?? null;
  };

  /** 发一个假请求，返回 { status, body, json }。 */
  ctx.invoke = async (method, url, body, headers = {}) => {
    const route = ctx.findRoute(method, url);
    if (!route) return { status: 404, body: '', json: null, route: null };
    const req = fakeReq(method, url, body, headers);
    const res = fakeRes();
    await route.handler(req, res);
    let parsed = null;
    try { parsed = JSON.parse(res.body); } catch {}
    return { status: res.statusCode, body: res.body, json: parsed, route };
  };

  return ctx;
}

export function fakeReq(method, url, body, headers = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = {
    host: '127.0.0.1:58750',
    ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...headers,
  };
  req.socket = { remoteAddress: '127.0.0.1', localAddress: '127.0.0.1' };
  req.connection = req.socket;
  if (body !== undefined) {
    process.nextTick(() => {
      req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
      req.emit('end');
    });
  } else {
    process.nextTick(() => req.emit('end'));
  }
  return req;
}

export function fakeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    finished: false,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers ?? {}; },
    setHeader(k, v) { this.headers[k] = v; },
    write(chunk) { this.body += chunk; },
    end(chunk = '') { this.body += chunk; this.finished = true; },
  };
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 浏览器半边加载
// ─────────────────────────────────────────────────────────────────────────────

function makeReactMock() {
  const idle = () => {};
  const hook = (initial) => [typeof initial === 'function' ? initial() : initial, idle];
  return {
    createElement: (type, props, ...children) => ({ type, props, children }),
    Fragment: Symbol('Fragment'),
    useCallback: (fn) => fn,
    useEffect: idle,
    useLayoutEffect: idle,
    useMemo: (fn) => fn(),
    useRef: (value) => ({ current: value }),
    useState: hook,
    useReducer: (_r, initial) => [initial, idle],
    useContext: () => ({}),
    createContext: (value) => ({ Provider: null, Consumer: null, _value: value }),
    memo: (c) => c,
    forwardRef: (c) => c,
    startTransition: (fn) => fn(),
  };
}

/**
 * 加载包的浏览器半边。返回 { exports, registrations }：
 *   registrations: [{ name, options, component }] —— 通过 channels/slots 注册的东西。
 */
export async function loadClient(clientFile, { requires = {} } = {}) {
  const registrations = [];
  let loaded = null;
  const React = makeReactMock();
  const previousWindow = globalThis.window;
  globalThis.window = {
    __ModuleLoader__: {
      load({ id, factory }) {
        assert.ok(id, 'ModuleLoader.load 缺少 id');
        const module = { exports: {} };
        loaded = factory((name) => {
          if (name === 'react') return React;
          if (name in requires) return requires[name];
          return {};
        });
      },
    },
  };
  try {
    const url = `${path.resolve(clientFile)}?t=${Date.now()}`;
    await import(url);
  } finally {
    globalThis.window = previousWindow;
  }
  assert.ok(loaded, 'client.js 没有调用 window.__ModuleLoader__.load');
  return { exports: loaded, registrations, React };
}

/** 用假 slots 跑客户端 apply()，返回注册到的设置栏目。 */
export function collectSlots(pluginExports, { React } = {}) {
  const registered = [];
  const slots = {
    inject: (_name, fn) => fn(),
    register(options, component) {
      registered.push({ options, component });
      return () => {};
    },
  };
  const ctx = { slots, effect: (fn) => { void fn(); return () => {}; }, on: () => () => {} };
  pluginExports.apply(ctx);
  return registered;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. 便捷断言
// ─────────────────────────────────────────────────────────────────────────────

export function assertOk(result, what = '请求') {
  assert.ok(result.status >= 200 && result.status < 300, `${what} 失败：HTTP ${result.status} ${String(result.body).slice(0, 300)}`);
  assert.equal(result.json?.ok, true, `${what} 返回体里 ok !== true：${String(result.body).slice(0, 300)}`);
  return result.json;
}

export function assertNoProblems(problems, what) {
  if (problems.length) {
    throw new Error(`${what} 体检失败：\n  - ${problems.join('\n  - ')}`);
  }
}

export { assert, fs, os, path };
