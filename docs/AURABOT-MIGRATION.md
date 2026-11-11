# SurfCore → Aurabot 线上机器人迁移方案

> 目标：把**线上正在跑的 QQ 机器人**（QQ `2477094441`，主人 `1362431704`）从 **SurfCore（插件 + 外置 bridge 进程）** 切到 **Aurabot（`github.com/aureth-labs/dsh-aurabot-qq`，单插件 + 插件内 OneBot 客户端）**。
> 范围按用户口径「只迁移线上机器人」：优先保证 QQ 私聊/群聊的人格、记忆、关系与权限不丢；B站等当前未启用的能力放二期。
> 配套文档：[AURABOT-API-MAPPING.md](AURABOT-API-MAPPING.md)（能力/配置/数据/接口对照与缺口）。
> 证据底稿：`docs/work/surfcore-inventory.md`（SurfCore 侧）、`docs/work/aurabot-inventory.md`（Aurabot 侧）、`docs/work/lead-verified-facts.md`（Lead 实测）、`docs/work/mapping-matrix.md`（对照矩阵）。
> 盘点/实测时间：2026-11-03。

---

## 0. 结论速览（TL;DR）

| 问题 | 结论 |
| --- | --- |
| 能不能切？ | **能**。核心 QQ 链路（接既有 OneBot v11 网关）在 Linux 上可用；Aurabot 1.1.24 已实测能在本机 DSH **0.2.1-rc.5** 上安装、组合配置并启动 |
| 怎么切？ | 停 bridge → 装 Aurabot → 从 profile 移除 SurfCore → 重启 DSH → 用 `gateway=onebot` 接现有 SnowLuma → 迁人格/记忆/白名单 → **先试运行**再上线 |
| 最大前提 | **SnowLuma 的 QQ 登录态现在是断的**（12:10 重启后停在 `awaiting EULA/PRIVACY consent` + `awaiting login`，OneBot 端口连上即 reset）。迁移第 0 步必须先恢复登录 |
| 最大风险 | ① 同一 QQ 号只能有一个 OneBot 消费方：bridge 与 Aurabot 同时连会**双收消息、双回复**；② 重启 DSH 会**中断当前这个 agent 会话**（`surfcore-dsh.service` 就是本会话所在实例）；③ 本机 3 GB 内存，DSH 已用 ~1.9 GB，不能长期双跑 |
| 范式变了 | 不是换皮：SurfCore 是「模型自主唤醒/潜水/收尾 + 必须调 `qq_*` 工具发言」，Aurabot 是「中枢推送 + 策略决定回不回 + **模型正文就是发出的消息**」。群聊还会**失去鱼群保护/上线补历史/对话收尾/token 闸**；群聊联网搜索是否还在取决于 Step 3 是否保留根级 web-search MCP（详见 API 对照文档 §0、§6） |
| 会丢什么 | SurfCore 独有的 **B站生物钟·养鱼·观看历史·口味·四类动态·定时分享、记忆卡衰减压缩、角色包快照/回档、语音包管理、桌宠 host、备份/诊断/组件更新、扩展平台、`qq-mode` 命名空间、桥接自愈、42 个 MCP 工具（39 snowluma + 1 host + 2 web-search）协议** 不再有等价物（详见 API 对照文档 §5.2 权威清单）。**Token 额度与花费统计已补回**（用户模块 `token-budget`，见 [TOKEN-BUDGET-MODULE.md](TOKEN-BUDGET-MODULE.md)） |
| 会得到什么 | 模块化可开关、每个 QQ 聊天独立 DSH 会话、BM25 记忆库、群聊插话/头衔过滤/防机器人互聊、空间日记、表情包库、生图、心情、主动搭话、按聊天选模型、用户自写模块；Linux 上可用（抖音/翻唱/桌宠桌面行为受限） |
| 预计耗时 | 核心切换 30–60 分钟（含重启与试运行）；人格+记忆+权限验证 1–2 小时；二期能力按需 |

---

## 1. 背景与判定标准

**现状**：SurfCore 是「插件 + 外置桥接进程」双层结构。`surfcore-dsh.service` 起 DSH（profile `web`，`DSH_HOME=/home/ubuntu/dsh-agentchat/dsh-0.2-home`，端口 3102），`surfcore-bridge.service` 起 `surfcore/src/bridge.js`（独立进程，消费 SnowLuma 的 OneBot，再通过 DSH RPC 驱动 agent preset `qq-chat-v2`，由它承担白名单、token 闸、鱼群保护、上线下线补历史、记忆卡注入等 19 类「像人」行为）。

**目标**：Aurabot 是单插件（bundle）结构：插件进程内自带 OneBot v11 客户端直接连 SnowLuma，每个 QQ 私聊/群对应一个 DSH 会话（工作区「Aurabot · QQ」），人格/记忆/工具都挂在会话上。

**迁移成功的判定**（也是验收口径）：

1. 主人私聊、白名单群（`694991842`）里她能正常收发；群聊 @、图片、引用、表情、语音（按需）不漏回、不重复回；
2. 人格仍是现在这张「大肥鱼」卡（不是 Aurabot 自带默认卡），说话风格不出现 Markdown/小作文；
3. 长期关系与记忆可被想起（记忆导入后可检索、人物小档案可用）；
4. 权限默认安全：总开关默认关、试运行默认开；白名单与主人身份正确；
5. 全程只有一个 OneBot 消费方，SnowLuma 侧无重复事件；
6. 可回滚：旧 SurfCore 数据与 profile 未被破坏。

---

## 2. 当前线上拓扑（SurfCore，迁移前）

```
QQ 客户端（SnowLuma 容器内 Linux QQ，账号 2477094441「大肥鱼」）
  │  OneBot v11
  ▼
SnowLuma 容器 snowluma（motricseven7/snowluma:latest）
  ├─ HTTP  ← 127.0.0.1:3000（path /，Bearer token）
  ├─ WS    ← 127.0.0.1:3001（Universal，?access_token=）
  ├─ WebUI   127.0.0.1:5099
  └─ VNC     127.0.0.1:6081（扫码登录）
  │
  ▼
surfcore/src/bridge.js（pid 2091，systemd: surfcore-bridge.service）
  ├─ 白名单/token 闸/鱼群/收尾/补历史/记忆卡注入/分条发送…（19 类行为）
  ├─ 控制台 127.0.0.1:3100（x-console-token）
  └─ 通过 RPC + WS /api/remote.mux 驱动 DSH
  │
  ▼
DSH 0.2.1-rc.5（pid 990，systemd: surfcore-dsh.service，profile web，:3102）
  ├─ 插件 surfcore v0.7.13（bundle + link 依赖，14 个设置栏目）
  ├─ agent preset qq-chat-v2（reserved2 模式，工具面 = 42 个 mcp__snowluma__* 等）
  └─ 3 个 MCP server（snowluma 39 工具 / snowluma-host 1 / web-search-safe 2）
```

关键资产位置（迁移必须知道「两处状态目录」）：

| 类别 | 路径 |
| --- | --- |
| 插件状态 | `/home/ubuntu/dsh-agentchat/dsh-0.2-home/surfcore/`（当前角色/记忆卡/配置备份等，26 MB，其中 backups 24 MB） |
| 桥接状态 | `/home/ubuntu/dsh-agentchat/surfcore/state/`（sessions.json、social-v2.json、黑话 247 条、token 账本等，1.1 MB） |
| 人格素材库 | `/home/ubuntu/dsh-agentchat/surfcore/roles/`（99 张）、`roles-full/`（27 张） |
| 人格卡（线上生效） | `dsh-0.2-home/surfcore/characters/da-fei-yu/persona.md`（当前角色「原装-大肥鱼」） |
| 记忆 | `dsh-0.2-home/surfcore/characters/da-fei-yu/memory/`（衰减卡 303 条/248 KB 全量卡） |
| 桥接配置 | `/home/ubuntu/dsh-agentchat/surfcore/config.json`（白名单/模式/闸门） |
| 运行时 | `/home/ubuntu/dsh-agentchat/dsh-0.2-trial`（`@deepseek-ai/dsh` 0.2.1-rc.5，node v24.19.0） |

> 另有一只**无关**的 DSH：pid 972，`dsh web --port 3080`，使用默认 `~/.dsh`，没有 surfcore，迁移时不要误停。

---

## 3. 目标拓扑（Aurabot，迁移后）

```
QQ 客户端（SnowLuma 容器，不变）
  │  OneBot v11（不变）
  ▼
SnowLuma 容器（不变；启停仍归 Docker，Aurabot 不管理它）
  │
  ▼
DSH 0.2.1-rc.5 profile web（surfcore-dsh.service，:3102）
  └─ 插件 dsh-aurabot-qq v1.1.24
       ├─ 插件内 OneBot 客户端（gateway=onebot → http://127.0.0.1:3000 + ws://127.0.0.1:3001）
       ├─ 聊天中枢：每个 QQ 私聊/群 = 一个 DSH 会话（工作区「Aurabot · QQ」）
       ├─ 3 个 agent preset：aurabot-private / -private-long / -social
       ├─ 18 个内置模块 + 用户模块目录
       └─ 数据目录：dsh-0.2-home/plugins-data/aurabot/
```

迁移后**没有**外置 bridge 进程、没有 3100 控制台、没有 `qq-mode` 设置命名空间；工具面变成 Aurabot 自己的 `qq_send_message` / `qq_reply` / `qq_chat_history` / `remember` / `recall_memory` / `bili_watch` …（不是 `mcp__snowluma__*`，旧 preset 的提示词不再适用，Aurabot 用自己的人格变量 + 规则注入）。

---

## 4. 可行性论证（已实测，非纸面）

1. **能装**：在隔离 `DSH_HOME`（`/tmp/dsh-aurabot-compat`）用同一运行时执行
   `dsh plugin --profile web add github:aureth-labs/dsh-aurabot-qq`
   → pnpm 从 `codeload.github.com` 拉取 tar.gz（1273 KiB），装成 `dsh-aurabot-qq@1.1.24`，并**自动把包加进 `dsh.profile.bundles`**。
2. **能组合**：`dsh --profile web --dump-config` 退出码 0，输出含 `# == dsh-aurabot-qq` 与 3 个 preset。
3. **能启动**：隔离 profile 启 web（3199）成功；日志出现
   `[core] Aurabot v1.1.24 已加载｜总开关 关｜试运行 开｜工作区 /home/ubuntu/Aurabot/qq-chats`、`[pet] 桌宠模块就绪`、`[heybox] 小黑盒模块起来了`；数据目录自动生成 `plugins-data/aurabot/{personas/modules/modules-data/logs}`；DSH 根路径 401（正常鉴权），无 error。
4. **仓库同一性**：`aureth-labs/dsh-aurabot-qq` 与上游 `accomplish07zrh-eng/dsh-aurabot-qq` 的 `refs/heads/main` 是**同一 commit sha** `b3301f6b0140…`（采集时 `git ls-remote` 两边输出一致；仅证明代码同一，不构成对镜像同步策略的背书），所以行为可按 Aurabot 1.1.24 文档理解；仅安装命令要写 `aureth-labs`。
5. **接法确定**：`gateway=onebot` 时地址仍填在 `snowluma.*` 下（`httpUrl`/`wsUrl`/`httpToken`/`wsToken`），插件不启动、不注入 SnowLuma，只连填的地址；连上后先用 `get_login_info` 核对是不是机器人号，不是就断开且不再自动重连。
6. **schema dump 的已知问题**：`--dump-config-schema` 会对 preset 的 `plugins` 子列表报 `dsh: error: unrecognized Loader tree carrier`（Aurabot 3 条 + 纯 base+web-app profile 4 条），**命令退出码 1**；这属于 schema 投影限制，**不影响启动**（已实测启动成功），不要拿它当安装失败判据。
7. **未验证项**：SnowLuma WS 的 `?access_token=` 鉴权是否被接受（当前 QQ 未登录，无法实连）——第 12 节验证清单会覆盖。

---

## 5. 前置条件（阶段 A：不满足就别开始）

- [ ] **恢复 SnowLuma 的 QQ 登录态**（当前断线）：
  1. 取 WebUI 初始密码（容器日志里只打印一次；日志很长，用整份 grep 而不是 `--tail`）：
     `sudo docker logs snowluma 2>&1 | grep -i -A3 "initial credentials" | tail -20`
  2. 打开 WebUI 完成 **EULA/隐私同意**：面板 `/vnc` **只代理 VNC 6081，没有代理 5099**；
     WebUI 用 SSH 隧道访问 `ssh -L 5099:127.0.0.1:5099 <这台机器>` 后开 `http://127.0.0.1:5099`；
     扫码登录走 VNC：面板 `https://154.8.153.208:10325/vnc/vnc.html?autoconnect=1&resize=scale`（登录态下）。
  3. 验证登录真的好了（用 SnowLuma 里机器人号自己的 accessToken）：
     ```bash
     TOKEN=$(python3 -c "import json;print(json.load(open('/home/ubuntu/dsh-agentchat/snowluma/data/config/onebot_2477094441.json'))['networks']['httpServers'][0]['accessToken'])")
     curl -s -X POST http://127.0.0.1:3000/get_login_info \
       -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}'
     # 期望 {"status":"ok","retcode":0,"data":{"user_id":2477094441,...}}
     ```
- [ ] **全量备份**（含 profile 清单 + 两处状态 + 人格素材 + 配置；aurabot 数据目录此时还不存在）：
  ```bash
  BK=~/surfcore-migration-backup-$(date +%F-%H%M)
  mkdir -p "$BK"
  cp -a /home/ubuntu/dsh-agentchat/dsh-0.2-home/profiles/web/{package.json,cordis.patch.yml,pnpm-lock.yaml} "$BK"/ 2>/dev/null
  cp -a /home/ubuntu/dsh-agentchat/dsh-0.2-home/surfcore "$BK"/dsh-home-surfcore
  cp -a /home/ubuntu/dsh-agentchat/surfcore/state "$BK"/bridge-state
  cp -a /home/ubuntu/dsh-agentchat/surfcore/config.json "$BK"/bridge-config.json
  cp -a /home/ubuntu/dsh-agentchat/surfcore/roles "$BK"/roles
  tar czf "$BK".tar.gz -C "$(dirname "$BK")" "$(basename "$BK")" && echo "backup: $BK.tar.gz"
  ```
- [ ] **接受窗口内中断**：重启 `surfcore-dsh.service` 会关掉当前 DSH 以及**正在和你对话的这个 agent 会话**（它就跑在这个 DSH 里）。建议：
  - 迁移操作在另一个终端（SSH）或本机完成，重启后重新打开 GUI 继续；
  - 或者从外部会话（如 DSH 别的 profile）执行命令。
- [ ] **内存**：3 GB 总量、DSH 已用约 1.7–2.0 GB、swap 已用约 100–600 MB（随负载波动，动手指令相实读为准）。不要同时跑两套完整机器人；按 §6 的「先停旧再起新」执行。
- [ ] **确认没有别的消费者**：`ps -eo pid,cmd | grep -E 'bridge\.js|astrbot'`；`astrbot.service` 当前 inactive，确认保持 inactive。
- [ ] **决定 MCP 区块处理**（见 §6 Step 3）：profile 的 `cordis.patch.yml` 里由 SurfCore 维护的 3 条 MCP 是否保留（**注意该区块里还有 llm 模型配置，不能整段删**）。

---

## 6. 迁移步骤（Runbook）

> 约定：所有命令以 `ubuntu` 用户执行；需要 root 的命令前缀 `sudo`。DSH_HOME 固定为 `/home/ubuntu/dsh-agentchat/dsh-0.2-home`。
> 每一步给出「做什么 / 命令 / 预期 / 失败怎么办」，并标出回滚点（R）。

### Step 1｜停 SurfCore 桥接（释放 OneBot，避免双消费）

```bash
sudo systemctl disable --now surfcore-bridge     # 必须 disable：单元是 Restart=always
systemctl status surfcore-bridge --no-pager | head -5     # 预期 inactive (dead)
ps -eo pid,cmd | grep 'bridge\.js' | grep -v grep || echo "bridge 进程已退出"
ss -ltnp | grep 3100 || echo "3100 已释放"                 # 预期无输出
```

- **只用 `stop` 不够**：`surfcore-bridge.service` 是 `Restart=always`，会自己回来。必须 `disable --now`。
- **不要**在此时才去关设置页的「启动 QQ」——桥接是独立 systemd 服务，直接停服务最干净；`SURFCORE_SKIP_AUTOSTART=1` 已保证插件不会再自愈拉起它（重启 DSH 后也不会）。
- 失败：若停服后 30 秒内 `ps` 仍见到 `bridge.js`，`sudo kill <pid>`；确认 `state/bridge.lock` 对应进程已退出。
- 此时 QQ 机器人处于**离线**状态（没人再回消息）。

**R1**：`sudo systemctl start surfcore-bridge` 即可恢复原状（本步骤未改任何文件）。

### Step 2｜装 Aurabot、卸 SurfCore（profile 包管理）

先停 DSH（避免运行中的 profile 在包操作期间被改写）：

```bash
sudo systemctl stop surfcore-dsh
```

然后（DSH CLI 路径与运行时）：

```bash
DSH=/home/ubuntu/dsh-agentchat/dsh-0.2-trial/node_modules/@deepseek-ai/dsh/lib/bin.js
NODE=/home/ubuntu/.local/node/bin/node
export DSH_HOME=/home/ubuntu/dsh-agentchat/dsh-0.2-home
export PATH=/home/ubuntu/.local/node/bin:/home/ubuntu/.local/share/pnpm:$PATH

# 1) 先移除旧的 SurfCore（取消 bundle 选择；仓库目录不动）
"$NODE" "$DSH" plugin --profile web remove surfcore

# 2) 再安装 Aurabot（写 profile package.json + 自动加入 dsh.profile.bundles）
"$NODE" "$DSH" plugin --profile web add github:aureth-labs/dsh-aurabot-qq
```

> 顺序说明：两者都是 profile bundle，**先移除旧的再装新的**，避免任何「两个 QQ 插件同时被选中」的瞬间。DSH 已停，所以顺序本身不影响运行，只是更稳。

预期：

```bash
cat "$DSH_HOME/profiles/web/package.json"
# dependencies 里有 "dsh-aurabot-qq": "github:aureth-labs/dsh-aurabot-qq"，不再有 surfcore
# dsh.profile.bundles 里有 "dsh-aurabot-qq"，不再有 "surfcore"
```

- 网络慢时安装约 1–2 分钟（实测 1m13s），pnpm 会打印 tarball 下载进度。
- 若 `add` 报 GitHub 访问失败：先 `git ls-remote https://github.com/aureth-labs/dsh-aurabot-qq` 验证网络；或改用本地目录 spec 安装（把仓库 clone 到本地后用 `add /path/to/dsh-aurabot-qq`）。
- `remove surfcore` 会同时取消 bundle 选择；若 pnpm 报 link 依赖仍被引用，手动从 `dependencies` 删掉 `"surfcore": "link:..."` 并再跑一次 remove/`pnpm install`。

**R2**：恢复备份里的 `profiles/web/{package.json,pnpm-lock.yaml,cordis.patch.yml}`，再 `pnpm install`（或 `dsh plugin add link:...`），重启 DSH。

### Step 3｜处理 agent 侧 MCP 区块（可选，但建议做）

`profiles/web/cordis.patch.yml` 里有一个由 SurfCore `scripts/setup-dsh.mjs` 写入的区块（`# === qq-bridge MCP BEGIN ===` 到 `# === qq-bridge MCP END ===`）。

> ⚠️ **千万不要整段删除**：这个区块里除了 3 条 MCP，还有 **`llm-deepseek`（模型 provider + API key 环境变量）和 `agent-default-model`（默认模型）** 两段。整段删掉 = DSH 没有模型，Aurabot 一句都推理不出来。

区块内容与迁移后的表现：

| 区块内条目 | 迁移后表现 | 建议 |
| --- | --- | --- |
| `mcp-snowluma`（39 个 `mcp__snowluma__*` 工具） | 其中 35 个走 bridge 控制台 :3100（桥停后失效）；4 个只读查询（`qq_status`/`qq_list_groups`/`qq_get_group_members`/`qq_get_group_history`）直连 SnowLuma :3000，仍可用 | 删除（Aurabot 不需要） |
| `mcp-snowluma-host`（`snowluma_status`） | 直连 SnowLuma :3000，桥停后**仍可用** | 可删；想保留一个探活工具就留 |
| `mcp-web-search-safe`（`web_search`/`web_fetch`） | 独立 stdio server，不依赖 bridge，仍可用 | 看你要不要「agent 侧联网搜索」，见下 |
| `llm-deepseek` + `agent-default-model` | **DSH 的模型配置** | **必须保留** |

两种做法（都只删 `insert:` 块，保留 llm 两段）：

- **A（推荐）**：删掉 `mcp-snowluma`、`mcp-snowluma-host`、`mcp-web-search-safe` 三个 `insert:` 块。副作用：DSH 里的 agent 会话（含 Aurabot 的 QQ 会话）不再有这些工具；QQ 群聊因此**没有联网搜索**（Aurabot 的 social preset 本身不挂 web 搜索）。
- **B（保留联网搜索）**：只删 `mcp-snowluma`、`mcp-snowluma-host`，保留 `mcp-web-search-safe`。**注意**：根级 MCP 工具对所有 agent 可见，所以 Aurabot 的 QQ 会话（含群聊）也会拿到 `web_search`/`web_fetch` —— 这是把「群聊能联网搜索」保下来的唯一方式；以后删掉 `/home/ubuntu/dsh-agentchat/surfcore` 仓库前，先把 `src/mcp-web-search-safe.js` 复制到别处并改路径。

> 注意：MCP 工具挂在 DSH profile 层，不是「只属于旧 SurfCore 的 QQ 机器人」；保留就会出现在所有 agent（包括 Aurabot）的工具里。删不删都不影响 Aurabot 上线。

### Step 4｜重启 DSH，确认 Aurabot 装上了

```bash
sudo systemctl restart surfcore-dsh
sleep 20
systemctl status surfcore-dsh --no-pager | head -12        # 预期 active (running)
# 注意：该单元把日志重定向到文件，journalctl 看不到插件日志
tail -n 120 /home/ubuntu/dsh-agentchat/logs-surfcore-dsh.log | grep -iE 'aurabot|error|fail' || true
```

- GUI：`https://154.8.153.208:10326/`（DSH 重启后重新打开；**当前对话会话会中断，这是正常的**）。
- 预期：左侧栏「自动化任务」下面出现 **Aurabot**；日志出现 `Aurabot v1.1.24 已加载`；数据目录出现 `dsh-0.2-home/plugins-data/aurabot/`。
- 失败：`systemctl status` 里若 DSH 起不来，多半是 profile patch 组合错误——看 `journalctl -u surfcore-dsh -n 200` 与 `logs-surfcore-dsh.log`（该文件里有一行带 DSH 启动 token，贴给别人前先脱敏）；回滚 R2。
- 若 DSH 起来了但 Aurabot 面板空白/报错：看浏览器控制台（import/slots 相关报错）。服务端已实测可启动；**浏览器面板渲染是本方案里唯一未实测的环节**，第一次打开请留意。
- profile 里还有 `dsh-tide-badge` / `dsh-codex-media` 等其它 bundle，以及 `dsh-secure-proxy` / `@deepseek-ai/dsh-subagent-codex` 等依赖：迁移只动 `surfcore` 与 `dsh-aurabot-qq`，**不要整份替换** `package.json` 把别的插件弄丢。

### Step 5｜配 QQ 接入（向导，`gateway=onebot`）

在 Aurabot 面板点「重走设置向导」或在「连接」页填：

| 字段 | 值 |
| --- | --- |
| 机器人 QQ 号 | `2477094441` |
| 你的 QQ 号（主人） | `1362431704` |
| 接 QQ 方式 | **接我已有的 OneBot 机器人**（不要选 SnowLuma，Linux 上不适用） |
| 正向 WebSocket 地址 | `ws://127.0.0.1:3001` |
| HTTP 地址（可选但建议） | `http://127.0.0.1:3000` |
| token | SnowLuma `onebot_2477094441.json` 里 HTTP/WS 各自的 `accessToken`（HTTP 用 Bearer，WS 用 `?access_token=`） |

> 地址仍保存在配置的 `snowluma.httpUrl/wsUrl/httpToken/wsToken` 下（`gateway=onebot` 也如此），这是设计如此，不是 bug。

预期：面板显示「连上了：大肥鱼（机器人号）」或连接状态 `connected`；日志出现登录核对通过；若填错号/网关，会明确提示并且**不会**自动重连到错误账号。

- 失败排查：
  - `连 ... 没连上` → 检查 SnowLuma 是否登录、端口/token 是否对（用 §5 的 curl 再验一次）；容器内 DSH 要写容器可达 IP，本机写 `127.0.0.1`。
  - 提示 `登录的不是机器人号` → 核对 `botQQ` 与 SnowLuma 实际登录号（`get_login_info`）。

### Step 6｜人格迁移（把现在这张「大肥鱼」卡搬过去）

SurfCore 线上人格：`dsh-0.2-home/surfcore/characters/da-fei-yu/persona.md`（当前角色「原装-大肥鱼」；另有人格素材库 `surfcore/roles/*.md` 99 张可选）。

**Aurabot 人格位置**：`dsh-0.2-home/plugins-data/aurabot/personas/<id>.md`（首次启动已播种自带 `dafeiyu.md`；之后以数据目录为准，面板可编辑）。

**好消息**：线上 `persona.md` 与 `surfcore/roles/原装-大肥鱼.md` **逐字节相同**（3880 B），正文里不含任何工具名/接口引用 → 可以原样作为 Aurabot 人格，不会被失效工具名污染。

两种落地方式：

- **A（推荐，可回退）**：新建 `personas/da-fei-yu.md` = SurfCore 正文，然后在面板「人格」里点「设为当前」（写入 `persona.current="da-fei-yu"`）；自带 `dafeiyu.md` 保留作参考。
- **B（最省事）**：直接用 SurfCore 正文覆盖 `personas/dafeiyu.md`，不动 `persona.current`。零配置改动，但丢失自带卡的语感细节、且没有单人回退（Aurabot 无快照）。

命令方式（对应方案 A）：

```bash
AU=/home/ubuntu/dsh-agentchat/dsh-0.2-home/plugins-data/aurabot
cp /home/ubuntu/dsh-agentchat/dsh-0.2-home/surfcore/characters/da-fei-yu/persona.md "$AU/personas/da-fei-yu.md"
# 然后在面板「人格」里把 da-fei-yu 设为当前（或改 config.json 的 persona.current）
```

注意事项（**行为会变，不是 bug**）：

- Aurabot 在人格后面**额外注入自己的规则**（`aurabot_rules_private/social`）：分条用 `|||` 或一行一条、禁 Markdown、`<sticker:标签>`/`<face:名字>`/`<at:QQ号>`/`<voice>`/`<poke>`/`<reply:N>` 内联标记、群里无关时输出 `[沉默]`、私聊要主动一点等。SurfCore 桥接的注入块是另一套（reserved2 协议、工具调用、收尾判断）。
- 人格正文与人设风格保留，但「怎么发消息」由 Aurabot 规则决定；如果现人格里有「每条都带 `[SILENT]`/必须用工具发」之类旧协议内容，建议删掉（否则会和新规则打架）。
- 人格 `---name/tags---` 头可选；没有就按文件名当名字。
- 迁移前先 `tar` 归档 `characters/`（Aurabot 没有快照/回档机制，这就是回滚点）。

### Step 7｜记忆迁移（关系资产，含字段转换）

> **重要**：不要用面板「导入旧档案」硬搬 303 条——该接口单次 ≤3 万字且**每次最多产出 80 条候选**，303 条要分 4 批且每批烧一次模型调用，还会被相似度去重。**推荐直接写 `memories.json`**（一次到位、不去重、可 `diff` 校验）。

SurfCore 记忆资产（live 数据在**当前角色目录**下；`$DSH_HOME/surfcore/memory/` 里的那份是旧扁平布局残留，只有 764 B，**别搬错**）：

| 文件 | 内容 | 迁移方式 |
| --- | --- | --- |
| `characters/da-fei-yu/memory/memory-card.json`（357 KB，303 条） | 衰减记忆卡（结构化，推荐转换源） | 转换脚本 → `plugins-data/aurabot/memories.json` |
| `characters/da-fei-yu/memory/memory-card-full.jsonl`（248 KB，303 行） | 全量卡（字段最全） | 同上，优先用这份 |
| `memory-card-prompt-qq.md` | QQ 注入块（1150 字） | 不需要（Aurabot 动态召回） |
| `surfcore/state/social-v2.json` | 进行中话题/想说的话/群友印象/收尾 summary | 转成记忆条目（见下表） |
| `surfcore/state/slang.json`（247 条黑话） | 群梗库 | 压缩 30–50 条进人格卡（推荐），或转记忆条目 |

`memories.json` 字段映射（Aurabot item：`{id,text,about,aboutName,tags,importance,source,chatId,at,hits}`；硬约束：`text` **截断 200 字**、`tags` ≤5、库上限 3000、相似度 ≥0.6 去重）：

| SurfCore 字段 | Aurabot 字段 | 规则 |
| --- | --- | --- |
| `text`（均长 12.7 字，仅 1 条 >200） | `text` | 直拷；超 200 那条劈成两条 |
| `speaker`（主人 165 / 大肥鱼 81 / 群友 57…） | `aboutName` | 直拷 |
| 无 QQ 号 | `about` | 主人 → `1362431704`；群友人工补（留空即少「关于此人」加权） |
| `importance`（0~100） | `importance`（0~1） | `÷100`；pinned/anchor 两三条拉到 ≥0.9 |
| `kind`（owner/event/promise/firstMeet/conflict） | `tags` | 第一个 tag 保留 kind，再补 1~3 个话题词 |
| `createdAt`（ISO） | `at`（毫秒） | `Date.parse()` |
| `source`（qq-owner/qq-self/qq-group） | `source` | 统一 `"import"` |
| `isSelf=true`（81 条，她自己说过的话） | — | **建议丢弃**（会污染召回）；要留就 `importance≤0.3` + `tags:['旧事']` |
| `id`（`mem_*`） | `id` | 重新生成 8 位短 id |

`social-v2.json` 记忆类字段（实测有真实内容）：

- 顶层结构是 `{conversations: {"private:1362431704": {...}, "group:694991842": {...}}, paused:false}`；例如 `conversations["private:1362431704"].activeTopics[0]` = `{text:"主人11月4日之前要交作业，需要提醒他", pendingQuestion:"11.3晚上提醒主人交作业"}` → 2 条记忆（`about=1362431704`、`importance:0.9`、`tags:["约定","提醒"]`）；
- 私聊与群各有一份 `closure`：`summary`+`nextOpening` → 私聊 2 条 + 群 2 条（共 4 条；`tags:["收尾","上次聊到"]`、`importance:0.7`）。注意：Aurabot 没有「下次开场承接」的注入点，只能靠召回自然命中；
- `wakeConfig/unread/lastReadThroughSeq/agentToken/recentMessages` 是运行态，**不搬**。

黑话 247 条（Aurabot 无黑话机制）三选一：**A（推荐）** 取高频 30–50 条压缩成「群梗速查」段落追加到人格卡末尾（纯文本、稳定、占提示词 token）；B 全量转成 `tags:['黑话']` 记忆条目（靠召回、命中不稳定）；C 写用户模块挂 `prompt` hook（超出本期）。原始 `slang.json` 必须归档。

完成后验证：面板「心情与记忆」条数 = 映射条数；主人私聊问「你记得我什么」能想起；抽查 5–10 条旧事在召回里出现；重启 DSH 后数据仍在。

> 旧 DSH 会话（`dsh-0.2-home/sessions/` 14 MB）**不迁移**：它们绑定 SurfCore 的会话结构，Aurabot 用的是新会话；原样保留只读留档即可。

### Step 8｜权限与白名单

从 SurfCore 生产配置对齐（`surfcore/config.json`）：

| 项 | SurfCore 现值 | Aurabot 填法 |
| --- | --- | --- |
| 私聊白名单 | `allow.private = ["1362431704"]` | `allow.private` 同一人（注意：**主人永远能私聊**，其实可不填；填上更直观） |
| 群白名单 | `allow.groups = ["694991842"]` | `allow.groups = ["694991842"]` |
| 黑名单 | `deny.*` 全空 | Aurabot 无 deny 机制；确认不需要按人拉黑（有需要在群里用权限/头衔过滤） |
| 主人 | `ownerQQ=1362431704` | 向导里已填 `ownerQQ` |
| 权限档 | — | `ownerLevel=full`（默认）；`profilePerms` 默认「仅主人」 |
| 头衔过滤 | SurfCore 无 | Aurabot 默认 `titleFilter.title = 大肥鱼`，用于防别的机器人互聊；可按需改 |
| 模型 | `deepseek-official / deepseek-flash / high` | 「模型」页全局模型选 `deepseek-flash`（聊天模型可默认跟随 DSH） |

### Step 9｜先试运行，观察

1. 确认面板顶部：**总开关开（enabled=true）+ 试运行开（dryRun=true）**。
   > 默认是「总开关关 + 试运行开」；**先打开总开关、保留试运行**，这样她照常思考，但只写日志不真发。
2. 用主人号给机器人发 3 类消息：普通闲聊 / 带图片 / 引用一条旧消息；群里 @ 她一次、不 @ 说一句无关的话。
3. 去「日志」页看她本来要回什么、有没有调工具报错。
4. 检查 QQ 侧确实**没有**消息发出（试运行生效），SnowLuma 只看到 Aurabot 一个消费者（`bridge.js` 已停）。
5. 试运行至少跑 30–60 分钟（覆盖一次群聊插话与一次记忆召回）。

### Step 10｜正式上线

1. 关「试运行」（dryRun=false），总开关保持开；
2. 再发一轮消息确认真发；
3. 观察 24 小时：错误日志、回复是否重复/漏回、群聊是否刷屏、token 消耗；
4. 按需打开二期模块（见 §7）。

**R3（上线后回滚）**：见 §9。

---

## 7. 二期 / 按需项（当前未启用或不紧急）

| 能力 | 现状 | 迁移后做法 | Linux 限制 |
| --- | --- | --- | --- |
| B站（浏览/评论/回评/截图/改签名头像） | SurfCore 侧**未登录**、`biliBridge.enabled=false`，等于装了没用 | Aurabot 面板「B站」填 Cookie（`SESSDATA` + `bili_jct`）或登录；默认关，按需开 | 无（抽帧需要 ffmpeg，本机未装） |
| 语音条（TTS） | SurfCore 语音全关、无语音包 | 面板「语音」安装 edge-tts（需 `python3-venv`，本机可用；无 uv 也能装） | 跨平台可用；Windows 语音兜底没有 |
| 空间日记 / 空间互动 | — | 面板「空间日记」开；依赖 SnowLuma 扩展 action（本机 Docker SnowLuma 支持） | 可用 |
| 表情包库 | SurfCore 表情库 0 条 | 面板「表情包」从 QQ 收藏导入/上传；偷表情默认开 | 可用（依赖 SnowLuma `add_custom_face` 扩展） |
| 生图 | — | 面板「生图」配 OpenAI 兼容接口或自定义/Codex | 可用 |
| 主动搭话 / 目的引擎 | SurfCore `purpose.enabled=false`、早安未启用 | 面板「主动搭话」开 `speakUp`；目的引擎默认关，二者二选一 | 可用 |
| 桌宠 | SurfCore 未装桌宠本体 | Aurabot「桌宠」页可生成 Electron 客户端 | 桌面窗口/图标行为 Windows-only；本机无桌面 |
| 抖音 | — | 需非 headless Chrome/Edge + X | **不可用**（无浏览器、无 Xvfb、无 DISPLAY） |
| 翻唱（RVC 点歌） | — | — | **Windows-only，不可用** |
| 小黑盒 | — | 面板「小黑盒」填 Cookie | 可用（纯 HTTP） |
| 贴吧只读扩展 | SurfCore 只有 planned | 装 `extensions/tieba-reader` 为用户模块 | 可用 |
| B站生物钟/养鱼/观看历史/口味/四类动态分享 | SurfCore 独有 | **Aurabot 无等价物** | 接受损失，或未来写用户模块 |

---

## 8. 数据迁移清单（速查）

| # | 数据 | 源 | 目标 | 方式 | 必须? |
| --- | --- | --- | --- | --- | --- |
| 1 | 当前人格卡 | `dsh-0.2-home/surfcore/characters/da-fei-yu/persona.md`（3880 B，与 `roles/原装-大肥鱼.md` 逐字节相同） | `plugins-data/aurabot/personas/da-fei-yu.md` + `persona.current` | copy + 面板「设为当前」 | **必须** |
| 2 | 人格素材库 | `surfcore/roles/*.md`（99） | 备用，按需导入 personas | 手动挑 | 建议 |
| 3 | 记忆卡（live，303 条） | `characters/da-fei-yu/memory/memory-card.json` / `memory-card-full.jsonl` | Aurabot `memories.json` | **字段转换脚本**（不走面板导入） | **必须** |
| 4 | 进行中话题/收尾承接 | `surfcore/state/social-v2.json` 的 `activeTopics/closure` | 记忆条目 | 手工转换（API 对照 §3.5） | 建议 |
| 5 | 黑话库 | `surfcore/state/slang.json`（247 条） | 人格卡末尾「群梗速查」段落（推荐） | 导出压缩 30–50 条 | 建议 |
| 6 | 白名单/主人 | `surfcore/config.json` `allow.*`/`ownerQQ` | Aurabot `allow`/`ownerQQ` | 面板/向导 | **必须** |
| 7 | 模型/参数 | `surfcore/config.json` `dsh.*` | Aurabot `model` 页 | 面板 | 必须 |
| 8 | B站配置/凭据 | `dsh-0.2-home/surfcore/bili.config.json`（无凭据，未登录） | 二期重新登录 | 面板填 Cookie | 二期 |
| 9 | token 用量账本 | `token-usage-*.json`、`surfcore/state/token-usage.jsonl` | 留档（Aurabot 无额度闸） | 复制到备份目录 | 留档 |
| 10 | 旧 DSH 会话 | `dsh-0.2-home/sessions/` | 不迁 | 保留只读 | 不迁 |
| 11 | 桥接配置全量 | `surfcore/config.json` | 语义逐项对照（见 API 文档 §2） | 人工 | 参考 |

> 易搬错点：`$DSH_HOME/surfcore/memory/memory-card*.json` 是**旧扁平布局残留**（764 B，只有 10-30 的旧内容）；live 记忆卡在 `characters/da-fei-yu/memory/`（303 条）。

---

## 9. 回滚（R3）

任何一步失败都按以下顺序回滚（数据未删，可完全恢复）：

```bash
# 1) 停新：面板先把总开关关掉（或直接改 config.json 的 enabled=false）
sudo systemctl stop surfcore-dsh

# 2) 还原 profile 包（删 Aurabot、装回 SurfCore）
DSH=/home/ubuntu/dsh-agentchat/dsh-0.2-trial/node_modules/@deepseek-ai/dsh/lib/bin.js
NODE=/home/ubuntu/.local/node/bin/node
export DSH_HOME=/home/ubuntu/dsh-agentchat/dsh-0.2-home
"$NODE" "$DSH" plugin --profile web remove dsh-aurabot-qq
"$NODE" "$DSH" plugin --profile web add link:/home/ubuntu/dsh-agentchat/dsh-0.2-home/plugins/surfcore
# 若 package.json/cordis.patch.yml 有变，用备份覆盖后再 pnpm install:
#   cp $BK/package.json $BK/cordis.patch.yml $BK/pnpm-lock.yaml $DSH_HOME/profiles/web/
#   (cd $DSH_HOME/profiles/web && pnpm install)

# 3) 起回旧服务
sudo systemctl start surfcore-dsh
sudo systemctl start surfcore-bridge
systemctl status surfcore-dsh surfcore-bridge --no-pager | head -20
```

- Aurabot 数据目录 `plugins-data/aurabot/` 保留不删（回滚后不加载，后续可再切回）。
- SurfCore 的两处状态目录（`dsh-0.2-home/surfcore/`、`surfcore/state/`）全程未删，记忆/角色/桥接状态原样可用。
- 若 SnowLuma 在迁移中被改动（一般不用动），`docker restart snowluma` 并在 VNC 重新确认登录。

---

## 10. 能力缺口与永久损失

完整对照见 [AURABOT-API-MAPPING.md](AURABOT-API-MAPPING.md) §5（其中 §5.2 是「永久丢失」的唯一权威清单，本节只做摘要）：

- **群友/主人能立刻感知的 5 个降级**（最重要）：
  1. **群聊联网搜索**：若按 Step 3 方案 A 删掉根级 `web-search-safe`，群聊将没有联网搜索（`social` preset 不挂 `tool-web`；主人私聊仍可用 DSH 内置 `tool-web`）。想保留就选 Step 3 方案 B；
  2. **失去鱼群保护**（同名鱼/连续鱼/占比 ≥60% 不再硬拦，只能用头衔过滤+群策略冷却近似）；
  3. **失去上线补历史**（掉线期间的消息不再补回，重启后可能漏消息）；
  4. **失去 token 防爆破闸**（日唤醒上限/最小间隔/¥8 日花费闸都没有，成本靠模型档位与群限流）；
  5. **失去对话收尾承接**（没有 summary/nextOpening，只能转成记忆条目人工承接）。
- **永久丢失（Aurabot 无等价，完整清单见 API 文档 §5.2）**：12 槽角色快照/回档、B站生物钟·养鱼·观看历史·口味·四类定时动态·定时分享、语音包管理器、桌宠 host API、备份/诊断/组件更新、扩展/平台框架、SnowLuma 自愈、`qq-mode` 命名空间、主人审计流水、黑话自动学习闭环、身份对齐/泄露闸；以及「全量卡 vs 衰减卡」双轨、已读水位/潜水/收尾等会话状态语义。**「真人式分条」不算永久丢失**（Aurabot 有自己的分条策略，见 API 文档 §5.1#20）。
- **已补回**：Token 额度与花费统计（`token-budget` 用户模块，按天统计 QQ/其他、峰谷分时四桶计价、额度/80% 预警/超限暂停回消息、`/budget` 命令），见 [TOKEN-BUDGET-MODULE.md](TOKEN-BUDGET-MODULE.md)；缺的只是 SurfCore「停唤醒」语义。
- **等价或更强**：人格注入（DSH preset 变量，切人格即时生效）、记忆检索（BM25+遗忘曲线+说话人加权）、群聊插话策略、防机器人互聊头衔过滤、按聊天选模型、空间日记、表情包库、生图、主动搭话、全局试运行。
- **协议面损失**：SurfCore 的 42 个 MCP 工具（39 `mcp__snowluma__*` + 1 host + 2 web-search）与 45 个 `/api/socialV2/*` 是它自己的协议面；Aurabot 用 `qq_*` 工具与内部 hub，外部自动化脚本（如果给旧 bridge 写过）会全部失效——本机没有这类外部脚本，影响可忽略。但**旧 preset 提示词/评测集作废**，不能带过去。
- **注意不是所有损失都是「丢掉功能」**：SurfCore 的「模型自主唤醒/潜水/收尾」范式本身被换成了 Aurabot 的「推送式」范式——这是设计选择，需要你确认接受（详见 API 对照文档 §0/§6）。

---

## 11. 风险与注意事项

| # | 风险 | 触发条件 | 规避 |
| --- | --- | --- | --- |
| 1 | **双消费双回复** | bridge 与 Aurabot 同时连 SnowLuma | 必须先停 `surfcore-bridge.service` 再开 Aurabot（Runbook Step 1） |
| 2 | **重启 DSH 中断当前 agent 会话** | `sudo systemctl restart surfcore-dsh` | 在 SSH 终端操作；重启后重新打开 GUI；重要对话先导出 |
| 3 | **SnowLuma 登录态丢失** | 容器重启/掉线/EULA 未同意 | Step 0 恢复；`docker restart snowluma` 后需 VNC 重新登录 |
| 4 | **内存不足** | 两套同时跑（3 GB 总量） | 严格串行；观察 `systemctl status` 的 Memory 与 `free -g` |
| 5 | 工具/提示词协议差异 | Aurabot 用 `qq_*` 工具 + 行/`|||` 分条 + `[沉默]` | 迁完人格后先试运行，调人格里与旧协议冲突的段落 |
| 6 | 依赖 SnowLuma 扩展 action 的功能降级 | 未来换 NapCat/LLOneBot 等标准 OneBot | 本机继续用 Docker SnowLuma；换网关前先验证空间/表情/改资料 |
| 7 | 无 ffmpeg/Chrome/X | 想用 B站抽帧、抖音 | 需要时再装（`apt install ffmpeg`；Chrome+Xvfb） |
| 8 | 模型用量变化 | 每个 QQ 聊天一个 DSH 会话、上下文更大 | 先试运行看日志与 token；用「按聊天选模型」控成本 |
| 9 | 安装网络失败 | GitHub 慢/被墙 | 用本地 clone + `dsh plugin add <路径>`；或 `proxy` 环境变量 |
| 10 | 浏览器面板未实测 | Aurabot 的 client slots 注入在 rc.5 上是否正常渲染（服务端已实测启动） | 第一次打开看是否出现 Aurabot 侧栏与 20 个标签；空白就看浏览器 console，必要时回滚 |
| 11 | 验收期行为差异 | 从「模型自主决定发不发」变成「推送式」；鱼群保护/补历史/收尾/token 闸确定丢失；群聊联网搜索取决于 Step 3 选项 | 必须走 Step 9 试运行，先由主人自己确认接受这个变化再上线 |

---

## 12. 验证清单（上线后逐条打勾）

- [ ] `systemctl status surfcore-dsh` active；`surfcore-bridge` inactive/disabled
- [ ] Aurabot 面板「连接」：状态 connected，登录核对通过（`get_login_info` = 2477094441）
- [ ] OneBot 鉴权两处都通：HTTP（`curl -X POST :3000/get_login_info` 返回 retcode 0）；WS（Aurabot 连上后日志无 401，SnowLuma 侧能看到 Aurabot 的连接）
- [ ] `/aurabot/api/state` 未带 Cookie 时被拒（401/403）——确认面板接口至少不裸奔（未确认项 A-2；若返回 200 需报告）
- [ ] 按 Step 3 方案 A：确认 Aurabot 会话工具面没有 `mcp__*`（含 `web_search`）；按方案 B：确认 `web_search`/`web_fetch` 在 Aurabot 会话里可用
- [ ] 主人私聊：普通对话/带图/引用/语音（若开）都正常，分条自然，不重复
- [ ] 群 `694991842`：@ 必回；无 @ 闲聊按相关度插话；不刷屏；头衔过滤生效（如群里有别的机器人）
- [ ] 人格：说话风格、称呼、梗与旧版一致（抽查 5 轮）；确认没有出现 Markdown/小作文
- [ ] 记忆：能想起导进去的旧事；人物小档案/相处经验在面板可见
- [ ] 权限：非主人私聊被拒；群管/改资料仅主人可用；试运行关闭后确认真正发出
- [ ] SnowLuma 事件只被 Aurabot 消费（无 bridge 进程；`ps` 无 `bridge.js`）
- [ ] 数据目录：`plugins-data/aurabot/` 有 config/personas/memories/logs；重启 DSH 后配置不丢
- [ ] 回滚演练：按 §9 能在一杯咖啡时间内恢复（建议迁移后 24h 内演练一次）

---

## 13. 时间估算

| 阶段（与 API 文档 §7 一致） | 内容 | 预计 |
| --- | --- | --- |
| A 前置（Step 0–1） | 恢复 SnowLuma 登录 + 备份 + 停桥接 | 20–40 分钟（取决于扫码） |
| B 核心切换（Step 2–5） | 装/卸、重启 DSH、配网关 | 15–30 分钟 |
| C 上线验证（Step 6–10） | 人格迁移 + 权限 + 试运行 + 正式上线 | 60–90 分钟 + 24 小时观察 |
| D 上线后补（Step 7 记忆 / 黑话） | 记忆转换（可离线预做）、导入与召回验收（上线后第 1 周）、黑话压缩进人格 | 30–60 分钟 + 1 周验收 |
| E 按需 | B站/语音/空间/表情等 | 每项 10–30 分钟 |

---

## 附录 A：不想点向导？预写 `config.json`（自动化路径）

Aurabot 的 `loadConfig()` 是「读 `config.json` → 用默认值补齐 → normalize」，所以可以在**第一次启动前**直接写好配置，重启后即生效（面板只是同一份配置的 GUI）。适合「写脚本一次到位」：

```bash
AU_DIR=/home/ubuntu/dsh-agentchat/dsh-0.2-home/plugins-data/aurabot
export AU_DIR      # 下面 python 会读这个变量；不写死路径
mkdir -p "$AU_DIR"

# 从 SnowLuma 的 onebot 配置里取两个 token（不同网络各自一份）
python3 - <<'EOF'
import json, os
ob = json.load(open('/home/ubuntu/dsh-agentchat/snowluma/data/config/onebot_2477094441.json'))
http_token = ob['networks']['httpServers'][0]['accessToken']
ws_token   = ob['networks']['wsServers'][0]['accessToken']
cfg = {
  "enabled": False,            # 先关总开关；试运行保持开
  "dryRun": True,
  "setupDone": True,           # 跳过向导
  "botQQ": "2477094441",
  "ownerQQ": "1362431704",
  "ownerName": "主人",
  "gateway": "onebot",         # 接既有 SnowLuma，不管理进程
  "snowluma": {
    "httpUrl": "http://127.0.0.1:3000",
    "wsUrl": "ws://127.0.0.1:3001",
    "httpToken": http_token,
    "wsToken": ws_token
  },
  "allow": {"private": ["1362431704"], "groups": ["694991842"]},
  "model": {"provider": "deepseek-official", "model": "deepseek-flash", "reasoningEffort": "high"}
}
d = os.environ.get('AU_DIR', '/home/ubuntu/dsh-agentchat/dsh-0.2-home/plugins-data/aurabot')
os.makedirs(d, exist_ok=True)
p = os.path.join(d, 'config.json')
json.dump(cfg, open(p, 'w'), ensure_ascii=False, indent=2)
os.chmod(p, 0o600)
print('written:', p)
EOF
```

- 写完后重启 DSH，打开面板核对「连接」页；再在面板里把总开关打开（保持试运行）。
- 注意 `setupDone:true` 会让 Aurabot 走「老用户升级」逻辑，把 `qzoneSocial`/`bili`/`douyin` 三项自动置为关闭（`src/core/config.js` 的 `OPT_IN_ON_UPDATE`）——本期本来就全关，无影响；以后要开 B站/抖音需在面板手动打开。
- 若之前已经启动过 Aurabot（数据目录已有 config.json），用面板改更稳；手工改也行，但要保留文件里已有的其它键（`loadConfig` 会补默认值，但**不要**只写这几个键覆盖掉面板已存的设置——追加合并，或干脆用面板）。
- token 属于凭据：`chmod 600`、不要提交进 git / 不要贴到聊天里。

## 附录 B：本机现状速查（2026-11-03 13:00 前后实测；迁移时以 `systemctl` / `free -g` / `du` 实读为准）

| 项 | 值 |
| --- | --- |
| DSH / node | 0.2.1-rc.5 / v24.19.0 |
| DSH_HOME | `/home/ubuntu/dsh-agentchat/dsh-0.2-home` |
| GUI | https://154.8.153.208:10326/ |
| 服务 | `surfcore-dsh.service`（DSH）、`surfcore-bridge.service`（旧桥，迁移后应停用） |
| SnowLuma | Docker 容器 `snowluma`；OneBot HTTP `127.0.0.1:3000`、WS `127.0.0.1:3001`、WebUI `5099`、VNC `6081` |
| 机器人/主人 | 2477094441 / 1362431704 |
| 白名单 | 私聊 1362431704；群 694991842 |
| 内存/磁盘 | 3 GB（DSH 已用约 1.7–2.0 GB、swap 100–600 MB）/ 剩余 25 GB |
| 已装工具 | node、pnpm、git、python3.12+venv；**无** ffmpeg、Chrome、Xvfb、uv |
| 数据体量 | `dsh-0.2-home/surfcore` 26 MB（backups 24 MB/284 条）；`surfcore/state` 1.1 MB；`sessions/` 16 MB；角色快照 1.7 MB |
| 无关实例 | pid 972 的 DSH（端口 3080，`~/.dsh`，无 surfcore）——不要动 |

---

*本文档由 Lead 汇总两份只读盘点 + 隔离实测证据编写；所有配置键/路由/工具名可在 `docs/work/aurabot-inventory.md` 的 file:line 引用中复核。*
