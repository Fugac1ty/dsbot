# DSBot ⇄ Aurabot 能力 / 配置 / 数据 / 接口对照（API 对照文档）

> 配套文档：[AURABOT-MIGRATION.md](AURABOT-MIGRATION.md)（迁移 Runbook）。
> 目标：把线上 QQ 机器人（QQ `2477094441`）从 **DSBot**（插件 + 外置 bridge 进程）切到 **Aurabot `dsh-aurabot-qq@1.1.24`**（单插件 + 插件内 OneBot 客户端）。
> 证据：`docs/work/dsbot-inventory.md`（SC）、`docs/work/aurabot-inventory.md`（AU）、`docs/work/lead-verified-facts.md`（LV）、`docs/work/mapping-matrix.md`（完整版矩阵，含每一行的点击级证据）。
> 判定：`1:1` / `等价异名` / `部分` / `缺失`；动作：`自动可用` / `需重配` / `需人工重做` / `会丢失`；影响：`阻断` / `体验下降` / `无关`。

---

## 0. 先读：这不是「换个插件」，是换了一套对话范式

| | DSBot（现状） | Aurabot（目标） |
| --- | --- | --- |
| 谁决定「发不发/何时发」 | **模型自主**：被唤醒 → 自己决定潜水/收尾/主动搭话 → **必须调 `qq_*` 工具**才真发 | **中枢推送**：收到消息 → 群策略/合并窗口决定回不回 → **模型正文就是发出的消息**（`<inline 标记>` 控制表情/语音/@/引用） |
| 每轮上下文 | 桥接把人格卡、记忆卡、对齐 brief、黑话、未读合并成提示词 | 每个 QQ 会话一个 DSH 会话；人格在系统提示词、记忆按需召回、上下文长期保留 |
| 工具面 | 42 个 MCP 工具（39 个 `mcp__snowluma__*` + 1 个 `snowluma_status` + 2 个 web-search；含已读水位/潜水/收尾/等待等**状态机工具**） | 48 个工具名（45 个模块工具 + 3 个跨会话联动 `aurabot_*`；`qq_*`/`remember`/`bili_*`/…），**没有**状态机工具 |
| 谁管 QQ 连接 | 外置 `bridge.js` 进程（可被插件启停/自愈，控制台 :3100） | 插件内 OneBot 客户端（`gateway=onebot` 只连既有网关，不自愈） |

**结论**：能力对照里约 30/42 个工具「无对应」，其中 12 个属于范式性缺失（已读水位/潜水/收尾/等待、未读查询、分条/引用/拍一拍）；旧 preset 的 17 条工具协议**全部作废且语义相反**。迁移可做，但请把它当「换引擎」而不是「打补丁」。

---

## 1. 能力对照矩阵

> 完整 41 行（含每行 SC/AU 行号证据）在 `docs/work/mapping-matrix.md` §1；下面按「用户能感知」重排。

### 1.1 设置栏目（DSBot 实际 14 个 tab → Aurabot 5 组 20 页）

> 口径：DSBot 的真实 tab 共 14 个（概览/角色/目的/QQ/语音/桌宠/B站/Token额度/观看历史/记忆/对齐/扩展/全部参数/诊断）；**「记忆卡」不是独立 tab**，它在「记忆」页内。下表按能力拆行，故有 15 行。

| # | DSBot 能力（现状态） | Aurabot 对应 | 判定 | 迁移动作 | 影响 |
| --- | --- | --- | --- | --- | --- |
| 1 | 概览：桥接/SnowLuma/DSH 状态、模式、记忆卡比例 | 面板「概览」+ `/aurabot/api/state` | 等价异名 | 自动可用 | 无关 |
| 2 | 角色：角色库、12 槽快照、切换 epoch（在用） | 面板「人格」+ `personas/*.md` + `persona.current`（无快照/回档） | 部分 | 需人工重做 | 体验下降 |
| 3 | 目的：驱力→目标→主动私聊（关） | `purpose` 模块（默认关）+ `speakUp.*` | 部分 | 需重配 | 无关 |
| 4 | QQ：桥接启停、模式切换、白名单、鱼群、收尾、token 闸、发送节奏（在用） | 「连接/聊天/权限」+ `gateway`/`snowluma.*`/`allow.*`/`group.*`/`merge.*` | 部分（无桥接/模式概念） | 需重配 | 体验下降 |
| 5 | 语音：语音包安装/启停、TTS 三路路由（未装） | 「语音」+ `voice.*`（edge-tts/cosyvoice/gptsovits/http + ASR） | 等价异名（Aurabot 更强） | 需重配（需 venv） | 无关 |
| 6 | 桌宠：安装/启停/对话（未装） | `pet` 模块 + `/panel/pet/*` | 部分（Linux 桌面行为不可用） | 需人工重做 | 无关 |
| 7 | B站：扫码登录、待审回复、自动化快照、立即分享（未登录） | 「B站」+ `bili.*`（刷/评/回/点赞/截图） | 部分（无扫码 UI/分享/动态） | 需重配 | 无关 |
| 8 | Token 额度：日用量/花费/80% 提醒/逐轮明细（在用） | **无**（无 cost/budget/tokenGuard） | 缺失 | 会丢失 | 体验下降 |
| 9 | 观看历史（空） | 无独立页；`bili.json` 的 `seen/history` | 部分 | 会丢失（无实损） | 无关 |
| 10 | 记忆：双向脱敏同步、隐私审计、预览（同步关） | `memory` 模块 + `/profiles` `/insights` `/style` | 部分（召回更强，无跨平台管道） | 需人工重做 | 体验下降 |
| 11 | 记忆卡（在「记忆」tab 内）：衰减/遗忘/容量压缩（303 条，在用） | `consolidate()` + 遗忘曲线 + `invalidAt` | 部分（机制等价，触发源是聊天流水） | 需人工重做（数据转换） | 体验下降 |
| 12 | 对齐：QQ⇄B站身份映射（空） | **无** | 缺失 | 会丢失（无实损） | 无关 |
| 13 | 扩展：扩展启停/配置 + 平台注册表（均未启用） | 用户模块 18 内置 + `modules`/`ext`/`safeMode` | 等价异名（API 不同） | 需人工重做（无现存扩展） | 无关 |
| 14 | 全部参数：三份配置原始 JSON 编辑（在用） | 单份 `config.json` + 面板表单（无冲突戳） | 部分 | 需重配 | 无关 |
| 15 | 诊断：体检/日志/备份/组件更新回滚（在用） | 仅 `/logs` `/update/check` `/changelog` | 缺失 | 会丢失 | 体验下降 |

### 1.2 桥接的 19 类「像人」行为（最容易被漏掉）

| # | DSBot 行为（在用？） | Aurabot 对应 | 判定 | 迁移动作 | 影响 |
| --- | --- | --- | --- | --- | --- |
| 1 | 白名单/黑名单（在用） | `allow.private/groups` + `ownerQQ`（**无 deny**） | 部分 | 需重配 | 阻断（必须填对） |
| 2 | 二代仿真 reserved2：文本不发出、必须调工具（在用） | 无对应模式：正文即消息、群策略决定回不回 | 缺失（范式） | 会丢失 | 阻断（行为变化需接受） |
| 3 | 对话收尾判断（在用） | 无收尾概念；用 `[沉默]`/不回 | 缺失 | 会丢失（可用记忆条目补承接） | 体验下降 |
| 4 | Token 防爆破：日唤醒上限/最小间隔/¥8 上限（在用） | 无（`grep tokenGuard/costCNY` 空） | 缺失 | 会丢失 | 体验下降（成本风险） |
| 5 | 早安问候（关） | `speakUp`（仅主人私聊） | 部分 | 需重配 | 无关 |
| 6 | 上线补历史：掉线补消息+水位去重（在用） | 无水位/无补洞（`chatlog` 只本地 14 天） | 缺失 | 会丢失 | 体验下降 |
| 7 | 鱼群保护：同名鱼/连续鱼/占比≥60% 不参与（在用） | `titleFilter`（只滤别的机器人）+ `burstMax` | 缺失 | 会丢失 | 体验下降 |
| 8 | B站定时分享/记忆同步/动态轮询（关） | 无 | 缺失 | 会丢失 | 无关 |
| 9 | 身份对齐注入：群聊前置 brief（空） | 无 | 缺失 | 会丢失 | 无关 |
| 10 | 记忆卡注入（在用） | 每轮 `systemPrompt.context()` 按消息召回 | 等价异名 | 需人工重做（数据转换） | 体验下降 |
| 11 | 人格卡注入（在用） | `{{aurabot_persona}}` + `complete:true` 独占系统提示词 | 等价异名（无字数上限） | 需重配 | 阻断（身份） |
| 12 | 仿真层提示词可控制台读写（在用） | `rulesText()` 代码生成，面板不可改 | 部分 | 需人工重做 | 体验下降 |
| 13 | 自我身份锚点（在用） | 无（只有头像同步） | 缺失 | 会丢失 | 无关 |
| 14 | 身份泄露闸：公开面 QQ 号拦截（在用） | `redact.js` 只抹 token/cookie/key | 缺失 | 会丢失 | 无关（B站未用） |
| 15 | 黑话学习：247 条、管理员确认入库（在用） | 无 | 缺失 | 会丢失（可转文本补） | 体验下降 |
| 16 | 表情包语义：情绪/内容索引 + 匹配分（机制在、库空） | `stickers` 模块：tags/summary + 概率 | 部分 | 需重配 | 体验下降 |
| 17 | 真人式分条：1~3s、≤500 字、8/分钟（在用） | `splitLines`+`bubbleDelay`+`\|\|\|`；上限 5 条、群里 3 条 | 部分 | 自动可用（不可配） | 体验下降 |
| 18 | 主人特权审计 / token 账本（在用） | 无（只有 logs） | 缺失 | 会丢失 | 体验下降 |
| 19 | 目的机制：素材→驱力→目标→回执（关） | `purpose` 模块（默认关） | 部分 | 需重配 | 无关 |

### 1.3 对外接口面

| DSBot | Aurabot | 判定 | 影响 |
| --- | --- | --- | --- |
| 插件 HTTP 24 入口 + 4 子路由族 + `/health` | `/aurabot/api/*` 74 条（形状全不同） | 部分 | 体验下降（外部脚本断） |
| MCP 42 工具（39+1+2） | 48 个工具名（语义不同，见 §4.1） | 部分 | 阻断（preset/prompt 作废） |
| 桥接控制台约 140 个 `/api/*` 字面量（精确 `pathname` 去重 131；含 45 个 `/api/socialV2/*`） | **无对外 HTTP**（行为内化在 hub/reply/client） | 缺失 | 无关（无外部脚本依赖则无感） |
| CLI `tools/bili.mjs` 46 子命令 + 159 个脚本 | 无 CLI | 缺失 | 无关（B站未用） |
| preset `qq-chat` / `qq-chat-v2` | `aurabot-private` / `-private-long` / `-social` | 等价异名 | 阻断（旧提示词全废） |
| `qq-mode` settings 命名空间（5 种 mode） | 无（`ownerLevel` 3 档 + 策略） | 缺失 | 无关 |
| 扩展平台 + `PlatformAdapter` | 用户模块 API v1（10 个可改写 hook + 7 个只读事件） | 缺失（API 不兼容） | 无关（无现存扩展） |

---

## 2. 配置字段级对照

### 2.1 DSBot 合体配置（`$DSH_HOME/dsbot/config.json`）→ Aurabot

| DSBot 键（现值） | Aurabot 键 / 页面 | 判定 | 动作/建议 |
| --- | --- | --- | --- |
| `qqbotRoot`、`bridge.autoStart/consoleBase=3100` | 无（无外置桥） | 无 | 忽略 |
| `persona.file`（空）/`compactChars=2200` | `persona.current` | 部分 | 新建 `da-fei-yu` 并设为当前（见 §3.2） |
| `admin.qq=1362431704` | `ownerQQ` | 1:1 | **必填** |
| `admin.displayName=主人`、`gentle` | `ownerName='主人'` | 部分 | 填 |
| `memory.qqToBili.*`（关） | 无 | 无 | 忽略 |
| `memory.privacy.*`（全开） | 无（出站只有 `redact` 抹密钥） | 无 | 改用**人格文字约束**+权限档 |
| `alignment.*`（空） | 无 | 无 | 忽略 |
| `memoryCard.*`（303 条/衰减） | `memory.enabled/recallCount=6/dailyConsolidate/consolidateTimes` | 部分 | 开 `memory.enabled`；整理时段按需 |
| `extensions.enabled` | `modules{}`/`safeMode=false` | 等价异名 | 保持默认 |
| `platforms.enabled=[qq,bili]` | 模块开关（`bili.enabled` 等） | 部分 | 本期都保持关 |
| `updates.enabled`（每 6h 查 GitHub） | 无自动更新（面板 `/update/check`） | 缺失 | 手工：再跑 `dsh plugin add` + 重启 |
| `ui.*` | `tabs{}` | 部分 | 忽略 |

### 2.2 DSBot 桥接配置（`<SC>/config.json`）→ Aurabot（逐键要点）

| DSBot 键（现值） | Aurabot 键 | 判定 | 动作/建议 |
| --- | --- | --- | --- |
| `dsh.baseUrl=…:3102` | 无（插件在 DSH 内） | 无 | 忽略 |
| `dsh.provider/model/reasoningEffort`（`deepseek-official`/`deepseek-flash`/`high`） | `model.provider/model/reasoningEffort`（+`chatModels.*`） | 1:1 | **必填** |
| `snowluma.httpUrl=http://127.0.0.1:3000` | `snowluma.httpUrl` | 1:1 | **必填** |
| `snowluma.wsUrl=ws://127.0.0.1:3001` | `snowluma.wsUrl` | 1:1 | **必填** |
| `snowluma.accessToken`（单值） | `snowluma.httpToken` + `snowluma.wsToken`（两个独立） | 部分（要拆） | 从 `onebot_2477094441.json` 的 HTTP/WS 各自 `accessToken` 取 |
| `snowluma.followDiscoveredEndpoint/allowLaunch` | 无（onebot 模式只连填的地址） | 无 | `gateway="onebot"` |
| `allow.private=["1362431704"]` / `allow.groups=["694991842"]` | `allow.private/groups` | 1:1 | **必填原值** |
| `deny.*`（全空）/`allowAllWhenEmpty=false` | 无 deny；空=只回主人 | 缺失/等价 | 无实损；需要时用 `titleFilter` |
| `agentPreset=qq-chat` / `socialV2.agentPreset=qq-chat-v2` | 无（权限档自动选 3 个 preset） | 缺失 | 忽略 |
| `sessionCwd` | `workspaceDir`（空=`~/Aurabot/qq-chats`） | 部分 | 建议填绝对路径 |
| `role.maxInjectChars=6000` | 无上限 | 缺失 | 人格 <4000 字即无实损 |
| `social.*`（触发概率/必须回复词/burst…） | `group.*`（wakeWords/interjectChance/cooldownSec/maxPerHour/quietHours/minRelevance/burstMax）+ `merge.*` | 部分 | 按 §2.4 建议值 |
| `socialV2.enabled=true` | `enabled=false`+`dryRun=true` | 等价异名 | 先开 `enabled`、留 `dryRun` 验收 |
| `socialV2.tools.*`（31 布尔） | 无（模块开关+`profilePerms`） | 缺失 | 用 `modules{}` 关模块近似 |
| `socialV2.wake.*`（潜水/唤醒预算） | 无 | 缺失 | 无替代（范式不同） |
| `socialV2.closure.*` / `socialV2.wait.*` | 无 | 缺失 | 无替代 |
| `socialV2.history.*`（上线补历史） | 无 | 缺失 | 无替代 |
| `socialV2.tokenGuard.*`（20/10/¥8） | 无 | 缺失 | 无替代（成本靠模型/群限流） |
| `socialV2.send.*`（分条 1~3s、≤500 字、8/min） | 无配额；分条上限硬编码 | 部分 | 接受（见 §1.2-17） |
| `socialV2.sticker.*` | `stickers.*` | 部分 | 开 `stickers.enabled`；`caption=true` |
| `socialV2.voice.*`（关） | `voice.*` | 部分 | 保持关或装 venv 后开 |
| `fishGuard.*`（QQ 鱼群） | 无 | 缺失 | 无替代 |
| `slang.*`（247 条） | 无 | 缺失 | §3.4 替代 |
| `purpose/greetings/proactive`（全 false） | `ext.purpose.*` / `speakUp.*` | 部分 | 需要时开 speakUp |
| `biliBridge.*`（全 false） | 无（B站模块无分享） | 缺失 | 忽略 |
| `consolePort/Token=3100` | 无 | 缺失 | 忽略（端口释放） |
| `httpGuard.trustedProxyHosts` | 无（由 DSH/Caddy 管） | 缺失 | 忽略 |
| `webSearch.*`（MCP 联网搜索） | 无（DSH 内置 `tool-web`，仅私聊 preset 挂） | 缺失 | **群聊无联网搜索**（§6） |
| `pricing.models.*` | 无 | 缺失 | 忽略 |

### 2.3 DSBot B站配置（`$DSH_HOME/dsbot/bili.config.json`）→ Aurabot（B站本期不迁）

| DSBot 键 | Aurabot | 动作 |
| --- | --- | --- |
| `self/owner` mid/name（空=未登录） | `bili.sessdata/biliJct/cookie` | 二期重新登录 |
| `night.windows/skipChance` | 无 | 忽略（无生物钟） |
| `preferences.like/dislike` | `bili.keywords[]` | 手工挑关键词 |
| `quota.shareDaily`、`share.*`、`dynamics.kinds` | 无 | 忽略（无分享/动态） |
| `limits.*` | `bili.maxRunsPerDay/maxCommentsPerDay/maxRepliesPerDay` | 按需调 |
| `diary.push` / `listen.comment` | `bili.autoBrowse/reply`（部分） | 忽略 |
| `fishGuard`（B站评论区版） | 无 | 忽略 |
| `notify.type=none` | 无 | 忽略 |

### 2.4 迁移必须人工填的 16 项（上线前逐项打勾）

| # | 键 | 值 | 备注 |
| --- | --- | --- | --- |
| 1 | `botQQ` | `2477094441` | 连上后 `get_login_info` 必须相等，否则不自动重连 |
| 2 | `ownerQQ` | `1362431704` | 决定权限档 full |
| 3 | `gateway` | `"onebot"` | 不管理 SnowLuma 进程 |
| 4 | `snowluma.httpUrl` | `http://127.0.0.1:3000` | |
| 5 | `snowluma.wsUrl` | `ws://127.0.0.1:3001` | |
| 6 | `snowluma.httpToken` / `wsToken` | SnowLuma 两个 `accessToken`（***） | Bearer / `?access_token=` |
| 7 | `allow.private` | `["1362431704"]` | 原值搬 |
| 8 | `allow.groups` | `["694991842"]` | 原值搬 |
| 9 | `model.provider/model/reasoningEffort` | `deepseek-official` / `deepseek-flash` / `high` | 原值搬 |
| 10 | `ownerLevel` / `longTasks` | `full` / `false` | 决定 preset |
| 11 | `enabled` / `dryRun` | `true` / `true` → 验收后 `dryRun=false` | 安全默认 |
| 12 | `persona.current` | `da-fei-yu`（新 id，推荐）或改 `dafeiyu` | §3.2 |
| 13 | `group.wakeWords` | `['大肥鱼','肥鱼']` | 可并入旧 `mustReplyKeywords`（deepseek/小鲸鱼/大肥鱼/鲸鱼/在吗） |
| 14 | `group.quietHours` | `[1,8]` | 与旧夜间静默对齐（按现网作息调） |
| 15 | `workspaceDir` | 空 或 `/home/ubuntu/Aurabot/qq-chats` | |
| 16 | `bili/douyin/heybox/imageGen/song.enabled` | 全 `false` | 本期不迁 |

> 反向新增（Aurabot 有、DSBot 无）需要决策：`profilePerms.*`（改资料/好友申请/白名单/抖音/小黑盒三档权限）、`titleFilter.*`（防机器人互聊）、`group.overrides{}`（单群策略）、`chatModels.*`（按聊天选模型）。

---

## 3. 数据资产对照与迁移

### 3.1 总表（只搬「人格 + 记忆 + 关系语感」，运行态全部重建）

| 资产（现路径/体量） | Aurabot 目标 | 能直搬 | 迁移方式 | 校验 |
| --- | --- | --- | --- | --- |
| 当前人格卡 `characters/da-fei-yu/persona.md`（3880 B） | `plugins-data/aurabot/personas/da-fei-yu.md` | ✅ | copy | 面板人格列表字数≈3880；`diff` 一致 |
| 其他角色 `characters/char-*`、`tie-ba-lao-ge`（2.6 MB） | 每角色一个 `personas/<id>.md` | ⚠️ 部分 | 仅当前角色必须；其余按需 copy | 面板逐个可读 |
| 人格素材库 `dsbot/roles/`（99）/`roles-full/`（27） | 同上 | ✅ | 按需 copy | 抽查 3 个 |
| 衰减记忆卡 `characters/da-fei-yu/memory/memory-card.json`（303 条） | `plugins-data/aurabot/memories.json` | ❌ 格式不同 | **转换脚本**（字段映射 §3.3），不走面板导入 | 条数一致 + 抽查召回 |
| 全量卡 `memory-card-full.jsonl`（303 行/248 KB） | 同上 | ❌ | 同上（**优先用这份做转换源**，字段最全） | 同上 |
| 记忆注入块 `memory-card-prompt-qq.md`（1150 字） | 无（动态召回，不需静态块） | — | 不搬 | — |
| 记忆 inbox `memory-inbox.jsonl`（112 KB） | 可并入转换源 | ❌ | 可选 | — |
| 记忆卡快照 `characters/da-fei-yu/snapshots/`（1.5 MB） | 无快照机制 | ❌ | **不可搬**；先 tar 归档当回滚点 | `tar -tzf` |
| 目的状态 `purpose-outreach.json`（661 B） | `purpose/purpose-state.json`（结构不同） | ❌ | 不可搬（功能默认关） | — |
| `social-v2.json`（77 KB）记忆类字段 | `memories.json` + 人格 | ⚠️ 部分 | 转换（§3.5） | 见 §3.5 |
| 黑话库 `state/slang.json`（247 条/129 KB） | 无对应 | ❌ | 转人格段落/记忆（§3.4） | 群里抽查 5 个词 |
| 表情库 `state/stickers.json`（0 条） | `stickers/index.json`+图片 | ❌（空） | 面板「从 QQ 导入」 | 数量=QQ 收藏 |
| B站凭据 `bili/*`（不存在） | `bili.cookie` | ❌ | 二期重新登录 | `bili.state` 已登录 |
| B站配置 `bili.config.json`（3 KB） | `bili.*` | ⚠️ 部分 | 面板手工（§2.3） | 抽查 |
| 观看历史（空） | `bili.json` seen/history | ❌（空） | 有则转数组 | 行数 |
| Token 账本 `token-usage-*`/`token-usage.jsonl`/`tool-calls.jsonl` | 无 | ❌ | **不可搬**，仅留档 | — |
| 会话映射 `state/sessions.json`（322 B） | `sessions.json`（新格式） | ❌ | **不搬**：绑定旧 DSH sessionId，首条消息自动重建 | 首条消息后生成新 sessionId |
| 桥接杂项 `mode.json`/`self-identity.json`/`greetings.json`/`alignment-brief.md` | 无 | ❌ | 不可搬（≤5 KB 留档；文案可并入人格） | — |
| 跨平台记忆管道 `qq-public-feed.jsonl`、`memory/*-for-*.md` | 无 | ❌ | 不搬（近空） | — |
| 备份 `backups/`（284 条/24 MB） | 无备份机制 | ❌ | 只留最近 2~3 份归档 | — |
| DSH 会话 `$DSH_HOME/sessions/`（14 MB） | 无 | ❌ | 不搬（旧会话侧栏仍可读） | — |
| 桌宠/语音数据/日志 | Aurabot 自有 `modules-data/pet/`、`logs/` | ❌ | 不搬（自动生成） | — |

> **易搬错点**：`$DSH_HOME/dsbot/memory/memory-card*.json` 是**旧扁平布局残留**（764 B，10-30 的旧版本）；**live 记忆卡在 `characters/da-fei-yu/memory/`（303 条）**。别搬错那份。

### 3.2 人格卡专项（可直搬，但要改 id）

- 线上 `persona.md` 与 `dsbot/roles/原装-大肥鱼.md` **逐字节相同**（3880 B），正文**不含任何工具名/接口引用**（`grep qq_/mcp__/token` 无命中）→ 可直接作为 Aurabot 人格正文。
- Aurabot 的 `personas/*.md` 只放「角色正文」，输出协议由 `rulesText()` 代码注入（一句一行/`|||`/`<voice>`/`<sticker:>`/`<at:QQ号>`/`<poke>`/`[沉默]`）。**不要把自带 `dafeiyu.md` 整份覆盖就以为搬完**——自带卡里的「一次只说一句话、想说的多就拆条发」是人格层语感（`personas/dafeiyu.md`），覆盖会丢细节。
- 两种落地：
  - **A（推荐）**：新建 `personas/da-fei-yu.md` = DSBot 正文，面板「设为当前」→ `persona.current="da-fei-yu"`；自带 `dafeiyu.md` 留着参考。多一步配置、可回退。
  - **B（最省事）**：用 DSBot 正文覆盖 `personas/dafeiyu.md`，不动 `persona.current`。零配置改动，但丢失自带卡语感、无单人回退。
- 迁移前先 `tar` 归档 `characters/`（Aurabot 无快照/回档）。

### 3.3 记忆卡 303 条 → `memories.json` 字段映射

Aurabot item 形状：`{id,text,about,aboutName,tags,importance,source,chatId,at,hits,invalidAt?}`。硬约束：`text` **截断 200 字**、`tags` 最多 5 条、库上限 3000 条、`add()` 按相似度 ≥0.6 去重。

| DSBot 字段（真实取值） | Aurabot 字段 | 规则 |
| --- | --- | --- |
| `text`（303 条，均长 12.7 字，最长 254，仅 1 条 >200） | `text` | 直拷；超 200 那条劈成两条 |
| `speaker`（主人 165 / 大肥鱼 81 / 2円 33 / 自动骗 13…） | `aboutName` | 直拷 |
| 无 QQ 号字段 | `about` | 主人 → `1362431704`；群友需人工补（无可信来源，留空则少「关于此人」加权） |
| `importance`（0~100） | `importance`（0~1） | `÷100`；`pinned`/`anchor` 两三条拉到 ≥0.9 |
| `kind`（owner 164 / event 133 / promise 4 / firstMeet 1 / conflict 1） | `tags` | 第一个 tag 保留原 kind，再补 1~3 个话题词 |
| `createdAt`（ISO） | `at`（毫秒） | `Date.parse()` |
| `source`（qq-owner/qq-self/qq-group） | `source` | 统一 `"import"` |
| `isSelf=true`（81 条，她自己说过的话） | — | **建议丢弃**（导入规则明确「不记她自己的人设」，保留会污染召回）；若要留，`importance≤0.3`+`tags:['旧事']` |
| `recallCount/decaySteps/clarity/emotional/conversationKey/botReply` | — | 无对应；可选把 `clarity` 拼进 tag |
| `id`（`mem_*`） | `id` | 重新生成 8 位短 id |

**两条路线，二选一（推荐 ①）**：

1. **直接写 `memories.json`（推荐）**：303 条一次到位、不去重、不烧 token、可 diff。做法：停 Aurabot（`enabled=false`）→ 写文件（UTF-8 无 BOM、原子写）→ 起插件 → 面板「心情与记忆」看条数。写前先 `JSON.parse` 自检。
2. **面板「导入旧档案」**：`POST /aurabot/api/memory/import`（文本 ≤30000 字，内部再切 6×5000 字，**每次最多 80 条候选**）→ `/import/commit` 勾选入库。适合「只留最重要的 80 条」，303 条要分 4 次且每次烧一次模型调用。

### 3.4 黑话库 247 条 → 无对应机制的替代

Aurabot 全仓无黑话/梗库（`grep -rl "slang|黑话" src/` 空）。三选一：

| 方案 | 做法 | 成本 | 效果 |
| --- | --- | --- | --- |
| **A（推荐）** | 取高频 30~50 条压缩成「群梗速查」段落追加到 `personas/da-fei-yu.md` 末尾（每条 ≤30 字） | 纯文本 | 100% 常驻、稳定；占系统提示词 token |
| B | 247 条全转 `memories.json` 条目（`tags:['黑话']`，`importance 0.6~0.8`） | 转换脚本 | 靠召回，命中不稳定，容量无限 |
| C | 写用户模块挂 `prompt` hook 动态注入 | 需写代码 | 最接近原体验，超出本期 |

> 原始 `slang.json` 必须归档（Aurabot 侧无落盘位置）。
>
> 记忆导入时机建议：转换脚本可**离线预做**（不依赖 QQ 在线）；导入与召回验收放在「阶段 D」（上线后第 1 周），避免阻塞首发。

### 3.5 `social-v2.json` 记忆类字段 → Aurabot 记忆条目

| DSBot 字段（实测） | 内容 | Aurabot 落点 |
| --- | --- | --- |
| `conversations["private:1362431704"].activeTopics[0]` | `{text:"主人11月4日之前要交作业，需要提醒他", pendingQuestion:"11.3晚上提醒主人交作业"}` | 2 条记忆：`text` 原文、`aboutName:"主人"`、`about:"1362431704"`、`importance:0.9`、`tags:["约定","提醒"]` |
| `conversations[*].closure`（私聊 + 群各一份） | `summary`/`nextOpening`（上次聊到哪、下次怎么接） | 私聊 2 条 + 群 2 条（共 4 条；`tags:["收尾","上次聊到"]`、`importance:0.7`）；**「下次开场」在 Aurabot 无注入点**，只能靠召回自然命中 |
| `memberImpressions/activeTopics`（群） | 空 | 无 |
| `wakeConfig/unread/lastReadThroughSeq/agentToken/recentMessages` | 运行态 | **不搬**（无对应结构） |

---

## 4. 接口对照

### 4.1 MCP 工具：42 → Aurabot 48 个工具名（45 模块 + 3 联动；同名也不同义）

> **最关键警告**：DSBot preset 提示词**逐条点名工具名**（`presets/qq-chat-v2.patch.yml` 的 17 条协议，含 `mcp__snowluma__qq_send_message`/`qq_wait_for_messages`/`qq_mark_read`/`qq_close_conversation`/`qq_set_wake_config` 等），且要求把「会话令牌」作为参数传入。换插件后**整套协议作废**，且语义**相反**（旧：文本不发出、必须调工具；新：正文就是发出的消息）。

| DSBot 工具 | Aurabot 对应 | 判定/说明 |
| --- | --- | --- |
| `qq_status` `qq_get_prompt` `qq_social_state` `qq_get_self_image` | 无 | 缺失（状态在面板/`/api/state`） |
| `qq_list_groups` `qq_get_group_members` `qq_get_active_members` | 无工具（内部有成员缓存，模型不可见） | 缺失 |
| `qq_get_group_history` | `qq_chat_history` | 部分（仅当前会话、≤50 条） |
| `qq_get_unread_messages` `qq_get_recent_messages` `qq_get_my_recent_messages` | 无 | 缺失（消息由中枢合并注入，模型不能主动查） |
| `qq_get_message_detail` | 无 | 缺失 |
| `qq_get_message_images` | 无工具 | 等价异名（图/表情自动进上下文） |
| `qq_get_forward_msg` | 无工具 | 等价异名（合并转发自动展开） |
| `qq_send_message` | `qq_send_message` | **同名不同义**（Aurabot 只在主人私聊挂、用于发到**别的**会话；当前会话回复=正文） |
| `qq_send_burst` `qq_send_group_message` `qq_send_private_message` | 无 | 缺失（`\|\|\|` 内联分条替代） |
| `qq_reply` / `qq_send_poke` | 无 | 缺失（`<reply:N>` / `<poke>` 内联标记替代） |
| `qq_send_sticker` | `qq_send_sticker` | 部分（另有 `<sticker:标签>`） |
| `qq_send_voice` | 无 | 缺失（`<voice>` 标记 + `voice.autoChance`） |
| `qq_mark_read` `qq_close_conversation` `qq_set_wake_config` `qq_wait_for_messages` | 无 | **缺失（范式性）**：Aurabot 无已读水位/潜水/收尾/等待概念 |
| `qq_report_feedback` | 无 | 缺失 |
| `qq_list_stickers` / `qq_collect_sticker` | 同名 | 部分（Aurabot 另有 `qq_add_sticker`/`qq_save_sticker`/`qq_import_qq_stickers`/`qq_edit_sticker`） |
| `qq_get_sticker_image` `qq_sticker_note` `qq_set_sticker_remark` | 无（`qq_edit_sticker` 近似） | 缺失（旧 `setStickerRemark` 也默认关） |
| `qq_list_voices` | 无 | 缺失 |
| `qq_memory_query/append/remove/clear` | `recall_memory` / `remember` | 部分（只能记，不能删/清；删除在面板） |
| `qq_slang_query` / `qq_slang_submit` | 无 | 缺失（§3.4） |
| `snowluma_status`（host 1） | 无 | 缺失（onebot 模式不探 SnowLuma） |
| `web_search` / `web_fetch`（2） | 主人私聊 = DSH `tool-web`；**群里没有** | **缺失（群聊）**：social preset 不挂 tool-web，群友让她联网查东西会做不到 |

> Aurabot 另有 DSBot 没有的模块工具，例如：`qq_group_admin`、`qq_draw_image`、`qq_send_qzone`、`qq_send_file`、`bili_*`(6)、`douyin_*`(7)、`heybox_*`(9)、`qq_get_profile`/`qq_set_*`/`qq_handle_friend_request`/`qq_whitelist` 等（`weather_now` 只在模块 API 文档示例里，源码未实现）。

### 4.2 插件 HTTP 路由对照

| DSBot 路由族 | Aurabot 对应 | 判定 |
| --- | --- | --- |
| `/overview` `/health` | `/api/state` | 等价异名 |
| `/config`（三份配置、409 冲突） | `/save`（单份）+ 面板表单 | 部分（无版本戳） |
| `/characters` `/persona` | `/personas` `/persona/{get,save,delete,use,polish}` | 部分（无快照/导入导出） |
| `/memory` `/memory-card` `/memory-card/full` | `/memories` `/memory/{add,update,delete,recalls,restore,import,import/commit,extract}` `/profiles*` `/insights*` `/style/save` | 部分（无同步/隐私审计/全量卡） |
| `/mode`（qq-mode 命名空间） | 无 | 缺失 |
| `/bridge`（start/stop/restart/call） | `/onebot/reconnect` `/onebot/test` `/test-send` | 部分（无外置进程） |
| `/diagnostics` `/logs` `/updates` | `/logs` `/update/check` `/changelog` | 部分（无体检/备份/回滚） |
| `/token-budget` `/owner-audit` `/privacy/explain` `/watch-history` `/preferences/scan` `/fish-guard/qq` | 无 | 缺失（6 类整页无对应） |
| `/bili/*`（扫码/待审/自动化/分享） | `/bili/{state,account,run,replies,shots,shot/image,shot/delete}` | 部分（无扫码/分享） |
| `/voice/*`（代理桥接） | `/voice/{song-voices,test,install,asr-status,asr-prepare,asr-last,asr-test}` | 部分 |
| `/pet/*`（11 条）+ `/pet-api/*`（12 条，`x-pet-token`） | `/panel/pet/*`（14 条）+ pet 模块 26 条 | 部分（契约不同，桌宠本体要换） |
| `/extensions` `/platforms` | `/modules` `/modules/{reload,create,fork,prompt,open,simulate,tools,tool,panel}` | 等价异名 |
| `/dsh-dsbot/ext/<id>/<path>` | `/aurabot/api/ext/<id>/<path>` | 等价异名 |
| `/updates`（组件更新/回滚） | 无 | 缺失 |

> 鉴权差异：DSBot 显式 `connection.requestRejection`（无 Cookie 实测 401）；Aurabot 的 handler 内未见鉴权代码，是否受 DSH 外层保护**未确认**（附录 A-2）。

### 4.3 桥接控制台约 140 个 `/api/*` 字面量 → 无对外 HTTP

| DSBot | Aurabot 实现位置 | 对外可见性 |
| --- | --- | --- |
| `/api/socialV2/*`（45 个：state/config/prompt/send-*/wake/mark-read/close/history-catchup/memory-*/slang-*/sticker-*） | `src/chat/hub.js`、`src/chat/reply.js`、`src/chat/group-policy.js`、`src/onebot/client.js` 内部函数 | **不暴露**：行为内化，无 REST 等价物 |
| `/api/status` `/api/sessions` `/api/restart` `/api/preset/sim-prompt` | `/api/state` `/sessions/reset` `/save` | 部分 |
| `/api/voice/packs/*`、`/api/tokens/*`、`/api/authorize/read` | 无（语音安装走 `/voice/install`；账本/授权无） | 缺失 |

### 4.4 CLI / 脚本

- DSBot：`tools/bili.mjs` 46 子命令、`scripts/` 159 个（运维常用 9 个）、插件内 36 个测试脚本（`scripts/` 共 42 个文件：36 个 `test-*.mjs` + 6 个 `ui-*.mjs`）。
- Aurabot：**零 CLI**，全部经面板或 `/aurabot/api/*`；唯一带独立脚本的是贴吧扩展。

### 4.5 preset 对照

| 维度 | DSBot `qq-chat` / `qq-chat-v2` | Aurabot `aurabot-private` / `-private-long` / `-social` |
| --- | --- | --- |
| 系统提示词 | persona 前缀 + 17 条工具协议 + 场景规则 | persona 变量 + `rulesText`（内联标记协议）+ `complete:true`（人格独占） |
| 工具面 | 39 `mcp__snowluma__*` + web-search 2 + ask-user + todo + 守卫 | 模块工具（45 + 3 联动）；private 另加 bash/fs/fs-search/web；private-long 加 jobs/schedule；**social 无任何本地工具、无 web** |
| 守卫 | `qq-tool-restrict.mjs`（注册期隐藏 + 运行期白名单） | 无同名守卫；preset 只挂必要插件 + 模块按权限档注册 |
| 选择 | `qq-mode` 命名空间 + `socialV2.agentPreset` | 权限档自动选 |
| 会话 | 单 agent + 桥接注入 | 每 QQ 会话一个 DSH 会话（侧栏「Aurabot · QQ」） |

### 4.6 `qq-mode` 命名空间

DSBot 用 loader entry `qq-mode` 的 Config 推导 settings 命名空间：`mode ∈ {chat, closed-agent, reserved, reserved2, simulation}`（默认 `reserved2`）+ `ownerQQ`，桥接读写。Aurabot 无 settings 命名空间，等价信息分散在 `ownerLevel` / `allow.*` / `group.*` / `enabled`/`dryRun`。**外部读写该命名空间的脚本/文档全部失效。**

### 4.7 模块 hooks / 扩展平台

| DSBot | Aurabot |
| --- | --- |
| `extensions/<id>/{manifest.json,index.js}`，默认关；宿主 API = config/dataDir/paths/platforms/记忆/桥接控制/B站工具链/事件总线/自定义路由 | `modules/<id>/index.mjs`，`export default {id,name,version,api,setup,settings,panel,tab,defaults}`；hooks：`message`/`poke`/`reply`/`group/decide`/`prompt`/`reply/items`/`send`/`model`/`persona`/`rules` 共 10 个可改写 + 7 个只读事件 |
| `PlatformAdapter` + 内置 qq/bili + tieba planned | 无平台抽象，每平台一个模块 |
| 现有 `sts2`/`bili-live` 未启用 | 内置 18 模块 + 贴吧扩展 |
| **API 完全不兼容**，扩展要重写；因现有扩展都未启用 → 无实损 | |

### 4.8 外部脚本/自动化会断的地方（逐条）

1. 任何 `curl http://127.0.0.1:3102/dsh-dsbot/api/*`（带/不带 Cookie 都变 404）。
2. 桥接控制台 `127.0.0.1:3100` 全部 `/api/*`（含 `x-console-token` 调用方）——**端口直接消失**。
3. `pet-api` 契约（`<STATE>/pet/host.json` 的 baseUrl+token）——桌宠本体要换 Aurabot 客户端。
4. `tools/bili.mjs` 全部子命令 + `scripts/{setup-dsh,sync-dsh-port,scan-dsh-tool-names,check-onebot-status,bili-memory-sync}.mjs`。
5. 任何读写 `qq-mode` settings 命名空间的脚本。
6. 黑话确认流（`/api/slang/*`）与 token 用量报表（`/api/tokens/*`）。
7. systemd `dsbot-bridge.service` 的日志/ExecStart 监控（`logs-dsbot-bridge.log` 不再增长）。
8. 依赖 `mcp__snowluma__*` 工具名的 prompt/评测集/审计脚本。

---

## 5. 缺口与永久丢失

### 5.1 缺口 22 条（按影响）

| # | 缺口（DSBot 有 / Aurabot 无） | 等级 | Aurabot 近似替代 | 建议 |
| --- | --- | --- | --- | --- |
| 1 | Token 额度/峰谷计价/80-100% 闸门/日花费 ¥8 | **已部分补回** | 已移植为 `token-budget` 用户模块：按天统计 QQ/其他分类 tokens 与人民币花费（峰谷分时、四桶计价），可设每日额度、80% 预警、超额度暂停回消息；见 [TOKEN-BUDGET-MODULE.md](TOKEN-BUDGET-MODULE.md) | 额度/统计已可用；DSBot 的「停唤醒」语义不可复制（改为不回消息） |
| 2 | 模型自主唤醒/潜水/已读水位/收尾/等待 | **阻断（行为）** | 推送式：群策略决定回不回、`[沉默]`、`merge.*` 合并 | **用户书面接受行为模型变化** |
| 3 | B站生物钟/养鱼/观看历史/口味/定时分享/四类动态 | 无关（当前未登录） | `bili` 模块（刷/评/回/赞/截图） | 接受；要用单独做子方案 |
| 4 | 记忆卡衰减压缩（自动衰减+全量卡） | 体验下降 | `consolidate()` + 遗忘曲线 + `invalidAt` | 接受（机制等价，历史不衰减） |
| 5 | 角色包/12 槽快照/回档/epoch | 体验下降 | 面板人格 CRUD + 手工 tar | 接受，迁移前归档 |
| 6 | 语音包安装/健康检查/TTS 三路路由/云端凭据 | 无关（当前关） | `voice.*`（edge-tts/本地/ASR） | 接受（能力接近） |
| 7 | 桌宠 host API（12 条） | 无关 | pet 模块 26 条路由 + 新契约 | 接受（本机无桌面） |
| 8 | 备份/诊断/组件更新回滚 | 体验下降 | 仅 `/logs` `/update/check` | 接受，改手工 |
| 9 | 扩展平台（manifest + 宿主 API） | 无关 | 用户模块 API v1 | 接受（无现存扩展） |
| 10 | SnowLuma 安装检测/token 自愈/桥接自愈 | 体验下降 | 断线退避 2s→30s + `/onebot/reconnect` | 接受：掉线需人工介入 |
| 11 | `qq-mode` 命名空间 + 5 模式 | 无关 | `ownerLevel` 3 档 + 策略 | 接受 |
| 12 | 上线补历史（补洞+水位） | 体验下降 | 无（`qq_chat_history` 只能模型主动翻 ≤50） | 接受：重启后可能漏掉掉线消息 |
| 13 | 对话收尾（summary/nextOpening 承接） | 体验下降 | 无；把 summary 转成记忆条目人工承接 | 用记忆条目补 |
| 14 | 鱼群保护（QQ 群） | 体验下降 | `titleFilter` + `burstMax` | 接受，靠 `group.minRelevance`/冷却 |
| 15 | 群聊生物钟 | **无关**（仅 chat 模式生效，当前 reserved2 未启用） | `group.quietHours` | 接受 |
| 16 | 早安问候 | 无关（关） | `speakUp.*`（仅主人私聊） | 需要时开 |
| 17 | 黑话学习（247 条+确认闭环） | 体验下降 | §3.4 三方案 | 用替代，放弃自动学习 |
| 18 | 身份对齐/自我身份锚点/身份泄露闸 | 无关（空/B站未用） | 无（redact 只管密钥） | 接受；将来做 B站 要重做泄露闸 |
| 19 | 主人特权审计/token 账本 | 体验下降 | 无（只有 logs） | 接受 |
| 20 | 真人式分条（1~3s、≤500 字、8/min） | 体验下降 | `splitLines`+`bubbleDelay`（≈9 字/秒）；上限 5 条、群 3 条 | 接受（更不容易刷屏） |
| 21 | 全局试运行（DSBot 没有） | 无关 | Aurabot `dryRun=true` 默认 | **反向增强** |
| 22 | MCP 42 工具面（39+1+2） | **阻断（prompt 层）** | 48 个工具名（§4.1） | **必须重做提示词/评测集** |

### 5.2 永久丢失（迁移后不可恢复）—— 两文档统一口径

> 本节是「永久丢失」的唯一权威清单；[AURABOT-MIGRATION.md](AURABOT-MIGRATION.md) §10 只做摘要并引用本节。

**能力型永久丢失（Aurabot 侧没有任何载体）**

| # | 能力 | 为什么不可恢复 |
| --- | --- | --- |
| 1 | 12 槽角色快照 / epoch 回档 / 存档机制 | Aurabot 人格只有 md 文件 + CRUD，没有快照/回档概念 |
| 2 | Token 逐轮账本 / 花费报表 / 真实额度闸门（80%/100% 停唤醒、¥8 日上限） | **已部分补回**：`token-budget` 用户模块提供按天统计、峰谷计价、额度与超限闸门（[TOKEN-BUDGET-MODULE.md](TOKEN-BUDGET-MODULE.md)）；DSBot 的「停唤醒」语义不可复制 |
| 3 | B站生物钟 / 养鱼 / 观看历史 / 口味资料 / 四类定时动态 / 定时分享 | Aurabot 的 bili 模块是「刷/评/回/赞/截图」，没有生物钟与动态/分享 |
| 4 | 语音包管理器（打包/激活/音量规则/云端凭据路由） | Aurabot 只有 TTS 引擎路由，没有语音包资产生命周期 |
| 5 | 桌宠 host API 契约（12 条 `x-pet-token` 接口） | Aurabot 用自己 26 条 pet 模块路由 + 新契约，旧桌宠本体不兼容 |
| 6 | 备份/体检/诊断/组件更新回滚 | Aurabot 只有日志与更新检查 |
| 7 | 扩展平台 + `PlatformAdapter`（含 `sts2`/`bili-live` 预留位） | 模块 API 完全不同，扩展需重写 |
| 8 | SnowLuma 安装检测 / token 自愈 / 桥接自愈 | Aurabot 不做进程管理，只有 2s→30s 断线退避 |
| 9 | `qq-mode` 命名空间（5 种模式切换） | Aurabot 无 settings 命名空间 |
| 10 | 主人特权审计流水（`owner-audit.jsonl`） | Aurabot 无审计写路径 |

**数据/机制型永久丢失（数据可搬，语义层级丢失）**

| # | 项 | 说明 |
| --- | --- | --- |
| 11 | 记忆卡「全量永不遗忘 + 衰减」双轨 | 303 条可转进 `memories.json`，但「全量卡 vs 衰减卡」的双层语义与衰减曲线不再存在 |
| 12 | 已读水位 / 潜水 / 对话收尾（summary+nextOpening）的会话状态语义 | Aurabot 无这些状态机；session 上下文由 DSH 管理 |
| 13 | 跨平台身份对齐（QQ⇄B站 映射 + brief 注入） | 当前 `links:[]` 为空，数据无实损，机制不可复制 |
| 14 | 身份泄露闸（公开面 QQ 号拦截） | Aurabot 只抹密钥/token，不拦 QQ 号；将来做 B站 必须重做 |
| 15 | 黑话「自动学习→管理员确认」闭环 | 247 条文本可转，学习/确认流程不可复制 |

> **群友/主人能立刻感知的 5 项降级**：① 群聊联网搜索（**仅当按迁移文档 Step 3 方案 A 删除根级 web-search MCP 时成立**；若保留该 MCP，Aurabot 会话也能用，见 Step 3 说明）；② 鱼群保护；③ 上线补历史；④ token 防爆破闸；⑤ 对话收尾/下次开场承接。
> 其余大多当前处于关闭或空数据状态，实际损失有限。

---

## 6. 迁移后行为变化（验收要看这些）

| 场景 | DSBot 旧行为 | Aurabot 新行为 |
| --- | --- | --- |
| 主人私聊 | 被唤醒→可能先潜水→用工具发 1~N 条 | 收到即按合并窗口回；正文按行/`|||` 拆条；可主动搭话（speakUp 默认开） |
| 群聊被 @ | 唤醒→必须回 | 必须回（wakeWords/@ 判定） |
| 群聊闲聊 | 模型自主判断是否插话；鱼群保护硬拦 | 按 `interjectChance`/`minRelevance`/冷却插话；**无鱼群保护** |
| 群里让她「查一下」 | web-search MCP 可用 | **social preset 没有联网工具，做不到** |
| 表情/语音/引用/@ | 调 `qq_send_sticker`/`qq_send_voice`/`qq_reply` 工具 | 内联标记 `<sticker:标签>`/`<voice>`/`<reply:N>`/`<at:QQ号>`；`qq_send_message` 只在主人私聊挂、用于发到别的会话 |
| 沉默 | `[沉默]`/不回复/收尾工具 | `[沉默]` 或群策略判定不回；**无收尾/下次开场承接** |
| 掉线重启 | 桥接上线补历史 + 水位去重 | **不补历史**，可能漏掉掉线期间消息 |
| Token 成本 | 日额度 ¥8 + 唤醒上限硬闸 | 无额度闸；靠模型档位与群限流 |

---

## 7. 迁移分期（阶段 A–E，与 Runbook 的 Step 编号对应）

| 阶段 | 对应 Runbook | 范围 | 进入条件 | 验收 | 回滚点 |
| --- | --- | --- | --- | --- | --- |
| **A 前置** | Step 0–1 | 恢复 QQ 登录态（SnowLuma VNC + EULA/隐私同意）；备份；停桥接 | `curl :3000/get_login_info` 返回 `retcode:0` | 网关 HTTP/WS 都可连；`dsbot-bridge` 已 disable | —（不涉及数据变更） |
| **B 核心切换** | Step 2–5 | 装 Aurabot、卸 DSBot、重启 DSH、配 `gateway=onebot` | 阶段 A 完成；已确认迁移窗口 | DSH 起、Aurabot 面板在、连接状态 connected、登录核对通过 | 停 DSH → 移除 aurabot → 装回 dsbot → 起 bridge（迁移文档 §9） |
| **C 上线验证** | Step 6–10 | 人格迁移（必须）+ 白名单/权限 + 试运行 → 正式上线 | 阶段 B 通过 | 试运行 20 条私聊/群聊；关 dryRun 后 10 轮私聊 + 3 次群 @ 正常；白名单外无响应 | 关总开关/回滚 B |
| **D 上线后补** | Step 7（记忆部分，可离线预做转换） | 记忆导入（转换脚本可在上线前离线跑，导入+召回验收放上线后第 1 周）+ 黑话压缩进人格 | 阶段 C 稳定 ≥3 天；`memories.json` 通过 `JSON.parse` 自检 | 面板条数=映射条数；抽 10 个话题召回正确 | 恢复空 `memories.json` + 旧人格 |
| **E 按需** | §7 二期 | B站（重新扫码）、语音、桌宠、空间、抖音等 | 用户明确要继续用对应能力 | 对应面板/工具可用 | 关对应模块开关（不影响 QQ 链路） |

---

## 8. 附录：未确认项与确认方法

| # | 未确认 | 确认方法 |
| --- | --- | --- |
| A-1 | SnowLuma WS `role:"Universal"` 是否接受 Aurabot 的 `?access_token=` 鉴权 | 登录态恢复后，node 脚本连 `ws://127.0.0.1:3001/?access_token=***` 发 `get_login_info`，看 `retcode:0` |
| A-2 | `/aurabot/api/*` 是否受 DSH 鉴权保护（handler 内未见校验） | 装好后 `curl -i http://127.0.0.1:3102/aurabot/api/state`（不带 Cookie），看是否 401 |
| A-3 | 记忆条目里群友 `speaker` 昵称 ⇄ QQ 号 | 读 `state/social-v2.json` 的 `recentMessages[].sender` 或导出群成员对照后补 `about` |
| A-4 | 换人格 id 后历史会话是否可续 | 切换后看侧栏「Aurabot · QQ」是否新建会话（旧会话成为普通 DSH 会话，预期行为） |
| A-5 | 面板「导入旧档案」在 web 版是否完整可见 | 装好后逐页点一遍 |
| A-6 | 303 条记忆里哪些必须保留 | 人工抽样 `memory-card.md` 与用户确认（默认建议：主人 164 + 群 57 保留，self 81 丢弃） |

---

*完整逐行矩阵（含每个结论的 SC/AU/LV 行号证据）见 `docs/work/mapping-matrix.md`。*
