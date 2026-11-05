/**
 * 第 1 期：AI 辅助创作工作台（07 §12.1、08 §3.2）
 * 第 2 期：生成任务编排（generation_jobs）+ 成片合成（comic_films / film_versions）路由骨架
 *
 * 交付物是「创作工程」而非成片：
 * 剧本 / 分镜 / 角色设定 / 对白 / 配音均由 AI 建议，人工确认后再导出素材。
 * 第 2 期落地状态机与编排控制面；真实模型调用与队列消费（ai-orchestrator）、
 * 对象存储预签名（media 域 /media/presign/*）后续接入，骨架不伪造外部产物。
 */

import { Router } from 'express';
import { z } from 'zod';
import { AppError, uuidv7 } from '@mim/core-domain';
import { clockOf } from '../domain.js';
import { idempotency, requireAuth, requireEntitlement } from '../middleware.js';
import { parse } from '../validate.js';
import { jsonParse, pathParam } from '../utils.js';
import type { ApiDeps, Db } from '../types.js';

/** 工作台的解锁模块编码（与 db.ts seedModules 保持一致） */
const MODULE_CODE = 'comic.workbench';

/** 允许写入分镜 / 角色的项目状态；进入生成态后内容冻结 */
const EDITABLE_STATUSES = new Set(['draft', 'storyboarded']);

const PROJECT_STATUSES = [
  'draft',
  'storyboarded',
  'generating',
  'rendered',
  'published',
  'archived',
] as const;

interface ProjectRow {
  id: string;
  owner_user_id: string;
  region: string;
  title: string;
  synopsis: string | null;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface CharacterRow {
  id: string;
  project_id: string;
  name: string;
  appearance_prompt: string;
  seed: number | null;
  reference_asset_ids: string;
  voice_profile: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface StoryboardRow {
  id: string;
  project_id: string;
  version_no: number;
  shots: string;
  confirmed_at: string | null;
  created_by: string;
  created_at: string;
}

/** 第 2 期：生成任务编排（08 §3.2：queued → running → succeeded/failed/canceled 单向） */
const JOB_TYPES = ['text', 'image', 'video', 'tts', 'compose'] as const;
const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'canceled'] as const;

/** 第 2 期：成片（draft → reviewing → published → archived；驳回回到 draft 留原因） */
const FILM_STATUSES = ['draft', 'reviewing', 'published', 'archived'] as const;

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

interface FilmRow {
  id: string;
  project_id: string;
  title: string;
  status: string;
  current_version_id: string | null;
  review_note: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface FilmVersionRow {
  id: string;
  film_id: string;
  version_no: number;
  object_key: string | null;
  duration_sec: number | null;
  size_bytes: number | null;
  published_at: string | null;
  created_by: string;
  created_at: string;
}

function projectPayload(row: ProjectRow) {
  return {
    id: row.id,
    region: row.region,
    title: row.title,
    synopsis: row.synopsis,
    status: row.status,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function characterPayload(row: CharacterRow) {
  return {
    id: row.id,
    name: row.name,
    appearance_prompt: row.appearance_prompt,
    seed: row.seed,
    reference_asset_ids: jsonParse<string[]>(row.reference_asset_ids) ?? [],
    voice_profile: row.voice_profile,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function storyboardPayload(row: StoryboardRow) {
  return {
    id: row.id,
    version_no: row.version_no,
    shots: jsonParse<unknown[]>(row.shots) ?? [],
    confirmed_at: row.confirmed_at,
    created_by: row.created_by,
    created_at: row.created_at,
  };
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

function filmPayload(row: FilmRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    status: row.status,
    current_version_id: row.current_version_id,
    review_note: row.review_note,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function filmVersionPayload(row: FilmVersionRow) {
  return {
    id: row.id,
    film_id: row.film_id,
    version_no: row.version_no,
    object_key: row.object_key,
    duration_sec: row.duration_sec,
    size_bytes: row.size_bytes,
    published_at: row.published_at,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

/** 只允许操作「本人 + 未删除」的创作工程；跨用户与不存在一律 404，不泄漏存在性 */
function findProject(db: Db, userId: string, projectId: string): ProjectRow {
  const row = db
    .prepare(
      `SELECT * FROM comic_projects
       WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL`,
    )
    .get(projectId, userId) as ProjectRow | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'comic project not found', { project_id: projectId });
  return row;
}

/** 任务经工程判定归属：跨用户 / 已删除工程 / 不存在一律 404，不泄漏存在性 */
function findJob(db: Db, userId: string, jobId: string): JobRow {
  const row = db
    .prepare(
      `SELECT j.* FROM generation_jobs j
       JOIN comic_projects p ON p.id = j.project_id
       WHERE j.id = ? AND p.owner_user_id = ? AND p.deleted_at IS NULL`,
    )
    .get(jobId, userId) as JobRow | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'generation job not found', { job_id: jobId });
  return row;
}

/** 成片同样经工程判定归属，规则与 findJob 一致 */
function findFilm(db: Db, userId: string, filmId: string): FilmRow {
  const row = db
    .prepare(
      `SELECT f.* FROM comic_films f
       JOIN comic_projects p ON p.id = f.project_id
       WHERE f.id = ? AND p.owner_user_id = ? AND p.deleted_at IS NULL AND f.deleted_at IS NULL`,
    )
    .get(filmId, userId) as FilmRow | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'comic film not found', { film_id: filmId });
  return row;
}

const createBody = z.object({
  title: z.string().trim().min(1).max(120),
  synopsis: z.string().max(4000).optional(),
});

const updateBody = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    synopsis: z.string().max(4000).nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine((value) => value.title !== undefined || value.synopsis !== undefined, {
    message: 'title or synopsis is required',
  });

const shotSchema = z.object({
  index: z.number().int().positive(),
  description: z.string().trim().min(1).max(1000),
  dialogue: z.string().max(1000).optional(),
  camera: z.string().max(80).optional(),
  duration_sec: z.number().positive().max(600).optional(),
});

const storyboardBody = z.object({
  shots: z.array(shotSchema).min(1).max(100),
  confirm: z.boolean().default(false),
});

const characterBody = z.object({
  name: z.string().trim().min(1).max(60),
  appearance_prompt: z.string().trim().min(1).max(2000),
  seed: z.number().int().optional(),
  reference_asset_ids: z.array(z.string().min(1)).max(20).default([]),
  voice_profile: z.string().max(200).optional(),
});

const suggestBody = z.object({
  kind: z.enum(['script', 'storyboard', 'dialogue', 'voice']),
  prompt: z.string().max(2000).optional(),
  count: z.number().int().min(1).max(10).default(3),
});

const listQuery = z.object({
  status: z.enum(PROJECT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ---------- 第 2 期：任务编排 / 成片合成入参 ----------

const createJobBody = z.object({
  job_type: z.enum(JOB_TYPES),
  storyboard_id: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  cost_estimate_minor: z.number().int().min(0).optional(),
});

const listJobsQuery = z.object({
  status: z.enum(JOB_STATUSES).optional(),
  job_type: z.enum(JOB_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const completeJobBody = z.object({
  result: z.record(z.string(), z.unknown()).default({}),
});

const failJobBody = z.object({
  error_code: z.string().trim().min(1).max(80),
});

const createFilmBody = z.object({
  title: z.string().trim().min(1).max(120),
  object_key: z.string().min(1).max(512).optional(),
  duration_sec: z.number().int().positive().optional(),
  size_bytes: z.number().int().min(0).optional(),
});

const filmVersionBody = z.object({
  object_key: z.string().min(1).max(512).optional(),
  duration_sec: z.number().int().positive().optional(),
  size_bytes: z.number().int().min(0).optional(),
});

const rejectFilmBody = z.object({
  reason: z.string().trim().min(1).max(500),
});

const listFilmsQuery = z.object({
  status: z.enum(FILM_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * 本地 mock 建议适配器：真实文本模型（第 2 期 P0）未接入前，
 * 返回结构化、可人工确认的候选，不伪造外部模型输出。
 */
function buildMockSuggestions(
  kind: 'script' | 'storyboard' | 'dialogue' | 'voice',
  project: ProjectRow,
  prompt: string | null,
  count: number,
): Array<Record<string, unknown>> {
  const theme = project.synopsis?.trim() || prompt?.trim() || `${project.title}的核心冲突`;
  const items: Array<Record<string, unknown>> = [];
  for (let i = 1; i <= count; i += 1) {
    if (kind === 'script') {
      items.push({
        title: `${project.title}·剧情候选 ${i}`,
        logline: `${theme}（方向 ${i}）`,
        beats: ['起', '承', '转', '合'],
      });
    } else if (kind === 'storyboard') {
      items.push({
        index: i,
        description: `分镜 ${i}：围绕「${theme}」推进`,
        camera: i % 2 === 0 ? '中景横移' : '近景固定',
        duration_sec: 3,
      });
    } else if (kind === 'dialogue') {
      items.push({
        speaker: `角色${((i - 1) % 2) + 1}`,
        line: `围绕「${theme}」的对白候选 ${i}`,
      });
    } else {
      items.push({
        character_name: `角色${((i - 1) % 2) + 1}`,
        voice_profile: `沉稳·中低音·语速偏慢（候选 ${i}）`,
      });
    }
  }
  return items;
}

export function createComicRouter(deps: ApiDeps): Router {
  const router = Router();
  router.use(requireAuth);
  router.use(requireEntitlement(MODULE_CODE));

  // ---------- 创作工程 CRUD ----------

  router.get('/comic/projects', (req, res) => {
    const user = req.user!;
    const query = parse(listQuery, req.query);
    const rows = query.status
      ? deps.db
          .prepare(
            `SELECT * FROM comic_projects
             WHERE owner_user_id = ? AND status = ? AND deleted_at IS NULL
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(user.id, query.status, query.limit)
      : deps.db
          .prepare(
            `SELECT * FROM comic_projects
             WHERE owner_user_id = ? AND deleted_at IS NULL
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(user.id, query.limit);
    res.json({ items: (rows as ProjectRow[]).map(projectPayload) });
  });

  router.post('/comic/projects', idempotency, (req, res) => {
    const body = parse(createBody, req.body);
    const user = req.user!;
    const now = clockOf(deps);
    const id = uuidv7();
    deps.db
      .prepare(
        `INSERT INTO comic_projects
           (id, owner_user_id, region, title, synopsis, status, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', 1, ?, ?)`,
      )
      .run(id, user.id, user.region, body.title, body.synopsis ?? null, now, now);
    res.status(201).json({ project: projectPayload(findProject(deps.db, user.id, id)) });
  });

  router.get('/comic/projects/:id', (req, res) => {
    const user = req.user!;
    const project = findProject(deps.db, user.id, pathParam(req, 'id'));
    const characters = deps.db
      .prepare(
        `SELECT * FROM comic_characters
         WHERE project_id = ? AND deleted_at IS NULL
         ORDER BY created_at`,
      )
      .all(project.id) as CharacterRow[];
    const storyboard = deps.db
      .prepare(
        `SELECT * FROM storyboards
         WHERE project_id = ?
         ORDER BY version_no DESC
         LIMIT 1`,
      )
      .get(project.id) as StoryboardRow | undefined;
    res.json({
      project: projectPayload(project),
      characters: characters.map(characterPayload),
      latest_storyboard: storyboard ? storyboardPayload(storyboard) : null,
    });
  });

  router.patch('/comic/projects/:id', idempotency, (req, res) => {
    const body = parse(updateBody, req.body);
    const user = req.user!;
    const project = findProject(deps.db, user.id, pathParam(req, 'id'));
    if (project.version !== body.version) {
      throw new AppError('CONFLICT', 'project version mismatch', {
        expected_version: body.version,
        current_version: project.version,
      });
    }
    if (!EDITABLE_STATUSES.has(project.status)) {
      throw new AppError('CONFLICT', `project is not editable in status ${project.status}`, {
        status: project.status,
      });
    }

    const now = clockOf(deps);
    const sets: string[] = [];
    const values: unknown[] = [];
    if (body.title !== undefined) {
      sets.push('title = ?');
      values.push(body.title);
    }
    if (body.synopsis !== undefined) {
      sets.push('synopsis = ?');
      values.push(body.synopsis);
    }
    sets.push('version = ?', 'updated_at = ?');
    values.push(project.version + 1, now, project.id, project.version);

    const result = deps.db
      .prepare(`UPDATE comic_projects SET ${sets.join(', ')} WHERE id = ? AND version = ?`)
      .run(...values);
    if (result.changes === 0) {
      throw new AppError('CONFLICT', 'project was modified concurrently');
    }

    res.json({ project: projectPayload(findProject(deps.db, user.id, project.id)) });
  });

  router.delete('/comic/projects/:id', idempotency, (req, res) => {
    const user = req.user!;
    const project = findProject(deps.db, user.id, pathParam(req, 'id'));
    const now = clockOf(deps);
    deps.db.transaction(() => {
      deps.db
        .prepare(
          `UPDATE comic_projects
           SET deleted_at = ?, updated_at = ?, version = version + 1
           WHERE id = ?`,
        )
        .run(now, now, project.id);
      deps.db
        .prepare(
          `UPDATE comic_characters
           SET deleted_at = ?, updated_at = ?
           WHERE project_id = ? AND deleted_at IS NULL`,
        )
        .run(now, now, project.id);
    })();
    res.json({ ok: true, project_id: project.id });
  });

  // ---------- 分镜 ----------

  router.post('/comic/projects/:id/storyboard', idempotency, (req, res) => {
    const body = parse(storyboardBody, req.body);
    const user = req.user!;
    const project = findProject(deps.db, user.id, pathParam(req, 'id'));
    if (!EDITABLE_STATUSES.has(project.status)) {
      throw new AppError('CONFLICT', `project is not editable in status ${project.status}`, {
        status: project.status,
      });
    }
    if (new Set(body.shots.map((shot) => shot.index)).size !== body.shots.length) {
      throw new AppError('VALIDATION_FAILED', 'shot index must be unique', {
        field: 'shots.index',
      });
    }

    const now = clockOf(deps);
    const saved = deps.db.transaction(() => {
      const latest = deps.db
        .prepare(`SELECT MAX(version_no) AS max_version FROM storyboards WHERE project_id = ?`)
        .get(project.id) as { max_version: number | null };
      const versionNo = (latest.max_version ?? 0) + 1;
      const id = uuidv7();
      deps.db
        .prepare(
          `INSERT INTO storyboards
             (id, project_id, version_no, shots, confirmed_at, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          project.id,
          versionNo,
          JSON.stringify(body.shots),
          body.confirm ? now : null,
          user.id,
          now,
        );
      if (body.confirm) {
        deps.db
          .prepare(
            `UPDATE comic_projects
             SET status = 'storyboarded', version = version + 1, updated_at = ?
             WHERE id = ?`,
          )
          .run(now, project.id);
      }
      return { id, versionNo };
    })();

    res.status(201).json({
      storyboard: {
        id: saved.id,
        version_no: saved.versionNo,
        shots: body.shots,
        confirmed_at: body.confirm ? now : null,
        created_by: user.id,
        created_at: now,
      },
      project_status: body.confirm ? 'storyboarded' : project.status,
    });
  });

  // ---------- 角色设定（同名 upsert，保持跨分镜一致性） ----------

  router.post('/comic/projects/:id/characters', idempotency, (req, res) => {
    const body = parse(characterBody, req.body);
    const user = req.user!;
    const project = findProject(deps.db, user.id, pathParam(req, 'id'));
    if (!EDITABLE_STATUSES.has(project.status)) {
      throw new AppError('CONFLICT', `project is not editable in status ${project.status}`, {
        status: project.status,
      });
    }

    const now = clockOf(deps);
    const upserted = deps.db.transaction(() => {
      const referenceIds = JSON.stringify(body.reference_asset_ids);
      const existing = deps.db
        .prepare(
          `SELECT * FROM comic_characters
           WHERE project_id = ? AND name = ? AND deleted_at IS NULL`,
        )
        .get(project.id, body.name) as CharacterRow | undefined;

      if (existing) {
        const unchanged =
          existing.appearance_prompt === body.appearance_prompt &&
          existing.seed === (body.seed ?? null) &&
          existing.reference_asset_ids === referenceIds &&
          existing.voice_profile === (body.voice_profile ?? null);
        if (unchanged) return { id: existing.id, created: false };
        deps.db
          .prepare(
            `UPDATE comic_characters
             SET appearance_prompt = ?, seed = ?, reference_asset_ids = ?, voice_profile = ?,
                 version = version + 1, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            body.appearance_prompt,
            body.seed ?? null,
            referenceIds,
            body.voice_profile ?? null,
            now,
            existing.id,
          );
        return { id: existing.id, created: false };
      }

      const id = uuidv7();
      deps.db
        .prepare(
          `INSERT INTO comic_characters
             (id, project_id, name, appearance_prompt, seed, reference_asset_ids, voice_profile,
              version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          id,
          project.id,
          body.name,
          body.appearance_prompt,
          body.seed ?? null,
          referenceIds,
          body.voice_profile ?? null,
          now,
          now,
        );
      return { id, created: true };
    })();

    const row = deps.db
      .prepare('SELECT * FROM comic_characters WHERE id = ?')
      .get(upserted.id) as CharacterRow;
    res.status(upserted.created ? 201 : 200).json({
      character: characterPayload(row),
      created: upserted.created,
    });
  });

  // ---------- AI 建议（人工确认后再落库） ----------

  router.post('/comic/projects/:id/suggest', idempotency, (req, res) => {
    const body = parse(suggestBody, req.body);
    const user = req.user!;
    const project = findProject(deps.db, user.id, pathParam(req, 'id'));
    const now = clockOf(deps);
    const items = buildMockSuggestions(body.kind, project, body.prompt ?? null, body.count);
    res.json({
      suggestion: {
        kind: body.kind,
        model: 'mock-text-suggest',
        generated_at: now,
        requires_confirmation: true,
        items,
      },
    });
  });

  // ---------- 第 2 期：生成任务编排（jobs） ----------

  router.get('/comic/projects/:id/jobs', (req, res) => {
    const user = req.user!;
    const query = parse(listJobsQuery, req.query);
    const project = findProject(deps.db, user.id, pathParam(req, 'id'));
    const conditions = ['project_id = ?'];
    const values: unknown[] = [project.id];
    if (query.status) {
      conditions.push('status = ?');
      values.push(query.status);
    }
    if (query.job_type) {
      conditions.push('job_type = ?');
      values.push(query.job_type);
    }
    values.push(query.limit);
    const rows = deps.db
      .prepare(
        `SELECT * FROM generation_jobs
         WHERE ${conditions.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(...values) as JobRow[];
    res.json({ items: rows.map(jobPayload) });
  });

  router.post('/comic/projects/:id/jobs', idempotency, (req, res) => {
    const body = parse(createJobBody, req.body);
    const user = req.user!;
    const project = findProject(deps.db, user.id, pathParam(req, 'id'));
    // 只有分镜确认（storyboarded）或已在生成中的工程允许派发任务
    if (project.status !== 'storyboarded' && project.status !== 'generating') {
      throw new AppError('CONFLICT', `project is not dispatchable in status ${project.status}`, {
        status: project.status,
      });
    }
    let storyboardId: string | null = null;
    if (body.storyboard_id) {
      const storyboard = deps.db
        .prepare('SELECT id FROM storyboards WHERE id = ? AND project_id = ?')
        .get(body.storyboard_id, project.id) as { id: string } | undefined;
      if (!storyboard) {
        throw new AppError('NOT_FOUND', 'storyboard not found', { storyboard_id: body.storyboard_id });
      }
      storyboardId = storyboard.id;
    }

    const now = clockOf(deps);
    const id = uuidv7();
    const created = deps.db.transaction(() => {
      deps.db
        .prepare(
          `INSERT INTO generation_jobs
             (id, project_id, storyboard_id, job_type, status, retry_of, cost_estimate_minor,
              error_code, payload, result, created_by, created_at, started_at, finished_at)
           VALUES (?, ?, ?, ?, 'queued', NULL, ?, NULL, ?, NULL, ?, ?, NULL, NULL)`,
        )
        .run(
          id,
          project.id,
          storyboardId,
          body.job_type,
          body.cost_estimate_minor ?? null,
          JSON.stringify(body.payload),
          user.id,
          now,
        );
      // 首个任务派发驱动 storyboarded → generating（08 §3.2）
      if (project.status === 'storyboarded') {
        deps.db
          .prepare(
            `UPDATE comic_projects
             SET status = 'generating', version = version + 1, updated_at = ?
             WHERE id = ?`,
          )
          .run(now, project.id);
      }
      return deps.db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(id) as JobRow;
    })();

    res.status(201).json({
      job: jobPayload(created),
      project_status: project.status === 'storyboarded' ? 'generating' : project.status,
    });
  });

  router.get('/comic/jobs/:id', (req, res) => {
    const user = req.user!;
    const job = findJob(deps.db, user.id, pathParam(req, 'id'));
    res.json({ job: jobPayload(job) });
  });

  // 状态迁移由编排控制面驱动（ai-orchestrator 接入后由其消费队列调用）
  router.post('/comic/jobs/:id/start', idempotency, (req, res) => {
    const user = req.user!;
    const job = findJob(deps.db, user.id, pathParam(req, 'id'));
    if (job.status !== 'queued') {
      throw new AppError('CONFLICT', `job is not startable in status ${job.status}`, {
        status: job.status,
      });
    }
    const now = clockOf(deps);
    deps.db
      .prepare(`UPDATE generation_jobs SET status = 'running', started_at = ? WHERE id = ?`)
      .run(now, job.id);
    res.json({ job: jobPayload(findJob(deps.db, user.id, job.id)) });
  });

  router.post('/comic/jobs/:id/complete', idempotency, (req, res) => {
    const body = parse(completeJobBody, req.body ?? {});
    const user = req.user!;
    const job = findJob(deps.db, user.id, pathParam(req, 'id'));
    if (job.status !== 'running') {
      throw new AppError('CONFLICT', `job is not completable in status ${job.status}`, {
        status: job.status,
      });
    }
    const now = clockOf(deps);
    deps.db.transaction(() => {
      deps.db
        .prepare(
          `UPDATE generation_jobs SET status = 'succeeded', result = ?, finished_at = ? WHERE id = ?`,
        )
        .run(JSON.stringify(body.result), now, job.id);
      // 骨架口径：compose 任务成功即视为合成完成，工程 generating → rendered
      //（08 §3.2 的 generation_assets 分镜全覆盖校验随资产表接入后收紧）
      if (job.job_type === 'compose') {
        deps.db
          .prepare(
            `UPDATE comic_projects
             SET status = 'rendered', version = version + 1, updated_at = ?
             WHERE id = ? AND status = 'generating'`,
          )
          .run(now, job.project_id);
      }
    })();
    res.json({ job: jobPayload(findJob(deps.db, user.id, job.id)) });
  });

  router.post('/comic/jobs/:id/fail', idempotency, (req, res) => {
    const body = parse(failJobBody, req.body);
    const user = req.user!;
    const job = findJob(deps.db, user.id, pathParam(req, 'id'));
    if (job.status !== 'running') {
      throw new AppError('CONFLICT', `job is not failable in status ${job.status}`, {
        status: job.status,
      });
    }
    const now = clockOf(deps);
    deps.db
      .prepare(
        `UPDATE generation_jobs SET status = 'failed', error_code = ?, finished_at = ? WHERE id = ?`,
      )
      .run(body.error_code, now, job.id);
    res.json({ job: jobPayload(findJob(deps.db, user.id, job.id)) });
  });

  router.post('/comic/jobs/:id/cancel', idempotency, (req, res) => {
    const user = req.user!;
    const job = findJob(deps.db, user.id, pathParam(req, 'id'));
    if (job.status !== 'queued' && job.status !== 'running') {
      throw new AppError('CONFLICT', `job is not cancelable in status ${job.status}`, {
        status: job.status,
      });
    }
    const now = clockOf(deps);
    deps.db
      .prepare(`UPDATE generation_jobs SET status = 'canceled', finished_at = ? WHERE id = ?`)
      .run(now, job.id);
    res.json({ job: jobPayload(findJob(deps.db, user.id, job.id)) });
  });

  // 失败重试：新建 job（retry_of 指向原 job），历史 job 永不覆盖
  router.post('/comic/jobs/:id/retry', idempotency, (req, res) => {
    const user = req.user!;
    const job = findJob(deps.db, user.id, pathParam(req, 'id'));
    if (job.status !== 'failed') {
      throw new AppError('CONFLICT', `only failed job can be retried, current status ${job.status}`, {
        status: job.status,
      });
    }
    const now = clockOf(deps);
    const id = uuidv7();
    deps.db
      .prepare(
        `INSERT INTO generation_jobs
           (id, project_id, storyboard_id, job_type, status, retry_of, cost_estimate_minor,
            error_code, payload, result, created_by, created_at, started_at, finished_at)
         VALUES (?, ?, ?, ?, 'queued', ?, ?, NULL, ?, NULL, ?, ?, NULL, NULL)`,
      )
      .run(
        id,
        job.project_id,
        job.storyboard_id,
        job.job_type,
        job.id,
        job.cost_estimate_minor,
        job.payload,
        user.id,
        now,
      );
    res.status(201).json({ job: jobPayload(findJob(deps.db, user.id, id)) });
  });

  // ---------- 第 2 期：成片合成（films） ----------

  router.get('/comic/projects/:id/films', (req, res) => {
    const user = req.user!;
    const query = parse(listFilmsQuery, req.query);
    const project = findProject(deps.db, user.id, pathParam(req, 'id'));
    const rows = query.status
      ? deps.db
          .prepare(
            `SELECT * FROM comic_films
             WHERE project_id = ? AND status = ? AND deleted_at IS NULL
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(project.id, query.status, query.limit)
      : deps.db
          .prepare(
            `SELECT * FROM comic_films
             WHERE project_id = ? AND deleted_at IS NULL
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(project.id, query.limit);
    res.json({ items: (rows as FilmRow[]).map(filmPayload) });
  });

  // 合成成片：工程须已进入 rendered（compose 任务成功），创建 draft 成片 + 首个版本
  router.post('/comic/projects/:id/films', idempotency, (req, res) => {
    const body = parse(createFilmBody, req.body);
    const user = req.user!;
    const project = findProject(deps.db, user.id, pathParam(req, 'id'));
    if (project.status !== 'rendered' && project.status !== 'published') {
      throw new AppError('CONFLICT', `project is not composable in status ${project.status}`, {
        status: project.status,
      });
    }

    const now = clockOf(deps);
    const filmId = uuidv7();
    const versionId = uuidv7();
    const film = deps.db.transaction(() => {
      deps.db
        .prepare(
          `INSERT INTO comic_films
             (id, project_id, title, status, current_version_id, review_note, version,
              created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, 'draft', NULL, NULL, 1, ?, ?, NULL)`,
        )
        .run(filmId, project.id, body.title, now, now);
      deps.db
        .prepare(
          `INSERT INTO film_versions
             (id, film_id, version_no, object_key, duration_sec, size_bytes, published_at,
              created_by, created_at)
           VALUES (?, ?, 1, ?, ?, ?, NULL, ?, ?)`,
        )
        .run(
          versionId,
          filmId,
          body.object_key ?? null,
          body.duration_sec ?? null,
          body.size_bytes ?? null,
          user.id,
          now,
        );
      return deps.db.prepare('SELECT * FROM comic_films WHERE id = ?').get(filmId) as FilmRow;
    })();

    const version = deps.db
      .prepare('SELECT * FROM film_versions WHERE id = ?')
      .get(versionId) as FilmVersionRow;
    res.status(201).json({ film: filmPayload(film), version: filmVersionPayload(version) });
  });

  router.get('/comic/films/:id', (req, res) => {
    const user = req.user!;
    const film = findFilm(deps.db, user.id, pathParam(req, 'id'));
    const versions = deps.db
      .prepare('SELECT * FROM film_versions WHERE film_id = ? ORDER BY version_no')
      .all(film.id) as FilmVersionRow[];
    res.json({ film: filmPayload(film), versions: versions.map(filmVersionPayload) });
  });

  // 追加新版本：版本只追加不覆盖；published 发新版后回到 draft 待重审
  router.post('/comic/films/:id/versions', idempotency, (req, res) => {
    const body = parse(filmVersionBody, req.body);
    const user = req.user!;
    const film = findFilm(deps.db, user.id, pathParam(req, 'id'));
    if (film.status === 'archived') {
      throw new AppError('CONFLICT', 'archived film cannot accept new versions', {
        status: film.status,
      });
    }

    const now = clockOf(deps);
    const saved = deps.db.transaction(() => {
      const latest = deps.db
        .prepare('SELECT MAX(version_no) AS max_version FROM film_versions WHERE film_id = ?')
        .get(film.id) as { max_version: number | null };
      const versionNo = (latest.max_version ?? 0) + 1;
      const id = uuidv7();
      deps.db
        .prepare(
          `INSERT INTO film_versions
             (id, film_id, version_no, object_key, duration_sec, size_bytes, published_at,
              created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .run(
          id,
          film.id,
          versionNo,
          body.object_key ?? null,
          body.duration_sec ?? null,
          body.size_bytes ?? null,
          user.id,
          now,
        );
      if (film.status === 'published') {
        deps.db
          .prepare(
            `UPDATE comic_films
             SET status = 'draft', review_note = NULL, version = version + 1, updated_at = ?
             WHERE id = ?`,
          )
          .run(now, film.id);
      }
      return { id, versionNo };
    })();

    const version = deps.db
      .prepare('SELECT * FROM film_versions WHERE id = ?')
      .get(saved.id) as FilmVersionRow;
    res.status(201).json({ version: filmVersionPayload(version) });
  });

  // 提交审核：draft → reviewing；最新版本须已登记 object_key（成片产物归属对象存储）
  router.post('/comic/films/:id/submit-review', idempotency, (req, res) => {
    const user = req.user!;
    const film = findFilm(deps.db, user.id, pathParam(req, 'id'));
    if (film.status !== 'draft') {
      throw new AppError('CONFLICT', `film is not submittable in status ${film.status}`, {
        status: film.status,
      });
    }
    const latest = deps.db
      .prepare(
        'SELECT * FROM film_versions WHERE film_id = ? ORDER BY version_no DESC LIMIT 1',
      )
      .get(film.id) as FilmVersionRow | undefined;
    if (!latest || !latest.object_key) {
      throw new AppError('CONFLICT', 'latest film version has no object_key', { film_id: film.id });
    }
    const now = clockOf(deps);
    deps.db
      .prepare(
        `UPDATE comic_films
         SET status = 'reviewing', version = version + 1, updated_at = ?
         WHERE id = ?`,
      )
      .run(now, film.id);
    res.json({ film: filmPayload(findFilm(deps.db, user.id, film.id)) });
  });

  // 发布：reviewing → published；current_version_id 指向最新版本并记录 published_at
  router.post('/comic/films/:id/publish', idempotency, (req, res) => {
    const user = req.user!;
    const film = findFilm(deps.db, user.id, pathParam(req, 'id'));
    if (film.status !== 'reviewing') {
      throw new AppError('CONFLICT', `film is not publishable in status ${film.status}`, {
        status: film.status,
      });
    }
    const latest = deps.db
      .prepare(
        'SELECT * FROM film_versions WHERE film_id = ? ORDER BY version_no DESC LIMIT 1',
      )
      .get(film.id) as FilmVersionRow;
    const now = clockOf(deps);
    deps.db.transaction(() => {
      deps.db
        .prepare(
          `UPDATE comic_films
           SET status = 'published', current_version_id = ?, review_note = NULL,
               version = version + 1, updated_at = ?
           WHERE id = ?`,
        )
        .run(latest.id, now, film.id);
      deps.db
        .prepare('UPDATE film_versions SET published_at = ? WHERE id = ?')
        .run(now, latest.id);
      deps.db
        .prepare(
          `UPDATE comic_projects
           SET status = 'published', version = version + 1, updated_at = ?
           WHERE id = ? AND status = 'rendered'`,
        )
        .run(now, film.project_id);
    })();
    res.json({ film: filmPayload(findFilm(deps.db, user.id, film.id)) });
  });

  // 驳回：reviewing → draft，留原因（08 §3.2）
  router.post('/comic/films/:id/reject', idempotency, (req, res) => {
    const body = parse(rejectFilmBody, req.body);
    const user = req.user!;
    const film = findFilm(deps.db, user.id, pathParam(req, 'id'));
    if (film.status !== 'reviewing') {
      throw new AppError('CONFLICT', `film is not rejectable in status ${film.status}`, {
        status: film.status,
      });
    }
    const now = clockOf(deps);
    deps.db
      .prepare(
        `UPDATE comic_films
         SET status = 'draft', review_note = ?, version = version + 1, updated_at = ?
         WHERE id = ?`,
      )
      .run(body.reason, now, film.id);
    res.json({ film: filmPayload(findFilm(deps.db, user.id, film.id)) });
  });

  // 归档：draft / reviewing / published → archived（终态）
  router.post('/comic/films/:id/archive', idempotency, (req, res) => {
    const user = req.user!;
    const film = findFilm(deps.db, user.id, pathParam(req, 'id'));
    if (film.status === 'archived') {
      throw new AppError('CONFLICT', 'film is already archived', { status: film.status });
    }
    const now = clockOf(deps);
    deps.db
      .prepare(
        `UPDATE comic_films
         SET status = 'archived', version = version + 1, updated_at = ?
         WHERE id = ?`,
      )
      .run(now, film.id);
    res.json({ film: filmPayload(findFilm(deps.db, user.id, film.id)) });
  });

  return router;
}
