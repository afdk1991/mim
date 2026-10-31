# API 规范（表驱动 REST + RPC 双通道）

| 项 | 值 |
| --- | --- |
| 规范版本 | v1.0 |
| 状态 | 已冻结（CTO 批准） |
| 负责人 | BA（后端工程师 A · 业务域 + 架构） |
| 冻结日期 | 2026-10-30 |
| 适用代码基线 | `server/src/main.js`、`server/src/rest.js`、`server/src/rpc.js`、`server/src/auth.js` |
| 配套文档 | `docs/specs/统一错误码规范.md`、`docs/specs/账号与权限模型.md`、`docs/specs/埋点与数据口径规范.md` |

> 本文件的所有事实均以当前代码为准。凡代码尚未实现的能力，一律标注「建议 / Phase 2」，不描述为既成事实。
> 引用格式为 `文件:行号`，便于核对。

---

## 1. 设计前提：这不是标准 RESTful

本项目后端是 **自托管 Node 20 + `node:http` + PostgreSQL，零 Web 框架，唯一外部依赖 `pg`**（`server/src/main.js:1-27`）。接口形态因此不是「资源嵌套 + 动词语义」的经典 REST，而是**表驱动 REST + RPC 双通道**：

| 通道 | 路径 | 语义 | 适用 |
| --- | --- | --- | --- |
| 表通道（REST） | `/api/rest/:table[/:id]` | 对白名单表做 GET / POST / PATCH / DELETE | 结构简单、无跨表事务的 CRUD |
| 过程通道（RPC） | `/api/rpc/:name` | 调用服务端命名过程，参数以 `p_` 前缀传入 | 涉库存、余额、券码、状态机、幂等的原子操作 |

**为什么必须有 RPC 通道**（`server/src/rpc.js:1-13`）：

1. 库存：read-modify-write 在并发下必然超卖，扣减必须是同一事务内 `SELECT … FOR UPDATE` + 条件更新 `UPDATE … WHERE remaining >= qty`。
2. 券码：发码必须服务端构造（前端造码等于可伪造核销凭证），核销必须是 `WHERE status='unused'` 的一次性状态转移。
3. 钱包：余额必须服务端计算并原子增减（客户端传余额等于可任意改余额）。

**不存在的东西**（明确排除，禁止在文档或联调中假想）：

- 没有资源嵌套路径（无 `/users/:id/posts`）。路径最多两段，第三段直接 `bad_request`（`server/src/main.js:200`）。
- 没有 `/v1` 前缀、没有版本协商头（见 §3）。
- 没有批量接口、没有 `PATCH` 数组、没有 `upsert` 语义（唯一例外是 `profiles` 的 `write:'self'` upsert 与 `mall_upsert_order`）。
- 没有 `in`/`like`/`gt`/`lt`/`or` 等过滤算子，只有等值过滤（见 §5）。

---

## 2. 端点总览

| 方法 | 路径 | 鉴权 | 成功状态 | 说明 | 代码位置 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/health`、`/api/healthz` | 无 | 200 | 返回 `{ ok, db, service, uptime_ms, rpcs }` | `server/src/main.js:98` |
| GET | `/api/hello` | 无 | 200 | 无鉴权回声探针 | `server/src/main.js:101-103` |
| POST | `/api/auth/register` | 无 | 201 | 注册并签发令牌 | `server/src/main.js:106-109` |
| POST | `/api/auth/login` | 无 | 200 | 登录并签发令牌 | `server/src/main.js:110` |
| POST | `/api/auth/logout` | 可选 | 200 | 按 `jti` 吊销当前令牌 | `server/src/main.js:111-115` |
| GET | `/api/auth/me` | 必须 | 200 | 返回 `{ id, username, name, emoji, roles, permissions }` | `server/src/main.js:116-119` |
| POST | `/api/storage/upload` | 必须 | 201 | 对象上传 | `server/src/main.js:122-126` |
| GET | `/api/storage/:key` | 无 | 200 | 对象回读（SVG 强制 CSP + nosniff） | `server/src/main.js:127-146` |
| GET | `/api/sync/posts` | `X-Sync-Token` | 200 | 只读增量同步，无写能力 | `server/src/main.js:149-152` |
| POST | `/api/iot/hook/auth|acl|event` | `x-iot-hook-token` | 200 | EMQX 钩子，响应契约为 `{ result }`，**不走** `{ data }` 包装 | `server/src/main.js:157-168` |
| POST | `/api/iot/uplink` | `x-iot-hook-token` | 200 | 设备上行回执 | `server/src/main.js:169-172` |
| POST | `/api/iot/devices/:id/command` | 必须 | 201 | App 下发指令 | `server/src/main.js:175-178` |
| GET | `/api/iot/devices/:id/command/:cmdId` | 必须 | 200 | 指令状态轮询 | `server/src/main.js:179-182` |
| POST（GET 亦可） | `/api/rpc/:name` | 必须 | 200 | 调用过程；GET 时参数取自查询串 | `server/src/main.js:187-193` |
| GET | `/api/rest/:table` | 匿名可读（限 public 表） | 200 | 列表 | `server/src/main.js:202-211` |
| GET | `/api/rest/:table/:id` | 必须 | 200 | 单条 | `server/src/main.js:214` |
| POST | `/api/rest/:table` | 必须 | 201 | 插入 | `server/src/main.js:215` |
| PATCH | `/api/rest/:table/:id` | 必须 | 200 | 局部更新 | `server/src/main.js:216` |
| DELETE | `/api/rest/:table/:id` | 必须 | 200 | 删除，返回 `true` | `server/src/main.js:217` |

任何非 `/api` 前缀的路径统一返回 `404 / not_found`（`server/src/main.js:92-94`）。

---

## 3. 版本策略

| 项 | 现状 | 建议（Phase 2，尚未实现） |
| --- | --- | --- |
| 路径前缀 | 无。所有端点裸挂在 `/api` 下 | 引入 `/api/v2/...`，v1 与 v2 并行至少一个发布周期 |
| 版本协商头 | 无 | `X-Mim-Api-Version: 1`，服务端返回 `X-Mim-Api-Version` 回声头 |
| 破坏性变更 | 目前靠「前端与后端同仓同发」规避 | 破坏性变更必须换路径前缀，禁止在同路径上改响应结构 |
| 兼容性底线 | 响应体只允许 `{ data }` 一个键（前端据此解包，`src/core/http.ts:104`） | 该约束在任何版本都不得打破 |

规则：

1. **新增**字段 / 表 / RPC 为兼容变更，可直接发布。
2. **删除或改名**列、表、RPC 参数、响应字段为破坏性变更，必须走新前缀。
3. 前端解包逻辑（`src/core/http.ts:104`）假设成功响应只有 `data` 一个键，任何版本都不得附加同级键。

---

## 4. 统一响应结构

### 4.1 成功

```
HTTP 2xx
{ "data": <任意值> }
```

- 列表：`{ data: [ ... ] }`
- 单条：`{ data: { ... } }`
- 删除：`{ data: true }`
- 注册 / 插入 / 上传 / 下发指令：`HTTP 201 + { data: ... }`

前端解包规则（`src/core/http.ts:103-107`）：响应体是对象且**只有** `data` 一个键时取 `data`，否则整体作为 `data`。因此服务端成功响应**禁止**在 `data` 同级追加字段。

### 4.2 失败

```
HTTP <status>
{ "error": { "code": "<ErrCode>", "message": "<中文文案>" } }
```

- `code` 取自前端 `ErrCode` 联合类型（`src/core/result.ts:10-20`）；HTTP 状态码与 `code` 必须同时正确（详见 `docs/specs/统一错误码规范.md`）。
- 前端优先取响应体 `code`，取不到才按 HTTP 状态码反推（`src/core/http.ts:91-100`）。

### 4.3 跨域与缓存

| 头 | 值 | 位置 |
| --- | --- | --- |
| `Access-Control-Allow-Origin` | `*` | `server/src/main.js:31` |
| `Access-Control-Allow-Methods` | `GET,POST,PATCH,DELETE,OPTIONS` | `server/src/main.js:32` |
| `Access-Control-Allow-Headers` | `Content-Type,Authorization,X-Mim-Token,X-Sync-Token` | `server/src/main.js:33` |
| `Cache-Control` | 接口一律 `no-store`；对象存储回读 `public, max-age=31536000, immutable` | `server/src/main.js:44`、`server/src/main.js:133` |

> 注意：`x-iot-hook-token` 未出现在 `Access-Control-Allow-Headers` 中。当前 IoT 钩子由 EMQX 服务端直连调用（非浏览器跨域），不受影响；若将来需要浏览器直连，必须补该头。**已记录为不一致项，未修改代码。**

---

## 5. 鉴权头

| 方式 | 头 | 优先级 | 代码位置 |
| --- | --- | --- | --- |
| 标准 | `Authorization: Bearer <token>` | 1 | `server/src/auth.js:174` |
| 兼容 | `X-Mim-Token: <token>` | 2（`Authorization` 不存在时） | `server/src/auth.js:174` |

- 令牌为自签 HMAC-SHA256，形如 `base64url(payload).base64url(sig)`，payload = `{ uid, jti, iat, exp }`（`server/src/auth.js:6-7`、`server/src/auth.js:68-73`）。
- 缺省有效期 7 天，可用 `TOKEN_TTL_MS` 覆盖（`server/src/auth.js:25`）。
- 无令牌或令牌失效一律 `401 / no_auth`（`server/src/auth.js:175-178`）。
- 列表读使用 `tryAuth`：无 `Authorization` 与 `X-Mim-Token` 时按匿名处理，公共表可读；令牌损坏则按未登录处理（`server/src/main.js:225-228`）。
- 请求体上限默认 12 MB（`server/src/main.js:25`），超限为 `400 / bad_request`。

---

## 6. 分页 / 排序 / 过滤（以 `rest.js` 实际实现为准）

查询参数由 `server/src/rest.js:157-197` 解析，前端构造器见 `src/data/client.ts:41-48`。**只支持以下五种**：

| 参数 | 写法 | 默认 | 约束 | 非法时的错误 |
| --- | --- | --- | --- | --- |
| `select` | `select=id,title,created_at` | `*` | 逗号分隔列名，逐列用 `information_schema` 核定 | 未知列 → `400 / schema`（`server/src/rest.js:146`、`server/src/rest.js:111`） |
| `eq` | `eq=author_id.xxx` 可重复出现 | 无 | 多个 `eq` 之间为 **AND**；值按列类型判定（boolean / 数值 / 文本） | 缺 `.` → `400 / bad_request`；未知列 → `400 / schema`；数值列收到非数值 → `400 / bad_request`（`server/src/rest.js:157-174`） |
| `order` | `order=created_at.desc` 或 `order=created_at.asc` | 无（不保证顺序） | 只支持单列；`nulls last` | 未知列 → `400 / schema`（`server/src/rest.js:189-194`） |
| `limit` | `limit=20` | `100` | 夹取到 `[1, 500]` | 非数值按默认处理（`server/src/rest.js:196`） |
| `offset` | `offset=40` | `0` | 下限 0 | 同上（`server/src/rest.js:197`） |

示例：

```
GET /api/rest/posts?select=id,content,created_at&eq=author_id.7f3c...&eq=topic.摄影&order=created_at.desc&limit=20&offset=0
```

**明确不支持**（不要写进联调文档）：`like`、`ilike`、`gt`、`gte`、`lt`、`lte`、`in`、`neq`、`or`、多列排序、嵌套展开、聚合（`count`/`sum`）、游标分页。需要这些能力时，应新增 RPC 或在前端做内存过滤。

---

## 7. 幂等约定

### 7.1 现状：没有通用 `Idempotency-Key` 头

服务端**未实现** `Idempotency-Key` 请求头（全仓无该逻辑）。当前幂等一律靠**业务幂等键**，即「业务单据号」而非请求级 nonce。理由（`server/db/migrations/0010_wallet_idempotency.sql:9-12`）：请求级 nonce 挡不住「同一个业务动作被重试」——重试会带新 nonce，照样穿透去重。

> 建议（Phase 2）：为写类 RPC 增加可选 `Idempotency-Key` 头，服务端以 `(uid, key)` 落 `idempotency_keys` 表并缓存首次响应。此项尚未实现。

### 7.2 现有业务幂等键清单

| 幂等键 | 载体 / 约束 | 代码位置 |
| --- | --- | --- |
| `device_commands.id`（App 生成的 `cmd_id`，8~64 位） | `on conflict (id) do nothing`，重复下发直接回旧单 | `server/src/iot.js:194-202`、`server/db/migrations/0008_iot_device.sql:40-41` |
| `wallet_txs.snapshot ->> 'debit_order_id'`（对应 RPC 参数 `p_order_id`） | 唯一索引 `uq_wallet_txs_consume_bizkey`，仅作用于 `kind='consume'` | `server/db/migrations/0010_wallet_idempotency.sql:22-24`、`server/src/rpc.js:591-611` |
| `local_vouchers` 唯一索引 `UNIQUE(order_id)` | 同订单重复取码回读原码，返回 `reused=true` | `server/src/rpc.js:482-496` |
| `seckill_lock_items` 主键 `(session_id, user_id, order_id)` | 同一订单重复抢会 **累加 qty**（见 §7.3 风险） | `server/src/rpc.js:129-136` |
| `mall_orders.id`（客户端生成订单号） | RPC `mall_upsert_order` 按 id upsert | `server/src/rpc.js:669-715` |
| `mall_orders.ext.released` 布尔标记 | `travel_release` 幂等，重复调用返回 `released:0, reused:true` | `server/src/rpc.js:268-269`、`server/src/rpc.js:282-289` |
| `mall_orders.biz_status` 状态闸 | `travel_issue` / `travel_refund` 靠状态机去重 | `server/src/rpc.js:424`、`server/src/rpc.js:307-309` |

### 7.3 已知非幂等的接口（调用方必须自行防重）

| 接口 | 现象 | 代码位置 | 建议 |
| --- | --- | --- | --- |
| `seckill_grab` | 相同 `p_order_id` 重复调用会 `qty = qty + excluded.qty`，即累加占用而非幂等返回 | `server/src/rpc.js:129-136` | 前端以订单号为粒度单点提交；或改 RPC 为「已存在则原样返回」 |
| `travel_book` | 每次调用都真实扣减 `travel_date_stock.remaining`，无任何去重 | `server/src/rpc.js:222-226` | 以 `p_order_id` 为幂等键落库去重（Phase 2） |
| `wallet_credit` | 无业务键，重复调用重复入账 | `server/src/rpc.js:628-647` | 补齐 `p_order_id` 幂等键 |
| `admin_wallet_credit` | 无业务键，重复调用重复入账（且是管理员给别人加钱，风险更高） | `server/src/rpc.js:876-902` | 增加 `p_request_id` 幂等键 + 前端二次确认 |
| `send_message` | 每次调用生成新 UUID 双写两行 | `server/src/rpc.js:727-736` | 客户端生成 message id 作为幂等键 |
| `growth_record` | 只受 `daily_cap` 限制，同动作当天可多次计分至上限 | `server/src/rpc.js:796-804` | 按业务决定是否加去重窗口 |

### 7.4 写操作重试策略

前端默认「写不重试、读重试 1 次」（`src/core/http.ts:115`、`src/core/http.ts:132-138`）。因此：

- 写接口失败后，**不允许**客户端盲目重放，必须先查询当前状态（例如 `commandStatus`、`wallet_state`、订单 `biz_status`）再决定是否重提。
- 携带业务幂等键的写接口才允许自动重放。

---

## 8. 写入三态语义（ok / skip / fail）

定义于 `src/core/result.ts:45-50`，落点在 `src/data/sync.ts:53-58`：

| 态 | 含义 | 触发条件 | 调用方义务 |
| --- | --- | --- | --- |
| `ok` | 云端已确认 | `Result.ok === true` | 无 |
| `skip` | 不具备云端条件，**不是错误** | 未登录 **或** 未配置后端（`isBackendConfigured()` 为假） | 本地态即最终态，不提示、不回滚 |
| `fail` | 云端明确拒绝 | 其余全部失败 | 必须回滚本地乐观更新并向用户提示 |

铁律：

1. `skip` **不得**计为失败，也不得弹错误提示——纯本地模式下每次写入都被记成 `fail` 会让用户以为数据丢了（`src/data/sync.ts:44-49` 注释明确此点）。
2. `fail` 必须回滚本地乐观更新，否则出现「云端写失败但前端显示成功」的静默不一致（`src/core/result.ts:4-6`）。
3. 判断 `skip` 必须**同时**判 `isSignedIn()` 与 `isBackendConfigured()`，只判其一即为缺陷。

---

## 9. REST 表清单（白名单，共 36 张）

来源：`server/src/rest.js:27-75`。不在该 Map 中的表一律拒绝（`server/src/rest.js:89`）。

可见性取值含义（`server/src/rest.js:21-24`）：

- 读：`public` 匿名可读 / `owner` 仅本人 / `admin` 仅管理员。
- 写：`owner` 仅本人且服务端强制注入 owner 列 / `self` owner 列即主键（一人一行）/ `admin` 仅管理员 / `none` 禁写（必须走 RPC）。
- `users` **永不在白名单**，只能通过 RPC 或 `/api/auth/*` 访问（`server/src/rest.js:5-6`）。

| # | 表名 | 归属列 | 读可见性 | 写可见性 | 用途 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `profiles` | `id` | public | self | 公开资料（昵称 / 头像 / 简介 / 粉丝数） | `upsert:true`；`username` 只读，取令牌身份（`server/src/rest.js:29`） |
| 2 | `app_users` | `user_id` | owner | none | 历史 CloudBase uid 对照表 | 注册时自动落一行（`server/src/auth.js:227-231`） |
| 3 | `posts` | `author_id` | public | owner | 社区动态 | 唯一带 `visibility` 保密列的表（`server/src/rest.js:33`） |
| 4 | `post_comments` | `author_id` | public | owner | 动态评论 | |
| 5 | `articles` | `author_id` | public | owner | 长文 | |
| 6 | `article_comments` | `author_id` | public | owner | 长文评论 | |
| 7 | `snippets` | `author_id` | public | owner | 代码片段 | |
| 8 | `follows` | `follower_id` | public | owner | 关注关系 | |
| 9 | `favorites` | `user_id` | owner | owner | 收藏 | |
| 10 | `messages` | `user_id` | owner | owner | 私信副本（收发双方各一行） | 写入走 RPC `send_message`（`server/src/rpc.js:719-737`） |
| 11 | `notifications` | `user_id` | owner | owner | 站内通知 | |
| 12 | `post_drafts` | `user_id` | owner | owner | 动态草稿 | |
| 13 | `article_drafts` | `user_id` | owner | owner | 长文草稿 | |
| 14 | `products` | `created_by` | public | owner | 商品 | `adminOverride:true`，管理员豁免归属（`server/src/rest.js:46`） |
| 15 | `mall_orders` | `user_id` | owner | owner | 商城订单 | 金额列 `amount_fen`（分）；下单走 `mall_upsert_order` |
| 16 | `wallet_txs` | `user_id` | owner | none | 钱包流水 | 只能由 RPC 写 |
| 17 | `roles` | — | public | admin | 角色字典 | |
| 18 | `permissions` | — | public | admin | 权限点字典 | |
| 19 | `user_roles` | — | admin | admin | 用户—角色关系 | |
| 20 | `role_permissions` | — | admin | admin | 角色—权限关系 | |
| 21 | `audit_logs` | — | admin | none | 审计日志（append-only） | |
| 22 | `seckill_sessions` | — | public | admin | 秒杀场次 | |
| 23 | `seckill_locks` | `user_id` | owner | none | 秒杀锁（0004 遗留表） | 现行代码不再写，仅由兜底清理（`server/src/rpc.js:191-193`） |
| 24 | `seckill_lock_items` | `user_id` | owner | none | 秒杀锁（0007，一单一行） | |
| 25 | `local_merchants` | — | public | admin | 本地生活商家 | |
| 26 | `local_vouchers` | — | public | admin | 本地生活套餐券 | |
| 27 | `local_voucher_codes` | `user_id` | owner | none | 券码 | 发码 / 核销走 RPC |
| 28 | `live_rooms` | — | public | admin | 直播间 | |
| 29 | `live_shelf` | — | public | admin | 直播货架 | 复合主键 `(room_id, goods_id)`（`server/src/rest.js:65`） |
| 30 | `travel_tickets` | — | public | admin | 出行票种 | |
| 31 | `travel_date_stock` | — | public | admin | 出行日期库存 | 复合主键 `(ticket_id, date)`（`server/src/rest.js:67`） |
| 32 | `travel_rules` | — | public | admin | 出行退改规则 | 主键 `(ticket_id)`（`server/src/rest.js:68`） |
| 33 | `growth_events` | `user_id` | owner | none | 成长行为流水 | 由 `growth_record` 写 |
| 34 | `growth_checkins` | `user_id` | owner | none | 签到连击 | 由 `growth_checkin` 写 |
| 35 | `growth_badges` | `user_id` | owner | none | 成就徽章 | |
| 36 | `growth_rules` | — | public | admin | 成长规则（动作分值 / 每日上限 / 质量闸） | |

### 9.1 归属列（owner）强制语义

- 写操作时，客户端提交的 owner 列值**一律被丢弃**，由服务端注入 `ctx.uid`（`server/src/rest.js:260`、`server/src/rest.js:274-277`）。
- 读 `owner` 表时自动追加 `owner 列 = 当前 uid` 条件（`server/src/rest.js:177`）。
- 更新 / 删除时区分两种失败：目标不存在 → `404 not_found`；存在但不是你的 → `403 forbidden`（`server/src/rest.js:371-375`）。
- `posts.visibility='self'` 的行对非本人一律不可见，包括按 id 直读（`server/src/rest.js:179-186`、`server/src/rest.js:228-230`）。
- 表名与列名走 `IDENT_RE = /^[a-z_][a-z0-9_]*$/` 与 `information_schema` 双重核定，杜绝注入（`server/src/rest.js:77-82`、`server/src/rest.js:88-107`）。

---

## 10. RPC 清单（共 20 个）

来源：`server/src/rpc.js:923-952`。调用方式统一为 `POST /api/rpc/{name}`，参数**统一以 `p_` 前缀**命名（`p_order_id`、`p_fen` 等）。全部 RPC 均需鉴权（`server/src/main.js:191`）；标注「需 admin」的过程内部调用 `ctx.requireAdmin()`。

| # | 名称 | 参数（`p_*`） | 返回值 | 权限 | 幂等性 | 负责人 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `seckill_grab` | `p_session_id`、`p_qty`、`p_order_id`（可空） | `{ session_id, remaining, qty, expire_at }` | 本人 | **非幂等**：同 `p_order_id` 重复调用累加 qty（`server/src/rpc.js:129-136`） | BA |
| 2 | `seckill_release` | `p_session_id`、`p_order_id`（可空） | `{ released }`；无锁返回 `{ released: 0 }` | 本人 | 幂等 | BA |
| 3 | `travel_book` | `p_ticket_id`、`p_date`（YYYY-MM-DD）、`p_qty`、`p_order_id`（可选） | `{ ticket_id, date, qty, remaining }` | 本人 | **非幂等**（每次真实扣减） | BA |
| 4 | `travel_release` | `p_ticket_id`、`p_date`、`p_order_id`（**必填**） | `{ released, remaining }`；重复调用 `{ released: 0, reused: true, reason }` | 本人（须为未支付单） | 幂等（`ext.released` 标记） | BA |
| 5 | `travel_issue` | `p_order_id` | `{ order_id, biz_status, issued_at, reused }` | 本人（须已支付） | 幂等（已 `ticketed` 返回 `reused:true`） | BA |
| 6 | `travel_refund` | `p_order_id` | `{ order_id, amount_fen, fee_fen, refund_fen, credited_fen, restored }` | 本人（须 `ticketed`） | 幂等（状态闸 + 退款流水快照去重） | BA |
| 7 | `issue_voucher_code` | `p_order_id`、`p_voucher_id` | `{ code, expire_at, reused[, remaining] }` | 本人（须已支付） | 幂等（`UNIQUE(order_id)`，重复返回原码） | BA |
| 8 | `verify_voucher` | `p_code` | `{ code, order_id, used_at }` | **需 admin** | 一次性；重复核销返回 `409 conflict` | BA |
| 9 | `wallet_state` | 无 | `{ balance_fen, plan, txs[] }`（txs 最近 50 条） | 本人 | 只读 | BA |
| 10 | `wallet_debit` | `p_fen`、`p_note`（可选）、`p_order_id`（可选，业务幂等键） | `{ balance_fen, fen, reused }` | 本人 | 幂等（仅当传 `p_order_id`：咨询锁 + 唯一索引双闸） | BA |
| 11 | `wallet_credit` | `p_fen`、`p_kind`（`recharge` / `income`，默认 `recharge`）、`p_note`（可选） | `{ balance_fen, fen, kind }` | 本人（只能给自己入账） | **非幂等** | BA |
| 12 | `mall_upsert_order` | `p_order`（对象：`id`、`amount_fen`、`qty`、`status`、可选 `goods_id`/`title`/`emoji`/`channel`/`pay_channel`/`proof`/`biz_kind`/`ext`/`biz_status`） | 订单行 | 本人 | upsert（按 `p_order.id`，订单号被他人占用则 `403`） | BA |
| 13 | `send_message` | `p_peer`（对方 uuid）、`p_content` | `{ id, peer_id, created_at }` | 本人 | **非幂等** | BA |
| 14 | `bootstrap_admin` | 无 | `{ roles, permissions }` | 已登录 | 幂等（已有管理员 → `409 conflict`） | BA |
| 15 | `admin_user_lookup` | `p_query`（uuid 或用户名） | `{ id, username, name, balance_fen }` | **需 admin** | 只读 | BA |
| 16 | `admin_wallet_credit` | `p_user_id`、`p_fen`、`p_note`（可选） | `{ balance_fen, fen }` | **需 admin** | **非幂等** | BA |
| 17 | `admin_wallet_ledger` | `p_user_id`（可选，缺省查全站）、`p_limit`（默认 50，上限 200） | `{ rows[] }` | **需 admin** | 只读 | BA |
| 18 | `growth_record` | `p_action`、`p_quality`（默认 true） | `{ id, action, value }` | 本人 | 受 `daily_cap` 与 `quality_gate` 约束，非严格幂等 | BA |
| 19 | `growth_checkin` | 无（日期服务端取，防改时钟伪造连击） | `{ streak }` | 本人 | 幂等（当天重复 → `409 conflict`） | BA |
| 20 | `growth_state` | 无 | `{ events[], badges[], checkin: { last, streak } }` | 本人 | 只读 | BA |

### 10.1 参数解析规则（所有 RPC 共用）

| 类型 | 校验 | 越界错误 |
| --- | --- | --- |
| 字符串 `str` | 去空白，长度 `[min, max]`（默认 1~2000） | `400 bad_request` |
| 整数 `int` | 必须整且有限，默认 `[1, 1_000_000_000]` | `400 bad_request` |
| 布尔 `bool` | `true` / `'true'` / `1` / `'1'` 为真 | — |
| UUID | 必须匹配标准 UUID 正则 | `404 not_found`（`server/src/rpc.js:54-58`） |
| 日期 | 必须 `YYYY-MM-DD` | `400 bad_request`（`server/src/rpc.js:62-66`） |

### 10.2 未在 RPC 注册表中的过程

`callRpc` 对未注册函数名抛 `400 / schema`（`server/src/rpc.js:956`），函数名须匹配 `/^[a-z_][a-z0-9_]*$/`（`server/src/main.js:189`）。

---

## 11. 设备（IoT）接口补充

设备域不走 `/api/rpc`，有独立端点（见 §2），原因是其鉴权与响应契约（EMQX 约定的 `{ result }`）与常规通道不同。

| 项 | 约定 | 位置 |
| --- | --- | --- |
| 设备身份 | `devices.id` 即 device_id，出厂写入；`device_token_hash = sha256(Device-Token)`，永不下发明文 | `server/db/migrations/0008_iot_device.sql:13-26` |
| 指令幂等 | `cmd_id`（8~64 位字母数字 `-` `_`）即 `device_commands.id`，`on conflict (id) do nothing` | `server/src/iot.js:194-202` |
| 指令状态机 | `pending → sent → acked / failed`；超时由查询方按 `sent_at` 推算，不落枚举 | `server/src/iot.js:53`、`server/src/iot.js:215` |
| 设备域错误码 | `30101` 设备不存在（404）/ `30102` 设备离线（409）/ `30103` 未绑定或已被他人绑定（403） | `server/src/iot.js:35-37` |
| 尚未实现 | OTA check/report（随 0009 迁移）、设备激活与 BLE 配网 | `server/src/iot.js:23-26` |

> 设备域错误码为数字段位，**不在**前端 `ErrCode` 联合类型内，详见 `docs/specs/统一错误码规范.md` §5。

---

## 12. 评审记录

| 日期 | 版本 | 评审人 | 结论 | 备注 |
| --- | --- | --- | --- | --- |
| 2026-10-30 | v1.0 | （待填） | （待填） | 冻结基线，后续变更须走评审并升版本 |
| | | | | |
| | | | | |

---

## 13. 变更须知

修改下列任一文件时，必须同步更新本规范：

- `server/src/rest.js`（表白名单 / 查询参数 / 归属与可见性）
- `server/src/rpc.js`（RPC 注册表 / 参数 / 返回值 / 幂等性）
- `server/src/main.js`（端点 / 响应契约 / CORS）
- `server/src/auth.js`（鉴权头 / 令牌）
- `server/src/errors.js` 与 `src/core/result.ts`（错误码，另见统一错误码规范）
