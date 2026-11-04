# 09 · 第三方 SDK / API / API Key 全量清单（含北斗卫星导航）

> 本文档是 Mim 第三方能力接入的**唯一基线清单**。任何新增/变更的第三方 SDK、开放 API、密钥，必须先登记到本文件，再进入代码实现（铁律五 + 铁律七）。
>
> 当前状态：仓库已进入编码阶段。`services/mim-api`（`@mim/api`）已含运行时依赖并写入 `package.json` + `pnpm-lock.yaml`：`express ^5.3.0`、`better-sqlite3 ^13.0.3`、`jsonwebtoken ^9.0.3`、`bcryptjs ^3.0.2`、`zod ^4.6.7`（devDeps：`vitest@4`、`supertest@7`、`tsx@4`、`typescript@5.6.3`），均属业务自研基础设施而非下表所列第三方 SaaS/SDK。本文档登记的第三方能力清单仍为「计划引入」状态；对应能力接入时，按铁律五把依赖写入 `package.json` 并提交锁文件，同时更新本清单状态。

---

## 0. 三条硬约束

| 约束 | 规则 |
|---|---|
| 密钥不入库 | 所有 `AppKey` / `AppSecret` / `PrivateKey` / `MchId` 只允许出现在环境变量、CI Secret、云密钥管理（KMS）中；仓库只提交占位模板 `.env.example` |
| 密钥按 region 隔离 | 国内（cn）与海外（global）使用**独立应用与独立密钥**，不得复用同一套凭证 |
| 先登记后接入 | 新增第三方能力必须在本文件补齐「提供方 / 形态 / 用途 / 密钥名 / 优先级 / 合规」六要素，否则视为未完成交付 |

密钥统一命名：`MIM_<领域>_<提供方>_<密钥类型>`，全大写下划线分隔，例如 `MIM_PAY_WECHAT_MCH_ID`。

---

## 1. 账号与身份

| 提供方 | SDK / API 形态 | 用途 | 密钥 / 配置项（env） | 优先级 |
|---|---|---|---|---|
| 微信开放平台 | 网站应用 / 移动应用 / 小程序 SDK、OAuth2.0 | 微信扫码/授权登录、UnionID 打通 | `MIM_AUTH_WECHAT_APP_ID` / `MIM_AUTH_WECHAT_APP_SECRET` | P0 |
| 支付宝开放平台 | 开放平台 SDK、OAuth2.0 | 支付宝授权登录 | `MIM_AUTH_ALIPAY_APP_ID` / `MIM_AUTH_ALIPAY_PRIVATE_KEY` / `MIM_AUTH_ALIPAY_PUBLIC_KEY` | P0 |
| Google Identity | Google Sign-In SDK、OAuth2.0 / OIDC | 海外 Google 登录 | `MIM_AUTH_GOOGLE_CLIENT_ID` / `MIM_AUTH_GOOGLE_CLIENT_SECRET` | P0 |
| Apple | Sign in with Apple（原生 / JS） | 海外 Apple 登录、App Store 强制项 | `MIM_AUTH_APPLE_SERVICE_ID` / `MIM_AUTH_APPLE_TEAM_ID` / `MIM_AUTH_APPLE_KEY_ID` / `MIM_AUTH_APPLE_PRIVATE_KEY` | P0 |
| 阿里云短信 | 短信服务 API | 国内验证码 | `MIM_SMS_ALIYUN_ACCESS_KEY_ID` / `MIM_SMS_ALIYUN_ACCESS_KEY_SECRET` / `MIM_SMS_ALIYUN_SIGN_NAME` | P0 |
| 腾讯云短信 | SMS API | 国内验证码备份通道 | `MIM_SMS_TENCENT_SECRET_ID` / `MIM_SMS_TENCENT_SECRET_KEY` / `MIM_SMS_TENCENT_SDK_APP_ID` | P1 |
| 阿里云邮件推送 / AWS SES | 邮件 API | 海外注册验证与通知邮件 | `MIM_EMAIL_ALIYUN_ACCESS_KEY` / `MIM_EMAIL_SES_ACCESS_KEY_ID` / `MIM_EMAIL_SES_SECRET_ACCESS_KEY` | P0 |

---

## 2. 订阅与支付（PRD FR-02）

| 提供方 | SDK / API 形态 | 用途 | 密钥 / 配置项（env） | 优先级 |
|---|---|---|---|---|
| 微信支付 | JSAPI / Native / APP 支付 SDK、支付回调 API | 国内 Web/小程序/App 支付 | `MIM_PAY_WECHAT_MCH_ID` / `MIM_PAY_WECHAT_APP_ID` / `MIM_PAY_WECHAT_API_V3_KEY` / `MIM_PAY_WECHAT_CERT_SERIAL` / `MIM_PAY_WECHAT_PRIVATE_KEY` | P0 |
| 支付宝 | 手机网站 / APP 支付 SDK、异步通知 API | 国内支付 | `MIM_PAY_ALIPAY_APP_ID` / `MIM_PAY_ALIPAY_PRIVATE_KEY` / `MIM_PAY_ALIPAY_PUBLIC_KEY` | P0 |
| 银联 | 银联在线网关 / 云闪付 API | 国内银行卡支付 | `MIM_PAY_UNIONPAY_MER_ID` / `MIM_PAY_UNIONPAY_CERT_PATH` | P1 |
| Stripe | Stripe SDK（Checkout / Billing / Webhook） | 海外订阅与订阅生命周期 | `MIM_PAY_STRIPE_SECRET_KEY` / `MIM_PAY_STRIPE_WEBHOOK_SECRET` / `MIM_PAY_STRIPE_PRICE_ID_*` | P0 |
| PayPal | PayPal JS SDK / REST API | 海外备用支付 | `MIM_PAY_PAYPAL_CLIENT_ID` / `MIM_PAY_PAYPAL_CLIENT_SECRET` | P1 |
| Apple IAP | StoreKit / App Store Server API / Server Notifications | iOS 数字商品订阅（商店强制） | `MIM_IAP_APPLE_SHARED_SECRET` / `MIM_IAP_APPLE_ISSUER_ID` / `MIM_IAP_APPLE_KEY_ID` / `MIM_IAP_APPLE_PRIVATE_KEY` | P0 |
| Google Play Billing | Play Billing Library + Play Developer API | Android 海外订阅 | `MIM_IAP_GOOGLE_PACKAGE_NAME` / `MIM_IAP_GOOGLE_SERVICE_ACCOUNT_JSON` | P0 |
| RevenueCat | RevenueCat SDK / REST API（可选聚合层） | 跨商店订阅状态统一 | `MIM_IAP_REVENUECAT_API_KEY` | P1 |

> 资金合规硬约束不变：收款与清算必须由持牌机构完成；平台自身不经手资金池。

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

## 6. AI 能力（PRD P1，模型路由 + Prompt 版本）

| 提供方 | SDK / API 形态 | 用途 | 密钥 / 配置项（env） | 优先级 |
|---|---|---|---|---|
| OpenAI | REST API / 官方 SDK | 通用大模型 | `MIM_AI_OPENAI_API_KEY` / `MIM_AI_OPENAI_ORG_ID` | P1 |
| Anthropic | Messages API | Claude 模型 | `MIM_AI_ANTHROPIC_API_KEY` | P1 |
| Google Gemini | Generative Language API | 海外模型 | `MIM_AI_GEMINI_API_KEY` | P2 |
| Azure OpenAI | Azure SDK / REST | 企业合规部署 | `MIM_AI_AZURE_OPENAI_ENDPOINT` / `MIM_AI_AZURE_OPENAI_KEY` | P2 |
| 阿里云百炼 / 通义 | DashScope SDK / API | 国内大模型 | `MIM_AI_DASHSCOPE_API_KEY` | P1 |
| 火山方舟（豆包） | Ark SDK / API | 国内大模型 | `MIM_AI_ARK_API_KEY` / `MIM_AI_ARK_ENDPOINT_ID` | P1 |
| 百度文心 | 千帆 SDK / API | 国内备选 | `MIM_AI_QIANFAN_API_KEY` / `MIM_AI_QIANFAN_SECRET_KEY` | P2 |
| 讯飞星火 | WebSocket API | 语音/文本备选 | `MIM_AI_SPARK_APP_ID` / `MIM_AI_SPARK_API_KEY` / `MIM_AI_SPARK_API_SECRET` | P2 |
| LiteLLM（自建网关） | 开源模型路由 | 统一多模型接入与配额 | `MIM_AI_GATEWAY_MASTER_KEY` | P1 |

> 所有 AI 调用必须经统一网关（模型路由、Prompt 版本、配额、内容审核），业务层不得直连厂商密钥。

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
| 轮换 | 支付、IAP、AI 类密钥至少每 12 个月轮换一次；泄露事件触发即时轮换并留审计记录 |
| 最小权限 | 每个密钥只授予所需 API 范围；AI 密钥按项目/环境配额隔离 |
| 审计 | 密钥创建、使用、轮换、吊销记录保留 180 天（与 PRD §6 审计日志口径一致） |

---

## 13. 与现有工件的映射

| 工件 | 关系 |
|---|---|
| `Mim-PRD.html` FR-02 | 支付路由所需的第三方支付/IAP 能力，对应本文档 §2 |
| `Mim-PRD.html` FR-04 | 平台适配层封装的登录/支付/推送/存储/分享 SDK，对应本文档 §1/§2/§3/§8 |
| `Mim-PRD.html` FR-06 | 隐私政策必须包含的「第三方 SDK 清单」，以本文档为唯一来源 |
| `docs/wiki/04-dependencies.md` | 依赖实况与依赖治理；本文档为其「规划引入清单」的展开 |
| `AGENTS.md` 铁律五 / 铁律七 | 真正引入依赖时必须写入 `package.json` + 锁文件，并全量同步文档 |

---

## 14. 引入优先级汇总

| 优先级 | 范围 |
|---|---|
| **P0（随首个可运行端引入）** | 微信/支付宝/Google/Apple 登录、短信/邮件、微信支付/支付宝/Stripe/IAP/Google Play、APNs/FCM/华为/小米/OPPO/vivo 推送、验证码、对象存储、Sentry |
| **P1（PRD P1 能力开放时）** | IM、音视频、AI 网关、内容审核、地图与位置、CDN、埋点 |
| **P2（按需）** | 备份供应商、海外 IM、LiveKit、Mapbox、北斗高精度定位 |
| **P3（需硬件，P0 排除）** | 北斗短报文 / 北斗终端接入 |

---

_登记日期：2026-11-03。新增第三方能力必须先更新本文件，再进入实现。_
