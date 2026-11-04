/** FR-01/§9 审计日志：仅本人可见，倒序分页 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware.js';
import { parse } from '../validate.js';
import type { ApiDeps } from '../types.js';

const auditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  action: z.string().min(1).max(64).optional(),
});

interface AuditRow {
  id: string;
  action: string;
  target: string;
  request_id: string | null;
  payload: string | null;
  created_at: string;
}

export function createAuditRouter(deps: ApiDeps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/audit', (req, res) => {
    const query = parse(auditQuery, req.query);
    const clauses = ['user_id = ?'];
    const values: unknown[] = [req.user!.id];
    if (query.action) {
      clauses.push('action = ?');
      values.push(query.action);
    }
    const rows = deps.db
      .prepare(
        `SELECT id, action, target, request_id, payload, created_at FROM audit_logs
         WHERE ${clauses.join(' AND ')}
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...values, query.limit, query.offset) as AuditRow[];
    const total = deps.db
      .prepare(`SELECT COUNT(*) AS count FROM audit_logs WHERE ${clauses.join(' AND ')}`)
      .get(...values) as { count: number };
    res.json({ items: rows, total: total.count, limit: query.limit, offset: query.offset });
  });

  return router;
}
