# Aurabot（dsh-aurabot-qq）能力 / 配置 / 接口 / Linux 可行性 事实清单

> 用途：把线上 QQ 机器人从 DSBot 切到 Aurabot（目标形态 D）时，本文作为 Aurabot 侧的事实底稿。
> 只读盘点，未安装、未运行任何 setup/install/probe 脚本、未执行 npm test、未改任何代码或配置。
>
> 证据仓库：`/tmp/aurabot-qq-probe`（origin `https://github.com/aureth-labs/dsh-aurabot-qq.git`，HEAD `b3301f6`，2026-10-31，193 个文件）
> DSH 侧证据：`/home/ubuntu/dsh-agentchat/dsh-0.2-trial/node_modules/@deepseek-ai/*`（`@deepseek-ai/dsh` 版本 **0.2.1-rc.5**），下文简称 `DSH:`。
> 引用格式 `路径:行号`；仓库内路径相对 `/tmp/aurabot-qq-probe`。敏感值已掩码为 `***`。

## 0. 结论速览

| 项 | 结论 |
|---|---|
| 包身份 | 单包 `dsh-aurabot-qq@1.1.24`，`type: module`，入口 `src/host.js`，**零 npm 运行时依赖**（`package.json` 无 `dependencies`，只有 `engines.node>=22.13.0` + 测试脚本）— `package.json:1-58` |
| 形态 | 一个 bundle：插件本体 `aurabot` + **3 个 agent preset**（`aurabot-private` / `aurabot-private-long` / `aurabot-social`）— `cordis.patch.yml:9-143` |
| 上游关系 | 仓库内所有安装命令/仓库字段仍指上游 `accomplish07zrh-eng/dsh-aurabot-qq`（`package.json:52-54`、`README.md:33,39,62`）；本地 clone 的 origin 是 `aureth-labs/…`，内容一致（同一 HEAD）。**安装命令必须改写为 aureth-labs**（见 §1.2） |
| Linux 可行性 | **核心聊天链路可用**（gateway=onebot）；语音 TTS 可用（需 python3-venv/uv）；B站/小黑盒/空间可用；抖音需非 headless 浏览器（服务器要 Xvfb）；**RVC 翻唱 = Windows-only**；桌宠可装 Electron 但桌面行为/窗口清单是 Windows-only；SnowLuma 进程管理/注入 = Windows-only（Linux 不用它） |
| 接既有 Docker SnowLuma | `gateway:"onebot"` + `snowluma.httpUrl=http://127.0.0.1:3000` + `snowluma.wsUrl=ws://127.0.0.1:3001` + 两个 accessToken（配置键在 `snowluma.*` 下，哪怕 gateway=onebot）— `src/host.js:92-102`、`src/core/config.js:20-41` |
| DSH 0.2.1-rc.5 兼容性 | **静态核对通过**：所用服务（webServer/systemPrompt/workspaceRegistry/sessionController/llm/attachments/speechToText/tools）、`ctx.effect/interval/get/on`、client `slots`（`main`、`sidebar.panellist`）、`dsh.bundle.patch`、`dsh.client.inject/external`、`github:` 安装 spec 在 rc.5 中均存在（证据见 §1.3）。**未实机安装验证** |
| 最大坑 | ① 默认「总开关关 + 试运行开」，不改配置一句不发（`src/core/config.js:10-11`）；② 与 DSBot bridge 同时连同一 OneBot = 双消费；③ 空间/表情包/改资料依赖 **SnowLuma 扩展 action**（非标准 OneBot v11），换网关会降级（§10 风险 5）；④ 面板装完插件必须重启 DSH（`README.md:42`） |

## 1. 安装 / 运行要求与 Linux 可行性

### 1.1 包与 bundle 声明

- `package.json:8` `main: src/host.js`；`:9-14` exports（`.`、`./client`、`./cordis.patch.yml`）。
- `package.json:18-31` `dsh.bundle.patch: ./cordis.patch.yml`；`dsh.client`：`platform: web`、`inject: ["slots"]`、`external: ["react"]`。
- `package.json:38-49` 发布文件含 `extensions/ src/ client/ personas/ assets/`；`:50-54` repository/homepage 指上游；`:55-57` `engines.node >= 22.13.0`。
- `cordis.patch.yml:9-13` 先 `insert` 插件本体 `aurabot`（`name: dsh-aurabot-qq`）；`:12-62` `preset-aurabot-private`；`:63-118` `preset-aurabot-private-long`；`:119-143` `preset-aurabot-social`。
  - 三个 preset 都挂 `@deepseek-ai/dsh-persona`，`prefix: "{{aurabot_persona}}\n\n{{aurabot_rules_private|social}}"`、`complete: true`（人格独占系统提示词）— `cordis.patch.yml:20-26,71-77,127-131`。
  - 工具差异：private/private-long 有 bash/pwsh/fs/fs-search/web（bash 与 pwsh 按 `process.platform` 互斥，`cordis.patch.yml:29-34,80-85`）；私有长任务版另加 `tool-jobs`+`tool-schedule`（`:114-118`）；social 只有 persona + time-context + compaction（`:127-143`）。
  - ⚠ `README.md:69` 说「两个 preset」，实际 **3 个**；且 `aurabot_private_long` 只由 `cfg.longTasks` 打开（`src/chat/access.js:36-39`）。

### 1.2 安装命令（迁移时按此写）

仓库文档里的命令全部指上游，迁移到 aureth-labs 时要替换：

```bash
# README.md:39 原文：github:accomplish07zrh-eng/dsh-aurabot-qq
dsh plugin --profile web add github:aureth-labs/dsh-aurabot-qq
```

- DSH 侧 `github:` spec 由 plugin-manager 解析（`DSH:dsh-plugin-manager/lib/index.js:1168`），包必须声明 `dsh.bundle`（同文件 `:336,1866`），否则只当普通依赖装、**不会成为 profile layer**。
- 本机现有 profile 形态可参考：`/home/ubuntu/dsh-agentchat/dsh-0.2-home/profiles/web/package.json`（dependencies + `dsh.profile.bundles` 列表，当前含 `dsbot` link）。
- 升级=再跑一次 add + 重启 DSH（`README.md:57-63`）；数据目录不动（`README.md:59,121`）。

### 1.3 DSH 0.2.1-rc.5 兼容性核对（静态）

插件从宿主取的服务：`export const inject = ['agents','sessions','webServer','timer','workspaceRegistry','attachments','systemPrompt','llm']` — `src/host.js:36`；另用 `ctx.get('sessionController')`、`ctx.get('speechToText')`（`src/chat/hub.js:215,956`、`src/modules/voice/index.js:62`）。

| 插件用法（证据） | rc.5 中是否存在（证据） |
|---|---|
| `ctx.webServer.register({kind:'exact'\|'prefix', path, handler})` — `src/host.js:311-341` | ✅ `WebRouteKind = 'exact' \| 'prefix'`、`class WebServer` — `DSH:dsh-host-webserver/lib/types/index.d.ts:32,129-152` |
| `ctx.webServer.port` — `src/host.js:358` | ✅ `get port(): number \| undefined` — 同上 `:152` |
| `ctx.systemPrompt.variable(name, fn)` — `src/host.js:71-85` | ✅ `variable(...)` — `DSH:dsh-system-prompt/lib/types/index.d.ts:293` |
| `agent.ctx.systemPrompt.context(...)` — `src/chat/hub.js:404` | ✅ `context(...)` — 同上 `:269` |
| `workspaceRegistry.list()/create(path,title)/archivedSessionIds` — `src/chat/hub.js:195-215,268` | ✅ `DSH:dsh-workspace/lib/types/index.d.ts:81-82,146,172` |
| `sessionController.create({workspaceId, agentPreset})` / `.rename` / `.resolveAgent` — `src/chat/hub.js:215-243,255` | ✅ `DSH:dsh-api-session-controller/lib/types/index.d.ts:18,101,156` |
| `agents.selectForNextRequest(agent, sel)` 或 `agent.session.append('model/selection')` — `src/chat/hub.js:334-336` | ✅ `DSH:dsh-api-session-controller/lib/types/agent.d.ts:142`；session 事件表含 `model/selection` |
| `agent.ctx.tools.register / restrict` — `src/chat/hub.js:360,395` | ✅ `DSH:dsh-tools/lib/types/index.d.ts:34` 提供 `tools: ToolRuntime` |
| `ctx.on('tools/pre-execute')` — `src/host.js:348-349` | ✅ `DSH:dsh-tool-jobs/lib/index.js:235` |
| `ctx.on('session/event')` — `src/host.js:378` | ✅ `DSH:dsh-agent-preset-registry/lib/types/index.js:82` 等 |
| `ctx.llm.listProviders()/listModels()` — `src/host.js:198-213` | ✅ `DSH:dsh-llm/lib/types/index.d.ts:281,367` |
| `dsh.attachments` 存图 — `src/core/img.js:118`、`src/chat/hub.js:1381` | ✅ `DSH:dsh-attachment/lib/types/index.d.ts:14` |
| `dsh.get('speechToText')` — `src/chat/hub.js:956` | ✅ `DSH:dsh-experimental-speech-to-text/lib/types/index.d.ts:9` |
| client `dsh.client.inject/external`、`__ModuleLoader__` | ✅ `DSH:dsh-client-modules/lib/index.js:67-68` |
| client 注册 `slots.inject('main')` / `slots.register({name:'main',key})`、`sidebar.panellist`（id/order/label）— `client/client.js:3421-3426` | ✅ catalog：`main`(keyed，`key` 必填)、`sidebar.panellist`(list，`id` 必填) — `DSH:dsh-cordis-client-runner/lib/client.js:4365-4400,5747-5770` |
| `cordis.patch.yml` / `dsh.bundle.patch` | ✅ `DSH:dsh-plugin-manager/lib/index.js:2405` 读 profile 的 `cordis.patch.yml`；`:339` `bundlePatchPaths` |

结论：**没有发现必需 API 缺失**；但仓库**未声明最低 DSH 版本**（无 `peerDependencies`、README/CHANGELOG 未写版本门槛），实际能否在 rc.5 加载 = 未实机验证（见 §11 U1）。

### 1.4 Windows-only / 平台相关能力清单（证据）

| 能力 | 平台事实 | 证据 |
|---|---|---|
| SnowLuma 进程管理 + 注入 | 只认 Windows 安装目录（`index.mjs`、`node.exe`），`spawn(..., {windowsHide:true})`，注入前用 `netstat -ano -p TCP` + `powershell.exe` 查进程 | `src/snowluma/manager.js:27-42,261-280,426-430` |
| SnowLuma 注入校验 | 只注入 `/api/processes` 里 `account.uin` == botQQ 的 QQ 进程（`hookAutoLoad` 永远关） | `src/snowluma/manager.js:5,323-330,376-394` |
| 语音 Windows 兜底 | `windowsSynth()` 用 `powershell.exe` + System.Speech，仅 win32；引擎选择里 `auto` 在非 Windows 上退到 edge-tts / 本地接口 | `src/voice/tts.js:3,17,146-156,213-248` |
| uv 自动下载 | 仅 Windows 用 PowerShell 下 uv；Linux/macOS **只找已装好的**（`~/.local/bin/uv`、`~/.cargo/bin/uv`） | `src/voice/tts.js:108-127` |
| edge-tts | 跨平台；venv 路径 `Scripts/python.exe`(win) vs `bin/python`；Linux 需能 `python3 -m venv`（或 uv） | `src/voice/tts.js:14-19,73-102`；`README.md:52` |
| RVC 翻唱 | **Windows-only**：环境内 `env/Scripts/python.exe`、下载 `uv.exe`/`uv-…-win_amd64.whl`、安装目录只认 `X:\Aurabot\rvc` 盘符路径 | `src/song/studio.js:38,59-66,147-149,225,234-250,565-590`；`README.md:54` |
| 桌宠 Electron | 客户端安装跨平台（win32/darwin/linux 都拼 URL、unix 恢复可执行位），但**桌面窗口/图标行为走 PowerShell + Win32**，文档示例只写 Windows | `src/modules/pet/index.js:656-760`；`src/modules/pet/pet-client/main.js:545,630,1068,1280,1587`；`src/modules/pet/pet-client/README.md:7`；`docs/PET_MODULE_API.md:172` |
| 抖音浏览器 | 启动 **不带 headless**（窗口放屏幕外 `--window-position=-2400,-2400`），Linux 需有 X（Xvfb） | `src/douyin/browser.js:3,11-26,145-165`；`README.md:53` |
| B站抽帧 | 可选，依赖 ffmpeg（PATH / `/usr/bin/ffmpeg` 等），非必需 | `src/core/img.js:9-21`；`src/bili/vision.js:96-99` |
| 小黑盒 | 纯 HTTP + Cookie（pkey 必需），无浏览器依赖 | `src/heybox/api.js:133-192` |
| 平台判断总计 | `src` 里 `process.platform` 只出现在 7 处（tts/img/pet/douyin/paintings/codex-auth），没有硬编码 `win32` 才能启动核心 | `grep -rn process.platform src`（见 §1.4 各行） |

## 2. 数据目录布局（`<DSH_HOME>/plugins-data/aurabot/`）

根路径：`process.env.AURABOT_DATA_DIR` 覆盖，否则 `DSH_HOME`（默认 `~/.dsh`）+ `plugins-data/aurabot` — `src/core/store.js:7-15`。本机 `DSH_HOME=/home/ubuntu/dsh-agentchat/dsh-0.2-home`，即迁移后为 `…/dsh-0.2-home/plugins-data/aurabot/`。
写入方式：UTF-8 无 BOM、`file.tmp-<pid>` 再 rename（原子写）— `src/core/store.js:22-37`。

| 路径 | 谁写 / 谁读 | 格式 / 说明 | 证据 |
|---|---|---|---|
| `config.json` | 面板 `/save`、模块 `api.setConfig` 写；全插件读 | §3 配置模型 | `src/core/config.js:498-516` |
| `avatar.img` | 面板头像上传写；面板读取 / 同步 QQ 头像 | 原始图片字节 | `src/host.js:1031-1068` |
| `personas/*.md` | 首次启动从 `personas/` 播种；面板编辑写 | Markdown，可带 `--- name/tags ---` 头；当前人格正文进 `{{aurabot_persona}}` | `src/persona/personas.js:1-80`；`src/host.js:68,75` |
| `memories.json` | 记忆模块读写 | `{ items:[{id,text,about,aboutName,tags,importance,source,chatId,at,hits,invalidAt?}], profiles:{qq:{text,name,at}}, styles:{key:[…]}, rev }`；上限 3000 条 | `src/features/memory.js:172-190,351-371` |
| `chatlog/YYYY-MM-DD.jsonl` | 聊天中枢每条进出消息追加；启动追 14 天、记忆整理读 | 每行 `{t,chatId,who,uid?,text}` | `src/chat/hub.js:166-191` |
| `sessions.json` | 聊天中枢维护 chatId→DSH 会话 | `{ chats: { '<chatId>': {sessionId,preset,level,createdAt,title,model?} } }` | `src/chat/hub.js:59-61,227-243` |
| `mutes.json` | `/silent` 等命令写；发送前读 | `{ chatId: 到期时间戳 }` | `src/chat/commands.js:69-88` |
| `stickers/index.json` + `collected-<md5>.<ext>` / `manual-<md5>.<ext>` | 表情包模块读写 | 库项 `{md5,file,name,tags,from,at,width,height,bytes,emojiId,summary}`；上限 `maxLibrary` 默认 300 | `src/features/stickers.js:12-13,123-130,168-178,199-206` |
| `sticker-stash.json` | 偷表情「她挑/只听主人的」模式暂存 30 分钟 | `{ chatId: {at,segs[]} }` | `src/chat/hub.js:80-118` |
| `recent-media.json` | 每个聊天最近 6 张图短期引用（30 分钟） | `{ chatId: {at, images[]} }` | `src/chat/recent-media.js:7-34` |
| `friend-requests.json` | 好友申请缓存 | 最多 50 条，面板「权限」页读取 | `src/modules/contacts/index.js:53` |
| `mood.json` | 心情模块 | 心情值/历史/半衰期状态 | `src/features/companion.js:68` |
| `speakup.json` | 主动搭话 | 上次搭话/计数 | `src/features/companion.js:144` |
| `diary.json` | 空间日记 | `{ plan:{day,times,done}, history:[{at,text,ok,tid,dryRun,visibility,target_uins,error}] }`（history 最多 100） | `src/features/qzone.js:30-32,180-181` |
| `qzone-social.json` | 空间互动 | 浏览/互动进度 | `src/features/qzone-social.js:56` |
| `bili.json` | B站模块 | `{day,runs,comments,replies,lastRun,lastReplyCheck,seen:[bvid],repliedFeed,history}` | `src/bili/duty.js:46-48,199-201` |
| `bili-shots/` | B站抽帧截图库（默认留 300 张） | 图片文件 | `src/bili/shots.js:11` |
| `imagegen/` | 生图画作（`savePainting`）+ 面板图库 | 图片文件，编号 #1… 由本聊天最近记录 | `src/features/paintings.js:13`；`src/modules/imagegen/index.js:42` |
| `douyin.json` + `douyin/edge-profile/` | 抖音模块；专用浏览器登录资料目录 | 状态 `{...caps 计数, seen:[awemeId], history}` + Chromium profile | `src/douyin/duty.js:40-48` |
| `voice-cache/` | TTS 输出 mp3/wav，自动清 1 天前 | 音频文件 | `src/voice/tts.js:49-60` |
| `voice-rvc/` | 语音条变声输出 | 音频文件 | `src/voice/rvc.js:26` |
| `songs/` | 翻唱流水线产物 | 下载 / 分离 / 混音中间与成品 | `src/song/studio.js:399` |
| `local/` + `local/out/` | 本地接口脚本（`tts.mjs` `image.mjs` `song-convert.mjs` `asr.mjs`、`README-本地接口.md`）；`out/` 是脚本输出目录 | 升级不覆盖、改完即生效（按 mtime 重载） | `src/local/local.js:13-18,38-80` |
| `modules/` | 用户模块（升级不碰；同名替换内置）；启动时把 `API.md`/`aurabot.d.ts` 复制进来 | 目录名 = 模块 id | `src/core/modules.js:22-30,84-95` |
| `modules-data/<id>/` | 模块专用数据目录（`api.dataDir`）；目前实际使用：`modules-data/pet/`（见下）、`modules-data/purpose/` | 目录自动建 | `src/core/modules.js:210` |
| `modules-data/pet/` | `voice/`、`host.json`（桌宠发现契约：baseUrl+token）、`host-token`、`focus.json`、`process.json`、`whisper.json`、`behavior.json`、`packs/`（素材包）、`app/`（Electron 客户端）、`packs-staging/`、`packs-download.zip`、`desktop-quarantine/` | 全部 `api.dataDir` 写入 | `src/modules/pet/index.js:15,102-105,249,617,654,683,801,1073,1351,1714`；`docs/USER-MANUAL.md:203` |
| `purpose/purpose-state.json`、`purpose/nudge.json`（核心 `dataDir`，**不是** modules-data） | 目的引擎（默认关） | 状态机 / 追问记录 | `src/purpose/module.js:86-95` |
| `codex-auth.json` | Codex 订阅生图令牌（单独保存，不进配置） | 令牌，面板不回传 | `src/features/codex-auth.js:127`；`docs/USER-MANUAL.md:90` |
| `logs/` | 插件日志器（面板「日志」页数据源） | 文本日志 | `src/core/logger.js:14` |
| `tmp/` | 头像上传等临时文件 | 临时 | `src/modules/profile/index.js:67` |

> 升级保留：README 承诺「重装、升级插件都不会丢」（`README.md:119-121`）；数据目录与插件安装目录完全分离（`src/core/store.js:12-15`）。
> 迁移建议：可用 `AURABOT_DATA_DIR` 指向独立目录做并行验证（`src/core/store.js:13`）。

## 3. 配置模型（`src/core/config.js` DEFAULTS 全量键）

- 加载：`loadConfig()` 读 `config.json` → `normalize()`；老配置（有 botQQ/ownerQQ 无 setupDone）自动算向导完成（`src/core/config.js:503-510`）。
- 升级保护：`OPT_IN_ON_UPDATE = ['qzoneSocial','bili','douyin']` —— 老用户新增这三项会先**关着**（`:500-509`）。
- 归一化：`normalize()` 深合并默认值后逐键夹取/枚举校验（`:246-446`）；面板保存走 `mergeFromPanel()`：密钥字段空串=保留原值、`null`=清空（`:518-557`）。
- 密钥字段（面板不回传原文）：`snowluma.webuiPassword/httpToken/wsToken`、`imageGen.apiKey`、`song.neteaseCookie`、`bili.cookie/sessdata/biliJct`、`heybox.cookie`、`bridge.token`（`:449`）。

### 3.1 全量键清单（默认值以 DEFAULTS 为准）

| 键路径 | 类型 / 默认 | 含义 | 面板页 |
|---|---|---|---|
| `enabled` | bool `false` | 总开关，关着一句不发 | 顶部全局 |
| `dryRun` | bool `true` | 试运行：只写日志不真发 | 顶部全局 |
| `setupDone` | bool `false` | 向导是否走完 | 向导 |
| `botQQ` | string `''` | **机器人 QQ 号（迁移必填）** | 连接/向导 |
| `ownerQQ` | string `''` | **主人 QQ 号（迁移必填）** | 连接/向导 |
| `ownerName` | string `'主人'` | 主人称呼 | 权限 |
| `ownerLevel` | `full\|social\|chat`，`'full'` | 主人私聊的权限档（→ 选 preset） | 权限 |
| `profilePerms.<key>` | 每项 `off\|owner\|all`，默认 `owner` | 改资料/好友申请/白名单/抖音 5 项/小黑盒 4 项的权限（键清单见 `src/chat/access.js:47-53`） | 权限 |
| `longTasks` | bool `false` | 长任务模式（→ preset `aurabot-private-long`） | 权限 |
| `allow.private[]` / `allow.groups[]` | string[] `[]` | 私聊/群白名单；主人永远可私聊（`src/chat/access.js:11-24`） | 权限 |
| `gateway` | `snowluma\|onebot`，`'snowluma'` | **接 QQ 方式；Linux 用 `onebot`**（归一化只认这两个值 `:252`） | 连接 |
| `workspaceDir` | string `''` | QQ 会话工作区目录；留空=用户目录下 `Aurabot/qq-chats`；只认绝对路径（`:253-255`、`src/chat/hub.js:27-32`） | 连接 |
| `files.enabled` / `files.maxMB` / `files.dirs[]` | bool `true` / num `50`(1-2048) / string[] `[]` | 发文件开关、单文件上限、额外允许目录（`src/core/config.js:26,266-273`） | 聊天 |
| `security.dangerConfirm` | bool `false` | 危险终端命令先问主人 | 聊天 |
| `snowluma.dir` | string `'C:\Aurabot\snowluma'` | SnowLuma 安装目录（Windows 模式用；Linux 忽略） | 连接 |
| `snowluma.autoStart` / `autoAttach` | bool `true` / `true` | 随 DSH 启动 SnowLuma / 自动注入机器人号（仅 gateway=snowluma） | 连接 |
| `snowluma.webuiPort` | num `5099` | SnowLuma 控制台端口 | 连接 |
| `snowluma.webuiPassword` / `passwordAuto` | string `''` / bool `false` | 控制台密码（自动生成保存） | 连接 |
| `snowluma.httpUrl` / `wsUrl` / `httpToken` / `wsToken` | string `''` | **网关地址与令牌（gateway=onebot 也填在这里，迁移必填）** | 连接 |
| `model.provider` / `.model` / `.reasoningEffort` / `.vision` | string `''` / `''` / `'low'` / `auto\|on\|off`=`'auto'` | 全局模型、思考强度、视觉能力 | 模型 |
| `chatModels.privateDefault` / `.groupDefault` / `.privates{}` / `.groups{}` | `{provider,model,reasoningEffort}` | 按聊天选模型（优先级 QQ 号 > 群号 > 默认 > 全局，`README.md:77`） | 模型 |
| `merge.enabled/waitSec/maxSec/groupWaitSec/groupMaxSec` | `true`/2.5/8/5/15 | 连发合并（私聊与群不同节奏） | 聊天 |
| `imageGen.enabled` | bool `false` | 生图总开关 | 生图 |
| `imageGen.provider` | `openai\|custom\|codex`，`'openai'` | 接法 | 生图 |
| `imageGen.baseUrl/apiKey/model/size/stylePrompt` | `''`/`''`/`''`/`'1024x1024'`/`''` | OpenAI 兼容接口 / 自定义风格 | 生图 |
| `imageGen.shape` | `her\|square\|portrait\|landscape\|wide`，`'her'` | 默认构图（1024²、1024×1536、1536×1024、1536×864） | 生图 |
| `imageGen.ownerOnly` / `seeOwn` / `galleryShown` | `true`/`true`/`20` | 仅主人能画 / 画完自己看 / 图库显示数 | 生图 |
| `imageGen.custom.{method,url,bodyType,responsePath,params[]}` | `GET`/`''`/`json`/`''`/`[]` | 自定义生图接口（`{prompt}{model}{size}{width}{height}` 占位） | 生图 |
| `imageGen.codex.{model,quality,background}` | `'gpt-image-2'`/`'auto'`/`'auto'` | 实验性订阅接法 | 生图 |
| `persona.current` | string `'dafeiyu'` | 当前人格 id | 人格 |
| `group.*`（DEFAULT_GROUP_POLICY 展开） | `wakeWords:['大肥鱼','肥鱼']`、`interjectChance:0.15`、`cooldownSec:90`、`maxPerHour:6`、`quietHours:[1,8]`、`minRecentMessages:3`、`activeWindowSec:300`、`interests:[…]`、`minRelevance:0.25`、`burstMax:8`、`burstWindowSec:120` | 群聊插话策略（`src/chat/group-policy.js:3-16`） | 聊天 |
| `group.overrides{}` | 每群覆盖同一组键 | 单群插话设置 | 聊天 |
| `group.ownerBrief.{enabled,lines,groups[]}` | `false`/12/`[]` | 主人私聊里的群聊摘要（默认关） | 聊天 |
| `titleFilter.{enabled,groups[],title}` | `true`/`[]`/`'大肥鱼'` | 专属头衔过滤（一般用于别的机器人） | 权限 |
| `voice.enabled` | bool `true` | 语音总开关 | 语音 |
| `voice.engine` | `auto\|edge\|windows\|cosyvoice\|gptsovits\|http`，`'auto'` | TTS 引擎（失败退 Windows 语音，Linux 无此兜底） | 语音 |
| `voice.cosyvoice.{url,mode,spkId,instruct,sampleRate}` | `http://127.0.0.1:50000`/`sft`/`中文女`/`''`/22050 | 本地 CosyVoice | 语音/本地接口 |
| `voice.gptsovits.{url,refAudio,promptText,promptLang,textLang}` | `http://127.0.0.1:9880`/`''`/`''`/`zh`/`zh` | 本地 GPT-SoVITS | 语音/本地接口 |
| `voice.http.urlTemplate` | string `''` | 通用 HTTP TTS（`{text}` 占位） | 语音 |
| `voice.voice` / `.rate` / `.pitch` | `'zh-CN-XiaoyiNeural'` / `'+0%'` / `'+0Hz'` | edge-tts 音色/语速/音调（`±0` 必须带符号，`:388-395`） | 语音 |
| `voice.autoChance` / `.autoMaxChars` | `0.15` / `80` | 短回复自动转语音概率/字数上限 | 语音 |
| `voice.asr` | bool `true` | 听语音（QQ `fetch_ptt_text` → DSH `speechToText`） | 语音 |
| `voice.songVoice` / `.songPitch` | `''` / `0` | 语音条 RVC 变声音色/变调（依赖翻唱环境） | 语音 |
| `stickers.enabled` | bool `true` | 表情包总开关 | 表情包 |
| `stickers.faces` | bool `true` | 回复里夹 QQ 小黄脸 | 表情包 |
| `stickers.autoChance` | `0.35` | 自动配表情概率 | 表情包 |
| `stickers.collect` / `.collectMode` | `true` / `auto\|ask\|owner`=`'auto'` | 偷表情开关 / 三种偷法 | 表情包 |
| `stickers.fromGroups` / `.fromPrivate` / `.maxPerHour` / `.maxLibrary` / `.caption` | `true`/`true`/20/300/`true` | 来源、限额、视觉备注 | 表情包 |
| `diary.enabled` | bool `true` | 空间日记总开关 | 空间日记 |
| `diary.timesPerDay/windowStart/windowEnd/minGapMinutes` | 2/`'10:00'`/`'23:30'`/180 | 每天几条、时间窗、最小间隔 | 空间日记 |
| `diary.attachImage` / `.minChars` / `.maxChars` | `true`/60/140 | 配图、字数 | 空间日记 |
| `diary.visibility` / `.audienceQQs` | `all\|friends\|selected\|self\|excluded`=`'all'` / string | 可见范围与部分好友名单（聊天里只能收窄到 self） | 空间日记 |
| `local.{tts,image,song,asr}` | bool `false`×4 | 本地接口四项接管开关 | 本地接口 |
| `bili.enabled` | bool `false` | B站总开关 | B站 |
| `bili.sessdata` / `.biliJct` / `.cookie` | string `''` | 登录 Cookie（cookie 由前两项拼） | B站 |
| `bili.autoBrowse` / `intervalHours` / `maxRunsPerDay` / `perRun` | `true`/4/3/3 | 定时刷 | B站 |
| `bili.keywords[]` / `minViews` / `maxAgeDays` | `[]`/5000/60 | 搜索方向与筛选 | B站 |
| `bili.comment` / `maxCommentsPerDay` / `reply` / `maxRepliesPerDay` / `like` / `shareToOwner` | `true`/3/`true`/6/`false`/`true` | 写操作权限额 | B站 |
| `bili.vision` / `visionFrames` / `ffmpegPath` / `shotChance` / `shotLibrary` | `false`/6/`''`/0.35/300 | 抽帧看画面与截图库 | B站 |
| `douyin.enabled` | bool `false` | 抖音总开关（先扫码登录再开） | 抖音 |
| `douyin.autoBrowse` / `intervalHours` / `maxRunsPerDay` / `perRun` / `maxWatchPerDay` | `true`/4/3/5/30 | 定时刷与每日上限 | 抖音 |
| `douyin.dwellMin` / `.dwellMax` | 8 / 40 | 单条停留秒数 | 抖音 |
| `douyin.browserPath` | string `''` | 浏览器路径（空=自动找 Edge/Chrome/Chromium） | 抖音 |
| `douyin.shareBias` | `stingy\|normal\|proactive`=`'proactive'` | 分享积极度 | 抖音 |
| `douyin.ownerDm` / `dmPollMinutes` | `true` / 3 | 回主人抖音私信 / 轮询间隔 | 抖音 |
| `douyin.shareTo` | `douyin\|qq\|both`=`'douyin'` | 分享通道 | 抖音 |
| `douyin.owner.{input,secUid,uid,nickname,confirmedInput}` | 全 `''` | 主人抖音号（只能由「核对」写入，`src/core/config.js:546`） | 抖音 |
| `douyin.caps.{like,comment,share,atOwner}` | 30/3/5/3 | 每日上限（新号前 3 天减半） | 抖音 |
| `douyin.gate.{maxWritesPerDay,minWriteGapSec,newAccountDays}` | 40/20/3 | 写操作闸门 | 抖音 |
| `heybox.enabled` | bool `false` | 小黑盒总开关（先填 Cookie） | 小黑盒 |
| `heybox.cookie` | string `''` | 整串 Cookie（pkey 必需，写操作要 x_xhh_tokenid） | 小黑盒 |
| `heybox.autoBrowse` / `intervalHours` / `maxRunsPerDay` / `perRun` | `true`/4/6/3 | 定时逛（只读） | 小黑盒 |
| `heybox.likeDaily` / `.commentDaily` / `.maxPostsPerDay` | 10/3/3 | 限额 | 小黑盒 |
| `heybox.defaultTopic` / `.postStyle` | `7214` / `diary\|news\|mix`=`'mix'` | 默认分区（7214/18745/806933）与发帖风格 | 小黑盒 |
| `qzoneSocial.enabled` | bool `true`（老用户升级先关，`:501-509`） | 空间互动 | 空间日记 |
| `qzoneSocial.replyOwn` / `commentFriends` / `like` | `true`×3 | 回自己说说 / 逛好友 / 顺手点赞 | 空间日记 |
| `qzoneSocial.friendChance` / `.ownerChance` / `.maxPerDay` / `.intervalMin` | 0.3/0.7/8/30 | 互动概率与限额 | 空间日记 |
| `speakUp.enabled` | bool `true` | 主动搭话（只在主人私聊） | 主动搭话 |
| `speakUp.idleMinutes` / `minIntervalMinutes` / `maxIntervalMinutes` / `maxPerDay` / `nudge` / `awakeFrom` / `awakeTo` | 40/90/180/4/`true`/8/23 | 触发条件与配额、夜间静默 | 主动搭话 |
| `mood.enabled` / `.halfLifeHours` / `.judge` | `true`/3/`false` | 心情开关、半衰期、是否模型判心情 | 心情与记忆 |
| `memory.enabled` / `.recallCount` / `.dailyConsolidate` / `.consolidateTimes[]` | `true`/6/`true`/`['04:00','16:00']` | 记忆、每轮回想条数、每日整理时间 | 心情与记忆 |
| `song.enabled` | bool `false` | 翻唱总开关（需环境安装） | 翻唱 |
| `song.root` | string `''` | 翻唱环境目录（空=自动，老安装 `C:\Aurabot\rvc`） | 翻唱 |
| `song.voice` / `.pitch` | `''` / 0 | 默认音色与变调 | 翻唱 |
| `song.neteaseCookie` | string `''` | 网易云 MUSIC_U（下会员歌） | 翻唱 |
| `song.separatorModel` / `.maxVoiceSec` / `.clipStart` | `model_bs_roformer…ckpt` / 120 / `auto\|head`=`'auto'` | 人声分离模型、截段、从副歌还是开头 | 翻唱 |
| `song.vocalVolume` / `.instVolume` / `.ownerOnly` / `.keepWork` / `.pypiMirror` | 1/0.8/`true`/`false`/`auto\|cn\|off`=`'auto'` | 混音与安装源 | 翻唱 |
| `tabs{}` | object `{}` | 面板小偏好 | 面板 |
| `modules{}` | `{id:{enabled,useBuiltin,forkedFrom?}}`，默认开着 | 模块开关 / 是否用回内置 | 扩展 |
| `safeMode` | bool `false` | 安全模式：用户模块全不加载 | 扩展 |
| `ext{}` | `{模块id:{...}}` | 模块设置（用户模块 defaults） | 扩展 |
| `bridge.dshTools` / `.http` / `.token` / `.allowTargets` | `false`/`false`/`''`/`whitelist\|owner`=`'whitelist'` | 联动：DSH 工具 / 开放 HTTP / 密钥 / 可发对象 | 扩展 |
| （派生）`profilePerms.heyboxBrowse/Like/Comment/Post` | 默认 `owner` | DEFAULTS 未列，`normalize()` 按 `PROFILE_PERM_KEYS` 补齐（`src/core/config.js:262`、`src/chat/access.js:50-51`） | 权限 |

### 3.2 迁移时必须人工填的键

| 键 | 值（本机 Linux + Docker SnowLuma） | 说明 |
|---|---|---|
| `botQQ` | 机器人 QQ（SnowLuma 配置里 `onebot_<uin>.json`，本机为 `onebot_2477***441.json`；以连上后 `get_login_info` 回读为准） | 连上后 `get_login_info` 必须相等，否则断线不再重连（`src/host.js:113-150`） |
| `ownerQQ` | 主人 QQ | 决定权限档与白名单 |
| `gateway` | `"onebot"` | 不走 SnowLuma 进程管理 |
| `snowluma.httpUrl` | `http://127.0.0.1:3000` | 来自容器网关映射；容器内 DSH 连宿主机时不能写 127.0.0.1 |
| `snowluma.wsUrl` | `ws://127.0.0.1:3001` | 正向 WS（SnowLuma 里是 `role: "Universal"`） |
| `snowluma.httpToken` / `wsToken` | SnowLuma `accessToken`（`***`） | 分别以 `Authorization: Bearer`、`?access_token=` 发送（`src/onebot/client.js:49-51,124`） |
| `enabled` / `dryRun` | 先 `true`/`true` 试运行，再关 `dryRun` | 安全默认 |
| `allow.groups[]` / `allow.private[]` | 原有群/人 | 不填只回主人 |
| `model.provider/model` | 线上在用的 DSH 模型 | 空=跟随 DSH 默认 |
| 功能开关 | `bili/douyin/heybox/imageGen/song.enabled` 默认 `false` | 迁移后按需开 |

## 4. 模块清单（18 个内置模块）

内核：`src/core/modules.js`（加载、开关、同名替换、热重载、出错隔离、模块名下的工具/上下文/命令/定时/路由统一注销）；扩展接口版本 `API_VERSION = 1`，只加不改（`src/core/modules.js:18-20`）。内置清单与启动顺序：`src/modules/index.js:3-22`。
用户模块：数据目录 `modules/<id>/index.mjs|index.js`，`export default {id,name,version,api,setup(api),settings,panel,tab,defaults}`；保存即生效（按 mtime），加载失败自动回落内置（`src/core/modules.js:84-107`, `src/modules/API.md:70-95,327-347`）。
模块面板/设置：`settings` 自动生成表单；`panel:'panel.js'` 自定义面板；`tab:'内置页名'` 嵌进内置页（`src/modules/API.md:268-305`）。
**没有 mods 市场**：仓库里的 `dsh-aurabot-qq-mods` 是**桌宠素材仓库**（`README.md:146-150`、`CHANGELOG.md:5`）；扩展只有仓库内 `extensions/tieba-reader`（按用户模块方式安装，依赖目录内独立安装 — `extensions/README.md:1-5`）。

| 模块 id | 面板页 | 提供工具（grep `defineTool`/`name:`） | 主要配置键 / 默认开 | 依赖 |
|---|---|---|---|---|
| `stickers` 表情包 | 表情包 | `qq_send_sticker` `qq_list_stickers` `qq_edit_sticker` `qq_collect_sticker` `qq_save_sticker` `qq_import_qq_stickers` `qq_add_sticker` | `stickers.*`，默认开 | 网关 `add_custom_face`(SnowLuma 扩展) |
| `voice` 语音 | 语音 | 无（导出 `speak()`） | `voice.*`，默认开 | edge-tts / Python / 本地接口 |
| `mood` 心情 | 心情与记忆 | 无（导出 `state/label/nudge/effects/contextLine`） | `mood.*`，默认开 | 无 |
| `memory` 记忆 | 心情与记忆 | `remember` `recall_memory` | `memory.*`，默认开 | 无（本地 BM25） |
| `qq-tools` 基础 QQ 工具 | 无独立页 | `qq_chat_history` `qq_send_message` `qq_send_file` | `files.*`（发文件），默认开 | 网关消息历史接口 |
| `group-admin` 群管 | 无独立页 | `qq_group_admin`（ban/unban/kick/title/notice） | 无，默认开；需她在群里有管理权限 | 网关 `set_group_ban/kick/special_title/_send_group_notice` |
| `imagegen` 生图 | 生图 | `qq_draw_image` | `imageGen.*`，默认**关** | OpenAI 兼容 / 自定义接口 / Codex 订阅 / 本地脚本 |
| `diary` 空间日记 | 空间日记 | `qq_send_qzone` | `diary.*`，默认开 | 网关 `send_qzone_msg`（SnowLuma 扩展） |
| `qzone-social` 空间互动 | 空间日记 | 无 | `qzoneSocial.*`，默认开 | 网关 `get_qzone_feeds/get_qzone_msg_*/comment_qzone/like_qzone/delete_qzone_msg` |
| `speakup` 主动搭话 | 主动搭话 | 无 | `speakUp.*`，默认开 | 无 |
| `purpose` 目的引擎（实验） | 主动搭话 | 无 | `ext.purpose.*`（自身 defaults，`src/modules/purpose/index.js:20-27`），默认**关** | 无；与 speakup 二选一 |
| `pet` 桌宠 | 桌宠 | 无（是「载体」，提供 `dispatch()`） | `ext.pet.*`（carrier/modality/…），默认**关**（不生成、不启动客户端） | Electron（用户装）、素材包自动下载、Windows 桌面行为 |
| `bili` B站 | B站 | `bili_watch` `bili_comment` `qq_send_shot` `qq_list_shots` `bili_set_avatar` `bili_set_sign` | `bili.*`，默认**关** | HTTP；抽帧需 ffmpeg |
| `song` 翻唱 | 翻唱 | `qq_song_cover` | `song.*`，默认**关** | Windows + Python + Applio/RVC + ffmpeg（**Linux 不可用**） |
| `profile` 改资料 | 权限（含在页内） | `qq_get_profile` `qq_send_avatar` `qq_set_nickname` `qq_set_signature` `qq_set_avatar` | `profilePerms.qq*`，默认开/仅主人 | **SnowLuma 扩展 action**：`set_qq_profile` `set_self_longnick` `set_qq_avatar`（`src/modules/profile/index.js:1-3`） |
| `contacts` 好友申请与白名单 | 权限 | `qq_handle_friend_request` `qq_whitelist` | `profilePerms.qqFriendRequest/whitelist`，默认开 | `set_friend_add_request`、SnowLuma `set_doubt_friends_add_request`；**没有「主动加好友」**（SnowLuma v2.2.0 无此接口，`src/modules/contacts/index.js:4`） |
| `douyin` 刷抖音 | 抖音 | `douyin_watch` `douyin_recent` `douyin_browse` `douyin_share_owner` `douyin_send_dm` `douyin_like` `douyin_comment` | `douyin.*` + `profilePerms.douyin*`，默认**关** | Chrome/Edge/Chromium **非 headless** + CDP |
| `heybox` 小黑盒 | 小黑盒 | `heybox_feed` `heybox_watch` `heybox_hot` `heybox_search` `heybox_topics` `heybox_like` `heybox_comment` `heybox_post` `heybox_delete` | `heybox.*` + `profilePerms.heybox*`，默认**关** | 纯 HTTP + Cookie |
| `_template` | — | 新模块模板（不加载） | — | — |

> 模块 API（写入类型见 `src/modules/aurabot.d.ts:136-213`，说明见 `src/modules/API.md:95-182`）：`api.config/setConfig/settings/saveSettings/dir/dataDir/log`、`api.send/sendText/reply/sendImage/sendFile/sendVoiceFile/sendSegments/onebot`、`api.ask/think`、`api.on/emit/tool/defineTool/context/rule/command/every/later/route/onDispose`、`api.use/lazy/has/core/dsh/lib`。内置模块导出表见 `src/modules/API.md:306-327`（`api.use(id)` 拿到的函数，替换时函数名须一致）。

## 5. 面板页清单（`client/client.js`）

入口：侧栏「自动化任务」下面的 Aurabot（`client/client.js:3421-3426`，`slots` 注册 `main` + `sidebar.panellist`，order 20）。页面数据全部来自 `/aurabot/api/*`。

顶部导航 5 组（`client/client.js:533-538`）与 20 个标签（`:505-525`）：

| 组 | 标签（id） | 能做什么 | 对应配置键 |
|---|---|---|---|
| 概览 | 概览 | 状态、连接、统计、日志入口、立即找主人 | `enabled/dryRun` |
| 人设 | 人格 / 聊天 / 主动搭话 / 心情与记忆 | 人格增删改与设为当前、AI 润色；群聊策略、连发合并、群聊摘要、按群覆盖；主动搭话（含目的引擎卡）；记忆浏览/人物小档案/相处经验/说话方式/导入旧档案 | `persona`、`group/merge/titleFilter`、`speakUp`+`ext.purpose`、`mood/memory` |
| 表达 | 语音 / 表情包 / 生图 / 翻唱 / 桌宠 | TTS 音色试听与安装、变声；表情库改名标签/上传/从 QQ 导入/偷法；生图接口与构图、画作图库、Codex 登录；翻唱环境安装/音色导入；桌宠客户端/Electron/行为 | `voice`、`stickers`、`imageGen`、`song`、`ext.pet` |
| 平台 | 空间日记 / B站 / 抖音 / 小黑盒 | 日记时间与可见范围/历史/现在写一篇；B站登录与刷法/截图；抖音扫码登录/核对主人号/额度/私信；小黑盒 Cookie/逛法/热榜/发帖风格 | `diary/qzoneSocial`、`bili`、`douyin`、`heybox` |
| 系统 | 连接 / 模型 / 权限 / 本地接口 / 扩展 / 日志 | 网关与试运行、向导、SnowLuma、工作区；模型与按聊天选模型；白/黑名单、权限档、profilePerms、头衔过滤；本地接口模板与开关；模块开关/复制/新建/模拟测试/安全模式；日志 | `snowluma/gateway/workspaceDir`、`model/chatModels`、`allow/ownerLevel/longTasks/profilePerms/titleFilter`、`local`、`modules/safeMode/ext`、`logs` |

标签显隐：内置页有 `flag`（如 `voice.enabled`），模块页按该模块是否在跑来显隐（`client/client.js:505-525,3390-3405`）。有未保存改动时底部出现保存条（`TAB_KEYS` 定义 `:3379`）。

## 6. QQ 接入（迁移关键）

### 6.1 两种 gateway

- `gateway: 'snowluma'`（默认）：插件**自己管** SnowLuma（Windows 安装目录、后台启动、只给机器人号注入）；地址没填时从 SnowLuma 配置自动读（`src/core/config.js:20-41`、`src/host.js:92-102`、`src/snowluma/manager.js:48-75`）。
- `gateway: 'onebot'`：**只连填好的地址，不启动、不注入任何东西**（`src/core/config.js:20-22`、`README.md:47`、`docs/USER-MANUAL.md:15`）。
  - 地址仍来自 `cfg.snowluma.httpUrl/wsUrl/httpToken/wsToken`（`src/host.js:92-102`）；`gateway==='onebot'` 时不会读 SnowLuma 配置文件。
  - 看门狗里 `own = cfg.gateway === 'snowluma'`，非 own 分支不 start/attach SnowLuma（`src/host.js:391-415`）。

### 6.2 完整流程（代码事实）

1. 启动 `createOneBotClient({endpoint, onState, onEvent})`（`src/host.js:166-187`）。
2. 客户端：有 HTTP 就走 HTTP（`POST <httpUrl>/<action>`，`Authorization: Bearer <httpToken>`，token 为空则不带头）；HTTP 没配或网络失败且 WS 已连则改走 WS（`{action,params,echo}`）；传输失败按 `[1s,3s,5s]` 重试，业务错误不重试（`src/onebot/client.js:43-99`）。
3. WS：客户端连 `wsUrl`，有 token 时追加 `?access_token=`（`src/onebot/client.js:114-130`）；断线指数退避 2s→30s 重连（`:4-5`）。
4. 连接状态变化 → `onebotState`；连上后立刻 `checkLogin()`：`get_login_info` 取 `user_id`，必须 == `cfg.botQQ`；核对前事件先攒（≤200 条），核对通过补处理，失败则 `onebot.stop()` 且 `wrongAccount` 阻止自动重连直到改设置/手动重连（`src/host.js:113-150,376-388`）。
5. 事件：`message`/`message_sent` → 危险命令确认 → `hub.onMessage`；`notice/notify/poke` → `hub.onPoke`；其余事件只广播给模块（`src/host.js:147-166`）。
6. 单个客户端实例（`src/host.js:166` 只创建一次），面板重连走 `/aurabot/api/onebot/reconnect`（`src/host.js:787`）。

### 6.3 本机场景要填什么（Linux + Docker SnowLuma）

既有网关配置（只读核对，值已掩码）：
- `/home/ubuntu/dsh-agentchat/snowluma/data/config/onebot_2477***441.json`：`mode:"overlay"`；HTTP server `host:"0.0.0.0", port:3000, path:"/", accessToken:"***"`；WS server `role:"Universal", host:"0.0.0.0", port:3001, path:"/", accessToken:"***"`。全局 `onebot.json` 是空 `networks`。
- 因此 `snowluma.httpUrl=http://127.0.0.1:3000`、`snowluma.wsUrl=ws://127.0.0.1:3001`，token 取对应 `accessToken`（HTTP 与 WS 各自独立）；DSH 若在容器内，地址改成宿主可达 IP（`README.md:55`）。
- 注意：Aurabot 自动读配置时判断的是 `x.enable !== false`（`src/snowluma/manager.js:57-58`），而 SnowLuma 实际字段是 `enabled` — 自动读只影响 `gateway=snowluma` 模式；本机用 `onebot` 手填，不受影响。

### 6.4 Linux 为什么不用 gateway=snowluma

`createSnowLumaManager` 的安装/启动/注入全链是 Windows 假设：要求目录里有 `index.mjs`+`node.exe`（`src/snowluma/manager.js:27-42`）、`spawn(..., {windowsHide:true})`（`:280`）、注入前用 `netstat -ano -p TCP` 和 `powershell.exe (Get-Process).Path` 定位 QQ 进程（`:426-430`）、通过 SnowLuma WebUI `/api/processes` 注入（`:323-394`）。Linux 上既没有 QQ 客户端进程可注入，也不该由插件管理容器里的 SnowLuma。**结论：本机只用 `gateway=onebot` 连容器内 SnowLuma，SnowLuma 的启停交给 Docker。**

### 6.5 单连接不变量与双消费风险

- Aurabot 侧只有一个 OneBot 客户端（`src/host.js:166`），HTTP 与 WS 都指向同一网关，不做多路广播。
- 风险：SnowLuma 的 WS server 允许**多个客户端**；DSBot 的外置 bridge 当前正在消费同一网关。同时连会出现「同一条消息被两套处理、两边都回」或事件互相扰动，且 Aurabot 的 `get_login_info` 校验只能证明它连的是机器人号，**不能阻止别人也连**。迁移步骤必须：先停 DSBot bridge（本机 `/home/ubuntu/dsh-agentchat/logs-dsbot-bridge.log` 对应进程）→ 再开 Aurabot 总开关。
- Aurabot 没有文件锁/端口独占声明（配置与源码内均无 about 单实例锁）。

## 7. 数据资产与「导入 / 迁移入口」

| 资产 | 现存储 | Aurabot 侧入口 | 已有数据能否导入 / 怎么导 |
|---|---|---|---|
| 人格 | `personas/*.md`（数据目录副本，升级不覆盖） | 面板「人格」编辑/新建/「设为当前」；插件自带 `personas/dafeiyu.md` | ✅ 直接放 md 到 `plugins-data/aurabot/personas/`，或面板粘贴；`---name/tags---` 头可选（`src/persona/personas.js:23-36`）。注入点是提示词变量 `{{aurabot_persona}}`（`src/host.js:75`） |
| 记忆 | `memories.json`（+`chatlog/` 作为流水） | 面板「心情与记忆 → 导入旧档案」：`POST /aurabot/api/memory/import` 让模型挑候选 → `…/import/commit` 勾选后入库（`src/modules/memory/index.js:89-100`；`client/client.js:2163-2200`） | ✅ 支持 **txt/md 文本粘贴或上传（≤3 万字）**，自动与已有记忆去重；也可手改 `memories.json`（格式见 §2） |
| 表情包 | `stickers/index.json` + 图片 | 面板「表情包」上传/改名/标签/删除；`POST /sticker/import-qq` 从机器人号 QQ 收藏导入 | ⚠️ 只能按「QQ 收藏表情」或面板逐张上传导入；QQ 账号若有收藏，导入一次即可（`src/features/stickers.js:253-295`） |
| 语音 | `voice-cache/`（临时）、venv、本地脚本 | 面板「语音」安装 edge-tts、试听、引擎切换；「本地接口」生成 4 个模板脚本 | ✅ 装好 venv 即用；自有 TTS/ASR 写 `local/tts.mjs`、`asr.mjs` 并开开关（`src/local/local.js:13-18`） |
| 空间 / 日记 | `diary.json` 历史 | 面板「空间日记」：现在写一篇、可见范围、历史、删除；`/diary/*` 接口 | ⚠️ 历史记录可以留档但**不参与生成**；旧说说无法回填成记忆（只有新日记会 `onDiary` 进记忆，`src/modules/diary/index.js:20-25`） |
| B站 | `bili.json`（seen/history）+ `bili-shots/` | 面板「B站」：Cookie、刷法、额度、截图库；`/bili/*` | ⚠️ Cookie 可迁移（SESSDATA/bili_jct）；`seen` 可保留避免重复看；历史仅面板展示 |
| 抖音 | `douyin.json` + `douyin/edge-profile/`（登录态） | 面板「抖音」扫码登录、核对主人号、额度、私信、「显示浏览器窗口」 | ⚠️ 登录态在 profile 目录，**跨机器/跨平台浏览器 profile 不一定可用**，建议重新扫码；`seen/history` 可保留 |
| 小黑盒 | 无持久文件（额度在内存） | 面板「小黑盒」填 Cookie、检查登录、热榜预览、额度清零 | ✅ 只需 Cookie（pkey + 可选 x_xhh_tokenid） |
| 生图 | `imagegen/` 画作 + `codex-auth.json` | 面板「生图」接口配置/构图/图库；Codex 登录 | ✅ 画作直接拷目录；Codex 令牌可拷 `codex-auth.json`（面板不回传） |
| 翻唱 | `songs/`、翻唱环境目录（默认 `~/Aurabot/rvc`）、音色 `models/*.pth` | 面板「翻唱」一键安装 + 拖入 .pth/zip；`/song/import` | ⚠️ **Linux 不支持**；音色文件可保留给未来 Windows 用 |
| 桌宠 | `modules-data/pet/`（packs/app/host.json…） | 面板「桌宠」：下载生成客户端、安装 Electron、启动/停止、行为设置 | ⚠️ 素材包会自动下载（`dsh-aurabot-qq-mods/pet-pack/`），无需手动搬；行为/窗口能力 Windows-only |
| 贴吧扩展 | `extensions/tieba-reader`（用户模块形态，默认关自动浏览） | 仓库内扩展，按用户模块装到 `modules/`；只读，无发帖/回帖/点赞接口（`extensions/tieba-reader/README.md`、`README.md:109-111`） | ✅ 按插件目录手工安装（依赖目录内独立 `npm install`） |
| QQ 会话映射 | `sessions.json` + DSH `sessions/` | 无导入入口 | ❌ 换插件后 chatId→DSH 会话映射要重建（第一次收到消息自动建），旧 DSH 会话仍在侧栏可读 |
| 人物小档案 / 相处经验 / 说话方式 | `memories.json` 内 `profiles`/`insights`/`styles` | 面板：`/profiles`、`/insights`、`/style/save`，可手工改 | ✅ 随 `memories.json` 一起搬 |

## 8. 对外接口清单（对照用）

### 8.1 宿主路由（`/aurabot/api/*`，`src/host.js:43,311-312`）

核心路由都注册成 exact 路径；**不校验 HTTP 方法**（handler 直接读 `req`，`src/host.js:311` 只用 path 注册），模块接口走 prefix 路由再查表（`src/host.js:312-341`）。启动时共注册 **74 条**（69 条直接注册 + `/open/*` 5 条）：

| 分组 | 路由 |
|---|---|
| 状态/保存 | `/state` `/save` `/logs` `/commands` `/update/check` `/changelog` |
| 目的引擎/桌宠代理 | `/panel/purpose/{status,preview,run,config}`、`/panel/pet/{status,config,whisper,download,focus,electron-install,launch,stop}`、`/panel/pet/behavior/{status,actions,quarantine,restore,apologize}` 与 `/panel/pet/behavior` |
| SnowLuma | `/snowluma/{start,stop,attach,login-check,agreements,consent,reset-password,password,set-password,processes}` |
| 网关 | `/onebot/reconnect` `/onebot/test` `/test-send` `/setup/done` `/sessions/reset` |
| 人格 | `/personas` `/persona/{get,save,delete,use,polish}` |
| 群 | `/groups/titles` |
| 本地接口 | `/local/{status,template,open,test}` |
| 模块（扩展） | `/modules` `/modules/{reload,create,fork,prompt,open,simulate,tools,tool,panel}` |
| 联动 | `/bridge/{token,token/reset,examples}`；开放接口 `/open/{info,send,think,call,events}`（需 `Authorization: Bearer <bridge.token>`，`src/host.js:999-1007`） |
| 模型 | `/models` `/model/ping` |
| 形象 | `/avatar` `/avatar/{upload,reset,sync-qq}` |

### 8.2 模块路由

内置模块用自己的路径（`/aurabot/api/<path>`，因为内置模块 `prefix=''`），用户模块/替换版在 `/aurabot/api/ext/<id>/<path>`（`src/core/modules.js:190-191`）。

- voice：`/voice/{song-voices,test,install,asr-status,asr-prepare,asr-last,asr-test}`
- memory：`/memories` `/memory/{add,update,delete,recalls,restore,import,import/commit,extract}` `/insights` `/insights/save` `/profiles` `/profiles/{save,rebuild}` `/style/save`
- diary：`/diary/{privacy,friends,run,history}` `/qzone/delete`
- qzone-social：`/qzone/social/{run,state}`
- speakup：`/speakup/fire`
- purpose：`/purpose/{fire,status,preview}`
- song：`/song/{status,install,root/check,drives,search,account,import,voice/delete,request}`
- bili：`/bili/{state,account,run,replies,shots,shot/image,shot/delete}`
- douyin：`/douyin/{state,account,login,login/status,window,run,dms,confirm-owner}`
- heybox：`/heybox/{state,feed,hot,topics,account,login-cookie,run,clear-quota,styles}`
- imagegen：`/image/codex/{status,login,login/status,complete,cancel,logout}`、`/image/gallery`、`/image/gallery/image`、`/image/gallery/delete`、`/image/open-folder`
- stickers：`/stickers` `/sticker/{image,rename,delete,import-qq,upload}`
- group-admin：`/groups/roles`
- pet：26 条（`/status` `/events` `/config` `/packs` `/pack` `/packs/fetch-default` `/playback` `/history` `/focus` 等；长轮询 HTTP，无 WS/SSE — `src/modules/pet/index.js:1975-2100`、`docs/PET_MODULE_API.md`）

### 8.3 全部工具名（按模块）

`qq_chat_history` `qq_send_message` `qq_send_file` | `qq_group_admin` | `remember` `recall_memory` | `qq_draw_image` | `qq_send_qzone` | `qq_song_cover` | `bili_watch` `bili_comment` `qq_send_shot` `qq_list_shots` `bili_set_avatar` `bili_set_sign` | `douyin_watch` `douyin_recent` `douyin_browse` `douyin_share_owner` `douyin_send_dm` `douyin_like` `douyin_comment` | `heybox_feed` `heybox_watch` `heybox_hot` `heybox_search` `heybox_topics` `heybox_like` `heybox_comment` `heybox_post` `heybox_delete` | `qq_send_sticker` `qq_list_stickers` `qq_edit_sticker` `qq_collect_sticker` `qq_save_sticker` `qq_import_qq_stickers` `qq_add_sticker` | `qq_get_profile` `qq_send_avatar` `qq_set_nickname` `qq_set_signature` `qq_set_avatar` | `qq_handle_friend_request` `qq_whitelist`
（工具按会话/权限动态注册，`agent.ctx.tools.register` — `src/chat/hub.js:345-421`；工具定义同 DSH `dsh-tools` 形状 — `src/tools/tools.js:8-30`）
联动工具（开 `bridge.dshTools` 时给**别的** DSH 会话）：`aurabot_qq_send` `aurabot_status` `aurabot_call`（`src/core/bridge.js:101-113`）。

### 8.4 preset id 与选择规则

`aurabot-private`（主人私聊，完整工具）、`aurabot-private-long`（`longTasks` 开）、`aurabot-social`（群聊/别人私聊/后台会话，无本地工具）— `src/chat/access.js:36-39`；权限档 `full/social/chat`（`:4,27-33`）。preset 定义 `cordis.patch.yml:12-143`。

### 8.5 模块 hooks（可改写事件）

`src/host.js:259-269` + `src/modules/API.md:183-267`：
`message`(claim) `poke`(claim) `reply` `group/decide` `prompt` `reply/items` `send` `model`(同步) `persona`(同步) `rules`(同步)；只看不改：`activity` `onebot` `onebot/state` `config` `module/start` `module/stop` `song/sung`。

### 8.6 client 侧 slots 注册方式

`client/client.js:5-15`（`window.__ModuleLoader__.load({id:'dsh-aurabot-qq', factory:(require)=>…})`，`inject=['slots']`，`require('react')`），`:3421-3426`：
`slots.inject('main', () => slots.register({name:'main', key:'aurabot'}, AurabotPage))`、
`slots.inject('sidebar.panellist', () => slots.register({name:'sidebar.panellist', id:'aurabot', order:20, label:()=>'Aurabot'}, WhaleIcon))`。

## 9. 与 DSBot 的架构差异（事实层面）

| 维度 | DSBot（现状，线上） | Aurabot（目标） |
|---|---|---|
| 包形态 | bundle 两个 entry：`dsbot` + `qq-mode`（`/home/ubuntu/dsh-agentchat/dsh-0.2-home/plugins/‹合体插件›/cordis.patch.yml:11-17`） | bundle 插件本体 + 3 preset（`cordis.patch.yml:9-143`） |
| QQ 桥 | **外置进程**：`<dsbot>/src/bridge.js` 由插件启停/探活/读状态，console 端口默认 3100（`/home/ubuntu/dsh-agentchat/dsh-0.2-home/plugins/‹合体插件›/lib/bridge.js:1-19`）；桥接模式由 DSH settings 的 `qq-mode` 命名空间切换（chat/closed-agent/reserved/reserved2，`/home/ubuntu/dsh-agentchat/dsh-0.2-home/plugins/‹合体插件›/lib/qq-mode.js:1-19,40-45`） | **插件内 OneBot v11 客户端**（HTTP+WS，`src/onebot/client.js`），无外置进程、无 console 端口；一个客户端实例（`src/host.js:166`） |
| 会话模型 | 单 agent + bridge 注入（桥接负责映射聊天到会话） | **每个 QQ 私聊/群一个 DSH 会话**：`sessionController.create({workspaceId, agentPreset})`，工作区标题固定（`src/chat/hub.js:195-243`），侧栏「Aurabot · QQ」 |
| 人格注入 | 角色卡在插件内，桥接每消息注入 | DSH preset 的系统提示词最前面用 `{{aurabot_persona}}` 变量 + `complete:true`（`cordis.patch.yml:20-26`、`src/host.js:70-85`）；切人格即时生效、不用重建 preset |
| 记忆 | 记忆卡文件（dsbot-memory：衰减记忆卡/隐私闸门） | 本地索引：中文二元切词 + BM25 + 说话人/重要度/遗忘曲线加权；`memories.json` 单文件（`src/features/memory.js`、`README.md:72`） |
| 每轮动态内容 | bridge 拼进消息 | `systemPrompt.context()` 追加心情/记忆，不破坏前缀缓存（`README.md:70`、`src/chat/hub.js:404`） |
| 工具挂载 | 全局工具/桥接指令 | 按会话注册、按权限档与 `profilePerms` 动态挂（`src/chat/hub.js:345-421`、`src/chat/access.js:60-74`） |
| 多实例/端口 | 桥接 console 3100；OneBot 3000/3001 由外置进程占用 | 无自有端口，复用 DSH web 端口；**OneBot 3000/3001 必须独占**（迁移期两套不能同时连） |
| 对 DSH chat 入口 | 桥接调 DSH API 注入消息 | `workspaceRegistry` 建工作区 + `sessionController` 建会话 + `agents` 拿活 agent；`session/event` 监听一轮结束回 QQ（`src/host.js:377-390`、`src/chat/hub.js`） |

## 10. 已知限制 / 风险（迁移必读）

1. **默认不发**：`enabled=false`、`dryRun=true`（`src/core/config.js:10-11`）；不手动打开不发一句（`README.md:12`）。
2. **装完要重启 DSH**（`README.md:42`），面板/插件热更新只对用户模块有效（`src/core/modules.js:1-9`）。
3. **数据落在 DSH_HOME**：`plugins-data/aurabot/`（`src/core/store.js:7-15`）；换 DSH_HOME/profile 等于换数据；`AURABOT_DATA_DIR` 可覆盖。
4. **双消费者**：DSBot bridge 与 Aurabot 不能同时连同一 OneBot（§6.5）；需要停机窗口。
5. **SnowLuma 扩展 action 依赖**：空间（`send_qzone_msg` 等）、表情库（`add/modify/delete_custom_face`）、改资料（`set_qq_profile` 等）、语音转文字（`fetch_ptt_text`）、群公告（`_send_group_notice`）都是 SnowLuma 扩展，不是标准 OneBot v11。用本机 Docker SnowLuma 没问题；换 NapCat/LLOneBot 会降级（功能报错或面板置灰）。
6. **平台能力缺口**：RVC 翻唱 Windows-only（§1.4）；桌宠桌面行为/窗口清单 Windows-only；抖音需非 headless 浏览器 + 有 X（服务器需 Xvfb）；edge-tts 需 `python3-venv` 或 uv（Linux 不会自动下 uv）。
7. **权限面大**：主人私聊 = `full` preset，含 bash/fs/web 工具；群聊 = social 无本地工具。迁移时确认 `ownerQQ` 填对，否则权限档落错人（`src/chat/access.js:27-33`）。
8. **成本/噪声功能默认关**：`bili/douyin/heybox/imageGen/song` 默认关；升级时 `qzoneSocial/bili/douyin` 对老配置强制先关（`src/core/config.js:500-509`）。
9. **和 DSBot 的命名空间冲突**：两者都是 profile bundle；DSH profile 的 `dsh.profile.bundles` 里并存会双插件运行（本机 profile 文件 `/home/ubuntu/dsh-agentchat/dsh-0.2-home/profiles/web/package.json` 当前含 `dsbot`）。迁移应先把 dsbot 从 bundles/依赖移除再装 Aurabot。
10. **面板/权限的「仅主人」有执行期二次校验**（`src/chat/access.js:60-74`），但 `profilePerms` 的 heybox 四项只在 normalize 时才补默认值 —— 直接把旧配置拷来时要检查这四项是否存在（`src/core/config.js:17,262`）。
11. **插件本体零 npm 依赖**：插件本体无 npm 依赖（`package.json`），装不上通常是网络/git 访问问题；`extensions/tieba-reader` 才是独立 npm 包（`extensions/README.md`）。

## 11. 未确认项（每条附确认方法）

| # | 未确认 | 确认方法 |
|---|---|---|
| U1 | 插件能否在 DSH **0.2.1-rc.5** 实际加载运行（仓库未声明最低版本；仅静态核对 API 存在） | 在隔离 profile（如 `--profile aurabot-trial`）`dsh plugin add` 后启动，看 `/aurabot/api/state` 与日志有无 `inject` 缺失报错 |
| U2 | `github:aureth-labs/dsh-aurabot-qq` 是否可匿名安装（仓库可见性/CI）；aureth-labs 与上游的同步策略 | `git ls-remote https://github.com/aureth-labs/dsh-aurabot-qq` + 用一次性 profile 试 add（不要动 web profile） |
| U3 | aureth-labs 与 accomplish07zrh-eng 是否**逐字节**同一 commit（本地只有 aureth-labs origin `b3301f6`，无法证明镜像关系） | 对比两边 `git ls-remote`/commit 列表；或比对 `package.json` version 与 CHANGELOG 头部 |
| U4 | SnowLuma WS `role:"Universal"` 是否接受 Aurabot 的 `?access_token=` 查询参数鉴权（代码如此发送，未实连验证） | 用 node 脚本连 `ws://127.0.0.1:3001/?access_token=***` 发 `get_login_info`，看是否回 `retcode:0` |
| U5 | 同时连 DSBot bridge 时的具体表现（双回复/事件竞争） | 迁移窗口内先只停 bridge、保留 Aurabot 观察 10 分钟日志 |
| U6 | 本机是否有可用的 `python3-venv`/uv（决定语音能否装） | `python3 -m venv --help`、`uv --version`、`ls ~/.local/bin/uv`（未执行，避免写盘） |
| U7 | 服务器上是否有 X/Xvfb（决定抖音能否用） | `echo $DISPLAY`、`which Xvfb`；或在「抖音」页点扫码登录看浏览器是否起得来 |
| U8 | 面板导入旧档案/表情/音色的 UI 在 web 版是否都可见（前端逻辑纯浏览器） | 装好后逐页点一遍，对照 §5 |
| U9 | 旧 `sessions.json` 的 chatId 映射能否复用（DSH 会话 id 在换插件后是否仍可 resolve） | 拷 `sessions.json` 后观察日志「恢复会话失败/换一个新的」；失败即放弃映射 |
| U10 | `ext.pet` 在 Linux 桌面环境下 Electron 客户端能否启动（代码有 linux 分支，但无 Linux 文档验证） | 有桌面的 Linux 上在「桌宠」页生成客户端并按 `pet-client/README.md` 运行 |

---

### 附：本次盘点的「未做」清单（保持只读）

- 未 `npm install`、未 `npm test`、未运行 `extensions/tieba-reader/scripts/*`、未跑任何 setup/probe 脚本；
- 未修改 `/tmp/aurabot-qq-probe`（`git status` 干净）、未写 `~/.dsh`、未改 DSH profile；
- 未实机启动 Aurabot、未连接 OneBot（所有运行时结论均来自源码/配置/DSH 类型定义）。
