/**
 * 返佣 · 邀请人自助查询端点。
 *
 *   GET /api/v1/referral/commissions  — 鉴权，我的佣金明细 + 待结算 / 已结算 / 已冲正汇总。
 *
 * 结算动作（批量入账）走管理端端点 routes/referral-admin.ts；本文件只读。
 */

import { Router } from 'express'; // 路由容器
import { requireAuth } from '../middleware.js'; // 登录态校验
import { listCommissions } from '../commerce/referral-settlement.js'; // 明细与汇总查询
import type { ApiDeps } from '../types.js'; // 依赖容器

export function createReferralRouter(deps: ApiDeps): Router {
  const router = Router(); // 独立路由实例

  router.get('/referral/commissions', requireAuth, (req, res) => { // 只能看自己的佣金
    const { items, summary } = listCommissions(deps.db, req.user!.id); // 按邀请人查询
    res.json({ commissions: items, summary }); // 明细 + 汇总一起回显
  });

  return router; // 交出可挂载路由
}
