# 后台默认配置安全自查报告（2026-11-08）

> **性质与边界**：本报告是**通用框架下的出厂身份自查**，不构成任何具体产品的安全结论，不做漏洞挖掘、渗透测试、CVE 核查或资产探测。
> - 适用范围：仅自有或书面授权系统；仅依据本仓库内文件、本地首次部署记录与自有账号可见信息判断。
> - 未探测任何未授权资产：本轮**未发起任何对外请求**，未访问生产服务器、生产数据库、云平台控制台或第三方系统。
> - **不生成凭据清单**：全文只记录配置项「键名 / 状态 / 是否仍为出厂值」，不记录任何口令、令牌、密钥的值。初始账号与口令以厂商文档或本地首次部署记录为准。
> - 数据库账号仅核对**使用主体、初始口令状态、远程范围**三项，不写登录命令、连接串或查询语句。
> - 等保、数据出境、个人信息保护等合规法律义务，须咨询专业安全机构或法律顾问。

**首要目标结论（出厂身份是否仍存）**

| 出厂身份要素 | 结论 | 依据 |
|---|---|---|
| 通用默认管理员名（`admin`/`root` 类账号） | ✅ 代码中不存在；但存在可猜的 `superadmin` 内置角色码与 `x-admin-token` 通用引导通道 | `db.ts:98`、`config.ts:49`、`middleware.ts:205` |
| 未改初始口令 | 🟡 仓库内固定默认口令已于 2026-11-07 移除，改为部署期现场随机；**生产现役值是否轮换无法判定**（需自有账号可见的生产 env 记录） | `deploy/deploy.sh:180-195`、`docs/wiki/05-runbook.md:189`、`09-third-party-sdk-inventory.md:280` |
| 公开入口 | ⚠️ 存在：`/admin/` 通用路径公网可达、`/api/v1/auth/password` 为公开登录端点，无前置访问控制 | `deploy/nginx-mim.conf:82-111`、`app.ts:64` |
| 示例 / 测试账号 | ✅ 代码与建表脚本不种入任何用户账号；测试夹具中的固定值仅存在于测试文件；**生产库是否残留示例账号无法判定**（未探测） | `db.ts:20-22`、`schema.sql:11-40` |

---

## 一、资产台账

> 「负责人」栏：仓库自有账号为 `afdk1991`（GitHub 可见）；本仓库未登记具体运维责任人，统一标注「未登记」。
> 「管理员数」「2FA」栏：仅依据仓库文件与本地自有开发库判断；生产系统管理员清单与平台账号 2FA 状态不在授权可见信息内，标注「无法判定」。

| # | 系统 / 资产 | 负责人 | 地址（仓库记录） | 公网可达 | 管理员数 | 2FA | 上次检查时间 |
|---|---|---|---|---|---|---|---|
| A1 | 自研管理后台 `apps/admin` | 未登记 | `https://mim.mixm.top/admin/` | 是（无前置控制） | 无法判定（本地库 `user_roles`=0） | 无 | 2026-11-07 23:49（部署取证）/ 本次 2026-11-08 |
| A2 | 自研 API `services/mim-api` | 未登记 | `https://mim.mixm.top/api/v1`、`/health` | 是 | 不适用（RBAC 角色制） | 无 | 同上 |
| A3 | 腾讯云自建服务器（nginx + systemd + SQLite） | 未登记 | `https://mim.mixm.top` | 是 | 未登记 | 无法判定 | 2026-11-07 23:49 |
| A4 | EdgeOne Pages / GitHub Pages / Cloudflare Pages / Vercel / Sealos / IGA Pages / ghcr / GitHub 仓库（9 平台免费矩阵） | 未登记 | 见 `AGENTS.md` 铁律九 | 是 | 无法判定 | 无法判定 | 2026-11-07 23:49 |
| A5 | SQLite 单文件库 `mim.db` | 应用进程（`mim` 运行用户） | 服务器本地文件 `services/mim-api/data/mim.db` | 否（无网络监听） | 不适用（无 DB 账号） | 不适用 | 本次 2026-11-08 |
| A6 | CI/CD：GitHub Actions `deploy.yml` | 未登记 | `github.com/afdk1991/mim` | 是 | 无法判定 | 无法判定 | 2026-11-07（CI 五作业全绿） |
| A7 | 静态站点 / PRD 载体（`apps/web`、`site/*.html`、`Mim-PRD.html`） | 未登记 | 随 A3/A4 发布 | 是 | 不适用 | 不适用 | 本次 2026-11-08 |
| A8 | 网络设备 / IoT / 固件 | 不适用 | — | 不适用 | 不适用 | 不适用 | 本次（项目明确排除，见 §三-4） |

**台账缺口**：负责人、生产管理员数、各平台账号 2FA、上次正式自查时间均未在仓库登记，本轮列为 P1 补登项。

---

## 二、G1–G14 逐项结果

判定口径：**合格** = 有代码/配置证据满足；**不合格** = 有证据表明不满足；**无法判定** = 需生产侧或自有账号可见信息，本轮按约束不探测。风险等级仅针对本项，不代表整体系统风险。

| 项 | 要求 | 结果 | 证据（文件:行号） | 风险 |
|---|---|---|---|---|
| **G1** | 管理员名不可猜 | 🟡 部分合格 | 无固定 `admin`/`root` 账号；登录标识为手机号/邮箱并自动建号（`routes/auth.ts:158-196`）。但内置角色码 `superadmin`（`db.ts:98`）与引导头 `x-admin-token`（`middleware.ts:205-215`）为可猜的通用命名 | 中 |
| **G2** | 16 位随机、不复用 | 🟡 部分合格 | 管理员口令部署期现场随机 24 位（`deploy.sh:191-194`）、JWT 密钥 `openssl rand -hex 32`（`deploy.sh:164`）、验证码 `crypto.randomInt`（`auth.ts:52`）。但 `MIM_ADMIN_TOKEN` 由 CI Secret 透传（`deploy.yml:104`），其长度/随机性/是否跨环境复用**无法判定**；`deploy.sh:184-185,202-203` 幂等保留既有值，不自动轮换 | 中 |
| **G3** | 示例账号清除 | 🟡 部分合格 | `db.ts:20-22` 仅种入模块与 RBAC 角色/权限，**不种入任何 users/identities**；`schema.sql` 无用户 INSERT；`.env.example:36,197,202` 为空占位；站点/PRD 页无示例账号或口令。测试文件含固定夹具常量（`test/*.ts`），仅测试期生效。本地开发库 `users=8 / user_roles=0 / sessions=10`（自有开发数据，未入库、已 gitignore）。**生产库示例账号无法判定** | 中 |
| **G4** | 入口改路径 / 前置控制 | ❌ 不合格 | `/admin` 301 到 `/admin/`、`location /admin/` 使用通用路径（`nginx-mim.conf:82-111`）；全文无 `auth_basic` / `allow` / `deny` / `satisfy`；`POST /api/v1/auth/password` 为公开端点（`app.ts:64`、`auth.ts:328`） | **高** |
| **G5** | 仅内网 / VPN / 白名单 | ❌ 不合格 | 项目设计即 9 平台公网部署矩阵（`AGENTS.md` 铁律九），管理后台随公网域名发布；`nginx-mim.conf` 无任何来源限制。属**设计选择与清单要求冲突**，非配置失误 | **高** |
| **G6** | 管理员 2FA | ❌ 不合格 | 全仓 `2fa/mfa/totp/webauthn/passkey` 检索仅命中 1 处文档描述（`07-functional-modules.md:64`，指登录方式绑定二次确认，非管理员 2FA）；登录链路 `auth.ts:328-367` 只有单因子口令 | **高** |
| **G7** | 5–10 次锁定 + 告警 | 🟡 部分合格 | 锁定机制合格：`LOGIN_LOCK_AFTER_FAILURES=5`、`LOGIN_LOCK_MINUTES=15`（`config.ts:30-31`），`login_failures` 表 + `assertNotLocked/recordFailure`（`auth.ts:128-156`、`schema.sql:255-261`），验证码 5 次作废（`config.ts:26`）。**无告警出口**：`recordFailure` 仅写库，`auth.ts` 无 notify/告警联动 | 中 |
| **G8** | 无离职/停用/共用，最小权限 | 🟡 部分合格 | 最小权限合格：三档内置角色 `superadmin/operator/viewer` 权限分离（`db.ts:96-128`），权限实时查库、撤销即时生效（`middleware.ts:242-279`），账号状态含 `deleted/pending_deletion`（`schema.sql:14`）。但 `x-admin-token` 是**共用全权限引导通道**（`middleware.ts:194-216`、`admin.ts:186-191`），等效共用超管；离职/停用账号清单需生产侧信息，**无法判定** | 中 |
| **G9** | bcrypt/scrypt/argon2 慢哈希，禁明文/MD5 | 🟡 部分合格 | 验证码与凭据哈希使用 `bcryptjs` cost=10（`auth.ts:4,56-62`），刷新令牌仅存 `sha256` 摘要（`auth.ts:111`、`schema.sql:45`），JWT 限定 HS256 算法白名单（`auth.ts:91`）。但管理员登录口令 `MIM_AUTH_ADMIN_PASSWORD` **以明文配置值**参与 `secureEqual` 比较（`auth.ts:337-348`），未做慢哈希存储（虽 env 文件 chmod 600、不入仓库） | 中 |
| **G10** | 日志 ≥180 天，含来源IP/时间/账号/动作 | ❌ 不合格 | nginx 有 `access_log`（`nginx-mim.conf:118`，默认格式含 IP/时间/请求行），`/health` 关闭日志；但**无应用审计日志表**（`schema.sql` 全表无账号/动作审计），`deploy/` 与 `scripts/` 无 logrotate / 180 天留存配置；`backup-db.sh:23` 的 `KEEP=14` 是数据库备份份数，不是日志留存；`05-runbook.md` 记录审计域未实现 | **高** |
| **G11** | 令牌随机、超时、登出失效；Cookie HttpOnly+Secure | 🟡 部分合格 | 合格面：`randomBytes(32)` 刷新令牌（`auth.ts:79`）、访问令牌 15 分钟（`config.ts:23`）、刷新轮换即吊销旧会话（`auth.ts:385-387`）、登出撤销（`auth.ts:390-395`）、CORS `credentials:false`（`app.ts:45`）。**不适用/缺失面**：整站使用 Bearer + `localStorage` 持久化（`apps/admin/src/api.ts:8,17-56`、`apps/web/src/api.ts:61-84`），**无 Cookie 会话**，故 HttpOnly+Secure 无从落地；localStorage 存令牌存在脚本读取面 | 中 |
| **G12** | 关键写操作 CSRF 校验 | ⚪ 不适用（附说明） | 鉴权为 `Authorization` / `X-Admin-Token` 自定义头，非 Cookie 自动携带，浏览器跨站请求无法附带凭证；`cors` 白名单限定来源（`app.ts:34-48`），写操作强制 `Idempotency-Key`（`config.ts:35`、`middleware.ts:79-81`）。**清单字面的 CSRF Token 校验未实现**，但因无 Cookie 会话不构成等效风险；若后续改用 Cookie 会话须同步补 CSRF | 低 |
| **G13** | 受支持版本、无未修补高危 | ⚪ 无法判定 | 依赖清单记录 `vite 6.4.4`（标注安全修复线）、`vitest 4.1.12`（标注修复安全通告）、Node `>=20`、Express 5 等（`04-dependencies.md:11-33,72`）；锁文件 `lockfileVersion 9.0`。**本轮按约束不做漏洞核查**，未执行依赖审计/CVE 比对，故不判定 | 无法判定 |
| **G14** | `install.php`/`.sql`/`.bak`/`.zip` 删除且不可访问 | 🟡 部分合格 | 生产静态根 `/opt/mim/web`、`/opt/mim/admin` 只放构建产物（`deploy.sh:140-152`），**无 install.php、无 .bak/.zip**；`.env`（0 字节）、`.mim-dev-secret/jwt.key`、`data/mim.db`、`.trae-html-share-packages/*.zip` 均存在本地但已 gitignore 且未入库、不在静态根。`src/schema.sql`/`dist/schema.sql` 是**运行必需建表脚本**（非安装残留，`db.ts:9`、`deploy.sh:130-138`）。缺口：nginx **无 deny 规则**屏蔽敏感扩展名；本地工作区仍留 `.zip`/`.db`/`.key` 工件 | 中 |

**汇总**：合格 0 项（整项无缺口）；部分合格 8 项（G1/G2/G3/G7/G8/G9/G11/G14）；不合格 4 项（G4/G5/G6/G10）；不适用 1 项（G12）；无法判定 1 项（G13）。高风险 4 项（G4/G5/G6/G10），中风险 8 项，低风险 1 项。

---

## 三、六类分系统要点

| 类别 | 本项目对应资产 | 出厂身份核查要点 | 结论 |
|---|---|---|---|
| **1. CMS / 建站** | `apps/web`（Vite SPA）、`site/index.html`、`site/prd.html`、`Mim-PRD.html`、`dist/` | 无 CMS 内核（WordPress/DedeCMS 类）、无 `install.php`、无安装向导、无示例管理员；静态页不含默认口令/测试账号；构建产物仅 `index.html`+`assets/`，未混入 `.sql`/`.env`/`.db` | ✅ 无出厂身份残留；P2 补 nginx deny 规则 |
| **2. 服务器面板与运维** | `deploy/nginx-mim.conf`、`mim-api.service`、`mim-backup.service/.timer`、`bootstrap.sh`、`deploy.sh`、`backup-db.sh`、`.github/workflows/deploy.yml` | 无宝塔/cPanel/phpMyAdmin 类面板，故无面板出厂口令；`bootstrap.sh:65` 生成无口令短语的只读 deploy key（自动化部署密钥，非登录口令，已登记为仓库 Deploy Key）；运行用户 `mim` 为 `nologin` 系统用户；`sudo -n` 非交互。缺口：`/admin/` 无 basic auth / IP 白名单，SSH 来源未限制 | ⚠️ 面板类合格；入口前置控制不合格（G4/G5） |
| **3. 数据库与缓存** | SQLite（`better-sqlite3`，WAL）；无 Redis/Memcached 实部署（仅规划文档 `08-dev-implementation.md:24,319`） | **使用主体**：应用进程以 `mim` 用户读写本地单文件，无独立 DB 账号；**初始口令状态**：不适用（文件权限 `chmod 600` env + 目录属主控制，非口令鉴权）；**远程范围**：无网络监听端口，不对外暴露；每日 03:00 备份、保留 14 份（`backup-db.sh:23`、`mim-backup.timer`）；生产库路径在发布目录内 | ✅ 无远程暴露、无出厂账号；日志留存另见 G10 |
| **4. 网络设备与 IoT** | 无 | 项目文档明确排除硬件 IoT（`01-architecture.md:91`、`07-functional-modules.md:17,249`、`09-third-party-sdk-inventory.md:218-221`）；历史审计对象 `src/site-nodes.ts`（已不在工作树）的 45 个子域记录为站点地图元数据（并注明不暴露解析目标 IP/CNAME，`site.ts:9`），**不是真实网络设备资产**；无固件、路由器、交换机、MQTT/SNMP 端点 | ⚪ 不适用，无需核查 |
| **5. 云平台与 SaaS** | 9 个免费平台（腾讯云自建 / EdgeOne / GitHub Pages / Sealos / Cloudflare Pages / ghcr / IGA Pages / Vercel / GitHub 仓库），见 `AGENTS.md` 铁律九 | 平台凭证全部经 CI Secret 引用（`deploy.yml:77-104,261,304-306,323-325,342-345,367`），仓库内无明文；`deploy.sh:181-194` 明确移除公开固定口令并改为现场随机；`.env.example` 全部空占位、`env-check.mjs` 为 CI 门禁。缺口：各平台账号自身 2FA、初始口令状态、是否有遗留试用账号，**不在授权可见信息内，未探测** | 🟡 仓库侧合格；平台账号侧无法判定（P1 由自有账号自查） |
| **6. 自研后台** | `apps/admin` + `services/mim-api`：RBAC 双通道（`x-admin-token` 引导 + Bearer JWT/RBAC）、`/auth/password`、`/admin/*` | 这是出厂身份核查的核心区：无固定默认账号名、无示例账号种子、固定默认口令已移除；但**共用超管引导令牌全权限**、**单一共享管理员口令**、**无 2FA**、**`/admin/` 通用路径公网可达**、**无审计日志**、**后台凭证存 localStorage** | ⚠️ 见 G1/G2/G4–G11 逐项 |

---

## 四、处置优先级

### P0（当天）—— 出厂身份、公网弱认证后台/库/缓存/面板、明文/弱哈希、脚本/备份/示例账号

| # | 问题 | 动作 | 临时缓解 |
|---|---|---|---|
| P0-1 | `x-admin-token` 超管引导通道：共用、全权限、无 2FA、公网可达（`middleware.ts:194-216`） | 用引导通道把 `superadmin` 授予实名账号后，**关闭该通道**（生产 env 移除 `MIM_ADMIN_TOKEN`），日常仅走 RBAC | 当天轮换该令牌值，并限制来源 |
| P0-2 | `/admin/` 通用路径 + 公网可达 + 无前置控制（G4/G5） | 加 nginx `auth_basic` 或来源 IP 白名单；或改为非通用路径 | 当天先加 basic auth，再排期改路径 |
| P0-3 | 单一共享管理员口令 `MIM_AUTH_ADMIN_PASSWORD` 明文配置、无 2FA（`auth.ts:337`） | 确认生产现值非出厂值 → 轮换 → 改用实名账号 + RBAC，禁用共享口令登录 | 轮换并缩短暴露面，纳入密码管理器 |
| P0-4 | 各平台/服务器初始口令是否曾轮换**无法判定** | 由自有账号登录各平台核对口令轮换记录与停用/离职账号；有疑点即轮换 | 停用可疑账号 |
| P0-5 | 生产库是否残留示例/测试账号**无法判定** | 由自有账号在授权范围内核对账号清单，清除示例账号 | 先禁用示例账号 |
| P0-6 | 本地工作区残留 `.zip`/`.db`/`.key`/`.env` 工件（已 gitignore、未入库、不在静态根） | 确认生产静态根无同类文件；补 nginx `deny` 规则屏蔽 `.sql`/`.bak`/`.zip`/`.env`/`.db` | 立即加 deny |

### P1（一周）—— 未开 2FA、共用/离职大权限、无锁定告警、无日志

| # | 问题 | 动作 |
|---|---|---|
| P1-1 | 管理员 2FA 缺失（G6） | 为管理员登录引入第二因子（TOTP / WebAuthn），引导通道与共享口令通道同步纳入或先行关闭 |
| P1-2 | 共用大权限 / 离职停用账号清单缺失（G8） | 建立实名管理员清单与离职即停流程；复核 `operator`/`viewer` 最小权限；补台账「负责人/管理员数/2FA/上次检查时间」 |
| P1-3 | 有锁定无告警（G7） | 在 `recordFailure` 达阈值时接告警出口（现有 `notify` 通道可扩展），保留 5 次/15 分钟参数 |
| P1-4 | 无应用审计日志、无 180 天留存（G10） | 新增审计表记录来源 IP / 时间 / 账号 / 动作，配置日志轮转与 ≥180 天留存；注意 `KEEP=14` 是备份份数不可混用 |
| P1-5 | 生产管理员口令与 `MIM_ADMIN_TOKEN` 长度/复用状态无法判定（G2） | 制定季度轮换与「一系统一口令」规则，登记轮换记录（只记时间，不记值） |

### P2（一月）—— 入口控制、补丁/固件、最小权限

| # | 问题 | 动作 |
|---|---|---|
| P2-1 | 入口控制（G4 残余）：通用路径、无 deny 规则 | nginx 补 `location ~* \.(sql|bak|zip|env|db)$ { deny all; }`；`/admin/` 改非通用路径；评估 VPN / 白名单可行性（与 9 平台公网矩阵的设计冲突需业务决策） |
| P2-2 | 补丁 / 固件（G13） | 在授权范围内执行依赖审计与版本核对（本轮按「不找漏洞」约束未做）；网络设备/IoT 类不适用 |
| P2-3 | 最小权限与会话存储（G8/G11） | 后台/前台令牌从 `localStorage` 迁移到 `HttpOnly + Secure + SameSite` Cookie，并**同步补 CSRF 校验**（G12 的前提将变化）；复核内置角色权限基线 |
| P2-4 | 管理员口令慢哈希（G9） | 若保留口令登录，改为 bcrypt/argon2 校验；或彻底移除该端点、改实名 + 2FA |

---

## 五、留档要求

**留档表（模板，逐问题登记）**

| 字段 | 填写要求 |
|---|---|
| 问题 | 引用本报告编号（P0-1…P2-4 / G1…G14），描述现象不改结论 |
| 动作 | 具体变更内容 + 关联文件/配置 |
| 责任人 | 实名；当前台账中「未登记」项须补齐 |
| 完成时间 | 实际完成日期（P0 当天 / P1 一周 / P2 一月） |
| 临时缓解 / 到期日 | 未彻底修复时登记缓解措施与其失效日期，到期必须复核 |
| 复查 | **季度复查** + **重大变更后复查**（新增平台、改鉴权链路、换域名、人员变动、依赖大版本升级后立即复查） |

**凭据管理纪律（强制）**
- 所有初始账号与新口令**只入密码管理器**，由责任人在受控环境保管。
- **禁止**把口令、令牌、密钥的值写入：文档、聊天记录、仓库（含 commit message、issue、PR 正文、`.env` 提交）、截图、日志、CI 明文输出。
- 本报告与后续留档表**只记配置项键名与状态**，不记值；`deploy.sh` 已遵循「现场随机、日志不回显」，继续保持。
- 轮换记录只记「时间 + 责任人 + 结果」，不记新旧值。

---

## 六、复核与同步清单

| 工件 | 本轮是否变动 | 说明 |
|---|---|---|
| 本报告 `docs/security-default-config-audit-20261108.md` | 新增 | 自查结论与留档模板 |
| `docs/wiki/README.md` 索引 | 同步 | 追加本报告链接 |
| `AGENTS.md` / `README.md` / `Mim-PRD.html` / `deploy/` / `.github/workflows/` | 不涉及 | 本轮为只读自查，未改动任何功能、配置、依赖或部署工件 |
| 生产系统 | 不涉及 | 按「不探测未授权资产」约束，未发起外部请求，未变更生产 |

**免责声明**：本报告仅为通用自查框架在本仓库静态文件上的应用，用以确认出厂身份是否仍存，**不构成任何具体产品的安全结论或合规证明**，不替代渗透测试、代码审计、等保测评。等保、数据出境、个人信息保护等法律义务请咨询专业安全机构或法律顾问。

_自查时间：2026-11-08 01:35–01:48 (GMT+8) ｜ 依据仓库 HEAD `069d791`（2026-11-08 00:40）｜ 取证方式：本地文件静态分析，无外部探测_
