# 自托管 BaaS 落地执行计划（implementation plan）

> 目标：把 `docs/selfhosted-baas-blueprint.md` 的架构方案变成**可一键拉起、可验收**的代码仓库内容。
> 前置结论（环境勘察 2026-10-27）：本机无 docker / psql / deno / make，且 Docker Hub 与 GitHub API 出口不可达。
> 因此本轮交付以**可静态验证的产物**（SQL / compose / 脚本 / 函数源码）为主，运行时验证脚本按要求写好，
> 但需在装了 Docker 的机器上执行；这一点在下方每步验收标准里都做了区分标注。

---

## 0. 范围与位置决策（含歧义处理）

| 决策项 | 采用方案 | 理由 |
|---|---|---|
| 代码落点 | 仓库根新建 `baas/` 自包含目录 | 与既有 React 前端 `src/`、迁移 `supabase/` 完全隔离；根 CI 只构建 web，不受影响；日后要独立成仓库直接 `git mv baas ../` 即可 |
| 是否改根 `package.json` | **不改** | 避免与并行会话的改动冲突；`baas` 用 Makefile + 纯 Node 脚本（零依赖）驱动 |
| 编排形态 | Docker Compose（单节点起步）+ `s3` / `studio` 可选 profile | 单机即可跑全栈；对象存储默认走本地文件后端，接 S3 才开 profile |
| 镜像来源 | 全部收进 `.env` 变量（`POSTGRES_IMAGE` 等） | 本机无网络无法核对 tag；集中到一个文件，用户一次改完 |
| 组件选型 | 沿用蓝图结论：PostgREST / gotrue(supabase auth) / realtime / storage-api / edge-runtime / pgvector | 生态契约与 Supabase 一致，客户端 SDK 可直接复用，且全部可自托管 |

**必须偏离原计划的两处（已在下面步骤中体现）：**

1. **GraphQL 不直接暴露 `pg_graphql` 原生端点**，改为 PostgREST RPC 桥接 `public.graphql()`。
   原因：不同部署下文革端点挂载方式不一致，走 PostgREST `/rpc/graphql` 是最稳且能复用 JWT→RLS 链路的做法。
2. **Storage 默认后端 = 本地文件（`STORAGE_BACKEND=file`）而非 S3**。
   原因：单节点自托管零外部依赖；S3 通过 `minio` profile 与 `STORAGE_BACKEND=s3` 切换，两种都写好。

---

## 1. 步骤总览与依赖

```
步骤1 骨架与编排 ──┬─▶ 步骤2 数据库地基 ──▶ 步骤3 Auth+REST+GraphQL ──▶ 步骤6 Vector
                  │                              │
                  ├─▶ 步骤4 Realtime ────────────┤
                  ├─▶ 步骤5 Storage ─────────────┤
                  └─▶ 步骤7 Edge Functions ─────┘
                                                 │
                                           步骤8 验收脚本+文档（依赖全部）
```

硬依赖说明：

- **步骤2 是全部模块的地基**：角色（`anon`/`authenticated`/`service_role`/`authenticator`）、
  `request.jwt.claims → RLS` 提取函数、迁移记录表都在这里。
- **步骤3 之后的所有模块都复用同一套 RLS**，不再各自设计权限。
- **步骤4 Realtime 依赖步骤2 的 publication 白名单**（复制槽治理）。
- **步骤6 Vector 依赖步骤3**：向量检索函数必须 `security invoker`，结果才能被 RLS 裁剪。
- **步骤7 Edge Functions 依赖步骤3**（用 service_role 调 PostgREST）与步骤6（rag-search 调 RPC）。

---

## 2. 分步计划

### 步骤 1 · 目录骨架与编排（compose / env / 网关 / Makefile）

| 项 | 内容 |
|---|---|
| 实现目标 | 一条 `make up` 拉起全栈；所有镜像 tag、端口、密钥集中到 `.env`；网关按路径分发七类流量 |
| 新增文件 | `baas/docker-compose.yml`、`baas/.env.example`、`baas/envoy/envoy.yaml`、`baas/Makefile`、`baas/.gitignore`、`baas/docs/implementation-plan.md` |
| 关键实现 | Envoy 单监听 8000；路由 `/auth/v1` `/rest/v1` `/graphql/v1` `/realtime/v1` `/storage/v1` `/functions/v1` `/pg/meta`；WebSocket `upgrade_configs`；profile：`s3`(minio)、`studio` |
| 依赖 | 无 |
| 验收标准 | ① `docker compose config` 无报错（需在装 Docker 的机器上跑）；② YAML 缩进/无 Tab/必需服务齐全（本轮静态检查 `scripts/verify.mjs`）；③ 网关七条路由与 compose 服务名一一对应（脚本交叉比对） |

### 步骤 2 · 数据库地基与迁移流水线

| 项 | 内容 |
|---|---|
| 实现目标 | 角色与扩展幂等初始化；迁移按序执行、可重复、有记录；PostgREST schema cache 可重载 |
| 新增文件 | `baas/db/init/00_bootstrap_roles.sql`、`baas/db/migrations/0001_foundation.sql`、<br>`baas/scripts/db-psql.sh`、`baas/scripts/migrate.sh`、`baas/scripts/reload-postgrest.sh`、`baas/scripts/new-migration.sh`、`baas/scripts/check-sql.mjs` |
| 关键实现 | `anon/authenticated/service_role(bypassrls)/authenticator` 四角色；扩展 `pgcrypto/pgjwt/uuid-ossp/pgvector/pg_graphql`；`public.jwt_claims()/jwt_uid()/jwt_role()` 从 `request.jwt.claims` 取值（不依赖 auth schema 内部实现，可移植）；`schema_migrations` 记录表 |
| 依赖 | 步骤1（compose 提供 db 容器） |
| 验收标准 | ① `bash -n` 全部脚本通过；② `check-sql.mjs` 全绿（dollar-quote 平衡、无裸 `SET`、无 `security definer` 缺 `search_path`）；③ `make migrate` 可重复执行且不重复应用（psql 侧验证，需 Docker 环境） |

### 步骤 3 · Auth + REST/GraphQL 打通 RLS

| 项 | 内容 |
|---|---|
| 实现目标 | 邮箱密码 / 魔法链接 / OAuth 三种登录；注册自动建 profile；业务表策略按 `jwt_uid()` 收敛；GraphQL 走同一权限链路 |
| 新增文件 | `baas/db/migrations/0002_auth_bridge.sql`、`0003_rls_baseline.sql`、`0007_graphql_bridge.sql`；env 中 gotrue 段（SMTP / GitHub / Google） |
| 关键实现 | `handle_new_user()` 触发器；`todos` 全 CRUD 策略；`documents` 只读/自写策略；`public.graphql(query)` 桥接 `graphql.resolve()` 并对 `anon` 限流 |
| 依赖 | 步骤2 |
| 验收标准 | ① tsc / SQL 静态检查通过；② `check-sql.mjs` 中「public 表未开 RLS」检查为 0；③ 运行时：`make health` 中 `/auth/v1/health`、`/rest/v1/` 返回 2xx（需 Docker 环境） |

### 步骤 4 · Realtime

| 项 | 内容 |
|---|---|
| 实现目标 | WAL→WS 变更推送、Presence、Broadcast；复制槽不会撑爆磁盘 |
| 新增文件 | `baas/db/migrations/0004_realtime.sql`；compose 中 realtime 服务与参数 |
| 关键实现 | `create publication supabase_realtime for table <白名单>`；`TEMP_SLOT=true` + `max_slot_wal_keep_size` 治理；SECURE_CHANNELS=true（WS 必须带 JWT，RLS 在库内复算） |
| 依赖 | 步骤2 |
| 验收标准 | ① publication 白名单与业务表交叉一致；② 文档明确禁止 Realtime 依赖 `LISTEN`（事务池下失效）；③ 运行时 `/realtime/v1/api/health` 2xx |

### 步骤 5 · Storage

| 项 | 内容 |
|---|---|
| 实现目标 | S3 兼容 + 本地文件双后端；bucket 一键初始化；业务侧可把对象挂到自己的行上并受 RLS 约束 |
| 新增文件 | `baas/db/migrations/0005_storage_bridge.sql`、`baas/scripts/init-storage.sh`；compose `s3` profile(minio) + imgproxy |
| 关键实现 | `public.file_refs` 关联 `storage.objects`，RLS 用 `jwt_uid()`；`/storage/v1/object/sign` 签名 URL；`STORAGE_BACKEND` 切换说明 |
| 依赖 | 步骤2（Storage 也写 PG，元数据受 RLS） |
| 验收标准 | ① `bash -n init-storage.sh`；② 脚本用 service_role 调 `/storage/v1/bucket` 幂等建桶；③ 运行时 `/storage/v1/status` 2xx |

### 步骤 6 · Vector

| 项 | 内容 |
|---|---|
| 实现目标 | pgvector 向量检索 + 全文混合检索；结果受 RLS 裁剪；过滤场景召回不塌 |
| 新增文件 | `baas/db/migrations/0006_vector.sql` |
| 关键实现 | `documents` / `document_chunks`；`vector(1536)` + HNSW `vector_cosine_ops`；函数内 `set_config('hnsw.iterative_scan','on',true)`（事务局部）；`match_chunks()` / `hybrid_search()` 用 RRF 融合；全部 `security invoker` |
| 依赖 | 步骤3（RLS 与 jwt 提取函数） |
| 验收标准 | ① SQL 静态检查全绿；② 记录维度/索引限制（vector≤2000 维、>2000 用 halfvec）与 `set_config` 事务局部的原因；③ 运行时 RPC 可调用（需 Docker 环境） |

### 步骤 7 · Edge Functions

| 项 | 内容 |
|---|---|
| 实现目标 | Deno 函数全球部署的本地等价物：一个 main 服务按路径路由 + 三个可用示例 |
| 新增文件 | `baas/functions/main/index.ts`、`hello`、`embed`、`rag-search`、`_shared/cors.ts`、`_shared/db.ts`、`_shared/deno.d.ts`、`tsconfig.json` |
| 关键实现 | main 里按 `url.pathname` 分派；`_shared/db.ts` 用 service_role 走 PostgREST；`_shared/deno.d.ts` 提供本机 tsc 检查用的最小 `Deno` 声明（Deno 运行时不需要） |
| 依赖 | 步骤3（PostgREST）、步骤6（rag-search） |
| 验收标准 | ① `npx tsc -p baas/functions/tsconfig.json --noEmit` 0 错；② 每个 handler 有 CORS 与 OPTIONS 分支；③ 运行时 `/functions/v1/hello` 返回 JSON |

### 步骤 8 · 验收脚本 + 文档

| 项 | 内容 |
|---|---|
| 实现目标 | 一键体检：静态检查永远可跑，运行时检查有栈时才跑；密钥可本地生成并自验签 |
| 新增文件 | `baas/scripts/gen-jwt.mjs`、`healthcheck.mjs`、`verify.mjs`、`baas/README.md` |
| 关键实现 | `gen-jwt.mjs` 用 Node 内置 crypto 生成 HS256 anon/service key，**并做签发-验签回环自检**（本轮可真跑）；`healthcheck.mjs` 探测七类端点；`verify.mjs` 编排全部检查 |
| 依赖 | 步骤1-7 |
| 验收标准 | ① `node scripts/verify.mjs` 在本机跑通、退出码 0；② `node scripts/gen-jwt.mjs --self-test` 通过；③ README 手写步骤与 compose/env 实际变量逐项对应（脚本交叉核对） |

---

## 3. 风险登记（本轮无法在本机消除，需在目标机执行）

| 风险 | 等级 | 处置 |
|---|---|---|
| 镜像 tag 可能不存在（本机无网无法核对 Docker Hub） | 🟡 | 全部收进 `.env`，`README` 给出核对命令；首次 `make up` 前先 `make pull` |
| gotrue / realtime / storage 的 env 参数名随版本漂移 | 🟡 | env 段加注释标明版本区间；`healthcheck.mjs` 逐个端点探测，一眼看出哪个组件没起来 |
| 连接池事务模式下裸 `SET` 残留导致串号 | 🔴 | 全链路只用 `SET LOCAL` / `set_config(...,true)`；`check-sql.mjs` 静态拦截裸 `SET` |
| Realtime 复制槽堆积 | 🔴 | `max_slot_wal_keep_size` + `TEMP_SLOT` + 白名单 publication + 滞后告警（写进 README 运维章节） |
| PostgREST schema cache 未刷新导致「表不存在」假故障 | 🟡 | `make reload` 与 migrate 流程内自动 reload（本项目今天刚踩过 PGRST205） |

---

## 4. 执行结果回填（2026-10-27）

| 步骤 | 状态 | 验收证据 |
|---|---|---|
| 1 骨架与编排 | ✅ | compose 8 个核心服务 + 2 个 profile；Envoy 7 类路由；`verify.mjs` 编排一致性 6 项全绿 |
| 2 数据库地基 | ✅ | `00_bootstrap_roles.sql` + `0001`；`bash -n` 5/5；SQL 静态体检 9 文件 0 问题 |
| 3 Auth + REST/GraphQL | ✅ | `0002`(profiles/角色/首个管理员引导) `0003`(RLS 基线) `0007`(GraphQL 桥接)；public 表 RLS 漏开 = 0 |
| 4 Realtime | ✅ | `0004` publication 白名单 + replica identity full + 复制槽告警；Envoy 已配 `upgrade_configs: websocket` |
| 5 Storage | ✅ | `0005` file_refs + storage.objects 示例策略（schema 未就绪时自动跳过）；`init-storage.sh` 幂等建桶 |
| 6 Vector | ✅ | `0006` HNSW + iterative_scan（失败静默降级）+ RRF 混合检索，全部 security invoker |
| 7 Edge Functions | ✅ | main 路由 + 3 个函数；`tsc --noEmit --listFiles` 纳入 7 个文件、0 error |
| 8 验收与文档 | ✅ | `verify.mjs` 16/16 通过（退出码 0）；`gen-jwt.mjs --self-test` 含篡改拒绝用例全绿；README 已写 |

**未能在本机执行的验收（需在装 Docker 的机器上补跑）**：`docker compose config`、`make up`、
`make migrate`、`make health`（`healthcheck.mjs` 探测七端点）、`baas_selfcheck()` SQL。
原因：本机无 docker / psql / deno，且 Docker Hub 出口不可达。

---

## 5. 优化轮（同日追加）

| 优化项 | 交付 | 验收 |
|---|---|---|
| 连接池 | compose `pooler` profile（Supavisor）+ 池安全约束 | verify 新增「迁移未使用 LISTEN/NOTIFY」与 POOL_MODE 报告；check-sql 拦截裸 SET |
| CI 流水线 | `.github/workflows/baas.yml`（verify 离线 job + runtime 冒烟 job） | workflow YAML 经 js-yaml 解析通过；verify 断言其调用了 verify.mjs |
| 多租户 | 迁移 `0009_multitenancy.sql`（行级、tenant_id 可空 → 向后兼容） | libpg_query 解析通过；现有策略全部重放并叠加租户条件 |
| 监控 + 配额 | `metrics/{prometheus,alert.rules,pg_exporter.queries}.yml` + 迁移 `0010_quotas.sql` | 6 条告警规则解析通过；rag-search 接入 within_quota/bump_usage（429） |
| Edge 隔离 | `docker-compose.hardened.yml`（L1）+ `docs/edge-isolation.md`（L1/L2/L3） | hardened YAML 解析通过；L2 需 KVM，故只给路径不内置编排 |

复验：`scripts/verify.mjs` **21/21 通过**；11 个 SQL 文件经 libpg_query 全量解析通过；
8 个 YAML/JSON 经 js-yaml / JSON.parse 通过。
