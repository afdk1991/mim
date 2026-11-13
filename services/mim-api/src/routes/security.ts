/** 安全路由：验证码适配层签发、内容举报（滑动窗口限频）、运营处置与索引巡检 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '@mim/core-domain';
import { idempotency, requireAuth, requirePermission } from '../middleware.js';
import { parse } from '../validate.js';
import {
  issueCaptcha,
  verifyCaptcha,
  captchaMode,
  sceneCaptchaRequired,
  captchaProvidersConfigured,
  auditConfigured,
  auditFallback,
  inspectIndexes,
  slidingWindow,
  cacheOf,
  type CaptchaScene,
} from '../security.js';
import type { ApiDeps } from '../types.js';
import { describeCdn, purgeCdn, type PurgeResult } from '../cdn.js';

const now = () => new Date().toISOString(); // 统一 UTC 时间
const REPORT_SCENES: CaptchaScene[] = ['register', 'login', 'report', 'post']; // 状态披露用全场景清单

/** 举报限频：窗口（分钟）与上限均可由环境变量覆盖，缺省 24h / 5 条，按 用户+目标 滑动窗口 */
function reportLimit(env: Record<string, string | undefined>): { limit: number; windowSeconds: number } {
  const limit = Number(env.MIM_REPORT_LIMIT?.trim() || 5);
  const windowMinutes = Number(env.MIM_REPORT_WINDOW_MINUTES?.trim() || 1440);
  return { limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5, windowSeconds: Number.isFinite(windowMinutes) && windowMinutes > 0 ? Math.floor(windowMinutes * 60) : 86_400 };
}

export function createSecurityRouter(deps: ApiDeps): Router {
  const router = Router();
  let lastPurge: PurgeResult | null = null; // 最近一次 CDN 刷新结果（进程内留存，持久审计见 cdn_purge_audit 表）

  /** 公开能力状态：前端据此决定是否展示验证码与审核提示；如实回显当前模式 / 凭证齐备度 / 审核降级策略。 */
  router.get('/security/status', (_req, res) => {
    const env = deps.env;
    const mode = captchaMode(env);
    const requiredScenes = REPORT_SCENES.filter((scene) => sceneCaptchaRequired(env, scene));
    const providers = captchaProvidersConfigured(env);
    const auditEnabled = auditConfigured(env);
    res.json({
      // 兼容旧字段：任一强制场景即视为需要验证码；审核是否接入
      captcha_required: requiredScenes.length > 0,
      content_audit: auditEnabled,
      captcha: {
        mode,
        required_scenes: requiredScenes,
        providers: { image: true, slider: true, tencent: providers.tencent, geetest4: providers.geetest4 },
      },
      audit: { enabled: auditEnabled, provider: auditEnabled ? 'baidu' : 'none', fallback: auditFallback(env) },
    });
  });

  /** 验证码签发：按场景（register/login/report/post）走当前模式适配器；第三方缺凭证抛 503。 */
  router.get('/auth/captcha', (req, res) => {
    const sceneRaw = typeof req.query.scene === 'string' ? req.query.scene : 'login';
    const scene: CaptchaScene = (REPORT_SCENES as string[]).includes(sceneRaw) ? (sceneRaw as CaptchaScene) : 'login';
    const issue = issueCaptcha(deps.db, deps.env, scene);
    res.json({ scene, ...issue });
  });

  /** 提交举报：report 场景验证码（若强制）→ 用户+目标滑动窗口限频 → 目标存在性与自举报校验。 */
  router.post('/reports', requireAuth, idempotency, async (req, res) => {
    const userId = req.user!.id;
    // 先于 zod 剥离读取验证码字段；off / 场景未强制时 verifyCaptcha 直接放行
    await verifyCaptcha(deps.db, deps.env, 'report', (req.body ?? {}) as Record<string, unknown>);
    const body = parse(
      z.object({
        target_type: z.enum(['thread', 'post', 'asset', 'product', 'user']),
        target_id: z.string().min(1).max(80),
        reason: z.string().min(2).max(80),
        detail: z.string().max(500).optional(),
      }),
      req.body,
    );
    // 滑动窗口：维度 = 用户 + 目标类型 + 目标 ID；窗口与上限走环境变量，缺省 24h / 5 条
    const { limit, windowSeconds } = reportLimit(deps.env);
    const rate = await slidingWindow(cacheOf(deps.env), `report:${userId}:${body.target_type}:${body.target_id}`, limit, windowSeconds);
    if (!rate.ok) throw new AppError('RATE_LIMITED', `窗口内最多提交 ${limit} 条举报`, { limit, reset_at: rate.resetAt });
    if (body.target_type === 'user' && body.target_id === userId) throw new AppError('VALIDATION_FAILED', '不能举报自己');
    const exists = (() => {
      if (body.target_type === 'thread') return !!deps.db.prepare('SELECT 1 AS ok FROM community_threads WHERE id = ?').get(body.target_id);
      if (body.target_type === 'post') return !!deps.db.prepare('SELECT 1 AS ok FROM community_posts WHERE id = ?').get(body.target_id);
      if (body.target_type === 'asset') return !!deps.db.prepare('SELECT 1 AS ok FROM paid_assets WHERE code = ? OR id = ?').get(body.target_id, body.target_id);
      if (body.target_type === 'product') return !!deps.db.prepare('SELECT 1 AS ok FROM shop_products WHERE code = ? OR id = ?').get(body.target_id, body.target_id);
      return !!deps.db.prepare('SELECT 1 AS ok FROM users WHERE id = ?').get(body.target_id);
    })();
    if (!exists) throw new AppError('NOT_FOUND', '举报目标不存在');
    const ts = now();
    const id = `report-${randomUUID()}`;
    deps.db
      .prepare(
        `INSERT INTO content_reports (id, reporter_id, target_type, target_id, reason, detail, status, admin_note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', '', ?, ?)`,
      )
      .run(id, userId, body.target_type, body.target_id, body.reason, body.detail ?? '', ts, ts);
    res.status(201).json({ ok: true, id });
  });

  /** 我的举报记录。 */
  router.get('/reports/mine', requireAuth, (req, res) => {
    const items = deps.db
      .prepare('SELECT id, target_type, target_id, reason, status, admin_note, created_at FROM content_reports WHERE reporter_id = ? ORDER BY created_at DESC LIMIT 30')
      .all(req.user!.id);
    res.json({ items });
  });

  /** 运营视角：按状态列出举报。 */
  router.get('/reports/admin', requirePermission('commerce:write'), (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
    const items = deps.db
      .prepare('SELECT id, reporter_id, target_type, target_id, reason, detail, status, admin_note, created_at FROM content_reports WHERE status = ? ORDER BY created_at ASC LIMIT 100')
      .all(status);
    res.json({ items });
  });

  /** 索引巡检：缺失索引建议与慢查询候选（只读，供 DBA / 运营复核执行计划）。 */
  router.get('/security/index-audit', requirePermission('commerce:write'), (_req, res) => {
    res.json(inspectIndexes(deps.db));
  });

  /** CDN 配置与回源缓存契约状态：如实回显厂商 / 齐备度 / 策略清单 / 最近刷新结果。 */
  router.get('/security/cdn', requirePermission('commerce:write'), (_req, res) => {
    res.json({ ...describeCdn(deps.env), purge_last_result: lastPurge });
  });

  /** 主动刷新 CDN 缓存：需管理权限（commerce:write 等价管理门禁），结果落 cdn_purge_audit 审计表。 */
  router.post('/security/cdn/purge', requireAuth, requirePermission('commerce:write'), idempotency, async (req, res) => {
    const body = parse(z.object({ urls: z.array(z.string().url()).min(1) }), req.body);
    const result = await purgeCdn(deps.env, body.urls);
    lastPurge = result;
    deps.db
      .prepare(
        `INSERT INTO cdn_purge_audit (id, actor_id, provider, ok, configured, purged_json, error, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `cdn-purge-${randomUUID()}`,
        req.user!.id,
        result.provider,
        result.ok ? 1 : 0,
        result.configured ? 1 : 0,
        JSON.stringify(result.purged),
        result.error ?? null,
        result.status ?? null,
        now(),
      );
    res.status(result.ok ? 200 : result.configured ? 502 : 503).json(result);
  });

  /** 运营处置：通过则隐藏目标内容，驳回只记录结论。 */
  router.put('/reports/:id', requirePermission('commerce:write'), idempotency, (req, res) => {
    const body = parse(z.object({ status: z.enum(['resolved', 'rejected']), admin_note: z.string().max(200).optional() }), req.body);
    const row = deps.db.prepare('SELECT id, target_type, target_id, status FROM content_reports WHERE id = ?').get(req.params.id) as
      | { id: string; target_type: string; target_id: string; status: string }
      | undefined;
    if (!row) throw new AppError('NOT_FOUND', '举报记录不存在');
    if (row.status !== 'pending') throw new AppError('CONFLICT', '举报已处理');
    const ts = now();
    const tx = deps.db.transaction(() => {
      deps.db.prepare('UPDATE content_reports SET status = ?, admin_note = ?, updated_at = ? WHERE id = ?').run(body.status, body.admin_note ?? '', ts, row.id);
      if (body.status === 'resolved') {
        if (row.target_type === 'thread') deps.db.prepare("UPDATE community_threads SET status = 'hidden' WHERE id = ?").run(row.target_id);
        if (row.target_type === 'post') deps.db.prepare('DELETE FROM community_posts WHERE id = ?').run(row.target_id);
        if (row.target_type === 'product') deps.db.prepare("UPDATE shop_products SET status = 'inactive' WHERE code = ? OR id = ?").run(row.target_id, row.target_id);
        if (row.target_type === 'asset') deps.db.prepare("UPDATE paid_assets SET status = 'hidden' WHERE code = ? OR id = ?").run(row.target_id, row.target_id);
      }
    });
    tx();
    res.json({ ok: true, status: body.status });
  });

  return router;
}
