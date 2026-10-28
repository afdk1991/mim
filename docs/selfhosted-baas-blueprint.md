# 可完全自托管 BaaS 平台 · 架构方案与落地要点

> ⚠️ **本文是历史方案参考**，描述的是「自建一套类 Supabase BaaS 平台」的通用架构，
> **不代表 Mim 项目当前的后端实现**。
>
> Mim 当前后端是仓库内的 `server/`（Node 20 + `node:http` + `pg`，零框架），部署方式见
> [`deploy/README.md`](../../deploy/README.md)（宿主机直部署 + systemd 守护）。
>
> **本项目全程不使用 Docker**：下文涉及的容器化拓扑仅作原方案记录，不作为部署依据。

> 定位：对标 Supabase 的后端即服务平台，**全部组件可自建、无云端强依赖**。
> 设计原则：**Postgres 是唯一真相源**——权限在库内（RLS），身份是一张 JWT，
> 其余模块都是围绕这两个事实展开的无状态服务。
> 版本参照：2026-10（Postgres 17/18、PostgREST v14、pgvector 0.8.6、supabase/auth(gotrue) v2.19x、
> realtime v2.13x、storage-api v1.7x、edge-runtime v1.7x）。

---

## 1. 边界：做什么、不做什么

| 范围 | 内容 |
|---|---|
| ✅ 做 | Postgres 之上的 REST / GraphQL / Realtime / Storage / Auth / Vector / Functions 六项能力 + 统一网关 + 管理面 |
| ✅ 做 | 单租户单库形态（一个项目 = 一个库/一个 schema 集合），可水平复制出多项目 |
| ❌ 不做 | 多租户物理隔离（库/实例级租户）—— 那是控制面层的事，本方案只约定接口 |
| ❌ 不做 | 数据库分支（Branching）、连接池智能路由等云厂商增值能力 |
| ❌ 不做 | 自研存储引擎与自研 SQL 解析器（成本与收益不成比例） |

---

## 2. 总体架构

```
┌─ 客户端 SDK（Web / iOS / Android / Flutter）────────────────────┐
│  .from('posts').select() │ .channel() │ .storage.from() │ .functions.invoke() │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTPS / WSS
┌─────────── 统一网关（Envoy 或 Kong / Caddy / APISIX）───────────┐
│ /rest/v1/*  /graphql/v1  /auth/v1/*  /storage/v1/*              │
│ /realtime/v1/*  /functions/v1/*        ← 统一鉴权前缀 + 限流      │
└───┬───────┬───────┬────────┬────────────┬───────────┬───────────┘
    │       │       │        │            │           │
PostgREST  pg_graphql Auth   Storage-api  Realtime   Edge Runtime
 (REST)   (GraphQL) (gotrue)  (S3+元数据) (Elixir/WS) (Deno isolate)
    │       │       │        │            │           │
    └───────┴───────┴───┬────┴────────────┤           ├── 对象存储（部署包）
                        │                 │           │
              ┌─────────▼─────────────────▼──┐   ┌────▼──────────┐
              │  PostgreSQL 17/18（内核）     │   │ S3 兼容存储    │
              │ · auth schema（身份）         │   │ Garage/RustFS │
              │ · storage schema（元数据）     │   │ /SeaweedFS    │
              │ · public schema（业务+RLS）    │   └────┬──────────┘
              │ · extensions: pgvector,       │        │
              │   pg_graphql, pgcrypto,       │   ┌────▼──────────┐
              │   pg_cron, pg_net, postgis    │   │ CDN（Caddy）   │
              │ · logical replication (WAL)   │   │ + imgproxy    │
              └───────────────┬───────────────┘   └───────────────┘
                              │ WAL
                        Realtime 订阅解码
```

**一句话**：除 Edge Runtime 外，所有模块都只是「Postgres 的一种读取方式」，
差别只在于它们各自如何把 HTTP 请求翻译成 SQL、以及用哪个角色执行。

---

## 3. 技术选型总表

| 模块 | 首选 | 备选 | 许可 | 选它的理由 |
|---|---|---|---|---|
| REST API | PostgREST v14 | 自研（Go/Rust） | MIT | 零代码 CRUD，schema 即 API，事务内 `SET LOCAL` 天然兼容连接池 |
| GraphQL | pg_graphql（扩展） | Hasura / Graphile | PostgreSQL License | 库内解析，无 N+1（一次 SQL 出结果），不引入第二个服务 |
| Auth | supabase/auth(gotrue) v2 | Keycloak / Ory Kratos / Authelia | MIT/Apache | 与 PostgREST 的 JWT+RLS 模型原生咬合；自带 MFA/OAuth/魔法链接 |
| Realtime | supabase/realtime（Elixir） | 自研 Go + pglogrepl；Centrifugo | Apache-2.0 | WAL→WS 全链路已实现；自带 RLS 复算与 Presence/Broadcast |
| Storage | storage-api + S3 兼容后端 | SeaweedFS 自带网关 | MIT + 后端许可 | 元数据在 PG（RLS 统一鉴权），文件在 S3（容量无限） |
| 对象存储 | Garage / RustFS / SeaweedFS | MinIO（AGPL，见风险） | Apache-2.0 / LGPL | 许可友好、轻量、可单机起步 |
| Edge Functions | edge-runtime（Deno） | workerd / Spin(WASM) / Firecracker | MIT / Apache-2.0 | 与生态 SDK 契约一致；需要强隔离时换 microVM |
| Vector | pgvector 0.8.6 | Qdrant / Milvus（超 5000 万向量） | PostgreSQL License | 与业务行同库，天然享 RLS/事务/备份，省一套系统 |
| 网关 | Envoy（Supabase 现默认） | Kong / Caddy / APISIX | Apache-2.0 | 路径路由 + JWT 预校验 + 限流 |
| 连接池 | Supavisor / PgBouncer | 直连（小规格） | Apache-2.0 / ISC | 服务多副本下必须收敛连接数 |
| 管理面 | Studio + postgres-meta | 自研控制台 + meta API | Apache-2.0 | 表浏览/SQL 编辑器/策略编辑器 |

> 🟡 **待确认**：MinIO 采用 AGPLv3 且社区形态近年有调整（官方分发形态与功能范围变动），
> 商用前请自行复核许可与维护状态；本方案默认选 Apache-2.0 的 Garage/RustFS/SeaweedFS。

---

## 4. 各模块落地要点

### 4.1 Database（Postgres → REST + GraphQL + RLS）

**关键实现路径**

1. **角色体系**（一切权限的地基）

```sql
-- PostgREST 用 authenticator 登录，再在事务内 SET LOCAL ROLE 切换到请求角色
create role authenticator noinherit login password '***';
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls; -- 仅服务端，绝不下发客户端
grant anon, authenticated, service_role to authenticator;
```

2. **RLS 辅助函数**（`stable` + 固定 search_path，防止被劫持）

```sql
create schema if not exists auth;
create or replace function auth.uid() returns uuid
language sql stable set search_path = public, pg_temp
as $$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid $$;

create or replace function auth.role() returns text
language sql stable set search_path = public, pg_temp
as $$ select coalesce(current_setting('request.jwt.claims', true)::json->>'role','anon') $$;
```

3. **策略模板**（每张业务表必开）

```sql
alter table public.posts enable row level security;      -- 不 enable = 全表裸奔
alter table public.posts force row level security;       -- 连表主也要受策略约束
create policy posts_owner on public.posts
  for all to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
```

4. **GraphQL**：`create extension pg_graphql;` → 提供 SQL 函数 `graphql.resolve()`，
   由 PostgREST 以 RPC 暴露，网关把 `/graphql/v1` 转发过去；改 schema 后
   `comment on schema public is '@graphql';` 触发反射刷新。

5. **Schema 缓存**：PostgREST 有 schema cache，**建表/改函数后必须 reload**，
   否则报 `PGRST205`（表不存在）/ `PGRST202`（函数不存在）——
   表其实已经建好了。迁移流水线末尾固定加一句：

```sql
notify pgrst, 'reload schema';
```

6. **迁移管理**：`migrations/NNNN_*.sql` + `schema_migrations` 版本表，
   全部**幂等写法**（`create ... if not exists` / DO 块捕获 `duplicate_object` / `on conflict do nothing`），
   因为同一份 SQL 会在本地、CI、SQL Editor 三个通道各跑一次。

**MVP 边界**：单库 + PostgREST（REST）+ RLS + 版本化迁移 + 一键 reload schema。
GraphQL、只读副本、`pg_cron` 定时任务属于增强项。

---

### 4.2 Auth（邮箱密码 / 魔法链接 / OAuth）

**关键实现路径**

1. **信任根是 JWT**：Auth 签发，其余所有服务只做验签，不再互相调用。

| 项 | 建议 |
|---|---|
| 算法 | HS256 起步；对外/多服务建议 ES256 + JWKS（支持密钥轮换，网关/函数可本地验签） |
| access token | 1h，`sub`=user id、`role`=`authenticated`、`aud`、`exp` |
| refresh token | 存 `auth.refresh_tokens`，**轮换 + 复用检测**（旧 token 被重放 → 整族失效） |
| 匿名 | `role=anon` 的短 token，用于未登录读公开数据 |

2. **打通 RLS 的完整链路**

```
登录 → Auth 签 JWT → 客户端带 Bearer → 网关 → PostgREST 验签
   → set local request.jwt.claims = <payload>; set local role = authenticated
   → 本次事务内 RLS 策略用 auth.uid() 取到 sub → 行级过滤生效
```

3. **三种登录方式**

| 方式 | 要点 |
|---|---|
| 邮箱密码 | argon2id/bcrypt；注册后 `auth.users` 触发器 → `public.profiles` 自动建档；密码重置走一次性 token |
| 魔法链接 | 需要 SMTP；单次 token + 短有效期 + 一次性消费；注意防邮件枚举（响应恒等） |
| OAuth | OIDC/OAuth2 **PKCE**，state 校验；回调落在 `/auth/v1/callback`；身份写入 `auth.identities`（一个用户可绑多个 provider）；provider 的 client id/secret 集中配置 |

4. **安全基线**：登录/注册/重置接口限流；审计日志落 `auth.audit_log_entries`；
   **service_role key 禁止出现在任何前端产物**（构建后 grep 自检）。

**MVP 边界**：邮箱密码 + 刷新轮换 + JWT↔RLS 打通。魔法链接（要 SMTP）与 OAuth（要 provider 审批）排 P2。

---

### 4.3 Realtime（WAL → WebSocket）

**关键实现路径**

1. **数据变更链路**

```
Postgres wal_level=logical
  → create publication supabase_realtime for table <白名单表>
  → Realtime 建 replication slot，用 pgoutput/wal2json 解码
  → 按 topic（schema.table.filter）分发
  → 用订阅者 JWT 对该行做 RLS 复算（WAL 里没有权限信息！）
  → WebSocket 推送
```

2. **三种通道语义**

| 通道 | 是否落库 | 用途 | 一致性 |
|---|---|---|---|
| Postgres Changes | 是（走 WAL） | 数据变更订阅 | 最终一致 |
| Broadcast | 否（内存广播） | 聊天、协同光标、通知 | 不保证送达 |
| Presence | 否（内存状态） | 在线状态、谁在编辑 | CRDT 合并，断开自动清理 |

3. **🔴 最大的运维风险**：复制槽堆积。消费者掉线或消费慢 → WAL 持续保留 → **磁盘写满**。
   强制配套：`max_slot_wal_keep_size`（硬上限）+ 监控 `pg_replication_slots.restart_lsn` 滞后量 + 告警。
   另外**槽内表要白名单**，别把高频写入的大表放进 publication。

4. **自研替代**：Go + `pglogrepl` 解码 pgoutput，fanout 层用 Redis Streams；
   多节点时 Phoenix 集群/Redis 做跨节点广播。

**MVP 边界**：Postgres Changes（INSERT/UPDATE/DELETE）+ Broadcast。Presence 排 P2。

---

### 4.4 Storage（S3 兼容 + CDN）

**关键实现路径**

1. **元数据在 PG，字节在 S3**：`storage.buckets` / `storage.objects`，
   权限用 RLS 表达（按 bucket + 路径前缀），与业务表同一套权限模型。

```sql
create policy objects_owner on storage.objects
  for all to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
```

2. **上传流程**（两种，按文件大小选）

| 流程 | 路径 | 适用 |
|---|---|---|
| 签名直传 | API 签发短期凭证/预签名 URL → 客户端直传 S3 → 回调登记元数据 | 大文件、弱网 |
| 代理上传 | 客户端 → Storage API → S3 | 小文件、需服务端校验（MIME/尺寸/病毒扫描） |

3. **CDN**：对象存储前挂 Caddy/Nginx 缓存层；**私有桶绝不能裸缓存**——
   必须走预签名 URL（带过期）或 `secure_link`，并设置 `Cache-Control: private/no-store`。
   图片变换用 imgproxy（**必须开 URL 签名**，否则变成免费的图片处理机 + 放大攻击面）。

4. **一致性**：删除采用两阶段（标记删除 → GC 任务清理对象），
   并跑周期任务比对「对象清单 vs 元数据」清理孤儿对象。

**MVP 边界**：单桶/多桶 + 上传下载 + RLS 前缀隔离 + 公开桶 CDN。
图片变换、分片上传、跨区复制排后。

---

### 4.5 Edge Functions（Deno Serverless）

**现状提醒**：自托管 Edge Functions 官方标注为 **Beta**（会有 breaking change），
生产需固定版本号并做好回滚预案。

**关键实现路径**

1. **部署链路**：函数源码 → bundle（eszip/ESM）→ 存对象存储 → 运行时拉取热加载 →
   路由 `/functions/v1/<name>`。运行时= `Deno.serve` 语义，Web 标准 API。

2. **多租户隔离**：V8 isolate 是**进程内隔离，不是安全边界**。
   必须叠加：CPU/内存/墙钟限制、出站网络白名单（**防 SSRF**：禁内网段与云 metadata 地址）、
   每函数独立配额、Seccomp/容器边界。执行不可信代码 → 换 Firecracker microVM（冷启动约 0.8s）。

3. **冷启动**：Deno 冷启动在同类里偏慢（约百毫秒级）。优化面：预热 isolate 池、
   减少依赖体积、区域常驻；对延迟敏感路径改走常驻微服务。

4. **全球部署**

```
GeoDNS/Anycast → 就近区域 Edge Runtime
   读：区域内只读副本（延迟低）
   写：回源中心库（跨区延迟，需接受）
```

   设计建议：**Edge 函数只做编排与无状态逻辑**，写操作尽量收敛到中心或走队列。

5. **与 Auth 打通**：函数内用 JWKS 本地验签 JWT；慎用 service_role（会绕过 RLS），
   优先「用用户 JWT 直连 PostgREST」或「函数内显式校验 + 安全 definer RPC」。

**MVP 边界**：单区域单节点 edge-runtime + 函数打包部署 + JWT 校验中间件 + 资源限额。
多区域与强隔离排 P3。

---

### 4.6 Vector（pgvector · AI 场景）

**能力边界（0.8.x，务必按此做建模）**

| 类型 | 索引维度上限 | 字节/维 | 用途 |
|---|---|---|---|
| `vector` | 2,000 | 4 (FP32) | 通用 |
| `halfvec` | 4,000 | 2 (FP16) | 高维模型（>2000 维）唯一可行解 |
| `bit` | 64,000 | 1 | 二值量化 |
| `sparsevec` | 1,000 非零 | 8/非零 | SPLADE / 稀疏混合 |

**关键实现路径**

```sql
create extension if not exists vector;

create table documents (
  id bigserial primary key,
  owner uuid not null default auth.uid(),
  content text, metadata jsonb,
  embedding halfvec(1536)          -- 高维模型务必用 halfvec
);
alter table documents enable row level security;   -- 向量也要受 RLS 保护

-- 建索引：先灌数据、再 CONCURRENTLY 建，且调大工作内存
set maintenance_work_mem = '8GB';
set max_parallel_maintenance_workers = 7;
create index concurrently on documents
  using hnsw (embedding halfvec_cosine_ops) with (m = 16, ef_construction = 64);
```

- **过滤导致召回不足是头号坑**：近似索引是「先扫图、后过滤」，
  `ef_search=40` + 命中率 10% 的过滤条件 → 要 10 条只回 4 条。
  修法（0.8+）：`set local hnsw.iterative_scan = relaxed_order;` + 调 `hnsw.max_scan_tuples`。
  过滤值少 → 部分索引；过滤值多 → 分区。
- **检索入口封成 RPC**（`security definer` + 内部再按 owner 过滤，避免策略递归）：

```sql
create or replace function match_documents(q halfvec(1536), k int, threshold float)
returns table (id bigint, content text, score float)
language sql stable security definer set search_path = public as $$
  select id, content, 1 - (embedding <=> q) as score
  from documents
  where owner = auth.uid() and 1 - (embedding <=> q) > threshold
  order by embedding <=> q limit k
$$;
```

- **混合检索**：`tsvector` 全文 + 向量语义 → 结果用 RRF 融合；真 BM25 需 ParadeDB 等外部引擎。
- **Embedding 生成**：放 Edge Function（调模型 API）+ `pg_cron`/队列做批量回填，
  避免把耗时的外部调用塞进事务。
- **运维**：大量 re-embed 会造成 MVCC 膨胀（向量更新=整行重写），需针对性 autovacuum 调优；
  版本 ≥ 0.8.2（并行构建有 CVE-2026-3172 修复）。
- **容量线**：≤1000 万向量用 pgvector 最划算；>5000 万或要求 p99 极低 → Qdrant/Milvus。

**MVP 边界**：pgvector + 单表 + HNSW + `match_documents` RPC + RLS。混合检索、批量回填、重排排后。

---

## 5. 模块依赖与数据流

### 5.1 依赖矩阵（谁挂了会连累谁）

| 服务 | 依赖 PG | 依赖 Auth(JWT) | 依赖对象存储 | 挂掉后表现 |
|:---|:---:|:---:|:---:|---|
| PostgREST | ✅ | ✅（验签） | — | 全部 CRUD 不可用 |
| pg_graphql | ✅ | ✅ | — | GraphQL 不可用 |
| Auth | ✅ | — | — | 无法登录；**已签发 JWT 在有效期内仍可用** |
| Storage | ✅（元数据） | ✅ | ✅ | 上传下载不可用 |
| Realtime | ✅（WAL） | ✅ | — | 订阅断开；业务读写不受影响 |
| Edge Functions | 可选 | ✅（可选） | ✅（部署包） | 函数不可用 |
| Studio/meta | ✅ | — | — | 管理面不可用，业务无感 |

**关键结论**：PG 与 Auth 是「硬依赖」，其余模块是可独立降级的能力面。
因此 HA 优先保 PG 与 Auth，Realtime/Storage/Functions 可单副本起步。

### 5.2 三条主数据流

1. **请求流**：SDK → 网关（限流/路由）→ 各服务 → 统一以「某角色」在事务内执行 SQL → 返回。
2. **鉴权流**：Auth 签 JWT → 各服务验签 → `set local request.jwt.claims/role` → **RLS 在库内裁决**。
   （安全边界落在库内，任何服务被绕过都无法越权读行——这是整套架构最值钱的一点。）
3. **变更流**：PG WAL → Realtime 解码 → RLS 复算 → WebSocket 推送；
   旁路：Storage 写元数据 → 也可进 WAL 触发订阅。

### 5.3 全局硬约束（跨模块，必须一致）

- 所有服务共享**同一套 JWT 密钥/JWKS** 与同一组角色名（`anon`/`authenticated`/`service_role`）。
- `wal_level=logical` 是 Realtime 的前置条件（改它需要重启 PG）。
- 任何 DDL 后都要 `notify pgrst, 'reload schema'`，否则报「表/函数不存在」的假故障。

---

## 6. 自托管部署建议

### 6.1 三档拓扑

| 档位 | 组成 | 适用 | 最低规格 |
|---|---|---|---|
| **A 单机** | 单机：宿主机直接安装 PG + PostgREST + GoTrue + Realtime + Storage + 对象存储 + 网关 + Studio，各组件以 systemd 单元守护（原方案此行写的是 Compose 编排，本仓库不用容器） | 内部工具 / POC / 小项目 | 4C8G + 100G SSD |
| **B 单区生产** | PG 主备（Patroni）+ 连接池 + 各服务 ≥2 副本（无状态）+ 对象存储 3 节点 + LB + 监控 | 对外生产 | 库 8C32G；服务 各 2C4G×2 |
| **C 全球多区** | 中心写库 + 区域只读副本 + 区域 Realtime/Edge + GeoDNS + CDN | 跨洲用户 | 每区同 B 的只读层 |

### 6.2 连接池的坑（🔴 必读）

事务池化（PgBouncer/Supavisor transaction 模式）下：

- ✅ PostgREST 安全——它用**事务内** `set_config(..., true)`（等价 `SET LOCAL`），事务结束即失效。
- ❌ 裸 `SET`（非 LOCAL）会**跨请求残留** → 串号/越权读（RLS 正确也拦不住，因为 GUC 是别人设的）。
- ❌ `LISTEN/NOTIFY` 失效（会话级）→ Realtime **必须走逻辑复制，不能依赖 LISTEN**；
  确需通知的走独立 session 模式连接。
- ❌ 会话级咨询锁失效 → 一律用 `pg_advisory_xact_lock`。

### 6.3 生产配套清单

| 项 | 建议 |
|---|---|
| 备份 | pgBackRest / pg_basebackup + WAL 归档，**开启 PITR**；每季度做一次真实恢复演练 |
| 密钥 | Vault 或 SOPS 管理；JWT 支持 JWKS 双密钥轮换窗口 |
| 监控 | Prometheus + Grafana + postgres_exporter；`pg_stat_statements` 抓慢查询 |
| 告警 | 复制槽滞后、连接池耗尽、磁盘、WAL 归档断流、401/403 突增（越权探测信号） |
| 升级 | 固定各服务镜像 tag，先升灰度实例；`versions.md` 记录可回滚版本 |
| 迁移 | CI 应用 + 幂等 SQL + 末尾 `notify pgrst`；应用后跑一次结构自检（见 §7） |

---

## 7. MVP 范围与实现优先级

| 优先级 | 模块 | MVP 交付物 | 为什么是这个顺序 |
|:---:|---|---|---|
| **P0** | Database + Auth | PG 基线 + 角色/RLS + PostgREST + 邮箱密码登录 + 网关 + 迁移流水线 | **Auth↔RLS 是全部模块的安全地基**，没有它后面每个模块都要重新设计权限 |
| **P1** | Storage + Realtime + Vector | 桶/对象 + RLS 前缀隔离；WAL 变更订阅 + Broadcast；pgvector + match RPC | 覆盖 80% 应用需求，且三者都复用 P0 的权限模型，边际成本低 |
| **P2** | Auth 扩展 + GraphQL + Edge Functions | OAuth + 魔法链接 + Presence；pg_graphql；单区 Deno 函数 | 差异化能力；**Edge Functions 可先用普通微服务替代**，故不分到 P0 |
| **P3** | 规模化 | 多区域只读副本、混合检索、imgproxy、函数多区、配额与审计 | 有了用户量才有意义 |

**里程碑定义（可验收）**

- M1（P0 完成）：注册→登录→带 JWT 请求 REST→只能读到自己的行（RLS 生效）→未登录只读公开数据。
- M2（+P1）：上传私有文件并取回；订阅一张表的变更并在另一客户端收到；写入向量并用 RPC 检索。
- M3（+P2）：OAuth 登录可用；GraphQL 查询返回同 REST 一致的结果；函数部署并被调用。
- M4（+P3）：跨区读走本地副本；混合检索召回达标。

---

## 8. 风险登记表

| 严重度 | 风险 | 触发条件 | 对策 |
|:---:|---|---|---|
| 🔴 | service_role 泄露 | key 被打包进前端产物 | 构建后 grep 自检；网关禁止该 token 从外网进入；泄露即轮换 |
| 🔴 | RLS 漏开 / 写成 `using(true)` | 新表忘了 enable | 交付前跑：`select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity;` |
| 🔴 | 连接池 GUC 残留导致串号 | 事务池 + 非 LOCAL 的 SET | 全链路只用 `SET LOCAL`；代码评审禁用裸 `SET` |
| 🔴 | 复制槽撑爆磁盘 | Realtime 掉线/消费慢 | `max_slot_wal_keep_size` + 滞后告警；publication 白名单 |
| 🟡 | Schema cache 陈旧（PGRST205/202） | 迁移后未 reload | 迁移流水线末尾固定 `notify pgrst, 'reload schema'` |
| 🟡 | 对象存储许可风险 | 选用 AGPL 后端且对外商用 | 优先 Apache-2.0（Garage/RustFS/SeaweedFS）；商用前复核 |
| 🟡 | pgvector 内存与构建时间 | maintenance_work_mem 默认 64MB | 调大工作内存、并行构建、`CONCURRENTLY`；向量量级到千万时评估专用库 |
| 🟡 | Edge Runtime Beta + isolate 隔离弱 | 多租户/不可信代码 | 固定版本、加资源与出站限制；不可信代码改 microVM |
| 🟢 | CDN 缓存了私有文件 | 私有桶配了公共缓存 | 预签名 + `Cache-Control: private`；缓存键带签名 |
| 🟢 | 邮件枚举 | 魔法链接接口响应不一致 | 恒等响应 + 限流 |

---

## 9. 每模块的可验证信号（不要用"看起来能用"验收）

| 模块 | 验收动作 | 期望 |
|---|---|---|
| REST+RLS | 用 A 账号 curl 查 B 的数据 | 返回空数组（不是 403 也算通过，但需确认无泄漏） |
| Auth | 取 access token → 篡改签名 → 请求 | 401；过期 token → 401 |
| Realtime | 订阅后另起连接改一行 | WS 收到变更；无权限的行收不到 |
| Storage | 直传后不带 JWT 访问私有对象 | 403/404；带正确 JWT 200 |
| Functions | 调用函数但不带 JWT | 401；函数内访问内网 metadata 地址失败（SSRF 已封） |
| Vector | `match_documents` 用他人 owner | 结果集为空；`iterative_scan` 开启后过滤查询仍满 k 条 |

---

## 10. 待确认项（确认后再进入实施）

1. **目标规模与形态**：内部工具（单机）还是对外多租户平台（决定是否需要租户隔离层与配额）？
2. **数据属地**：是否需要国内机房/备案（影响对象存储、CDN、Edge 区域选型）？
3. **多租户粒度**：库级 / schema 级 / 行级（三条路线成本差异巨大）？
4. **对象存储许可**：是否接受 AGPL（MinIO）？
5. **Edge 运行时**：坚持 Deno，还是可接受 workerd/WASM 或 microVM？
6. **向量量级**：预估向量条数与维度（直接决定 pgvector 够不够用）。
