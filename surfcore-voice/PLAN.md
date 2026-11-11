# PLAN —— surfcore-voice

> 语音包安装/启动/停止/健康检查、TTS 路由（本地/云端/Piper）、角色音色、云端凭据、语音包更新。
>
> **不负责**：语音消息的发送（桥接/桌宠各自做）、QQ 其它参数。
>
> 架构契约：[../../docs/SPLIT-ARCHITECTURE.md](../../docs/SPLIT-ARCHITECTURE.md)
> 实现手册：[../../docs/PACKAGE-SPEC.md](../../docs/PACKAGE-SPEC.md)

---

## 1. 先 vendor 旧代码

```bash
cd 插件
node tools/vendor.mjs --pkg surfcore-voice --roots plugins/surfcore/lib/voice-health.js,plugins/surfcore/lib/bridge.js,plugins/surfcore/lib/store.js,plugins/surfcore/lib/paths.js,plugins/surfcore/lib/http-guard.js
```

vendor 保持仓库相对结构，包内引用写成：

```js
import { X } from './vendor/plugins/surfcore/lib/xxx.js';
```

---

## 2. 宿主半边取材（旧 `plugins/surfcore/lib/index.js`）

| 旧位置 | 要搬什么 |
| --- | --- |
| `plugins/surfcore/lib/index.js:1900-1982` | `handleVoice`：除了「网盘离线包入口」「打开参考音频目录」两个本地动作，其余都是**代理到桥接控制台** `/api/voice*`（`consoleBase()` + `consoleToken()`，来自 vendored `bridge.js`）。 |
| `plugins/surfcore/lib/voice-health.js` | `VOICE_PORTS` / `readPackCharacters` / `validateCharacter` 整份复用。 |
| `index.js:2903-2916` | 启动时语音链路自检（8765 voxd / 9880 GPT-SoVITS 端口探测），保留并写到包日志。 |

---

## 3. 浏览器半边取材（旧 `plugins/surfcore/lib/client.js`）

公共 UI 套件已在 `lib/client.js` 里内联（Row/Field/Section/Btn/api/ProgressBar/Browse/WindowsEditor/flatten/ErrorModal…）。

| 旧位置 | 要搬什么 |
| --- | --- |
| `client.js:3347-3389` | `CloudStats`（云端额度/用量）。 |
| `client.js:3390-3485` | `CloudForm`（云端凭据表单）。 |
| `client.js:3486-3956` | `VoiceTab`（语音包列表/安装/启动停止/试听/角色音色/TTS 路由/参考音频）。 |
| `client.js:5122-5384` | 栏目外壳；内页：语音 / 云端。 |

---

## 4. 要提供的路由（前缀见 lib/index.js 的 API_PREFIX）

- `GET/POST /voice/packs — 列表 / 安装 / 导入 / 启动 / 停止 / 卸载（代理桥接）`
- `GET/POST /voice/cloud — 云端凭据与额度`
- `GET/POST /voice/tts — 路由与角色音色参数（写 QQ 配置 `socialV2.voice`，走 config-lock）`
- `POST /voice/packs/netdisk、/voice/packs/sample-open — 本地动作（非 Windows 返回可读错误）`
- `GET /voice/health — 端口/链路自检`
- `GET /status，GET /dsh-surfcore-voice/health`

---

## 5. 数据所有权

- `<surfcore>/config.json` 的 `socialV2.voice*`、`voicePacks.*`（**唯一写者**，走 config-lock；桥接读取生效）
- `<surfcore>/state/voice-packs/`、`voice-tts/`（桥接管理，本包只读/展示）
- 只读：`~/.dsh/surfcore/bili.config.json`（角色音色可能引用）

### 跨包契约

- 语音服务本体在**桥接进程**里：本包通过 `bridge.js` 的 `callBridge`/`consoleBase`/`consoleToken` 走 HTTP，不在本包内起 TTS。
- 桥接没跑时所有代理接口返回 502 + 可读提示（旧行为，保留）。

---

## 6. 测试要求（补进 `scripts/test-smoke.mjs`）

- [ ] `/voice/health` GET 200 且 `portOpen` 在无服务时返回 false 而不是抛错
- [ ] `/voice/packs` GET 在桥接不可达时返回 502 + `{ok:false,error}`（不是 500 堆栈）
- [ ] POST `/voice/tts` 写 `socialV2.voice` 后 QQ 配置其它键不变
- [ ] `/voice/packs/netdisk` 在非 Windows 返回 `OPEN_URL_UNSUPPORTED`
- [ ] client 注册 1 个栏目

---

## 7. 本包特别注意

- 本包最薄：核心是「代理 + 参数 + 健康检查」。不要尝试把 TTS 引擎搬进来。
- `voice-health.js` 的端口常量（8765/8767/9880）与旧版一致；迁移后桥接仍用同一套端口。

---

## 8. 完成标准

- [ ] `node ./scripts/test-smoke.mjs` 通过
- [ ] `node ../tools/vendor.mjs --pkg . --roots plugins/surfcore/lib/voice-health.js,plugins/surfcore/lib/bridge.js,plugins/surfcore/lib/store.js,plugins/surfcore/lib/paths.js,plugins/surfcore/lib/http-guard.js --check` 通过（含 --copy-dir 时一起带上）
- [ ] `node ../tools/verify-all.mjs surfcore-voice` 通过
- [ ] 只改了 `surfcore-voice/` 目录；旧仓库 `surfcore/` 一行未动
- [ ] `README.md` 的负责/不负责与实际一致
