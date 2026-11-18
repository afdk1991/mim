/** Express 应用装配：对象收发 → 公开路由 → 鉴权路由 → 统一 404/错误信封 */

import express from 'express'; // Express 本体，用于创建应用与挂载 JSON 解析
import cors from 'cors'; // 跨域中间件，托管平台以独立域名直连 API 时必需
import type { Express, NextFunction, Request, Response } from 'express'; // 仅类型引用，用于给工厂与中间件签名标注
import { createAuthRouter } from './routes/auth.js'; // 公开鉴权路由：验证码 / 登录 / 刷新
import { createOAuthRouter } from './routes/oauth.js'; // 第三方登录：授权 / 回调 / 票据兑换 / 绑定解绑
import { createImRouter } from './routes/im.js'; // 即时通讯：会话/消息/用户搜索，需登录
import { createMeRouter } from './routes/me.js'; // 个人资料与设置，内部统一 requireAuth
import { createCommunityRouter } from './routes/community.js'; // 社区与变现：论坛 / 付费阅读 / VIP / 钱包 / 独立商城 / 推广
import { createAssetsRouter } from './routes/assets.js'; // 付费资产：付费阅读 / 下载 / 图库 / 视频的浏览、解锁与分成（社区页依赖）
import { createMediaObjectRouter, createMediaRouter } from './routes/media.js'; // 媒体：免鉴权对象收发 + 受保护控制面
import { createAdminRouter } from './routes/admin.js'; // RBAC 后台控制面：角色 / 权限 / 用户角色授权
import { createShopAdminRouter } from './routes/shop-admin.js'; // 独立商城后台写入面：商品 / 优惠码 / 卡密 / VIP 套餐 CRUD
import { createDeploymentsRouter } from './routes/deployments.js'; // 部署汇总：统一字段的部署仓库 / 部署项 / 状态 / 结果 / 异常，公开只读
import { createContentUnifiedRouter } from './routes/content-unified.js'; // 统一内容与消息域：论坛/圈子、IM/私信合并后的只读视图
import { createOrdersRouter } from './routes/orders.js'; // 统一交易域：三套订单合并后的只读视图，供个人中心 / 中台统一口径
import { createPaymentsRouter } from './routes/payments.js'; // 支付：渠道、意图、回调与线下确认
import { createAppearanceRouter } from './routes/appearance.js'; // 外观：主题、语言、页面区块（site/config 与 pages 仍被购物车/社区使用）
import { createSecurityRouter } from './routes/security.js'; // 安全：图形验证码、举报与运营处置
import { createInviteAdminRouter } from './routes/invites.js'; // 邀请码：管理端生成与注册门槛核销
import { createRealnameRouter } from './routes/realname.js'; // 实名认证：本人提交与人工审核队列
import { createSsoRouter } from './routes/sso.js'; // 跨站 SSO：票据签发、兑换与登出广播
import { createFederationRouter } from './routes/federation.js'; // 联邦身份：OIDC 授权码模式客户端
import { createVipPricingRouter } from './routes/vip-pricing.js'; // VIP 分级定价规则只读查询
import { createReferralRouter } from './routes/referral.js'; // 返佣佣金明细自助查询（内部鉴权）
import { createReferralAdminRouter } from './routes/referral-admin.js'; // 返佣到期结算管理端点（RBAC）
import { createWalletWithdrawalRouter } from './routes/wallet-withdrawals.js'; // 提现分成：可提现余额 / 申请 / 审核 / 到账（钱包结算层）
import { createGrowthDmAdminRouter } from './routes/growth-dm-admin.js'; // 成长私信：系统身份私信群发（RBAC messaging:write）
import { createGrowthRouter } from './routes/growth.js'; // 社区激励链：签到 / 积分流水 / 等级进度 / 徽章 + 后台规则配置（RBAC content:write）
import { createPaymentChannelRouter } from './payments/router.js'; // 扩展支付渠道：虎皮椒 / 讯虎 / PayPal / Stripe / 支付宝企业支付
import { createContentOpsRouter } from './routes/content-ops.js'; // 内容运营：公告 / 更新日志 / 推广计划，公开读 + 管理端 CRUD
import { createCirclesRouter } from './routes/circles.js'; // 圈子：独立于板块的成员制社群，公开浏览 + 成员/圈主写操作
import { createCacheHeaderMiddleware, createCaptchaMiddleware, createForceLoginMiddleware, errorHandler, notFound, requestId } from './middleware.js'; // 统一 404、错误信封、请求追踪 + 缓存头 / 验证码 / 强制登录门禁
import { DATA_DIR } from './config.js'; // 本地存储驱动的兜底目录
import { createStorage } from './storage.js'; // 存储适配器工厂，按 env 决定 local 或 s3
import { createNotifyChannels } from './notify.js'; // 验证码通知通道工厂（短信 / 邮件）
import type { ApiDeps } from './types.js'; // 依赖容器类型

/** 解析 trust proxy：只信任显式配置的可信代理，避免无条件信任 X-Forwarded-For 被伪造来源 IP */
function resolveTrustProxy(env: ApiDeps['env']): boolean | number | string { // 定义函数 resolveTrustProxy：封装可复用业务步骤
  const raw = (env.MIM_TRUST_PROXY ?? 'loopback').trim(); // 默认只信任同机反代（nginx → 127.0.0.1）
  if (!raw) return false; // 显式留空视为关闭
  const lower = raw.toLowerCase(); // 归一化便于匹配
  if (lower === 'false' || lower === 'off' || lower === '0') return false; // 关闭：直接使用 socket 地址
  if (lower === 'true' || lower === '1') return true; // 信任全部（仅建议在已由外层网关固定来源时使用）
  const hops = Number(raw); // 纯数字表示信任的代理层数
  if (Number.isInteger(hops) && hops >= 0) return hops; // 按跳数信任
  return raw; // 'loopback' 或逗号分隔的 CIDR 白名单
} // 结束 resolveTrustProxy

export function createApp(deps: ApiDeps): Express { // 应用工厂：测试可传入替身依赖，生产传入真实 db
  // 未注入 storage / notify 时按 env 构造默认实例（测试可显式注入替身）
  const storage = deps.storage ?? createStorage({ env: deps.env, jwtSecret: deps.jwtSecret, fallbackDir: DATA_DIR }); // 缺省存储：按 env 选驱动，本地驱动落 data 目录
  const notify = deps.notify ?? createNotifyChannels(deps.env); // 缺省通知通道：无凭证时降级为日志下发验证码
  const resolved: ApiDeps = { ...deps, storage, notify }; // 合并为「全部就绪」的依赖，后续路由拿到的都是非空实例

  const app = express(); // 创建应用实例
  app.disable('x-powered-by'); // 关闭默认响应头，减少框架指纹暴露
  app.set('trust proxy', resolveTrustProxy(resolved.env)); // 反代后按可信代理解析 req.ip，未配置时默认只信任 loopback
  app.use(requestId); // 必须最先挂：后续日志、错误信封、跨域暴露头都依赖 req.requestId
  // 跨域白名单：托管平台（GitHub Pages / Cloudflare / Vercel / Render）以独立域名直连本 API。
  // MIM_CORS_ORIGINS 未配置时不挂载，保持自建服务器「同源反代」原有行为不变；Bearer 鉴权不依赖 Cookie，故 credentials 关闭。
  const corsOrigins = (resolved.env.MIM_CORS_ORIGINS ?? '') // 读白名单配置，未配置得空串
    .split(',') // 约定用逗号分隔多个来源
    .map((o) => o.trim()) // 去掉两端空白，容忍人写配置里的空格
    .filter(Boolean); // 丢弃空项，避免空串被当成「允许任意来源」
  if (corsOrigins.length > 0) { // 未配置则完全不挂 CORS，向后兼容自建服务器
    app.use( // 挂载跨域中间件
      cors({ // 显式列出方法、请求头与暴露头，避免默认值缺项
        origin: corsOrigins, // 仅白名单来源可跨域访问
        methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], // 含 PUT 与预检 OPTIONS，覆盖对象直传
        allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id', 'X-Admin-Token'], // 鉴权、幂等键、追踪头、超管引导令牌必须放行（缺 X-Admin-Token 会让跨域后台登录被预检拦死）
        exposedHeaders: ['X-Request-Id'], // 让浏览器端能读到追踪 ID 便于报障
        credentials: false, // 不用 Cookie 会话，关闭凭证可避免必须精确匹配 origin
        maxAge: 86400, // 预检结果缓存一天，减少 OPTIONS 往返开销
      }), // cors 配置对象结束
    ); // app.use 调用结束，cors 已挂载
  } // if 结束：未配置白名单则保持同源行为
  app.use((req: Request, _res: Response, next: NextFunction) => { // 依赖注入中间件：把依赖挂到每个请求上
    req.deps = resolved; // 路由内通过 req.deps 取 db / storage / notify
    next(); // 继续后续中间件链
  }); // 依赖注入中间件结束

  // 对象收发端点必须先于 express.json 挂载：其 PUT 路由自带 raw 解析器，读取原始字节
  app.use('/api/v1', createMediaObjectRouter(resolved)); // 若排在 express.json 之后，请求流已被 JSON 解析器消费，raw 拿不到原始字节
  app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { (req as { rawBody?: string }).rawBody = buf.toString('utf8'); } })); // 保留原始报文供微信回调验签.body
  app.use(express.urlencoded({ extended: false, limit: '256kb' })); // 支付宝异步通知以 form-urlencoded 回传，需单独解析

  // 全站强制登录：集中门禁，默认开启（MIM_FORCE_LOGIN=0 关闭）；必须早于缓存头与全部业务路由
  app.get('/api/v1/healthz', (_req, res) => { // 监控别名：语义同 /health，供只允许访问 /api 前缀的探针使用
    res.json({ status: 'ok' }); // 最小静态响应：只回报存活状态，不暴露服务名与版本
  }); // /api/v1/healthz 结束
  // 就绪探针：/health 只证明进程活着，/ready 还要确认依赖可用，部署与负载均衡据此决定是否放流量。
  // 必须早于强制登录门禁注册，否则只允许访问 /api 前缀的外部探针会被 401 拦掉。
  // 对外只回报 ready / unavailable，不列举依赖项与错误原因；失败明细写服务日志供运维定位。
  const readyHandler = (_req: Request, res: Response) => {
    const checks: Record<string, boolean> = {};
    try { // 数据库可能因文件损坏、锁冲突或磁盘满而不可读
      resolved.db.prepare('SELECT 1 AS ok').get(); // 最轻量的一次真实查询
      checks.database = true;
    } catch { // 探针不应把异常抛给调用方，直接降级为未就绪
      checks.database = false;
    }
    checks.storage = storage.configured; // 存储缺凭证时上传链路必失败，故未配置即未就绪
    const ready = Object.values(checks).every(Boolean); // 全部依赖就绪才算 ready
    if (!ready) console.error('[ready] 依赖未就绪', checks); // 明细只进服务日志，不进公网响应
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable' }); // 未就绪用 503 让编排器摘除实例
  };
  app.get('/api/v1/ready', readyHandler); // /api 前缀别名：与根路径共用同一判定
  app.use('/api/v1', createForceLoginMiddleware()); // 未认证一律 401，不签发任何临时身份

  // 公共只读端点缓存头：弱 ETag + Cache-Control + 304 命中，必须排在业务路由之前才能覆盖全部公开读接口
  app.use('/api/v1', createCacheHeaderMiddleware({ maxAgeSeconds: 60, scope: 'public' })); // 私有端点由该中间件按 scope 跳过，避免把用户数据写进共享缓存

  app.get('/health', (_req, res) => { // 健康检查：必须早于鉴权路由，供负载均衡与 CI 探活
    res.json({ status: 'ok' }); // 返回最小静态响应：不含服务名与版本，避免对外暴露内部标识
  }); // 健康检查路由结束

  // 根路径 /ready 与 /api/v1/ready 共用同一判定，兼容直连回环与 nginx location = /ready 反代
  app.get('/ready', readyHandler); // 就绪探针根路径别名

  // 公开路由：验证码/登录/刷新
  // 验证码门禁前置：按场景拦截写入口；生产环境未配置 MIM_CAPTCHA_MODE 时默认 image 并强制 register/login
  app.use('/api/v1/auth/register', createCaptchaMiddleware('register')); // 注册场景：开启后缺票据直接 400/403，未开启不改变行为
  app.use('/api/v1/auth/login', createCaptchaMiddleware('login')); // 登录场景：同上，按 MIM_CAPTCHA_LOGIN 开关生效
  app.use('/api/v1/auth/password', createCaptchaMiddleware('login')); // 口令登录同样受登录场景约束，堵住绕过验证码登录的爆破通道
  app.use('/api/v1', createAuthRouter(resolved)); // 登录端点无 token，必须注册在受保护路由之前才不会被拦成 401
  // 第三方登录：授权入口公开，绑定/解绑在 router 内部按需 requireAuth
  app.use('/api/v1', createOAuthRouter(resolved)); // 必须在全局 requireAuth 之前挂载，否则匿名发起授权会被拦成 401
  app.use('/api/v1', createFederationRouter(resolved)); // 联邦 OIDC：status/login 公开，callback 兑换后回跳票据
  app.use('/api/v1', createVipPricingRouter(resolved)); // VIP 定价规则只读查询，公开

  // 部署汇总路由：三个端点全部公开只读，不查业务表、不提供写操作
  app.use('/api/v1', createDeploymentsRouter(resolved)); // /deployments/overview 在 router 内先于 /:id 注册
  app.use('/api/v1', createContentUnifiedRouter(resolved)); // 统一内容与消息只读：/content/items 公开，/messaging/* 需登录
  app.use('/api/v1', createOrdersRouter(resolved)); // 统一订单只读：/orders 与 /orders/summary 均要求登录，旧订单路由保持原样
  app.use('/api/v1', createPaymentsRouter(resolved)); // 支付回调必须公开；其余端点在 router 内逐个挂鉴权
  app.use('/api/v1', createPaymentChannelRouter(resolved)); // 扩展渠道：第三方回调公开，下单/退款在 router 内挂 requireAuth + idempotency
  app.use('/api/v1', createSecurityRouter(resolved)); // 验证码公开；举报端点内部挂 requireAuth / 运营权限
  app.use('/api/v1', createInviteAdminRouter(resolved)); // 邀请码管理端需管理员令牌；校验端点公开供注册前预检
  app.use('/api/v1', createRealnameRouter(resolved)); // 本人端点内部 requireAuth；管理端点内部 requirePermission
  app.use('/api/v1', createContentOpsRouter(resolved)); // 公开公告/更新日志/推广端点先挂；管理端点内部再挂权限
  app.use('/api/v1', createSsoRouter(resolved)); // 票据签发要求登录态，兑换与登出广播保持公开

  // 受保护路由（各 router 内部统一 requireAuth）
  for (const router of [ // 顺序注册：同名子路径时先注册者先匹配
    createWalletWithdrawalRouter(resolved), // 提现分成必须先于社区路由：/wallet/withdrawals 自带登录 + 幂等，避免被社区 /wallet 前缀重复套一层
    createMeRouter(resolved), // /me 前缀：个人资料、设置、注销
    createMediaRouter(resolved), // media 控制面：预签名（聊天/社区附件上传均依赖）
    createImRouter(resolved), // IM 即时通讯：会话列表/消息历史/用户搜索/已读
    createAppearanceRouter(resolved), // 外观：site/config 与 pages 仍被购物车 / 社区页面区块使用
    createCommunityRouter(resolved), // 社区与变现：板块 / 帖子 / 付费解锁 / VIP / 钱包 / 商品订单 / 优惠码 / 推广
    createAssetsRouter(resolved), // 付费资产：付费阅读 / 下载 / 图库 / 视频的浏览、解锁与分成（社区页依赖，保留）
    createCirclesRouter(resolved), // 圈子：成员制社群（圈主 / 审核 / 成员上限 / 圈内动态与公告），与板块并存
    createReferralRouter(resolved), // 返佣：我的佣金明细与汇总（内部 requireAuth）
  ]) { // 路由数组结束，进入逐个注册循环
    app.use('/api/v1', router); // 统一 /api/v1 前缀；鉴权按命名空间在 router 内部生效
  } // for 结束：受保护 router 已依次挂载

  // 后台控制面（RBAC）：每个路由显式挂 requirePermission，未带凭证一律 401，带凭证但缺权限 403
  app.use('/api/v1', createAdminRouter(resolved)); // 不挂 idempotency：超管引导通道无 req.user，挂上会被幂等中间件前置拦截成 401
  app.use('/api/v1', createShopAdminRouter(resolved)); // 商城后台写入面：同样走 RBAC 权限点 commerce:write，不挂全局幂等
  app.use('/api/v1', createReferralAdminRouter(resolved)); // 返佣到期结算：RBAC commerce:write，独立文件不并入 admin.ts
  app.use('/api/v1', createGrowthDmAdminRouter(resolved)); // 成长私信：复用 IM 会话，RBAC messaging:write
  app.use('/api/v1', createGrowthRouter(resolved)); // 社区激励链：用户侧签到/流水/等级/徽章 + 管理侧规则配置，内部按端点各自鉴权

  app.use(notFound); // 所有路由之后兜底：未命中即返回统一 404 信封
  app.use(errorHandler); // 必须最后挂：四参错误中间件只捕获其之前注册的链路抛错
  return app; // 返回装配完成的应用，交给 server 监听
} // createApp 结束
