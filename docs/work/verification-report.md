# 独立核对报告：AURABOT-MIGRATION / AURABOT-API-MAPPING

> 核对人：verifier。核对时间：2026-11-03 13:27–13:55（Asia/Shanghai）。
> 快照（sha256）：MIGRATION=`4839a44f…a05543`（564 行）、API-MAPPING=`b02cbaf7…713a081`（444 行）、mapping-matrix=`ec174b55…8f8e01e`。**两份正式文档在核对期间被 Lead 改过两次（13:28/13:34），本报告以该快照为准；行号可能漂移，以引文定位。**
> 方法：回源码/生产环境只读核对（`/tmp/aurabot-qq-probe@b3301f6`、`‹老仓库›`、`dsh-0.2-home`、systemd、SnowLuma 容器、隔离 `DSH_HOME=/tmp/dsh-aurabot-compat`）。未改正式文档、未装/重启生产、未发 QQ。
> 结论统计：**阻断级 1 条 FAIL**；事实错误 12 条 FAIL + 1 条 UNVERIFIED；一致性冲突 4 条 FAIL；建议改进 12 条（D-1…D-12，其中 D-12 为 UNVERIFIED）；环境/数据/命令类 20 余项 PASS。安全：两份正式文档 + 4 份底稿**均无明文凭据**（与真实 accessToken/console-token/WebUI 密码比对 0 命中）PASS。

## A. 阻断级错误（照文档操作会直接搞坏迁移）

- **A-1 FAIL｜Step 3 方案 A「整段删除 `# === qq-bridge MCP BEGIN === … END ===` 区块」会连带删掉 LLM 模型配置。**
  证据：`dsh-0.2-home/profiles/web/cordis.patch.yml:1-50`，BEGIN(`:1`)/END(`:50`) 之间不只有 3 个 MCP `insert`（`:3-30`），还有 **`llm-deepseek`（`:31-42`）和 `agent-default-model`（`:43-48`）**。删整段后 DSH 无 DeepSeek provider/默认模型，Aurabot（model 跟随 DSH）私聊/群聊全部无法推理。
  修正：MIGRATION §6 Step 3「A（推荐）」改为「只删除 `mcp-snowluma`、`mcp-snowluma-host`、`mcp-web-search-safe` 三个 `insert:` 块；**保留** 同区块内的 `llm-deepseek` 与 `agent-default-model`（不是 MCP）」；并把副作用说明补上「整段删会丢模型配置」。

## B. 事实错误

- **B-1 FAIL｜Aurabot 工具数：文档写「46 个模块工具 + 3 个联动 = 49」，实际 45 + 3 = 48。**
  证据：`grep defineTool src/modules --include=*.js` = 45 个唯一工具名（stickers 7 / qq-tools 3 / group-admin 1 / memory 2 / imagegen 1 / diary 1 … 合计 45）；`src/core/bridge.js:100-115` 另有 3 个跨会话联动 `aurabot_*`。`weather_now` 只是 `src/modules/API.md:248` 的示例，源码未实现。
  位置：API §0 表（16 行）、§1.3（76 行）、§4.1 标题（263 行）、§4.5（332 行「≤46+3」）、§5.1 #22（390 行）。
  修正：各处改为「**45 个模块工具 + 3 个联动 `aurabot_*` = 48 个工具名**」；§4.1 末尾「Aurabot 另有…weather_now 等」删 `weather_now`。

- **B-2 FAIL｜`/api/socialV2/*` 写「46 个」，实际 45 个。**
  证据：`dsbot/src/bridge.js` 中 `url.pathname === '/api/socialV2…'` 去重 45 条；`/api/images/message`（`:8004`）属于 `/api/images/*`，不是 socialV2；无动态 socialV2 路由。
  位置：API §1.3（77 行）、§4.3（318 行）、MIGRATION §10（450 行）均写「约 46」。
  修正：统一改「45 个」（或「约 45」）；mapping-matrix 的 46 一并改。

- **B-3 FAIL｜Step 3 表对 3 个 MCP server 的依赖判断不准。**
  证据：`src/mcp-snowluma-safe.js` 39 个工具中 **35 个走 bridge 控制台 :3100**（`agentApi()`，`:109,181`），**4 个直连 SnowLuma HTTP :3000**（`qq_status`/`qq_list_groups`/`qq_get_group_members`/`qq_get_group_history`，`onebot()`）；`src/mcp-host-server.js:48` 的 `snowluma_status` 也直连 :3000。
  位置：MIGRATION §6 Step 3 表（221-223 行）。
  修正：「snowluma」行为「35 个二代状态/发送类走 3100（停桥后失效）；4 个只读查询直连 3000（仍可用，但 Aurabot 不需要）」；「snowluma-host」改为「直连 3000，**迁移后仍可用**（可保留作探活）」。

- **B-4 FAIL｜「42 个 `mcp__snowluma__*`」表述错误。** 42 = 3 个 server：39 个 `mcp__snowluma__*` + 1 个 `mcp__snowluma-host__snowluma_status` + 2 个 `mcp__web_search_safe__*`（`src/mcp-snowluma-safe.js:366+`、`mcp-host-server.js:74`、`mcp-web-search-safe.js:52-141`）。
  位置：MIGRATION 64 行/448 行、API 16 行。修正：改为「42 个 MCP 工具（39 snowluma + 1 host + 2 web-search）」。

- **B-5 FAIL｜DSBot 桌宠接口「14 条」不对。** `/pet-api/*` 实际 12 条（11 个静态 suffix + 动态 `/audio/<key>.wav`，`lib/pet-api.js:124-214`）；设置页 `/pet/*` 11 条（`lib/index.js:2019-2126`）。
  位置：API §4.2（307 行「14 条 x-pet-token」）、§5.1 #7（375 行「桌宠 host API（14 条）」）。修正：pet-api=12、/pet=11。

- **B-6 FAIL｜「DSBot 14 tab」与其下 15 行表不符，且「记忆卡」不是独立 tab。** 实际 TABS 14 项（`plugins/‹合体插件›/lib/client.js:5104-5119`）：概览/角色/目的/QQ/语音/桌宠/B站/Token额度/观看历史/记忆/对齐/扩展/全部参数/**诊断**；「记忆卡」在「记忆」页内（`MemoryCardPanel` 由 `MemoryTab` 渲染，`client.js:3957-3960,3040`）。
  位置：API §1.1 标题（27 行）与行 11/15。修正：标题改「DSBot 14 tab（诊断是第 14 个 tab；记忆卡在『记忆』页内）」，或把 15 行改称「15 个设置栏目」。

- **B-7 FAIL｜hook 计数：「11 hooks」「9 个只读」均与源码不符。** `src/modules/API.md:183-267` 列出 10 个可改写 hook（message/poke/reply/group/decide/prompt/reply/items/send/model/persona/rules）+ **7 个只读**（activity/onebot/onebot/state/config/module/start/module/stop/song/sung）。
  位置：API §1.3（81 行「11 hooks」）、§4.7（345 行「9 个只读」）。修正：改「10 个可改写 hook + 7 个只读事件」。

- **B-8 FAIL｜「插件内 40 个测试脚本」不对。** `plugins/‹合体插件›/scripts/` 共 42 个文件：36 个 `test-*.mjs` + 6 个 `ui-*.mjs`。
  位置：API §4.4（324 行）。修正：「36 个测试脚本（scripts/ 共 42 个）」。

- **B-9 FAIL｜`tools/bili.mjs`「50 子命令」不对。** 命令表实测 46 个（读 32 / 写 12 / 排查 2，`tools/bili.mjs` 的 `map`）。
  位置：API §1.3（78 行，无「约」）、§4.4（324 行「约 50」可接受）。修正：46（或「约 46」）。

- **B-10 FAIL｜`social-v2.json` 取值路径少一层 `conversations`。** 实际结构 `{conversations:{"private:1362431704":{…},"group:694991842":{…}},paused:false}`；`private:1362431704` 不是顶层键。另：「closure（private/group）→ 2 条记忆」不成立：私聊与群各有一份 `summary`+`nextOpening`，都转则 4 条（私聊 closure 实测 `summary:"主人又想用命令设定11.4交作业提醒…"`、`nextOpening:"下次他来说话，开头先催一句11.4的作业"`；群 closure 亦有两条）。
  位置：MIGRATION §7（324-327 行）、API §3.5（254-255 行）。修正：路径写 `conversations["private:1362431704"].activeTopics[0]`；closure 条数写 2（仅私聊）或 4（私聊+群）。

- **B-11 FAIL｜Step 4「journalctl … | grep -iE 'aurabot|error|fail'」看不到 Aurabot 日志。** 单元把输出重定向到文件：`/etc/systemd/system/dsbot-dsh.service` 有 `StandardOutput=append:/home/ubuntu/dsh-agentchat/logs-dsbot-dsh.log`（`StandardError=` 同文件）；实测 `journalctl -u dsbot-dsh` 只有 systemd 的 Started/Consumed 行，插件/Aurabot 日志全在 append 文件。
  位置：MIGRATION §6 Step 4（238、243 行）。修正：改为 `tail -n 100 /home/ubuntu/dsh-agentchat/logs-dsbot-dsh.log | grep -iE 'aurabot|error|fail'`；**注意该文件内有一行 `dsh web: https://…/?token=***`，贴日志前必须脱敏**。

- **B-12 FAIL｜「WebUI 5099 走面板 `/vnc`」不成立。** `profiles/web/cordis.patch.yml` 的 dsh-secure-proxy 只把 `/vnc` 代理到 `127.0.0.1:6081`（VNC），没有 5099 挂载；WebUI 只能 SSH 隧道（`ssh -L 5099:127.0.0.1:5099`）或本机访问。另 `docker logs --tail 300 snowluma | grep …password` 会随 QQ 日志增长失效（当前容器日志 31,829 行，本次凭据行在 31,809；启动后约 30 分钟就可能被挤出 tail 窗口）。
  位置：MIGRATION §5（125-127 行）。修正：「WebUI 5099 用 SSH 隧道（面板 `/vnc` 只代理 VNC 6081）」；密码取法改 `docker logs snowluma 2>&1 | grep -i "initial credentials" | tail -1`。

- **B-13 UNVERIFIED｜「aureth-labs 与上游 refs/heads/main 同一 commit」。** 本机网络受限（`git ls-remote` 超时），无法独立对比上游。旁证（未达 PASS）：probe HEAD=`b3301f6b014016e141c07d266a716c0fea566aab`；`/tmp/aurabot-compat-add.log` 显示 `codeload.github.com/aureth-labs/…/tar.gz/b3301f6…`（1273 KiB，1m13s）；compat 安装包与 probe 源码 `diff -rq` 无差异。建议：Lead 保留一次 `git ls-remote` 原始输出作证据；文档把「逐字节同一」降为「同一 commit sha（已拉取对照）」。

## C. 正式文档/矩阵之间的结论冲突

- **C-1 FAIL｜「4 个可感知降级」两份文档口径不同。** MIGRATION §10（443-447 行）：群聊联网搜索 / 鱼群保护 / 上线补历史 / token 闸；API §5.2 尾注（400 行）：token 闸 / 补历史 / 鱼群 / **对话收尾**；且 MIGRATION TL;DR（19 行）列了 5 项（含对话收尾）与 §10 的 4 项自相矛盾。
  修正：统一为 5 项（把「群聊联网搜索」也列入），并在 API §5.2 尾注同步；或按 API 4 项 + 在 §10 注「联网搜索是否仍存在取决于 Step 3 是否保留 web-search MCP」（见 D-3）。

- **C-2 FAIL｜分期编号/记忆导入时机冲突。** API §7：第 0 步=恢复登录，**P0=QQ 核心（不含记忆）**，P1=记忆导入（进入条件「P0 稳定 ≥3 天」）；MIGRATION §13：**P0=前置（恢复登录+备份）**、P1=核心切换、P2=人格+记忆+权限（上线前，Step 6-8）、P3=试运行。同名 P0/P1/P2 指不同阶段，且记忆迁移一份在上线前、一份在上线后。
  修正：统一编号（建议用 Runbook 的 Step 1-10 + 「上线后 P1」描述），并二选一：记忆转换可离线预做、导入/验收放上线后 P1（推荐，避免阻塞首发）。

- **C-3 FAIL｜「永久丢失」清单不一致（两文档 + 矩阵）。** MIGRATION §10（448 行）含 token 额度闸门/桌宠 host API/备份诊断/扩展平台/qq-mode/桥接自愈/真人式分条节奏；API §5.2（394-398 行）5 条未含这些，却含「记忆卡全量卡机制、token 逐轮账本」而 MIGRATION §10 未列（只在 TL;DR 提「记忆卡衰减压缩」）。
  修正：合并为一张清单，分「能力型永久丢失」与「数据/机制型永久丢失」两组，两份文档互相引用同一表；「真人式分条」在 API §5.1 #20 是「体验下降+部分替代」，不应同时列为永久丢失（择一）。

- **C-4 FAIL｜交叉引用错。** MIGRATION §5（151 行）「决定 MCP 区块处理（见 §6 Step 4）」应为 **Step 3**（MCP 区块在 Step 3，Step 4 是重启 DSH）。其余 § 引用均有效（MIGRATION→API §0/§2/§3.5/§5/§6；API 内部 §1/§2.3/§2.4/§3.2-3.5/§4.1/§6 均存在）。

## D. 建议改进 / 口径说明（非错误）

- **D-1 PASS（口径）｜「74 条路由」可复现但需注明范围。** 实测 `route()` 路径 69 个 + `/open/*` 5 个 = 74（`src/host.js:311,999-1006`）；模块路由（`/memories`、`/voice/*`、`/pet/*`、`/bili/*` 等）经 prefix 路由动态分发，**未计入 74**。建议写「启动时核心路由 74 条（69 直接 + 5 /open），模块路由另计」。
- **D-2 PASS（口径）｜「138 个 /api/*」是字面量计数，非精确端点数。** grep 可复现 138 个不同 `/api/*` 字面量，但其中 7 个是前缀/动态基串（`/api/send/`、`/api/socialV2/`、`/api/slang/batch-`、`/api/tokens/`、`/api/voice/packs/`、`/api/stickers/`、`/api/images/`），精确 `pathname ===` 去重 131 条；动态子路由（voice/packs、slang/batch-*、tokens/*）未逐个计入。建议措辞「约 140 个 `/api/*` 路由（含前缀族）」。
- **D-3 重要建议｜保留 MCP 区块会让 Aurabot 的 QQ 会话也看到这些 profile 级工具。** 本会话（非 qq-chat preset 的 agent）工具列表里就有 `mcp__snowluma__*` 与 `mcp__web_search_safe__*`，证明 root 级 MCP 工具对所有 agent 可见（DSBot qq-chat-v2 preset 也不自带 MCP client 却能调 `mcp__snowluma__*`，同理）。因此：① Step 3「这是 DSH agent 侧工具，与 QQ 机器人本体无关」不准确；② 若选方案 B 保留 `mcp-web-search-safe`，Aurabot 群聊**也会有** web_search，与 API §6「social preset 没有联网工具，做不到」冲突。建议 Step 3 明确「保留 = Aurabot 会话也可见；方案 B 需在 §12 验收加『确认 Aurabot social/private 会话工具面无 mcp__*』」，或默认只保留 `snowluma-host` 探活。
- **D-4 PASS（口径）｜`--dump-config-schema` 的「告警」实为 error 且退出码 1。** 实测 compat profile：`dsh: error: [/187-/190, /192-/194] unrecognized Loader tree carrier`，7 条（4 条纯 base+web-app profile 可复现，3 条来自 Aurabot preset），exit=1。MIGRATION §4.6 写「已知无害告警」建议改为「报 `dsh: error` 且 exit 1，属 schema 投影限制，不影响启动（已实测启动成功）」。
- **D-5 PASS（需标注时效）｜环境数值为时间点数据。** 现测：DSH 内存 1.7G（peak 2.2G）、swap 已用 **603 MB**、`sessions/` **16 MB**、snapshots **1.7 MB**（文档分别写 ~1.9GB/~100MB/14MB/1.5MB）。建议在附录 B 标注「实测于 13:00，迁移时以 systemctl/free/du 实读为准」。
- **D-6 PASS｜命令/路径类逐项核对通过。** 备份命令 5 个源路径全部存在（`profiles/web/{package.json,cordis.patch.yml,pnpm-lock.yaml}`、`dsh-home/dsbot`、`dsbot/{state,config.json,roles}`）；systemd 两单元存在，`Restart=always`+`DSBOT_SKIP_AUTOSTART=1` 属实且代码 `lib/index.js:623` 尊重该变量；`dsh plugin --help` 语义（转发 pnpm、`--profile` 必填、add/remove 合法）✓；`DSH/NODE/PATH` 三个路径存在（pnpm 10.34.5）。
- **D-7 PASS｜附录 A 预写 config.json 脚本可跑。** 在 `/tmp/dsh-aurabot-compat` 实跑（仅改目标目录）：生成 556 B、`python3 -m json.tool` VALID、chmod 600；用 `loadConfig()` 读回：gateway=onebot、两 token 就位、allow/ownerQQ/botQQ 正确、五个二期模块默认 false。小问题：① shell `AU_DIR` 与 python 内硬编码 `d` 重复，改 `AU_DIR` 不生效 → 建议 `d = os.environ.get('AU_DIR', …)`；② `setupDone:true` 会触发 `OPT_IN_ON_UPDATE` 把 `qzoneSocial/bili/douyin` 强制 enabled=false（`src/core/config.js:506-508`），建议在附录 A 注明「空间互动会被自动关，需在面板重开」。
- **D-8 PASS｜SnowLuma 登录态故障属实。** 容器 `awaiting EULA/PRIVACY consent`、`awaiting login: PID=80`；`curl :3000/get_login_info` 连上即 reset（HTTP=000，带/不带 token 均如此）；bridge 进程仍在跑（pid 2091）。TL;DR「最大前提」判断正确，迁移第 0 步必须先恢复登录。
- **D-9 PASS（安全）｜无明文凭据。** 两份正式文档与 4 份底稿未出现真实 accessToken/console-token/WebUI 密码（与 3 个真实值比对 0 命中，敏感值均 `***`）；本报告同样不含明文。注意：`logs-dsbot-dsh.log`/`docker logs` 本身含凭据，引用时须脱敏（见 B-11/B-12）。
- **D-10 PASS｜其余环境事实。** 端口 3000/3001/3100/3102/5099/6081/3080 在听；pid 990(DSH)/2091(bridge)/972(无关 DSH :3080) 属实；`astrbot.service` inactive(dead)；无 ffmpeg/Chrome/Chromium/Xvfb/uv，python3.12+venv 可用；DSH 0.2.1-rc.5 / node v24.19.0；磁盘 40G 剩 25G；profile bundles 含 dsbot、3 个 MCP、`dsh-tide-badge`/`dsh-codex-media` 等（`dsh-secure-proxy` 是依赖+patch 行而非 bundle，MIGRATION 245 行措辞可改「其它依赖/bundle」）。
- **D-11 PASS｜数据/计数核对。** 42=39+1+2 ✓；303 条（`memory-card.json` 357,366 B、`memory-card-full.jsonl` 247,994 B/303 行）✓；persona 3880 B 且与 `roles/原装-大肥鱼.md` 逐字节相同（`cmp` 通过）、正文无 qq_/mcp__/token 引用 ✓；roles 99 / roles-full 27 ✓；slang 247（128,967 B）✓；人物卡 1150 字 ✓；DSH_HOME/dsbot 26M（backups 24M/284 条）、state 1.1M ✓；social-v2 77KB、sessions.json 322B、token-usage.jsonl 177,032B、tool-calls.jsonl 234,501B、purpose-outreach 661B、inbox 112,165B、bili.config 3,097B、stickers 空 ✓；均长 12.7 字、最长 254、1 条 >200、speaker 165/81/33/13、kind 164/133/4/1/1、isSelf 81、source 165/81/57 ✓；token 用量 qq ¥0.8667/30.15M ✓；mode=reserved2、ownerQQ/allow/deny、dsh provider/model/high、tokenGuard 20/10/¥8、history 30/720、fishGuard 5/0.6/blockSends、slang injectMax8、closure 20min、webSearch maxUses5 等配置值全部一致 ✓。
- **D-12 UNVERIFIED｜未实测项与文档一致（PASS）。** A-1（WS `?access_token=`）、A-2（`/aurabot/api/state` 鉴权）、浏览器面板渲染、SnowLuma 扩展 action（`add_custom_face`/`send_qzone_msg`/`set_qq_profile`/`fetch_ptt_text`）本机支持性——均因 QQ 未登录/未启动隔离实例而无法实测；文档已按「未确认项」标注（A-1/A-2、风险 10），本报告确认这些标注诚实，不额外扣分。隔离实例 `/tmp/dsh-aurabot-compat` 未启动（3.6G 内存现用 2.0G+swap 603M，避免影响生产 DSH），故 A-2 未补测。

## E. 建议修正顺序（给 Lead）
1. 先改 A-1（否则 Runbook 会删模型配置）。
2. 再改 B-1/B-2/B-3/B-4（11 处计数/工具面，最易被读者当事实引用）。
3. 统一 C-1/C-2/C-3 与 C-4 的交叉引用，避免两份文档互相打脸。
4. 其余 B-5…B-12、D-1…D-11 按节顺手改；B-13、D-12 保留 UNVERIFIED 标注即可。
