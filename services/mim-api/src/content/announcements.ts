/**
 * 公告业务函数：公开列表过滤 / 排序，管理端 CRUD。
 * 公开口径：只回 status='published' 且在有效期内；置顶优先，发布时间倒序。
 */

import { AppError, uuidv7 } from '@mim/core-domain'; // 统一业务异常 + 时间有序主键
import type { Db } from '../types.js'; // 数据库连接类型

/** 公告行（库内完整字段子集） */
export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  level: 'info' | 'warning' | 'success' | 'danger';
  status: 'draft' | 'published' | 'archived';
  published_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  pinned: number;
  author_id: string | null;
  created_at: string;
  updated_at: string;
}

/** 公开列表条目（冻结契约：id / title / body / pinned / published_at） */
export interface PublicAnnouncement {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  published_at: string;
}

/** 新建 / 更新入参（zod 在路由层收口，业务层只认归一后的字段） */
export interface AnnouncementInput {
  title: string;
  body: string;
  level: 'info' | 'warning' | 'success' | 'danger';
  status: 'draft' | 'published' | 'archived';
  starts_at: string | null;
  ends_at: string | null;
  pinned: boolean;
}

export type AnnouncementPatch = Partial<AnnouncementInput>;

/** 校验时间区间：两端都给时截止必须晚于起始。 */
function validateWindow(startsAt: string | null, endsAt: string | null): void {
  if (startsAt && endsAt && endsAt <= startsAt) {
    throw new AppError('VALIDATION_FAILED', 'ends_at 必须晚于 starts_at', { field: 'ends_at' });
  }
}

/** 公开视图映射：pinned 归一为布尔；published_at 优先取发布时间，回落生效起始，再回落创建时间。 */
function toPublic(row: AnnouncementRow): PublicAnnouncement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    pinned: row.pinned === 1,
    published_at: row.published_at ?? row.starts_at ?? row.created_at,
  };
}

/** 公开公告列表：草稿 / 归档 / 未生效 / 已过期一律不出现。 */
export function listPublicAnnouncements(db: Db, now: string, limit: number): PublicAnnouncement[] {
  const rows = db
    .prepare(
      `SELECT id, title, body, level, status, published_at, starts_at, ends_at, pinned, author_id, created_at, updated_at
         FROM announcements
        WHERE status = 'published'
          AND (starts_at IS NULL OR starts_at <= ?)
          AND (ends_at IS NULL OR ends_at > ?)
        ORDER BY pinned DESC, COALESCE(published_at, starts_at, created_at) DESC
        LIMIT ?`,
    )
    .all(now, now, limit) as AnnouncementRow[];
  return rows.map(toPublic);
}

/** 管理端列表：全量状态，按置顶与创建时间倒序，供后台维护页消费。 */
export function listAdminAnnouncements(db: Db): AnnouncementRow[] {
  return db
    .prepare('SELECT * FROM announcements ORDER BY pinned DESC, created_at DESC, id DESC')
    .all() as AnnouncementRow[];
}

/** 按主键取单行；不存在抛 NOT_FOUND。 */
export function getAnnouncement(db: Db, id: string): AnnouncementRow {
  const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id) as AnnouncementRow | undefined;
  if (!row) throw new AppError('NOT_FOUND', '公告不存在');
  return row;
}

/** 新建公告；authorId 由路由层注入（登录用户 ID，引导通道记 system）。 */
export function createAnnouncement(db: Db, input: AnnouncementInput, now: string, authorId: string | null): AnnouncementRow {
  validateWindow(input.starts_at, input.ends_at);
  const id = `ann-${uuidv7()}`;
  const publishedAt = input.status === 'published' ? now : null; // 直接建为已发布时落首次发布时间
  db.prepare(
    `INSERT INTO announcements (id, title, body, level, status, published_at, starts_at, ends_at, pinned, author_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.title,
    input.body,
    input.level,
    input.status,
    publishedAt,
    input.starts_at,
    input.ends_at,
    input.pinned ? 1 : 0,
    authorId,
    now,
    now,
  );
  return getAnnouncement(db, id);
}

/** 局部更新公告；只更新入参出现的字段，updated_at 统一刷新。 */
export function updateAnnouncement(db: Db, id: string, patch: AnnouncementPatch, now: string): AnnouncementRow {
  const existing = getAnnouncement(db, id); // 不存在先抛 404
  const merged: AnnouncementRow = { // 与存量行合并后做区间校验
    ...existing,
    ...patch,
    pinned: patch.pinned === undefined ? existing.pinned : patch.pinned ? 1 : 0, // 入参布尔归一为库内 0/1
  };
  validateWindow(merged.starts_at, merged.ends_at);

  const fields: Array<keyof AnnouncementPatch> = [
    'title',
    'body',
    'level',
    'status',
    'starts_at',
    'ends_at',
    'pinned',
  ];
  const assignments: string[] = [];
  const params: Array<string | number | null> = [];
  for (const field of fields) {
    if (!(field in patch)) continue; // 未传入的字段保持原样
    assignments.push(`${field} = ?`);
    params.push(field === 'pinned' ? (patch.pinned ? 1 : 0) : (patch[field] as string | null));
  }
  if (assignments.length === 0) return existing; // 空补丁直接回读，不刷时间戳
  assignments.push('updated_at = ?');
  params.push(now, id);
  db.prepare(`UPDATE announcements SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
  return getAnnouncement(db, id);
}

/** 删除公告；不存在抛 NOT_FOUND。 */
export function deleteAnnouncement(db: Db, id: string): void {
  const changed = db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
  if (changed.changes === 0) throw new AppError('NOT_FOUND', '公告不存在');
}

/**
 * 发布公告：draft / archived → published；已是 published 抛 409。
 * published_at 仅首次发布写入（COALESCE 保留历史发布时间，重发不覆盖）。
 */
export function publishAnnouncement(db: Db, id: string, now: string): AnnouncementRow {
  const row = getAnnouncement(db, id);
  if (row.status === 'published') {
    throw new AppError('CONFLICT', '公告已是发布状态', { from: row.status, to: 'published' });
  }
  db.prepare(
    `UPDATE announcements
        SET status = 'published', published_at = COALESCE(published_at, ?), updated_at = ?
      WHERE id = ?`,
  ).run(now, now, id);
  return getAnnouncement(db, id);
}

/** 归档公告：draft / published → archived；已是 archived 抛 409。 */
export function archiveAnnouncement(db: Db, id: string, now: string): AnnouncementRow {
  const row = getAnnouncement(db, id);
  if (row.status === 'archived') {
    throw new AppError('CONFLICT', '公告已是归档状态', { from: row.status, to: 'archived' });
  }
  db.prepare(`UPDATE announcements SET status = 'archived', updated_at = ? WHERE id = ?`).run(now, id);
  return getAnnouncement(db, id);
}
