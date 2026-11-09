/** Express 应用装配：对象收发 → 公开路由 → 鉴权路由 → 统一 404/错误信封 */

import express from 'express'; // Express 本体，用于创建应用与挂载 JSON 解析
import cors from 'cors'; // 跨域中间件，托管平台以独立域名直连 API 时必需
import type { Express, NextFunction, Request, Response } from 'express'; // 仅类型引用，用于给工厂与中间件签名标注
import { createAuthRouter } from './routes/auth.js'; // 公开鉴权路由：验证码 / 登录 / 刷新
import { createCatalogRouter } from './routes/catalog.js'; // 商城路由：模块列表公开，权益接口内部鉴权
import { createImRouter } from './routes/im.js'; // 即时通讯：会话/消息/用户搜索，需登录
import { createMeRouter } from './routes/me.js'; // 个人资料与设置，内部统一 requireAuth
import { createComicRouter } from './routes/comic.js'; // 创作工程与分镜，内部统一 requireAuth
import { createMediaObjectRouter, createMediaRouter } from './routes/media.js'; // 媒体：免鉴权对象收发 + 受保护控制面
import { createAiRouter } from './routes/ai.js'; // AI 编排控制面，内部统一 requireAuth
import { createAdminRouter } from './routes/admin.js'; // RBAC 后台控制面：角色 / 权限 / 用户角色授权
import { createSitesRouter } from './routes/sites.js'; // 站点模块运行时：45 个去重入口的能力点 / 业务条目
import { createEntriesRouter } from './routes/entries.js'; // 统一入口配置清单：19 业务域 / 职责边界 / 关联区分 / 占位标识
import { createDeploymentsRouter } from './routes/deployments.js'; // 部署汇总：统一字段的部署仓库 / 部署项 / 状态 / 结果 / 异常，公开只读
import { errorHandler, notFound, requestId } from './middleware.js'; // 统一 404、错误信封、请求追踪三件套
import { DATA_DIR } from './config.js'; // 本地存储驱动的兜底目录
import { createStorage } from './storage.js'; // 存储适配器工厂，按 env 决定 local 或 s3
import { createOrchestrator } from './orchestrator.js'; // 生成任务编排器工厂，会启动后台 worker
import { createNotifyChannels } from './notify.js'; // 验证码通知通道工厂（短信 / 邮件）
import type { ApiDeps } from './types.js'; // 依赖容器类型

export function createApp(deps: ApiDeps): Express { // 应用工厂：测试可传入替身依赖，生产传入真实 db
  // 未注入 storage / orchestrator / notify 时按 env 构造默认实例（测试可显式注入替身）
  const storage = deps.storage ?? createStorage({ env: deps.env, jwtSecret: deps.jwtSecret, fallbackDir: DATA_DIR }); // 缺省存储：按 env 选驱动，本地驱动落 data 目录
  const orchestrator = // 缺省编排器：负责后台消费 queued 生成任务
    deps.orchestrator ?? createOrchestrator({ db: deps.db, storage, env: deps.env, now: deps.now }); // 复用上面解析好的 storage，防止控制面与 worker 读写不同目录
  const notify = deps.notify ?? createNotifyChannels(deps.env); // 缺省通知通道：无凭证时降级为日志下发验证码
  const resolved: ApiDeps = { ...deps, storage, orchestrator, notify }; // 合并为「全部就绪」的依赖，后续路由拿到的都是非空实例

  const app = express(); // 创建应用实例
  app.disable('x-powered-by'); // 关闭默认响应头，减少框架指纹暴露
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
    req.deps = resolved; // 路由内通过 req.deps 取 db / storage / orchestrator
    next(); // 继续后续中间件链
  }); // 依赖注入中间件结束

  // 对象收发端点必须先于 express.json 挂载：其 PUT 路由自带 raw 解析器，读取原始字节
  app.use('/api/v1', createMediaObjectRouter(resolved)); // 若排在 express.json 之后，请求流已被 JSON 解析器消费，raw 拿不到原始字节
  app.use(express.json({ limit: '1mb' })); // 全局 JSON 解析，限 1mb 防大包打爆内存；此后注册的路由才有 req.body

  app.get('/health', (_req, res) => { // 健康检查：必须早于鉴权路由，供负载均衡与 CI 探活
    res.json({ status: 'ok', service: 'mim-api', version: '0.0.0' }); // 返回最小静态响应，不查库以免探活放大故障
  }); // 健康检查路由结束

  // 就绪探针：/health 只证明进程活着，/ready 还要确认依赖可用，部署与负载均衡据此决定是否放流量
  app.get('/ready', (_req, res) => { // 依赖自检端点：不查业务表，只做最小可用性判定
    const checks: Record<string, boolean> = {}; // 逐项记录各依赖是否就绪，便于运维直接定位是库还是存储挂了
    try { // 数据库可能因文件损坏、锁冲突或磁盘满而不可读
      resolved.db.prepare('SELECT 1 AS ok').get(); // 最轻量的一次真实查询
      checks.database = true; // 查询成功即视为可读
    } catch { // 任意异常都按「不可用」处理
      checks.database = false; // 探针不应把异常抛给调用方，直接降级为未就绪
    } // 数据库检查结束
    checks.storage = storage.configured; // 存储缺凭证时上传链路必失败，故未配置即未就绪（用已解析的非空实例，避免可选字段误判）
    const ready = Object.values(checks).every(Boolean); // 全部依赖就绪才算 ready
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable', checks }); // 未就绪用 503 让编排器摘除实例
  }); // 就绪探针结束

  // 公开路由：验证码/登录/刷新
  app.use('/api/v1', createAuthRouter(resolved)); // 登录端点无 token，必须注册在受保护路由之前才不会被拦成 401

  // 商城路由：GET /modules 公开；POST /entitlements + GET /me/entitlements 内部 requireAuth
  app.use('/api/v1', createCatalogRouter(resolved)); // 公开与受保护端点混装，鉴权下沉到 router 内部按路径处理

  // 站点模块路由：浏览类端点公开；新建条目 / 状态流转在 router 内部挂 requireAuth + idempotency
  app.use('/api/v1', createSitesRouter(resolved)); // 与商城同属「浏览公开、写操作登录」的按需登录模型
  app.use('/api/v1', createEntriesRouter(resolved)); // 统一入口配置清单：全部端点只读公开，静态路径先于 /:entryKey 注册

  // 部署汇总路由：三个端点全部公开只读，不查业务表、不提供写操作
  app.use('/api/v1', createDeploymentsRouter(resolved)); // /deployments/overview 在 router 内先于 /:id 注册

  // 受保护路由（各 router 内部统一 requireAuth）
  for (const router of [ // 顺序注册：同名子路径时先注册者先匹配
    createMeRouter(resolved), // /me 前缀：个人资料、设置、注销
    createComicRouter(resolved), // 创作工程、分镜与审核
    createMediaRouter(resolved), // media 控制面：预签名与产物列表
    createAiRouter(resolved), // ai 编排控制面：能力自检与手动触发任务
    createImRouter(resolved), // IM 即时通讯：会话列表/消息历史/用户搜索/已读
  ]) { // 路由数组结束，进入逐个注册循环
    app.use('/api/v1', router); // 统一 /api/v1 前缀；鉴权按命名空间在 router 内部生效
  } // for 结束：四个受保护 router 已依次挂载

  // 后台控制面（RBAC）：每个路由显式挂 requirePermission，未带凭证一律 401，带凭证但缺权限 403
  app.use('/api/v1', createAdminRouter(resolved)); // 不挂 idempotency：超管引导通道无 req.user，挂上会被幂等中间件前置拦截成 401

  app.use(notFound); // 所有路由之后兜底：未命中即返回统一 404 信封
  app.use(errorHandler); // 必须最后挂：四参错误中间件只捕获其之前注册的链路抛错
  return app; // 返回装配完成的应用，交给 server 监听
} // createApp 结束
