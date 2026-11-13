/**
 * 内容运营路由工厂：公告 / 更新日志 / 推广计划。
 *
 * 挂载模型（与 catalog / community 等混装路由一致）：
 *   - 公开 GET 与点击端点免鉴权，工厂整体须挂在全局 requireAuth 之前；
 *   - 管理端 CRUD 在工厂内部逐路由挂 requirePermission('appearance:write')，写操作再叠 idempotency。
 *
 * 冻结公开契约：
 *   GET /api/v1/announcements?limit=   → { items: [{ id, title, body, pinned, published_at }] }
 *   GET /api/v1/changelog?limit=       → { items: [{ id, version, title, body, published_at }] }
 *   GET /api/v1/promotions             → { items: [{ id, name, summary, target_url, starts_at, ends_at, status }] }
 */

import { Router } from 'express'; // 路由容器
import { z } from 'zod'; // 入参校验
import { AppError } from '@mim/core-domain'; // 统一业务异常
import { idempotency, requirePermission } from '../middleware.js'; // 鉴权门禁与写幂等
import { parse } from '../validate.js'; // 校验错误翻译
import type { ApiDeps } from '../types.js'; // 依赖容器
import { parseLimit, visitorHash } from '../content/shared.js'; // 分页解析与访客指纹
import { pathParam } from '../utils.js'; // 安全路径参数：拒绝数组与缺失值
import { // 业务步骤
  createAnnouncement, // 业务步骤
  deleteAnnouncement, // 业务步骤
  listAdminAnnouncements, // 业务步骤
  listPublicAnnouncements, // 业务步骤
  updateAnnouncement, // 业务步骤
} from '../content/announcements.js'; // 公告业务函数
import { // 业务步骤
  aggregateChangelogByVersion, // 业务步骤
  createChangelogEntry, // 业务步骤
  deleteChangelogEntry, // 业务步骤
  listAdminChangelog, // 业务步骤
  listPublicChangelog, // 业务步骤
  updateChangelogEntry, // 业务步骤
} from '../content/changelog.js'; // 更新日志业务函数
import { // 业务步骤
  assertClickable, // 业务步骤
  checkClickRateLimit, // 业务步骤
  createPromotion, // 业务步骤
  deletePromotion, // 业务步骤
  listAdminPromotions, // 业务步骤
  listPublicPromotions, // 业务步骤
  recordClick, // 业务步骤
  updatePromotion, // 业务步骤
  type PromotionRow, // 业务步骤
} from '../content/promotions.js'; // 推广计划业务函数

/**
 * 本包管理端权限码：复用已种子化的 `appearance:write`（运营内容维护），与社区板块审核同一口径。
 * 待 RBAC 包在权限点清单登记独立的 `content:write` 后，可在此切换；超管引导令牌（x-admin-token）视同全权限。
 */
const CONTENT_PERMISSION = 'appearance:write'; // 业务步骤

const DEFAULT_LIMIT = 20; // 公开列表缺省条数
const MAX_LIMIT = 50; // 公开列表硬上限，防止超大列表拖慢查询

/** 公告入参：标题 / 正文 / 级别 / 状态 / 有效期 / 置顶。 */
const announcementCreateSchema = z.object({ // 业务步骤
  title: z.string().min(1).max(120), // 业务步骤
  body: z.string().max(10000).default(''), // 业务步骤
  level: z.enum(['info', 'warning', 'success', 'danger']).default('info'), // 业务步骤
  status: z.enum(['draft', 'published', 'archived']).default('draft'), // 业务步骤
  starts_at: z.string().max(40).nullable().optional(), // 业务步骤
  ends_at: z.string().max(40).nullable().optional(), // 业务步骤
  pinned: z.boolean().default(false), // 业务步骤
}); // 业务步骤

/** 公告局部更新：全部字段可选。 */
const announcementPatchSchema = z.object({ // 业务步骤
  title: z.string().min(1).max(120).optional(), // 业务步骤
  body: z.string().max(10000).optional(), // 业务步骤
  level: z.enum(['info', 'warning', 'success', 'danger']).optional(), // 业务步骤
  status: z.enum(['draft', 'published', 'archived']).optional(), // 业务步骤
  starts_at: z.string().max(40).nullable().optional(), // 业务步骤
  ends_at: z.string().max(40).nullable().optional(), // 业务步骤
  pinned: z.boolean().optional(), // 业务步骤
}); // 业务步骤

/** 更新日志入参：语义版本号 + 标题 + 正文 + 变更清单 + 发布时间 + 状态。 */
const changelogCreateSchema = z.object({ // 业务步骤
  version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, '版本号须为语义版本，如 0.0.8'), // 业务步骤
  title: z.string().min(1).max(120), // 业务步骤
  body: z.string().max(10000).default(''), // 业务步骤
  changes: z.array(z.string().min(1).max(200)).max(50).default([]), // 业务步骤
  published_at: z.string().max(40).nullable().optional(), // 业务步骤
  status: z.enum(['draft', 'published', 'archived']).default('draft'), // 业务步骤
}); // 业务步骤

/** 更新日志局部更新。 */
const changelogPatchSchema = z.object({ // 业务步骤
  version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, '版本号须为语义版本，如 0.0.8').optional(), // 业务步骤
  title: z.string().min(1).max(120).optional(), // 业务步骤
  body: z.string().max(10000).optional(), // 业务步骤
  changes: z.array(z.string().min(1).max(200)).max(50).optional(), // 业务步骤
  published_at: z.string().max(40).nullable().optional(), // 业务步骤
  status: z.enum(['draft', 'published', 'archived']).optional(), // 业务步骤
}); // 业务步骤

/** 推广计划入参：名称 / 摘要 / 落地页 / 推广码 / 有效期 / 状态 / 预算（最小货币单位，仅统计）。 */
const promotionCreateSchema = z.object({ // 业务步骤
  name: z.string().min(1).max(120), // 业务步骤
  summary: z.string().max(300).default(''), // 业务步骤
  target_url: z.string().max(500).default(''), // 业务步骤
  code: z.string().max(40).nullable().optional(), // 业务步骤
  starts_at: z.string().max(40).nullable().optional(), // 业务步骤
  ends_at: z.string().max(40).nullable().optional(), // 业务步骤
  status: z.enum(['draft', 'active', 'paused', 'archived']).default('draft'), // 业务步骤
  budget_cents: z.number().int().min(0).max(100_000_000).default(0), // 业务步骤
}); // 业务步骤

/** 推广计划局部更新。 */
const promotionPatchSchema = z.object({ // 业务步骤
  name: z.string().min(1).max(120).optional(), // 业务步骤
  summary: z.string().max(300).optional(), // 业务步骤
  target_url: z.string().max(500).optional(), // 业务步骤
  code: z.string().max(40).nullable().optional(), // 业务步骤
  starts_at: z.string().max(40).nullable().optional(), // 业务步骤
  ends_at: z.string().max(40).nullable().optional(), // 业务步骤
  status: z.enum(['draft', 'active', 'paused', 'archived']).optional(), // 业务步骤
  budget_cents: z.number().int().min(0).max(100_000_000).optional(), // 业务步骤
}); // 业务步骤

/** 路由工厂：依赖显式注入，测试可整体替换内存库与替身环境。 */
export function createContentOpsRouter(deps: ApiDeps): Router { // 业务步骤
  const router = Router(); // 业务步骤
  const now = () => (deps.now ? deps.now() : new Date().toISOString()); // 可注入时钟，便于过期 / 频控断言

  // ===== 公开端点（免鉴权，须在全局 requireAuth 之前挂载）=====

  /** 公开公告列表：置顶优先 + 发布时间倒序，只回已发布且在有效期内。 */
  router.get('/announcements', (req, res) => { // 业务步骤
    const limit = parseLimit(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT); // 业务步骤
    const items = listPublicAnnouncements(deps.db, now(), limit); // 业务步骤
    res.json({ items }); // 业务步骤
  }); // 业务步骤

  /** 公开更新日志：语义版本倒序 + 同版本时间倒序。 */
  router.get('/changelog', (req, res) => { // 业务步骤
    const limit = parseLimit(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT); // 业务步骤
    const items = listPublicChangelog(deps.db, limit); // 业务步骤
    res.json({ items }); // 业务步骤
  }); // 业务步骤

  /** 更新日志按版本聚合视图：每版本取最新一条 + 条目数，版本倒序。 */
  router.get('/changelog/versions', (_req, res) => { // 业务步骤
    const items = aggregateChangelogByVersion(deps.db); // 业务步骤
    res.json({ items }); // 业务步骤
  }); // 业务步骤

  /** 公开推广计划：只回进行中且在有效期内。 */
  router.get('/promotions', (_req, res) => { // 业务步骤
    const items = listPublicPromotions(deps.db, now()); // 业务步骤
    res.json({ items }); // 业务步骤
  }); // 业务步骤

  /**
   * 推广点击计数：公开端点，匿名可点。
   * 幂等键（Idempotency-Key）同计划同键只入账一次；访客指纹做滑动窗口频控防刷。
   * 本端点不走全局 idempotency 中间件（该中间件要求登录主体），去重在 promotion_clicks 表内完成。
   */
  router.post('/promotions/:id/click', (req, res) => { // 业务步骤
    const promotion = deps.db.prepare('SELECT * FROM promotions WHERE id = ?').get(pathParam(req, 'id')) as // 业务步骤
      | PromotionRow // 业务步骤
      | undefined; // 业务步骤
    if (!promotion) throw new AppError('NOT_FOUND', '推广计划不存在'); // 业务步骤
    assertClickable(promotion, now()); // 业务步骤

    const idempotencyKey = (req.header('idempotency-key') ?? '').trim() || null; // 业务步骤
    const visitor = visitorHash(req, deps); // 业务步骤

    const violation = checkClickRateLimit(deps.db, deps.env, promotion.id, visitor, now()); // 业务步骤
    if (violation) { // 业务步骤
      res.setHeader('Retry-After', String(violation.retryAfter)); // 客户端按退避秒数重试
      throw new AppError('RATE_LIMITED', '点击过于频繁，请稍后再试', { retry_after: violation.retryAfter }); // 业务步骤
    } // 业务步骤

    const result = recordClick(deps.db, promotion.id, idempotencyKey, visitor, now()); // 业务步骤
    res.json({ ok: true, deduped: result.deduped, click_count: result.clickCount }); // 业务步骤
  }); // 业务步骤

  // ===== 管理端端点（工厂内挂 requirePermission；写操作叠 idempotency）=====

  // --- 公告管理 ---
  router.get('/admin/content/announcements', requirePermission(CONTENT_PERMISSION), (_req, res) => { // 业务步骤
    res.json({ items: listAdminAnnouncements(deps.db) }); // 业务步骤
  }); // 业务步骤

  router.post('/admin/content/announcements', requirePermission(CONTENT_PERMISSION), idempotency, (req, res) => { // 业务步骤
    const body = parse(announcementCreateSchema, req.body); // 业务步骤
    const authorId = req.user?.id ?? 'system'; // 引导通道无用户主体，记 system 留痕
    const item = createAnnouncement( // 业务步骤
      deps.db, // 业务步骤
      { // 业务步骤
        title: body.title, // 业务步骤
        body: body.body, // 业务步骤
        level: body.level, // 业务步骤
        status: body.status, // 业务步骤
        starts_at: body.starts_at ?? null, // 业务步骤
        ends_at: body.ends_at ?? null, // 业务步骤
        pinned: body.pinned, // 业务步骤
      }, // 业务步骤
      now(), // 业务步骤
      authorId, // 业务步骤
    ); // 业务步骤
    res.status(201).json({ item }); // 业务步骤
  }); // 业务步骤

  router.patch('/admin/content/announcements/:id', requirePermission(CONTENT_PERMISSION), idempotency, (req, res) => { // 业务步骤
    const body = parse(announcementPatchSchema, req.body); // 业务步骤
    const item = updateAnnouncement(deps.db, pathParam(req, 'id'), body, now()); // 业务步骤
    res.json({ item }); // 业务步骤
  }); // 业务步骤

  router.delete('/admin/content/announcements/:id', requirePermission(CONTENT_PERMISSION), idempotency, (req, res) => { // 业务步骤
    deleteAnnouncement(deps.db, pathParam(req, 'id')); // 业务步骤
    res.json({ ok: true }); // 业务步骤
  }); // 业务步骤

  // --- 更新日志管理 ---
  router.get('/admin/content/changelog', requirePermission(CONTENT_PERMISSION), (_req, res) => { // 业务步骤
    res.json({ items: listAdminChangelog(deps.db) }); // 业务步骤
  }); // 业务步骤

  router.post('/admin/content/changelog', requirePermission(CONTENT_PERMISSION), idempotency, (req, res) => { // 业务步骤
    const body = parse(changelogCreateSchema, req.body); // 业务步骤
    const item = createChangelogEntry( // 业务步骤
      deps.db, // 业务步骤
      { // 业务步骤
        version: body.version, // 业务步骤
        title: body.title, // 业务步骤
        body: body.body, // 业务步骤
        changes: body.changes, // 业务步骤
        published_at: body.published_at ?? null, // 业务步骤
        status: body.status, // 业务步骤
      }, // 业务步骤
      now(), // 业务步骤
    ); // 业务步骤
    res.status(201).json({ item }); // 业务步骤
  }); // 业务步骤

  router.patch('/admin/content/changelog/:id', requirePermission(CONTENT_PERMISSION), idempotency, (req, res) => { // 业务步骤
    const body = parse(changelogPatchSchema, req.body); // 业务步骤
    const item = updateChangelogEntry(deps.db, pathParam(req, 'id'), body, now()); // 业务步骤
    res.json({ item }); // 业务步骤
  }); // 业务步骤

  router.delete('/admin/content/changelog/:id', requirePermission(CONTENT_PERMISSION), idempotency, (req, res) => { // 业务步骤
    deleteChangelogEntry(deps.db, pathParam(req, 'id')); // 业务步骤
    res.json({ ok: true }); // 业务步骤
  }); // 业务步骤

  // --- 推广计划管理（统计读取：click_count / conversion_count / budget_cents）---
  router.get('/admin/content/promotions', requirePermission(CONTENT_PERMISSION), (_req, res) => { // 业务步骤
    res.json({ items: listAdminPromotions(deps.db) }); // 业务步骤
  }); // 业务步骤

  router.post('/admin/content/promotions', requirePermission(CONTENT_PERMISSION), idempotency, (req, res) => { // 业务步骤
    const body = parse(promotionCreateSchema, req.body); // 业务步骤
    const item = createPromotion( // 业务步骤
      deps.db, // 业务步骤
      { // 业务步骤
        name: body.name, // 业务步骤
        summary: body.summary, // 业务步骤
        target_url: body.target_url, // 业务步骤
        code: body.code ?? null, // 业务步骤
        starts_at: body.starts_at ?? null, // 业务步骤
        ends_at: body.ends_at ?? null, // 业务步骤
        status: body.status, // 业务步骤
        budget_cents: body.budget_cents, // 业务步骤
      }, // 业务步骤
      now(), // 业务步骤
    ); // 业务步骤
    res.status(201).json({ item }); // 业务步骤
  }); // 业务步骤

  router.patch('/admin/content/promotions/:id', requirePermission(CONTENT_PERMISSION), idempotency, (req, res) => { // 业务步骤
    const body = parse(promotionPatchSchema, req.body); // 业务步骤
    const item = updatePromotion(deps.db, pathParam(req, 'id'), body, now()); // 业务步骤
    res.json({ item }); // 业务步骤
  }); // 业务步骤

  router.delete('/admin/content/promotions/:id', requirePermission(CONTENT_PERMISSION), idempotency, (req, res) => { // 业务步骤
    deletePromotion(deps.db, pathParam(req, 'id')); // 业务步骤
    res.json({ ok: true }); // 业务步骤
  }); // 业务步骤

  return router; // 业务步骤
} // 业务步骤
