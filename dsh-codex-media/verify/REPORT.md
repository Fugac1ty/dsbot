# dsh-codex-media — 隔离 DSH profile 集成验证报告

**结论：PASS**（2026-11-03，最终版生图插件 `dsh-codex-media`）
真实 DSH（0.2.1-rc.5）在隔离 `DSH_HOME` 中加载了本插件 bundle，boot 日志出现激活标记，
verify-only 探针从**真实 tool registry** 中读到了 `codex_imagegen` 与 `codex_vision` 两个工具；
SIGTERM 干净退出、端口释放、无进程残留；负向对照（坏 import）给出清晰诊断。

- 复跑脚本：[`verify/run-verify.sh`](run-verify.sh)
- 运行摘要（PASS/FAIL 全量）：[`verify/logs/summary.txt`](logs/summary.txt)

---

## 1. 环境与隔离边界

| 项 | 值 |
|---|---|
| 插件目录 | `/home/ubuntu/dsh-agentchat/插件/dsh-codex-media` |
| package / bundle / entry id | `dsh-codex-media`（`cordis.patch.yml` 中 id 与 name 均为 `dsh-codex-media`） |
| 真实 `dsh` | `/home/ubuntu/dsh-agentchat/dsh-0.2-trial/node_modules/@deepseek-ai/dsh/lib/bin.js`（0.2.1-rc.5） |
| Node | v24.19.0 |
| 隔离 `DSH_HOME` | `dsh-codex-media/verify/.dsh-home`（workspace 内，首次由 `--reset` 全新生成） |
| boot 端口 | `127.0.0.1:3199` |
| 生产 `DSH_HOME` | `/home/ubuntu/dsh-agentchat/dsh-0.2-home` —— **全程未读写**（脚本内含 guard 明确拒绝该路径） |
| 生产端口 | `3102` —— **全程未触碰**（验证期间生产 `dsh web` PID 990 一直在跑） |
| 写作用域 | 仅 `dsh-codex-media/verify/**`；插件本体 `lib/**`、`package.json`、`cordis.patch.yml` 未改动 |

## 2. 验证矩阵（全部 PASS）

| # | 检查 | 命令 / 证据 | 结果 |
|---|---|---|---|
| 1 | 隔离 home + baseline profile 可 compose | `DSH_HOME=verify/.dsh-home node <bin.js> --profile web --dump-config` → exit 0，自动生成 `profiles/web`（日志 `logs/00-baseline-dump.log`） | PASS |
| 2 | profile 注入 bundle + 软链 | `dsh.profile.bundles` 尾部为 `dsh-codex-media`；`profiles/web/node_modules/dsh-codex-media -> 插件目录` | PASS |
| 3 | `--dump-config` 组合结果含 bundle | `logs/01-dump-config.log` 第 1232–1234 行：`# == dsh-codex-media` / `- id: dsh-codex-media` / `name: dsh-codex-media`；且无旧 `dsh-codex-vision` 残留 | PASS |
| 4 | 真实启动 + 激活标记 | `env DSH_CODEX_MEDIA_BOOT_MARKER=1 DSH_HOME=… node <bin.js> --profile web --host 127.0.0.1 --port 3199 --no-open` → `logs/02-positive-boot.log` 出现标记行 | PASS |
| 5 | 硬验证：真实 tool registry 注册 | verify-only 探针 entry（只写隔离 home 的 profile patch）：`ctx.tools.get('codex_imagegen')` / `get('codex_vision')` 均非空，`ctx.tools.schemas()` 含两个名字 | PASS |
| 6 | web 就绪 | 日志出现 `dsh web: http://127.0.0.1:3199/?token=…`（token 已脱敏） | PASS |
| 7 | 无激活失败诊断 | boot 日志无 `did not activate` / `failed to import` | PASS |
| 8 | SIGTERM 干净退出 | SIGTERM 后进程退出（wait rc=0，约 4s），`pgrep` 无残留，端口 `3199` 释放 | PASS |
| 9 | 负向对照（坏 import） | `verify/.broken-plugin` 副本 → `dsh: warning: 1 entry did not activate` + `dsh-codex-media (dsh-codex-media): failed to import: Error [ERR_MODULE_NOT_FOUND] …`（`logs/03-negative-boot.log`） | PASS |

## 3. 关键原始日志

### 3.1 `--dump-config`（`logs/01-dump-config.log`，节选）

```
# == dsh-codex-media
- id: dsh-codex-media
  name: dsh-codex-media
```

### 3.2 真实 boot（`logs/02-positive-boot.log` 全文，token 脱敏）

```
[dsh-codex-media] bundle loaded: registered tools codex_imagegen, codex_vision (command=codex, imageSandbox=workspace-write)
VERIFY-PROBE codex_imagegen=registered codex_vision=registered
VERIFY-PROBE schemas codex_imagegen=yes codex_vision=yes total=3 names=codex_vision,codex_imagegen,working_directory
VERIFY-PROBE codex_imagegen_description="Generate or edit a raster image with Codex's built-in image_gen (GPT Image) and save the result as a PNG inside the work"
VERIFY-PROBE codex_vision_description="Look at one or more images with Codex (OpenAI's vision-capable coding agent) and return its textual answer. Use it when "
dsh web: http://127.0.0.1:3199/?token=<redacted>
```

探针说明（不修改插件）：`run-verify.sh` 在**隔离 home** 的 `profiles/web/cordis.patch.yml` 追加一个
`verify-probe` entry（`name: ./verify-probe.mjs`），它的 `inject = ['tools']`，在 apply 后查询真实
`ctx.tools` 注册表并发 `console.log`。这次 boot 结束即删除探针 entry 与文件，插件目录零改动。
`total=3` 是真实全局工具数（另有 base 的 `working_directory`），两个目标工具都在。

### 3.3 负向对照（`logs/03-negative-boot.log`，节选）

```
dsh: warning: 1 entry did not activate
dsh-codex-media (dsh-codex-media): failed to import: Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'/home/ubuntu/dsh-agentchat/插件/dsh-codex-media/verify/.broken-plugin/lib/does-not-exist.mjs' …
dsh web: http://127.0.0.1:3199/?token=<redacted>
```

即：坏 import 时 web 仍起、诊断明确指出 entry 与插件名、失败原因（模块找不到）——生产排障可读。

### 3.4 干净退出

```
PASS  [positive] process exited cleanly (wait rc=0, 4s); no residue
PASS  [positive] port 3199 released
```

（`ss -ltn` 3199 free；`ps` 中无 `--port 3199` 的 dsh 进程；3102 上的生产进程未受影响。）

## 4. 额外发现：插件里的 `ctx.logger.*` 不会出现在 boot 输出

`ctx.logger.info(...)` / `ctx.logger.warn(...)` 在默认 `dsh --profile web` 启动时**不可见**——DSH host
没有注册 console logger exporter（cordis 默认 exporter 只写内存 buffer），所以日志里只有
`console.log` / `process.stderr.write` 的输出来自插件。复现实验（`logs/04-logger-channel-probe.log`）：

```
LOGGER-PROBE console dsh-codex-media codex_imagegen codex_vision
LOGGER-PROBE stderr dsh-codex-media codex_imagegen codex_vision
dsh web: http://127.0.0.1:3199/?token=<redacted>
```

探针同时调用了 `logger.info` / `logger.warn` / `console.log` / `stderr.write`，只有后两者出现。
因此激活标记必须走 `console.log`（当前实现已按此修复：`DSH_CODEX_MEDIA_BOOT_MARKER=1` 时输出）。

## 5. 复跑方法

```bash
cd /home/ubuntu/dsh-agentchat/插件/dsh-codex-media
./verify/run-verify.sh --reset --with-negative   # 全新 home + dump-config + 真实 boot + 注册探针 + 负向对照
./verify/run-verify.sh                            # 复用已有 verify/.dsh-home（更快）
./verify/run-verify.sh --dump-only                # 只验证组合配置，不启动
./verify/run-verify.sh --no-probe                 # 不插注册探针，只看 marker
```

退出码 0 = 全部通过；`1` = 有失败项。每次运行会覆盖 `verify/logs/*.log` 与 `summary.txt`。

可选环境覆盖（目录/包名再次变更时无需改脚本）：

```bash
BUNDLE_NAME=dsh-codex-media BUNDLE_ID=dsh-codex-media \
TOOL_NAMES="codex_imagegen codex_vision" MARKER_ENV=DSH_CODEX_MEDIA_BOOT_MARKER \
BOOT_PORT=3199 ./verify/run-verify.sh
```

注意 `--reset` 只删除 `verify/.dsh-home`（脚本内有路径前缀 guard）；脚本启动即检查 `DSH_HOME` 不等于/不属于
生产 home，且 3199 被占用时直接退出而不干预。

## 6. 产物与边界说明

| 路径 | 内容 |
|---|---|
| `verify/run-verify.sh` | 可复跑验证脚本（唯一交付脚本） |
| `verify/logs/00-baseline-dump.log` | 首次 baseline `--dump-config` 全量输出 |
| `verify/logs/01-dump-config.log` | 注入 bundle 后的全量组合配置（含 codex-media 行） |
| `verify/logs/02-positive-boot.log` | 真实 boot：激活标记 + 探针 registry 结果 + web URL |
| `verify/logs/03-negative-boot.log` | 负向对照：坏 import 的 boot 诊断 |
| `verify/logs/04-logger-channel-probe.log` | `ctx.logger` 不可见复现证据 |
| `verify/logs/summary.txt` | 本次运行的 PASS/FAIL 全量摘要 |
| `verify/.dsh-home/` | 隔离 DSH_HOME（临时，可随时 `--reset` 重建） |
| `verify/.broken-plugin/` | 负向对照用的坏插件副本（每次运行重建） |

- `verify/logs/*.log` 中 `dsh web:` 行的 `?token=` 是**仅限隔离 home、已被 SIGTERM 关闭**的
  一次性本地 token；本报告已脱敏。
- 未覆盖项：`codex_imagegen` / `codex_vision` 的**实际执行**需要真实 Codex 登录/`image_gen` 能力，
  不在本次 bundle 加载验证范围内（逻辑由 `node --test` 单测覆盖，Lead 报告 118 pass / 0 fail）。
- 本次验证没有调用生产 DSH、没有修改插件目录内 `verify/**` 以外的任何文件。
