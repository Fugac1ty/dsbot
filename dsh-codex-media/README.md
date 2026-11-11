# dsh-codex-media

让 **DeepSeek Harness 连上 Codex 做「生图」** 的 DSH 插件：注册 `codex_imagegen` 工具，把 Codex 内置的
`image_gen`（GPT Image）当成 DSH 的图片生成能力 —— 生成/编辑图片、把成品 PNG 落到工作区、并在 Web GUI
里以内联图片展示。

同时附带一个 `codex_vision` 工具：把图片交给 Codex 的视觉能力，返回文字描述（文本模型「看图」的补丁）。

| 工具 | 作用 | 是否需要 OPENAI_API_KEY |
|---|---|---|
| **`codex_imagegen`** | 生图 / 改图（调用 Codex 内置 `image_gen`，默认 gpt-image 系列） | 否（用 Codex 登录态） |
| `codex_vision` | 识图 / 看图回答（Codex 视觉） | 否（用 Codex 登录态） |

## 为什么是「Codex + 工具」

Codex CLI 0.16x 自带稳定的 `image_generation` 功能：agent 内置 `image_gen` 工具（GPT Image），负责
prompt 增强、参考图/编辑、透明背景等，并把结果存到 `$CODEX_HOME/generated_images/`。本插件做的是**桥**：

```
DSH agent ──codex_imagegen(prompt, output?, reference_images?)──▶ 插件
                                                               │ spawn `codex exec --json`
                                                               ▼
                                                     Codex agent + 内置 image_gen
                                                               │ 生成 PNG
                                                               ▼
                      event.savedPath ──▶ 复制到 <workspace>/output/imagegen/xxx.png
                                                               │
                      attachment store ──▶ 工具结果里内联返回图片（Web GUI 直接显示）
```

- 不需要 `OPENAI_API_KEY`（走 Codex 的 ChatGPT/账号登录），这是和「直接调 OpenAI images API」最大的区别；
- 生成的图片是**工作区里的真实文件**，后续可以 `present`、`read_image`、给网页用、再喂回 `codex_imagegen` 做迭代；
- 部署支持 durable attachment 时，工具结果带 image block，聊天窗口直接看到图；不支持时退化为文字 + 路径。

## 前置条件

| 依赖 | 要求 |
|---|---|
| DSH | `0.2.1-rc.5`（`engines.dsh` 声明 `>=0.2.1-rc.5 <0.3.0`） |
| Codex CLI | `>= 0.16x`；本机：`/home/ubuntu/.local/bin/codex`（v0.165.0） |
| Codex 登录 | **必须**：`codex login`（或 API key），否则工具返回可读的「未登录」错误 |
| image_generation 功能 | Codex 内置，`codex features list` 里应为 `image_generation stable true` |

自检：

```bash
codex --version
codex login status                                   # 需要显示已登录
codex features list | grep image_generation          # stable  true
```

### 登录 Codex（本机当前尚未登录）

```bash
codex login                                          # 有浏览器：ChatGPT 登录
# 无头服务器：
printenv OPENAI_API_KEY | codex login --with-api-key
codex login status
```

> 当前这台机器 `codex login status` 输出 `Not logged in`：插件装好后，第一次调用会返回
> `[EXIT_NONZERO] ... Codex 未登录：请先在 DSH 宿主机执行 codex login...`，登录后再调用即可。
> Codex 凭据在 `CODEX_HOME`（本机包装脚本指向 `dsh-agentchat/.tools/codex-home`）。

## 安装

插件就是本目录，DSH 侧需要三件事：`package.json` 依赖、`dsh.profile.bundles` 里加一项、
`profile/node_modules` 里一个指向本目录的软链。三种方式任选其一。

### 方式 A：DSH Web 插件页（推荐）

DSH Web GUI → 左侧 **Plugins / 插件** 页 → 添加本地插件（`link:` 目标）填：

```
/home/ubuntu/dsh-agentchat/插件/dsh-codex-media
```

安装后自动加入 bundle 选择；开着 HMR 的 profile 几秒内生效，无需重启。

### 方式 B：`dsh plugin` 命令

```bash
# 需要能写 profile 目录（在 DSH 文件沙箱之外的宿主机终端执行）
dsh plugin --profile web add link:/home/ubuntu/dsh-agentchat/插件/dsh-codex-media
```

### 方式 C：离线安装脚本（不需要 pnpm）

```bash
node /home/ubuntu/dsh-agentchat/插件/dsh-codex-media/scripts/install.mjs \
  --profile "$DSH_HOME/profiles/web"

# 预览 / 卸载
node scripts/install.mjs --profile "$DSH_HOME/profiles/web" --dry-run
node scripts/install.mjs --profile "$DSH_HOME/profiles/web" --uninstall
```

脚本会备份 `package.json`、写入 `"dsh-codex-media": "link:<本目录>"`、把 `dsh-codex-media` 追加到
`dsh.profile.bundles`、并在 `profile/node_modules/` 建软链。HMR 开启时自动重载，否则重启 DSH。

> 本机生产 profile：`DSH_HOME=/home/ubuntu/dsh-agentchat/dsh-0.2-home`，
> profile 目录 `/home/ubuntu/dsh-agentchat/dsh-0.2-home/profiles/web`。
> 注意：DSH agent 自己的 bash 工具受 workspace 沙箱限制，写不了这个目录，请在宿主机终端运行。

## 使用

### 生图

模型/用户调用示例：

```jsonc
{
  "prompt": "一只戴着墨镜、坐在冲浪板上的鲸鱼，扁平插画风，背景是渐变晚霞，16:9 横构图",
  "output": "assets/whale.png"
}
```

```jsonc
{
  "prompt": "把背景换成雪夜街道，保持主体和构图不变",
  "reference_images": ["/home/ubuntu/dsh-agentchat/assets/whale.png"],
  "output": "assets/whale-snow.png"
}
```

- `prompt`：必填，生图/改图需求。细节越具体越好（主体、风格、构图、光线、画面里的文字要逐字写清楚）。
- `output`：可选，工作区内的 `.png` 路径（相对 session 工作目录）。省略时用
  `output/imagegen/codex-<时间戳>-<随机>.png`；目标已存在时自动变成 `xxx-v2.png`（除非配置 `overwriteOutput: true`）。
- `reference_images`：可选，参考图/编辑目标；支持本地路径、`http(s)` URL、`data:image/...;base64`。
  编辑类需求把被编辑图放第一张。
- `transparent_background`：可选，要求 image_gen 输出透明背景（alpha）。

返回值（工具结果）：

```jsonc
{
  "path": "/home/ubuntu/dsh-agentchat/output/imagegen/codex-2026-11-03_04-30-00-abc123.png",
  "relativePath": "output/imagegen/codex-....png",
  "mediaType": "image/png",
  "bytes": 1832456,
  "elapsedMs": 48213,
  "revisedPrompt": "…image_gen 实际使用的增强提示词…",
  "attachment": { "attachmentId": "…", "mediaType": "image/png", "bytes": 1832456, "width": 1536, "height": 1024 }
}
```

有 `attachment` 时 Web GUI 会直接内联显示图片；没有 attachment store 时只有文字 + 路径。

### 识图（附带）

```jsonc
{
  "images": ["/path/to/screenshot.png"],
  "prompt": "把截图里的报错信息逐字转写出来，并指出是哪一行在崩"
}
```

`images` 支持本地路径、`http(s)` URL、`data:image/...;base64`；`prompt` 省略则详细中文描述。

### 发到 QQ / 聊天客户端（Aurabot）

两种方式，优先用第一种（不依赖模型）：

1. **直接投递（推荐，`qqDelivery.enabled: true`）**：插件读 Aurabot 的
   `$DSH_HOME/plugins-data/aurabot/{config.json,sessions.json}`，用它的 OneBot HTTP 连接
   （`snowluma.httpUrl` + token）把图直接发回**当前这一轮所在的 QQ 聊天**（只认 sessionId 精确匹配的聊天，
   不接受外部聊天号；Aurabot 总开关关着或试运行时不发）。成功时工具结果写「已直接发到 QQ」，
   不再给下面那行语法，避免重复发。
2. **文字兜底**：工具结果里还会附带一行 **QQ/Aurabot 发图语法**：

```
![图片](/绝对路径/xxx.png)
```

Aurabot 的回复解析器（`src/chat/reply.js`）会把这种 Markdown 图片行转成 image 消息段，
`src/core/net.js` 的 `fetchImage` 支持本地绝对路径（10 MiB 以内），所以模型只要把这一行原样放进
最终回复，图就会以图片消息发到 QQ（群聊/私聊都行）。Web GUI 本身则直接内联显示附件，不需要这行。

> 如果 QQ 那边仍然只收到文字，检查：路径必须是本机绝对路径、文件 ≤10MiB、且模型真的把这一行原样输出了
> （Aurabot 会把普通 Markdown 洗掉，但这一行是它的图片语法，不会被洗）。

## 配置

在 profile 的 `cordis.patch.yml` 里按 id `dsh-codex-media` 覆盖（patch 整体替换 config，
未写的字段由插件内 Config 兜底默认值）：

```yaml
- id: dsh-codex-media
  config:
    imageTimeoutMs: 600000       # 生图超时（生图普遍 30~120s，网络慢可调大）
    outputDir: output/imagegen   # 生图默认输出目录
    model: ''                    # Codex agent 模型（不是 image 模型）；留空用 Codex 默认
    command: codex               # Codex 可执行文件（PATH 名或绝对路径）
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `command` | `codex` | Codex 可执行文件 |
| `prefixArgs` / `extraArgs` | `[]` | 插在 `exec` 前 / 追加到命令行（高级） |
| `model` | `''` | Codex agent 模型；生图用的是 Codex 内置 image_gen 的默认 image 模型 |
| `codexHome` | `''` | 非空时作为子进程 `CODEX_HOME` |
| `env` | `{}` | 追加给 Codex 子进程的环境变量 |
| `checkLogin` | `true` | 调用前先跑 `codex login status`：未登录时**快速失败**（几秒）而不是在 exec 里等网络重试；设置 `OPENAI_API_KEY` 时自动跳过 |
| `imageSandbox` | `workspace-write` | 生图时 Codex 沙箱（需要能往工作区写结果） |
| `imageTimeoutMs` | `300000` | 单次生图超时，到点杀整个 Codex 进程组 |
| `maxReferenceImages` | `4` | 参考图数量上限 |
| `maxGeneratedBytes` | `52428800` | 成品图字节上限（50 MiB） |
| `outputDir` | `output/imagegen` | 默认输出目录（相对 session 工作目录） |
| `overwriteOutput` | `false` | 目标同名时是否覆盖（默认生成 `-v2` 兄弟文件） |
| `qqDelivery.enabled` | `false` | 生成后直接把图发回当前 QQ 聊天（Aurabot 会话；用它的 OneBot 连接和 session↔chat 映射，不依赖模型输出） |
| `qqDelivery.aurabotDataDir` | `''` | Aurabot 数据目录；空 = `$DSH_HOME/plugins-data/aurabot` |
| `qqDelivery.timeoutMs` / `maxBytes` | `120000` / `50MiB` | 发送超时 / 图片大小上限 |
| `sandbox` | `read-only` | 识图时 Codex 沙箱 |
| `timeoutMs` | `180000` | 识图超时 |
| `maxImages` / `maxImageBytes` | `6` / `20 MiB` | 识图数量、单图字节上限 |
| `allowUrls` / `allowDataUrls` | `true` | 是否允许 URL / data URL 图片输入 |
| `allowPrivateUrls` | `false` | 是否允许内网/本机 URL（SSRF 防护，默认拒绝） |
| `defaultPrompt` | 中文详细描述 | `codex_vision` 未给 prompt 时的默认请求 |

### 网络受限环境（本机就是这样）

本机直连 `chatgpt.com` 会超时，Codex 必须走本地代理。生产 profile 里已给插件配置：

```yaml
- id: dsh-codex-media
  config:
    checkLogin: true
    env:
      HTTPS_PROXY: http://127.0.0.1:7890
      HTTP_PROXY: http://127.0.0.1:7890
      ALL_PROXY: http://127.0.0.1:7890
      NO_PROXY: 127.0.0.1,localhost
```

换机器/换代理端口时改这里（或改用 `OPENAI_API_KEY` 走 API 模式）。代理不通时工具会返回
`EXIT_NONZERO` + Codex 的 network 错误，据此排查。

## 实现细节

- 生图提示词要求 Codex：必须真的调用 `image_gen`、把最终图复制到目标路径、只回复 `DONE <path>`。
- 插件用 `codex exec --json --sandbox workspace-write -C <workspace> ... -` 调用（prompt 走 stdin，避免参数注入），
  从 JSONL 事件里读 `savedPath`（兼容 camelCase/snake_case、app-server 封套、内联 base64、`failure` 事件）。
- 找不到事件路径时依次兜底：目标路径已存在（Codex 自己复制了）→ 扫描工作区里新出现的图片 →
  否则返回 `NO_IMAGE` / `IMAGE_GEN_FAILED`（附 Codex 最后回复，方便定位）。
- 成品校验 magic bytes（PNG/JPEG/WebP/GIF）与体积，原子写入；附件入库失败不影响文件产出。
- 参考图复用识图链路的图片解析（本地/URL/data URL、SSRF 防护、大小与格式校验、临时文件清理）。

## 安全

- Codex 生图跑在 `workspace-write` 沙箱、`-C <session 工作目录>`，输出路径被强制限制在工作区内；
- 只接受 `.png` 输出路径（内置 image_gen 输出 PNG，插件不做格式转换）；
- prompt 通过 stdin 传递，不会被当成命令行开关；
- 超时/中止会杀掉 Codex 整个进程组并清理临时文件；
- 输入图片（参考图）走与识图相同的 SSRF/体积/格式防护；
- **图片内容会发送给 OpenAI（Codex 的模型）**，敏感图片请自行判断。

## 排错

| 现象 | 原因 / 处理 |
|---|---|
| `[COMMAND_NOT_FOUND]` | PATH 里没有 `codex`：装 `@openai/codex`，或配置 `command` 绝对路径 |
| `[EXIT_NONZERO] … Codex 未登录` | `codex login` 或 `printenv OPENAI_API_KEY \| codex login --with-api-key` |
| `[IMAGE_GEN_FAILED] … usageLimitExceeded` | Codex 账号生图额度用尽，等重置或换账号 |
| `[NO_IMAGE]` + Codex 最终回复 | Codex 没调用 image_gen / 被拒；看回复里的原因，或重试 |
| `[TIMEOUT]` | 生图慢：调大 `imageTimeoutMs`，或简化 prompt（少文字/少细节） |
| `[OUTPUT_OUTSIDE_WORKSPACE]` / `[INVALID_OUTPUT]` | 输出路径必须在 session 工作区内且以 `.png` 结尾 |
| `[URL_FORBIDDEN]` | 参考图 URL 指向内网被拦；可信时设 `allowPrivateUrls: true` |
| 工具列表里没有 `codex_imagegen` | bundle 未启用 / profile 未重载 / import 失败，看 DSH 启动日志 |

## 开发 / 测试

```bash
cd /home/ubuntu/dsh-agentchat/插件/dsh-codex-media
node --test test/*.test.mjs        # 118 个用例，全部使用假 codex，不联网、不需要凭据
```

```
dsh-codex-media/
├── package.json            # bundle 声明：dsh.bundle.patch
├── cordis.patch.yml        # bundle patch：插入 dsh-codex-media 插件行
├── lib/
│   ├── index.js            # Cordis 插件：注册 codex_imagegen / codex_vision
│   ├── imagegen.mjs        # 生图纯逻辑：prompt、JSONL 事件解析、输出路径、落盘/兜底扫描
│   ├── image-source.mjs    # 图片来源 → 本地文件（URL/data URL/SSRF/体积/格式/临时文件）
│   └── codex-exec.mjs      # spawn codex exec（超时/中止/进程组/--json/stdout 捕获）
├── test/                   # node:test 单测 + fake-codex 夹具 + 1x1 PNG
├── scripts/install.mjs     # 离线安装/卸载脚本
├── docs/CONTRACT.md        # 模块接口契约（并行开发用）
└── README.md
```

插件依赖由 DSH profile 提供（`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery`）；本目录放了指向
本机 DSH 安装的 `node_modules/@deepseek-ai/*` 软链，所以 `link:` 安装方式下可直接 import。

## 已知限制

- 每次生图都会起一个 Codex 进程（冷启动 + agent 推理，通常 20~120 秒）；不做常驻进程复用。
- 内置 `image_gen` 不接受 size/quality/model 参数（那是 CLI/API fallback 的能力）；比例、质量请写进 prompt。
- 同一 prompt 多次调用结果不同（生成模型本身特性）；要可复现请自行保存 prompt。
- 透明背景取决于 `image_gen` 是否支持；不支持时会得到普通背景。
- 依赖 Codex 登录态；未登录时两个工具都会返回明确的登录提示（`checkLogin` 预检让它在 1~2 秒内失败，而不是等 Codex 网络重试）。
- 也可以通过环境变量 `OPENAI_API_KEY` 使用 API key 模式（此时跳过登录预检，Codex 走 API）。
