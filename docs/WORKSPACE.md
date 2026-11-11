# 工程侧：SurfCore 插件拆分工作区（`插件/`）

> 本文件是工程记录：8 个包是怎么从旧合体插件 `surfcore` 拆出来的、当前进度到哪。
> 产品与项目总览见根目录 [README.md](../README.md)。

把合体插件 `surfcore` 拆成**一个个单独的插件**。

- **拆分期间旧插件一行不改**（`../surfcore/plugins/surfcore/**` 只读）。
- 新插件全部在本目录独立开发、离线测试（不装进 DSH、不连 QQ、不写真实 `~/.dsh`）。
- 全部完善后再按 [MIGRATION.md](MIGRATION.md) 整体迁移。

## 8 个新插件

| 包 | 设置栏目 | 负责 |
| --- | --- | --- |
| [surfcore-core](surfcore-core/) | SurfCore · 核心 | 配置模型、管理员身份、概览/诊断、全部参数、扩展与平台、组件更新、备份、日志 |
| [surfcore-qq](surfcore-qq/) | SurfCore · QQ | QQ 桥接控制、`qq-mode` 命名空间、白名单/黑名单、SnowLuma、QQ 全部参数 |
| [surfcore-bili](surfcore-bili/) | SurfCore · B站 | B站 生物钟、扫码登录、养鱼参数、观看历史、口味、定时分享与四类动态 |
| [surfcore-memory](surfcore-memory/) | SurfCore · 记忆 | 衰减记忆卡、双向脱敏记忆、身份对齐、隐私闸门、主人审计 |
| [surfcore-character](surfcore-character/) | SurfCore · 角色 | 角色包创建/切换/存档回档、人格卡编辑、角色迁移 |
| [surfcore-token](surfcore-token/) | SurfCore · 额度 | 每日 token 额度与用量采集、峰谷计价、80%/100% 闸门 |
| [surfcore-pet](surfcore-pet/) | SurfCore · 桌宠 | 桌宠安装/更新/启停、桌宠对话、目的机制桌宠载体、pet host.json |
| [surfcore-voice](surfcore-voice/) | SurfCore · 语音 | 语音包安装/启停/健康检查、TTS 路由、角色音色与云端凭据 |

每个包都是**自包含**的（只 import 包内文件 + Node 内置 + 自己声明的 npm 依赖）；
旧代码用 `tools/vendor.mjs` 原样复制进 `lib/vendor/`，迁移后删掉旧仓库也不受影响。

## 文档

| 文档 | 内容 |
| --- | --- |
| [SPLIT-ARCHITECTURE.md](SPLIT-ARCHITECTURE.md) | 共同契约：包边界、目录标准、宿主服务、**配置锁协议**、**文件所有权**、跨包契约、API 约定、验收标准 |
| [PACKAGE-SPEC.md](PACKAGE-SPEC.md) | 实现手册：怎么搬宿主 handler、怎么搬浏览器组件、常见坑 |
| [MIGRATION.md](MIGRATION.md) | 阶段二迁移：前置条件、顺序、共存冲突、回归清单、回滚、归档 |
| `../surfcore-<part>/PLAN.md` | 每个包的具体取材清单（旧文件:行号 → 新包位置） |

## 迁移到 Aurabot（2026-11-03，线上机器人切换）

> 与上面的「拆分 8 个包」是两条线：这是把**线上正在跑的 QQ 机器人**从 SurfCore 切到
> [aureth-labs/dsh-aurabot-qq](https://github.com/aureth-labs/dsh-aurabot-qq) 的交付物（只写方案/对照，不改代码、不安装）。

| 文档 | 内容 |
| --- | --- |
| [AURABOT-MIGRATION.md](AURABOT-MIGRATION.md) | 迁移方案 / Runbook：拓扑、可行性实测、前置条件、分步命令、数据迁移、回滚、验证、时间估算 |
| [AURABOT-API-MAPPING.md](AURABOT-API-MAPPING.md) | 能力 / 配置 / 数据 / 接口对照 + 缺口与永久损失 |
| [TOKEN-BUDGET-MODULE.md](TOKEN-BUDGET-MODULE.md) | 补回：Token 额度与花费统计（用户模块 `token-budget`，峰谷四桶计价、额度闸门、`/budget`） |
| [MEME-INTEGRATION.md](MEME-INTEGRATION.md) | 接入：dsh-meme 表情包（用户模块 `qq-meme`，`qq_send_meme` 工具 + `[表情: …]` 自动转图） |
| `docs/work/` | 证据底稿：SurfCore 盘点、Aurabot 盘点、对照矩阵、Lead 实测记录 |

## 工具

```bash
node tools/new-plugin.mjs --name <包名> --title <栏目名> --prefix <API 前缀>   # 生成骨架（已完成，勿重复生成）
node tools/vendor.mjs --pkg <包> --roots <旧仓库路径,...> [--copy-dir <目录>]  # vendor 旧代码（结构保持）
node tools/vendor.mjs --pkg <包> --roots ... --check                          # 校验 vendor 与旧仓库一致
node tools/verify-all.mjs                                                     # 全量体检：清单 + 自包含 + 各包冒烟
node <包>/scripts/test-smoke.mjs                                              # 单包冒烟
```

- `tools/test-harness.mjs`：mock ctx / 假 req-res / 假 `window.__ModuleLoader__` / 自包含检查。
- `templates/client-kit.js`：从旧 `client.js` 摘出的公共 UI 套件（生成骨架时内联进每个包）。

## 当前状态

| 包 | 状态 |
| --- | --- |
| 基础设施（docs / tools / templates） | ✅ 完成 |
| 8 个包骨架 + PLAN | ✅ 完成 |
| surfcore-token | 🚧 示范包（Lead 实现中） |
| surfcore-core / qq / bili / memory / character / pet / voice | 🚧 分包实现中 |
| 全量验证 + 迁移文档校对 | ⏳ 待所有包完成 |

> 状态以各包 `node ../tools/verify-all.mjs <包名>` 与包内 `PLAN.md` 的勾选为准。
