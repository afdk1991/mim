/** 安全路由：图形验证码、内容举报与运营处置 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '@mim/core-domain';
import { idempotency, requireAuth, requirePermission } from '../middleware.js';
import { parse } from '../validate.js';
import { createCaptcha, captchaHash } from '../security.js';
import type { ApiDeps } from '../types.js';

const now = () => new Date().toISOString(); // 统一 UTC 时间
const REPORT_WINDOW_MS = 24 * 60 * 60 * 1000; // 举报频率窗口：24 小时
const REPORT_LIMIT = 5; // 每个账号每 24 小时最多 5 条举报

export function createSecurityRouter(deps: ApiDeps): Router {
  const router = Router();

  /** 公开能力状态：前端据此决定是否展示验证码与审核提示。 */
  router.get('/security/status', (_req, res) => {
    res.json({
      captcha_required: deps.env.MIM_CAPTCHA_REQUIRED === '1',
      content_audit: !!(deps.env.MIM_BAIDU_AUDIT_API_KEY && deps.env.MIM_BAIDU_AUDIT_SECRET_KEY),
    });
  });

  /** 图形验证码：返回 SVG 与 id；每次生成都清理过期记录。 */
  router.get('/auth/captcha', (_req, res) => {
    const captcha = createCaptcha();
    const ts = now();
    deps.db.prepare('DELETE FROM captchas WHERE expires_at <= ?').run(ts);
    deps.db
      .prepare('INSERT INTO captchas (id, answer_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)')
      .run(captcha.id, captchaHash(captcha.answer), captcha.expires_at, ts);
    res.json({ id: captcha.id, svg: captcha.svg, expires_at: captcha.expires_at });
  });

  /** 提交举报：按账号限流，目标必须存在且不能举报自己。 */
  router.post('/reports', requireAuth, idempotency, (req, res) => {
    const userId = req.user!.id;
    const body = parse(
      z.object({
        target_type: z.enum(['thread', 'post', 'asset', 'product', 'user']),
        target_id: z.string().min(1).max(80),
        reason: z.string().min(2).max(80),
        detail: z.string().max(500).optional(),
      }),
      req.body,
    );
    const since = new Date(Date.now() - REPORT_WINDOW_MS).toISOString();
    const recent = deps.db.prepare('SELECT COUNT(*) AS count FROM content_reports WHERE reporter_id = ? AND created_at > ?').get(userId, since) as { count: number };
    if (recent.count >= REPORT_LIMIT) throw new AppError('RATE_LIMITED', `24 小时内最多提交 ${REPORT_LIMIT} 条举报`);
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
