# DSBot 拆分架构（8 个独立插件）

> 目标：把合体插件（老仓库）（宿主 `lib/index.js` 2958 行 + 设置页 `lib/client.js` 5409 行 +
> ~20 个宿主模块）拆成**一个个单独的插件**。拆分期间**旧插件一行不改**；新包在
> `插件/` 下独立开发与测试，全部完善后再整体迁移（见 [MIGRATION.md](MIGRATION.md)）。
>
> 本文件是 8 个包的共同契约。每个包的具体取材位置见包内 `PLAN.md`。

---

## 0. 四条硬约束（所有包都必须满足）

1. **自包含**：包内代码只能 `import` 包内文件、Node 内置模块、以及自己 `package.json` 声明的 npm 依赖。
   **禁止**出现 `../../../src/*.js`、`dsbot` 之类的包外引用。由
   `tools/test-harness.mjs` 的 `checkPackage()` 自动检查，违反即测试失败。
   - 需要的旧代码用 `tools/vendor.mjs` **原样复制**到 `lib/vendor/`（保持仓库相对结构，
     所以一行 import 都不用改）。
2. **不改旧插件**：`‹老仓库›/**` 只读。所有产出写在本工作区 `插件/`。
3. **可离线验证**：每个包自带 `scripts/test-smoke.mjs`，用 mock ctx 装配宿主半边、
   用假 `window.__ModuleLoader__` 加载浏览器半边，不启动 DSH、不连 QQ、不写真实 `~/.dsh`。
4. **数据兼容**：继续读写原有配置文件与状态目录（QQ 的 `config.json`、`~/.dsh/dsbot/*`、
   `bili.config.json`、记忆目录、`characters/`、`pet/` 等），保证迁移后旧数据直接可用、
   桥接进程与 B站 工具链不用改。

---

## 1. 包清单

| # | 包 | 设置栏目 | API 前缀 | 负责 | 不负责 |
| --- | --- | --- | --- | --- | --- |
| 1 | `dsbot-core` | DSBot · 核心 | `/dsh-dsbot-core/api` | 配置模型与读改写、管理员身份投影、概览/诊断、全部参数、扩展宿主、平台注册表、组件更新、备份、日志、原生浏览 | QQ/B站 业务参数与运行、记忆内容、角色 |
| 2 | `dsbot-qq` | DSBot · QQ | `/dsh-dsbot-qq/api` | QQ 桥接进程启停/自愈/日志/状态、`qq-mode` settings 命名空间、模式切换、白名单/黑名单、SnowLuma 检测与启动、QQ 鱼群保护状态 | B站 调度、分享（归 bili）、记忆/角色/额度 |
| 3 | `dsbot-bili` | DSBot · B站 | `/dsh-dsbot-bili/api` | B站 生物钟（scheduler 五条 tick）、bili 配置与 cookie/扫码登录、养鱼参数、观看历史、口味扫描、定时分享/四类动态、B站 鱼群守则 | QQ 桥接本身、记忆维护 |
| 4 | `dsbot-memory` | DSBot · 记忆 | `/dsh-dsbot-memory/api` | 衰减记忆卡（维护/压缩/备份/注入块渲染）、双向脱敏记忆（QQ⇄B站）、身份对齐、隐私闸门、主人特权审计 | 记忆内容产生者（桥接/调度器） |
| 5 | `dsbot-character` | DSBot · 角色 | `/dsh-dsbot-character/api` | 角色包（创建/切换/存档/回档/删除）、人格卡解析与编辑、角色迁移与指针、自我认同 | 记忆卡内容 |
| 6 | `dsbot-token` | DSBot · 额度 | `/dsh-dsbot-token/api` | 每日 token 额度与用量采集（四口径）、峰谷计价、80%/100% 闸门、启动回填、额度文件 | 其它插件的用量明细（它们各自追加） |
| 7 | `dsbot-pet` | DSBot · 桌宠 | `/dsh-dsbot-pet/api`（桌宠 API 仍为 `/dsh-dsbot/pet-api`） | 桌宠安装/更新/启停/卸载、桌宠对话、目的机制（主动搭话）桌宠载体、`pet/host.json` 心跳 | QQ 载体的目的发送（桥接自己做） |
| 8 | `dsbot-voice` | DSBot · 语音 | `/dsh-dsbot-voice/api` | 语音包安装/启停/健康检查、TTS 路由（本地/云端/Piper）、角色音色、云端凭据 | 语音消息的发送（桥接/桌宠各自做） |

安装后，DSH 设置里会出现 8 个独立栏目（`settings.section` 的 id = 包名）。
它们在 UI 上并列，互不依赖；任何单个包都可以单独安装/停用（停用只影响它自己的栏目与后台任务）。

---

## 2. 目录与文件标准

每个包结构一致（由 `tools/new-plugin.mjs` 生成骨架）：

```
dsbot-<part>/
├── package.json          # name=目录名；exports ./client；dsh.bundle.patch；dsh.client.platform=web
├── cordis.patch.yml      # insert 一行：id=<包名> name=<包名> config: {}
├── icon.svg              # 插件列表图标（每个包不同色）
├── locale/{zh,en}.json   # 插件名/描述
├── lib/
│   ├── bootstrap.js      # 运行根探测，必须是 lib/index.js 的第一个 import
│   ├── config-lock.js    # 跨插件配置锁 + 原子写 + 备份（协议见 §4）
│   ├── index.js          # 宿主入口：export name/inject/apply/default
│   ├── client.js         # 浏览器半边：window.__ModuleLoader__.load({id, factory})
│   └── vendor/           # 旧代码原样副本（MANIFEST.json 记录来源与哈希）
├── scripts/test-smoke.mjs
├── PLAN.md               # 本包的取材清单（人读）
└── README.md
```

宿主入口约定：

```js
export const name = 'dsbot-<part>';
export const inject = ['webServer', 'connection'];   // 需要什么写什么
export function apply(ctx) { /* 建服务 → 注册路由 → 挂定时器 → ctx.effect(清理) */ }
export default { name, inject, apply };
```

浏览器入口约定：每个包**恰好注册一个** `settings.section`，id = 包名。
栏目内部可以自带标签页（例如 B站 包内含「B站 / 观看历史」两个内页）。

公共 UI（`Row/Field/FieldGroups/Section/AdvancedSettings/Btn/StatusDot/api()/ProgressBar/Browse/
WindowsEditor/flatten/ErrorModal` 等）从 `templates/client-kit.js` 内联进每个 `lib/client.js` ——
浏览器半边是经典脚本，不能 `import` 相对文件，所以只能每包自带一份。
每个包的 `CSS_TAG` 必须是 `<包名>/console.css`（避免重复注入同一个 style id）。

---

## 3. 宿主服务（DSH 提供，插件侧只用 `ctx.get()` / `inject`）

| 服务 | 用途 | 谁用 |
| --- | --- | --- |
| `webServer.register({kind,path,handler})` | 注册路由，返回 disposer | 全部 |
| `connection.requestRejection(req)` | DSH 自己的准入判定（路由里再挡一层） | 全部 |
| `sessionController.prompt/create/inspect/cancel/list` | 塞「你醒了」回合、建/查/取消会话、token 回填 | bili / token / pet |
| `sessions.get` + `permissionPresets.current/set` | 给 B站 会话单独切权限 | bili |
| `ctx.on('session/event')` / `('session/created')` | 实时 token 计量、会话创建即切权限 | token / bili |
| `settings.describe/update` | 读写 `qq-mode` 命名空间 | qq |
| `subprocess` | 拉起桌宠子进程 | pet |
| `slots`（客户端） | 注册设置栏目 | 全部 |

---

## 4. 跨插件配置共享协议（拆分后唯一的新机制）

多个包会写同一批 JSON 文件。为此每个包内 `lib/config-lock.js` 实现同一套三条协议：

1. **写前拿锁**：`<STATE_DIR>/config.lock` 目录（`mkdir` 原子）；锁内 <10s 未释放视为陈旧可抢占；
   拿不到锁最多等 10s 后**报错**（绝不静默丢写）。
2. **锁内完成整轮 读-改-写**：只改自己负责的键，其余键原样写回。禁止「锁外读、锁内写」。
3. **覆盖前备份**：`<STATE_DIR>/backups/<文件名>.<时间戳>`（保留 40 份）；临时文件 + rename 原子替换。

写法：

```js
import { updateJsonFile } from './lib/config-lock.js';
import { QQ_CONFIG } from './vendor/plugins/‹合体插件›/lib/paths.js';

updateJsonFile(QQ_CONFIG, (cfg) => {
  const social = cfg.socialV2 ?? (cfg.socialV2 = {});
  social.voice = { ...(social.voice ?? {}), ...patch };
  return cfg;
}, { backupLabel: 'voice' });
```

> ⚠️ 旧单体插件不认识这把锁。所以**迁移期不要同时运行新旧两边**（见 MIGRATION.md）。

### 4.1 文件 / 键所有权（唯一写者）

| 文件 / 目录 | 唯一写者 | 说明 |
| --- | --- | --- |
| `<dsbot>/config.json` | `dsbot-qq` | QQ 桥接配置。**例外**：`socialV2.voice*` 由 `dsbot-voice` 写；`biliBridge*` 由 `dsbot-bili` 写（都要走锁） |
| `~/.dsh/dsbot/config.json`（统一配置） | `dsbot-core` | **例外**：`bridge` 由 qq 写；`persona` 由 character 写；`memory` / `alignment` / `memoryCard` 由 memory 写；其余键（`admin`/`extensions`/`platforms`/`updates`/`ui`/`qqbotRoot`）由 core 写。全部走锁 |
| `~/.dsh/dsbot/bili.config.json` | `dsbot-bili` | B站 全部参数与凭据引用 |
| `~/.dsh/dsbot/memory/**` | `dsbot-memory` | 记忆卡、注入块、双向记忆 md、inbox 的**维护者**；inbox 允许多写者 append（追加单行，天然安全） |
| `~/.dsh/dsbot/characters/**`、`persona` 路径 | `dsbot-character` | 角色包 + 当前角色指针 |
| `~/.dsh/dsbot/token-*.json` | `dsbot-token` | 额度与用量快照 |
| `~/.dsh/dsbot/token-usage-pet.jsonl` | `dsbot-pet` | 桌宠对话用量（append-only；由 token 包读入「其他」口径） |
| `~/.dsh/dsbot/pet/**` | `dsbot-pet` | 桌宠状态、`host.json`、`host-token`、对话记录 |
| `<dsbot>/state/*` | 桥接进程（外部） | 插件只读（对话历史、token 用量原始记录、白名单快照） |
| `~/.dsh/dsbot/plugin.log` | 全部 | 只 append（各包前缀 `[包名]`） |
| `~/.dsh/dsbot/backups/` | 全部 | 文件名含来源标签，天然不冲突 |

### 4.2 只读/只写契约（跨包解耦点）

| 契约 | 写者 → 读者 |
| --- | --- |
| `memory/memory-card-prompt-qq.md` / `-bili.md` | memory → 桥接进程 / bili 调度器 |
| `memory/memory-inbox.jsonl` | 桥接 / bili / pet append → memory 维护 |
| `token-usage-daily.json` | token → bili 调度器（额度闸门只读） |
| `token-usage-pet.jsonl` | pet append → token 汇总 |
| `pet/host.json`、`pet/host-token` | pet → 桌宠 Electron |
| `characters/current-role.json` | character → qq/bili/memory/pet（读，决定人格卡与记忆路径） |
| `<dsbot>/state/mode.json` | 桥接写 / qq 读（模式显示） |
| `<dsbot>/state/alignment-brief.md` | memory → 桥接 / bili 调度器 |
| `<dsbot>/state/needs-bridge-restart.json` | character 写（切换角色后）→ qq 包自愈 tick 读到就重启桥接并删除标记 |
| `<dsbot>/state/plugin-intent.json` | 任意包写「希望别的包做一件事」的通用意图文件（role/action/reason/at），消费方责任方删除；目前只有 role-switch 用到 |

**规则：跨包只通过这些文件与只读 HTTP 交互，不做进程内 service 依赖**（保证任意子集可单独安装）。

**意图文件约定**（`state/needs-bridge-restart.json`）：写者只负责「写文件」，不做跨包动作；
责任方在自己的定时任务里读文件 → 执行 → 删除文件。格式：

```json
{ "action": "restart-bridge", "reason": "character-switched", "roleId": "<id>", "at": "2026-11-03T..." }
```

消费方必须是**幂等**的：文件不存在 / 已过期（>30 分钟）/ 内容不合法时直接忽略。

---

## 5. API 约定（8 个包统一）

- 前缀见 §1；同前缀内用 `pathname` 分派（与旧插件相同的风格）。
- 响应体：`{ ok: true, ... }` 成功；`{ ok: false, error, code?, hint? }` 失败。
- 状态码：`400` 参数/请求体、`403` 非回环/跨站、`404` 未知接口、`405` 方法不对、`409` 冲突、`415` JSON、`500` 未预期。
- 四层准入（每个包的 `route()` 已内建）：回环 Host → 写操作同源 → 写操作 `application/json` →
  `connection.requestRejection`。
- 读配置给 UI 前必须脱敏（`********`）；保存时 `********` 表示保持原值（沿用旧 `store.js` 语义：
  `redactForUi` / `restoreMaskedSecrets`，可直接用 vendored 版本）。
- 每个包额外暴露 `GET <前缀>/status`（插件自检）与 `GET /dsh-<包名>/health`（存活探针，不经过 DSH 鉴权）。

---

## 6. 后台任务边界

| 任务 | 归属 | 周期 |
| --- | --- | --- |
| 桥接进程自愈（2 分钟） | qq | 2 min |
| B站 生物钟五条 tick | bili | 8/12/15/20/25s 首启后按 60s/60s/30s/20s/60s |
| 记忆卡维护 | memory | 首 8s，之后 10 min |
| 角色自动存档 | character | 首 10s，之后 6 h |
| QQ→B站 记忆同步 | memory | 首 20s，之后 `memory.qqToBili.intervalMs`（≥5 min） |
| token 采集 | token | 事件驱动 + 落盘节流 |
| 桌宠 host.json 心跳 | pet | 2 min |
| 目的机制桌宠载体 tick | pet | 60s（`carrier=pet` 时才跑） |
| 组件更新检查 | core | 首 20s，之后 6 h |

所有定时器必须 `.unref?.()`，并在 `ctx.effect` 的清理函数里清掉 —— 保证插件停用后不残留。

---

## 7. 验收标准（Definition of Done）

一个包算「完成」需要同时满足：

1. `node scripts/test-smoke.mjs` 通过（含 `checkPackage()`：清单/patch/自包含/栏目注册）。
2. `node ../../tools/vendor.mjs --pkg . --roots <...> --check` 通过（vendor 与旧仓库一致）。
3. 宿主半边：`status` + 本包主要 GET/POST 接口都有断言；`apply()` 能在 mock ctx 下装配与卸载。
4. 浏览器半边：ModuleLoader 能加载，注册 1 个 `settings.section`，id = 包名。
5. `README.md` 写清负责/不负责、数据文件、测试方式。
6. 不改动 `dsbot/` 任何文件（`git status` 里不应出现旧仓库路径）。

---

## 8. 已知限制（诚实记录）

- **UI 无法离线看效果**：只能验证「加载成功 + 注册成功 + 组件能构造」，
  真实像素/交互要在 `docs/MIGRATION.md` 的安装验证阶段看。这是「先不装」决策的代价。
- **`dsbot/presets/*.patch.yml`（两个 QQ agent preset）与 `qq-tool-restrict.mjs` 仍留在旧包**：
  它们不是「部件」，迁移时单独处理（见 MIGRATION.md §4）。
- **桥接进程与 B站 工具链不拆**：`src/bridge.js`（15k 行）与 `tools/bili.mjs` 是独立运行的程序，
  不是 DSH 插件；拆分包只负责「配置它们、启停它们、展示它们」。B站 包把 `tools/` 一起 vendor 进包内，
  使新包不依赖旧仓库目录。
- **桌宠 API 前缀保持 `/dsh-dsbot/pet-api`**：桌宠 Electron 进程从 `pet/host.json` 读取地址，
  为兼容不改名。迁移时旧插件必须先停用，避免同一前缀被两个插件注册。
