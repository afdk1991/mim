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
import { audited, auditActor, writeAudit } from '../audit.js'; // 统一审计留痕：内容上下架等后台写动作必须留痕
import { parse } from '../validate.js'; // 校验错误翻译
import type { ApiDeps } from '../types.js'; // 依赖容器
import { parseLimit, visitorHash } from '../content/shared.js'; // 分页解析与访问者指纹
import { pathParam } from '../utils.js'; // 安全路径参数：拒绝数组与缺失值
import { // 引入依赖、类型或本地模块绑定
  archiveAnnouncement, // 执行当前业务步骤
  countAdminAnnouncements, // 管理端总数
  createAnnouncement, // 执行当前业务步骤
  deleteAnnouncement, // 执行当前业务步骤
  listAdminAnnouncements, // 执行当前业务步骤
  listPublicAnnouncements, // 执行当前业务步骤
  publishAnnouncement, // 执行当前业务步骤
  updateAnnouncement, // 执行当前业务步骤
} from '../content/announcements.js'; // 公告业务函数
import { // 引入依赖、类型或本地模块绑定
  aggregateChangelogByVersion, // 执行当前业务步骤
  archiveChangelogEntry, // 执行当前业务步骤
  countAdminChangelog, // 管理端总数
  createChangelogEntry, // 执行当前业务步骤
  deleteChangelogEntry, // 执行当前业务步骤
  listAdminChangelog, // 执行当前业务步骤
  listPublicChangelog, // 执行当前业务步骤
  publishChangelogEntry, // 执行当前业务步骤
  updateChangelogEntry, // 执行当前业务步骤
} from '../content/changelog.js'; // 更新日志业务函数
import { // 引入依赖、类型或本地模块绑定
  assertClickable, // 执行当前业务步骤
  checkClickRateLimit, // 执行当前业务步骤
  checkConversionRateLimit, // 执行当前业务步骤
  countAdminPromotions, // 管理端总数
  createPromotion, // 执行当前业务步骤
  deletePromotion, // 执行当前业务步骤
  listAdminPromotions, // 执行当前业务步骤
  listPublicPromotions, // 执行当前业务步骤
  recordClick, // 执行当前业务步骤
  recordConversion, // 执行当前业务步骤
  updatePromotion, // 执行当前业务步骤
  type PromotionRow, // 类型别名 PromotionRow：复用一份复合类型定义
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
  const tryGate = (code: string): 'pass' | 'forbidden' => { // 常量 tryGate：保存固定配置或一次性派生值
    try { // 异常捕获起点：包裹可能抛出错误的操作
      requirePermission(code)(req, res, () => {}); // 调用 requirePermission 并处理其返回结果
      return 'pass'; // 返回当前函数的处理结果
    } catch (err) { // 代码块结束
      if (isAppError(err) && err.code === 'FORBIDDEN') return 'forbidden'; // 条件分支：按判断结果选择后续处理路径
      throw err; // 401 / 账号不可用等非权限错误不做降级，原样上交错误处理
    } // 代码块结束
  }; // 代码块结束
  if (tryGate(CONTENT_PERMISSION) === 'pass' || tryGate(LEGACY_PERMISSION) === 'pass') { // 条件分支：按判断结果选择后续处理路径
    next(); // 调用 next 并处理其返回结果
    return; // 返回当前函数的处理结果
  } // 代码块结束
  next(new AppError('FORBIDDEN', 'permission denied', { permission: CONTENT_PERMISSION })); // 调用 next 并处理其返回结果
} // 代码块结束

const DEFAULT_LIMIT = 20; // 公开列表缺省条数
const MAX_LIMIT = 50; // 公开列表硬上限，防止超大列表拖慢查询

/** 管理端列表缺省页大小：仅在显式传 limit 时启用分页，不传仍返回全量。 */
const ADMIN_PAGE_LIMIT = 20;
/** 管理端列表单页硬上限。 */
const ADMIN_PAGE_MAX = 100;

/** 可选分页上限：未传 limit 时返回 undefined，保持「不传即全量」的旧行为。 */
function optionalLimit(raw: unknown): number | undefined {
  const text = String(raw ?? '').trim(); // 空串与缺失一律视为未传
  return text ? parseLimit(text, ADMIN_PAGE_LIMIT, ADMIN_PAGE_MAX) : undefined;
} // 代码块结束

/** 偏移量：非法值与负数统一回落 0。 */
function readOffset(raw: unknown): number {
  const parsed = Number.parseInt(String(raw ?? ''), 10); // 十进制解析
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
} // 代码块结束

/** 公告入参：标题 / 正文 / 级别 / 状态 / 有效期 / 置顶。 */
const announcementCreateSchema = z.object({
  title: z.string().min(1).max(120), // 对象字段 title：记录一项配置或数据
  body: z.string().max(10000).default(''), // 对象字段 body：记录一项配置或数据
  level: z.enum(['info', 'warning', 'success', 'danger']).default('info'), // 对象字段 level：记录一项配置或数据
  status: z.enum(['draft', 'published', 'archived']).default('draft'), // 对象字段 status：记录一项配置或数据
  starts_at: z.string().max(40).nullable().optional(), // 对象字段 starts_at：记录一项配置或数据
  ends_at: z.string().max(40).nullable().optional(), // 对象字段 ends_at：记录一项配置或数据
  pinned: z.boolean().default(false), // 对象字段 pinned：记录一项配置或数据
}); // 代码块结束

/** 公告局部更新：全部字段可选。 */
const announcementPatchSchema = z.object({
  title: z.string().min(1).max(120).optional(), // 对象字段 title：记录一项配置或数据
  body: z.string().max(10000).optional(), // 对象字段 body：记录一项配置或数据
  level: z.enum(['info', 'warning', 'success', 'danger']).optional(), // 对象字段 level：记录一项配置或数据
  status: z.enum(['draft', 'published', 'archived']).optional(), // 对象字段 status：记录一项配置或数据
  starts_at: z.string().max(40).nullable().optional(), // 对象字段 starts_at：记录一项配置或数据
  ends_at: z.string().max(40).nullable().optional(), // 对象字段 ends_at：记录一项配置或数据
  pinned: z.boolean().optional(), // 对象字段 pinned：记录一项配置或数据
}); // 代码块结束

/** 更新日志入参：语义版本号 + 标题 + 正文 + 变更清单 + 发布时间 + 状态。 */
const changelogCreateSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, '版本号须为语义版本，如 0.0.8'), // 对象字段 version：记录一项配置或数据
  title: z.string().min(1).max(120), // 对象字段 title：记录一项配置或数据
  body: z.string().max(10000).default(''), // 对象字段 body：记录一项配置或数据
  changes: z.array(z.string().min(1).max(200)).max(50).default([]), // 对象字段 changes：记录一项配置或数据
  published_at: z.string().max(40).nullable().optional(), // 对象字段 published_at：记录一项配置或数据
  status: z.enum(['draft', 'published', 'archived']).default('draft'), // 对象字段 status：记录一项配置或数据
}); // 代码块结束

/** 更新日志局部更新。 */
const changelogPatchSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, '版本号须为语义版本，如 0.0.8').optional(), // 对象字段 version：记录一项配置或数据
  title: z.string().min(1).max(120).optional(), // 对象字段 title：记录一项配置或数据
  body: z.string().max(10000).optional(), // 对象字段 body：记录一项配置或数据
  changes: z.array(z.string().min(1).max(200)).max(50).optional(), // 对象字段 changes：记录一项配置或数据
  published_at: z.string().max(40).nullable().optional(), // 对象字段 published_at：记录一项配置或数据
  status: z.enum(['draft', 'published', 'archived']).optional(), // 对象字段 status：记录一项配置或数据
}); // 代码块结束

/** 推广计划入参：名称 / 摘要 / 落地页 / 推广码 / 有效期 / 状态 / 预算（最小货币单位，仅统计）。 */
const promotionCreateSchema = z.object({
  name: z.string().min(1).max(120), // 对象字段 name：记录一项配置或数据
  summary: z.string().max(300).default(''), // 对象字段 summary：记录一项配置或数据
  target_url: z.string().max(500).default(''), // 对象字段 target_url：记录一项配置或数据
  code: z.string().max(40).nullable().optional(), // 对象字段 code：记录一项配置或数据
  starts_at: z.string().max(40).nullable().optional(), // 对象字段 starts_at：记录一项配置或数据
  ends_at: z.string().max(40).nullable().optional(), // 对象字段 ends_at：记录一项配置或数据
  status: z.enum(['draft', 'active', 'paused', 'archived']).default('draft'), // 对象字段 status：记录一项配置或数据
  budget_cents: z.number().int().min(0).max(100_000_000).default(0), // 对象字段 budget_cents：记录一项配置或数据
}); // 代码块结束

/** 推广计划局部更新。 */
const promotionPatchSchema = z.object({
  name: z.string().min(1).max(120).optional(), // 对象字段 name：记录一项配置或数据
  summary: z.string().max(300).optional(), // 对象字段 summary：记录一项配置或数据
  target_url: z.string().max(500).optional(), // 对象字段 target_url：记录一项配置或数据
  code: z.string().max(40).nullable().optional(), // 对象字段 code：记录一项配置或数据
  starts_at: z.string().max(40).nullable().optional(), // 对象字段 starts_at：记录一项配置或数据
  ends_at: z.string().max(40).nullable().optional(), // 对象字段 ends_at：记录一项配置或数据
  status: z.enum(['draft', 'active', 'paused', 'archived']).optional(), // 对象字段 status：记录一项配置或数据
  budget_cents: z.number().int().min(0).max(100_000_000).optional(), // 对象字段 budget_cents：记录一项配置或数据
}); // 代码块结束

/** 路由工厂：依赖显式注入，测试可整体替换内存库与替身环境。 */
export function createContentOpsRouter(deps: ApiDeps): Router {
  const router = Router(); // 常量 router：保存固定配置或一次性派生值
  const now = () => (deps.now ? deps.now() : new Date().toISOString()); // 可注入时钟，便于过期 / 频控断言

  // ===== 公开端点（免鉴权，须在全局 requireAuth 之前挂载）=====

  /** 公开公告列表：置顶优先 + 发布时间倒序，只回已发布且在有效期内。 */
  router.get('/announcements', (req, res) => {
    const limit = parseLimit(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT); // 常量 limit：保存固定配置或一次性派生值
    const items = listPublicAnnouncements(deps.db, now(), limit); // 常量 items：保存固定配置或一次性派生值
    res.json({ items }); // 执行当前业务步骤
  }); // 代码块结束

  /** 公开更新日志：语义版本倒序 + 同版本时间倒序。 */
  router.get('/changelog', (req, res) => {
    const limit = parseLimit(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT); // 常量 limit：保存固定配置或一次性派生值
    const items = listPublicChangelog(deps.db, limit); // 常量 items：保存固定配置或一次性派生值
    res.json({ items }); // 执行当前业务步骤
  }); // 代码块结束

  /** 更新日志按版本聚合视图：每版本取最新一条 + 条目数，版本倒序。 */
  router.get('/changelog/versions', (_req, res) => {
    const items = aggregateChangelogByVersion(deps.db); // 常量 items：保存固定配置或一次性派生值
    res.json({ items }); // 执行当前业务步骤
  }); // 代码块结束

  /** 公开推广计划：只回进行中且在有效期内。 */
  router.get('/promotions', (_req, res) => {
    const items = listPublicPromotions(deps.db, now()); // 常量 items：保存固定配置或一次性派生值
    res.json({ items }); // 执行当前业务步骤
  }); // 代码块结束

  /**
   * 推广点击计数：公开端点，匿名可点。
   * 幂等键（Idempotency-Key）同计划同键只入账一次；访问者指纹做滑动窗口频控防刷。
   * 本端点不走全局 idempotency 中间件（该中间件要求登录主体），去重在 promotion_clicks 表内完成。
   */
  router.post('/promotions/:id/click', (req, res) => {
    const promotion = deps.db.prepare('SELECT * FROM promotions WHERE id = ?').get(pathParam(req, 'id')) as // 常量 promotion：保存固定配置或一次性派生值
      | PromotionRow // 执行当前业务步骤
      | undefined; // 执行当前业务步骤
    if (!promotion) throw new AppError('NOT_FOUND', '推广计划不存在'); // 条件分支：按判断结果选择后续处理路径
    assertClickable(promotion, now()); // 调用 assertClickable 并处理其返回结果

    const idempotencyKey = (req.header('idempotency-key') ?? '').trim() || null; // 常量 idempotencyKey：保存固定配置或一次性派生值
    const visitor = visitorHash(req, deps); // 常量 visitor：保存固定配置或一次性派生值

    const violation = checkClickRateLimit(deps.db, deps.env, promotion.id, visitor, now()); // 常量 violation：保存固定配置或一次性派生值
    if (violation) { // 条件分支：按判断结果选择后续处理路径
      res.setHeader('Retry-After', String(violation.retryAfter)); // 客户端按退避秒数重试
      throw new AppError('RATE_LIMITED', '点击过于频繁，请稍后再试', { retry_after: violation.retryAfter }); // 抛出错误：中断当前流程并向上层传递
    } // 代码块结束

    const result = recordClick(deps.db, promotion.id, idempotencyKey, visitor, now()); // 常量 result：保存固定配置或一次性派生值
    res.json({ ok: true, deduped: result.deduped, click_count: result.clickCount }); // 执行当前业务步骤
  }); // 代码块结束

  /**
   * 转化回写：公开端点，匿名可上报。
   * 与点击同口径：幂等键（Idempotency-Key）同计划同键只入账一次；访问者指纹做滑动窗口频控防刷。
   * 只累计 conversion_count，不记佣金、不做资金结算；去重在 promotion_conversions 表内完成。
   */
  router.post('/promotions/:id/conversion', (req, res) => {
    const promotion = deps.db.prepare('SELECT * FROM promotions WHERE id = ?').get(pathParam(req, 'id')) as // 常量 promotion：保存固定配置或一次性派生值
      | PromotionRow // 执行当前业务步骤
      | undefined; // 执行当前业务步骤
    if (!promotion) throw new AppError('NOT_FOUND', '推广计划不存在'); // 条件分支：按判断结果选择后续处理路径
    assertClickable(promotion, now()); // 调用 assertClickable 并处理其返回结果

    const idempotencyKey = (req.header('idempotency-key') ?? '').trim() || null; // 常量 idempotencyKey：保存固定配置或一次性派生值
    const visitor = visitorHash(req, deps); // 常量 visitor：保存固定配置或一次性派生值

    const violation = checkConversionRateLimit(deps.db, deps.env, promotion.id, visitor, now()); // 常量 violation：保存固定配置或一次性派生值
    if (violation) { // 条件分支：按判断结果选择后续处理路径
      res.setHeader('Retry-After', String(violation.retryAfter)); // 客户端按退避秒数重试
      throw new AppError('RATE_LIMITED', '转化上报过于频繁，请稍后再试', { retry_after: violation.retryAfter }); // 抛出错误：中断当前流程并向上层传递
    } // 代码块结束

    const result = recordConversion(deps.db, promotion.id, idempotencyKey, visitor, now()); // 常量 result：保存固定配置或一次性派生值
    res.json({ ok: true, deduped: result.deduped, conversion_count: result.conversionCount }); // 执行当前业务步骤
  }); // 代码块结束

  // ===== 管理端端点（工厂内挂 requirePermission；写操作叠 idempotency）=====

  // --- 公告管理 ---
  router.get('/admin/content/announcements', requireContentPermission, (req, res) => {
    const items = listAdminAnnouncements(deps.db, optionalLimit(req.query.limit), readOffset(req.query.offset));
    res.json({ items, total: countAdminAnnouncements(deps.db) }); // 新增 total，旧字段 items 保持不变
  }); // 代码块结束

  router.post('/admin/content/announcements', requireContentPermission, idempotency, (req, res) => { // 执行当前业务步骤
    const body = parse(announcementCreateSchema, req.body); // 常量 body：保存固定配置或一次性派生值
    const authorId = req.user?.id ?? 'system'; // 引导通道无用户主体，记 system 留痕
    const item = createAnnouncement( // 常量 item：保存固定配置或一次性派生值
      deps.db, // 执行当前业务步骤
      { // 执行当前业务步骤
        title: body.title, // 对象字段 title：记录一项配置或数据
        body: body.body, // 对象字段 body：记录一项配置或数据
        level: body.level, // 对象字段 level：记录一项配置或数据
        status: body.status, // 对象字段 status：记录一项配置或数据
        starts_at: body.starts_at ?? null, // 对象字段 starts_at：记录一项配置或数据
        ends_at: body.ends_at ?? null, // 对象字段 ends_at：记录一项配置或数据
        pinned: body.pinned, // 对象字段 pinned：记录一项配置或数据
      }, // 代码块结束
      now(), // 调用 now 并处理其返回结果
      authorId, // 执行当前业务步骤
    ); // 执行当前业务步骤
    writeAudit(deps.db, auditActor(req), { // 新建公告留痕：对象主键取落库后回读的行 ID
      action: 'content.announcement.create', // 动作码：新增公告
      targetType: 'announcement', // 对象类型
      targetId: item.id, // 对象主键：公告 ID
      detail: { title: body.title, level: body.level, status: body.status, pinned: body.pinned }, // 明细：只记摘要字段
    }); // 审计写入结束
    res.status(201).json({ item }); // 执行当前业务步骤
  }); // 代码块结束

  router.patch('/admin/content/announcements/:id', requireContentPermission, idempotency, (req, res) => { // 执行当前业务步骤
    const body = parse(announcementPatchSchema, req.body); // 常量 body：保存固定配置或一次性派生值
    const item = audited(deps.db, auditActor(req), { // 修改公告与审计同属一次敏感操作
      action: 'content.announcement.update', // 动作码：修改公告
      targetType: 'announcement', // 对象类型
      targetId: pathParam(req, 'id'), // 对象主键：公告 ID
      detail: body, // 明细：本次补丁字段
    }, () => updateAnnouncement(deps.db, pathParam(req, 'id'), body, now())); // 常量 item：保存固定配置或一次性派生值
    res.json({ item }); // 执行当前业务步骤
  }); // 代码块结束

  router.delete('/admin/content/announcements/:id', requireContentPermission, idempotency, (req, res) => { // 执行当前业务步骤
    const id = pathParam(req, 'id'); // 路径参数收敛
    audited(deps.db, auditActor(req), { // 删除公告与审计同属一次敏感操作
      action: 'content.announcement.delete', // 动作码：删除公告
      targetType: 'announcement', // 对象类型
      targetId: id, // 对象主键：公告 ID
    }, () => deleteAnnouncement(deps.db, id)); // 调用 deleteAnnouncement 并处理其返回结果
    res.json({ ok: true }); // 执行当前业务步骤
  }); // 代码块结束

  // 公告状态流转：发布（draft/archived → published）、归档（draft/published → archived）；非法流转 409。
  router.post('/admin/content/announcements/:id/publish', requireContentPermission, idempotency, (req, res) => {
    const id = pathParam(req, 'id'); // 路径参数收敛
    const item = audited(deps.db, auditActor(req), { // 发布公告与审计同属一次敏感操作
      action: 'content.announcement.publish', // 动作码：发布公告
      targetType: 'announcement', // 对象类型
      targetId: id, // 对象主键：公告 ID
    }, () => publishAnnouncement(deps.db, id, now())); // 常量 item：保存固定配置或一次性派生值
    res.json({ item }); // 执行当前业务步骤
  }); // 代码块结束

  router.post('/admin/content/announcements/:id/archive', requireContentPermission, idempotency, (req, res) => { // 执行当前业务步骤
    const id = pathParam(req, 'id'); // 路径参数收敛
    const item = audited(deps.db, auditActor(req), { // 归档公告与审计同属一次敏感操作
      action: 'content.announcement.archive', // 动作码：归档公告
      targetType: 'announcement', // 对象类型
      targetId: id, // 对象主键：公告 ID
    }, () => archiveAnnouncement(deps.db, id, now())); // 常量 item：保存固定配置或一次性派生值
    res.json({ item }); // 执行当前业务步骤
  }); // 代码块结束

  // --- 更新日志管理 ---
  router.get('/admin/content/changelog', requireContentPermission, (req, res) => {
    const items = listAdminChangelog(deps.db, optionalLimit(req.query.limit), readOffset(req.query.offset));
    res.json({ items, total: countAdminChangelog(deps.db) }); // 新增 total，旧字段 items 保持不变
  }); // 代码块结束

  router.post('/admin/content/changelog', requireContentPermission, idempotency, (req, res) => { // 执行当前业务步骤
    const body = parse(changelogCreateSchema, req.body); // 常量 body：保存固定配置或一次性派生值
    const item = createChangelogEntry( // 常量 item：保存固定配置或一次性派生值
      deps.db, // 执行当前业务步骤
      { // 执行当前业务步骤
        version: body.version, // 对象字段 version：记录一项配置或数据
        title: body.title, // 对象字段 title：记录一项配置或数据
        body: body.body, // 对象字段 body：记录一项配置或数据
        changes: body.changes, // 对象字段 changes：记录一项配置或数据
        published_at: body.published_at ?? null, // 对象字段 published_at：记录一项配置或数据
        status: body.status, // 对象字段 status：记录一项配置或数据
      }, // 代码块结束
      now(), // 调用 now 并处理其返回结果
    ); // 执行当前业务步骤
    writeAudit(deps.db, auditActor(req), { // 新建更新日志留痕：对象主键取落库后回读的行 ID
      action: 'content.changelog.create', // 动作码：新增更新日志
      targetType: 'changelog', // 对象类型
      targetId: item.id, // 对象主键：日志条目 ID
      detail: { version: body.version, title: body.title, status: body.status }, // 明细：只记摘要字段
    }); // 审计写入结束
    res.status(201).json({ item }); // 执行当前业务步骤
  }); // 代码块结束

  router.patch('/admin/content/changelog/:id', requireContentPermission, idempotency, (req, res) => { // 执行当前业务步骤
    const body = parse(changelogPatchSchema, req.body); // 常量 body：保存固定配置或一次性派生值
    const item = audited(deps.db, auditActor(req), { // 修改更新日志与审计同属一次敏感操作
      action: 'content.changelog.update', // 动作码：修改更新日志
      targetType: 'changelog', // 对象类型
      targetId: pathParam(req, 'id'), // 对象主键：日志条目 ID
      detail: body, // 明细：本次补丁字段
    }, () => updateChangelogEntry(deps.db, pathParam(req, 'id'), body, now())); // 常量 item：保存固定配置或一次性派生值
    res.json({ item }); // 执行当前业务步骤
  }); // 代码块结束

  router.delete('/admin/content/changelog/:id', requireContentPermission, idempotency, (req, res) => { // 执行当前业务步骤
    const id = pathParam(req, 'id'); // 路径参数收敛
    audited(deps.db, auditActor(req), { // 删除更新日志与审计同属一次敏感操作
      action: 'content.changelog.delete', // 动作码：删除更新日志
      targetType: 'changelog', // 对象类型
      targetId: id, // 对象主键：日志条目 ID
    }, () => deleteChangelogEntry(deps.db, id)); // 调用 deleteChangelogEntry 并处理其返回结果
    res.json({ ok: true }); // 执行当前业务步骤
  }); // 代码块结束

  // 更新日志状态流转：发布（draft/archived → published，首次写 published_at）、归档；非法流转 409。
  router.post('/admin/content/changelog/:id/publish', requireContentPermission, idempotency, (req, res) => {
    const id = pathParam(req, 'id'); // 路径参数收敛
    const item = audited(deps.db, auditActor(req), { // 发布更新日志与审计同属一次敏感操作
      action: 'content.changelog.publish', // 动作码：发布更新日志
      targetType: 'changelog', // 对象类型
      targetId: id, // 对象主键：日志条目 ID
    }, () => publishChangelogEntry(deps.db, id, now())); // 常量 item：保存固定配置或一次性派生值
    res.json({ item }); // 执行当前业务步骤
  }); // 代码块结束

  router.post('/admin/content/changelog/:id/archive', requireContentPermission, idempotency, (req, res) => { // 执行当前业务步骤
    const id = pathParam(req, 'id'); // 路径参数收敛
    const item = audited(deps.db, auditActor(req), { // 归档更新日志与审计同属一次敏感操作
      action: 'content.changelog.archive', // 动作码：归档更新日志
      targetType: 'changelog', // 对象类型
      targetId: id, // 对象主键：日志条目 ID
    }, () => archiveChangelogEntry(deps.db, id, now())); // 常量 item：保存固定配置或一次性派生值
    res.json({ item }); // 执行当前业务步骤
  }); // 代码块结束

  // --- 推广计划管理（统计读取：click_count / conversion_count / budget_cents）---
  router.get('/admin/content/promotions', requireContentPermission, (req, res) => {
    const items = listAdminPromotions(deps.db, optionalLimit(req.query.limit), readOffset(req.query.offset));
    res.json({ items, total: countAdminPromotions(deps.db) }); // 新增 total，旧字段 items 保持不变
  }); // 代码块结束

  router.post('/admin/content/promotions', requireContentPermission, idempotency, (req, res) => { // 执行当前业务步骤
    const body = parse(promotionCreateSchema, req.body); // 常量 body：保存固定配置或一次性派生值
    const item = createPromotion( // 常量 item：保存固定配置或一次性派生值
      deps.db, // 执行当前业务步骤
      { // 执行当前业务步骤
        name: body.name, // 对象字段 name：记录一项配置或数据
        summary: body.summary, // 对象字段 summary：记录一项配置或数据
        target_url: body.target_url, // 对象字段 target_url：记录一项配置或数据
        code: body.code ?? null, // 对象字段 code：记录一项配置或数据
        starts_at: body.starts_at ?? null, // 对象字段 starts_at：记录一项配置或数据
        ends_at: body.ends_at ?? null, // 对象字段 ends_at：记录一项配置或数据
        status: body.status, // 对象字段 status：记录一项配置或数据
        budget_cents: body.budget_cents, // 对象字段 budget_cents：记录一项配置或数据
      }, // 代码块结束
      now(), // 调用 now 并处理其返回结果
    ); // 执行当前业务步骤
    writeAudit(deps.db, auditActor(req), { // 新建推广计划留痕：对象主键取落库后回读的行 ID
      action: 'content.promotion.create', // 动作码：新增推广计划
      targetType: 'promotion', // 对象类型
      targetId: item.id, // 对象主键：推广计划 ID
      detail: { name: body.name, status: body.status, budget_cents: body.budget_cents }, // 明细：只记摘要字段
    }); // 审计写入结束
    res.status(201).json({ item }); // 执行当前业务步骤
  }); // 代码块结束

  router.patch('/admin/content/promotions/:id', requireContentPermission, idempotency, (req, res) => { // 执行当前业务步骤
    const body = parse(promotionPatchSchema, req.body); // 常量 body：保存固定配置或一次性派生值
    const item = audited(deps.db, auditActor(req), { // 修改推广计划与审计同属一次敏感操作
      action: 'content.promotion.update', // 动作码：修改推广计划
      targetType: 'promotion', // 对象类型
      targetId: pathParam(req, 'id'), // 对象主键：推广计划 ID
      detail: body, // 明细：本次补丁字段
    }, () => updatePromotion(deps.db, pathParam(req, 'id'), body, now())); // 常量 item：保存固定配置或一次性派生值
    res.json({ item }); // 执行当前业务步骤
  }); // 代码块结束

  router.delete('/admin/content/promotions/:id', requireContentPermission, idempotency, (req, res) => { // 执行当前业务步骤
    const id = pathParam(req, 'id'); // 路径参数收敛
    audited(deps.db, auditActor(req), { // 删除推广计划与审计同属一次敏感操作
      action: 'content.promotion.delete', // 动作码：删除推广计划
      targetType: 'promotion', // 对象类型
      targetId: id, // 对象主键：推广计划 ID
    }, () => deletePromotion(deps.db, id)); // 调用 deletePromotion 并处理其返回结果
    res.json({ ok: true }); // 执行当前业务步骤
  }); // 代码块结束

  return router; // 返回当前函数的处理结果
} // 代码块结束
