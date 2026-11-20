/**
 * 返佣结算 · 管理端端点（独立文件，不并入 admin.ts）。
 *
 *   POST /api/v1/admin/referrals/settle  — RBAC commerce:write，把保护期已满的 pending
 *     佣金批量转 settled 并入余额；条件 UPDATE 抢占，重复调用幂等，不会二次入账。
 */

import { Router } from 'express'; // 路由容器
import { requirePermission } from '../middleware.js'; // RBAC 校验
import { audited, auditActor } from '../audit.js'; // 统一审计留痕：返佣结算动钱，必须留痕
import { settleDueCommissions } from '../commerce/referral-settlement.js'; // 结算状态机
import type { ApiDeps } from '../types.js'; // 依赖容器

export function createReferralAdminRouter(deps: ApiDeps): Router {
  const router = Router(); // 独立路由实例

  router.post('/admin/referrals/settle', requirePermission('commerce:write'), (req, res) => {
    const detail: Record<string, unknown> = {}; // 结算条数 / 金额在业务跑完后回填，审计落库时序列化
    const result = audited(deps.db, auditActor(req), { // 批量结算与审计同属一次敏感操作（动钱）
      action: 'referral.settle', // 动作码：返佣到期结算
      targetType: 'referral_settle', // 对象类型：结算批次
      targetId: 'batch', // 对象主键：批次口径（幂等重复调用不二次入账）
      detail, // 明细：本轮结算条数与金额（非敏感）
    }, () => {
      const settled = settleDueCommissions(deps); // 到期批量结算（注入时钟可在测试冻结）
      detail.settled = settled.settled; // 回填本轮结算条数
      detail.total_cents = settled.totalCents; // 回填本轮结算金额（分）
      return settled; // 交回业务结果
    });
    res.json({ ok: true, settled: result.settled, total_cents: result.totalCents }); // 回显本轮结算条数与金额
  });

  return router; // 交出可挂载路由
}
