# DSBot → Aurabot 能力 / 配置 / 数据 / 接口对照矩阵与缺口分析

> **口径**：目标 **D** —— 只把线上 QQ 机器人从 DSBot 切到 Aurabot（`dsh-aurabot-qq@1.1.24`）。不写代码、不安装、不改配置；本文供正式迁移文档直接引用。
>
> **证据缩写**：`SC:<行>` = `dsbot-inventory.md`；`AU:<行>` = `aurabot-inventory.md`；`LV:<行>` = `lead-verified-facts.md`；`src/…:行` = Aurabot 仓库 `/tmp/aurabot-qq-probe`（HEAD `b3301f6`，AU:6）源码；`<PL>` = DSBot 线上插件目录。
> 未确认项统一标「未确认」+ 确认方法（附录 A）。行号是写作时快照，漂移时以 `§` 锚点为准。敏感值掩码 `***`，QQ/群号保留。
>
> **判定词表**：`1:1` / `等价异名` / `部分` / `缺失`；**动作**：`自动可用` / `需重配` / `需人工重做` / `会丢失`；**影响**：`阻断` / `体验下降` / `无关`。

## 0. 结论速览（供决策先读）

| # | 结论 | 证据 |
|---|---|---|
| 1 | **技术可切**：Aurabot 1.1.24 已实测能在本机 DSH 0.2.1-rc.5 安装并启动；QQ 核心链路（gateway=onebot → 容器 SnowLuma）完全可用 | LV:32-47、LV:53-54 |
| 2 | **范式不同，不是 1:1 换皮**：DSBot「模型自主唤醒/潜水/收尾 + 工具发言」→ Aurabot「消息推送 + 策略决定回不回 + 正文即发言」。42 个 MCP 工具里 **约 30 个无对应**，其中 12 个属范式性缺失（已读水位/潜水/收尾/等待 4 个 + 未读查询 3 个 + 分条/引用/拍一拍 5 个） | 本文 §1.2、§4.1 |
| 3 | **人格和记忆能搬**，但必须转换：人格 md 可直搬（无工具引用，`persona.md` 与 `roles/原装-大肥鱼.md` 字节相同）；303 条记忆要按字段映射写入 `memories.json`，**不要走面板导入**（单次 ≤3 万字、≤80 候选，会丢量） | LV:73-76；AU:336；`src/features/memory.js:208-229` |
| 4 | **群聊体验会明显降级**：无联网搜索（social preset 不挂 tool-web）、无黑话库、无鱼群保护、无 token 闸、无上线补历史 | `cordis.patch.yml:119-143`；`src` 全仓无 `slang`/`tokenGuard`/`cost` |
| 5 | **有硬冲突**：同一 QQ 号只能一个 OneBot 消费方；`dsbot-bridge.service` 是 `Restart=always`，不停用会反复抢消息；重启 DSH 会中断当前 agent 会话；3 GB 内存不支持两套并行 | LV:14-16、LV:28；`/etc/systemd/system/dsbot-bridge.service` |

---

## 1. 能力对照矩阵

> 共 **41 行**：设置栏目 15（14 tab + 诊断子页）、桥接「像人」行为 19、对外接口面 7。为可读性拆成三张同构表（5 列一致）。

### 1.1 设置页栏目（SC§4 L154-172）

| DSBot 能力（SC 引用） | Aurabot 对应（AU 引用 / 键） | 判定 | 迁移动作 | 影响 |
|---|---|---|---|---|
| 概览：桥接/SnowLuma/DSH 状态、模式、记忆卡比例、更新提示（L158） | 面板「概览」+ `/aurabot/api/state`（AU:288,358） | 等价异名 | 自动可用（字段不同，看连接/统计即可） | 无关 |
| 角色：角色库 CRUD、12 槽快照、切换 epoch（L159） | 面板「人格」+ `personas/*.md`、`persona.current`（AU:289,335） | 部分（无快照/回档/epoch） | 需人工重做（搬人格 + 手工留档） | 体验下降 |
| 目的：驱力→目标假设→主动私聊（L160，当前关） | `purpose` 模块（默认关，AU:268）+ `speakUp.*` 主动搭话（AU:217） | 部分 | 需重配（`ext.purpose.*` 与 speakUp 二选一） | 无关（当前关） |
| QQ：桥接启停、模式（chat/closed-agent/reserved2）、白名单、模型、鱼群、收尾、token 闸、发送节奏（L161） | 面板「连接/聊天/权限」+ `gateway/snowluma.*/allow.*/group.*/merge.*`（AU:288-292） | 部分（无桥接进程可启停、无模式切换） | 需重配（逐键见 §2.2） | 体验下降 |
| 语音：语音包安装/启停/规则、TTS 三路路由（L162，未装） | 面板「语音」+ `voice.*`（edge-tts / cosyvoice / gptsovits / http，AU:174-182） | 等价异名（Aurabot 更强：含 ASR、音色试听） | 需重配（需 venv；无 ffmpeg 见 LV:67） | 无关（当前关） |
| 桌宠：安装/启停/对话、内置形象（L163，未装） | `pet` 模块 + `/panel/pet/*` 26 条路由（AU:269,387） | 部分（Linux 桌面行为不可用，AU:82） | 需人工重做（无桌面环境，LV:92） | 无关 |
| B站：扫码登录、cookie、依赖体检、待审回复、自动化快照、立即分享（L164，未登录） | 面板「B站」+ `bili.*`（AU:193-198） | 部分（无扫码 UI/待审队列/立即分享） | 需重配（重新登录，LV:78） | 无关（当前未登录） |
| Token 额度：日用量/花费、80% 提醒、逐轮明细（L165，今 qq ¥0.87/30.1M tokens，L352） | **无**（全仓无 cost/budget/tokenGuard） | 缺失 | 会丢失（替代：DeepSeek 账单 + `group.maxPerHour`/`merge.*` 限流） | 体验下降 |
| 观看历史：`watch-history.jsonl` + 每条的后续动作（L166，空） | 无独立页；`bili.json` 有 `seen/history`（AU:110） | 部分 | 会丢失（数据为空，无实损） | 无关 |
| 记忆：双向脱敏同步、隐私策略与审计、预览、身份候选扫描（L167，同步关） | `memory` 模块 + `memories.json` + `/profiles`·`/insights`·`/style`（AU:220,348） | 部分（召回更强；无跨平台同步管道/隐私闸解释器） | 需人工重做（导入 + 隐私策略改由人格卡约束） | 体验下降 |
| 记忆卡：衰减/遗忘/容量压缩 + 两份注入块（L168，303 条） | `consolidate()` + 遗忘曲线 + `invalidAt` 过时不删（AU:220；`src/features/memory.js:633-690`） | 部分（机制等价，触发源是聊天流水） | 需人工重做（§3.2 字段映射） | 体验下降 |
| 对齐：QQ⇄B站身份映射、审批、brief 注入（L169，`links:[]`） | **无** | 缺失 | 会丢失（当前空，无实损） | 无关 |
| 扩展：扩展启停/配置/重载 + 平台注册表（L170，`sts2`/`bili-live` 均未启用） | `modules/` 用户模块 18 内置（AU:249-278）、`modules{}`/`safeMode`/`ext{}` | 等价异名（API 完全不同，AU:278） | 需人工重做（若有自写扩展；现状无可用扩展） | 无关 |
| 全部参数：三份配置原始 JSON 编辑 + 版本戳防覆盖（L171） | 无三份配置编辑；单份 `config.json` + 面板表单（AU:129-134） | 部分 | 需重配（危险操作改手工编辑文件） | 无关 |
| 诊断：环境体检/日志/备份/组件更新回滚（L172） | 仅 `/logs`、`/update/check`、`/changelog`（AU:358）；**无体检/备份/回滚** | 缺失 | 会丢失（替代：手工体检清单 + tar 归档） | 体验下降 |

### 1.2 桥接「像人」行为（SC§3 L126-146，共 19 条）

| DSBot 能力（SC 行 / 实现） | Aurabot 对应（AU 引用 / 源码） | 判定 | 迁移动作 | 影响 |
|---|---|---|---|---|
| ① 白名单/黑名单：`allow.*`+`deny.*`，空=全拒（L128） | `allow.private/groups` + `ownerQQ`（AU:149；`src/chat/access.js:11-24`）；**无 deny 名单** | 部分 | 需重配（必填，见 §2.4） | 阻断 |
| ② 二代仿真 reserved2：文本不发出、必须调工具、会话令牌鉴权（L129） | **无对应模式**：正文即消息、群策略决定回不回、工具由模块按权限档挂（AU:415-420；`src/chat/reply.js:4-10`） | 缺失（范式不同） | 会丢失 + 替代：改由 `group.*` 策略 + `[沉默]` 决定不回 | 阻断（行为变化需用户书面接受） |
| ③ 对话收尾判断（L130，`conversation-closure.js`） | 无收尾工具；用 `[沉默]`/不回复；会话上下文长期保留（`src/chat/reply.js:11`） | 缺失 | 会丢失 + 替代（自然不回，无 summary/nextOpening 承接） | 体验下降 |
| ④ Token 防爆破：日唤醒上限/最小间隔/日花费 ¥8（L131） | **无**（`grep -rn costCNY/tokenGuard src` 空） | 缺失 | 会丢失 + 替代：`group.maxPerHour=6`、`burstMax=8`、`merge.waitSec` | 体验下降（成本风险） |
| ⑤ 早安问候：每日定时私聊/群问候（L132，`greetings.enabled=false`） | `speakUp`（只在主人私聊，AU:217） | 部分 | 需重配 | 无关（当前关） |
| ⑥ 上线补历史：`get_group_msg_history` 补水位（L133，在用） | 无水位/无补洞；`chatlog` 只本地留 14 天（AU:99）；`qq_chat_history` 需模型主动调 | 缺失 | 会丢失 | 体验下降 |
| ⑦ 鱼群保护 QQ：同名鱼≥5/连续 5 条/占比 60% 不参与（L134，在用） | `titleFilter` 只滤「别的机器人头衔」（AU:173）+ `burstMax` 刹车 | 缺失 | 会丢失 + 替代（标题过滤 + 群策略冷却） | 体验下降 |
| ⑧ B站定时分享/记忆同步/动态轮询（L135，`biliBridge.enabled=false`） | 无（bili 模块只有刷/评/赞/截图，无分享到群） | 缺失 | 会丢失 | 无关（当前关） |
| ⑨ 身份对齐注入：群聊前置 brief（L136） | 无 | 缺失 | 会丢失 | 无关（`links:[]`） |
| ⑩ 记忆卡注入：读 `memory-card-prompt-qq.md` 拼提示词（L137，在用） | 每轮 `systemPrompt.context()` 按当前消息召回（AU:419；`src/chat/hub.js:404`） | 等价异名 | 需人工重做（数据转换，§3.2） | 体验下降 |
| ⑪ 人格卡注入：每条消息前注入 `persona.md`，上限 6000 字（L138，在用） | `{{aurabot_persona}}` + `complete:true` 独占系统提示词（AU:30；`src/host.js:70-85`） | 等价异名（无字数上限） | 需重配（放 md + 设 `persona.current`） | 阻断（人格=身份） |
| ⑫ 仿真层提示词可控制台读写 + 安全基线校验（L139） | `persona` + `rulesText()` 由代码生成，面板不可编辑（`src/persona/personas.js:86-120`） | 部分（不可热改协议文本） | 需人工重做（要改只能改人格/写模块） | 体验下降 |
| ⑬ 自我身份锚点：跨平台「我是谁」卡（L140） | 无 self-identity；只有 `/avatar/sync-qq` 头像同步（AU:368） | 缺失 | 会丢失 | 无关 |
| ⑭ 身份泄露闸：公开面精确 ID 拦截（L141） | `redact.js` 只抹 token/cookie/key（`src/core/redact.js:1-20`），不拦 QQ 号 | 缺失 | 会丢失 | 无关（B站未用） |
| ⑮ 黑话学习：抽取→解释→管理员确认→注入≤8 条（L142，库内 247 条） | **无**（`src` 全仓无 `slang`/`黑话`） | 缺失 | 会丢失 + 替代（§3.3） | 体验下降 |
| ⑯ 表情包语义：情绪/内容索引 + 按最近消息算匹配分（L143） | `stickers` 模块：tags/summary/视觉备注 + `autoChance` 概率（AU:183-187） | 部分（无「匹配分」语义检索） | 需重配（从 QQ 收藏重新导入） | 体验下降 |
| ⑰ 真人式分条：1~3s 间隔、≤500 字、每分钟 8/每小时 60（L144，在用） | `splitLines`+`bubbleDelay`（打字速度模拟）+`\|\|\|`；**文字气泡上限 5 条，群里 >3 截到 3**（`src/chat/reply.js:96-105,147-152`；`src/chat/hub.js:676,710`） | 部分 | 自动可用（节奏由代码控制，不可配） | 体验下降 |
| ⑱ 主人特权审计 / token 账本（L145） | 无 owner-audit；只有 `logs/`（AU:123） | 缺失 | 会丢失 | 体验下降 |
| ⑲ 目的机制：素材→驱力→目标→回执（L146，当前关） | `purpose` 模块（默认关，AU:268） | 部分 | 需重配 | 无关（当前关） |

### 1.3 对外接口面

| DSBot 能力（SC 引用） | Aurabot 对应（AU 引用） | 判定 | 迁移动作 | 影响 |
|---|---|---|---|---|
| 插件 HTTP 24 入口 + 4 子路由族 + `/health`（L187-220） | `/aurabot/api/*` 74 条（AU:352-368） | 部分（路径/形状全不同） | 需人工重做（外部调用脚本） | 体验下降 |
| MCP 42 工具（39 snowluma + host 1 + web-search 2，L222-230） | 模块工具 49 个（AU:389-393），语义不同 | 部分 | 会丢失 + 替代（§4.1） | 阻断（preset 提示词作废） |
| 桥接控制台 138 个 `/api/*`、其中 `/api/socialV2/*` 46 个（L232-254） | **无对外 HTTP**；等价行为在 `src/chat/hub.js` + `src/onebot/client.js` 内部 | 缺失 | 自动消失（无脚本依赖则无影响） | 无关 |
| CLI `tools/bili.mjs` 50 子命令 + `scripts/` 159 个（L267-271） | 无 CLI | 缺失 | 会丢失（面板代替；无批量操作） | 无关（B站未用） |
| preset `qq-chat` / `qq-chat-v2`（L273-278） | `aurabot-private` / `-private-long` / `-social`（AU:395-397） | 等价异名 | 需人工重做（新 preset 自带，旧提示词全废） | 阻断 |
| `qq-mode` 设置命名空间（mode 5 值 + ownerQQ，L263-265） | 无 | 缺失 | 会丢失（由 `ownerLevel`+`allow.*`+`group.*` 承担） | 无关 |
| 扩展平台 + `PlatformAdapter` 接口（L280-283） | 用户模块 API v1 + 11 个 hooks（AU:278,399-402） | 缺失（API 不兼容） | 会丢失（现有扩展均未启用） | 无关 |

---

## 2. 配置字段级对照

### 2.1 `$DSH_HOME/dsbot/config.json`（合体配置，SC§2.1-2.2）

| DSBot 键（现值） | Aurabot 键 / 面板页 | 判定 | 动作 / 建议值 |
|---|---|---|---|
| `qqbotRoot`、`bridge.autoStart/consoleBase`（`<SC>`/3100） | 无（Aurabot 无外置桥进程） | 无 | 忽略 |
| `persona.file`（空）/`compactChars=2200` | `persona.current`（面板「人格」） | 部分 | 设 `da-fei-yu`（或覆盖 `dafeiyu`），见 §3.1 |
| `admin.qq=1362431704` | `ownerQQ`（AU:144） | 1:1 | **必填 `1362431704`** |
| `admin.displayName=主人`、`gentle=true` | `ownerName='主人'` | 部分（无 `gentle`） | 填 `主人` |
| `memory.qqToBili.*`（同步关） | 无 | 无 | 忽略（无跨平台同步能力） |
| `memory.privacy.*`（全开） | 无（只有出站 `redact`） | 无 | 改用**人格卡文字约束** + 模块权限（§5 缺口） |
| `alignment.*`（`links:[]`） | 无 | 无 | 忽略 |
| `memoryCard.enabled/maxChars/injectMaxChars.qq=2200/recentDays=7/forgetAfterDays=60/dailyHour=4/autoCompact` | `memory.enabled/recallCount=6/dailyConsolidate/consolidateTimes=['04:00','16:00']`（AU:220） | 部分 | 打开 `memory.enabled`；每日整理时段按需改 |
| `extensions.enabled=true` | `modules{}`、`safeMode=false` | 等价异名 | 保持默认 |
| `platforms.enabled=[qq,bili]`、`planned=[tieba]` | 无平台抽象；用 `bili.enabled`/`douyin.enabled` 等模块开关 | 部分 | 只开 `bili.enabled=false`（现状） |
| `updates.enabled=true`（每 6h 查 GitHub） | 无自动更新；面板 `/update/check`（AU:358） | 缺失 | 忽略（手工升级：再跑一次 `dsh plugin add` + 重启，AU:45） |
| `ui.activeTab/showAdvanced` | `tabs{}`（AU:227） | 部分 | 忽略 |

### 2.2 `<SC>/config.json`（桥接配置，SC§2.3，逐键）

| DSBot 键（现值） | Aurabot 键 | 判定 | 动作 / 建议值 |
|---|---|---|---|
| `dsh.baseUrl=…:3102` | 无（插件在 DSH 内） | 无 | 忽略 |
| `dsh.provider/model/reasoningEffort`（`deepseek-official`/`deepseek-flash`/`high`） | `model.provider/model/reasoningEffort`；`chatModels.*` 可按 QQ/群覆盖（AU:159-160） | 1:1 | **必填三项** |
| `snowluma.httpUrl=http://127.0.0.1:3000` | `snowluma.httpUrl` | 1:1 | **必填** |
| `snowluma.wsUrl=ws://127.0.0.1:3001` | `snowluma.wsUrl` | 1:1 | **必填** |
| `snowluma.accessToken=***`（单 token） | `snowluma.httpToken` + `snowluma.wsToken`（**两个独立**） | 部分（需拆两值） | 从 `onebot_2477094441.json` 的 HTTP/WS `accessToken` 分别取（AU:243） |
| `snowluma.followDiscoveredEndpoint/allowLaunch/launcherPath` | 无（`gateway=onebot` 只连填好的地址，AU:301-303） | 无 | `gateway="onebot"`（AU:240） |
| `ownerQQ=1362431704` | `ownerQQ` | 1:1 | **必填** |
| `allow.private=["1362431704"]`、`allow.groups=["694991842"]` | `allow.private/groups`（AU:149） | 1:1 | **必填原值** |
| `deny.users/private/groups`（全空） | 无 | 缺失 | 无实损（当前空）；需要时用 `titleFilter` 近似 |
| `allowAllWhenEmpty=false` | 无（等价固定：空=只回主人，`src/chat/access.js:11-24`） | 等价异名 | 忽略 |
| `agentPreset=qq-chat`、`socialV2.agentPreset=qq-chat-v2`、`workspaceTitle` | 无（preset 由权限档自动选：`aurabot-private`/`-private-long`/`-social`，AU:397） | 缺失 | 忽略 |
| `sessionCwd=<SC>` | `workspaceDir`（空=用户目录 `Aurabot/qq-chats`，AU:151） | 部分 | 建议填 `/home/ubuntu/Aurabot/qq-chats` 或留空 |
| `role.maxInjectChars=6000` | 无（人格全文注入，无上限） | 缺失 | 人格卡 <4000 字，无实损 |
| `social.*`（reply chars 500、mustReplyKeywords、triggerProbability、burst…） | `group.*`（wakeWords/`interjectChance`/`cooldownSec`/`maxPerHour`/`quietHours`/`minRelevance`/`burstMax`/`burstWindowSec`，AU:170）+ `merge.*`（AU:161） | 部分 | 见 §2.4 建议值 |
| `socialV2.enabled=true` | `enabled`(false) + `dryRun`(true)（AU:140-141） | 等价异名 | 先 `enabled=true`+`dryRun=true`，验收后关 dryRun |
| `socialV2.tools.*` 31 个布尔（`sendVoice=false`、`setStickerRemark=false`） | 无（工具由模块开关 + `profilePerms` 决定，AU:147,228） | 缺失 | 用 `modules{}` 关模块、`profilePerms` 收权限近似 |
| `socialV2.wake.*`（`defaultMode=diving`、`preSleepWaitMs=300000`、`maxWakePerHour=12`、`noActionLimit=3`） | 无 | 缺失 | 无替代（范式不同），成本用 `group.maxPerHour` 兜 |
| `socialV2.closure.*`、`socialV2.wait.*` | 无 | 缺失 | 无替代 |
| `socialV2.history.*`（`enabled/limit=30/maxAge=720`） | 无 | 缺失 | 无替代（§5） |
| `socialV2.tokenGuard.*`（日唤醒 20/私聊 10/¥8） | 无 | 缺失 | 无替代（成本靠模型档位+群限流） |
| `socialV2.send.*`（`maxSendPerMinute=8`、`maxPerHour=60`、`maxMessageChars=500`、分条 1~3s） | 无配额；分条上限硬编码 5/群 3（`src/chat/reply.js:96-105`），间隔由 `bubbleDelay` 算 | 部分 | 接受；必要时调 `group.maxPerHour` |
| `socialV2.sticker.*`（`enabled/syncTtl/maxListCount=100/match.topK=2/match.minScore=0.34/collect.*`） | `stickers.*`（`enabled/faces/autoChance/collect/collectMode/fromGroups/fromPrivate/maxPerHour/maxLibrary/caption`，AU:183-187） | 部分 | 开 `stickers.enabled`；`caption=true` 保留视觉备注 |
| `socialV2.voice.*`（`enabled=false`、`tts.enabled=false`、路由 local 8765/cloud 8767） | `voice.*`（engine=auto/edge/cosyvoice/gptsovits/http、`autoChance`、`asr`，AU:174-182） | 部分（Aurabot 无语音包管理） | 保持 `voice.enabled=false` 或装 venv 后按需开 |
| `fishGuard.*`（10min/`maxFish=5`/占比 0.6/`blockSends=true`） | 无 | 缺失 | 无替代（§5） |
| `slang.*`（`enabled=true`、`injectMax=8`、`learnerPreset=qq-chat`） | 无 | 缺失 | 见 §3.3 替代 |
| `purpose.enabled` / `greetings.enabled` / `proactive.enabled`（全 false） | `ext.purpose.*`（默认关）/ `speakUp.*` | 部分 | 需要时开 `speakUp.enabled` |
| `biliBridge.*`（全 false） | 无（B站模块无分享） | 缺失 | 忽略 |
| `consolePort=3100` / `consoleToken` | 无 | 缺失 | 忽略（端口 3100 释放） |
| `httpGuard.trustedProxyHosts`（2 个域名） | 无（Aurabot 不做反代校验；由 DSH/Caddy 管） | 缺失 | 忽略（但注意 DSH 启动参数已带 `--trusted-host`） |
| `webSearch.*`（provider=auto、`maxUses=5`、apiKey=***） | 无（用 DSH 内置 `tool-web`，仅私聊 preset 挂载） | 缺失 | 群里没有搜索能力（§5） |
| `pricing.models.my-relay-model.*` | 无（Aurabot 无计价表） | 缺失 | 忽略（额度页整体缺失） |
| `ackMessage` / `sendDelayMs=300` / `questionTimeoutMs` | 无 | 缺失 | 忽略 |

### 2.3 `$DSH_HOME/dsbot/bili.config.json`（SC§2.4，B站未登录）

| DSBot 键 | Aurabot 键 | 判定 | 动作 |
|---|---|---|---|
| `self/owner` mid/name（全空） | `bili.sessdata/biliJct/cookie`（AU:194） | 部分 | **重新登录**（无 cookie 可搬，LV:78） |
| `night.windows`（20:00-24:00）、`skipChance=0.3` | 无 | 缺失 | 忽略 |
| `preferences.like/dislike` | `bili.keywords[]`、`minViews`、`maxAgeDays`（AU:196） | 部分 | 手工挑关键词 |
| `quota.shareDaily=3`、`share.*` | 无（无分享能力） | 缺失 | 忽略 |
| `limits.daily=30/replyDaily=50/taDaily=15/...` | `bili.maxRunsPerDay=3`、`maxCommentsPerDay=3`、`maxRepliesPerDay=6`（AU:195-197） | 部分 | 按原值调低/调高 |
| `dynamics.kinds` 四类固定开头 | 无（无动态能力） | 缺失 | 忽略 |
| `diary.push` / `listen.comment` | `bili.autoBrowse/reply`（部分） | 部分 | 忽略 |
| `fishGuard`（B站评论区版） | 无 | 缺失 | 忽略 |
| `notify.type=none` | 无 | 缺失 | 忽略 |

### 2.4 迁移时必须人工填的字段清单（P0 上线前逐项打勾）

| # | 键 | 值 | 备注 |
|---|---|---|---|
| 1 | `botQQ` | `2477094441` | 连上后 `get_login_info` 必须相等，否则永不自动重连（AU:238；`src/host.js:113-150`） |
| 2 | `ownerQQ` | `1362431704` | 决定权限档（`full`）与白名单（AU:239） |
| 3 | `gateway` | `"onebot"` | 不走 SnowLuma 进程管理（AU:240） |
| 4 | `snowluma.httpUrl` | `http://127.0.0.1:3000` | LV:54 |
| 5 | `snowluma.wsUrl` | `ws://127.0.0.1:3001` | LV:54 |
| 6 | `snowluma.httpToken` / `wsToken` | SnowLuma `onebot_2477094441.json` 的两个 `accessToken`（`***`） | 分别以 `Bearer`、`?access_token=` 发送（AU:243） |
| 7 | `allow.private[]` | `["1362431704"]` | 原值搬（SC:90） |
| 8 | `allow.groups[]` | `["694991842"]` | 原值搬（SC:90） |
| 9 | `model.provider`/`.model`/`.reasoningEffort` | `deepseek-official` / `deepseek-flash` / `high` | 原值搬（SC:89） |
| 10 | `ownerLevel` / `longTasks` | `full` / `false` | 决定 `aurabot-private`；`longTasks=true` 换 `-private-long` |
| 11 | `enabled` / `dryRun` | 先 `true` / `true`，验收后 `dryRun=false` | 安全默认（AU:244） |
| 12 | `persona.current` | `da-fei-yu`（新 id）或保持 `dafeiyu`（覆盖自带卡） | §3.1 |
| 13 | `group.wakeWords` | `['大肥鱼','肥鱼']` | Aurabot 默认即此值（AU:170）；DSBot 对应的是 `social.mustReplyKeywords`= `['deepseek','小鲸鱼','大肥鱼','鲸鱼','d指导','在吗']`（`<SC>/config.json` 实测），可按需并入 |
| 14 | `group.quietHours` | `[1,8]` | 与 DSBot 夜间静默口径对齐（以现网实际作息为准） |
| 15 | `workspaceDir` | 空（默认 `~/Aurabot/qq-chats`）或显式指定 | AU:151 |
| 16 | `bili/douyin/heybox/imageGen/song.enabled` | 全部保持 `false` | 本期不迁（AU:247） |

> 反方向（Aurabot 有、DSBot 无）需要新决策的键：`profilePerms.*`（改资料/好友申请/白名单/抖音/小黑盒三档）、`titleFilter.*`、`group.overrides{}`、`chatModels.*`。

---

## 3. 数据资产迁移表

> 总原则：**只搬「人格 + 记忆 + 关系语感」，运行态一律重建**。DSBot 数据分居两处（插件 `<STATE>` vs 桥接 `<SC>/state`，SC:319），搬运时两处都要看，但只需取下列指定文件。

| 资产（SC§6 行 / LV） | 现路径 / 体量 | Aurabot 目标 / 格式 | 能直搬 | 迁移方式 | 转换后校验 |
|---|---|---|---|---|---|
| 当前人格卡（L293，LV:73-76） | `characters/da-fei-yu/persona.md`，3880 B | `plugins-data/aurabot/personas/da-fei-yu.md`（Markdown，`---name/tags---` 头可选，AU:335） | ✅ | copy | 面板「人格」列表出现且字数≈3880 B；`diff` 源文一致 |
| 角色索引/其他角色（L294） | `characters/{index,current}.json`、`char-*`、`tie-ba-lao-ge`，2.6 MB | 无索引；每角色 = `personas/<id>.md` + `persona.current` | ⚠️ 部分 | 仅取当前角色；其余可选批量 copy 成 md | 面板列表逐个可读 |
| 人格素材库（L309） | `<SC>/roles/` 99 个、`roles-full/` 27 个，1.7 MB | 同上（批量丢进 `personas/`） | ✅ | copy（按需，非线上必需） | 抽查 3 个 |
| 衰减记忆卡（L295） | `characters/da-fei-yu/memory/memory-card.json` 357 KB，**303 records** | `plugins-data/aurabot/memories.json`（`items[]`，AU:98） | ❌ 格式不同 | **转换脚本**（字段映射见 §3.2），不走面板导入 | 面板记忆条数=映射后条数；随机抽 5 条召回命中 |
| 全量记忆卡（L297） | `memory-card-full.jsonl` 303 行 / 248 KB（append-only，字段最全） | 同上（**优先用这份做转换源**，字段更全） | ❌ | 转换脚本 | 同上 |
| 记忆注入块（L296） | `memory-card-prompt-qq.md` 1150 字 | 无（Aurabot 动态召回，不需要静态注入块） | — | 不搬（留作人工核对参照） | — |
| 记忆 inbox（L298） | `memory/memory-inbox.jsonl` 112 KB | `chatlog/YYYY-MM-DD.jsonl`（可作导入素材） | ❌ | 可选：并入转换源 | 无（增量） |
| 记忆卡快照（L299） | `characters/da-fei-yu/snapshots/auto-*`，1.5 MB | **无快照机制** | ❌ | **不可搬**：先打包归档，作为本次迁移的回滚点 | `tar -tzf` 可列出 |
| 目的状态（L300） | `purpose-outreach.json` 661 B | `purpose/purpose-state.json`（结构不同，AU:121） | ❌ | 不可搬（功能默认关） | — |
| 二代运行态记忆字段（L306） | `<SC>/state/social-v2.json` 77 KB | `memories.json` + 人格（见 §3.4） | ⚠️ 部分 | 转换（只取记忆类字段） | 见 §3.4 清单 |
| 黑话库（L307） | `<SC>/state/slang.json` 247 条 / 129 KB | **无对应机制** | ❌ | 转换到人格卡 + 记忆条目（§3.3） | 群里抽查 5 个词 |
| 表情库（L308） | `stickers.json`（0 条） | `stickers/index.json` + 图片 | ❌（空） | 不搬；改用面板「从 QQ 导入」 | 面板表情数 = QQ 收藏数 |
| B站凭据（L301） | `<STATE>/bili/*` **不存在**（未登录） | `bili.cookie` 系列 | ❌ | 不可搬：到 Aurabot 面板重新登录 | `bili.state` 显示已登录 |
| B站配置（L302） | `bili.config.json` 3 KB | `bili.*`（§2.3） | ⚠️ 部分 | 面板手工填报（按 §2.3 表） | 抽查额度键 |
| 观看历史（L303） | `characters/<id>/bili/watch-history.jsonl`（空） | `bili.json` 的 `seen/history` | ❌（空） | 有则转 JSON 数组 | `bili.json` 行数 |
| Token 用量/账本（L304） | `token-usage-*.json`、`token-usage.jsonl` 177 KB、`tool-calls.jsonl` 235 KB | 无 | ❌ | **不可搬**：只留档（Aurabot 无账本） | — |
| QQ 会话映射（L305） | `<SC>/state/sessions.json` 322 B | `sessions.json`（`{chats:{chatId:{sessionId,preset,…}}}`） | ❌ | **不搬**：绑定旧 DSH sessionId，首次收到消息自动重建（AU:347,450） | 首条消息后 `sessions.json` 生成新 sessionId |
| 桥接状态杂项（L311） | `mode.json`/`current-role.json`/`self-identity.json`/`greetings.json`/`alignment-brief.md` | 无对应（可选把 self-identity 文案并入人格卡） | ❌ | 不可搬（≤5 KB，留档） | — |
| 跨平台记忆管道（L312） | `qq-public-feed.jsonl`、`memory/*-for-*.md`（近空） | 无 | ❌ | 不搬 | — |
| 备份（L313） | `<STATE>/backups/` 284 条目 / 24 MB | 无备份机制 | ❌ | 不搬全量；取最近 2~3 份留档 | `tar -tzf` |
| DSH 会话记录（L314） | `$DSH_HOME/sessions/` 50 文件 / 14 MB | 无 | ❌ | 不搬（旧会话在侧栏仍可读，AU:347） | — |
| 桌宠/语音数据 + 日志（L315-317） | `pet/` 20 KB、无语音包、`plugin.log`/`bridge.log*` 274 KB | Aurabot 自有 `modules-data/pet/`、`logs/` | ❌ | 不搬（自动生成）+ 旧日志留档只读 | — |

### 3.1 人格卡专项（结论：可直搬，但要改 id 且不能覆盖协议）

- DSBot 的 `persona.md` 与 `<SC>/roles/原装-大肥鱼.md` **逐字节相同**（已 `diff`），是「原装-大肥鱼」的唯一正文 → 搬一份即可。
- 该文本**不含任何工具名/接口引用**（`grep qq_/mcp__/token` 无命中）→ 可以直接作为 Aurabot 人格正文，不会被失效工具名污染。
- Aurabot 的 `personas/*.md` 只放「角色正文」；**输出协议由 `rulesText()` 代码拼接**（一句一行/`|||`/`<voice>`/`<sticker:>`/`<at:QQ>`/`<poke>`/`[沉默]`，`src/persona/personas.js:86-120`）。所以**不要**把 Aurabot 自带 `personas/dafeiyu.md` 整份覆盖掉就以为搬完了——自带卡里那几条「一次只说一句话，想说的多就拆成几条发，用 ||| 分隔」是人格层习惯（`personas/dafeiyu.md:18,52-53`），覆盖后会损失语感细节。
- 两种落地方式：
  - **A（推荐）**：新建 `personas/da-fei-yu.md`（内容 = DSBot `persona.md`），面板「人格」里「设为当前」→ 写入 `persona.current="da-fei-yu"`；自带 `dafeiyu.md` 保留作参考。**多一步改配置，但可回退**。
  - **B（最省事）**：直接用 DSBot 文本覆盖 `personas/dafeiyu.md`，`persona.current` 不用改。**零配置改动，但丢失自带卡语感且不可单人回退**（无快照机制）。
- 迁移前先 tar 归档 `characters/`（Aurabot 无快照/回档，§1.1 行「角色」）。

### 3.2 记忆卡 → `memories.json` 字段映射（303 条）

Aurabot 的 item 形状：`{id,text,about,aboutName,tags,importance,source,chatId,at,hits,invalidAt?}`（AU:98）。硬约束（源码实测）：`text` 会被 **截断到 200 字**（`src/features/memory.js:187`）、`tags` 最多 5 条（`:200`）、库上限 3000 条（`:202`）、`add()` 会按相似度 ≥0.6 去重（`:191`）。

| DSBot 字段（真实取值） | Aurabot 字段 | 规则 |
|---|---|---|
| `text`（303 条：均长 12.7 字，最长 254，**仅 1 条 >200**） | `text` | 直拷；>200 字那条手工劈成两条 |
| `speaker`（主人 165 / 大肥鱼 81 / 2円 33 / 自动骗 13 …） | `aboutName` | 直拷 |
| 无 QQ 号字段（记录里只有昵称） | `about` | 主人 → `1362431704`；群友需人工补（无可信来源，留空即不享受「关于此人」加权） |
| `importance`（0~100，如 35/48/100） | `importance`（0~1） | `÷100`；`pinned`/`anchor` 的 2 条拉到 ≥0.9 |
| `kind`（owner 164 / event 133 / promise 4 / firstMeet 1 / conflict 1） | `tags` | 保留为第一个 tag（`['promise']` 等），再补 1~3 个话题词 |
| `createdAt`（ISO） | `at`（毫秒） | `Date.parse()` |
| `source`（qq-owner/qq-self/qq-group） | `source` | 统一 `"import"` |
| `isSelf=true`（81 条，是**她自己说过的话**） | — | **建议丢弃**：Aurabot 的导入提示词明确「不要记她自己的人设」，保留会污染召回；若要留，置 `importance≤0.3` + `tags:['旧事']` |
| `recallCount`/`decaySteps`/`clarity`/`emotional`/`conversationKey`/`botReply` 等 | — | 无对应；可选把 `clarity` 拼进 tag |
| `id`（`mem_*`） | `id` | 重新生成 8 位短 id |

**两条路线，二选一（推荐 ①）**：
1. **直接写 `memories.json`（推荐）**：303 条一次到位、不去重、不烧 token、可 diff 校验。操作：先停 Aurabot（`enabled=false`）→ 写文件（UTF-8 无 BOM、原子写，AU:91）→ 起插件 → 面板「心情与记忆」看条数。风险：手写格式错会导致 `load()` 异常，需先 `JSON.parse` 自检。
2. **面板「导入旧档案」**：`POST /aurabot/api/memory/import`（文本 ≤30000 字，内部再切 6×5000 字，**每次最多产出 80 条候选**，`src/features/memory.js:208-229`）→ `/import/commit` 勾选入库。`memory-card.md` 13,898 字可一次喂完，但 303 条会被截到 80 条 → 需 4 次分段导入，且**每段烧一次模型调用**。适合「只想留最重要 80 条」的省事方案。

### 3.3 黑话库 247 条 → 无对应机制的替代方案

Aurabot 全仓无黑话/梗库（`grep -rl "slang\|黑话" src/` 空）。三选一：

| 方案 | 做法 | 成本 | 效果 |
|---|---|---|---|
| **A（推荐）** | 取高频/最常用的 **30~50 条**，压缩成「群梗速查」段落（每条≤30 字）追加到 `personas/da-fei-yu.md` 末尾 | 纯文本，零代码 | 100% 常驻，稳定；缺点是占系统提示词 token |
| B | 247 条全量转成 `memories.json` 条目（`tags:['黑话']`，`importance 0.6~0.8`） | 转换脚本 | 靠记忆召回，命中不稳定，但容量无限 |
| C | 写一个用户模块挂 `prompt` hook 动态注入（`src/modules/API.md:183-267`） | 需写代码 | 最接近原体验；**超出本期范围**（不写代码） |

> 遗留：原始 `slang.json` 必须归档（Aurabot 侧无任何落盘位置）。

### 3.4 `social-v2.json` 记忆类字段 → Aurabot 记忆条目（实测取值）

| DSBot 字段（实测） | 内容 | Aurabot 落点 |
|---|---|---|
| `private:1362431704.activeTopics[0]` | `{text:"主人11月4日之前要交作业，需要提醒他", pendingQuestion:"11.3晚上提醒主人交作业"}` | 2 条记忆：`text` 原文，`aboutName:"主人"`、`about:"1362431704"`、`importance:0.9`、`tags:["约定","提醒"]` |
| `private:…closure` | `summary:"主人又想用命令设定11.4交作业提醒…"`、`nextOpening:"下次他来说话，开头先催一句11.4的作业"` | 2 条记忆（`tags:["收尾","上次聊到"]`，`importance:0.7`）；**注意 `nextOpening` 的「下次开场」语义在 Aurabot 无注入点**，只能靠召回自然命中 |
| `group:694991842.closure` | `summary`（游戏隐藏分/炸鱼梗）、`nextOpening` | 同上（群聊无「开场承接」注入点，效果弱） |
| `memberImpressions` / `activeTopics`（群侧） / `fishGuardLog` | 均为空 | 无 |
| `wakeConfig`/`unread`/`lastReadThroughSeq`/`agentToken`/`wakeTimes`/`sendTimes`/`recentMessages` | 运行态 | **不搬**（Aurabot 无对应结构） |

---

## 4. 接口对照

### 4.1 MCP 工具：42 → Aurabot 49 工具（同名者语义也不同）

> 关键警告：DSBot preset 提示词**逐条点名工具名**（`<PL>/presets/qq-chat-v2.patch.yml:22-25`，含 `mcp__snowluma__qq_send_message`、`qq_wait_for_messages`、`qq_mark_read`、`qq_close_conversation`、`qq_set_wake_config` 等），且要求「把【会话令牌】作为 token 参数传入」。换插件后**整套 17 条工具协议全部作废**，而且语义是**反的**：DSBot 是「文本不发出、必须调工具」，Aurabot 是「正文就是发出的消息、工具只用于发到别的会话」。

| DSBot 工具（SC:226） | Aurabot 对应 | 判定 / 说明 |
|---|---|---|
| `qq_status`、`qq_get_prompt`、`qq_social_state`、`qq_get_self_image` | 无 | 缺失（状态在面板/`/api/state`） |
| `qq_list_groups`、`qq_get_group_members`、`qq_get_active_members` | 无工具 | 缺失（内部有 `get_group_member_list` 缓存，`src/chat/hub.js:139-143`，但对模型不可见） |
| `qq_get_group_history` | `qq_chat_history` | 部分（仅当前会话、≤50 条；底层同为 `get_group_msg_history`，`src/modules/qq-tools/index.js:19-23`） |
| `qq_get_unread_messages`、`qq_get_recent_messages`、`qq_get_my_recent_messages` | 无 | 缺失（消息由中枢合并后注入，模型不能主动查） |
| `qq_get_message_detail` | 无 | 缺失 |
| `qq_get_message_images` | 无工具 | 等价异名（消息里的图/表情自动进上下文） |
| `qq_get_forward_msg` | 无工具 | 等价异名（合并转发自动展开为「[合并转发的聊天记录]」） |
| `qq_send_message` | `qq_send_message` | **同名不同义**（Aurabot 只在主人私聊挂、用途=发到**别的**会话；当前会话回复=正文，`src/modules/qq-tools/index.js:62-78`） |
| `qq_send_burst`、`qq_send_group_message`、`qq_send_private_message` | 无 | 缺失（`\|\|\|` 内联分条替代） |
| `qq_reply` / `qq_send_poke` | 无 | 缺失（`<reply:N>` / `<poke>` 内联标记替代） |
| `qq_send_sticker` | `qq_send_sticker` | 部分（另有 `<sticker:标签>`） |
| `qq_send_voice` | 无 | 缺失（`<voice>` 标记 + `voice.autoChance` 替代） |
| `qq_mark_read`、`qq_close_conversation`、`qq_set_wake_config`、`qq_wait_for_messages` | 无 | **缺失（范式性）**：Aurabot 无已读水位/潜水/收尾/等待概念（AU:415-421） |
| `qq_report_feedback` | 无 | 缺失 |
| `qq_list_stickers` / `qq_collect_sticker` | `qq_list_stickers` / `qq_collect_sticker` | 部分（Aurabot 另有 `qq_add_sticker`/`qq_save_sticker`/`qq_import_qq_stickers`/`qq_edit_sticker`） |
| `qq_get_sticker_image` / `qq_sticker_note` / `qq_set_sticker_remark` | 无（`qq_edit_sticker` 近似改名/标签） | 缺失（DSBot 的 `setStickerRemark` 也默认关） |
| `qq_list_voices` | 无 | 缺失 |
| `qq_memory_query` / `qq_memory_append` / `qq_memory_remove` / `qq_memory_clear` | `recall_memory` / `remember` | 部分（只能「记」不能「删/清」，删除在面板） |
| `qq_slang_query` / `qq_slang_submit` | 无 | 缺失（§3.3） |
| `snowluma_status`（host 1 个） | 无 | 缺失（`gateway=onebot` 不探 SnowLuma） |
| `web_search` / `web_fetch`（web-search-safe 2 个） | **群里无**；主人私聊 = DSH `tool-web` | **缺失（群聊）**：social preset 不挂 tool-web（`cordis.patch.yml:119-143`），群友让她联网查东西会做不到 |

> Aurabot 另有 DSBot 没有的工具：`qq_group_admin`、`qq_draw_image`、`qq_send_qzone`、`qq_send_file`、`bili_*`(6)、`douyin_*`(7)、`heybox_*`(9)、`qq_get_profile`/`qq_set_*`/`qq_handle_friend_request`/`qq_whitelist`、`weather_now`（AU:389-393 汇总 + `src` 实测 49 个）。

### 4.2 插件 HTTP 路由：24+4 族+14 pet-api → `/aurabot/api/*` 74 条

| DSBot 路由族（SC:187-220） | Aurabot 对应 | 判定 |
|---|---|---|
| `/overview` `/health` | `/state`、`/aurabot/api/state`（AU:358） | 等价异名 |
| `/config`（三份配置读写、409 冲突） | `/save`（单份 config）+ 面板表单 | 部分（无版本戳/冲突检测） |
| `/characters` `/persona` | `/personas`、`/persona/{get,save,delete,use,polish}` | 部分（无快照/导入导出） |
| `/memory` `/memory-card` `/memory-card/full` | `/memories`、`/memory/{add,update,delete,recalls,restore,import,import/commit,extract}`、`/profiles*`、`/insights*`、`/style/save` | 部分（无双向同步/隐私审计/全量卡） |
| `/mode`（写 DSH settings `qq-mode`） | 无 | 缺失 |
| `/bridge`（start/stop/restart/call） | `/onebot/reconnect`、`/onebot/test`、`/test-send` | 部分（无外置进程） |
| `/diagnostics` `/logs` `/updates` | `/logs`、`/update/check`、`/changelog` | 部分（无体检/备份/回滚） |
| `/token-budget` `/owner-audit` `/privacy/explain` `/watch-history` `/preferences/scan` `/fish-guard/qq` | 无 | 缺失（6 类整页无对应） |
| `/bili/*`（扫码/待审/自动化/分享） | `/bili/{state,account,run,replies,shots,shot/image,shot/delete}` | 部分（无扫码/分享） |
| `/voice/*`（代理桥接） | `/voice/{song-voices,test,install,asr-status,asr-prepare,asr-last,asr-test}` | 部分 |
| `/pet/*` + `/pet-api/*`（14 条，`x-pet-token`） | `/panel/pet/*`（14 条）+ pet 模块 26 条（AU:359,387） | 部分（契约不同，桌宠本体要换） |
| `/extensions` `/platforms` | `/modules`、`/modules/{reload,create,fork,prompt,open,simulate,tools,tool,panel}` | 等价异名 |
| `/dsh-dsbot/ext/<id>/<path>` | `/aurabot/api/ext/<id>/<path>`（AU:372） | 等价异名 |
| `/updates`（组件更新/回滚） | 无 | 缺失 |

> 鉴权差异：DSBot 显式调 `connection.requestRejection`（无 Cookie 实测 401，SC:185）；Aurabot 的路由 handler 内**未见鉴权代码**（`src/host.js:311-341`），是否受 DSH 外层鉴权保护 **未确认**（附录 A-2）。

### 4.3 桥接控制台 138 个 API（重点 `/api/socialV2/*` 46 个）→ 无对外 HTTP

| DSBot（SC:232-254） | Aurabot 实现位置 | 对外可见性 |
|---|---|---|
| `/api/socialV2/*` 46 个（state/config/prompt/send-*/wake/mark-read/close/history-catchup/memory-*/slang-*/sticker-*/tool-log…） | `src/chat/hub.js`、`src/chat/reply.js`、`src/chat/group-policy.js`、`src/onebot/client.js` 内部函数 | **不暴露**：行为内化，无 REST 等价物 → 外部脚本/工具链断 |
| `/api/status`、`/api/sessions`、`/api/restart`、`/api/preset/sim-prompt` | `/state`、`/sessions/reset`、`/save` | 部分 |
| `/api/voice/packs/*`（安装/导入/启停/云配置）、`/api/tokens/*`、`/api/authorize/read` | 无（语音安装走面板 `/voice/install`；账本/授权无） | 缺失 |

### 4.4 CLI / 脚本 → 无 CLI

- DSBot：`tools/bili.mjs` 约 50 子命令（读类 30+、写类须 `--dry`/`--go`、排障 2 个）、`scripts/` 159 个（运维常用 9 个）、`<PL>/scripts/` 40 个测试脚本（SC:267-271）。
- Aurabot：**零 CLI**，全部经面板或 `/aurabot/api/*`。`extensions/tieba-reader` 是唯一带独立脚本的扩展（AU:346）。
- 会断的地方：`bili.mjs` 批量评论/动态/查询、`setup-dsh.mjs`/`sync-dsh-port.mjs`/`scan-dsh-tool-names.mjs` 等 profile 维护脚本、`check-onebot-status.mjs`、`bili-memory-sync.mjs`。

### 4.5 preset：2 个 → 3 个，工具面重排

| 维度 | DSBot `qq-chat` / `qq-chat-v2`（SC:273-278） | Aurabot `aurabot-private` / `-private-long` / `-social`（AU:29-32） |
|---|---|---|
| 系统提示词 | persona 前缀 + 17 条工具协议 + 场景/反 AI 味规则；`complete` 未设 | persona（`{{aurabot_persona}}`）+ `rulesText`（内联标记协议）+ **`complete: true`**（人格独占） |
| 工具面 | `mcp__snowluma__*` 39 + web-search 2 + `tool-ask-user` + `tool-todo` + 守卫 | 模块工具（≤49）；private 另加 bash/pwsh/fs/fs-search/web；private-long 再加 `tool-jobs`+`tool-schedule`；**social 无任何本地工具、无 web** |
| 守卫 | `qq-tool-restrict.mjs`：注册期隐藏 + 运行期 `tools.guard` 白名单（SC:278） | 无同名守卫；靠 preset 只挂必要插件 + 模块按权限档注册（AU:420） |
| 选择方式 | `qq-mode` 命名空间 + `socialV2.agentPreset` | 权限档自动：`levelFor()` → `presetFor()`（`src/chat/access.js:27-39`） |
| 会话 | 单 agent + 桥接注入 | 每 QQ 会话一个 DSH 会话（侧栏「Aurabot · QQ」，AU:416） |

### 4.6 `qq-mode` 设置命名空间 → 无对应

DSBot 用 loader entry `qq-mode` 的 Config 推导 settings 命名空间，字段 `mode∈{chat, closed-agent, reserved, reserved2, simulation}`（默认 `reserved2`）+ `ownerQQ`，桥接读写它（SC:263-265）。Aurabot 无 settings 命名空间：等价信息分散在 `ownerLevel`（权限档）、`allow.*`、`group.*`、`enabled/dryRun`。**外部任何读写该命名空间的脚本/文档全部失效。**

### 4.7 模块 hooks / 扩展平台

| DSBot（SC:280-283） | Aurabot（AU:399-402,278） |
|---|---|
| `extensions/<id>/{manifest.json,index.js}`，默认 `enabled:false`，宿主 API = config/dataDir/paths/platforms/registerPlatform/记忆/桥接控制/B站工具链/事件总线/自定义路由 | `modules/<id>/index.mjs`，`export default {id,name,version,api,setup,settings,panel,tab,defaults}`；`api.*` 约 25 项；hooks：`message`/`poke`/`reply`/`group/decide`/`prompt`/`reply/items`/`send`/`model`/`persona`/`rules` 可改写，另有 9 个只读 |
| `PlatformAdapter` 接口 + 内置 qq/bili + tieba planned | 无平台抽象，每平台一个模块 |
| 现有 `sts2`/`bili-live` 均未启用 | 内置 18 模块 + `extensions/tieba-reader` |
| 结论 | **API 完全不兼容**，DSBot 扩展必须重写；因现有扩展都未启用 → 无实损 |

### 4.8 外部脚本/自动化会断的地方（逐条）

1. 任何 `curl http://127.0.0.1:3102/dsh-dsbot/api/*`（带/不带 Cookie 都变 404）——设置页自动化、`ui-shot.mjs` 类巡检脚本。
2. 桥接控制台 `127.0.0.1:3100` 全部 `/api/*`（含 `x-console-token` 调用方）——**端口直接消失**。
3. `pet-api` 契约（`<STATE>/pet/host.json` 的 `baseUrl`+`token`）——桌宠本体若存在必须换 Aurabot 桌宠客户端。
4. `tools/bili.mjs` 全部子命令 + `scripts/{setup-dsh,sync-dsh-port,scan-dsh-tool-names,check-onebot-status,bili-memory-sync}.mjs`。
5. 任何读写 `qq-mode` settings 命名空间的脚本。
6. 黑话确认流（`/api/slang/{extract,research,batch-confirm}`）与 token 用量报表（`/api/tokens/*`）。
7. systemd `dsbot-bridge.service` 的 `ExecStart`/日志路径监控（`logs-dsbot-bridge.log` 不再增长）。
8. 依赖 `mcp__snowluma__*` 工具名的 prompt/评测集/审计脚本。

---

## 5. 缺口清单与替代

| # | 缺口（DSBot 有 / Aurabot 无） | 等级 | Aurabot 近似替代 | 建议 |
|---|---|---|---|---|
| 1 | Token 额度/峰谷计价/80-100% 闸门/日花费上限 ¥8（SC:165,99） | 体验下降 | 无；只能靠 `model.reasoningEffort`、`group.maxPerHour`、`merge.waitSec` 间接压 | **接受损失** + 在 DeepSeek 侧设预算告警（外部） |
| 2 | 模型自主唤醒/潜水/已读水位/收尾/等待（4 工具 + wake/tokenGuard 配置） | **阻断（行为）** | 推送式：`group.*` 决定回不回、`[沉默]` 表示不回、`merge.*` 合并连发 | **必须让用户书面接受**这是行为模型变化 |
| 3 | B站：生物钟/养鱼/观看历史/口味/定时分享/四类动态/cookie 登录（SC:135,164-166） | 无关（当前未登录、`biliBridge` 关） | `bili` 模块：定时刷 + 评论/回复/点赞 + 抽帧看画面 | **接受损失**；要用再单独做 B站 子方案 |
| 4 | 记忆卡衰减压缩（303 条自动衰减 + 全量卡） | 体验下降 | `consolidate()` 每日 04:00/16:00 从聊天流水提炼 + 遗忘曲线 + `invalidAt` 过时不删 | **接受**（机制等价，历史条目不再衰减） |
| 5 | 角色包/12 槽快照/回档/epoch | 体验下降 | 无；面板人格 CRUD + 手工 tar 归档 | **接受损失**，迁移前人工归档、把「回滚点」写进操作手册 |
| 6 | 语音包安装/健康检查/TTS 三路路由/云端凭据 | 无关（当前关） | `voice.*`：edge-tts 安装/试听/引擎切换/cosyvoice/gptsovits/http + ASR | **接受**（能力接近，缺语音包管理器与音量规则） |
| 7 | 桌宠 host API（14 条，`x-pet-token`） | 无关 | pet 模块 26 条路由 + `/panel/pet/*` + 自带 `host.json` 契约 | **接受**；本机无桌面（LV:92）不可用 |
| 8 | 备份/诊断/组件更新回滚 | 体验下降 | 仅 `/logs`、`/update/check`、`/changelog` | **接受**；改用手工体检脚本 + tar（不在本期交付） |
| 9 | 扩展平台（manifest + 宿主 API） | 无关（`sts2`/`bili-live` 未启用） | 用户模块 API v1（更强，但要重写） | **接受损失**（无现存扩展可迁） |
| 10 | SnowLuma 安装检测 / token 自愈 / 桥接自愈（SC:52,59,327） | 体验下降 | `gateway=onebot` 不自愈；只有 `/onebot/reconnect` + 断线退避 2s→30s（AU:309） | **接受损失**：QQ 掉线/换 token 需人工介入，写进运维手册 |
| 11 | `qq-mode` 命名空间 + 5 种模式 | 无关 | 无（`ownerLevel` 3 档 + 策略） | **接受损失** |
| 12 | 上线补历史（补洞 + 水位） | 体验下降 | 无；`qq_chat_history` 只能模型主动翻 ≤50 条 | **接受损失**；重启后可能漏掉掉线期间消息 |
| 13 | 对话收尾（summary/nextOpening 承接） | 体验下降 | 无；只能靠记忆条目人工承接（§3.4） | **用记忆条目补**（把 closure.summary 转成记忆） |
| 14 | 鱼群保护（QQ 群） | 体验下降 | `titleFilter` 只滤别的机器人 + `burstMax` 刹车 | **接受损失**；靠 `group.minRelevance`/冷却降低被刷概率 |
| 15 | 群聊生物钟（每小时 40% 在线、离线只回 @） | **无关**：仅 chat 模式生效（`src/bridge.js:1160,11784-11825`），当前 reserved2 未启用 | `group.quietHours`（默认 1-8 点静默） | **接受**（Aurabot 有更简单的静默时段） |
| 16 | 早安问候 | 无关（`greetings.enabled=false`） | `speakUp.*`（仅主人私聊主动搭话） | **接受**；需要时开 `speakUp.enabled` |
| 17 | 黑话学习（247 条，管理员确认入库） | 体验下降 | §3.3 三方案（推荐压缩进人格卡 + 记忆条目） | **用替代方案补**，放弃「自动学习新梗」 |
| 18 | 身份对齐 / 自我身份锚点 / 身份泄露闸 | 无关（`links:[]`、B站未用） | 无（`redact` 只管密钥，不管 QQ 号） | **接受损失**；若将来做 B站 必须重做泄露闸 |
| 19 | 主人特权审计 / token 账本 | 体验下降 | 无（只有 `logs/`） | **接受损失** |
| 20 | 真人式分条：1~3s 间隔、≤500 字、每分钟 8/每小时 60 | 体验下降 | `splitLines`+`bubbleDelay`（约 9 字/秒模拟）；**上限 5 条、群里 3 条** | **接受**（上限更低，反而不易刷屏） |
| 21 | 全局试运行（DSBot 无；B站 写操作才有 `--dry/--go`） | 无关 | `dryRun=true` 是 Aurabot 的默认值（AU:141） | **反向增强**：迁移期直接用 dryRun 验收 |
| 22 | MCP 工具面 42 个 | **阻断（prompt 层）** | 49 个模块工具（§4.1） | **必须重做提示词/评测集**，不能沿用 |

**永久丢失（Aurabot 侧无任何载体，迁移后不可恢复）**：
1. 12 槽角色快照 / epoch 回档 / 快照机制；Token 逐轮账本与花费报表（数据仅留档）。
2. B站 生物钟 / 养鱼 / 观看历史 / 口味资料 / 四类动态 / 定时分享；语音包管理器（打包 / 激活 / 音量规则 / 云端凭据路由）。
3. 跨平台身份对齐（QQ⇄B站 映射 + brief 注入）+ 身份泄露闸；黑话「自动学习 → 管理员确认」闭环（247 条可转文本，机制不可复制）。
4. 记忆卡「全量永不遗忘 + 衰减」双轨中的全量卡机制（数据可转，语义层级丢失）；已读水位 / 潜水 / 收尾等会话状态语义。
5. 主人特权审计流水（`owner-audit.jsonl`）；扩展平台上的既有扩展（含未启用的 `sts2`/`bili-live` 预留位）。

---

## 6. 迁移可行性结论与分期

### 6.1 分档结论

**建议分阶段（不建议一次性全量切换，也不需要「双跑」，因为同一 QQ 号无法双消费）。**

- **可全量切的部分**：QQ 私聊/群聊对话主链路（网关 + 人格 + 白名单 + 权限 + 试运行）、记忆导入、表情包重建。
- **不可切、需接受损失的部分**：见 §5「永久丢失」10 项；其中只有「token 闸/上线补历史/鱼群保护/收尾」是**群友/主人可感知**的降级，其余当前都处于关闭或空数据状态。
- **不建议切的部分**：B站 能力（未登录，且 Aurabot 无分享/动态/生物钟）——本期保持「不启用」，不要为了迁移而迁移。

### 6.2 分期与边界

| 期 | 范围 | 进入条件 | 验收 | 回滚点 |
|---|---|---|---|---|
| **第 0 步（前置，阻断项）** | 恢复 QQ 登录态 | VNC 6081 / WebUI 5099 扫码 + 同意 EULA/PRIVACY；`curl :3000/get_login_info` 返回 `retcode:0`（LV:23-26） | 网关 HTTP/WS 都可连；`dsbot-bridge` 日志恢复「SnowLuma 已连接」 | —（不涉及数据变更） |
| **P0** | QQ 核心对话：网关 + 人格 + 白名单 + 权限 + 试运行 | 第 0 步完成；已 tar 归档 `$DSH_HOME/dsbot` 与 `<SC>/state`；已确认「迁移窗口内停桥接」的责任人 | ① `dryRun=true` 下私聊/群聊各 20 条消息，面板日志显示「要发的内容」正确；② 关 dryRun 后与主人私聊 10 轮、群里被 @ 3 次，回复正常且分条像人；③ 白名单外的人发消息无响应 | `systemctl stop dsbot-dsh` → 从 profile 移除 aurabot bundle → 恢复 dsbot → `systemctl start dsbot-bridge`（见 §7 顺序） |
| **P1** | 记忆导入 + 黑话/身份等语感资产 | P0 稳定运行 ≥3 天无异常；记忆转换脚本产出通过 `JSON.parse` 自检 | ① 面板记忆条数 = 映射条数；② 抽 10 个话题问「你还记得…」，召回正确；③ 主人「交作业」提醒类记忆可被提起（§3.4）；④ 人格卡含压缩后的黑话段落 | 恢复 P0 备份的 `memories.json` 为空 + 换回旧人格卡 |
| **P2** | B站 等当前未用的能力（含抖音/小黑盒可选） | 用户明确要继续用 B站；已完成重新扫码登录 | `bili.state` 显示已登录；跑一轮 `bili.autoBrowse` 有正确记录 | 关 `bili.enabled=false`（不影响 QQ 链路） |
| **P3** | 语音 / 桌宠 / 空间 / 抖音等可选 | 装 `ffmpeg`（语音条编码）、`python3-venv`（edge-tts）；抖音另需 X/Xvfb + Chromium（LV:64-70） | 语音试听通过、发一条语音条收到；空间日记写一条可见 | 对应模块开关置 false |

> **用户口径执行要点**：「只迁移线上机器人」= 优先保证 QQ 私聊/群聊像人、不丢记忆和关系。因此 **P0 的人群是「主人 + 694991842 群」**，P1 的人群资产优先级是「主人（165 条记录）> 群友（57 条）> 她自己的旧发言（81 条，建议丢弃）」。

---

## 7. 关键冲突点（按危险度排序）

| # | 冲突 | 事实 | 必须做的事 |
|---|---|---|---|
| 1 | **同一 QQ 号只能一个 OneBot 消费者** | SnowLuma WS 允许多客户端；bridge.js 与 Aurabot 同时连 → 双收/双回（AU:327-328） | 先停 bridge **再**开 Aurabot 总开关；**顺序不可颠倒** |
| 2 | **`dsbot-bridge.service` 会自己回来** | `Restart=always`（`/etc/systemd/system/dsbot-bridge.service`）；且 DSBot 插件每 120s 有 `maybeAutoStartBridge()`（SC:59）；但当前 DSH 单元带 `DSBOT_SKIP_AUTOSTART=1`（`/etc/systemd/system/dsbot-dsh.service`） | 必须 `systemctl disable --now dsbot-bridge.service` **并**把 `dsbot` 从 `dsh.profile.bundles` 移除（AU:434），只 kill 进程会复发 |
| 3 | **DSH 重启会中断当前 agent 会话** | 本会话就跑在 `dsbot-dsh.service`(pid 990) 里（LV:16） | 安装/移除插件都要重启 DSH（AU:427）→ 该操作必须由**外部**（另开终端/systemd）执行，并提前告知用户本会话会断 |
| 4 | **插件并存冲突**（preset 名/设置命名空间/端口/数据目录） | 两者都是 profile bundle，并存 = 双插件运行；`qq-mode` 命名空间与 Aurabot 无冲突但旧 preset 会留在列表里；端口 3100 会消失（Aurabot 无自有端口） | 迁移必须「先移除 dsbot，再装 aurabot」；数据目录互不干扰（`$DSH_HOME/dsbot` vs `$DSH_HOME/plugins-data/aurabot`），但**旧插件的数据不要就地改** |
| 5 | **内存 3 GB 极限** | DSH 已占 1.8~2.0 GB，swap 已用 ~98 MB（LV:15,69） | 禁止两套 DSH 并行；验证期也只保留一套（必要时临时停 bridge 腾内存） |
| 6 | **SnowLuma 容器与登录态归属** | SnowLuma 在 Docker（3000/3001/5099/6081），登录态在容器内；DSBot 负责 token 自愈回写配置，Aurabot 不做（§5-10） | SnowLuma 启停归 Docker（`docker restart snowluma`），**不要让 Aurabot 用 `gateway=snowluma`**（Linux 会尝试 Windows 路径，AU:321-323）；换 token 后手工同步两处 token |
| 7 | **`~/.dsh` 那只 DSH（pid 972，端口 3080）与迁移无关** | 该 home 下无 dsbot 插件/状态（SC:353, LV 侧同） | **不要误停/误改**；所有操作限定 `DSH_HOME=/home/ubuntu/dsh-agentchat/dsh-0.2-home` |
| 8 | 试运行开关方向相反 | DSBot 没有全局 dryRun；Aurabot 默认 `enabled=false`+`dryRun=true`（AU:426） | 忘记打开 `enabled` 会表现为「插件装了但完全不回消息」，不要误判为故障 |

## 附录 A：未确认项与确认方法

| # | 未确认 | 确认方法 |
|---|---|---|
| A-1 | SnowLuma WS `role:"Universal"` 是否接受 Aurabot 的 `?access_token=` 查询参数鉴权（AU:445 U4） | 登录态恢复后，用 node 脚本连 `ws://127.0.0.1:3001/?access_token=***` 发 `get_login_info`，看是否 `retcode:0` |
| A-2 | `/aurabot/api/*` 是否受 DSH 鉴权保护（handler 内未见校验，`src/host.js:311-341`） | 装好后 `curl -i http://127.0.0.1:<port>/aurabot/api/state`（不带 Cookie），看是否 401 |
| A-3 | DSBot 群成员 QQ 号与 `speaker` 昵称的对应关系（记忆条目只有昵称） | 读 `<SC>/state/social-v2.json` 的 `recentMessages[].sender`，或 `qq_get_group_members` 历史导出，与 `memory-card-full.jsonl` 的 `speaker` 对齐后补 `about` |
| A-4 | `personas/da-fei-yu.md` 换 id 后历史会话是否仍可续（旧会话被绑在旧 preset 上） | 切换后看侧栏「Aurabot · QQ」是否新建会话；旧会话成为普通 DSH 会话（预期行为） |
| A-5 | 面板「导入旧档案」在 web 版是否完整可见（AU:449 U8） | 装好后逐页点一遍「心情与记忆 → 导入旧档案」 |
| A-6 | `memory-card.json` 的 303 条里，哪些属于「必须保留」（SC:370 #7） | 人工抽样 `memory-card.md`（28 KB / 323 行），与用户确认可丢弃范围（本文按「主人 164 + 群 57 保留、self 81 丢弃」给默认建议） |
