/**
 * 运行根探测 —— **必须是 lib/index.js 的第一个 import**。
 *
 * 为什么需要它：vendored 模块按「仓库相对结构」原样复制（见 tools/vendor.mjs），
 * 它们在 import 时就会解析路径；而 vendored paths.js 需要知道旧 surfcore 仓库根
 * （QQ 的 config.json 与 src/bridge.js 在那里）。ESM 按 import 声明顺序求值，
 * 所以只要本文件排在前面，先设好 SURFCORE_ROOT，后面的一切路径就都对了。
 *
 * 解析顺序（第一个探针通过者胜出）：
 *   1. 环境变量 SURFCORE_ROOT / SURFCORE_QQBOT_ROOT（部署时可显式指定）
 *   2. <插件工作区>/surfcore（本仓库布局：插件/<pkg> → ../surfcore）
 *   3. <插件工作区>（旧布局：插件目录直接放在 surfcore 旁边）
 *   4. 当前工作目录 / 其父目录
 * 探针 = 同时存在 config.json 与 src/bridge.js。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');

function looksLikeSurfcoreRoot(dir) {
  try {
    return Boolean(dir)
      && fs.existsSync(path.join(dir, 'config.json'))
      && fs.existsSync(path.join(dir, 'src', 'bridge.js'));
  } catch {
    return false;
  }
}

const CANDIDATES = [
  process.env.SURFCORE_ROOT,
  process.env.SURFCORE_QQBOT_ROOT,
  process.env.QQBILI_QQBOT_ROOT,
  path.resolve(PKG_ROOT, '..', '..', 'surfcore'),
  path.resolve(PKG_ROOT, '..', '..'),
  path.resolve(PKG_ROOT, '..', '..', '..'),
  process.cwd(),
  path.resolve(process.cwd(), '..'),
].filter(Boolean);

const FOUND = CANDIDATES.find(looksLikeSurfcoreRoot);
if (FOUND) process.env.SURFCORE_ROOT = FOUND;

export const SURFCORE_ROOT = FOUND ?? '';
export const PACKAGE_ROOT = PKG_ROOT;
