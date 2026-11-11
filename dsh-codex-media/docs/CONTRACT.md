# dsh-codex-media — 模块契约（Contract）

> 这是三个并发工作流之间的**接口契约**。实现必须严格遵守；`lib/index.js`（Lead 负责）会按此契约调用
> `lib/image-source.mjs` 与 `lib/codex-exec.mjs`。契约变更必须先改本文件并通知 Lead。

## 0. 运行环境

- Node.js `v24.19.0`（ESM，`"type": "module"`）。
- **零外部依赖**：只能 import `node:*` 内置模块。`@deepseek-ai/*` 只允许在 `lib/index.js` 中使用。
- 测试用内置 `node:test` + `node:assert/strict`，命令：`cd dsh-codex-media && node --test test/`。
- 所有路径都按 `path` 模块处理；不要硬编码本机绝对路径。
- 代码风格：JSDoc 注释、`const` 优先、无 TypeScript。对外函数必须 `export`。
- 所有 async 函数必须尊重传入的 `AbortSignal`（若提供）。

## 1. `lib/image-source.mjs`（owner: image-resolver）

把「模型给的一张图」统一解析成一个**本地文件路径**，供 codex `-i/--image` 使用；负责下载 / base64 落盘 /
本地文件校验 / 体积上限 / 格式嗅探 / 内网 SSRF 防护 / 临时文件清理。

### 导出

```js
export class ImageSourceError extends Error {
  /**
   * @param {string} code   见下表
   * @param {string} message 面向模型的可读错误（含具体 source 与修复建议）
   * @param {{ source?: string, cause?: unknown }} [options]
   */
  constructor(code, message, options)
  // 实例属性：name='ImageSourceError', code, source
}

/** @param {Uint8Array} bytes @returns {'image/png'|'image/jpeg'|'image/webp'|'image/gif'|undefined} */
export function sniffImageMediaType(bytes)

/**
 * @param {string[]} sources 用户/模型传入的 source 列表（本地路径 / http(s) URL / data:image/...;base64,）
 * @param {object} options
 * @param {string} options.cwd                      本地相对路径的基准目录（绝对路径）
 * @param {number} options.maxImages                最多接受多少张（超出即报错）
 * @param {number} options.maxBytes                 单张图字节上限
 * @param {boolean} options.allowUrls               是否允许 http(s)
 * @param {boolean} options.allowDataUrls           是否允许 data: URL
 * @param {boolean} options.allowPrivateUrls        是否允许内网/本机地址（默认 false，SSRF 防护）
 * @param {AbortSignal} [options.signal]
 * @param {string} [options.tempDir]                临时根目录，默认 os.tmpdir()
 * @param {number} [options.timeoutMs=20000]        单个 URL 下载超时
 * @param {number} [options.maxRedirects=3]
 * @param {typeof fetch} [options.fetchImpl]        测试注入
 * @param {(hostname: string) => Promise<Array<{address: string, family: number}>>} [options.lookupImpl]
 *                                                  测试注入；默认 node:dns/promises lookup({all:true})
 * @returns {Promise<{
 *   images: Array<{ source: string, kind: 'file'|'url'|'data', path: string, mediaType: string, bytes: number, temporary: boolean }>,
 *   cleanup: () => Promise<void>,
 * }>}
 */
export async function resolveImageSources(sources, options)
```

### 行为要求

1. **参数校验**
   - `sources` 必须是数组；空数组、非字符串元素、trim 后为空 → `INVALID_ARGUMENT`。
   - `sources.length > maxImages` → `TOO_MANY_IMAGES`，消息里带上限。
2. **分类**（按顺序）
   - `/^https?:\/\//i` → URL
   - `/^data:/i` → data URL
   - `/^file:\/\//i` → 转成本地路径（`fileURLToPath`）
   - 其它 → 本地路径（相对路径用 `path.resolve(options.cwd, source)`）
3. **本地文件**
   - 不存在 → `NOT_FOUND`；不是普通文件（目录/设备）→ `NOT_A_FILE`；大小 0 → `EMPTY_IMAGE`；
     `stat.size > maxBytes` → `TOO_LARGE`（消息给出实际大小与上限）。
   - 只读文件头（≤16 字节）+ `sniffImageMediaType`；不是 PNG/JPEG/WebP/GIF → `UNSUPPORTED_IMAGE`。
   - **不复制**本地文件；返回绝对路径、`temporary: false`。
4. **data URL**
   - 仅支持 `data:image/<png|jpeg|webp|gif>;base64,<payload>`（大小写不敏感）；其余 → `UNSUPPORTED_IMAGE`。
   - base64 解码失败 → `INVALID_ARGUMENT`；解码后 0 字节 → `EMPTY_IMAGE`；超上限 → `TOO_LARGE`。
   - 写入本次调用专用临时目录，文件名用内容 hash 或序号 + 正确扩展名；`kind:'data'`, `temporary:true`。
5. **URL**
   - 非法 URL / 非 http(s) / 带用户名密码 → `UNSUPPORTED_SCHEME`。
   - `allowUrls === false` → `URL_FORBIDDEN`。
   - `allowPrivateUrls === false` 时做 SSRF 防护：对主机名做 DNS（全部 A/AAAA）解析；解析失败 → `FETCH_FAILED`；
     任一地址属于 **loopback / RFC1918 / link-local / 唯一本地 IPv6 / multicast / unspecified / 0.0.0.0**
     或主机名是 `localhost` / 以 `.local`、`.internal` 结尾 → `URL_FORBIDDEN`（消息说明被拦截的地址）。
     主机名本身是 IP 字面量时直接判定。
   - 重定向手动处理（`redirect:'manual'`）：每跳都重新做上述校验；超过 `maxRedirects` → `FETCH_FAILED`。
   - 非 2xx → `FETCH_FAILED`（消息带状态码）。
   - 下载时同时叠加调用方 `signal` 与 `AbortSignal.timeout(timeoutMs)`；超时/中止 → `FETCH_FAILED` 或
     `ABORTED`（若调用方 signal 已中止，用 `ABORTED`，消息含原因）。
   - `content-length` 超上限或流式累计超上限 → `TOO_LARGE`（禁止把超限内容全读进内存）。
   - 下载字节做 `sniffImageMediaType`；不是图片 → `UNSUPPORTED_IMAGE`。
   - 写入临时目录；`kind:'url'`, `temporary:true`。
6. **临时文件/清理**
   - 只在真正需要落盘（url/data）时才 `mkdtemp`；整个 `resolveImageSources` 共用一个临时目录。
   - 返回的 `cleanup()` 幂等：递归删除该临时目录；从未创建临时目录时是 no-op。
   - **函数内部抛错时自己清理已创建的临时目录** 再抛出。
7. **错误消息**：中文或英文都可，但必须**面向模型**、可操作（包含 source、限制值、建议）。错误码集合：
   `INVALID_ARGUMENT` `TOO_MANY_IMAGES` `NOT_FOUND` `NOT_A_FILE` `EMPTY_IMAGE` `TOO_LARGE`
   `UNSUPPORTED_IMAGE` `UNSUPPORTED_SCHEME` `URL_FORBIDDEN` `FETCH_FAILED` `ABORTED`。

### 测试要求（`test/image-source.test.mjs`）

至少覆盖：相对/绝对本地路径、缺文件、目录、空文件、超限、非图片、PNG/JPEG/GIF/WEBP 嗅探、
data URL 成功+超限+非法、URL 拒绝 `http://127.0.0.1` / `http://localhost` / `http://10.0.0.5` /
`http://[::1]`（用注入的 `lookupImpl`，不要依赖真实的 DNS/网络）、URL 下载成功（注入 `fetchImpl`
返回图片字节，含 302 重定向链与内网跳转被拒）、下载超时/中止、`cleanup()` 删除临时目录、幂等。
测试自身创建/清理 `os.tmpdir()` 下的临时目录，不得写插件目录以外的固定路径。

## 2. `lib/codex-exec.mjs`（owner: codex-runner）

调用 `codex exec` 把图片交给 Codex（OpenAI 视觉模型），拿到**最终回答文本**。

### 导出

```js
export class CodexVisionError extends Error {
  /**
   * @param {string} code  见下表
   * @param {string} message
   * @param {{ stderr?: string, exitCode?: number, command?: string, cause?: unknown }} [options]
   */
  constructor(code, message, options)
  // 实例属性：name='CodexVisionError', code, stderr, exitCode, command
}

/**
 * @param {object} options
 * @param {string[]} options.imagePaths       已经解析好的本地绝对路径（可为空数组；生图时通常为空或仅参考图）
 * @param {string} options.prompt             给 Codex 的完整提示词（非空）
 * @param {string} [options.model]            `--model` 覆盖
 * @param {AbortSignal} [options.signal]
 * @param {string} [options.command='codex']  可执行文件（PATH 名或绝对路径）
 * @param {string[]} [options.prefixArgs=[]]  插在 `exec` 之前的参数（测试用 node 脚本时有用）
 * @param {string[]} [options.extraArgs=[]]   追加在 `-o`/`--model` 之后、prompt 之前的参数
 * @param {string} [options.codexHome]        非空时作为子进程 CODEX_HOME
 * @param {Record<string,string>} [options.env] 额外环境变量（覆盖进程环境）
 * @param {number} [options.timeoutMs=180000]
 * @param {string} [options.sandbox='read-only']
 * @param {string} [options.cwd]              非空时作为工作目录（不删除）；否则内部建临时目录
 * @param {number} [options.maxDiagnosticBytes=65536]
 * @param {boolean} [options.json=false]      为 true 时在 `exec` 之后加 `--json`，stdout 输出 JSONL 事件
 * @param {boolean} [options.captureStdout=false] 为 true 时完整保留 stdout（最多 maxStdoutBytes）并返回
 * @param {boolean} [options.checkLogin=false] 为 true 时先跑 `codex login status`，未登录快速失败（NOT_LOGGED_IN）
 * @param {number} [options.maxStdoutBytes=8388608] captureStdout 时的 stdout 上限
 * @param {typeof import('node:child_process').spawn} [options.spawnImpl] 测试注入（可选）
 * @returns {Promise<{ answer: string, exitCode: number, durationMs: number, command: string,
 *   stdout?: string, stdoutTruncated?: boolean }>}
 */
export async function runCodexVision(options)
```

### 行为要求

1. **子进程 argv**（顺序固定）：
   `[...prefixArgs, 'exec', ...(json ? ['--json'] : []), '--ephemeral', '--skip-git-repo-check', '--color', 'never',
     '--sandbox', sandbox, '-C', workdir, ...imagePaths.flatMap(p => ['-i', p]), '-o', lastMessagePath,
     ...(model ? ['--model', model] : []), ...extraArgs, '-']`
   - prompt **通过 stdin 写入**（最后一个位置参数是 `-`），避免提示词以 `-` 开头被当成参数。
   - `lastMessagePath` 位于本次临时工作目录内（`last-message.txt`）。
2. **环境**：`{ ...process.env, ...options.env, NO_COLOR:'1', ...(codexHome ? { CODEX_HOME: codexHome } : {}) }`。
3. **stdout/stderr**：默认只保留尾部 `maxDiagnosticBytes` 字节（防止内存膨胀），`stdout` 不返回，`stderr` 进错误对象。
   当 `captureStdout: true` 时，额外完整收集 stdout（上限 `maxStdoutBytes`；超限截断并令 `stdoutTruncated: true`），
   在成功结果里返回 `stdout`。默认策略不变（生图模块需要 `--json` 的完整事件流）。
4. **超时**：`timeoutMs` 到点 kill **整个进程组**（`detached: process.platform !== 'win32'`，
   先 `SIGTERM`，约 2s 后 `SIGKILL`），拒绝 `TIMEOUT`，消息含 timeoutMs 与 stderr 尾部。
5. **中止**：调用方 `signal` 中止 → kill 进程组 → 拒绝 `ABORTED`。
6. **spawn 失败**：`ENOENT` → `COMMAND_NOT_FOUND`（消息含 command 与 `codex login`/安装提示）；
   其它 → `SPAWN_FAILED`。**超时/中止时也要等在 kill 后关闭子进程再 reject/return**，不要泄漏子进程。
7. **退出非 0** → `EXIT_NONZERO`（`stderr`/`exitCode` 属性齐全）。若 stderr 命中
   `/not logged in|login|401|unauthorized|invalid.api.?key|authentication/i`，在 message 末尾追加
   认证提示：`Codex 未登录：请先在 DSH 宿主机执行 codex login（或 printenv OPENAI_API_KEY | codex login --with-api-key）后重试。`
8. **成功**：读 `last-message.txt`，`trim()`；去掉 ANSI 转义序列；空 → `NO_OUTPUT`。返回 `answer`。
9. **临时目录**：内部 `mkdtemp(path.join(os.tmpdir(), 'dsh-codex-media-'))`，`finally` 中递归删除；
   设置了 `options.cwd` 时不创建也不删除。绝不写入用户 cwd。
10. 错误码集合：`INVALID_CONFIG` `COMMAND_NOT_FOUND` `SPAWN_FAILED` `TIMEOUT` `ABORTED` `EXIT_NONZERO` `NO_OUTPUT`。

### 测试要求（`test/codex-exec.test.mjs` + `test/fixtures/fake-codex.mjs`）

`test/fixtures/fake-codex.mjs` 是一个 **可执行**（`chmod +x`，`#!/usr/bin/env node`）的假 codex，约定：

- 解析 argv，找到 `-o <file>`、所有 `-i <file>`、以及 `exec` 位置；从 stdin 读完整 prompt。
- 若设置 `FAKE_CODEX_ARGS_PATH`，把 `{ argv, stdin, cwd }` 以 JSON 写入该路径。
- `FAKE_CODEX_ANSWER`（默认 `fake description`）写入 `-o` 指定的文件；`FAKE_CODEX_STDOUT` 打到 stdout。
- `FAKE_CODEX_EXIT_CODE` 非 0 时：向 stderr 写 `FAKE_CODEX_STDERR`（默认 `fake failure`），以该码退出。
- `FAKE_CODEX_DELAY_MS` 存在时先 sleep 再输出（用于超时/中止测试；被 SIGTERM/SIGKILL 杀死时不写答案）。
- `FAKE_CODEX_STDOUT_EXTRA`：原样追加到 stdout 末尾（生图模块用它注入形如
  `{"type":"item.completed","item":{"type":"imageGeneration","savedPath":"/abs/x.png"}}` 的 JSONL 事件）。

`codex-exec.test.mjs` 覆盖：成功时 answer 正确、argv 含 `-i`/`-o`/`--ephemeral`、prompt 经 stdin 到达、
`model`/`extraArgs`/`codexHome`/`env` 传递、非 0 退出→`EXIT_NONZERO`（含 stderr）、认证错误消息提示、
超时→`TIMEOUT`（确认进程被杀）、中止→`ABORTED`、`codexHome` 生效、临时目录被清理；
以及空 `imagePaths`、`json:true` 时 argv 含 `--json`、`captureStdout:true` 返回完整 stdout、
超过 `maxStdoutBytes` 时 `stdoutTruncated:true`。
测试不得依赖真实 codex 或真实网络；用 `command: process.execPath, prefixArgs: [fakePath]` 或直接
`command: fakePath`。

## 3. Lead 侧的消费方式（仅供参考，不需要实现）

```js
const resolved = await resolveImageSources(sources, {
  cwd, maxImages: config.maxImages, maxBytes: config.maxImageBytes,
  allowUrls: config.allowUrls, allowDataUrls: config.allowDataUrls,
  allowPrivateUrls: config.allowPrivateUrls, signal: exec.signal,
})
try {
  const result = await runCodexVision({
    imagePaths: resolved.images.map(i => i.path), prompt, model, signal: exec.signal,
    command: config.command, prefixArgs: config.prefixArgs, extraArgs: config.extraArgs,
    codexHome: config.codexHome, timeoutMs: config.timeoutMs, sandbox: config.sandbox,
  })
} finally { await resolved.cleanup() }
```

## 4. 写作用域（避免并发冲突）

| owner | 只允许写 |
|---|---|
| image-resolver | `lib/image-source.mjs`, `test/image-source.test.mjs` |
| codex-runner | `lib/codex-exec.mjs`, `test/codex-exec.test.mjs`, `test/fixtures/fake-codex.mjs` |
| verify | `verify/**` |
| Lead | 其余全部（`package.json`, `cordis.patch.yml`, `lib/index.js`, `README.md`, `scripts/**`, `test/plugin.test.mjs`, `test/fixtures/tiny.png`, `docs/**`） |

共享但不修改：`test/fixtures/tiny.png`（1x1 PNG，Lead 提供）、`node_modules/@deepseek-ai/*` 软链（Lead 提供）。
