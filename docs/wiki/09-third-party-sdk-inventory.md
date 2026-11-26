# 09 · 第三方 SDK / API / API Key 全量清单（含北斗卫星导航）

> 本文档是 Mim 第三方能力接入的**唯一基线清单**。任何新增/变更的第三方 SDK、开放 API、密钥，必须先登记到本文件，再进入代码实现（铁律五 + 铁律七）。
>
> 当前状态：仓库已进入编码阶段。`services/mim-api`（`@mim/api`）已含运行时依赖并写入 `package.json` + `pnpm-lock.yaml`：`express ^5.3.0`、`better-sqlite3 ^13.0.3`、`jsonwebtoken ^9.0.3`、`bcryptjs ^3.0.2`、`zod ^4.6.7`、`@aws-sdk/client-s3 ^3.1162.0`、`@aws-sdk/s3-request-presigner ^3.1162.0`（devDeps：`vitest@4`、`supertest@7`、`tsx@4`、`typescript@5.6.3`、`esbuild@0.25`），均属业务自研基础设施而非下表所列第三方 SaaS/SDK。其中 AWS SDK 用于 media 域对象存储准入（预签名上传/下载、S3 兼容端点），已在 `package.json` + `pnpm-lock.yaml` 落位（铁律五）。本文档登记的第三方能力清单仍为「计划引入」状态；对应能力接入时，按铁律五把依赖写入 `package.json` 并提交锁文件，同时更新本清单状态。
>
> **2026-11-07 增补 `apps/admin`（独立管理后台）前端依赖 7 项**（同为构建期 / 基础设施类，非第三方 SaaS）：`react ^18.3.1`、`react-dom ^18.3.1`（视图运行时）、`vite ^6.4.4`、`@vitejs/plugin-react ^4.7.0`（构建与开发服务器）、`typescript ^5.6.3`（类型检查）、`@types/react ^18.3.12`、`@types/react-dom ^18.3.1`（类型声明）。全部已写入 `apps/admin/package.json` 并经 `pnpm install` 提交 `pnpm-lock.yaml`；管理后台不引入任何 UI 组件库（自写 CSS 令牌），因此无额外第三方组件依赖。
>
> **2026-11-10 增补本地 npm 开源库 5 项**（无密钥、进程内依赖，非第三方 SaaS；调研来源见 [开源组件引入决策-2026-11-10.md](../开源组件引入决策-2026-11-10.md)）：`apps/web` 前端——`echarts ^6.1.0`（`Store.tsx` 价格历史折线图 `PriceHistoryChart`；`Sites.tsx` 总览状态分布环形图 `StatusPieChart`）、`@antv/g6 ^5.1.1`（`Store.tsx` 详情面板依赖链有向图 `DependencyGraph`）、`vditor ^4.0.1`（`ComicWorkbench.tsx` 创建标签页脚本 Markdown 编辑器 `ScriptEditor`）；`services/mim-api` 后端——`sharp ^0.35.5`（`GET /api/v1/media/thumb` WebP 缩略图端点；前端 `AssetPreview` 带 Bearer fetch BlobURL 内联预览、失败回退原图）、`exceljs ^4.4.0`（`GET /api/v1/orders/export` 订单 xlsx 导出端点）。5 项均已写入对应 `package.json` 并更新 `pnpm-lock.yaml`，typecheck / 构建 / 契约测试全绿（api 233 例）。

---

## 0. 三条硬约束

| 约束 | 规则 |
|---|---|
| 密钥不入库 | 所有 `AppKey` / `AppSecret` / `PrivateKey` / `MchId` 只允许出现在环境变量、CI Secret、云密钥管理（KMS）中；仓库只提交占位模板 `.env.example` |
| 密钥按 region 隔离 | 国内（cn）与海外（global）使用**独立应用与独立密钥**，不得复用同一套凭证 |
| 先登记后接入 | 新增第三方能力必须在本文件补齐「提供方 / 形态 / 用途 / 密钥名 / 优先级 / 合规」六要素，否则视为未完成交付 |

密钥统一命名：`MIM_<领域>_<提供方>_<密钥类型>`，全大写下划线分隔，例如 `MIM_STORAGE_S3_ACCESS_KEY_ID`。

---

## 1. 账号与身份

| 提供方 | SDK / API 形态 | 用途 | 密钥 / 配置项（env） | 优先级 |
|---|---|---|---|---|
| 微信开放平台 | 网站应用 / 移动应用 / 小程序 SDK、OAuth2.0 | 微信扫码/授权登录、UnionID 打通 | `MIM_AUTH_WECHAT_APP_ID` / `MIM_AUTH_WECHAT_APP_SECRET` | P0 |
| 支付宝开放平台 | 开放平台 SDK、OAuth2.0 | 支付宝授权登录 | `MIM_AUTH_ALIPAY_APP_ID` / `MIM_AUTH_ALIPAY_PRIVATE_KEY` / `MIM_AUTH_ALIPAY_PUBLIC_KEY` | P0 |
| Google Identity | Google Sign-In SDK、OAuth2.0 / OIDC | 海外 Google 登录 | `MIM_AUTH_GOOGLE_CLIENT_ID` / `MIM_AUTH_GOOGLE_CLIENT_SECRET` | P0 |
| Apple | Sign in with Apple（原生 / JS） | 海外 Apple 登录、App Store 强制项 | `MIM_AUTH_APPLE_SERVICE_ID` / `MIM_AUTH_APPLE_TEAM_ID` / `MIM_AUTH_APPLE_KEY_ID` / `MIM_AUTH_APPLE_PRIVATE_KEY` | P0 |
| GitHub | OAuth 2.0 Web Flow（`oauth4webapi`） | 开发者账号登录、拉 `user/emails` 补邮箱 | `MIM_AUTH_GITHUB_CLIENT_ID` / `MIM_AUTH_GITHUB_CLIENT_SECRET` | P0 |
| Gitee（码云） | OAuth 2.0（`oauth4webapi`） | 国内开发者账号登录 | `MIM_AUTH_GITEE_CLIENT_ID` / `MIM_AUTH_GITEE_CLIENT_SECRET` | P0 |
| GitLab | OAuth 2.0（`oauth4webapi`，支持自建实例端点覆盖） | 企业与自建 GitLab 登录 | `MIM_AUTH_GITLAB_CLIENT_ID` / `MIM_AUTH_GITLAB_CLIENT_SECRET` | P1 |
| Microsoft 身份平台 | Microsoft Entra ID v2.0（OIDC，`oauth4webapi`） | 海外企业 / 个人账号登录 | `MIM_AUTH_MICROSOFT_CLIENT_ID` / `MIM_AUTH_MICROSOFT_CLIENT_SECRET` | P0 |
| QQ 互联 | QQ 登录（`graph.qq.com`，专用适配器：先换 `openid` 再拉资料） | 国内 QQ 登录 | `MIM_AUTH_QQ_APP_ID` / `MIM_AUTH_QQ_APP_KEY` | P1 |
| 抖音开放平台 | 抖音网站应用授权（`open.douyin.com`，专用适配器：`client_key` + 逗号 scope + `data` 嵌套响应） | 国内抖音账号登录 | `MIM_AUTH_DOUYIN_CLIENT_KEY` / `MIM_AUTH_DOUYIN_CLIENT_SECRET` | P1 |
| 微博开放平台 | 微博 OAuth2.0（`api.weibo.com`，专用适配器） | 国内微博账号登录 | `MIM_AUTH_WEIBO_CLIENT_ID` / `MIM_AUTH_WEIBO_CLIENT_SECRET` | P1 |
| 百度开放平台 | 百度 OAuth2.0（`openapi.baidu.com`，standard 通用客户端） | 国内百度账号登录 | `MIM_AUTH_BAIDU_CLIENT_ID` / `MIM_AUTH_BAIDU_CLIENT_SECRET` | P1 |
| Facebook | Graph API v19.0（standard 通用客户端，头像嵌套 `picture.data.url`） | 海外 Facebook 登录 | `MIM_AUTH_FACEBOOK_CLIENT_ID` / `MIM_AUTH_FACEBOOK_CLIENT_SECRET` | P1 |
| Twitter（X） | OAuth2 PKCE + HTTP Basic（`api.twitter.com/2`，资料包 `data` 节点） | 海外 X 登录 | `MIM_AUTH_TWITTER_CLIENT_ID` / `MIM_AUTH_TWITTER_CLIENT_SECRET` | P1 |

> **2026-11-12 落地状态**：上表 9 家（微信 / Google / Apple / GitHub / Gitee / GitLab / Microsoft / QQ / 抖音）已全部进入代码实现，注册表在 `services/mim-api/src/oauth/providers.ts`，协议层 `oauth/client.ts`（标准实现依赖 `oauth4webapi@3.8.8`，微信 / QQ / 抖音走专用适配器，Apple 用 p8 现签 ES256 client_secret），绑定与一次性票据在 `oauth/accounts.ts`，端点在 `routes/oauth.ts`。公共配置：`MIM_OAUTH_CALLBACK_BASE`（后端对外基址，缺省取请求的 `x-forwarded-proto` + `host`）、`MIM_WEB_BASE_URL`（回调 302 的前端基址）。每家 provider 另支持 `MIM_AUTH_<ID>_REDIRECT_URI` / `_AUTHORIZE_URL` / `_TOKEN_URL` / `_PROFILE_URL` / `_JWKS_URL` 五个可选覆盖变量（自建 GitLab / GitHub Enterprise / 联合调试）；Apple 因平台回调形态特殊，示例模板中显式列出 `MIM_AUTH_APPLE_REDIRECT_URI`；回调地址默认 `${MIM_OAUTH_CALLBACK_BASE}/api/v1/auth/oauth/<id>/callback`。**凭证未配置时该家 `configured=false`，前端按钮置灰、接口返回 `AUTH_OAUTH_NOT_CONFIGURED(503)`，不得视为可用**。平台侧需登记的回调 URL 见 [05-runbook §第三方登录回调登记](./05-runbook.md)。支付宝仍仅用于支付场景，不承担登录。

> **2026-11-14 落地状态更新（覆盖上一段的「9 家 / 支付宝不承担登录」口径，原文按铁律三保留）**：注册表 `OAUTH_PROVIDERS` 已扩至 **14 家登录 provider**（GitHub / Gitee / GitLab / Google / Microsoft / Apple / 微信 / QQ / 抖音 / **微博 / 百度 / 支付宝 / Facebook / Twitter(X)**）。适配器 flavor 分流共七种：`standard`（GitHub / Gitee / GitLab / Google / Microsoft / **百度 / Facebook / Twitter**）、`apple`、`wechat`、`qq`、`douyin`、**`weibo`（专用适配器）**、**`alipay`（专用适配器，`auth_user_info` scope，网关统一端点）**——即**支付宝已同时承担登录**（`MIM_AUTH_ALIPAY_APP_ID` + `MIM_AUTH_ALIPAY_PRIVATE_KEY` 作凭证），不再仅限支付场景。2026-11-12 段的其余口径（公共配置、五个可选覆盖变量、未配置置灰 `AUTH_OAUTH_NOT_CONFIGURED(503)`）继续有效。
| 阿里云短信 | 短信服务 API（`@alicloud/dysmsapi20170525`） | 国内验证码 | `MIM_SMS_ALIYUN_ACCESS_KEY_ID` / `MIM_SMS_ALIYUN_ACCESS_KEY_SECRET` / `MIM_SMS_ALIYUN_SIGN_NAME` / `MIM_SMS_ALIYUN_TEMPLATE_CODE` | P0 |
| 腾讯云短信 | SMS API | 国内验证码备份通道 | `MIM_SMS_TENCENT_SECRET_ID` / `MIM_SMS_TENCENT_SECRET_KEY` / `MIM_SMS_TENCENT_SDK_APP_ID` | P1 |
| 阿里云邮件推送 / AWS SES | 邮件 API（SES 走 `@aws-sdk/client-ses`） | 海外注册验证与通知邮件 | `MIM_EMAIL_ALIYUN_ACCESS_KEY` / `MIM_EMAIL_SES_ACCESS_KEY_ID` / `MIM_EMAIL_SES_SECRET_ACCESS_KEY` / `MIM_EMAIL_SES_REGION` / `MIM_EMAIL_SES_FROM_ADDRESS` | P0 |
| 自建 SMTP（站点选项「邮件」分组托管入口，2026-11-20） | SMTP 直连（后台只存主机/端口/TLS/账号/发信人；口令走环境变量） | 站点通知与账号类邮件，替代第三方邮件 API 的自托管通道 | `MIM_SMTP_PASSWORD`（变量名可由后台字段 `smtp_password_ref` 指定，默认即此名） | P1 |

---

## 3. 推送与消息触达

| 提供方 | SDK / API 形态 | 用途 | 密钥 / 配置项（env） | 优先级 |
|---|---|---|---|---|
| APNs | Apple Push Notification service（HTTP/2 API） | iOS 推送 | `MIM_PUSH_APNS_KEY_ID` / `MIM_PUSH_APNS_TEAM_ID` / `MIM_PUSH_APNS_PRIVATE_KEY` / `MIM_PUSH_APNS_TOPIC` | P0 |
| FCM | Firebase Cloud Messaging SDK / HTTP v1 API | Android 海外推送 | `MIM_PUSH_FCM_PROJECT_ID` / `MIM_PUSH_FCM_SERVICE_ACCOUNT_JSON` | P0 |
| 华为 HMS Push | HMS Core Push SDK | 华为/鸿蒙设备推送 | `MIM_PUSH_HUAWEI_APP_ID` / `MIM_PUSH_HUAWEI_APP_SECRET` | P0（国内 App） |
| 小米推送 | MiPush SDK | 小米设备推送 | `MIM_PUSH_XIAOMI_APP_ID` / `MIM_PUSH_XIAOMI_APP_KEY` | P0（国内 App） |
| OPPO / vivo 推送 | 厂商 Push SDK | 对应设备推送 | `MIM_PUSH_OPPO_APP_KEY` / `MIM_PUSH_OPPO_MASTER_SECRET` / `MIM_PUSH_VIVO_APP_ID` / `MIM_PUSH_VIVO_APP_KEY` | P0（国内 App） |
| 极光 / 个推 | 聚合推送 SDK | 厂商通道聚合与回落 | `MIM_PUSH_JPUSH_APP_KEY` / `MIM_PUSH_JPUSH_MASTER_SECRET` / `MIM_PUSH_GETUI_APP_ID` | P1 |
| 微信模板消息 / 订阅消息 | 小程序订阅消息 API | 小程序内通知 | 复用 `MIM_AUTH_WECHAT_APP_ID` / `SECRET` | P0 |

---

## 4. IM 与实时通信（PRD P1）

| 提供方 | SDK / API 形态 | 用途 | 密钥 / 配置项（env） | 优先级 |
|---|---|---|---|---|
| 腾讯云 IM | TIM SDK / REST API | 会话、消息、离线推送 | `MIM_IM_TENCENT_SDK_APP_ID` / `MIM_IM_TENCENT_SECRET_KEY` | P1 |
| 环信 / 融云 | IM SDK / REST API | 备选 IM 供应商 | `MIM_IM_HUANXIN_APP_KEY` / `MIM_IM_RONGCLOUD_APP_KEY` / `MIM_IM_RONGCLOUD_APP_SECRET` | P2 |
| Sendbird / Stream | Chat SDK | 海外 IM | `MIM_IM_SENDBIRD_APP_ID` / `MIM_IM_STREAM_API_KEY` | P2 |
| Twilio | Programmable Messaging API | 海外短信 / WhatsApp 触达 | `MIM_MSG_TWILIO_ACCOUNT_SID` / `MIM_MSG_TWILIO_AUTH_TOKEN` | P1 |

---

## 5. 音视频（PRD P1，采购不自研）

| 提供方 | SDK / API 形态 | 用途 | 密钥 / 配置项（env） | 优先级 |
|---|---|---|---|---|
| 声网 Agora | RTC SDK / RESTful API | 实时音视频 | `MIM_RTC_AGORA_APP_ID` / `MIM_RTC_AGORA_APP_CERTIFICATE` | P1 |
| 腾讯云 TRTC | TRTC SDK / REST API | 实时音视频（国内主选） | `MIM_RTC_TENCENT_SDK_APP_ID` / `MIM_RTC_TENCENT_SECRET_KEY` | P1 |
| 即构 ZEGO | RTC / 直播 SDK | 备选 | `MIM_RTC_ZEGO_APP_ID` / `MIM_RTC_ZEGO_APP_SIGN` | P2 |
| LiveKit | 开源 SFU + Cloud | 出海 / 可控成本方案 | `MIM_RTC_LIVEKIT_API_KEY` / `MIM_RTC_LIVEKIT_API_SECRET` / `MIM_RTC_LIVEKIT_URL` | P2 |
| 云录制 / 转码 | 各厂商云端录制 API、CDN | 录制、转码、回放 | 复用对应 RTC 凭证 + `MIM_CDN_*` | P1 |

---

## 6. AI 能力（已于 2026-11-15 随创作工作台一并下线）

> 漫剧生成、AI 编排与全部模型 / 语音 / 视频供应商凭证在 2026-11-15 的模块下线中移除：服务端不再读取对应变量，`.env.example` 也已清理。若未来重启 AI 能力，需同时补回实现、模板与本清单登记，避免清单与代码漂移。

---

## 7. 内容审核与安全

| 提供方 | SDK / API 形态 | 用途 | 密钥 / 配置项（env） | 优先级 |
|---|---|---|---|---|
| 数美 | 内容审核 API / SDK | 文本、图片、音频审核 | `MIM_MODERATION_SHUME_ACCESS_KEY` / `MIM_MODERATION_SHUME_APP_ID` | P1 |
| 网易易盾 | 内容安全 API | 备选审核 | `MIM_MODERATION_YIDUN_SECRET_ID` / `MIM_MODERATION_YIDUN_SECRET_KEY` | P1 |
| 阿里云内容安全 / 腾讯云天御 | 内容安全 API | 云厂商一体化审核 | `MIM_MODERATION_ALIYUN_ACCESS_KEY` / `MIM_MODERATION_TENCENT_SECRET_ID` | P1 |
| 腾讯防水墙 / 极验 | 验证码 SDK | 防刷、人机验证 | `MIM_CAPTCHA_TENCENT_APP_ID` / `MIM_CAPTCHA_GEETEST_ID` / `MIM_CAPTCHA_GEETEST_KEY` | P0 |

**反向代理与来源 IP 配置（自研 API，进程内）**

| 配置项（env） | 用途 | 默认值 | 优先级 |
|---|---|---|---|
| `MIM_TRUST_PROXY` | Express `trust proxy` 口径：`loopback` / 整数跳数 / 逗号分隔 CIDR / `false` / `true`；决定 `req.ip` 是否采信 `X-Forwarded-For`（登录失败锁定依赖真实来源 IP） | `loopback` | P0（安全） |

**自研算法参数（零第三方依赖，进程内）**

| 配置项（env） | 用途 | 默认值 | 优先级 |
|---|---|---|---|
| `MIM_ALGORITHM_WEIGHTS` | 搜索 / 热榜算法参数 JSON 覆盖：`bm25{k1,b,title,summary,body}`、`rank{halfLifeDays,engagementWeight}`、`heat{likes,replies,views,favorites,gravity}`、`window{search,trending}`；优先级高于后台 `site_settings`（键 `community_algorithm_weights`）与内置默认值，越界值被夹取 | 空（用默认值） | P1（排序口径） |


---

## 8. 存储、CDN 与基础设施

| 提供方 | SDK / API 形态 | 用途 | 密钥 / 配置项（env） | 优先级 |
|---|---|---|---|---|
| AWS S3 | S3 兼容 SDK | 海外对象存储（聊天 / 社区附件） | `MIM_STORAGE_S3_ACCESS_KEY_ID` / `MIM_STORAGE_S3_SECRET_ACCESS_KEY` | P0 |
| Cloudflare / EdgeOne 主动刷新（链路已实现，可选接入） | CDN REST API 按需 purge；仅厂商与凭证齐备时 `configured=true`，缺凭证返回 `CDN_NOT_CONFIGURED` 且不发上游请求 | `MIM_CDN_CLOUDFLARE_API_TOKEN`；其余厂商 / 凭证变量归 `MIM_CDN_*` 通配家族（PROVIDER / CLOUDFLARE_ZONE_ID / EDGEONE_ZONE_ID / EDGEONE_API_KEY） | P1（可选） |
| CloudFront 主动刷新 | **显式不支持**（错误码 `CDN_PROVIDER_UNSUPPORTED`）：本部署不依赖边缘 CDN 主动刷新——前端产物文件名带 hash 走不可变长缓存、HTML 走 no-cache 协商缓存、站点由 nginx / `_redirects` 直出，发版即变更 URL，旧 hash 产物无人引用，无需 purge；未来若真接入 CloudFront，需 SigV4 签名与分发 ID，属新增能力，不在当前范围 | `MIM_CDN_ALIYUN_ACCESS_KEY`（预留登记，当前代码零读取）；CloudFront 三项凭证归 `MIM_CDN_*` 通配家族，当前不读取 | 不支持 |

> CDN 口径（2026-11-20 修订）：本生产部署为单机 nginx 直出，未启用边缘 CDN；`scripts/verify-cdn.mjs` 探测到「可达但无缓存特征」记 `disabled-expected`（预期，不作为缺陷），两次均不可达才记 `unreachable`（网络 / 域名问题）。主动刷新仅 cloudflare / edgeone 两条 REST 链路实现；CloudFront 显式不支持，不再保留「待接入 AWS SDK」一类占位表述。

**对象存储准入运行时配置（自研 `media` 域，进程内模块）**

| 配置项（env） | 用途 | 默认值 | 优先级 |
|---|---|---|---|
| `MIM_STORAGE_DRIVER` | 存储驱动（`local` 本地磁盘 / `s3` S3 兼容） | `local` | P0（第 2 期已接入） |
| `MIM_STORAGE_LOCAL_DIR` | 本地驱动落盘根目录 | `<服务目录>/data/media` | P0 |
| `MIM_STORAGE_S3_ENDPOINT` | S3 兼容端点（OSS / COS / R2 / MinIO；AWS 可留空） | 空 | P0 |
| `MIM_STORAGE_S3_REGION` | S3 区域 | 无（`s3` 模式下必填；R2 填 `auto`，AWS 填如 `us-east-1`） | P0 |
| `MIM_STORAGE_S3_BUCKET` | 存储桶名（须为私有桶） | 无（`s3` 模式下必填；缺项启动即抛 `STORAGE_CONFIG_INVALID`） | P0 |
| `MIM_STORAGE_S3_FORCE_PATH_STYLE` | 路径风格（MinIO 需 `1`） | `0` | P0 |
| `MIM_PUBLIC_BASE_URL` | 对外公开基址（本地驱动预签名 URL 拼接） | 请求 Host | P0 |
| `MIM_CATALOG_IMAGE_DIR` | 全量商城高清图落盘目录（API `/mall/img` 与每日采集器共用；须在发布目录之外，避免发布清理误删） | 生产 `/var/lib/mim/catalog-images`；开发 `storage/catalog-images` | P1 |

> 预签名 URL 的有效期默认 900 秒、上限 7 天；`object_key` 归属校验统一 404，不泄露他人资源存在性。

**应用运行时配置（自研 API 跨域白名单）**

| 配置项（env） | 用途 | 默认值 | 优先级 |
|---|---|---|---|
| `MIM_CORS_ORIGINS` | 允许跨域直连 API 的来源白名单（逗号分隔，如两个托管平台域名）；托管平台（GitHub Pages / Cloudflare / Vercel / Render）以独立域名访问时必配；留空则不挂载 CORS 中间件（自建服务器同源反代无需配置） | 空 | P0（托管部署必需） |

---

## 9. 可观测性、分析与实验

| 提供方 | SDK / API 形态 | 用途 | 密钥 / 配置项（env） | 优先级 |
|---|---|---|---|---|
| Sentry | Sentry SDK / DSN | 前后端异常监控 | `MIM_OBS_SENTRY_DSN` / `MIM_OBS_SENTRY_AUTH_TOKEN` | P0 |
| Datadog / Grafana Cloud | Agent / SDK / API | 指标、日志、链路追踪 | `MIM_OBS_DATADOG_API_KEY` / `MIM_OBS_GRAFANA_TOKEN` | P2 |
| Langfuse | SDK / API | AI 链路追踪与评测 | `MIM_OBS_LANGFUSE_PUBLIC_KEY` / `MIM_OBS_LANGFUSE_SECRET_KEY` | P2 |
| Umami / GA4 / Mixpanel | 埋点 SDK / Measurement Protocol | 行为分析与增长 | `MIM_ANALYTICS_UMAMI_WEBSITE_ID` / `MIM_ANALYTICS_GA4_MEASUREMENT_ID` / `MIM_ANALYTICS_MIXPANEL_TOKEN` | P1 |

---

## 10. 地图与位置服务

| 提供方 | SDK / API 形态 | 用途 | 密钥 / 配置项（env） | 优先级 |
|---|---|---|---|---|
| 高德地图 | JS API / 原生定位 SDK / Web 服务 API | 国内地图、POI、逆地理编码 | `MIM_MAP_AMAP_KEY` / `MIM_MAP_AMAP_SECURITY_CODE` | P1 |
| 百度地图 | JS API / 定位 SDK | 国内备选 | `MIM_MAP_BAIDU_AK` | P2 |
| 腾讯位置服务 | 地图 SDK / WebService API | 小程序内地图 | `MIM_MAP_TENCENT_KEY` | P1 |
| Google Maps Platform | Maps SDK / Places / Geocoding API | 海外地图 | `MIM_MAP_GOOGLE_API_KEY` | P1 |
| Mapbox | Maps SDK / API | 海外定制地图 | `MIM_MAP_MAPBOX_TOKEN` | P2 |

---

## 11. 北斗卫星导航系统（专项）

北斗是本清单中**唯一需要单独定义接入边界**的第三方能力：它既可以是纯软件（系统 GNSS 芯片 + 高精度服务 SDK），也可以是含终端的硬件方案，两者在 PRD 的 IoT 排除项下口径不同。

### 11.1 能力分层与接入形态

| 层级 | 能力 | 典型接入形态 | 说明 |
|---|---|---|---|
| L1 基础定位（PNT） | 北斗三号定位/导航/授时 | 设备 GNSS 芯片直接输出；App 侧经系统定位 API（Web 用 `navigator.geolocation`，原生用系统 Location） | **不需要第三方 SDK 与 Key**，属于操作系统能力 |
| L2 高精度定位 | 地基增强（RTK/网络 RTK，厘米级） | 千寻位置 FindCM / FindNow SDK 或 HTTP API；六分科技、中国移动/电信北斗高精度服务 | 需要 `AppKey` / `Secret`，按调用量或终端数计费 |
| L3 短报文通信（RDSS） | 北斗三号区域/全球短报文 | 北斗终端厂商 SDK + 运营平台 API；或北斗短报文通信服务商网关 | 依赖硬件终端或专用模组，属 IoT 范畴 |
| L4 时间同步 | 北斗授时 | 授时终端 / NTP 服务 | 与业务无直接关系，数据中心侧使用 |

### 11.2 提供方与密钥

| 提供方 | 形态 | 用途 | 密钥 / 配置项（env） | 优先级 |
|---|---|---|---|---|
| 千寻位置（FindCM / FindNow） | SDK（Android/iOS/RTOS）+ HTTP API | 厘米级/亚米级高精度定位 | `MIM_BDS_QIANXUN_APP_KEY` / `MIM_BDS_QIANXUN_APP_SECRET` / `MIM_BDS_QIANXUN_SERVICE_ID` | P2（按需） |
| 六分科技 | SDK + API | 高精度定位备选 | `MIM_BDS_LIUFEN_APP_ID` / `MIM_BDS_LIUFEN_APP_KEY` | P2（按需） |
| 中国移动 / 中国电信北斗高精度 | 运营商位置服务 API | 国内合规高精度 | `MIM_BDS_CMCC_APP_ID` / `MIM_BDS_CMCC_APP_SECRET` | P2（按需） |
| 北斗短报文服务商（终端厂商网关） | 终端 SDK + 网关 API | 无网区域短报文通信 | `MIM_BDS_RDSS_TERMINAL_ID` / `MIM_BDS_RDSS_APP_KEY` / `MIM_BDS_RDSS_APP_SECRET` | P3（需硬件） |

### 11.3 坐标系与合规

| 项 | 要求 |
|---|---|
| 坐标系 | 中国大陆地图展示必须使用 GCJ-02（火星坐标）；GPS/北斗原始输出为 WGS-84；百度系为 BD-09。转换必须使用成熟第三方库（如 `coordtransform` / `gcoord`），禁止自研转换算法 |
| 测绘资质 | 提供互联网地图服务、高精度定位服务需符合《测绘法》及互联网地图服务相关规定；具体资质由服务商承担，平台侧核验其资质 |
| 位置数据 | 国内用户位置数据境内存储、不出境；精度与采集频率按最小必要原则 |
| 隐私告知 | 首次申请定位权限前说明用途；北斗/高精度定位须在隐私政策第三方 SDK 清单中列明 |
| 终端准入 | 北斗短报文终端需入网许可与型号核准；平台不直接销售终端 |

### 11.4 与 PRD 范围的口径冲突（必须显式处理）

PRD §3「明确排除（P0 不做）」含「硬件设备接入与 IoT `Assumption, TBD`」。因此：

- **P0/P1 允许**：L1 基础定位（系统能力，零依赖）与 L2 高精度定位（纯软件 SDK/API），用于签到、打卡、位置展示等 SaaS 场景；
- **P0 不做**：L3 短报文与任何北斗终端硬件接入（属 IoT），维持排除口径；
- 若产品后续要做北斗短报文（如无网应急通信），必须新开 OQ 并修订 PRD §3 排除项，不得在本清单中默认放开。

### 11.5 落地节奏

1. 先接 L1（零依赖，无 Key）；
2. 有高精度需求时再接 L2（千寻/六分，需商务开通与 AppKey）；
3. L3 仅在明确产品需求与硬件方案后评估。

---

## 12. 密钥安全与轮换

| 规则 | 说明 |
|---|---|
| 分级 | 服务端密钥（`*_SECRET` / `*_PRIVATE_KEY`）严禁下发客户端；客户端仅持有 AppID/AppKey 类公开标识 |
| 存储 | 生产环境使用云 KMS / Secret Manager；CI 使用加密 Secret；本地开发用 `.env`（已忽略提交） |
| 轮换 | AI、短信/邮件、对象存储类密钥至少每 12 个月轮换一次；泄露事件触发即时轮换 |
| 最小权限 | 每个密钥只授予所需 API 范围；AI 密钥按项目/环境配额隔离 |
| 审计 | 密钥创建、使用、轮换、吊销由运维变更记录留痕 180 天 |

---

## 13. 与现有工件的映射

| 工件 | 关系 |
|---|---|
| `Mim-PRD.html` FR-03.1（功能模块商城） | 无新增第三方能力；模块解锁为自有业务逻辑，不依赖支付通道 |
| `Mim-PRD.html` FR-03.2（漫剧 AI 剧） | 文生图 / 图生视频 / TTS 对应本文档 §6；产物存储与分发对应 §8；内容审核对应 §7 |
| `Mim-PRD.html` FR-04 | 平台适配层封装的登录/推送/存储/分享 SDK，对应本文档 §1/§3/§8 |
| `Mim-PRD.html` FR-06 | 隐私政策必须包含的「第三方 SDK 清单」，以本文档为唯一来源 |
| `docs/wiki/07-functional-modules.md` §12 | 实现拆分清单逐期列出所需第三方能力，与本文件 §6/§8 对应 |
| `docs/wiki/04-dependencies.md` | 依赖实况与依赖治理；本文档为其「规划引入清单」的展开 |
| `AGENTS.md` 铁律五 / 铁律七 | 真正引入依赖时必须写入 `package.json` + 锁文件，并全量同步文档 |

---

## 14. 引入优先级汇总

| 优先级 | 范围 |
|---|---|
| **P0（随首个可运行端引入）** | 微信/支付宝/Google/Apple 登录、短信/邮件、APNs/FCM/华为/小米/OPPO/vivo 推送、验证码、对象存储、Sentry |
| **P0（漫剧第 2 期起）** | 文生图（通义万相 / Seedream）、图生视频（Seedance / 可灵）、TTS（火山 / Azure / ElevenLabs）；漫剧产物对象存储与预签名下载（复用 §8） |
| **P1（PRD P1 能力开放时）** | IM、音视频 RTC、AI 网关、内容审核、地图与位置、CDN、埋点 |
| **P2（按需）** | 备份供应商、海外 IM、LiveKit、Mapbox、北斗高精度定位 |
| **P3（需硬件，P0 排除）** | 北斗短报文 / 北斗终端接入 |

---

---

## 15. 应用自有机密（非第三方）

以下密钥为 Mim 应用自身运行所需，不对应任何第三方 SaaS/SDK，但同样受 §0 三条硬约束管理（不入库、只在环境变量 / CI Secret / KMS 中出现）。

| 配置项（env） | 用途 | 生成与管理 | 优先级 |
|---|---|---|---|
| `MIM_JWT_SECRET` | 后端 JWT HS256 签名密钥（>=32 字符随机串） | 生产由 `deploy/deploy.sh` §5 幂等生成并写入 `/opt/mim/mim-api.env`（chmod 600），systemd 经 `EnvironmentFile` 注入；本地开发留空时自动生成 `.mim-dev-secret/jwt.key`（已 gitignore）。生产缺失即拒绝启动 | P0 |
| `MIM_ADMIN_TOKEN` | RBAC 超管引导令牌（bootstrap）：请求头 `x-admin-token` 携带即视同拥有全部 9 个权限点，解决「第一个超管从哪来」的冷启动；同时是 `/api/v1/admin/*` 与 catalog 管理写路由的双通道鉴权之一 | `deploy/deploy.sh` §5 幂等写入 `/opt/mim/mim-api.env`（已存在则保留运维自定义值，仅当 CI Secret 透传非空且文件缺失该变量时才补写）；口令由 GitHub Actions secret 同名变量下发，本地/仓库均不落盘。缺失时管理写路由返回 403 `FEATURE_NOT_AVAILABLE 'admin API is not enabled'`；值错误返回 401 `invalid admin token`（sha256 归一长度后 `timingSafeEqual` 比对，防时序侧信道） | P0 |
| `MIM_JOBS` | 进程内后台定时任务总开关（生成任务 worker 等）；多副本部署时只让一个实例消费 | `services/mim-api/src/config.ts` 读取，留空或任意非 `0` 值均视为启用（避免拼写错误导致任务静默不跑），显式 `0` 关闭；`services/mim-api/src/index.ts` 在关闭时打印 `jobs: disabled`。无凭证含义，属运行时开关 | P1 |
| `MIM_DELETION_GRACE_DAYS` | 账号注销冷静期天数：自助申请后进入 `pending_deletion`，期内可撤销，到期由清理引擎物理删除；范围 1–365，缺省 7 | `services/mim-api/src/config.ts` 的 `deletionGraceDays` 钳取到 1–365 区间，越界 / 非法值回落缺省 7；`services/mim-api/src/privacy.ts` 与 `routes/me.ts` 共用同一派生口径。无凭证含义，属运行时开关 | P1 |
| `MIM_DELETION_SWEEP_MINUTES` | 到期清理扫描间隔（分钟）：进程内调度器按此周期轮询已到期的待删除账号；范围 5–1440，缺省 60 | `services/mim-api/src/config.ts` 的 `deletionSweepMinutes` 钳取到 5–1440 分钟区间，越界 / 非法值回落缺省 60；`startPrivacyScheduler` 据此注册 `setInterval`，句柄 `unref()`。无凭证含义，属运行时开关 | P1 |
| `MIM_DELETION_BATCH` | 单轮清理批量上限：每轮扫描最多物理删除的待删除账号数；范围 1–500，缺省 50 | `services/mim-api/src/config.ts` 的 `deletionBatchSize` 钳取到 1–500 区间，越界 / 非法值回落缺省 50；`purgeDueAccounts` 按此取批。无凭证含义，属运行时开关 | P1 |
| `MIM_PAYMENT_NOTIFY_SECRET` | 支付渠道回调密钥：`POST /api/v1/orders/:id/payment-notify` 用 hex(HMAC-SHA256(secret, `订单号.渠道.交易号.金额.时间戳`)) 校验渠道身份 | 与支付渠道后台约定同一串随机密钥（`openssl rand -hex 32` 生成后两处配置），由运维写入 `/opt/mim/mim-api.env`，仓库与 CI 日志均不落盘。留空时该回调返回 503 `PAYMENT_NOTIFY_NOT_CONFIGURED`；人工结算 `POST /orders/:id/settle` 不依赖该变量 | P1 |
| `MIM_ALIPAY_APP_ID` / `MIM_ALIPAY_PRIVATE_KEY` / `MIM_ALIPAY_PUBLIC_KEY` / `MIM_ALIPAY_NOTIFY_URL` | 支付宝当面付预下单 + 异步通知验签：应用 ID、应用私钥（RSA2 签名）、支付宝公钥（RSA2 验签）、异步通知地址 | 支付宝开放平台控制台获取；私钥只写入 `/opt/mim/mim-api.env`，仓库不落盘。缺前两项时渠道 `configured=false`，下单返回 `PROVIDER_NOT_CONFIGURED`；`POST /api/v1/payments/alipay/notify` 用公钥验签，公钥留空时回调一律回 `failure` | P0 |
| `MIM_WECHAT_MCH_ID` / `MIM_WECHAT_API_V3_KEY` / `MIM_WECHAT_SERIAL_NO` / `MIM_WECHAT_PRIVATE_KEY` | 微信企业支付 Native：商户号、APIv3 密钥、证书序列号、商户私钥 | 微信支付商户平台获取；四项缺一即 `PROVIDER_NOT_CONFIGURED`，不生成假二维码 | P0 |
| `MIM_MANUAL_PAY_ACCOUNT` | 人工转账 / 线下收款展示的收款说明 | 运营填写，可由后台文案替代；不含真实密钥 | P2 |
| `MIM_PAYMENT_SANDBOX` / `MIM_PAYMENT_SANDBOX_SECRET` | 沙箱支付开关与 HMAC-SHA256 回调密钥，仅测试 / 预发启用 | 生产必须留空或 `0`；密钥用 `openssl rand -hex 32` 生成，回调 `x-mim-signature` 验签 | P2 |
| `MIM_IP_HASH_SALT` | IP 归属地哈希盐：来源 IP 只存 SHA-256(`${salt}:${ip}`)，不存明文 IP | 建议独立随机串；缺省回落 `MIM_JWT_SECRET`，轮换后历史哈希不可关联 | P1 |

---

## 16. 2026-11-13 增补适配器变量家族（通配登记）

> 本轮新增的支付扩展渠道、验证码 / 审核适配器、社区 / 积分 / SSO / 实名等进程内模块配置，按家族以通配符 `MIM_<家族>_*` 登记；家族内任一具体变量名命中前缀即视为已登记（与 env-check 通配口径一致）。未配置时对应适配器 `configured=false` / 走本地降级，不生成假订单或假凭证。

| 家族 / 提供方 | 用途 | 密钥 / 配置项（env，通配） | 优先级 |
|---|---|---|---|
| 虎皮椒聚合支付（hupijiao） | 微信 / 支付宝扫码收款，MD5 签名 | `MIM_HUPIJIAO_*`（APP_ID / APP_KEY / API_BASE / NOTIFY_URL / RETURN_URL） | P1 |
| 讯虎聚合支付（xunhu） | HMAC-SHA256 通用聚合协议收款 | `MIM_XUNHU_*`（APP_ID / APP_KEY / API_BASE / NOTIFY_URL / RETURN_URL） | P1 |
| PayPal | 国际卡 / 钱包，Orders v2 + Webhook 验签 | `MIM_PAYPAL_*`（CLIENT_ID / CLIENT_SECRET / WEBHOOK_ID / MODE / CURRENCY / RETURN_URL / CANCEL_URL / API_BASE） | P1 |
| Stripe | PaymentIntent 国际卡 + Webhook HMAC | `MIM_STRIPE_*`（SECRET_KEY / WEBHOOK_SECRET / CURRENCY / RETURN_URL / API_BASE） | P1 |
| 支付宝企业支付（alipay_ent） | 电脑网站 page.pay / 手机网站 wap.pay，RSA2 签名验签 | `MIM_ALIPAY_ENT_*`（APP_ID / PRIVATE_KEY / PUBLIC_KEY / NOTIFY_URL / RETURN_URL / GATEWAY / SANDBOX） | P1 |
| 通用 OAuth 提供方扩展 | 微博 / 百度 / Facebook / Twitter 等新增 provider 及各家回调覆盖变量 | `MIM_AUTH_*`（CLIENT_ID / CLIENT_SECRET / REDIRECT_URI，前缀通配覆盖既有 14 家） | P1 |
| 验证码门禁 | 模式与分场景开关；旧 `MIM_CAPTCHA_REQUIRED=1` 视为全场景强制 | `MIM_CAPTCHA_*`（MODE / REGISTER / LOGIN / REPORT / POST / REQUIRED） | P0 |
| 腾讯防水墙（新版） | 滑块 / 短信验证码适配器凭证 | `MIM_TENCENT_CAPTCHA_*`（APP_ID / SECRET_KEY） | P0 |
| 极验 GeeTest4 | 极验四代验证码适配器凭证 | `MIM_GEETEST4_CAPTCHA_*`（ID / KEY） | P0 |
| 百度内容审核 | 文本 / 图片审核适配器凭证 | `MIM_BAIDU_AUDIT_*`（API_KEY / SECRET_KEY） | P1 |
| 审核降级策略 | 上游审核故障时 open 放行 / closed 拒绝 | `MIM_AUDIT_*`（`MIM_AUDIT_FALLBACK`） | P1 |
| Redis 缓存 | 配置 `MIM_REDIS_URL` 走真实 Redis；缺省降级内存实现（单副本） | `MIM_REDIS_*`（`MIM_REDIS_URL`） | P1 |
| 举报频控 | 举报条数上限与滑动窗口（分钟） | `MIM_REPORT_*`（`MIM_REPORT_LIMIT` / `MIM_REPORT_WINDOW_MINUTES`） | P1 |
| 社区模块配置 | 板块频控 / 审核开关 / 推荐权重 / 敏感词等进程内配置 | `MIM_COMMUNITY_*`（WINDOW_MINUTES / WINDOW_MAX / DAILY_MAX / TOTAL_MAX / BOARD_REVIEW / RECOMMEND_WEIGHTS / BLOCK_WORDS / CREATE_MIN_LEVEL / CREATE_MAX） | P1 |
| 积分抵扣 | 抵扣开关 / 积分比例 / 抵扣上限比例 | `MIM_POINTS_*`（DEDUCTION_ENABLED / PER_YUAN / MAX_RATIO_PERCENT） | P1 |
| 跨站 SSO | 票据签名密钥与允许站点白名单 | `MIM_SSO_*`（SECRET / ALLOWED_SITES） | P1 |
| 实名认证 | 提供方（manual / third_party）与独立签名密钥 | `MIM_REALNAME_*`（PROVIDER / SECRET） | P1 |
| 微信支付平台凭证扩展 | 平台证书序列号 / 平台公钥 / 通知地址 / 应用 ID（既有商户号 / V3 密钥 / 序列号 / 私钥见 §15） | `MIM_WECHAT_*`（APP_ID / NOTIFY_URL / PLATFORM_SERIAL / PLATFORM_PUBLIC_KEY） | P0 |
| 注册总开关 | 默认关闭；仅 `MIM_REGISTRATION_ENABLED=1` 才允许自助注册、验证码首登、OAuth 首登与免登录访客建号 | `MIM_REGISTRATION_ENABLED`（精确项） | P0 |
| 全站门禁总开关 | 默认开启：除登录链路、第三方支付回调、健康检查与公开读白名单外，其余接口要求有效凭证（Bearer JWT 或超管引导令牌）；仅显式 `0` / `false` / `off` 关闭，供排障与测试使用 | `MIM_FORCE_LOGIN`（精确项）；`services/mim-api/src/config.ts` 读取，`createForceLoginMiddleware` 统一判定 | P0 |
| 注册邀请门槛 | `MIM_REGISTER_INVITE_REQUIRED=1` 时新账号必须凭有效邀请码注册 | `MIM_REGISTER_INVITE_REQUIRED`（精确项） | P1 |
| 圈子模块配置 | 圈子创建门槛（最小用户等级 / 每用户可创建数量），缺省 0 / 1 | `MIM_CIRCLE_CREATE_*`（`MIM_CIRCLE_CREATE_MIN_LEVEL` / `MIM_CIRCLE_CREATE_MAX_PER_USER`） | P1 |
| OIDC 联邦身份 | 标准授权码模式联邦登录（state / nonce 一次性、claims 校验；ID Token 签名验签与 SAML 2.0 未落地，见 `federation.ts` 文件头）；四项缺一即 `configured=false`、端点返回 503 | `MIM_OIDC_*`（`MIM_OIDC_ISSUER` / `MIM_OIDC_CLIENT_ID` / `MIM_OIDC_CLIENT_SECRET` / `MIM_OIDC_REDIRECT_URI`） | P1 |
| 推广返佣结算 | 一级 / 二级佣金比例与归因保护期（缺省 5% / 关闭 / 7 天），进程内配置非第三方凭证 | `MIM_REFERRAL_*`（`MIM_REFERRAL_RATE` / `MIM_REFERRAL_L2_RATE` / `MIM_REFERRAL_PROTECT_DAYS`） | P1 |
| 推广点击 / 转化频控 | 推广计划访客点击与转化滑动窗口：窗口秒数、点击上限、转化上限；缺省 600 秒内 10 次，显式配 0 关闭频控（不建议生产关闭） | `MIM_CONTENT_CLICK_WINDOW_SECONDS` / `MIM_CONTENT_CLICK_MAX` / `MIM_CONTENT_CONVERSION_MAX`（精确项，`services/mim-api/src/content/promotions.ts` 读取） | P2 |
| 同机共存端口 | 与 MixmAPP 共用 CVM：前端 HTTP / HTTPS 与后端回环端口，外加证书策略与 default_server 归属开关；由 nginx 模板占位符渲染，避免散落硬编码 | `MIM_WEB_HTTP_PORT` / `MIM_WEB_HTTPS_PORT` / `MIM_API_PORT` / `MIM_TLS_CERTBOT` / `MIM_NGINX_TAKE_DEFAULT` | P0 |

_登记日期：2026-11-03；2026-11-04 增补漫剧生成（文生图 / 图生视频 / TTS）为 P0 第 2 期能力；2026-11-05 增补「应用自有机密」段：`MIM_JWT_SECRET`；2026-11-05 增补 media / ai-orchestrator 进程内模块的 13 项运行时配置（§6 / §8）；2026-11-05 增补管理员口令变量（生产密码登录口令，修复验证码通道未接入导致无法登录）；2026-11-07 增补 `apps/admin` 前端构建与基础设施依赖（7 项，见文首）；2026-11-07 增补 `MIM_ADMIN_TOKEN`（RBAC 超管引导令牌，由 CI Secret 下发、`deploy/deploy.sh` 幂等写入 `/opt/mim/mim-api.env`）；2026-11-07 增补 `MIM_JOBS`（后台定时任务开关，补登记修复「先接入后登记」漂移）；2026-11-07 修订该管理员口令变量（移除公开固定口令，改为现场随机生成）；2026-11-08 增补 `MIM_PAYMENT_NOTIFY_SECRET`（商城订单渠道回调签名密钥，未配置时回调 503、人工结算不受影响）；2026-11-13 增补 §16 适配器变量家族通配登记（支付扩展五渠道 / 验证码 / 审核 / Redis / 社区 / 积分 / SSO / 实名等）。2026-11-14 增补 OIDC 联邦身份与推广返佣结算两组变量登记（消除 gap-scan C 段 7 项未登记）。2026-11-15 补登记 `MIM_FORCE_LOGIN`（全站门禁总开关，修复 gap-scan C 段未登记导致 Deploy 门禁失败）；2026-11-15 下线管理员口令变量（后端已不再读取，`.env.example` 与 `deploy/deploy.sh` 同步移除，口令维护改走后台「用户 → 重置口令」）；2026-11-20 增补 §18：门禁脚本 / 部署编排 / 离线遗留内部变量按通配分流登记，另补登记推广点击 / 转化频控三项运行时配置（§16）。新增第三方能力必须先更新本文件，再进入实现。_

## 17. 已登记的预留 / 已移除依赖（2026-11-20 扫描；批次 8 复核 2026-11-20；审计轮净减 2026-11-24）

> 背景：`services/mim-api`（`@mim/api`）`package.json` 下列出 api 侧零静态引用的候选依赖。批次 8 对原「待清理」3 项（`exceljs` / `qrcode` / `sharp`）补做全仓静态 + 动态双重复核（`src/`、`test/`、`scripts/`、`deploy/`、`packages/*`、`tools/`、`.github/`、`apps/admin`、`apps/web`；排查 `import`/`require`/`await import(`/模板字符串动态加载/`createRequire`/插件式注册表与按包名字符串加载），确认零引用后已移除。**2026-11-24 全仓闭环审计轮**：原预留的 8 项（`cron-parser` / `csv-parse` / `diff` / `expr-eval` / `marked` / `mustache` / `sql-formatter` / `yaml`）连同 `@types/mustache` 经全仓 `*.ts/*.cjs/*.js/*.mjs` 复核确认无 `from` / `require` 命中后，已从 `services/mim-api/package.json` 与 `pnpm-lock.yaml` 移除；`pg` 未动。

| 依赖 | 版本 | 判定状态 | 备注 |
|---|---|---|---|
| `cron-parser` | — | **已移除（审计轮，2026-11-24）** | 定时任务表达式解析；全仓无 import/require，已从 dependencies 与锁文件移除 |
| `csv-parse` | — | **已移除（审计轮，2026-11-24）** | 批量导入/导出候选；全仓无静态引用，已移除 |
| `diff` | — | **已移除（审计轮，2026-11-24）** | 文案/配置比对候选；全仓无静态引用，已移除 |
| `exceljs` | — | **已移除（批次 8，2026-11-20）** | 订单 xlsx 导出端点已随商城下线；全仓 `src/`/`test/`/`scripts/`/`deploy/`/`packages/*`/`tools/`/`.github/` 静态 + 动态双重复核零引用（无 `import`/`require`/`await import(`/插件式注册表），已从 `services/mim-api/package.json` dependencies 与 `pnpm-lock.yaml` 移除 |
| `expr-eval` | — | **已移除（审计轮，2026-11-24）** | 公式/权益表达式候选；全仓无静态引用，已移除 |
| `marked` | — | **已移除（审计轮，2026-11-24）** | Markdown 渲染候选；全仓无该 npm 包引用（源码内 `marked` 仅为局部变量名），已移除 |
| `mustache` | — | **已移除（审计轮，2026-11-24）** | 模板渲染候选；连同类型声明 `@types/mustache` 一并从 devDependencies 与锁文件移除 |
| `qrcode` | — | **api 已移除 / web 保留（批次 8，2026-11-20）** | api 侧零引用（`payments.ts` 命中均为局部字段 `qrText`/`qr_text`，非包引用），api dependencies 与 `@types/qrcode` devDependencies、锁文件 api importer 已清；**web 侧保留**：`apps/web/src/components/QrCode.tsx` 真实 `import QRCode from 'qrcode'`，web 自有 `qrcode` + `@types/qrcode`，`apps/web/src/qrcode.d.ts` 有 ambient 声明 |
| `sharp` | — | **已移除（批次 8，2026-11-20）** | 缩略图端点已随 media/创作模块下线；`src/`/`test/`/`scripts/`/`deploy/`/`tools/`/CI 零引用，`deploy/deploy.sh` 仅 `pnpm install --frozen-lockfile --prod=false` 无 sharp 专属 rebuild、部署脚本无图片处理，`dist/index.js` 无 sharp 模块说明符；已从 api dependencies 移除，`build.mjs` external `'sharp'` 与其原生模块注释块已清，锁文件 `sharp` 与 `@img/sharp-*` 平台包全清 |
| `sql-formatter` | — | **已移除（审计轮，2026-11-24）** | SQL 工具候选；全仓无静态引用，已移除 |
| `yaml` | — | **已移除（审计轮，2026-11-24）** | 配置/清单解析候选；全仓无静态引用，已移除 |

> 同期前端清理（2026-11-20）：`apps/web` 中零引用的 `@antv/g6`、`echarts`、`vditor` 已从 `package.json` 与 `pnpm-lock.yaml` 移除；文首 2026-11-10 增补段所述三者用途（商城价格图 / 依赖图 / 漫剧脚本编辑器）随商城与漫剧模块一并下线，该段为历史快照，不再代表现行前端依赖。

---

## 18. 门禁脚本 / 部署编排 / 离线遗留内部变量（2026-11-20 分流登记）

> 下列变量只被自检 / 取证脚本、`deploy/deploy.sh` 编排脚本或已下线模块引用，**不属于生产运行时配置**，因此按家族 / 单变量通配登记，**不进入 `.env.example` 必填模板**（env-check 通配口径覆盖展开项；测试变量不占必填位，避免 env-check 误红）。脚本本地运行时按需在命令行 / shell 环境注入。另：MIM_APP（蓝图代码串 EDGEONE_LEGACY_PROJECT_MIM_APP 的子串误匹配）与 MIM_X（注释占位示例）为静态扫描误报，不计入本表，也不使用反引号书写以免被登记口径捕获。

| 家族 / 场景 | 用途 | 登记前缀（env，通配） | 分类 |
|---|---|---|---|
| 匿名取证脚本 | `scripts/verify-anonymous-evidence.mjs` 探测目标、令牌、浏览器与 DB 取证参数（成员：ADMIN_TOKEN / API_BASE / AUTH_TOKEN / BROWSER / CDP / DB_PATH / KEEP_BROWSER / TIMEOUT_MS / WEB_BASE）；未配置时对应检查 SKIP 放行，不阻断门禁 | `MIM_EVIDENCE_*` | 仅内部测试 |
| 门禁 E2E 脚本 | `scripts/verify-chat-flow.mjs` / `verify-chat-plus.mjs` 的 API 基址、CDP 端点与页面地址（成员：API / CDP / PAGE） | `MIM_GATE_*` | 仅内部测试 |
| 性能基准 | `scripts/perf-bench.mjs` 探测目标与耗时门槛（毫秒） | `MIM_API_BASE*` / `MIM_PERF_TARGET_MS*` | 仅内部测试 |
| E2E 截图 | 聊天流程校验截图落盘路径 | `MIM_E2E_PNG*` | 仅内部测试 |
| 部署编排 | `deploy/deploy.sh` 环境文件路径；演练早退开关（取值 data / sync），生产勿设 | `MIM_ENV_FILE*` / `MIM_DEPLOY_STOP_AFTER*` | 部署编排 |
| 离线遗留模块 | AI 编排 worker、成本告警上限、AI baseUrl http 放行、成片审核 SLA、导航站兜底起源、备份定时器、版本回显覆盖、蓝图 DB 路径；对应模块已下线或仅蓝图示例，`src/` 零读取，保留登记仅为历史命令行与文档可追溯 | `MIM_AI_WORKER*` / `MIM_AI_HOURLY_COST_LIMIT_MINOR*` / `MIM_AI_ALLOW_INSECURE_BASE*` / `MIM_FILM_REVIEW_SLA_HOURS*` / `MIM_PUBLIC_ORIGIN*` / `MIM_ENABLE_BACKUP_TIMER*` / `MIM_SERVICE_VERSION*` / `MIM_DB_PATH*` | 离线遗留 |
