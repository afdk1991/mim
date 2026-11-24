/**
 * 账号注销 · 管理端端点（独立文件，不并入 admin.ts）。
 *
 *   GET  /admin/deletions       — RBAC user:read，待删除队列 + 当前清理策略 + 最近一次执行留痕；
 *   POST /admin/deletions/run    — RBAC privacy:write，立即执行一轮到期物理清理并写审计。
 */

import { Router } from 'express'; // 路由容器
import { uuidv7 } from '@mim/core-domain'; // 审计行主键，调用方需要回读 audit_id 时显式生成
import { requirePermission } from '../middleware.js'; // RBAC 校验
import { auditActor, writeAudit } from '../audit.js'; // 统一审计留痕：手动清理属敏感写操作，必须留痕
import { sha256 } from '../auth.js'; // id 摘要：审计只存前 8 位 sha256，不存原值
import { listDeletionQueue, purgeDueAccountsDetailed } from '../privacy.js'; // 队列查询与到期清理引擎
import { deletionBatchSize, deletionGraceDays, deletionSweepMinutes, JOBS_ENABLED } from '../config.js'; // 清理策略参数（env 派生）
import { clockOf } from '../domain.js'; // 可控时钟，响应时间戳与注入时钟对齐
import { jsonParse } from '../utils.js'; // 解析审计明细 JSON，脏数据不抛错
import type { ApiDeps } from '../types.js'; // 依赖容器

/** 审计明细行结构（反查最近一次清理批次用） */
interface PurgeAuditRow {
  created_at: string; // 审计时间（ISO）
  payload: string | null; // 已脱敏明细 JSON
} // PurgeAuditRow 结束

export function createPrivacyAdminRouter(deps: ApiDeps): Router {
  const router = Router(); // 独立路由实例

  // GET /admin/deletions：待删除队列、策略与最近一次执行留痕（user:read 只读权限）
  router.get('/admin/deletions', requirePermission('user:read'), (_req, res) => {
    const now = new Date(); // 队列倒计时基准时间
    const batchSize = deletionBatchSize(deps.env); // 单轮批量上限（同时作为列表条数上限）
    const items = listDeletionQueue(deps.db, now, batchSize); // 待删除队列（按预约时间升序）
    const totalRow = deps.db.prepare( // 统计全部待删除账号数（不受列表条数上限约束）
      "SELECT COUNT(*) AS n FROM users WHERE status = 'pending_deletion'",
    ).get() as { n: number }; // 计数行结构断言

    // 反查最近一次 privacy.account_purge 审计，作为最近执行留痕
    const lastRow = deps.db.prepare(
      `SELECT created_at, payload FROM audit_logs WHERE action = ? ORDER BY created_at DESC LIMIT 1`,
    ).get('privacy.account_purge') as PurgeAuditRow | undefined; // 最新一条清理批次审计
    let lastRun: { at: string | null; purged: number; source: string | null } = { at: null, purged: 0, source: null }; // 缺省空留痕
    if (lastRow) { // 存在历史批次：解析明细回填
      const payload = jsonParse<{ purged?: number; source?: string }>(lastRow.payload); // 解析审计明细
      lastRun = { // 组装最近执行记录
        at: lastRow.created_at, // 执行时间
        purged: payload?.purged ?? 0, // 回收条数
        source: payload?.source ?? null, // 触发来源 startup / interval / manual
      }; // lastRun 结束
    } // 历史批次分支结束

    res.json({ // 响应结构对齐冻结契约 §2.1
      total: totalRow.n, // 待删除账号总数
      items, // 队列明细（含剩余秒数与逾期标记）
      policy: { // 当前生效的清理策略
        auto_purge_enabled: JOBS_ENABLED, // 进程内调度总开关
        grace_days: deletionGraceDays(deps.env), // 注销冷静期天数
        sweep_minutes: deletionSweepMinutes(deps.env), // 到期扫描间隔（分钟）
        batch_size: batchSize, // 单轮批量上限
      },
      last_run: lastRun, // 最近一次执行留痕（无记录时 at=null）
    }); // 响应结束
  }); // GET /admin/deletions 结束

  // POST /admin/deletions/run：手动触发一轮到期清理（privacy:write 专属写权限）
  router.post('/admin/deletions/run', requirePermission('privacy:write'), (req, res) => {
    const auditId = uuidv7(); // 显式生成审计主键，便于响应回读 audit_id
    const { result, purgedIds } = purgeDueAccountsDetailed(deps.db, deps.storage, {}); // 跑一轮到期清理
    const idsSha256 = purgedIds.map((id) => sha256(id).slice(0, 8)); // 已删 id 只存前 8 位摘要，不存原值
    writeAudit(deps.db, auditActor(req), { // 手动清理批次留痕
      id: auditId, // 回读用审计主键
      action: 'privacy.account_purge', // 动作码：账号注销清理
      targetType: 'privacy_purge', // 对象类型：清理批次
      targetId: 'batch', // 批次口径
      detail: { // 明细只含计数、逐表行数与摘要集合
        scanned: result.scanned, // 候选数
        purged: result.purged, // 回收数
        deleted_rows: result.deletedRows, // 逐表删除行数
        ids_sha256: idsSha256, // 已删 id 摘要（前 8 位）
        source: 'manual', // 触发来源：管理端手动
      },
    }); // 审计写入结束
    res.json({ // 响应结构对齐冻结契约 §2.2
      purged: result.purged, // 本轮回收账号数
      scanned: result.scanned, // 本轮扫描候选数
      at: clockOf(deps), // 执行时间（ISO）
      audit_id: auditId, // 审计行主键，供后台追溯
    }); // 响应结束
  }); // POST /admin/deletions/run 结束

  return router; // 交出可挂载路由
} // createPrivacyAdminRouter 结束
