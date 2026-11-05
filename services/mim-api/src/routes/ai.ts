/**
 * ai-orchestrator 域（08 §2 / §8）：生成任务编排控制面
 *
 * - 后台 worker 自动消费 queued 任务（进程内，见 orchestrator.ts）；
 * - 本路由提供手动触发（便于测试与运维补偿）与能力自检；
 * - 任务归属经工程 owner 校验，跨用户一律 404。
 */

import { Router } from 'express';
import { AppError } from '@mim/core-domain';

import { idempotency, requireAuth, requireEntitlement } from '../middleware.js';
import { jsonParse, pathParam } from '../utils.js';
import type { Orchestrator } from '../orchestrator.js';
import type { ApiDeps } from '../types.js';
import { ownedJobProjectId } from './media.js';

const MODULE_CODE = 'comic.workbench';

interface JobRow {
  id: string;
  project_id: string;
  storyboard_id: string | null;
  job_type: string;
  status: string;
  retry_of: string | null;
  cost_estimate_minor: number | null;
  error_code: string | null;
  payload: string;
  result: string | null;
  created_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

function jobPayload(row: JobRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    storyboard_id: row.storyboard_id,
    job_type: row.job_type,
    status: row.status,
    retry_of: row.retry_of,
    cost_estimate_minor: row.cost_estimate_minor,
    error_code: row.error_code,
    payload: jsonParse<Record<string, unknown>>(row.payload) ?? {},
    result: row.result ? jsonParse<Record<string, unknown>>(row.result) : null,
    created_by: row.created_by,
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
  };
}

function requireOrchestrator(deps: ApiDeps): Orchestrator {
  if (!deps.orchestrator) {
    throw new AppError('PROVIDER_NOT_CONFIGURED', 'ai orchestrator is not available');
  }
  return deps.orchestrator;
}

export function createAiRouter(deps: ApiDeps): Router {
  const router = Router();
  // 鉴权按命名空间生效：未匹配到 /ai* 的请求直接放行到后续 router，避免未知路径被误拦成 401
  router.use('/ai', requireAuth);
  router.use('/ai', requireEntitlement(MODULE_CODE));

  /** 能力自检：provider / 成本上限 / 保留期 / 存储驱动 */
  router.get('/ai/capabilities', (_req, res) => {
    const orchestrator = requireOrchestrator(deps);
    res.json({
      ai: orchestrator.capabilities(),
      storage: deps.storage
        ? { driver: deps.storage.driver, configured: deps.storage.configured }
        : null,
    });
  });

  /** 手动触发单个 queued 任务（正常由后台 worker 自动消费） */
  router.post('/ai/jobs/:id/run', idempotency, async (req, res) => {
    const user = req.user!;
    const jobId = pathParam(req, 'id');

    const projectId = ownedJobProjectId(deps.db, user.id, jobId);
    if (!projectId) throw new AppError('NOT_FOUND', 'generation job not found', { job_id: jobId });

    const job = deps.db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(jobId) as JobRow | undefined;
    if (!job) throw new AppError('NOT_FOUND', 'generation job not found', { job_id: jobId });
    if (job.status !== 'queued') {
      throw new AppError('CONFLICT', `generation job is ${job.status}`, { job_id: jobId, status: job.status });
    }

    const orchestrator = requireOrchestrator(deps);
    const run = await orchestrator.runOne(jobId);
    if (!run || run.status === 'skipped') {
      throw new AppError('CONFLICT', run?.message ?? 'generation job was claimed by another worker', {
        job_id: jobId,
      });
    }

    const updated = deps.db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(jobId) as JobRow;

    res.json({ run, job: jobPayload(updated) });
  });

  return router;
}
