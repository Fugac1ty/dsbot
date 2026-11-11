# dsh-balance-peak

在 DeepSeek Harness 输入框上方右上角显示 **DeepSeek 账户余额** + **高峰/低谷时段** 徽章，支持在「设置 → 插件」里微调位置。

- 🟠 **忙时**：按官方 V4 峰谷计价（北京时间）实时显示当前高峰窗口。
- 🟢 **谷时**：显示下一高峰窗口，提醒何时便宜。
- 💰 **DeepSeek 余额**：服务端代理读取，`CNY xx.xx` 形式展示，**API key 永不出服务端**。

## 特性

- 悬浮胶囊定位在输入框卡片上方右上角，不遮挡输入内容。
- 位置、显示项、刷新间隔均可在「设置 → 插件 → 余额峰谷」里配置（方向按钮可微调）。
- 余额经 DSH 凭据通道复用 `DEEPSEEK_API_KEY`，无需在浏览器填写任何 key。
- 支持一键刷新余额（胶囊右侧 ↻ 按钮）。

## 截图

> 截图区：请替换为下面两张真实截图。

**输入框右上角胶囊：**

![screenshot](docs/screenshot-pills.png)

**设置 → 插件 → 余额峰谷：**

![screenshot](docs/screenshot-settings.png)

## 峰谷规则

高峰（贵）：`09:00–12:00` 与 `14:00–18:00`（北京时间 `Asia/Shanghai`）。
低谷（便宜）：其余时间。

## 安装

### 方式一：GitHub（推荐，DSH 插件标准方式）

```sh
dsh plugin --profile web add https://github.com/Kumar1337/dsh-balance-peak
```

或手动 clone：

```sh
git clone https://github.com/Kumar1337/dsh-balance-peak.git
```

### 方式二：npm（若已发布）

```sh
npm install -g dsh-balance-peak
```

### 方式三：手动 link 到 web profile

把本包加入 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles`，并确保它作为依赖可解析（`link:` 到本目录），然后重启 DSH Web。

## 配置

余额复用 DSH 已配置的 `DEEPSEEK_API_KEY`（`~/.dsh/.credentials.yaml` 或环境变量）；若未配置，徽章显示「读取失败」。

在 **设置 → 插件 → 余额峰谷** 卡片里可调整：

| 字段 | 说明 |
|---|---|
| `showPeak` / `showBalance` | 显示/隐藏忙时、余额胶囊 |
| `refreshSeconds` | 余额刷新间隔（秒，5–3600） |
| `offsetX` / `offsetY` | 胶囊相对输入卡片的位置微调（距卡片右缘 px / 距卡片上方 px，可负数） |

## 隐私

浏览器看不到任何 API key；`/api/balance` 只返回余额读数本身。

## License

[MIT](LICENSE)

---

© 2026 [Kumar1337](https://github.com/Kumar1337) · [报告问题](https://github.com/Kumar1337/dsh-balance-peak/issues)
