/** FR-03 工作区：任务与子任务（固定两级）、状态流转、LWW 同步写入 */

import { Router } from 'express';
import { z } from 'zod';
import {
  AppError,
  assertTaskTitle,
  assertTaskTransition,
  resolveConflict,
  resolveTaskLevel,
  uuidv7,
} from '@mim/core-domain';
import type { TaskLevel, TaskStatus } from '@mim/core-domain';
import { assertProjectAccess, clockOf, writeAudit } from '../domain.js';
import { idempotency, requireAuth } from '../middleware.js';
import { isIsoDate, pathParam } from '../utils.js';
import { parse } from '../validate.js';
import type { ApiDeps, Db } from '../types.js';

export interface TaskRow {
  id: string;
  project_id: string;
  user_id: string;
  parent_id: string | null;
  level: number;
  title: string;
  description: string;
  status: TaskStatus;
  due_date: string | null;
  priority: number;
  version: number;
  seq: number;
  client_updated_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const taskCreateBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  parent_id: z.string().min(1).optional(),
  due_date: z
    .string()
    .refine(isIsoDate, { message: 'due_date must be YYYY-MM-DD' })
    .optional(),
  priority: z.number().int().min(0).max(3).optional(),
});

const taskPatchBody = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
    due_date: z
      .string()
      .refine(isIsoDate, { message: 'due_date must be YYYY-MM-DD' })
      .nullable()
      .optional(),
    priority: z.number().int().min(0).max(3).optional(),
    status: z.enum(['todo', 'done']).optional(),
    version: z.number().int().positive(),
    client_updated_at: z.string().min(1),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.due_date !== undefined ||
      value.priority !== undefined ||
      value.status !== undefined,
    { message: 'at least one field is required' },
  );

const taskStatusBody = z.object({
  status: z.enum(['todo', 'done']),
  version: z.number().int().positive(),
  client_updated_at: z.string().min(1),
});

const taskListQuery = z.object({
  status: z.enum(['todo', 'done']).optional(),
  parent_id: z.string().min(1).optional(),
});

export function taskPayload(row: TaskRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    parent_id: row.parent_id,
    level: row.level,
    title: row.title,
    description: row.description,
    status: row.status,
    due_date: row.due_date,
    priority: row.priority,
    version: row.version,
    seq: row.seq,
    client_updated_at: row.client_updated_at,
    created_by: row.user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getTaskRow(db: Db, taskId: string): TaskRow | null {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
  if (!row || row.deleted_at !== null) return null;
  return row;
}

/** 任务级鉴权：先定位任务所属项目，再按项目角色判定 */
function assertTaskAccess(db: Db, taskId: string, userId: string, action: 'task:read' | 'task:write' | 'task:delete') {
  const row = getTaskRow(db, taskId);
  if (!row) throw new AppError('TASK_NOT_FOUND', 'task not found', { task_id: taskId });
  const access = assertProjectAccess(db, row.project_id, userId, action);
  return { task: row, ...access };
}

/** 任务事件 + tasks.seq 回写必须在同一事务内完成（08 §3.2） */
export function appendTaskEvent(
  db: Db,
  row: Pick<TaskRow, 'id' | 'project_id' | 'user_id'>,
  type: string,
  payload: unknown,
  clientUpdatedAt: string,
  now: string,
): number {
  const info = db
    .prepare(
      `INSERT INTO task_events (task_id, project_id, user_id, type, payload, client_updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(row.id, row.project_id, row.user_id, type, JSON.stringify(payload), clientUpdatedAt, now);
  return Number(info.lastInsertRowid);
}

export function createTasksRouter(deps: ApiDeps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/projects/:projectId/tasks', (req, res) => {
    const query = parse(taskListQuery, req.query);
    const user = req.user!;
    assertProjectAccess(deps.db, pathParam(req, 'projectId'), user.id, 'task:read');

    const clauses = ['project_id = ?', 'deleted_at IS NULL'];
    const values: unknown[] = [pathParam(req, 'projectId')];
    if (query.status) {
      clauses.push('status = ?');
      values.push(query.status);
    }
    if (query.parent_id) {
      clauses.push('parent_id = ?');
      values.push(query.parent_id);
    }
    const rows = deps.db
      .prepare(
        `SELECT * FROM tasks WHERE ${clauses.join(' AND ')}
         ORDER BY level, CASE status WHEN 'todo' THEN 0 ELSE 1 END, priority DESC,
                  COALESCE(due_date, '9999-12-31'), created_at`,
      )
      .all(...values) as TaskRow[];
    res.json({ items: rows.map(taskPayload) });
  });

  router.post('/projects/:projectId/tasks', idempotency, (req, res) => {
    const body = parse(taskCreateBody, req.body);
    const user = req.user!;
    const now = clockOf(deps);
    const { project } = assertProjectAccess(deps.db, pathParam(req, 'projectId'), user.id, 'task:write');

    let level: TaskLevel = 1;
    if (body.parent_id) {
      const parent = getTaskRow(deps.db, body.parent_id);
      if (!parent || parent.project_id !== project.id) {
        throw new AppError('TASK_PARENT_INVALID', 'parent task not found in this project', {
          parent_id: body.parent_id,
        });
      }
      level = resolveTaskLevel(parent.level as TaskLevel);
    }

    const title = assertTaskTitle(body.title);
    const taskId = uuidv7();
    const payload = {
      id: taskId,
      project_id: project.id,
      parent_id: body.parent_id ?? null,
      level,
      title,
      description: body.description ?? '',
      status: 'todo' as TaskStatus,
      due_date: body.due_date ?? null,
      priority: body.priority ?? 0,
      version: 1,
      seq: 0,
      client_updated_at: now,
      created_by: user.id,
      created_at: now,
      updated_at: now,
    };

    deps.db.transaction(() => {
      deps.db
        .prepare(
          `INSERT INTO tasks
             (id, project_id, user_id, parent_id, level, title, description, status, due_date,
              priority, version, seq, client_updated_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?, 1, 0, ?, ?, ?)`,
        )
        .run(
          taskId,
          project.id,
          user.id,
          body.parent_id ?? null,
          level,
          title,
          body.description ?? '',
          body.due_date ?? null,
          body.priority ?? 0,
          now,
          now,
          now,
        );
      const seq = appendTaskEvent(
        deps.db,
        { id: taskId, project_id: project.id, user_id: user.id },
        'created',
        payload,
        now,
        now,
      );
      deps.db.prepare('UPDATE tasks SET seq = ? WHERE id = ?').run(seq, taskId);
    })();

    const row = getTaskRow(deps.db, taskId)!;
    writeAudit(deps.db, {
      userId: user.id,
      region: user.region,
      action: 'task.create',
      target: taskId,
      requestId: req.requestId,
      createdAt: now,
    });
    res.status(201).json({ task: taskPayload(row) });
  });

  router.get('/tasks/:taskId', (req, res) => {
    const { task } = assertTaskAccess(deps.db, pathParam(req, 'taskId'), req.user!.id, 'task:read');
    res.json({ task: taskPayload(task) });
  });

  router.patch('/tasks/:taskId', idempotency, (req, res) => {
    const body = parse(taskPatchBody, req.body);
    const user = req.user!;
    const now = clockOf(deps);
    const { task } = assertTaskAccess(deps.db, pathParam(req, 'taskId'), user.id, 'task:write');

    const verdict = resolveConflict(
      { clientUpdatedAt: body.client_updated_at, seq: Number.MAX_SAFE_INTEGER },
      { clientUpdatedAt: task.client_updated_at, seq: task.seq },
    );
    if (verdict === 'reject') {
      throw new AppError('CONFLICT', 'server copy is newer than the incoming update', {
        current: taskPayload(task),
      });
    }
    if (body.status !== undefined) assertTaskTransition(task.status, body.status);
    if (body.title !== undefined) body.title = assertTaskTitle(body.title);

    const sets: string[] = [];
    const values: unknown[] = [];
    if (body.title !== undefined) {
      sets.push('title = ?');
      values.push(body.title);
    }
    if (body.description !== undefined) {
      sets.push('description = ?');
      values.push(body.description);
    }
    if (body.due_date !== undefined) {
      sets.push('due_date = ?');
      values.push(body.due_date);
    }
    if (body.priority !== undefined) {
      sets.push('priority = ?');
      values.push(body.priority);
    }
    if (body.status !== undefined) {
      sets.push('status = ?');
      values.push(body.status);
    }

    let changed = 0;
    deps.db.transaction(() => {
      const seq = appendTaskEvent(
        deps.db,
        { id: task.id, project_id: task.project_id, user_id: user.id },
        'updated',
        { changes: body, task_id: task.id },
        body.client_updated_at,
        now,
      );
      sets.push('version = version + 1', 'seq = ?', 'client_updated_at = ?', 'updated_at = ?');
      values.push(seq, body.client_updated_at, now, task.id, body.version);
      const result = deps.db
        .prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ? AND version = ?`)
        .run(...values);
      changed = result.changes;
      if (changed === 0) throw new AppError('CONFLICT', 'task was modified, refresh and retry');
    })();

    const row = getTaskRow(deps.db, task.id)!;
    writeAudit(deps.db, {
      userId: user.id,
      region: user.region,
      action: 'task.update',
      target: task.id,
      requestId: req.requestId,
      createdAt: now,
    });
    res.json({ task: taskPayload(row) });
  });

  router.post('/tasks/:taskId/status', idempotency, (req, res) => {
    const body = parse(taskStatusBody, req.body);
    const user = req.user!;
    const now = clockOf(deps);
    const { task } = assertTaskAccess(deps.db, pathParam(req, 'taskId'), user.id, 'task:write');

    const verdict = resolveConflict(
      { clientUpdatedAt: body.client_updated_at, seq: Number.MAX_SAFE_INTEGER },
      { clientUpdatedAt: task.client_updated_at, seq: task.seq },
    );
    if (verdict === 'reject') {
      throw new AppError('CONFLICT', 'server copy is newer than the incoming update', {
        current: taskPayload(task),
      });
    }
    assertTaskTransition(task.status, body.status);

    let changed = 0;
    deps.db.transaction(() => {
      const seq = appendTaskEvent(
        deps.db,
        { id: task.id, project_id: task.project_id, user_id: user.id },
        'status_changed',
        { task_id: task.id, from: task.status, to: body.status },
        body.client_updated_at,
        now,
      );
      const result = deps.db
        .prepare(
          `UPDATE tasks SET status = ?, version = version + 1, seq = ?,
             client_updated_at = ?, updated_at = ? WHERE id = ? AND version = ?`,
        )
        .run(body.status, seq, body.client_updated_at, now, task.id, body.version);
      changed = result.changes;
      if (changed === 0) throw new AppError('CONFLICT', 'task was modified, refresh and retry');
    })();

    const row = getTaskRow(deps.db, task.id)!;
    writeAudit(deps.db, {
      userId: user.id,
      region: user.region,
      action: 'task.status',
      target: task.id,
      requestId: req.requestId,
      payload: { status: body.status },
      createdAt: now,
    });
    res.json({ task: taskPayload(row) });
  });

  router.delete('/tasks/:taskId', idempotency, (req, res) => {
    const user = req.user!;
    const now = clockOf(deps);
    const { task } = assertTaskAccess(deps.db, pathParam(req, 'taskId'), user.id, 'task:delete');

    const targets = [task];
    if (task.level === 1) {
      const children = deps.db
        .prepare(`SELECT * FROM tasks WHERE parent_id = ? AND deleted_at IS NULL`)
        .all(task.id) as TaskRow[];
      targets.push(...children);
    }

    deps.db.transaction(() => {
      for (const row of targets) {
        const seq = appendTaskEvent(
          deps.db,
          { id: row.id, project_id: row.project_id, user_id: user.id },
          'deleted',
          { task_id: row.id },
          now,
          now,
        );
        deps.db
          .prepare(
            `UPDATE tasks SET deleted_at = ?, version = version + 1, seq = ?, updated_at = ?
             WHERE id = ? AND deleted_at IS NULL`,
          )
          .run(now, seq, now, row.id);
      }
    })();

    writeAudit(deps.db, {
      userId: user.id,
      region: user.region,
      action: 'task.delete',
      target: task.id,
      requestId: req.requestId,
      payload: { cascaded: targets.length - 1 },
      createdAt: now,
    });
    res.json({ status: 'deleted', id: task.id, cascaded_children: targets.length - 1 });
  });

  return router;
}
