# Lead 复核的实测事实（Aurabot 迁移可行性）

> 本文件是 Lead 在写正式迁移文档前亲手做的**环境实测**记录，与两份 inventory 互补。
> 采集时间：2026-11-03 12:50–13:10（Asia/Hong_Kong）。

## 1. 线上运行时事实

| 项 | 事实 | 证据 |
| --- | --- | --- |
| DSH 运行时 | `@deepseek-ai/dsh` **0.2.1-rc.5** | `dsh-0.2-trial/package.json`；进程 `node .../dsh-0.2-trial/node_modules/@deepseek-ai/dsh/lib/bin.js --profile web` |
| DSH_HOME | `/home/ubuntu/dsh-agentchat/dsh-0.2-home` | `/etc/systemd/system/dsbot-dsh.service` 的 `Environment=DSH_HOME=...` |
| profile | `web`（bundles 含 `dsbot`、`dsh-tide-badge` 等） | `dsh-0.2-home/profiles/web/package.json` |
| Node | v24.19.0 | `node -v` |
| 服务管理 | systemd：`dsbot-dsh.service`、`dsbot-bridge.service`（均 `Restart=always`） | `/etc/systemd/system/*.service` |
| 资源 | 3 GB 内存（DSH 已用 1.8–2.0 GB，swap 已用 ~98 MB）；磁盘 40G/剩余 25G | `systemctl status dsbot-dsh`、`free -g`、`df -h` |
| 当前 agent 会话 | **就跑在 `dsbot-dsh.service`（pid 990）里** → 重启该服务会中断当前 DSH 会话 | `ps` / `systemctl status dsbot-dsh` 的 CGroup 包含本会话进程 |

## 2. QQ 接入事实（迁移的关键前提）

- SnowLuma 在 Docker：容器 `snowluma`，镜像 `docker.m.daocloud.io/motricseven7/snowluma:latest`，端口 `127.0.0.1:3000`（OneBot HTTP，path `/`）、`127.0.0.1:3001`（OneBot WS，path `/`，role Universal）、`5099` WebUI、`6081` VNC。
- OneBot 配置：`/home/ubuntu/dsh-agentchat/snowluma/data/config/onebot_2477094441.json`（`mode:"overlay"`，`accessToken` 已设置，值掩码；WS `role:"Universal"`、`messageFormat:"array"`、`historySync.enabled:false`）。
- 机器人 QQ：`2477094441`；主人 QQ：`1362431704`（来自 DSBot 生产配置 `admin.qq`）。
- **当前 QQ 登录态不正常**（2026-11-03 12:10 起）：SnowLuma 日志显示
  `awaiting EULA/PRIVACY consent before the panel unlocks`、`awaiting login: PID=80`；
  `dsbot-bridge` 每 30 秒刷 `SnowLuma WebSocket closed before opening` / `连不上 OneBot HTTP API`；
  直接 `curl http://127.0.0.1:3000/get_login_info` 被 connection reset。
  → **迁移前必须先通过 VNC/WebUI 重新登录机器人 QQ（并完成 EULA 同意）。**
- 同一 QQ 号同一时间只能有一个 OneBot 消费方：bridge.js 与 Aurabot 不能同时连 SnowLuma，否则会双收消息/双回复。

## 3. Aurabot 安装/兼容性实测（隔离 DSH_HOME，未触碰生产）

在 `/tmp/dsh-aurabot-compat` 用同一运行时（0.2.1-rc.5）做了三次实测：

1. **安装成功**：`dsh plugin --profile web add github:aureth-labs/dsh-aurabot-qq`
   → pnpm 从 `codeload.github.com` 拉 tar.gz（1273 KiB，~19–50 KiB/s，耗时 **1m13s**），
   装到 `dsh-aurabot-qq@1.1.24`，并**自动把 `dsh-aurabot-qq` 加进 `dsh.profile.bundles`**。
2. **配置树可组合**：`dsh --profile web --dump-config` 退出码 0，输出含 `# == dsh-aurabot-qq`
   与 3 个 preset（`aurabot-private` / `aurabot-private-long` / `aurabot-social`）。
3. **可实际启动**：隔离 profile 启 web（端口 3199）成功，日志：
   `[core] Aurabot v1.1.24 已加载｜总开关 关｜试运行 开｜工作区 /home/ubuntu/Aurabot/qq-chats`，
   `[pet] 桌宠：宿主注入 Web 端口 3199`，`[heybox] 小黑盒模块起来了`，数据目录自动生成
   `plugins-data/aurabot/{config? ,personas/dafeiyu.md, modules/, modules-data/pet/, logs/}`。
   根路径返回 401（DSH 正常鉴权），无 error。
4. **已知无害告警**：`--dump-config-schema` 对 preset 的 `plugins` 子列表报
   `unrecognized Loader tree carrier`（/192–/194 为 Aurabot 的 3 个 preset；/187–/190 在不装 Aurabot 的
   纯 base+web-app profile 上同样出现，属 schema 投影能力限制，**不影响启动**，已实测启动成功）。
5. 结论：**Aurabot 1.1.24 能在本机 DSH 0.2.1-rc.5 上安装并启动**；`engines.dsh`/peer 未声明 → 无版本闸门。

## 4. Aurabot 关键配置事实（Lead 从源码复核）

- 数据目录：`$DSH_HOME/plugins-data/aurabot/`（`AURABOT_DATA_DIR` 可覆盖）——`src/core/store.js:7-17`。
- 配置：`loadConfig()` 读 `config.json` 后 `normalize()`；因此**可以在首次启动前预写 config.json**（`src/core/config.js:503-516`）。
- gateway 选择：`cfg.gateway = 'onebot'` 时**只认** `cfg.snowluma.{httpUrl,wsUrl,httpToken,wsToken}`，不启动/不注入 SnowLuma（`src/host.js:92-104, 396`、`src/core/config.js:20-21`）。
  → 本机填：`httpUrl=http://127.0.0.1:3000`、`wsUrl=ws://127.0.0.1:3001`、两个 token = SnowLuma 的 accessToken。
- 连上后先 `get_login_info` 核对机器人号，核对前不处理消息、不是机器人号就不自动重连（`src/host.js:105-112`）。
- 人格：Markdown 文件在 `plugins-data/aurabot/personas/`，首次从插件自带 `personas/*.md` 复制，之后以数据目录为准（`src/persona/personas.js:1-12`）。
- 记忆导入：面板 `POST /aurabot/api/memory/import`（喂一段旧档案文本，模型抽候选）→ `POST /aurabot/api/memory/import/commit`（`src/modules/memory/index.js:89-95`）。
- 白名单：`allow.private` / `allow.groups`（数组，字符串 QQ/群号；`src/core/config.js:23`）。
- 默认：`enabled=false`（总开关关）、`dryRun=true`（试运行开）——首次上线前必须手动打开。

## 5. 本机 Linux 能力盘点（影响哪些 Aurabot 功能可用）

| 能力 | 本机状态 | 影响 |
| --- | --- | --- |
| node | v24.19.0（满足 `>=22.13`） | ✅ |
| Python / venv | Python 3.12.3，`venv` 可用；无 `uv` | edge-tts 语音可装 |
| ffmpeg | **未安装**（`which ffmpeg` 空） | 语音条编码/翻唱混音相关功能需先装 |
| Chrome/Chromium/Edge | **未安装** | 刷抖音（需非 headless 浏览器）不可用 |
| 内存 | 3 GB，DSH 已占 ~1.8–2.0 GB | 同时跑两套风险高；建议停一套再起另一套 |

## 6. DSBot 侧现状（迁移对象）

- 生产人格：当前角色 `原装-大肥鱼`（`dsbot/state/current-role.json`），人格卡 `dsbot/roles/原装-大肥鱼.md`（3880 B）——
  **与 Aurabot 自带 `personas/dafeiyu.md` 是两份不同文本**（DSBot 版是用户自己改的），迁移时必须把这份文本搬进 Aurabot 人格，不要用自带默认覆盖。
- 角色数据在 `DSH_HOME/dsbot/characters/{da-fei-yu,...}`（persona.md、memory/*、purpose-outreach.json）。
- 记忆卡：`DSH_HOME/dsbot/memory/memory-card.md` 等（当前内容接近空，23% 容量、13.9k 字，主要是「还没有记忆」占位）。
- Token 额度：`DSH_HOME/dsbot/token-usage-{daily,state}.json`；预算配置在合体 `config.json`（`tokenBudget`/`pricing` 等）。
- B站：`bili.config.json` 只在，**当前未登录**（plugin.log：`生物钟未启动：B站 还没登录`），没有可搬迁的 B站 cookie 登录态 → 到 Aurabot 需重新登录。
- QQ 桥接白名单/黑白名单：在 `dsbot/config.json`（bridge 配置）`allow.*` / `deny.*`。
- 桥接控制台：`127.0.0.1:3100`（`consoleToken` 在 `dsbot/state/console-token`）。

## 7. 对两份 inventory「未确认项」的消解（Lead 实测）

| 原未确认 | 结论 | 证据 |
| --- | --- | --- |
| aurabot U1：能否在 DSH 0.2.1-rc.5 实际加载 | **已消解：能**（隔离 DSH_HOME 安装 + 启动成功；面板数据目录生成；日志 `Aurabot v1.1.24 已加载`） | 见 §3 实测 2/3；`/tmp/dsh-aurabot-compat/plugins-data/aurabot/logs/aurabot-2026-11-03.log` |
| aurabot U2：`github:aureth-labs/...` 能否匿名安装 | **已消解：能**（pnpm 成功拉取 aureth-labs 仓库 tar.gz） | `/tmp/aurabot-compat-add.log` |
| aurabot U3：aureth-labs 与上游是否同一 commit | **已消解：同一 commit** `b3301f6b014016e141c07d266a716c0fea566aab` | `git ls-remote` 两边 refs/heads/main 相同；pnpm tarball 也是该 sha |
| aurabot U6：python3-venv / uv | venv **可用**（Python 3.12.3 ensurepip OK）；**uv 未安装** | `python3 -c 'import venv,ensurepip'`；`which uv` 空 |
| aurabot U7：X/Xvfb / 浏览器 | **都没有**：`DISPLAY` 未设置、无 Xvfb、无 Chrome/Chromium/Edge | `echo $DISPLAY`、`which Xvfb xvfb-run`、`ls /usr/bin | grep -i chrom` |
| aurabot U4：SnowLuma WS `?access_token=` 是否被接受 | 仍未确认（SnowLuma 当前 QQ 未登录，OneBot 端口 reset，无法实连） | 前置条件恢复登录后再验 |
| aurabot U10：Linux 桌宠 Electron | 本机无桌面环境，不适用（迁移后可选项，不影响 QQ 机器人） | `DISPLAY` 未设置 |

补充修正（写正式文档时用）：
- aurabot 实际是「插件本体 + **3 个** preset」，README 里写「两个 preset」也不准确。
- 本机 **没有 ffmpeg**（`which ffmpeg` 空）→ Aurabot 的「B站抽帧看画面 / 语音条编码 / 翻唱混音」要先装 ffmpeg；语音 TTS 本身（edge-tts mp3）不依赖 ffmpeg。
- 本机 **没有 Chrome/Chromium/Edge / Xvfb** → 抖音模块不可用（需要非 headless 浏览器 + X）。
- **`dsbot-dsh.service` 就是当前这个 agent 会话所在的 DSH**：迁移时重启 DSH 会中断当前对话（先在面板/文档里说清楚，或从 systemd 外部执行）。
- SnowLuma 目前 EULA 未同意 + QQ 未登录（12:10 重启后 `awaiting EULA/PRIVACY consent` / `awaiting login: PID=80`），迁移第 0 步必须先恢复登录态。
