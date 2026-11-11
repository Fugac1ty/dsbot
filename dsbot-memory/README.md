# dsbot-memory

衰减记忆卡、双向脱敏记忆、身份对齐、隐私闸门与主人审计

> 由旧单体插件 `dsbot` 拆出的**独立插件**。旧插件在拆分期间保持不动；
> 本包只依赖包内文件（`lib/vendor/` 是旧代码的原样副本），不 import 旧仓库任何路径。

## 这个包负责什么

<!-- 用 3-8 条写清楚边界：负责什么、**不**负责什么（哪个包负责）。 -->

- 设置栏目：`DSBot · 记忆`（settings.section id = `dsbot-memory`，order 见 lib/client.js）
- HTTP 前缀：`/dsh-dsbot-memory/api`
- 数据：沿用原有配置文件与状态目录（见 `docs/SPLIT-ARCHITECTURE.md` 的文件所有权表）

## 目录

| 路径 | 说明 |
| --- | --- |
| `lib/index.js` | 宿主入口（`export function apply(ctx)`） |
| `lib/client.js` | 浏览器半边（DSH 设置栏目） |
| `lib/bootstrap.js` | 运行根探测（必须第一个 import） |
| `lib/config-lock.js` | 跨插件配置锁 / 原子写 / 备份 |
| `lib/vendor/` | 旧代码原样副本；**只由 tools/vendor.mjs 生成，不要手改** |
| `scripts/test-smoke.mjs` | 离线冒烟测试 |

## 重新 vendor

```bash
# 在本包目录
node ../../tools/vendor.mjs --pkg . --roots <逗号分隔的 dsbot 相对路径>
node ../../tools/vendor.mjs --pkg . --roots <...> --check   # 校验是否与旧仓库一致
```

## 测试

```bash
node scripts/test-smoke.mjs
```

## 迁移

见 `docs/MIGRATION.md`：本包完善并通过测试后，停用旧 `dsbot`，安装本包。
