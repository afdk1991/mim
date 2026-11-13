# Mim 自研工具集（`tools/`）

本目录是 Mim 平台三款「自研工具」的**最小可执行实现**：纯 Node 内置模块，**零新增 npm 依赖**，
测试离线运行、不联网下载任何资源。每款工具独立成包，互不依赖，也不参与主仓库构建。

| 目录 | slug（对齐 `mim_tools` 种子） | 用途 |
| --- | --- | --- |
| `quick-build-wp/` | `quick-build-wp` | 生成宝塔式 WordPress 一键建站脚本（Nginx / MySQL / PHP / 建库建站 / 伪静态 / 可选 SSL） |
| `db-replace-domain/` | `db-replace-domain` | 数据库批量换域名：SQL 文本导出 / SQLite 库，正确重算 PHP 序列化字符串长度，自动备份 |
| `liudun-waf/` | `liudun-waf` | Node 反向代理 WAF 网关：CC 限流、SQLi/XSS/穿越/敏感文件规则、黑白名单、JSONL 拦截日志，可导出等价 nginx 配置 |

## 运行测试

```bash
node tools/test-all.mjs          # 一次跑完三套测试，末尾打印 PASS/FAIL 汇总
node tools/quick-build-wp/test/cli.test.mjs   # 单套（node --test）
```

退出码：`0` 全部通过；`1` 存在失败套件。

---

## 1. Quick Build WP — `quick-build-wp/`

### 命令

```bash
# 输出将要执行的步骤清单（JSON）
node tools/quick-build-wp/cli.mjs --plan [--domain D] [--php-version V] [--wp-version V] [--ssl]

# 生成可在 Linux 上执行的安装脚本（幂等，脚本自身支持 --dry-run）
node tools/quick-build-wp/cli.mjs --emit <out.sh> [选项]

# 对脚本做静态自检：必需命令齐全 / 无高危命令 / 变量带默认值 / 写操作走 dry-run 封装
node tools/quick-build-wp/cli.mjs --verify <file.sh>

node tools/quick-build-wp/cli.mjs --help
```

### 参数

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `--plan` | 打印步骤清单 JSON（不落盘） | — |
| `--emit <file>` | 渲染 bash 安装脚本到指定文件 | — |
| `--verify <file>` | 静态自检并输出检查矩阵 JSON | — |
| `--domain <域名>` | 站点域名 | `example.com` |
| `--php-version <ver>` | PHP 版本 | `8.2` |
| `--wp-version <ver>` | WordPress 版本 | `latest` |
| `--ssl` | 生成脚本默认开启 HTTPS 证书申请 | 关 |

### 退出码

| 码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `2` | 参数缺失或非法 |
| `3` | `--verify` 自检未通过 |
| `4` | 文件读写失败 |
| `1` | 其它运行时错误（错误信息带文件与行号） |

### 生成脚本特性

- **幂等**：Nginx / MySQL / PHP 已安装则跳过；库与账号 `CREATE IF NOT EXISTS`；站点目录已有 `wp-load.php` 则跳过下载；
- **`--dry-run`**：脚本在 Linux 上 `sudo bash install.sh --dry-run` 时，所有写操作只打印不落盘；
- **自检覆盖**：必需能力（nginx / mysql / php / curl / wordpress / 伪静态）、高危命令（`rm -rf /`、`mkfs`、`dd`、fork 炸弹）、变量默认值、dry-run 路由。

---

## 2. 数据库批量替换 / 换域名 — `db-replace-domain/`

### 命令

```bash
# 预览（不改文件 / 不写库）
node tools/db-replace-domain/cli.mjs --input dump.sql --from old.com --to new.com --dry-run

# 真实执行（apply 前自动写 <input>.bak 备份，已存在则不覆盖）
node tools/db-replace-domain/cli.mjs --input dump.sql --from old.com --to new.com --apply [--no-backup]

# SQLite 库模式（.sqlite / .db / .sqlite3，按扩展名 + 文件头识别）
node tools/db-replace-domain/cli.mjs --input site.sqlite --from old.com --to new.com --apply

node tools/db-replace-domain/cli.mjs --help
```

### 参数

| 参数 | 说明 |
| --- | --- |
| `--input <file>` | `.sql` 文本导出或 SQLite 库 |
| `--from <域名>` | 旧域名（自动匹配 `http/https`、协议相对 `//`、`www/非 www` 变体） |
| `--to <域名>` | 新域名 |
| `--dry-run` | 只统计预览，不写 |
| `--apply` | 真实执行，自动备份 |
| `--no-backup` | apply 时跳过备份（不推荐） |

### 退出码

| 码 | 含义 |
| --- | --- |
| `0` | 成功（dry-run 有命中也算成功） |
| `2` | 参数缺失或非法 |
| `4` | 输入文件读写失败 |
| `5` | 无法识别的输入格式 |
| `1` | 其它运行时错误（错误信息带文件与行号） |

### 处理要点

- **PHP 序列化字符串长度重算**：`s:<len>:"...";` 在域名变长 / 变短时按 UTF-8 字节重算长度，避免反序列化截断；
- **变体覆盖**：`https://old.com`、`http://old.com`、`//old.com`、`www.old.com`、裸域名；
- **SQLite**：遍历所有用户表 TEXT 列，JS 层替换后参数化 `UPDATE` 写回；`WITHOUT ROWID` 表无 rowid，会被跳过并计入 `skippedTables`；
- **幂等**：二次 `--apply` 无新增改动，文件 / 库内容稳定。

---

## 3. 流盾 WAF — `liudun-waf/`

### 命令

```bash
# 启动代理网关
node tools/liudun-waf/cli.mjs --listen 8801 --upstream http://127.0.0.1:8800 \
  [--rules rules.json] [--log ./logs/liudun-waf.jsonl] [--dry-run]

# 生成等价 nginx 配置（limit_req / 黑白名单 geo / 签名 map / proxy_pass）
node tools/liudun-waf/cli.mjs --emit-nginx <out.conf> --upstream http://127.0.0.1:8800

node tools/liudun-waf/cli.mjs --help
```

### 参数

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `--listen <port>` | 网关监听端口 | `8801` |
| `--upstream <url>` | 上游地址 | `http://127.0.0.1:8800` |
| `--rules <file>` | 规则 JSON | 随包 `rules.json` |
| `--log <file>` | 拦截日志 JSONL 路径 | `./logs/liudun-waf.jsonl` |
| `--dry-run` | 只记录不拦截，请求照常透传 | 关 |
| `--emit-nginx <file>` | 导出 nginx 配置后退出，不起网关 | — |

### 退出码

| 码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `2` | 参数缺失或非法 |
| `4` | 规则 / 配置文件读写或解析失败 |
| `1` | 其它运行时错误（错误信息带文件与行号） |

### 规则能力（`rules.json`）

- **CC 限流**：IP + 路径滑动窗口，超限返回 `429`；
- **签名规则**：SQLi / XSS / 路径穿越 / 敏感文件探测，命中返回 `403`；
- **IP 黑白名单**：白名单优先放行，黑名单直接拦截；
- **日志**：每条记录一行 JSON（`ts / ip / method / path / action / reason / ruleId / type / dryRun`）；
- **dry-run**：命中规则只写日志（`action: log-only`），不拦截。

---

## 与平台 `/tools` 目录的对接方式

平台侧路由见 `services/mim-api/src/routes/tools.ts`，数据表为 `schema.d/21-tools.sql` 的 `mim_tools`，
三条种子记录的 `slug` 与本目录一一对应：

| `mim_tools.slug` | 本目录实现 | 可产出的分发物 |
| --- | --- | --- |
| `quick-build-wp` | `tools/quick-build-wp/` | `--emit` 生成的建站脚本 `.sh` |
| `db-replace-domain` | `tools/db-replace-domain/` | 工具包 / CLI 说明 |
| `liudun-waf` | `tools/liudun-waf/` | 网关 CLI、`--emit-nginx` 生成的 `.conf` |

对接边界（重要）：

- `mim_tools` 记录里的 `download_url` / `doc_url`（即安装包 / 仓库链接）**可指向本目录产出的脚本或配置**，
  平台只做**元数据分发与链接展示**，**不在服务端执行**这些脚本、不起 WAF 进程；
- 建站脚本由用户在自有 Linux 主机执行；WAF 网关由站点侧 / 网关侧自行部署；换域名工具由管理员在数据库所在环境运行；
- 本目录不被 `services/mim-api`、`apps/web` 或主构建引用，平台前端只通过工具详情页的外链访问产物。

## 约束与边界

- 纯 Node 内置模块，**不新增 npm 依赖**；测试不联网，不下载真实 WordPress；
- 本机无 Docker / MySQL / PHP：建站工具交付物是**可执行脚本生成器 + 静态自检**，脚本的真实安装动作在目标 Linux 主机上发生；
- SQLite 模式依赖 Node 22 内置 `node:sqlite`（实验性 API）；
- 不改动主仓库既有源码 / 配置 / 工作流，本目录之外仅在 `docs/` 留交付文档。
