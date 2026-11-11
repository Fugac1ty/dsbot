# PLAN —— dsbot-pet

> 桌宠安装/更新/启停/卸载、桌宠对话、目的机制（主动搭话）桌宠载体、`pet/host.json` 心跳与本地令牌 API。
>
> **不负责**：目的机制 QQ 载体（桥接负责）、QQ/B站 业务。
>
> 架构契约：[../../docs/SPLIT-ARCHITECTURE.md](../../docs/SPLIT-ARCHITECTURE.md)
> 实现手册：[../../docs/PACKAGE-SPEC.md](../../docs/PACKAGE-SPEC.md)

---

## 1. 先 vendor 旧代码

```bash
cd 插件
node tools/vendor.mjs --pkg dsbot-pet --roots plugins/dsbot/lib/pet.js,plugins/dsbot/lib/pet-chat.js,plugins/dsbot/lib/pet-purpose.js,plugins/dsbot/lib/pet-api.js,plugins/dsbot/lib/memory-card.js,plugins/dsbot/lib/persona.js,plugins/dsbot/lib/store.js,plugins/dsbot/lib/paths.js,plugins/dsbot/lib/http-guard.js
```

vendor 保持仓库相对结构，包内引用写成：

```js
import { X } from './vendor/plugins/dsbot/lib/xxx.js';
```

---

## 2. 宿主半边取材（旧 `plugins/dsbot/lib/index.js`）

| 旧位置 | 要搬什么 |
| --- | --- |
| `plugins/dsbot/lib/index.js:221-237` | `petService` / `petChat` / `petPurpose` / `petApi` 创建（`ctx.get("subprocess")` 可选）。 |
| `index.js:2018-2149` | `handlePet`（安装/卸载/启动/停止/状态/对话/配置）。 |
| `index.js:2128-2149` + `2150-2246` | `purposeAvailability` + `handlePurpose`（目的机制：状态/预览/试一次/参数）。 |
| `index.js:2900-2906` | `petHostTimer`（每 2 分钟重写 `pet/host.json`）+ `petPurpose.start()`。**行为变更**：桌宠对话用量改 append 到 `token-usage-pet.jsonl`（不再直接调 tokenBudget 服务）。 |
| `plugins/dsbot/lib/{pet,pet-chat,pet-purpose,pet-api}.js` | 整份复用。 |

---

## 3. 浏览器半边取材（旧 `plugins/dsbot/lib/client.js`）

公共 UI 套件已在 `lib/client.js` 里内联（Row/Field/Section/Btn/api/ProgressBar/Browse/WindowsEditor/flatten/ErrorModal…）。

| 旧位置 | 要搬什么 |
| --- | --- |
| `client.js:1744-1953` | `PurposeCard`（目的机制：素材/目标/节奏/安静时段/预览/试一次）。 |
| `client.js:1954-2033` | `PurposeCarrierCard`（载体 桌宠/QQ + 形式 文本/语音 + 回落）。 |
| `client.js:2034-2082` | `PetChatTestCard`（桌宠对话测试）。 |
| `client.js:2083-2098` | `PurposeTab`。 |
| `client.js:4917-5103` | `PetTab`（安装/更新/启动/停止/卸载/形象/对话参数）。 |
| `client.js:5122-5384` | 栏目外壳；内页：桌宠 / 目的。 |

---

## 4. 要提供的路由（前缀见 lib/index.js 的 API_PREFIX）

- `GET/POST /pet — status / install / update / start / stop / uninstall / list / chat / config`
- `GET/POST /purpose — 状态 / 参数 / 预览 / 立即试一次 / 桌宠对话测试`
- `GET /status，GET /dsh-dsbot-pet/health`
- `桌宠本地接口前缀 `/dsh-dsbot/pet-api`（保留原名，Electron 从 host.json 读地址）`

---

## 5. 数据所有权

- `~/.dsh/dsbot/pet/**`（**唯一写者**：host.json/host-token/对话记录/focus.json/安装目录）
- 目的状态 `purpose-outreach.json`（随当前角色）
- `~/.dsh/dsbot/config.json` 的 `purpose` 键 → 实际在 **QQ 配置** `<dsbot>/config.json` 的 `purpose.*`（与桥接共享，走 config-lock）
- append：`~/.dsh/dsbot/token-usage-pet.jsonl`（用量，token 包汇总）
- 只读：`characters/current-role.json`、`memory/memory-card-prompt-qq.md`

### 跨包契约

- 目的机制载体互斥：读 `<dsbot>/config.json` 的 `purpose.carrier`（`pet`/`qq`）+ `petFallbackToQQ`；`carrier=qq` 时本包 tick 直接返回。专注模式读 `pet/focus.json`（桥接也读同一份）。
- 桌宠 Electron 从 `pet/host.json` 发现端口/令牌/`api` 前缀；写文件必须 0600。
- 对话用量：append `token-usage-pet.jsonl`，**不要**直接改 `token-usage-state.json`（那是 token 包独占）。

---

## 6. 测试要求（补进 `scripts/test-smoke.mjs`）

- [ ] `/pet` GET status 返回 `installed/running`；`/purpose` GET 返回参数与可用性
- [ ] `petApi.writeHostFile(true)` 后 `pet/host.json` 存在、0600、含 baseUrl/token/api
- [ ] `/purpose` POST 试一次在 carrier=qq 时不发（返回被跳过原因）
- [ ] client 注册 1 个栏目

---

## 7. 本包特别注意

- 桌宠是仓库外的 Electron 工程（`<工作区>/pet/`），本包只负责安装/更新/启停/接口，不 vendor 它。
- `pet.js` 会下载 Electron/安装包：测试里**不要**触发真实下载（mock `subprocess`/`fetch`，或只测 status 分支）。
- 桌宠 API 前缀 `/dsh-dsbot/pet-api` 与旧插件相同：迁移时必须先停旧插件。

---

## 8. 完成标准

- [ ] `node ./scripts/test-smoke.mjs` 通过
- [ ] `node ../tools/vendor.mjs --pkg . --roots plugins/dsbot/lib/pet.js,plugins/dsbot/lib/pet-chat.js,plugins/dsbot/lib/pet-purpose.js,plugins/dsbot/lib/pet-api.js,plugins/dsbot/lib/memory-card.js,plugins/dsbot/lib/persona.js,plugins/dsbot/lib/store.js,plugins/dsbot/lib/paths.js,plugins/dsbot/lib/http-guard.js --check` 通过（含 --copy-dir 时一起带上）
- [ ] `node ../tools/verify-all.mjs dsbot-pet` 通过
- [ ] 只改了 `dsbot-pet/` 目录；旧仓库 `dsbot/` 一行未动
- [ ] `README.md` 的负责/不负责与实际一致
