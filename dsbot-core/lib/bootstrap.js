/**
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
