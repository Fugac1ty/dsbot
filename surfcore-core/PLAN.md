# PLAN —— surfcore-core

> 配置模型与统一配置读写、管理员身份投影、概览与诊断、全部参数、扩展宿主、平台注册表、组件更新、备份、日志、原生浏览。
>
> **不负责**：QQ/B站 业务参数与运行、记忆内容、角色、额度、桌宠、语音。
>
> 架构契约：[../../docs/SPLIT-ARCHITECTURE.md](../../docs/SPLIT-ARCHITECTURE.md)
> 实现手册：[../../docs/PACKAGE-SPEC.md](../../docs/PACKAGE-SPEC.md)

---

## 1. 先 vendor 旧代码

```bash
cd 插件
node tools/vendor.mjs --pkg surfcore-core --roots plugins/surfcore/lib/store.js,plugins/surfcore/lib/paths.js,plugins/surfcore/lib/http-guard.js,plugins/surfcore/lib/privacy.js,plugins/surfcore/lib/platforms.js,plugins/surfcore/lib/extensions.js,plugins/surfcore/lib/updates.js,plugins/surfcore/lib/doctor.js,plugins/surfcore/lib/snowluma-install.js
```

vendor 保持仓库相对结构，包内引用写成：

```js
import { X } from './vendor/plugins/surfcore/lib/xxx.js';
```

---

## 2. 宿主半边取材（旧 `plugins/surfcore/lib/index.js`）

| 旧位置 | 要搬什么 |
| --- | --- |
| `plugins/surfcore/lib/index.js:1-175` | 头注释与公共辅助（`pluginLog`、`safeBackupName`、`readTextFile`、`readTextTail`、`mtimeIso`、`fileInfo`、`parseModeState`、`QQ_STATE_DIR`）—— `pluginLog` 换成包内 `log`。 |
| `index.js:187-211` | `PlatformRegistry` + `ExtensionHost` 装配。`ExtensionHost` 需要 memory/align/bridge 三组能力回调：本包**只保留** `log` 与 `platforms`，memory/align/bridge 回调改成直接调用 vendored 的 `memory.js`/`align.js`/`bridge.js`（读）或返回“由对应插件负责”的说明性错误。 |
| `index.js:238-320` | `createUpdatesService` 的组件清单：**简化**为「本拆分包集合 + 旧 surfcore 仓库 + 语音包目录 + 桌宠目录」，不要依赖 petService/voice 插件的内存对象；读 `~/.dsh/surfcore/pet/*`、`<surfcore>/state/voice-packs` 判断存在性即可。 |
| `index.js:325-345` | `platformStartState` / `platformStartEnabled` / `idleSchedulerStatus`。 |
| `index.js:384-418` | `ensureAdminProjection`：把 `unified.admin` 投影到 QQ `ownerQQ` 与 `bili.config.json` 的 `owner.mid/name`。**本包是管理员身份唯一写者**（写两个文件都要走 config-lock）。 |
| `index.js:592-660` | `currentDshUrl` / `bridgeStaleReason` / `trustedProxyHosts`（概览与诊断要用）。 |
| `index.js:661-691` | `route()` 四层准入（脚手架已内建，直接复用）。 |
| `index.js:692-767` | `overview()`：保留系统/配置/平台/扩展/更新/备份部分；QQ/B站运行状态改为**只读**（读 `state/*` 文件或直接省略，由各自的栏目负责展示）。 |
| `index.js:768-939` | `handleConfig`：统一配置读（脱敏）+ 写（`********` 保持原值）。**只允许写 core 负责的键**（`admin`/`extensions`/`platforms`/`updates`/`ui`/`qqbotRoot`）；其它键原样保留并回写。 |
| `index.js:1255-1444` | `handleExtensions` + `dshProfileWithSurfcore` / `installChecks` / `installStep` / `runCommand` / `runInstall` / `doctorFix`。 |
| `index.js:1445-1633` | `handleDiagnostics`（体检、路径、备份恢复）。 |
| `index.js:1634-1900` | 诊断用的 SnowLuma 探测辅助（`portOpen`/`findSnowLumaInstall`/`snowLumaWebui`/`diagnoseSnowLuma`/`launchSnowLuma`）；**只搬 handleDiagnostics 实际用到的**，一键启动留在 qq 包。 |
| `index.js:1983-2017` | `handleBrowse`（原生目录/文件选择；Windows PowerShell 写 UTF-8 临时文件那段注释必须保留）。 |
| `index.js:2712-2719` | `handleLogs`（插件日志尾部）。 |
| `index.js:2746-2790` | `handlePlatforms` + `handleUpdates`。 |
| `index.js:2825-2866` + `2870-2898` | API 分派表（只留本包路径）；扩展自定义路由 `/dsh-surfcore-core/ext/<id>/<path>`；`GET /dsh-surfcore-core/health`。 |

---

## 3. 浏览器半边取材（旧 `plugins/surfcore/lib/client.js`）

公共 UI 套件已在 `lib/client.js` 里内联（Row/Field/Section/Btn/api/ProgressBar/Browse/WindowsEditor/flatten/ErrorModal…）。

| 旧位置 | 要搬什么 |
| --- | --- |
| `client.js:486-562` | `AdminCard`（管理员身份）——**唯一编辑入口**。 |
| `client.js:737-762` | `PlatformStartCard`（平台启动开关）。 |
| `client.js:1218-1332` | `UpdatesModal`（组件更新）。 |
| `client.js:1352-1694` | `OverviewTab` —— 改造成「核心概览」：保留 QQ/B站 状态只读展示、启动按钮**删掉**（各自包负责），保留扩展/更新/备份/版本卡。 |
| `client.js:4202-4265` | `ExtensionsTab`。 |
| `client.js:4266-4306` | `AdvancedTab`（三份配置的完整扁平树，`flattenFields` 已在 kit 里）。 |
| `client.js:4307-4519` | `DiagnosticsTab`。 |
| `client.js:5104-5119` + `5122-5384` | 栏目外壳与 `TABS`；内页保留：概览 / 身份 / 扩展 / 全部参数 / 诊断。 |

---

## 4. 要提供的路由（前缀见 lib/index.js 的 API_PREFIX）

- `GET/POST /config — 统一配置（脱敏读、保持原值写）`
- `POST /admin — 管理员身份保存（qq/biliMid/biliName/displayName/gentle）并投影到两份配置`
- `GET /overview — 系统/配置/平台/扩展/更新/备份概览`
- `GET /extensions，POST /extensions — 列表 / 启停 / 重载 / 配置`
- `GET /platforms，POST /platforms — 平台开关与登记`
- `GET /updates，POST /updates — 检查与执行更新`
- `GET /diagnostics，POST /diagnostics/fix — 体检与修复`
- `GET /backups，POST /backups/restore — 备份列表与恢复`
- `GET /logs，GET /browse — 日志尾部、原生选择框`
- `GET /status，GET /dsh-surfcore-core/health`
- `前缀 /dsh-surfcore-core/ext/<id>/<path> — 扩展自定义路由`

---

## 5. 数据所有权

- `~/.dsh/surfcore/config.json`（统一配置：**除** bridge/persona/memory/alignment/memoryCard 之外的键）
- `~/.dsh/surfcore/backups/`、`plugin.log`、`extensions.json`
- 投影写：`<surfcore>/config.json` 的 `ownerQQ`、`~/.dsh/surfcore/bili.config.json` 的 `owner`
- 只读：`<surfcore>/state/*`、`~/.dsh/surfcore/pet/*`、`bili/`

### 跨包契约

- **管理员身份唯一写者**：其它插件只读展示。
- `unified.platforms.start.{qq,bili}` 由本包写，qq/bili 包读它决定是否自动启动。
- 扩展宿主：`extensions.enabled/disabled` 由本包写；扩展自定义路由前缀 `/dsh-surfcore-core/ext`。

---

## 6. 测试要求（补进 `scripts/test-smoke.mjs`）

- [ ] `/config` GET 返回脱敏值；POST 带 `********` 时保持原值；其它键不被改动
- [ ] `/admin` POST 后：`unified.admin` 更新 + QQ `ownerQQ` + bili `owner.mid` 都正确（读临时文件断言）
- [ ] `/extensions` GET 返回列表；`/updates` GET 返回组件数组且不抛错
- [ ] `/diagnostics` GET 200；`/browse` 在非 Windows 平台返回可读错误（不是 500 堆栈）
- [ ] `/status` + health 200

---

## 7. 本包特别注意

- 这是唯一携带**完整配置模型**（store.js 全量 DEFAULTS）的包，体量最大；`handleConfig` 的脱敏/保持原值语义必须原样保留。
- 概览里的「一键启动」删掉，避免与本包无关的桥接/生物钟控制；由 qq / bili 包各自提供。
- `ensureAdminProjection` 写两个文件时要**各自走 config-lock**，不要一个锁里写两个文件（锁只保护单文件）。

---

## 8. 完成标准

- [ ] `node ./scripts/test-smoke.mjs` 通过
- [ ] `node ../tools/vendor.mjs --pkg . --roots plugins/surfcore/lib/store.js,plugins/surfcore/lib/paths.js,plugins/surfcore/lib/http-guard.js,plugins/surfcore/lib/privacy.js,plugins/surfcore/lib/platforms.js,plugins/surfcore/lib/extensions.js,plugins/surfcore/lib/updates.js,plugins/surfcore/lib/doctor.js,plugins/surfcore/lib/snowluma-install.js --check` 通过（含 --copy-dir 时一起带上）
- [ ] `node ../tools/verify-all.mjs surfcore-core` 通过
- [ ] 只改了 `surfcore-core/` 目录；旧仓库 `surfcore/` 一行未动
- [ ] `README.md` 的负责/不负责与实际一致
