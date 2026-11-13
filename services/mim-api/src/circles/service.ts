/**
 * 圈子（circle）业务层：成员制社群的归属、准入、审核、动态与公告。
 *
 * 概念边界（与板块 board 严格区分）：
 *   - 板块隶属站点，是内容分区（community_boards / community_threads）；
 *   - 圈子以「人 / 兴趣 / 组织」为中心，核心是成员关系：圈主、加入审核、成员上限、
 *     圈内专属动态流与公告；可跨板块聚合内容，也可以只有圈内动态。
 * 本模块只读写 circles / circle_members / circle_posts / circle_notices 四张表，
 * 不借用板块表冒充圈子，也不向板块表回写归属。
 */

import { randomUUID } from 'node:crypto'; // 内部主键与邀请码生成
import { AppError } from '@mim/core-domain'; // 统一业务异常
import type { ApiDeps, Db } from '../types.js'; // 依赖容器与同步句柄类型

/** 圈子可见性：public 公开可浏览；private 仅 active 成员可见 */
export type CircleVisibility = 'public' | 'private';
/** 加入方式：open 直接加入；approve 待圈主 / 管理员审核；invite 凭邀请码加入 */
export type CircleJoinMode = 'open' | 'approve' | 'invite';
/** 圈子状态：active 正常；archived 归档（不可再加入 / 发声，只读展示） */
export type CircleStatus = 'active' | 'archived';
/** 成员角色：owner 圈主；admin 管理员；member 普通成员 */
export type CircleRole = 'owner' | 'admin' | 'member';
/** 成员关系状态：pending 待审核；active 已加入；left 已退出或被拒 */
export type CircleMemberStatus = 'pending' | 'active' | 'left';

/** circles 表行结构（与 40-circles.sql 一一对应） */
export interface CircleRow {
  id: string; // 对象字段 id：记录一项配置或数据
  slug: string; // 对象字段 slug：记录一项配置或数据
  name: string; // 对象字段 name：记录一项配置或数据
  intro: string; // 对象字段 intro：记录一项配置或数据
  cover_url: string | null; // 对象字段 cover_url：记录一项配置或数据
  owner_id: string; // 对象字段 owner_id：记录一项配置或数据
  visibility: CircleVisibility; // 对象字段 visibility：记录一项配置或数据
  join_mode: CircleJoinMode; // 对象字段 join_mode：记录一项配置或数据
  member_limit: number; // 对象字段 member_limit：记录一项配置或数据
  category: string | null; // 对象字段 category：记录一项配置或数据
  status: CircleStatus; // 对象字段 status：记录一项配置或数据
  invite_code: string | null; // 对象字段 invite_code：记录一项配置或数据
  created_at: string; // 对象字段 created_at：记录一项配置或数据
} // 代码块结束

/** circle_members 表行结构 */
export interface MemberRow {
  circle_id: string; // 对象字段 circle_id：记录一项配置或数据
  user_id: string; // 对象字段 user_id：记录一项配置或数据
  role: CircleRole; // 对象字段 role：记录一项配置或数据
  status: CircleMemberStatus; // 对象字段 status：记录一项配置或数据
  joined_at: string; // 对象字段 joined_at：记录一项配置或数据
} // 代码块结束

/** 圈子列表查询过滤条件 */
export interface CircleListFilter {
  visibility?: string; // 执行当前业务步骤
  category?: string; // 执行当前业务步骤
  keyword?: string; // 执行当前业务步骤
  page: number; // 对象字段 page：记录一项配置或数据
  limit: number; // 对象字段 limit：记录一项配置或数据
} // 代码块结束

/** 圈子创建入参（已由路由层 zod 校验收敛） */
export interface CreateCircleInput {
  slug: string; // 对象字段 slug：记录一项配置或数据
  name: string; // 对象字段 name：记录一项配置或数据
  intro: string; // 对象字段 intro：记录一项配置或数据
  cover_url?: string | null; // 执行当前业务步骤
  visibility: CircleVisibility; // 对象字段 visibility：记录一项配置或数据
  join_mode: CircleJoinMode; // 对象字段 join_mode：记录一项配置或数据
  member_limit: number; // 对象字段 member_limit：记录一项配置或数据
  category?: string | null; // 执行当前业务步骤
} // 代码块结束

/** 邀请码字符集：去掉易混字符（0/O、1/I），便于口头转达 */
const INVITE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** 生成 8 位圈子邀请码 */
function generateInviteCode(): string {
  const bytes = new Uint8Array(8); // 常量 bytes：保存固定配置或一次性派生值
  globalThis.crypto.getRandomValues(bytes); // 执行当前业务步骤
  return Array.from(bytes, (b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join(''); // 返回当前函数的处理结果
} // 代码块结束

/** 读取整型环境变量；缺失 / 非法时回落兜底值。 */
function envInt(env: Record<string, string | undefined>, key: string, fallback: number): number {
  const raw = env[key]?.trim(); // 常量 raw：保存固定配置或一次性派生值
  if (!raw) return fallback; // 条件分支：按判断结果选择后续处理路径
  const parsed = Number.parseInt(raw, 10); // 常量 parsed：保存固定配置或一次性派生值
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback; // 返回当前函数的处理结果
} // 代码块结束

/** 创建圈子的配额门槛：最低等级 + 每人可建数量；env 可覆盖，默认 0 级 / 1 个。 */
export function createLimits(env: Record<string, string | undefined>): { minLevel: number; maxPerUser: number } {
  return { // 返回当前函数的处理结果
    minLevel: envInt(env, 'MIM_CIRCLE_CREATE_MIN_LEVEL', 0), // 对象字段 minLevel：记录一项配置或数据
    maxPerUser: envInt(env, 'MIM_CIRCLE_CREATE_MAX_PER_USER', 1), // 对象字段 maxPerUser：记录一项配置或数据
  }; // 代码块结束
} // 代码块结束

/**
 * 当前用户等级：与 growth / community 同一口径（积分每 300 一级、每 3 笔订单加一级，封顶 10）。
 * 钱包行 / 订单缺失时按 0 处理，保证新用户等级基线为 1。
 */
export function levelOfUser(db: Db, userId: string): number {
  const points = (db.prepare('SELECT points FROM wallets WHERE user_id = ?').get(userId) as { points: number } | undefined)?.points ?? 0; // 常量 points：保存固定配置或一次性派生值
  const orders = (db.prepare("SELECT COUNT(*) AS count FROM shop_orders WHERE user_id = ? AND status IN ('paid','delivered')").get(userId) as { count: number } | undefined)?.count ?? 0; // 常量 orders：保存固定配置或一次性派生值
  return Math.min(10, 1 + Math.floor(points / 300) + Math.floor(orders / 3)); // 返回当前函数的处理结果
} // 代码块结束

/** 按 slug 取圈子；归档圈在写链路仍可读，但准入 / 发声链路另行拦截。 */
export function getCircleBySlug(db: Db, slug: string): CircleRow | undefined {
  return db.prepare('SELECT * FROM circles WHERE slug = ?').get(slug) as CircleRow | undefined; // 返回当前函数的处理结果
} // 代码块结束

/** 取某用户在指定圈子的关系行；无关系返回 undefined。 */
export function membershipOf(db: Db, circleId: string, userId: string): MemberRow | undefined {
  return db.prepare('SELECT * FROM circle_members WHERE circle_id = ? AND user_id = ?').get(circleId, userId) as MemberRow | undefined; // 返回当前函数的处理结果
} // 代码块结束

/** active 成员数（pending / left 不计入成员上限与名单）。 */
export function countActiveMembers(db: Db, circleId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM circle_members WHERE circle_id = ? AND status = ?').get(circleId, 'active') as { count: number }; // 常量 row：保存固定配置或一次性派生值
  return row.count; // 返回当前函数的处理结果
} // 代码块结束

/** 判定用户是否为圈子管理员（owner / admin，且关系有效）。 */
export function canManage(member: MemberRow | undefined): boolean {
  return !!member && member.status === 'active' && (member.role === 'owner' || member.role === 'admin'); // 返回当前函数的处理结果
} // 代码块结束

/** 可见性门禁：private 圈子仅 active 成员可看；public 不限制。非成员访问 private 抛 403。 */
export function assertCircleVisible(db: Db, circle: CircleRow, userId?: string): void {
  if (circle.visibility !== 'private') return; // 条件分支：按判断结果选择后续处理路径
  if (!userId) throw new AppError('FORBIDDEN', '该圈子为私密圈子，仅成员可见'); // 条件分支：按判断结果选择后续处理路径
  const member = membershipOf(db, circle.id, userId); // 常量 member：保存固定配置或一次性派生值
  if (!member || member.status !== 'active') throw new AppError('FORBIDDEN', '该圈子为私密圈子，仅成员可见'); // 条件分支：按判断结果选择后续处理路径
} // 代码块结束

/** 成员门禁：动态流 / 公告 / 名单要求当前用户为 active 成员，否则 403。 */
export function assertActiveMember(member: MemberRow | undefined): void {
  if (!member || member.status !== 'active') throw new AppError('FORBIDDEN', '仅圈子成员可访问'); // 条件分支：按判断结果选择后续处理路径
} // 代码块结束

/** 管理门禁：owner / admin 之外一律 403。 */
export function assertManageable(member: MemberRow | undefined): void {
  if (!canManage(member)) throw new AppError('FORBIDDEN', '仅圈主或管理员可执行该操作'); // 条件分支：按判断结果选择后续处理路径
} // 代码块结束

/** 对外圈子投影：剥离 invite_code 等敏感字段，附成员数与当前用户关系。 */
export function projectCircle(db: Db, circle: CircleRow, userId?: string) {
  const member = userId ? membershipOf(db, circle.id, userId) : undefined; // 常量 member：保存固定配置或一次性派生值
  return { // 返回当前函数的处理结果
    slug: circle.slug, // 对象字段 slug：记录一项配置或数据
    name: circle.name, // 对象字段 name：记录一项配置或数据
    intro: circle.intro, // 对象字段 intro：记录一项配置或数据
    cover_url: circle.cover_url, // 对象字段 cover_url：记录一项配置或数据
    owner_id: circle.owner_id, // 对象字段 owner_id：记录一项配置或数据
    visibility: circle.visibility, // 对象字段 visibility：记录一项配置或数据
    join_mode: circle.join_mode, // 对象字段 join_mode：记录一项配置或数据
    member_limit: circle.member_limit, // 对象字段 member_limit：记录一项配置或数据
    category: circle.category, // 对象字段 category：记录一项配置或数据
    status: circle.status, // 对象字段 status：记录一项配置或数据
    member_count: countActiveMembers(db, circle.id), // 对象字段 member_count：记录一项配置或数据
    i_am_member: !!member && member.status === 'active', // 对象字段 i_am_member：记录一项配置或数据
    my_role: member && member.status === 'active' ? member.role : null, // 对象字段 my_role：记录一项配置或数据
  }; // 代码块结束
} // 代码块结束

/** 圈子列表：仅 active；支持可见性 / 分类 / 关键词过滤与分页。 */
export function listCircles(db: Db, filter: CircleListFilter, userId?: string) {
  const where: string[] = ["status = 'active'"]; // 常量 where：保存固定配置或一次性派生值
  const params: unknown[] = []; // 常量 params：保存固定配置或一次性派生值
  if (filter.visibility) { // 条件分支：按判断结果选择后续处理路径
    where.push('visibility = ?'); // 执行当前业务步骤
    params.push(filter.visibility); // 执行当前业务步骤
  } // 代码块结束
  if (filter.category) { // 条件分支：按判断结果选择后续处理路径
    where.push('category = ?'); // 执行当前业务步骤
    params.push(filter.category); // 执行当前业务步骤
  } // 代码块结束
  if (filter.keyword) { // 条件分支：按判断结果选择后续处理路径
    where.push('(name LIKE ? OR intro LIKE ?)'); // 执行当前业务步骤
    const like = `%${filter.keyword}%`; // 常量 like：保存固定配置或一次性派生值
    params.push(like, like); // 执行当前业务步骤
  } // 代码块结束
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''; // 常量 whereSql：保存固定配置或一次性派生值
  const total = (db.prepare(`SELECT COUNT(*) AS count FROM circles ${whereSql}`).get(...params) as { count: number }).count; // 常量 total：保存固定配置或一次性派生值
  const limit = Math.min(50, Math.max(1, filter.limit)); // 常量 limit：保存固定配置或一次性派生值
  const offset = (Math.max(1, filter.page) - 1) * limit; // 常量 offset：保存固定配置或一次性派生值
  const rows = db // 常量 rows：保存固定配置或一次性派生值
    .prepare(`SELECT * FROM circles ${whereSql} ORDER BY created_at DESC, slug ASC LIMIT ? OFFSET ?`) // 执行当前业务步骤
    .all(...params, limit, offset) as CircleRow[]; // 注册 ALL 路由 / 中间件处理器
  return { items: rows.map((row) => projectCircle(db, row, userId)), total, page: filter.page, limit }; // 返回当前函数的处理结果
} // 代码块结束

/**
 * 创建圈子：等级门槛 + 每人数量上限 + slug 唯一；创建者自动成为 owner。
 * 事务内同时落 circles 行与 owner 成员行，避免出现无主圈子。
 */
export function createCircle(deps: ApiDeps, input: CreateCircleInput, userId: string, now: string): CircleRow {
  const limits = createLimits(deps.env); // 常量 limits：保存固定配置或一次性派生值
  // slug 唯一冲突优先判定：与数量 / 等级配额无关，重复标识直接 409
  if (deps.db.prepare('SELECT 1 AS ok FROM circles WHERE slug = ?').get(input.slug)) {
    throw new AppError('CONFLICT', '圈子 slug 已存在'); // 抛出错误：中断当前流程并向上层传递
  } // 代码块结束
  if (limits.minLevel > 0 && levelOfUser(deps.db, userId) < limits.minLevel) { // 条件分支：按判断结果选择后续处理路径
    throw new AppError('FORBIDDEN', `创建圈子需 Lv.${limits.minLevel}`, { reason: 'CIRCLE_CREATE_LEVEL', required_level: limits.minLevel }); // 抛出错误：中断当前流程并向上层传递
  } // 代码块结束
  const owned = (deps.db.prepare("SELECT COUNT(*) AS count FROM circles WHERE owner_id = ? AND status = 'active'").get(userId) as { count: number }).count; // 常量 owned：保存固定配置或一次性派生值
  if (owned >= limits.maxPerUser) { // 条件分支：按判断结果选择后续处理路径
    throw new AppError('VALIDATION_FAILED', `每人最多创建 ${limits.maxPerUser} 个圈子`, { reason: 'CIRCLE_CREATE_LIMIT', max_per_user: limits.maxPerUser }); // 抛出错误：中断当前流程并向上层传递
  } // 代码块结束
  const id = `circle-${randomUUID()}`; // 常量 id：保存固定配置或一次性派生值
  const inviteCode = generateInviteCode(); // 常量 inviteCode：保存固定配置或一次性派生值
  const tx = deps.db.transaction(() => { // 常量 tx：保存固定配置或一次性派生值
    deps.db // 执行当前业务步骤
      .prepare( // 执行当前业务步骤
        `INSERT INTO circles (id, slug, name, intro, cover_url, owner_id, visibility, join_mode, member_limit, category, status, invite_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      ) // 执行当前业务步骤
      .run(id, input.slug, input.name, input.intro, input.cover_url ?? null, userId, input.visibility, input.join_mode, input.member_limit, input.category ?? null, inviteCode, now); // 执行当前业务步骤
    deps.db // 执行当前业务步骤
      .prepare('INSERT INTO circle_members (circle_id, user_id, role, status, joined_at) VALUES (?, ?, ?, ?, ?)') // 执行当前业务步骤
      .run(id, userId, 'owner', 'active', now); // 执行当前业务步骤
  }); // 代码块结束
  tx(); // 调用 tx 并处理其返回结果
  return getCircleBySlug(deps.db, input.slug)!; // 返回当前函数的处理结果
} // 代码块结束

/**
 * 加入圈子：
 *   - open：直接 active；approve：落 pending 待审；invite：校验邀请码后 active；
 *   - 成员上限已满 → 409；已 active 幂等返回；已 pending 重复申请不重复入队。
 */
export function joinCircle(deps: ApiDeps, circle: CircleRow, userId: string, inviteCode: string | undefined, now: string) {
  if (circle.status === 'archived') throw new AppError('VALIDATION_FAILED', '圈子已归档，不可加入', { reason: 'CIRCLE_ARCHIVED' }); // 条件分支：按判断结果选择后续处理路径
  const existing = membershipOf(deps.db, circle.id, userId); // 常量 existing：保存固定配置或一次性派生值
  if (existing && existing.status === 'active') { // 条件分支：按判断结果选择后续处理路径
    return { status: 'active' as const, role: existing.role, joined: true, via: 'already' }; // 返回当前函数的处理结果
  } // 代码块结束
  if (existing && existing.status === 'pending') { // 条件分支：按判断结果选择后续处理路径
    return { status: 'pending' as const, role: existing.role, joined: false, via: 'pending' }; // 返回当前函数的处理结果
  } // 代码块结束
  if (circle.member_limit > 0 && countActiveMembers(deps.db, circle.id) >= circle.member_limit) { // 条件分支：按判断结果选择后续处理路径
    throw new AppError('CONFLICT', '圈子成员已达上限', { reason: 'CIRCLE_MEMBER_LIMIT', member_limit: circle.member_limit }); // 抛出错误：中断当前流程并向上层传递
  } // 代码块结束
  let status: CircleMemberStatus; // 可变变量 status：运行过程中会被重新赋值
  if (circle.join_mode === 'open') { // 条件分支：按判断结果选择后续处理路径
    status = 'active'; // 赋值：更新变量 status 的取值
  } else if (circle.join_mode === 'approve') { // 代码块结束
    status = 'pending'; // 赋值：更新变量 status 的取值
  } else { // 代码块结束
    if (!inviteCode || inviteCode.trim() !== circle.invite_code) { // 条件分支：按判断结果选择后续处理路径
      throw new AppError('VALIDATION_FAILED', '邀请码无效', { reason: 'CIRCLE_INVITE_INVALID' }); // 抛出错误：中断当前流程并向上层传递
    } // 代码块结束
    status = 'active'; // 赋值：更新变量 status 的取值
  } // 代码块结束
  // 原 owner 即使退出过，重新加入仍保留 owner 角色；其余按普通成员落位。
  const role: CircleRole = existing?.role === 'owner' ? 'owner' : 'member';
  deps.db // 执行当前业务步骤
    .prepare( // 执行当前业务步骤
      `INSERT INTO circle_members (circle_id, user_id, role, status, joined_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(circle_id, user_id) DO UPDATE SET role = excluded.role, status = excluded.status, joined_at = excluded.joined_at`,
    ) // 执行当前业务步骤
    .run(circle.id, userId, role, status, now); // 执行当前业务步骤
  return { status, role, joined: status === 'active', via: circle.join_mode }; // 返回当前函数的处理结果
} // 代码块结束

/** 退出圈子：owner 不可退出（归档 / 转让属后续管理能力）；非成员退出按 404 收口。 */
export function leaveCircle(deps: ApiDeps, circle: CircleRow, userId: string): void {
  const member = membershipOf(deps.db, circle.id, userId); // 常量 member：保存固定配置或一次性派生值
  if (!member || member.status !== 'active') throw new AppError('NOT_FOUND', '尚未加入该圈子'); // 条件分支：按判断结果选择后续处理路径
  if (member.role === 'owner') throw new AppError('FORBIDDEN', '圈主不可退出圈子，可先归档或转让', { reason: 'CIRCLE_OWNER_CANNOT_LEAVE' }); // 条件分支：按判断结果选择后续处理路径
  deps.db.prepare("UPDATE circle_members SET status = 'left' WHERE circle_id = ? AND user_id = ?").run(circle.id, userId); // 执行当前业务步骤
} // 代码块结束

/** 审核待审成员：approve 通过为 active；reject 置 left。仅 owner / admin 可操作。 */
export function decidePendingMember(deps: ApiDeps, circle: CircleRow, actorId: string, targetUserId: string, approve: boolean, now: string): void {
  const actor = membershipOf(deps.db, circle.id, actorId); // 常量 actor：保存固定配置或一次性派生值
  assertManageable(actor); // 调用 assertManageable 并处理其返回结果
  const target = membershipOf(deps.db, circle.id, targetUserId); // 常量 target：保存固定配置或一次性派生值
  if (!target || target.status !== 'pending') throw new AppError('NOT_FOUND', '没有待审核的成员'); // 条件分支：按判断结果选择后续处理路径
  deps.db // 执行当前业务步骤
    .prepare("UPDATE circle_members SET status = ?, joined_at = ? WHERE circle_id = ? AND user_id = ?") // 执行当前业务步骤
    .run(approve ? 'active' : 'left', approve ? now : target.joined_at, circle.id, targetUserId); // 执行当前业务步骤
} // 代码块结束

/** 发圈内动态：active 成员均可；thread_id 可空（纯圈内动态），也可回填跨板块聚合的既有板块帖。 */
export function addCirclePost(deps: ApiDeps, circle: CircleRow, authorId: string, body: string, threadId: string | null, now: string) {
  const member = membershipOf(deps.db, circle.id, authorId); // 常量 member：保存固定配置或一次性派生值
  assertActiveMember(member); // 调用 assertActiveMember 并处理其返回结果
  const id = `circle-post-${randomUUID()}`; // 常量 id：保存固定配置或一次性派生值
  deps.db // 执行当前业务步骤
    .prepare('INSERT INTO circle_posts (id, circle_id, thread_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)') // 执行当前业务步骤
    .run(id, circle.id, threadId, authorId, body, now); // 执行当前业务步骤
  return { id, circle_id: circle.id, thread_id: threadId, author_id: authorId, body, created_at: now }; // 返回当前函数的处理结果
} // 代码块结束

/** 圈内动态流：仅 active 成员可读，按时间倒序。 */
export function listCirclePosts(deps: ApiDeps, circle: CircleRow, userId: string) {
  const member = membershipOf(deps.db, circle.id, userId); // 常量 member：保存固定配置或一次性派生值
  assertActiveMember(member); // 调用 assertActiveMember 并处理其返回结果
  return deps.db // 返回当前函数的处理结果
    .prepare( // 执行当前业务步骤
      `SELECT p.id, p.thread_id, p.author_id, p.body, p.created_at,
              u.display_name AS author_name, u.member_no AS author_member_no
         FROM circle_posts p LEFT JOIN users u ON u.id = p.author_id
        WHERE p.circle_id = ? ORDER BY p.created_at DESC, p.id DESC LIMIT 50`,
    ) // 执行当前业务步骤
    .all(circle.id); // 注册 ALL 路由 / 中间件处理器
} // 代码块结束

/** 发圈内公告：仅 owner / admin。 */
export function addCircleNotice(deps: ApiDeps, circle: CircleRow, authorId: string, body: string, now: string) {
  const actor = membershipOf(deps.db, circle.id, authorId); // 常量 actor：保存固定配置或一次性派生值
  assertManageable(actor); // 调用 assertManageable 并处理其返回结果
  const id = `circle-notice-${randomUUID()}`; // 常量 id：保存固定配置或一次性派生值
  deps.db.prepare('INSERT INTO circle_notices (id, circle_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(id, circle.id, authorId, body, now); // 执行当前业务步骤
  return { id, circle_id: circle.id, author_id: authorId, body, created_at: now }; // 返回当前函数的处理结果
} // 代码块结束

/** 圈内公告流：仅 active 成员可读，按时间倒序。 */
export function listCircleNotices(deps: ApiDeps, circle: CircleRow, userId: string) {
  const member = membershipOf(deps.db, circle.id, userId); // 常量 member：保存固定配置或一次性派生值
  assertActiveMember(member); // 调用 assertActiveMember 并处理其返回结果
  return deps.db // 返回当前函数的处理结果
    .prepare( // 执行当前业务步骤
      `SELECT n.id, n.author_id, n.body, n.created_at,
              u.display_name AS author_name, u.member_no AS author_member_no
         FROM circle_notices n LEFT JOIN users u ON u.id = n.author_id
        WHERE n.circle_id = ? ORDER BY n.created_at DESC, n.id DESC LIMIT 50`,
    ) // 执行当前业务步骤
    .all(circle.id); // 注册 ALL 路由 / 中间件处理器
} // 代码块结束

/** 待审名单：仅 owner / admin 调用方读取；返回 pending 成员供审核操作选择。 */
export function listPendingMembers(db: Db, circleId: string) {
  return db // 返回当前函数的处理结果
    .prepare( // 执行当前业务步骤
      `SELECT m.user_id, m.role, m.status, m.joined_at,
              u.display_name AS name, u.member_no AS member_no
         FROM circle_members m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.circle_id = ? AND m.status = 'pending'
        ORDER BY m.joined_at ASC, m.user_id ASC`,
    ) // 执行当前业务步骤
    .all(circleId); // 注册 ALL 路由 / 中间件处理器
} // 代码块结束

/** 成员名单：仅 active 成员可读；pending / left 不对外展示。 */
export function listCircleMembers(deps: ApiDeps, circle: CircleRow, userId: string) {
  const member = membershipOf(deps.db, circle.id, userId); // 常量 member：保存固定配置或一次性派生值
  assertActiveMember(member); // 调用 assertActiveMember 并处理其返回结果
  return deps.db // 返回当前函数的处理结果
    .prepare( // 执行当前业务步骤
      `SELECT m.user_id, m.role, m.status, m.joined_at,
              u.display_name AS name, u.member_no AS member_no
         FROM circle_members m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.circle_id = ? AND m.status = 'active'
        ORDER BY m.role = 'owner' DESC, m.joined_at ASC, m.user_id ASC`,
    ) // 执行当前业务步骤
    .all(circle.id); // 注册 ALL 路由 / 中间件处理器
} // 代码块结束
