# PLAN —— surfcore-character

> 角色包（创建/切换/存档/回档/删除）、人格卡解析与编辑、角色迁移与指针、自我认同（self-identity）。
>
> **不负责**：记忆卡内容、管理员身份。
>
> 架构契约：[../../docs/SPLIT-ARCHITECTURE.md](../../docs/SPLIT-ARCHITECTURE.md)
> 实现手册：[../../docs/PACKAGE-SPEC.md](../../docs/PACKAGE-SPEC.md)

---

## 1. 先 vendor 旧代码

```bash
cd 插件
node tools/vendor.mjs --pkg surfcore-character --roots plugins/surfcore/lib/characters.js,plugins/surfcore/lib/persona.js,plugins/surfcore/lib/privacy.js,plugins/surfcore/lib/store.js,plugins/surfcore/lib/paths.js,plugins/surfcore/lib/http-guard.js
```

vendor 保持仓库相对结构，包内引用写成：

```js
import { X } from './vendor/plugins/surfcore/lib/xxx.js';
```

---

## 2. 宿主半边取材（旧 `plugins/surfcore/lib/index.js`）

| 旧位置 | 要搬什么 |
| --- | --- |
| `plugins/surfcore/lib/index.js:419-453` | `ensureCharacterSystem` / `writeCharacterRolePointer`。 |
| `index.js:454-537` | `stopAllBridgeSessions` / `archiveBridgeRuntimeState` / `switchCharacterEverywhere`。**降级**：不再直接调桥接进程，改成写 `state/needs-bridge-restart.json`（契约见架构文档 §4.2），由 qq 包自愈 tick 重启。 |
| `index.js:538-568` | `characterMigration` + `runCharacterAutoSave`（角色自动存档：首 10s、之后 6h）。 |
| `index.js:940-1027` | `handleCharacters`（列表/详情/新建/切换/删除/快照/回档）。 |
| `index.js:1028-1074` | `handlePersona`（路径 + 内容编辑 + 历史备份）。 |
| `plugins/surfcore/lib/{characters,persona}.js` | 整份复用。 |

---

## 3. 浏览器半边取材（旧 `plugins/surfcore/lib/client.js`）

公共 UI 套件已在 `lib/client.js` 里内联（Row/Field/Section/Btn/api/ProgressBar/Browse/WindowsEditor/flatten/ErrorModal…）。

| 旧位置 | 要搬什么 |
| --- | --- |
| `client.js:2992-3042` | `PersonaEditor`（人格卡路径 + 内容编辑）。 |
| `client.js:4520-4649` | `CharactersTab`（当前角色/epoch/记忆占用/全部角色/加载/新建/删除/存档回档）。 |
| `client.js:5122-5384` | 栏目外壳；内页：角色 / 人格卡 / 存档。 |

---

## 4. 要提供的路由（前缀见 lib/index.js 的 API_PREFIX）

- `GET/POST /characters — 列表 / 详情 / 新建 / 切换 / 删除`
- `GET/POST /characters/snapshot — 手动存档 / 回档 / 删除快照`
- `GET/POST /persona — 路径与内容读写、历史备份`
- `GET /status，GET /dsh-surfcore-character/health`

---

## 5. 数据所有权

- `~/.dsh/surfcore/characters/**`（角色包、快照、`current-role.json`）
- `~/.dsh/surfcore/config.json` 的 `persona` 键（走 config-lock）
- `<surfcore>/roles/*.md`（旧布局，只读；迁移进角色包）

### 跨包契约

- 切换角色后写 `state/needs-bridge-restart.json`（qq 包消费）；bili/memory/pet 各自下一次 tick 读 `characters/current-role.json` 生效。
- 人格卡唯一真相是角色包里的 `persona.md`；`unified.persona.file` 只作为兼容路径。

---

## 6. 测试要求（补进 `scripts/test-smoke.mjs`）

- [ ] `/characters` GET 列表；POST 新建后目录出现
- [ ] 切换角色后 `current-role.json` 更新 + `needs-bridge-restart.json` 出现
- [ ] `/persona` GET 内容非空（临时角色包）；POST 保存后文件变化且写备份
- [ ] client 注册 1 个栏目

---

## 7. 本包特别注意

- 角色系统是其它包的路径基准：本包必须先于 memory/bili/pet 的读取稳定。
- 旧代码切换角色会重启桥接与调度器；拆分后只发「需要重启」标记，不要跨包直接操作。

---

## 8. 完成标准

- [ ] `node ./scripts/test-smoke.mjs` 通过
- [ ] `node ../tools/vendor.mjs --pkg . --roots plugins/surfcore/lib/characters.js,plugins/surfcore/lib/persona.js,plugins/surfcore/lib/privacy.js,plugins/surfcore/lib/store.js,plugins/surfcore/lib/paths.js,plugins/surfcore/lib/http-guard.js --check` 通过（含 --copy-dir 时一起带上）
- [ ] `node ../tools/verify-all.mjs surfcore-character` 通过
- [ ] 只改了 `surfcore-character/` 目录；旧仓库 `surfcore/` 一行未动
- [ ] `README.md` 的负责/不负责与实际一致
