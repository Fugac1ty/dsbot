# PLAN —— surfcore-qq

> QQ 桥接进程的启停/自愈/日志/状态、`qq-mode` settings 命名空间、模式切换、白名单/黑名单、SnowLuma 检测与启动、QQ 鱼群保护状态、主人审计。
>
> **不负责**：B站 调度与分享、记忆/角色/额度、管理员身份编辑（core 负责，本包只读展示）。
>
> 架构契约：[../../docs/SPLIT-ARCHITECTURE.md](../../docs/SPLIT-ARCHITECTURE.md)
> 实现手册：[../../docs/PACKAGE-SPEC.md](../../docs/PACKAGE-SPEC.md)

---

## 1. 先 vendor 旧代码

```bash
cd 插件
node tools/vendor.mjs --pkg surfcore-qq --roots plugins/surfcore/lib/bridge.js,plugins/surfcore/lib/qq-mode.js,plugins/surfcore/lib/qq-fish-guard.js,plugins/surfcore/lib/snowluma-install.js,plugins/surfcore/lib/doctor.js,plugins/surfcore/lib/store.js,plugins/surfcore/lib/paths.js,plugins/surfcore/lib/http-guard.js
```

vendor 保持仓库相对结构，包内引用写成：

```js
import { X } from './vendor/plugins/surfcore/lib/xxx.js';
```

---

## 2. 宿主半边取材（旧 `plugins/surfcore/lib/index.js`）

| 旧位置 | 要搬什么 |
| --- | --- |
| `plugins/surfcore/lib/index.js:1-175` | 公共辅助；`pluginLog` → 包内 `log`。 |
| `index.js:592-660` | `currentDshUrl` / `bridgeStaleReason`（桥接要不要重启、端口是否漂移）。 |
| `index.js:619-650` | `maybeAutoStartBridge` + 2 分钟自愈定时器（`index.js:2908-2911` 那段 `bridgeRepairTimer`）。 |
| `index.js:661-691` | `route()`（脚手架已内建）。 |
| `index.js:768-939` | `handleConfig` 的 **QQ 侧**：读写 `<surfcore>/config.json`（白名单/黑名单、模式、social/socialV2、工具开关、早安、voicePacks 等）；B站 与统一配置部分删掉。 |
| `index.js:1207-1254` | `handleMode`（chat/closed-agent/reserved/reserved2/simulation）。 |
| `index.js:1634-1900` | SnowLuma 全套：`portOpen` / `resolveSnowLumaLauncher` / `findSnowLumaInstall` / `snowLumaWebui` / `openLocalUrl` / `diagnoseSnowLuma` / `launchSnowLuma` / `showStartupPopup` / `watchStartupCompletion`。 |
| `index.js:2247-2397` | `handleBridge`（status/start/stop/restart/logs；含「启动 QQ 时按 `platforms.start.qq` 判断」的语义）。 |
| `index.js:2398-2416` | `handleQqFishGuard`（`summarizeQqFishGuard`）。 |
| `index.js:2720-2745` | `handleOwnerAudit`（只读桥接写好的 `state/owner-audit.jsonl`）。 |
| `index.js:2825-2866` + `2894-2898` | 分派表（QQ 路径）+ health。 |
| `plugins/surfcore/lib/qq-mode.js` 整份 | **第二个 loader 行**：`cordis.patch.yml` 要插两行 —— `id: surfcore-qq, name: surfcore-qq` 与 `id: qq-mode, name: ./lib/qq-mode.js`。qq-mode 需要 `@deepseek-ai/schemastery`，写进 package.json dependencies。 |

---

## 3. 浏览器半边取材（旧 `plugins/surfcore/lib/client.js`）

公共 UI 套件已在 `lib/client.js` 里内联（Row/Field/Section/Btn/api/ProgressBar/Browse/WindowsEditor/flatten/ErrorModal…）。

| 旧位置 | 要搬什么 |
| --- | --- |
| `client.js:563-736` | `parseIdListText` / `IdListEditor` / `WhitelistCard` / `BlacklistCard`。 |
| `client.js:737-762` | `PlatformStartCard`（「启动 QQ」开关）。 |
| `client.js:796-1030` | `QQ_FIELDS` 全部 + `TOOL_LABELS`（一代/二代仿真、social、工具开关、早安、语音包参数…）。 |
| `client.js:1695-1743` | `QqFishGuardStatusCard`。 |
| `client.js:2099-2153` | `ClosureCard`（对话收尾判断）。 |
| `client.js:2154-2290` | `QQTab` —— 改造：管理员卡片换成**只读**（显示 `unified.admin`，链接到 core 栏目），其余保留。 |
| `client.js:445-485` | `AuditModal`（主人审计，从旧 QQ 高级设置搬入）。 |
| `client.js:5122-5384` | 栏目外壳；内页：概览 / QQ / 高级。 |

---

## 4. 要提供的路由（前缀见 lib/index.js 的 API_PREFIX）

- `GET/POST /config — QQ 配置（`<surfcore>/config.json`）`
- `GET /overview — 桥接/SnowLuma/模式/白名单摘要 + 平台开关`
- `POST /mode — 模式切换（同时写 state/mode.json 与 settings `qq-mode` 命名空间）`
- `GET/POST /bridge — status / start / stop / restart / logs（`callBridge` 读控制台）`
- `GET/POST /snowluma — 检测 / 打开 / 启动 / 安装目录设置`
- `GET /fish-guard/qq — QQ 鱼群保护摘要`
- `GET /owner-audit — 主人特权审计（只读）`
- `GET /status，GET /dsh-surfcore-qq/health`

---

## 5. 数据所有权

- `<surfcore>/config.json`（QQ 桥接配置，**唯一写者**；例外：`socialV2.voice*` 归 voice、`biliBridge*` 归 bili，它们自己加锁）
- `~/.dsh/surfcore/config.json` 的 `bridge` 键 + `platforms.start.qq`（**读**，写归 core）
- `state/mode.json`、`state/owner-audit.jsonl`、`state/bridge.log`、`state/console-token`（只读为主）
- 桥接进程：`<surfcore>/src/bridge.js`（用 `bootstrap.js` 的 `SURFCORE_ROOT` 解析；不 vendor，它是独立程序）

### 跨包契约

- 写 `qq-mode` settings 命名空间：需要 loader entry id 精确等于 `qq-mode` 且模块导出带 `volatile` 字段的 `Config`。
- **角色切换后的桥接重启**：character 包写 `state/needs-bridge-restart.json`，本包 2 分钟自愈 tick 读到就重启桥接并删除标记（见架构文档 §4.2）。
- 启动开关：读 `unified.platforms.start.qq`（core 写），关闭时不自启、不参与一键启动。

---

## 6. 测试要求（补进 `scripts/test-smoke.mjs`）

- [ ] `/config` GET 脱敏；POST 只改 QQ 键（预先放入的 `biliBridge` 与其它键必须原样）
- [ ] `/mode` POST 写入 `state/mode.json`；mock `settings.update` 断言调用了一次
- [ ] `/bridge` GET 在桥接没跑时返回可读状态（不抛错）；`/bridge` POST stop 不真的杀进程（mock 掉 `subprocess`/`callBridge`）
- [ ] `/snowluma` GET 在非 Windows 返回可疑但可读的检测结果
- [ ] client 注册 1 个栏目，`getElements` 之类不做；`/status` 200

---

## 7. 本包特别注意

- `qq-mode` 的 `Config` 用 `createRequire` 取 schemastery 的 CJS（原因写在旧文件注释里，保留）。
  测试里先 `ensureDepOnPath(['@deepseek-ai/schemastery'])` 再 import qq-mode。
- 桥接自愈定时器会 `spawn` 子进程：测试里必须 mock `ctx.get('subprocess')`，或直接用环境变量 `SURFCORE_SKIP_AUTOSTART=1` 挡住。

---

## 8. 完成标准

- [ ] `node ./scripts/test-smoke.mjs` 通过
- [ ] `node ../tools/vendor.mjs --pkg . --roots plugins/surfcore/lib/bridge.js,plugins/surfcore/lib/qq-mode.js,plugins/surfcore/lib/qq-fish-guard.js,plugins/surfcore/lib/snowluma-install.js,plugins/surfcore/lib/doctor.js,plugins/surfcore/lib/store.js,plugins/surfcore/lib/paths.js,plugins/surfcore/lib/http-guard.js --check` 通过（含 --copy-dir 时一起带上）
- [ ] `node ../tools/verify-all.mjs surfcore-qq` 通过
- [ ] 只改了 `surfcore-qq/` 目录；旧仓库 `surfcore/` 一行未动
- [ ] `README.md` 的负责/不负责与实际一致
