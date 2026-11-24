/** FR-01 个人中心：资料、注销与撤销、本人数据自助导出 */

import { Router } from 'express'; // 引入 Express 路由工厂，用于装配 /me 下的个人中心接口
import { z } from 'zod'; // 引入 zod，用声明式 schema 校验 PATCH /me 的请求体
import { deletionGraceDays } from '../config.js'; // 引入注销冷静期派生函数（env 可调），替代硬编码常量
import { clockOf } from '../domain.js'; // 引入可控时钟，测试可注入固定时间而不依赖真实系统时间
import { idempotency, requireAuth } from '../middleware.js'; // 引入写操作幂等与登录态校验两个中间件
import { parse } from '../validate.js'; // 引入 zod 校验包装器，失败统一抛 VALIDATION_FAILED
import { addDays, todayDate } from '../utils.js'; // 引入按天偏移 / 当日日期工具
import { writeAudit, auditActor } from '../audit.js'; // 统一审计留痕：注销申请属敏感账号动作，必须留痕
import type { ApiDeps, Db } from '../types.js'; // 仅引入依赖注入与数据库类型，编译期擦除、不产生运行时代码

const profileBody = z // 更新资料接口的请求体 schema：先取 zod 链式构建器
  .object({ // 要求请求体必须是对象，未声明字段会被 zod 默认剥离
    display_name: z.string().max(60).optional(), // 昵称：可选，最长 60 字符，防止超长文本落库
    locale: z.enum(['zh-CN', 'en-US']).optional(), // 语言：只允许受支持的两种取值，避免写入未知语言码
    timezone: z.string().min(1).max(64).optional(), // 时区：可选字符串，限长 1-64 以排除空值与异常长串
  }) // 字段定义结束
  .refine((value) => Object.keys(value).length > 0, { message: '至少填写一个字段' }); // 追加语义约束：至少提交一个字段，避免无意义的空更新

/** 导出分组结构：key 机器可读、label 面向人、count 与 rows 长度一致 */
interface ExportSection { // 数据导出分组类型
  key: string; // 分组键（英文标识，前端按此渲染）
  label: string; // 分组中文名
  count: number; // 行数（与 rows.length 对齐）
  rows: Array<Record<string, unknown>>; // 行数据，字段在各查询处显式列明，不 SELECT *
}

/** 标识脱敏：手机 / 邮箱只保留首尾片段，导出包内不还原完整登录标识 */
function maskIdentifier(identifier: string): string { // 脱敏辅助函数
  if (!identifier) return ''; // 空标识直接返回
  if (identifier.includes('@')) { // 邮箱形态：保留首字符与域名
    const [name, domain] = identifier.split('@'); // 拆出本地段与域名
    return `${name.slice(0, 1)}***@${domain}`; // 本地段只留首字符
  } // 邮箱分支结束
  if (identifier.length <= 4) return '***'; // 极短标识不保留任何片段，避免反推
  return `${identifier.slice(0, 3)}***${identifier.slice(-4)}`; // 手机等长标识：前 3 后 4 保留
} // maskIdentifier 结束

/** 通用分组构造器：空列表也保留分组，便于前端固定渲染全部数据域 */
function buildSection(key: string, label: string, rows: Array<Record<string, unknown>>): ExportSection { // 分组装配
  return { key, label, count: rows.length, rows }; // 回显键 / 名 / 行数 / 行数据
} // buildSection 结束

export function createMeRouter(deps: ApiDeps): Router { // 工厂函数：接收依赖（数据库、时钟等）并返回装配好的个人中心路由
  const router = Router(); // 创建独立 router 实例，便于在 app 层按前缀统一挂载
  // 鉴权按命名空间生效：未匹配到 /me* 的请求直接放行到后续 router，避免未知路径被误拦成 401
  router.use('/me', requireAuth); // 仅对 /me 前缀启用登录态校验，不影响其它路由

  /** 按主键回查当前用户完整行（含注销预约时间与注册时间），避免依赖令牌内快照 */
  function readCurrentUser(db: Db, userId: string) { // 回查辅助函数
    return db.prepare( // 预编译单行查询
      `SELECT id, member_no, region, status, display_name, locale, timezone, is_guest,
              deletion_scheduled_at, created_at
         FROM users WHERE id = ?`, // 只取个人中心与导出需要的列，不带敏感列
    ).get(userId) as { // 行结构断言
      id: string; member_no: string | null; region: string; status: string; display_name: string;
      locale: string; timezone: string; is_guest: number | null; deletion_scheduled_at: string | null; created_at: string;
    } | undefined; // 查不到返回 undefined（鉴权层已保证存在，此处仅类型兜底）
  } // readCurrentUser 结束

  /** 通用只读查询：按占位符取行，导出各数据域复用同一封装 */
  function queryRows<T extends Record<string, unknown>>(sql: string, params: unknown[]): T[] { // 只读查询辅助
    return deps.db.prepare(sql).all(...params) as T[]; // 预编译并绑定参数，返回行数组
  } // queryRows 结束

  router.get('/me', (req, res) => { // GET /me：读取当前登录用户的对外可见资料
    const row = readCurrentUser(deps.db, req.user!.id); // 回库取最新状态（注销变更即时生效）
    const graceDays = deletionGraceDays(deps.env); // 当前生效的冷静期天数（env 派生）
    res.json({ // 直接以 JSON 返回，响应结构由前端契约消费
      user: { // 只暴露安全字段，不返回密码哈希、手机号等敏感信息
        id: row!.id, // 用户唯一 ID，前端用作本地缓存键
        member_no: row!.member_no, // 自动分配的 Mim ID 号码，个人中心展示与客服引用
        region: row!.region, // 区域（cn/global），决定前端可用的模块与身份类型
        status: row!.status, // 账号状态（active/pending_deletion），前端据此展示注销提示
        display_name: row!.display_name, // 昵称，用于页面展示
        locale: row!.locale, // 语言偏好，用于前端切换文案
        timezone: row!.timezone, // 时区偏好，用于前端本地化时间展示
        is_guest: row!.is_guest === 1, // 历史兼容列：恒为 false，仅为存量数据读取保留
        deletion_scheduled_at: row!.deletion_scheduled_at, // 注销预约时间；null 表示未申请注销
        deletion_grace_days: graceDays, // 当前生效的冷静期天数，供前端展示倒计时口径
      }, // user 字段结束
    }); // 响应体结束
  }); // GET /me 路由结束

  router.patch('/me', idempotency, (req, res) => { // PATCH /me：局部更新资料，先过幂等中间件防止重复提交
    const body = parse(profileBody, req.body); // 校验请求体并剥离未声明字段，失败直接抛 VALIDATION_FAILED
    const now = clockOf(deps); // 取当前时间（可由测试注入），作为 updated_at 落库
    const sets: string[] = []; // 收集待更新的 SET 片段，未提交的字段不参与更新
    const values: unknown[] = []; // 与 SET 片段一一对应的实参，用占位符传值防止 SQL 注入
    if (body.display_name !== undefined) { // 仅当客户端显式提交昵称时才更新该列
      sets.push('display_name = ?'); // 使用占位符而非字符串拼接，杜绝注入风险
      values.push(body.display_name); // 按占位符顺序压入昵称值
    } // 昵称分支结束
    if (body.locale !== undefined) { // 仅当显式提交语言偏好时才更新
      sets.push('locale = ?'); // 语言列占位符
      values.push(body.locale); // 压入已通过枚举校验的语言码
    } // 语言分支结束
    if (body.timezone !== undefined) { // 仅当显式提交时区偏好时才更新
      sets.push('timezone = ?'); // 时区分列占位符
      values.push(body.timezone); // 压入已通过长度校验的时区值
    } // 时区分支结束
    sets.push('updated_at = ?'); // 任何资料变更都刷新修改时间，便于审计与缓存失效
    values.push(now, req.user!.id); // 先压入 updated_at 值，再压入 WHERE 条件所需的用户 ID
    deps.db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values); // 动态拼装 SET 列表执行更新，WHERE 按主键精确命中单行

    const row = deps.db // 更新后回查数据库，确保响应与落库结果严格一致
      .prepare('SELECT id, member_no, region, status, display_name, locale, timezone FROM users WHERE id = ?') // 只查可对外字段，避免把敏感列带出
      .get(req.user!.id); // 按当前登录用户 ID 取单行
    res.json({ user: row }); // 返回更新后的完整用户视图
  }); // PATCH /me 路由结束

  router.post('/me/deletion', idempotency, (req, res) => { // POST /me/deletion：发起注销，进入宽限期而非立即物理删除
    const now = clockOf(deps); // 当前时间，作为状态变更时间戳
    const graceDays = deletionGraceDays(deps.env); // 按当前配置取冷静期天数
    const row = readCurrentUser(deps.db, req.user!.id); // 回库读取最新账号状态与预约时间
    if (row!.status === 'pending_deletion') { // 已在宽限期内重复发起：保持幂等，回显已存在的预约时间，不重置冷静期
      res.json({ status: 'pending_deletion', deletion_scheduled_at: row!.deletion_scheduled_at, grace_days: graceDays }); // 原样回显既有预约时间
      return; // 提前返回，避免重复写库覆盖原预约
    } // 幂等分支结束
    const scheduledAt = addDays(now, graceDays); // 按宽限期天数算出真正删除的时间点
    deps.db // 使用同步驱动执行单条更新
      .prepare( // 准备带占位符的 UPDATE 语句
        // 说明：把账号状态改为待删除，并记录删除预约时间与最后修改时间
        `UPDATE users SET status = 'pending_deletion', deletion_scheduled_at = ?, updated_at = ?
         WHERE id = ?`, // 条件：按主键定位当前用户；占位符依次为预约时间、修改时间、用户 ID
      ) // prepare 调用结束
      .run(scheduledAt, now, row!.id); // 按占位符顺序绑定并执行
    writeAudit(deps.db, auditActor(req), { // 注销申请属敏感账号动作，统一审计留痕
      action: 'privacy.account_deletion_request', // 动作码：账号注销申请
      targetType: 'user', // 对象类型：用户
      targetId: row!.id, // 对象主键：当前用户 ID
      detail: { member_no: row!.member_no, scheduled_at: scheduledAt }, // 明细只放 Mim ID 与预约时间，不放敏感明文
    }); // 审计写入结束
    res.json({ status: 'pending_deletion', deletion_scheduled_at: scheduledAt, grace_days: graceDays }); // 回显新状态、预约删除时间与冷静期天数
  }); // POST /me/deletion 路由结束

  router.post('/me/cancel-deletion', idempotency, (req, res) => { // POST /me/cancel-deletion：撤销注销，状态恢复为 active
    const now = clockOf(deps); // 当前时间作为 updated_at
    const row = readCurrentUser(deps.db, req.user!.id); // 回库读取最新状态，避免令牌快照过期
    if (row!.status !== 'pending_deletion') { // 非待删除状态无需处理，保持幂等
      res.json({ status: row!.status, deletion_scheduled_at: row!.deletion_scheduled_at }); // 原样回显当前状态与预约时间
      return; // 提前返回，避免无意义写库
    } // 幂等分支结束
    deps.db // 同步执行更新
      .prepare( // 准备 UPDATE 语句
        // 说明：状态回滚为 active，并清空删除预约时间，防止后台任务继续执行删除
        `UPDATE users SET status = 'active', deletion_scheduled_at = NULL, updated_at = ? WHERE id = ?`, // 单行 SQL：SET 三列（状态、清空预约、修改时间），WHERE 按主键限定
      ) // prepare 调用结束
      .run(now, row!.id); // 绑定修改时间与用户 ID 后执行
    res.json({ status: 'active', deletion_scheduled_at: null }); // 回显恢复后的状态与空预约时间
  }); // POST /me/cancel-deletion 路由结束

  router.get('/me/export', (req, res) => { // GET /me/export：本人自助导出完整数据包（只读快照）
    const row = readCurrentUser(deps.db, req.user!.id); // 回库取本人资料行
    const userId = row!.id; // 当前用户主键，作为各数据域查询条件
    const graceDays = deletionGraceDays(deps.env); // 包内记录当前生效的冷静期天数
    const today = todayDate(() => clockOf(deps)).replace(/-/g, ''); // 导出文件名用 YYYYMMDD 日期串

    // ---- 登录身份与第三方绑定（标识脱敏，不带 raw_profile / union 原文）----
    const identities = queryRows<Record<string, unknown>>(
      'SELECT provider, region, identifier, created_at FROM identities WHERE user_id = ? ORDER BY created_at', [userId],
    ).map((r) => ({ ...r, identifier: maskIdentifier(String(r.identifier ?? '')) })); // 标识按首尾脱敏后再入包
    const oauthAccounts = queryRows<Record<string, unknown>>(
      'SELECT provider, provider_user_id, nickname, created_at FROM oauth_accounts WHERE user_id = ? ORDER BY created_at', [userId],
    ); // 第三方绑定：只取提供方、提供方账号 ID 与展示昵称，不取邮箱与原始资料快照
    const sessions = queryRows<Record<string, unknown>>(
      'SELECT device_id, expires_at, created_at FROM sessions WHERE user_id = ? ORDER BY created_at', [userId],
    ); // 会话只导出设备与有效期元信息，绝不带出 refresh_token_hash
    const devices = queryRows<Record<string, unknown>>(
      'SELECT platform, name, last_seen_at, created_at FROM devices WHERE user_id = ? ORDER BY created_at', [userId],
    ); // 设备登记信息

    // ---- 钱包、积分、等级、徽章、签到 ----
    const wallets = queryRows<Record<string, unknown>>(
      'SELECT balance_cents, points, updated_at FROM wallets WHERE user_id = ?', [userId],
    ); // 钱包余额与积分
    const walletTransactions = queryRows<Record<string, unknown>>(
      'SELECT kind, amount_cents, points, ref_type, ref_id, note, created_at FROM wallet_transactions WHERE user_id = ? ORDER BY created_at', [userId],
    ); // 钱包流水明细
    const vipMemberships = queryRows<Record<string, unknown>>(
      'SELECT plan_id, level, starts_at, expires_at, status, created_at FROM vip_memberships WHERE user_id = ? ORDER BY created_at', [userId],
    ); // VIP 会员权益记录
    const checkins = queryRows<Record<string, unknown>>(
      'SELECT day, points, streak, created_at FROM checkins WHERE user_id = ? ORDER BY day', [userId],
    ); // 签到记录
    const userGrowth = queryRows<Record<string, unknown>>(
      'SELECT lifetime_points, level, updated_at FROM user_growth WHERE user_id = ?', [userId],
    ); // 成长档案：累计积分与等级
    const userBadges = queryRows<Record<string, unknown>>(
      'SELECT badge_code, source, awarded_at FROM user_badges WHERE user_id = ? ORDER BY awarded_at', [userId],
    ); // 已授予徽章

    // ---- 社区内容与互动 ----
    const threads = queryRows<Record<string, unknown>>(
      'SELECT title, summary, kind, status, price_cents, created_at, updated_at FROM community_threads WHERE author_id = ? ORDER BY created_at', [userId],
    ); // 本人发布的主题帖
    const posts = queryRows<Record<string, unknown>>(
      'SELECT thread_id, parent_id, content, created_at FROM community_posts WHERE author_id = ? ORDER BY created_at', [userId],
    ); // 本人发布的回复
    const threadLikes = queryRows<Record<string, unknown>>(
      'SELECT thread_id, created_at FROM community_thread_likes WHERE user_id = ? ORDER BY created_at', [userId],
    ); // 点赞记录
    const favorites = queryRows<Record<string, unknown>>(
      'SELECT thread_id, created_at FROM community_favorites WHERE user_id = ? ORDER BY created_at', [userId],
    ); // 收藏记录
    const ratings = queryRows<Record<string, unknown>>(
      'SELECT thread_id, rating, created_at FROM community_ratings WHERE user_id = ?', [userId],
    ); // 评分记录
    const purchases = queryRows<Record<string, unknown>>(
      'SELECT thread_id, amount_cents, created_at FROM community_purchases WHERE user_id = ?', [userId],
    ); // 付费帖购买记录
    const galleryFavorites = queryRows<Record<string, unknown>>(
      'SELECT media_id, created_at FROM gallery_favorites WHERE user_id = ?', [userId],
    ); // 图库 / 视频收藏
    const threadViews = queryRows<Record<string, unknown>>(
      'SELECT thread_id, created_at FROM community_thread_views WHERE user_id = ?', [userId],
    ); // 浏览去重账本

    // ---- 圈子 ----
    const circleMembers = queryRows<Record<string, unknown>>(
      'SELECT circle_id, role, status, joined_at FROM circle_members WHERE user_id = ?', [userId],
    ); // 本人加入的圈子与角色
    const circlePosts = queryRows<Record<string, unknown>>(
      'SELECT circle_id, body, created_at FROM circle_posts WHERE author_id = ? ORDER BY created_at', [userId],
    ); // 本人发布的圈内动态
    const circleNotices = queryRows<Record<string, unknown>>(
      'SELECT circle_id, body, created_at FROM circle_notices WHERE author_id = ? ORDER BY created_at', [userId],
    ); // 本人发布的圈内公告

    // ---- 消息与通知 ----
    const imConversations = queryRows<Record<string, unknown>>(
      `SELECT c.id, c.type, c.title, c.created_at
         FROM im_conversations c
         JOIN im_conversation_members m ON m.conversation_id = c.id
        WHERE m.user_id = ? ORDER BY c.updated_at DESC`, [userId],
    ); // 本人所在 IM 会话元信息（不含他人昵称原值以外的额外身份字段）
    const imMessages = queryRows<Record<string, unknown>>(
      'SELECT conversation_id, content_type, content, status, created_at FROM im_messages WHERE sender_user_id = ? ORDER BY created_at', [userId],
    ); // 本人发出的 IM 消息
    const directMessages = queryRows<Record<string, unknown>>(
      'SELECT from_user_id, to_user_id, content, read_at, created_at FROM direct_messages WHERE from_user_id = ? OR to_user_id = ? ORDER BY created_at', [userId, userId],
    ); // 私信往来：本人发出与本人可读的消息
    const notifications = queryRows<Record<string, unknown>>(
      'SELECT kind, thread_id, post_id, content, read_at, created_at FROM community_notifications WHERE user_id = ? ORDER BY created_at', [userId],
    ); // 站内通知（不取 actor_id，避免带出触发者标识）
    const unifiedMessages = queryRows<Record<string, unknown>>(
      'SELECT conversation_id, source, content_type, content, status, created_at FROM messages WHERE sender_user_id = ? ORDER BY created_at', [userId],
    ); // 统一消息表中本人发出的消息

    // ---- 交易、订单、支付与推广 ----
    const orders = queryRows<Record<string, unknown>>(
      'SELECT id, source, status, channel, total_cents, discount_cents, payable_cents, created_at, paid_at FROM orders WHERE user_id = ? ORDER BY created_at', [userId],
    ); // 统一订单记录
    const paymentIntents = queryRows<Record<string, unknown>>(
      'SELECT purpose, ref_id, provider, amount_cents, status, created_at, paid_at FROM payment_intents WHERE user_id = ? ORDER BY created_at', [userId],
    ); // 支付意图（不取支付链接 / 二维码文本）
    const paymentExtIntents = queryRows<Record<string, unknown>>(
      'SELECT purpose, ref_id, provider, amount_cents, status, created_at, paid_at FROM payment_ext_intents WHERE user_id = ? ORDER BY created_at', [userId],
    ); // 扩展渠道支付意图
    const shopOrders = queryRows<Record<string, unknown>>(
      'SELECT id, product_id, quantity, amount_cents, discount_cents, payable_cents, coupon_code, status, delivery_kind, created_at, paid_at, delivered_at FROM shop_orders WHERE user_id = ? ORDER BY created_at', [userId],
    ); // 独立商城订单
    const couponRedemptions = queryRows<Record<string, unknown>>(
      'SELECT coupon_id, order_id, discount_cents, created_at FROM coupon_redemptions WHERE user_id = ?', [userId],
    ); // 优惠码核销记录
    const referralCodes = queryRows<Record<string, unknown>>(
      'SELECT code, created_at FROM referral_codes WHERE user_id = ?', [userId],
    ); // 本人推广码
    const referrals = queryRows<Record<string, unknown>>(
      'SELECT inviter_id, invitee_id, code, status, commission_cents, created_at FROM referrals WHERE inviter_id = ? OR invitee_id = ?', [userId, userId],
    ).map((r) => ({ // 只保留本人在关系中的角色与推广关系，不导出对端用户 ID
      role: r.inviter_id === userId ? 'inviter' : 'invitee', // 判定本人角色：邀请人 / 被邀请人
      code: r.code, // 推广码
      status: r.status, // 绑定 / 结算状态
      commission_cents: r.commission_cents, // 关联佣金
      created_at: r.created_at, // 绑定时间
    }));
    const referralCommissions = queryRows<Record<string, unknown>>(
      'SELECT level, order_id, amount_cents, status, settle_at, settled_at, created_at FROM referral_commissions WHERE inviter_id = ? OR invitee_id = ? ORDER BY created_at', [userId, userId],
    ); // 返佣佣金明细
    const assetPurchases = queryRows<Record<string, unknown>>(
      'SELECT asset_id, amount_cents, created_at FROM asset_purchases WHERE user_id = ?', [userId],
    ); // 付费数字资产购买记录
    const authoredAssets = queryRows<Record<string, unknown>>(
      'SELECT code, kind, title, summary, status, views, sales, created_at FROM paid_assets WHERE author_id = ? ORDER BY created_at', [userId],
    ); // 本人创作的数字资产
    const creatorEarnings = queryRows<Record<string, unknown>>(
      'SELECT source_type, source_id, gross_cents, platform_fee_cents, net_cents, status, created_at, settled_at FROM creator_earnings WHERE user_id = ? ORDER BY created_at', [userId],
    ); // 创作收益分成记录
    const withdrawals = queryRows<Record<string, unknown>>(
      'SELECT amount_cents, status, method, review_note, created_at, reviewed_at, paid_at FROM withdrawal_requests WHERE user_id = ? ORDER BY created_at', [userId],
    ); // 提现申请（账户名 / 账号属敏感财务标识，一律不导出）
    const afterSales = queryRows<Record<string, unknown>>(
      'SELECT order_id, kind, reason, status, admin_note, created_at, updated_at FROM after_sales_requests WHERE user_id = ? ORDER BY created_at', [userId],
    ); // 售后申请记录
    const realnameRecords = queryRows<Record<string, unknown>>(
      'SELECT id_type, name_masked, id_last4, provider, status, reject_reason, created_at, updated_at FROM realname_records WHERE user_id = ?', [userId],
    ); // 实名材料：只导出结论与脱敏片段，不带姓名 / 证件号哈希原值
    const myInvitations = queryRows<Record<string, unknown>>(
      'SELECT code, max_uses, used_count, status, expires_at, created_at FROM invitations WHERE created_by = ?', [userId],
    ); // 本人创建的邀请码（绑定标识列不进入导出包）
    const invitationRedemptions = queryRows<Record<string, unknown>>(
      'SELECT invitation_id, created_at FROM invitation_redemptions WHERE user_id = ?', [userId],
    ); // 本人注册时的邀请核销记录（不取绑定标识）
    const contentItems = queryRows<Record<string, unknown>>(
      'SELECT source, source_id, kind, title, summary, status, created_at FROM content_items WHERE author_id = ? ORDER BY created_at', [userId],
    ); // 统一内容表中本人发布的条目

    // ---- 组装导出包：数据域顺序按「身份 → 资金 → 内容 → 社交 → 交易」排列 ----
    const sections: ExportSection[] = [ // 全量分组清单，空域也保留以对齐契约
      buildSection('identities', '登录身份', identities),
      buildSection('oauth_accounts', '第三方绑定', oauthAccounts),
      buildSection('sessions', '会话设备', sessions),
      buildSection('devices', '设备登记', devices),
      buildSection('wallets', '钱包余额', wallets),
      buildSection('wallet_transactions', '钱包流水', walletTransactions),
      buildSection('vip_memberships', '会员权益', vipMemberships),
      buildSection('checkins', '签到记录', checkins),
      buildSection('user_growth', '成长等级', userGrowth),
      buildSection('user_badges', '徽章', userBadges),
      buildSection('community_threads', '社区帖子', threads),
      buildSection('community_posts', '回复', posts),
      buildSection('community_thread_likes', '点赞', threadLikes),
      buildSection('community_favorites', '收藏', favorites),
      buildSection('community_ratings', '评分', ratings),
      buildSection('community_purchases', '付费帖购买', purchases),
      buildSection('gallery_favorites', '图库收藏', galleryFavorites),
      buildSection('community_thread_views', '浏览记录', threadViews),
      buildSection('circle_members', '圈子成员', circleMembers),
      buildSection('circle_posts', '圈内动态', circlePosts),
      buildSection('circle_notices', '圈内公告', circleNotices),
      buildSection('im_conversations', 'IM 会话', imConversations),
      buildSection('im_messages', 'IM 消息', imMessages),
      buildSection('direct_messages', '私信', directMessages),
      buildSection('community_notifications', '站内通知', notifications),
      buildSection('messages', '统一消息', unifiedMessages),
      buildSection('orders', '订单', orders),
      buildSection('payment_intents', '支付意图', paymentIntents),
      buildSection('payment_ext_intents', '扩展渠道支付', paymentExtIntents),
      buildSection('shop_orders', '商城订单', shopOrders),
      buildSection('coupon_redemptions', '优惠核销', couponRedemptions),
      buildSection('referral_codes', '推广码', referralCodes),
      buildSection('referrals', '推广关系', referrals),
      buildSection('referral_commissions', '返佣佣金', referralCommissions),
      buildSection('asset_purchases', '数字资产购买', assetPurchases),
      buildSection('authored_assets', '创作资产', authoredAssets),
      buildSection('creator_earnings', '创作收益', creatorEarnings),
      buildSection('withdrawal_requests', '提现申请', withdrawals),
      buildSection('after_sales_requests', '售后申请', afterSales),
      buildSection('realname_records', '实名记录', realnameRecords),
      buildSection('invitations', '邀请码', myInvitations),
      buildSection('invitation_redemptions', '邀请核销', invitationRedemptions),
      buildSection('content_items', '统一内容条目', contentItems),
    ];

    const memberNo = row!.member_no ?? 'unknown'; // Mim ID 缺失时文件名兜底为 unknown
    const fileName = `mim-data-${memberNo}-${today}.json`; // 附件文件名：mim-data-<号码>-<YYYYMMDD>.json
    res.setHeader('Content-Type', 'application/json; charset=utf-8'); // 导出包为 JSON 文本
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`); // 浏览器按附件下载并使用约定文件名
    res.json({ // 导出包结构对齐冻结契约 §1.4
      schema: 'mim.account-export.v1', // 包结构版本号，后续格式演进据此兼容
      exported_at: clockOf(deps), // 导出时间（ISO，可注入时钟便于测试断言）
      grace_days: graceDays, // 当前生效冷静期天数
      profile: { // 本人资料快照
        id: row!.id, // 内部主键
        member_no: row!.member_no, // 对外 Mim ID
        display_name: row!.display_name, // 昵称
        locale: row!.locale, // 语言偏好
        timezone: row!.timezone, // 时区偏好
        region: row!.region, // 所属区域
        status: row!.status, // 账号状态
        created_at: row!.created_at, // 注册时间
        deletion_scheduled_at: row!.deletion_scheduled_at, // 注销预约时间
      },
      sections, // 全量数据域分组
      notes: [ // 导出说明文案，固定随包下发
        '本文件是一次性快照，包含你在 Mim 的全部个人数据；服务器侧会在注销到期后物理删除。',
      ],
    }); // 导出包响应结束
  }); // GET /me/export 路由结束

  return router; // 返回装配完成的路由，供 app.ts 挂载到 /api/v1
} // createMeRouter 工厂结束
