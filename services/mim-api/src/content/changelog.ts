/**
 * 更新日志业务函数：公开列表按语义版本倒序 + 时间倒序，按版本聚合视图，管理端 CRUD。
 * 版本排序走 semver 库；无法解析为语义版本的条目回落字典序并排在可解析版本之后。
 */

import semver from 'semver'; // 语义版本比较：成熟库而非手写正则
import { AppError, uuidv7 } from '@mim/core-domain'; // 统一业务异常 + 时间有序主键
import type { Db } from '../types.js'; // 数据库连接类型

/** 更新日志行（库内完整字段子集） */
export interface ChangelogRow {
  id: string;
  version: string;
  title: string;
  body: string;
  changes: string; // JSON 字符串数组
  published_at: string | null;
  status: 'draft' | 'published' | 'archived';
  created_at: string;
  updated_at: string;
}

/** 公开列表条目（冻结契约：id / version / title / body / published_at） */
export interface PublicChangelogEntry {
  id: string;
  version: string;
  title: string;
  body: string;
  published_at: string | null;
}

/** 按版本聚合视图条目 */
export interface ChangelogVersionGroup {
  version: string;
  title: string;
  published_at: string | null;
  latest_id: string;
  entry_count: number;
}

/** 新建 / 更新入参 */
export interface ChangelogInput {
  version: string;
  title: string;
  body: string;
  changes: string[];
  published_at: string | null;
  status: 'draft' | 'published' | 'archived';
}

export type ChangelogPatch = Partial<ChangelogInput>;

/** 语义版本比较：返回 -1/0/1；非法版本回落字典序，且排在合法版本之后。 */
function compareVersion(a: string, b: string): number {
  const pa = semver.coerce(a);
  const pb = semver.coerce(b);
  if (pa && pb) return semver.compare(pa, pb);
  if (pa) return 1; // a 合法 b 非法：a 排后（倒序时 b 在前）
  if (pb) return -1;
  return a.localeCompare(b); // 都非法：字典序兜底
}

/** 公开视图映射。 */
function toPublic(row: ChangelogRow): PublicChangelogEntry {
  return { id: row.id, version: row.version, title: row.title, body: row.body, published_at: row.published_at };
}

/** 公开更新日志：只回已发布；先按语义版本倒序，同版本内按发布时间倒序。 */
export function listPublicChangelog(db: Db, limit: number): PublicChangelogEntry[] {
  const rows = db
    .prepare("SELECT * FROM changelog_entries WHERE status = 'published' ORDER BY published_at DESC, id DESC")
    .all() as ChangelogRow[];
  rows.sort((a, b) => {
    const byVersion = compareVersion(b.version, a.version); // 版本倒序
    if (byVersion !== 0) return byVersion;
    return (b.published_at ?? '').localeCompare(a.published_at ?? ''); // 同版本时间倒序
  });
  return rows.slice(0, limit).map(toPublic);
}

/** 按版本聚合视图：每个版本取最新一条作为代表，附条目数；版本倒序。 */
export function aggregateChangelogByVersion(db: Db): ChangelogVersionGroup[] {
  const rows = db
    .prepare("SELECT * FROM changelog_entries WHERE status = 'published' ORDER BY published_at DESC, id DESC")
    .all() as ChangelogRow[];
  const groups = new Map<string, ChangelogVersionGroup>(); // 版本号 → 聚合条目
  for (const row of rows) {
    const existing = groups.get(row.version);
    if (!existing) {
      groups.set(row.version, {
        version: row.version,
        title: row.title,
        published_at: row.published_at,
        latest_id: row.id,
        entry_count: 1,
      });
    } else {
      existing.entry_count += 1; // 同版本追加条目计数（列表已按时间倒序，首条即最新）
    }
  }
  return [...groups.values()].sort((a, b) => compareVersion(b.version, a.version));
}

/** 管理端列表：全量状态，按版本倒序 + 时间倒序。 */
export function listAdminChangelog(db: Db): ChangelogRow[] {
  const rows = db.prepare('SELECT * FROM changelog_entries ORDER BY created_at DESC, id DESC').all() as ChangelogRow[];
  rows.sort((a, b) => {
    const byVersion = compareVersion(b.version, a.version);
    if (byVersion !== 0) return byVersion;
    return (b.published_at ?? '').localeCompare(a.published_at ?? '');
  });
  return rows;
}

/** 按主键取单行；不存在抛 NOT_FOUND。 */
export function getChangelogEntry(db: Db, id: string): ChangelogRow {
  const row = db.prepare('SELECT * FROM changelog_entries WHERE id = ?').get(id) as ChangelogRow | undefined;
  if (!row) throw new AppError('NOT_FOUND', '更新日志不存在');
  return row;
}

/** 校验版本号未被其它条目占用；excludeId 用于更新时排除自身。 */
function assertVersionFree(db: Db, version: string, excludeId?: string): void {
  const row = db.prepare('SELECT id FROM changelog_entries WHERE version = ?').get(version) as { id: string } | undefined;
  if (row && row.id !== excludeId) {
    throw new AppError('CONFLICT', '该版本号已存在更新日志', { version });
  }
}

/** 新建更新日志。 */
export function createChangelogEntry(db: Db, input: ChangelogInput, now: string): ChangelogRow {
  assertVersionFree(db, input.version);
  const id = `cl-${uuidv7()}`;
  db.prepare(
    `INSERT INTO changelog_entries (id, version, title, body, changes, published_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.version,
    input.title,
    input.body,
    JSON.stringify(input.changes),
    input.published_at,
    input.status,
    now,
    now,
  );
  return getChangelogEntry(db, id);
}

/** 局部更新更新日志；版本号变更时做唯一性校验。 */
export function updateChangelogEntry(db: Db, id: string, patch: ChangelogPatch, now: string): ChangelogRow {
  const existing = getChangelogEntry(db, id);
  if (patch.version && patch.version !== existing.version) assertVersionFree(db, patch.version, id);

  const fields: Array<keyof ChangelogPatch> = ['version', 'title', 'body', 'changes', 'published_at', 'status'];
  const assignments: string[] = [];
  const params: Array<string | null> = [];
  for (const field of fields) {
    if (!(field in patch)) continue;
    assignments.push(`${field} = ?`);
    params.push(field === 'changes' ? JSON.stringify(patch.changes ?? []) : ((patch[field] as string | null) ?? null));
  }
  if (assignments.length === 0) return existing;
  assignments.push('updated_at = ?');
  params.push(now, id);
  db.prepare(`UPDATE changelog_entries SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
  return getChangelogEntry(db, id);
}

/** 删除更新日志；不存在抛 NOT_FOUND。 */
export function deleteChangelogEntry(db: Db, id: string): void {
  const changed = db.prepare('DELETE FROM changelog_entries WHERE id = ?').run(id);
  if (changed.changes === 0) throw new AppError('NOT_FOUND', '更新日志不存在');
}
