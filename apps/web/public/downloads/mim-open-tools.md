# Mim 自研工具与内部共享包清单

> 本清单内容全部取自 Mim 仓库 `tools/README.md`、`tools/` 目录实际代码与 `packages/` 目录结构，
> 不包含未在仓库内落地的规划项。三款自研工具均为纯 Node 内置模块实现，零新增 npm 依赖，测试离线运行。

## 一、自研工具（`tools/`，独立成包、互不依赖，不参与主仓库构建）

### 1. Quick Build WP — `quick-build-wp`

- 仓库目录：`tools/quick-build-wp/`（`cli.mjs`、`lib/plan.mjs`、`lib/render.mjs`、`lib/verify.mjs`、`test/cli.test.mjs`）
- 用途：生成宝塔式 WordPress 一键建站脚本，覆盖 Nginx / MySQL / PHP / 建库建站 / 伪静态 / 可选 SSL。
- 命令能力：
  - `--plan`：打印将要执行的步骤清单（JSON，不落盘）；
  - `--emit <out.sh>`：渲染可在 Linux 上执行的幂等安装脚本（脚本自身支持 `--dry-run`）；
  - `--verify <file.sh>`：静态自检——必需命令齐全、无高危命令、变量带默认值、写操作走 dry-run 封装。
- 处理要点：Nginx / MySQL / PHP 已安装则跳过；库与账号 `CREATE IF NOT EXISTS`；站点目录已有 `wp-load.php` 则跳过下载；dry-run 下所有写操作只打印不落盘。

### 2. 数据库批量换域名 — `db-replace-domain`

- 仓库目录：`tools/db-replace-domain/`（`cli.mjs`、`lib/replace.mjs`、`lib/sqlite.mjs`、`test/cli.test.mjs`）
- 用途：数据库批量替换域名，支持 SQL 文本导出与 SQLite 库两种输入。
- 命令能力：
  - `--dry-run`：只统计预览，不改文件 / 不写库；
  - `--apply`：真实执行，apply 前自动写 `<input>.bak` 备份（已存在则不覆盖），可用 `--no-backup` 跳过；
  - SQLite 模式按扩展名 + 文件头识别（`.sqlite` / `.db` / `.sqlite3`）。
- 处理要点：PHP 序列化字符串 `s:<len>:"...";` 按 UTF-8 字节重算长度，避免反序列化截断；覆盖 `https://`、`http://`、协议相对 `//`、`www.` / 非 `www.`、裸域名变体；SQLite 遍历所有用户表 TEXT 列，参数化 `UPDATE` 写回；`WITHOUT ROWID` 表无 rowid，跳过并计入 `skippedTables`；二次 `--apply` 无新增改动，幂等。

### 3. 流盾 WAF — `liudun-waf`

- 仓库目录：`tools/liudun-waf/`（`cli.mjs`、`rules.json`、`lib/nginx.mjs`、`lib/waf.mjs`、`test/waf.test.mjs`）
- 用途：Node 反向代理 WAF 网关，可导出等价 nginx 配置。
- 命令能力：
  - `--listen <port> --upstream <url>`：启动代理网关；
  - `--rules <file>`：规则 JSON（随包 `rules.json`）；
  - `--log <file>`：拦截日志 JSONL 路径；
  - `--dry-run`：只记录不拦截，请求照常透传；
  - `--emit-nginx <out.conf>`：导出 nginx 配置（`limit_req` / 黑白名单 geo / 签名 map / `proxy_pass`）后退出，不起网关。
- 规则能力：CC 限流（IP + 路径滑动窗口，超限 429）；签名规则（SQLi / XSS / 路径穿越 / 敏感文件探测，命中 403）；IP 黑白名单（白名单优先放行，黑名单直接拦截）；每条拦截记录一行 JSON（`ts / ip / method / path / action / reason / ruleId / type / dryRun`）。

### 与平台对接边界

平台侧路由见 `services/mim-api/src/routes/tools.ts`，数据表为 `schema.d/21-tools.sql` 的 `mim_tools`，三条种子记录 slug 与上述目录一一对应。平台只做元数据分发与链接展示，不在服务端执行这些脚本、不起 WAF 进程；建站脚本由用户在自有 Linux 主机执行，WAF 网关由站点侧 / 网关侧自行部署，换域名工具由管理员在数据库所在环境运行。

## 二、内部共享包（`packages/`，随主仓库构建）

| 包名 | 目录 | 说明 |
| --- | --- | --- |
| `@mim/core-domain` | `packages/core-domain/` | 共享领域层：错误码、状态机、UUIDv7，以及统一入口配置清单 `siteModules.json`、部署注册表 `deploymentRegistry.json`、自定义域名清单 `customDomains.json` 等领域数据。 |
| `@mim/i18n` | `packages/i18n/` | 前端 / 后端共用的国际化文案包。 |

## 三、仓库内工程化校验脚本（`scripts/`，供 CI 与本地门禁使用）

以下脚本随仓库提供，均为 Node 内置模块实现，用于本地门禁与部署取证：

- `version-check.mjs`：semver 与发布通道、git tag 一致性校验；
- `env-check.mjs`：环境变量清单与 `.env.example` 接线核对；
- `comment-check.mjs`：逐行注释覆盖率扫描（`--strict` 阈值 80%）；
- `verify-auth-gate.mjs`：匿名可读 / 写操作 401 / 付费预览门禁双层校验；
- `verify-deployments.mjs`：多平台部署矩阵工件与注册表核对；
- `verify-site-modules.mjs`、`verify-entry-manifest.mjs`、`verify-site-directory`：站点模块、入口清单与目录结构核对；
- `verify-custom-domains.mjs`：自定义域名清单核对；
- `verify-indexes.mjs`：数据库索引核对；
- `deployment-summary.mjs`：由部署注册表重生成部署汇总；
- `csp-inline-hash.mjs`：构建期重算内联脚本 SHA-256 并生成 CSP 配置；
- `build.mjs`、`serve-local.mjs`、`spa-404.mjs`、`perf-bench.mjs`：构建、本地静态服务、SPA 深链接回退与性能基线工具。

## 四、运行环境约束

- 自研工具纯 Node 内置模块，不新增 npm 依赖；测试不联网、不下载真实 WordPress；
- 本机无 Docker / MySQL / PHP：建站工具交付物是可执行脚本生成器 + 静态自检，脚本的真实安装动作在目标 Linux 主机上发生；
- SQLite 模式依赖 Node 22 内置 `node:sqlite`（实验性 API）。
