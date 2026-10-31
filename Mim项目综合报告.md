# Mim 项目综合报告

> 生成日期：2026-10-29（UTC+8）
> 覆盖范围：全项目通读、四方向落地、延续收尾、3.txt 交付清单、全项目查漏补缺、互联网资源调研
> 项目根：`F:\合并项目\Mim` · Git 远端：`https://github.com/afdk1991/mim.git`（唯一可写源）
> 硬约束：**全程不使用 Docker**（宿主机直部署 + systemd + nginx + PostgreSQL）

---

## 目录

1. 项目全貌
2. 技术栈与架构
3. 业务模块
4. 后端服务
5. 关键设计决策（铁律）
6. 四方向落地成果（模块分析 / 代码审查 / 无 Docker 部署 / 文档更新）
7. 延续收尾工作（推送 / BE-002 / 连库实测 V1–V8 / worker 修复 / 查漏补缺）
8. 3.txt 交付清单落地对照
9. 互联网资源调研结论
10. 验证与验收汇总
11. git 提交记录
12. 遗留事项与待决策
13. 产物索引

---

## 1. 项目全貌

Mim 是一个**自托管后端 + 纯前端 SPA** 的多端内容社区与工具台应用，含商城、VIP、成长引擎与 9 个工具模块。同一套代码经平台适配层（`src/platform/`）跑在 **Web / Android / iOS / 鸿蒙 / 桌面(Tauri)** 五类端上。

核心定位变化（本次工作后）：从"本地演示项目"升级为**具备完整部署体系、可连库实测、有边缘可选层、有互联网资源决策依据**的可上线项目。

---

## 2. 技术栈与架构

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | React 18 + Vite 8 + TS 5.9 | 纯 SPA，自研 hash 路由，`base:'./'` 支持子路径部署 |
| 后端 | `node:http` 零框架 + `pg` | 自托管 `server/`，PostgreSQL 单库，端口 8787（可配） |
| 移动壳 | Capacitor 8（Android/iOS） | `androidScheme:'https'` 规避混合内容 |
| 桌面壳 | Tauri 2（含 updater 插件） | nsis/msi/dmg/appimage/deb 分发 |
| 鸿蒙 | HarmonyOS entry 模块 | ArkTS + ArkWeb 壳内嵌 dist |
| 部署 | GitHub Actions + 宿主机 | systemd + nginx + logrotate，**全程无 Docker** |
| 可选边缘层 | Cloudflare Workers（`worker/`） | 地理路由 + 健康探测 + 故障转移 + D1 只读副本（**非主路线**） |

**分层目录**（严格依赖方向）：
```
pages → app（路由/状态） → ui → domain（模型/规则）
     → data（客户端/同步） → platform（四端适配） → core（http/storage/result）
```

---

## 3. 业务模块（前端 57 条路由）

| 模块 | 内容 |
|---|---|
| 内容社区 | 动态（转发/评论/点赞/投票/抽奖）、文章+编辑器、代码片段、话题/超话、榜单、视频流、资源下载、搜索、直播 |
| 社交 | 关注/粉丝、收藏、浏览足迹、私信、通知 |
| 商城 | 商品目录（youxuan/gexm/mix/live/laal 五渠道）、购物车、订单、钱包（金额一律「分」）+ **四大业务会场**：秒杀、本地生活（门店/套餐券/券码）、直播尖货、出行（票种/日期库存/退改） |
| 会员与成长 | VIP 中心、成长引擎（行为事件账本/签到连击/徽章/可运营规则表） |
| 工具台（9 个） | BOM、Coze 面板、AI 资源库、漫剧、Ardot 聚合监控、邮箱聚合、路线导航、配送调度台、价格监控 |
| 系统 | 登录注册、设置、站点信息页、管理后台（审计/角色/商品/充值核销） |

---

## 4. 后端服务（server/，20 个 RPC + 通用 REST）

- **认证**：scrypt 加盐哈希（N=16384）+ HMAC-SHA256 自签令牌（jti 吊销），支持「首个管理员」环境变量引导
- **REST 安全三层**：① 表白名单（`users` 永不在内）② 列白名单（information_schema 实时核定）③ 归属强制（owner 服务端注入）
- **RPC 事务层**：秒杀抢购=行锁+条件更新+限购锁；券码服务端生成、`WHERE status='unused'` 一次性核销；钱包余额服务端原子计算；出行退票四道闸防重复退；成长计分服务端校时防刷
- **迁移 0001→0008**：IAM(RBAC/审计/令牌吊销) → 内容 → 商城 → 四大业务 → 成长 → posts 增量同步水位 → seckill_lock_items（订单粒度锁，0007 新增）→ **iot_device（物联网设备表，0008 新增）**
- **额外能力**：`/api/storage` 本地磁盘对象存储（base64 上传、目录穿越防护）、`/api/sync/posts` 只读增量同步端点（X-Sync-Token 鉴权，`{data:{rows,next,has_more}}` 契约，供边缘层/镜像站拉取）

---

## 5. 关键设计决策（铁律）

| 铁律 | 内容 |
|---|---|
| 金额只用「分」 | bigint，根除历史 100 倍错位 |
| 时间统一 bigint 毫秒 | 前端模型与 DB 列严格一一对应 |
| 响应契约 | 成功 `{data}`、失败 `{error:{code,message}}`，前后端 ErrCode 对齐 |
| 离线优先 | 未配置后端时前端完全可用（localStorage）；配置后三态写回（skip/成功/失败降级） |
| 平台适配契约 | 同一用例对 mock/web/capacitor/miniprogram 四端全绿 |
| 版本唯一源 | `src/core/version.ts` 四段式 → 各端派生 |
| **无 Docker** | 宿主机直部署，CI 内置「禁止容器化产物」闸门（机器可校验） |
| **GitHub 唯一可写源** | 其余仓库/制品/运行时全部单向同步，任何下游可删除重建 |

---

## 6. 四方向落地成果

### 6.1 模块深入分析 → `docs/analysis/`

**商城四业务并发与退款分析.md**（29.8 KB）：
- 秒杀/本地/直播/出行逐业务链路 + 并发正确性 + 退款链路 + 风险表（每行带 file:line 证据）
- 防超卖主干成立：秒杀/出行均为事务内「行锁 + 条件 UPDATE WHERE remaining>=qty」
- 发现并处置：出行退票链路不可达（后由 AN-001 出票链路修复）、秒杀锁过期清理（AN-004）、本地套餐库存防超卖、退票字段不一致（已修）
- **含「七、实测验证」章节**：环境结论、Windows 启动 PG 步骤、V1–V8 待验证清单与回填结果（见第 7 节）

**平台适配层契约分析.md**（13.9 KB）：
- 分层方向正确（IPlatformAdapter 唯一触宿主处、不反向依赖 core/React）
- 指出：`core/http.ts` 直接用全局 fetch 未平台化、contract-check 不校验行为语义、Capacitor 原生分支不进契约测试（均登记为改进方向）

### 6.2 代码审查 → `docs/review/`（合并报告 + 3 份子报告）

三线共 **45 条**（P0×1、P1×7、P2×18、P3×19），**已修复 8 条**，全部带 file:line 证据。

| 严重度 | 已修复项 |
|---|---|
| P0 | `build-release.yml` 版本门禁读已删除的 `src/version.ts` → 统一 `src/core/version.ts` |
| P1×6 | `travel_release` 授权漏洞、`deploy.yml` 端口硬编码、desktop job 未限 tag、`install.sh` 未排除敏感文件、前端调不存在的 RPC、退票字段/文案对齐 |
| P1/P2 | 退票字段 `fee/refund` → `fee_fen/refund_fen`；退款文案对齐 |

后续 P1 的实现状态：AN-001/AN-004/FE-001 已实现（第 7 节）、BE-001/BE-002 已实现、BE-003/004/005 登记（第 12 节）。

### 6.3 无 Docker 部署方案 → `deploy/`

- `deploy/README.md`（32.5 KB，21+ 节）：原生进程架构（systemd + nginx + PostgreSQL）、「下载方案→Mim 落地形态」对照表、安装/升级/回滚、GitHub Releases zip 分发、健康检查、备份、密钥管理、降级矩阵与成本、取舍、3.txt 交付清单对照表
- `deploy/install.sh`（无 Docker 10 步安装）、`init-db.sh`、`mim-server.service`、`nginx-mim.conf`（SPA 回退 + /api 反代 + CSP/X-Content-Type-Options/X-Frame-Options/Referrer-Policy）、`logrotate-mim.conf`

### 6.4 文档更新

- **归档 5 份**到 `docs/archive/`（git mv 保留历史，SHA256 5/5 一致，内容零改动）：开发吧.md、漫剧片单更新变更总结.md、全平台.md、全栈全站全平台技术方案.md、阅读理解与实施规划报告.md
- **刷新 4 份**：路由清单（52 路径探针 + 40 case 标签 0 MISS）、启动说明、迁移说明、页面实现规范
- 新建 `docs/README.md` 索引

---

## 7. 延续收尾工作

### 7.1 推送 8 个 commit ✅
- 推送前核验 `git remote -v`：origin = `https://github.com/afdk1991/mim.git`（唯一正确）
- 推送成功；`git fetch` 后 `rev-list --left-right --count` = 0，与远端一致

### 7.2 BE-002 秒杀多单累计锁整行释放粒度 ✅
- 新迁移 `0007_seckill_lock_items.sql`（一行一订单：主键 session+user+order + qty + expire_at）
- `seckill_grab/release/sweepSeckillLocks` 全切新表；`release` 只删本订单那一行、只回补该单 qty
- 实测（V3）：A 3 件 + B 2 件后 release(A) → 精确回补 3，B 单锁行仍在（qty=2 无误伤）
- commit `e4f55f8`

### 7.3 本机连库实测 V1–V8 ✅（真实数据，非推断）

**环境**：winget 无人值守安装 **PostgreSQL 17.11**（Windows 服务）→ `createdb mim` → 迁移 **0001~0008 全部应用** → `node server/src/main.js`（会话注入 DATABASE_URL/JWT_SECRET/SECKILL_LOCK_MS/SYNC_TOKEN）→ `/api/health` 返回 `{ok:true, db:true, rpcs:20}`。

**结果 7/7 通过，退出码 0**（脚本 `scripts/loadtest-v1-v8.mjs`，真实 HTTP + SQL 断言）：

| 项 | 断言要点 | 实测结果 |
|---|---|---|
| V1 并发不超卖 | 40 并发/库存 20 | 成功 20 / 409 冲突 20，remaining=0，锁 qty=20 守恒，145ms |
| V2 限购+过期回补 | 抢 2 件后限购 409 | 过期懒清理回补 2 再扣 1，remaining 98→99 |
| V3 BE-002 粒度 | 多单累计锁 | 精确回补，无误伤 |
| V4 退票幂等 | 首退 200 `refund_fen=9000`（10000−10% 费） | 二退 409，income 流水仅 1 笔 |
| V5 出票闭环 | SQL 造 pending_ticket 单 | issue 200 → ticketed → refund 200 |
| V6 release 归属五档 | 缺参 400/他人 403/不存在 404/已付 released:0/未付 released:1 | 全符合 |
| V7 同步游标 | 错 token 403；12 条翻页拉满 | 无重无漏（5ms 错峰写入） |
| V8 并发取码唯一 | 20 并发 | 全 200，DB 仅 1 码行，39ms |

**过程中的真实发现**：V7 首轮失败定位为 **BE-005 真实复现**——0006 触发器用 `clock_timestamp()` 覆写 `updated_at`，同毫秒插入导致游标 `updated_at > since` 漏行（已登记，未修）。

**回填**：分析文档 7.3 表状态列全部回填（状态+证据+关键数值）+ 新增 7.5 实测环境节；commit `366e590`。

### 7.4 worker 边缘层修复 ✅（独立 tsc 核验的 5 项）

| 项 | 修复 |
|---|---|
| ① P1 状态码 | `handleHealth` 补 `, 200`（TS2554） |
| ② P1 类型缺失 | 新建 `worker/package.json` + tsconfig（@cloudflare/workers-types） |
| ③ P2 兼容性 | `r.json<T>()` → `as` 断言（TS2558） |
| ④ P2 一致性 | 与 `server/src/sync.js` 实际 `{data:{rows,next,has_more}}` 核对一致，无需改 |
| ⑤ P2 KV 选项 | `ttl` → `expirationTtl`（TS2353） |

验证：worker tsc exit 0 + 主 typecheck exit 0；commit `f235916`。

### 7.5 全项目查漏补缺（8 项扫描）✅

- **修复 4 处**：server/README 四处滞后（rpcs 19→20、补 travel_issue、seckill_lock_items、/api/sync/posts 路由）；server/.env.example 补 VOUCHER_MAX_DAYS；package.json 补 3 个 verify npm 入口；docs/README 索引补代码审查报告
- **登记 11 条 gap** → `docs/gaps.md`（GAP-01~05 + BE-003/004/005/006/007-008/SD-002-004）
- **验证**：typecheck 0 / 单测 `tests/` 2 个文件全过 / build / server:check(10 文件) / loadtest --check 全通过；路由 57/57 一致；版本文件层 9/9 全绿

---

## 8. 3.txt 交付清单落地对照（13+3 交付物）

| 3.txt 交付物 | Mim 落地 | 说明 |
|---|---|---|
| `.env.example` | 根 `.env.example` ✅ | 补可选边缘层变量段 |
| `build-publish.yml`（镜像+GHCR/ACR+npm） | `.github/workflows/deploy-release.yml` ✅ | tag→构建 zip→GitHub Release；容器镜像剔除（无 Docker）；npm 为可选 job |
| `cleanup-images.sh` | `scripts/cleanup-images.sh` ✅ | 无 Docker 适配：gh api 过期清理 + DRY_RUN；GHCR/ACR 为 N/A 参考函数 |
| `deploy.yml` | `.github/workflows/deploy.yml` ✅ | SSH + systemd 直部署，含质量闸门 |
| `docker-compose.yml` | **决策剔除** | 禁容器；等价物 = systemd 原生进程（README 记录） |
| `index.ts`（Worker 网关） | `worker/src/index.ts` ✅ | 可选边缘层（健康探测/故障转移/Cron 写 D1） |
| `init-multi-remote.sh` | `scripts/init-multi-remote.sh` ✅ | GitHub → Gitee/极狐/AtomGit/CNB |
| `mirror.yml` | `.github/workflows/mirror.yml` ✅ | 单向镜像 + 每日 04:00 兜底 |
| `nginx/default.conf` | `deploy/nginx-mim.conf` ✅ | SPA 回退 + /api 反代 + 全套安全头 |
| `pipeline.yml`（Gitee Go） | `.gitee/pipeline.yml` ✅ | 国内构建校验兜底 |
| `README.md`（交付说明） | `deploy/README.md` ✅ | 含 3.txt 对照表（第二十二节） |
| `sync.ts` | `server/src/sync.js` ✅ | 等价物（node:http 版，契约一致） |
| `bootstrap.sh` | `deploy/bootstrap.sh` ✅ | 无 Docker 一键重建，对齐 10 分钟重建 |
| `backup.sh` | `scripts/backup.sh` ✅ | pg_dump+gzip+轮转+可选 rclone |
| D1 迁移 SQL | `worker/migrations/0001_init.sql` ✅ | posts 只读副本 + 幂等 upsert |
| `wrangler.jsonc` | `worker/wrangler.jsonc` ✅ | 参考配置，占位中文标注「创建后回填」 |

验证：bash -n 3/3、YAML 解析全过、占位符 0 残留（「创建后回填」为模板预期注释）。commits：`0791425`、`1b7aaf7`、`bc506ca`。

---

## 9. 互联网资源调研结论 → `docs/research/`

主报告 `互联网资源调研.md`（19.9 KB）+ 6 份维度明细（`artifacts/01~06`，合计约 120 KB）。约 **184 条推荐、约 214 个去重来源 URL**，关键数字经独立复核（GitHub Actions 2000 分钟/月、EdgeOne Makers 50 万 token/月均官方确认）。

| 维度 | 核心结论 |
|---|---|
| 前端生态 | 保持自研轻量 UI；立即用 clsx / TanStack Virtual / react-markdown / Embla；值得评估 TanStack Query / TipTap / dayjs / Recharts；组件库仅参考 |
| 后端与 SQL | 保持 node:http 零框架；零依赖收窄注入面；值得评估 zod / kysely / rate-limiter-flexible / jose / argon2 / pino；修正三处事实（node-pg-migrate MIT、slonik BSD-3、BullMQ v6 已支持 PG） |
| 免费服务与 CI | UptimeRobot 50 监控器 / Sentry 5k errors/月 / Grafana Cloud 10k 指标；备份链 pg_dump+restic+rclone→B2（前 10GB 免费）/R2（10GB+零出口费）；CI 用 GitHub Actions + Gitee Go 兜底 |
| AI 能力 | EdgeOne Makers 50 万 token/月（官方核实）+ 智谱 GLM-Flash 全免费 + 豆包/百炼新人包；UGC 审核必须专业 API（腾讯/阿里内容安全试用包），禁止大模型 prompt 替代；自托管 LLM 不建议 |
| 多端构建 | tauri-plugin-updater + tauri-action 桌面分发核心；Capacitor 8 官方插件作适配层原生后端；OTA 走自托管 live-update（Capgo 已无免费层）；鸿蒙原生 ArkTS+ArkWeb |
| 同类与网络 | GPL 族（NodeBB/Discourse/Lemmy/mall4j）只看不抄；MIT/Apache（litemall/macrozheng-mall/shadcn）可借鉴登记；边缘层首选 EdgeOne（与已有 `.edgeone/` 同账号）；acme.sh 全自动；**备案是境内硬约束**；宁波家宽公网 IPv6 大概率可用 |

**Top 10 高价值资源**：
1. 腾讯 EdgeOne（免费套餐 + Makers 50 万 token/月，双免费且已有 `.edgeone/`）
2. GitHub Actions（2000 分钟/月，已在用）
3. Cloudflare R2（10GB + 零出口费，`/api/storage/*` 最优云落点）
4. 智谱 GLM-4.7-Flash（全免费）
5. Sentry Developer Free（5k errors/月）
6. restic + rclone + B2（加密异地备份链）
7. TanStack Query（值得先单模块试验）
8. tauri-plugin-updater + tauri-action（桌面端分发）
9. 腾讯云内容安全（3000 条试用，UGC 合规刚需）
10. acme.sh/certbot（证书 0 成本全自动）

诚实标注：Codeup/AtomGit/CNB 及 Arco/AdminLTE/又拍云的官方现行数字未检索到，分文件已注明需人工复核。本次为纯只读调研，未修改任何代码。

---

## 10. 验证与验收汇总

| 验证项 | 结果 |
|---|---|
| `npm run typecheck` | ✅ 0 错误 |
| `npm run build` | ✅ 通过 |
| `npm run test`（vitest） | ✅ `tests/` 下 2 个文件（`core-utils.test.ts`、`platform-contract.test.ts`）全过 |
| `server:check`（node --check ×10） | ✅ 通过 |
| 连库实测 loadtest V1–V8 | ✅ 7/7 通过（真实数据回填） |
| YAML 解析（workflows + .gitee + wrangler） | ✅ 全过 |
| bash -n（install/init-db/bootstrap/init-multi-remote/cleanup-images/backup） | ✅ 6/6 |
| 占位符残留（your-org/app-core/crpi-xxxx） | ✅ 0 |
| Docker 依赖 | ✅ 仅「禁止容器化产物」闸门 + N/A 决策说明 |
| nginx 安全头 | ✅ CSP/X-Content-Type-Options/X-Frame-Options/Referrer-Policy |
| 路由一致性 | ✅ 57/57（case 标签探针） |
| 版本载体 | ✅ 9/9 文件层（tag 层 GAP-01 为发版决策） |

---

## 11. git 提交记录（自基线 c0ab01a 后 20 条）

```
24102f4 chore: 补 verify:feed/mobile/desktop-regress npm 入口
dc28084 docs: 对齐前后端契约与 env 模板，新增本轮 gap 登记
366e590 test: 连库实测 V1-V8 全绿并回填分析文档
f235916 fix(worker): 修复网关类型与状态码缺口
bc506ca docs: env 模板补齐可选边缘层变量 + README 追加 3.txt 交付清单对照表
1b7aaf7 feat(deploy): 新增一键重建/备份/制品清理脚本（无 Docker）
0791425 feat(worker): 新增可选边缘层 Worker 网关与 D1 只读副本迁移
e4f55f8 fix: 秒杀多单累计锁按订单粒度精确释放（BE-002）
5547325 feat: 早前会话前端与脚本调整        ← 已推送（8 个已推的最早边界）
e6b736d feat: 只读增量同步端点
6751e2a feat: 平台适配层与契约测试
1213b3f feat: 商城 P1 实现（出票/秒杀锁清理/购物车拆单）
84dad87 ci: workflow 与 Gitee 流水线落地
dec51ab deploy: 无 Docker 部署方案落地
79e66b2 docs: 模块分析与代码审查报告
864c710 docs: 归档历史文档并刷新现行规范
```

**推送状态**：已推 8 个（`5547325` 及更早）；**未推 8 个**（`e4f55f8`、`0791425`、`1b7aaf7`、`bc506ca`、`f235916`、`366e590`、`dc28084`、`24102f4`），`main` 领先 `origin/main` 8 个 commit。工作树仅余排除项：`.workbuddy/`、`3.txt`、`artifacts/`、`docs/research/`（调研产物按要求独立存放）。

---

## 12. 遗留事项与待决策（均已如实登记，未擅改）

| 编号 | 内容 | 类型 | 建议 |
|---|---|---|---|
| BE-003 | SVG stored-XSS（对象存储内联返回） | 安全策略 | 对象回读加 `CSP: default-src 'none'`，需确认 |
| BE-005 | 同毫秒游标漏行（0006 触发器 clock_timestamp） | 已复现 | 迁移或游标语义调整，需确认 |
| GAP-01 | version:check 因历史 tag（V0.0.0.0 + 回滚锚点）红 | 发版决策 | 发版打 V0.1.0.0 并决策脚本容忍度；锚点已文档化不可删 |
| GAP-03/04 | 成长引擎两端口径、商户核销页 | 产品/架构 | 需决策 |
| worker | `wrangler deploy` 未实跑（需 Cloudflare 账号） | 启用阶段 | 手动操作 |
| worker | npm install 需 `--legacy-peer-deps` | 已知 | 已如实反映在 package.json 注释 |
| 调研 | Codeup/AtomGit/CNB、Arco/AdminLTE/又拍云官方数字 | 待人工复核 | 分文件已注明 |
| CI | workflow 需配 Secrets 后真实触发 | 待配置 | OCI_HOST/OCI_USER/OCI_SSH_KEY/CF_TOKEN/EO_TOKEN 等 |

---

## 13. 产物索引

| 类别 | 路径 |
|---|---|
| 综合报告 | `Mim项目综合报告.md`（本文件） |
| 模块分析 | `docs/analysis/商城四业务并发与退款分析.md`、`docs/analysis/平台适配层契约分析.md` |
| 代码审查 | `docs/review/代码审查报告.md`、`docs/review/前端-审查.md`、`后端-审查.md`、`脚本部署-审查.md` |
| 缺口登记 | `docs/gaps.md` |
| 互联网调研 | `docs/research/互联网资源调研.md` + `docs/research/artifacts/01~06-*.md` |
| 部署手册 | `deploy/README.md`（含 3.txt 对照表） |
| 部署脚本 | `deploy/install.sh`、`init-db.sh`、`bootstrap.sh`、`mim-server.service`、`nginx-mim.conf`、`logrotate-mim.conf` |
| 运维脚本 | `scripts/backup.sh`、`cleanup-images.sh`、`loadtest-v1-v8.mjs`、`server-health.mjs`、`verify-*.mjs`、`sync-pull.mjs` |
| CI | `.github/workflows/`（deploy/build/build-release/deploy-release/mirror/release-notes）+ `.gitee/pipeline.yml` |
| 可选边缘层 | `worker/`（src/index.ts + wrangler.jsonc + package.json + migrations/0001_init.sql） |
| 文档 | `docs/README.md`（索引）、`docs/archive/`（归档）、`docs/rebuild/`（现行规范） |
| 迁移 | `server/db/migrations/0001~0008` |

---

*报告完。项目当前状态：全部任务完成、验证通过、16 项产物落盘；8 个 commit 待推送（等确认）。*
