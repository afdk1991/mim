# 自托管 BaaS（Database / Auth / Realtime / Storage / Edge Functions / Vector）

对标 Supabase 的**可完全自托管**后端即服务平台：以 Postgres 为唯一真相源，
其余模块都只是「Postgres 的一种读取方式」，权限统一落在库内 RLS。

架构方案（选型论证、数据流、风险清单）见 [`../docs/selfhosted-baas-blueprint.md`](../docs/selfhosted-baas-blueprint.md)，
本目录是它的可运行落地物；分步计划与验收标准见 [`docs/implementation-plan.md`](docs/implementation-plan.md)。

---

## 1. 组件矩阵

| 能力 | 组件 | 容器内端口 | 对外路径 |
|---|---|---|---|
| 数据库 | Postgres（supabase/postgres） | 5432 | — |
| REST | PostgREST | 3000 | `/rest/v1` |
| GraphQL | pg_graphql（经 PostgREST RPC 桥接） | 3000 | `/graphql/v1` |
| Auth | gotrue（supabase/auth） | 9999 | `/auth/v1` |
| Realtime | supabase/realtime | 4000 | `/realtime/v1` |
| Storage | storage-api（+ imgproxy） | 5000 / 5001 | `/storage/v1` |
| Edge Functions | edge-runtime（Deno） | 8081 | `/functions/v1` |
| Vector | pgvector（库内扩展） | — | `/rest/v1/rpc/match_chunks` |
| 管理面 | postgres-meta（+ 可选 studio） | 8080 | `/pg/meta` |
| 网关 | Envoy | 8000 | 全部入口 |

---

## 2. 五分钟起栈

```bash
cd baas
cp .env.example .env
# 1) 至少改掉标了【必改】的项：POSTGRES_PASSWORD / JWT_SECRET / SITE_URL
# 2) 生成两个 JWT 并写入 .env（含签发-验签自检）
node scripts/gen-jwt.mjs --self-test --write      # 或 make keys

make pull          # 拉镜像（首次必做；tag 变更见 §8）
make up            # docker compose up -d
make migrate       # 应用 db/migrations（幂等，结束后自动刷新 PostgREST schema cache）
make storage-init  # 建 avatars / documents 两个 bucket
make health         # 运行时健康探测
```

离线自检（不需要 Docker，随时可跑）：

```bash
node scripts/verify.mjs        # shell 语法 + SQL 体检 + 编排一致性 + 函数类型检查（16 项）
node scripts/check-sql.mjs    # 只看 SQL
```

---

## 3. 三条核心数据流

1. **鉴权流**：`Auth 签 JWT（role/sub）→ PostgREST 在事务内 set_config('request.jwt.claims', …, true)
   → 切换 PG 角色 → RLS 在库内裁决`。**RLS 是唯一安全边界**，REST / GraphQL / Realtime / Storage 共用这一条。
2. **变更流**：Postgres WAL → 逻辑复制槽 → Realtime → WebSocket。变更行的可见性由 RLS **在库内复算**，
   不信任客户端传来的任何身份声明。
3. **检索流**：Edge Function → 向量化 → `match_chunks` / `hybrid_search` RPC → 结果同样受文档 RLS 裁剪。

---

## 4. 接入示例（curl）

```bash
B=http://localhost:8000
A=$(grep '^ANON_KEY=' .env | cut -d= -f2-)
S=$(grep '^SERVICE_ROLE_KEY=' .env | cut -d= -f2-)

# 注册（邮箱密码）
curl -X POST "$B/auth/v1/signup" -H "apikey: $A" -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com","password":"pass1234"}'
# 取回 access_token 后：
# 魔法链接：POST /auth/v1/magiclink {"email": "..."}
# OAuth：浏览器打开 $B/auth/v1/authorize?provider=github

# REST（RLS 生效，只看到自己的 todos）
curl "$B/rest/v1/todos?select=*" -H "apikey: $A" -H "Authorization: Bearer <user_jwt>"

# GraphQL
curl -X POST "$B/graphql/v1" -H "apikey: $A" -H "Authorization: Bearer <user_jwt>" \
  -H 'Content-Type: application/json' -d '{"query":"{ todosCollection { edges { node { id title } } } }"}'

# Realtime（WS）：wss://<host>/realtime/v1/websocket?apikey=<user_jwt>&vsn=1.0.0
#   topic: realtime:public:todos    变更订阅
#   Presence / Broadcast：同 topic，客户端直接 send，无需服务端表

# Storage 上传（avatars 桶，仅本人可写）
curl -X POST "$B/storage/v1/object/avatars/me.png" -H "Authorization: Bearer <user_jwt>" \
  -H "apikey: $A" -F file=@me.png
# 数据库侧记录引用：POST /rest/v1/file_refs

# Vector 检索
curl -X POST "$B/rest/v1/rpc/match_chunks" -H "apikey: $A" -H "Content-Type: application/json" \
  -d '{"query_embedding":"[0.01,0.02,...]","match_count":8}'
# 混合检索：rpc/hybrid_search {"query_text":"...","query_embedding":"[...]"}

# Edge Functions
curl "$B/functions/v1/hello"
curl -X POST "$B/functions/v1/rag-search" -H 'Content-Type: application/json' -d '{"query":"运费怎么算"}'

# 库内自检
bash scripts/db-psql.sh -c "select * from public.baas_selfcheck();"
```

---

## 5. 最小可用范围与优先级

| 优先级 | 内容 | 交付判定 |
|---|---|---|
| **P0** | Database（REST + RLS）+ Auth（邮箱密码） | `make health` 中 auth/rest 均 2xx；注册登录后只能看见自己的 todos |
| **P1** | Storage（本地后端）+ Realtime（变更订阅）+ Vector（match_chunks） | 上传可下载、订阅能收到变更、RPC 返回结果 |
| **P2** | 魔法链接 + OAuth、GraphQL、Edge Functions | 本文 §4 全部示例可用 |
| **P3** | S3/MinIO 后端、imgproxy + CDN、多区域只读副本、配额与审计 | 按需 |

---

## 6. 运维手册（必读，都是会真出事故的项）

| 风险 | 等级 | 处置 |
|---|---|---|
| **裸 `SET` 跨请求残留**（事务连接池下）导致串号越权 | 🔴 | 全链路只用 `SET LOCAL` / `set_config(..., true)`；`check-sql.mjs` 静态拦截裸 `SET` |
| **RLS 漏开**：public 表对 API 裸奔 | 🔴 | 交付前 `select * from public.rls_missing;` 必须为空；`baas_selfcheck()` 也会报 |
| **复制槽堆积**：Realtime 断连后 WAL 无限保留撑爆磁盘 | 🔴 | 已设 `max_slot_wal_keep_size`；`baas_selfcheck()` 监控滞后（>512MB 告警）；publication 只放白名单表 |
| **PostgREST schema cache 未刷新**：新表报“不存在”假故障 | 🟡 | 迁移后 `make reload`（`notify pgrst, 'reload schema'`），`make migrate` 已自动带上 |
| **service_role key 泄漏**：该 key 绕过 RLS | 🔴 | 只允许服务端使用，绝不进浏览器产物；轮换时改 `JWT_SECRET` 后重新 `make keys` |
| **向量维度不一致**：`EMBEDDING_DIM` 与 `vector(N)` 不符 | 🟡 | 改维度需同步 `.env` 与 `0006_vector.sql`；>2000 维改用 `halfvec` |

备份：`make backup`（`pg_dump | gzip` 到 `backups/`）；恢复 `gunzip -c <file> | docker compose exec -T db psql -U postgres`。

---

## 7. 扩展矩阵

| 扩展 | 用途 | 缺失后果 |
|---|---|---|
| pgcrypto / uuid-ossp | `gen_random_uuid()`、加密 | 必装，缺失则迁移失败 |
| vector（pgvector） | 向量检索 | `0006` 自动跳过向量列，检索不可用 |
| pg_graphql | GraphQL | `/graphql/v1` 返回明确错误提示 |
| pgjwt / pg_stat_statements | 库内签 JWT / SQL 统计 | 可选 |

未安装时 `db/init/00_bootstrap_roles.sql` 只告警不阻断，栈照样能起来。

---

## 8. 镜像版本与已知偏差

- 所有镜像 tag 集中在 `.env`（`POSTGRES_IMAGE` 等）。**首次启动前建议 `make pull` 确认 tag 存在**；
  若某个 tag 已下架，改 `.env` 即可，编排文件无需改动。
- 编写环境无外网，tag 未经实时核对 —— 这是本目录唯一需要你确认的外部依赖点。
- **两处刻意的方案偏离**（详见 `docs/implementation-plan.md` §0）：
  1. GraphQL 走 PostgREST RPC 桥接（`public.graphql`），而非直接暴露原生端点；
  2. Storage 默认本地文件后端，S3 通过 `--profile s3` + `STORAGE_BACKEND=s3` 切换。

---

## 9. 连接池（可选，高并发必开）

```bash
make up-pooler          # docker compose --profile pooler up -d
# 然后把 rest 的 PGRST_DB_URI 指向 supavisor:6543
```

事务模式（`POOL_MODE=transaction`）下的硬性约束：

- 会话级 GUC 一律改用 `SET LOCAL` / `set_config(..., true)`（裸 `SET` 会跨请求残留 → **串号越权**）
- 禁止依赖 `LISTEN/NOTIFY`（Realtime 走逻辑复制，不依赖它）
- 禁止会话级 advisory lock、临时表、预处理语句跨请求复用

`scripts/check-sql.mjs` 静态拦截裸 `SET`；`scripts/verify.mjs` 校验迁移里没有 LISTEN/NOTIFY。

## 10. 多租户（可选，行级，向后兼容）

`db/migrations/0009_multitenancy.sql` 提供 `tenants` / `tenant_members` / `current_tenant()`，
并给业务表加上可空 `tenant_id`：**为 NULL 时行为与单租户完全一致**，因此启用与否都不影响既有部署。

| 粒度 | 隔离 | 成本 | 适用 |
|---|---|---|---|
| 库级 | 最强 | 最高（N 套实例/备份/迁移） | 租户 < 50、合规硬要求 |
| schema 级 | 强 | 中（迁移要按 schema 重放） | 几十~几百租户 |
| **行级（已实现）** | 依赖 RLS 正确性 | 最低（一套迁移） | 百~万级租户 |

使用：登录后 `rpc/create_tenant {"name":"acme"}` → JWT 中带上 `tenant_id` claim →
所有带 `tenant_id` 的行自动按成员关系隔离。

## 11. 用量配额

`db/migrations/0010_quotas.sql`：`bump_usage()` 计数、`within_quota()` 判定（limit ≤ 0 表示不限）。
`functions/rag-search` 已接入（超限返回 429，配额变量 `QUOTA_RPC_PER_HOUR`）。
网关层令牌桶与这里互补：前者挡瞬时洪峰，后者管业务量。

## 12. 可观测性（--profile metrics）

`postgres_exporter` + `prometheus`：开箱带三条 Realtime 高危告警（复制槽滞后 > 512MB、
复制槽无消费端、`max_slot_wal_keep_size` 未限制）与三条 PG 告警（宕机、连接数 > 80%、长事务 > 1h）。

```bash
make up-metrics   # Prometheus: http://localhost:9090 ，告警页 /alerts
```

需要通知渠道再加 Alertmanager；需要磁盘水位告警再加 node-exporter（WAL 堆积最终表现为磁盘耗尽）。

## 13. Edge Functions 隔离

分三档，详见 [`docs/edge-isolation.md`](docs/edge-isolation.md)：

- **L1 容器级（默认提供）**：`make up-hardened` → `cap_drop: ALL`、`no-new-privileges`、
  只读根 + tmpfs、PID/内存/CPU 上限、非 root
- **L2 microVM（Firecracker）**：需宿主机支持 KVM，本仓库**不内置**——在无法确认 KVM 的场景
  给出编排只会得到一个启动即失败的栈，路径与前提写在文档里
- **L3 gVisor/seccomp**：折中方案

## 14. CI

`.github/workflows/baas.yml`：

- job `verify`（离线）：`scripts/verify.mjs` 全部 21 项 + JWT 签发验签自检
- job `runtime`（真起栈）：`make up` → `migrate` → `storage-init` → `healthcheck` → `baas_selfcheck()`，
  失败时自动收集容器日志

## 15. 目录结构

```
baas/
├── docker-compose.yml        # 编排（profile: s3 / studio / pooler / metrics）
├── docker-compose.hardened.yml  # 加固覆盖层（cap_drop / 只读根 / 资源上限）
├── envoy/envoy.yaml          # 网关路由（七类流量 + WebSocket upgrade）
├── Makefile                  # 常用操作封装
├── .env.example              # 全部配置（含镜像 tag）
├── metrics/                  # prometheus.yml / alert.rules.yml / pg_exporter.queries.yml
├── db/
│   ├── init/                 # 容器首次启动执行（角色 / 扩展 / 授权，幂等）
│   └── migrations/           # 0001~0008，按序、幂等、有记录
├── scripts/
│   ├── db-psql.sh            # 在容器内执行 psql（宿主机无需装 psql）
│   ├── migrate.sh            # 迁移（单事务 + 记录 + 自动 reload schema cache）
│   ├── reload-postgrest.sh / new-migration.sh / init-storage.sh
│   ├── check-sql.mjs         # SQL 静态体检（裸 SET / RLS 漏开 / dollar-quote）
│   ├── gen-jwt.mjs           # 生成 anon/service JWT 并自验签
│   ├── healthcheck.mjs       # 运行时七端点探测
│   └── verify.mjs            # 一键体检总入口
├── functions/                # Deno 函数：main 路由 + hello / embed / rag-search
└── docs/                     # implementation-plan.md（含验收回填）/ edge-isolation.md
```

## 16. 优化项状态

| 优化项 | 状态 | 交付物 |
|---|---|---|
| 连接池（Supavisor） | ✅ | compose `pooler` profile + 池安全校验（裸 SET / LISTEN 拦截） |
| CI 集成 | ✅ | `.github/workflows/baas.yml`（离线 verify + 运行时冒烟） |
| 多租户 | ✅ 行级、向后兼容 | `0009_multitenancy.sql` + 三粒度对比文档 |
| 监控告警 + 配额 | ✅ | `metrics/*` + `0010_quotas.sql` + rag-search 接入 429 |
| Edge 强隔离 | ⚠️ 部分 | L1 加固已落地；L2（Firecracker microVM）需 KVM，仅提供路径文档 |
