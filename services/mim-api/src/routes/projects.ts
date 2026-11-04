/** FR-03 工作区：项目、成员与邀请 */

import { Router } from 'express';
import { z } from 'zod';
import {
  AppError,
  canCreateProject,
  canInviteCollaborator,
  uuidv7,
} from '@mim/core-domain';
import { normalizeIdentity, newOpaqueToken } from '../auth.js';
import { INVITATION_TTL_DAYS } from '../config.js';
import {
  assertProjectAccess,
  clockOf,
  countActiveCollaborators,
  countOwnedProjects,
  effectivePlan,
  getProjectRow,
  writeAudit,
} from '../domain.js';
import { idempotency, requireAuth } from '../middleware.js';
import { parse } from '../validate.js';
import { addDays, pathParam } from '../utils.js';
import { appendTaskEvent } from './tasks.js';
import type { TaskRow } from './tasks.js';
import type { ApiDeps } from '../types.js';

const projectCreateBody = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(2000).optional(),
});

const projectPatchBody = z
  .object({
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(2000).optional(),
    version: z.number().int().positive(),
  })
  .refine((value) => value.name !== undefined || value.description !== undefined, {
    message: 'at least one field is required',
  });

const invitationBody = z.object({
  provider: z.enum(['phone', 'email']),
  identifier: z.string().min(1),
  role: z.enum(['editor', 'viewer']).default('editor'),
});

interface ProjectListRow {
  id: string;
  name: string;
  description: string;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
  role: string;
}

interface InvitationRow {
  id: string;
  project_id: string;
  inviter_user_id: string;
  region: string;
  provider: 'phone' | 'email';
  identifier: string;
  role: 'editor' | 'viewer';
  token: string;
  status: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

function projectPayload(row: {
  id: string;
  name: string;
  description: string;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
}, role: string) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    role,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function invitationPayload(row: InvitationRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    region: row.region,
    provider: row.provider,
    identifier: row.identifier,
    role: row.role,
    token: row.token,
    status: row.status,
    expires_at: row.expires_at,
    accepted_at: row.accepted_at,
    created_at: row.created_at,
  };
}

export function createProjectsRouter(deps: ApiDeps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/projects', (req, res) => {
    const rows = deps.db
      .prepare(
        `SELECT p.id, p.name, p.description, p.status, p.version, p.created_at, p.updated_at, m.role
         FROM projects p
         JOIN project_members m ON m.project_id = p.id
         WHERE m.user_id = ? AND m.status = 'active' AND p.status <> 'deleted'
         ORDER BY p.updated_at DESC`,
      )
      .all(req.user!.id) as ProjectListRow[];
    res.json({ items: rows.map((row) => projectPayload(row, row.role)) });
  });

  router.post('/projects', idempotency, (req, res) => {
    const body = parse(projectCreateBody, req.body);
    const user = req.user!;
    const now = clockOf(deps);
    const plan = effectivePlan(deps.db, user.id, now);
    if (!canCreateProject(plan.features, countOwnedProjects(deps.db, user.id))) {
      throw new AppError('QUOTA_PROJECTS_EXCEEDED', 'project limit reached for the current plan', {
        limit: plan.features.projectsLimit,
      });
    }

    const projectId = uuidv7();
    deps.db.transaction(() => {
      deps.db
        .prepare(
          `INSERT INTO projects (id, user_id, region, name, description, status, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
        )
        .run(projectId, user.id, user.region, body.name.trim(), body.description ?? '', now, now);
      deps.db
        .prepare(
          `INSERT INTO project_members (id, project_id, user_id, role, status, created_at, updated_at)
           VALUES (?, ?, ?, 'owner', 'active', ?, ?)`,
        )
        .run(uuidv7(), projectId, user.id, now, now);
    })();

    writeAudit(deps.db, {
      userId: user.id,
      region: user.region,
      action: 'project.create',
      target: projectId,
      requestId: req.requestId,
      payload: { name: body.name },
      createdAt: now,
    });

    const row = deps.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    res.status(201).json({ project: projectPayload(row as never, 'owner') });
  });

  router.get('/projects/:projectId', (req, res) => {
    const { project, role } = assertProjectAccess(
      deps.db,
      pathParam(req, 'projectId'),
      req.user!.id,
      'project:read',
    );
    res.json({ project: projectPayload(project, role) });
  });

  router.patch('/projects/:projectId', idempotency, (req, res) => {
    const body = parse(projectPatchBody, req.body);
    const user = req.user!;
    const now = clockOf(deps);
    assertProjectAccess(deps.db, pathParam(req, 'projectId'), user.id, 'project:update');

    const sets: string[] = [];
    const values: unknown[] = [];
    if (body.name !== undefined) {
      sets.push('name = ?');
      values.push(body.name.trim());
    }
    if (body.description !== undefined) {
      sets.push('description = ?');
      values.push(body.description);
    }
    sets.push('version = version + 1', 'updated_at = ?');
    values.push(now, pathParam(req, 'projectId'), body.version);

    const result = deps.db
      .prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ? AND version = ? AND status <> 'deleted'`)
      .run(...values);
    if (result.changes === 0) throw new AppError('CONFLICT', 'project was modified, refresh and retry');

    writeAudit(deps.db, {
      userId: user.id,
      region: user.region,
      action: 'project.update',
      target: pathParam(req, 'projectId'),
      requestId: req.requestId,
      payload: body,
      createdAt: now,
    });

    const row = getProjectRow(deps.db, pathParam(req, 'projectId'))!;
    const role = assertProjectAccess(deps.db, pathParam(req, 'projectId'), user.id, 'project:read').role;
    res.json({ project: projectPayload(row, role) });
  });

  router.post('/projects/:projectId/archive', idempotency, (req, res) => {
    const user = req.user!;
    const now = clockOf(deps);
    assertProjectAccess(deps.db, pathParam(req, 'projectId'), user.id, 'project:archive');
    deps.db
      .prepare(
        `UPDATE projects SET status = 'archived', version = version + 1, updated_at = ?
         WHERE id = ? AND status = 'active'`,
      )
      .run(now, pathParam(req, 'projectId'));
    writeAudit(deps.db, {
      userId: user.id,
      region: user.region,
      action: 'project.archive',
      target: pathParam(req, 'projectId'),
      requestId: req.requestId,
      createdAt: now,
    });
    const row = getProjectRow(deps.db, pathParam(req, 'projectId'))!;
    res.json({ project: projectPayload(row, 'owner') });
  });

  router.delete('/projects/:projectId', idempotency, (req, res) => {
    const user = req.user!;
    const now = clockOf(deps);
    const projectId = pathParam(req, 'projectId');
    assertProjectAccess(deps.db, projectId, user.id, 'project:delete');

    // 两级删除：项目 → 全部一级任务 → 全部二级子任务，均在事务内软删并写同步事件
    const targets = deps.db
      .prepare(
        `SELECT * FROM tasks WHERE project_id = ? AND deleted_at IS NULL
         ORDER BY level, created_at`,
      )
      .all(projectId) as TaskRow[];
    const cascaded_tasks = targets.filter((row) => row.level === 1).length;
    const cascaded_subtasks = targets.length - cascaded_tasks;

    deps.db.transaction(() => {
      for (const row of targets) {
        const seq = appendTaskEvent(
          deps.db,
          row,
          'deleted',
          { task_id: row.id, cascade: 'project.delete' },
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
      deps.db
        .prepare(
          `UPDATE projects SET status = 'deleted', deleted_at = ?, version = version + 1, updated_at = ?
           WHERE id = ?`,
        )
        .run(now, now, projectId);
    })();

    writeAudit(deps.db, {
      userId: user.id,
      region: user.region,
      action: 'project.delete',
      target: projectId,
      requestId: req.requestId,
      payload: { cascaded_tasks, cascaded_subtasks },
      createdAt: now,
    });
    res.json({ status: 'deleted', id: projectId, cascaded_tasks, cascaded_subtasks });
  });

  router.get('/projects/:projectId/members', (req, res) => {
    assertProjectAccess(deps.db, pathParam(req, 'projectId'), req.user!.id, 'project:read');
    const rows = deps.db
      .prepare(
        `SELECT m.user_id, m.role, m.status, m.created_at, u.display_name, u.region
         FROM project_members m
         JOIN users u ON u.id = m.user_id
         WHERE m.project_id = ? AND m.status = 'active'
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, m.created_at`,
      )
      .all(pathParam(req, 'projectId')) as Array<{
      user_id: string;
      role: string;
      status: string;
      created_at: string;
      display_name: string;
      region: string;
    }>;
    res.json({
      items: rows.map((row) => ({
        user_id: row.user_id,
        role: row.role,
        display_name: row.display_name,
        region: row.region,
        created_at: row.created_at,
      })),
    });
  });

  router.get('/projects/:projectId/invitations', (req, res) => {
    assertProjectAccess(deps.db, pathParam(req, 'projectId'), req.user!.id, 'member:manage');
    const rows = deps.db
      .prepare('SELECT * FROM project_invitations WHERE project_id = ? ORDER BY created_at DESC')
      .all(pathParam(req, 'projectId')) as InvitationRow[];
    res.json({ items: rows.map(invitationPayload) });
  });

  router.post('/projects/:projectId/invitations', idempotency, (req, res) => {
    const body = parse(invitationBody, req.body);
    const user = req.user!;
    const now = clockOf(deps);
    const { project } = assertProjectAccess(deps.db, pathParam(req, 'projectId'), user.id, 'member:manage');

    const plan = effectivePlan(deps.db, user.id, now);
    if (!canInviteCollaborator(plan.features, countActiveCollaborators(deps.db, project.id))) {
      throw new AppError('QUOTA_COLLABORATORS_EXCEEDED', 'collaborator limit reached for the current plan', {
        limit: plan.features.collaboratorsLimit,
      });
    }

    const identity = normalizeIdentity(project.region as 'cn' | 'global', body.provider, body.identifier);
    const expiresAt = addDays(now, INVITATION_TTL_DAYS);
    const invitationId = uuidv7();
    deps.db
      .prepare(
        `INSERT INTO project_invitations
           (id, project_id, inviter_user_id, region, provider, identifier, role, token, status,
            expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(
        invitationId,
        project.id,
        user.id,
        project.region,
        identity.provider,
        identity.identifier,
        body.role,
        newOpaqueToken(),
        expiresAt,
        now,
      );

    writeAudit(deps.db, {
      userId: user.id,
      region: user.region,
      action: 'member.invite',
      target: project.id,
      requestId: req.requestId,
      payload: { provider: identity.provider, identifier: identity.identifier, role: body.role },
      createdAt: now,
    });

    const row = deps.db
      .prepare('SELECT * FROM project_invitations WHERE id = ?')
      .get(invitationId) as InvitationRow;
    res.status(201).json({ invitation: invitationPayload(row) });
  });

  router.delete('/projects/:projectId/invitations/:invitationId', idempotency, (req, res) => {
    const user = req.user!;
    const now = clockOf(deps);
    assertProjectAccess(deps.db, pathParam(req, 'projectId'), user.id, 'member:manage');
    const row = deps.db
      .prepare('SELECT * FROM project_invitations WHERE id = ? AND project_id = ?')
      .get(pathParam(req, 'invitationId'), pathParam(req, 'projectId')) as InvitationRow | undefined;
    if (!row) throw new AppError('INVITATION_NOT_FOUND', 'invitation not found');
    if (row.status !== 'pending') {
      throw new AppError('INVITATION_INVALID', `invitation is already ${row.status}`);
    }
    deps.db
      .prepare(`UPDATE project_invitations SET status = 'revoked' WHERE id = ?`)
      .run(pathParam(req, 'invitationId'));
    res.json({ status: 'revoked', id: pathParam(req, 'invitationId') });
  });

  router.post('/invitations/:token/accept', idempotency, (req, res) => {
    const user = req.user!;
    const now = clockOf(deps);
    const row = deps.db
      .prepare('SELECT * FROM project_invitations WHERE token = ?')
      .get(pathParam(req, 'token')) as InvitationRow | undefined;
    if (!row) throw new AppError('INVITATION_NOT_FOUND', 'invitation not found');
    if (row.status !== 'pending') {
      throw new AppError('INVITATION_INVALID', `invitation is already ${row.status}`);
    }
    if (Date.parse(row.expires_at) <= Date.parse(now)) {
      deps.db.prepare(`UPDATE project_invitations SET status = 'expired' WHERE id = ?`).run(row.id);
      throw new AppError('INVITATION_EXPIRED', 'invitation expired');
    }
    if (row.region !== user.region) {
      throw new AppError('ACCOUNT_REGION_MISMATCH', 'invitation belongs to another region', {
        invitation_region: row.region,
      });
    }
    const identity = deps.db
      .prepare(
        `SELECT user_id FROM identities WHERE region = ? AND provider = ? AND identifier = ?`,
      )
      .get(row.region, row.provider, row.identifier) as { user_id: string } | undefined;
    if (!identity || identity.user_id !== user.id) {
      throw new AppError('INVITATION_INVALID', 'invitation was not issued for this account');
    }

    deps.db.transaction(() => {
      deps.db
        .prepare(
          `INSERT INTO project_members (id, project_id, user_id, role, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', ?, ?)
           ON CONFLICT(project_id, user_id) DO UPDATE SET
             role = excluded.role,
             status = 'active',
             updated_at = excluded.updated_at`,
        )
        .run(uuidv7(), row.project_id, user.id, row.role, now, now);
      deps.db
        .prepare(`UPDATE project_invitations SET status = 'accepted', accepted_at = ? WHERE id = ?`)
        .run(now, row.id);
    })();

    writeAudit(deps.db, {
      userId: user.id,
      region: user.region,
      action: 'member.accept',
      target: row.project_id,
      requestId: req.requestId,
      payload: { invitation_id: row.id, role: row.role },
      createdAt: now,
    });

    res.json({ project_id: row.project_id, role: row.role });
  });

  router.delete('/projects/:projectId/members/:userId', idempotency, (req, res) => {
    const user = req.user!;
    const now = clockOf(deps);
    assertProjectAccess(deps.db, pathParam(req, 'projectId'), user.id, 'member:manage');

    const member = deps.db
      .prepare(
        `SELECT * FROM project_members WHERE project_id = ? AND user_id = ? AND status = 'active'`,
      )
      .get(pathParam(req, 'projectId'), pathParam(req, 'userId')) as
      | { id: string; role: string }
      | undefined;
    if (!member) throw new AppError('MEMBER_NOT_FOUND', 'member not found');
    if (member.role === 'owner') {
      const owners = deps.db
        .prepare(
          `SELECT COUNT(*) AS n FROM project_members
           WHERE project_id = ? AND role = 'owner' AND status = 'active'`,
        )
        .get(pathParam(req, 'projectId')) as { n: number };
      if (owners.n <= 1) throw new AppError('MEMBER_LAST_OWNER', 'project must keep at least one owner');
    }

    deps.db
      .prepare(`UPDATE project_members SET status = 'removed', updated_at = ? WHERE id = ?`)
      .run(now, member.id);
    writeAudit(deps.db, {
      userId: user.id,
      region: user.region,
      action: 'member.remove',
      target: pathParam(req, 'projectId'),
      requestId: req.requestId,
      payload: { removed_user_id: pathParam(req, 'userId') },
      createdAt: now,
    });
    res.json({ status: 'removed', user_id: pathParam(req, 'userId') });
  });

  return router;
}
