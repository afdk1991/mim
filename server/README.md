# Mim 自托管后端（server/）

Node 20 + 内置 `node:http` 实现的自托管后端，**唯一外部依赖是 `pg`**（不引入
express / fastify / jwt / bcrypt 等任何第三方库）。密码用 `crypto.scrypt` 加盐哈希，
令牌用 `crypto` 的 HMAC-SHA256 自签。

前端契约（路由、查询串参数、`{data}` / `{error:{code,message}}` 响应格式、错误码枚举）
严格按 `src/data/client.ts` 与 `src/core/result.ts` 实现，**本目录不得改写前端契约**。

```
server/
  package.json            依赖只有 pg
  Dockerfile              node:20-alpine
  docker-compose.yml      postgres:16 + api（+ 一次性 migrate 任务）
  .env.example
  db/migrations/
    0001_iam.sql           users/profiles/app_users/roles/permissions/user_roles/
                           role_permissions/audit_logs/token_revocations（+ 角色种子）
    0002_content.sql       posts/post_comments/articles/article_comments/snippets/
                           follows/favorites/messages/notifications/post_drafts/article_drafts
    0003_commerce.sql      products/mall_orders/wallet_balances/wallet_txs
    0004_business.sql      seckill_sessions/seckill_locks/local_merchants/local_vouchers/
                           local_voucher_codes/live_rooms/live_shelf/travel_tickets/
                           travel_date_stock/travel_rules
    0005_growth.sql        growth_rules/growth_events/growth_checkins/growth_badges（+ 规则种子）
  scripts/migrate.js       迁移执行器（记录于 schema_migrations，幂等）
  scripts/promote-admin.js 命令行授予首个管理员
  src/
    main.js    HTTP 入口 / CORS / 路由分发
    db.js      pg 连接池、类型解析、事务包装
    auth.js    注册 / 登录 / 登出 / 令牌签发与吊销 / 角色权限装载
    rest.js    /api/rest/:table 通用 CRUD（表与列白名单 + 归属校验）
    rpc.js     /api/rpc/:fn 服务端过程（库存 / 券码 / 钱包 / 订单 / 成长）
    storage.js 对象存储（本地磁盘）与回读
    errors.js  ErrCode ↔ HTTP 状态码映射
```

## 一、启动

### A. 本机（已有 PostgreSQL 16）

```bash
cd server
npm install
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/mim
npm run migrate        # 应用 db/migrations/*.sql（幂等，可重复执行）
npm run dev            # 默认监听 8787
```

健康检查：

```bash
curl http://127.0.0.1:8787/api/health
# {"data":{"ok":true,"db":true,"service":"mim-server","uptime_ms":…,"rpcs":16}}
# 仓库根目录另有 npm run server:health（scripts/server-health.mjs），
# 会真实探测 /api/health 与 /api/rest/products?limit=1 并打印结果
```

前端 `vite.config.ts` 已把 `/api`、`/auth`、`/storage` 代理到 `http://127.0.0.1:8787`，
所以 `npm run dev`（前端）只需后端在跑即可，无需处理跨域。

### B. Docker

```bash
cd server
docker compose up -d db            # 先起库并等待 healthy
docker compose run --rm migrate    # 应用迁移（一次性任务）
docker compose up -d api           # 起后端 → http://127.0.0.1:8787/api/health
```

## 二、环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATABASE_URL` | `postgres://postgres:postgres@127.0.0.1:5432/mim` | 连接串 |
| `JWT_SECRET` | 开发用常量（启动时告警） | **生产必须替换**（`openssl rand -hex 32`） |
| `TOKEN_TTL_MS` | `604800000`（7 天） | 令牌有效期 |
| `PG_POOL_MAX` | `10` | 连接池上限 |
| `SECKILL_LOCK_MS` | `900000`（15 分钟） | 秒杀锁库存时长，与前端 `LIMITS.seckillLockMs` 一致 |
| `VOUCHER_MAX_DAYS` | `90` | 券码最长有效期，与前端 `LIMITS.voucherMaxDays` 一致 |
| `UPLOAD_DIR` | `./data/uploads` | 对象存储落盘目录 |
| `UPLOAD_MAX_BYTES` | `3145728`（3MB） | 单文件上限，与前端 `LIMITS.uploadMaxBytes` 一致 |
| `PUBLIC_API_BASE` | 空 | 有网关/CDN 时填公网地址，决定 `/api/storage/<key>` 返回的 `url` 是否绝对 |
| `BOOTSTRAP_ADMIN_USERNAME` | 空 | 全新库首个管理员账号名（见「管理员」一节） |
| `MAX_BODY_BYTES` | `12582912` | 请求体上限（base64 上传会放大约 1.33 倍） |

## 三、路由契约

所有响应成功为 `{data: …}`（**仅此一个键**，前端按此解包），
失败为 `{error:{code,message}}` 且 code 取自前端 `ErrCode`：

| HTTP | code | 典型场景 |
| --- | --- | --- |
| 400 | `bad_request` | 参数非法、status/biz_kind 取值非法 |
| 400 | `schema` | 表未开放/未迁移、列不存在（文案刻意与 PostgREST 一致，前端据此做缺列降级） |
| 401 | `no_auth` | 未登录 / 令牌失效 / 已登出 |
| 403 | `forbidden` | 非管理员、操作他人数据 |
| 404 | `not_found` | 资源不存在（含「他人的保密内容」） |
| 409 | `conflict` | 重复注册、库存不足、重复核销、重复退票、余额不足 |
| 503 | `busy` | 并发冲突（死锁/序列化失败） |
| 500 | `server` | 未预期异常（原始错误只进日志，不下发给前端） |

CORS 全开：`*` + `Authorization`/`X-Mim-Token`/`Content-Type` + OPTIONS 预检。

```
GET    /api/health                     → {ok,db,service,uptime_ms,rpcs}
POST   /api/auth/register              {username,password} → {token,user}
POST   /api/auth/login                 {username,password} → {token,user}
POST   /api/auth/logout                吊销当前令牌（按 jti 落 token_revocations）
GET    /api/auth/me                    → {id,username,name,emoji,roles,permissions}
GET    /api/rest/:table                 select / eq=col.val（可重复）/ order=col.asc|desc / limit / offset
GET    /api/rest/:table/:id
POST   /api/rest/:table                返回整行（写操作强制注入 owner）
PATCH  /api/rest/:table/:id
DELETE /api/rest/:table/:id
POST   /api/rpc/:fn                    服务端过程（全部需登录）
POST   /api/storage/upload             {name,mime,body(base64)} → {key,url,size}
GET    /api/storage/<key>              回读对象（含 Content-Type 与长缓存）
```

### REST 白名单与安全模型

- **表白名单**：`src/rest.js` 的 `TABLES`。`users`（含 `password_hash`）
  **永不在白名单**，公开资料一律走 `profiles`。
- **列白名单**：列名由 `information_schema` 实时核定，未知列返回
  `Could not find the 'x' column of 'y'` + `code='schema'`，前端 `writeWithFallback`
  会自动剔除该列重试（缺列降级的旧行为保持不变）。
- **归属**：写操作强制注入/过滤 owner 列（客户端传的 owner 值一律忽略）；
  更新/删除命中 0 行时区分「不存在」(404) 与「存在但不是你的」(403)。
- 读策略：`public`（匿名可读）/ `owner`（仅本人）/ `admin`（仅管理员）；
  `posts` 的 `visibility='self'` 行对所有人（含管理员）隐藏，仅作者可见。

## 四、服务端过程（/api/rpc/:fn）

### 库存与履约

- `seckill_grab(p_session_id, p_qty, p_order_id)` → `{session_id, remaining, qty, expire_at}`
  防超卖三件套在同一事务内完成：① `SELECT … FOR UPDATE` 场次行锁 串行化并发；
  ② `UPDATE … WHERE remaining >= p_qty` 条件更新 库存不足即失败；
  ③ `seckill_locks(session_id, user_id)` 主键唯一约束兜底限购。
  场次不存在/未开始/已结束/已关闭 → 对应 404/409；超限购 → 409。
- `seckill_release(p_session_id, p_order_id)` → `{released}`，幂等（无锁返回 0）。
- `travel_book(p_ticket_id, p_date, p_qty, p_order_id)` → `{remaining}`，
  按 `(ticket_id, date)` 行锁 + 条件更新；同时把本人订单置 `pending_ticket`。
- `travel_release(p_ticket_id, p_date, p_qty, p_order_id)` → `{released, remaining}`，
  仅本人且未支付订单可释放。
- `travel_refund(p_order_id)` → `{amount_fen, fee_fen, refund_fen, credited_fen, restored}`
  防重复退四道闸：非出行单 / 已 `refunding`·`refunded` / 非 `ticketed` / 不可退。
  手续费取 `ceil(amount_fen * fee_rate)`（不可退时全额手续费），实退
  `greatest(0, amount - fee)`；规则优先用下单时快照 `ext.rule`，运营事后改规则不影响已成交订单。
  **退款闭环**：实退金额以 `income` 流水入账钱包（与状态转移同事务，并按
  `snapshot->>'refund_order_id'` 去重，重复退不会重复入账）；同一事务内回滚日期库存，
  订单置 `refunded`。

### 本地生活券码

- `issue_voucher_code(p_order_id, p_voucher_id)` → `{code, expire_at, reused}`
  **服务端发码**（前端禁止构造），幂等（同订单返回原码并置 `reused=true`），
  未支付订单拒绝（409），有效期 `least(voucher.valid_until, now + 90 天)`，
  发码后回填 `mall_orders.ext.voucherCode` 并把 `biz_status` 置 `pending_verify`。
- `verify_voucher(p_code)` → `{code, order_id, used_at}`，**仅管理员**。
  一次性转移：`UPDATE … WHERE status='unused'`，重复核销必然 409；过期即置 `expired` 并拒绝。

### 钱包（余额一律服务端计算）

- `wallet_state()` → `{balance_fen, plan, txns[]}`（最近 50 条流水）。
- `wallet_debit(p_fen, p_note)` → `{balance_fen}`，条件更新原子扣款，余额不足 → 409。
- `wallet_credit(p_fen, p_note, p_kind)` → `{balance_fen}`，`p_kind` 仅 `recharge|income`。

### 订单 / 私信 / 管理员 / 成长

- `mall_upsert_order(p_order)`：字段
  `id, goods_id, title, emoji, amount_fen, qty, channel, status, pay_channel, proof, biz_kind, ext, biz_status`。
  **金额列是 `amount_fen`（分，整数）**——历史库的 `amount`（元）曾导致退票金额错位 100 倍，
  重建已彻底消除，不存在任何「元」金额列。
  流程：`SELECT … FOR UPDATE` 锁订单行 → 他人订单直接 403 → 存在则更新、不存在则插入，
  `user_id` 恒为令牌 uid；`status`/`biz_kind` 取值白名单校验，非法即 400。
- `send_message(p_peer, p_content)`：收发双方各持一份副本（owner 列即收件人），
  读取天然按会话隔离。
- `bootstrap_admin()`：库里已有管理员 → 409；否则把调用者设为 admin 并记录审计。
- `growth_record(p_action, p_quality)` / `growth_checkin()` / `growth_state()`：
  服务端校时与日上限、质量门、连击计算均在服务端，客户端改时钟伪造无效。

## 五、管理员

全新库没有任何管理员时的两个官方出口（都是一次性）：

1. `BOOTSTRAP_ADMIN_USERNAME=<username>` 后该账号下次登录/`me` 时自动获 admin；
2. `node scripts/promote-admin.js <username|userId>`（已有管理员时脚本拒绝执行）。
   > 注意：前端 `src/app/admin-gate.tsx` 的「成为首个管理员」按钮用裸 `fetch('/api/rpc/bootstrap_admin')`
   > **不带 Authorization 头**，因此服务端会返回 401。这是前端侧缺陷（本目录不改 `src/`），
   > 需用上面两个出口之一替代。

## 六、常见问题

- **`relation "xxx" does not exist` / `表 xxx 不存在`**：没跑迁移。在 `server` 目录执行 `npm run migrate`。
- **health 里 `db:false`**：`/api/health` 本身仍返回 200，表示进程活着但连不上库——
  检查 `DATABASE_URL`（Docker 内 hostname 是 `db`，不是 `127.0.0.1`）。
- **未知列报 `schema`**：线上表结构比迁移旧/新。确认迁移跑全后重启服务
  （列名缓存在进程内，迁移后需重启以刷新 `describe()` 缓存）。
- **`启动了但立刻退出`**：Windows 下 `import.meta.url` 与 `process.argv[1]` 路径格式不同，
  main.js 已按 `fileURLToPath` 处理；若自行改入口请注意这一点。
- **上传 400（超过 3MB）**：与前端 `LIMITS.uploadMaxBytes` 对齐，需要放大就同时改
  `UPLOAD_MAX_BYTES` 与前端常量。
- **登出后令牌仍可用？** 不会：令牌带 `jti`，登出写入 `token_revocations`，
  每次鉴权都会查一次吊销表。

## 七、不做的事（有意保留）

- 不预置任何演示商品、种子订单或假数据——空库就是空态，由运营/用户上架。
- 不实现支付回调（微信/支付宝商户号未到位前保持 `pay_channel` 透传）。
- 不在数据库层再写 plpgsql 函数：所有并发裁定集中在 `src/rpc.js`，便于阅读与测试。
