/** FR-03 多端实时同步：基于 task_events.seq 的增量拉取 */

import { Router } from 'express';
import { z } from 'zod';
import { assertProjectAccess, clockOf } from '../domain.js';
import { idempotency, requireAuth } from '../middleware.js';
import { parse } from '../validate.js';
import { SYNC_PAGE_SIZE } from '../config.js';
import type { ApiDeps } from '../types.js';
import type { TaskRow } from './tasks.js';

const changesQuery = z.object({
  since_seq: z.coerce.number().int().min(0).default(0),
  project_id: z.string().min(1).optional(),
  device_id: z.string().min(1).max(128).optional(),
});

interface EventRow {
  seq: number;
  task_id: string;
  project_id: string;
  user_id: string;
  type: string;
  payload: string;
  client_updated_at: string;
  created_at: string;
}

function eventPayload(row: EventRow, task: TaskRow | null) {
  return {
    seq: row.seq,
    type: row.type,
    task_id: row.task_id,
    project_id: row.project_id,
    payload: row.payload,
    client_updated_at: row.client_updated_at,
    created_at: row.created_at,
    task: task
      ? {
          id: task.id,
          parent_id: task.parent_id,
          level: task.level,
          title: task.title,
          description: task.description,
          status: task.status,
          due_date: task.due_date,
          priority: task.priority,
          version: task.version,
          seq: task.seq,
          client_updated_at: task.client_updated_at,
          updated_at: task.updated_at,
          deleted: task.deleted_at !== null,
        }
      : null,
  };
}

/** 设备游标：同一用户多设备独立记录 last_seq（08 §3.2） */
function upsertCursor(deps: ApiDeps, userId: string, deviceId: string | undefined, seq: number, now: string): void {
  if (!deviceId) return;
  deps.db
    .prepare(
      `INSERT INTO sync_cursors (id, user_id, device_id, last_seq, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_seq = excluded.last_seq, updated_at = excluded.updated_at`,
    )
    .run(`${userId}:${deviceId}`, userId, deviceId, seq, now);
}

export function createSyncRouter(deps: ApiDeps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/sync/changes', (req, res) => {
    const query = parse(changesQuery, req.query);
    const user = req.user!;

    if (query.project_id) {
      assertProjectAccess(deps.db, query.project_id, user.id, 'task:read');
    }

    const clauses = [
      'e.seq > ?',
      `EXISTS (SELECT 1 FROM project_members m
                WHERE m.project_id = e.project_id AND m.user_id = ? AND m.status = 'active')`,
      'EXISTS (SELECT 1 FROM projects p WHERE p.id = e.project_id AND p.status <> \'deleted\')',
    ];
    const values: unknown[] = [query.since_seq, user.id];
    if (query.project_id) {
      clauses.push('e.project_id = ?');
      values.push(query.project_id);
    }

    const rows = deps.db
      .prepare(
        `SELECT e.* FROM task_events e
         WHERE ${clauses.join(' AND ')}
         ORDER BY e.seq ASC
         LIMIT ?`,
      )
      .all(...values, SYNC_PAGE_SIZE + 1) as EventRow[];

    const hasMore = rows.length > SYNC_PAGE_SIZE;
    const page = hasMore ? rows.slice(0, SYNC_PAGE_SIZE) : rows;
    const taskStmt = deps.db.prepare('SELECT * FROM tasks WHERE id = ?');
    const items = page.map((row) => {
      const task = (taskStmt.get(row.task_id) as TaskRow | undefined) ?? null;
      return eventPayload(row, task);
    });

    const nextSeq = page.length > 0 ? page[page.length - 1].seq : query.since_seq;
    upsertCursor(deps, user.id, query.device_id, nextSeq, clockOf(deps));

    res.json({ items, next_seq: nextSeq, has_more: hasMore });
  });

  // 客户端上报自身游标（离线补拉后确认）
  router.post('/sync/cursors', idempotency, (req, res) => {
    const body = parse(z.object({ device_id: z.string().min(1).max(128), last_seq: z.number().int().min(0) }), req.body);
    const now = clockOf(deps);
    upsertCursor(deps, req.user!.id, body.device_id, body.last_seq, now);
    res.json({ device_id: body.device_id, last_seq: body.last_seq });
  });

  return router;
}
