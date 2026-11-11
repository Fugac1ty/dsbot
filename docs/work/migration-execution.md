# 迁移执行记录（2026-11-03 20:00–21:4x）

> 本文件记录**实际执行**与文档计划的差异；计划见 `docs/AURABOT-MIGRATION.md`。

## 已完成

| 步骤 | 结果 |
| --- | --- |
| 备份 | `插件/migration-backup-2026-11-03-2002/`（profile 三件套 + `dsh-0.2-home/surfcore` 全量 + 桥接 `state/` + `config.json` + `roles/`，均 tar.gz；另在 `插件/` 根下留了 `.tar.gz` 合并包） |
| 停旧桥 | `systemctl disable --now surfcore-bridge` → inactive/disabled，`bridge.js` 进程已退出 |
| 装 Aurabot | **改用本地源码 link 安装**：`github:` spec 在本机被 git 解析成 `git+ssh`（Host key 失败），`git+https` 拉取超时；于是把已验证的 clone 复制到 `/home/ubuntu/dsh-agentchat/aurabot-qq-src`（HEAD `b3301f6`）后 `dsh plugin --profile web add /home/ubuntu/dsh-agentchat/aurabot-qq-src`。profile 依赖为 `link:…`，升级方式：`git -C /home/ubuntu/dsh-agentchat/aurabot-qq-src pull` 后重启 DSH |
| 卸 SurfCore | `dsh plugin --profile web remove surfcore`；bundle/依赖已移除，仓库与两处状态完整保留 |
| profile patch | 只删了 `mcp-snowluma`、`mcp-snowluma-host` 两个 `insert` 块；**保留** `mcp-web-search-safe` 与 `llm-deepseek`/`agent-default-model`（整段删会丢模型配置）。`--dump-config` 校验 exit 0，含 aurabot + 3 preset，无 surfcore bundle |
| 配置 | 预写 `plugins-data/aurabot/config.json`：`gateway=onebot`、`botQQ=2477094441`、`ownerQQ=1362431704`、`allow.private/groups` 原值、`model=deepseek-official/deepseek-flash/high`、`enabled=false`、`dryRun=true`、`setupDone=true`，其余新功能（voice/speakUp/diary/qzoneSocial/bili/douyin/heybox/imageGen/song/purpose）先关 |
| 人格 | `characters/da-fei-yu/persona.md`（3880 B）→ `plugins-data/aurabot/personas/da-fei-yu.md`，`persona.current=da-fei-yu`（自带 `dafeiyu.md` 保留） |
| 记忆 | 303 条全量卡 + `social-v2.json` 的记忆类字段 → `memories.json`，共 **229 条**（丢弃 81 条 `isSelf`；主人 165 条保留；进行中话题/收尾承接各转记忆） |
| 激活 | 由 `systemd-run` 独立单元执行：停 DSH → 重写最终 config/persona/memories → 启 DSH → 自检（`Aurabot v1.1.24 已加载`）→ 失败自动回滚；日志 `docs/work/migration-activate.log` |

## 环境注入的意外（已处理）

- 执行 `dsh plugin add` 时，**运行中的 DSH 热加载了 Aurabot 默认配置实例**（日志 21:24 `Aurabot v1.1.24 已加载`），并在 21:33 用自己的默认值覆盖了 `config.json`（`enabled=true`、`gateway=snowluma`、allow 空）。因此激活脚本改为「先停 DSH、再写最终配置、再启动」，避免再次被覆盖；live 实例生成的 `sessions.json/diary.json/qzone-social.json/speakup.json` 已清掉。
- 该 live 实例在 dryRun 下跑了几轮空间日记（未真发），属预期内的小额 token 开销。

## 尚未完成 / 需要人工

1. **SnowLuma 的 QQ 登录态仍是断的**（`awaiting EULA/PRIVACY consent` + `awaiting login`，`:3000` 连接 reset）。需要人工：
   - SnowLuma WebUI（`ssh -L 5099:127.0.0.1:5099` 后开 `http://127.0.0.1:5099`）完成 EULA/隐私同意；
   - VNC（面板 `/vnc/vnc.html` 或 `http://127.0.0.1:6081`）登录机器人 QQ（扫码）。
2. 登录后打开 Aurabot 面板：确认「连接」= connected、登录核对 2477094441；先总开关开 + 试运行开验证，再关试运行。
3. surfcore-bridge 保持 disabled（回滚时才重新 enable）；SurfCore 仓库/数据未删。
4. 未实测项（WS token 鉴权、`/aurabot/api/*` 鉴权、浏览器面板渲染、SnowLuma 扩展 action）按 `docs/AURABOT-MIGRATION.md` §12 验收。

## 迁移后补装（2026-11-03 夜）

- **Token 额度与花费**：SurfCore 的额度/统计以用户模块 `token-budget` 补回（`docs/TOKEN-BUDGET-MODULE.md`）。
- **dsh-meme 表情包**：安装 `dsh-meme@0.1.76` 插件，并以用户模块 `qq-meme` 接进 QQ（`docs/MEME-INTEGRATION.md`）；`qq_send_meme` 工具 + `[表情: …]`/`<sticker:…>` 自动转真实图片。
