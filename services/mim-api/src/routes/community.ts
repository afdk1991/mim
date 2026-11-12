/** 社区与变现路由：论坛 / 付费阅读 / VIP / 钱包积分 / 独立商城 / 优惠码 / 推广分成 */

import { Router } from 'express'; // Express 路由容器
import { randomUUID } from 'node:crypto'; // 稳定主键生成
import { z } from 'zod'; // 入参声明式校验
import { AppError } from '@mim/core-domain'; // 统一业务异常
import { parse } from '../validate.js'; // 校验失败统一翻译
import { idempotency, requireAuth } from '../middleware.js'; // 鉴权与写操作幂等
import { auditText, assertPublicHttpUrl } from '../security.js'; // 内容审核与远程链接 SSRF 校验
import type { ApiDeps } from '../types.js'; // 依赖容器

const now = () => new Date().toISOString(); // 统一 UTC 时间

/** 确保当前用户有钱包行；新用户开箱即 0 余额、100 积分。 */
function ensureWallet(deps: ApiDeps, userId: string) {
  const existing = deps.db.prepare('SELECT user_id, balance_cents, points FROM wallets WHERE user_id = ?').get(userId) as
    | { user_id: string; balance_cents: number; points: number }
    | undefined;
  if (existing) return existing;
  const row = { user_id: userId, balance_cents: 0, points: 100 };
  deps.db.prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, ?, ?, ?)').run(
    userId,
    row.balance_cents,
    row.points,
    now(),
  );
  deps.db.prepare(
    `INSERT INTO wallet_transactions (id, user_id, kind, points, note, created_at) VALUES (?, ?, 'points', 100, '新用户见面礼', ?)`,
  ).run(`wt-${randomUUID()}`, userId, now());
  return row;
}

/** 读取当前用户 Mim ID，用于积分转账备注。 */
function walletOfMember(deps: ApiDeps, userId: string): string {
  const row = deps.db.prepare('SELECT member_no FROM users WHERE id = ?').get(userId) as { member_no: string | null } | undefined;
  return row?.member_no ?? userId;
}

/** 当前有效 VIP 等级；0 表示非会员。 */
function vipLevel(deps: ApiDeps, userId: string): number {  const row = deps.db
    .prepare(`SELECT level FROM vip_memberships WHERE user_id = ? AND status = 'active' AND expires_at > ? ORDER BY level DESC LIMIT 1`)
    .get(userId, now()) as { level: number } | undefined;
  return row?.level ?? 0;
}

/** 当前用户是否有权查看某帖：免费 / 已购 / VIP。 */
function hasThreadAccess(deps: ApiDeps, userId: string, threadId: string, priceCents: number): boolean {
  if (priceCents <= 0) return true;
  if (vipLevel(deps, userId) > 0) return true;
  return !!deps.db.prepare('SELECT 1 AS ok FROM community_purchases WHERE user_id = ? AND thread_id = ?').get(userId, threadId);
}

/** 板块访问：免费板块直接放行；付费板块需加入或 VIP。 */
function hasBoardAccess(deps: ApiDeps, userId: string, boardId: string, boardPriceCents: number): boolean {
  if (boardPriceCents <= 0) return true;
  if (vipLevel(deps, userId) > 0) return true;
  return !!deps.db.prepare('SELECT 1 AS ok FROM community_board_memberships WHERE board_id = ? AND user_id = ?').get(boardId, userId);
}

/** 钱包余额是否足够；不足抛带 details 的校验错误，前端可识别。 */
function requireBalance(deps: ApiDeps, userId: string, amount: number): { balance_cents: number; points: number } {
  const wallet = ensureWallet(deps, userId);
  if (wallet.balance_cents < amount)
    throw new AppError('VALIDATION_FAILED', '余额不足，请先在钱包用卡密充值', {
      reason: 'INSUFFICIENT_BALANCE',
      required_cents: amount,
      balance_cents: wallet.balance_cents,
    });
  return wallet;
}

/** 扣余额并写一条消费流水。 */
function debit(deps: ApiDeps, userId: string, amount: number, refType: string, refId: string, note: string) {
  ensureWallet(deps, userId); // 先保证钱包行存在，否则首次消费的 UPDATE 会静默落空
  deps.db.prepare('UPDATE wallets SET balance_cents = balance_cents - ?, updated_at = ? WHERE user_id = ?').run(amount, now(), userId);
  deps.db
    .prepare(
      `INSERT INTO wallet_transactions (id, user_id, kind, amount_cents, ref_type, ref_id, note, created_at) VALUES (?, ?, 'consume', ?, ?, ?, ?, ?)`,
    )
    .run(`wt-${randomUUID()}`, userId, -amount, refType, refId, note, now());
}

/** 加余额并写一条充值 / 退款流水。 */
function credit(deps: ApiDeps, userId: string, amount: number, kind: 'recharge' | 'refund' | 'commission', note: string) {
  ensureWallet(deps, userId); // 先保证钱包行存在，避免首次充值 / 退款 / 分成的 UPDATE 静默落空
  deps.db.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, updated_at = ? WHERE user_id = ?').run(amount, now(), userId);
  deps.db
    .prepare(
      `INSERT INTO wallet_transactions (id, user_id, kind, amount_cents, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(`wt-${randomUUID()}`, userId, kind, amount, note, now());
}

/** 计算优惠码折扣：fixed 固定立减，percent 百分比（value=20 即 8 折）。 */
function couponDiscount(deps: ApiDeps, code: string | undefined, amount: number): { code: string | null; discount: number; couponId: string | null } {
  if (!code) return { code: null, discount: 0, couponId: null };
  const coupon = deps.db.prepare('SELECT * FROM coupons WHERE code = ? AND active = 1').get(code.toUpperCase()) as
    | { id: string; kind: 'fixed' | 'percent'; value: number; min_amount_cents: number; max_uses: number; used_count: number; expires_at: string | null }
    | undefined;
  if (!coupon) throw new AppError('NOT_FOUND', '优惠码不存在或已停用');
  if (coupon.expires_at && coupon.expires_at < now()) throw new AppError('VALIDATION_FAILED', '优惠码已过期');
  if (coupon.max_uses > 0 && coupon.used_count >= coupon.max_uses) throw new AppError('VALIDATION_FAILED', '优惠码已使用完');
  if (amount < coupon.min_amount_cents)
    throw new AppError('VALIDATION_FAILED', `订单满 ${(coupon.min_amount_cents / 100).toFixed(2)} 元可用`, {
      reason: 'COUPON_MIN_AMOUNT',
      min_amount_cents: coupon.min_amount_cents,
    });
  const discount = coupon.kind === 'fixed' ? Math.min(coupon.value, amount) : Math.min(Math.round((amount * coupon.value) / 100), amount);
  return { code: coupon.id, discount, couponId: coupon.id };
}

// 本路由承载的全部命名空间前缀：鉴权与幂等只挂在这些前缀上，
// 避免裸 router.use 全局拦截穿过本 router 的其他命名空间（如后台 /admin）请求。
const COMMUNITY_PREFIXES = ['/community', '/vip', '/wallet', '/shop', '/coupons', '/referral'];

export function createCommunityRouter(deps: ApiDeps): Router {
  const router = Router();
  router.use(COMMUNITY_PREFIXES, requireAuth); // 社区与资产全部需要会话；访客会话同样可用
  router.use(COMMUNITY_PREFIXES, idempotency); // 写操作幂等，防重复扣款 / 重复发卡

  /** 社区首页聚合：板块、统计、当前会员与钱包。 */
  router.get('/community/overview', (req, res) => {
    const userId = req.user!.id;
    const boards = deps.db
      .prepare(
        `SELECT b.slug, b.name, b.description, b.icon, b.sort_order, b.price_cents,
                (SELECT COUNT(*) FROM community_board_memberships m WHERE m.board_id = b.id AND m.user_id = ?) AS joined,
                (SELECT COUNT(*) FROM community_threads t WHERE t.board_id = b.id AND t.status = 'published') AS thread_count
         FROM community_boards b ORDER BY b.sort_order ASC`,
      )
      .all(userId);
    const stats = deps.db
      .prepare(`SELECT COUNT(*) AS threads, COALESCE(SUM(views), 0) AS views, COALESCE(SUM(likes), 0) AS likes FROM community_threads WHERE status = 'published'`)
      .get();
    const wallet = ensureWallet(deps, userId);
    const level = vipLevel(deps, userId);
    const vip = deps.db
      .prepare(`SELECT plan_id, level, expires_at FROM vip_memberships WHERE user_id = ? AND status = 'active' AND expires_at > ? ORDER BY level DESC LIMIT 1`)
      .get(userId, now()) as { plan_id: string; level: number; expires_at: string } | undefined;
    res.json({ boards, stats, wallet, vip_level: level, vip: vip ?? null });
  });

  /** 板块列表。 */
  router.get('/community/boards', (req, res) => {
    const boards = deps.db
      .prepare(
        `SELECT b.slug, b.name, b.description, b.icon, b.price_cents,
                (SELECT COUNT(*) FROM community_board_memberships m WHERE m.board_id = b.id AND m.user_id = ?) AS joined,
                (SELECT COUNT(*) FROM community_threads t WHERE t.board_id = b.id AND t.status = 'published') AS thread_count
         FROM community_boards b ORDER BY b.sort_order ASC`,
      )
      .all(req.user!.id);
    res.json({ boards });
  });

  /** 帖子列表：板块 / 形态 / 排序 / 关键词 / 分页。 */
  router.get('/community/threads', (req, res) => {
    const userId = req.user!.id;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const board = typeof req.query.board === 'string' && req.query.board !== 'all' ? req.query.board : '';
    const kind = typeof req.query.kind === 'string' && req.query.kind !== 'all' ? req.query.kind : '';
    const sort = ['hot', 'views', 'replies', 'favorites', 'rating'].includes(String(req.query.sort))
      ? String(req.query.sort)
      : 'latest';
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '24'), 10) || 24, 1), 60);
    const where: string[] = ["t.status = 'published'"];
    const args: unknown[] = [];
    if (board) {
      where.push('b.slug = ?');
      args.push(board);
    }
    if (kind) {
      where.push('t.kind = ?');
      args.push(kind);
    }
    if (q) {
      where.push('(t.title LIKE ? OR t.summary LIKE ?)');
      args.push(`%${q}%`, `%${q}%`);
    }
    const order =
      sort === 'hot'
        ? 't.likes DESC, t.views DESC, t.last_activity_at DESC'
        : sort === 'views'
          ? 't.views DESC, t.last_activity_at DESC'
          : sort === 'replies'
            ? 't.reply_count DESC, t.last_activity_at DESC'
            : sort === 'favorites'
              ? 'favorite_count DESC, t.last_activity_at DESC'
              : sort === 'rating'
                ? 'rating_avg DESC, rating_count DESC, t.last_activity_at DESC'
                : 't.last_activity_at DESC';
    const rows = deps.db
      .prepare(
        `SELECT t.id, t.title, t.summary, t.kind, t.cover_url, t.price_cents, t.views, t.likes, t.reply_count,
                t.created_at, t.last_activity_at, b.slug AS board_slug, b.name AS board_name, b.price_cents AS board_price_cents,
                u.display_name AS author_name,
                (SELECT COUNT(*) FROM community_purchases p WHERE p.thread_id = t.id AND p.user_id = ?) AS purchased,
                (SELECT COUNT(*) FROM community_favorites f WHERE f.thread_id = t.id AND f.user_id = ?) AS favorited,
                (SELECT COUNT(*) FROM community_favorites f WHERE f.thread_id = t.id) AS favorite_count,
                (SELECT ROUND(AVG(r.rating), 2) FROM community_ratings r WHERE r.thread_id = t.id) AS rating_avg,
                (SELECT COUNT(*) FROM community_ratings r WHERE r.thread_id = t.id) AS rating_count,
                (SELECT COUNT(*) FROM community_board_memberships m WHERE m.board_id = b.id AND m.user_id = ?) AS board_joined
         FROM community_threads t
         JOIN community_boards b ON b.id = t.board_id
         LEFT JOIN users u ON u.id = t.author_id
         WHERE ${where.join(' AND ')}
         ORDER BY ${order}
         LIMIT ?`,
      )
      .all(userId, userId, userId, ...args, limit);
    const level = vipLevel(deps, userId);
    const items = (rows as Array<Record<string, unknown> & { price_cents: number; purchased: number; board_price_cents: number; board_joined: number }>).map((row) => ({
      ...row,
      locked:
        (row.price_cents > 0 && row.purchased === 0 && level === 0) ||
        (row.board_price_cents > 0 && row.board_joined === 0 && level === 0),
    }));
    res.json({ items, total: items.length, sort, vip_level: level });
  });

  /** 帖子详情：未解锁时隐藏正文与回复。 */
  router.get('/community/threads/:id', (req, res) => {
    const userId = req.user!.id;
    const id = req.params.id;
    const thread = deps.db
      .prepare(
        `SELECT t.*, b.slug AS board_slug, b.id AS board_id, b.name AS board_name, b.price_cents AS board_price_cents,
                u.display_name AS author_name,
                (SELECT COUNT(*) FROM community_purchases p WHERE p.thread_id = t.id AND p.user_id = ?) AS purchased,
                (SELECT COUNT(*) FROM community_favorites f WHERE f.thread_id = t.id AND f.user_id = ?) AS favorited,
                (SELECT ROUND(AVG(r.rating), 2) FROM community_ratings r WHERE r.thread_id = t.id) AS rating_avg,
                (SELECT COUNT(*) FROM community_ratings r WHERE r.thread_id = t.id) AS rating_count,
                (SELECT rating FROM community_ratings r WHERE r.thread_id = t.id AND r.user_id = ?) AS my_rating
         FROM community_threads t JOIN community_boards b ON b.id = t.board_id LEFT JOIN users u ON u.id = t.author_id
         WHERE t.id = ? AND t.status = 'published'`,
      )
      .get(userId, userId, userId, id) as
      | (Record<string, unknown> & {
          price_cents: number;
          purchased: number;
          board_id: string;
          board_price_cents: number;
          body: string;
          favorited: number;
        })
      | undefined;
    if (!thread) throw new AppError('NOT_FOUND', '帖子不存在');
    deps.db.prepare('UPDATE community_threads SET views = views + 1 WHERE id = ?').run(id);
    const boardUnlocked = hasBoardAccess(deps, userId, thread.board_id, thread.board_price_cents);
    const unlocked = boardUnlocked && hasThreadAccess(deps, userId, id, thread.price_cents);
    const liked = !!deps.db.prepare('SELECT 1 AS ok FROM community_thread_likes WHERE thread_id = ? AND user_id = ?').get(id, userId);
    const media = deps.db
      .prepare('SELECT id, kind, url, poster_url, sort_order FROM community_thread_media WHERE thread_id = ? ORDER BY sort_order ASC')
      .all(id);
    const options = deps.db
      .prepare(
        `SELECT o.id, o.label,
                (SELECT COUNT(*) FROM community_poll_votes v WHERE v.option_id = o.id) AS votes,
                (SELECT COUNT(*) FROM community_poll_votes v WHERE v.option_id = o.id AND v.user_id = ?) AS mine
         FROM community_poll_options o WHERE o.thread_id = ? ORDER BY o.sort_order ASC`,
      )
      .all(userId, id) as Array<{ id: string; label: string; votes: number; mine: number }>;
    const myVote = deps.db.prepare('SELECT option_id FROM community_poll_votes WHERE thread_id = ? AND user_id = ?').get(id, userId) as
      | { option_id: string }
      | undefined;
    const posts = unlocked
      ? deps.db
          .prepare(
            `SELECT p.id, p.content, p.created_at, u.display_name AS author_name, u.member_no AS author_member_no
             FROM community_posts p LEFT JOIN users u ON u.id = p.author_id
             WHERE p.thread_id = ? ORDER BY p.created_at ASC LIMIT 200`,
          )
          .all(id)
      : [];
    res.json({
      thread: {
        ...thread,
        views: (thread.views as number) + 1,
        body: unlocked ? thread.body : '',
        locked: !unlocked,
        board_locked: !boardUnlocked,
        media: unlocked ? media : [],
        poll: unlocked && options.length > 0 ? { options, total: (options as Array<{ votes: number }>).reduce((sum, option) => sum + option.votes, 0), my_option: myVote?.option_id ?? null } : null,
      },
      posts,
      liked,
      unlocked,
      favorited: !!thread.favorited,
    });
  });

  /** 发帖：支持文本 / 视频 / 图集 / 剧集 / 问答 / 投票与付费定价。 */
  router.post('/community/threads', async (req, res) => {
    const userId = req.user!.id;
    const body = parse(
      z.object({
        board_slug: z.string().min(1).max(40),
        title: z.string().min(4).max(80),
        summary: z.string().max(200).optional(),
        body: z.string().min(10).max(8000),
        kind: z.enum(['text', 'video', 'gallery', 'series', 'qa', 'poll']).optional(),
        cover_url: z.string().max(300).optional(),
        price_cents: z.number().int().min(0).max(100000).optional(),
        media: z
          .array(
            z.object({
              kind: z.enum(['image', 'video']),
              url: z.string().min(1).max(500),
              poster_url: z.string().max(500).optional(),
            }),
          )
          .max(12)
          .optional(),
        poll_options: z.array(z.string().min(1).max(60)).min(2).max(10).optional(),
      }),
      req.body,
    );
    const board = deps.db.prepare('SELECT id, price_cents FROM community_boards WHERE slug = ?').get(body.board_slug) as
      | { id: string; price_cents: number }
      | undefined;
    if (!board) throw new AppError('NOT_FOUND', '板块不存在');
    if (!hasBoardAccess(deps, userId, board.id, board.price_cents)) throw new AppError('FORBIDDEN', '请先加入该付费板块');
    const kind = body.kind ?? 'text';
    const media = body.media ?? [];
    if ((kind === 'gallery' || kind === 'series') && !media.some((item) => item.kind === 'image')) throw new AppError('VALIDATION_FAILED', '图集/剧集至少需要一张图片');
    if (kind === 'video' && !media.some((item) => item.kind === 'video')) throw new AppError('VALIDATION_FAILED', '视频帖至少需要一个视频地址');
    if (kind === 'poll' && (!body.poll_options || body.poll_options.length < 2)) throw new AppError('VALIDATION_FAILED', '投票帖至少需要两个选项');
    for (const item of media) {
      if (!/^(https?:)?\//.test(item.url)) throw new AppError('VALIDATION_FAILED', '媒体地址必须是站内路径或 http(s) 地址');
      if (/^https?:/.test(item.url)) {
        try {
          await assertPublicHttpUrl(item.url);
        } catch {
          throw new AppError('VALIDATION_FAILED', '媒体地址不允许指向内网或非法协议');
        }
      }
    }
    const audit = await auditText(deps.env, `${body.title}\n${body.summary ?? ''}\n${body.body}`);
    if (!audit.ok) throw new AppError('VALIDATION_FAILED', audit.reason ?? '内容未通过审核');
    const id = `thread-${randomUUID()}`;
    const ts = now();
    const tx = deps.db.transaction(() => {
      deps.db
        .prepare(
          `INSERT INTO community_threads (id, board_id, author_id, title, summary, body, kind, cover_url, price_cents, status, created_at, updated_at, last_activity_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)`,
        )
        .run(id, board.id, userId, body.title, body.summary ?? '', body.body, kind, body.cover_url ?? null, body.price_cents ?? 0, ts, ts, ts);
      media.forEach((item, index) => {
        deps.db
          .prepare('INSERT INTO community_thread_media (id, thread_id, kind, url, poster_url, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(`media-${randomUUID()}`, id, item.kind, item.url, item.poster_url ?? null, index, ts);
      });
      (body.poll_options ?? []).forEach((label, index) => {
        deps.db
          .prepare('INSERT INTO community_poll_options (id, thread_id, label, sort_order) VALUES (?, ?, ?, ?)')
          .run(`poll-${randomUUID()}`, id, label, index);
      });
    });
    tx();
    res.status(201).json({ thread_id: id });
  });

  /** 解锁付费帖：余额扣款；VIP 直接放行。 */
  router.post('/community/threads/:id/unlock', (req, res) => {
    const userId = req.user!.id;
    const id = req.params.id;
    const thread = deps.db
      .prepare('SELECT t.price_cents, b.id AS board_id, b.price_cents AS board_price_cents FROM community_threads t JOIN community_boards b ON b.id = t.board_id WHERE t.id = ?')
      .get(id) as { price_cents: number; board_id: string; board_price_cents: number } | undefined;
    if (!thread) throw new AppError('NOT_FOUND', '帖子不存在');
    if (!hasBoardAccess(deps, userId, thread.board_id, thread.board_price_cents)) throw new AppError('FORBIDDEN', '请先加入该付费板块');
    if (thread.price_cents <= 0) return res.json({ unlocked: true, charged_cents: 0 });
    if (deps.db.prepare('SELECT 1 AS ok FROM community_purchases WHERE user_id = ? AND thread_id = ?').get(userId, id))
      return res.json({ unlocked: true, charged_cents: 0 });
    if (vipLevel(deps, userId) > 0) {
      deps.db.prepare('INSERT INTO community_purchases (id, user_id, thread_id, amount_cents, created_at) VALUES (?, ?, ?, 0, ?)').run(`cp-${randomUUID()}`, userId, id, now());
      return res.json({ unlocked: true, charged_cents: 0, via: 'vip' });
    }
    const price = thread.price_cents;
    requireBalance(deps, userId, price);
    const tx = deps.db.transaction(() => {
      debit(deps, userId, price, 'community_thread', id, '解锁付费帖');
      deps.db.prepare('INSERT INTO community_purchases (id, user_id, thread_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)').run(`cp-${randomUUID()}`, userId, id, price, now());
    });
    tx();
    res.json({ unlocked: true, charged_cents: price });
  });

  /** 回复：必须已解锁；写入后刷新回帖数与活跃时间。 */
  router.post('/community/threads/:id/reply', async (req, res) => {
    const userId = req.user!.id;
    const id = req.params.id;
    const body = parse(z.object({ content: z.string().min(1).max(4000), parent_id: z.string().max(80).optional() }), req.body);
    const thread = deps.db
      .prepare('SELECT t.price_cents, b.id AS board_id, b.price_cents AS board_price_cents FROM community_threads t JOIN community_boards b ON b.id = t.board_id WHERE t.id = ?')
      .get(id) as { price_cents: number; board_id: string; board_price_cents: number } | undefined;
    if (!thread) throw new AppError('NOT_FOUND', '帖子不存在');
    if (!hasBoardAccess(deps, userId, thread.board_id, thread.board_price_cents)) throw new AppError('FORBIDDEN', '请先加入该付费板块');
    if (!hasThreadAccess(deps, userId, id, thread.price_cents)) throw new AppError('FORBIDDEN', '请先解锁本帖');
    const audit = await auditText(deps.env, body.content);
    if (!audit.ok) throw new AppError('VALIDATION_FAILED', audit.reason ?? '回复未通过审核');
    const ts = now();
    deps.db
      .prepare('INSERT INTO community_posts (id, thread_id, author_id, parent_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(`post-${randomUUID()}`, id, userId, body.parent_id ?? null, body.content, ts);
    deps.db.prepare('UPDATE community_threads SET reply_count = reply_count + 1, last_activity_at = ? WHERE id = ?').run(ts, id);
    res.status(201).json({ ok: true });
  });

  /** 点赞开关。 */
  router.post('/community/threads/:id/like', (req, res) => {
    const userId = req.user!.id;
    const id = req.params.id;
    const existing = deps.db.prepare('SELECT 1 AS ok FROM community_thread_likes WHERE thread_id = ? AND user_id = ?').get(id, userId);
    if (existing) {
      deps.db.prepare('DELETE FROM community_thread_likes WHERE thread_id = ? AND user_id = ?').run(id, userId);
      deps.db.prepare('UPDATE community_threads SET likes = MAX(0, likes - 1) WHERE id = ?').run(id);
      return res.json({ liked: false });
    }
    deps.db.prepare('INSERT INTO community_thread_likes (thread_id, user_id, created_at) VALUES (?, ?, ?)').run(id, userId, now());
    deps.db.prepare('UPDATE community_threads SET likes = likes + 1 WHERE id = ?').run(id);
    return res.json({ liked: true });
  });

  /** 收藏开关。 */
  router.post('/community/threads/:id/favorite', (req, res) => {
    const userId = req.user!.id;
    const id = req.params.id;
    if (!deps.db.prepare("SELECT 1 AS ok FROM community_threads WHERE id = ? AND status = 'published'").get(id)) throw new AppError('NOT_FOUND', '帖子不存在');
    const existing = deps.db.prepare('SELECT 1 AS ok FROM community_favorites WHERE thread_id = ? AND user_id = ?').get(id, userId);
    if (existing) {
      deps.db.prepare('DELETE FROM community_favorites WHERE thread_id = ? AND user_id = ?').run(id, userId);
      return res.json({ favorited: false });
    }
    deps.db.prepare('INSERT INTO community_favorites (thread_id, user_id, created_at) VALUES (?, ?, ?)').run(id, userId, now());
    return res.json({ favorited: true });
  });

  /** 我的收藏。 */
  router.get('/community/favorites', (req, res) => {
    const items = deps.db
      .prepare(
        `SELECT t.id, t.title, t.summary, t.kind, t.cover_url, t.price_cents, t.views, t.likes, t.reply_count,
                b.slug AS board_slug, b.name AS board_name, f.created_at AS favorited_at
         FROM community_favorites f JOIN community_threads t ON t.id = f.thread_id JOIN community_boards b ON b.id = t.board_id
         WHERE f.user_id = ? AND t.status = 'published' ORDER BY f.created_at DESC LIMIT 50`,
      )
      .all(req.user!.id);
    res.json({ items });
  });

  /** 评分：1–5 星，一人一帖一条，可修改。 */
  router.post('/community/threads/:id/rate', (req, res) => {
    const userId = req.user!.id;
    const body = parse(z.object({ rating: z.number().int().min(1).max(5) }), req.body);
    const thread = deps.db.prepare('SELECT price_cents FROM community_threads WHERE id = ?').get(req.params.id) as { price_cents: number } | undefined;
    if (!thread) throw new AppError('NOT_FOUND', '帖子不存在');
    if (!hasThreadAccess(deps, userId, req.params.id, thread.price_cents)) throw new AppError('FORBIDDEN', '请先解锁本帖');
    const ts = now();
    deps.db
      .prepare(
        `INSERT INTO community_ratings (thread_id, user_id, rating, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(thread_id, user_id) DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at`,
      )
      .run(req.params.id, userId, body.rating, ts, ts);
    const summary = deps.db.prepare('SELECT ROUND(AVG(rating), 2) AS avg, COUNT(*) AS count FROM community_ratings WHERE thread_id = ?').get(req.params.id);
    res.json({ ok: true, summary });
  });

  /** 投票：一人一票，可改投；必须已解锁。 */
  router.post('/community/threads/:id/vote', (req, res) => {
    const userId = req.user!.id;
    const body = parse(z.object({ option_id: z.string().min(1).max(80) }), req.body);
    const thread = deps.db.prepare('SELECT price_cents FROM community_threads WHERE id = ?').get(req.params.id) as { price_cents: number } | undefined;
    if (!thread) throw new AppError('NOT_FOUND', '帖子不存在');
    if (!hasThreadAccess(deps, userId, req.params.id, thread.price_cents)) throw new AppError('FORBIDDEN', '请先解锁本帖');
    const option = deps.db.prepare('SELECT id FROM community_poll_options WHERE id = ? AND thread_id = ?').get(body.option_id, req.params.id);
    if (!option) throw new AppError('NOT_FOUND', '投票选项不存在');
    deps.db
      .prepare(
        `INSERT INTO community_poll_votes (thread_id, option_id, user_id, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(thread_id, user_id) DO UPDATE SET option_id = excluded.option_id, created_at = excluded.created_at`,
      )
      .run(req.params.id, body.option_id, userId, now());
    res.json({ ok: true });
  });

  /** 加入付费板块：余额扣款；VIP 直接加入并记 0 元。 */
  router.post('/community/boards/:slug/join', (req, res) => {
    const userId = req.user!.id;
    const board = deps.db.prepare('SELECT id, slug, name, price_cents FROM community_boards WHERE slug = ?').get(req.params.slug) as
      | { id: string; slug: string; name: string; price_cents: number }
      | undefined;
    if (!board) throw new AppError('NOT_FOUND', '板块不存在');
    if (deps.db.prepare('SELECT 1 AS ok FROM community_board_memberships WHERE board_id = ? AND user_id = ?').get(board.id, userId)) {
      return res.json({ joined: true, charged_cents: 0 });
    }
    const viaVip = vipLevel(deps, userId) > 0;
    const charge = viaVip ? 0 : board.price_cents;
    if (charge > 0) requireBalance(deps, userId, charge);
    const tx = deps.db.transaction(() => {
      if (charge > 0) debit(deps, userId, charge, 'community_board', board.id, `加入板块 ${board.name}`);
      deps.db
        .prepare('INSERT INTO community_board_memberships (board_id, user_id, amount_cents, created_at) VALUES (?, ?, ?, ?)')
        .run(board.id, userId, charge, now());
    });
    tx();
    res.status(201).json({ joined: true, charged_cents: charge, via: viaVip ? 'vip' : 'balance' });
  });

  /** 积分转账：按 Mim ID 转给其他用户，双方各记一条流水。 */
  router.post('/wallet/points/transfer', (req, res) => {
    const userId = req.user!.id;
    const body = parse(
      z.object({
        to_member_no: z.string().min(1).max(20),
        points: z.number().int().min(1).max(100000),
        note: z.string().max(80).optional(),
      }),
      req.body,
    );
    ensureWallet(deps, userId);
    const recipient = deps.db.prepare('SELECT id, member_no, display_name FROM users WHERE member_no = ?').get(body.to_member_no.toUpperCase()) as
      | { id: string; member_no: string; display_name: string | null }
      | undefined;
    if (!recipient) throw new AppError('NOT_FOUND', '接收方 Mim ID 不存在');
    if (recipient.id === userId) throw new AppError('VALIDATION_FAILED', '不能转给自己');
    const wallet = deps.db.prepare('SELECT points FROM wallets WHERE user_id = ?').get(userId) as { points: number };
    if (wallet.points < body.points) throw new AppError('VALIDATION_FAILED', '积分不足');
    const ts = now();
    const tx = deps.db.transaction(() => {
      deps.db.prepare('UPDATE wallets SET points = points - ?, updated_at = ? WHERE user_id = ?').run(body.points, ts, userId);
      deps.db
        .prepare(`INSERT INTO wallet_transactions (id, user_id, kind, points, note, created_at) VALUES (?, ?, 'points', ?, ?, ?)`)
        .run(`wt-${randomUUID()}`, userId, -body.points, `转给 ${recipient.member_no}${body.note ? `：${body.note}` : ''}`, ts);
      ensureWallet(deps, recipient.id);
      deps.db.prepare('UPDATE wallets SET points = points + ?, updated_at = ? WHERE user_id = ?').run(body.points, ts, recipient.id);
      deps.db
        .prepare(`INSERT INTO wallet_transactions (id, user_id, kind, points, note, created_at) VALUES (?, ?, 'points', ?, ?, ?)`)
        .run(`wt-${randomUUID()}`, recipient.id, body.points, `来自 ${walletOfMember(deps, userId)}${body.note ? `：${body.note}` : ''}`, ts);
    });
    tx();
    res.json({ ok: true, points: body.points, to: recipient.member_no });
  });
  /** VIP 套餐。 */
  router.get('/vip/plans', (_req, res) => {
    const plans = deps.db
      .prepare('SELECT code, name, level, price_cents, duration_days, perks FROM vip_plans WHERE active = 1 ORDER BY sort_order')
      .all() as Array<{ code: string; name: string; level: number; price_cents: number; duration_days: number; perks: string }>;
    res.json({ plans: plans.map((plan) => ({ ...plan, perks: JSON.parse(plan.perks) as string[] })) });
  });

  /** 开通 / 续费 VIP：余额扣款，有效期顺延。 */
  router.post('/vip/subscribe', (req, res) => {
    const userId = req.user!.id;
    const body = parse(z.object({ code: z.string().min(1).max(40) }), req.body);
    const plan = deps.db.prepare('SELECT * FROM vip_plans WHERE code = ? AND active = 1').get(body.code) as
      | { id: string; code: string; name: string; level: number; price_cents: number; duration_days: number }
      | undefined;
    if (!plan) throw new AppError('NOT_FOUND', '套餐不存在');
    requireBalance(deps, userId, plan.price_cents);
    const current = deps.db
      .prepare('SELECT expires_at FROM vip_memberships WHERE user_id = ? AND status = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1')
      .get(userId, 'active', now()) as { expires_at: string } | undefined;
    const start = current && new Date(current.expires_at) > new Date() ? new Date(current.expires_at) : new Date();
    const expires = new Date(start.getTime() + plan.duration_days * 86400000).toISOString();
    const tx = deps.db.transaction(() => {
      debit(deps, userId, plan.price_cents, 'vip_plan', plan.id, `开通 ${plan.name}`);
      deps.db
        .prepare(
          `INSERT INTO vip_memberships (id, user_id, plan_id, level, starts_at, expires_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
        )
        .run(`vip-${randomUUID()}`, userId, plan.id, plan.level, now(), expires, now());
      deps.db.prepare('UPDATE wallets SET points = points + 50, updated_at = ? WHERE user_id = ?').run(now(), userId);
    });
    tx();
    res.status(201).json({ ok: true, level: plan.level, expires_at: expires });
  });

  /** 钱包：余额、积分、签到状态、最近流水。 */
  router.get('/wallet', (req, res) => {
    const userId = req.user!.id;
    const wallet = ensureWallet(deps, userId);
    const day = new Date().toISOString().slice(0, 10);
    const checked = !!deps.db.prepare('SELECT 1 AS ok FROM checkins WHERE user_id = ? AND day = ?').get(userId, day);
    const tx = deps.db
      .prepare('SELECT id, kind, amount_cents, points, note, created_at FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 30')
      .all(userId);
    res.json({ wallet, checked_in_today: checked, transactions: tx, vip_level: vipLevel(deps, userId) });
  });

  /** 签到：每天 +5 积分。 */
  router.post('/wallet/checkin', (req, res) => {
    const userId = req.user!.id;
    ensureWallet(deps, userId);
    const day = new Date().toISOString().slice(0, 10);
    try {
      deps.db
        .prepare('INSERT INTO checkins (id, user_id, day, points, created_at) VALUES (?, ?, ?, 5, ?)')
        .run(`ci-${randomUUID()}`, userId, day, now());
    } catch {
      throw new AppError('CONFLICT', '今天已经签到过了');
    }
    deps.db.prepare('UPDATE wallets SET points = points + 5, updated_at = ? WHERE user_id = ?').run(now(), userId);
    deps.db
      .prepare(`INSERT INTO wallet_transactions (id, user_id, kind, points, note, created_at) VALUES (?, ?, 'points', 5, '每日签到', ?)`)
      .run(`wt-${randomUUID()}`, userId, now());
    res.json({ ok: true, points: 5 });
  });

  /** 充值卡兑换。 */
  router.post('/wallet/redeem', (req, res) => {
    const userId = req.user!.id;
    const body = parse(z.object({ code: z.string().min(6).max(60) }), req.body);
    const card = deps.db.prepare('SELECT * FROM wallet_cards WHERE code = ?').get(body.code.toUpperCase()) as
      | { id: string; amount_cents: number; status: string }
      | undefined;
    if (!card) throw new AppError('NOT_FOUND', '卡密不存在');
    if (card.status !== 'unused') throw new AppError('CONFLICT', '卡密已被使用');
    const tx = deps.db.transaction(() => {
      deps.db.prepare('UPDATE wallet_cards SET status = ?, used_by = ?, used_at = ? WHERE id = ?').run('used', userId, now(), card.id);
      credit(deps, userId, card.amount_cents, 'recharge', '充值卡兑换');
    });
    tx();
    res.json({ ok: true, amount_cents: card.amount_cents });
  });

  /** 独立商城商品列表：自动发货商品按剩余卡密算可售库存。 */
  router.get('/shop/products', (_req, res) => {
    const rows = deps.db
      .prepare(
        `SELECT p.code, p.name, p.summary, p.kind, p.price_cents, p.cover_url, p.stock, p.delivery_note,
                CASE WHEN p.kind = 'virtual_auto'
                  THEN (SELECT COUNT(*) FROM shop_card_keys k WHERE k.product_id = p.id AND k.status = 'unused')
                  ELSE p.stock END AS available
         FROM shop_products p WHERE p.status = 'active' ORDER BY p.sort_order`,
      )
      .all();
    res.json({ products: rows });
  });

  /** 下单：余额扣款 + 优惠码 + 自动发卡 / 实物地址 / 人工发货。 */
  router.post('/shop/orders', (req, res) => {
    const userId = req.user!.id;
    const body = parse(
      z.object({
        product_code: z.string().min(1).max(60),
        quantity: z.number().int().min(1).max(10).optional(),
        coupon_code: z.string().max(40).optional(),
        shipping: z
          .object({ name: z.string().min(1).max(40), phone: z.string().min(5).max(30), address: z.string().min(5).max(200) })
          .optional(),
      }),
      req.body,
    );
    const product = deps.db.prepare('SELECT * FROM shop_products WHERE code = ? AND status = ?').get(body.product_code, 'active') as
      | { id: string; code: string; name: string; kind: 'physical' | 'virtual_auto' | 'virtual_manual'; price_cents: number; stock: number }
      | undefined;
    if (!product) throw new AppError('NOT_FOUND', '商品不存在或已下架');
    const quantity = body.quantity ?? 1;
    if (product.kind === 'physical' && !body.shipping) throw new AppError('VALIDATION_FAILED', '实物商品需要填写收货信息');
    if (product.kind === 'physical' && product.stock < quantity) throw new AppError('VALIDATION_FAILED', '库存不足');
    const amount = product.price_cents * quantity;
    const coupon = couponDiscount(deps, body.coupon_code, amount);
    const payable = Math.max(0, amount - coupon.discount);
    requireBalance(deps, userId, payable);
    const orderId = `order-${randomUUID()}`;
    const tx = deps.db.transaction(() => {
      debit(deps, userId, payable, 'shop_order', orderId, `购买 ${product.name}`);
      let status: 'paid' | 'delivered' = 'paid';
      let deliveredAt: string | null = null;
      let deliveredContent: string | null = null;
      let deliveryKind = product.kind;
      if (product.kind === 'virtual_auto') {
        const key = deps.db.prepare("SELECT id, code FROM shop_card_keys WHERE product_id = ? AND status = 'unused' LIMIT 1").get(product.id) as
          | { id: string; code: string }
          | undefined;
        if (!key) throw new AppError('VALIDATION_FAILED', '该商品暂时缺货');
        deps.db.prepare("UPDATE shop_card_keys SET status = 'used', used_by = ?, used_at = ? WHERE id = ?").run(userId, now(), key.id);
        status = 'delivered';
        deliveredAt = now();
        deliveredContent = key.code;
      } else if (product.kind === 'virtual_manual') {
        deliveredContent = '下单成功，客服将在 24 小时内联系你安排远程时间。';
      }
      if (product.kind !== 'virtual_auto') {
        deps.db.prepare('UPDATE shop_products SET stock = MAX(0, stock - ?) WHERE id = ?').run(quantity, product.id);
      }
      deps.db
        .prepare(
          `INSERT INTO shop_orders (id, user_id, product_id, quantity, amount_cents, discount_cents, payable_cents, coupon_code, status, delivery_kind, delivered_content, shipping_json, created_at, paid_at, delivered_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          orderId,
          userId,
          product.id,
          quantity,
          amount,
          coupon.discount,
          payable,
          body.coupon_code?.toUpperCase() ?? null,
          status,
          deliveryKind,
          deliveredContent,
          body.shipping ? JSON.stringify(body.shipping) : null,
          now(),
          now(),
          deliveredAt,
        );
      if (coupon.couponId) {
        deps.db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(coupon.couponId);
        deps.db
          .prepare('INSERT INTO coupon_redemptions (id, coupon_id, user_id, order_id, discount_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(`cr-${randomUUID()}`, coupon.couponId, userId, orderId, coupon.discount, now());
      }
      // 推广分成：被邀请人首单，邀请人拿 5%（仅一次，标记 settled）
      const referral = deps.db.prepare("SELECT id, inviter_id FROM referrals WHERE invitee_id = ? AND status = 'bound'").get(userId) as
        | { id: string; inviter_id: string }
        | undefined;
      if (referral) {
        const commission = Math.round(payable * 0.05);
        deps.db.prepare("UPDATE referrals SET commission_cents = ?, status = 'settled' WHERE id = ?").run(commission, referral.id);
        credit(deps, referral.inviter_id, commission, 'commission', `推广首单分成（订单 ${orderId}）`);
      }
    });
    tx();
    res.status(201).json({ order_id: orderId, payable_cents: payable, discount_cents: coupon.discount, delivery_kind: product.kind });
  });

  /** 我的订单。 */
  router.get('/shop/orders', (req, res) => {
    const userId = req.user!.id;
    const items = deps.db
      .prepare(
        `SELECT o.id, o.quantity, o.amount_cents, o.discount_cents, o.payable_cents, o.coupon_code, o.status, o.delivery_kind,
                o.delivered_content, o.created_at, o.delivered_at, p.code AS product_code, p.name AS product_name, p.cover_url
         FROM shop_orders o JOIN shop_products p ON p.id = o.product_id
         WHERE o.user_id = ? ORDER BY o.created_at DESC LIMIT 50`,
      )
      .all(userId);
    res.json({ items });
  });

  /** 确认收货 / 完成人工发货。 */
  router.post('/shop/orders/:id/confirm', (req, res) => {
    const userId = req.user!.id;
    const order = deps.db.prepare('SELECT status FROM shop_orders WHERE id = ? AND user_id = ?').get(req.params.id, userId) as
      | { status: string }
      | undefined;
    if (!order) throw new AppError('NOT_FOUND', '订单不存在');
    if (order.status !== 'paid') throw new AppError('CONFLICT', '当前订单状态不可确认');
    deps.db.prepare("UPDATE shop_orders SET status = 'delivered', delivered_at = ? WHERE id = ?").run(now(), req.params.id);
    res.json({ ok: true });
  });

  /** 退款：原路退回余额；实物已发货也可退，由运营后续处理物流。 */
  router.post('/shop/orders/:id/refund', (req, res) => {
    const userId = req.user!.id;
    const order = deps.db.prepare('SELECT status, payable_cents FROM shop_orders WHERE id = ? AND user_id = ?').get(req.params.id, userId) as
      | { status: string; payable_cents: number }
      | undefined;
    if (!order) throw new AppError('NOT_FOUND', '订单不存在');
    if (order.status === 'refunded' || order.status === 'cancelled') throw new AppError('CONFLICT', '订单已退款或已取消');
    const tx = deps.db.transaction(() => {
      deps.db.prepare("UPDATE shop_orders SET status = 'refunded' WHERE id = ?").run(req.params.id);
      credit(deps, userId, order.payable_cents, 'refund', `订单退款 ${req.params.id}`);
    });
    tx();
    res.json({ ok: true, refunded_cents: order.payable_cents });
  });

  /** 优惠码预校验（不消耗次数）。 */
  router.post('/coupons/validate', (req, res) => {
    const body = parse(z.object({ code: z.string().min(1).max(40), amount_cents: z.number().int().min(0) }), req.body);
    const result = couponDiscount(deps, body.code, body.amount_cents);
    res.json({ valid: true, discount_cents: result.discount });
  });

  /** 推广中心：邀请码、已邀请人数与累计佣金。 */
  router.get('/referral', (req, res) => {
    const userId = req.user!.id;
    let code = deps.db.prepare('SELECT code FROM referral_codes WHERE user_id = ?').get(userId) as { code: string } | undefined;
    if (!code) {
      const generated = `MIM${userId.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase()}`;
      deps.db.prepare('INSERT OR IGNORE INTO referral_codes (user_id, code, created_at) VALUES (?, ?, ?)').run(userId, generated, now());
      code = { code: generated };
    }
    const invited = deps.db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(commission_cents), 0) AS commission FROM referrals WHERE inviter_id = ?').get(userId);
    res.json({ code: code.code, invited, commission_cents: (invited as { commission: number }).commission });
  });

  /** 绑定邀请码：仅新用户、仅一次、不能绑自己。 */
  router.post('/referral/bind', (req, res) => {
    const userId = req.user!.id;
    const body = parse(z.object({ code: z.string().min(4).max(40) }), req.body);
    if (deps.db.prepare('SELECT 1 AS ok FROM referrals WHERE invitee_id = ?').get(userId)) throw new AppError('CONFLICT', '已绑定过邀请码');
    const inviter = deps.db.prepare('SELECT user_id FROM referral_codes WHERE code = ?').get(body.code.toUpperCase()) as { user_id: string } | undefined;
    if (!inviter) throw new AppError('NOT_FOUND', '邀请码不存在');
    if (inviter.user_id === userId) throw new AppError('VALIDATION_FAILED', '不能绑定自己的邀请码');
    deps.db
      .prepare("INSERT INTO referrals (id, inviter_id, invitee_id, code, status, created_at) VALUES (?, ?, ?, ?, 'bound', ?)")
      .run(`ref-${randomUUID()}`, inviter.user_id, userId, body.code.toUpperCase(), now());
    res.json({ ok: true });
  });

  return router;
}
