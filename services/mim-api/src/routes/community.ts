/** 社区与变现路由：论坛 / 付费阅读 / VIP / 钱包积分 / 独立商城 / 优惠码 / 推广分成 */

import { Router } from 'express'; // Express 路由容器
import { randomUUID } from 'node:crypto'; // 稳定主键生成
import { z } from 'zod'; // 入参声明式校验
import { AppError } from '@mim/core-domain'; // 统一业务异常
import { parse } from '../validate.js'; // 校验失败统一翻译
import { idempotency, requireAuth, requirePermission } from '../middleware.js'; // 鉴权 / 权限门禁 / 写操作幂等
import { auditText, assertPublicHttpUrl, verifyCaptcha } from '../security.js'; // 内容审核 / 远程链接 SSRF / 场景验证码
import { readPointsConfig } from '../commerce/config.js'; // 积分兑换比例与单笔上限配置
import { computeDeduction, deductPoints, getPointsBalance } from '../commerce/points.js'; // 积分抵扣纯计算 + 事务扣减
import type { ApiDeps } from '../types.js'; // 引入依赖：声明本文件使用的外部能力
import { checkPostRateLimit, resolveQuota } from '../community/limits.js'; // 三期：发帖频控与配额
import { loadWeights, refreshRecommendScore, saveWeights, DEFAULT_WEIGHTS } from '../community/recommend.js'; // 三期：推荐指数
import { DEFAULT_TABS, loadBoardTabs, saveBoardTabs, SORT_BY_KEYS, type TabInput } from '../community/tabs.js'; // 三期：板块 Tab 组合
import { readHomeSetting, writeHomeSetting, boardReviewEnabled, saveBoardReviewEnabled, type HomeView } from '../community/settings.js'; // 三期：首页指向与审核开关
import { findBlockedWord } from '../community/sensitive.js'; // 三期：本地敏感词校验 // 依赖容器

const now = () => new Date().toISOString(); // 统一 UTC 时间

/** 确保当前用户有钱包行；新用户开箱即 0 余额、100 积分。 */
function ensureWallet(deps: ApiDeps, userId: string) { // 定义函数 ensureWallet：封装可复用业务步骤
  const existing = deps.db.prepare('SELECT user_id, balance_cents, points FROM wallets WHERE user_id = ?').get(userId) as // 保存 existing：承载本步骤的计算结果供后续使用
    | { user_id: string; balance_cents: number; points: number } // 业务步骤：推进当前流程的下一项处理
    | undefined; // 业务步骤：推进当前流程的下一项处理
  if (existing) return existing; // 条件分支：仅在满足业务前置条件时继续
  const row = { user_id: userId, balance_cents: 0, points: 100 }; // 保存 row：承载本步骤的计算结果供后续使用
  deps.db.prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, ?, ?, ?)').run( // 预编译 SQL：固定语句结构后绑定参数执行
    userId, // 业务步骤：推进当前流程的下一项处理
    row.balance_cents, // 业务步骤：推进当前流程的下一项处理
    row.points, // 业务步骤：推进当前流程的下一项处理
    now(), // 业务步骤：推进当前流程的下一项处理
  ); // 调用结束：参数列表与链式调用收尾
  deps.db.prepare( // 预编译 SQL：固定语句结构后绑定参数执行
    `INSERT INTO wallet_transactions (id, user_id, kind, points, note, created_at) VALUES (?, ?, 'points', 100, '新用户见面礼', ?)`, // 业务步骤：推进当前流程的下一项处理
  ).run(`wt-${randomUUID()}`, userId, now()); // 执行写入：把参数落库并返回影响结果
  return row; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 读取当前用户 Mim ID，用于积分转账备注。 */
function walletOfMember(deps: ApiDeps, userId: string): string { // 定义函数 walletOfMember：封装可复用业务步骤
  const row = deps.db.prepare('SELECT member_no FROM users WHERE id = ?').get(userId) as { member_no: string | null } | undefined; // 保存 row：承载本步骤的计算结果供后续使用
  return row?.member_no ?? userId; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 当前有效 VIP 等级；0 表示非会员。 */
function vipLevel(deps: ApiDeps, userId: string): number {  const row = deps.db // 定义函数 vipLevel：封装可复用业务步骤
    .prepare(`SELECT level FROM vip_memberships WHERE user_id = ? AND status = 'active' AND expires_at > ? ORDER BY level DESC LIMIT 1`) // 预编译 SQL：固定语句结构后绑定参数执行
    .get(userId, now()) as { level: number } | undefined; // 查询单行：读取一条记录供判定使用
  return row?.level ?? 0; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 当前用户是否有权查看某帖：免费 / 已购 / VIP。 */
function hasThreadAccess(deps: ApiDeps, userId: string, threadId: string, priceCents: number): boolean { // 定义函数 hasThreadAccess：封装可复用业务步骤
  if (priceCents <= 0) return true; // 条件分支：仅在满足业务前置条件时继续
  if (vipLevel(deps, userId) > 0) return true; // 条件分支：仅在满足业务前置条件时继续
  return !!deps.db.prepare('SELECT 1 AS ok FROM community_purchases WHERE user_id = ? AND thread_id = ?').get(userId, threadId); // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 当前用户等级：与 growth 路由同一口径（积分 / 订单 / 签到），用于板块发帖门槛。 */
function levelOfUser(deps: ApiDeps, userId: string): number { // 定义函数 levelOfUser：封装可复用业务步骤
  const points = (deps.db.prepare('SELECT points FROM wallets WHERE user_id = ?').get(userId) as { points: number } | undefined)?.points ?? 0; // 保存 points：承载本步骤的计算结果供后续使用
  const orders = (deps.db.prepare('SELECT COUNT(*) AS count FROM shop_orders WHERE user_id = ?').get(userId) as { count: number } | undefined)?.count ?? 0; // 保存 orders：承载本步骤的计算结果供后续使用
  return Math.min(10, 1 + Math.floor(points / 300) + Math.floor(orders / 3)); // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 板块访问：付费门槛 + followers 可见性；版主 / 创建者 / 运营不受关注限制。 */
function hasBoardAccess(deps: ApiDeps, userId: string, boardId: string, boardPriceCents?: number): boolean { // 定义函数 hasBoardAccess：封装可复用业务步骤
  const board = deps.db // 保存 board：承载本步骤的计算结果供后续使用
    .prepare('SELECT id, price_cents, visibility, created_by, moderator_id FROM community_boards WHERE id = ?') // 预编译 SQL：固定语句结构后绑定参数执行
    .get(boardId) as { id: string; price_cents: number; visibility: string; created_by: string | null; moderator_id: string | null } | undefined; // 查询单行：读取一条记录供判定使用
  if (!board) return false; // 条件分支：仅在满足业务前置条件时继续
  const price = boardPriceCents ?? board.price_cents; // 保存 price：承载本步骤的计算结果供后续使用
  if (price > 0 && vipLevel(deps, userId) === 0) { // 条件分支：仅在满足业务前置条件时继续
    const joined = deps.db.prepare('SELECT 1 AS ok FROM community_board_memberships WHERE board_id = ? AND user_id = ?').get(boardId, userId); // 保存 joined：承载本步骤的计算结果供后续使用
    if (!joined) return false; // 条件分支：仅在满足业务前置条件时继续
  } // 结束条件分支：本层作用域收尾
  if (board.visibility === 'followers' && board.created_by !== userId && board.moderator_id !== userId) { // 条件分支：仅在满足业务前置条件时继续
    const followed = deps.db.prepare('SELECT 1 AS ok FROM community_board_follows WHERE board_id = ? AND user_id = ?').get(boardId, userId); // 保存 followed：承载本步骤的计算结果供后续使用
    if (!followed) return false; // 条件分支：仅在满足业务前置条件时继续
  } // 结束条件分支：本层作用域收尾
  return true; // 返回结果：把本步骤产物交给调用方
} // 结束函数体：本层作用域收尾

/** 对外可见性口径：price_cents > 0 即付费板块（paid），否则按 visibility 列取值。 */
function effectiveVisibility(board: { price_cents: number; visibility: string }): string { // 定义函数 effectiveVisibility：封装可复用业务步骤
  return board.price_cents > 0 ? 'paid' : board.visibility; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

/** 当前用户是否可管理该板块：创建者 / 版主本人，或后续由运营权限端点放行。 */
function canModerateBoard(board: { created_by: string | null; moderator_id: string | null }, userId: string): boolean { // 定义函数 canModerateBoard：封装可复用业务步骤
  return board.created_by === userId || board.moderator_id === userId; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

/** 建板块门槛：等级阈值与每人数量上限；板块配置为 0 时回落环境变量 / 内置默认。 */
function createLimits(deps: ApiDeps, board: { create_min_level?: number | null; create_max_per_user?: number | null }): { minLevel: number; maxPerUser: number } { // 定义函数 createLimits：封装可复用业务步骤
  const env = deps.env; // 保存 env：承载本步骤的计算结果供后续使用
  const minLevel = (board.create_min_level ?? 0) > 0 ? (board.create_min_level as number) : Number(env.MIM_COMMUNITY_CREATE_MIN_LEVEL ?? '5') || 5; // 保存 minLevel：承载本步骤的计算结果供后续使用
  const maxPerUser = (board.create_max_per_user ?? 0) > 0 ? (board.create_max_per_user as number) : Number(env.MIM_COMMUNITY_CREATE_MAX ?? '3') || 3; // 保存 maxPerUser：承载本步骤的计算结果供后续使用
  return { minLevel, maxPerUser }; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

/** 钱包余额是否足够；不足抛带 details 的校验错误，前端可识别。 */
function requireBalance(deps: ApiDeps, userId: string, amount: number): { balance_cents: number; points: number } { // 定义函数 requireBalance：封装可复用业务步骤
  const wallet = ensureWallet(deps, userId); // 保存 wallet：承载本步骤的计算结果供后续使用
  if (wallet.balance_cents < amount) // 条件分支：仅在满足业务前置条件时继续
    throw new AppError('VALIDATION_FAILED', '余额不足，请先在钱包用卡密充值', { // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
      reason: 'INSUFFICIENT_BALANCE', // 对象字段：声明结构中的一项数据
      required_cents: amount, // 对象字段：声明结构中的一项数据
      balance_cents: wallet.balance_cents, // 对象字段：声明结构中的一项数据
    }); // 结束代码块：本层作用域收尾
  return wallet; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

/** 扣余额并写一条消费流水。 */
function debit(deps: ApiDeps, userId: string, amount: number, refType: string, refId: string, note: string) { // 定义函数 debit：封装可复用业务步骤
  ensureWallet(deps, userId); // 先保证钱包行存在，否则首次消费的 UPDATE 会静默落空
  deps.db.prepare('UPDATE wallets SET balance_cents = balance_cents - ?, updated_at = ? WHERE user_id = ?').run(amount, now(), userId); // 预编译 SQL：固定语句结构后绑定参数执行
  deps.db // 业务步骤：推进当前流程的下一项处理
    .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
      `INSERT INTO wallet_transactions (id, user_id, kind, amount_cents, ref_type, ref_id, note, created_at) VALUES (?, ?, 'consume', ?, ?, ?, ?, ?)`, // 业务步骤：推进当前流程的下一项处理
    ) // 调用结束：参数列表与链式调用收尾
    .run(`wt-${randomUUID()}`, userId, -amount, refType, refId, note, now()); // 执行写入：把参数落库并返回影响结果
} // 结束函数体：本层作用域收尾

/** 加余额并写一条充值 / 退款流水。 */
function credit(deps: ApiDeps, userId: string, amount: number, kind: 'recharge' | 'refund' | 'commission', note: string) { // 定义函数 credit：封装可复用业务步骤
  ensureWallet(deps, userId); // 先保证钱包行存在，避免首次充值 / 退款 / 分成的 UPDATE 静默落空
  deps.db.prepare('UPDATE wallets SET balance_cents = balance_cents + ?, updated_at = ? WHERE user_id = ?').run(amount, now(), userId); // 预编译 SQL：固定语句结构后绑定参数执行
  deps.db // 业务步骤：推进当前流程的下一项处理
    .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
      `INSERT INTO wallet_transactions (id, user_id, kind, amount_cents, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`, // 业务步骤：推进当前流程的下一项处理
    ) // 调用结束：参数列表与链式调用收尾
    .run(`wt-${randomUUID()}`, userId, kind, amount, note, now()); // 执行写入：把参数落库并返回影响结果
} // 结束函数体：本层作用域收尾

/** 计算优惠码折扣：fixed 固定立减，percent 百分比（value=20 即 8 折）。 */
function couponDiscount(deps: ApiDeps, code: string | undefined, amount: number): { code: string | null; discount: number; couponId: string | null } { // 定义函数 couponDiscount：封装可复用业务步骤
  if (!code) return { code: null, discount: 0, couponId: null }; // 条件分支：仅在满足业务前置条件时继续
  const coupon = deps.db.prepare('SELECT * FROM coupons WHERE code = ? AND active = 1').get(code.toUpperCase()) as // 保存 coupon：承载本步骤的计算结果供后续使用
    | { id: string; kind: 'fixed' | 'percent'; value: number; min_amount_cents: number; max_uses: number; used_count: number; expires_at: string | null } // 业务步骤：推进当前流程的下一项处理
    | undefined; // 业务步骤：推进当前流程的下一项处理
  if (!coupon) throw new AppError('NOT_FOUND', '优惠码不存在或已停用'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
  if (coupon.expires_at && coupon.expires_at < now()) throw new AppError('VALIDATION_FAILED', '优惠码已过期'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
  if (coupon.max_uses > 0 && coupon.used_count >= coupon.max_uses) throw new AppError('VALIDATION_FAILED', '优惠码已使用完'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
  if (amount < coupon.min_amount_cents) // 条件分支：仅在满足业务前置条件时继续
    throw new AppError('VALIDATION_FAILED', `订单满 ${(coupon.min_amount_cents / 100).toFixed(2)} 元可用`, { // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
      reason: 'COUPON_MIN_AMOUNT', // 对象字段：声明结构中的一项数据
      min_amount_cents: coupon.min_amount_cents, // 对象字段：声明结构中的一项数据
    }); // 结束代码块：本层作用域收尾
  const discount = coupon.kind === 'fixed' ? Math.min(coupon.value, amount) : Math.min(Math.round((amount * coupon.value) / 100), amount); // 保存 discount：承载本步骤的计算结果供后续使用
  return { code: coupon.id, discount, couponId: coupon.id }; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾

// 本路由承载的全部命名空间前缀：鉴权与幂等只挂在这些前缀上，
// 避免裸 router.use 全局拦截穿过本 router 的其他命名空间（如后台 /admin）请求。
const COMMUNITY_PREFIXES = ['/community', '/vip', '/wallet', '/shop', '/coupons', '/referral']; // 保存 COMMUNITY_PREFIXES：承载本步骤的计算结果供后续使用

export function createCommunityRouter(deps: ApiDeps): Router { // 定义函数 createCommunityRouter：封装可复用业务步骤
  const router = Router(); // 保存 router：承载本步骤的计算结果供后续使用

  // ---- 公开只读端点：先于 requireAuth 注册，匿名访客也可读取权威展示配置 ----

  /** 论坛设为首页：读取当前首页指向（community 论坛 / portal 门户），权威配置由前端消费。 */
  router.get('/community/home-setting', (_req, res) => { // 路由 GET /community/home-setting：注册入口并绑定鉴权与处理逻辑
    res.json({ home: readHomeSetting(deps.db) }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 板块 Tab 栏目配置读取：缺省清单 + 板块持久化覆盖，公开供板块页渲染。 */
  router.get('/community/boards/:slug/tabs', (req, res) => { // 路由 GET /community/boards/:slug/tabs：注册入口并绑定鉴权与处理逻辑
    const board = deps.db.prepare('SELECT id, status FROM community_boards WHERE slug = ?').get(req.params.slug) as // 保存 board：承载本步骤的计算结果供后续使用
      | { id: string; status: string } // 业务步骤：推进当前流程的下一项处理
      | undefined; // 业务步骤：推进当前流程的下一项处理
    if (!board) throw new AppError('NOT_FOUND', '板块不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    res.json({ tabs: loadBoardTabs(deps.db, board.id) }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 推荐指数权重读取：公开当前生效权重（环境变量覆盖不在此回显，仅回显持久化 / 默认值）。 */
  router.get('/community/recommend-weights', (_req, res) => { // 路由 GET /community/recommend-weights：注册入口并绑定鉴权与处理逻辑
    res.json({ weights: loadWeights(deps.env, deps.db), defaults: DEFAULT_WEIGHTS }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  // ---- 运营管理端点：先于 requireAuth 注册，requirePermission 内部识别超管引导令牌通道 ----

  /** 待审核板块队列：运营查看 pending 板块列表。 */
  router.get('/community/boards/pending', requirePermission('appearance:write'), (_req, res) => { // 路由 GET /community/boards/pending：注册入口并绑定鉴权与处理逻辑
    const boards = deps.db // 保存 boards：承载本步骤的计算结果供后续使用
      .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
        `SELECT b.id, b.slug, b.name, b.description, b.icon, b.price_cents, b.visibility, b.status, b.created_by, b.created_at,
                u.display_name AS creator_name
           FROM community_boards b LEFT JOIN users u ON u.id = b.created_by
          WHERE b.status = 'pending' ORDER BY b.created_at ASC`,
      ) // 调用结束：参数列表与链式调用收尾
      .all(); // 查询多行：读取列表供批量处理
    res.json({ boards }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 审核通过：板块上架，普通访客可见可发帖。 */
  router.post('/community/boards/:slug/approve', requirePermission('appearance:write'), (req, res) => { // 路由 POST /community/boards/:slug/approve：注册入口并绑定鉴权与处理逻辑
    const board = deps.db.prepare('SELECT id, status FROM community_boards WHERE slug = ?').get(req.params.slug) as { id: string; status: string } | undefined; // 保存 board：承载本步骤的计算结果供后续使用
    if (!board) throw new AppError('NOT_FOUND', '板块不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    if (board.status !== 'pending') throw new AppError('CONFLICT', '该板块不在待审核队列'); // 业务拒绝 CONFLICT：以统一错误码终止当前请求
    deps.db.prepare("UPDATE community_boards SET status = 'active', review_note = NULL, reviewed_at = ? WHERE id = ?").run(now(), board.id); // 预编译 SQL：固定语句结构后绑定参数执行
    res.json({ ok: true, slug: req.params.slug, status: 'active' }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 审核驳回：记录原因，板块保持不可见。 */
  router.post('/community/boards/:slug/reject', requirePermission('appearance:write'), (req, res) => { // 路由 POST /community/boards/:slug/reject：注册入口并绑定鉴权与处理逻辑
    const board = deps.db.prepare('SELECT id, status FROM community_boards WHERE slug = ?').get(req.params.slug) as { id: string; status: string } | undefined; // 保存 board：承载本步骤的计算结果供后续使用
    if (!board) throw new AppError('NOT_FOUND', '板块不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    if (board.status !== 'pending') throw new AppError('CONFLICT', '该板块不在待审核队列'); // 业务拒绝 CONFLICT：以统一错误码终止当前请求
    const body = parse(z.object({ note: z.string().max(200).default('') }), req.body); // 保存 body：承载本步骤的计算结果供后续使用
    deps.db.prepare("UPDATE community_boards SET status = 'rejected', review_note = ?, reviewed_at = ? WHERE id = ?").run(body.note, now(), board.id); // 预编译 SQL：固定语句结构后绑定参数执行
    res.json({ ok: true, slug: req.params.slug, status: 'rejected' }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 论坛设为首页：运营写入首页指向（community 论坛 / portal 门户），权威配置供前端消费。 */
  router.put('/community/home-setting', requirePermission('appearance:write'), (req, res) => { // 路由 PUT /community/home-setting：注册入口并绑定鉴权与处理逻辑
    const body = parse(z.object({ home: z.enum(['community', 'portal']) }), req.body); // 保存 body：承载本步骤的计算结果供后续使用
    writeHomeSetting(deps.db, body.home as HomeView, now()); // 业务步骤：推进当前流程的下一项处理
    res.json({ ok: true, home: readHomeSetting(deps.db) }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 建板块审核开关：运营读取 / 切换新板块是否进入 pending 队列。 */
  router.get('/community/review-setting', requirePermission('appearance:write'), (_req, res) => { // 路由 GET /community/review-setting：注册入口并绑定鉴权与处理逻辑
    res.json({ review_enabled: boardReviewEnabled(deps.db, deps.env) }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾
  router.put('/community/review-setting', requirePermission('appearance:write'), (req, res) => { // 路由 PUT /community/review-setting：注册入口并绑定鉴权与处理逻辑
    const body = parse(z.object({ enabled: z.boolean() }), req.body); // 保存 body：承载本步骤的计算结果供后续使用
    saveBoardReviewEnabled(deps.db, body.enabled, now()); // 业务步骤：推进当前流程的下一项处理
    res.json({ ok: true, review_enabled: boardReviewEnabled(deps.db, deps.env) }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 推荐指数权重：运营持久化可调权重；环境变量 JSON 覆盖仍优先生效。 */
  router.put('/community/recommend-weights', requirePermission('appearance:write'), (req, res) => { // 路由 PUT /community/recommend-weights：注册入口并绑定鉴权与处理逻辑
    const body = parse( // 保存 body：承载本步骤的计算结果供后续使用
      z.object({ // 业务步骤：推进当前流程的下一项处理
        views: z.number().min(0).max(1000).optional(), // 对象字段：声明结构中的一项数据
        replies: z.number().min(0).max(1000).optional(), // 对象字段：声明结构中的一项数据
        favorites: z.number().min(0).max(1000).optional(), // 对象字段：声明结构中的一项数据
        rating: z.number().min(0).max(1000).optional(), // 对象字段：声明结构中的一项数据
        halfLifeDays: z.number().min(0.5).max(365).optional(), // 对象字段：声明结构中的一项数据
      }), // 结束代码块：本层作用域收尾
      req.body, // 读取请求：取得入参、身份或上下文
    ); // 调用结束：参数列表与链式调用收尾
    const current = loadWeights(deps.env, deps.db); // 保存 current：承载本步骤的计算结果供后续使用
    const merged = { ...current, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) }; // 保存 merged：承载本步骤的计算结果供后续使用
    saveWeights(deps.db, merged, now()); // 业务步骤：推进当前流程的下一项处理
    res.json({ ok: true, weights: loadWeights(deps.env, deps.db) }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  router.use(COMMUNITY_PREFIXES, requireAuth); // 社区与资产全部需要会话；访客会话同样可用
  router.use(COMMUNITY_PREFIXES, idempotency); // 写操作幂等，防重复扣款 / 重复发卡

  /** 社区首页聚合：板块、统计、当前会员与钱包。 */
  router.get('/community/overview', (req, res) => { // 路由 GET /community/overview：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const boards = deps.db // 保存 boards：承载本步骤的计算结果供后续使用
      .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
        `SELECT b.slug, b.name, b.description, b.icon, b.sort_order, b.price_cents,
                b.visibility, b.post_min_level, b.status,
                (SELECT COUNT(*) FROM community_board_memberships m WHERE m.board_id = b.id AND m.user_id = ?) AS joined,
                (SELECT COUNT(*) FROM community_board_follows cf WHERE cf.board_id = b.id AND cf.user_id = ?) AS followed,
                (SELECT COUNT(*) FROM community_threads t WHERE t.board_id = b.id AND t.status = 'published') AS thread_count,
                CASE WHEN b.moderator_id = ? OR b.created_by = ? THEN 1 ELSE 0 END AS is_moderator
         FROM community_boards b
         WHERE b.status = 'active' OR b.created_by = ? OR b.moderator_id = ?
         ORDER BY b.sort_order ASC`,
      ) // 调用结束：参数列表与链式调用收尾
      .all(userId, userId, userId, userId, userId, userId); // 查询多行：读取列表供批量处理
    const stats = deps.db // 保存 stats：承载本步骤的计算结果供后续使用
      .prepare(`SELECT COUNT(*) AS threads, COALESCE(SUM(views), 0) AS views, COALESCE(SUM(likes), 0) AS likes FROM community_threads WHERE status = 'published'`) // 预编译 SQL：固定语句结构后绑定参数执行
      .get(); // 查询单行：读取一条记录供判定使用
    const wallet = ensureWallet(deps, userId); // 保存 wallet：承载本步骤的计算结果供后续使用
    const level = vipLevel(deps, userId); // 保存 level：承载本步骤的计算结果供后续使用
    const vip = deps.db // 保存 vip：承载本步骤的计算结果供后续使用
      .prepare(`SELECT plan_id, level, expires_at FROM vip_memberships WHERE user_id = ? AND status = 'active' AND expires_at > ? ORDER BY level DESC LIMIT 1`) // 预编译 SQL：固定语句结构后绑定参数执行
      .get(userId, now()) as { plan_id: string; level: number; expires_at: string } | undefined; // 查询单行：读取一条记录供判定使用
    res.json({ boards, stats, wallet, vip_level: level, vip: vip ?? null, user_level: levelOfUser(deps, userId) }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 板块列表。 */
  router.get('/community/boards', (req, res) => { // 路由 GET /community/boards：注册入口并绑定鉴权与处理逻辑
    const boards = deps.db // 保存 boards：承载本步骤的计算结果供后续使用
      .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
        `SELECT b.slug, b.name, b.description, b.icon, b.price_cents,
                b.visibility, b.post_min_level, b.status,
                (SELECT COUNT(*) FROM community_board_memberships m WHERE m.board_id = b.id AND m.user_id = ?) AS joined,
                (SELECT COUNT(*) FROM community_board_follows cf WHERE cf.board_id = b.id AND cf.user_id = ?) AS followed,
                (SELECT COUNT(*) FROM community_threads t WHERE t.board_id = b.id AND t.status = 'published') AS thread_count,
                CASE WHEN b.moderator_id = ? OR b.created_by = ? THEN 1 ELSE 0 END AS is_moderator
         FROM community_boards b
         WHERE b.status = 'active' OR b.created_by = ? OR b.moderator_id = ?
         ORDER BY b.sort_order ASC`,
      ) // 调用结束：参数列表与链式调用收尾
      .all(req.user!.id, req.user!.id, req.user!.id, req.user!.id, req.user!.id, req.user!.id); // 查询多行：读取列表供批量处理
    res.json({ boards }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 帖子列表：板块 / 形态 / 排序 / 关键词 / 分页。 */
  router.get('/community/threads', (req, res) => { // 路由 GET /community/threads：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''; // 保存 q：承载本步骤的计算结果供后续使用
    const board = typeof req.query.board === 'string' && req.query.board !== 'all' ? req.query.board : ''; // 保存 board：承载本步骤的计算结果供后续使用
    const kind = typeof req.query.kind === 'string' && req.query.kind !== 'all' ? req.query.kind : ''; // 保存 kind：承载本步骤的计算结果供后续使用
    const sort = ['hot', 'views', 'replies', 'favorites', 'rating', 'recommend'].includes(String(req.query.sort)) // 保存 sort：承载本步骤的计算结果供后续使用
      ? String(req.query.sort) // 业务步骤：推进当前流程的下一项处理
      : 'latest'; // 业务步骤：推进当前流程的下一项处理
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '24'), 10) || 24, 1), 60); // 保存 limit：承载本步骤的计算结果供后续使用
    const where: string[] = ["t.status = 'published'", "(b.status = 'active' OR b.created_by = ? OR b.moderator_id = ?)"]; // 保存 where：承载本步骤的计算结果供后续使用
    const args: unknown[] = [userId, userId]; // 保存 args：承载本步骤的计算结果供后续使用
    if (board) { // 条件分支：仅在满足业务前置条件时继续
      where.push('b.slug = ?'); // 业务步骤：推进当前流程的下一项处理
      args.push(board); // 业务步骤：推进当前流程的下一项处理
    } // 结束条件分支：本层作用域收尾
    if (kind) { // 条件分支：仅在满足业务前置条件时继续
      where.push('t.kind = ?'); // 业务步骤：推进当前流程的下一项处理
      args.push(kind); // 业务步骤：推进当前流程的下一项处理
    } // 结束条件分支：本层作用域收尾
    if (q) { // 条件分支：仅在满足业务前置条件时继续
      where.push('(t.title LIKE ? OR t.summary LIKE ?)'); // 业务步骤：推进当前流程的下一项处理
      args.push(`%${q}%`, `%${q}%`); // 业务步骤：推进当前流程的下一项处理
    } // 结束函数体：本层作用域收尾
    const order = // 保存 order：承载本步骤的计算结果供后续使用
      sort === 'hot' // 赋值：更新当前作用域中的状态
        ? 't.likes DESC, t.views DESC, t.last_activity_at DESC' // 业务步骤：推进当前流程的下一项处理
        : sort === 'views' // 业务步骤：推进当前流程的下一项处理
          ? 't.views DESC, t.last_activity_at DESC' // 业务步骤：推进当前流程的下一项处理
          : sort === 'replies' // 业务步骤：推进当前流程的下一项处理
            ? 't.reply_count DESC, t.last_activity_at DESC' // 业务步骤：推进当前流程的下一项处理
            : sort === 'favorites' // 业务步骤：推进当前流程的下一项处理
              ? 'favorite_count DESC, t.last_activity_at DESC' // 业务步骤：推进当前流程的下一项处理
              : sort === 'rating' // 业务步骤：推进当前流程的下一项处理
                ? 'rating_avg DESC, rating_count DESC, t.last_activity_at DESC' // 业务步骤：推进当前流程的下一项处理
                : sort === 'recommend' // 业务步骤：推进当前流程的下一项处理
                  ? 't.recommend_score DESC, t.last_activity_at DESC' // 业务步骤：推进当前流程的下一项处理
                  : 't.last_activity_at DESC'; // 业务步骤：推进当前流程的下一项处理
    const rows = deps.db // 保存 rows：承载本步骤的计算结果供后续使用
      .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
        `SELECT t.id, t.title, t.summary, t.kind, t.cover_url, t.price_cents, t.views, t.likes, t.reply_count,
                t.recommend_score,
                t.created_at, t.last_activity_at, b.slug AS board_slug, b.name AS board_name, b.price_cents AS board_price_cents,
                b.visibility AS board_visibility, b.post_min_level AS board_post_min_level,
                u.display_name AS author_name,
                (SELECT COUNT(*) FROM community_purchases p WHERE p.thread_id = t.id AND p.user_id = ?) AS purchased,
                (SELECT COUNT(*) FROM community_favorites f WHERE f.thread_id = t.id AND f.user_id = ?) AS favorited,
                (SELECT COUNT(*) FROM community_favorites f WHERE f.thread_id = t.id) AS favorite_count,
                (SELECT ROUND(AVG(r.rating), 2) FROM community_ratings r WHERE r.thread_id = t.id) AS rating_avg,
                (SELECT COUNT(*) FROM community_ratings r WHERE r.thread_id = t.id) AS rating_count,
                (SELECT COUNT(*) FROM community_board_memberships m WHERE m.board_id = b.id AND m.user_id = ?) AS board_joined,
                (SELECT COUNT(*) FROM community_board_follows cf WHERE cf.board_id = b.id AND cf.user_id = ?) AS board_followed
         FROM community_threads t
         JOIN community_boards b ON b.id = t.board_id
         LEFT JOIN users u ON u.id = t.author_id
         WHERE ${where.join(' AND ')}
         ORDER BY ${order}
         LIMIT ?`,
      ) // 调用结束：参数列表与链式调用收尾
      .all(userId, userId, userId, userId, ...args, limit); // 查询多行：读取列表供批量处理
    const level = vipLevel(deps, userId); // 保存 level：承载本步骤的计算结果供后续使用
    const items = (rows as Array<Record<string, unknown> & { price_cents: number; purchased: number; board_price_cents: number; board_joined: number; board_visibility: string; board_followed: number }>).map((row) => ({ // 保存 items：承载本步骤的计算结果供后续使用
      ...row, // 链式调用：在上一步结果上继续处理
      locked: // 对象字段：声明结构中的一项数据
        (row.price_cents > 0 && row.purchased === 0 && level === 0) || // 业务步骤：推进当前流程的下一项处理
        (row.board_price_cents > 0 && row.board_joined === 0 && level === 0) || // 业务步骤：推进当前流程的下一项处理
        (row.board_visibility === 'followers' && row.board_followed === 0), // 业务步骤：推进当前流程的下一项处理
    })); // 结束函数体：本层作用域收尾
    res.json({ items, total: items.length, sort, vip_level: level }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束代码块：本层作用域收尾

  /** 帖子详情：未解锁时隐藏正文与回复。 */
  router.get('/community/threads/:id', (req, res) => { // 路由 GET /community/threads/:id：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const id = req.params.id; // 保存 id：承载本步骤的计算结果供后续使用
    const thread = deps.db // 保存 thread：承载本步骤的计算结果供后续使用
      .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
        `SELECT t.*, b.slug AS board_slug, b.id AS board_id, b.name AS board_name, b.price_cents AS board_price_cents,
                b.visibility AS board_visibility, b.status AS board_status, b.created_by AS board_created_by, b.moderator_id AS board_moderator_id,
                u.display_name AS author_name,
                (SELECT COUNT(*) FROM community_purchases p WHERE p.thread_id = t.id AND p.user_id = ?) AS purchased,
                (SELECT COUNT(*) FROM community_favorites f WHERE f.thread_id = t.id AND f.user_id = ?) AS favorited,
                (SELECT COUNT(*) FROM community_board_follows cf WHERE cf.board_id = b.id AND cf.user_id = ?) AS board_followed,
                (SELECT ROUND(AVG(r.rating), 2) FROM community_ratings r WHERE r.thread_id = t.id) AS rating_avg,
                (SELECT COUNT(*) FROM community_ratings r WHERE r.thread_id = t.id) AS rating_count,
                (SELECT rating FROM community_ratings r WHERE r.thread_id = t.id AND r.user_id = ?) AS my_rating
         FROM community_threads t JOIN community_boards b ON b.id = t.board_id LEFT JOIN users u ON u.id = t.author_id
         WHERE t.id = ? AND t.status = 'published'`,
      ) // 调用结束：参数列表与链式调用收尾
      .get(userId, userId, userId, userId, id) as // 查询单行：读取一条记录供判定使用
      | (Record<string, unknown> & { // 业务步骤：推进当前流程的下一项处理
          price_cents: number; // 对象字段：声明结构中的一项数据
          purchased: number; // 对象字段：声明结构中的一项数据
          board_id: string; // 对象字段：声明结构中的一项数据
          board_price_cents: number; // 对象字段：声明结构中的一项数据
          body: string; // 对象字段：声明结构中的一项数据
          favorited: number; // 对象字段：声明结构中的一项数据
          board_followed: number; // 对象字段：声明结构中的一项数据
          board_created_by: string | null; // 对象字段：声明结构中的一项数据
          board_moderator_id: string | null; // 对象字段：声明结构中的一项数据
          board_status: string; // 对象字段：声明结构中的一项数据
          author_id: string | null; // 对象字段：声明结构中的一项数据
          accepted_post_id: string | null; // 对象字段：声明结构中的一项数据
        }) // 结束代码块：本层作用域收尾
      | undefined; // 业务步骤：推进当前流程的下一项处理
    if (!thread) throw new AppError('NOT_FOUND', '帖子不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    if (thread.board_status !== 'active' && thread.board_created_by !== userId && thread.board_moderator_id !== userId && thread.author_id !== userId) { // 条件分支：仅在满足业务前置条件时继续
      throw new AppError('NOT_FOUND', '帖子不存在'); // 待审核 / 被驳回板块的帖子对普通访客不可见
    } // 结束条件分支：本层作用域收尾
    deps.db.prepare('UPDATE community_threads SET views = views + 1 WHERE id = ?').run(id); // 预编译 SQL：固定语句结构后绑定参数执行
    refreshRecommendScore(deps, id); // 浏览量计入推荐指数
    const boardUnlocked = hasBoardAccess(deps, userId, thread.board_id, thread.board_price_cents); // 保存 boardUnlocked：承载本步骤的计算结果供后续使用
    // 板块会员准入 + 单帖已购两条解锁路径：付费帖可单独购买，不强制先加入板块；免费内容仍受板块门槛约束。
    const threadPaidUnlocked = thread.price_cents > 0 && hasThreadAccess(deps, userId, id, thread.price_cents); // 保存 threadPaidUnlocked：承载本步骤的计算结果供后续使用
    const unlocked = boardUnlocked || threadPaidUnlocked; // 保存 unlocked：承载本步骤的计算结果供后续使用
    const liked = !!deps.db.prepare('SELECT 1 AS ok FROM community_thread_likes WHERE thread_id = ? AND user_id = ?').get(id, userId); // 保存 liked：承载本步骤的计算结果供后续使用
    const media = deps.db // 保存 media：承载本步骤的计算结果供后续使用
      .prepare('SELECT id, kind, url, poster_url, sort_order FROM community_thread_media WHERE thread_id = ? ORDER BY sort_order ASC') // 预编译 SQL：固定语句结构后绑定参数执行
      .all(id); // 查询多行：读取列表供批量处理
    const options = deps.db // 保存 options：承载本步骤的计算结果供后续使用
      .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
        `SELECT o.id, o.label,
                (SELECT COUNT(*) FROM community_poll_votes v WHERE v.option_id = o.id) AS votes,
                (SELECT COUNT(*) FROM community_poll_votes v WHERE v.option_id = o.id AND v.user_id = ?) AS mine
         FROM community_poll_options o WHERE o.thread_id = ? ORDER BY o.sort_order ASC`,
      ) // 调用结束：参数列表与链式调用收尾
      .all(userId, id) as Array<{ id: string; label: string; votes: number; mine: number }>; // 查询多行：读取列表供批量处理
    const myVote = deps.db.prepare('SELECT option_id FROM community_poll_votes WHERE thread_id = ? AND user_id = ?').get(id, userId) as // 保存 myVote：承载本步骤的计算结果供后续使用
      | { option_id: string } // 业务步骤：推进当前流程的下一项处理
      | undefined; // 业务步骤：推进当前流程的下一项处理
    const posts = unlocked // 保存 posts：承载本步骤的计算结果供后续使用
      ? deps.db // 业务步骤：推进当前流程的下一项处理
          .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
            `SELECT p.id, p.content, p.created_at, u.display_name AS author_name, u.member_no AS author_member_no
             FROM community_posts p LEFT JOIN users u ON u.id = p.author_id
             WHERE p.thread_id = ? ORDER BY p.created_at ASC LIMIT 200`,
          ) // 调用结束：参数列表与链式调用收尾
          .all(id) // 查询多行：读取列表供批量处理
      : []; // 业务步骤：推进当前流程的下一项处理
    const episodes = unlocked && thread.kind === 'series' // 保存 episodes：承载本步骤的计算结果供后续使用
      ? deps.db.prepare('SELECT id, title, media_url, poster_url, sort_order FROM community_series_episodes WHERE thread_id = ? ORDER BY sort_order ASC').all(id) // 预编译 SQL：固定语句结构后绑定参数执行
      : []; // 业务步骤：推进当前流程的下一项处理
    const acceptedPost = unlocked && thread.accepted_post_id // 保存 acceptedPost：承载本步骤的计算结果供后续使用
      ? deps.db.prepare('SELECT p.id, p.content, p.created_at, u.display_name AS author_name FROM community_posts p LEFT JOIN users u ON u.id = p.author_id WHERE p.id = ?').get(thread.accepted_post_id) // 预编译 SQL：固定语句结构后绑定参数执行
      : null; // 业务步骤：推进当前流程的下一项处理
    const canModerate = // 保存 canModerate：承载本步骤的计算结果供后续使用
      userId === thread.board_moderator_id || userId === thread.board_created_by || userId === thread.author_id; // 赋值：更新当前作用域中的状态
    res.json({ // 输出响应：把处理结果写回 HTTP 客户端
      thread: { // 对象字段：声明结构中的一项数据
        ...thread, // 链式调用：在上一步结果上继续处理
        views: (thread.views as number) + 1, // 对象字段：声明结构中的一项数据
        body: unlocked ? thread.body : '', // 对象字段：声明结构中的一项数据
        locked: !unlocked, // 对象字段：声明结构中的一项数据
        board_locked: !boardUnlocked, // 对象字段：声明结构中的一项数据
        media: unlocked ? media : [], // 对象字段：声明结构中的一项数据
        episodes, // 业务步骤：推进当前流程的下一项处理
        accepted_post: acceptedPost, // 对象字段：声明结构中的一项数据
        can_moderate: canModerate, // 对象字段：声明结构中的一项数据
        poll: unlocked && options.length > 0 ? { options, total: (options as Array<{ votes: number }>).reduce((sum, option) => sum + option.votes, 0), my_option: myVote?.option_id ?? null } : null, // 对象字段：声明结构中的一项数据
      }, // 结束代码块：本层作用域收尾
      posts, // 业务步骤：推进当前流程的下一项处理
      liked, // 业务步骤：推进当前流程的下一项处理
      unlocked, // 业务步骤：推进当前流程的下一项处理
      favorited: !!thread.favorited, // 对象字段：声明结构中的一项数据
    }); // 结束函数体：本层作用域收尾
  }); // 结束代码块：本层作用域收尾

  /** 发帖：支持文本 / 视频 / 图集 / 剧集 / 问答 / 投票与付费定价。 */
  router.post('/community/threads', async (req, res) => { // 路由 POST /community/threads：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const body = parse( // 保存 body：承载本步骤的计算结果供后续使用
      z.object({ // 业务步骤：推进当前流程的下一项处理
        board_slug: z.string().min(1).max(40), // 对象字段：声明结构中的一项数据
        title: z.string().min(4).max(80), // 对象字段：声明结构中的一项数据
        summary: z.string().max(200).optional(), // 对象字段：声明结构中的一项数据
        body: z.string().min(10).max(8000), // 对象字段：声明结构中的一项数据
        kind: z.enum(['text', 'video', 'gallery', 'series', 'qa', 'poll']).optional(), // 对象字段：声明结构中的一项数据
        cover_url: z.string().max(300).optional(), // 对象字段：声明结构中的一项数据
        price_cents: z.number().int().min(0).max(100000).optional(), // 对象字段：声明结构中的一项数据
        media: z // 对象字段：声明结构中的一项数据
          .array( // 链式调用：在上一步结果上继续处理
            z.object({ // 业务步骤：推进当前流程的下一项处理
              kind: z.enum(['image', 'video']), // 对象字段：声明结构中的一项数据
              url: z.string().min(1).max(500), // 对象字段：声明结构中的一项数据
              poster_url: z.string().max(500).optional(), // 对象字段：声明结构中的一项数据
            }), // 结束代码块：本层作用域收尾
          ) // 调用结束：参数列表与链式调用收尾
          .max(12) // 链式调用：在上一步结果上继续处理
          .optional(), // 链式调用：在上一步结果上继续处理
        poll_options: z.array(z.string().min(1).max(60)).min(2).max(10).optional(), // 对象字段：声明结构中的一项数据
        episodes: z.array(z.object({ title: z.string().min(1).max(80), media_url: z.string().min(1).max(500), poster_url: z.string().max(500).optional() })).max(100).optional(), // 对象字段：声明结构中的一项数据
      }), // 结束代码块：本层作用域收尾
      req.body, // 读取请求：取得入参、身份或上下文
    ); // 调用结束：参数列表与链式调用收尾
    const board = deps.db // 保存 board：承载本步骤的计算结果供后续使用
      .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
        `SELECT id, slug, price_cents, post_min_level, status,
                rate_window_minutes, rate_window_max, daily_max, total_max
           FROM community_boards WHERE slug = ?`,
      ) // 调用结束：参数列表与链式调用收尾
      .get(body.board_slug) as // 查询单行：读取一条记录供判定使用
      | { // 业务步骤：推进当前流程的下一项处理
          id: string; // 对象字段：声明结构中的一项数据
          slug: string; // 对象字段：声明结构中的一项数据
          price_cents: number; // 对象字段：声明结构中的一项数据
          post_min_level: number; // 对象字段：声明结构中的一项数据
          status: string; // 对象字段：声明结构中的一项数据
          rate_window_minutes: number | null; // 对象字段：声明结构中的一项数据
          rate_window_max: number | null; // 对象字段：声明结构中的一项数据
          daily_max: number | null; // 对象字段：声明结构中的一项数据
          total_max: number | null; // 对象字段：声明结构中的一项数据
        } // 结束代码块：本层作用域收尾
      | undefined; // 业务步骤：推进当前流程的下一项处理
    if (!board) throw new AppError('NOT_FOUND', '板块不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    if (board.status !== 'active') throw new AppError('FORBIDDEN', '该板块尚未通过审核，暂不可发帖'); // 业务拒绝 FORBIDDEN：以统一错误码终止当前请求
    if (!hasBoardAccess(deps, userId, board.id, board.price_cents)) throw new AppError('FORBIDDEN', '请先加入 / 关注该板块'); // 业务拒绝 FORBIDDEN：以统一错误码终止当前请求
    if (board.post_min_level > 0 && levelOfUser(deps, userId) < board.post_min_level) { // 条件分支：仅在满足业务前置条件时继续
      throw new AppError('FORBIDDEN', `该板块发帖需 Lv.${board.post_min_level}`, { reason: 'LEVEL_TOO_LOW', required_level: board.post_min_level }); // 业务拒绝 FORBIDDEN：以统一错误码终止当前请求
    } // 结束函数体：本层作用域收尾
    const violation = checkPostRateLimit(deps.db, deps.env, userId, board.id, board); // 保存 violation：承载本步骤的计算结果供后续使用
    if (violation) { // 条件分支：仅在满足业务前置条件时继续
      res.setHeader('Retry-After', String(violation.retryAfter)); // 429 退避秒数，客户端据此排队重试
      throw new AppError('RATE_LIMITED', violation.message, { reason: violation.reason, retry_after: violation.retryAfter }); // 业务拒绝 RATE_LIMITED：以统一错误码终止当前请求
    } // 结束条件分支：本层作用域收尾
    const kind = body.kind ?? 'text'; // 保存 kind：承载本步骤的计算结果供后续使用
    const media = body.media ?? []; // 保存 media：承载本步骤的计算结果供后续使用
    const episodes = body.episodes ?? []; // 保存 episodes：承载本步骤的计算结果供后续使用
    if ((kind === 'gallery' || kind === 'series') && !media.some((item) => item.kind === 'image')) throw new AppError('VALIDATION_FAILED', '图集/剧集至少需要一张图片'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    if (kind === 'video' && !media.some((item) => item.kind === 'video')) throw new AppError('VALIDATION_FAILED', '视频帖至少需要一个视频地址'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    if (kind === 'series' && episodes.length === 0) throw new AppError('VALIDATION_FAILED', '剧集帖至少需要一集'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    if (kind === 'poll' && (!body.poll_options || body.poll_options.length < 2)) throw new AppError('VALIDATION_FAILED', '投票帖至少需要两个选项'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    for (const item of media) { // 循环处理：逐项完成批量数据操作
      if (!/^(https?:)?\//.test(item.url)) throw new AppError('VALIDATION_FAILED', '媒体地址必须是站内路径或 http(s) 地址');
      if (/^https?:/.test(item.url)) { // 条件分支：仅在满足业务前置条件时继续
        try { // 异常保护：确保失败路径可回收资源
          await assertPublicHttpUrl(item.url); // 等待异步结果：串行完成依赖操作
        } catch { // 结束代码块：本层作用域收尾
          throw new AppError('VALIDATION_FAILED', '媒体地址不允许指向内网或非法协议'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
        } // 结束代码块：本层作用域收尾
      } // 结束条件分支：本层作用域收尾
    } // 结束循环体：本层作用域收尾
    for (const item of episodes) { // 循环处理：逐项完成批量数据操作
      if (!/^(https?:)?\//.test(item.media_url)) throw new AppError('VALIDATION_FAILED', '剧集地址必须是站内路径或 http(s) 地址');
      if (/^https?:/.test(item.media_url)) { // 条件分支：仅在满足业务前置条件时继续
        try { // 异常保护：确保失败路径可回收资源
          await assertPublicHttpUrl(item.media_url); // 等待异步结果：串行完成依赖操作
        } catch { // 结束代码块：本层作用域收尾
          throw new AppError('VALIDATION_FAILED', '剧集地址不允许指向内网或非法协议'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
        } // 结束代码块：本层作用域收尾
      } // 结束条件分支：本层作用域收尾
    } // 结束循环体：本层作用域收尾
    await verifyCaptcha(deps.db, deps.env, 'post', (req.body ?? {}) as Record<string, unknown>); // 发帖场景验证码：读取原始请求体（解析后会剥离验证码字段）；开关关闭时为空操作，默认放行
    const audit = await auditText(deps.env, `${body.title}\n${body.summary ?? ''}\n${body.body}`); // 保存 audit：承载本步骤的计算结果供后续使用
    if (!audit.ok) throw new AppError('VALIDATION_FAILED', audit.reason ?? '内容未通过审核'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    const id = `thread-${randomUUID()}`; // 保存 id：承载本步骤的计算结果供后续使用
    const ts = now(); // 保存 ts：承载本步骤的计算结果供后续使用
    const tx = deps.db.transaction(() => { // 保存 tx：承载本步骤的计算结果供后续使用
      deps.db // 业务步骤：推进当前流程的下一项处理
        .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
          `INSERT INTO community_threads (id, board_id, author_id, title, summary, body, kind, cover_url, price_cents, status, created_at, updated_at, last_activity_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)`,
        ) // 调用结束：参数列表与链式调用收尾
        .run(id, board.id, userId, body.title, body.summary ?? '', body.body, kind, body.cover_url ?? null, body.price_cents ?? 0, ts, ts, ts); // 执行写入：把参数落库并返回影响结果
      media.forEach((item, index) => { // 业务步骤：推进当前流程的下一项处理
        deps.db // 业务步骤：推进当前流程的下一项处理
          .prepare('INSERT INTO community_thread_media (id, thread_id, kind, url, poster_url, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)') // 预编译 SQL：固定语句结构后绑定参数执行
          .run(`media-${randomUUID()}`, id, item.kind, item.url, item.poster_url ?? null, index, ts); // 执行写入：把参数落库并返回影响结果
      }); // 结束函数体：本层作用域收尾
      (body.poll_options ?? []).forEach((label, index) => { // 业务步骤：推进当前流程的下一项处理
        deps.db // 业务步骤：推进当前流程的下一项处理
          .prepare('INSERT INTO community_poll_options (id, thread_id, label, sort_order) VALUES (?, ?, ?, ?)') // 预编译 SQL：固定语句结构后绑定参数执行
          .run(`poll-${randomUUID()}`, id, label, index); // 执行写入：把参数落库并返回影响结果
      }); // 结束函数体：本层作用域收尾
      episodes.forEach((item, index) => { // 业务步骤：推进当前流程的下一项处理
        deps.db // 业务步骤：推进当前流程的下一项处理
          .prepare('INSERT INTO community_series_episodes (id, thread_id, title, media_url, poster_url, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)') // 预编译 SQL：固定语句结构后绑定参数执行
          .run(`episode-${randomUUID()}`, id, item.title, item.media_url, item.poster_url ?? null, index, ts); // 执行写入：把参数落库并返回影响结果
      }); // 结束函数体：本层作用域收尾
    }); // 结束函数体：本层作用域收尾
    tx(); // 业务步骤：推进当前流程的下一项处理
    res.status(201).json({ thread_id: id }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束代码块：本层作用域收尾

  /** 解锁付费帖：余额扣款；VIP 直接放行。 */
  router.post('/community/threads/:id/unlock', (req, res) => { // 路由 POST /community/threads/:id/unlock：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const id = req.params.id; // 保存 id：承载本步骤的计算结果供后续使用
    const thread = deps.db // 保存 thread：承载本步骤的计算结果供后续使用
      .prepare('SELECT t.price_cents, b.id AS board_id, b.price_cents AS board_price_cents FROM community_threads t JOIN community_boards b ON b.id = t.board_id WHERE t.id = ?') // 预编译 SQL：固定语句结构后绑定参数执行
      .get(id) as { price_cents: number; board_id: string; board_price_cents: number } | undefined; // 查询单行：读取一条记录供判定使用
    if (!thread) throw new AppError('NOT_FOUND', '帖子不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    // 免费帖须先满足板块准入；付费帖允许单独购买解锁，不强制先加入板块。
    if (thread.price_cents <= 0 && !hasBoardAccess(deps, userId, thread.board_id, thread.board_price_cents)) throw new AppError('FORBIDDEN', '请先加入该付费板块'); // 业务拒绝 FORBIDDEN：以统一错误码终止当前请求
    if (thread.price_cents <= 0) return res.json({ unlocked: true, charged_cents: 0 }); // 条件分支：仅在满足业务前置条件时继续
    if (deps.db.prepare('SELECT 1 AS ok FROM community_purchases WHERE user_id = ? AND thread_id = ?').get(userId, id)) // 条件分支：仅在满足业务前置条件时继续
      return res.json({ unlocked: true, charged_cents: 0 }); // 返回结果：把本步骤产物交给调用方
    if (vipLevel(deps, userId) > 0) { // 条件分支：仅在满足业务前置条件时继续
      deps.db.prepare('INSERT INTO community_purchases (id, user_id, thread_id, amount_cents, created_at) VALUES (?, ?, ?, 0, ?)').run(`cp-${randomUUID()}`, userId, id, now()); // 预编译 SQL：固定语句结构后绑定参数执行
      return res.json({ unlocked: true, charged_cents: 0, via: 'vip' }); // 返回结果：把本步骤产物交给调用方
    } // 结束条件分支：本层作用域收尾
    const price = thread.price_cents; // 保存 price：承载本步骤的计算结果供后续使用
    requireBalance(deps, userId, price); // 业务步骤：推进当前流程的下一项处理
    const tx = deps.db.transaction(() => { // 保存 tx：承载本步骤的计算结果供后续使用
      debit(deps, userId, price, 'community_thread', id, '解锁付费帖'); // 业务步骤：推进当前流程的下一项处理
      deps.db.prepare('INSERT INTO community_purchases (id, user_id, thread_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)').run(`cp-${randomUUID()}`, userId, id, price, now()); // 预编译 SQL：固定语句结构后绑定参数执行
    }); // 结束函数体：本层作用域收尾
    tx(); // 业务步骤：推进当前流程的下一项处理
    res.json({ unlocked: true, charged_cents: price }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 回复：必须已解锁；写入后刷新回帖数与活跃时间。 */
  router.post('/community/threads/:id/reply', async (req, res) => { // 路由 POST /community/threads/:id/reply：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const id = req.params.id; // 保存 id：承载本步骤的计算结果供后续使用
    const body = parse(z.object({ content: z.string().min(1).max(4000), parent_id: z.string().max(80).optional() }), req.body); // 保存 body：承载本步骤的计算结果供后续使用
    const thread = deps.db // 保存 thread：承载本步骤的计算结果供后续使用
      .prepare('SELECT t.price_cents, b.id AS board_id, b.price_cents AS board_price_cents FROM community_threads t JOIN community_boards b ON b.id = t.board_id WHERE t.id = ?') // 预编译 SQL：固定语句结构后绑定参数执行
      .get(id) as { price_cents: number; board_id: string; board_price_cents: number } | undefined; // 查询单行：读取一条记录供判定使用
    if (!thread) throw new AppError('NOT_FOUND', '帖子不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    if (!hasBoardAccess(deps, userId, thread.board_id, thread.board_price_cents)) throw new AppError('FORBIDDEN', '请先加入该付费板块'); // 业务拒绝 FORBIDDEN：以统一错误码终止当前请求
    if (!hasThreadAccess(deps, userId, id, thread.price_cents)) throw new AppError('FORBIDDEN', '请先解锁本帖'); // 业务拒绝 FORBIDDEN：以统一错误码终止当前请求
    const audit = await auditText(deps.env, body.content); // 保存 audit：承载本步骤的计算结果供后续使用
    if (!audit.ok) throw new AppError('VALIDATION_FAILED', audit.reason ?? '回复未通过审核'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    const ts = now(); // 保存 ts：承载本步骤的计算结果供后续使用
    deps.db // 业务步骤：推进当前流程的下一项处理
      .prepare('INSERT INTO community_posts (id, thread_id, author_id, parent_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)') // 预编译 SQL：固定语句结构后绑定参数执行
      .run(`post-${randomUUID()}`, id, userId, body.parent_id ?? null, body.content, ts); // 执行写入：把参数落库并返回影响结果
    deps.db.prepare('UPDATE community_threads SET reply_count = reply_count + 1, last_activity_at = ? WHERE id = ?').run(ts, id); // 预编译 SQL：固定语句结构后绑定参数执行
    refreshRecommendScore(deps, id); // 回复计入推荐指数
    res.status(201).json({ ok: true }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 点赞开关。 */
  router.post('/community/threads/:id/like', (req, res) => { // 路由 POST /community/threads/:id/like：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const id = req.params.id; // 保存 id：承载本步骤的计算结果供后续使用
    const existing = deps.db.prepare('SELECT 1 AS ok FROM community_thread_likes WHERE thread_id = ? AND user_id = ?').get(id, userId); // 保存 existing：承载本步骤的计算结果供后续使用
    if (existing) { // 条件分支：仅在满足业务前置条件时继续
      deps.db.prepare('DELETE FROM community_thread_likes WHERE thread_id = ? AND user_id = ?').run(id, userId); // 预编译 SQL：固定语句结构后绑定参数执行
      deps.db.prepare('UPDATE community_threads SET likes = MAX(0, likes - 1) WHERE id = ?').run(id); // 预编译 SQL：固定语句结构后绑定参数执行
      refreshRecommendScore(deps, id); // 业务步骤：推进当前流程的下一项处理
      return res.json({ liked: false }); // 返回结果：把本步骤产物交给调用方
    } // 结束条件分支：本层作用域收尾
    deps.db.prepare('INSERT INTO community_thread_likes (thread_id, user_id, created_at) VALUES (?, ?, ?)').run(id, userId, now()); // 预编译 SQL：固定语句结构后绑定参数执行
    deps.db.prepare('UPDATE community_threads SET likes = likes + 1 WHERE id = ?').run(id); // 预编译 SQL：固定语句结构后绑定参数执行
    refreshRecommendScore(deps, id); // 业务步骤：推进当前流程的下一项处理
    return res.json({ liked: true }); // 返回结果：把本步骤产物交给调用方
  }); // 结束函数体：本层作用域收尾

  /** 收藏开关。 */
  router.post('/community/threads/:id/favorite', (req, res) => { // 路由 POST /community/threads/:id/favorite：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const id = req.params.id; // 保存 id：承载本步骤的计算结果供后续使用
    if (!deps.db.prepare("SELECT 1 AS ok FROM community_threads WHERE id = ? AND status = 'published'").get(id)) throw new AppError('NOT_FOUND', '帖子不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    const existing = deps.db.prepare('SELECT 1 AS ok FROM community_favorites WHERE thread_id = ? AND user_id = ?').get(id, userId); // 保存 existing：承载本步骤的计算结果供后续使用
    if (existing) { // 条件分支：仅在满足业务前置条件时继续
      deps.db.prepare('DELETE FROM community_favorites WHERE thread_id = ? AND user_id = ?').run(id, userId); // 预编译 SQL：固定语句结构后绑定参数执行
      refreshRecommendScore(deps, id); // 业务步骤：推进当前流程的下一项处理
      return res.json({ favorited: false }); // 返回结果：把本步骤产物交给调用方
    } // 结束条件分支：本层作用域收尾
    deps.db.prepare('INSERT INTO community_favorites (thread_id, user_id, created_at) VALUES (?, ?, ?)').run(id, userId, now()); // 预编译 SQL：固定语句结构后绑定参数执行
    refreshRecommendScore(deps, id); // 收藏计入推荐指数
    return res.json({ favorited: true }); // 返回结果：把本步骤产物交给调用方
  }); // 结束函数体：本层作用域收尾

  /** 我的收藏。 */
  router.get('/community/favorites', (req, res) => { // 路由 GET /community/favorites：注册入口并绑定鉴权与处理逻辑
    const items = deps.db // 保存 items：承载本步骤的计算结果供后续使用
      .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
        `SELECT t.id, t.title, t.summary, t.kind, t.cover_url, t.price_cents, t.views, t.likes, t.reply_count,
                b.slug AS board_slug, b.name AS board_name, f.created_at AS favorited_at
         FROM community_favorites f JOIN community_threads t ON t.id = f.thread_id JOIN community_boards b ON b.id = t.board_id
         WHERE f.user_id = ? AND t.status = 'published' ORDER BY f.created_at DESC LIMIT 50`,
      ) // 调用结束：参数列表与链式调用收尾
      .all(req.user!.id); // 查询多行：读取列表供批量处理
    res.json({ items }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 评分：1–5 星，一人一帖一条，可修改。 */
  router.post('/community/threads/:id/rate', (req, res) => { // 路由 POST /community/threads/:id/rate：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const body = parse(z.object({ rating: z.number().int().min(1).max(5) }), req.body); // 保存 body：承载本步骤的计算结果供后续使用
    const thread = deps.db.prepare('SELECT price_cents FROM community_threads WHERE id = ?').get(req.params.id) as { price_cents: number } | undefined; // 保存 thread：承载本步骤的计算结果供后续使用
    if (!thread) throw new AppError('NOT_FOUND', '帖子不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    if (!hasThreadAccess(deps, userId, req.params.id, thread.price_cents)) throw new AppError('FORBIDDEN', '请先解锁本帖'); // 业务拒绝 FORBIDDEN：以统一错误码终止当前请求
    const ts = now(); // 保存 ts：承载本步骤的计算结果供后续使用
    deps.db // 业务步骤：推进当前流程的下一项处理
      .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
        `INSERT INTO community_ratings (thread_id, user_id, rating, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(thread_id, user_id) DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at`,
      ) // 调用结束：参数列表与链式调用收尾
      .run(req.params.id, userId, body.rating, ts, ts); // 执行写入：把参数落库并返回影响结果
    const summary = deps.db.prepare('SELECT ROUND(AVG(rating), 2) AS avg, COUNT(*) AS count FROM community_ratings WHERE thread_id = ?').get(req.params.id); // 保存 summary：承载本步骤的计算结果供后续使用
    refreshRecommendScore(deps, req.params.id); // 评分计入推荐指数
    res.json({ ok: true, summary }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 投票：一人一票，可改投；必须已解锁。 */
  router.post('/community/threads/:id/vote', (req, res) => { // 路由 POST /community/threads/:id/vote：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const body = parse(z.object({ option_id: z.string().min(1).max(80) }), req.body); // 保存 body：承载本步骤的计算结果供后续使用
    const thread = deps.db.prepare('SELECT price_cents FROM community_threads WHERE id = ?').get(req.params.id) as { price_cents: number } | undefined; // 保存 thread：承载本步骤的计算结果供后续使用
    if (!thread) throw new AppError('NOT_FOUND', '帖子不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    if (!hasThreadAccess(deps, userId, req.params.id, thread.price_cents)) throw new AppError('FORBIDDEN', '请先解锁本帖'); // 业务拒绝 FORBIDDEN：以统一错误码终止当前请求
    const option = deps.db.prepare('SELECT id FROM community_poll_options WHERE id = ? AND thread_id = ?').get(body.option_id, req.params.id); // 保存 option：承载本步骤的计算结果供后续使用
    if (!option) throw new AppError('NOT_FOUND', '投票选项不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    deps.db // 业务步骤：推进当前流程的下一项处理
      .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
        `INSERT INTO community_poll_votes (thread_id, option_id, user_id, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(thread_id, user_id) DO UPDATE SET option_id = excluded.option_id, created_at = excluded.created_at`,
      ) // 调用结束：参数列表与链式调用收尾
      .run(req.params.id, body.option_id, userId, now()); // 执行写入：把参数落库并返回影响结果
    res.json({ ok: true }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 加入付费板块：余额扣款；VIP 直接加入并记 0 元。 */
  router.post('/community/boards/:slug/join', (req, res) => { // 路由 POST /community/boards/:slug/join：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const board = deps.db.prepare('SELECT id, slug, name, price_cents FROM community_boards WHERE slug = ?').get(req.params.slug) as // 保存 board：承载本步骤的计算结果供后续使用
      | { id: string; slug: string; name: string; price_cents: number } // 业务步骤：推进当前流程的下一项处理
      | undefined; // 业务步骤：推进当前流程的下一项处理
    if (!board) throw new AppError('NOT_FOUND', '板块不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    if (deps.db.prepare('SELECT 1 AS ok FROM community_board_memberships WHERE board_id = ? AND user_id = ?').get(board.id, userId)) { // 条件分支：仅在满足业务前置条件时继续
      return res.json({ joined: true, charged_cents: 0 }); // 返回结果：把本步骤产物交给调用方
    } // 结束条件分支：本层作用域收尾
    const viaVip = vipLevel(deps, userId) > 0; // 保存 viaVip：承载本步骤的计算结果供后续使用
    const charge = viaVip ? 0 : board.price_cents; // 保存 charge：承载本步骤的计算结果供后续使用
    if (charge > 0) requireBalance(deps, userId, charge); // 条件分支：仅在满足业务前置条件时继续
    const tx = deps.db.transaction(() => { // 保存 tx：承载本步骤的计算结果供后续使用
      if (charge > 0) debit(deps, userId, charge, 'community_board', board.id, `加入板块 ${board.name}`); // 条件分支：仅在满足业务前置条件时继续
      deps.db // 业务步骤：推进当前流程的下一项处理
        .prepare('INSERT INTO community_board_memberships (board_id, user_id, amount_cents, created_at) VALUES (?, ?, ?, ?)') // 预编译 SQL：固定语句结构后绑定参数执行
        .run(board.id, userId, charge, now()); // 执行写入：把参数落库并返回影响结果
    }); // 结束函数体：本层作用域收尾
    tx(); // 业务步骤：推进当前流程的下一项处理
    res.status(201).json({ joined: true, charged_cents: charge, via: viaVip ? 'vip' : 'balance' }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 关注 / 取消关注板块：followers 可见板块的准入动作，同时用于普通板块订阅。 */
  router.post('/community/boards/:slug/follow', (req, res) => { // 路由 POST /community/boards/:slug/follow：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const board = deps.db.prepare('SELECT id, name FROM community_boards WHERE slug = ?').get(req.params.slug) as { id: string; name: string } | undefined; // 保存 board：承载本步骤的计算结果供后续使用
    if (!board) throw new AppError('NOT_FOUND', '板块不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    const existing = deps.db.prepare('SELECT 1 AS ok FROM community_board_follows WHERE board_id = ? AND user_id = ?').get(board.id, userId); // 保存 existing：承载本步骤的计算结果供后续使用
    if (existing) { // 条件分支：仅在满足业务前置条件时继续
      deps.db.prepare('DELETE FROM community_board_follows WHERE board_id = ? AND user_id = ?').run(board.id, userId); // 预编译 SQL：固定语句结构后绑定参数执行
      return res.json({ followed: false }); // 返回结果：把本步骤产物交给调用方
    } // 结束条件分支：本层作用域收尾
    deps.db.prepare('INSERT INTO community_board_follows (board_id, user_id, created_at) VALUES (?, ?, ?)').run(board.id, userId, now()); // 预编译 SQL：固定语句结构后绑定参数执行
    return res.json({ followed: true }); // 返回结果：把本步骤产物交给调用方
  }); // 结束函数体：本层作用域收尾

  /** 创建板块：等级 / VIP 门槛 + 每人数量上限 + 重名 / 敏感词校验；需审核时进入 pending 队列。 */
  router.post('/community/boards', async (req, res) => { // 路由 POST /community/boards：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const body = parse( // 保存 body：承载本步骤的计算结果供后续使用
      z.object({ // 业务步骤：推进当前流程的下一项处理
        slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/, 'slug 只能是小写字母、数字与连字符'), // 对象字段：声明结构中的一项数据
        name: z.string().min(2).max(40), // 对象字段：声明结构中的一项数据
        description: z.string().max(200).default(''), // 对象字段：声明结构中的一项数据
        icon: z.string().max(8).default('🧩'), // 对象字段：声明结构中的一项数据
        price_cents: z.number().int().min(0).max(100000).default(0), // 对象字段：声明结构中的一项数据
        visibility: z.enum(['public', 'followers', 'paid']).default('public'), // 对象字段：声明结构中的一项数据
        post_min_level: z.number().int().min(0).max(10).default(0), // 对象字段：声明结构中的一项数据
      }), // 结束代码块：本层作用域收尾
      req.body, // 读取请求：取得入参、身份或上下文
    ); // 调用结束：参数列表与链式调用收尾
    const limits = createLimits(deps, {}); // 保存 limits：承载本步骤的计算结果供后续使用
    if (vipLevel(deps, userId) === 0 && levelOfUser(deps, userId) < limits.minLevel) { // 条件分支：仅在满足业务前置条件时继续
      throw new AppError('FORBIDDEN', `创建板块需 Lv.${limits.minLevel} 或 VIP 会员`, { reason: 'BOARD_CREATE_FORBIDDEN', required_level: limits.minLevel }); // 业务拒绝 FORBIDDEN：以统一错误码终止当前请求
    } // 结束函数体：本层作用域收尾
    const created = deps.db.prepare('SELECT COUNT(*) AS count FROM community_boards WHERE created_by = ?').get(userId) as { count: number }; // 保存 created：承载本步骤的计算结果供后续使用
    if (created.count >= limits.maxPerUser) { // 条件分支：仅在满足业务前置条件时继续
      throw new AppError('VALIDATION_FAILED', `每人最多创建 ${limits.maxPerUser} 个板块`, { reason: 'BOARD_CREATE_LIMIT', max_per_user: limits.maxPerUser }); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    } // 结束代码块：本层作用域收尾
    if (deps.db.prepare('SELECT 1 AS ok FROM community_boards WHERE slug = ?').get(body.slug)) throw new AppError('CONFLICT', '板块 slug 已存在'); // 业务拒绝 CONFLICT：以统一错误码终止当前请求
    const dupName = deps.db.prepare('SELECT 1 AS ok FROM community_boards WHERE lower(trim(name)) = lower(trim(?))').get(body.name); // 保存 dupName：承载本步骤的计算结果供后续使用
    if (dupName) throw new AppError('CONFLICT', '板块名称已存在', { reason: 'BOARD_NAME_DUPLICATE' }); // 业务拒绝 CONFLICT：以统一错误码终止当前请求
    const blocked = findBlockedWord(deps.env, `${body.name}\n${body.description}`); // 保存 blocked：承载本步骤的计算结果供后续使用
    if (blocked) throw new AppError('VALIDATION_FAILED', '板块名称或简介包含受限词，请修改后再提交', { reason: 'BOARD_BLOCKED_WORD', word: blocked }); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    const boardAudit = await auditText(deps.env, `${body.name}\n${body.description}`); // 板块名 / 简介接入内容审核；无远程凭证时 provider=none 放行
    if (!boardAudit.ok) throw new AppError('VALIDATION_FAILED', boardAudit.reason ?? '板块名称或简介未通过审核'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    // paid 为对外口径：落库仍用 visibility=public + price_cents>0，付费准入由会员/关注链路判定。
    const visibility = body.visibility === 'paid' ? 'public' : body.visibility; // 保存 visibility：承载本步骤的计算结果供后续使用
    const priceCents = body.visibility === 'paid' ? Math.max(1, body.price_cents) : body.price_cents; // 保存 priceCents：承载本步骤的计算结果供后续使用
    if (body.visibility === 'paid' && body.price_cents <= 0) throw new AppError('VALIDATION_FAILED', '付费板块必须设置价格', { reason: 'PAID_BOARD_PRICE_REQUIRED' }); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    const reviewRequired = boardReviewEnabled(deps.db, deps.env); // 保存 reviewRequired：承载本步骤的计算结果供后续使用
    const status = reviewRequired ? 'pending' : 'active'; // 保存 status：承载本步骤的计算结果供后续使用
    const maxSort = (deps.db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS max FROM community_boards').get() as { max: number }).max; // 保存 maxSort：承载本步骤的计算结果供后续使用
    const ts = now(); // 保存 ts：承载本步骤的计算结果供后续使用
    deps.db // 业务步骤：推进当前流程的下一项处理
      .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
        `INSERT INTO community_boards (id, slug, name, description, icon, sort_order, price_cents, visibility, post_min_level, status, created_by, moderator_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ) // 调用结束：参数列表与链式调用收尾
      .run(`board-${randomUUID()}`, body.slug, body.name, body.description, body.icon, maxSort + 1, priceCents, visibility, body.post_min_level, status, userId, userId, ts); // 执行写入：把参数落库并返回影响结果
    res.status(201).json({ ok: true, slug: body.slug, status }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束代码块：本层作用域收尾

  /** 保存板块 Tab 组合：版主 / 创建者可调顺序、显隐与排序口径；全量覆盖持久化配置。 */
  router.put('/community/boards/:slug/tabs', (req, res) => { // 路由 PUT /community/boards/:slug/tabs：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const board = deps.db.prepare('SELECT id, created_by, moderator_id FROM community_boards WHERE slug = ?').get(req.params.slug) as // 保存 board：承载本步骤的计算结果供后续使用
      | { id: string; created_by: string | null; moderator_id: string | null } // 业务步骤：推进当前流程的下一项处理
      | undefined; // 业务步骤：推进当前流程的下一项处理
    if (!board) throw new AppError('NOT_FOUND', '板块不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    if (!canModerateBoard(board, userId)) throw new AppError('FORBIDDEN', '只有版主可以调整栏目配置'); // 业务拒绝 FORBIDDEN：以统一错误码终止当前请求
    const body = parse( // 保存 body：承载本步骤的计算结果供后续使用
      z.object({ // 业务步骤：推进当前流程的下一项处理
        tabs: z // 对象字段：声明结构中的一项数据
          .array( // 链式调用：在上一步结果上继续处理
            z.object({ // 业务步骤：推进当前流程的下一项处理
              key: z.string().min(1).max(40), // 对象字段：声明结构中的一项数据
              label: z.string().max(20).optional(), // 对象字段：声明结构中的一项数据
              visible: z.boolean().optional(), // 对象字段：声明结构中的一项数据
              sort_order: z.number().int().min(0).max(999).optional(), // 对象字段：声明结构中的一项数据
              sort_by: z.string().min(1).max(20).optional(), // 对象字段：声明结构中的一项数据
            }), // 结束代码块：本层作用域收尾
          ) // 调用结束：参数列表与链式调用收尾
          .max(20), // 链式调用：在上一步结果上继续处理
      }), // 结束代码块：本层作用域收尾
      req.body, // 读取请求：取得入参、身份或上下文
    ); // 调用结束：参数列表与链式调用收尾
    const knownKeys = new Set(DEFAULT_TABS.map((tab) => tab.key)); // 保存 knownKeys：承载本步骤的计算结果供后续使用
    for (const tab of body.tabs) { // 循环处理：逐项完成批量数据操作
      if (!knownKeys.has(tab.key)) throw new AppError('VALIDATION_FAILED', `未知栏目：${tab.key}`, { reason: 'TAB_KEY_UNKNOWN' }); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
      if (tab.sort_by && !SORT_BY_KEYS.has(tab.sort_by)) throw new AppError('VALIDATION_FAILED', `未知排序口径：${tab.sort_by}`, { reason: 'TAB_SORT_UNKNOWN' }); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    } // 结束代码块：本层作用域收尾
    saveBoardTabs(deps.db, board.id, body.tabs as TabInput[], now()); // 业务步骤：推进当前流程的下一项处理
    res.json({ ok: true, tabs: loadBoardTabs(deps.db, board.id) }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束代码块：本层作用域收尾

  /** 板块配额 / 发帖门槛配置：版主可调频控窗口、每日 / 累计上限与发帖等级。 */
  router.put('/community/boards/:slug/config', (req, res) => { // 路由 PUT /community/boards/:slug/config：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const board = deps.db.prepare('SELECT id, created_by, moderator_id, price_cents, visibility FROM community_boards WHERE slug = ?').get(req.params.slug) as // 保存 board：承载本步骤的计算结果供后续使用
      | { id: string; created_by: string | null; moderator_id: string | null; price_cents: number; visibility: string } // 业务步骤：推进当前流程的下一项处理
      | undefined; // 业务步骤：推进当前流程的下一项处理
    if (!board) throw new AppError('NOT_FOUND', '板块不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    if (!canModerateBoard(board, userId)) throw new AppError('FORBIDDEN', '只有版主可以调整板块配置'); // 业务拒绝 FORBIDDEN：以统一错误码终止当前请求
    const body = parse( // 保存 body：承载本步骤的计算结果供后续使用
      z.object({ // 业务步骤：推进当前流程的下一项处理
        rate_window_minutes: z.number().int().min(0).max(1440).optional(), // 对象字段：声明结构中的一项数据
        rate_window_max: z.number().int().min(0).max(1000).optional(), // 对象字段：声明结构中的一项数据
        daily_max: z.number().int().min(0).max(10000).optional(), // 对象字段：声明结构中的一项数据
        total_max: z.number().int().min(0).max(100000).optional(), // 对象字段：声明结构中的一项数据
        post_min_level: z.number().int().min(0).max(10).optional(), // 对象字段：声明结构中的一项数据
      }), // 结束代码块：本层作用域收尾
      req.body, // 读取请求：取得入参、身份或上下文
    ); // 调用结束：参数列表与链式调用收尾
    deps.db // 业务步骤：推进当前流程的下一项处理
      .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
        `UPDATE community_boards SET
                rate_window_minutes = COALESCE(?, rate_window_minutes),
                rate_window_max = COALESCE(?, rate_window_max),
                daily_max = COALESCE(?, daily_max),
                total_max = COALESCE(?, total_max),
                post_min_level = COALESCE(?, post_min_level)
         WHERE id = ?`,
      ) // 调用结束：参数列表与链式调用收尾
      .run( // 执行写入：把参数落库并返回影响结果
        body.rate_window_minutes ?? null, // 业务步骤：推进当前流程的下一项处理
        body.rate_window_max ?? null, // 业务步骤：推进当前流程的下一项处理
        body.daily_max ?? null, // 业务步骤：推进当前流程的下一项处理
        body.total_max ?? null, // 业务步骤：推进当前流程的下一项处理
        body.post_min_level ?? null, // 业务步骤：推进当前流程的下一项处理
        board.id, // 业务步骤：推进当前流程的下一项处理
      ); // 调用结束：参数列表与链式调用收尾
    const refreshed = deps.db // 保存 refreshed：承载本步骤的计算结果供后续使用
      .prepare('SELECT rate_window_minutes, rate_window_max, daily_max, total_max FROM community_boards WHERE id = ?') // 预编译 SQL：固定语句结构后绑定参数执行
      .get(board.id) as { rate_window_minutes: number; rate_window_max: number; daily_max: number; total_max: number }; // 查询单行：读取一条记录供判定使用
    res.json({ ok: true, quota: resolveQuota(deps.env, refreshed) }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 问答采纳：仅提问者可采纳本贴的一条回复；重复采纳覆盖旧结果。 */
  router.post('/community/threads/:id/accept', (req, res) => { // 路由 POST /community/threads/:id/accept：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const body = parse(z.object({ post_id: z.string().min(1).max(80) }), req.body); // 保存 body：承载本步骤的计算结果供后续使用
    const thread = deps.db.prepare("SELECT id, author_id, kind FROM community_threads WHERE id = ? AND status = 'published'").get(req.params.id) as // 保存 thread：承载本步骤的计算结果供后续使用
      | { id: string; author_id: string | null; kind: string } // 业务步骤：推进当前流程的下一项处理
      | undefined; // 业务步骤：推进当前流程的下一项处理
    if (!thread) throw new AppError('NOT_FOUND', '帖子不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    if (thread.author_id !== userId) throw new AppError('FORBIDDEN', '只有提问者可以采纳回复'); // 业务拒绝 FORBIDDEN：以统一错误码终止当前请求
    if (thread.kind !== 'qa') throw new AppError('VALIDATION_FAILED', '只有问答帖支持采纳'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    const post = deps.db.prepare('SELECT id FROM community_posts WHERE id = ? AND thread_id = ?').get(body.post_id, thread.id); // 保存 post：承载本步骤的计算结果供后续使用
    if (!post) throw new AppError('NOT_FOUND', '回复不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    deps.db.prepare('UPDATE community_threads SET accepted_post_id = ?, updated_at = ? WHERE id = ?').run(body.post_id, now(), thread.id); // 预编译 SQL：固定语句结构后绑定参数执行
    res.json({ ok: true, accepted_post_id: body.post_id }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 删除帖子：作者、版主或板块创建者可软删（status=hidden），保留数据可审计。 */
  router.delete('/community/threads/:id', (req, res) => { // 路由 DELETE /community/threads/:id：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const row = deps.db // 保存 row：承载本步骤的计算结果供后续使用
      .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
        `SELECT t.id, t.author_id, b.created_by, b.moderator_id
         FROM community_threads t JOIN community_boards b ON b.id = t.board_id WHERE t.id = ?`,
      ) // 调用结束：参数列表与链式调用收尾
      .get(req.params.id) as { id: string; author_id: string | null; created_by: string | null; moderator_id: string | null } | undefined; // 查询单行：读取一条记录供判定使用
    if (!row) throw new AppError('NOT_FOUND', '帖子不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    if (row.author_id !== userId && row.created_by !== userId && row.moderator_id !== userId) throw new AppError('FORBIDDEN', '只有作者或版主可以删除'); // 业务拒绝 FORBIDDEN：以统一错误码终止当前请求
    deps.db.prepare("UPDATE community_threads SET status = 'hidden', updated_at = ? WHERE id = ?").run(now(), row.id); // 预编译 SQL：固定语句结构后绑定参数执行
    res.json({ ok: true }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 积分转账：按 Mim ID 转给其他用户，双方各记一条流水。 */
  router.post('/wallet/points/transfer', (req, res) => { // 路由 POST /wallet/points/transfer：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const body = parse( // 保存 body：承载本步骤的计算结果供后续使用
      z.object({ // 业务步骤：推进当前流程的下一项处理
        to_member_no: z.string().min(1).max(20), // 对象字段：声明结构中的一项数据
        points: z.number().int().min(1).max(100000), // 对象字段：声明结构中的一项数据
        note: z.string().max(80).optional(), // 对象字段：声明结构中的一项数据
      }), // 结束代码块：本层作用域收尾
      req.body, // 读取请求：取得入参、身份或上下文
    ); // 调用结束：参数列表与链式调用收尾
    ensureWallet(deps, userId); // 业务步骤：推进当前流程的下一项处理
    const recipient = deps.db.prepare('SELECT id, member_no, display_name FROM users WHERE member_no = ?').get(body.to_member_no.toUpperCase()) as // 保存 recipient：承载本步骤的计算结果供后续使用
      | { id: string; member_no: string; display_name: string | null } // 业务步骤：推进当前流程的下一项处理
      | undefined; // 业务步骤：推进当前流程的下一项处理
    if (!recipient) throw new AppError('NOT_FOUND', '接收方 Mim ID 不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    if (recipient.id === userId) throw new AppError('VALIDATION_FAILED', '不能转给自己'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    const wallet = deps.db.prepare('SELECT points FROM wallets WHERE user_id = ?').get(userId) as { points: number }; // 保存 wallet：承载本步骤的计算结果供后续使用
    if (wallet.points < body.points) throw new AppError('VALIDATION_FAILED', '积分不足'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    const ts = now(); // 保存 ts：承载本步骤的计算结果供后续使用
    const tx = deps.db.transaction(() => { // 保存 tx：承载本步骤的计算结果供后续使用
      deps.db.prepare('UPDATE wallets SET points = points - ?, updated_at = ? WHERE user_id = ?').run(body.points, ts, userId); // 预编译 SQL：固定语句结构后绑定参数执行
      deps.db // 业务步骤：推进当前流程的下一项处理
        .prepare(`INSERT INTO wallet_transactions (id, user_id, kind, points, note, created_at) VALUES (?, ?, 'points', ?, ?, ?)`) // 预编译 SQL：固定语句结构后绑定参数执行
        .run(`wt-${randomUUID()}`, userId, -body.points, `转给 ${recipient.member_no}${body.note ? `：${body.note}` : ''}`, ts); // 执行写入：把参数落库并返回影响结果
      ensureWallet(deps, recipient.id); // 业务步骤：推进当前流程的下一项处理
      deps.db.prepare('UPDATE wallets SET points = points + ?, updated_at = ? WHERE user_id = ?').run(body.points, ts, recipient.id); // 预编译 SQL：固定语句结构后绑定参数执行
      deps.db // 业务步骤：推进当前流程的下一项处理
        .prepare(`INSERT INTO wallet_transactions (id, user_id, kind, points, note, created_at) VALUES (?, ?, 'points', ?, ?, ?)`) // 预编译 SQL：固定语句结构后绑定参数执行
        .run(`wt-${randomUUID()}`, recipient.id, body.points, `来自 ${walletOfMember(deps, userId)}${body.note ? `：${body.note}` : ''}`, ts); // 执行写入：把参数落库并返回影响结果
    }); // 结束代码块：本层作用域收尾
    tx(); // 业务步骤：推进当前流程的下一项处理
    res.json({ ok: true, points: body.points, to: recipient.member_no }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束代码块：本层作用域收尾
  /** VIP 套餐。 */
  router.get('/vip/plans', (_req, res) => { // 路由 GET /vip/plans：注册入口并绑定鉴权与处理逻辑
    const plans = deps.db // 保存 plans：承载本步骤的计算结果供后续使用
      .prepare('SELECT code, name, level, price_cents, duration_days, perks FROM vip_plans WHERE active = 1 ORDER BY sort_order') // 预编译 SQL：固定语句结构后绑定参数执行
      .all() as Array<{ code: string; name: string; level: number; price_cents: number; duration_days: number; perks: string }>; // 查询多行：读取列表供批量处理
    res.json({ plans: plans.map((plan) => ({ ...plan, perks: JSON.parse(plan.perks) as string[] })) }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束代码块：本层作用域收尾

  /** 开通 / 续费 VIP：余额扣款，有效期顺延。 */
  router.post('/vip/subscribe', (req, res) => { // 路由 POST /vip/subscribe：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const body = parse(z.object({ code: z.string().min(1).max(40) }), req.body); // 保存 body：承载本步骤的计算结果供后续使用
    const plan = deps.db.prepare('SELECT * FROM vip_plans WHERE code = ? AND active = 1').get(body.code) as // 保存 plan：承载本步骤的计算结果供后续使用
      | { id: string; code: string; name: string; level: number; price_cents: number; duration_days: number } // 业务步骤：推进当前流程的下一项处理
      | undefined; // 业务步骤：推进当前流程的下一项处理
    if (!plan) throw new AppError('NOT_FOUND', '套餐不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    requireBalance(deps, userId, plan.price_cents); // 业务步骤：推进当前流程的下一项处理
    const current = deps.db // 保存 current：承载本步骤的计算结果供后续使用
      .prepare('SELECT expires_at FROM vip_memberships WHERE user_id = ? AND status = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1') // 预编译 SQL：固定语句结构后绑定参数执行
      .get(userId, 'active', now()) as { expires_at: string } | undefined; // 查询单行：读取一条记录供判定使用
    const start = current && new Date(current.expires_at) > new Date() ? new Date(current.expires_at) : new Date(); // 保存 start：承载本步骤的计算结果供后续使用
    const expires = new Date(start.getTime() + plan.duration_days * 86400000).toISOString(); // 保存 expires：承载本步骤的计算结果供后续使用
    const tx = deps.db.transaction(() => { // 保存 tx：承载本步骤的计算结果供后续使用
      debit(deps, userId, plan.price_cents, 'vip_plan', plan.id, `开通 ${plan.name}`); // 业务步骤：推进当前流程的下一项处理
      deps.db // 业务步骤：推进当前流程的下一项处理
        .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
          `INSERT INTO vip_memberships (id, user_id, plan_id, level, starts_at, expires_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`, // 业务步骤：推进当前流程的下一项处理
        ) // 调用结束：参数列表与链式调用收尾
        .run(`vip-${randomUUID()}`, userId, plan.id, plan.level, now(), expires, now()); // 执行写入：把参数落库并返回影响结果
      deps.db.prepare('UPDATE wallets SET points = points + 50, updated_at = ? WHERE user_id = ?').run(now(), userId); // 预编译 SQL：固定语句结构后绑定参数执行
    }); // 结束函数体：本层作用域收尾
    tx(); // 业务步骤：推进当前流程的下一项处理
    res.status(201).json({ ok: true, level: plan.level, expires_at: expires }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 钱包：余额、积分、签到状态、最近流水。 */
  router.get('/wallet', (req, res) => { // 路由 GET /wallet：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const wallet = ensureWallet(deps, userId); // 保存 wallet：承载本步骤的计算结果供后续使用
    const day = new Date().toISOString().slice(0, 10); // 保存 day：承载本步骤的计算结果供后续使用
    const checked = !!deps.db.prepare('SELECT 1 AS ok FROM checkins WHERE user_id = ? AND day = ?').get(userId, day); // 保存 checked：承载本步骤的计算结果供后续使用
    const tx = deps.db // 保存 tx：承载本步骤的计算结果供后续使用
      .prepare('SELECT id, kind, amount_cents, points, note, created_at FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 30') // 预编译 SQL：固定语句结构后绑定参数执行
      .all(userId); // 查询多行：读取列表供批量处理
    res.json({ wallet, checked_in_today: checked, transactions: tx, vip_level: vipLevel(deps, userId) }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 签到：每天 +5 积分。 */
  router.post('/wallet/checkin', (req, res) => { // 路由 POST /wallet/checkin：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    ensureWallet(deps, userId); // 业务步骤：推进当前流程的下一项处理
    const day = new Date().toISOString().slice(0, 10); // 保存 day：承载本步骤的计算结果供后续使用
    try { // 异常保护：确保失败路径可回收资源
      deps.db // 业务步骤：推进当前流程的下一项处理
        .prepare('INSERT INTO checkins (id, user_id, day, points, created_at) VALUES (?, ?, ?, 5, ?)') // 预编译 SQL：固定语句结构后绑定参数执行
        .run(`ci-${randomUUID()}`, userId, day, now()); // 执行写入：把参数落库并返回影响结果
    } catch { // 结束代码块：本层作用域收尾
      throw new AppError('CONFLICT', '今天已经签到过了'); // 业务拒绝 CONFLICT：以统一错误码终止当前请求
    } // 结束代码块：本层作用域收尾
    deps.db.prepare('UPDATE wallets SET points = points + 5, updated_at = ? WHERE user_id = ?').run(now(), userId); // 预编译 SQL：固定语句结构后绑定参数执行
    deps.db // 业务步骤：推进当前流程的下一项处理
      .prepare(`INSERT INTO wallet_transactions (id, user_id, kind, points, note, created_at) VALUES (?, ?, 'points', 5, '每日签到', ?)`) // 预编译 SQL：固定语句结构后绑定参数执行
      .run(`wt-${randomUUID()}`, userId, now()); // 执行写入：把参数落库并返回影响结果
    res.json({ ok: true, points: 5 }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 充值卡兑换。 */
  router.post('/wallet/redeem', (req, res) => { // 路由 POST /wallet/redeem：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const body = parse(z.object({ code: z.string().min(6).max(60) }), req.body); // 保存 body：承载本步骤的计算结果供后续使用
    const card = deps.db.prepare('SELECT * FROM wallet_cards WHERE code = ?').get(body.code.toUpperCase()) as // 保存 card：承载本步骤的计算结果供后续使用
      | { id: string; amount_cents: number; status: string } // 业务步骤：推进当前流程的下一项处理
      | undefined; // 业务步骤：推进当前流程的下一项处理
    if (!card) throw new AppError('NOT_FOUND', '卡密不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    if (card.status !== 'unused') throw new AppError('CONFLICT', '卡密已被使用'); // 业务拒绝 CONFLICT：以统一错误码终止当前请求
    const tx = deps.db.transaction(() => { // 保存 tx：承载本步骤的计算结果供后续使用
      deps.db.prepare('UPDATE wallet_cards SET status = ?, used_by = ?, used_at = ? WHERE id = ?').run('used', userId, now(), card.id); // 预编译 SQL：固定语句结构后绑定参数执行
      credit(deps, userId, card.amount_cents, 'recharge', '充值卡兑换'); // 业务步骤：推进当前流程的下一项处理
    }); // 结束函数体：本层作用域收尾
    tx(); // 业务步骤：推进当前流程的下一项处理
    res.json({ ok: true, amount_cents: card.amount_cents }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 独立商城商品列表：自动发货商品按剩余卡密算可售库存。 */
  router.get('/shop/products', (_req, res) => { // 路由 GET /shop/products：注册入口并绑定鉴权与处理逻辑
    const rows = deps.db // 保存 rows：承载本步骤的计算结果供后续使用
      .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
        `SELECT p.code, p.name, p.summary, p.kind, p.price_cents, p.cover_url, p.stock, p.delivery_note,
                CASE WHEN p.kind = 'virtual_auto'
                  THEN (SELECT COUNT(*) FROM shop_card_keys k WHERE k.product_id = p.id AND k.status = 'unused')
                  ELSE p.stock END AS available
         FROM shop_products p WHERE p.status = 'active' ORDER BY p.sort_order`,
      ) // 调用结束：参数列表与链式调用收尾
      .all(); // 查询多行：读取列表供批量处理
    res.json({ products: rows }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 下单：余额扣款 + 优惠码 + 自动发卡 / 实物地址 / 人工发货。 */
  router.post('/shop/orders', (req, res) => { // 路由 POST /shop/orders：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const body = parse( // 保存 body：承载本步骤的计算结果供后续使用
      z.object({ // 业务步骤：推进当前流程的下一项处理
        product_code: z.string().min(1).max(60), // 对象字段：声明结构中的一项数据
        quantity: z.number().int().min(1).max(10).optional(), // 对象字段：声明结构中的一项数据
        coupon_code: z.string().max(40).optional(), // 对象字段：声明结构中的一项数据
        use_points: z.boolean().optional(), // 是否使用积分抵扣；指定 points_to_use 视为开启
        points_to_use: z.number().int().min(1).optional(), // 指定消耗积分；缺省按可抵扣上限最大化
        shipping: z // 对象字段：声明结构中的一项数据
          .object({ name: z.string().min(1).max(40), phone: z.string().min(5).max(30), address: z.string().min(5).max(200) }) // 链式调用：在上一步结果上继续处理
          .optional(), // 链式调用：在上一步结果上继续处理
      }), // 结束代码块：本层作用域收尾
      req.body, // 读取请求：取得入参、身份或上下文
    ); // 调用结束：参数列表与链式调用收尾
    const product = deps.db.prepare('SELECT * FROM shop_products WHERE code = ? AND status = ?').get(body.product_code, 'active') as // 保存 product：承载本步骤的计算结果供后续使用
      | { id: string; code: string; name: string; kind: 'physical' | 'virtual_auto' | 'virtual_manual'; price_cents: number; stock: number } // 业务步骤：推进当前流程的下一项处理
      | undefined; // 业务步骤：推进当前流程的下一项处理
    if (!product) throw new AppError('NOT_FOUND', '商品不存在或已下架'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    const quantity = body.quantity ?? 1; // 保存 quantity：承载本步骤的计算结果供后续使用
    if (product.kind === 'physical' && !body.shipping) throw new AppError('VALIDATION_FAILED', '实物商品需要填写收货信息'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    if (product.kind === 'physical' && product.stock < quantity) throw new AppError('VALIDATION_FAILED', '库存不足'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    const amount = product.price_cents * quantity; // 保存 amount：承载本步骤的计算结果供后续使用
    const coupon = couponDiscount(deps, body.coupon_code, amount); // 保存 coupon：承载本步骤的计算结果供后续使用
    const afterCoupon = Math.max(0, amount - coupon.discount); // 优惠码之后的应付（积分段入参）
    const pointsConfig = readPointsConfig(deps.env); // 积分兑换比例与单笔上限
    const usePoints = body.use_points === true || body.points_to_use !== undefined; // 显式开启或指定积分量
    const deduction = usePoints // 常量 deduction：保存固定配置或一次性派生值
      ? computeDeduction({ amountCents: afterCoupon, pointsBalance: getPointsBalance(deps.db, userId), config: pointsConfig, pointsToUse: body.points_to_use }) // 执行当前业务步骤
      : { deduct_cents: 0, points_spent: 0, payable_cents: afterCoupon, capped_by: 'none' as const }; // 未开启抵扣：全额应付
    const payable = Math.max(0, deduction.payable_cents); // 抵扣后应付（分）；全额抵扣为 0 即即时完成
    if (payable > 0) requireBalance(deps, userId, payable); // 业务步骤：推进当前流程的下一项处理
    const orderId = `order-${randomUUID()}`; // 保存 orderId：承载本步骤的计算结果供后续使用
    const tx = deps.db.transaction(() => { // 保存 tx：承载本步骤的计算结果供后续使用
      if (deduction.points_spent > 0) { // 有抵扣才扣积分并写流水，与订单 / 余额扣款同事务
        deductPoints(deps.db, { userId, points: deduction.points_spent, deductCents: deduction.deduct_cents, refType: 'shop_order', refId: orderId, note: `积分抵扣 ${product.name}`, now: now() }); // 调用 deductPoints 并处理其返回结果
      } // 代码块结束
      if (payable > 0) debit(deps, userId, payable, 'shop_order', orderId, `购买 ${product.name}`); // 业务步骤：推进当前流程的下一项处理
      let status: 'paid' | 'delivered' = 'paid'; // 保存 status：承载本步骤的计算结果供后续使用
      let deliveredAt: string | null = null; // 保存 deliveredAt：承载本步骤的计算结果供后续使用
      let deliveredContent: string | null = null; // 保存 deliveredContent：承载本步骤的计算结果供后续使用
      let deliveryKind = product.kind; // 保存 deliveryKind：承载本步骤的计算结果供后续使用
      if (product.kind === 'virtual_auto') { // 条件分支：仅在满足业务前置条件时继续
        const key = deps.db.prepare("SELECT id, code FROM shop_card_keys WHERE product_id = ? AND status = 'unused' LIMIT 1").get(product.id) as // 保存 key：承载本步骤的计算结果供后续使用
          | { id: string; code: string } // 业务步骤：推进当前流程的下一项处理
          | undefined; // 业务步骤：推进当前流程的下一项处理
        if (!key) throw new AppError('VALIDATION_FAILED', '该商品暂时缺货'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
        deps.db.prepare("UPDATE shop_card_keys SET status = 'used', used_by = ?, used_at = ? WHERE id = ?").run(userId, now(), key.id); // 预编译 SQL：固定语句结构后绑定参数执行
        status = 'delivered'; // 赋值：更新当前作用域中的状态
        deliveredAt = now(); // 赋值：更新当前作用域中的状态
        deliveredContent = key.code; // 赋值：更新当前作用域中的状态
      } else if (product.kind === 'virtual_manual') { // 其他分支：处理不满足前置条件的路径
        deliveredContent = '下单成功，客服将在 24 小时内联系你安排远程时间。'; // 赋值：更新当前作用域中的状态
      } // 结束条件分支：本层作用域收尾
      if (product.kind !== 'virtual_auto') { // 条件分支：仅在满足业务前置条件时继续
        deps.db.prepare('UPDATE shop_products SET stock = MAX(0, stock - ?) WHERE id = ?').run(quantity, product.id); // 预编译 SQL：固定语句结构后绑定参数执行
      } // 结束条件分支：本层作用域收尾
      deps.db // 业务步骤：推进当前流程的下一项处理
        .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
          `INSERT INTO shop_orders (id, user_id, product_id, quantity, amount_cents, discount_cents, payable_cents, coupon_code, points_spent, points_deduct_cents, status, delivery_kind, delivered_content, shipping_json, created_at, paid_at, delivered_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ) // 调用结束：参数列表与链式调用收尾
        .run( // 执行写入：把参数落库并返回影响结果
          orderId, // 业务步骤：推进当前流程的下一项处理
          userId, // 业务步骤：推进当前流程的下一项处理
          product.id, // 业务步骤：推进当前流程的下一项处理
          quantity, // 业务步骤：推进当前流程的下一项处理
          amount, // 业务步骤：推进当前流程的下一项处理
          coupon.discount, // 业务步骤：推进当前流程的下一项处理
          payable, // 业务步骤：推进当前流程的下一项处理
          body.coupon_code?.toUpperCase() ?? null, // 业务步骤：推进当前流程的下一项处理
          deduction.points_spent, // 积分消耗留痕
          deduction.deduct_cents, // 折抵金额留痕（分）
          status, // 业务步骤：推进当前流程的下一项处理
          deliveryKind, // 业务步骤：推进当前流程的下一项处理
          deliveredContent, // 业务步骤：推进当前流程的下一项处理
          body.shipping ? JSON.stringify(body.shipping) : null, // 业务步骤：推进当前流程的下一项处理
          now(), // 业务步骤：推进当前流程的下一项处理
          now(), // 业务步骤：推进当前流程的下一项处理
          deliveredAt, // 业务步骤：推进当前流程的下一项处理
        ); // 调用结束：参数列表与链式调用收尾
      if (coupon.couponId) { // 条件分支：仅在满足业务前置条件时继续
        deps.db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(coupon.couponId); // 预编译 SQL：固定语句结构后绑定参数执行
        deps.db // 业务步骤：推进当前流程的下一项处理
          .prepare('INSERT INTO coupon_redemptions (id, coupon_id, user_id, order_id, discount_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)') // 预编译 SQL：固定语句结构后绑定参数执行
          .run(`cr-${randomUUID()}`, coupon.couponId, userId, orderId, coupon.discount, now()); // 执行写入：把参数落库并返回影响结果
      } // 结束条件分支：本层作用域收尾
      // 推广分成：被邀请人首单，邀请人拿 5%（仅一次，标记 settled）
      const referral = deps.db.prepare("SELECT id, inviter_id FROM referrals WHERE invitee_id = ? AND status = 'bound'").get(userId) as // 保存 referral：承载本步骤的计算结果供后续使用
        | { id: string; inviter_id: string } // 业务步骤：推进当前流程的下一项处理
        | undefined; // 业务步骤：推进当前流程的下一项处理
      if (referral) { // 条件分支：仅在满足业务前置条件时继续
        const commission = Math.round(payable * 0.05); // 保存 commission：承载本步骤的计算结果供后续使用
        deps.db.prepare("UPDATE referrals SET commission_cents = ?, status = 'settled' WHERE id = ?").run(commission, referral.id); // 预编译 SQL：固定语句结构后绑定参数执行
        credit(deps, referral.inviter_id, commission, 'commission', `推广首单分成（订单 ${orderId}）`); // 业务步骤：推进当前流程的下一项处理
      } // 结束条件分支：本层作用域收尾
    }); // 结束函数体：本层作用域收尾
    tx(); // 业务步骤：推进当前流程的下一项处理
    res.status(201).json({ order_id: orderId, payable_cents: payable, discount_cents: coupon.discount, delivery_kind: product.kind, points_spent: deduction.points_spent, points_deduct_cents: deduction.deduct_cents }); // 输出响应：既有字段不变，仅追加积分抵扣明细
  }); // 结束函数体：本层作用域收尾

  /** 我的订单。 */
  router.get('/shop/orders', (req, res) => { // 路由 GET /shop/orders：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const items = deps.db // 保存 items：承载本步骤的计算结果供后续使用
      .prepare( // 预编译 SQL：固定语句结构后绑定参数执行
        `SELECT o.id, o.quantity, o.amount_cents, o.discount_cents, o.payable_cents, o.coupon_code, o.points_spent, o.points_deduct_cents, o.status, o.delivery_kind,
                o.delivered_content, o.created_at, o.delivered_at, p.code AS product_code, p.name AS product_name, p.cover_url
         FROM shop_orders o JOIN shop_products p ON p.id = o.product_id
         WHERE o.user_id = ? ORDER BY o.created_at DESC LIMIT 50`,
      ) // 调用结束：参数列表与链式调用收尾
      .all(userId); // 查询多行：读取列表供批量处理
    res.json({ items }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 确认收货 / 完成人工发货。 */
  router.post('/shop/orders/:id/confirm', (req, res) => { // 路由 POST /shop/orders/:id/confirm：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const order = deps.db.prepare('SELECT status FROM shop_orders WHERE id = ? AND user_id = ?').get(req.params.id, userId) as // 保存 order：承载本步骤的计算结果供后续使用
      | { status: string } // 业务步骤：推进当前流程的下一项处理
      | undefined; // 业务步骤：推进当前流程的下一项处理
    if (!order) throw new AppError('NOT_FOUND', '订单不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    if (order.status !== 'paid') throw new AppError('CONFLICT', '当前订单状态不可确认'); // 业务拒绝 CONFLICT：以统一错误码终止当前请求
    deps.db.prepare("UPDATE shop_orders SET status = 'delivered', delivered_at = ? WHERE id = ?").run(now(), req.params.id); // 预编译 SQL：固定语句结构后绑定参数执行
    res.json({ ok: true }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 退款：原路退回余额；实物已发货也可退，由运营后续处理物流。 */
  router.post('/shop/orders/:id/refund', (req, res) => { // 路由 POST /shop/orders/:id/refund：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const order = deps.db.prepare('SELECT status, payable_cents FROM shop_orders WHERE id = ? AND user_id = ?').get(req.params.id, userId) as // 保存 order：承载本步骤的计算结果供后续使用
      | { status: string; payable_cents: number } // 业务步骤：推进当前流程的下一项处理
      | undefined; // 业务步骤：推进当前流程的下一项处理
    if (!order) throw new AppError('NOT_FOUND', '订单不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    if (order.status === 'refunded' || order.status === 'cancelled') throw new AppError('CONFLICT', '订单已退款或已取消'); // 业务拒绝 CONFLICT：以统一错误码终止当前请求
    const tx = deps.db.transaction(() => { // 保存 tx：承载本步骤的计算结果供后续使用
      deps.db.prepare("UPDATE shop_orders SET status = 'refunded' WHERE id = ?").run(req.params.id); // 预编译 SQL：固定语句结构后绑定参数执行
      credit(deps, userId, order.payable_cents, 'refund', `订单退款 ${req.params.id}`); // 业务步骤：推进当前流程的下一项处理
    }); // 结束函数体：本层作用域收尾
    tx(); // 业务步骤：推进当前流程的下一项处理
    res.json({ ok: true, refunded_cents: order.payable_cents }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 优惠码预校验（不消耗次数）。 */
  router.post('/coupons/validate', (req, res) => { // 路由 POST /coupons/validate：注册入口并绑定鉴权与处理逻辑
    const body = parse(z.object({ code: z.string().min(1).max(40), amount_cents: z.number().int().min(0) }), req.body); // 保存 body：承载本步骤的计算结果供后续使用
    const result = couponDiscount(deps, body.code, body.amount_cents); // 保存 result：承载本步骤的计算结果供后续使用
    res.json({ valid: true, discount_cents: result.discount }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  /** 推广中心：邀请码、已邀请人数与累计佣金。 */
  router.get('/referral', (req, res) => { // 路由 GET /referral：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    let code = deps.db.prepare('SELECT code FROM referral_codes WHERE user_id = ?').get(userId) as { code: string } | undefined; // 保存 code：承载本步骤的计算结果供后续使用
    if (!code) { // 条件分支：仅在满足业务前置条件时继续
      const generated = `MIM${userId.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase()}`; // 保存 generated：承载本步骤的计算结果供后续使用
      deps.db.prepare('INSERT OR IGNORE INTO referral_codes (user_id, code, created_at) VALUES (?, ?, ?)').run(userId, generated, now()); // 预编译 SQL：固定语句结构后绑定参数执行
      code = { code: generated }; // 赋值：更新当前作用域中的状态
    } // 结束条件分支：本层作用域收尾
    const invited = deps.db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(commission_cents), 0) AS commission FROM referrals WHERE inviter_id = ?').get(userId); // 保存 invited：承载本步骤的计算结果供后续使用
    res.json({ code: code.code, invited, commission_cents: (invited as { commission: number }).commission }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束代码块：本层作用域收尾

  /** 绑定邀请码：仅新用户、仅一次、不能绑自己。 */
  router.post('/referral/bind', (req, res) => { // 路由 POST /referral/bind：注册入口并绑定鉴权与处理逻辑
    const userId = req.user!.id; // 保存 userId：承载本步骤的计算结果供后续使用
    const body = parse(z.object({ code: z.string().min(4).max(40) }), req.body); // 保存 body：承载本步骤的计算结果供后续使用
    if (deps.db.prepare('SELECT 1 AS ok FROM referrals WHERE invitee_id = ?').get(userId)) throw new AppError('CONFLICT', '已绑定过邀请码'); // 业务拒绝 CONFLICT：以统一错误码终止当前请求
    const inviter = deps.db.prepare('SELECT user_id FROM referral_codes WHERE code = ?').get(body.code.toUpperCase()) as { user_id: string } | undefined; // 保存 inviter：承载本步骤的计算结果供后续使用
    if (!inviter) throw new AppError('NOT_FOUND', '邀请码不存在'); // 业务拒绝 NOT_FOUND：以统一错误码终止当前请求
    if (inviter.user_id === userId) throw new AppError('VALIDATION_FAILED', '不能绑定自己的邀请码'); // 业务拒绝 VALIDATION_FAILED：以统一错误码终止当前请求
    deps.db // 业务步骤：推进当前流程的下一项处理
      .prepare("INSERT INTO referrals (id, inviter_id, invitee_id, code, status, created_at) VALUES (?, ?, ?, ?, 'bound', ?)") // 预编译 SQL：固定语句结构后绑定参数执行
      .run(`ref-${randomUUID()}`, inviter.user_id, userId, body.code.toUpperCase(), now()); // 执行写入：把参数落库并返回影响结果
    res.json({ ok: true }); // 输出响应：把处理结果写回 HTTP 客户端
  }); // 结束函数体：本层作用域收尾

  return router; // 返回结果：把本步骤产物交给调用方
} // 结束代码块：本层作用域收尾
