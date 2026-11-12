/** 用户成长路由：等级、徽章、站内私信与 IP 归属地 */

import { Router } from 'express'; // 路由容器
import { createHash, randomUUID } from 'node:crypto'; // IP 哈希与私信主键
import { z } from 'zod'; // 入参校验
import { AppError } from '@mim/core-domain'; // 业务异常
import { idempotency, requireAuth } from '../middleware.js'; // 会话与写幂等
import { parse } from '../validate.js'; // 校验错误翻译
import type { ApiDeps } from '../types.js'; // 依赖容器

const now = () => new Date().toISOString(); // UTC 时间

/** 等级公式：积分每 300 一级、每 3 笔订单加一级，最高 10 级。 */
function levelOf(points: number, orders: number): { level: number; next_points: number } {
  const level = Math.min(10, 1 + Math.floor(points / 300) + Math.floor(orders / 3));
  const next = level >= 10 ? 0 : level * 300; // 0 表示已满级
  return { level, next_points: next };
}

/** 汇总当前用户统计：积分、订单、资产、签到、VIP。 */
function statsOf(deps: ApiDeps, userId: string) {
  const wallet = deps.db.prepare('SELECT points, balance_cents FROM wallets WHERE user_id = ?').get(userId) as { points: number; balance_cents: number } | undefined;
  const orders = deps.db.prepare("SELECT COUNT(*) AS count FROM shop_orders WHERE user_id = ? AND status IN ('paid','delivered')").get(userId) as { count: number };
  const assets = deps.db.prepare("SELECT COUNT(*) AS count FROM paid_assets WHERE author_id = ? AND status = 'published'").get(userId) as { count: number };
  const checkins = deps.db.prepare('SELECT COUNT(*) AS count FROM checkins WHERE user_id = ?').get(userId) as { count: number };
  const vip = deps.db
    .prepare("SELECT MAX(level) AS level FROM vip_memberships WHERE user_id = ? AND status = 'active' AND expires_at > ?")
    .get(userId, now()) as { level: number | null };
  return { points: wallet?.points ?? 0, orders: orders.count, assets: assets.count, checkins: checkins.count, vip_level: vip.level ?? 0 };
}

export function createGrowthRouter(deps: ApiDeps): Router {
  const router = Router();
  router.use('/me/growth', requireAuth); // 成长数据仅本人
  router.use('/me/growth', idempotency); // 同步徽章可重复点击
  router.use('/messages', requireAuth); // 私信读写
  router.use('/messages', idempotency); // 防重复发送
  router.use('/me/ip', requireAuth); // 归属地仅本人可见

  /** 等级配置：前端展示升级路径。 */
  router.get('/levels', (_req, res) => {
    res.json({ levels: Array.from({ length: 10 }, (_, index) => ({ level: index + 1, points: index * 300, label: index === 9 ? '满级' : `Lv.${index + 1}` })) });
  });

  /** 我的成长总览。 */
  router.get('/me/growth', (req, res) => {
    const userId = req.user!.id;
    const stats = statsOf(deps, userId);
    const { level, next_points } = levelOf(stats.points, stats.orders);
    const badges = deps.db
      .prepare(
        `SELECT b.code, b.name, b.description, b.icon, CASE WHEN ub.badge_id IS NULL THEN 0 ELSE 1 END AS awarded, ub.awarded_at
         FROM badges b LEFT JOIN user_badges ub ON ub.badge_id = b.id AND ub.user_id = ? ORDER BY b.sort_order`,
      )
      .all(userId);
    res.json({ level, next_points, stats, badges });
  });

  /** 同步徽章：按当前统计自动发放，已获得的不会重复写。 */
  router.post('/me/growth/sync', (req, res) => {
    const userId = req.user!.id;
    const stats = statsOf(deps, userId);
    const rules: Array<[string, boolean]> = [
      ['newcomer', true], // 登录即得
      ['checkin-7', stats.checkins >= 7],
      ['first-order', stats.orders >= 1],
      ['creator', stats.assets >= 1],
      ['vip', stats.vip_level >= 1],
    ];
    const awarded: string[] = [];
    const tx = deps.db.transaction(() => {
      for (const [code, ok] of rules) {
        if (!ok) continue;
        const badge = deps.db.prepare('SELECT id FROM badges WHERE code = ?').get(code) as { id: string } | undefined;
        if (!badge) continue;
        const changed = deps.db.prepare('INSERT OR IGNORE INTO user_badges (user_id, badge_id, awarded_at) VALUES (?, ?, ?)').run(userId, badge.id, now());
        if (changed.changes === 1) awarded.push(code);
      }
    });
    tx();
    res.json({ ok: true, awarded });
  });

  /** 私信列表：inbox 收件箱 / sent 已发送。 */
  router.get('/messages', (req, res) => {
    const userId = req.user!.id;
    const box = req.query.box === 'sent' ? 'sent' : 'inbox';
    const items = box === 'sent'
      ? deps.db
          .prepare(
            `SELECT m.id, m.content, m.read_at, m.created_at, u.member_no AS peer_member_no, u.display_name AS peer_name
             FROM direct_messages m JOIN users u ON u.id = m.to_user_id WHERE m.from_user_id = ? ORDER BY m.created_at DESC LIMIT 40`,
          )
          .all(userId)
      : deps.db
          .prepare(
            `SELECT m.id, m.content, m.read_at, m.created_at, u.member_no AS peer_member_no, u.display_name AS peer_name
             FROM direct_messages m JOIN users u ON u.id = m.from_user_id WHERE m.to_user_id = ? ORDER BY m.created_at DESC LIMIT 40`,
          )
          .all(userId);
    const unread = deps.db.prepare('SELECT COUNT(*) AS count FROM direct_messages WHERE to_user_id = ? AND read_at IS NULL').get(userId) as { count: number };
    res.json({ box, items, unread: unread.count });
  });

  /** 发送私信：按 Mim ID 找人，禁止发给自己。 */
  router.post('/messages', (req, res) => {
    const userId = req.user!.id;
    const body = parse(z.object({ to_member_no: z.string().min(6).max(20), content: z.string().min(1).max(800) }), req.body);
    const target = deps.db.prepare('SELECT id, status FROM users WHERE member_no = ?').get(body.to_member_no) as { id: string; status: string } | undefined;
    if (!target || target.status !== 'active') throw new AppError('NOT_FOUND', '收件人不存在');
    if (target.id === userId) throw new AppError('VALIDATION_FAILED', '不能给自己发私信');
    const id = `dm-${randomUUID()}`;
    deps.db
      .prepare('INSERT INTO direct_messages (id, from_user_id, to_user_id, content, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, userId, target.id, body.content, now());
    res.status(201).json({ ok: true, id });
  });

  /** 标记已读：只能标记自己收到的消息。 */
  router.post('/messages/:id/read', (req, res) => {
    const changed = deps.db
      .prepare('UPDATE direct_messages SET read_at = ? WHERE id = ? AND to_user_id = ? AND read_at IS NULL')
      .run(now(), req.params.id, req.user!.id);
    if (changed.changes === 0) throw new AppError('NOT_FOUND', '消息不存在或已读');
    res.json({ ok: true });
  });

  /** IP 归属地：只存哈希 + 粗粒度国家 / 地区码，不落明文 IP。 */
  router.get('/me/ip', (req, res) => {
    const forwarded = req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? req.ip ?? '';
    const region = req.header('cf-ipcountry') ?? req.header('x-vercel-ip-country') ?? req.header('x-country-code') ?? '';
    const salt = deps.env.MIM_IP_HASH_SALT ?? deps.jwtSecret;
    const hash = createHash('sha256').update(`${salt}:${forwarded}`).digest('hex');
    deps.db
      .prepare(
        `INSERT INTO user_signals (user_id, ip_hash, region_code, last_seen_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET ip_hash = excluded.ip_hash, region_code = excluded.region_code, last_seen_at = excluded.last_seen_at`,
      )
      .run(req.user!.id, hash, region, now());
    res.json({ region_code: region || '未知', ip_hash_prefix: hash.slice(0, 12), note: '仅保存哈希与粗粒度地区，不保存明文 IP' });
  });

  return router;
}
