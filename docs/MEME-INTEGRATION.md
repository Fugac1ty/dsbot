# dsh-meme 接入 Aurabot QQ（表情包）

> 2026-11-03：把 [yyh-001/dsh-meme](https://github.com/yyh-001/dsh-meme)（v0.1.76）装进 DSH，并用一个 Aurabot 用户模块把它的图库接到 QQ 收发链路上。

## 装了什么

| 项 | 位置 / 说明 |
| --- | --- |
| dsh-meme 插件 | profile `dsh-0.2-home/profiles/web` 的依赖 `dsh-meme@^0.1.76`，bundle 已加入 `dsh.profile.bundles`；纯 insert 可热挂载，日志可见 `[dsh-expression] send_meme 已注册(Web通道,/dsh-memes)` |
| 内置图库 | `profiles/web/node_modules/dsh-meme/memes/dafeiyu-001`（24 张「大肥鱼」表情，带分类/描述/关键词） |
| 设置文件 | `~/.dsh/dsh-expression.json`（注意：dsh-meme 用 `HOME` 定位，不是 `DSH_HOME`；目前只有内置图库基线，没有额外配置） |
| 用户图库 | `~/.dsh/meme-packs`（可自己加图/建库；也可以在 dsh-meme 设置页导入 ZIP、市场装包） |
| QQ 桥接模块 | `dsh-0.2-home/plugins-data/aurabot/modules/qq-meme/`（用户模块，升级不覆盖） |

## qq-meme 模块做什么

1. **`qq_send_meme` 工具**：给她在 QQ 聊天里用。参数 `tag`（happy/angry/sad/shy/confused/daily）或 `query`（描述/关键词，如「猫 比心」「摸鱼」）。内部调 dsh-meme 的只读服务 `ctx.get('dshMeme').pick()` 拿**绝对路径**，读文件后用 Aurabot 原生图片消息发出（不是文字标记）。每个聊天 15 秒冷却，一次一张。
2. **`qq_meme_list` 工具**：只读候选清单（不发图），方便她换关键词/挑图。
3. **标记自动转图（兜底）**：dsh-meme 的全局提示词会让她写 `[表情: 描述]`，而 QQ 没有前端配图器。模块在回复落地前把
   - `[表情: 描述]` → 按描述检索图库 → 换成真实图片；
   - 原生 `<sticker:开心>` 这类标记 → 按情绪桶映射成 dsh-meme 图片（图库为空时不再出现「没找到这张表情」）；
   每条回复最多转 2 张，找不到描述就只去掉标记、不编造。
4. **规则注入**：`aurabot_rules_*` 里加一条「氛围合适用 qq_send_meme 直接发，写 `[表情: …]` 也会自动转图」；设置关掉后规则和工具一起消失。

路由（调试用）：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/aurabot/api/ext/qq-meme/status` | 服务是否就绪、图库列表、抽一张样例 |
| POST | `/aurabot/api/ext/qq-meme/send` | `{chatId, tag/query}` 真发一张（测试/运维用） |
| POST | `/aurabot/api/ext/qq-meme/simulate` | `{text}` 只做标记转换、返回要发的 items（不真发） |

## 验证记录（2026-11-03 23:14–23:20）

- 插件热挂载成功；`ctx.get('dshMeme')` 可用，`packs()` 返回 `dafeiyu-001 / 大肥鱼 / 24 张`，`pick({tag:'happy'})` 返回真实绝对路径与描述。
- 模块 `running: user`，工具 `qq_send_meme`、`qq_meme_list`，无报错。
- 真发测试：`POST /ext/qq-meme/send {chatId:'private:1362431704', tag:'happy'}` → SnowLuma 日志 `send_private_msg ... message=[len=1]`（图片消息已到主人 QQ）。
- 标记转换（simulate）：
  - `前面一句话 [表情: 爱心眼花痴] 后面一句话` → `[text, image, text]`
  - `好耶 [表情: 爱心眼花痴] 然后 <sticker:开心> 收工` → `[text, image, text, image, text]`

## 已知限制

1. **QQ 没有原生「表情」消息类型**：图片以图片消息发出，客户端可能按大图显示。dsh-meme 的「QQ 发图尺寸」只作用于它自己的 dsh-im/QQ 官方机器人通道，本链路不经过那里，所以**不会自动缩图**；要缩小得在 qq-meme 里加 sharp/ffmpeg 缩放（本机没装 ffmpeg）。
2. **GIF**：按原文件发（服务返回路径）；QQ 端是否保留动画取决于客户端。
3. **dsh-meme 的全局提示词对 DSH 里所有 agent 生效**（包括 GUI 会话）；它自身的「主动斗图」档位设置也只影响 Web 前端，不影响本 QQ 链路——QQ 侧节奏由 `qq-meme` 的 15 秒冷却和「最多 2 张」控制。
4. 目前只接了内置「大肥鱼」图库；想加自己的表情：把图片放进 `~/.dsh/meme-packs/<你的库>/` 并在 dsh-meme 设置页「扫描新增」，或用它的「从 QQ 收藏导入」/ZIP/市场（都自动对 qq-meme 生效）。

## 升级 / 停用 / 回滚

- 升级 dsh-meme：`dsh plugin --profile web add dsh-meme@latest` 后重启 DSH（或它支持的热挂载）。图库和设置不丢。
- 停用 QQ 桥接：Aurabot 面板「扩展」页把「表情包（dsh-meme 接入）」关掉（或目录改名加 `_` 前缀），几秒卸载；工具/规则/标记转换一起停。
- 彻底移除：删 `modules/qq-meme/` + `dsh plugin --profile web remove dsh-meme`；不影响 Aurabot 本体。

## 内置集成（已内置，随下一版发布）

> 2026-11-04：上面那套从「数据目录里的用户模块 qq-meme」搬进了 Aurabot 内置的 stickers 模块，不再依赖用户模块。dsh-meme 本身不用动：当前 profile 里已经装好 `dsh-meme@0.1.76`，用户不需要另外安装。**dsh-meme 的图库就是她的表情库**（`stickers.source` 默认 `auto`）；管理、偷表情、上传、改名、删除全在 Aurabot 的「表情包」页，不用打开 dsh-meme 自己的设置页。

### 代码位置

| 项 | 位置 |
| --- | --- |
| 只读适配层 | `src/features/dsh-meme.js`：`getMemeService` / `searchMemes` / `pickMeme` / `memeSegment` / `safeMemeFile` / `memePacks` / `bucketOf` |
| 写入 / 管理 API | `src/features/dsh-meme-api.js`：封装 `/dsh-memes-api`（只回环）的 `packs` / `listAll` / `upload` / `update` / `remove` / `setPack` / `setPackEnabled` / `createMemePack`；写别的图库时临时切当前图库再切回 |
| 表情来源 / 偷表情 | `src/features/stickers.js`：`sourceMode()` / `dshMemeOnly()`；`collect` / `addFromBuffer` / `importFromQQ` 在 dsh-meme 模式下写进「她偷来的表情」；`findEditTarget` / `editItem` 按来源改名/删除 |
| 工具 / 路由 / 回复改写 / 规则 | `src/modules/stickers/index.js`：`qq_send_sticker` / `qq_list_stickers` / `qq_collect_sticker` / `qq_save_sticker` / `qq_add_sticker` / `qq_edit_sticker` / `qq_import_qq_stickers` 全部保留；新增 `/sticker/meme/upload`、`/sticker/meme/update`、`/sticker/meme/delete`、`/sticker/meme/pack` |
| 面板 | `client/client.js`「表情包」页：上传、改名、改标签、删除、图库开关、筛选、刷新；没有跳 dsh-meme 设置页的入口 |
| 来源开关 | `config.stickers.source`：`auto`（默认，装了 dsh-meme 就用）/ `dsh-meme` / `local`（用回本地库） |
| 回归测试 | `test/dsh-meme.test.js`（17 条）+ `test/dsh-meme-manage.test.js`（4 条：偷表情/上传/改名删除/面板数据）+ `test/embed-dsh-meme-client.test.js`（3 条：摘入口/CRLF/幂等/恢复） |

### 来源与写入

- `source=auto`：`ctx.get('dshMeme')` 在、且 `stickers.dshMeme !== false` → 用 dsh-meme；否则用本地库。显式 `dsh-meme` / `local` 按配置来。
- **dsh-meme 模式**：发送、`<sticker:描述>`、自动配表情都从 dsh-meme 图库挑；偷表情（三种模式）通过管理 API 直接收进 **`aurabot-stolen`「她偷来的表情」** 图库；存表情 / 收画作 / 上传 / QQ 收藏导入也都写这个图库。本地库不参与。
- 写入前会 `ensurePack('aurabot-stolen')`（第一次自动建，已存在就复用），`upload/update/delete` 会临时把 dsh-meme 的当前图库切到目标图库再切回，避免改错库。
- **local 模式**：与接入前一致（本地库、偷表情、QQ 收藏导入、改名删图）。
- 管理 API 不可用（没装、端口拿不到、版本变了）：写入类操作回退到本地库（`addFromBuffer`）或返回可读错误；面板提示；只读服务仍然能用于发送。
- 只读服务契约、`contractVersion`、≤5MB、`safeMemeFile` 白名单等降级规则同上一版。

### 和旧 qq-meme 模块的差异

1. **来源**：旧模块只是旁路补充，本地库仍是主库；现在 dsh-meme 直接取代本地库（默认）。
2. **管理**：旧模块没有管理 UI；现在 Aurabot 面板直接管 dsh-meme 图库（上传/改名/标签/删除/图库开关），不需要它的设置页。
3. **偷表情**：旧模块不收；内置版保留三种偷法，收下即写进 dsh-meme「她偷来的表情」，马上就能发。
4. **标记转换**：`<sticker:描述>`、`[表情: 描述]` 都从 dsh-meme 找；每条回复最多 2 张，找不到只剥标记、不编造。local 模式按本地库转换。
5. **自动配表情**：dsh-meme 模式从它的图库挑（情绪词映射六桶）；local 模式用本地库。
6. **只读服务 + 写 API 两条路**：发送/检索走只读服务；写走 `/dsh-memes-api`，接口不可用不影响发送。

### 旧本地库迁移（之前偷来的表情）

- 脚本：`scripts/migrate-stickers-to-dsh-meme.mjs`，npm 别名 `pnpm migrate-stickers`。
  例：`node scripts/migrate-stickers-to-dsh-meme.mjs --aurabot-data /home/ubuntu/dsh-agentchat/dsh-0.2-home/plugins-data/aurabot`
- 读 `plugins-data/aurabot/stickers/index.json`，按 md5 去重，复制到 `~/.dsh/meme-packs/aurabot-stolen/`，写 `manifest.json` + `index.db`（caption=原名、keywords=原标签），并把图库加进 `enabledPacks`（写前备份）。
- 不删原本地库；重复执行只跳过已迁的图。示例环境已迁 7 张：汤圆、猫猕猴桃、蓝鲸猫、走路小猪、哭哭猪、躺平少女、握拳鹿女。
- 想用回旧库：`stickers.source: "local"`。

### 旧 qq-meme 用户模块：已停用

- 数据目录里 `plugins-data/aurabot/modules/qq-meme` 已改名 `_qq-meme`（保留可回滚），不再加载；本仓库代码不碰用户模块目录。
- 回滚：把 `_qq-meme` 改回 `qq-meme`，并把 `stickers.source` 设为 `"local"`，避免和内置的 dsh-meme 管理重复。
- dsh-meme 自己的 DSH 设置页 / 插件详情页入口已用 `scripts/embed-dsh-meme-client.mjs`（`pnpm embed-dsh-meme-client`）摘掉：改的是它已安装的 `client.js` 里两个 `slots.inject`（`settings.section` / `plugins.bundle.config`），其它 client 功能（输入框快捷发图）不动。原文件备份在 `client.js.aurabot-bak`，`--restore` 可还原；**dsh-meme 升级会覆盖，需要重跑**。这样表情包管理只留在 Aurabot 面板里。
