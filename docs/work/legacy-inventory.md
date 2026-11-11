# DSBot 线上部署与能力盘点（迁移底稿）

> 用途：为「把线上 QQ 机器人从 DSBot 切到 Aurabot」提供 DSBot 侧的**事实底稿**。只读盘点，不改变任何代码/配置。
> 别名（下文用缩写）：`<SC>` = `‹老仓库›`；`<PL>` = `<SC>/plugins/‹合体插件›`（线上插件，v0.7.13）；
> `$DSH_HOME` = `/home/ubuntu/dsh-agentchat/dsh-0.2-home`；`<STATE>` = `$DSH_HOME/‹状态目录›`（插件状态）；`<BST>` = `<SC>/state`（桥接状态）。
> 证据约定：`文件:行号` 均指上述路径下的真实行号；无法确认的写「未确认」并给确认方法（见 §9）。
> 敏感值一律 `***`；QQ 号/群号保留（迁移要用）。盘点时间 2026-11-03 13:00 前后（Asia/Shanghai）。

---

## 1. 运行拓扑与数据流

### 1.1 进程 / 端口 / 版本（实测）

| 组件 | 实例 | 端点 | 证据 |
| --- | --- | --- | --- |
| QQ 客户端 + SnowLuma（Docker） | 容器 `snowluma`，镜像 `docker.m.daocloud.io/motricseven7/snowluma:latest`，QQ 号 **2477094441**（昵称「大肥鱼」） | OneBot v11 HTTP `127.0.0.1:3000`、WS `127.0.0.1:3001`、WebUI `127.0.0.1:5099`、VNC `127.0.0.1:6081` | `docker ps`；`snowluma/data/config/onebot_2477094441.json:1-40`；`<BST>/self-identity.json` |
| QQ 桥接（外置 Node 进程） | **pid 2091**，2026-11-03 12:10:02 启动，`node <SC>/src/bridge.js`（842 KB / 15,220 行） | 本地控制台 `127.0.0.1:3100` | `ps -o pid,lstart,cmd -p 2091`；`<BST>/bridge.lock`=2091；`src/bridge.js:8337` |
| DSH 运行时（本会话这只） | **pid 990**，`@deepseek-ai/dsh 0.2.1-rc.5`，node **v24.19.0**，`--profile web --port 3102` | `127.0.0.1:3102`，公网入口经 Caddy：`10325`(https 域名)、`10326`(->3102) | `ps`；`dsh-0.2-trial/package.json`；runtime context（GUI = https://154.8.153.208:10326/） |
| DSH MCP 子进程（3 个） | pid 2244 `mcp-web-search-safe.js`、2252 `mcp-snowluma-safe.js`、2253 `mcp-host-server.js`，父进程均为 990 | stdio | `ps -eo pid,ppid,cmd` |
| Caddy（反代 + 面板鉴权） | pid 1365，`/run/dsh-auth-caddy/Caddyfile`（配置文件无读权限） | 监听 `*:10325`、`*:10326` | `ss -ltnp` |
| **另一只 DSH（与 DSBot 无关，待确认）** | pid 972，pnpm 全局 `dsh web --port 3080`，使用默认 `~/.dsh`（该 home 下**没有** dsbot 插件/状态） | `127.0.0.1:3080` | `ps`；`ls ~/.dsh` |

关键路径事实：

- 插件以 **link 依赖 + bundle** 双重方式装入 profile：`$DSH_HOME/profiles/web/package.json` 的 `dependencies.dsbot = link:.../dsh-0.2-home/plugins/dsbot`，且 `dsh.profile.bundles` 里列了 `dsbot`（决定 cordis.patch.yml / presets 被合成）。
- 插件目录本身是符号链接：`$DSH_HOME/plugins/dsbot -> <SC>/plugins/dsbot`；profile 内 `node_modules/dsbot -> ../../../plugins/dsbot`（供 preset 用裸说明符 `dsbot/qq-tool-restrict.mjs`，见 `qq-tool-restrict.mjs:5-13`）。
- DSH_HOME 由启动器注入环境变量；插件侧解析见 `lib/paths.js:14-25`（`DSH_HOME` 缺省 `~/.dsh`，`STATE_DIR=$DSH_HOME/dsbot`）。

### 1.2 数据流（二代仿真 reserved2 现状）

```
QQ 客户端(容器内)
  │  OneBot v11
  ▼
SnowLuma 网关 (Docker, :3000 HTTP / :3001 WS, token 见 onebot_2477094441.json → 已掩码)
  │  WS 文本事件
  ▼
bridge.js (pid 2091)  ──HTTP 控制台(3100, x-console-token)──▶ 设置页/运维脚本
  │  ① 消息归一化 / 白名单 / 鱼群 / token 闸 / 收尾判断
  │  ② RPC: /api/<method>（session/prompt 等）+ WS: /api/remote.mux（事件流）
  ▼
DSH 0.2.1 (pid 990, :3102)  ── agent preset `qq-chat-v2`（reserved2 模式）
  │  模型 provider=deepseek-official / model=deepseek-flash / effort=high
  │  工具面：mcp__snowluma__qq_*（39 个）+ mcp__web-search-safe__*（2 个）+ qq-tool-restrict 守卫
  ▼
bridge /api/socialV2/* （带会话级 x-agent-token）──▶ OneBot send_msg ──▶ QQ
```

- 一代模式（`chat`，preset `qq-chat`）存在但**当前未启用**；当前全局模式 = `reserved2`：`<BST>/mode.json`、启动日志 `<SC>/../logs-dsbot-bridge.log`「桥接模式已确定为 reserved2」。
- 桥接→DSH 的 RPC 端点/参数形状集中在 `src/dsh-client.js:160-186`、`src/dsh-client.js:513/690`（`/api/remote.mux` WS），协议注释见 `src/dsh-client.js:1-10`。
- SnowLuma 侧 token 自愈：`src/snowluma-conn.js:1-14`（按账号扫描 `onebot_*.json` 试 `get_login_info`），成功后**回写** `<SC>/config.json`（`src/snowluma-conn.js:187-230`，调用点 `src/bridge.js:15032`、`15053`）。

### 1.3 桥接如何被拉起 / 自愈（迁移必须知道）

- 插件 `maybeAutoStartBridge()`：`<PL>/lib/index.js:619-644`；判定过期 `bridgeStaleReason()` `<PL>/lib/index.js:601-612`（root 变了或 `dshBaseUrl` 与当前 DSH 不一致 → 重启桥接）。
- 启动实现 `<PL>/lib/bridge.js:168-196`（`spawn(node, [<SC>/src/bridge.js])`，注入 `DSH_WEB_URL`，等最多 12s 端口就绪）；停止 `<PL>/lib/bridge.js:198-246`；重启 `:248-254`。
- DSH 地址来源：`currentDshUrl()` `<PL>/lib/index.js:592-598`（读 `webServer.port`，兜底 `DSH_WEB_URL`）；桥接侧兜底探测 `src/dsh-port.js:51-62`（**仅 Windows** 枚举进程；Linux 直接返回 null → 依赖 `DSH_WEB_URL`/config.json），探活判据 `src/dsh-port.js:71-83`。
- 自愈轮询：插件每 120s（`<PL>/lib/index.js:2920-2922`）；桥接自身对 SnowLuma WS 断开按 10~60s 退避重连（日志 `SnowLuma 连接断开（code=1006），重连中…`）。
- 控制台 3100 的用途：**不是 QQ 面板**，而是桥接自带的本地 HTTP 控制台 + 设置页代理目标（`src/bridge.js:3752-3775`，仅 127.0.0.1）；插件把语音/分享/记忆刷新等请求带 `x-console-token` 转发过去（`<PL>/lib/index.js:1896-1975`、`<PL>/lib/bridge.js:60-90`）。

---

## 2. 生产配置现状

### 2.1 四份配置的职责（不搬家的单一真相，见 `lib/store.js:1-12`）

| 文件 | 谁读 | 谁写 | 作用 |
| --- | --- | --- | --- |
| `$DSH_HOME/dsbot/config.json` | 插件（`lib/paths.js:20` UNIFIED_FILE） | 插件设置页 | 「合体配置」：persona/admin/memory/privacy/alignment/memoryCard/extensions/platforms/updates/ui |
| `<SC>/config.json` | 桥接（`src/bridge.js:766-768`）、MCP server（`src/mcp-snowluma-safe.js:28-41`） | 用户 + 设置页 + **桥接自己的 token 自愈会改写** | 桥接配置：dsh/allow/social/socialV2/fishGuard/slang/purpose/greetings/biliBridge… |
| `$DSH_HOME/dsbot/bili.config.json` | B站工具链、插件 | 插件设置页 | B站账号/偏好/额度/夜间/监听/分享/鱼群 |
| `<SC>/config.example.json` | 插件（默认值合并 `lib/store.js:286`） | — | 缺省值与注释 |

### 2.2 `$DSH_HOME/dsbot/config.json` 关键键（现值）

- `qqbotRoot=<SC>`、`bridge.autoStart=true`、`bridge.consoleBase=http://127.0.0.1:3100`（`bridge.startScript` 为 Windows 的 `start.bat`，Linux 不用）。
- `admin.qq=1362431704`、`displayName=主人`、`gentle=true`。
- `memory.qqToBili.enabled=false`（QQ→B站 同步**关**）；`memory.privacy.*` 全开（私信/密钥/PII/联系方式拦截 + 审计）。
- `alignment.enabled=true`、`priority=override-sync`（对齐高于同步开关，见 `lib/align.js:1-10`）。
- `memoryCard.enabled=true`、`maxChars=0`（不限）、`warnChars=60000`、`injectMaxChars.qq=2200`、`recentDays=7`、`forgetAfterDays=60`、`dailyHour=4`、`autoCompact=true`。
- `platforms.enabled=[qq,bili]`、`platforms.start={qq:true,bili:true}`、`planned=[tieba]`。
- `updates.enabled=true`（每 6h 查 GitHub release；pet 走 `surfpet` releases）。

### 2.3 `<SC>/config.json`（桥接）关键键（现值）

| 键 | 现值 | 含义/证据 |
| --- | --- | --- |
| `dsh.baseUrl/provider/model/reasoningEffort` | `http://127.0.0.1:3102` / `deepseek-official` / `deepseek-flash` / `high` | 会话创建时用；默认值在 `src/bridge.js:770-783` |
| `allow.private` / `allow.groups` | `["1362431704"]` / `["694991842"]` | 唯一准入白名单（`src/bridge.js:1630 allowed()`）；空则按 `allowAllWhenEmpty` |
| `allowAllWhenEmpty` | `false` | 关闭时白名单为空=全拒 |
| `agentPreset` / `workspaceTitle` | `qq-chat` / `QQ 聊天` | 一代默认；二代见 `socialV2.agentPreset` |
| `socialV2.enabled` | `true` | 二代仿真总开关（`src/bridge.js:9373-9380`） |
| `socialV2.agentPreset` | `qq-chat-v2` | reserved2 会话用的 preset |
| `socialV2.tools.*` | 31 个布尔开关，`setStickerRemark=false`、`sendVoice=false` | MCP 工具按会话裁剪（`mcp-snowluma-safe.js` 注册期 + `bridge` 侧二次校验） |
| `socialV2.wake.*` | `defaultMode=diving`、`preSleepWaitMs=300000`、`maxWakePerHour=12`、`noActionLimit=3` | 唤醒/潜水预算 |
| `socialV2.closure.*` | `enabled=true`、`cooldownMs=1200000`、`promptInWake=true` | 收尾判断（`src/conversation-closure.js`） |
| `socialV2.send.*` | `maxSendPerMinute=8`、`maxSendPerHour=60`、`maxMessageChars=500`、分条 1~3s | 发送节奏与刷屏限制 |
| `socialV2.tokenGuard.*` | `enabled=true`、`maxWakesPerDay=20`、`privateMaxWakesPerDay=10`、`maxDailyCostCNY=8` | token 防爆破（`src/token-guard.js`） |
| `socialV2.voice.*` | `enabled=false`、`tts.enabled=false` | 语音默认关（当前也没装语音包） |
| `socialV2.history.*` | `enabled=true`、`limit=30`、`maxAgeMinutes=720`、`wake=true` | 上线补历史（`src/history-catchup.js`） |
| `fishGuard.*` | `enabled=true`、窗口 10min、`maxFish=5`、`maxFishRatio=0.6`、`blockSends=true` | QQ 鱼群保护（`src/fish-guard.js`） |
| `slang.enabled` | `true`，`learnerPreset=qq-chat`、`autoResearch=true` | 黑话学习（`src/slang-learner.js`） |
| `purpose.enabled` / `greetings.enabled` / `proactive.enabled` | 全 `false` | 目的机制、早安、主动搭话当前**未启用** |
| `biliBridge.enabled` | `false`（`memory/dynamics/share` 亦 false） | B站→QQ 记忆/动态/定时分享当前**未启用**（`src/bridge.js:1202-1231`、`15136`） |
| `snowluma.httpUrl/wsUrl/accessToken` | `http://127.0.0.1:3000` / `ws://127.0.0.1:3001` / `***` | `followDiscoveredEndpoint=true`、`allowLaunch=false` |
| `consolePort` / `consoleToken` | `3100` / 空 | 空=启动时自动生成并落 `<BST>/console-token`（`src/bridge.js:3760-3772`） |
| `httpGuard.trustedProxyHosts` | `154.8.153.208:10326`、`dsbot.154.8.153.208.sslip.io:10325` | 反代域名白名单（`<PL>/lib/http-guard.js:79-86`） |
| `webSearch.*` | `provider=auto`、`model=deepseek-v4-flash`、`apiKey=***`、`maxUses=5` | web-search MCP 的配置（`src/web-search.js`） |

### 2.4 `$DSH_HOME/dsbot/bili.config.json` 关键键

`self/owner` 的 mid/name **均为空**（=B站未登录）；`night.windows=[{20:00-24:00, wakes:1}]`、`skipChance=0.3`；`preferences.like/dislike` 各若干（DSH/AI 工具、鬼畜、猫咪、Live2D；带货/擦边/标题党/纯搬运）；`quota.shareDaily=3`；`limits.daily=30/replyDaily=50/taDaily=15/...`；`dynamics.kinds` 四类固定开头（best 8 点 / game 12 点 / anime 16 点 / gaming 20 点）；`diary.push=true`；`listen.comment=true`（每 300s）；`share.enabled=true,minScore=13`；`fishGuard`（B站评论区版，`maxFishRatio=0.4`、点赞限流）；`notify.type=none`。

### 2.5 会被运行时改写的配置（迁移注意）

- `<SC>/config.json` 的 `snowluma.accessToken/wsUrl/httpUrl` 会被桥接自愈**写回**（`src/bridge.js:15032`、`15053`）。
- `$DSH_HOME/dsbot/config.json`、`bili.config.json` 保存时会先备份到 `<STATE>/backups/`（`<PL>/lib/store.js:570-605`）。

---

## 3. 桥接侧行为清单（须逐项对照的「能力」，不只是接口）

桥接进程（`src/bridge.js`，15,220 行 + `src/*.js` 纯逻辑模块）承担了大部分「像人」的行为。它们**不在插件里**，迁移时最容易被漏掉：

| 行为 | 规则要点 | 实现（file:line） | 线上状态 |
| --- | --- | --- | --- |
| 白名单/黑名单 | `allow.groups/private` 是唯一准入；`deny.users` 按人拉黑（会话仍在白名单也不触发）；空名单时按 `allowAllWhenEmpty=false` 全拒 | `src/bridge.js:1630`（`allowed()`）、`:796-812`（allow/deny 归一化）、`:1652`（`senderBlocked()`） | 在用：群 694991842、私聊 1362431704 |
| 二代仿真（reserved2） | 文本不自动转发，AI 必须用 `qq_send_message` 等工具发言；每会话独立 `agentToken`（MCP 调用鉴权）；唤醒/潜水由模型自主 | `src/bridge.js:9373-9400`（运行态）、`:12235`（唤醒调度）、`:9808`（初始提示词）、`:3773-3804`（agentToken）、`:154-170`（模式别名） | **在用**（mode=reserved2） |
| 对话收尾判断 | 「这段是否已经可以结束」的纯逻辑：收尾式最后一句/对方是否在提问/是否有 pendingThought/话题闭环/节奏疲劳 → 建议收尾；对「对方明确提问/求助」硬拒收尾 | `src/conversation-closure.js:1-20`、`src/bridge.js:10283`、工具 `qq_close_conversation`（`src/mcp-snowluma-safe.js:623`） | 在用（`socialV2.closure.enabled=true`） |
| Token 防爆破 | 每日唤醒上限（群 20/私聊 10）、最小间隔 2min、直接点名可绕过间隔、单轮出站≤8、日花费上限 ¥8 | `src/token-guard.js:1-15`、`src/bridge.js:10093`、`:3041`（账本）、`:10101`（每日额度） | 在用 |
| 早安问候 | 每天定时私聊/群里问候；错过 3h 内补发、失败 10min 重试；reserved2 下要求模型用工具发 | `src/greeting-schedule.js:1-20`、`src/bridge.js:11188` | **未启用**（`greetings.enabled=false`） |
| 上线补历史 | 掉线期间的消息用 OneBot `get_group_msg_history` 补回，只并入「水位之后、本地没存过」的，避免重复唤醒/风暴 | `src/history-catchup.js:1-25`、`src/bridge.js:13170` | 在用（`socialV2.history.enabled=true`） |
| 鱼群保护（QQ） | 10min 窗口内同名鱼 ≥5 / 连续 5 条鱼 / 鱼占比 ≥60% → 不参与；直接 @/引用默认放行；`blockSends=true` 时硬拦 | `src/fish-guard.js:1-18`、`src/bridge.js:9952` | 在用 |
| B站定时分享 / 记忆同步 | 每天 8 个时间点把 B站 视频分享到白名单群（可选卡片模式）+ 周期刷新 B站→QQ 记忆简报 + 动态轮询 | `src/bili-share-scheduler.js`、`src/bili-memory.js`、`src/bridge.js:15114-15170`、`src/share-mode.js` | **未启用**（`biliBridge.enabled=false`，B站未登录） |
| 身份对齐注入 | 桥接只读插件写的 `state/alignment-brief.md`（按 mtime 缓存），**群聊**投递前**置顶**注入；不依赖记忆同步开关 | `src/bridge.js:718-730`、`:2905-2911` | 机制在，但 `links:[]`（无映射可注入） |
| 记忆卡注入 | 读插件写好的 `memory-card-prompt-qq.md`（mtime 缓存）拼进提示词；容量 80/90/100% 时私聊管理员告警 | `src/bridge.js:11717-11760`、`:5569`、`:8301-8318`；写卡方 `<PL>/lib/memory-card.js:1-10` | **在用** |
| 人格卡注入 | 每条消息前注入当前角色 `persona.md`（热生效），带上限（默认 6000 字，可配 1k~20k） | `src/bridge.js:352-372`、`:1153-1157` | 在用 |
| 仿真层提示词 | preset 的 `persona.prefix`（行为/协议）可被控制台读写，带安全基线校验（缺标记则警告/拒绝） | `src/preset-prompt.js:1-25`、`src/bridge.js:467+` | 在用 |
| 自我身份锚点 | 跨平台「我是谁」卡片（QQ 完整号 / B站 mid 公开），并在 B站 侧给 QQ 号打码 | `src/self-identity.js:1-18`、`src/bridge.js:37`（provenance/self block） | 在用（`state/self-identity.json` 有 QQ 2477094441/昵称大肥鱼） |
| 身份泄露闸 | 公开面（B站评论/动态）发送前做精确 ID 命中 + 「QQ/群号+数字」形态拦截 | `src/identity-guard.js:1-15`、`src/bridge.js`（发送链路） | 在用 |
| 黑话学习 | 群聊抽取候选 → AI 解释 → 管理员确认后进入提示词；注入上限 8 条 | `src/slang-learner.js`、`src/bridge.js`（`/api/slang/*`） | 在用（库内 247 条） |
| 表情包语义 | 收藏表情的情绪/内容索引 + 按最近消息算 1~2 张「表情匹配」，模型可发/可偷 | `src/sticker-lib.js`、`src/sticker-semantics.js`、`src/bridge.js:1819` | 机制在（库内 0 条，QQ 侧未同步） |
| 真人式分条发送 | 分条节奏 1~3s、长间隔概率 20%、单条≤500 字、每分钟≤8/每小时≤60 | `src/bridge.js:8404`、`socialV2.send.*` | 在用 |
| 主人特权审计 / token 账本 | 主人特权操作写 `state/owner-audit.jsonl`（agent 读不到）；逐轮 usage 计价入账 | `src/owner-audit.js`、`src/token-ledger.js`、`src/bridge.js:3041` | 在用 |
| 目的机制（主动找主人） | 素材→驱力→目标假设→选择→回执；载体可 qq 或 pet；受安静时段/每日上限约束 | `src/purpose-engine.js`、`src/bridge.js:10688`、`<PL>/lib/pet-purpose.js` | **未启用**（`purpose.enabled=false`） |

> 迁移口径建议：白名单、token 闸、鱼群、收尾、记忆卡/人格注入、身份闸属于「**不做就会被群友/主人立刻发现**」的硬行为；早安/目的/B站分享/黑话/表情属于可分批补齐的软行为。

---

## 4. 功能清单（设置页栏目）

设置页真实 tab 列表在 `<PL>/lib/client.js:5104-5120`，共 **14 个**（任务口径的 13 个 + 「语音」）：

| # | 栏目 | 实际行为 | 实现（file:line） | 主要数据/API | 当前状态 |
| --- | --- | --- | --- | --- | --- |
| 1 | 概览 | 桥接/SnowLuma/DSH 状态、模式、角色、记忆卡比例、平台开关、更新提示、路径与文件戳 | `<PL>/lib/index.js:691-766`；SnowLuma 诊断 `:706-712` | `GET /api/overview` | 在用 |
| 2 | 角色 | 角色库（导入/新建/切换/重命名/删除/12 槽自动快照）、人设卡编辑、注入上限 | `:939-1026`、`<PL>/lib/characters.js:1-12`、`:1027-1073` | `characters/index.json`、`characters/<id>/persona.md`、`snapshots/` | 在用（当前角色 `da-fei-yu`「原装-大肥鱼」epoch 5，`<STATE>/characters/current.json`） |
| 3 | 目的 | 从人格卡+记忆卡+近 7 天素材生成「目标假设」，按安静时段/每日上限主动私聊主人；载体可切 QQ 或桌宠 | `:2127-2377`、`src/purpose-engine.js`、`<PL>/lib/pet-purpose.js:1-10` | `purpose-outreach.json`；`/api/purpose/{status,preview,run}` | **未启用**（`purpose.enabled=false`） |
| 4 | QQ | 桥接启停/重启、模式（chat/closed-agent/reserved2）、ownerQQ、白名单/黑名单、安全审计、DSH 模型与 effort、鱼群、收尾、token 闸、发送节奏、初始提示词、表情包、语音、上线补历史 | `:767-940`（配置）、`:1206-1253`（模式）、`<PL>/lib/bridge.js` | `config.json` 的 `social/socialV2/fishGuard/allow/deny`；`/api/bridge`、`/api/mode` | 在用（reserved2） |
| 5 | 语音 | 语音包安装/启停/导入/测试、规则、TTS（本地 voxd 8765 / GPT-SoVITS 9880 / 云端 8767） | `:1896-2018`（转发桥接 `/api/voice/*`） | 无语音包目录 | **未安装/关闭** |
| 6 | 桌宠 | 安装/卸载/启动/停止/状态、桌宠对话（文本/语音）、内置形象 | `:2019-2126`、`<PL>/lib/pet.js:1-10`、`pet-chat.js`、`pet-api.js` | `<STATE>/pet/`（`host.json`、`host-token`）；`/dsh-dsbot/pet-api/*` | **未安装**（无 `pet/app`；host 文件在，供桌宠发现） |
| 7 | B站 | 扫码登录（fish/owner）、cookie 粘贴、账号重置、依赖体检、待审回复、自动化快照、立即分享、通知测试 | `:2467-2710`、`:2378-2394` | `bili.config.json`、`bili/credentials.json`、`bili/owner-credentials.json`；`/api/bili/*` | **未登录**（`bili/` 空；日志「生物钟未启动：B站 还没登录」） |
| 8 | Token 额度 | 每日三类（qq/bili/other）用量+花费、额度与 80% 提醒、逐轮明细 | `:2788-2823`、`<PL>/lib/token-budget.js:1-12`、`token-usage-pure.js` | `token-usage-daily.json`、`token-usage-state.json`、`token-budget.json`(缺省=QQ ¥8) | 在用（今日 30.1M tokens / ¥0.87，见 §8） |
| 9 | 观看历史 | 当前角色 `bili/watch-history.jsonl` + 每条之后的动作（评论/收藏/动态） | `:2415-2438` | `characters/<id>/bili/` | 空（B站未登录） |
| 10 | 记忆 | 双向脱敏同步（B站→QQ / QQ→B站）、隐私策略与审计、预览、一键同步/清空、身份候选扫描 | `:1074-1120`、`<PL>/lib/memory.js:1-10`、`privacy.js:1-8` | `memory/qq-for-bili.md`、`memory/bili-for-qq.md`；`/api/memory` | 同步关（`qqToBili=false`，biliBridge 关） |
| 11 | 记忆卡 | 她的长期记忆：inbox 摄取→衰减/遗忘/容量压缩→两份 prompt 注入块；全量卡只存档 | `:1121-1170`、`<PL>/lib/memory-card.js:1-10`、`src/memory-card.js` | `memory-card.json/.md`、`memory-card-prompt-qq.md`、`memory-card-full.jsonl` | **在用**（全量 303 条/248KB；衰减卡 13.8k 字/23%） |
| 12 | 对齐 | QQ⇄B站身份映射表（谁是谁）、候选扫描、审批、导出/导入、两侧 brief 注入 | `:1171-1205`、`<PL>/lib/align.js:1-10` | `alignments.json`（现 `links:[]`）、`state/alignment-brief.md` | 开关开但**无映射**（未实际使用） |
| 13 | 扩展 | 扩展启用/配置/重载；平台注册表（qq/bili 内置，tieba planned） | `:1254-1273`、`<PL>/lib/extensions.js:1-10`、`platforms.js:1-10` | `extensions/<id>/manifest.json` | 均**默认关闭**（`sts2`、`bili-live` 仅预留） |
| 14 | 全部参数 | 三份配置的原始 JSON 编辑（带版本戳防覆盖、保存前校验、保存后按需重启桥接） | `:767-940`（`baseStamp`/409 冲突）、`:2788` | `GET/POST /api/config` | 在用 |
| 15*(14 内) | 诊断 | 环境体检（目录/凭据/桥接/ffmpeg/语音端口/隐私策略）、日志、备份、组件更新回滚 | `:1445-1503`、`:2711-2744`、`:2750-2787`、`<PL>/lib/doctor.js:1-8` | `/api/diagnostics`、`/api/logs`、`/api/updates` | 在用 |

> 口径说明：任务给的 13 栏目 = 上表 1-4、6-14（不含「语音」）；实现里语音是独立 tab（client.js:5109），已在本表单列。

---

## 5. 对外接口清单（「API 对照」的底稿）

### 4.1 插件 HTTP 路由（DSH webServer 注册）

前缀常量：`API_PREFIX='/dsh-dsbot/api'`、`EXT_PREFIX='/dsh-dsbot/ext'`（`<PL>/lib/index.js:107-108`）。

**鉴权链（三层，逐请求执行）** `<PL>/lib/index.js:662-688`：
① Host 回环或 `httpGuard.trustedProxyHosts` 白名单（`lib/http-guard.js:79-86`）→ ② 写操作同源 `sameOrigin` + `content-type: application/json`（否则 415）→ ③ DSH `connection.requestRejection(req)`（设置页 API 靠 DSH 会话 Cookie）。实测：无 Cookie 访问 `/dsh-dsbot/api/overview`、`/dsh-dsbot/health` 均 **401**。

`/dsh-dsbot/api/*`（24 个精确入口 + 4 个子路由族，全部同源 fetch）：

| 路由 | 方法 | 用途 |
| --- | --- | --- |
| `/overview` | GET | 总览快照（§4#1） |
| `/config` | GET/POST | 三份配置读写（GET 返回 qq/bili/unified+stamps；POST 支持整份保存/分部保存、409 冲突） |
| `/characters` | GET/POST | 角色库 CRUD / 切换 / 导入导出 / 快照 |
| `/persona` | GET/POST | 当前人设卡读写 |
| `/memory` | GET/POST | 记忆状态/预览/审计/`sync`/`refresh-bili`/`scan-align`/`rebuild`/`purge` |
| `/memory-card`、`/memory-card/full` | GET/POST | 记忆卡状态/整理/全量卡查询 |
| `/align` | GET/POST | 对齐表 list/add/update/remove/approve/reject/scan/import/export |
| `/mode` | GET/POST | 模式与 ownerQQ（写 DSH settings `qq-mode`） |
| `/extensions` | GET/POST | 扩展 toggle/config/reload |
| `/platforms` | GET | 平台注册表 |
| `/diagnostics` | GET/POST | 体检 / 一键修复（install 任务） |
| `/bridge` | GET/POST | 桥接 status/start/stop/restart/call |
| `/token-budget` | GET/POST | 额度状态 / 保存 limits / add / reset |
| `/watch-history` | GET | 观看历史（含动作富化） |
| `/preferences/scan` | GET | 口味关键词扫描（B站/本地） |
| `/fish-guard/qq` | GET | QQ 鱼群触发记录（读 `social-v2.json.fishGuardLog`） |
| `/logs` | GET | 插件日志 + 桥接日志尾部 |
| `/owner-audit` | GET | 主人特权操作审计（`state/owner-audit.jsonl`） |
| `/browse` | GET | 本机目录/文件选择器（Electron 桥） |
| `/privacy/explain` | GET/POST | 隐私闸门解释（这段文本会不会被拦） |
| `/updates` | GET/POST | 组件更新检查/应用/回滚/忽略 |
| `/purpose/*` | GET/POST | `status`/`preview`/`run`/`carrier`/`config`（`:2127-2377`） |
| `/voice/*` | 代理 | 转发桥接 `/api/voice/*`（`:1896-1975`，带 `x-console-token`） |
| `/pet/*` | GET/POST | 桌宠安装/启停/状态（`:2019-2126`） |
| `/bili/*` | GET/POST | `fish-guard`/`session-permission`/`deps`/`pending`/`automation`/`notify-config`/`share-now`/`accounts`/`qr/{start,poll,cancel}`/`account/reset`；POST `action=cookie|notify-test|pending-approve|pending-reject` |
| `/dsh-dsbot/ext/<id>/<path>` | 任意 | 扩展自定义路由（`lib/extensions.js` 注册，`:2866-2877`） |
| `/dsh-dsbot/health` | GET | `{ok,name,version,privacyPolicyVersion}`（`:2894-2896`，同样过 DSH 鉴权） |
| **`/dsh-dsbot/pet-api/*`** | 见下 | 桌宠专用：回环 + `x-pet-token`（`?token=` 仅音频）双闸（`lib/pet-api.js:100-124`） |

`pet-api` 子路由（14）：`GET /health`、`GET /status`、`GET /config`、`GET /history`、`GET /purpose/status`、`POST /purpose/preview`、`POST /purpose/run`、`POST /chat`、`POST /focus`、`POST /chat/test`、`GET /events`（长轮询，非 SSE）、`GET /audio/<key>.wav`（`lib/pet-api.js:124-214`）。桌宠靠 `<STATE>/pet/host.json`（baseUrl+token）发现，2 分钟重写一次（`<PL>/lib/index.js:2898-2901`）。

### 4.2 MCP 三个 server（profile 注册见 `$DSH_HOME/profiles/web/cordis.patch.yml:1-30`）

| server id | 入口 | 工具数 | 工具 |
| --- | --- | --- | --- |
| `snowluma` | `src/mcp-snowluma-safe.js` | **39** | 查：`qq_status`、`qq_list_groups`、`qq_get_group_members`、`qq_get_group_history`、`qq_get_prompt`、`qq_get_unread_messages`、`qq_get_recent_messages`、`qq_social_state`、`qq_get_my_recent_messages`、`qq_get_message_detail`、`qq_get_active_members`、`qq_get_message_images`、`qq_get_forward_msg`、`qq_get_self_image`、`qq_list_stickers`、`qq_get_sticker_image`、`qq_list_voices`、`qq_memory_query`、`qq_slang_query`；发：`qq_send_message`、`qq_send_burst`、`qq_send_group_message`、`qq_send_private_message`、`qq_reply`、`qq_send_poke`、`qq_send_sticker`、`qq_send_voice`、`qq_mark_read`、`qq_close_conversation`、`qq_set_wake_config`、`qq_wait_for_messages`、`qq_report_feedback`；写：`qq_memory_append/remove/clear`、`qq_sticker_note`、`qq_set_sticker_remark`、`qq_collect_sticker`、`qq_slang_submit` |
| `snowluma-host` | `src/mcp-host-server.js:74-93` | 1 | `snowluma_status`（只读探活 `get_login_info`） |
| `web-search-safe` | `src/mcp-web-search-safe.js:52-141` | 2 | `web_search`、`web_fetch` |

注册行号（`mcp-snowluma-safe.js`）：`qq_status:366` … `qq_get_forward_msg:1346`；发送类强制白名单校验，逻辑与桥接 `allowed()` 对齐（`:60-70` 注释 `isAllowed`）。安全边界：只暴露聊天安全子集，不含管理类动作（禁言/踢人/群设置/文件传输，`:1-6`）。

### 4.3 桥接控制台 HTTP API（端口 3100，`src/bridge.js:3752-8345`）

- 鉴权：所有请求需 `x-console-token` 或 `?token=`（`src/bridge.js:3919-3931`）；二代会话工具另需 `x-agent-token` 且必须匹配该会话的 agentToken（`src/bridge.js:3773-3804`）；写操作强制 `application/json`（否则 415，`src/bridge.js:3981`）；仅绑 `127.0.0.1`（`:8337`）。
- 共 **138** 个 `/api/*` 路径（grep 去重计数）。分组：

| 组 | 端点（代表性/全量） |
| --- | --- |
| 状态/运维 | `GET /api/status`、`/api/pending`、`/api/sessions`、`/api/owner-audit`、`/api/presets`、`/api/restart`、`/api/session/reset`、`/api/workspace/reset`、`POST /api/console/token`、`/api/console/notify-ai` |
| 模式/角色 | `POST /api/mode`、`/api/role`、`/api/role-mode`、`GET /api/roles`、`/api/roles/content`、`POST /api/roles/{limit,create,update,rename,delete}`、`/api/preset/sim-prompt`(+`/backups`,`/restore`) |
| DSH | `GET /api/dsh/model`、`POST /api/dsh/effort` |
| 白名单/安全 | `GET/POST /api/whitelist`、`GET/POST /api/security` |
| 发送（一代/内部） | `POST /api/send/{group,private,reply,voice}`、`/api/images/message`、`/api/test-send`、`/api/greeting/test` |
| 二代仿真（46 个 `/api/socialV2/*`） | `state`、`states`、`config`、`reset`、`prompt`、`unread`、`recent`、`message-detail`、`active-members`、`my-recent`、`send-message`、`send-burst`、`send-poke`、`send-sticker`、`send-voice`、`check-send`、`record-sent`、`wait`、`wake`、`wake-config`、`mark-read`、`close`、`history-catchup`、`initial-prompt`、`activity`、`feedback`、`feedback-clear`、`tool-log`、`tool-log/clear`、`voices`、`memory`、`memory-append`、`memory-remove`、`memory-clear`、`memory-update`、`slang/query`、`slang/submit`、`sticker-list`、`sticker-image`、`sticker-note`、`sticker-remark`、`collect-sticker`、`self-image`、`images/message`、`forward-message`、`forward-media` |
| B站 | `GET /api/bili/status`、`/api/bili/prompt-preview`、`POST /api/bili/{memory/refresh,dynamics/poll,share-now}` |
| 黑话 | `GET/POST /api/slang`、`POST /api/slang/{clear,extract,research,config,batch-delete,batch-confirm,batch-reject}` |
| 表情 | `GET /api/stickers`、`POST /api/stickers/{sync,note,remark}` |
| Token 账本 | `GET /api/tokens/{summary,daily,recent,series,turns}`、`POST /api/tokens/reset` |
| 语音 | `GET /api/voice/list`、`/api/voice/rules`、`POST /api/voice/send`、`/api/voice/packs/*`（install/import/start/stop/test/enable/activate/remove/clean/cloud-config/cloud-stats/sample…） |
| 目的 | `GET /api/purpose/status`、`POST /api/purpose/{preview,run}` |
| 授权 | `GET /api/authorize/read`、`POST /api/memory-card/notify` |

- 无 SSE 端点（`grep -c 'event-stream' = 0`）；实时性来自 ①桥接↔DSH 的 `/api/remote.mux` WS；②设置页轮询；③桌宠 `/pet-api/events` 长轮询。
- 网页控制台：`GET /` 内嵌单页（`src/bridge.js:4069-4077`），401 时返回令牌输入页（实测）。

### 4.4 桥接 ↔ DSH RPC（迁移替换 DSH 交互时逐条对照）

- RPC 形态：`POST /api/<method>`，payload `{ args: { request|_request: {...} } }`（`src/dsh-client.js:160-186`、`269-290`）；启动鉴权：DSH launch token → Cookie（`src/dsh-client.js:1-10`、`discoverDshLaunchToken`）。
- 方法集：`session/{list,create,prompt,cancel,selectModel,rename,fork,updateQueue,page,search,follow,projections}`、`workspace/{create,rename,delete,archiveSession,insertBefore,insertSessionBefore}`、`agentPresets/list`、`settings/{describe,update}`（`:160-186`、`src/bridge.js:4236`）。
- 事件流：WS `/api/remote.mux`，自动 follow 所有会话（`src/dsh-client.js:513-527`、`646-700`；`FOLLOW_SNAPSHOT_MESSAGES=200`）。
- 投递：`session/prompt`（带 requestId）+ `session/updateQueue` 清队列（`inbox` 投影解析 `src/dsh-client.js:200-260`）。

### 4.5 `qq-mode` 设置命名空间

`<PL>/lib/qq-mode.js:1-39`：DSH 0.2.x 用「loader entry id=qq-mode + Config」推导 settings 命名空间；字段 `mode ∈ {chat, closed-agent, reserved, reserved2, simulation}`（默认 `reserved2`）+ `ownerQQ`，两者 `volatile`。桥接读写该命名空间：`src/bridge.js:3220-3245`（读）、`4236`（写）。合体插件 patch 注册：`<PL>/cordis.patch.yml:11-17`。

### 4.6 CLI 脚本

- **B站工具链主入口** `<PL>/tools/bili.mjs`（子命令表 `:9-56`，约 50 个）：读类 `session/thread/check-comment/check-dynamic/check-mention/watch/comment-digest/recon/video/subtitles/watch-video/debrief/feed/prefs/quota/fish-guard/watch-history/likes/selftest/deps/diary/night/score/daily/share-dynamic/gamefeed/attack/search/covers/whois`；写类（必须 `--dry`/`--go`）`comment/reply-draft/comment-del/dynamic/dynamic-image/dynamic-edit/danmaku/auto/await/fav/dm/dm-await`；排障 `dyn-keywords/dyn-page`。`tools/{commands,verify,diagnostics,lib,docs}` 为具体实现与文档（`verify/*` 7 个、`tools/lib/*` 20+ 个纯逻辑模块）。
- **仓库脚本** `<SC>/scripts/`（159 个，多为测试/探针）：真正被运维用的——`setup-dsh.mjs`（维护 profile 的 MCP 区块与 link）、`sync-dsh-port.mjs`（写回 DSH 端口）、`build-agent-preset-patches.mjs`（生成 presets）、`scan-dsh-tool-names.mjs`（工具名对账，配合守卫）、`check-onebot-status.mjs`、`bili-memory-sync.mjs`、`harden-state-acl.mjs`、`detect-profile.mjs`、`stop-qq-bot.ps1`（Windows 停止）。
- **插件内脚本** `<PL>/scripts/`（40 个）：几乎全是 `test-*.mjs`（`package.json` 的 `npm test` 逐条跑）+ 4 个 UI 截图/巡检脚本（`ui-shot.mjs`、`ui-tabs.mjs`、`ui-purpose.mjs`、`ui-settings-editable.mjs`）。

### 4.7 presets 与工具守卫

- 两个 agent preset 由 `<PL>/package.json:36-48` 的 `dsh.bundle.patch` 声明：`cordis.patch.yml` + `presets/qq-chat.patch.yml` + `presets/qq-chat-v2.patch.yml`。
- `presets/qq-chat.patch.yml`：preset id `qq-chat`，插件行 = persona（超长安全/场景提示词）+ tool-web(search/fetch 关) + tool-ask-user + tool-todo + **qq-tool-restrict** + compaction 组。`qq-chat-v2.patch.yml` 同构，人格段换成「二代仿真模式」全套协议（文本不自动转发、必须用 `qq_send_message`、沉睡前观察、收尾、表情/语音/引用/合并转发等 17 条）。
- 源文件在 `<SC>/dsh/agent-presets/{qq-chat,qq-chat-v2}/{preset.yml,agent.cordis.yml,qq-tool-restrict.mjs(re-export 壳)}`。
- **工具守卫** `<PL>/qq-tool-restrict.mjs`：①`tools.restrict` 在注册期隐藏本地执行/文件/进程/子代理/工作流/job/goal 等工具；②`tools.guard` 白名单兜底，运行时拒绝非允许工具（`:1-25`、`159`、`176`）。权威实现只在插件包内，preset 侧只是 re-export。

### 4.8 扩展 / 平台接口

- 扩展：`<PL>/extensions/<id>/{manifest.json,index.js}`，**默认 `enabled:false`**，需设置页显式开启才 `import()`；宿主 API = config/dataDir/paths/platforms/registerPlatform/记忆/桥接控制/B站工具链/事件总线/自定义 HTTP 路由（`extensions/README.md:1-40`、`lib/extensions.js:1-10`）。现有：`sts2`（杀戮尖塔启动器，预留）、`bili-live`（B站自主直播，预留），均未启用。
- 平台：`PlatformAdapter` 接口 `{id,name,version,status,capabilities,status(),readMemory(),writeMemory(),promptBlock()}`（`<PL>/lib/platforms.js`、`platforms/README.md`）。内置 `qq`、`bili`（active），`tieba` = `planned`（`platforms/tieba/manifest.json`）；微博已明确移除。

---

## 6. 数据资产清单（迁移必读）

体量实测（2026-11-03 13:00）：`$DSH_HOME/dsbot` 合计 **26 MB**（其中 `backups/` 24 MB、284 个条目）；`<SC>/state` 1.1 MB；`<SC>/roles` 99 个人格卡 1.0 MB；`<SC>/roles-full` 27 个 744 KB；`$DSH_HOME/sessions` 14 MB。

| 资产 | 路径 | 格式 | 用途 | 体量 | 迁移判断 |
| --- | --- | --- | --- | --- | --- |
| 当前角色人设 | `<STATE>/characters/da-fei-yu/persona.md`（+`character.json`） | Markdown/JSON | 每条消息注入的人格卡；当前角色 `原装-大肥鱼` epoch 5 | 4 KB | **必须搬**（人格=她的身份） |
| 角色库索引/其他角色 | `<STATE>/characters/{index.json,current.json,char-*/,tie-ba-lao-ge/}` | JSON+MD | 角色切换与导入来源 | 2.6 MB | 建议搬（索引+至少当前角色） |
| 记忆卡（衰减） | `<STATE>/characters/da-fei-yu/memory/memory-card.json/.md` | JSON | 唯一真相 + 人读版 | 357 KB / 28 KB | **必须搬** |
| 记忆注入块 | 同目录 `memory-card-prompt-qq.md`（+`-bili`） | Markdown | 桥接按 mtime 缓存注入 QQ 提示词（`src/bridge.js:11717-11760`） | 2.5 KB | 建议搬（可由卡重建） |
| 全量记忆卡 | `memory-card-full.jsonl` + `-stats.json` + `.md` | append-only JSONL | 只存档、永不遗忘；303 条/248 KB | 248 KB | 建议搬（情感价值高，体积可控） |
| 记忆 inbox | `memory/memory-inbox.jsonl` | JSONL | 桥接追加、插件摄取 | 当前空/待摄取 | 可搬（增量） |
| 记忆卡快照 | `characters/da-fei-yu/snapshots/auto-2026-10-31/` | 目录包 | 12 槽自动存档（`lib/characters.js:1-12`） | 1.5 MB | 建议搬（迁移前回滚点） |
| 目的状态 | `characters/da-fei-yu/purpose-outreach.json` | JSON | 驱力/目标假设/历史回执 | 4 KB | 可搬（当前功能关闭） |
| B站凭据 | `<STATE>/bili/credentials.json`、`owner-credentials.json` | JSON（含 cookie，`***`） | B站登录 | **不存在**（未登录） | 不适用；若后续要用 B站须重新扫码 |
| B站配置 | `<STATE>/bili.config.json` | JSON | B站偏好/额度/夜间/分享 | 3 KB | 建议搬（迁移后如保留 B站能力直接复用） |
| 观看历史 | `<STATE>/characters/<id>/bili/watch-history.jsonl` | JSONL | 看过什么/口味素材 | 当前空 | 可搬（有则搬） |
| Token 用量/账本 | `<STATE>/token-usage-daily.json`、`token-usage-state.json`、`<BST>/token-usage.jsonl`(177 KB)、`tool-calls.jsonl`(235 KB) | JSON/JSONL | 额度闸门、花费报表、工具调用审计 | ~420 KB | 可搬（统计/审计；额度闸需重建） |
| QQ 会话映射 | `<BST>/sessions.json` | JSON | `group:694991842 → session-ed43eb13…`、`private:1362431704 → session-ac1853a3…`；含 `sessionPolicies` | 322 B | **不搬**（绑定 DSH 会话 ID，迁移后重映射） |
| 二代仿真运行态 | `<BST>/social-v2.json` | JSON | 每会话 wakeConfig/unread/readThroughSeq/agentToken/closure/fishGuardLog/activeTopics/pendingThoughts/memberImpressions | 77 KB | 部分搬：**记忆类字段建议搬**（activeTopics/pendingThoughts/memberImpressions/closure 的 summary/nextOpening），运行态（unread/seq/wakeConfig/agentToken）不搬 |
| 黑话库 | `<BST>/slang.json`（247 条） | JSON | 群梗/黑话（候选+已确认），注入提示 | 129 KB | 建议搬（群里语感资产） |
| 表情库 | `<BST>/stickers.json` | JSON | 收藏表情语义索引 | 空（0 条） | 不搬 |
| 人格卡素材库 | `<SC>/roles/`（99 个 .md）、`<SC>/roles-full/`（27 个） | Markdown | 换角色/新用户默认卡 | 1.7 MB | 建议搬（非线上必需） |
| 桥接配置 | `<SC>/config.json` | JSON | 白名单/模式/二代参数/闸门 | 10 KB | **必须搬**（语义逐项对照到 Aurabot 配置） |
| 桥接状态杂项 | `<BST>/{mode.json,current-role.json,self-identity.json,greetings.json,alignment-brief.md}` | JSON/MD | 当前模式/角色/自我锚点/问候记录/对齐提示 | <5 KB | 部分搬（self-identity 与对齐 brief 建议搬） |
| QQ 公开 feed / 记忆桥接文件 | `<BST>/qq-public-feed.jsonl`、`<STATE>/memory/{qq-for-bili,bili-for-qq,alignment-for-bili}.md` | JSONL/MD | 跨平台记忆管道 | 近空 | 可搬（空则忽略） |
| 备份 | `<STATE>/backups/`（284 条，含 `characters-before-import-*`、`bili-config-*`、`qq-config-*`） | 混合 | 每次保存/切换前的自动备份 | 24 MB | 建议搬最近几份（回滚用），全量可不搬 |
| DSH 会话记录 | `$DSH_HOME/sessions/`（50 文件）、`$DSH_HOME/storages/session_projcache/` | DSH 私有格式 | QQ/B站/黑话会话历史 | 14 MB | **不搬**（换 Agent 后不可读；情感价值可另存导出） |
| 桌宠数据 | `<STATE>/pet/{host.json,host-token,chat/,voice/}` | JSON | 桌宠发现与对话 | 20 KB | 不搬（未安装桌宠本体） |
| 语音数据 | 无（`socialV2.voice.enabled=false`，无 voice-packs 目录） | — | — | 0 | 不搬 |
| 插件日志 | `<STATE>/plugin.log`、`<BST>/bridge.log*`、`/home/ubuntu/dsh-agentchat/logs-dsbot-bridge.log`(274 KB, root) | 文本 | 排障证据 | <1 MB | 不搬（迁移后保留只读留档） |

> 目录分工易混淆点：**插件数据在 `$DSH_HOME/dsbot/`（记忆卡/角色/配置），桥接数据在 `<SC>/state/`（会话/黑话/运行态）**——`src/bridge.js:113` 的 `STATE_DIR` 与 `lib/paths.js:16` 的 `STATE_DIR` 是两个不同的目录。

---

## 7. 外部依赖与耦合

1. **DSH 版本/API 契约**：0.2.1-rc.5；依赖 `/api/<rpc>` + `/api/remote.mux` WS、`settings` 命名空间推导、`session/updateQueue`、inbox 投影形状（`src/dsh-client.js:1-10`、`200-260`）。DSH 升级会直接打断桥接（`FOLLOW_SNAPSHOT_MESSAGES`、`session/*` args 形状是硬编码）。
2. **端口漂移发现**：插件用 `webServer.port`（可靠）；桥接 Linux 上无自动发现（`src/dsh-port.js:51-62` 仅 win32），依赖 `DSH_WEB_URL`（插件 spawn 时注入）或 `config.json` 的 `baseUrl=3102`。迁移后端口若变，必须同步。
3. **SnowLuma 登录态**：QQ 号 2477094441；OneBot HTTP/WS 各一份 token（`snowluma/data/config/onebot_2477094441.json`，`***`）；桥接会按账号目录试 token 并回写配置（`src/snowluma-conn.js:1-14`）。当前**未登录**（§8）。
4. **模型 provider**：profile `llm-deepseek`（`apiKeyEnv: DEEPSEEK_API_KEY`，baseURL `https://api.deepseek.com/anthropic`），`agent-default-model` = `deepseek-official/deepseek-flash/high`（`$DSH_HOME/profiles/web/cordis.patch.yml:31-48`）；桥接自己的 `cfg.dsh.provider/model/effort` 会覆盖会话模型（`src/bridge.js:770-783`、`/api/dsh/model`）。
5. **web-search MCP**：DeepSeek 联网搜索 + Bing 回退，独立 stdio server（`src/web-search.js`），配置来自 `<SC>/config.json` 的 `webSearch`；与 DSH 内置 `tool-web`（preset 里 search/fetch 全关）互不重复。
6. **Node / ffmpeg / Python**：桥接与 MCP 都要求真实 `node`（`lib/paths.js:96-107`，拒绝 Electron exe）；ffmpeg 只影响「B站抽帧看画面」与语音（诊断里标注可选）；`tools/` 里大量脚本用 `ffmpeg`、`yt-dlp` 类外部工具。
7. **语音服务**：可选 `voxd:8765`、`GPT-SoVITS:9880`、云端 `8767`（`<PL>/lib/voice-health.js:1-8`、`lib/index.js:1474-1497`）；当前全关。
8. **GitHub 更新源**：`updates` 每 6h 查 DSBot/pet/语音包 release（`<PL>/lib/updates.js:1-10`）；迁移后应关闭（避免旧组件被拉回）。
9. **贴吧预留**：`platforms/tieba` 仅 manifest（planned），无实现代码。
10. **反代/鉴权**：Caddy（10325/10326）→ DSH；`httpGuard.trustedProxyHosts` 必须与线上域名一致，否则设置页 API 全 403。

---

## 8. 当前运行状态与故障（迁移前置条件）

**结论：QQ 链路当前是断的 —— 不是 DSBot 代码问题，是 SnowLuma 侧 QQ 登录态不正常。**

证据（均为只读探测）：

1. 容器在跑、端口在听：`docker ps` → `snowluma` Up；`ss -ltnp` → `127.0.0.1:3000/3001/5099/6081` 均 LISTEN。
2. 但 OneBot HTTP **连上即被 reset**：`curl -sv -X POST http://127.0.0.1:3000/get_login_info -H 'Authorization: Bearer ***'` → `Recv failure: Connection reset by peer`（HTTP=000）；无 token 同样 000。WS 端口 `3001` TCP 可连，但握手即断。
3. 桥接日志持续刷（本地时间 12:44~13:03，每 30s 一轮）：
   `<BST>/bridge.log` / `logs-dsbot-bridge.log` → `SnowLuma 连接断开（code=1006），重连中…`、`SnowLuma WebSocket closed before opening`、`⚠️ token 自愈失败（error {}）：连不上 OneBot HTTP API（http://127.0.0.1:3000）：未知错误`。
4. 今天 12:10 启动的桥接**没有**「SnowLuma 已连接 / 机器人昵称」这两行；对照该日志开头（10-30 12:44:44 那次成功启动）有 `SnowLuma 已连接：ws://127.0.0.1:3001`、`机器人昵称: 大肥鱼`（`grep -n "SnowLuma 已连接\|机器人昵称" logs-dsbot-bridge.log` 可复核；该文件仍在增长，行号会漂移）。
5. SnowLuma 容器日志 12:10 之后只有：`[Hook] awaiting login: PID=80`、`pipe connected`，之后再无登录/在线事件（`docker logs snowluma`）；WebUI 5099 的 `/api/*` 全部 401（需登录）。
6. B站侧另有独立故障：`<STATE>/plugin.log` 2026-11-03T04:10:07Z → `生物钟未启动：B站 还没登录（设置 → B站 → 扫码登录），避免空转消耗 token`；`<STATE>/bili/` 为空。
7. DSH 侧正常：12:10:03 桥接先报 `DSH 端口探测：http://127.0.0.1:3102 连不上`，12:10:09 变为 `DSH 已就绪（模式: reserved2）`——说明「桥接→DSH」这条腿是通的，断点在 SnowLuma/QQ 登录。
8. 今日 token 用量（`<STATE>/token-usage-daily.json`）：qq ¥0.8667 / 30.15M tokens，other ¥0.0449 / 1.30M tokens，合计 ¥0.91——历史用量规模参考：单日 30M+ tokens，迁移后额度/预算策略必须覆盖这个量级。
9. 另外：`~/.dsh`（pid 972 的 DSH，端口 3080）与 DSBot 无关（该 home 下无 dsbot 插件/状态），迁移时不要误动/误停。

**迁移前置条件（按顺序）**：
① SnowLuma 恢复 QQ 登录（WebUI 5099 或 VNC 6081 扫码）→ 验证 `get_login_info` 返回 `retcode:0`、WS 可连；② 确认白名单 `allow.private=["1362431704"]`、`allow.groups=["694991842"]` 与 Aurabot 侧一致；③ 明确迁移窗口内谁来停桥接（否则两套机器人抢同一条 QQ 消息，会双回复）；④ 决定 DSH 侧是复用 3102 这只还是新 DSH（影响 `DSH_WEB_URL`、控制台端口、preset 注册）。

---

## 9. 未确认项（附确认方法）

| # | 未确认 | 确认方法 |
| --- | --- | --- |
| 1 | `qq-mode` 的 mode 值最终持久化在哪个文件（DSH settings 存储位置未找到） | 设置页 → DSBot → 全部参数/概览 看 DSH mode；或用带会话 Cookie 的请求调 `settings/describe`（`src/bridge.js:3220`），或 `grep -r reserved2 $DSH_HOME` 全量搜 |
| 2 | SnowLuma 当前 QQ 是否真在登录页（无凭证，未登录 WebUI） | WebUI `http://127.0.0.1:5099` 用容器启动日志里的一次性密码登录后看状态页；或 `docker exec snowluma` 看 QQ 进程窗口（VNC 6081） |
| 3 | pid 972（端口 3080）这只 DSH 的用途/是否该停 | `ls ~/.dsh/profiles`、`~/.dsh/settings.yaml`；询问用户是否有第二个部署；其 Caddy 信任域 10325 与 DSBot 的 10326 不同 |
| 4 | `roles-full/` 与 `roles/` 的差异定位（99 vs 27） | diff 文件名/内容；`<SC>/README.md` 与 `CHANGELOG.md` 检索 roles-full |
| 5 | 桥接 `logs-dsbot-bridge.log`（root 属主）由谁重定向产生 | 看启动 DSH 的父进程/服务单元（`systemctl status`/`ps -o ppid`），或 `ls -l /proc/2091/fd/1` |
| 6 | 一代 `chat` 模式是否曾在本机跑通（当前只有 reserved2） | `<BST>/bridge.log.1` 搜索 `模式: chat`；`state/roles-rename-map*.json` 推断历史；或临时切模式（**不建议在线上做**） |
| 7 | 记忆卡 `memory-card.json`（303 条记录）的去留口径（哪些属于「必须保留」） | 人工抽样 `memory-card.md`（人读版 28 KB），与用户确认可丢弃范围 |
| 8 | B站能力迁移后是否还要（涉及重新扫码、cookie 迁移政策） | 产品决策；技术上 B站侧全部依赖 `bili.config.json` + cookie + `tools/bili.mjs` |

---

## 10. 给「API 对照」的要点（按迁移影响排序）

1. **MCP 面 42 个工具**是最硬的对照面：Aurabot 必须提供同名/同语义工具（尤其 `qq_send_message`/`qq_reply`/`qq_wait_for_messages`/`qq_mark_read`/`qq_close_conversation`/`qq_set_wake_config`/`qq_get_prompt`/`qq_social_state`/`qq_memory_*`/`qq_*sticker*`/`qq_slang_*`/`qq_get_images`/`qq_get_forward_msg`）——preset 提示词（`presets/qq-chat-v2.patch.yml:19-39`）逐条点名这些工具名。
2. **桥接的 138 个控制台 API** 里真正被 preset/工具链依赖的是 `/api/socialV2/*`（46 个）与 `/api/status`；其余是设置页/运维面，可降级。
3. **`qq-mode` settings 命名空间 + 两种 preset** 是 DSH 特有的耦合；Aurabot 若无等价机制，需在迁移方案里显式说明替代（配置项/内置模式）。
4. **桥接状态与插件状态分居两处**（`<SC>/state` vs `$DSH_HOME/dsbot`），迁移脚本必须两处都处理，且 `sessions.json` 里的 DSH sessionId 必须丢弃重映射。
5. **当前故障不是代码问题**：QQ 登录态未恢复，任何迁移验证都跑不通；建议方案里把「先恢复 SnowLuma 登录」列为第 0 步。
