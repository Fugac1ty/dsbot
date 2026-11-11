# PLAN —— surfcore-memory

> 衰减记忆卡（维护/压缩/备份/注入块渲染）、双向脱敏记忆（QQ⇄B站）、身份对齐、隐私闸门、主人特权审计。
>
> **不负责**：记忆内容的产生者（桥接/调度器/pet 各自 append inbox）、角色人格卡本身。
>
> 架构契约：[../../docs/SPLIT-ARCHITECTURE.md](../../docs/SPLIT-ARCHITECTURE.md)
> 实现手册：[../../docs/PACKAGE-SPEC.md](../../docs/PACKAGE-SPEC.md)

---

## 1. 先 vendor 旧代码

```bash
cd 插件
node tools/vendor.mjs --pkg surfcore-memory --roots plugins/surfcore/lib/memory.js,plugins/surfcore/lib/memory-card.js,plugins/surfcore/lib/align.js,plugins/surfcore/lib/privacy.js,plugins/surfcore/lib/store.js,plugins/surfcore/lib/paths.js,plugins/surfcore/lib/http-guard.js
```

vendor 保持仓库相对结构，包内引用写成：

```js
import { X } from './vendor/plugins/surfcore/lib/xxx.js';
```

---

## 2. 宿主半边取材（旧 `plugins/surfcore/lib/index.js`）

| 旧位置 | 要搬什么 |
| --- | --- |
| `plugins/surfcore/lib/index.js:1075-1123` | `handleMemory`（摘要/预览/同步/审计）。 |
| `index.js:1124-1171` | `handleMemoryCard` + `handleMemoryCardFull`。 |
| `index.js:1172-1206` | `handleAlign`（链接/候选/批准/否定/导入导出/称呼）。 |
| `index.js:224-229` | 启动时重建对齐简报（`writeAlignmentBriefs`，桥接与 B站 调度器都读）。 |
| `index.js:412-414` | 记忆卡维护定时器（首 8s、之后 10 分钟；`startMemoryCardTimer`）。 |
| `index.js:569-581` | `startSyncTimer`（QQ→B站 同步，`memory.qqToBili.intervalMs`）。 |
| `index.js:2720-2745` | `handleOwnerAudit`（只读 `state/owner-audit.jsonl`）。 |
| `index.js:2858-2864` | `/privacy/explain` 分派。 |
| `plugins/surfcore/lib/{memory,memory-card,align,privacy}.js` | 整份复用，不改。 |

---

## 3. 浏览器半边取材（旧 `plugins/surfcore/lib/client.js`）

公共 UI 套件已在 `lib/client.js` 里内联（Row/Field/Section/Btn/api/ProgressBar/Browse/WindowsEditor/flatten/ErrorModal…）。

| 旧位置 | 要搬什么 |
| --- | --- |
| `client.js:445-485` | `AuditModal`（主人审计）。 |
| `client.js:763-782` | `AliasCell`（对齐表里给每个人设称呼）。 |
| `client.js:3043-3278` | `MemoryCardPanel`（摘要/容量条/压缩/备份/回滚）。 |
| `client.js:3279-3346` | `FullMemoryCardPanel`（全量卡）。 |
| `client.js:3957-4068` | `MemoryTab`（改造：两个同步开关 + 记忆卡入口）。 |
| `client.js:4069-4201` | `AlignTab`。 |
| `client.js:5122-5384` | 栏目外壳；内页：记忆卡 / 双向记忆 / 对齐。 |

---

## 4. 要提供的路由（前缀见 lib/index.js 的 API_PREFIX）

- `GET/POST /memory — 状态 / 预览 / 立即同步 / 审计尾部`
- `GET/POST /memory-card — 快照 / 维护 / 压缩 / 回滚 / 导入导出`
- `GET /memory-card/full — 全量卡分页查看`
- `GET/POST /align — 链接表 / 候选扫描 / 批准 / 否定 / 称呼 / 导入导出`
- `POST /privacy/explain — 隐私闸门解释`
- `GET /owner-audit — 主人特权审计`
- `GET /status，GET /dsh-surfcore-memory/health`

---

## 5. 数据所有权

- `~/.dsh/surfcore/memory/**`（**唯一维护者**：记忆卡 JSON/MD、两份注入块、全量卡 JSONL、inbox 的整理方）
- `~/.dsh/surfcore/{alignments.json,align-candidates.json}`、`state/alignment-brief.md`
- `~/.dsh/surfcore/config.json` 的 `memory` / `alignment` / `memoryCard` 键（走 config-lock）
- 只读：`<surfcore>/state/qq-activity.log`、`~/.dsh/surfcore/characters/current-role.json`

### 跨包契约

- 对外只通过文件交付：`memory/memory-card-prompt-qq.md` / `-bili.md`（桥接与 bili 调度器读）、`memory-inbox.jsonl`（桥接/bili/pet append，本包整理）。
- 角色：读 `characters/current-role.json` 决定 `memory/<角色id>/` 路径。
- inbox 允许多写者 append：每行一个 JSON，单行 < PIPE_BUF 时追加安全；本包只做「读取→合并→重写主卡→清空已消费部分」。

---

## 6. 测试要求（补进 `scripts/test-smoke.mjs`）

- [ ] `/memory-card` GET 返回容量/清晰度统计；POST 压缩后文件变化
- [ ] 记忆卡维护：在临时 memory 目录放入 inbox 行，跑一次维护后主卡包含该条
- [ ] `/align` POST 添加链接后 `alignments.json` 变化；GET 列表包含
- [ ] `/privacy/explain` POST 返回命中规则
- [ ] 定时器注册后 `ctx.disposeAll()` 不抛错
- [ ] client 注册 1 个栏目

---

## 7. 本包特别注意

- `memory-card.js` 的 `?rev=` 缓存破坏后缀在 vendor 后没有意义：包内 import 不要带查询串。
- 旧插件里 `memoryCardTimer` 首次 8s/之后 10min；迁移后**只有本包**维护记忆卡，避免双维护。
- `includeOwner` / 隐私过滤规则在 `privacy.js`，必须原样保留。

---

## 8. 完成标准

- [ ] `node ./scripts/test-smoke.mjs` 通过
- [ ] `node ../tools/vendor.mjs --pkg . --roots plugins/surfcore/lib/memory.js,plugins/surfcore/lib/memory-card.js,plugins/surfcore/lib/align.js,plugins/surfcore/lib/privacy.js,plugins/surfcore/lib/store.js,plugins/surfcore/lib/paths.js,plugins/surfcore/lib/http-guard.js --check` 通过（含 --copy-dir 时一起带上）
- [ ] `node ../tools/verify-all.mjs surfcore-memory` 通过
- [ ] 只改了 `surfcore-memory/` 目录；旧仓库 `surfcore/` 一行未动
- [ ] `README.md` 的负责/不负责与实际一致
