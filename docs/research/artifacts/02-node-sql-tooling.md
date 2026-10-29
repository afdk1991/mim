# Mim 后端生态 + PostgreSQL 工具链推荐清单

- **调研日期**：2026-10-29（Asia/Shanghai）
- **调研范围**：自托管全栈项目 Mim 的 Node 后端（`server/`：node:http 零框架 + pg 8.23，Node ≥20，ESM，唯一依赖 `pg`）+ PostgreSQL 工具链
- **部署约束**：全程无 Docker；GitHub Actions 构建 + 自有宿主机 systemd + nginx + PostgreSQL；按「无 Redis」评估
- **证据纪律**：标注「✅已核实官方」= npm/GitHub/官网直接核对；「⚠️仅第三方称」= 博客/二手来源，需二次确认
- **现状基线（已读 `server/package.json`、`server/scripts/migrate.js`、`server/db/migrations/`）**：
  - 自研迁移执行器：纯 SQL 文件（`0001_iam.sql` … `0007_seckill_lock_items.sql`）按文件名升序执行，全部语句幂等，记录表 `schema_migrations`；**无 down 回滚机制**
  - 自研通用 REST `/api/rest/:table` + RPC `/api/rpc/:fn` + 自研日志 + 自研 verify 脚本；前端已用 vitest 3.2.7

---

## 1. HTTP 框架 / 路由对照

| 资源 | URL | 开源许可 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| **保持零框架（现状 node:http）** | — | — | 极高：已自研通用表接口/RPC/存储/同步，全栈仅 1 个依赖 pg，攻击面最小 | 0 | **立即用（基线）** |
| **Hono** | https://hono.dev/docs | ✅ MIT（官方 README + npm 4.13.13） | 高：零依赖、Web 标准 Request/Response、Node 可跑、TS 优先；可渐进包裹现有 handler，中间件生态（cors/csrf/logger）现成 | 低-中：需重构路由层为 Hono app，通用表接口可平移 | **值得评估**（若未来要扩路由/中间件，它是首选引入对象） |
| **Fastify v5** | https://fastify.dev/ | ✅ MIT（OpenJS 基金会项目；v5.12.7） | 中：性能与 schema 校验（JSON Schema）强，但 v5 要求 Node 20+（✅满足）；插件体系较重，与现有 pg 直连模式叠加后抽象层偏厚 | 中-高：全量路由改写 + schema 体系建设 | **值得评估（偏谨慎）**——仅当「schema 校验 + 自动文档」成为刚需时 |
| **Express 5** | https://expressjs.com/en/blog/2025-03-31-v5-1-latest-release/ | ✅ MIT | 低：Express 5.1 已于 2025-03 成为 npm latest（✅已核实官方），生态最大但非 TS 优先、性能不如 Hono/Fastify；Mim 已自研路由，迁移无收益 | 高：与零框架自研完全重叠 | **仅参考** |
| **Koa** | https://www.npmjs.com/package/koa | ✅ MIT（v3.2.1，约 5 个月前发布，迭代缓慢） | 低：仅洋葱中间件模型，生态薄，维护热度低 | 中 | **仅参考** |

**结论权衡**：Mim 自研 REST/RPC 已成形且运行良好，**保持零框架是默认推荐**；只有当「中间件复用（限流/校验/日志）」的边际收益超过重构成本时，才优先考虑 Hono（轻、TS、可渐进），Fastify 次之，Express/Koa 不建议回头迁移。

---

## 2. 中间件 / 通用件

| 资源 | URL | 开源许可 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| **rate-limiter-flexible** | https://www.npmjs.com/package/rate-limiter-flexible | ✅ 官方 npm 自述：支持 PostgreSQL / 进程内存 / Cluster / PM2 等存储，**不依赖 Redis** | 高：正好覆盖 Mim「无 Redis + 已有 PG」场景；登录/秒杀接口限流可直接用 PG store，单机用 memory store | 低：单包，包一层中间件即可 | **值得评估**（优先于 express-rate-limit） |
| **@fastify/busboy** | https://www.npmjs.com/package/@fastify/busboy | ✅ MIT（Fastify 官方维护的 busboy fork，修复上游长期问题） | 高：对照 `/api/storage/*` 上传，流式 multipart 解析、不整文件入内存；undici 官方文档亦推荐用它解析不可信请求体 | 低：纯流式 parser，直接挂 node:http | **值得评估** |
| **busboy（上游 mscdex）** | https://github.com/mscdex/busboy | ✅ MIT | 中：功能同 @fastify/busboy，但上游修复慢，undici 官方文档已转推 fork | 低 | **仅参考**（选 @fastify/busboy 即可） |
| **helmet** | https://www.npmjs.com/package/helmet | ✅ MIT | 中：设置 CSP/HSTS 等安全响应头；但零框架下「手写几个 `res.setHeader()`」等价，且 API 类服务通常由 nginx 兜底安全头 | 极低 | **值得评估**（或直接手写 5 行 setHeader） |
| **cors（cors 包）** | https://www.npmjs.com/package/cors | ✅ MIT（第三方包页常识，未逐项核对） | 中：若前端与 API 同源部署（nginx 反代）则不需要；跨域部署时才引入 | 极低 | **值得评估（视部署拓扑）** |
| **compression** | https://www.npmjs.com/package/compression | ✅ MIT | 低：nginx 已做 gzip/brotli，应用层再压重复且耗 CPU | 低 | **不建议引入**（见文末清单） |
| **express-rate-limit** | https://www.npmjs.com/package/express-rate-limit | ✅ MIT | 低：绑定 Express 中间件模型，零框架 server 无法直接用 | — | **不建议引入**（见文末清单） |

---

## 3. 校验（对照自研 RPC 参数校验）

| 资源 | URL | 开源许可 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| **zod** | https://zod.dev/ | ✅ MIT（官方站点；已迭代至 v4） | 高：TS 类型推导是核心收益——`/api/rpc/:fn` 的入参 schema 一处定义、运行时校验 + 类型自动产出；纯 JS 可跑，无原生编译 | 低：在 rpc.js 包一层 `schema.parse(input)` | **值得评估（首选）** |
| **valibot** | https://valibot.dev/ | ✅ MIT（官方 FAQ 明确 MIT） | 高：与 zod 同能力，模块化/可 tree-shake，包体更小（⚠️体积数据为第三方对比文）；若在意 server 冷启动/包体积可选它 | 低 | **值得评估**（zod 的轻量替代） |
| **ajv** | https://ajv.js.org/ | ✅ MIT（生态常识，未逐项核对） | 中：JSON Schema 生态主力，主要随 Fastify 生态使用；Mim 不走 Fastify 则收益一般 | 中：需自维护 schema 到 TS 类型的桥 | **仅参考** |
| **joi** | https://joi.dev/ | ✅ BSD-3-Clause（生态常识） | 低：老牌但演进停滞，TS 推导弱于 zod/valibot | 中 | **不建议引入** |

---

## 4. 日志（对照自研日志）

| 资源 | URL | 开源许可 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| **pino** | https://getpino.io/ | ✅ MIT（官方 README 明示） | 高：官方称低开销（比常见替代快 5x+）、JSON 结构化输出；自托管侧可由 systemd `journald` 收 JSON 日志，或 `pino-pretty` 本地查看，无需 ELK/Loki | 低：替换自研 logger 为 pino 实例 | **值得评估** |
| **winston** | https://github.com/winstonjs/winston | ✅ MIT（生态常识） | 中：transports 灵活但同步开销大、样板多；自托管单机场景 pino 更省事 | 中 | **仅参考** |

---

## 5. 进程守护（PM2 vs systemd）

| 资源 | URL | 开源许可 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| **systemd（现状）** | https://pm2.io/docs/runtime/overview/（对照阅读） | — | 高：已在部署路线中；cgroup 资源限制 + journald 日志一体化，零额外运行时开销 | 0 | **立即用（现状）** |
| **PM2** | https://pm2.io/docs/runtime/overview/ | ✅ AGPL（源码可见的运行时；生态常识） | 低：⚠️仅第三方对比文称 PM2 自身带约 80MB+ Node 运行时开销；其 cluster 模式对单实例 API 收益有限，且与 systemd 职能重叠 | 中 | **不建议引入**（见文末清单） |

---

## 6. SQL 工具链（重点）

### 6.1 迁移（对照 `server/scripts/migrate.js` 自研执行器）

| 资源 | URL | 开源许可 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| **自研 migrate.js（现状）** | 项目内 `server/scripts/migrate.js` | — | 高：纯 SQL 幂等文件 + `schema_migrations` 记录，与 PG 原生心智一致；缺口是**无 down 回滚、无单文件事务包裹** | 0 | **立即用（基线）** |
| **node-pg-migrate** | https://www.npmjs.com/package/node-pg-migrate | ✅ **MIT**（npm 官方页；注意：与任务预设的 BSD-3 不符，已核实修正；约 9 天前仍在发布） | 中：专做 PG 迁移、支持 up/down、CLI 成熟；但 Mim 现有 SQL 全量幂等模式与它的「每迁移事务化 + 版本表」模型重叠，替换等于推翻现有 7 个迁移文件约定 | 中：需改写现有迁移目录约定 | **仅参考**（除非需要正式回滚能力） |
| **umzug** | https://www.npmjs.com/package/umzug | ✅ MIT（v3.8.3，Sequelize 团队维护） | 中：与 ORM 解耦的迁移引擎，可直接驱动现有 SQL 文件并补 down/状态表；比 node-pg-migrate 更贴近「包装现有 SQL」 | 低-中：可包一层现有 migrations 目录 | **值得评估**（若要给自研执行器补回滚/锁） |
| **knex（含迁移 CLI）** | https://www.npmjs.com/package/knex | ✅ MIT（v3.3.0） | 低：查询构造 + 迁移捆绑的重型工具，引入即绑定其 DSL，与 Mim「裸 SQL 心智」冲突 | 高 | **仅参考** |
| **drizzle-kit（+ drizzle-orm）** | https://orm.drizzle.team/docs/migrations | ✅ Apache-2.0（drizzle-orm；kit 同许可证体系） | 中：schema 即 TS 定义、自动生成迁移，类型安全最佳；但要求把现有 7 个手写 SQL 迁移全部反向建模成 schema.ts，重构面最大 | 高：全量 schema 建模 | **值得评估（长期方向，非急件）** |

### 6.2 查询构造 / 类型安全（对照自研 `/api/rest/:table` 动态查询）

| 资源 | URL | 开源许可 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| **kysely** | https://kysely.dev/ | ✅ MIT（v0.29.7，0 运行时依赖） | 高：纯查询构造器（不强绑 ORM），可直接套现有 pg Pool；动态条件链式拼构，列名/表名类型检查，正好收窄 `/api/rest/:table` 的 SQL 注入面 | 中：通用查询层改写，RPC 裸 SQL 可保留 | **值得评估（本维度首选）** |
| **drizzle-orm** | https://orm.drizzle.team/ | ✅ Apache-2.0 | 中：类型安全更强但需先建 schema 模型；与 kysely 二选一，drizzle 更「全栈 ORM」、kysely 更「渐进叠加」 | 高 | **仅参考**（与 6.1 drizzle-kit 联动决策） |
| **knex** | https://www.npmjs.com/package/knex | ✅ MIT | 低：DSL 老、类型弱于 kysely/drizzle | 高 | **不建议引入** |

### 6.3 SQL 格式化 / 安全（防注入）

| 资源 | URL | 开源许可 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| **pg 自带 escapeIdentifier / escapeLiteral** | https://node-postgres.com/apis/utilities | （pg 已在依赖内） | 高：`pg` 官方导出标识符转义函数，动态表名/列名（`/api/rest/:table` 入参）直接用它白名单转义，**零新增依赖** | 极低 | **立即用**（先审计现有 rest.js 是否对表名/列名做了转义） |
| **pg-format** | https://www.npmjs.com/package/pg-format | ✅ MIT（npm 官方页） | 中：PG `format()` 的 JS 实现，`%I` 转义标识符、`%L` 转义字面量；与 pg 自带函数能力重叠，作为更显式的备选 | 极低 | **值得评估**（若团队嫌 pg 内置函数不显式） |
| **slonik** | https://www.npmjs.com/package/slonik | ✅ **BSD-3-Clause**（npm 官方页；注意：与任务预设的 MIT 不符，已核实修正；v49.12.0，约 3 天前仍在发布） | 中：`sql` 标签模板天然防注入 + 内置断言/日志；但它本身就是 pg 的再封装，Mim 已直连 pg，再套一层收益有限 | 中：DB 访问层替换 | **仅参考** |
| **sql-formatter** | https://www.npmjs.com/package/sql-formatter | ✅ MIT（npm 官方页） | 低：仅用于 SQL 美化/日志打印，与运行时安全无关 | 极低 | **仅参考**（调试时可选） |

---

## 7. 安全（对照 `/api/auth/*`）

| 资源 | URL | 开源许可 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| **argon2（node-argon2）** | https://www.npmjs.com/package/argon2 | ✅ MIT 包装层（底层 PHC argon2 另证）；v0.26.0 起提供预编译二进制 | 高：⚠️仅第三方文称 OWASP 2025 密码存储速查表首推 **argon2id（m=19456, t=2, p=1）**；自托管宿主机无 Docker 也能装（prebuild 覆盖 Ubuntu x64/arm64） | 低：替换哈希函数调用 | **值得评估（首选）**——先核实当前 auth.js 用的是 bcrypt/scrypt/明文哪一种 |
| **@node-rs/argon2** | https://www.npmjs.com/package/@node-rs/argon2 | ✅ MIT（v2.2.2，约 17 天前发布） | 中：Rust/napi-rs 实现，预编译二进制、无 node-gyp 编译链；若怕 node-argon2 原生编译问题可选 | 低 | **值得评估**（argon2 的纯 Rust 替代） |
| **bcrypt** | https://www.npmjs.com/package/bcrypt | ✅ MIT | 中：广泛验证但已被 OWASP 降为遗留选项（⚠️第三方文）；72 字节截断坑 | 低 | **仅参考**（存量兼容可留，新密码建议 argon2id） |
| **jose** | https://www.npmjs.com/package/jose | ✅ MIT（panva 维护，v6.x，约 3 天前发布） | 高：纯 JS Web Crypto 实现 JWS/JWT/JWE，无原生编译、Node/Edge 通吃；正配 `/api/auth/*` 的 token 签发校验 | 低 | **值得评估（首选）** |
| **jsonwebtoken** | https://www.npmjs.com/package/jsonwebtoken | ✅ MIT | 低：生态老但维护放缓（约 1 年未发版，✅已见 npm 页） | 低 | **仅参考** |
| **CSRF** | — | — | 对 Mim 影响小：API 若走 `Authorization: Bearer`（非 Cookie）则浏览器天然不自动带凭证，**CSRF 面基本不存在**；若未来改 Cookie 会话，再上 double-submit cookie 或 Hono CSRF 中间件 | — | **仅参考（按现状 Bearer 可不管）** |

---

## 8. 测试（对照根 scripts 自研 verify 脚本）

| 资源 | URL | 开源许可 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| **node:test（Node 内置）** | https://nodejs.org/api/test.html | （Node 内置，零新增依赖） | 高：Node ≥20 内置测试运行器，可直接 `node --test` 跑 server 测试；与零框架极简风格一致 | 低：把 verify:backend 断言改写为 test(）用例 | **值得评估（首选）** |
| **supertest** | https://www.npmjs.com/package/supertest | ✅ MIT（生态常识） | 高：可直接把 `http.Server` 实例传进去发断言请求，无需监听端口；正好测零框架 server | 低 | **值得评估**（与 node:test 搭配） |
| **vitest** | https://vitest.dev/ | ✅ MIT | 中：前端 devDependencies 已用 vitest 3.2.7（✅项目内已核实）；若想前后端统一测试栈可复用，但后端纯 Node 场景 node:test 更零依赖 | 低（已有依赖） | **仅参考**（前端已用，后端不必强行统一） |

---

## 9. 后台任务

| 资源 | URL | 开源许可 | 与 Mim 匹配度 | 引入成本 | 优先级 |
|---|---|---|---|---|---|
| **cron（kelektiv/node-cron）** | https://www.npmjs.com/package/cron | ✅ MIT（v4.4.0） | 高：进程内 cron 表达式调度，无 Redis/无额外进程；适合每日清理、统计聚合等轻定时任务 | 极低 | **值得评估（首选）** |
| **croner** | https://www.npmjs.com/package/croner | ✅ MIT（v10.0.1，约 3 天前发布，零依赖） | 高：同为进程内调度，零依赖、TS 友好；与 node-cron 二选一 | 极低 | **值得评估** |
| **BullMQ v6（PostgreSQL 后端）** | https://bullmq.io/news/260927/bullmq-v6-postgresql/ | ✅ 官方公告：v6（2026-07 发布，Node 库 6.3.9）新增 **PostgreSQL 后端**，要求 PG 13+（推荐 14+），用 LISTEN/NOTIFY 唤醒 worker；吞吐约为 Redis 后端的一半（单 worker 峰值 ~9.4K jobs/s） | 中：终于**不再依赖 Redis**，与 Mim 无 Redis 路线吻合；但 2026-07 才发布、生态年轻，官方自己也说「会有 bug，欢迎反馈」 | 中：引入 pg 后端 + worker 进程 | **仅参考**（需要真正的任务队列/延迟任务/重试时再评估，勿过早引入） |
| **BullMQ v5 / Bull（Redis 后端）** | https://docs.bullmq.io/quick-start | — | 低：**强依赖 Redis**，与 Mim「无 Redis」路线不符 | — | **不建议引入**（见文末清单） |

---

## 附：本维度「不建议引入」清单

| 资源 | 原因 |
|---|---|
| **BullMQ v5 / Bull（Redis 后端）** | 官方 quick-start 明确需要 Redis 服务运行，Mim 无 Redis 路线 |
| **express-rate-limit** | 绑定 Express 中间件模型，Mim 是 node:http 零框架，无法直接挂载 |
| **compression（应用层）** | nginx 已做 gzip/brotli，应用层再压重复且耗 CPU |
| **PM2** | Mim 已走 systemd（cgroup + journald 一体化），PM2 额外带 Node 运行时开销，职能重叠（⚠️开销数据为第三方对比文） |
| **knex（查询构造器方向）** | DSL 重、类型安全弱于 kysely/drizzle，与裸 SQL 心智冲突 |
| **joi** | 演进停滞、TS 推导弱于 zod/valibot |
| **jsonwebtoken** | 维护放缓，同能力的 jose（panva）更活跃且无原生编译 |
| **Express 5 / Koa（新引入）** | Mim 自研路由已成形，从零框架迁到框架无净收益 |
| **任何 Docker 化方案** | 项目硬约束：全程无 Docker，宿主机裸跑 systemd |

---

## 与任务预设的出入修正（重要）

1. **node-pg-migrate 实际为 MIT**（npm 官方页），非任务预设的 BSD-3-Clause；仍在活跃发布（约 9 天前）。
2. **slonik 实际为 BSD-3-Clause**（npm 官方页），非任务预设的 MIT；仍在活跃发布（约 3 天前）。
3. **BullMQ 已于 2026-07（v6）新增 PostgreSQL 后端**——不再硬性要求 Redis；但生态年轻，定位从「不匹配」调整为「仅参考、观察成熟度」。
4. Mim 现有 `server/scripts/migrate.js` 是**自研幂等 SQL 执行器**（非空白），迁移类工具的评估基准应是「替换它」而非「从零搭建」。

---

## 来源 URL 汇总（按出现顺序，去重后见文末统计）

1. https://hono.dev/docs — Hono 官方文档（Web 标准、多运行时）
2. https://www.npmjs.com/package/hono — hono npm 页（MIT，v4.13.13）
3. https://fastify.dev/ — Fastify 官网（v5.x · Node 20+，OpenJS）
4. https://fastify.dev/docs/v5.7.x/Guides/Migration-Guide-V5/ — Fastify v5 迁移指南（v5 仅支持 Node 20+）
5. https://www.npmjs.com/package/fastify — fastify npm 页（MIT，v5.12.7）
6. https://expressjs.com/en/blog/2025-03-31-v5-1-latest-release/ — Express 5.1 成为 npm latest 官方公告 + LTS 时间表
7. https://expressjs.com/en/support/ — Express 官方版本支持矩阵
8. https://www.npmjs.com/package/koa — koa npm 页（MIT，v3.2.1）
9. https://zod.dev/ — Zod 官方站（TS-first schema，v4 迁移指南）
10. https://valibot.dev/ — Valibot 官方站（MIT，模块化）
11. https://getpino.io/ — Pino 官方 README（MIT，低开销）
12. https://kysely.dev/ — Kysely 官网（MIT，v0.29.7，0 运行时依赖）
13. https://orm.drizzle.team/docs/migrations — Drizzle ORM 迁移文档（drizzle-kit）
14. https://www.npmjs.com/package/node-pg-migrate — node-pg-migrate npm 页（MIT，活跃）
15. https://www.npmjs.com/package/slonik — slonik npm 页（BSD-3-Clause，v49.12.0）
16. https://www.npmjs.com/package/argon2 — node-argon2 npm 页（MIT 包装，预编译二进制）
17. https://www.npmjs.com/package/@node-rs/argon2 — @node-rs/argon2 npm 页（MIT，Rust/napi-rs）
18. https://auth1.ai/blog/argon2id-vs-bcrypt-migration/ — OWASP 2025 argon2id 参数（⚠️第三方转述）
19. https://www.npmjs.com/package/rate-limiter-flexible — rate-limiter-flexible npm 页（支持 PG/内存/Cluster，无需 Redis）
20. https://www.npmjs.com/package/helmet — helmet npm 页（安全响应头）
21. https://www.npmjs.com/package/@fastify/busboy — @fastify/busboy npm 页（官方维护的 busboy fork）
22. https://undici.nodejs.org/api/Fetch — undici 官方文档（推荐 @fastify/busboy 解析不可信 multipart）
23. https://www.npmjs.com/package/umzug — umzug npm 页（MIT，v3.8.3，Sequelize 团队）
24. https://www.npmjs.com/package/knex — knex npm 页（MIT，v3.3.0）
25. https://www.npmjs.com/package/pg-format — pg-format npm 页（安全转义标识符/字面量）
26. https://node-postgres.com/apis/utilities — pg 官方文档（escapeIdentifier / escapeLiteral）
27. https://www.npmjs.com/package/sql-formatter — sql-formatter npm 页（SQL 美化）
28. https://nodejs.org/api/test.html — Node.js 内置 test runner 官方文档
29. https://www.npmjs.com/package/cron — node-cron（cron 包）npm 页（MIT，v4.4.0）
30. https://www.npmjs.com/package/croner — croner npm 页（MIT，零依赖）
31. https://bullmq.io/news/260927/bullmq-v6-postgresql/ — BullMQ v6 PostgreSQL 后端官方公告
32. https://docs.bullmq.io/quick-start — BullMQ 官方 quick-start（Redis 为必需的历史说明）
33. https://pm2.io/docs/runtime/overview/ — PM2 官方文档
34. https://www.digitalocean.com/community/tutorials/how-to-use-pm2-to-setup-a-node-js-production-environment-on-an-ubuntu-vps — DigitalOcean PM2 vs systemd 对照（⚠️第三方教程）
35. https://www.npmjs.com/package/jose — jose npm 页（panva，MIT，v6.x）
36. https://www.npmjs.com/package/express-rate-limit — express-rate-limit npm 页（MIT，Express 专用）
