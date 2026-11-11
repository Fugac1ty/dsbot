#!/usr/bin/env node
/**
 * new-plugin.mjs —— 生成一个「自包含」的拆分包骨架。
 *
 * 生成内容（每个包都一样，保证 8 个新插件长得像同一套工程）：
 *   package.json            包名/导出/dsh.bundle.patch/dsh.client
 *   cordis.patch.yml        bundle 补丁：插入一行 id=<包名> 的 loader 行
 *   icon.svg                插件列表图标（按 --color 换色）
 *   locale/{zh,en}.json     插件名与描述
 *   lib/bootstrap.js        运行根探测（必须最先 import）
 *   lib/config-lock.js      跨插件配置锁 + 原子写 + 备份
 *   lib/index.js            宿主入口骨架（四层准入的路由助手 + apply + dispose）
 *   lib/client.js           设置栏目骨架（内联 templates/client-kit.js 的公共 UI）
 *   scripts/test-smoke.mjs  离线冒烟测试骨架（checkPackage + 路由 + client 注册）
 *   README.md               这个包负责什么、怎么测、依赖哪些数据文件
 *
 * 用法：
 *   node tools/new-plugin.mjs --name dsbot-qq --title "DSBot · QQ" \
 *        --prefix /dsh-dsbot-qq/api --order 8 --color 12a8ff \
 *        --desc "QQ 桥接控制、白名单、SnowLuma 与 QQ 参数"
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGINS_ROOT = path.resolve(HERE, '..');

function parseArgs(argv) {
  const out = { order: 20, color: '1f6feb', section: '', desc: '', title: '', prefix: '', name: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i] ?? '';
    if (a === '--name') out.name = v();
    else if (a === '--title') out.title = v();
    else if (a === '--prefix') out.prefix = v();
    else if (a === '--order') out.order = Number(v()) || 20;
    else if (a === '--color') out.color = v();
    else if (a === '--desc') out.desc = v();
    else if (a === '--section') out.section = v();
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  return out;
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function packageJson({ name, desc }) {
  return json({
    name,
    version: '0.1.0',
    private: true,
    type: 'module',
    description: desc,
    main: './lib/index.js',
    exports: {
      '.': './lib/index.js',
      './client': './lib/client.js',
      './locale/*.json': './locale/*.json',
      './icon': './icon.svg',
    },
    scripts: {
      test: 'node scripts/test-smoke.mjs',
      'test:vendor': 'echo "先按 PLAN.md 跑 tools/vendor.mjs，再把 roots 填进 package.json 的这个脚本"',
    },
    files: ['lib', 'locale', 'cordis.patch.yml', 'icon.svg', 'README.md'],
    dsh: {
      bundle: { patch: ['./cordis.patch.yml'] },
      client: { platform: 'web', inject: [] },
    },
    license: 'MIT',
  });
}

const cordisPatch = ({ name }) => `# ============================================================================
# ${name} —— 由旧单体插件 dsbot 拆出的独立 bundle
# ============================================================================
# 只插入一行：id 必须等于包名（设置页 / 插件详情按包名找宿主入口）。
# ⚠️ 与旧 dsbot 同时安装时不会冲突：行 id / 路由前缀 / 设置栏目 id 都不同。
# ============================================================================
- insert:
    - id: ${name}
      name: ${name}
      config: {}
`;

const iconSvg = ({ color }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="DSBot module">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#${color}" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#${color}" stop-opacity="0.45"/>
    </linearGradient>
  </defs>
  <rect x="4" y="4" width="56" height="56" rx="14" fill="url(#g)"/>
  <circle cx="32" cy="30" r="13" fill="none" stroke="white" stroke-width="3.4" stroke-dasharray="60 22" stroke-linecap="round"/>
  <circle cx="32" cy="30" r="4.2" fill="white"/>
  <rect x="16" y="47" width="32" height="4.6" rx="2.3" fill="white" fill-opacity="0.9"/>
</svg>
`;

const zhLocale = ({ title, desc }) => json({ meta: { title, description: desc } });
const enLocale = ({ title, desc }) => json({ meta: { title: title.replace(/·/g, '-'), description: desc } });

const bootstrapJs = `/**
 * 运行根探测 —— **必须是 lib/index.js 的第一个 import**。
 *
 * 为什么需要它：vendored 模块按「仓库相对结构」原样复制（见 tools/vendor.mjs），
 * 它们在 import 时就会解析路径；而 vendored paths.js 需要知道旧 dsbot 仓库根
 * （QQ 的 config.json 与 src/bridge.js 在那里）。ESM 按 import 声明顺序求值，
 * 所以只要本文件排在前面，先设好 DSBOT_ROOT，后面的一切路径就都对了。
 *
 * 解析顺序（第一个探针通过者胜出）：
 *   1. 环境变量 DSBOT_ROOT / DSBOT_QQBOT_ROOT（部署时可显式指定）
 *   2. <插件工作区>/dsbot（本仓库布局：插件/<pkg> → ../dsbot）
 *   3. <插件工作区>（旧布局：插件目录直接放在 dsbot 旁边）
 *   4. 当前工作目录 / 其父目录
 * 探针 = 同时存在 config.json 与 src/bridge.js。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');

function looksLikeDsbotRoot(dir) {
  try {
    return Boolean(dir)
      && fs.existsSync(path.join(dir, 'config.json'))
      && fs.existsSync(path.join(dir, 'src', 'bridge.js'));
  } catch {
    return false;
  }
}

/**
 * 在包的祖父目录下扫一遍：任何同时含 config.json 与 src/bridge.js 的兄弟目录，
 * 都当作运行根（QQ 桥接进程和 QQ 配置在那里）。不再依赖目录叫什么名字。
 */
function findRuntimeRoot() {
  const grandparent = path.resolve(PKG_ROOT, '..', '..');
  try {
    for (const name of fs.readdirSync(grandparent)) {
      const dir = path.join(grandparent, name);
      if (dir === PKG_ROOT) continue;
      if (looksLikeDsbotRoot(dir)) return dir;
    }
  } catch { /* 读不到就当没找到 */ }
  return '';
}

const CANDIDATES = [
  process.env.DSBOT_ROOT,
  process.env.DSBOT_QQBOT_ROOT,
  process.env.QQBILI_QQBOT_ROOT,
  findRuntimeRoot(),
  path.resolve(PKG_ROOT, '..', '..'),
  path.resolve(PKG_ROOT, '..', '..', '..'),
  process.cwd(),
  path.resolve(process.cwd(), '..'),
].filter(Boolean);

const FOUND = CANDIDATES.find(looksLikeDsbotRoot);
if (FOUND) process.env.DSBOT_ROOT = FOUND;

export const DSBOT_ROOT = FOUND ?? '';
export const PACKAGE_ROOT = PKG_ROOT;
`;

const configLockJs = `/**
 * 跨插件配置锁 + 原子写 + 备份（每个拆分包自带一份，协议相同）。
 *
 * 拆分后多个插件会读写同一批 JSON 文件（~/.dsh/dsbot/config.json、
 * <dsbot>/config.json、bili.config.json …）。协议只有三条：
 *
 *   1. **写前拿锁**：\`<STATE_DIR>/config.lock\` 目录（mkdir 是原子的）。
 *      锁内 <10s 未释放视为陈旧可抢占；拿不到锁最多等 10s 后报错（绝不静默丢写）。
 *   2. **锁内完成整轮 读-改-写**：只改自己负责的键，其它键原样写回。
 *      不允许「锁外读、锁内写」。
 *   3. **覆盖前备份**：\`<STATE_DIR>/backups/<文件名>.<时间戳>\`，只留最近 40 份；
 *      写临时文件再 rename，进程被杀不会留下半截 JSON。
 *
 * ⚠️ 旧单体插件不认识这把锁：**迁移期不要同时运行新旧两边**（见 docs/MIGRATION.md）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR, BACKUP_DIR, ensureDirs } from './vendor/plugins/dsbot/lib/paths.js';

const LOCK_DIR = path.join(STATE_DIR, 'config.lock');
const LOCK_WAIT_MS = 10_000;
const LOCK_STALE_MS = 10_000;
const BACKUP_KEEP = 40;

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* 极端环境不支持就忙等 */ }
}

/** 在配置锁内执行 fn（同步函数，返回什么就返回什么）。 */
export function withConfigLock(fn, { waitMs = LOCK_WAIT_MS, label = 'config' } = {}) {
  ensureDirs();
  const started = Date.now();
  let held = false;
  for (;;) {
    try {
      fs.mkdirSync(LOCK_DIR);
      held = true;
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        const stat = fs.statSync(LOCK_DIR);
        stale = Date.now() - stat.mtimeMs > LOCK_STALE_MS;
      } catch { stale = true; }
      if (stale) {
        try { fs.rmSync(LOCK_DIR, { recursive: true, force: true }); } catch {}
        continue;
      }
      if (Date.now() - started > waitMs) throw new Error(\`等待配置锁超时（\${label}）：\${LOCK_DIR}\`);
      sleepSync(25);
    }
  }
  try {
    return fn();
  } finally {
    if (held) { try { fs.rmSync(LOCK_DIR, { recursive: true, force: true }); } catch {} }
  }
}

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function safeStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

/** 覆盖前备份（保留最近 BACKUP_KEEP 份），返回备份路径或空串。 */
export function backupFile(file, label = '') {
  try {
    if (!fs.existsSync(file)) return '';
    ensureDirs();
    const base = path.basename(file);
    const name = \`\${base}\${label ? \`.\${String(label).replace(/[^\\w.-]+/g, '-')}\` : ''}.\${safeStamp()}\`;
    const dest = path.join(BACKUP_DIR, name);
    fs.copyFileSync(file, dest);
    pruneBackups();
    return dest;
  } catch { return ''; }
}

export function pruneBackups(keep = BACKUP_KEEP) {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .map((name) => ({ name, mtime: fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const file of files.slice(keep)) {
      try { fs.rmSync(path.join(BACKUP_DIR, file.name), { force: true }); } catch {}
    }
  } catch {}
}

export function writeJsonAtomic(file, value, { mode = 0o600 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = \`\${file}.\${process.pid}.\${Date.now()}.tmp\`;
  fs.writeFileSync(tmp, \`\${JSON.stringify(value, null, 2)}\\n\`, { encoding: 'utf8', mode });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, mode); } catch {}
}

/**
 * 锁内 读-改-写 一个 JSON 文件。
 * mutator 收到当前对象（可能是 fallback），返回新对象或就地修改后返回它。
 * 返回最终写下的对象。
 */
export function updateJsonFile(file, mutator, { fallback = {}, backupLabel = '', mode = 0o600 } = {}) {
  return withConfigLock(() => {
    const current = readJson(file, null) ?? JSON.parse(JSON.stringify(fallback));
    const next = mutator(current) ?? current;
    backupFile(file, backupLabel);
    writeJsonAtomic(file, next, { mode });
    return next;
  }, { label: path.basename(file) });
}

/** 锁内只读（避免读到别的插件写了一半的旧值）。 */
export function readJsonLocked(file, fallback = null) {
  return withConfigLock(() => readJson(file, fallback), { label: path.basename(file) });
}

export { LOCK_DIR, BACKUP_KEEP };
`;

function hostIndexJs({ name, prefix, desc }) {
  return `/**
 * ${name} —— ${desc}
 *
 * 由旧单体插件 dsbot 拆出的**独立、自包含**插件：只 import 包内文件与 Node 内置。
 * 依赖的旧代码在 lib/vendor/（由 tools/vendor.mjs 按仓库相对结构原样复制）。
 *
 * 路由前缀：${prefix}
 * 设置栏目 id：${name}（浏览器半边见 lib/client.js）
 */
import './bootstrap.js'; // 必须第一：先定好 DSBOT_ROOT，vendored paths 才能解析
import fs from 'node:fs';
import path from 'node:path';
import {
  STATE_DIR, MEMORY_DIR, BACKUP_DIR, UNIFIED_FILE, QQ_CONFIG, BILI_CONFIG, ensureDirs, maskPath,
} from './vendor/plugins/dsbot/lib/paths.js';
import { json, readBody, isLoopbackReq, sameOrigin } from './vendor/plugins/dsbot/lib/http-guard.js';
import { readJson, updateJsonFile, backupFile } from './config-lock.js';

export const name = '${name}';
export const inject = ['webServer', 'connection'];
export const API_PREFIX = '${prefix}';

const log = (...args) => {
  const line = \`[\${new Date().toISOString()}] [\${name}] \${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\`;
  try { console.log(line); } catch {}
  try {
    ensureDirs();
    fs.appendFileSync(path.join(STATE_DIR, 'plugin.log'), \`\${line}\\n\`);
  } catch {}
};

export function apply(ctx) {
  ensureDirs();
  const disposers = [];

  /** 四层准入 + 统一 500，与旧插件 lib/index.js 的 route() 语义一致。 */
  function route(kind, pathname, handler) {
    disposers.push(ctx.webServer.register({
      kind,
      path: pathname,
      handler: async (req, res) => {
        const trusted = (() => { try { return readJson(QQ_CONFIG, {})?.httpGuard?.trustedProxyHosts ?? []; } catch { return []; } })();
        if (!isLoopbackReq(req, Array.isArray(trusted) ? trusted : [])) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return; }
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

  // ── 路由 ─────────────────────────────────────────────────────────────────
  route('prefix', API_PREFIX, async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const tail = url.pathname.slice(API_PREFIX.length).replace(/^\\/+/, '');
    if (tail === 'status') {
      json(res, 200, {
        ok: true,
        plugin: name,
        version: '0.1.0',
        paths: {
          stateDir: maskPath(STATE_DIR),
          memoryDir: maskPath(MEMORY_DIR),
          backupDir: maskPath(BACKUP_DIR),
        },
        files: {
          unified: fs.existsSync(UNIFIED_FILE),
          qqConfig: fs.existsSync(QQ_CONFIG),
          biliConfig: fs.existsSync(BILI_CONFIG),
        },
      });
      return;
    }
    json(res, 404, { ok: false, error: \`未知接口：\${url.pathname}\` });
  });

  route('exact', '${prefix.replace(/\/api$/, '')}/health', async (_req, res) => {
    json(res, 200, { ok: true, name, version: '0.1.0' });
  });

  // 卸载：清定时器 / 定时任务在这里登记。
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) { try { dispose(); } catch {} }
  });

  log(\`已激活；stateDir=\${maskPath(STATE_DIR)}\`);
}

export default { name, inject, apply };
`;
}

function clientJs({ name, title, prefix, order, kit }) {
  return `/**
 * ${name} —— 浏览器半边：DSH 设置里的「${title}」栏目。
 *
 * 自包含经典脚本：由 window.__ModuleLoader__.load({ id, factory }) 包装，
 * factory 内只有作用域，不能 import 相对文件；公共 UI 控件已内联在下面。
 * 数据流：本组件 ⇄ ${prefix}/*（同源 fetch）⇄ 本插件宿主半边。
 */
window.__ModuleLoader__.load({
  id: "${name}",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const {
      createElement: h,
      useCallback,
      useEffect,
      useMemo,
      useRef,
      useState,
    } = React;

    const API = "${prefix}";
    const CSS_TAG = "${name}/console.css";

${kit}

    // ── 本插件的状态与数据 ──────────────────────────────────────────────────
    // TODO: 在这里加 <本插件> 的加载/保存/动作函数（全部走 api(...)）。
    async function loadStatus() {
      return api("/status");
    }

    function ${camel(name)}Section() {
      useStyleOnce();
      const [status, setStatus] = useState(null);
      const [err, setErr] = useState("");
      const [busy, setBusy] = useState(false);
      const [toastText, setToastText] = useState("");

      const toast = useCallback((text) => {
        setToastText(String(text ?? ""));
        setTimeout(() => setToastText(""), 2600);
      }, []);

      const reload = useCallback(async () => {
        try { setStatus(await loadStatus()); setErr(""); }
        catch (error) { setErr(String(error?.message ?? error)); }
      }, []);

      useEffect(() => { void reload(); }, [reload]);

      return h("div", { className: "qbw-app" },
        h("div", { className: "qbw-head" },
          h("p", { className: "qbw-kicker" }, "DSBot 拆分包"),
          h("h2", { className: "qbw-title" }, "${title}"),
          h("p", { className: "qbw-sub" }, "独立插件：只负责本栏目；数据仍写原有的配置文件与状态目录。")),
        h("div", { className: "qbw-body" },
          err ? h("div", { className: "qbw-err", style: { marginBottom: "8px" } }, err) : null,
          h(Section, { title: "运行状态", note: "来自本插件的宿主半边" },
            status
              ? h("div", null,
                h(Row, { label: "插件" }, h("span", null, status.plugin ?? "${name}")),
                h(Row, { label: "版本" }, h("span", null, status.version ?? "—")),
                h(Row, { label: "状态目录" }, h("span", { className: "qbw-hint" }, status.paths?.stateDir ?? "—")),
                h(Row, { label: "统一配置" }, h(StatusDot, { ok: !!status.files?.unified }, status.files?.unified ? "已存在" : "未创建")))
              : h("div", { className: "qbw-hint" }, "加载中…")),
          h(AdvancedSettings, null,
            h(Row, { label: "API 前缀" }, h("span", { className: "qbw-hint" }, API)))),
        h("div", { className: "qbw-foot" },
          h(Btn, { onClick: () => void reload(), disabled: !!busy }, busy ? "刷新中…" : "重新读取"),
          h("span", { className: "spacer" }),
          toastText ? h("span", { style: { marginLeft: "10px", color: "var(--dsw-alias-label-secondary)" } }, toastText) : null));
    }

    const inject = ["slots"];
    const NS = "${name}";

    function apply(ctx) {
      ctx.effect(
        () => ctx.slots.inject("settings.section", () =>
          ctx.slots.register({ name: "settings.section", id: NS, order: ${order}, label: () => "${title}" }, ${camel(name)}Section),
          "${name}: settings section"),
        "${name}: settings section",
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.${camel(name)}Section = ${camel(name)}Section;
    exports.__test = { API, CSS_TAG };
    return module.exports;
  },
});
`;
}

function camel(name) {
  return name.replace(/[-/]+(.)/g, (_, c) => c.toUpperCase()).replace(/^dsbot/, 'dsbot');
}

function smokeTest({ name, section, prefix }) {
  return `/**
 * ${name} 离线冒烟测试（不启动 DSH）。
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
  const problems = checkPackage(PKG_DIR, { expectSectionId: '${section}' });
  assert.deepEqual(problems, [], \`包体检失败：\\n\${problems.join('\\n')}\`);

  // 2) 宿主半边
  const mod = await import(\`../lib/index.js?t=\${Date.now()}\`);
  assert.equal(mod.name, '${name}');
  assert.ok(Array.isArray(mod.inject) && mod.inject.includes('webServer'));
  const ctx = createMockCtx();
  mod.apply(ctx);
  assert.ok(ctx.routes.length >= 1, '没有注册任何路由');
  assert.ok(ctx.findRoute('GET', '${prefix}/status'), '没有 ${prefix}/status 前缀路由');
  // TODO: 逐个断言本插件的关键接口（assertOk(await ctx.invoke('GET', '<prefix>/...'))）
  ctx.disposeAll();

  // 3) 浏览器半边
  const client = await loadClient(path.join(PKG_DIR, 'lib/client.js'));
  assert.ok(typeof client.exports.apply === 'function', 'client 没有导出 apply');
  const slots = collectSlots(client.exports, { React: client.React });
  assert.equal(slots.length, 1, \`设置栏目注册数量应为 1，实际 \${slots.length}\`);
  assert.equal(slots[0].options.id, '${section}');
  assert.equal(slots[0].options.name, 'settings.section');
  assert.equal(typeof slots[0].options.label, 'function');

  console.log('✓ ${name} 冒烟测试通过');
} finally {
  env.cleanup();
}
`;
}

function readme({ name, title, desc, prefix }) {
  return `# ${name}

${desc}

> 由旧单体插件 \`dsbot\` 拆出的**独立插件**。旧插件在拆分期间保持不动；
> 本包只依赖包内文件（\`lib/vendor/\` 是旧代码的原样副本），不 import 旧仓库任何路径。

## 这个包负责什么

<!-- 用 3-8 条写清楚边界：负责什么、**不**负责什么（哪个包负责）。 -->

- 设置栏目：\`${title}\`（settings.section id = \`${name}\`，order 见 lib/client.js）
- HTTP 前缀：\`${prefix}\`
- 数据：沿用原有配置文件与状态目录（见 \`docs/SPLIT-ARCHITECTURE.md\` 的文件所有权表）

## 目录

| 路径 | 说明 |
| --- | --- |
| \`lib/index.js\` | 宿主入口（\`export function apply(ctx)\`） |
| \`lib/client.js\` | 浏览器半边（DSH 设置栏目） |
| \`lib/bootstrap.js\` | 运行根探测（必须第一个 import） |
| \`lib/config-lock.js\` | 跨插件配置锁 / 原子写 / 备份 |
| \`lib/vendor/\` | 旧代码原样副本；**只由 tools/vendor.mjs 生成，不要手改** |
| \`scripts/test-smoke.mjs\` | 离线冒烟测试 |

## 重新 vendor

\`\`\`bash
# 在本包目录
node ../tools/vendor.mjs --pkg . --roots <逗号分隔的 dsbot 相对路径>
node ../tools/vendor.mjs --pkg . --roots <...> --check   # 校验是否与旧仓库一致
\`\`\`

## 测试

\`\`\`bash
node scripts/test-smoke.mjs
\`\`\`

## 迁移

见 \`docs/MIGRATION.md\`：本包完善并通过测试后，停用旧 \`dsbot\`，安装本包。
`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.name) {
    console.log('用法：node tools/new-plugin.mjs --name dsbot-qq --title "DSBot · QQ" --prefix /dsh-dsbot-qq/api [--order 8] [--color 12a8ff] [--desc "..."]');
    process.exit(args.help ? 0 : 1);
  }
  const { name } = args;
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('包名只能是小写字母/数字/连字符');
  const title = args.title || `DSBot · ${name.replace(/^dsbot-/, '')}`;
  const prefix = args.prefix || `/${name}/api`;
  const section = args.section || name;
  const desc = args.desc || `${title}（DSBot 拆分包）`;
  const pkgDir = path.join(PLUGINS_ROOT, name);
  if (fs.existsSync(pkgDir)) throw new Error(`目录已存在：${pkgDir}`);

  const kit = fs.readFileSync(path.join(PLUGINS_ROOT, 'templates', 'client-kit.js'), 'utf8');
  // 去掉模板文件头的说明注释块（只保留代码本体）。
  const kitBody = kit.replace(/^\/\*\*[\s\S]*?\*\/\n/, '');

  fs.mkdirSync(path.join(pkgDir, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(pkgDir, 'locale'), { recursive: true });
  fs.mkdirSync(path.join(pkgDir, 'scripts'), { recursive: true });

  fs.writeFileSync(path.join(pkgDir, 'package.json'), packageJson({ name, desc }));
  fs.writeFileSync(path.join(pkgDir, 'cordis.patch.yml'), cordisPatch({ name }));
  fs.writeFileSync(path.join(pkgDir, 'icon.svg'), iconSvg({ color: args.color }));
  fs.writeFileSync(path.join(pkgDir, 'locale/zh.json'), zhLocale({ title, desc }));
  fs.writeFileSync(path.join(pkgDir, 'locale/en.json'), enLocale({ title, desc }));
  fs.writeFileSync(path.join(pkgDir, 'lib/bootstrap.js'), bootstrapJs);
  fs.writeFileSync(path.join(pkgDir, 'lib/config-lock.js'), configLockJs);
  fs.writeFileSync(path.join(pkgDir, 'lib/index.js'), hostIndexJs({ name, prefix, desc }));
  fs.writeFileSync(path.join(pkgDir, 'lib/client.js'), clientJs({ name, title, prefix, order: args.order, kit: kitBody }));
  fs.writeFileSync(path.join(pkgDir, 'scripts/test-smoke.mjs'), smokeTest({ name, section, prefix }));
  fs.writeFileSync(path.join(pkgDir, 'README.md'), readme({ name, title, desc, prefix }));

  console.log(`✓ 已生成 ${path.relative(PLUGINS_ROOT, pkgDir)}/`);
  console.log('下一步：');
  console.log(`  1. node tools/vendor.mjs --pkg ${name} --roots <旧仓库相对路径,...>`);
  console.log('  2. 按 docs/PACKAGE-SPEC.md 实现宿主路由 + 设置栏目');
  console.log(`  3. node ${name}/scripts/test-smoke.mjs`);
}

main();
