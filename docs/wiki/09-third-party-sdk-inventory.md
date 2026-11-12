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

> **2026-11-12 落地状态**：上表 9 家（微信 / Google / Apple / GitHub / Gitee / GitLab / Microsoft / QQ / 抖音）已全部进入代码实现，注册表在 `services/mim-api/src/oauth/providers.ts`，协议层 `oauth/client.ts`（标准实现依赖 `oauth4webapi@3.8.8`，微信 / QQ / 抖音走专用适配器，Apple 用 p8 现签 ES256 client_secret），绑定与一次性票据在 `oauth/accounts.ts`，端点在 `routes/oauth.ts`。公共配置：`MIM_OAUTH_CALLBACK_BASE`（后端对外基址，缺省取请求的 `x-forwarded-proto` + `host`）、`MIM_WEB_BASE_URL`（回调 302 的前端基址）。每家 provider 另支持 `MIM_AUTH_<ID>_REDIRECT_URI` / `_AUTHORIZE_URL` / `_TOKEN_URL` / `_PROFILE_URL` / `_JWKS_URL` 五个可选覆盖变量（自建 GitLab / GitHub Enterprise / 联合调试）；Apple 因平台回调形态特殊，示例模板中显式列出 `MIM_AUTH_APPLE_REDIRECT_URI`；回调地址默认 `${MIM_OAUTH_CALLBACK_BASE}/api/v1/auth/oauth/<id>/callback`。**凭证未配置时该家 `configured=false`，前端按钮置灰、接口返回 `AUTH_OAUTH_NOT_CONFIGURED(503)`，不得视为可用**。平台侧需登记的回调 URL 见 [05-runbook §第三方登录回调登记](./05-runbook.md)。支付宝仍仅用于支付场景，不承担登录。
| 阿里云短信 | 短信服务 API（`@alicloud/dysmsapi20170525`） | 国内验证码 | `MIM_SMS_ALIYUN_ACCESS_KEY_ID` / `MIM_SMS_ALIYUN_ACCESS_KEY_SECRET` / `MIM_SMS_ALIYUN_SIGN_NAME` / `MIM_SMS_ALIYUN_TEMPLATE_CODE` | P0 |
| 腾讯云短信 | SMS API | 国内验证码备份通道 | `MIM_SMS_TENCENT_SECRET_ID` / `MIM_SMS_TENCENT_SECRET_KEY` / `MIM_SMS_TENCENT_SDK_APP_ID` | P1 |
| 阿里云邮件推送 / AWS SES | 邮件 API（SES 走 `@aws-sdk/client-ses`） | 海外注册验证与通知邮件 | `MIM_EMAIL_ALIYUN_ACCESS_KEY` / `MIM_EMAIL_SES_ACCESS_KEY_ID` / `MIM_EMAIL_SES_SECRET_ACCESS_KEY` / `MIM_EMAIL_SES_REGION` / `MIM_EMAIL_SES_FROM_ADDRESS` | P0 |

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

## 6. AI 能力（PRD P1 通用 AI；**漫剧生成 P0，自第 2 期起**）

通用大模型路由为 P1/P2；**漫剧 AI 剧（FR-03.2）所需的文生图 / 图生视频 / TTS 自第 2 期起为 P0**，未接入前第 1 期（AI 辅助创作工作台）不产出成片。

| 提供方 | SDK / API 形态 | 用途 | 密钥 / 配置项（env） | 优先级 |
|---|---|---|---|---|
| OpenAI | REST API / 官方 SDK | 通用大模型 | `MIM_AI_OPENAI_API_KEY` / `MIM_AI_OPENAI_ORG_ID` | P1 |
| Anthropic | Messages API | Claude 模型 | `MIM_AI_ANTHROPIC_API_KEY` | P1 |
| Google Gemini | Generative Language API | 海外模型 | `MIM_AI_GEMINI_API_KEY` | P2 |
| Azure OpenAI | Azure SDK / REST | 企业合规部署 | `MIM_AI_AZURE_OPENAI_ENDPOINT` / `MIM_AI_AZURE_OPENAI_KEY` | P2 |
| 阿里云百炼 / 通义（含通义万相文生图） | DashScope SDK / API | 国内大模型 + 文生图 | `MIM_AI_DASHSCOPE_API_KEY` | P1（文生图：漫剧第 2 期 P0） |
| 火山方舟（豆包 / Seedream 文生图 / Seedance 图生视频） | Ark SDK / API | 国内大模型 + 漫剧关键帧与分镜片段 | `MIM_AI_ARK_API_KEY` / `MIM_AI_ARK_ENDPOINT_ID` | P1（漫剧第 2 期 P0） |
| 可灵 AI（Kling） | REST API（异步任务 + 结果回调/轮询） | 图生视频备选 | `MIM_AI_KLING_ACCESS_KEY` / `MIM_AI_KLING_SECRET_KEY` | 漫剧第 2 期 P1（备选通道） |
| Runway | REST API | 海外图生视频 | `MIM_AI_RUNWAY_API_KEY` | 漫剧第 3 期 P1（海外） |
| OpenAI Images（gpt-image） | Images API | 海外文生图备选 | 复用 `MIM_AI_OPENAI_API_KEY` | 漫剧第 3 期 P1（海外） |
| 火山引擎语音合成 / Azure Speech / ElevenLabs | TTS API | 漫剧配音（`job_type=tts`） | `MIM_AI_TTS_ARK_APP_ID` / `MIM_AI_AZURE_SPEECH_KEY` + `MIM_AI_AZURE_SPEECH_REGION` / `MIM_AI_ELEVENLABS_API_KEY` | 漫剧第 2 期 P1 |
| 百度文心 | 千帆 SDK / API | 国内备选 | `MIM_AI_QIANFAN_API_KEY` / `MIM_AI_QIANFAN_SECRET_KEY` | P2 |
| 讯飞星火 | WebSocket API | 语音/文本备选 | `MIM_AI_SPARK_APP_ID` / `MIM_AI_SPARK_API_KEY` / `MIM_AI_SPARK_API_SECRET` | P2 |
| LiteLLM（自建网关） | 开源模型路由 | 统一多模型接入与配额 | `MIM_AI_GATEWAY_MASTER_KEY` | P1 |

**生成任务编排运行时配置（自研 `ai-orchestrator`，进程内模块，非第三方）**

| 配置项（env） | 用途 | 默认值 | 优先级 |
|---|---|---|---|
| `MIM_AI_PROVIDER` | 任务执行使用的 AI 提供方标识（`mock` 为本地确定性产出；`openai` 为 OpenAI 兼容协议，凭证复用 `MIM_AI_OPENAI_API_KEY`） | `mock` | P0（第 2 期已接入 mock + openai） |
| `MIM_AI_BASE_URL` | OpenAI 兼容端点（`MIM_AI_PROVIDER=openai` 时生效；可切换火山方舟 / DeepSeek / 百炼兼容模式） | `https://api.openai.com/v1` | P0 |
| `MIM_AI_TEXT_MODEL` | 文本任务模型（方舟填推理接入点 ID） | `gpt-4o-mini` | P0 |
| `MIM_AI_IMAGE_MODEL` | 图像任务模型（需支持 `b64_json` 或 `url` 返回） | `dall-e-3` | P0 |
| `MIM_AI_TTS_MODEL` | 语音合成（TTS）模型；OpenAI 兼容网关不支持时任务诚实失败 | `tts-1` | 漫剧第 2 期 P1 |
| `MIM_AI_VIDEO_BASE_URL` | 视频生成厂商端点（留空则 video 任务类型不可用） | 空（不启用） | 漫剧第 2 期 P1 |
| `MIM_AI_VIDEO_API_KEY` | 视频生成厂商凭证（须与 `MIM_AI_VIDEO_BASE_URL` 同时配置） | 空（不启用） | 漫剧第 2 期 P1 |
| `MIM_AI_VIDEO_MODEL` | 视频生成模型 | `image-to-video` | 漫剧第 2 期 P1 |
| `MIM_FFMPEG_PATH` | ffmpeg 可执行文件路径；留空则 compose 合成与导出转码不可用 | 空（不启用） | 漫剧第 2 期 P1 |
| `MIM_AI_WORKER` | 是否随 API 进程启动后台队列 worker（`1` 启用 / `0` 关闭，关闭后仅能由 `POST /ai/jobs/:id/run` 手动消费） | `1` | P0 |
| `MIM_AI_WORKER_INTERVAL_MS` | worker 轮询间隔（毫秒） | `2000` | P0 |
| `MIM_AI_JOB_COST_LIMIT_MINOR` | 单任务成本上限（分），超出即 `COST_LIMIT_EXCEEDED(402)` | `100000` | P0 |
| `MIM_AI_DAILY_COST_LIMIT_MINOR` | 当日累计成本上限（分，按 `status='succeeded'` 求和） | `500000` | P0 |
| `MIM_AI_ASSET_TTL_DAYS` | 原始生成产物保留天数（`compose` 成片长期保留） | `90` | P0 |
| `MIM_AI_JOB_STALE_MS` | `running` 任务失联判定阈值（毫秒）：进程崩溃/重启后超过该时长即回收重跑 | `900000` | P0 |
| `MIM_AI_JOB_MAX_RECLAIM` | 同一任务允许被回收重新入队的次数上限，超出即判 `JOB_STALE_TIMEOUT`（防毒任务反复烧配额） | `2` | P0 |
| `MIM_ASSET_GC_BATCH` | `asset-gc` 定时任务单轮清理的过期产物条数上限 | `200` | P1 |

> 所有 AI 调用必须经统一网关（模型路由、Prompt 版本、配额、内容审核），业务层不得直连厂商密钥。漫剧生成的**成本预检与额度扣减**在 `comic` / `ai-orchestrator` 内完成（`generation_jobs`），供应商选择与成本上限见 PRD OQ-08。

---

## 7. 内容审核与安全

| 提供方 | SDK / API 形态 | 用途 | 密钥 / 配置项（env） | 优先级 |
|---|---|---|---|---|
| 数美 | 内容审核 API / SDK | 文本、图片、音频审核 | `MIM_MODERATION_SHUME_ACCESS_KEY` / `MIM_MODERATION_SHUME_APP_ID` | P1 |
| 网易易盾 | 内容安全 API | 备选审核 | `MIM_MODERATION_YIDUN_SECRET_ID` / `MIM_MODERATION_YIDUN_SECRET_KEY` | P1 |
| 阿里云内容安全 / 腾讯云天御 | 内容安全 API | 云厂商一体化审核 | `MIM_MODERATION_ALIYUN_ACCESS_KEY` / `MIM_MODERATION_TENCENT_SECRET_ID` | P1 |
| 腾讯防水墙 / 极验 | 验证码 SDK | 防刷、人机验证 | `MIM_CAPTCHA_TENCENT_APP_ID` / `MIM_CAPTCHA_GEETEST_ID` / `MIM_CAPTCHA_GEETEST_KEY` | P0 |

---

## 8. 存储、CDN 与基础设施

| 提供方 | SDK / API 形态 | 用途 | 密钥 / 配置项（env） | 优先级 |
|---|---|---|---|---|
| 阿里云 OSS | OSS SDK / API | 国内对象存储 | `MIM_STORAGE_ALIYUN_OSS_ACCESS_KEY_ID` / `MIM_STORAGE_ALIYUN_OSS_ACCESS_KEY_SECRET` / `MIM_STORAGE_ALIYUN_OSS_BUCKET` | P0 |
| 腾讯云 COS | COS SDK / API | 国内备选存储 | `MIM_STORAGE_TENCENT_SECRET_ID` / `MIM_STORAGE_TENCENT_SECRET_KEY` / `MIM_STORAGE_TENCENT_BUCKET` | P1 |
| AWS S3 / Cloudflare R2 | S3 兼容 SDK | 海外对象存储 | `MIM_STORAGE_S3_ACCESS_KEY_ID` / `MIM_STORAGE_S3_SECRET_ACCESS_KEY` / `MIM_STORAGE_R2_ACCESS_KEY_ID` | P0 |
| 七牛 / 又拍云 | 存储 + CDN SDK | CDN 加速与图片处理 | `MIM_STORAGE_QINIU_ACCESS_KEY` / `MIM_STORAGE_QINIU_SECRET_KEY` | P1 |
| Cloudflare CDN / 阿里云 CDN | CDN API | 静态资源加速 | `MIM_CDN_CLOUDFLARE_API_TOKEN` / `MIM_CDN_ALIYUN_ACCESS_KEY` | P1 |

**对象存储准入运行时配置（自研 `media` 域，进程内模块）**

| 配置项（env） | 用途 | 默认值 | 优先级 |
|---|---|---|---|
| `MIM_STORAGE_DRIVER` | 存储驱动（`local` 本地磁盘 / `s3` S3 兼容） | `local` | P0（第 2 期已接入） |
| `MIM_STORAGE_LOCAL_DIR` | 本地驱动落盘根目录 | `<服务目录>/data/media` | P0 |
| `MIM_STORAGE_S3_ENDPOINT` | S3 兼容端点（OSS / COS / R2 / MinIO；AWS 可留空） | 空 | P0 |
| `MIM_STORAGE_S3_REGION` | S3 区域 | `auto`（留空时用 `auto`，AWS 可改为具体区域如 `us-east-1`） | P0 |
| `MIM_STORAGE_S3_BUCKET` | 存储桶名 | 空（缺失则驱动视为未配置） | P0 |
| `MIM_STORAGE_S3_FORCE_PATH_STYLE` | 路径风格（MinIO 需 `1`） | `0` | P0 |
| `MIM_PUBLIC_BASE_URL` | 对外公开基址（本地驱动预签名 URL 拼接） | 请求 Host | P0 |

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
| `MIM_AUTH_ADMIN_PASSWORD` | `POST /api/v1/auth/password` 的管理员登录口令；短信/邮件通道未接入时的唯一可用登录入口 | `deploy/deploy.sh` §5 幂等补齐并写入 `/opt/mim/mim-api.env`（chmod 600）；优先级为「env 文件已有值 → 保留」>「CI/运维同名环境变量透传」>「现场 `openssl rand` 生成随机口令」。**不再使用仓库内可查的固定默认口令**，随机口令不回显到 CI 日志，运维从服务器 env 文件读取。留空时该端点返回 503 `AUTH_PASSWORD_NOT_CONFIGURED` | P0 |
| `MIM_ADMIN_TOKEN` | RBAC 超管引导令牌（bootstrap）：请求头 `x-admin-token` 携带即视同拥有全部 8 个权限点，解决「第一个超管从哪来」的冷启动；同时是 `/api/v1/admin/*` 与 catalog 管理写路由的双通道鉴权之一 | `deploy/deploy.sh` §5 幂等写入 `/opt/mim/mim-api.env`（已存在则保留运维自定义值，仅当 CI Secret 透传非空且文件缺失该变量时才补写）；口令由 GitHub Actions secret 同名变量下发，本地/仓库均不落盘。缺失时管理写路由返回 403 `FEATURE_NOT_AVAILABLE 'admin API is not enabled'`；值错误返回 401 `invalid admin token`（sha256 归一长度后 `timingSafeEqual` 比对，防时序侧信道） | P0 |
| `MIM_JOBS` | 进程内后台定时任务总开关（生成任务 worker 等）；多副本部署时只让一个实例消费 | `services/mim-api/src/config.ts` 读取，留空或任意非 `0` 值均视为启用（避免拼写错误导致任务静默不跑），显式 `0` 关闭；`services/mim-api/src/index.ts` 在关闭时打印 `jobs: disabled`。无凭证含义，属运行时开关 | P1 |
| `MIM_PAYMENT_NOTIFY_SECRET` | 支付渠道回调密钥：`POST /api/v1/orders/:id/payment-notify` 用 hex(HMAC-SHA256(secret, `订单号.渠道.交易号.金额.时间戳`)) 校验渠道身份 | 与支付渠道后台约定同一串随机密钥（`openssl rand -hex 32` 生成后两处配置），由运维写入 `/opt/mim/mim-api.env`，仓库与 CI 日志均不落盘。留空时该回调返回 503 `PAYMENT_NOTIFY_NOT_CONFIGURED`；人工结算 `POST /orders/:id/settle` 不依赖该变量 | P1 |
| `MIM_ALIPAY_APP_ID` / `MIM_ALIPAY_PRIVATE_KEY` / `MIM_ALIPAY_NOTIFY_URL` | 支付宝当面付预下单：应用 ID、应用私钥（RSA2 签名）、异步通知地址 | 支付宝开放平台控制台获取；私钥只写入 `/opt/mim/mim-api.env`，仓库不落盘。缺前两项时渠道 `configured=false`，下单返回 `PROVIDER_NOT_CONFIGURED` | P0 |
| `MIM_WECHAT_MCH_ID` / `MIM_WECHAT_API_V3_KEY` / `MIM_WECHAT_SERIAL_NO` / `MIM_WECHAT_PRIVATE_KEY` | 微信企业支付 Native：商户号、APIv3 密钥、证书序列号、商户私钥 | 微信支付商户平台获取；四项缺一即 `PROVIDER_NOT_CONFIGURED`，不生成假二维码 | P0 |
| `MIM_MANUAL_PAY_ACCOUNT` | 人工转账 / 线下收款展示的收款说明 | 运营填写，可由后台文案替代；不含真实密钥 | P2 |
| `MIM_PAYMENT_SANDBOX` / `MIM_PAYMENT_SANDBOX_SECRET` | 沙箱支付开关与 HMAC-SHA256 回调密钥，仅测试 / 预发启用 | 生产必须留空或 `0`；密钥用 `openssl rand -hex 32` 生成，回调 `x-mim-signature` 验签 | P2 |
| `MIM_BAIDU_TRANSLATE_APPID` / `MIM_BAIDU_TRANSLATE_KEY` | 百度翻译开放平台：机器翻译与前后台语言分离 | 百度翻译控制台申请；缺任一项时 `/i18n/translate` 返回 503 `PROVIDER_NOT_CONFIGURED`，已知文案仍走本地词典 | P1 |
| `MIM_IP_HASH_SALT` | IP 归属地哈希盐：`user_signals.ip_hash` 只存 SHA-256(`${salt}:${ip}`)，不存明文 IP | 建议独立随机串；缺省回落 `MIM_JWT_SECRET`，轮换后历史哈希不可关联 | P1 |
| `MIM_MEILISEARCH_URL` / `MIM_MEILISEARCH_KEY` / `MIM_MEILISEARCH_INDEX` | Meilisearch 实例地址、查询 / 管理密钥、索引名（默认 `mim_search`） | 自建或 Meilisearch Cloud 获取；未配置时统一搜索自动降级 SQLite，`POST /search/reindex` 返回 503 | P1 |

_登记日期：2026-11-03；2026-11-04 增补漫剧生成（文生图 / 图生视频 / TTS）为 P0 第 2 期能力；2026-11-05 增补「应用自有机密」段：`MIM_JWT_SECRET`；2026-11-05 增补 media / ai-orchestrator 进程内模块的 13 项运行时配置（§6 / §8）；2026-11-05 增补 `MIM_AUTH_ADMIN_PASSWORD`（生产密码登录口令，修复验证码通道未接入导致无法登录）；2026-11-07 增补 `apps/admin` 前端构建与基础设施依赖（7 项，见文首）；2026-11-07 增补 `MIM_ADMIN_TOKEN`（RBAC 超管引导令牌，由 CI Secret 下发、`deploy/deploy.sh` 幂等写入 `/opt/mim/mim-api.env`）；2026-11-07 增补 `MIM_JOBS`（后台定时任务开关，补登记修复「先接入后登记」漂移）；2026-11-07 修订 `MIM_AUTH_ADMIN_PASSWORD`（移除公开固定口令，改为现场随机生成）；2026-11-08 增补 `MIM_PAYMENT_NOTIFY_SECRET`（商城订单渠道回调签名密钥，未配置时回调 503、人工结算不受影响）。新增第三方能力必须先更新本文件，再进入实现。_
