/**
 * 内容运营路由工厂：公告 / 更新日志 / 推广计划。
 *
 * 挂载模型（与 catalog / community 等混装路由一致）：
 *   - 公开 GET 与点击 / 转化端点免鉴权，工厂整体须挂在全局 requireAuth 之前；
 *   - 管理端 CRUD 与状态流转在工厂内部逐路由挂双权限门禁（content:write 或既有 appearance:write），写操作再叠 idempotency。
 *
 * 冻结公开契约：
 *   GET /api/v1/announcements?limit=   → { items: [{ id, title, body, pinned, published_at }] }
 *   GET /api/v1/changelog?limit=       → { items: [{ id, version, title, body, published_at }] }
 *   GET /api/v1/promotions             → { items: [{ id, name, summary, target_url, starts_at, ends_at, status }] }
 */

import { Router } from 'express'; // 路由容器
import type { NextFunction, Request, Response } from 'express'; // 中间件类型，编译期擦除
import { z } from 'zod'; // 入参校验
import { AppError, isAppError } from '@mim/core-domain'; // 统一业务异常 + 类型守卫
import { idempotency, requirePermission } from '../middleware.js'; // 鉴权门禁与写幂等
import { parse } from '../validate.js'; // 校验错误翻译
import type { ApiDeps } from '../types.js'; // 依赖容器
import { parseLimit, visitorHash } from '../content/shared.js'; // 分页解析与访客指纹
import { pathParam } from '../utils.js'; // 安全路径参数：拒绝数组与缺失值
import {
  archiveAnnouncement,
  createAnnouncement,
  deleteAnnouncement,
  listAdminAnnouncements,
  listPublicAnnouncements,
  publishAnnouncement,
  updateAnnouncement,
} from '../content/announcements.js'; // 公告业务函数
import {
  aggregateChangelogByVersion,
  archiveChangelogEntry,
  createChangelogEntry,
  deleteChangelogEntry,
  listAdminChangelog,
  listPublicChangelog,
  publishChangelogEntry,
  updateChangelogEntry,
} from '../content/changelog.js'; // 更新日志业务函数
import {
  assertClickable,
  checkClickRateLimit,
  checkConversionRateLimit,
  createPromotion,
  deletePromotion,
  listAdminPromotions,
  listPublicPromotions,
  recordClick,
  recordConversion,
  updatePromotion,
  type PromotionRow,
} from '../content/promotions.js'; // 推广计划业务函数

/** 正式权限点：本包在 schema.d/07-content.sql 幂等注册并授予内置超管。 */
const CONTENT_PERMISSION = 'content:write';
/** 兼容期旧权限码：存量管理员仍持有的 appearance:write，二者任一满足即放行，避免锁死现有后台。 */
const LEGACY_PERMISSION = 'appearance:write';

/**
 * 双权限门禁：content:write 或 appearance:write 任一满足即放行。
 * 实现上依次尝试两个单权限门禁：仅 FORBIDDEN 降级到下一个；401 等其它错误原样上交。
 * 超管引导通道（x-admin-token）由 requirePermission 内部识别并视同全权限。
 */
function requireContentPermission(req: Request, res: Response, next: NextFunction): void {
  const tryGate = (code: string): 'pass' | 'forbidden' => {
    try {
      requirePermission(code)(req, res, () => {});
      return 'pass';
    } catch (err) {
      if (isAppError(err) && err.code === 'FORBIDDEN') return 'forbidden';
      throw err; // 401 / 账号不可用等非权限错误不做降级，原样上交错误处理
    }
  };
  if (tryGate(CONTENT_PERMISSION) === 'pass' || tryGate(LEGACY_PERMISSION) === 'pass') {
    next();
    return;
  }
  next(new AppError('FORBIDDEN', 'permission denied', { permission: CONTENT_PERMISSION }));
}

const DEFAULT_LIMIT = 20; // 公开列表缺省条数
const MAX_LIMIT = 50; // 公开列表硬上限，防止超大列表拖慢查询

/** 公告入参：标题 / 正文 / 级别 / 状态 / 有效期 / 置顶。 */
const announcementCreateSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().max(10000).default(''),
  level: z.enum(['info', 'warning', 'success', 'danger']).default('info'),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  starts_at: z.string().max(40).nullable().optional(),
  ends_at: z.string().max(40).nullable().optional(),
  pinned: z.boolean().default(false),
});

/** 公告局部更新：全部字段可选。 */
const announcementPatchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  body: z.string().max(10000).optional(),
  level: z.enum(['info', 'warning', 'success', 'danger']).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  starts_at: z.string().max(40).nullable().optional(),
  ends_at: z.string().max(40).nullable().optional(),
  pinned: z.boolean().optional(),
});

/** 更新日志入参：语义版本号 + 标题 + 正文 + 变更清单 + 发布时间 + 状态。 */
const changelogCreateSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, '版本号须为语义版本，如 0.0.8'),
  title: z.string().min(1).max(120),
  body: z.string().max(10000).default(''),
  changes: z.array(z.string().min(1).max(200)).max(50).default([]),
  published_at: z.string().max(40).nullable().optional(),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
});

/** 更新日志局部更新。 */
const changelogPatchSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, '版本号须为语义版本，如 0.0.8').optional(),
  title: z.string().min(1).max(120).optional(),
  body: z.string().max(10000).optional(),
  changes: z.array(z.string().min(1).max(200)).max(50).optional(),
  published_at: z.string().max(40).nullable().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
});

/** 推广计划入参：名称 / 摘要 / 落地页 / 推广码 / 有效期 / 状态 / 预算（最小货币单位，仅统计）。 */
const promotionCreateSchema = z.object({
  name: z.string().min(1).max(120),
  summary: z.string().max(300).default(''),
  target_url: z.string().max(500).default(''),
  code: z.string().max(40).nullable().optional(),
  starts_at: z.string().max(40).nullable().optional(),
  ends_at: z.string().max(40).nullable().optional(),
  status: z.enum(['draft', 'active', 'paused', 'archived']).default('draft'),
  budget_cents: z.number().int().min(0).max(100_000_000).default(0),
});

/** 推广计划局部更新。 */
const promotionPatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  summary: z.string().max(300).optional(),
  target_url: z.string().max(500).optional(),
  code: z.string().max(40).nullable().optional(),
  starts_at: z.string().max(40).nullable().optional(),
  ends_at: z.string().max(40).nullable().optional(),
  status: z.enum(['draft', 'active', 'paused', 'archived']).optional(),
  budget_cents: z.number().int().min(0).max(100_000_000).optional(),
});

/** 路由工厂：依赖显式注入，测试可整体替换内存库与替身环境。 */
export function createContentOpsRouter(deps: ApiDeps): Router {
  const router = Router();
  const now = () => (deps.now ? deps.now() : new Date().toISOString()); // 可注入时钟，便于过期 / 频控断言

  // ===== 公开端点（免鉴权，须在全局 requireAuth 之前挂载）=====

  /** 公开公告列表：置顶优先 + 发布时间倒序，只回已发布且在有效期内。 */
  router.get('/announcements', (req, res) => {
    const limit = parseLimit(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const items = listPublicAnnouncements(deps.db, now(), limit);
    res.json({ items });
  });

  /** 公开更新日志：语义版本倒序 + 同版本时间倒序。 */
  router.get('/changelog', (req, res) => {
    const limit = parseLimit(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const items = listPublicChangelog(deps.db, limit);
    res.json({ items });
  });

  /** 更新日志按版本聚合视图：每版本取最新一条 + 条目数，版本倒序。 */
  router.get('/changelog/versions', (_req, res) => {
    const items = aggregateChangelogByVersion(deps.db);
    res.json({ items });
  });

  /** 公开推广计划：只回进行中且在有效期内。 */
  router.get('/promotions', (_req, res) => {
    const items = listPublicPromotions(deps.db, now());
    res.json({ items });
  });

  /**
   * 推广点击计数：公开端点，匿名可点。
   * 幂等键（Idempotency-Key）同计划同键只入账一次；访客指纹做滑动窗口频控防刷。
   * 本端点不走全局 idempotency 中间件（该中间件要求登录主体），去重在 promotion_clicks 表内完成。
   */
  router.post('/promotions/:id/click', (req, res) => {
    const promotion = deps.db.prepare('SELECT * FROM promotions WHERE id = ?').get(pathParam(req, 'id')) as
      | PromotionRow
      | undefined;
    if (!promotion) throw new AppError('NOT_FOUND', '推广计划不存在');
    assertClickable(promotion, now());

    const idempotencyKey = (req.header('idempotency-key') ?? '').trim() || null;
    const visitor = visitorHash(req, deps);

    const violation = checkClickRateLimit(deps.db, deps.env, promotion.id, visitor, now());
    if (violation) {
      res.setHeader('Retry-After', String(violation.retryAfter)); // 客户端按退避秒数重试
      throw new AppError('RATE_LIMITED', '点击过于频繁，请稍后再试', { retry_after: violation.retryAfter });
    }

    const result = recordClick(deps.db, promotion.id, idempotencyKey, visitor, now());
    res.json({ ok: true, deduped: result.deduped, click_count: result.clickCount });
  });

  /**
   * 转化回写：公开端点，匿名可上报。
   * 与点击同口径：幂等键（Idempotency-Key）同计划同键只入账一次；访客指纹做滑动窗口频控防刷。
   * 只累计 conversion_count，不记佣金、不做资金结算；去重在 promotion_conversions 表内完成。
   */
  router.post('/promotions/:id/conversion', (req, res) => {
    const promotion = deps.db.prepare('SELECT * FROM promotions WHERE id = ?').get(pathParam(req, 'id')) as
      | PromotionRow
      | undefined;
    if (!promotion) throw new AppError('NOT_FOUND', '推广计划不存在');
    assertClickable(promotion, now());

    const idempotencyKey = (req.header('idempotency-key') ?? '').trim() || null;
    const visitor = visitorHash(req, deps);

    const violation = checkConversionRateLimit(deps.db, deps.env, promotion.id, visitor, now());
    if (violation) {
      res.setHeader('Retry-After', String(violation.retryAfter)); // 客户端按退避秒数重试
      throw new AppError('RATE_LIMITED', '转化上报过于频繁，请稍后再试', { retry_after: violation.retryAfter });
    }

    const result = recordConversion(deps.db, promotion.id, idempotencyKey, visitor, now());
    res.json({ ok: true, deduped: result.deduped, conversion_count: result.conversionCount });
  });

  // ===== 管理端端点（工厂内挂 requirePermission；写操作叠 idempotency）=====

  // --- 公告管理 ---
  router.get('/admin/content/announcements', requireContentPermission, (_req, res) => {
    res.json({ items: listAdminAnnouncements(deps.db) });
  });

  router.post('/admin/content/announcements', requireContentPermission, idempotency, (req, res) => {
    const body = parse(announcementCreateSchema, req.body);
    const authorId = req.user?.id ?? 'system'; // 引导通道无用户主体，记 system 留痕
    const item = createAnnouncement(
      deps.db,
      {
        title: body.title,
        body: body.body,
        level: body.level,
        status: body.status,
        starts_at: body.starts_at ?? null,
        ends_at: body.ends_at ?? null,
        pinned: body.pinned,
      },
      now(),
      authorId,
    );
    res.status(201).json({ item });
  });

  router.patch('/admin/content/announcements/:id', requireContentPermission, idempotency, (req, res) => {
    const body = parse(announcementPatchSchema, req.body);
    const item = updateAnnouncement(deps.db, pathParam(req, 'id'), body, now());
    res.json({ item });
  });

  router.delete('/admin/content/announcements/:id', requireContentPermission, idempotency, (req, res) => {
    deleteAnnouncement(deps.db, pathParam(req, 'id'));
    res.json({ ok: true });
  });

  // 公告状态流转：发布（draft/archived → published）、归档（draft/published → archived）；非法流转 409。
  router.post('/admin/content/announcements/:id/publish', requireContentPermission, idempotency, (req, res) => {
    const item = publishAnnouncement(deps.db, pathParam(req, 'id'), now());
    res.json({ item });
  });

  router.post('/admin/content/announcements/:id/archive', requireContentPermission, idempotency, (req, res) => {
    const item = archiveAnnouncement(deps.db, pathParam(req, 'id'), now());
    res.json({ item });
  });

  // --- 更新日志管理 ---
  router.get('/admin/content/changelog', requireContentPermission, (_req, res) => {
    res.json({ items: listAdminChangelog(deps.db) });
  });

  router.post('/admin/content/changelog', requireContentPermission, idempotency, (req, res) => {
    const body = parse(changelogCreateSchema, req.body);
    const item = createChangelogEntry(
      deps.db,
      {
        version: body.version,
        title: body.title,
        body: body.body,
        changes: body.changes,
        published_at: body.published_at ?? null,
        status: body.status,
      },
      now(),
    );
    res.status(201).json({ item });
  });

  router.patch('/admin/content/changelog/:id', requireContentPermission, idempotency, (req, res) => {
    const body = parse(changelogPatchSchema, req.body);
    const item = updateChangelogEntry(deps.db, pathParam(req, 'id'), body, now());
    res.json({ item });
  });

  router.delete('/admin/content/changelog/:id', requireContentPermission, idempotency, (req, res) => {
    deleteChangelogEntry(deps.db, pathParam(req, 'id'));
    res.json({ ok: true });
  });

  // 更新日志状态流转：发布（draft/archived → published，首次写 published_at）、归档；非法流转 409。
  router.post('/admin/content/changelog/:id/publish', requireContentPermission, idempotency, (req, res) => {
    const item = publishChangelogEntry(deps.db, pathParam(req, 'id'), now());
    res.json({ item });
  });

  router.post('/admin/content/changelog/:id/archive', requireContentPermission, idempotency, (req, res) => {
    const item = archiveChangelogEntry(deps.db, pathParam(req, 'id'), now());
    res.json({ item });
  });

  // --- 推广计划管理（统计读取：click_count / conversion_count / budget_cents）---
  router.get('/admin/content/promotions', requireContentPermission, (_req, res) => {
    res.json({ items: listAdminPromotions(deps.db) });
  });

  router.post('/admin/content/promotions', requireContentPermission, idempotency, (req, res) => {
    const body = parse(promotionCreateSchema, req.body);
    const item = createPromotion(
      deps.db,
      {
        name: body.name,
        summary: body.summary,
        target_url: body.target_url,
        code: body.code ?? null,
        starts_at: body.starts_at ?? null,
        ends_at: body.ends_at ?? null,
        status: body.status,
        budget_cents: body.budget_cents,
      },
      now(),
    );
    res.status(201).json({ item });
  });

  router.patch('/admin/content/promotions/:id', requireContentPermission, idempotency, (req, res) => {
    const body = parse(promotionPatchSchema, req.body);
    const item = updatePromotion(deps.db, pathParam(req, 'id'), body, now());
    res.json({ item });
  });

  router.delete('/admin/content/promotions/:id', requireContentPermission, idempotency, (req, res) => {
    deletePromotion(deps.db, pathParam(req, 'id'));
    res.json({ ok: true });
  });

  return router;
}
