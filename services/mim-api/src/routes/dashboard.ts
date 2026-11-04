/** FR-03 个人仪表盘：今日、未来 7 天、逾期与未排期（按用户时区切日） */

import { Router } from 'express';
import { clockOf } from '../domain.js';
import { requireAuth } from '../middleware.js';
import { plusDaysDate } from '../utils.js';
import { taskPayload } from './tasks.js';
import type { TaskRow } from './tasks.js';
import type { ApiDeps } from '../types.js';

/** 用 IANA 时区求当地日期；非法时区回落 UTC 切日 */
export function localDate(iso: string, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));
    return parts;
  } catch {
    return iso.slice(0, 10);
  }
}

interface DashboardTaskRow extends TaskRow {
  project_name: string;
}

function selectTasks(db: ApiDeps['db'], userId: string, clause: string, params: unknown[]) {
  return db
    .prepare(
      `SELECT t.*, p.name AS project_name
       FROM tasks t
       JOIN projects p ON p.id = t.project_id AND p.status <> 'deleted'
       JOIN project_members m ON m.project_id = t.project_id AND m.user_id = ? AND m.status = 'active'
       WHERE t.deleted_at IS NULL AND ${clause}
       ORDER BY COALESCE(t.due_date, '9999-12-31'), t.priority DESC, t.created_at`,
    )
    .all(userId, ...params) as DashboardTaskRow[];
}

function withProject(rows: DashboardTaskRow[]) {
  return rows.map((row) => ({ ...taskPayload(row), project_name: row.project_name }));
}

export function createDashboardRouter(deps: ApiDeps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/dashboard', (req, res) => {
    const user = req.user!;
    const now = clockOf(deps);
    const today = localDate(now, user.timezone);
    const tomorrow = plusDaysDate(today, 1);
    const weekEnd = plusDaysDate(today, 7);

    const todayTasks = selectTasks(
      deps.db,
      user.id,
      `t.status = 'todo' AND t.due_date = ?`,
      [today],
    );
    const upcoming = selectTasks(
      deps.db,
      user.id,
      `t.status = 'todo' AND t.due_date >= ? AND t.due_date <= ?`,
      [tomorrow, weekEnd],
    );
    const overdue = selectTasks(deps.db, user.id, `t.status = 'todo' AND t.due_date < ?`, [today]);
    const unscheduled = selectTasks(
      deps.db,
      user.id,
      `t.status = 'todo' AND t.due_date IS NULL`,
      [],
    );
    const completedToday = selectTasks(
      deps.db,
      user.id,
      `t.status = 'done' AND t.updated_at >= ?`,
      [new Date(Date.parse(now) - 48 * 3600 * 1000).toISOString()],
    ).filter((row) => localDate(row.updated_at, user.timezone) === today);

    res.json({
      date: today,
      timezone: user.timezone,
      generated_at: now,
      today: withProject(todayTasks),
      next_7_days: withProject(upcoming),
      overdue: withProject(overdue),
      unscheduled: withProject(unscheduled),
      completed_today: withProject(completedToday),
      counts: {
        today: todayTasks.length,
        next_7_days: upcoming.length,
        overdue: overdue.length,
        unscheduled: unscheduled.length,
        completed_today: completedToday.length,
      },
    });
  });

  return router;
}
