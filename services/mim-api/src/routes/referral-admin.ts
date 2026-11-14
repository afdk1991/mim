/**
 * 返佣结算 · 管理端端点（独立文件，不并入 admin.ts）。
 *
 *   POST /api/v1/admin/referrals/settle  — RBAC commerce:write，把保护期已满的 pending
 *     佣金批量转 settled 并入余额；条件 UPDATE 抢占，重复调用幂等，不会二次入账。
 */

import { Router } from 'express'; // 路由容器
import { requirePermission } from '../middleware.js'; // RBAC 校验
import { settleDueCommissions } from '../commerce/referral-settlement.js'; // 结算状态机
import type { ApiDeps } from '../types.js'; // 依赖容器

export function createReferralAdminRouter(deps: ApiDeps): Router {
  const router = Router(); // 独立路由实例

  router.post('/admin/referrals/settle', requirePermission('commerce:write'), (req, res) => {
    const result = settleDueCommissions(deps); // 到期批量结算（注入时钟可在测试冻结）
    res.json({ ok: true, settled: result.settled, total_cents: result.totalCents }); // 回显本轮结算条数与金额
  });

  return router; // 交出可挂载路由
}
