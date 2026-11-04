/** Express 应用装配：公开路由 → 鉴权路由 → 统一 404/错误信封 */

import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { createAuthRouter } from './routes/auth.js';
import { createPublicBillingRouter, createBillingRouter } from './routes/billing.js';
import { createMeRouter } from './routes/me.js';
import { createProjectsRouter } from './routes/projects.js';
import { createTasksRouter } from './routes/tasks.js';
import { createDashboardRouter } from './routes/dashboard.js';
import { createSyncRouter } from './routes/sync.js';
import { createExportsRouter } from './routes/exports.js';
import { createAuditRouter } from './routes/audit.js';
import { errorHandler, notFound, requestId } from './middleware.js';
import type { ApiDeps } from './types.js';

export function createApp(deps: ApiDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(requestId);
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.deps = deps;
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'mim-api', version: '0.0.0' });
  });

  // 公开路由：套餐目录、mock 支付回调、验证码/登录/刷新
  app.use('/api/v1', createPublicBillingRouter(deps));
  app.use('/api/v1', createAuthRouter(deps));

  // 受保护路由（各 router 内部统一 requireAuth）
  for (const router of [
    createMeRouter(deps),
    createBillingRouter(deps),
    createProjectsRouter(deps),
    createTasksRouter(deps),
    createDashboardRouter(deps),
    createSyncRouter(deps),
    createExportsRouter(deps),
    createAuditRouter(deps),
  ]) {
    app.use('/api/v1', router);
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
