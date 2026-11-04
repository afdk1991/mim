/**
 * 第 1 期：AI 辅助创作工作台（07 §12.1、08 §3.2）
 *
 * 交付物是「创作工程」而非成片：
 * 剧本 / 分镜 / 角色设定 / 对白 / 配音均由 AI 建议，人工确认后再导出素材。
 * 生成成片（generation_jobs / media）属于第 2 期，本路由不涉及。
 */

import { Router } from 'express';
import { z } from 'zod';
import { AppError, uuidv7 } from '@mim/core-domain';
import { clockOf, writeAudit } from '../domain.js';
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
    writeAudit(deps.db, {
      userId: user.id,
      region: user.region,
      action: 'comic.project_created',
      target: id,
      requestId: req.requestId,
      payload: { title: body.title },
      createdAt: now,
    });
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

    writeAudit(deps.db, {
      userId: user.id,
      region: user.region,
      action: 'comic.project_updated',
      target: project.id,
      requestId: req.requestId,
      payload: { fields: Object.keys(body).filter((key) => key !== 'version') },
      createdAt: now,
    });
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
    writeAudit(deps.db, {
      userId: user.id,
      region: user.region,
      action: 'comic.project_deleted',
      target: project.id,
      requestId: req.requestId,
      payload: { title: project.title },
      createdAt: now,
    });
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

    writeAudit(deps.db, {
      userId: user.id,
      region: user.region,
      action: 'comic.storyboard_saved',
      target: project.id,
      requestId: req.requestId,
      payload: { version_no: saved.versionNo, confirmed: body.confirm, shots: body.shots.length },
      createdAt: now,
    });

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

    writeAudit(deps.db, {
      userId: user.id,
      region: user.region,
      action: 'comic.character_upserted',
      target: project.id,
      requestId: req.requestId,
      payload: { character_id: upserted.id, name: body.name, created: upserted.created },
      createdAt: now,
    });

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
    writeAudit(deps.db, {
      userId: user.id,
      region: user.region,
      action: 'comic.suggestion_generated',
      target: project.id,
      requestId: req.requestId,
      payload: { kind: body.kind, count: body.count, model: 'mock-text-suggest' },
      createdAt: now,
    });
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

  return router;
}
