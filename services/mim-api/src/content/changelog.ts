/**
 * 更新日志业务函数：公开列表按语义版本倒序 + 时间倒序，按版本聚合视图，管理端 CRUD。
 * 版本排序走 semver 库；无法解析为语义版本的条目回落字典序并排在可解析版本之后。
 */

import semver from 'semver'; // 语义版本比较：成熟库而非手写正则
import { AppError, uuidv7 } from '@mim/core-domain'; // 统一业务异常 + 时间有序主键
import type { Db } from '../types.js'; // 数据库连接类型

/** 更新日志行（库内完整字段子集） */
export interface ChangelogRow { // 业务步骤
  id: string; // 主键
  version: string; // 语义版本号
  title: string; // 标题
  body: string; // 正文
  changes: string; // JSON 字符串数组
  published_at: string | null; // 发布时间
  status: 'draft' | 'published' | 'archived'; // 状态
  created_at: string; // 创建时间
  updated_at: string; // 更新时间
} // 业务步骤

/** 公开列表条目（冻结契约：id / version / title / body / published_at） */
export interface PublicChangelogEntry { // 业务步骤
  id: string; // 主键
  version: string; // 版本号
  title: string; // 标题
  body: string; // 正文
  published_at: string | null; // 发布时间
} // 业务步骤

/** 按版本聚合视图条目 */
export interface ChangelogVersionGroup { // 业务步骤
  version: string; // 版本号
  title: string; // 代表条目标题
  published_at: string | null; // 代表条目发布时间
  latest_id: string; // 最新条目主键
  entry_count: number; // 该版本条目数
} // 业务步骤

/** 新建 / 更新入参 */
export interface ChangelogInput { // 业务步骤
  version: string; // 版本号
  title: string; // 标题
  body: string; // 正文
  changes: string[]; // 变更清单
  published_at: string | null; // 发布时间
  status: 'draft' | 'published' | 'archived'; // 状态
} // 业务步骤

export type ChangelogPatch = Partial<ChangelogInput>; // 局部更新入参

/** 语义版本比较：返回 -1/0/1；非法版本回落字典序，且排在合法版本之后。 */
function compareVersion(a: string, b: string): number { // 业务步骤
  const pa = semver.coerce(a); // 解析 a
  const pb = semver.coerce(b); // 解析 b
  if (pa && pb) return semver.compare(pa, pb); // 双合法按语义版本比较
  if (pa) return 1; // a 合法 b 非法：a 排后（倒序时 b 在前）
  if (pb) return -1; // 业务步骤
  return a.localeCompare(b); // 都非法：字典序兜底
} // 业务步骤

/** 公开视图映射。 */
function toPublic(row: ChangelogRow): PublicChangelogEntry { // 业务步骤
  return { id: row.id, version: row.version, title: row.title, body: row.body, published_at: row.published_at }; // 业务步骤
} // 业务步骤

/** 公开更新日志：只回已发布；先按语义版本倒序，同版本内按发布时间倒序。 */
export function listPublicChangelog(db: Db, limit: number): PublicChangelogEntry[] { // 业务步骤
  const rows = db // 业务步骤
    .prepare("SELECT * FROM changelog_entries WHERE status = 'published' ORDER BY published_at DESC, id DESC") // 业务步骤
    .all() as ChangelogRow[]; // 业务步骤
  rows.sort((a, b) => { // 业务步骤
    const byVersion = compareVersion(b.version, a.version); // 版本倒序
    if (byVersion !== 0) return byVersion; // 业务步骤
    return (b.published_at ?? '').localeCompare(a.published_at ?? ''); // 同版本时间倒序
  }); // 业务步骤
  return rows.slice(0, limit).map(toPublic); // 业务步骤
} // 业务步骤

/** 按版本聚合视图：每个版本取最新一条作为代表，附条目数；版本倒序。 */
export function aggregateChangelogByVersion(db: Db): ChangelogVersionGroup[] { // 业务步骤
  const rows = db // 业务步骤
    .prepare("SELECT * FROM changelog_entries WHERE status = 'published' ORDER BY published_at DESC, id DESC") // 业务步骤
    .all() as ChangelogRow[]; // 业务步骤
  const groups = new Map<string, ChangelogVersionGroup>(); // 版本号 → 聚合条目
  for (const row of rows) { // 业务步骤
    const existing = groups.get(row.version); // 业务步骤
    if (!existing) { // 业务步骤
      groups.set(row.version, { // 业务步骤
        version: row.version, // 业务步骤
        title: row.title, // 业务步骤
        published_at: row.published_at, // 业务步骤
        latest_id: row.id, // 业务步骤
        entry_count: 1, // 业务步骤
      }); // 业务步骤
    } else { // 业务步骤
      existing.entry_count += 1; // 同版本追加条目计数（列表已按时间倒序，首条即最新）
    } // 业务步骤
  } // 业务步骤
  return [...groups.values()].sort((a, b) => compareVersion(b.version, a.version)); // 业务步骤
} // 业务步骤

/** 管理端列表：全量状态，按版本倒序 + 时间倒序。 */
export function listAdminChangelog(db: Db): ChangelogRow[] { // 业务步骤
  const rows = db.prepare('SELECT * FROM changelog_entries ORDER BY created_at DESC, id DESC').all() as ChangelogRow[]; // 业务步骤
  rows.sort((a, b) => { // 业务步骤
    const byVersion = compareVersion(b.version, a.version); // 业务步骤
    if (byVersion !== 0) return byVersion; // 业务步骤
    return (b.published_at ?? '').localeCompare(a.published_at ?? ''); // 业务步骤
  }); // 业务步骤
  return rows; // 业务步骤
} // 业务步骤

/** 按主键取单行；不存在抛 NOT_FOUND。 */
export function getChangelogEntry(db: Db, id: string): ChangelogRow { // 业务步骤
  const row = db.prepare('SELECT * FROM changelog_entries WHERE id = ?').get(id) as ChangelogRow | undefined; // 业务步骤
  if (!row) throw new AppError('NOT_FOUND', '更新日志不存在'); // 业务步骤
  return row; // 业务步骤
} // 业务步骤

/** 校验版本号未被其它条目占用；excludeId 用于更新时排除自身。 */
function assertVersionFree(db: Db, version: string, excludeId?: string): void { // 业务步骤
  const row = db.prepare('SELECT id FROM changelog_entries WHERE version = ?').get(version) as { id: string } | undefined; // 业务步骤
  if (row && row.id !== excludeId) { // 业务步骤
    throw new AppError('CONFLICT', '该版本号已存在更新日志', { version }); // 业务步骤
  } // 业务步骤
} // 业务步骤

/** 新建更新日志。 */
export function createChangelogEntry(db: Db, input: ChangelogInput, now: string): ChangelogRow { // 业务步骤
  assertVersionFree(db, input.version); // 业务步骤
  const id = `cl-${uuidv7()}`; // 业务步骤
  db.prepare( // 业务步骤
    `INSERT INTO changelog_entries (id, version, title, body, changes, published_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run( // 业务步骤
    id, // 业务步骤
    input.version, // 业务步骤
    input.title, // 业务步骤
    input.body, // 业务步骤
    JSON.stringify(input.changes), // 业务步骤
    input.published_at, // 业务步骤
    input.status, // 业务步骤
    now, // 业务步骤
    now, // 业务步骤
  ); // 业务步骤
  return getChangelogEntry(db, id); // 业务步骤
} // 业务步骤

/** 局部更新更新日志；版本号变更时做唯一性校验。 */
export function updateChangelogEntry(db: Db, id: string, patch: ChangelogPatch, now: string): ChangelogRow { // 业务步骤
  const existing = getChangelogEntry(db, id); // 业务步骤
  if (patch.version && patch.version !== existing.version) assertVersionFree(db, patch.version, id); // 业务步骤

  const fields: Array<keyof ChangelogPatch> = ['version', 'title', 'body', 'changes', 'published_at', 'status']; // 业务步骤
  const assignments: string[] = []; // 业务步骤
  const params: Array<string | null> = []; // 业务步骤
  for (const field of fields) { // 业务步骤
    if (!(field in patch)) continue; // 业务步骤
    assignments.push(`${field} = ?`); // 业务步骤
    params.push(field === 'changes' ? JSON.stringify(patch.changes ?? []) : ((patch[field] as string | null) ?? null)); // 业务步骤
  } // 业务步骤
  if (assignments.length === 0) return existing; // 业务步骤
  assignments.push('updated_at = ?'); // 业务步骤
  params.push(now, id); // 业务步骤
  db.prepare(`UPDATE changelog_entries SET ${assignments.join(', ')} WHERE id = ?`).run(...params); // 业务步骤
  return getChangelogEntry(db, id); // 业务步骤
} // 业务步骤

/** 删除更新日志；不存在抛 NOT_FOUND。 */
export function deleteChangelogEntry(db: Db, id: string): void { // 业务步骤
  const changed = db.prepare('DELETE FROM changelog_entries WHERE id = ?').run(id); // 业务步骤
  if (changed.changes === 0) throw new AppError('NOT_FOUND', '更新日志不存在'); // 业务步骤
} // 业务步骤
