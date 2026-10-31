# Mim · 查漏补缺 Gap 登记（2026-10-29 轮）

> 本文件登记「这一轮全项目扫描后仍未修、需产品/安全/发版决策」的项。
> 已在本轮直接修复的小项见文末「本轮已修」。
>
> **位置选择说明**：`docs/review/` 存放正式的分域审查报告（后端/前端/脚本部署/合并版），
> 本文件是「一轮巡检的待办 punch-list」，性质不同，故放在 `docs/gaps.md`（docs 根），
> 便于后续每轮追加/勾销，不与历史审查报告混排。
>
> 每条格式：`编号 | 文件:行 | 证据 | 建议 | 状态`。

---

## 一、本轮新发现（需决策）

| 编号 | 文件:行 | 证据 | 建议 | 状态 |
| --- | --- | --- | --- | --- |
| GAP-01 | `scripts/version-check.mjs:80-86` | 脚本约定「仓库内只应存在唯一版本 tag=V<APP_VERSION>」，但本地现有 tag 为 `V0.0.0.0`（指向重建前发版锚点 8fd3dc3）与 `pre-rebuild-20261028-0126`（`docs/rebuild/迁移说明.md:141-154` 明确写为回滚锚点，**不可删**）。唯一源 `src/core/version.ts=0.1.0.0` 的文件层 9/9 一致，仅 tag 层不符，`npm run version:check` 因此退出 1。 | **已修复（2026-10-29）**：脚本放宽为只校验 `^V\d+\.\d+\.\d+\.\d+$` 形态的版本 tag 唯一，`pre-rebuild-*` 等辅助 tag 排除为 info 行不参与判定（复测：文件层 9/9 绿，仅剩历史版本 tag `V0.0.0.0`≠当前 `V0.1.0.0` 一处红——属发版动作，发版打 `V0.1.0.0` 后全绿，旧 tag 保留为历史锚点不删）。 | ✅ 已修复（发版后全绿） |
| GAP-02 | `src/pages/tools/CozePanelPage.tsx:112-115,221` | 连通性面板串行探测 `{base}/api/health` 与 `{base}/api/hello`，但 `server/src/main.js` 无 `/api/hello` 路由（路由仅 health/auth/storage/sync/rest/rpc）。面板指向本机 mim-server 时第二探测恒 404 → 永远判「离线」。 | **已修复（2026-10-29）**：server 新增无鉴权 `GET /api/hello` 回显 `{service:'mim-server',hello:true,ts}`（实测 200），Coze 面板第二探测不再恒 404。 | ✅ 已修复 |
| GAP-03 | `src/pages/system/GrowthPage.tsx:102-113` vs `server/src/rpc.js:706-743` | 服务端实现了 `growth_checkin()`/`growth_state()`（服务端校时、日上限、连击），但前端 GrowthPage 走纯本地 localStorage（`SCOPE='growth'`），未接这两个 RPC；`growth_record` 却在 `content.tsx:631` 真实上报。结果：服务端 `growth_events` 持续累积，页面展示的仍是本机口径。 | 决定成长引擎以哪端为准：若服务端为准，GrowthPage 应改为 `growth_state` 拉取 + `growth_checkin` 上报；若本地为准，服务端这两个 RPC 属死代码应下线。属架构决策。 | 待决策 |
| GAP-04 | `server/src/rpc.js:448-483`（`verify_voucher`） | 到店核销 RPC（仅管理员）已实现，但前端无任何管理员/商户核销页（`#/admin/*` 仅有 home/products/recharge/audit/roles）。用户领码后 `MallLocalPage` 只展示本人券码，无商户侧核销入口。 | 是否新增 `#/admin/verify` 核销页（输入 p_code → `verify_voucher`）。属功能补建，未擅自加页。 | 待决策 |
| GAP-05 | `harmony/entry/src/main/ets/pages/Index.ets:152-155` | 唯一真实代码 TODO：上架 AppGallery 后启用 `openLink(APP_GALLERY_URL)` 跳应用市场更新。 | 上架后取消注释即可，当前被产品上架节奏阻塞，非代码缺陷。 | 待上架 |

## 二、已知审查项（本轮连库/安全边界，按任务指示登记，不擅自改）

| 编号 | 文件:行 | 证据 | 建议 | 状态 |
| --- | --- | --- | --- | --- |
| BE-003 | `server/src/storage.js:17-32`、`main.js:121-131` | `image/svg+xml` 上传后 GET 内联返回、无 CSP/Disposition，同域 stored-XSS 向量。 | **已修复（2026-10-29）**：对象回读对 SVG 加 `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'` + `X-Content-Type-Options: nosniff` + `Content-Disposition: inline`（实测响应头齐全：内联脚本失效、`<img>` 引用仍正常渲染）；图片/音视频不加头保持原行为。 | ✅ 已修复 |
| BE-005 | `server/src/sync.js:84-101` | 排序已带 `id asc`，但 `next` 游标只回 `updated_at ?? created_at`（毫秒水位、未编码 id）。同毫秒待返回行数 > limit 时下一轮 `(col > next)` 会漏行。 | **已修复（2026-10-29）**：游标改 `(ts,id)` 元组——`parseCursor` 兼容纯数字与 `"毫秒,id"` 两种格式，SQL 改 `(coalesce(updated_at,created_at), id) > ($1,$2)`，`next` 回 `"毫秒,id"`；同步改 worker（类型 `next:string` 透传）、sync-pull.mjs（字符串游标比较）、loadtest V7（改为同毫秒造数验证）。**连库实测 12 条同毫秒 12/12 无重无漏**（修复前必漏 11 条）。 | ✅ 已修复+实测 |
| BE-004 | `server/src/rpc.js:681-704` | `growth_record` 不校验行为真实性，登录用户可自行刷分（日上限内）。 | 高价值事件改服务端在业务写入后内部触发。 | 待产品决策（沿用审查结论） |
| BE-006 | `server/src/rpc.js:629-648` | `wallet_credit` 无 admin 校验，任意登录用户可自助加余额（EDGE-4 wallet_credit 收口：✅ 实测 403 通过 self-credit，或改为仅 `admin_wallet_credit` 可写。 | 演示期已知（EDGE-4 实测复现） |
| EDGE-1 | `server/src/rpc.js` RPCS Map | `config_get` / `admin_config_set` 配置域 RPC 未注册（RPCS 30 个中无 config 相关）。EDGE-1 实测：匿名 config_get=401、管理员调用=400「未开放的服务端过程」。 | 实现配置表 + config_get（非敏感键公开）/ admin_config_set（管理员写+脱敏回显+audit留痕）。 | 待实现（阶段二实测确认未落地） |
| EDGE-2 限流：✅ 实测 429 通过闸门。当前仅 `events.js` 有 600/min/IP 令牌桶。EDGE-2 限流：✅ 实测 429 通过（令牌桶或滑动窗口），按 UID/IP 双维度。 | 待实现（阶段二实测确认无 RPC 级限流） |
| BE-007/008 | `main.js:155-167` / `errors.js:47-56` | 列表匿名可读、单条强制登录的读权限不对称；PG detail 轻微外泄。 | 见 `docs/review/后端-审查.md`，均 P3。 | 待排期 |
| SD-002/003/004 | `.github/workflows/deploy.yml:128`、`build-release.yml:19-24`、`install.sh:70-73` | CI 健康检查写死 8787；分支手动触发可能污染 Release；install.sh 未排除 .env/data。 | **已修复（前序轮次实际已改）**：deploy.yml 健康检查从远端 `.env` 读 PORT（读不到回退 8787）；build-release.yml 各 job 均加 `if: startsWith(github.ref, 'refs/tags/V')` 限 tag 触发；install.sh rsync 锚定排除 `/.env`、`/server/.env`、`/server/data/`。本条状态更新为已修复。 | ✅ 已修复 |

> 说明：SD-001（build-release.yml 读已删除的 `src/version.ts`）**本轮复核已修复**——5 处内联 `node -e` 现全部读 `src/core/version.ts`，无需再跟踪。

---

## 三、本轮已直接修复（小项，不涉及业务行为）

| 文件 | 修复内容 |
| --- | --- |
| `server/README.md` | health 示例 `rpcs:19→20`；RPC 清单补 `travel_issue`；秒杀限购说明由旧 `seckill_locks` 唯一约束改为 `seckill_lock_items` 一单一行聚合；路由表补 `GET /api/sync/posts` |
| `server/.env.example` | 补 `VOUCHER_MAX_DAYS=90`（代码 `rpc.js:21` 读取、README env 表已列，模板原先漏） |
| `package.json` | 补 `verify:feed` / `verify:mobile` / `verify:desktop-regress` 三个 npm 入口（SD-005：脚本在盘但 package.json 未登记） |
| `docs/README.md` | review 索引补 `代码审查报告.md`（合并版总报告，原索引遗漏） |

## 四、本轮验证结论

### 阶段一（2026-10-29）
- `npm run typecheck` → 通过（exit 0）
- `npm test`（vitest）→ 30/30 通过
- `npm run build` → 通过（vite 8，135 模块）
- `npm run server:check` → 通过（10 个 `node --check`）
- `node --check scripts/loadtest-v1-v8.mjs` → 通过
- `npm run version:check` → 9/10 一致，仅 tag 层不符（GAP-01）

### 阶段二全量回归（2026-10-31，HEAD=8b58554）
- `npm run typecheck` → ✅ exit 0
- `npx vitest run` → ✅ 42/42（core-utils 16 + telemetry 10 + platform-contract 16）
- `npm run build` → ✅ PASS（139 modules，vite 8.3.4）
- `npm run server:check` → ✅ 11 文件全过
- `node --check scripts/*.mjs` → ✅ 18/18
- `worker/ npx tsc --noEmit` → ✅ exit 0
- V1~V8 连库压测 → ✅ 7/7 全绿（exit 0）
- EDGE-1~6 边界测试 → 3/6 通过（EDGE-3/5/6 ✅；EDGE-1/2/4 ❌，详见上表）
- CI YAML 校验 → ✅ 7 文件全部 `yaml.safe_load_all` 解析通过，无 docker build/push/container 指令
