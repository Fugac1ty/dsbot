# 迁移计划（阶段二，等 8 个包全部完善后再执行）

> 阶段一（当前）：旧 `surfcore` 一行不改，新拆分包在 `插件/` 下独立开发、离线测试。
> 阶段二（本文件）：把新包装进 DSH、停用旧包、验证、最后归档旧包。
> **本阶段不要执行本文件里的安装动作**，除非用户明确要求。

---

## 0. 前置条件（全部满足才开工）

- [ ] 8 个包 `node scripts/test-smoke.mjs` 全绿；`node tools/verify-all.mjs` 全绿。
- [ ] 每个包都有 `README.md` + `PLAN.md` 完成标记；`docs/SPLIT-ARCHITECTURE.md` 的验收标准逐条打勾。
- [ ] 用户确认迁移窗口（迁移期间 QQ 桥接与 B站 生物钟会停一会）。
- [ ] 全量备份（至少这四样）：
  ```bash
  tar czf ~/surfcore-backup-$(date +%F).tar.gz \
      ~/.dsh/surfcore \
      ~/dsh-agentchat/surfcore/config.json \
      ~/dsh-agentchat/surfcore/plugins/surfcore \
      ~/dsh-agentchat/dsh-0.2-home/profiles/web/{package.json,cordis.patch.yml}
  ```

---

## 1. 迁移顺序（为什么是这个顺序）

| 步 | 动作 | 原因 |
| --- | --- | --- |
| 1 | 停 QQ 桥接 + B站 生物钟（设置页「启动开关」关掉，或停用旧插件并等 2 分钟） | 旧插件会自愈拉起桥接进程 |
| 2 | 安装 `surfcore-core` → 重启 DSH → 打开「SurfCore · 核心」看数据是否读到 | 所有包共用配置模型，先验证读取正确 |
| 3 | 安装 `surfcore-character` → 验证角色页能切换、记忆路径跟着变 | 角色决定人格卡/记忆路径，后续包依赖它 |
| 4 | 安装 `surfcore-memory` → 验证记忆卡摘要、压缩、双向同步开关 | 桥接与 B站 都读它渲染的注入块 |
| 5 | 安装 `surfcore-token` → 验证今日用量、额度保存 | B站 额度闸门读它的快照 |
| 6 | 安装 `surfcore-voice` → 验证语音包列表/启停/试听 | 桥接/桌宠发语音用它 |
| 7 | 安装 `surfcore-bili` → 验证生物钟能启动、观看历史 | 依赖 4/5/6 的产物 |
| 8 | 安装 `surfcore-qq` → 验证桥接启停、白名单、模式、`qq-mode` 命名空间 | 最后装，因为它会拉起桥接进程 |
| 9 | 安装 `surfcore-pet`（可选，未装桌宠就不需要） | 桌宠 API 前缀与旧插件冲突，**必须旧插件停用后再装** |
| 10 | 停用并移除旧 `surfcore` bundle | 完成后旧插件不应再被加载 |
| 11 | 全链路回归（见 §3） | |

每一步之间重启 DSH（`dsh` 侧 HMR 对 bundle 补丁不一定生效，重启最稳）。

---

## 2. 共存冲突清单（迁移期必须知道的硬冲突）

| 冲突点 | 旧插件 | 新插件 | 处置 |
| --- | --- | --- | --- |
| `qq-mode` settings 命名空间 | 旧 bundle 的 `qq-mode` 行 | `surfcore-qq` 的同名行 | 同一命名空间只能有一个提供者：**先停旧再装新** |
| 桌宠 API 前缀 `/dsh-surfcore/pet-api` | 旧 `lib/pet-api.js` | `surfcore-pet` | 同上 |
| `/dsh-surfcore/health` | 旧插件 | 新包各自 `/dsh-<包名>/health` | 不冲突（名字不同） |
| 设置栏目 | 「SurfCore」一个 | 8 个「SurfCore · X」 | 可共存（栏目不同），但会重复显示两份设置入口 |
| 后台任务（桥接自愈 / B站 tick / 记忆卡维护 / token 采集） | 旧插件 | 新包各自 | **必须避免两边同时跑**：迁移期按上表顺序，每装一个新包就停旧的对应能力；最稳是「先停旧插件，再逐个装新包」 |
| 配置写入 | 旧插件无锁 | 新包有锁 | 两边同时写会丢更新 → 不要同时运行 |

> **推荐的最简迁移路径**：备份 → **停用旧插件** → 按顺序装 8 个新包 → 全链路回归。
> 中间不需要新旧并存（离线测试已经覆盖了「新包自己能不能起」）。

### 2.1 数据兼容性

不需要迁移数据。新包读写的是**同一批文件**：

- `<surfcore>/config.json`、`~/.dsh/surfcore/config.json`、`~/.dsh/surfcore/bili.config.json`
- `~/.dsh/surfcore/{memory,characters,pet,bili}/`、`token-*.json`、`backups/`
- `<surfcore>/state/*`（只读）

旧配置里存在、新包不认识的键**必须原样保留**（`updateJsonFile` 的读-改-写语义保证这一点）。

### 2.2 两个 QQ agent preset 与工具守卫

旧包里 `presets/qq-chat.patch.yml`、`presets/qq-chat-v2.patch.yml`、`qq-tool-restrict.mjs`
**不属于 8 个部件**，迁移时有两种选择：

1. 保留旧 bundle 仅用于提供 preset（把旧插件行 `disabled: true`，preset patch 仍生效）；或
2. 把这两个 preset patch 移到一个新的小 bundle `surfcore-presets`（另开任务）。

**不要**直接把 preset 塞给 `surfcore-qq`：preset 属于 agent 配置，与 QQ 桥接插件生命周期不同。

---

## 3. 迁移后全链路回归清单

- [ ] DSH 设置里 8 个栏目都能打开，无 404 / 500；浏览器控制台无 import 报错。
- [ ] 角色：切换角色 → `characters/current-role.json` 更新 → 人格卡内容跟随。
- [ ] 记忆：记忆卡摘要/容量条正常；手动压缩成功；`memory/memory-card-prompt-qq.md` 有更新。
- [ ] 额度：今日用量递增；改额度后 `token-budget.json` 变化；80% 提醒弹一次。
- [ ] 语音：语音包列表正常；启动/停止可用；发一条测试语音（桥接在跑时）。
- [ ] B站：生物钟 `running=true`；观看历史有数据；额度到顶时不再叫醒。
- [ ] QQ：桥接启停/重启；白名单保存后 `<surfcore>/config.json` 变化且桥接重启后生效；
      模式切换写入 `qq-mode` 命名空间；SnowLuma 检测正确。
- [ ] 桌宠（若安装）：`pet/host.json` 由新插件写；桌宠能连上新端口；对话/语音正常。
- [ ] 所有插件停用后：DSH 退出不被定时器吊住；桥接不被反复拉起。
- [ ] `~/.dsh/surfcore/plugin.log` 里 8 个包各自有激活日志，没有异常堆栈。

---

## 4. 回滚

1. 停用 8 个新 bundle（`plugin_manager` 里禁用或从 profile 移除）。
2. 恢复备份的 `~/.dsh/surfcore` 与 `config.json`（新包只使用锁与备份，不改旧结构；但为稳妥仍恢复）。
3. 重新启用旧 `surfcore` bundle，重启 DSH，确认桥接与生物钟恢复。

---

## 5. 归档旧插件（只有在回滚窗口过后）

- [ ] 旧 `surfcore` bundle 从 profile 的 bundles 列表移除，`dsh-0.2-home/plugins/surfcore` 符号链接删除。
- [ ] `surfcore/plugins/surfcore` 保留一个 tag/分支（`legacy/surfcore-plugin`），不直接删。
- [ ] 更新 `surfcore/docs/` 与本工作区 README，标注「插件已拆分为 8 个独立包」。
- [ ] 把 `docs/PITFALLS.md` 里与插件相关的条目链接更新到新包路径。
