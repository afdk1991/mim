# Mim

> **项目名称：Mim**（用户 2026-11-09 18:50 统一定名）。仓库目录、npm scope `@mim/*`、仓库名 `mim` 均与项目名称一致；现役生产入口为 `https://zy.laal.top`（API `https://api.laal.top`，后台 `https://zy.laal.top/admin/`），旧域名 `mim.mixm.top` 已无 Mim 部署、仅 301 → `zy.laal.top`。协作铁律见 [AGENTS.md](./AGENTS.md)。

## 项目主题

**主题**：IM 即时通讯 + 社区内容与社区商城，一套 Node/TypeScript 全栈、多平台发布的跨端协作平台。

主题词与归属分类全部取自 [Gitee Explore](https://gitee.com/explore) 的真实分类（不自造分类名）：

| 归属 | 分类 | 链接 | 对应已实现功能 |
|---|---|---|---|
| 主 | IM即时通讯/聊天 | https://gitee.com/explore/im | `/chat` 单聊 / 群聊 / 引用回复 / 撤回 / 文件图片消息、WebRTC 视频通话 |
| 主 | WEB应用开发 | https://gitee.com/explore/web-app-develop | `apps/web` SPA（深链接回退四件套）、`apps/admin` 管理端前端 |
| 辅 | 后台管理框架 | https://gitee.com/explore/backend | `/admin/` 商城与订单运营视图、管理类 `/api/v1/*` |
| 辅 | 多媒体 | https://gitee.com/explore/multimedia | WebRTC 音视频链路（聊天视频通话）、图片 / 文件消息的预签名收发 |

分类与标杆项目对标、以及「Gitee 仓库无主题字段」的实测结论见 [docs/项目主题与Gitee-Explore分类映射-20261112.md](./docs/项目主题与Gitee-Explore分类映射-20261112.md)。

## 许可证

本项目采用 **MIT License**，全文见 [LICENSE](./LICENSE)（`Copyright (c) 2026 Mim project contributors`）。

- 若后续需要专利授权条款，可整体替换为 Apache-2.0：删除本仓库 `LICENSE` 并换入 Apache-2.0 全文，同时改本节与 Gitee / GitHub 仓库页的许可证标识，属一次性可逆改动。

## 版本

- 当前版本：**V0.0.18-preview**（2026-11-25「借鉴标杆落地」：合规静态页体系 `/legal/privacy|terms|refund|help`、独立 404 视图、根级错误边界、个人中心成长等级 / 徽章 / 收藏 / 圈子 / 我的举报聚合、圈子关键词 + 分类筛选、列表骨架屏、备案号入站点选项；RELEASE_CHANNEL=preview 由展示后缀体现，不改 semver 数字）

## 社区内容现状（2026-11-20）

> 本节为现行口径；下文「版本」各历史变更条目与早期章节中访客自动建号 / 模块商城 / 漫剧 / 入口清单 / 导航站 / 统一搜索等描述，均为各轮交付快照，按铁律三保留作历史留痕，**不再作为现状引用**。2026-11-24 全仓闭环审计轮又收口：已删错误码（`AUTH_PASSWORD_NOT_CONFIGURED` / `ACCOUNT_REGION_MISMATCH` / `PAYMENT_REQUIRED` / `COST_LIMIT_EXCEEDED` / `GENERATION_FAILED`）、已删校验脚本（`verify-site-modules` / `verify-entry-manifest` / `verify-site-directory`）、已删前端 `release-notes.ts` 与入口清单 `siteModules.json` 的相关表述，一律以历史快照对待，现行门禁与真源计数见 [AGENTS.md 2026-11-24 覆盖段](./AGENTS.md)。

> **现行状态覆盖（2026-11-25 晚，错误码治理 + gap-scan 收口 + 前端视图拆分）**：版本仍 **V0.0.18-preview**（HEAD `00713fa`，无新业务模块、semver 未递增）。`VIEW_SEGMENTS` **10** 段；`apps/web/src/views/` 顶层 **18** 个 `.tsx` 视图 + `chat/`、`community/` 子模块目录 **5** 个拆分产物；`apps/admin/src/views/` **23** 个视图；后端 `routes/` **29** 个路由模块；数据库 **113** 张表。错误码注册表 **41** 码逐一 grep 取证全部存活、零删除，仅订正两处脱节注释（取证表 [docs/错误码治理-20261125.md](./docs/错误码治理-20261125.md)）；gap-scan 嵌套子组件不再误报 WARN、子目录不参与视图注册扫描；`Chat.tsx` / `Community.tsx` 拆出纯函数 / 文案映射 / 气泡 / 骨架屏子模块，对外路径与导出符号不变。门禁复测：`@mim/api` **62 文件 / 571 例**、`@mim/web` **3 文件 / 28 例**、三套构建 0、`verify-deployments` 55/55、`verify-auth-gate` 149/149、`verify-custom-domains` 20/20、`gap-scan` PASS。后端 `routes/community.ts`（67 端点）本轮未拆，方案见交付报告。

- **生产入口**：前端 `https://zy.laal.top`，API `https://api.laal.top/api/v1`，后台 `https://zy.laal.top/admin/`；裸域 `laal.top` 是独立 WordPress（zibll）社区站，与本项目无关。
- **现行前端视图段**（唯一真源 `apps/web/src/router.ts` 的 `VIEW_SEGMENTS`，共 10 个）：`/home`、`/community`、`/circles`、`/chat`、`/account`、`/checkout`、`/pay-return`、`/signin`、`/legal/<privacy|terms|refund|help>`（多段合规静态页）、独立 404 视图（未知路径落点，不对外挂导航）；无 `/cart` 视图；商城 / 入口清单 / 漫剧 / 导航站 / 统一搜索 / 云存储 / 图床 / 下载分发等旧段已随模块下线，仅作历史别名；未命中任何段的路径渲染独立 404，不再静默回落首页。
- **门禁**：匿名默认可读（公开内容 200），个人与资金路径要求登录，写操作一律 401 `AUTH_UNAUTHORIZED`；自助注册由 `MIM_REGISTRATION_ENABLED` 控制且默认关闭（403 `AUTH_REGISTER_DISABLED`）；`POST /auth/guest` 已删除；口令只认库内 `credentials`，环境变量超管口令已不生效。
- **圈子**：`GET /circles` 匿名 200，前端匿名渲染清单与空态，加入 / 发帖 / 审核等写操作引导登录。
- **社区检索口径（缺陷 D7 决策）**：检索以中文为准；英文仅整词子串、ASCII 大小写不敏感匹配，不保证复数 / 时态 / 词干变体召回；英文词形归一接入属独立检索语义改造项。
- **生产社区盘点**（2026-11-19/20 只读库内 count + 公开 API 交叉核对）：版块 7、帖子 18、回复 0、图库 / 视频媒体 9、合集 2、圈子 0、公告 16（15 发布 + 1 草稿）、更新日志 11、付费资产 5。
- **留档产物**（`reports/` 目录整体不入库，仅本地留档）：`reports/社区内容全量接管-20261120/` 下 `生产库盘点/盘点摘要.md`、`生产库盘点/内容修复记录.md`、`源码核对/修复与上线取证.md`、`源码核对/community_defects.md`、`浏览器验收/browser_report.md` 与 `browser_check.json`。

版本号规约（与 [AGENTS.md 铁律四](./AGENTS.md#铁律四版本号每次添加功能模块更新等等规约与-readme-同步) 同步）：

- 首个对外正式发布版本 = **V0.0.0**，此后按 V0.0.1、V0.0.2… 递增，发布前不得占用。
- 内部 / 预览 / 草稿构建用 `RELEASE_CHANNEL`（`preview` / `draft` / `test`）区分，展示为 `V0.0.0-preview` 等，**不改 semver 数字**。
- 内部 git tag 命名为 `draft-*` / `pre-*`，不得为 `V<semver>` 形态。
- 校验由 `scripts/version-check.mjs` 强制。
- **2026-11-12 功能变更（社区与商城二期：媒体 / 投票 / 收藏评分 / 付费板块 / 积分转账 / 微信 Native / 支付宝 WAP / 验证码 / 举报审核）**：新增 8 张幂等表（`community_thread_media`、`community_poll_options`、`community_poll_votes`、`community_favorites`、`community_ratings`、`community_board_memberships`、`content_reports`、`captchas`）。① 帖子形态闭环：图集 / 视频 / 剧集帖写多图或视频并返回 `media[]`，前端渲染图片网格与视频播放器；投票帖 2–10 选项、计票、百分比、改投；发帖按形态强校验媒体与选项，媒体 URL 过 SSRF 校验，标题 / 正文过 `auditText` 内容审核。② 收藏与评分：收藏开关 / 我的收藏、1–5 星评分 upsert，列表 `sort` 扩展为 `latest / hot / views / replies / favorites / rating`，详情回 `favorited / rating_avg / rating_count / my_rating`。③ 付费板块：`community_board_memberships` 付费加入、VIP 免单、余额扣款写流水，`hasBoardAccess` 统一校验，未加入隐藏正文 / 回复 / 媒体且禁止发帖，前端区分板块与帖子两种付费墙。④ 积分转账 `POST /wallet/points/transfer` 按 Mim ID 到账，双方各写流水，余额不足 / 转自己 / 收方不存在均拒绝。⑤ 支付：微信 Native 下单 + API v3 RSA-SHA256 签名 + 回调验签 + AES-256-GCM 解密 + 金额 / `trade_state` 校验；支付宝手机网站支付 `alipay.trade.wap.pay`；`createIntent` 支持 `qr / wap / app` 并返回 `pay_url`；`express.json` 保留 `rawBody` 供回调验签。⑥ 安全：`GET /auth/captcha` 本地 5 位 SVG、答案只存 sha256、10 分钟一次性；`MIM_CAPTCHA_REQUIRED=1` 时 `/auth/code` 强制校验且登录页自动展示验证码；`GET /security/status`、`POST /reports`（24 小时 5 条限流）、`GET /reports/mine`、运营列表与处置（隐藏帖子 / 删回复 / 下架商品 / 隐藏资产）；`assertPublicHttpUrl` 拒绝 localhost / 私网 / 回环 / 链路本地 / IPv6 映射；百度文本审核可选接入。验证：`pnpm -r typecheck` 5/5、`pnpm --filter @mim/api test` **32 文件 / 431 例全过**、`pnpm --filter @mim/web build` 成功；本地强制验证码实测无码 `VALIDATION_FAILED`、带正确码 `delivery=dev`。交付说明见 [docs/社区与商城二期落地说明-20261112.md](./docs/社区与商城二期落地说明-20261112.md)。仍未配置的外部凭证（微信商户号、支付宝商户、百度审核 Key、快递查询、Meilisearch 实例）保持「明确不可用 / 降级」口径，不假装可用。
- **2026-11-08 功能变更**：补齐「成片导出」全链路（后端 `POST /api/v1/comic/films/:id/export` 早已存在但前端 0 代码，本轮接通前端入口、转码降级与契约测试）。当前仍处 `preview` 通道，按上述规约**只记录模块变更、不改 semver 数字**，展示版本保持 **V0.0.0-preview**；首个对外正式发布版本仍为未占用的 V0.0.0。
- **2026-11-09 功能变更**：按 DNSPod `mixm.top` 工作表 45 类备注新增「站点模块矩阵」（45 模块 / 135 功能点 / 90 条演示数据 + 共享注册表 `packages/core-domain/src/siteModules.json` + `/api/v1/sites*` 7 端点 + `site_module_items` 表 + `/sites` 前端视图 + 14 例契约测试 + 43 项校验）。交付说明见 [docs/站点模块开发落地说明-20261109.md](./docs/站点模块开发落地说明-20261109.md)。同上仍处 `preview` 通道，**只记录模块变更、不改 semver 数字**，展示版本保持 **V0.0.0-preview**。全量验证终值（2026-11-09 23:07 实测）：`npm run check` 0、`pnpm --filter @mim/api test` **13 文件 / 188 例全过**、`comment-check --strict` 通过、`build:web` 成功、`verify:site-modules` **43/43**、`verify:site-directory` PASS、xls ↔ 注册表双向比对 **0 差异**、Edge CDP `/sites` 真渲染 **27/27 PASS**（详见 [交付说明 §5](./docs/站点模块开发落地说明-20261109.md)）。
- **2026-11-09 23:35 功能变更（统一入口配置清单轮）**：在上一轮基础上按用户新指令升级为**统一入口配置清单**——45 类备注去重整理（两行 `@`→`AT_ROOT`、11 行空白→`BLANK_UNSET`、重复备注合并 45 项），**不补写具体主机值**，统一可配置占位标识 `{{HOST:<ENTRY_KEY>}}`（运行期由 `MIM_HOST_*` 注入），按「入口｜业务系统/模块说明」划分为 **19 个业务域**；新增核心功能 / 职责边界 / 后台接口职责 / 相似模块关联与区分（均为实现推导，非备注原文）。单一数据源 `packages/core-domain/src/siteModules.json`（schema `mim.site-modules.v2`）升级，新增后端 `/api/v1/entries*` 6 只读清单端点，前端 `/sites` 升级为统一入口配置清单视图，配套 `config/entry-hosts.example.json` 占位模板、`docs/统一入口配置清单-20261109.md` 可读清单、`docs/统一入口配置清单与模块化实现说明-20261109.md` 交付说明。全量验证终值（2026-11-09 23:35 实测）：`npm run check` 0、`pnpm --filter @mim/api test` **15 文件 / 211 例全过**、`comment-check --strict` 通过、`build:web` 成功、`verify:site-modules` **79/79**、`verify:entry-manifest` **23/23**、xls / 用户文本 ↔ 清单双向比对 **0 差异**、Edge CDP `/sites` 真渲染 **26/26 PASS**。仍处 `preview` 通道、零 git 写操作。

- **2026-11-09 功能变更（部署汇总）**：新增「部署汇总」模块——单一事实源 `packages/core-domain/src/deploymentRegistry.json`（9 矩阵平台 / 11 规范部署项 / 5 CI 作业 / 2 git 远端 / 6 候选排除项）+ 共享包 `deploymentRegistry.ts` + 公开只读 `/api/v1/deployments*` 3 端点 + `/deployments` 前端核对表 + 结构化产物 `docs/deployment-summary.{json,md}` + 生成器 / 校验器 + 10 例契约测试。统一字段（仓库标识 / 部署状态 / 部署结果 / 异常说明）并对空数据、失败状态、缺失信息分别标识；仍处 `preview` 通道，**只记录模块变更、不改 semver 数字**，展示版本保持 **V0.0.0-preview**。同步清单见 [AGENTS.md §13](./AGENTS.md)。
- **2026-11-11 变更（对外路径段统一为模块功能名称）**：按用户「所有平台的访问域名 `https://XX.XXX.top/XXX` 里的路径段全部改成模块功能名称」指令，把前端对外地址的路径段与内部视图标识解耦，统一由 [router.ts](./apps/web/src/router.ts) 的 `VIEW_SEGMENTS` 一处定义：`/store → /marketplace`（商城）、`/sites → /entry-catalog`（入口配置清单）、`/comic → /comic-studio`（漫剧 AI 剧）、`/login → /signin`（登录），`/chat`、`/settings`、`/deployments` 原段名本身即功能名保持不变。旧段名保留兼容层（前端 `LEGACY_SEGMENTS` 原地改写 + 生产 nginx 四条 `location =` 301），旧书签与外链不失效。各平台回退规则均为 `/* → /index.html` 通配，改名后自动生效；构建期 `dist/<模块功能名>/index.html` 目录、入口页内联脚本的视图段清单、nginx CSP 的内联脚本 sha256 已同轮同步更新（`sha256-Q4BFbQUCW5bmauOy9Zn8D1km5RItTJrk6r3tkodIR0M=`）。后端接口前缀 `/api/v1/*` 与管理后台 `/admin/` 不在本次改名范围（前者是版本化接口命名空间、后者是静态入口，均非功能模块名）。
- **2026-11-12 功能变更（Mim ID 自动分配 + 9 家第三方登录）**：① 新增对外编号 `users.member_no`（形如 `MIM-10000001`），由单行发号表 `member_no_sequence` 在事务内自增分配，与内部 uuidv7 主键解耦；唯一索引 `uq_users_member_no` 走 `ADDITIVE_INDEXES` 增量迁移，启动时 `backfillMemberNos` 为历史用户按 `created_at ASC` 补齐号码，登录时 `ensureMemberNo` 兜底补号。全部建号入口统一收敛到 `identity.ts` 的 `createUser`，因此**自助注册、验证码首登、密码首登、第三方首登**都会拿到号码，`/auth/register`、`/auth/password`、`/auth/login`、`/auth/refresh`、`GET /me`、`GET /me/oauth` 均回传 `member_no`。② 引入 9 家第三方登录：GitHub / Gitee / GitLab / Google / Apple / Microsoft / 微信 / QQ / 抖音，注册表 `services/mim-api/src/oauth/providers.ts` 统一描述端点、scope、认证方式与资料映射。标准 OIDC/OAuth2 走 `oauth4webapi@3.8.8`（强制 PKCE S256 + state + ID Token 校验，Apple 用 p8 现签 ES256 client_secret），微信 / QQ / 抖音因协议差异走专用适配器（`appid` / `client_key`、`#wechat_redirect` 锚点、QQ 二次拉 openid、抖音 `data` 嵌套）。③ 安全模型：`state` 只存 sha256、10 分钟过期、回调即删；正式令牌不进地址栏——回调只带 300 秒一次性登录票据，前端 `POST /auth/oauth/exchange` 换取会话；绑定 / 解绑受「同一第三方身份不可绑到两个 Mim 账号」与「至少保留一种登录方式」两条约束。④ 前端：`/signin` 展示 9 家按钮（未配置凭证置灰并标注「未配置」），回调自动兑换并清理地址栏；注册成功先展示自动分配的 Mim ID 再进入工作台；`/account` 的「账号与设置」分区展示号码、已绑定第三方与解绑入口。⑤ 契约测试 `services/mim-api/test/oauth.test.ts` 13 例（号码连续性与回填、9 家授权参数、GitHub/微信全链路、state 伪造、票据一次性、绑定冲突、最后登录方式保护），用本地假提供方服务端，不依赖外网。新增依赖：`oauth4webapi@3.8.8`（标准 OAuth2/OIDC 协议实现）。新增环境变量见 [.env.example](./.env.example)「账号与身份」段；**未配置凭证的提供方在界面置灰、接口返回 `AUTH_OAUTH_NOT_CONFIGURED`，不会假装可用**。
- **2026-11-12 功能变更（统一入口落地状态对齐）**：在既有统一入口配置清单之上新增**落地状态四态层** `packages/core-domain/src/entryImplementation.ts`，把 44 个入口逐条对照项目现有真实模块标注 **已落地 4 / 部分相邻 19 / 规划中 19 / 语义冲突 2**；`realFeatures` 只登记代码里确实存在的视图 / 路由能力，未实现流程不臆造。后端 `/sites/overview`、`/entries/overview` 透出四态计数，列表与详情逐条带落地映射；前端 `/entry-catalog` 卡片渲染落地徽标、已落地功能清单与边界说明，已落地 / 相邻 / 冲突入口直达站内视图或独立后台，规划中入口隐藏演示条目与新建表单、显示规划空态。同步对齐清单规模口径为 44 入口 / 132 功能点 / 88 演示条目 / 116 关联 / 46 占位标识。配套修复：`/health` 版本号改为读取本包 `package.json` semver（不再硬编码 0.0.1），便于线上核对版本；种子启动时幂等清理已从注册表移除的孤儿 system 演示条目（已移除序号 02 的 `PORTAL_SITE` 2 条），用户自建条目 `created_by` 非 system、不受影响。全量验证终值（2026-11-12 实测）：`pnpm -r typecheck` 0、`pnpm --filter @mim/api test` **25 文件 / 373 例全过**、`verify:site-modules` **83/83**、`verify:entry-manifest` **23/23**、`verify:deployments` **55/55**、`verify:auth-gate` **39/39**、`verify:custom-domains` **20/20**、`npm run check` 0、四套构建 0。
- **2026-11-12 功能变更（导航站 NAVIGATION 落成真实模块）**：按「建业务模块 / 最容易实现闭环」的指令，把统一入口清单里的 **NAVIGATION（全站资源导航站）** 从目录条目升级为可运行功能：新增 `nav_links` 表（`schema.sql` 幂等建表 + 两个索引）与 7 条站内视图种子 `NAV_LINK_SEEDS`（`packages/core-domain/src/navigation.ts`，主键 `nav-seed-<n>`、`INSERT OR IGNORE` 不覆盖已探测状态、启动时按主键前缀幂等清理孤儿种子）；新增 6 个端点 `GET /navigation/summary`、`GET /navigation/links`（`q` / `group` / `status` / `recommended` 过滤）、`POST /navigation/links`、`PATCH /navigation/links/:id`、`POST /navigation/links/:id/check`、`POST /navigation/check`（浏览公开，写与探测 `requireAuth + idempotency`）；服务端探测为 GET + `redirect:'manual'` + 8 秒超时 + `user-agent: mim-navigation-probe/1.0`，2xx/3xx 记 `ok`、4xx/5xx 与网络异常记 `broken`，回写 HTTP 码 / 耗时 / 探测时间，站内相对路径按 `MIM_PUBLIC_ORIGIN` 补齐（缺省 `https://mim.mixm.top`）；前端新增 `/navigation` 视图（目录概览三态计数、关键词检索、分组筛选、分组列表、单条与全量「检测」、推荐位切换、收录表单、外部链接 `target=_blank`）；落地状态四态层同步把 `NAVIGATION` 标为 `implemented` 并指向 `/navigation`，计数变为 **已落地 5 / 部分相邻 18 / 规划中 19 / 语义冲突 2**（上一条登记的 4/19 为落地前口径）。契约测试 `services/mim-api/test/navigation.test.ts` 9 例（用本地 `node:http` 服务做探测目标，不依赖外网）。
- **2026-11-12 功能变更（统一搜索 SEARCH）**：新增跨业务域的统一搜索模块，解决「模块商城、44 入口、导航站、社区帖子、独立商城各有各的检索」的割裂。后端 `services/mim-api/src/search.ts` 把五类数据统一收敛为 `SearchDocument`（`id / scope / title / subtitle / snippet / href / keywords / popularity / updated_at`），`GET /api/v1/search` 支持 `q`（必填，≤80 字）、`scope`（`all` / 单值 / 逗号多值）、`limit`（每来源 1–30，默认 8），返回按来源分组的命中与命中片段；标题完全相等 140 分、前缀 120、包含 95、副标题 +35、正文 +20，同分按热度与更新时间排序。`GET /api/v1/search/summary` 返回各来源文档数。引擎双轨：配置 `MIM_MEILISEARCH_URL` / `MIM_MEILISEARCH_KEY`（索引名 `MIM_MEILISEARCH_INDEX`，默认 `mim_search`）时优先走 Meilisearch，实例不可达、索引缺失或无命中时**自动降级 SQLite 本地检索**并在响应 `engine` 字段标明实际引擎；`POST /api/v1/search/reindex` 需 `module:read`（或超管引导令牌）把全量文档推送到 Meilisearch，未配置返回 503 `PROVIDER_NOT_CONFIGURED`，不假装可用。前端新增 `/search` 视图（关键词输入、六档来源页签、来源规模卡片、推荐词、命中高亮与分组列表），左侧导航新增「统一搜索」。契约测试 `services/mim-api/test/search.test.ts` 7 例（多来源命中、来源过滤、非法 scope、空查询、limit、summary、Meili 不可达降级、未配置重建 503 / 未登录 401）。本轮全量验证：`pnpm --filter @mim/api test` **28 文件 / 398 例全过**、api/web typecheck 0、web 构建 0。
- **2026-11-12 功能变更（商业化二期：支付 / 资产 / 履约 / 资金 / 外观 / 成长 / 国际化）**：新增 16 张幂等建表（`paid_assets`、`asset_purchases`、`payment_intents`、`payment_events`、`shipments`、`after_sales`、`product_reviews`、`withdrawals`、`creator_earnings`、`site_settings`、`page_blocks`、`badges`、`user_badges`、`direct_messages`、`user_signals`、`translation_cache`）与 5 个付费资产 / 5 个徽章 / 3 项设置 / 5 个页面区块种子。① **付费资产**：`/assets` 列表与详情、四类 `kind`（article/download/gallery/video）、未解锁只回 220 字试读且隐藏 `file_url`、余额 / VIP 免费 / 已购 / 作者四路解锁、作者 70% 分成记账。② **支付适配层**：`src/payments.ts` 统一 `manual / alipay / wechat / sandbox` 四渠道，金额一律服务端按资产 / VIP / 订单 / 充值规则计算；支付宝当面付 RSA2 预下单、微信 Native 缺证书明确 `PROVIDER_NOT_CONFIGURED`、沙箱 HMAC-SHA256 验签、`fulfillIntent` 幂等落到充值 / 资产 / VIP / 订单四类履约。③ **履约**：发货 upsert 运单与轨迹、本人 / 运营查轨迹、售后仅已付款或已发货可申请且金额取实付、运营通过即退款关单、一单一评与商品评分聚合。④ **资金**：提现申请先冻结扣余额（最低 10 元）、驳回退回、通过后可标记打款；创作者收益 `pending → settled` 逐条条件更新防重复入账；平台资金汇总。⑤ **外观**：`theme / locales / site` 白名单设置、页面区块 CRUD 与批量排序，首页 / 论坛 / 商城种子区块。⑥ **成长**：等级 `min(10, 1 + floor(points/300) + floor(orders/3))`、5 枚徽章自动发放、按 Mim ID 私信与未读 / 已读、IP 只存 SHA-256 哈希 + 粗粒度国家码。⑦ **国际化**：百度翻译适配（`MIM_BAIDU_TRANSLATE_APPID / KEY`，MD5 签名）与 `translation_cache` 去重，未配置明确 503；前后台语言可分离。新增权限点 `commerce:write` / `appearance:write` 并加入 operator 基线；运营端点仅挂 `requirePermission`（同时支持 Bearer 与 `x-admin-token`），幂等中间件对引导令牌使用固定作用域。前端新增 `/commerce` 商业化中台（资产 / 履约 / 资金 / 外观 / 成长国际化五页签）。契约测试 `services/mim-api/test/commerce.test.ts` 8 例全过；RBAC 期望同步为 10 个权限点。交付说明见 [docs/商业化二期落地说明-20261112.md](./docs/商业化二期落地说明-20261112.md)。仍未接：虎皮椒 / 讯虎 / PayPal / Stripe、快递查询供应商、短信验证码、图片 / 滑动 / 腾讯 / 极验验证码、百度内容审核、代理登录、Facebook / Microsoft / Twitter / 百度 OAuth、Redis/CDN；未配置供应商时对应能力返回明确错误或走手动 / 沙箱，不假装可用。
- **2026-11-12 功能变更（Mim ID 改为 QQ 号样式）**（⚠️ 本条中的「七类规则 / `1～99` 正常发放 / `renumber_v1`」口径已被同日二次收紧作废，现行口径见下一条）：按用户「彻底方案：从个位纯数字开始 + 全量重排 + 把所有靓号保留」指令，对外编号 `users.member_no` 由 `MIM-` 前缀 + 8 位补零（`MIM-10000001`）改为**纯数字**（`1`、`2`、`3` … 上限 `9,999,999,999`），位数随用户量自然增长，早期用户天然拿到更短的号。① 发号从个位 `1` 起，游标推进时跳过全部靓号；② 靓号规则收敛到 `services/mim-api/src/member-no.ts` 的纯函数 `classifyPremiumNo`，七类：豹子（`repeat`，3 位起全同数字）、顺子（`ladder`，连续递增 / 递减）、回文（`palindrome`）、对子（`abab`，`1212` 这类两位一组重复）、整百整千（`round`，末尾两个 0）、谐音吉利（`pronounce`，`520` / `1314` / `888` / `666` / `999` / `168` / `886` / `5188` 等）、生日号（`birthday`，合法的 8 位 `19YYMMDD` / `20YYMMDD`）；`1～99` 属短号段按注册顺序正常发放（若连个位号也预留，就与「从个位起发号」自相矛盾；如需整段保留，只改 `classifyPremiumNo` 一处）；③ 存量一次性全量重排 `renumberMemberNos`：按 `created_at ASC, id ASC` 依资历发最短可用号，先把号码列整体置 `NULL` 再逐个写新号以绕开唯一索引的中间态冲突，旧号逐条写入新表 `member_no_history`（`uuidv7` 主键 + `user_id` / `old_no` / `new_no` / `created_at`），完成标记落在新表 `member_no_meta`（`renumber_v1=done`），事务用 `immediate` 先拿写锁，多进程同时启动只有一个真正改号，重复启动返回空数组即幂等；④ 发号器同时校验「非靓号」与「未被人工占用」两个条件，`member_no_sequence` 单行表事务内读改写保证不重号，连续跳过超过 `1,000,000` 个号即抛 `MEMBER_NO_EXHAUSTED` 快速失败；⑤ 私信收件人校验由 `min(6).max(20)` 改为 `/^\d{1,10}$/`，前端输入框 `inputMode=numeric`、占位符改为 `100001`；⑥ 新增契约测试 `services/mim-api/test/member-no.test.ts` 14 例（七类靓号判定、短号段不判靓号、发号跳过靓号、已占用号不二次发出、重排顺序与审计、重排幂等、重排不占靓号）。本轮实测：`pnpm -r typecheck` 0、`pnpm --filter @mim/api test` **30 文件 / 422 例全过**；本地开发库副本（40 个存量用户）重排结果为 `1`～`40`、靓号占用 0、非纯数字残留 0、游标 `41`、审计 40 条，二次启动号码不变且审计不增。交付说明见 [docs/Mim-ID-纯数字靓号制-20261112.md](./docs/Mim-ID-纯数字靓号制-20261112.md)。
- **2026-11-12 变更（Mim ID 靓号规则二次收紧）**：按用户指令把 `1～99` **整段预留**（自动发号起点由 `1` 变为 `102`：`100` 整百、`101` 回文均在池内），并把此前「看着好记但没预留」的号纳入池子：新增 `repeatBlock`（重复段，`123123` / `12341234` / `100100`）、`staircase`（阶梯对子，`1122` / `112233` / `998877`）、`iconic`（经典号整串白名单，`007` / `1024` / `2048` / `4096` / `110` / `114` / `119` / `120` / `10010` / `10086` / `12306` / `95588`）三类判定，靓号类别由 7 类扩为 11 类。因为规则变了，`identity.ts` 的重排开关由 `renumber_v1` 升版为 `renumber_v2`，部署后启动期会**再重排一次**（旧号继续写 `member_no_history` 审计，`immediate` 事务 + `done` 标记保证只跑一次）。离线枚举（`1～1,000,000`）：预留 **43,670** 个（4.367%），首个可发号 `102`。**靓号仍然不自动发放**：发号器与重排遇到池内号码一律跳过，只能由运营 `UPDATE users SET member_no` 定向授予（唯一索引拦重复、发号器自动跳过已占用号）。`member-no.test.ts` 扩到 15 例（新增短号段、重复段、阶梯、经典号与「重排不退短号段」断言）。
- **2026-11-20 功能变更（站点选项后台 V0.0.16-preview：把主题选项后台 Global & Features 落成声明式配置）**：① **注册表** —— 新增 `services/mim-api/src/options/registry.ts`（10 个分组 / 40 个字段的声明式定义 + 类型自检 + 默认值 + 逐字段清洗夹取），一条字段声明同时驱动后台控件、接口校验与前端消费；② **接口** —— `GET /api/v1/site/options`（免登录只读公开字段，邮件分组不外泄）、`GET /api/v1/admin/site-options`（schema + 取值 + 最后保存时间）、`PUT`（`appearance:write` + 局部写入只提交改动键 + 未知键忽略）、`POST /admin/site-options/reset`（单键或全量恢复默认）；存储落在 `site_settings` 单条 JSON（key 为 options），不改既有 theme / site / home；③ **后台面板** —— 新增 `apps/admin/src/views/SiteOptions.tsx`（按 schema 数据驱动、分组级恢复默认、脏改动计数、只提交差异），导航新增「站点选项」，不写进并行在途的 `Settings.tsx`；④ **前端真实消费** —— `apps/web/src/site-options.ts` 规范化 + `applySiteChrome`（标题 / meta / favicon / 主屏图标 / 内容区宽度 / 圆角档 / 自定义 CSS），`Shell.tsx` 按开关控制吸顶、页脚、右栏、底部 Tab 项数与明暗 Logo，新增 `FloatingActions.tsx`（回到顶部 + 联系 + 分享渠道面板），`SearchPanel` 用后台占位文案、热门搜索词与默认排序 / 去同质；⑤ **验证** —— 新增 `test/site-options.test.ts` 9 例（默认结构 / 公开裁剪 / 脏值清洗 / 差异登记 / 匿名读 200 / 匿名写 401 / 管理员读写 / 重置 / 未知键忽略），`@mim/api` 59 文件 552 例全过、`@mim/web` 19 例、三套构建 0、`comment-check --strict` 通过、`env-check` / `version-check`（0.0.16）0、`verify-auth-gate` 147/147。
- **2026-11-24 功能变更（账号自助注销 + 到期物理删除 + 数据包导出 V0.0.17-preview）**：① **自助注销** —— `POST /me/deletion` 进入 `pending_deletion` 并预约到期时刻（重复申请幂等、回显既有预约时间不重置冷静期），`POST /me/cancel-deletion` 撤销恢复 `active`；`GET /me` 回传 `deletion_scheduled_at` / `deletion_grace_days`。② **数据包导出** —— `GET /me/export` 按身份 / 资金 / 内容 / 社交 / 交易五域输出 JSON 附件（`mim-data-<MimID>-<YYYYMMDD>.json`），口令哈希 / 刷新令牌哈希 / 提现账户名账号 / 实名姓名与证件哈希一律不进包，手机邮箱首尾脱敏。③ **物理删除引擎** —— `services/mim-api/src/privacy.ts`：单用户一个 `BEGIN IMMEDIATE` 事务，子表先于父表逐表 DELETE，他人可见引用（板块创建者 / 版主 / 卡片使用人 / 公告作者 / 通知触发者 / 举报处理人 / 会话成员）置空匿名化，`audit_logs` 不物理删而改写为 `deleted-<sha256 前 12 位>` 并置脱敏占位；重复执行幂等（无候选即 `purged=0`），单账号事务失败整体回滚、不阻断同批其余账号。④ **调度** —— `startPrivacyScheduler` 随 `MIM_JOBS` 总开关注册：启动先跑一轮 + 周期 `setInterval` + 句柄 `unref`；参数 `MIM_DELETION_GRACE_DAYS`（默认 7，1–365）、`MIM_DELETION_SWEEP_MINUTES`（默认 60，5–1440）、`MIM_DELETION_BATCH`（默认 50，1–500）。⑤ **管理端** —— `GET /admin/deletions`（`user:read`：队列 / 倒计时 / 逾期标记 / 策略 / 最近一次留痕）、`POST /admin/deletions/run`（新增权限点 `privacy:write`：手动触发一轮并写 `privacy.account_purge` 审计，已删 id 只存 sha256 前 8 位摘要）；后台新增「账号注销」视图。⑥ **验证** —— 新增 `test/account-deletion.test.ts` 13 例（申请 / 幂等 / 撤销 / 逐域删除 / 双用户交叉不误删 / 重复幂等 / 事务回滚 / 导出脱敏 / 队列与 RBAC 401·403），前端 `lib/deletion.test.ts` 9 例；本轮实测 `@mim/api` 61 文件 567 例、`@mim/web` 3 文件 28 例、三套构建 0、`verify-auth-gate` 147/147、`verify-deployments` 55/55、`env-check` / `version-check`（0.0.17）0、`comment-check --strict` 通过。交付说明见 [docs/账号注销与数据清理-20261124.md](./docs/账号注销与数据清理-20261124.md)。
- **2026-11-25 功能变更（借鉴标杆落地 V0.0.18-preview）**：参照两份外部标杆矩阵（`reports/商业标杆借鉴矩阵-20261125.md`、`reports/内容与专业服务借鉴矩阵-20261125.md`，本地留档不入库）落地八项：① **合规静态页** `/legal/privacy|terms|refund|help` 四篇结构化骨架（法律条款待法务复核，占位不构成承诺），页脚「更多」列新增四项匿名可见合规链接；② **独立 404 视图**，未知路径不再静默回落首页，停在未找到页并给回首页 / 去社区两个出口；③ **根级错误边界**（前台 + 后台），渲染期异常切兜底卡片；④ **个人中心成长聚合**：等级进度、徽章墙、我的收藏、我加入的圈子、我的举报；⑤ **新端点** `GET /api/v1/community/reports/mine`（私密读，匿名 401，仅回本人单据），已登记进 `verify-auth-gate` 私密读清单；⑥ **圈子**关键词 + 分类筛选 + 重置；⑦ 列表 / 详情骨架屏组件；⑧ **备案号** `beian_icp` / `beian_police` 收进站点选项注册表（`publicRead`，留空不渲染）。本轮实测：`@mim/api` 62 文件 571 例、`@mim/web` 3 文件 28 例、Playwright e2e 5 passed、三套构建 0、`verify-auth-gate` 149/149、`verify-deployments` 55/55、`verify-custom-domains` 20/20、`env-check` / `version-check`（0.0.18）0、`comment-check --strict` 81.2% 通过、`gap-scan` PASS。线上取证发现合规多段被前置规整脚本折叠，已最小修补段表与保留名单并加 e2e 深链接断言（跟进提交 `b38e182`，run `45600202786` 六作业全绿）。交付说明见 [docs/借鉴标杆落地-20261125.md](./docs/借鉴标杆落地-20261125.md)。
- **2026-11-20 功能变更（自研算法收口 V0.0.14-preview：参数可配 + 全窗口排序 + 前端入口）**：① **权重持久化 / 后台可调** —— 新增 `services/mim-api/src/algorithms/config.ts`（`DEFAULT_ALGORITHM_WEIGHTS`、`mergeAlgorithmWeights` 逐字段夹取、`loadAlgorithmWeights` 优先级「环境变量 `MIM_ALGORITHM_WEIGHTS` > `site_settings` 键 `community_algorithm_weights` > 内置默认值」、`saveAlgorithmWeights` 幂等 upsert）；新增 `GET /api/v1/community/algorithm-weights`（运营只读，回显 `weights` / `defaults` / `source`）与 `PUT`（`requirePermission('appearance:write')` + 幂等键，支持 `bm25` / `rank` / `heat` / `window` 任一字段局部覆盖，未知字段直接 400）。② **搜索摆脱 200 条候选窗口** —— 相关性排序窗口改为配置项（默认 **5000**，区间 50–20000），窗口内 `offset/limit` 任意深翻页；`GET /community/search` 响应新增 `candidate_limit` 与 `weights_source`。③ **热榜窗口与权重同样可配** —— `GET /community/trending` 候选窗口默认 **500**（10–5000），热度权重全部读配置，响应回显 `window` 与 `weights_source`。④ **前端真实入口** —— `apps/web/src/api/community.ts` 增加 `trendingThreads()`、`searchThreads` 支持 `sort` / `diversify`、命中项带 `relevance`；`CommunityMore.tsx` 的 `SearchPanel` 新增「相关度排序 / 最新优先」切换、`去同质` 开关、相关度回显，并在打开面板时拉取**社区热榜 Top5**（含热度分与候选窗口）。⑤ **验证** —— 新增 `test/algorithms-config.test.ts` **7 例**（默认值、优先级、夹取、脏 JSON、匿名 401 / 运营可读、写入即生效、**220 条命中后 offset=200 仍可取 10 条**、热榜窗口生效），`@mim/api` **52 文件 / 501 例全过**，`pnpm -r typecheck` 5/5，web 构建 0，`env-check` / `version-check`（0.0.14）0，`verify-auth-gate` 142/142，`verify-deployments` 55/55。
- **2026-11-19 功能变更（自研算法包 V0.0.14-preview：搜索相关性排序 + 社区热榜）**：新增 `services/mim-api/src/algorithms/`（**零第三方依赖、全纯函数**）——`text.ts`（全角归一 + 中文二元切分 + 英轻量词形归一 + 中英停用词 + Jaccard）、`bm25.ts`（字段加权 BM25，标题 3 / 摘要 2 / 正文 1，`k1=1.2`、`b=0.75`、IDF + 长度归一 + 稳定排序 + 空查询降级）、`heat.ts`（`engagement/(ageHours+2)^1.5`，点赞 3 / 回复 5 / 收藏 6 / 浏览 0.3）、`mmr.ts`（MMR 贪心去同质，`λ=0.7`，不改入参）、`rank.ts`（半衰期 7 天的时效衰减 + 综合分 `relevance·decay + 0.02·ln(1+2likes+3replies)`）。接入：`GET /community/search` 由「LIKE + 时间排序」升级为**默认相关性排序**（200 条候选窗口内 BM25 + 综合分，`items[].relevance` 回显；`sort=latest` 保留旧口径，`diversify=1` 走 MMR，同板块相似度 0.9、否则标题词集 Jaccard），`total` 仍为全量 LIKE 命中数；新增只读匿名端点 `GET /community/trending`（`limit` 默认 10 / 上限 50、可选 `board`、返回 `heat` 与 `algorithm: heat-v1`）。自研理由（铁律五例外说明）与公式见 [docs/自研算法-搜索排序与热榜-20261119.md](./docs/自研算法-搜索排序与热榜-20261119.md)。验证：`test/algorithms.test.ts` **16 例**、`test/algorithms-api.test.ts` **5 例**、`pnpm --filter @mim/api test` **51 文件 / 494 例全过**、`pnpm -r typecheck` 5/5、`comment-check --strict` 通过、`verify-auth-gate` 142/142、`verify-deployments` 55/55、`version-check` 0.0.13 通过。同轮清理后端重复路由：`GET /payments/channels` 曾在 `routes/payments.ts` 与 `payments/router.ts` 两处注册（后者永远被前者遮蔽），现只保留主支付路由一处，`test/payments-channels.test.ts` 改为按生产挂载顺序（主路由先、渠道子路由后）取证；全仓 `router.{get,post,put,patch,delete}` 扫描 265 条注册、真实重复 0（唯一同名 `POST /auth/register` 出现在 `middleware.ts` 的文档注释示例中，非注册）。

### 校验命令

```bash
node scripts/version-check.mjs
RELEASE_CHANNEL=preview node scripts/version-check.mjs
node scripts/env-check.mjs
node scripts/comment-check.mjs
```

- `version-check.mjs`：铁律四版本规约校验（退出码 0 / 1）
- `env-check.mjs`：09 清单 §0 密钥治理校验——`.env.example` ↔ 09 清单 ↔ `.gitignore` 一致性（退出码 0 / 1）
- `comment-check.mjs`：铁律十一注释覆盖率校验——逐文件统计「可注释行 / 已解释行」，默认基线模式（退出码恒 0），`--strict` 为 CI 门禁模式（低于阈值退出 1）
- ~~`verify:film-export`~~（**已下线，历史留痕**）：漫剧模块删除后，成片导出 E2E 脚本与 npm 入口已移除；下述历史描述为各轮交付快照。
- ~~`verify:site-modules` / `verify:entry-manifest` / `verify:site-directory`~~（**已下线，历史留痕**）：入口配置清单模块删除后，三个校验脚本已不在 `scripts/` 目录与 npm scripts 中；下述 83 / 23 / 16 项断言描述为历史快照。
- `verify:chat-flow`：聊天点击级 E2E（15 项断言，`scripts/verify-chat-flow.mjs`）——真点「+ 群聊」「创建群聊」、用 CDP 选文件发图片消息（断言气泡内 `<img>` 的 `naturalWidth > 0`）、点气泡上的「撤回」并断言消息从列表消失；取证落 `.tmp/chat-flow-e2e.json` / `.png`
- `verify:chat-plus`：聊天增强点击级 E2E（23 项断言，`scripts/verify-chat-plus.mjs`）——引用回复（引用条 → 气泡内引用块 → 发送后自动清除）、文件消息下载（真访问直链得 200）、群管理（设管理员后角色标签变「管理员」、邀请入群后成员数 2 → 3）、会话内搜索结果定位与目标消息高亮；取证落 `.tmp/chat-plus-e2e.json` / `.png`
- `summary:deployments`：部署汇总生成器——采集 `git remote` / `git ls-tree HEAD` / 工作树工件 / CI 作业 / 两份矩阵表行数，输出 `docs/deployment-summary.json`（结构化）与 `docs/deployment-summary.md`（核对表）；追加 `--live` 可对各入口真实 `curl` 探测并刷新 `result`
- `verify:deployments`：部署汇总零依赖校验（55 项断言）——规范 ID 唯一、枚举合法、9 平台无遗漏、别名不撞名、空数据标识、工件双口径与真实仓库一致、共享包→后端→前端→文档全链路消费

## 视觉精修（2026-11-20）

`apps/web` 全站新增视觉精修层 `apps/web/src/styles-polish.css`（在 `styles-colorful.css` 之后引入，层叠最后生效）：

- **令牌**：字体栈换 `Inter / HarmonyOS Sans SC`，正文 15px / 行高 1.62，圆角 10–20px，四档冷调阴影，品牌渐变统一为靛蓝→湖蓝→青绿。
- **首页**：深色渐变主视觉 + eyebrow + 双按钮 + 结构指标条；入口卡加线性图标与箭头；精选区渐变竖条标题 + 悬停抬升。
- **彩色收编**：取消 chips / badge 的 9 档、6 档 `nth-child` 随机配色与列表斑马渐变、表头三色底、红色首字下沉，统一中性药丸与细线分界；仅保留板块色相与榜单金银铜。
- **登录页**：两栏居中、分段胶囊、22px 圆角登录卡，取消整屏 `min-height` 造成的半屏空带。
- **暗色**：所有新增规则给 `[data-theme='dark']` 分支，并修复 `.card/.block` 误伤 `.btn.block` 导致侧栏主按钮丢失渐变的问题。
- **取证**：Edge 真机截图覆盖首页 / 社区 / 登录 / 移动端 / 暗色，控制台 0 错误。详见 [docs/全站视觉精修-20261120.md](./docs/全站视觉精修-20261120.md)。
- **线上**：CI Deploy run `44567555946` 五作业全绿（含「发布到生产服务器」），生产前端 `https://zy.laal.top` 已加载新样式资源 `index-B3RegpRe.css`（含 `--pd-grad` / `pd-hero` 特征），`/community` `/signin` 深链接 200、控制台 0 错误。注：`laal.top` 根域当前为 WordPress 站点，不是 Mim 前端。
- **管理端**（第二轮）：`apps/admin/src/styles-polish.css` 覆盖登录页 + 18 个后台视图——侧栏胶囊导航、品牌渐变页标题、中性表头与去斑马行、38px 表单控件 + 4px 焦点环、分段页签、状态徽标语义色、暗色分支与移动端横条侧栏；`@mim/admin` build / typecheck ✓，Edge 逐视图截图 20 张。

本轮为纯样式与首页信息层级调整，**不改 semver**（沿用彩色层同一口径），版本仍为 `V0.0.13-preview`。

## 项目铁律

所有 AI 协作者必须遵守 [AGENTS.md](./AGENTS.md) 中的十二条铁律：

1. **铁律一**：AI 负责执行，不把任务丢回用户，全权接管浏览器等一切可自动化环境（最高优先级）。
2. **铁律二**：可逆操作直接做，不可逆操作先授权。
3. **铁律三**：基于证据，不空口断言。
4. **铁律四**：版本号规约（与本文件同步）。
5. **铁律五**：必须引入所有第三方依赖，不得重复造轮子。
6. **铁律六**：全角色全流程自动化——AI 承担所有人员职责，每轮交付前必须 BUG/代码检查。
7. **铁律七**：功能模块增删必须全量同步，交付报告附同步清单。
8. **铁律八**：任务完成后必须全自动化部署到远程生产环境（前后端 + 数据库），**禁止以本地预览作为交付终点**。
9. **铁律九**：多平台部署矩阵只走免费方案（**11 个平台**：9 个原矩阵平台 + 2026-11-10 新增的 **Gitee（码云）** 镜像仓 + 2026-11-13 接替停服 Sealos 的 **Netlify**），每轮部署必须逐平台刷新 HTTP / 耗时 / 连接取证；本机不可达须附网络侧证据与替代取证。
10. **铁律十**：免费平台额度矩阵与选型路由——远程仓库 3 个（GitHub / Bitbucket / Gitee）、纯静态 5 个（GitHub Pages / Cloudflare Pages / Vercel / Netlify / Azure Static Web Apps）、后端动态 2 个（Render / Cloudflare Workers）的免费额度为准入依据；新平台须过「长期免费层 / 额度可承载 / 是否实名绑卡 / 复核日期与来源」四要件并季度复核。**原候选托管平台相关内容已于 2026-11-09 按用户指令全量删除，不得重新引入。**
11. **铁律十一**：全仓库逐行注释与解释——业务代码、脚本、CSS、HTML 每行须有中文解释；`scripts/comment-check.mjs` 为校验器（`--strict` 为 CI 门禁）；未全量达标时不得声称「已全量注释完成」。
12. **铁律十二**：**全量远程仓库同步 + 生产统一部署到线上腾讯云自建服务器**——两个远端（`origin` GitHub、`gitee` Gitee）每轮必须同轮全部推送并逐个 `git ls-remote` 取证；远程仓库只承担源码托管与镜像，**生产唯一权威终点为 `https://zy.laal.top`**（API `https://api.laal.top`；nginx + systemd + SQLite，前后端 + 数据库一体上线；旧 `mim.mixm.top` 仅 301 → `zy.laal.top`），铁律九的 11 平台仅作分发 / 镜像 / 取证，不得替代「已上线」；交付须附 V1–V6 取证矩阵（详见 [AGENTS.md §12](./AGENTS.md#铁律十二全量远程仓库同步与生产统一部署到线上腾讯云自建服务器)）。

## 仓库结构

pnpm workspace Monorepo（`pnpm-workspace.yaml` 纳入 `apps/*`、`services/*`、`packages/*`）：

```
apps/web/            # Web 端薄壳（React 18 + Vite 6，端口 5173；现行视图：社区 / 圈子 / 聊天 / 个人中心 / 收银台 / 支付回跳 / 登录）
apps/web/src/views/  # 视图组件：Home / Community（含 CommunityGallery / CommunityAssets / CommunityGuides / CommunityMore / ContentDetail / AnnouncementsPanel）/ Circles / Chat / Checkout / PaymentReturn / Profile / Login / MyAssets / PageBlocks 等子组件
apps/admin/          # 独立管理后台（React 18 + Vite 6，端口 5174，生产入口 /admin/；23 个视图 tsx = 20 个导航视图 + Products 内页签子组件 Cards / Coupons + 登录页 Login；后台导航 20 项与 App.tsx renderView 20 分支 1:1）
services/mim-api/    # 后端 API（Express 5 + SQLite WAL + JWT + zod，端口 8787，前缀 /api/v1）
services/mim-api/src/routes/  # 现行路由模块 29 个：admin / appearance / assets / auth / circles / community / content-ops / content-unified / deployments / federation / growth / growth-dm-admin / im / invites / me / media / oauth / orders / payments / privacy-admin / realname / referral / referral-admin / security / shop-admin / site-options / sso / vip-pricing / wallet-withdrawals（另加 payments/router.ts 扩展支付工厂）
services/mim-api/src/oauth/   # 第三方登录适配层：providers（注册表）/ client（协议交换）/ accounts（绑定与一次性票据）
services/mim-api/src/identity.ts  # 唯一建号入口：Mim ID 事务发号、历史用户回填、登录缺号兜底
packages/core-domain/# 共享领域层（错误码 ERROR_CODES / UUIDv7 / 部署汇总注册表 deploymentRegistry）
packages/i18n/       # 双语文案（zh-CN / en-US）、t() 回退链与货币格式化
scripts/             # build / version-check / env-check / comment-check / verify-auth-gate / deployment-summary / verify-deployments / verify-custom-domains / verify-indexes / verify-env-wiring 等
deploy/              # 生产部署工件（bootstrap / deploy / nginx / systemd / migrations / sealos / iga）
.github/workflows/   # CI/CD（deploy.yml 五作业：verify / deploy / pages / packages / platforms）
site/                # PRD 可视化阅读载体（`npm run build:site` 离线副本，非生产站点）
docs/wiki/           # 结构化文档（01~10 + 首页 README）
```

> **现行覆盖（2026-11-20）**：模块商城（`/marketplace` `/products` `/cart`）、入口配置清单（`/entry-catalog` `/sites`）、漫剧工作台（`/comic-studio`）、导航站（`/navigation`）、统一搜索（`/search`）、云存储 / 图床 / 下载分发（`/cloud` `/img` `/download`）及对应后端路由、测试与种子均已从代码删除；上方各历史变更条目与 wiki 中相关描述按铁律三保留作历史留痕，不代表当前工作树实况。

## 功能与接口

### 前端视图（`apps/web/src/views`）

站内采用零依赖 history 路径路由（[router.ts](./apps/web/src/router.ts)）：路径即视图，现行对外路径段由 `VIEW_SEGMENTS` 一处定义——`/community`（社区）、`/circles`（圈子，独立成员制社群）、`/chat`（聊天）、`/account`（个人中心与设置）、`/checkout`（收银台）、`/pay-return`（支付回跳）、`/signin`（登录），根路径 `/` 与未知路径统一回落 `/community`；地址栏不再出现 `#/` 或 `?tads` 残留。旧 `#/xxx` 链接与改名前的旧段（`/login` `/settings` `/profile` `/forum`）在启动时自动改写为新路径（前端 `LEGACY_SEGMENTS` + 生产 nginx 301）；已并入的 `/announcements`、`/news`、`/releases` 统一改写为 `/community`，已删除的 `/cart` 回落到 `/account`；其余已下线模块的旧段（`/marketplace` `/products` `/entry-catalog` `/comic-studio` `/navigation` `/search` `/cloud` `/img` `/download` 等）不再登记，访问时按未知路径回落社区，不会把用户送回已删除页面。**2026-11-12 起「设置」不再是独立视图**：原设置页的账号资料、语言 / 时区、区域信息与注销操作全部并入 `/account` 的「账号与设置」分区。**2026-11-15 起「购物车」随模块商城整块删除**：不再有独立页面、页签或接口，`/account` 只保留资料与账号安全。视图由 [App.tsx](./apps/web/src/App.tsx) 按路径渲染，刷新、前进后退与外链直达均可用（GitHub Pages 由 `404.html` 回退、Cloudflare Pages 由 `functions/[[catchall]].js` 回退、EdgeOne Pages 由构建期生成的 `404.html` + 每个路径段的同名目录回退、生产 nginx 由 `try_files` 回退）。**门禁现行口径（2026-11-16 起，取代早期「按需登录 / 访客会话」模型）**：匿名默认可读——首页、社区列表、帖子正文、图库与视频、商品列表与详情、公告全部 200；只有命中个人与资金路径（`/me`、`/wallet`、收藏、通知、资产、返佣等）才要求登录；写操作（发帖 / 评论 / 点赞 / 收藏 / 举报 / 上传 / 编辑删除等）一律 401 `AUTH_UNAUTHORIZED`。`POST /api/v1/auth/guest` 路由已删除，不再有自动访客建号；`/signin` 用于登录已有正式账号。自助注册由服务端开关 `MIM_REGISTRATION_ENABLED` 控制且**默认关闭**（关闭态 403 `AUTH_REGISTER_DISABLED`）。`site/*.html` 与 `Mim-PRD.html` 为公开产品文档页，不含门禁。

独立管理后台见 [apps/admin](./apps/admin)：独立构建、独立静态根（生产 `/admin/`），承载概览 / 发货与售后 / 批量改价（仅独立商城商品）/ 邀请码 / 实名审核 / 内容运营 / 社区运营 / 页面搭建 / 成长私信 / 角色与权限 / 用户。

**导航收口（2026-11-15 模块下线后，2026-11-20 复核）**：主导航按后台配置平铺社区 / 聊天 / 个人中心等项，页脚附圈子入口与登录 / 退出入口；公告动态、社区资讯、版本三个页面已并入社区页「公告动态」页签（旧链接 `/announcements`、`/news`、`/releases` 由前端 `LEGACY_SEGMENTS` 与生产 nginx 301 统一落到 `/community`）；`圈子` 作为独立视图保留（深链接 `/circles` 可直达，匿名可见清单与空态）。**部署汇总前端页已随模块下线移除**：后端 `deployments` 只读路由仍在（匿名 401，属设计如此），但不再有 `/deployments` 前端视图。已下线的模块入口、路由、页面与后端接口全部移除，不再以隐藏项形式残留。

**商城范围（2026-11-15 收口）**：项目只在**社区页内**保留一套商城（`shop` 标签）——实物快递 / 自动发卡密 / 人工发货三类商品，按余额与优惠码结算，下单走 `community.shop` 接口。功能模块商城（原 `/marketplace`）已整块删除：前端入口、购物车、目录 / 订单 / 权益页面、后台菜单与后端路由、类型定义、种子数据、数据表全部移除。

| 视图 | 组件 | 说明 |
|---|---|---|
| 登录 | `Login.tsx` | 全站唯一登录入口：**账号密码登录**（`POST /auth/password`，口令只认库内 `credentials(kind=password)` bcrypt 记录；环境变量超管口令 `MIM_AUTH_ADMIN_PASSWORD` 已不生效）、**验证码登录**（`/auth/code` + `/auth/login`，需短信/邮件通道凭证）、**第三方登录**（`GET /auth/oauth/providers` 拉清单 + 是否已配置 → `POST /auth/oauth/:provider/authorize` 取授权地址 → 回调 302 带一次性票据 → `POST /auth/oauth/exchange` 换会话；未配置凭证的提供方按钮置灰标注「未配置」）。**自助注册由 `MIM_REGISTRATION_ENABLED` 开关控制、默认关闭**：关闭态 `POST /auth/register` → 403 `AUTH_REGISTER_DISABLED`，`/auth/channels` 上报 `register:false`，登录页不渲染注册分段；打开态才走完整注册并复用统一建号规则（`user.member_no` 纯数字 Mim ID，靓号只人工授予）。登录页挂载时查 `GET /auth/channels` 并在通道未配置时直接提示改用密码。匿名访问收费 / 私密视图时在内容区内嵌登录引导。 |
| ~~部署汇总前端页~~（**已下线，历史留痕**） | ~~`Deployments.tsx`~~ | 该前端视图随 2026-11-15 模块收口删除；后端 `deployments` 只读路由仍在（`GET /deployments/overview` 等，匿名 401 属设计如此），数据源 `packages/core-domain/src/deploymentRegistry.json` 与 `docs/deployment-summary.{json,md}` 保留。下方「部署汇总」历史描述为各轮交付快照，不再代表当前前端实况。 |
| 设置 | `Profile.tsx` | 资料、区域、语言与注销冷静期；**2026-11-12 归位**：设置不再是顶层导航入口，只作为登录后「个人中心」内的「账号与设置」页签；独立 `Settings.tsx` 已删除，匿名访客的个人中心只保留「资料」与账号安全。 |
| 聊天 | `Chat.tsx` | 即时通讯与视频通话：会话列表、用户搜索、消息收发、WebRTC 视频通话（`VideoCall.tsx`），WS 端点 `/api/v1/im/ws`；**2026-11-11 增强**——引用回复（`reply_to_id` + 发送时固化 `reply_excerpt` 摘要快照，气泡内渲染引用块）、文件消息气泡（presign 下载直链 + 体积 + 下载按钮）、群管理（群主「设/撤管理员」「转让群主」、群主/管理员「移除」「邀请入群」、成员数实时刷新）、会话内搜索结果定位（`?around=` 按目标消息取上下文窗口 + 命中高亮）、未读分割线（`unread_count` 换算锚点，渲染「以下是新消息」）、表情选择器（20 个 Unicode 表情） |

### 后端接口（`services/mim-api`，前缀 `/api/v1`）

| 分组 | 端点 | 鉴权 |
|---|---|---|
| 健康 | `GET /health` | 公开 |
| 鉴权 | `POST /auth/code`、`/auth/login`、`/auth/register`、`/auth/password`、`/auth/refresh`、`/auth/logout`、`GET /auth/channels` | 公开（`logout` 需登录；`/auth/channels` 只返回各通道是否可用的布尔值；`/auth/register` 受 `MIM_REGISTRATION_ENABLED` 开关控制，默认关闭返回 403 `AUTH_REGISTER_DISABLED`；`POST /auth/guest` 路由已删除） |
| 第三方登录（2026-11-12） | `GET /auth/oauth/providers`（9 家清单 + 是否已配置，支持 `?region=cn\|global`）、`POST /auth/oauth/:provider/authorize`（下发授权地址与 state，`mode=login\|bind`）、`GET\|POST /auth/oauth/:provider/callback`（回调换资料 → 302 回前端带一次性票据或绑定结果）、`POST /auth/oauth/exchange`（票据换双令牌）、`GET /me/oauth`、`DELETE /me/oauth/:provider` | providers 公开；callback 公开（靠 state 校验）；绑定模式与 `/me/oauth*` 需登录；票据一次性、300 秒过期 |
| Mim ID（2026-11-12） | 无独立端点：`/auth/register`、`/auth/login`、`/auth/password`、`/auth/refresh`、`GET /me`、`GET /me/oauth` 的 `user.member_no` 字段 | 随登录态返回；号码由服务端在事务内发号，客户端只读 |
| 部署汇总（2026-11-09） | `GET /deployments/overview`（分布统计 + 覆盖口径 + 状态/结果/严重度/层级字典 + 平台/CI/排除清单）、`GET /deployments`（12 项清单，支持 `?q=` / `?layer=` / `?status=` / `?verdict=` / `?platform_id=`；`verdict=EMPTY` 命中空数据项）、`GET /deployments/:id`（单项详情 + 同平台同类项） | 路由保留；该组端点注明「管理员可读」，匿名访问 401 属设计如此；无写端点 |
| 个人中心（2026-11-11） | 复用既有 `GET /me`、`PATCH /me`（`display_name` / `locale` / `timezone`）、`POST /me/deletion`、`POST /me/cancel-deletion`，前端 `/account` 页承载「资料编辑 / 我的权益 / 我的订单 / 账号安全」等分区（**购物车分区随模块商城于 2026-11-15 删除**）；资料区与账号安全区展示 `user.member_no`（Mim ID），账号安全区新增第三方账号绑定 / 解绑（`GET /me/oauth`、`DELETE /me/oauth/:provider`，绑定走 `POST /auth/oauth/:provider/authorize` 的 `mode=bind`，回调后提示绑定成功；最后一个登录方式不允许解绑） | 登录 |
| 账号 | `GET /me`、`PATCH /me`、`POST /me/deletion`、`POST /me/cancel-deletion` | 登录 |
| 媒体 | `PUT/GET /media/objects/*`（URL 签名）、`POST /media/presign/upload`（`asset_type` 必填）、`GET /media/presign/download` | 对象端点凭签名免鉴权；预签名需登录；供聊天附件与社区图集 / 视频帖使用 |
| 管理 RBAC | `GET /admin/me`、`GET /admin/permissions`、`GET /admin/roles`、`POST /admin/roles`、`PATCH/DELETE /admin/roles/:code`、`GET/PUT /admin/roles/:code/permissions`、`GET /admin/users`、`GET/POST /admin/users/:userId/roles`、`DELETE /admin/users/:userId/roles/:roleCode` | Bearer + `rbac:read` / `rbac:write`（`x-admin-token` 为超管引导通道） |
| 即时通讯 | `GET/POST /im/conversations`、`GET/PATCH/DELETE /im/conversations/:id`（详情/改名/删除或解散）、`GET/POST /im/conversations/:id/members`、`DELETE /im/conversations/:id/members/:userId`、`PATCH /im/conversations/:id/preferences`（置顶/免打扰）、`GET /im/conversations/:id/messages`、`GET /im/conversations/:id/messages/search?q=`、`POST /im/conversations/:id/messages`、`POST /im/conversations/:id/messages/:messageId/recall`（2 分钟内仅本人）、`POST /im/conversations/:id/read`、`GET /im/users`、`WS /im/ws?token=<access_token>`（服务端帧含 `message.recall`） | 登录（WS 凭 query token） |



除 `auth/*` 外的写接口强制 `Idempotency-Key`（同键同体重放首次结果、同键异体 409）；错误统一信封携带 `requestId`。

## 开发与运行

前置：Node >= 20（实测 v22.23.3）、pnpm 9.12.0。

```bash
pnpm install                              # 安装全部 workspace 依赖
pnpm -r typecheck                         # 全仓库类型检查
pnpm --filter @mim/api test               # API 契约测试（vitest + supertest，58 个测试文件 / 543 例，2026-11-20 本轮实测）
pnpm --filter @mim/web test               # 用户端 vitest：纯函数归一化 / srcset 派生 12 例 + Testing Library/jsdom 组件级 7 例（共 19 例）
pnpm --filter @mim/web e2e                # 浏览器级端到端（Playwright）：真实 Chromium 点击真实前端 + 真实本地 API，桌面 3 例 + 移动 1 例（首次需 pnpm --filter @mim/web exec playwright install chromium）
pnpm --filter @mim/web build              # 前端类型检查 + 产物构建
pnpm --filter @mim/admin build            # 管理后台类型检查 + 产物构建
pnpm --filter @mim/api dev                # 启动后端（http://127.0.0.1:8787）
pnpm --filter @mim/web dev                # 启动前端（http://127.0.0.1:5173，/api 代理到 8787）
pnpm --filter @mim/admin dev              # 启动管理后台（http://127.0.0.1:5174，/api 代理到 8787）
npm run check                             # 版本规约 + 密钥模板校验 + 注释覆盖率（CI 以 --strict 执行）
# 历史留痕：verify:site-modules / verify:entry-manifest / verify:site-directory 三个校验脚本随入口配置清单模块于 2026-11-15 一并删除，已不在 npm scripts 与 scripts/ 目录中
npm run summary:deployments                # 生成部署汇总 JSON + Markdown 核对表（--live 追加真实 curl 探测）
npm run verify:deployments                 # 部署汇总 55 项零依赖校验
```

其他：`npm run build`（构建真实前端 `apps/web/dist` → 根 `dist/`，EdgeOne Pages 等 OutputDir=dist 的托管平台同款）、`npm run build:admin`（构建管理后台 `apps/admin/dist`）、`npm run build:site`（PRD 阅读页 `site/` → `dist/` 离线预览）、`npm test`（等价 `@mim/api test`）。

## 文档索引

| 入口 | 内容 |
|---|---|
| [docs/wiki/README.md](./docs/wiki/README.md) | Wiki 首页：01 架构 / 02 模块 / 03 代码参考 / 04 依赖 / 05 运行 / 06 治理 / 07 功能 / 08 开发实现 / 09 第三方 SDK 清单 |
| [docs/deployment-summary.md](./docs/deployment-summary.md) | 部署汇总核对表：11 矩阵平台 / 12 规范部署项逐项列出仓库标识、平台 / 层级、交付链路、访问域名、部署状态、部署结果、异常说明；含异常明细、工件双口径、覆盖去重与排除说明（另有 7 条候选 / 排除留痕不计入汇总） |
| [docs/deployment-summary.json](./docs/deployment-summary.json) | 同上的结构化结果（机器可核对，schema `mim.deployment-registry.v1`） |
| [docs/zibll-wordpress-独立站点方案-20261118.md](./docs/zibll-wordpress-独立站点方案-20261118.md) | 子比主题 V9.2 独立 WordPress 平行站点方案：落点裸域 `laal.top`（复用既有 WP）、架构分流、站点块工件 `deploy/wp-blog/laal-top-wp.conf`、迁移取证、授权激活取证（2026-11-20 已激活 `is_aut=1`）、合规与到期风险、回滚方案；兜底建站脚本 `deploy/wp-blog/install-blog.laal.top.sh`（生成器自检 22/22） |
| [2026-11-16/zibll-alignment/gap-inventory-20261118.md](./2026-11-16/zibll-alignment/gap-inventory-20261118.md) | 子比主题结构 / 样式对齐缺口清单：本轮已落地项、延期项与前置依赖、两条路线边界 |
| [docs/wiki/07-functional-modules.md](./docs/wiki/07-functional-modules.md) | FR-01~06 功能规格与实现状态（实况） |
| [docs/wiki/08-dev-implementation.md](./docs/wiki/08-dev-implementation.md) | 开发实现全景与「已实现 vs 规划」对照（§1.1） |
| [Mim-PRD.html](./Mim-PRD.html) | 产品需求文档（V0.0.16-preview 口径，含 FR-01~06 功能规格与交互演示；PRD 中商城 / 漫剧等旧范围描述为草案历史口径，以代码现行视图段为准） |
| [team-hiring-plan.md](./team-hiring-plan.md) | 技术架构约束与团队分阶段配置规划 |

## 站点与部署

> **生产环境已上线**：`https://zy.laal.top`（API `https://api.laal.top`，后台 `https://zy.laal.top/admin/`；前端 `apps/web` + 后端 `services/mim-api` + SQLite 持久化数据库）。旧 `mim.mixm.top` 已无 Mim 部署，仅 301 → `zy.laal.top`。遵循 [铁律八](./AGENTS.md)，任务完成后由 CI 自动发布，**不以本地预览作为交付终点**。
>
> **2026-11-12 17:5x 全平台域名可访问性验证（现行状态）**：本机（宁波）+ CI Runner（run `43194019481` @ `fd2cf60`）双出口逐域名实测 13 个对外地址 —— **9 个可达**：`mim.mixm.top`（`/health` 200 / 53B、`/` 200 / 5305B、`/api/v1/modules` 200 / 10046B，`/marketplace` `/signin` `/deployments` 均 200，旧段 `/store` 301 → `/marketplace`）、`mim-299.pages.dev` 200 / 5305B、`afdk1991.github.io/mim/` 200 / 5305B、`mim-puce.vercel.app` 200 / 5182B（CI 出口；本机 TLS 阻断）、`gitee.com/mallwm_admin/mim` 200、`github.com/afdk1991/mim` 200、`ghcr.io/v2/` 401 / 73B（预期）；**3 个不可达**：`data.mixm.top`（CNAME 目标 `data.mixm.top.pages.dnsoe5.com` 在默认 DNS 与 `8.8.8.8` 下均 NXDOMAIN，本机与 CI 双 000，EdgeOne 入口整体失效）、`mim-i3ywsdfn.cloud.sealos.io/health`（本机 TLS `Connection was reset`、CI 000，DNS 正常）、`preview.iga-pages.com`（登记入口无 A 记录）；**1 个异常**：`mim-store.15726833367.workers.dev` 根路径 404 / 17B（Worker 存活但无根路由）。另修正一处登记错误：IGA 真实入口为 **`mim.preview.iga-pages.com`**（401 / 2413B，受访问保护），`preview.iga-pages.com` 本身不存在。7 个 `portal/m/api/test/store/dev/shop.mixm.top` 仍无解析（既有 pending）。逐项证据与处置建议见 [docs/平台域名验证-20261112.md](./docs/平台域名验证-20261112.md)。
>
> **2026-11-11 01:05 平台项目名复核（浏览器控制台实测，修正前一轮口径）**：以 AI 直接接管浏览器（路线 A）逐平台核对，结论两处更正 —— ① **Vercel 项目名本就是 `mim`**：项目概览页签标题 `mim - Overview - Vercel`、面包屑 `mim`、生产部署别名 `mim-bochzr8hs-afdk1991s-projects.vercel.app`，`mim-puce.vercel.app` 只是 Vercel 在 `mim.vercel.app` 被占后自动追加后缀的域名；② **EdgeOne 承载 `data.mixm.top` 的项目名已是 `mim`**：腾讯云 EdgeOne Makers 控制台项目列表见 `mim`（描述 `data.mixm.top`、代码源 `afdk1991/mim` `main`、近 24h 请求 542 / 15.1 MB、运行中）与遗留 `mim-app`（仅默认域、无流量、保留回滚），线上 `https://data.mixm.top/` 实测 **200 / 981B / `server: edgeone makers`**（仍为 WAF 人机校验页，按判别规则不作内容层断言）；`data.mim.top` 无 DNS 记录，佐证自定义域为 `data.mixm.top`。至此 Cloudflare Pages / Vercel / EdgeOne / GitHub / Gitee / ghcr / Worker 均为 `mim` 口径，**仅 IGA（Project `fr95fuwu57`）因缺 `iga_token` 与控制台登录态未取证**，逐项证据见 [AGENTS.md §9.15](./AGENTS.md)。
>
> **2026-11-11 00:20 多平台项目名统一为 Mim（现行状态）**：按用户「整个项目在多个平台项目名称全部统一为 Mim」指令，Cloudflare Pages 项目已由 `mim-8ah` 迁移为 **`mim`**（`wrangler pages project create mim` + `pages deploy --project-name=mim`），因 Pages 子域全局唯一、`mim.pages.dev` 已被他人占用，平台分配域名 **`https://mim-299.pages.dev`**；实测 `/` **200 / 1.840s / 5114B**、`/store` 200 / 0.571s、`/comic` 200 / 1.758s、`/api/v1/modules` **200 / 3.200s / 9514B**（Functions 反代生效）。旧项目 `mim-8ah` 保留作回滚。GitHub 仓库 / Gitee 仓库 / ghcr 包名早已为 `mim` / `mim-api`；Sealos（命名空间 `ns-i3ywsdfn`，平台分配不可自选）保持现状，Vercel / EdgeOne 两项经 01:05 复核确认**本就为 `mim`**（见上段），IGA（`fr95fuwu57`）**因缺令牌未取证**，逐项阻塞见 [AGENTS.md §9.15](./AGENTS.md)。**CI 复验**：push 触发的 run `42854147887` 中「托管平台同步」作业已用 `--project-name=mim` 云端真发（`Deployment complete! … https://cf70ccda.mim-299.pages.dev`），同一作业的线上取证 `mim-299.pages.dev/ => 200`、`mim.mixm.top/health => 200`、`mim-puce.vercel.app/ => 200`。
>
> **2026-11-10 23:40 生产上线取证（现行状态）**：`https://mim.mixm.top` 已真实在线 —— `/health` **200 / 0.071s / 53B**（`{"status":"ok","service":"mim-api","version":"0.0.0"}`）、`/` 200 / 5114B、`/api/v1/modules` 200 / 9514B、`/store` 与 `/comic` 200 / 5114B（`try_files` SPA 回落生效）、`/admin/` 200 / 1430B；Let's Encrypt 证书已签发（`ssl_verify_result=0`），`http://` 一律 **301** 跳 HTTPS；Cloudflare Pages 的 `/api` 反代随上游恢复（`https://mim-299.pages.dev/api/v1/modules` 实测 **200 / 3.200s / 9514B**）。主机构建与启动链路上修掉三个真实缺陷（esbuild banner `createRequire` 重名 `22d2d2b`、`sharp` 未设 external 被内联 `726f5bb`、启动期加载原生库致 SEGV → sharp 改按需加载 `f859114` + 主机 Node 升到 22.20.0）。取证明细见 [AGENTS.md §9.14](./AGENTS.md)。（注：该段为 2026-11-10 历史快照；2026-11-15 起生产入口已迁至 `https://zy.laal.top`，`mim.mixm.top` 仅 301 → `zy.laal.top`。）
>
> **2026-11-09 17:54 复核（现状标注，非历史数值改写）**：本机探测 `mim.mixm.top` 返回 `000`（curl exit 7，本地代理 `CONNECT tunnel failed, response 502`；DNS 正常解析 `115.159.159.11`），主机侧状态本轮无 SSH / `tccli` 凭据可验证；逐平台实测与「历史快照不得冒充现状」的阅读约定见 [AGENTS.md §0 / §9.1](./AGENTS.md)。
>
> **生产权威终点与双远端（铁律十二，2026-11-15 更新入口）**：本项目生产**唯一权威终点**为线上腾讯云自建服务器 `https://zy.laal.top`（API `https://api.laal.top`，前后端 + SQLite 一体上线；旧 `mim.mixm.top` 仅 301 → `zy.laal.top`），下方 11 平台矩阵仅为分发 / 镜像 / 可用性取证，**任一平台的 200 均不得替代「已上线」**。代码远端共 2 个：`origin`（`https://github.com/afdk1991/mim.git`）与 `gitee`（`https://gitee.com/mallwm_admin/mim.git`），每轮交付须**同轮全推并逐个 `git ls-remote` 取证**；**已移除的原候选托管平台相关内容全量删除且不得重新引入**。取证矩阵 V1–V6 与适用边界见 [AGENTS.md §12](./AGENTS.md#铁律十二全量远程仓库同步与生产统一部署到线上腾讯云自建服务器)。

| 项 | 说明 |
|---|---|
| 生产域名 | `https://zy.laal.top`（API `https://api.laal.top/api/v1`；后台 `https://zy.laal.top/admin/`；HTTPS，Let's Encrypt；nginx 托管静态产物并反代 `/api/v1`；旧 `mim.mixm.top` 仅 301 → `zy.laal.top`）。**裸域 `laal.top` 为独立 WordPress（zibll V9.2）社区站（仅 1 篇默认文章），不是 Mim**。 |
| 服务器布局 | `/opt/mim/app`（git 仓库）+ `/opt/mim/web`（用户端静态根）+ `/opt/mim/admin`（管理后台静态根）+ systemd `mim-api`（端口 8787） |
| 管理后台入口 | `https://zy.laal.top/admin/`（`apps/admin` 构建产物；nginx `/admin/` location 独立 alias，与用户端静态根隔离；页面声明 `noindex, nofollow`） |
| 数据库 | 物理落盘 `/var/lib/mim/mim.db`（SQLite WAL，持久化磁盘）；`/opt/mim/app/services/mim-api/data/mim.db` 为指向该物理库的软链 |
| 数据库迁移 | `deploy/migrations/*.cjs`（`2026-11-04-drop-fr03.cjs`、`2026-11-05-drop-billing-audit.cjs`）：`deploy/deploy.sh` 发布前幂等执行；**项目不创建任何数据库备份** |
| 运行期配置 | 生产写入 `/opt/mim/mim-api.env`：`MIM_JWT_SECRET`（≥32 字符，生产缺失直接拒绝启动）、`MIM_REGISTRATION_ENABLED`（只认 `1`，默认关闭；关闭态注册 403 `AUTH_REGISTER_DISABLED`）、`MIM_CORS_ORIGINS`、`MIM_STORAGE_DRIVER`（`local` / `s3`）+ `MIM_STORAGE_*`、`MIM_AI_PROVIDER`（`mock` / `openai`）与 `MIM_AI_*` 成本上限 / 产物保留期、`MIM_AI_WORKER`、`MIM_PUBLIC_BASE_URL`、`PORT`（缺省 8787）；完整清单见 [.env.example](./.env.example) 与 [09 清单](./docs/wiki/09-third-party-sdk-inventory.md)。**`MIM_AUTH_ADMIN_PASSWORD` 已不生效**：口令只认库内 `credentials(kind=password)` bcrypt 记录，不再有环境变量超管口令通道。 |
| 自动部署 | push `main` → GitHub Actions `.github/workflows/deploy.yml` → SSH 执行 `deploy/deploy.sh` → 服务器 HEAD 校验 → 线上 `/health` 取证 |
| 生产登录入口 | **现行门禁口径（2026-11-16 起，取代早期「免登录体验 / 访客会话」模型；早期访客自动建号、`is_guest=1`、IP 限流 30 次/小时等描述为历史留痕）**：匿名默认可读——社区列表、帖子正文、图库与视频、商品列表与详情、公告、圈子清单与空态全部 200；个人与资金路径（`/me`、`/wallet`、订单、收藏、通知、资产、返佣等）要求登录；写操作（发帖 / 评论 / 点赞 / 收藏 / 举报 / 上传 / 编辑删除等）一律 401 `AUTH_UNAUTHORIZED`。`POST /api/v1/auth/guest` 路由已删除（404），不再自动建号；`users.is_guest` 为历史兼容列、新账号恒 0。独立管理后台 `/admin/` 仍为「无凭证只渲染登录页」的 RBAC 门禁。登录页支持「密码登录 / 验证码登录 / 注册（开关打开时）」：`POST /api/v1/auth/password` 只比库内账号口令；`POST /api/v1/auth/register` 受 `MIM_REGISTRATION_ENABLED` 控制、默认关闭（403 `AUTH_REGISTER_DISABLED`）；`GET /api/v1/auth/channels` 下发各通道可用布尔值供登录页提示。验证码通道已支持阿里云短信（`MIM_SMS_ALIYUN_*`）与 AWS SES 邮件（`MIM_EMAIL_SES_*`），CI Secret 配置后由 `deploy.yml` 透传写入即生效，未配置时 `auth/code` 在生产返回 503 `AUTH_CHANNEL_NOT_CONFIGURED` |
| 代码同步通道 | 服务器访问 `https://github.com` 被阻断，改走 `git@github.com`（`/opt/mim/.ssh/deploy_key` 只读 Deploy Key，22 端口） |
| 一次性引导 | `sudo bash deploy/bootstrap.sh`（apt 依赖 / pnpm / nginx / systemd / certbot） |
| 手动重放 | `bash deploy/deploy.sh`（幂等；项目不创建任何数据库备份） |
| `site/index.html` / `site/prd.html` | PRD 可视化入口与副本，仅离线阅读，**不参与生产** |

### 多平台部署矩阵

> **层级定位（铁律十二 / 铁律九）**：本表为「1 个生产权威终点 + 铁律九的 11 个免费平台矩阵成员」，其中 11 行即铁律九的 11 个免费平台矩阵成员（2026-11-10 起 Gitee 镜像仓由「矩阵外补充项」提升为矩阵第 10 行；2026-11-13 Netlify 接替停服的 Sealos 成为第 11 行，Sealos 保留为退休留痕行；Cloudflare Pages 与其独立 Worker 为同行并列的两个规范部署项）；生产唯一权威终点是表中「腾讯云自建服务器」一行的 `https://zy.laal.top`（API `https://api.laal.top`；旧 `mim.mixm.top` 仅 301 → `zy.laal.top`）。静态站直传、同源反代 Worker、容器镜像与源码镜像仓均不承担生产运行，缺少该行 `/health` 200 与关键接口取证时不得宣称「已上线」。

一套代码、一份前端产物（`vite base: './'`，可挂任意子路径），后端统一由 `services/mim-api` 提供。CI 在 push `main` 时并行触发下列链路；缺凭证的平台以 `SKIP` 跳过，不阻断主链路。代码远端为 `origin`（GitHub）与 `gitee`（Gitee），每轮须同轮全推；原候选托管平台已全量移除。

| 平台 | 载体 | 入口 / 配置 | 状态 |
|---|---|---|---|
| GitHub 仓库 | 源码主仓 | `https://github.com/afdk1991/mim` | ✅ 已同步 |
| Gitee 仓库（码云 · 国内镜像，铁律九矩阵第 10 行） | 镜像源仓（铁律十二 §12.2 双远端） | `https://gitee.com/mallwm_admin/mim`（CI `platforms` 作业内「Gitee 镜像同步」步骤随 push 自动推送同一提交；令牌为仓库 secret `GITEE_TOKEN`，缺失则显式 `::warning::` SKIP；本地 `git push gitee main` 仍可用作兜底，逐个 `git ls-remote` 取证） | ✅ CI 自动同步（2026-11-12 实测：push `cf13458` → CI run `43067678292` 五作业全绿，「Gitee 镜像同步」步骤真实执行，`git ls-remote gitee refs/heads/main` = `cf134584a42f…` 与本地 HEAD 逐字一致；此前 2026-11-10 22:20 首次入矩阵时网页 **200 / 0.469s / 52034B**、默认分支 `main`；建仓取证见 [AGENTS.md §9.11](./AGENTS.md#911-gitee-镜像仓补齐2026-11-10-2150-0800)，入矩阵取证见 [§9.12](./AGENTS.md#912-部署矩阵新增-gitee码云2026-11-10-2220-0800)；本轮 CI 推送取证见 [docs/CI-Gitee镜像自动推送与生产发布取证-20261112.md](./docs/CI-Gitee镜像自动推送与生产发布取证-20261112.md)） |
| GitHub Pages | 前端静态站 | CI job `pages`（`configure-pages` + `upload-pages-artifact` + `deploy-pages`），`https://afdk1991.github.io/mim/` | ✅ CI 自动发布 |
| GitHub Packages | 容器镜像（ghcr） | CI job `packages` → `ghcr.io/afdk1991/mim-api:{latest,sha}`；npm registry 受「包 scope 必须等于仓库 owner」限制，故 `@mim/*` 不发 npm | ✅ CI 自动推送 |
| 腾讯云 EdgeOne Pages | 真实前端 `apps/web/dist` | 项目名 **`mim`**（2026-11-11 01:05 控制台实测；遗留项目 `mim-app` 仅默认域、无流量，保留回滚）；CLI 直传命令 `edgeone makers deploy dist -n mim --env production`（本机 `~/.edgeone/pages-config.json` 的 `workspaceToProject` 已映射 `F:\合并项目\Mim=mim`，对应 ProjectId `makers-iygo4nrk22jr`；遗留项目 `mim-app` = `makers-qsbzlpxaoa8b` 仅作回滚，勿用 `-n mim-app` 直传）；`apps/web/index.html` `<head>` 已内置 `?tads` / 裸问号归一化脚本；`data.mixm.top` 对 `curl` / 无头 UA 返回 WAF 混淆 JS，对**无头浏览器与全新 profile 的有头 Edge** 返回验证码页（`TEOCaptchaWidgetV1`），真实内容须复用**已通过过校验的** Edge user-data-dir + 有头模式 + CDP 取证（判定正则含 `EO_Bot_Ssid\|_0x649a\|TEOCaptchaWidgetV1\|正在验证连接安全性`） | ✅ 已同步（`data.mixm.top` 2026-11-11 01:05 实测 **200 / 981B / `server: edgeone makers`**，仅 WAF 人机校验页；内容层最近一次有头 Edge + CDP 取证（2026-11-06）`title=Mim` + `assets/index-cpYhbG3w.js`；2026-11-07 01:48 复测时放行凭证过期回落验证码页，需人工勾选一次复选框后恢复。控制台显示该项目已连代码源 `afdk1991/mim` `main`，交付方式是否已由直传改为 Git 连接**待复核**。**2026-11-12 复核**：CLI 直传本地同源构建 `dist/`（30 文件，API=`mim.mixm.top`）到项目 `mim`（`makers-iygo4nrk22jr`），最新 Deployment `dprcsooiriey` `Deploy Success`（前一轮 `dp2z0vxmyw0w` 留痕）；自定义域 `data.mixm.top` 本机 exit 6 / CI 双 000（CNAME 目标 NXDOMAIN），临时域去 token 401 平台鉴权挑战页（2715B，title=Tencent Edgeone），内容层本轮未复验。**2026-11-12 21:23 控制台复核**：登录主账号 `100033061933` 进入 Makers 控制台，mim 项目域名管理仅默认域 `mim-45yeiirr.edgeone.cool`（已生效），未绑定任何自定义域；默认域渲染 Mim SPA 正常，产物 `index-Dmz7Z5Id.js` + `index-DLY_QDd3.css`（与本机根构建 / IGA 直传同指纹），静态副本侧模块目录接口 Failed to fetch（纯静态分发，API 仍走生产 `mim.mixm.top`）；遗留 `mim-app`（`makers-qsbzlpxaoa8b`）域名表为空。`data.mixm.top` 双解析器 NXDOMAIN，需控制台添加自定义域取得新 CNAME 后在 DNSPod 配置解析） |
| Cloudflare Pages / Workers | 前端 + `/api` 反代 + SPA 深链接回退 | `wrangler.toml`（`name = "mim"`）+ `functions/api/[[path]].js`（/api 反代）+ `functions/[[catchall]].js`（SPA 回退：Pages 挂载 Functions 后 `_redirects` 被整体旁路，深链接由 catch-all Function 200 重写 index.html；curl 取证须带 `Accept: text/html` 头，裸 curl 默认 `Accept: */*` 得 404 属按设计跳过），项目名 **`mim`**、域名 `https://mim-299.pages.dev`（旧 `mim-8ah` 保留回滚） | ✅ CI 自动发布（`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 已配置；2026-11-11 项目名迁移后实测 `/`、`/store`、`/comic`、`/api/v1/modules` 全 200） |
| Cloudflare Pages 同源自托管入口（`_worker.js` 高级模式） | 前端静态资源 + `/api`、`/health` 反代到本机同源站点（cloudflared 快速隧道回源），不依赖已失效的 `mim.mixm.top` | `.tmp/pages-src/_worker.js`（部署进 `mim` 项目）→ `wrangler pages deploy`；入口 `https://mim-299.pages.dev/store`；上游地址写在 `_worker.js` 的 `UPSTREAM` 常量，隧道地址变化后重发一次即可 | ✅ 2026-11-09 实测（本机中国网络 curl：`/health` 200/53B、`/api/v1/modules` 200/3411B 返回 8 模块、`/store` `/comic` `/settings` `/login` 均 200；Edge CDP 真实下单 E2E 5/5，截图 `store-pages.png`）。**依赖本机进程在线（API 8787 / 静态站 5188 / cloudflared）**，本机离线即 502 |
| Vercel | 前端 + `/api` rewrite | 项目名 **`mim`**（控制台实测项目 `prj_vUKzS5yA2jKG5zJQRs3xv1HiY4Za`、团队 `team_Umjh5PlpJLquiNXoxAzHzNZT`），域名 `https://mim-puce.vercel.app`（`mim.vercel.app` 已被占用，`-puce` 为平台自动追加后缀）；`vercel.json`（rewrites 反代 `https://api.laal.top:8443`，`/health` 反代 `https://zy.laal.top:8443`） | ✅ **CI 自动发布**（2026-11-12 补齐 `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` 三个 secrets）：run `43244715814` Vercel 步骤真实发布并 Aliased 到 `mim-puce.vercel.app`，同作业探测 `200|5305|0.119s`；本机直连 vercel.app 超时（本机网络侧阻断，不以本机结果否定线上） |
| Netlify（铁律九矩阵第 11 行，接替停服的 Sealos 席位） | 前端静态站 + `/api` 反代 | 站点 **`mim-web`**（`SITE_ID=d1c93c6f-85b1-4714-bce6-673bd534b092`），入口 `https://mim-web.netlify.app`；CI `platforms` 作业 Netlify 步骤进入 `apps/web/dist` 用 `netlify-cli` 直传，并在发布目录 `_redirects` 顶端补 `/api/* -> https://api.laal.top:8443/api/:splat 200`（`netlify.toml` 同规则） | ✅ **CI 自动发布**（2026-11-13 00:12 +08:00，run `43255056330`）：`✔ Deploy is live!` → 部署 `6af5e52b` `state=ready`，CI 出口探测 `https://mim-web.netlify.app/ => 200|5840|0.209s`；浏览器实测 title=Mim、13 个导航项、访客会话自动签发、商城 19 个一级分类 / 205 个二级模块 / 213 个项目、console 零报错。缺那条 `/api` 反代时页面会 404 + TypeError，本轮已修复 |
| Sealos（已退休，不再作为部署项） | 容器 + PVC | 原 `https://mim-i3ywsdfn.cloud.sealos.io`（纯 API 容器，命名空间 `ns-i3ywsdfn` 由平台分配） | 🚫 **移出矩阵**：2026-11-12 实测 cloud.sealos.io（Singapore / Private Team）余额 0.00、应用列表 0 个，实例已停服；新建应用预估 ¥0.52/日，与「只走免费方案」冲突。用户选择「换免费平台」，席位由 Netlify 接替，登记见 `deploymentRegistry.json` 的 `excluded.excluded.sealos` 与 `coverage.sealos_retired_note` |
| IGA Pages | 前端静态站 | `deploy/iga/deploy.sh`（`iga login` → `iga pages deploy --name mim --scope domestic`，项目名取自 `IGA_PROJECT_NAME`，缺省 **`mim`**） | ✅ **本机 CLI 直传最新产物**（2026-11-12 18:57 设备授权恢复登录态，Account `2100829122`）：项目 `96otddwh48` / Deployment `76l9e2vbeh`，项目级稳定域 `mim-96otddwh48-proj2y3ftluws1shahnh.preview.iga-pages.com`；带凭证复验 **200 / 5305B**、title=Mim、产物 `index-Dmz7Z5Id.js` 与本地一致，裸访 307→401 / 2413B 属平台访问保护。⚠️ CI 仍 SKIP（`IGA_ACCESS_KEY/SECRET_KEY/PROJECT_NAME` secrets 未配）；同名分裂：旧项目 `fr95fuwu57`（旧版本，类型不兼容 upload_v2 CLI，闲置待控制台核对清理，删除不可逆需授权） |
| 腾讯云自建服务器 | 前后端 + SQLite | `deploy/deploy.sh`（nginx + systemd + certbot） | ✅ **唯一生产权威终点（铁律十二）** `https://zy.laal.top`（API `https://api.laal.top`；旧 `mim.mixm.top` 仅 301） |

托管平台以独立域名直连 API 时，需在生产 `mim-api.env` 配置跨域白名单 `MIM_CORS_ORIGINS`（`deploy/deploy.sh` 已幂等补齐 `https://afdk1991.github.io,https://zy.laal.top,https://api.laal.top,https://data.laal.top,https://data.mixm.top`）。

#### 自定义域名（2026-11-11 按 DNSPod `mixm.top` 导出统一命名）

> 用户指令「多平台部署矩阵所有自定义域名使用导出中对应的域名」。命名取自 `dnspod_records_2026-11-05_21-42-26.xls` 的 `mixm.top` 工作表主机记录，单一事实源为 `packages/core-domain/src/customDomains.json`（含 xls 行号、备注、状态、下一步），门禁 `node scripts/verify-custom-domains.mjs`。该导出**只有主机记录与备注，记录类型与记录值两列全为空**，故下表只确定命名与归属，解析以 DNSPod 控制台现状为准。

| 平台 | 自定义域名 | 状态 |
|---|---|---|
| 腾讯云自建服务器（生产权威终点） | `https://zy.laal.top`（旧 `mim.mixm.top` 仅 301 → `zy.laal.top`） | ✅ 已解析并在线（`https://zy.laal.top/health` 200，2026-11-15 实测） |
| 腾讯云 EdgeOne Pages | `https://data.mixm.top` | ❌ 2026-11-12 21:23 控制台复核：mim 项目（`makers-iygo4nrk22jr`）域名管理仅默认域 `mim-45yeiirr.edgeone.cool`（已生效、产物最新），**未登记 `data.mixm.top` 自定义域**；该域在默认 DNS 与 8.8.8.8 双解析器均 NXDOMAIN（无 CNAME / 无 A）。恢复需先在控制台为 mim 添加该自定义域取得平台新 CNAME，再到 DNSPod 配置解析；DNS 侧凭证本机与 CI 均无 |
| GitHub Pages | `https://afdk1991.github.io/mim/`（平台默认域，不绑定自定义域名） | ✅ CI 自动发布 |
| Cloudflare Pages | `https://portal.mixm.top` | ⏳ DNSPod 未解析 / 平台未绑定 |
| Vercel | `https://m.mixm.top` | ⏳ DNSPod 未解析 / 平台未绑定 |
| Sealos（纯 API 容器） | `https://api.mixm.top` | ⏳ DNSPod 未解析 / 平台未绑定 |
| IGA Pages | `https://test.mixm.top` | ⏳ DNSPod 未解析 / 平台未绑定 |
| Gitee（码云）镜像仓 | `https://store.mixm.top` | ⏳ DNSPod 未解析 |
| GitHub 仓库 | `https://dev.mixm.top` | ⏳ DNSPod 未解析 |
| Cloudflare 独立 Worker（`mim-store`） | `https://shop.mixm.top` | ⏳ DNSPod 未解析 / Worker 未加路由 |
| GitHub Packages（ghcr） | —（域名固定 `ghcr.io`，不适用） | — |

补充：`cloud.mixm.top` 已解析至生产 CVM 并已被云服务模块占用（实测 200 / 5114B），不分配给任何托管平台；新域名若指向生产 CVM，需单独签发证书（现有证书不覆盖任意子域）。

#### 已采用免费层平台（2026-11-10 扩展，待接入外部账号）

> 用户决策「全部采用免费层」：将铁律十候选池中的下列 5 个免费平台提升为**已采用**登记项（见 `packages/core-domain/src/deploymentRegistry.json`，`status = UNVERIFIED`，未达线上可达，不冒充已部署）。配置脚手架与受保护 CI 已就绪，真实发布需在对应平台控制台创建项目并填入 secret 后由 CI 自动发布。

| 平台 | 免费额度 | 载体 / 配置 | 状态 |
|---|---|---|---|
| GitLab 仓库 | 顶级群组聚合 CI/CD 分钟、存储上限 5GB | 计划镜像仓，待关联账号后 `git remote add`（+2 计划远端） | ⏳ 已登记 / 待接入 |
| Bitbucket | 最多 5 人永久免费；仓库软限 2GB / 硬限 4GB；LFS 1GB；约 50 构建分钟/月 | 计划镜像仓，待关联账号后 `git remote add` | ⏳ 已登记 / 待接入 |
| Netlify | 300 构建分钟/月（2026-10 起新账号 credit 制） | `netlify.toml`（发布 `apps/web/dist` + SPA 回退）；CI `Netlify` 步骤缺 `NETLIFY_AUTH_TOKEN` 即 SKIP | ⏳ 已登记 / 待接入 |
| Azure Static Web Apps | 100GB 带宽/月、10 个应用；超额带宽不可用 | `.github/workflows/azure-static-web-apps.yml`（缺 `AZURE_SWA_TOKEN` 即 SKIP；部署前向 `apps/web/dist` 注入 `staticwebapp.config.json` 的 `navigationFallback`，深链接回退 `index.html`） | ⏳ 已登记 / 待接入 |
| Render | 每工作区 750 免费实例小时/月（空闲休眠） | `render.yaml`（官方蓝图 schema：`services: - type: web / runtime: static`，含 `routes` 深链接回退 `/* → /index.html`）；CI `Render` 步骤缺 `RENDER_API_KEY` 即 SKIP | ⏳ 已登记 / 待接入 |

> **最新取证（2026-11-10 22:18 +08:00，Cloudflare 三项落地轮）**：按用户「三项全做」推进，前两项闭环、第三项如实停下。① **`/api` 反代已上线**：本地 `npx wrangler@3 pages deploy apps/web/dist --project-name mim-8ah --branch main --commit-dirty=true`（用新建令牌 `mim-ci-gh-actions`，权限仅「Cloudflare Pages: 编辑」）→ 日志「Uploaded 4 files」「Uploading _redirects」「**Uploading Functions bundle**」「Deployment complete!」；② **CI 自动发布已恢复**：仓库 secrets 由 `total_count: 0` 补为 `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` 两条，并把 `deploy.yml` 的 `--project-name=mim` 修正为 `mim-8ah`、去掉该步骤 `continue-on-error`、同步 `wrangler.toml` 的 `name`（提交 `b739483`）；push 触发 run **42831492102** 五作业全绿，Cloudflare 步骤真实执行 `wrangler 4.160.0` 并输出「Success! Uploaded 3 files」「Uploading Functions bundle」「**Deployment complete!** … https://1c93fea4.mim-8ah.pages.dev**」。生产域复测：`/` **200 / 1.585s / 5114B**、`/store` **200 / 1.150s / 5114B**、预览域 200 / 1.541s。③ **生产 `mim.mixm.top` 未上线（如实记录）**：`Test-NetConnection 115.159.159.11` → 80 **False** / 443 **False** / 22 **True**，`curl --noproxy http(s)://mim.mixm.top/health` → **000**；云主机侧无 `~/.ssh`、`ssh root@115.159.159.11` → `Permission denied (publickey,password)`；腾讯云控制台跳登录页（无登录态），故主机 Web 服务未起的根因与 `/api` 的 **521** 均无法在本轮修复，**不得据此宣称上线**。

> **最新取证（2026-11-10 21:47 +08:00，Cloudflare Pages 复核与重建轮）**：复核发现 `https://mim-8ah.pages.dev` 返回 **530（项目不存在）**，Cloudflare 账号 `15726833367@139.com`（Account ID `a799197458978d508f927083360c635b`）的「Workers 和 Pages」项目列表为**空**，`mixm.top` zone 内 **0 条 DNS 记录**；此前提到的「CI 自动发布」实为 `deploy.yml` 的 Cloudflare 步骤因缺 `CLOUDFLARE_API_TOKEN` 而 `SKIP: 缺少 …; exit 0` 的假绿。本轮用控制台「直接上传」重建 Pages 项目 `mim-8ah` 并直传根构建 `dist`（6 文件），取证：`/` **200 / 1.455s / 5114B**（`title=Mim`、产物 `assets/index-DkyuUDY7.js` + `index-DY6XAYXj.css`）、`/store` **200 / 1.040s / 5114B**、`assets/index-DkyuUDY7.js` **200**。**如实记录的限制**：本次为纯静态直传，**不含 `/api` 反代**（`functions/api/[[path]].js` 未随上传，同源后端不可用）；push 后 CI 不会自动重发，须补 `CLOUDFLARE_API_TOKEN` 才恢复自动发布。

> **最新取证（2026-11-09，公网商城可用性恢复轮）**：`mim.mixm.top` 生产主机已不可达（80/443 拒连、`/opt/mim` 不存在、SSH 主机密钥变更且公钥被拒，无 `tccli` 凭据），Cloudflare 账号 `15726833367@139.com` 下 **zone = 0**（`mixm.top` 的 DNS 在 DNSPod），故「cloudflared 具名隧道绑自定义域名」不可行。改以**同源 Pages 入口**恢复商城：`_worker.js`（Pages 高级模式）把 `/api/*` 与 `/health` 反代到本机同源站点（cloudflared 快速隧道 `https://bid-actress-reflected-occasion.trycloudflare.com` → `127.0.0.1:5188` → `/api` 转 `127.0.0.1:8787`），静态资源由 Pages 托管。**取证**：`https://mim-8ah.pages.dev` `/health` 200 / 53B、`/api/v1/modules` 200 / 3411B（8 个模块）、`/store` `/comic` `/settings` `/login` 全 200 / 5182B；Edge CDP 真实浏览器 E2E **5/5 PASS**（登录 200 → 8 张卡片 → 购买 99/299/999/199/49 → 待结算 → 我的订单 → 取消后徽标消失），截图 [.tmp/store-pages.png](./.tmp/store-pages.png)。**同一账号另发固定入口 Worker `mim-store`（`https://mim-store.15726833367.workers.dev`，Version `a31ecf09`）**，但本机 `*.workers.dev` 被 DNS 污染（解析至 `156.233.67.243`、443 不通），故不作为国内入口。**限制如实记录**：该入口依赖本机三进程在线；`wrangler pages deploy` 为手工直传，后续 CI 若重发 Pages 会以 `mim.mixm.top` 覆盖（需先恢复主机或改 CI 的 `VITE_API_ORIGIN`）。Gitee(`mallwm_admin/mim`)、Sealos、Vercel、EdgeOne、ghcr 本轮均未产生新部署：Gitee 无凭据、后四者 CI secrets 为空（SKIP 假绿）。


> **最新取证（2026-11-08 17:42:36 +08:00，本机中国网络 curl，HEAD `1b3072e`；性质为「仓库 / 文档一致性加固轮」的可访问性复测，无新功能部署）**：自建主站 `/health` 200 / 0.074s / 0.035s / LEN=53、首页 200 / 0.075s / 0.034s / LEN=5182（产物 `assets/index-ChbzA5PZ.js` + `assets/index-CeRvh2Rf.css`）、五条深链接 `/store` 0.060s / `/comic` 0.063s / `/chat` 0.064s / `/settings` 0.053s / `/login` 0.061s 全部 200 / LEN=5182（nginx `try_files` SPA 回落实测生效）、`/admin/` 200 / 0.093s / LEN=1430、`/api/v1/modules` 200 / 0.066s / LEN=438（返回 `comic.workbench` 一条上架模块）、`/api/v1/site/overview` 404 / LEN=126（`NOT_FOUND` 信封）；GitHub Pages `/mim/` 200 / 0.402s / LEN=5182（产物 `index-Mq2I8smM.js`），深链接 `/mim/store` 404 / 1.008s / LEN=5182（`404.html` 副本，属平台能力上限的预期设计）；Cloudflare Pages 首页 200 / 2.401s / LEN=5182（产物与自建同指纹），带 `Accept: text/html` 头深链接 `/store` 200 / 0.982s、`/comic` 200 / 0.749s、`/login` 200 / 0.948s 全部 LEN=5182，裸 curl `/store` 404 / 0.562s 属 catch-all Function 按设计只重写 html 导航；Sealos `/health` 200 / 0.366s / 0.196s / LEN=53；EdgeOne `data.mixm.top` 200 / 0.090s / LEN=985 仍为 WAF 挑战页（`EO_Bot_Ssid` / `_0x649a`，真实内容未以 curl 复验）；ghcr 未鉴权 401 / 0.537s / LEN=73 正常；Vercel 本机 000 / 21.276s（curl exit 28，DNS 污染）、github.com 本机 000 / 0.015s（curl exit 35，TLS 握手阻断，TCP 0.007s 可连），替代取证 `git ls-remote` 返回远端 `refs/heads/main` = `1b3072e`，与本地 HEAD 一致（0 ahead / 0 behind）。**逐平台明细以 [AGENTS.md 铁律九表格](./AGENTS.md) 为准**；下方 01:48 与 05:05 段落均为历史留痕，不冒充本轮结果。

> **最新取证（2026-11-08 18:14:17 +08:00，成片导出交付轮，HEAD `3271204`，CI run 42470091995 五作业全绿）**：生产自建首页 200 / 0.064s / LEN=5182 已加载本轮新产物 `assets/index-D2UkZqM1.js`（与本地同源构建一致）；`/health` 200 / 0.061s / LEN=53、五条深链接全 200 / LEN=5182、`/api/v1/modules` 200 / LEN=438、导出路由匿名探测 401（非 404，路由在线）；GitHub Pages `/mim/` 200（`index-COy8rstl.js`，根构建注入 API 源）、Cloudflare Pages 首页 200 与带 `Accept: text/html` 深链接 200、Sealos `/health` 200、EdgeOne WAF 挑战页 985B、ghcr 401、Vercel 本机 TLS 阻断（CI 平台同步作业 success 替代取证）。生产 Edge CDP E2E 8/8（商城匿名搜索 → 详情面板、按需登录门禁、console 零错误），本地成片导出 E2E 14/14。逐平台明细见 [AGENTS.md 铁律九表格](./AGENTS.md) 与 [05-runbook.md §7.1.3](./docs/wiki/05-runbook.md)。
> **最近一次复测（2026-11-08 18:3x +08:00，商城充实轮——本地 Edge CDP 验证，HEAD 待定）**：根因修复——此前「商城看不到」为 `seedModules` 仅种入 1 个模块导致页面显空；本轮扩充为 **8 个模块**（含付费生成包三档与依赖链）。本地 `GET /api/v1/modules` 返回 8 条、`Edge CDP` 渲染 `/store` 确认 8 张卡片（标题/价格/前置依赖/按钮可见、零控制台错误）；`pnpm --filter @mim/api test` 11 文件 154/154、`pnpm -r typecheck` 0、`comment-check --strict` 0（90.1%）、web 构建 0。生产九平台取证与 E2E 待 push + CI 后刷新；`/store` 为 Web SPA 路由，仅 `mim.mixm.top` / GitHub Pages / Cloudflare Pages 提供，EdgeOne（WAF）与 Sealos（纯 API 容器）本就不托管商城 SPA，其异常非缺陷。
> **历史留痕：取证口径说明（2026-11-08 05:05:32 核对）**：下方一段为 **2026-11-07 01:48 的历史实测快照**（对应 commit `7e4e3e9`），数值按铁律三保留原样留痕，**不冒充本轮结果**。仓库当前 HEAD 已推进至 `83f454c`（CI run 42413909910 五作业全绿）；**当时的逐平台取证见 [AGENTS.md 铁律九表格](./AGENTS.md)（2026-11-08 05:05:32 按需登录交付轮，本机中国网络 curl；现已被 18:14 成片导出交付轮取代）**——按需登录模型已上线：商城 `/store` 匿名可浏览，`/comic` `/chat` `/settings` 收费/私密视图匿名访问时于内容区内嵌登录卡片；自建主站 `/health` 200/0.087s、首页 200/0.066s（LEN=5182，产物 `assets/index-ChbzA5PZ.js` + `assets/index-CeRvh2Rf.css`）、五条深链接（`/store` `/comic` `/chat` `/settings` `/login`）全 200/LEN=5182、`/api/v1/modules` 200/0.062s（LEN=438）；**EdgeOne `data.mixm.top` curl 200/0.116s 仍为 985B WAF 挑战页**（真实内容最近一次复验为 2026-11-08 04:33 有头放行后商城全链路通过）；GitHub Pages `/mim/` 200/0.535s（深链接 404+LEN=5182 属 `404.html` 预期设计）、Cloudflare Pages 200/0.678s（LEN=5182 与自建同指纹，带 `Accept: text/html` 头深链接 `/store` `/comic` `/login` 全 200）、Sealos `/health` 200/0.269s；本地 `scripts/verify-auth-gate.mjs --live` 52/52 与生产匿名态 live 6/6 全 PASS。本页与 `docs/wiki/05-runbook.md §7.1.3` 的 01:48 数值待下一轮独立 curl 后再同步。

> **2026-11-07 01:48:24 +08:00 本机实测（中国网络，commit `7e4e3e9`，历史快照）**：9 个免费平台全部接入或已取证上线——自建 `mim.mixm.top` 200/0.065s 最快（`/health` 200/0.070s），且首页已引用本轮新产物 `assets/index-B15IIvsS.js` + `assets/index-Dxv4qrxj.css`（证明「整站强制登录改为公开视图免登录」已上线）；EdgeOne `data.mixm.top` curl 200/0.062s 但**响应体仅 986B，为 EdgeOne WAF 机器校验页（`EO_Bot_Ssid` / `_0x649a`），属假阳性**——本轮复用 profile 的 WAF 放行凭证已过期（约 17h），回落层 2 验证码页，CDP 合成点击 ×15 未通过，真实内容本轮未复验（最近一次有头取证 2026-11-06：`title=Mim（旧定位副标题已于 2026-11-10 删除）`、`assets/index-cpYhbG3w.js`、`isWafChallenge=false`）；GitHub Pages 200/0.225s、Cloudflare Pages 200/1.172s、Sealos `/health` 200/0.283s（根路径 `/` 404 `route GET / not found` 属正常）、ghcr 未鉴权 401/0.745s（正常）。Vercel 与 github.com 本机不可达属网络侧限制（Vercel DNS 污染至 162.125.2.5（Dropbox 段地址）/ github.com TLS 握手阻断 exit 35、TCP 0.019s 可连），CI 与 git/gh 侧取证正常（HEAD `7e4e3e9`）。逐平台 HTTP / 耗时 / 连接明细见 [05-runbook.md §7.1.3](./docs/wiki/05-runbook.md)；DNSPod 记录与功能模块对应见同页 §7.6。

> **`?tads` 注入机制与本轮修复（2026-11-07 定性）**：EdgeOne Bot 挑战脚本会给地址栏附加 `?tads`，其清理逻辑为字符串表内的 `location.href=location.href.replace(/[?|&]tads/, '')`——只匹配 `?tads` 本体、不匹配清理后残留的裸问号，故地址栏留下 `https://data.mixm.top/?`。**项目侧修复**：`apps/web/index.html` 的 `<head>` 内置归一化脚本（`history.replaceState` 原地清掉空查询串 / 裸问号，不新增历史、不触发跳转）。**上线验证（2026-11-07）**：`mim.mixm.top/`、`mim-299.pages.dev/`（当时为 `mim-8ah.pages.dev`，2026-11-11 项目名统一后域名变更）、`afdk1991.github.io/mim/` 响应均含该归一化脚本；`data.mixm.top` 因 WAF 全路径挑战无法用 curl 复验内容层（如实记录），已用 `edgeone makers deploy apps/web/dist -n mim-app --env production` 直传（最近一次为 2026-11-08 干净树产物 Deployment `dpu0n61jlos8`）。
>
> **EdgeOne WAF 拦截面（2026-11-07 补充实测）**：层 1 —— `curl` / 无头 UA 拿到约 986B 混淆 JS（`EO_Bot_Ssid` / `_0x649a`）；层 2 —— **无头浏览器（`--headless=new`）与全新 `user-data-dir` 的有头 Edge 都会落入验证码页**（`title=Security Verification`、`https://captcha.eo.gtimg.com/TEOCaptchaWidgetV1.js`、`htmlLen≈16419`、文案「正在验证连接安全性」）。**可通过方式与其失效边界**：复用**已通过过校验的** `user-data-dir`（本机 `$env:TEMP\edge-cdp-profile`）+ 有头模式 + CDP（`--remote-debugging-port=9333`）——2026-11-06 以此读得 `title=Mim（旧定位副标题已于 2026-11-10 删除）`、`htmlLen=1553`、`isWafChallenge=false`，截图存 [.screenshots/data-mixm-top-e2e.png](./.screenshots/data-mixm-top-e2e.png)；但**放行凭证会过期（实测约 17h 后失效：2026-11-07 01:48 复用该 profile 仍回落层 2）；层 2 的 TEOCaptcha 对 CDP 合成鼠标事件（`Input.dispatchMouseEvent`，×15 次点击）不放行；凭证过期后唯一出路是人工在有头浏览器勾选一次复选框，放行会回写 profile，后续 CDP 即可复用**。

### 部署汇总（2026-11-09 新增）

散落在铁律九矩阵（9 行）、本文件矩阵（10 行）、CI 工作流（5 作业）、`git remote`（2 个）与 §9.1 复核表里的同类项，现由**单一事实源** `packages/core-domain/src/deploymentRegistry.json` 收口，字段统一为 `snake_case`，前后端与脚本共用同一份定义：

| 统一字段 | 含义 / 空值约定 |
|---|---|
| `id` / `name` / `aliases` | 规范唯一键 / 统一名称 / 归并别名（去重依据） |
| `repository.id` / `url` / `role` | **仓库标识**三字段；直传型部署的 `id` / `url` 为 `null` |
| `status` | **部署状态**：`OK` / `BROKEN` / `UNVERIFIED` / `MANUAL` / `NOT_APPLICABLE` |
| `result` | **部署结果**：`PASS` / `DEGRADED` / `FAIL` / `NOT_TESTED` / `EMPTY`；整项为 `null` 即**空数据**，不填 0、不冒充成功 |
| `anomalies` | **异常说明**：`code` + `severity`（`critical`/`warning`/`info`，对应 🔴/🟡/🟢）+ `message` |
| `missing_fields` | **缺失信息**清单；空数组表示齐备 |
| `delivery.artifact_in_head` / `artifact_in_worktree` | 工件双口径：区分「远端 HEAD 仍存在」与「本地工作树已删除」 |

- **覆盖口径（2026-11-13 01:10 收口）**：**11 个矩阵平台**（腾讯云自建 / EdgeOne / GitHub Pages / Cloudflare Pages / ghcr / IGA / Vercel / GitHub 仓 / Gitee 镜像仓 / Netlify / Cloudflare 独立 Worker）→ **12 个规范部署项**（矩阵 11 行 + 同平台上的 `worker.mim-store`、`worker.mim-api-edge` 补充载体不重复计数）；**部署项全部 `OK` / `PASS`、有大取证、无空数据、无阻断异常**（`node scripts/deployment-summary.mjs`：部署项 12｜有取证 12｜空数据 0｜阻断异常 0（🔴0/🟡0）｜留痕 🟢30）。5 个 CI 作业中 4 个为部署作业，2 个真实 git 远端（`origin` GitHub / `gitee` Gitee 镜像仓）。
- **候选池（7 条，不计入汇总）**：`candidate.cf-workers`（形态已合并进 `pages.cloudflare` + `worker.mim-store`）、`excluded.vefaas`（无长期免费层，铁律九排除）、`excluded.sealos`（付费容器余额 0、应用 0 个，2026-11-12 用户选「换免费平台」后退休），以及 **2026-11-13 01:10 由部署项移入的 4 条**：`candidate.gitlab`（gitlab.com 对当前网络地区限制，注册/登录被重定向 `users/identity_verification/restricted`，仅给极狐入口）、`candidate.bitbucket`（需 Atlassian 账号 + App Password，且无静态托管）、`candidate.azure-swa`（免费层仍需 Azure 订阅 + 绑卡 + 部署令牌）、`candidate.render`（控制台已登录但新建服务强制 `Add Card` $1 授权验证）。四条的 `former_item_id`、原 `missing_fields` 与所需 `prerequisite` 均保留，补齐账号/令牌后可原样回迁为部署项。
- **去重**：README 曾把「Cloudflare Pages 同源自托管入口（`_worker.js`）」与「Cloudflare Pages / Workers」列成两行，实为同一域名同载体的两种发布形态，合并为 `pages.cloudflare` 一行并在 `delivery.modes` 区分。
- **本轮基线（2026-11-10 22:20 实测，Gitee 入矩阵轮）**：`gitee` 网页 200 / 0.469s / 52034B、`git ls-remote` exit 0 / 0.27s 且与本地 HEAD `4398cf0` 一致（历史 exit 124 超时已解除）；其余平台沿用 2026-11-09 23:03 快照（生产 `mim.mixm.top/health` = `000`，curl exit 7 本地代理 502；IGA Pages 与独立 Worker 为空数据）；工件双口径以 `git ls-tree HEAD` 与工作树实测为准，**不得以本表 `PASS` 冒充铁律八 / 十二的线上取证**。
- **生成与核对**：`npm run summary:deployments`（`--live` 追加真实 `curl` 探测）→ `docs/deployment-summary.json` + `docs/deployment-summary.md`；`npm run verify:deployments`（55 项断言）；**历史留痕**：Web 端 `/deployments` 核对表视图已随模块下线删除，后端只读路由与汇总产物保留。

本地构建：`npm run build`（真实前端 → 根 `dist/`，与 EdgeOne Pages 同款链路）；PRD 阅读页：`npm run build:site`（`site/` → `dist/`）；前端单独产物：`npm run build:web`；校验：`npm run check`。




## V0.0.11 六个「必须最先做」条目的不依赖凭据部分（2026-11-14）

新增四个前台视图并接进 SPA 路由：`/news` 社区资讯（复用 `GET /content/items`，未新增接口）、`/cloud` 私有云存储、`/img` 图床、`/download` 下载分发（承接 `store` 域，`/store` 段仍归商城）。后端把对象存储配置硬化为私有桶 + 预签名基线：`s3` 驱动缺桶名 / 区域 / 密钥直接抛 `STORAGE_CONFIG_INVALID`，不再静默回落本地；图床单独划出 `public/` 公有读前缀与 `MIM_STORAGE_PUBLIC_BASE_URL` 稳定直链基线。新增零依赖静态文档站 `help/`（项目介绍 / 部署说明 / 常见问题，内容与壳分离、可被后续站点复用）。本轮不 commit、不部署，需用户补齐桶参数与 CDN 基线后才可上线。

## V0.0.10 管理端六入口（2026-11-13）

在既有后台视图上新增批量改价、邀请码、实名审核、内容运营、自研工具、社区运营六个可操作入口；接口全部复用 `/api/v1/admin/*` 与运营域 API 拆分文件 `apps/admin/src/api-ops.ts`。CI run 43411850989 五作业全绿，生产 `/health` 返回 `0.0.10`。
