/**
 * 社区激励链 · 路由（用户侧 + 管理侧）。
 *
 * 用户侧（requireAuth）：
 *   GET  /api/v1/growth/checkin  — 今日签到状态与下次可得分
 *   POST /api/v1/growth/checkin  — 执行签到（重复签到返回 already_checked_in=true，不重复发分）
 *   GET  /api/v1/growth/points   — 积分余额与流水（走既有钱包账本）
 *   GET  /api/v1/growth/level    — 等级进度（当前等级 / 下一级还差多少）
 *   GET  /api/v1/growth/badges   — 我的徽章（含未获得徽章的条件进度）
 *
 * 管理侧（沿用后台既有 content:write 权限口径，写操作全部接 audit）：
 *   GET/PUT  /api/v1/admin/growth/config          — 签到规则与换天时区
 *   GET/PUT  /api/v1/admin/growth/levels          — 等级门槛与权益整表读写
 *   GET      /api/v1/admin/growth/badges          — 徽章定义列表（含停用）
 *   POST     /api/v1/admin/growth/badges          — 新建徽章
 *   PUT      /api/v1/admin/growth/badges/:code    — 修改徽章（编码不可改）
 *   DELETE   /api/v1/admin/growth/badges/:code    — 停用徽章（保留已授予记录）
 *   POST     /api/v1/admin/growth/badge-grants    — 手动授予徽章
 */

import { Router } from 'express'; // 路由容器
import { z } from 'zod'; // 入参校验
import { requireAuth, requirePermission } from '../middleware.js'; // 登录态与 RBAC
import { auditActor, audited } from '../audit.js'; // 后台写操作留痕
import { parse } from '../validate.js'; // zod 校验统一入口
import type { ApiDeps } from '../types.js'; // 依赖容器
import {
  createBadge,
  disableBadge,
  getCheckinStatus,
  getGrowthConfig,
  getLevelProgress,
  grantBadgeManually,
  listBadgeDefinitions,
  listLevels,
  listMyBadges,
  listPointsLedger,
  performCheckin,
  replaceLevels,
  saveGrowthConfig,
  updateBadge,
} from '../growth/service.js'; // 激励链领域服务

/** 签到规则入参：全部可选，未传字段沿用现值 */
const checkinRulesSchema = z.object({
  base_points: z.number().int().min(0).max(1000).optional(), // 基础分
  streak_bonus_per_day: z.number().int().min(0).max(100).optional(), // 每日连续加成
  streak_bonus_cap: z.number().int().min(0).max(365).optional(), // 加成封顶天数
});

/** 配置入参 */
const configSchema = z.object({
  timezone: z.string().trim().min(1).max(64).optional(), // IANA 时区
  checkin: checkinRulesSchema.optional(), // 签到规则
});

/** 等级入参 */
const levelSchema = z.object({
  level: z.number().int().min(1).max(99), // 等级序号
  name: z.string().trim().min(1).max(20), // 等级名称
  min_points: z.number().int().min(0).max(10_000_000), // 门槛累计积分
  perks: z.array(z.string().trim().min(1).max(40)).max(10).default([]), // 权益文案
});

/** 等级整表写入入参 */
const levelsSchema = z.object({ levels: z.array(levelSchema).min(1).max(20) });

/** 徽章条件类型 */
const conditionTypeSchema = z.enum(['checkin_streak', 'level', 'post_count', 'points']);

/** 徽章创建入参 */
const badgeCreateSchema = z.object({
  code: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,31}$/, '徽章编码只能是小写字母、数字与连字符，长度 2-32'), // 编码
  name: z.string().trim().min(1).max(20), // 名称
  description: z.string().trim().max(200).default(''), // 说明
  icon: z.string().trim().max(40).default(''), // 图标标识
  condition_type: conditionTypeSchema, // 条件类型
  condition_value: z.number().int().min(0).max(1_000_000), // 条件阈值
  active: z.boolean().default(true), // 是否启用
  sort_order: z.number().int().min(0).max(9999).default(100), // 排序
});

/** 徽章更新入参：编码不可改，其余可选 */
const badgeUpdateSchema = badgeCreateSchema.omit({ code: true }).partial();

/** 手动授予入参 */
const grantSchema = z.object({
  user_id: z.string().trim().min(1).max(64), // 目标用户
  badge_code: z.string().trim().min(2).max(32), // 徽章编码
});

/** 流水分页入参 */
const ledgerQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20), // 每页条数
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0), // 偏移
});

export function createGrowthRouter(deps: ApiDeps): Router {
  const router = Router(); // 路由实例
  const now = () => deps.now?.() ?? new Date().toISOString(); // 可注入时钟，测试可冻结自然日

  // ===== 用户侧：签到 =====

  // 签到状态：给前端展示「今天签没签、连续几天、下次能得多少分」
  router.get('/growth/checkin', requireAuth, (req, res) => {
    const userId = req.user?.id ?? ''; // requireAuth 已保证有用户
    res.json({ ok: true, ...getCheckinStatus(deps.db, userId, now()) });
  });

  // 执行签到：重复签到不报错，用 already_checked_in / first_today 区分
  router.post('/growth/checkin', requireAuth, (req, res) => {
    const userId = req.user?.id ?? ''; // 当前登录用户
    const result = performCheckin(deps.db, userId, now()); // 签到 + 发分 + 等级 + 徽章同一事务
    res.json({ ok: true, ...result });
  });

  // ===== 用户侧：积分流水 =====

  // 积分余额与流水：直接读既有钱包账本，不另建积分表
  router.get('/growth/points', requireAuth, (req, res) => {
    const userId = req.user?.id ?? ''; // 当前登录用户
    const query = parse(ledgerQuerySchema, req.query); // 分页参数
    res.json({ ok: true, ...listPointsLedger(deps.db, userId, query.limit, query.offset) });
  });

  // ===== 用户侧：等级进度 =====

  // 当前等级、下一级与差值
  router.get('/growth/level', requireAuth, (req, res) => {
    const userId = req.user?.id ?? ''; // 当前登录用户
    res.json({ ok: true, ...getLevelProgress(deps.db, userId, now()) });
  });

  // ===== 用户侧：徽章 =====

  // 我的徽章：已获得排在前面，未获得的带条件进度
  router.get('/growth/badges', requireAuth, (req, res) => {
    const userId = req.user?.id ?? ''; // 当前登录用户
    res.json({ ok: true, badges: listMyBadges(deps.db, userId, now()) });
  });

  // ===== 管理侧：签到规则 =====

  // 读取规则
  router.get('/admin/growth/config', requirePermission('content:write'), (_req, res) => {
    res.json({ ok: true, ...getGrowthConfig(deps.db) });
  });

  // 写入规则：审计留痕，失败也会记 failure
  router.put('/admin/growth/config', requirePermission('content:write'), (req, res) => {
    const body = parse(configSchema, req.body); // 校验入参
    const actor = auditActor(req); // 操作人快照
    const config = audited(
      deps.db,
      actor,
      { action: 'admin.growth.config_update', targetType: 'growth_config', targetId: 'default', detail: body },
      () => saveGrowthConfig(deps.db, body, now()), // 合并写入
    );
    res.json({ ok: true, ...config }); // 回显规范化后的配置
  });

  // ===== 管理侧：等级 =====

  // 等级列表
  router.get('/admin/growth/levels', requirePermission('content:write'), (_req, res) => {
    res.json({ ok: true, levels: listLevels(deps.db) });
  });

  // 等级整表替换：服务层校验连续性与门槛递增，事务内重算所有用户等级
  router.put('/admin/growth/levels', requirePermission('content:write'), (req, res) => {
    const body = parse(levelsSchema, req.body); // 校验入参
    const actor = auditActor(req); // 操作人快照
    const levels = audited(
      deps.db,
      actor,
      { action: 'admin.growth.levels_replace', targetType: 'growth_levels', targetId: 'all', detail: { levels: body.levels } },
      () => replaceLevels(deps.db, body.levels, now()), // 整表替换
    );
    res.json({ ok: true, levels }); // 回显落库结果
  });

  // ===== 管理侧：徽章 =====

  // 徽章定义列表（含停用，便于后台恢复）
  router.get('/admin/growth/badges', requirePermission('content:write'), (_req, res) => {
    res.json({ ok: true, badges: listBadgeDefinitions(deps.db) });
  });

  // 新建徽章
  router.post('/admin/growth/badges', requirePermission('content:write'), (req, res) => {
    const body = parse(badgeCreateSchema, req.body); // 校验入参
    const actor = auditActor(req); // 操作人快照
    const badge = audited(
      deps.db,
      actor,
      { action: 'admin.growth.badge_create', targetType: 'growth_badge', targetId: body.code, detail: body },
      () => createBadge(deps.db, body, now()), // 写入定义
    );
    res.status(201).json({ ok: true, badge }); // 201 表示新建
  });

  // 修改徽章
  router.put('/admin/growth/badges/:code', requirePermission('content:write'), (req, res) => {
    const body = parse(badgeUpdateSchema, req.body); // 校验入参（编码不可改）
    const code = String(req.params.code); // Express 5 的参数类型收窄
    const actor = auditActor(req); // 操作人快照
    const badge = audited(
      deps.db,
      actor,
      { action: 'admin.growth.badge_update', targetType: 'growth_badge', targetId: code, detail: body },
      () => updateBadge(deps.db, code, body, now()), // 合并写入
    );
    res.json({ ok: true, badge }); // 回显
  });

  // 停用徽章：软停用，已授予记录保留
  router.delete('/admin/growth/badges/:code', requirePermission('content:write'), (req, res) => {
    const code = String(req.params.code); // Express 5 的参数类型收窄
    const actor = auditActor(req); // 操作人快照
    const badge = audited(
      deps.db,
      actor,
      { action: 'admin.growth.badge_disable', targetType: 'growth_badge', targetId: code },
      () => disableBadge(deps.db, code, now()), // 置 active=0
    );
    res.json({ ok: true, badge }); // 回显停用后的定义
  });

  // 手动授予：已授予时 granted=false，不报错
  router.post('/admin/growth/badge-grants', requirePermission('content:write'), (req, res) => {
    const body = parse(grantSchema, req.body); // 校验入参
    const actor = auditActor(req); // 操作人快照
    const result = audited(
      deps.db,
      actor,
      {
        action: 'admin.growth.badge_grant',
        targetType: 'user_badge',
        targetId: `${body.user_id}:${body.badge_code}`,
        detail: { user_id: body.user_id, badge_code: body.badge_code },
      },
      () => grantBadgeManually(deps.db, body.user_id, body.badge_code, now()), // 幂等授予
    );
    res.json({ ok: true, ...result }); // 回显授予结果
  });

  return router; // 交出可挂载路由
}
