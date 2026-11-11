#!/usr/bin/env node
/**
 * extract-client-kit.mjs —— 从旧单体插件的设置页里抽出「公共 UI 套件」模板。
 *
 * 为什么要工具而不是手抄：
 *   旧 `plugins/dsbot/lib/client.js` 是一个 5409 行的经典脚本，套件里的每个函数都
 *   在 factory 作用域顶层（4 空格缩进）。手抄行号极易错位（第一版就因为少了一行 `}`
 *   让 8 个包的 client.js 全部语法错误）。这里按「4 空格缩进的顶层声明」切块，按名字抽取，
 *   再拼成模板；行号漂移不会影响结果。
 *
 * 用法：
 *   node tools/extract-client-kit.mjs            # 重新生成 templates/client-kit.js
 *   node tools/extract-client-kit.mjs --check    # 只校验模板是否与旧源一致（CI 用）
 *
 * 只读旧仓库：/home/ubuntu/dsh-agentchat/dsbot/plugins/dsbot/lib/client.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGINS_ROOT = path.resolve(HERE, '..');
const DSH_WORKSPACE = path.resolve(PLUGINS_ROOT, '..');
/**
 * 老仓库不随本仓库分发：在它的 plugins/ 下找最大的 lib/client.js（合体插件那一份）。
 * 也可以用 DSBOT_OLD_REPO 指定老仓库根。
 */
function findOldClientJs() {
  const repo = process.env.DSBOT_OLD_REPO ? path.resolve(process.env.DSBOT_OLD_REPO) : '';
  const roots = repo ? [repo] : (() => {
    try {
      return fs.readdirSync(DSH_WORKSPACE)
        .map((n) => path.join(DSH_WORKSPACE, n))
        .filter((d) => fs.existsSync(path.join(d, 'plugins')));
    } catch { return []; }
  })();
  const found = [];
  for (const root of roots) {
    let pkgs = [];
    try { pkgs = fs.readdirSync(path.join(root, 'plugins')); } catch { continue; }
    for (const name of pkgs) {
      const f = path.join(root, 'plugins', name, 'lib', 'client.js');
      if (fs.existsSync(f)) found.push(f);
    }
  }
  found.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
  return found[0] || '';
}

const SOURCE = findOldClientJs();
const TARGET = path.join(PLUGINS_ROOT, 'templates', 'client-kit.js');

/** 要抽的顶层声明（按顺序），名字 → 条目标题。`CSS_TAG` 由每个包自己声明，不抽。 */
const WANTED = [
  ['ProgressBar', '通用：进度条'],
  ['browseNative', '通用：原生目录/文件选择（宿主弹框）'],
  ['CSS', '通用：样式（每个包一份，注入 <head>）'],
  ['clone', '通用：深拷贝'],
  ['getPath', '通用：按路径读'],
  ['pathKeys', '通用：路径归一化（数组或 "a.b.c" 都接受）'],
  ['setPath', '通用：按路径写'],
  ['p', '通用：字段路径简写'],
  ['labelize', '通用：配置键 → 人读标签'],
  ['api', '通用：同源 API 客户端（失败抛 Error 带 code/hint/missing）'],
  ['useStyleOnce', '通用：样式注入'],
  ['fmtTime', '通用：时间格式化'],
  ['fmtBytes', '通用：字节格式化'],
  ['Row', '通用控件：Row'],
  ['ListInput', '通用控件：字符串列表输入'],
  ['Field', '通用控件：Field'],
  ['FieldGroups', '通用控件：字段分组'],
  ['JsonCell', '通用控件：JSON 单元格'],
  ['Section', '通用控件：折叠分组'],
  ['AdvancedSettings', '通用控件：高级设置折叠'],
  ['StatusDot', '通用控件：状态点'],
  ['Btn', '通用控件：按钮'],
  ['F', '通用：字段描述器'],
  ['Browse', '通用：「浏览…」按钮'],
  ['NUMS', '通用：序号符号表'],
  ['WindowsEditor', '通用：数组窗口编辑器'],
  ['flatten', '通用：任意配置扁平化'],
  ['inferKind', '通用：类型推断'],
  ['flattenFields', '通用：配置 → 字段列表'],
  ['ErrorModal', '通用：错误报告弹窗'],
];

const HEADER = `/**
 * DSBot 拆分 · 浏览器半边公共 UI 套件（模板）。
 *
 * 来源：旧单体插件 plugins/dsbot/lib/client.js 的通用部分，由
 * tools/extract-client-kit.mjs 按「factory 顶层声明」自动抽取，未改行为。
 * 生成时间与来源行号见 tools/extract-client-kit.mjs 的输出。
 *
 * 为什么内联而不用 import：DSH 的浏览器半边是经典脚本，由
 * \`window.__ModuleLoader__.load({ id, factory })\` 包装，factory 内部不能 import 相对文件，
 * 所以每个插件包自带一份。
 *
 * 使用约定（每个包的 lib/client.js 顶部，必须在套件之前）：
 *   const API = "<本插件的 API 前缀>";
 *   const CSS_TAG = "<包名>/console.css";   // 每包唯一，避免重复注入同一 style id
 *
 * ⚠️ 本文件是模板，不是模块：它依赖外层的 h / React hooks / API / CSS_TAG / CSS。
 * 生成器会把下面「套件正文」原样拼进目标 client.js，所以正文里不能有 import/export。
 */
`;

function readLines() {
  if (!fs.existsSync(SOURCE)) throw new Error(`找不到旧 client.js：${SOURCE}`);
  return fs.readFileSync(SOURCE, 'utf8').split('\n');
}

/**
 * 按缩进层级切分 factory 顶层声明。
 *
 * 旧 client.js 的缩进规则（实测）：
 *   · factory 作用域顶层声明：2 空格（只有 ProgressBar / browseNative）或 4 空格；
 *   · 函数体内的语句：比所属函数多 2 空格（≥4）；
 *   · 模板字符串（CSS 那 150 行）从第 0 列开始，不会撞上 "^ {2,4}(function|const|let)"。
 * 所以：先识别 2 空格声明（其范围直到 2 空格缩进的 `}`），中间的 4 空格行属于它，
 * 其余 4 空格声明才是顶层。切完用 `new Function` 做语法校验，坏块直接报错。
 */
function topLevelStarts(lines) {
  const starts = [];
  let inTwoSpace = null;
  const twoSpaceRe = /^ {2}(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/;
  const fourSpaceRe = /^ {4}(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/;
  const constRe = /^ {4}(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/;
  const destructureRe = /^ {4}const\s*[\[{]/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inTwoSpace) {
      if (line === '  }') inTwoSpace = null;
      continue;
    }
    let m = twoSpaceRe.exec(line);
    if (m) {
      starts.push({ name: m[1], line: i });
      inTwoSpace = m[1];
      continue;
    }
    m = fourSpaceRe.exec(line);
    if (m) { starts.push({ name: m[1], line: i }); continue; }
    m = constRe.exec(line);
    if (m) { starts.push({ name: m[1], line: i }); continue; }
    if (destructureRe.test(line)) starts.push({ name: null, line: i });
  }
  return starts;
}

/** 切出所有 factory 顶层声明 → Map(name → { text, startLine })。 */
export function sliceDeclarations(lines) {
  const starts = topLevelStarts(lines);
  const out = new Map();
  for (let idx = 0; idx < starts.length; idx++) {
    const from = starts[idx].line;
    const next = idx + 1 < starts.length ? starts[idx + 1].line : lines.length;
    let to = next; // exclusive：下一段声明的标题/空行归下一段
    while (to - 1 > from) {
      const line = lines[to - 1];
      if (line.trim() === '' || /^\s*\/\/ ──/.test(line)) { to -= 1; continue; }
      break;
    }
    const text = lines.slice(from, to).join('\n');
    const wanted = WANTED.some(([name]) => name === starts[idx].name);
    // 语法校验（只校验我们要抽的片段）：把片段当函数体解析；坏了说明边界切错，
    // 必须报错而不是静默产出坏模板。尾部 exports.* / return module.exports 那段不参与抽包。
    if (wanted) try {
      // eslint-disable-next-line no-new-func
      new Function('__kit_h', '__kit_React', '__kit_API', '__kit_CSS_TAG', '__kit_CSS', `${text}\n;`);
    } catch (error) {
      throw new Error(`第 ${from + 1} 行起的声明片段语法不合法（边界切错？）：${error.message}\n${text.slice(0, 200)}`);
    }
    const name = starts[idx].name;
    if (!name || out.has(name)) continue;
    out.set(name, { text, startLine: from + 1 });
  }
  return out;
}

export function buildKit(lines) {
  const decls = sliceDeclarations(lines);
  const missing = WANTED.map(([name]) => name).filter((name) => !decls.has(name));
  if (missing.length) throw new Error(`旧 client.js 里找不到这些声明：${missing.join(', ')}`);
  const parts = [];
  for (const [name, title] of WANTED) {
    const decl = decls.get(name);
    parts.push(`    // ── ${title} ──\n${decl.text}`);
  }
  return `${HEADER}\n${parts.join('\n\n')}\n`;
}

function main() {
  const lines = readLines();
  if (process.argv.includes('--dump')) {
    const decls = sliceDeclarations(lines);
    console.log('检测到', decls.size, '个顶层声明：');
    for (const [name, d] of decls) console.log(`  ${name} @${d.startLine} depth=${d.baseDepth} paren=${d.baseParen} (${d.text.split('\n').length} 行)`);
    return;
  }
  const kit = buildKit(lines);
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(TARGET) || fs.readFileSync(TARGET, 'utf8') !== kit) {
      console.error('✗ templates/client-kit.js 与旧 client.js 不一致，重跑 node tools/extract-client-kit.mjs');
      process.exit(1);
    }
    console.log('✓ templates/client-kit.js 与旧源一致');
    return;
  }
  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  fs.writeFileSync(TARGET, kit);
  const decls = sliceDeclarations(lines);
  const rows = WANTED.map(([name]) => `${name}@${decls.get(name).startLine}`).join(' ');
  console.log(`✓ 已生成 templates/client-kit.js（${kit.split('\n').length} 行）`);
  console.log(`  来源：${path.relative(DSH_WORKSPACE, SOURCE)}`);
  console.log(`  抽取：${rows}`);
}

main();
