# 包实现手册（PACKAGE-SPEC）

> 给实现某个拆分包的人/agent：照着做就能得到一个「自包含 + 可离线验证」的插件。
> 架构契约见 [SPLIT-ARCHITECTURE.md](SPLIT-ARCHITECTURE.md)；每个包的取材清单在包内 `PLAN.md`。

---

## 0. 一次性脚手架

```bash
cd 插件
node tools/new-plugin.mjs --name dsbot-qq --title "DSBot · QQ" \
     --prefix /dsh-dsbot-qq/api --order 8 --color 12a8ff --desc "..."
```

生成后进入该包，把 `PLAN.md` 里列的旧模块 vendor 进来：

```bash
node ../tools/vendor.mjs --pkg dsbot-qq --roots plugins/‹合体插件›/lib/bridge.js,plugins/‹合体插件›/lib/qq-mode.js,...
```

`vendor` 会**保持仓库相对结构**复制到 `lib/vendor/`，所以旧文件内部的相对 import 一行都不用改。
包内引用方式：

```js
import { restart as restartBridge } from './vendor/plugins/‹合体插件›/lib/bridge.js';
import { STATE_DIR } from './vendor/plugins/‹合体插件›/lib/paths.js';
import { adminFromSources } from './vendor/src/admin-identity.js';
```

> `lib/vendor/` **只由 vendor.mjs 生成**，不要手改。旧仓库更新后重跑即可。

---

## 1. 宿主半边（lib/index.js）移植步骤

旧插件所有业务都在一个 `apply(ctx)` 里（`plugins/‹合体插件›/lib/index.js`），拆的时候是「剪切+接线」：

1. **建服务**：把本包需要的 `createXxxService(...)` 调用搬过来。
   - 依赖旧闭包的参数（`pluginLog`、`readUnified`、`ctx`）换成包内实现：
     - `pluginLog(...)` → 包内 `log(...)`（已生成，写到 `plugin.log` 并 console）
     - `readUnified()/readQqConfig()/readBiliConfig()` → 直接用 vendored `store.js` 的同名函数
       （只读不需要锁；**写一律走 `updateJsonFile`/`withConfigLock`**）
2. **搬 handler**：把 `handleXxx(req, res, url)` 整个函数剪过来，它内部的闭包引用按上表替换。
   handler 之间的小工具（`runBili`、`installChecks`、`purposeAvailability`…）一起剪。
3. **注册路由**：在 `apply()` 里用 `route('prefix', API_PREFIX, dispatcher)` 分派。
   旧 `index.js:2825-2866` 那段就是分派表，只保留本包的路径。
4. **后台任务**：定时器/监听器照搬，但必须：
   - `.unref?.()`；
   - 在 `ctx.effect(() => () => { ... })` 里清掉；
   - 对「旧插件全局开关」的依赖改成读配置里的同一个键。
5. **跨包依赖一律降级为文件/HTTP**（见架构文档 §4.2）。例如：
   - token 额度闸门：不要拿 `tokenBudget` 服务，改成读 `~/.dsh/dsbot/token-usage-daily.json` 快照；
     读不到 = 不拦（fail-open），并在 `status` 接口里注明 `tokenGate: 'unavailable'`。
   - 记忆卡注入块：不要调 memory 包，直接读 `memory/memory-card-prompt-<platform>.md`。
   - 人格卡：直接读 `characters/current-role.json` + `persona.md`（可用 vendored `character-persona.js`）。
6. **不可用的宿主服务要判空**：`ctx.get('subprocess')`、`ctx.settings`、`permissionPresets`、
   `sessions` 都可能为 null / 方法不存在（不同 DSH 版本）。旧代码已有大量 `try/catch` 与可选链，保留它们。

移植时**保留旧代码的注释与事故记录**（PITFALLS 引用、日期、原因）。它们是这套代码最贵的资产。

---

## 2. 浏览器半边（lib/client.js）移植步骤

旧 `plugins/‹合体插件›/lib/client.js` 是一个大组件 `QQBIliWhaleSection`，内部按标签页分成多个
`XxxTab` 函数组件，共享统一状态（`unified/qq/bili/busy/toast`）。拆法：

1. 脚手架已内联公共 UI 套件（`templates/client-kit.js` 的内容）。
2. 把 `PLAN.md` 指定的 `XxxTab` 函数**整段复制**进本包 `lib/client.js`。
3. 把它的 props 换成本包自己的状态：
   - 旧：`({ cfg, set, unified, setUnified, busy, setBusy, toast, reload, overview, goTab })`
   - 新：本组件自己 `useState` + `reload()`，数据从本包 `API` 取。
   - 「跳转其它标签页」的 `goTab(...)` 在拆分后跨包不可用：改成一句提示文案
     （例如「到「DSBot · 记忆」栏目查看」）。
4. 数据接口改成 `api("/xxx")` 指向本包前缀；**字段路径保持不变**（仍是 `qq.socialV2.xxx` 这种），
   这样状态与旧配置完全兼容。
5. 多标签页的包（bili/memory/pet/core）在栏目内部自己做一个小 `TABS` + `renderTab()`，
   沿用旧组件顶部的 `qbw-tabs` 样式即可。
6. 栏目内 `useStyleOnce()` 会注入本包的 `CSS_TAG`；CSS 内容照抄旧 `CSS` 常量（同一套 `qbw-*` 类）。
7. 删除对旧全局的依赖：`window.__dsbotToast`（如需 toast 用本地 `toast()`）、
   `overview`/`goTab` 之类的跨标签状态。

> 旧组件之间的复用（如 `AdminCard` 同时出现在 QQ/B站 页）在拆分后按「归属包」放置；
> 其它包只**只读展示**，不再提供编辑入口（管理员身份唯一编辑入口在 `dsbot-core`）。

---

## 3. 安全与兼容的硬规矩

- **写配置必须走锁**：`updateJsonFile(file, mutator)`；读可以直读。
- **读给 UI 的配置必须脱敏**：用 vendored `store.js` 的 `redactForUi`；保存时 `restoreMaskedSecrets`。
- **路径不要硬编码**：一律从 vendored `paths.js` / `lib/bootstrap.js` 取。
- **错误必须可见**：接口失败返回 `{ok:false,error}`；日志写 `plugin.log`（带包名前缀）。
- **不要发真消息、不要连真 QQ、不要写 `~/.dsh` 以外的地方**（测试里）。
- **不要 `git`/网络**：本阶段纯离线。

---

## 4. 测试要求（scripts/test-smoke.mjs）

脚手架已给骨架，必须补到这些断言：

1. `checkPackage(PKG_DIR, { expectSectionId: '<包名>' })` 为空。
2. `apply(mockCtx)` 后：注册了本包前缀路由；`GET <prefix>/status` 返回 200 且 `ok:true`。
3. 每个**主要 GET 接口**至少断言一次 200 + 关键字段；每个**主要 POST 接口**至少断言一次
   成功路径（用临时目录里的假配置驱动，不要依赖真实用户数据）。
4. 写入类接口要断言「只改自己的键」：改前放一份别的键，改后必须原样还在。
5. `ctx.disposeAll()` 后：定时器不报错（可以先 `unref` 后直接调用）。
6. 客户端：`loadClient()` → `collectSlots()` → 1 个栏目，`id` 正确，`label` 是函数。

跑：

```bash
cd 插件/dsbot-xxx && node scripts/test-smoke.mjs
cd 插件 && node tools/verify-all.mjs          # 全量：体检 + 所有包的冒烟
```

---

## 5. 常见坑（拆分特有）

| 坑 | 后果 | 做法 |
| --- | --- | --- |
| 从旧仓库相对路径 import | 迁移后一删旧仓库全家崩 | vendor + `checkPackage` 会直接拦下 |
| 忘了 `import './bootstrap.js'` 第一行 | vendored `paths.js` 把 `<包>/lib/vendor` 当仓库根，读写错文件 | 骨架已含；新增入口文件也照做 |
| 两个包写同一个文件的同一个键 | 后写覆盖前写（隐蔽） | 遵守所有权表；例外必须走锁 |
| 同时启用新旧插件 | 同一 `qq-mode` 命名空间 / 同一 pet-api 前缀冲突 | 迁移时先停旧再装新（MIGRATION.md） |
| 把旧 `pluginLog` 闭包带过来 | ReferenceError | 用包内 `log` |
| 定时器没 unref / 没清理 | DSH 退出卡住、插件停用后还在跑 | `.unref?.()` + `ctx.effect` |
| 浏览器半边 import 相对文件 | 加载直接抛错 | 公共 UI 只能内联 |
| 复制旧的 `?rev=` 缓存破坏后缀 | vendor 后无意义、还可能解析失败 | vendor 自动剥查询串，包内 import 不要带 `?rev=` |

---

## 6. 提交前自检清单

```bash
node ../tools/vendor.mjs --pkg . --roots <...> --check   # vendor 与旧仓库一致
node scripts/test-smoke.mjs                              # 冒烟通过
node ../tools/verify-all.mjs                             # 全套通过
grep -rn "\.\./\.\./\.\./src\|from 'dsbot'\|require('dsbot')" lib/  # 应为空
```

再把 `README.md` 的「负责/不负责」和 `PLAN.md` 的完成状态更新一下。
