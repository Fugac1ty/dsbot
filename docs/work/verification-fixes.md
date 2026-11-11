# 核对报告处理记录（Lead 对 verifier 报告的逐条处置）

> 来源：`docs/work/verification-report.md`（verifier，2026-11-03 13:27–13:55）。
> 处置时间：2026-11-03 14:00 前后。两份正式文档已按下列方式修改；**未修的不是忽略，而是判定为「保留 UNVERIFIED 标注」或「口径说明」**。

## 一、阻断级

| # | 问题 | 处置 |
| --- | --- | --- |
| A-1 | Migration Step 3 方案 A 整段删除 MCP 区块会连带删掉同区块的 `llm-deepseek` + `agent-default-model`（DSH 无模型） | **已改**：Step 3 重写，明确「只删 3 个 MCP `insert:` 块，必须保留 llm 两段」；新增表格标注区块内每条目的迁移后表现与建议 |

## 二、事实错误

| # | 问题 | 处置 |
| --- | --- | --- |
| B-1 | Aurabot 工具数应为 45 模块 + 3 联动 = 48（原写 49）；`weather_now` 源码不存在 | **已改**：API 文档 §0/§1.3/§4.1 标题/§4.5/§5.1#22 全部改为 48（45+3）；§4.1 末尾删掉 `weather_now` 并注明它只是 API.md 示例 |
| B-2 | `/api/socialV2/*` 实际 45 个（原写 46） | **已改**：API 文档 §1.3/§4.3、Migration §10 统一为 45 |
| B-3 | Step 3 对 3 个 MCP server 的依赖判断错（35 走 3100 / 4 只读直连 3000；host 直连 3000 停桥后仍可用） | **已改**：Step 3 表格逐条重写 |
| B-4 | 「42 个 `mcp__snowluma__*`」表述错（42 = 39 + 1 + 2） | **已改**：Migration §0/§4/§10、API §0 全部改为「42 个 MCP 工具（39+1+2）」 |
| B-5 | 桌宠接口数：`/pet-api/*` 12 条、`/pet/*` 11 条（原写 14） | **已改**：API §4.2、§5.1#7 |
| B-6 | SurfCore 14 tab 与 15 行表不符；「记忆卡」不是独立 tab | **已改**：API §1.1 加口径说明（14 个真实 tab，记忆卡在「记忆」页内，表按能力拆 15 行） |
| B-7 | hook 数：10 可改写 + 7 只读（原写 11/9） | **已改**：API §1.3、§4.7 |
| B-8 | 插件内测试脚本 36 个（scripts/ 共 42 文件） | **已改**：API §4.4 |
| B-9 | `tools/bili.mjs` 子命令 46 个（原写 50） | **已改**：API §1.3、§4.4 |
| B-10 | `social-v2.json` 少一层 `conversations`；closure 私聊+群共 4 条 | **已改**：Migration §7 路径与条数；API §3.5 同步 |
| B-11 | `journalctl -u surfcore-dsh` 看不到插件日志（输出重定向到文件） | **已改**：Step 4 改 `tail -n 120 logs-surfcore-dsh.log`，并提示该文件含 `?token=` 需脱敏 |
| B-12 | WebUI 5099 不能走面板 `/vnc`（只代理 VNC 6081）；`docker logs --tail` 取密码会失效 | **已改**：§5 改为 SSH 隧道 + `docker logs ... | grep "initial credentials" | tail -20` |
| B-13 | 「aureth-labs 与上游同一 commit」verifier 无法独立验证（网络） | **保留 + 弱化措辞**：Lead 采集时 `git ls-remote` 两边输出一致（b3301f6b0140…），文档改为「同一 commit sha（采集时对照；不构成对镜像同步策略的背书）」 |

## 三、一致性冲突

| # | 问题 | 处置 |
| --- | --- | --- |
| C-1 | 「可感知降级」两份文档口径不同（4 vs 5） | **已改**：统一为 5 项（联网搜索/鱼群/补历史/token 闸/收尾），联网搜索项注明取决于 Step 3 是否保留 web-search MCP |
| C-2 | 分期编号 P0–P4 两文含义不同、记忆导入时机冲突 | **已改**：两文统一为「阶段 A–E」并对齐 Runbook Step；记忆转换可离线预做，导入/召回验收放阶段 D（上线后第 1 周） |
| C-3 | 「永久丢失」清单两文不一致；真人式分条不该并列永久丢失 | **已改**：API §5.2 成为唯一权威清单（能力型 10 项 + 数据机制型 5 项）；Migration §10 只做摘要并引用；真人式分条改为「体验下降/部分替代」 |
| C-4 | §5 交叉引用「见 §6 Step 4」应为 Step 3 | **已改** |

## 四、建议改进（已采纳）

- D-1/D-2：路由/API 计数加口径说明（74 = 69 + 5 `/open`，模块路由另计；桥接约 140 个字面量、精确去重 131）。
- D-3：Step 3 明确「根级 MCP 工具对所有 agent 可见（含 Aurabot QQ 会话），保留 web-search 则群聊也有联网搜索」，并据此修正 §10 的联网搜索表述。
- D-4：`--dump-config-schema` 由「无害告警」改为「报 `dsh: error`、退出码 1，属 schema 投影限制，不影响启动」。
- D-5：附录 B 标注为「13:00 前后实测，迁移时以实读为准」，内存/swap/sessions/snapshots 数值更新为区间。
- D-7：附录 A Python 脚本改用 `AU_DIR` 环境变量；补 `setupDone:true` 会触发 `OPT_IN_ON_UPDATE` 关闭 `qzoneSocial/bili/douyin` 的说明。
- D-10：Step 4 备注中 `dsh-secure-proxy` 改称「依赖」而非 bundle；Drop 无关实例提示保留。

## 五、保留为 UNVERIFIED（诚实标注，不修）

- A-1（SnowLuma WS `?access_token=` 鉴权）、A-2（`/aurabot/api/*` 是否受 DSH 鉴权）、浏览器面板在 rc.5 上的渲染、SnowLuma 扩展 action（空间/表情/改资料/语音转文字）本机支持性——均依赖「QQ 登录恢复」或「启动隔离实例」，当前无法实测；两份文档都在「未确认项/风险」处显式标注。
- 验证清单 §12 已把 A-1/A-2 变成上线时必查项；风险表新增「浏览器面板未实测」。
