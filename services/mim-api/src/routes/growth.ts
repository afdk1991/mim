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
  const level = Math.min(10, 1 + Math.floor(points / 300) + Math.floor(orders / 3)); // 常量 level：保存固定配置或一次性派生值
  const next = level >= 10 ? 0 : level * 300; // 0 表示已满级
  return { level, next_points: next }; // 返回当前函数的处理结果
} // 代码块结束

/** 汇总当前用户统计：积分、订单、资产、签到、VIP。 */
function statsOf(deps: ApiDeps, userId: string) {
  const wallet = deps.db.prepare('SELECT points, balance_cents FROM wallets WHERE user_id = ?').get(userId) as { points: number; balance_cents: number } | undefined; // 常量 wallet：保存固定配置或一次性派生值
  const orders = deps.db.prepare("SELECT COUNT(*) AS count FROM shop_orders WHERE user_id = ? AND status IN ('paid','delivered')").get(userId) as { count: number }; // 常量 orders：保存固定配置或一次性派生值
  const assets = deps.db.prepare("SELECT COUNT(*) AS count FROM paid_assets WHERE author_id = ? AND status = 'published'").get(userId) as { count: number }; // 常量 assets：保存固定配置或一次性派生值
  const checkins = deps.db.prepare('SELECT COUNT(*) AS count FROM checkins WHERE user_id = ?').get(userId) as { count: number }; // 常量 checkins：保存固定配置或一次性派生值
  const vip = deps.db // 常量 vip：保存固定配置或一次性派生值
    .prepare("SELECT MAX(level) AS level FROM vip_memberships WHERE user_id = ? AND status = 'active' AND expires_at > ?") // 执行当前业务步骤
    .get(userId, now()) as { level: number | null }; // 注册 GET 路由 / 中间件处理器
  return { points: wallet?.points ?? 0, orders: orders.count, assets: assets.count, checkins: checkins.count, vip_level: vip.level ?? 0 }; // 返回当前函数的处理结果
} // 代码块结束

export function createGrowthRouter(deps: ApiDeps): Router { // 导出函数 createGrowthRouter：对外暴露的调用入口
  const router = Router(); // 常量 router：保存固定配置或一次性派生值
  router.use('/me/growth', requireAuth); // 成长数据仅本人
  router.use('/me/growth', idempotency); // 同步徽章可重复点击
  router.use('/messages', requireAuth); // 私信读写
  router.use('/messages', idempotency); // 防重复发送
  router.use('/me/ip', requireAuth); // 归属地仅本人可见

  /** 等级配置：前端展示升级路径。 */
  router.get('/levels', (_req, res) => {
    res.json({ levels: Array.from({ length: 10 }, (_, index) => ({ level: index + 1, points: index * 300, label: index === 9 ? '满级' : `Lv.${index + 1}` })) }); // 执行当前业务步骤
  }); // 代码块结束

  /** 我的成长总览。 */
  router.get('/me/growth', (req, res) => {
    const userId = req.user!.id; // 常量 userId：保存固定配置或一次性派生值
    const stats = statsOf(deps, userId); // 常量 stats：保存固定配置或一次性派生值
    const { level, next_points } = levelOf(stats.points, stats.orders); // 执行当前业务步骤
    const badges = deps.db // 常量 badges：保存固定配置或一次性派生值
      .prepare( // 执行当前业务步骤
        `SELECT b.code, b.name, b.description, b.icon, CASE WHEN ub.badge_id IS NULL THEN 0 ELSE 1 END AS awarded, ub.awarded_at
         FROM badges b LEFT JOIN user_badges ub ON ub.badge_id = b.id AND ub.user_id = ? ORDER BY b.sort_order`,
      ) // 执行当前业务步骤
      .all(userId); // 注册 ALL 路由 / 中间件处理器
    res.json({ level, next_points, stats, badges }); // 执行当前业务步骤
  }); // 代码块结束

  /** 同步徽章：按当前统计自动发放，已获得的不会重复写。 */
  router.post('/me/growth/sync', (req, res) => {
    const userId = req.user!.id; // 常量 userId：保存固定配置或一次性派生值
    const stats = statsOf(deps, userId); // 常量 stats：保存固定配置或一次性派生值
    const rules: Array<[string, boolean]> = [ // 常量 rules：保存固定配置或一次性派生值
      ['newcomer', true], // 登录即得
      ['checkin-7', stats.checkins >= 7], // 执行当前业务步骤
      ['first-order', stats.orders >= 1], // 执行当前业务步骤
      ['creator', stats.assets >= 1], // 执行当前业务步骤
      ['vip', stats.vip_level >= 1], // 执行当前业务步骤
    ]; // 执行当前业务步骤
    const awarded: string[] = []; // 常量 awarded：保存固定配置或一次性派生值
    const tx = deps.db.transaction(() => { // 常量 tx：保存固定配置或一次性派生值
      for (const [code, ok] of rules) { // 循环：逐项遍历集合并执行相同处理
        if (!ok) continue; // 条件分支：按判断结果选择后续处理路径
        const badge = deps.db.prepare('SELECT id FROM badges WHERE code = ?').get(code) as { id: string } | undefined; // 常量 badge：保存固定配置或一次性派生值
        if (!badge) continue; // 条件分支：按判断结果选择后续处理路径
        const changed = deps.db.prepare('INSERT OR IGNORE INTO user_badges (user_id, badge_id, awarded_at) VALUES (?, ?, ?)').run(userId, badge.id, now()); // 常量 changed：保存固定配置或一次性派生值
        if (changed.changes === 1) awarded.push(code); // 条件分支：按判断结果选择后续处理路径
      } // 代码块结束
    }); // 代码块结束
    tx(); // 调用 tx 并处理其返回结果
    res.json({ ok: true, awarded }); // 执行当前业务步骤
  }); // 代码块结束

  /** 私信列表：inbox 收件箱 / sent 已发送。 */
  router.get('/messages', (req, res) => {
    const userId = req.user!.id; // 常量 userId：保存固定配置或一次性派生值
    const box = req.query.box === 'sent' ? 'sent' : 'inbox'; // 常量 box：保存固定配置或一次性派生值
    const items = box === 'sent' // 常量 items：保存固定配置或一次性派生值
      ? deps.db // 执行当前业务步骤
          .prepare( // 执行当前业务步骤
            `SELECT m.id, m.content, m.read_at, m.created_at, u.member_no AS peer_member_no, u.display_name AS peer_name
             FROM direct_messages m JOIN users u ON u.id = m.to_user_id WHERE m.from_user_id = ? ORDER BY m.created_at DESC LIMIT 40`,
          ) // 执行当前业务步骤
          .all(userId) // 注册 ALL 路由 / 中间件处理器
      : deps.db // 执行当前业务步骤
          .prepare( // 执行当前业务步骤
            `SELECT m.id, m.content, m.read_at, m.created_at, u.member_no AS peer_member_no, u.display_name AS peer_name
             FROM direct_messages m JOIN users u ON u.id = m.from_user_id WHERE m.to_user_id = ? ORDER BY m.created_at DESC LIMIT 40`,
          ) // 执行当前业务步骤
          .all(userId); // 注册 ALL 路由 / 中间件处理器
    const unread = deps.db.prepare('SELECT COUNT(*) AS count FROM direct_messages WHERE to_user_id = ? AND read_at IS NULL').get(userId) as { count: number }; // 常量 unread：保存固定配置或一次性派生值
    res.json({ box, items, unread: unread.count }); // 执行当前业务步骤
  }); // 代码块结束

  /** 发送私信：按 Mim ID 找人，禁止发给自己。 */
  router.post('/messages', (req, res) => {
    const userId = req.user!.id; // 常量 userId：保存固定配置或一次性派生值
    const body = parse(z.object({ to_member_no: z.string().regex(/^\d{1,10}$/), content: z.string().min(1).max(800) }), req.body); // 收件人必须是纯数字 Mim ID（1～10 位）
    const target = deps.db.prepare('SELECT id, status FROM users WHERE member_no = ?').get(body.to_member_no) as { id: string; status: string } | undefined; // 常量 target：保存固定配置或一次性派生值
    if (!target || target.status !== 'active') throw new AppError('NOT_FOUND', '收件人不存在'); // 条件分支：按判断结果选择后续处理路径
    if (target.id === userId) throw new AppError('VALIDATION_FAILED', '不能给自己发私信'); // 条件分支：按判断结果选择后续处理路径
    const id = `dm-${randomUUID()}`; // 常量 id：保存固定配置或一次性派生值
    deps.db // 执行当前业务步骤
      .prepare('INSERT INTO direct_messages (id, from_user_id, to_user_id, content, created_at) VALUES (?, ?, ?, ?, ?)') // 执行当前业务步骤
      .run(id, userId, target.id, body.content, now()); // 执行当前业务步骤
    res.status(201).json({ ok: true, id }); // 执行当前业务步骤
  }); // 代码块结束

  /** 标记已读：只能标记自己收到的消息。 */
  router.post('/messages/:id/read', (req, res) => {
    const changed = deps.db // 常量 changed：保存固定配置或一次性派生值
      .prepare('UPDATE direct_messages SET read_at = ? WHERE id = ? AND to_user_id = ? AND read_at IS NULL') // 执行当前业务步骤
      .run(now(), req.params.id, req.user!.id); // 执行当前业务步骤
    if (changed.changes === 0) throw new AppError('NOT_FOUND', '消息不存在或已读'); // 条件分支：按判断结果选择后续处理路径
    res.json({ ok: true }); // 执行当前业务步骤
  }); // 代码块结束

  /** IP 归属地：只存哈希 + 粗粒度国家 / 地区码，不落明文 IP。 */
  router.get('/me/ip', (req, res) => {
    const forwarded = req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? req.ip ?? ''; // 常量 forwarded：保存固定配置或一次性派生值
    const region = req.header('cf-ipcountry') ?? req.header('x-vercel-ip-country') ?? req.header('x-country-code') ?? ''; // 常量 region：保存固定配置或一次性派生值
    const salt = deps.env.MIM_IP_HASH_SALT ?? deps.jwtSecret; // 常量 salt：保存固定配置或一次性派生值
    const hash = createHash('sha256').update(`${salt}:${forwarded}`).digest('hex'); // 常量 hash：保存固定配置或一次性派生值
    deps.db // 执行当前业务步骤
      .prepare( // 执行当前业务步骤
        `INSERT INTO user_signals (user_id, ip_hash, region_code, last_seen_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET ip_hash = excluded.ip_hash, region_code = excluded.region_code, last_seen_at = excluded.last_seen_at`,
      ) // 执行当前业务步骤
      .run(req.user!.id, hash, region, now()); // 执行当前业务步骤
    res.json({ region_code: region || '未知', ip_hash_prefix: hash.slice(0, 12), note: '仅保存哈希与粗粒度地区，不保存明文 IP' }); // 执行当前业务步骤
  }); // 代码块结束

  return router; // 返回当前函数的处理结果
} // 代码块结束
