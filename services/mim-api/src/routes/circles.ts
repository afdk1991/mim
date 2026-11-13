/**
 * 圈子路由：公开浏览 / 成员准入与互动 / 圈主管理三组端点。
 *
 * 与社区板块路由（routes/community.ts）平行但概念独立：本路由只服务 circles 域，
 * 不读取、不写回 community_boards 等板块表。主控在 app.ts 挂载：
 *   app.use('/api/v1', createCirclesRouter(resolved));
 */

import { Router } from 'express'; // 路由容器
import type { NextFunction, Request, Response } from 'express'; // 仅类型引用
import { z } from 'zod'; // 入参声明式校验
import { AppError } from '@mim/core-domain'; // 统一业务异常
import { idempotency, requireAuth } from '../middleware.js'; // 会话门禁与写操作幂等
import { verifyAccessToken } from '../auth.js'; // 令牌校验（可选鉴权链路复用）
import { parse } from '../validate.js'; // 校验失败统一翻译
import type { ApiDeps, AuthUser } from '../types.js'; // 依赖容器与用户视图
import { // 引入依赖、类型或本地模块绑定
  addCircleNotice, // 执行当前业务步骤
  addCirclePost, // 执行当前业务步骤
  assertActiveMember, // 执行当前业务步骤
  assertCircleVisible, // 执行当前业务步骤
  countActiveMembers, // 执行当前业务步骤
  createCircle, // 执行当前业务步骤
  decidePendingMember, // 执行当前业务步骤
  getCircleBySlug, // 执行当前业务步骤
  joinCircle, // 执行当前业务步骤
  leaveCircle, // 执行当前业务步骤
  listCircleMembers, // 执行当前业务步骤
  listCircleNotices, // 执行当前业务步骤
  listCirclePosts, // 执行当前业务步骤
  listCircles, // 执行当前业务步骤
  listPendingMembers, // 执行当前业务步骤
  membershipOf, // 执行当前业务步骤
  canManage, // 执行当前业务步骤
  projectCircle, // 执行当前业务步骤
  type CircleRow, // 类型别名 CircleRow：复用一份复合类型定义
} from '../circles/service.js'; // 代码块结束

const now = () => new Date().toISOString(); // 统一 UTC 时间

// 本路由承载的命名空间前缀：鉴权与幂等只挂在这些前缀上，避免影响其它命名空间
const CIRCLE_PREFIXES = ['/circles'];

/**
 * 可选鉴权：令牌有效且账号正常则挂载 req.user，匿名 / 失效一律留空、不抛 401。
 * 公开读链路据此判断「我是否成员」；受保护端点随后由 requireAuth 强制门禁。
 */
function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? ''; // 常量 header：保存固定配置或一次性派生值
  const match = /^Bearer\s+(.+)$/i.exec(header); // 常量 match：保存固定配置或一次性派生值
  if (match && match[1]) { // 条件分支：按判断结果选择后续处理路径
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const payload = verifyAccessToken(match[1], req.deps.jwtSecret); // 常量 payload：保存固定配置或一次性派生值
      const row = req.deps.db // 常量 row：保存固定配置或一次性派生值
        .prepare('SELECT id, member_no, region, status, display_name, locale, timezone, is_guest FROM users WHERE id = ?') // 执行当前业务步骤
        .get(payload.sub) as AuthUser | undefined; // 注册 GET 路由 / 中间件处理器
      if (row && row.status === 'active') req.user = row; // 条件分支：按判断结果选择后续处理路径
    } catch { // 代码块结束
      // 令牌过期 / 签名无效按匿名处理，公开读不阻断
    }
  } // 代码块结束
  next(); // 调用 next 并处理其返回结果
} // 代码块结束

/** 按 slug 加载圈子；不存在统一 404 信封。 */
function loadCircle(db: ApiDeps['db'], slug: string): CircleRow {
  const circle = getCircleBySlug(db, slug); // 常量 circle：保存固定配置或一次性派生值
  if (!circle) throw new AppError('NOT_FOUND', '圈子不存在'); // 条件分支：按判断结果选择后续处理路径
  return circle; // 返回当前函数的处理结果
} // 代码块结束

/** 创建圈子入参 schema */
const createCircleSchema = z.object({
  slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/, 'slug 只能是小写字母、数字与连字符'), // 对象字段 slug：记录一项配置或数据
  name: z.string().min(2).max(40), // 对象字段 name：记录一项配置或数据
  intro: z.string().max(300).default(''), // 对象字段 intro：记录一项配置或数据
  cover_url: z.string().max(500).nullable().optional(), // 对象字段 cover_url：记录一项配置或数据
  visibility: z.enum(['public', 'private']).default('public'), // 对象字段 visibility：记录一项配置或数据
  join_mode: z.enum(['open', 'approve', 'invite']).default('open'), // 对象字段 join_mode：记录一项配置或数据
  member_limit: z.number().int().min(0).max(10_000).default(0), // 对象字段 member_limit：记录一项配置或数据
  category: z.string().max(40).nullable().optional(), // 对象字段 category：记录一项配置或数据
}); // 代码块结束

/** 加入圈子入参 schema：仅 invite 模式需要邀请码。 */
const joinSchema = z.object({
  invite_code: z.string().min(1).max(32).optional(), // 对象字段 invite_code：记录一项配置或数据
}); // 代码块结束

/** 审核入参 schema：待审成员用户 ID。 */
const decideSchema = z.object({
  user_id: z.string().min(1), // 对象字段 user_id：记录一项配置或数据
}); // 代码块结束

/** 圈内动态入参 schema：thread_id 可空，可回填跨板块聚合的既有板块帖。 */
const postSchema = z.object({
  body: z.string().min(1).max(2000), // 对象字段 body：记录一项配置或数据
  thread_id: z.string().min(1).max(64).nullable().optional(), // 对象字段 thread_id：记录一项配置或数据
}); // 代码块结束

/** 公告入参 schema。 */
const noticeSchema = z.object({
  body: z.string().min(1).max(1000), // 对象字段 body：记录一项配置或数据
}); // 代码块结束

export function createCirclesRouter(deps: ApiDeps): Router { // 导出函数 createCirclesRouter：对外暴露的调用入口
  const router = Router(); // 常量 router：保存固定配置或一次性派生值

  // 可选鉴权先挂：公开读链路识别登录态；不阻断匿名，强制门禁在受保护段再挂 requireAuth
  router.use(CIRCLE_PREFIXES, optionalAuth);

  // ---- 公开只读端点：先于 requireAuth 注册，匿名访客可浏览公开圈子 ----

  /** 圈子列表：支持 category / visibility / keyword 过滤与分页；匿名仅看到公开投影。 */
  router.get('/circles', (req, res) => {
    const visibility = typeof req.query.visibility === 'string' ? req.query.visibility : undefined; // 常量 visibility：保存固定配置或一次性派生值
    const category = typeof req.query.category === 'string' ? req.query.category : undefined; // 常量 category：保存固定配置或一次性派生值
    const keyword = typeof req.query.keyword === 'string' ? req.query.keyword : undefined; // 常量 keyword：保存固定配置或一次性派生值
    const page = Number.parseInt(String(req.query.page ?? '1'), 10) || 1; // 常量 page：保存固定配置或一次性派生值
    const limit = Number.parseInt(String(req.query.limit ?? '20'), 10) || 20; // 常量 limit：保存固定配置或一次性派生值
    const result = listCircles( // 常量 result：保存固定配置或一次性派生值
      deps.db, // 执行当前业务步骤
      { visibility, category, keyword, page, limit }, // 执行当前业务步骤
      req.user?.id, // 公开列表未挂 requireAuth，匿名时无用户上下文
    ); // 执行当前业务步骤
    res.json(result); // 执行当前业务步骤
  }); // 代码块结束

  /** 圈子详情：成员数 + 我是否成员 + 我的角色；private 圈子非成员 403。 */
  router.get('/circles/:slug', (req, res) => {
    const circle = loadCircle(deps.db, req.params.slug); // 常量 circle：保存固定配置或一次性派生值
    assertCircleVisible(deps.db, circle, req.user?.id); // 调用 assertCircleVisible 并处理其返回结果
    res.json({ circle: projectCircle(deps.db, circle, req.user?.id) }); // 执行当前业务步骤
  }); // 代码块结束

  // ---- 受保护端点：登录态 + 写操作幂等 ----
  router.use(CIRCLE_PREFIXES, requireAuth);
  router.use(CIRCLE_PREFIXES, idempotency); // 执行当前业务步骤

  /** 创建圈子：需登录；受等级 / 每人数量上限约束；创建者自动成为 owner。 */
  router.post('/circles', (req, res) => {
    const userId = req.user!.id; // 常量 userId：保存固定配置或一次性派生值
    const body = parse(createCircleSchema, req.body); // 常量 body：保存固定配置或一次性派生值
    const circle = createCircle(deps, body, userId, now()); // 常量 circle：保存固定配置或一次性派生值
    res.status(201).json({ ok: true, circle: { ...projectCircle(deps.db, circle, userId), invite_code: circle.invite_code } }); // 执行当前业务步骤
  }); // 代码块结束

  /** 加入圈子：open 直入 / approve 待审 / invite 凭邀请码；满员 409。 */
  router.post('/circles/:slug/join', (req, res) => {
    const userId = req.user!.id; // 常量 userId：保存固定配置或一次性派生值
    const circle = loadCircle(deps.db, req.params.slug); // 常量 circle：保存固定配置或一次性派生值
    const body = parse(joinSchema, req.body); // 常量 body：保存固定配置或一次性派生值
    const result = joinCircle(deps, circle, userId, body.invite_code, now()); // 常量 result：保存固定配置或一次性派生值
    res.status(result.status === 'active' ? 201 : 200).json({ ok: true, ...result }); // 执行当前业务步骤
  }); // 代码块结束

  /** 退出圈子：owner 不可退出；非成员 404。 */
  router.post('/circles/:slug/leave', (req, res) => {
    const userId = req.user!.id; // 常量 userId：保存固定配置或一次性派生值
    const circle = loadCircle(deps.db, req.params.slug); // 常量 circle：保存固定配置或一次性派生值
    leaveCircle(deps, circle, userId); // 调用 leaveCircle 并处理其返回结果
    res.json({ ok: true, left: true }); // 执行当前业务步骤
  }); // 代码块结束

  /** 成员名单：仅 active 成员可读；owner / admin 额外看到待审名单。 */
  router.get('/circles/:slug/members', (req, res) => {
    const userId = req.user!.id; // 常量 userId：保存固定配置或一次性派生值
    const circle = loadCircle(deps.db, req.params.slug); // 常量 circle：保存固定配置或一次性派生值
    const me = membershipOf(deps.db, circle.id, userId); // 常量 me：保存固定配置或一次性派生值
    assertActiveMember(me); // 调用 assertActiveMember 并处理其返回结果
    const items = listCircleMembers(deps, circle, userId); // 常量 items：保存固定配置或一次性派生值
    const pending = canManage(me) ? listPendingMembers(deps.db, circle.id) : []; // 常量 pending：保存固定配置或一次性派生值
    res.json({ items, pending, member_count: countActiveMembers(deps.db, circle.id) }); // 执行当前业务步骤
  }); // 代码块结束

  /** 通过待审成员：仅 owner / admin。 */
  router.post('/circles/:slug/approve', (req, res) => {
    const actorId = req.user!.id; // 常量 actorId：保存固定配置或一次性派生值
    const circle = loadCircle(deps.db, req.params.slug); // 常量 circle：保存固定配置或一次性派生值
    const body = parse(decideSchema, req.body); // 常量 body：保存固定配置或一次性派生值
    decidePendingMember(deps, circle, actorId, body.user_id, true, now()); // 调用 decidePendingMember 并处理其返回结果
    res.json({ ok: true, status: 'active' }); // 执行当前业务步骤
  }); // 代码块结束

  /** 拒绝待审成员：仅 owner / admin。 */
  router.post('/circles/:slug/reject', (req, res) => {
    const actorId = req.user!.id; // 常量 actorId：保存固定配置或一次性派生值
    const circle = loadCircle(deps.db, req.params.slug); // 常量 circle：保存固定配置或一次性派生值
    const body = parse(decideSchema, req.body); // 常量 body：保存固定配置或一次性派生值
    decidePendingMember(deps, circle, actorId, body.user_id, false, now()); // 调用 decidePendingMember 并处理其返回结果
    res.json({ ok: true, status: 'left' }); // 执行当前业务步骤
  }); // 代码块结束

  /** 发圈内动态：active 成员均可。 */
  router.post('/circles/:slug/posts', (req, res) => {
    const authorId = req.user!.id; // 常量 authorId：保存固定配置或一次性派生值
    const circle = loadCircle(deps.db, req.params.slug); // 常量 circle：保存固定配置或一次性派生值
    const body = parse(postSchema, req.body); // 常量 body：保存固定配置或一次性派生值
    const post = addCirclePost(deps, circle, authorId, body.body, body.thread_id ?? null, now()); // 常量 post：保存固定配置或一次性派生值
    res.status(201).json({ ok: true, post }); // 执行当前业务步骤
  }); // 代码块结束

  /** 圈内动态流：仅 active 成员可读。 */
  router.get('/circles/:slug/posts', (req, res) => {
    const userId = req.user!.id; // 常量 userId：保存固定配置或一次性派生值
    const circle = loadCircle(deps.db, req.params.slug); // 常量 circle：保存固定配置或一次性派生值
    res.json({ items: listCirclePosts(deps, circle, userId) }); // 执行当前业务步骤
  }); // 代码块结束

  /** 发圈内公告：仅 owner / admin。 */
  router.post('/circles/:slug/notices', (req, res) => {
    const authorId = req.user!.id; // 常量 authorId：保存固定配置或一次性派生值
    const circle = loadCircle(deps.db, req.params.slug); // 常量 circle：保存固定配置或一次性派生值
    const body = parse(noticeSchema, req.body); // 常量 body：保存固定配置或一次性派生值
    const notice = addCircleNotice(deps, circle, authorId, body.body, now()); // 常量 notice：保存固定配置或一次性派生值
    res.status(201).json({ ok: true, notice }); // 执行当前业务步骤
  }); // 代码块结束

  /** 圈内公告流：仅 active 成员可读。 */
  router.get('/circles/:slug/notices', (req, res) => {
    const userId = req.user!.id; // 常量 userId：保存固定配置或一次性派生值
    const circle = loadCircle(deps.db, req.params.slug); // 常量 circle：保存固定配置或一次性派生值
    res.json({ items: listCircleNotices(deps, circle, userId) }); // 执行当前业务步骤
  }); // 代码块结束

  return router; // 返回当前函数的处理结果
} // 代码块结束
