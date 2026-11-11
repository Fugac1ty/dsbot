# Token 额度与花费（移植自 SurfCore）

> 2026-11-03 迁移到 Aurabot 后补齐：SurfCore 的「Token 额度 + 花费统计」以**用户模块**形式移植回来，升级 Aurabot 不会覆盖。

## 位置

| 项 | 路径 |
| --- | --- |
| 模块代码 | `$DSH_HOME/plugins-data/aurabot/modules/token-budget/`（`index.mjs` + `panel.js` + `prices.mjs`） |
| 数据 | `$DSH_HOME/plugins-data/aurabot/modules-data/token-budget/usage.json` |
| 面板 | Aurabot 面板 →「扩展」分组的 **Token 额度与花费**（模块页，含自定义面板） |
| QQ 命令 | 主人私聊发 `/budget`（别名 `/额度`、`/花费`） |

本机 `$DSH_HOME` = `/home/ubuntu/dsh-agentchat/dsh-0.2-home`。

## 计量口径（与 SurfCore 对齐）

- **数据源**：DSH 的 `session/event` 事件里 `assistant/message` 携带的 `usage`（不是估算）。
- **四桶**：`inputTokens`（未命中）/ `cacheReadTokens`（命中）/ `cacheWriteTokens` / `outputTokens` 分别计价，另记 reasoning。
  唯一模型来自 DSH 事件里 `message.source.provider/model`。
- **价目表**：`prices.mjs` 从 SurfCore `src/model-prices.js` **原样移植**（MIT）：deepseek-flash / v4-flash / v4-pro 等；未知模型按 flash 价并标估算。
- **峰谷**：工作日 9–12、14–18 点为高峰（×2），其余时段与法定节假日 ×1（节假日表同 SurfCore）。
- **分类**：
  - `QQ`：Aurabot 工作区里的 `private:*` / `group:*` 会话（按 Aurabot 自己的 chat→session 映射识别）；
  - `其他`：Aurabot 自己的后台会话（`agentPreset` 以 `aurabot-` 开头，如空间日记/后台想事情）；
  - **面板/GUI/子代理等别的 DSH 会话不计入**（与 SurfCore 的「其他」口径一致，避免你写代码的用量把 QQ 额度顶掉）。
- **幂等**：同一 `session|turn|step` 的重试只记增量，不重复累加。

## 额度与闸门

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | 开 | 额度统计与闸门总开关 |
| `gate` | 开 | 超额度后是否暂停回 QQ 消息 |
| `warnPct` | 80 | 达到总额度该百分比时**私聊主人提醒一次/天** |
| `dailyTotal` | **¥8/天** | 总额度（0 = 不限） |
| `dailyQQ` | 0（不限） | QQ 分类单独额度（0 = 不限） |
| `dailyOther` | 0（不限） | 其他分类单独额度（0 = 不限） |

- 达到/超过额度且 `gate=true`：新来的 QQ 消息会被模块认领（**不回消息**），并私聊主人通知一次/天；次日 0 点（北京时间）自动恢复。
- 改额度：面板模块页直接改，或 `POST /aurabot/api/ext/token-budget/config`；立即生效，不用重启。
- 闸门只影响 QQ 回复，不影响 `/budget` 等主人命令。

## 接口（模块路由）

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/aurabot/api/ext/token-budget/state` | 今日 QQ/其他/总额、tokens、轮数、额度百分比、闸门状态、按模型明细、当前峰谷 |
| GET | `/aurabot/api/ext/token-budget/history?days=7` | 近 N 天汇总 |
| POST | `/aurabot/api/ext/token-budget/config` | 保存额度设置（body 同设置键） |
| POST | `/aurabot/api/ext/token-budget/reset` | 清零今日统计（不改设置） |

自测（本机）：

```bash
curl -s http://127.0.0.1:3102/aurabot/api/ext/token-budget/state | python3 -m json.tool | head -40
```

## 与 SurfCore 原实现的差异（有意为之）

1. **没有「唤醒闸门」**：SurfCore 是桥接主动唤醒模型，额度 100% 时停唤醒；Aurabot 是推送式，所以改成「超额度就不回消息」。
2. **额度单位只有人民币**：SurfCore 支持 `¥8` / `8M` 双单位；这里只做人民币（要 token 数单位可再加）。
3. **分类口径**：只统计 Aurabot 自己的会话；GUI/子代理不计（SurfCore 的「其他」也只算它自己触发的用量）。
4. 没有 SurfCore 的「逐轮明细 CSV/图表/价目表自定义」——有需要可以在这个模块里继续加（`panel.js` + `index.mjs` 都在数据目录，改完几秒热重载）。

## 升级 / 停用 / 回滚

- **升级 Aurabot**：用户模块在 `plugins-data/` 下，升级不覆盖；无需任何操作。
- **停用**：面板「扩展」页把模块关掉（或把目录改名加 `_` 前缀），几秒内卸载；闸门和统计一起停。
- **回滚**：删掉 `modules/token-budget/` 与 `modules-data/token-budget/` 即可；不影响 Aurabot 本体。
- 模块用到的内部接口：`api.dsh.on('session/event')`、`api.core.hub.sessions()`、`api.core.http`、`api.send`、`api.command`——升级后若面板「扩展」页报错，看 `plugins-data/aurabot/logs/` 里的 `[token-budget]` 行。
