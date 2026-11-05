/** Express 应用装配：对象收发 → 公开路由 → 鉴权路由 → 统一 404/错误信封 */

import express from 'express';
import cors from 'cors';
import type { Express, NextFunction, Request, Response } from 'express';
import { createAuthRouter } from './routes/auth.js';
import { createMeRouter } from './routes/me.js';
import { createComicRouter } from './routes/comic.js';
import { createMediaObjectRouter, createMediaRouter } from './routes/media.js';
import { createAiRouter } from './routes/ai.js';
import { errorHandler, notFound, requestId } from './middleware.js';
import { DATA_DIR } from './config.js';
import { createStorage } from './storage.js';
import { createOrchestrator } from './orchestrator.js';
import { createNotifyChannels } from './notify.js';
import type { ApiDeps } from './types.js';

export function createApp(deps: ApiDeps): Express {
  // 未注入 storage / orchestrator / notify 时按 env 构造默认实例（测试可显式注入替身）
  const storage = deps.storage ?? createStorage({ env: deps.env, jwtSecret: deps.jwtSecret, fallbackDir: DATA_DIR });
  const orchestrator =
    deps.orchestrator ?? createOrchestrator({ db: deps.db, storage, env: deps.env, now: deps.now });
  const notify = deps.notify ?? createNotifyChannels(deps.env);
  const resolved: ApiDeps = { ...deps, storage, orchestrator, notify };

  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  // 跨域白名单：托管平台（GitHub Pages / Cloudflare / Vercel / Render）以独立域名直连本 API。
  // MIM_CORS_ORIGINS 未配置时不挂载，保持自建服务器「同源反代」原有行为不变；Bearer 鉴权不依赖 Cookie，故 credentials 关闭。
  const corsOrigins = (resolved.env.MIM_CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (corsOrigins.length > 0) {
    app.use(
      cors({
        origin: corsOrigins,
        methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
        exposedHeaders: ['X-Request-Id'],
        credentials: false,
        maxAge: 86400,
      }),
    );
  }
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.deps = resolved;
    next();
  });

  // 对象收发端点必须先于 express.json 挂载：其 PUT 路由自带 raw 解析器，读取原始字节
  app.use('/api/v1', createMediaObjectRouter(resolved));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'mim-api', version: '0.0.0' });
  });

  // 公开路由：验证码/登录/刷新
  app.use('/api/v1', createAuthRouter(resolved));

  // 受保护路由（各 router 内部统一 requireAuth）
  for (const router of [
    createMeRouter(resolved),
    createComicRouter(resolved),
    createMediaRouter(resolved),
    createAiRouter(resolved),
  ]) {
    app.use('/api/v1', router);
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
