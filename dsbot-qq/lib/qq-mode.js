/**
 * qq-mode —— 第二个 loader entry 的入口（`cordis.patch.yml` 的
 * `- id: qq-mode / name: ./lib/qq-mode.js`）。
 *
 * 真正的实现在 `lib/vendor/plugins/dsbot/lib/qq-mode.js`（旧代码原样副本，
 * 由 tools/vendor.mjs 生成，不要手改）。这里只做一层薄转发，原因：
 *   · bundle patch 的 loader entry 路径固定是包内 `./lib/qq-mode.js`；
 *   · vendor 保持旧仓库相对结构（plugins/dsbot/lib/qq-mode.js），不随身改层级；
 *   · 于是用一个两行的入口把两者接上，旧文件一行都不用改。
 *
 * 为什么这条 entry 不能删：DSH 0.2.x 的 settings 命名空间由「loader entry id +
 * 该 entry 导出的 Config」推导；QQ 桥接（外部进程）靠 `qq-mode` 命名空间切换
 * chat / closed-agent / reserved / reserved2。entry id 必须精确等于 `qq-mode`，
 * 且 Config 至少有一个带 volatile 的字段（mode / ownerQQ）。
 *
 * ⚠️ 该文件依赖 @deepseek-ai/schemastery（CJS），已写进本包 package.json 的
 *    dependencies；vendored 实现用 createRequire 显式取 CJS（原因见旧文件注释）。
 */
export { name, inject, Config, apply } from './vendor/plugins/dsbot/lib/qq-mode.js';
