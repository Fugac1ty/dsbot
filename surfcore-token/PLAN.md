# PLAN —— surfcore-token

> 每日 token 额度与用量采集（QQ/B站/其他/总额四口径）、峰谷计价、80% 提醒/100% 闸门、启动回填、额度文件。
>
> **不负责**：哪个会话算 QQ / B站（由 session 事件元数据判断，本包内做）；其它插件的业务行为。
>
> 架构契约：[../../docs/SPLIT-ARCHITECTURE.md](../../docs/SPLIT-ARCHITECTURE.md)
> 实现手册：[../../docs/PACKAGE-SPEC.md](../../docs/PACKAGE-SPEC.md)

---

## 1. 先 vendor 旧代码

```bash
cd 插件
node tools/vendor.mjs --pkg surfcore-token --roots plugins/surfcore/lib/token-budget.js,plugins/surfcore/lib/token-usage-pure.js,plugins/surfcore/lib/paths.js,plugins/surfcore/lib/http-guard.js
```

vendor 保持仓库相对结构，包内引用写成：

```js
import { X } from './vendor/plugins/surfcore/lib/xxx.js';
```

---

## 2. 宿主半边取材（旧 `plugins/surfcore/lib/index.js`）

| 旧位置 | 要搬什么 |
| --- | --- |
| `plugins/surfcore/lib/index.js:189-195` | `createTokenBudgetService({ctx, dshHome, qqStateDir, getQqConfig, log})`。 |
| `index.js:211-221` | `ctx.on("session/event", ...)` 实时采集注册（失败只记日志，不让插件起不来）。 |
| `index.js:2791-2824` | `handleTokenBudget`（GET status / POST limits / add / reset）。 |
| `plugins/surfcore/lib/token-budget.js` | 整份复用（含 `dispose` 落盘、启动回填 `sessionController.list`）。 |

---

## 3. 浏览器半边取材（旧 `plugins/surfcore/lib/client.js`）

公共 UI 套件已在 `lib/client.js` 里内联（Row/Field/Section/Btn/api/ProgressBar/Browse/WindowsEditor/flatten/ErrorModal…）。

| 旧位置 | 要搬什么 |
| --- | --- |
| `client.js:4647-4792` | `CNY_CHIPS/TOKEN_CHIPS`、`parseBudgetInput`、`formatBudgetInput`、`fmtMoney/fmtTokenNum/fmtBudgetValue`、`budgetRatio`、`fmtPercent`、`LimitField`、`BudgetChips`、`BudgetMeter`、`BudgetScopeCard`。 |
| `client.js:4793-4916` | `TokenTab`。 |
| `client.js:5320-5372` | 额度 80% 提醒弹窗（在栏目外壳里）；改造为按本包 `/token-budget` 的 `alerts` 字段展示。 |
| `client.js:5122-5384` | 栏目外壳；内页：额度 / 用量明细。 |

---

## 4. 要提供的路由（前缀见 lib/index.js 的 API_PREFIX）

- `GET /token-budget — 今日四口径用量/比例/限额/今日首次 80% 提醒`
- `POST /token-budget — limits 保存 / add 追加 / reset 重置`
- `GET /token-usage — 明细（按 scope/模型/会话）`
- `GET /status，GET /dsh-surfcore-token/health`

---

## 5. 数据所有权

- `~/.dsh/surfcore/token-budget.json`、`token-usage-state.json`、`token-usage-daily.json`（**唯一写者**）
- 只读：`<surfcore>/state/{sessions.json,slang-session.json}`、`<surfcore>/config.json` 的定价配置
- 读入：`~/.dsh/surfcore/token-usage-pet.jsonl`（pet 包 append 的桌宠用量，计入「其他」）

### 跨包契约

- 对外交付「今日快照」`token-usage-daily.json`：bili 调度器读它做闸门（只读）。
- pet 包把桌宠对话用量 append 到 `token-usage-pet.jsonl`；本包汇总时并入「其他」，并按水位去重（文件内自带 `at`/`day`）。

---

## 6. 测试要求（补进 `scripts/test-smoke.mjs`）

- [ ] `/token-budget` GET 200 且包含 `scopes` 或 `limits`；`/token-usage` GET 200
- [ ] POST limits 后 `token-budget.json` 变化；POST add 后限额累加；POST reset 恢复默认
- [ ] `session/event` 监听注册成功；mock 一条事件后用量增加（用纯逻辑函数断言）
- [ ] `dispose` 后不再写文件、不抛错
- [ ] client 注册 1 个栏目

---

## 7. 本包特别注意

- 采集是**事件驱动**的：`ctx.on('session/event')` 的载荷形状见 `token-budget.js` 顶部注释与旧 `index.js:211-221`。
- 测试不要依赖真实 `state/sessions.json`；用 `makeTmpEnv()` 的临时目录造数据。
- 本包是示范包（Lead 第一个实现），其它包可参照它的 `lib/index.js` 结构。

---

## 8. 完成标准

- [ ] `node ./scripts/test-smoke.mjs` 通过
- [ ] `node ../tools/vendor.mjs --pkg . --roots plugins/surfcore/lib/token-budget.js,plugins/surfcore/lib/token-usage-pure.js,plugins/surfcore/lib/paths.js,plugins/surfcore/lib/http-guard.js --check` 通过（含 --copy-dir 时一起带上）
- [ ] `node ../tools/verify-all.mjs surfcore-token` 通过
- [ ] 只改了 `surfcore-token/` 目录；旧仓库 `surfcore/` 一行未动
- [ ] `README.md` 的负责/不负责与实际一致
