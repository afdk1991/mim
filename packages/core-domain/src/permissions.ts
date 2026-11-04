/**
 * 权限矩阵（FR-03 §5.5 基础协作）。
 * 角色两档：编辑（editor）/ 只读（viewer）；项目创建者为 owner。
 */

import { AppError } from './errors.js';
import type { PlanFeatures } from './plans.js';

export type ProjectRole = 'owner' | 'editor' | 'viewer';

export type Action =
  | 'project:read'
  | 'project:update'
  | 'project:archive'
  | 'project:delete'
  | 'member:manage'
  | 'task:read'
  | 'task:write'
  | 'task:delete'
  | 'export:create';

export const ROLE_MATRIX: Record<ProjectRole, Action[]> = {
  owner: [
    'project:read',
    'project:update',
    'project:archive',
    'project:delete',
    'member:manage',
    'task:read',
    'task:write',
    'task:delete',
    'export:create',
  ],
  editor: ['project:read', 'task:read', 'task:write', 'task:delete', 'export:create'],
  viewer: ['project:read', 'task:read'],
};

export function can(role: ProjectRole, action: Action): boolean {
  return ROLE_MATRIX[role].includes(action);
}

export function assertCan(role: ProjectRole, action: Action): void {
  if (!can(role, action)) {
    throw new AppError('FORBIDDEN', `role ${role} cannot perform ${action}`, { role, action });
  }
}

/** 项目数配额：免费版 3 个项目，其余不限额 */
export function canCreateProject(features: PlanFeatures, currentCount: number): boolean {
  return features.projectsLimit < 0 || currentCount < features.projectsLimit;
}

/** 协作者配额：不含 owner；基础版 3 人、专业版不限额、免费版 0 人 */
export function canInviteCollaborator(features: PlanFeatures, activeCollaborators: number): boolean {
  return features.collaboratorsLimit < 0 || activeCollaborators < features.collaboratorsLimit;
}
