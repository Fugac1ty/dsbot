# PLAN —— surfcore-bili

> B站生物钟（scheduler 五条 tick）、bili 配置与凭据/扫码登录、养鱼参数、观看历史、口味扫描、定时分享与四类动态、B站鱼群守则。
>
> **不负责**：QQ 桥接本身、记忆卡维护、额度采集。
>
> 架构契约：[../../docs/SPLIT-ARCHITECTURE.md](../../docs/SPLIT-ARCHITECTURE.md)
> 实现手册：[../../docs/PACKAGE-SPEC.md](../../docs/PACKAGE-SPEC.md)

---

## 1. 先 vendor 旧代码

```bash
cd 插件
node tools/vendor.mjs --pkg surfcore-bili --roots plugins/surfcore/lib/scheduler.js,plugins/surfcore/lib/automation.js,plugins/surfcore/lib/bili-qr-login.mjs,plugins/surfcore/lib/memory-card.js,plugins/surfcore/lib/persona.js,plugins/surfcore/lib/store.js,plugins/surfcore/lib/paths.js,plugins/surfcore/lib/http-guard.js,plugins/surfcore/lib/bridge.js --copy-dir plugins/surfcore/tools
```

vendor 保持仓库相对结构，包内引用写成：

```js
import { X } from './vendor/plugins/surfcore/lib/xxx.js';
```

---

## 2. 宿主半边取材（旧 `plugins/surfcore/lib/index.js`）

| 旧位置 | 要搬什么 |
| --- | --- |
| `plugins/surfcore/lib/index.js:346-383` | `startSchedulerNow`（会话 id = `bili-whale-<角色id>`；读平台开关）。 |
| `index.js:2379-2397` | `runBili(args, timeoutMs)`：用 `findNodeExe()` 跑 vendored 的 `tools/bili.mjs`。 |
| `index.js:2417-2466` | `handleWatchHistory` + `handlePreferenceScan`。 |
| `index.js:2467-2711` | `handleBili` 整段（账号/cookie/扫码/分享/动态/倾听/口味/待审/额度）。 |
| `plugins/surfcore/lib/scheduler.js` | 直接调用 `startScheduler(...)`；它依赖的 token 额度闸门改成读 `~/.dsh/surfcore/token-usage-daily.json` 快照（读不到 = 不拦）。 |
| `plugins/surfcore/lib/automation.js` | `automationSnapshot()`，原样使用。 |
| `plugins/surfcore/lib/bili-qr-login.mjs` | 扫码登录，原样使用。 |
| `tools/` 全目录 | 已由 `--copy-dir` vendor 进来；`BILI_MJS` 改成 `path.join(<包内 vendor>/plugins/surfcore/tools/bili.mjs)`（用 `import.meta.url` 算，不要写死）。 |

---

## 3. 浏览器半边取材（旧 `plugins/surfcore/lib/client.js`）

公共 UI 套件已在 `lib/client.js` 里内联（Row/Field/Section/Btn/api/ProgressBar/Browse/WindowsEditor/flatten/ErrorModal…）。

| 旧位置 | 要搬什么 |
| --- | --- |
| `client.js:1045-1160` | `BILI_FIELDS` 全部（作息/限额/工具/四类动态/倾听/推送/日记…）。 |
| `client.js:2291-2321` | `AutomationCard`。 |
| `client.js:2322-2369` | `QqShareSection`（定时分享 → 写 QQ 配置的 `biliBridge`，走 config-lock）。 |
| `client.js:2370-2474` | `FishGuardStatusCard`（B站 鱼群守则）。 |
| `client.js:2475-2582` | `WatchTab`（观看历史）。 |
| `client.js:2583-2698` | `BiliQrModal`（扫码）。 |
| `client.js:2699-2859` | `TasteEditor`（口味/关键词权重）。 |
| `client.js:2860-2991` | `BiliTab`（改造：管理员卡片只读；启动开关保留）。 |
| `client.js:5122-5384` | 栏目外壳；内页：B站 / 观看历史 / 口味。 |

---

## 4. 要提供的路由（前缀见 lib/index.js 的 API_PREFIX）

- `GET/POST /config — `bili.config.json``
- `GET /overview — 生物钟状态/今晚计划/账号/分发摘要`
- `POST /scheduler — start / stop / status / invalidate`
- `GET/POST /qr — 扫码登录 start/poll/cancel`
- `GET/POST /share、/dynamics、/listen、/dm、/live — 各类自主行为参数与立即执行`
- `GET/POST /taste — 口味关键词/权重；POST /preferences/scan — 一键抓偏好`
- `GET /watch-history — 她真正看过的视频`
- `GET /fish-guard — B站 鱼群守则状态`
- `GET /tools/deps、/tools/selftest — 依赖体检（跑 vendored bili.mjs）`
- `GET /status，GET /dsh-surfcore-bili/health`

---

## 5. 数据所有权

- `~/.dsh/surfcore/bili.config.json`（**唯一写者**）
- `~/.dsh/surfcore/bili/`（credentials/owner-credentials/数据）
- **跨包写**：`<surfcore>/config.json` 的 `biliBridge*` 键（走 config-lock）
- 只读：`memory/memory-card-prompt-bili.md`、`characters/current-role.json` + persona、`token-usage-daily.json`

### 跨包契约

- 额度闸门：只读 `token-usage-daily.json` 快照（bili 分项/总额），读不到 = 不拦（fail-open），并在 `/status` 里报 `tokenGate`。
- 记忆：不调 memory 包，读注入块文件；记忆写入走 pets 的 inbox 契约（如需）。
- 角色：读 `characters/current-role.json` 决定人格卡与记忆路径。
- `tools/bili.mjs` 通过子进程运行，路径从包内 vendor 解析。

---

## 6. 测试要求（补进 `scripts/test-smoke.mjs`）

- [ ] `/config` GET 脱敏（cookie 等）；POST 只改 bili 配置
- [ ] `/scheduler` GET 返回 `running` 状态对象；start 在 mock sessionController 下不抛错
- [ ] `/watch-history` GET 返回 `{ok:true, days/items...}`（用临时角色目录造数据）
- [ ] `/qr` GET/start 在无网络时返回可读错误（不 500 堆栈）
- [ ] `tools/bili.mjs` 存在于 vendor 且 `node <path> --help` 能跑（子进程）
- [ ] client 注册 1 个栏目

---

## 7. 本包特别注意

- 本包 vendor 体积最大（tools 836KB + 依赖）。**不要**手改 vendor；需要改行为就在 `lib/index.js` 里包一层。
- `runBili` 用 `findNodeExe()`：Electron 宿主里 `process.execPath` 是 Harness.exe，跑不了脚本，必须用这个。
- 非 Windows 平台上 scanner/ffmpeg 相关接口要返回可读错误。

---

## 8. 完成标准

- [ ] `node ./scripts/test-smoke.mjs` 通过
- [ ] `node ../tools/vendor.mjs --pkg . --roots plugins/surfcore/lib/scheduler.js,plugins/surfcore/lib/automation.js,plugins/surfcore/lib/bili-qr-login.mjs,plugins/surfcore/lib/memory-card.js,plugins/surfcore/lib/persona.js,plugins/surfcore/lib/store.js,plugins/surfcore/lib/paths.js,plugins/surfcore/lib/http-guard.js,plugins/surfcore/lib/bridge.js --copy-dir plugins/surfcore/tools --check` 通过（含 --copy-dir 时一起带上）
- [ ] `node ../tools/verify-all.mjs surfcore-bili` 通过
- [ ] 只改了 `surfcore-bili/` 目录；旧仓库 `surfcore/` 一行未动
- [ ] `README.md` 的负责/不负责与实际一致
