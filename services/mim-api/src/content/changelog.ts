/**
 * 更新日志业务函数：公开列表按语义版本倒序 + 时间倒序，按版本聚合视图，管理端 CRUD。
 * 版本排序走 semver 库；无法解析为语义版本的条目回落字典序并排在可解析版本之后。
 */

import semver from 'semver'; // 语义版本比较：成熟库而非手写正则
import { AppError, uuidv7 } from '@mim/core-domain'; // 统一业务异常 + 时间有序主键
import type { Db } from '../types.js'; // 数据库连接类型

/** 更新日志行（库内完整字段子集） */
export interface ChangelogRow {
  id: string; // 对象字段 id：记录一项配置或数据
  version: string; // 对象字段 version：记录一项配置或数据
  title: string; // 对象字段 title：记录一项配置或数据
  body: string; // 对象字段 body：记录一项配置或数据
  changes: string; // JSON 字符串数组
  published_at: string | null; // 对象字段 published_at：记录一项配置或数据
  status: 'draft' | 'published' | 'archived'; // 对象字段 status：记录一项配置或数据
  created_at: string; // 对象字段 created_at：记录一项配置或数据
  updated_at: string; // 对象字段 updated_at：记录一项配置或数据
} // 代码块结束

/** 公开列表条目（冻结契约：id / version / title / body / published_at） */
export interface PublicChangelogEntry {
  id: string; // 对象字段 id：记录一项配置或数据
  version: string; // 对象字段 version：记录一项配置或数据
  title: string; // 对象字段 title：记录一项配置或数据
  body: string; // 对象字段 body：记录一项配置或数据
  published_at: string | null; // 对象字段 published_at：记录一项配置或数据
} // 代码块结束

/** 按版本聚合视图条目 */
export interface ChangelogVersionGroup {
  version: string; // 对象字段 version：记录一项配置或数据
  title: string; // 对象字段 title：记录一项配置或数据
  published_at: string | null; // 对象字段 published_at：记录一项配置或数据
  latest_id: string; // 对象字段 latest_id：记录一项配置或数据
  entry_count: number; // 对象字段 entry_count：记录一项配置或数据
} // 代码块结束

/** 新建 / 更新入参 */
export interface ChangelogInput {
  version: string; // 对象字段 version：记录一项配置或数据
  title: string; // 对象字段 title：记录一项配置或数据
  body: string; // 对象字段 body：记录一项配置或数据
  changes: string[]; // 对象字段 changes：记录一项配置或数据
  published_at: string | null; // 对象字段 published_at：记录一项配置或数据
  status: 'draft' | 'published' | 'archived'; // 对象字段 status：记录一项配置或数据
} // 代码块结束

export type ChangelogPatch = Partial<ChangelogInput>; // 导出类型 ChangelogPatch：跨模块共享的类型定义

/** 语义版本比较：返回 -1/0/1；非法版本回落字典序，且排在合法版本之后。 */
function compareVersion(a: string, b: string): number {
  const pa = semver.coerce(a); // 常量 pa：保存固定配置或一次性派生值
  const pb = semver.coerce(b); // 常量 pb：保存固定配置或一次性派生值
  if (pa && pb) return semver.compare(pa, pb); // 条件分支：按判断结果选择后续处理路径
  if (pa) return 1; // a 合法 b 非法：a 排后（倒序时 b 在前）
  if (pb) return -1; // 条件分支：按判断结果选择后续处理路径
  return a.localeCompare(b); // 都非法：字典序兜底
} // 代码块结束

/** 公开视图映射。 */
function toPublic(row: ChangelogRow): PublicChangelogEntry {
  return { id: row.id, version: row.version, title: row.title, body: row.body, published_at: row.published_at }; // 返回当前函数的处理结果
} // 代码块结束

/** 公开更新日志：只回已发布；先按语义版本倒序，同版本内按发布时间倒序。 */
export function listPublicChangelog(db: Db, limit: number): PublicChangelogEntry[] {
  const rows = db // 常量 rows：保存固定配置或一次性派生值
    .prepare("SELECT * FROM changelog_entries WHERE status = 'published' ORDER BY published_at DESC, id DESC") // 执行当前业务步骤
    .all() as ChangelogRow[]; // 注册 ALL 路由 / 中间件处理器
  rows.sort((a, b) => { // 执行当前业务步骤
    const byVersion = compareVersion(b.version, a.version); // 版本倒序
    if (byVersion !== 0) return byVersion; // 条件分支：按判断结果选择后续处理路径
    return (b.published_at ?? '').localeCompare(a.published_at ?? ''); // 同版本时间倒序
  }); // 代码块结束
  return rows.slice(0, limit).map(toPublic); // 返回当前函数的处理结果
} // 代码块结束

/** 按版本聚合视图：每个版本取最新一条作为代表，附条目数；版本倒序。 */
export function aggregateChangelogByVersion(db: Db): ChangelogVersionGroup[] {
  const rows = db // 常量 rows：保存固定配置或一次性派生值
    .prepare("SELECT * FROM changelog_entries WHERE status = 'published' ORDER BY published_at DESC, id DESC") // 执行当前业务步骤
    .all() as ChangelogRow[]; // 注册 ALL 路由 / 中间件处理器
  const groups = new Map<string, ChangelogVersionGroup>(); // 版本号 → 聚合条目
  for (const row of rows) { // 循环：逐项遍历集合并执行相同处理
    const existing = groups.get(row.version); // 常量 existing：保存固定配置或一次性派生值
    if (!existing) { // 条件分支：按判断结果选择后续处理路径
      groups.set(row.version, { // 执行当前业务步骤
        version: row.version, // 对象字段 version：记录一项配置或数据
        title: row.title, // 对象字段 title：记录一项配置或数据
        published_at: row.published_at, // 对象字段 published_at：记录一项配置或数据
        latest_id: row.id, // 对象字段 latest_id：记录一项配置或数据
        entry_count: 1, // 对象字段 entry_count：记录一项配置或数据
      }); // 代码块结束
    } else { // 代码块结束
      existing.entry_count += 1; // 同版本追加条目计数（列表已按时间倒序，首条即最新）
    } // 代码块结束
  } // 代码块结束
  return [...groups.values()].sort((a, b) => compareVersion(b.version, a.version)); // 返回当前函数的处理结果
} // 代码块结束

/** 管理端列表：全量状态，按版本倒序 + 时间倒序。 */
export function listAdminChangelog(db: Db): ChangelogRow[] {
  const rows = db.prepare('SELECT * FROM changelog_entries ORDER BY created_at DESC, id DESC').all() as ChangelogRow[]; // 常量 rows：保存固定配置或一次性派生值
  rows.sort((a, b) => { // 执行当前业务步骤
    const byVersion = compareVersion(b.version, a.version); // 常量 byVersion：保存固定配置或一次性派生值
    if (byVersion !== 0) return byVersion; // 条件分支：按判断结果选择后续处理路径
    return (b.published_at ?? '').localeCompare(a.published_at ?? ''); // 返回当前函数的处理结果
  }); // 代码块结束
  return rows; // 返回当前函数的处理结果
} // 代码块结束

/** 按主键取单行；不存在抛 NOT_FOUND。 */
export function getChangelogEntry(db: Db, id: string): ChangelogRow {
  const row = db.prepare('SELECT * FROM changelog_entries WHERE id = ?').get(id) as ChangelogRow | undefined; // 常量 row：保存固定配置或一次性派生值
  if (!row) throw new AppError('NOT_FOUND', '更新日志不存在'); // 条件分支：按判断结果选择后续处理路径
  return row; // 返回当前函数的处理结果
} // 代码块结束

/** 校验版本号未被其它条目占用；excludeId 用于更新时排除自身。 */
function assertVersionFree(db: Db, version: string, excludeId?: string): void {
  const row = db.prepare('SELECT id FROM changelog_entries WHERE version = ?').get(version) as { id: string } | undefined; // 常量 row：保存固定配置或一次性派生值
  if (row && row.id !== excludeId) { // 条件分支：按判断结果选择后续处理路径
    throw new AppError('CONFLICT', '该版本号已存在更新日志', { version }); // 抛出错误：中断当前流程并向上层传递
  } // 代码块结束
} // 代码块结束

/** 新建更新日志。 */
export function createChangelogEntry(db: Db, input: ChangelogInput, now: string): ChangelogRow {
  assertVersionFree(db, input.version); // 调用 assertVersionFree 并处理其返回结果
  const id = `cl-${uuidv7()}`; // 常量 id：保存固定配置或一次性派生值
  db.prepare( // 执行当前业务步骤
    `INSERT INTO changelog_entries (id, version, title, body, changes, published_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run( // 执行当前业务步骤
    id, // 执行当前业务步骤
    input.version, // 执行当前业务步骤
    input.title, // 执行当前业务步骤
    input.body, // 执行当前业务步骤
    JSON.stringify(input.changes), // 执行当前业务步骤
    input.published_at, // 执行当前业务步骤
    input.status, // 执行当前业务步骤
    now, // 执行当前业务步骤
    now, // 执行当前业务步骤
  ); // 执行当前业务步骤
  return getChangelogEntry(db, id); // 返回当前函数的处理结果
} // 代码块结束

/** 局部更新更新日志；版本号变更时做唯一性校验。 */
export function updateChangelogEntry(db: Db, id: string, patch: ChangelogPatch, now: string): ChangelogRow {
  const existing = getChangelogEntry(db, id); // 常量 existing：保存固定配置或一次性派生值
  if (patch.version && patch.version !== existing.version) assertVersionFree(db, patch.version, id); // 条件分支：按判断结果选择后续处理路径

  const fields: Array<keyof ChangelogPatch> = ['version', 'title', 'body', 'changes', 'published_at', 'status']; // 常量 fields：保存固定配置或一次性派生值
  const assignments: string[] = []; // 常量 assignments：保存固定配置或一次性派生值
  const params: Array<string | null> = []; // 常量 params：保存固定配置或一次性派生值
  for (const field of fields) { // 循环：逐项遍历集合并执行相同处理
    if (!(field in patch)) continue; // 条件分支：按判断结果选择后续处理路径
    assignments.push(`${field} = ?`); // 执行当前业务步骤
    params.push(field === 'changes' ? JSON.stringify(patch.changes ?? []) : ((patch[field] as string | null) ?? null)); // 执行当前业务步骤
  } // 代码块结束
  if (assignments.length === 0) return existing; // 条件分支：按判断结果选择后续处理路径
  assignments.push('updated_at = ?'); // 执行当前业务步骤
  params.push(now, id); // 执行当前业务步骤
  db.prepare(`UPDATE changelog_entries SET ${assignments.join(', ')} WHERE id = ?`).run(...params); // 执行当前业务步骤
  return getChangelogEntry(db, id); // 返回当前函数的处理结果
} // 代码块结束

/** 删除更新日志；不存在抛 NOT_FOUND。 */
export function deleteChangelogEntry(db: Db, id: string): void {
  const changed = db.prepare('DELETE FROM changelog_entries WHERE id = ?').run(id); // 常量 changed：保存固定配置或一次性派生值
  if (changed.changes === 0) throw new AppError('NOT_FOUND', '更新日志不存在'); // 条件分支：按判断结果选择后续处理路径
} // 代码块结束

/**
 * 发布更新日志：draft / archived → published；已是 published 抛 409。
 * published_at 仅首次发布写入（COALESCE 保留历史发布时间，重发不覆盖）。
 */
export function publishChangelogEntry(db: Db, id: string, now: string): ChangelogRow {
  const row = getChangelogEntry(db, id); // 常量 row：保存固定配置或一次性派生值
  if (row.status === 'published') { // 条件分支：按判断结果选择后续处理路径
    throw new AppError('CONFLICT', '更新日志已是发布状态', { from: row.status, to: 'published' }); // 抛出错误：中断当前流程并向上层传递
  } // 代码块结束
  db.prepare( // 执行当前业务步骤
    `UPDATE changelog_entries
        SET status = 'published', published_at = COALESCE(published_at, ?), updated_at = ?
      WHERE id = ?`,
  ).run(now, now, id); // 执行当前业务步骤
  return getChangelogEntry(db, id); // 返回当前函数的处理结果
} // 代码块结束

/** 归档更新日志：draft / published → archived；已是 archived 抛 409。 */
export function archiveChangelogEntry(db: Db, id: string, now: string): ChangelogRow {
  const row = getChangelogEntry(db, id); // 常量 row：保存固定配置或一次性派生值
  if (row.status === 'archived') { // 条件分支：按判断结果选择后续处理路径
    throw new AppError('CONFLICT', '更新日志已是归档状态', { from: row.status, to: 'archived' }); // 抛出错误：中断当前流程并向上层传递
  } // 代码块结束
  db.prepare(`UPDATE changelog_entries SET status = 'archived', updated_at = ? WHERE id = ?`).run(now, id); // 执行当前业务步骤
  return getChangelogEntry(db, id); // 返回当前函数的处理结果
} // 代码块结束
