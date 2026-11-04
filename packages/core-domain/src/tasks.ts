/**
 * 任务领域规则（FR-03）：
 * - 固定两级：项目 → 任务（level 1）→ 子任务（level 2），子任务不得再有子任务。
 * - 状态仅 todo ⇄ done。
 * - 多端同步冲突裁决：先比 client_updated_at（LWW），同值再比 seq。
 */

import { AppError } from './errors.js';

export type TaskStatus = 'todo' | 'done';
export type TaskLevel = 1 | 2;

export const TASK_TITLE_MAX = 200;
export const TASK_DESCRIPTION_MAX = 5000;

export interface TaskSyncStamp {
  clientUpdatedAt: string;
  seq: number;
}

export function normalizeTaskTitle(title: string): string {
  return title.trim();
}

export function assertTaskTitle(title: string): string {
  const normalized = normalizeTaskTitle(title);
  if (normalized.length === 0 || normalized.length > TASK_TITLE_MAX) {
    throw new AppError('VALIDATION_FAILED', `task title must be 1-${TASK_TITLE_MAX} characters`, {
      field: 'title',
    });
  }
  return normalized;
}

/** 依据父任务层级推断新任务层级 */
export function resolveTaskLevel(parentLevel: TaskLevel | null): TaskLevel {
  if (parentLevel === null) return 1;
  if (parentLevel === 1) return 2;
  throw new AppError('TASK_PARENT_INVALID', 'subtask cannot have children (two-level limit)');
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (from === to) return;
  if (!(from === 'todo' && to === 'done') && !(from === 'done' && to === 'todo')) {
    throw new AppError('TASK_STATUS_INVALID', `task transition ${from} -> ${to} is not allowed`);
  }
}

/**
 * LWW 冲突裁决：入站写入是否应覆盖服务端当前值。
 * 同时刻（client_updated_at 相同）时以服务端 seq 较大者为准，入站写入总是携带更大的新 seq。
 */
export function resolveConflict(incoming: TaskSyncStamp, current: TaskSyncStamp): 'accept' | 'reject' {
  const incomingAt = Date.parse(incoming.clientUpdatedAt);
  const currentAt = Date.parse(current.clientUpdatedAt);
  if (Number.isNaN(incomingAt) || Number.isNaN(currentAt)) {
    throw new AppError('VALIDATION_FAILED', 'client_updated_at must be an ISO-8601 timestamp');
  }
  if (incomingAt > currentAt) return 'accept';
  if (incomingAt < currentAt) return 'reject';
  return incoming.seq >= current.seq ? 'accept' : 'reject';
}
