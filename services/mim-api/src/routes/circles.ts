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
import {
  addCircleNotice,
  addCirclePost,
  assertActiveMember,
  assertCircleVisible,
  countActiveMembers,
  createCircle,
  decidePendingMember,
  getCircleBySlug,
  joinCircle,
  leaveCircle,
  listCircleMembers,
  listCircleNotices,
  listCirclePosts,
  listCircles,
  listPendingMembers,
  membershipOf,
  canManage,
  projectCircle,
  type CircleRow,
} from '../circles/service.js';

const now = () => new Date().toISOString(); // 统一 UTC 时间

// 本路由承载的命名空间前缀：鉴权与幂等只挂在这些前缀上，避免影响其它命名空间
const CIRCLE_PREFIXES = ['/circles'];

/**
 * 可选鉴权：令牌有效且账号正常则挂载 req.user，匿名 / 失效一律留空、不抛 401。
 * 公开读链路据此判断「我是否成员」；受保护端点随后由 requireAuth 强制门禁。
 */
function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (match && match[1]) {
    try {
      const payload = verifyAccessToken(match[1], req.deps.jwtSecret);
      const row = req.deps.db
        .prepare('SELECT id, member_no, region, status, display_name, locale, timezone, is_guest FROM users WHERE id = ?')
        .get(payload.sub) as AuthUser | undefined;
      if (row && row.status === 'active') req.user = row;
    } catch {
      // 令牌过期 / 签名无效按匿名处理，公开读不阻断
    }
  }
  next();
}

/** 按 slug 加载圈子；不存在统一 404 信封。 */
function loadCircle(db: ApiDeps['db'], slug: string): CircleRow {
  const circle = getCircleBySlug(db, slug);
  if (!circle) throw new AppError('NOT_FOUND', '圈子不存在');
  return circle;
}

/** 创建圈子入参 schema */
const createCircleSchema = z.object({
  slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/, 'slug 只能是小写字母、数字与连字符'),
  name: z.string().min(2).max(40),
  intro: z.string().max(300).default(''),
  cover_url: z.string().max(500).nullable().optional(),
  visibility: z.enum(['public', 'private']).default('public'),
  join_mode: z.enum(['open', 'approve', 'invite']).default('open'),
  member_limit: z.number().int().min(0).max(10_000).default(0),
  category: z.string().max(40).nullable().optional(),
});

/** 加入圈子入参 schema：仅 invite 模式需要邀请码。 */
const joinSchema = z.object({
  invite_code: z.string().min(1).max(32).optional(),
});

/** 审核入参 schema：待审成员用户 ID。 */
const decideSchema = z.object({
  user_id: z.string().min(1),
});

/** 圈内动态入参 schema：thread_id 可空，可回填跨板块聚合的既有板块帖。 */
const postSchema = z.object({
  body: z.string().min(1).max(2000),
  thread_id: z.string().min(1).max(64).nullable().optional(),
});

/** 公告入参 schema。 */
const noticeSchema = z.object({
  body: z.string().min(1).max(1000),
});

export function createCirclesRouter(deps: ApiDeps): Router {
  const router = Router();

  // 可选鉴权先挂：公开读链路识别登录态；不阻断匿名，强制门禁在受保护段再挂 requireAuth
  router.use(CIRCLE_PREFIXES, optionalAuth);

  // ---- 公开只读端点：先于 requireAuth 注册，匿名访客可浏览公开圈子 ----

  /** 圈子列表：支持 category / visibility / keyword 过滤与分页；匿名仅看到公开投影。 */
  router.get('/circles', (req, res) => {
    const visibility = typeof req.query.visibility === 'string' ? req.query.visibility : undefined;
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const keyword = typeof req.query.keyword === 'string' ? req.query.keyword : undefined;
    const page = Number.parseInt(String(req.query.page ?? '1'), 10) || 1;
    const limit = Number.parseInt(String(req.query.limit ?? '20'), 10) || 20;
    const result = listCircles(
      deps.db,
      { visibility, category, keyword, page, limit },
      req.user?.id, // 公开列表未挂 requireAuth，匿名时无用户上下文
    );
    res.json(result);
  });

  /** 圈子详情：成员数 + 我是否成员 + 我的角色；private 圈子非成员 403。 */
  router.get('/circles/:slug', (req, res) => {
    const circle = loadCircle(deps.db, req.params.slug);
    assertCircleVisible(deps.db, circle, req.user?.id);
    res.json({ circle: projectCircle(deps.db, circle, req.user?.id) });
  });

  // ---- 受保护端点：登录态 + 写操作幂等 ----
  router.use(CIRCLE_PREFIXES, requireAuth);
  router.use(CIRCLE_PREFIXES, idempotency);

  /** 创建圈子：需登录；受等级 / 每人数量上限约束；创建者自动成为 owner。 */
  router.post('/circles', (req, res) => {
    const userId = req.user!.id;
    const body = parse(createCircleSchema, req.body);
    const circle = createCircle(deps, body, userId, now());
    res.status(201).json({ ok: true, circle: { ...projectCircle(deps.db, circle, userId), invite_code: circle.invite_code } });
  });

  /** 加入圈子：open 直入 / approve 待审 / invite 凭邀请码；满员 409。 */
  router.post('/circles/:slug/join', (req, res) => {
    const userId = req.user!.id;
    const circle = loadCircle(deps.db, req.params.slug);
    const body = parse(joinSchema, req.body);
    const result = joinCircle(deps, circle, userId, body.invite_code, now());
    res.status(result.status === 'active' ? 201 : 200).json({ ok: true, ...result });
  });

  /** 退出圈子：owner 不可退出；非成员 404。 */
  router.post('/circles/:slug/leave', (req, res) => {
    const userId = req.user!.id;
    const circle = loadCircle(deps.db, req.params.slug);
    leaveCircle(deps, circle, userId);
    res.json({ ok: true, left: true });
  });

  /** 成员名单：仅 active 成员可读；owner / admin 额外看到待审名单。 */
  router.get('/circles/:slug/members', (req, res) => {
    const userId = req.user!.id;
    const circle = loadCircle(deps.db, req.params.slug);
    const me = membershipOf(deps.db, circle.id, userId);
    assertActiveMember(me);
    const items = listCircleMembers(deps, circle, userId);
    const pending = canManage(me) ? listPendingMembers(deps.db, circle.id) : [];
    res.json({ items, pending, member_count: countActiveMembers(deps.db, circle.id) });
  });

  /** 通过待审成员：仅 owner / admin。 */
  router.post('/circles/:slug/approve', (req, res) => {
    const actorId = req.user!.id;
    const circle = loadCircle(deps.db, req.params.slug);
    const body = parse(decideSchema, req.body);
    decidePendingMember(deps, circle, actorId, body.user_id, true, now());
    res.json({ ok: true, status: 'active' });
  });

  /** 拒绝待审成员：仅 owner / admin。 */
  router.post('/circles/:slug/reject', (req, res) => {
    const actorId = req.user!.id;
    const circle = loadCircle(deps.db, req.params.slug);
    const body = parse(decideSchema, req.body);
    decidePendingMember(deps, circle, actorId, body.user_id, false, now());
    res.json({ ok: true, status: 'left' });
  });

  /** 发圈内动态：active 成员均可。 */
  router.post('/circles/:slug/posts', (req, res) => {
    const authorId = req.user!.id;
    const circle = loadCircle(deps.db, req.params.slug);
    const body = parse(postSchema, req.body);
    const post = addCirclePost(deps, circle, authorId, body.body, body.thread_id ?? null, now());
    res.status(201).json({ ok: true, post });
  });

  /** 圈内动态流：仅 active 成员可读。 */
  router.get('/circles/:slug/posts', (req, res) => {
    const userId = req.user!.id;
    const circle = loadCircle(deps.db, req.params.slug);
    res.json({ items: listCirclePosts(deps, circle, userId) });
  });

  /** 发圈内公告：仅 owner / admin。 */
  router.post('/circles/:slug/notices', (req, res) => {
    const authorId = req.user!.id;
    const circle = loadCircle(deps.db, req.params.slug);
    const body = parse(noticeSchema, req.body);
    const notice = addCircleNotice(deps, circle, authorId, body.body, now());
    res.status(201).json({ ok: true, notice });
  });

  /** 圈内公告流：仅 active 成员可读。 */
  router.get('/circles/:slug/notices', (req, res) => {
    const userId = req.user!.id;
    const circle = loadCircle(deps.db, req.params.slug);
    res.json({ items: listCircleNotices(deps, circle, userId) });
  });

  return router;
}
