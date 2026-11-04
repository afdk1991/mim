/** FR-03 CSV 导出（基础版及以上功能） */

import { Router } from 'express';
import { z } from 'zod';
import { AppError, hasFeature, uuidv7 } from '@mim/core-domain';
import { DATA_DIR } from '../config.js';
import { assertProjectAccess, clockOf, effectivePlan, writeAudit } from '../domain.js';
import { idempotency, requireAuth } from '../middleware.js';
import { parse } from '../validate.js';
import { csvEscape, pathParam } from '../utils.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ApiDeps } from '../types.js';
import type { TaskRow } from './tasks.js';

const EXPORT_DIR = resolve(DATA_DIR, 'exports');
const CSV_HEADER = [
  'id',
  'level',
  'parent_id',
  'title',
  'status',
  'due_date',
  'priority',
  'created_at',
  'updated_at',
];

interface ExportRow {
  id: string;
  user_id: string;
  project_id: string | null;
  status: string;
  file_path: string | null;
  created_at: string;
  updated_at: string;
}

function exportPayload(row: ExportRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function buildCsv(tasks: TaskRow[]): string {
  const lines = [CSV_HEADER.join(',')];
  const order = [...tasks].sort(
    (a, b) => a.level - b.level || a.created_at.localeCompare(b.created_at),
  );
  for (const task of order) {
    lines.push(
      [
        task.id,
        String(task.level),
        task.parent_id ?? '',
        task.title,
        task.status,
        task.due_date ?? '',
        String(task.priority),
        task.created_at,
        task.updated_at,
      ]
        .map((cell) => csvEscape(cell))
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function createExportsRouter(deps: ApiDeps): Router {
  const router = Router();
  router.use(requireAuth);

  router.post('/projects/:projectId/exports', idempotency, (req, res) => {
    parse(z.object({}).passthrough(), req.body ?? {});
    const user = req.user!;
    const now = clockOf(deps);
    assertProjectAccess(deps.db, pathParam(req, 'projectId'), user.id, 'export:create');

    const plan = effectivePlan(deps.db, user.id, now);
    if (!hasFeature(plan.features, 'csvExport')) {
      throw new AppError('FEATURE_NOT_AVAILABLE', 'csv export requires the basic plan or above', {
        feature: 'csvExport',
        plan_id: plan.planId,
      });
    }

    const tasks = deps.db
      .prepare('SELECT * FROM tasks WHERE project_id = ? AND deleted_at IS NULL ORDER BY level, created_at')
      .all(pathParam(req, 'projectId')) as TaskRow[];

    const exportId = uuidv7();
    if (!existsSync(EXPORT_DIR)) mkdirSync(EXPORT_DIR, { recursive: true });
    const filePath = resolve(EXPORT_DIR, `${exportId}.csv`);
    writeFileSync(filePath, buildCsv(tasks), { encoding: 'utf8' });

    deps.db
      .prepare(
        `INSERT INTO content_exports (id, user_id, project_id, status, file_path, created_at, updated_at)
         VALUES (?, ?, ?, 'ready', ?, ?, ?)`,
      )
      .run(exportId, user.id, pathParam(req, 'projectId'), filePath, now, now);

    writeAudit(deps.db, {
      userId: user.id,
      region: user.region,
      action: 'export.create',
      target: exportId,
      requestId: req.requestId,
      payload: { project_id: pathParam(req, 'projectId'), rows: tasks.length },
      createdAt: now,
    });

    const row = deps.db.prepare('SELECT * FROM content_exports WHERE id = ?').get(exportId) as ExportRow;
    res.status(201).json({ export: exportPayload(row), rows: tasks.length });
  });

  router.get('/exports', (req, res) => {
    const rows = deps.db
      .prepare('SELECT * FROM content_exports WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
      .all(req.user!.id) as ExportRow[];
    res.json({ items: rows.map(exportPayload) });
  });

  router.get('/exports/:exportId/download', (req, res) => {
    const row = deps.db
      .prepare('SELECT * FROM content_exports WHERE id = ?')
      .get(pathParam(req, 'exportId')) as ExportRow | undefined;
    if (!row || row.user_id !== req.user!.id) {
      throw new AppError('NOT_FOUND', 'export not found', { export_id: pathParam(req, 'exportId') });
    }
    if (!row.file_path || !existsSync(row.file_path)) {
      throw new AppError('NOT_FOUND', 'export file is no longer available', { export_id: row.id });
    }
    const csv = readFileSync(row.file_path, 'utf8');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="mim-export-${row.id}.csv"`);
    res.send(csv);
  });

  return router;
}
