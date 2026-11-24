/**
 * 账号自助注销 + 数据清理契约测试（后端批次）。
 *
 * 覆盖冻结契约 §7 清单：
 *   - 申请 / 幂等重复申请 / 撤销 / 非待删除态撤销幂等；
 *   - 到期清理逐域删除 PII、双用户交叉不误删、重复执行幂等、事务失败整体回滚；
 *   - 自助导出覆盖各数据域、不含敏感列、文件名与附件头正确；
 *   - 管理端队列剩余时间 / 逾期标记、手动触发写审计、匿名 401、无权限 403；
 *   - 待删除态账号仍可访问导出白名单。
 */

import { beforeEach, describe, expect, it } from 'vitest'; // vitest 编排 API
import request from 'supertest'; // supertest 进程内驱动 Express
import type { Express } from 'express'; // 仅引入类型
import { createApp } from '../src/app.js'; // 唯一装配入口
import { createDatabase } from '../src/db.js'; // 内存库工厂
import type { ApiDeps, Db } from '../src/types.js'; // 依赖与数据库类型
import { createUser } from '../src/identity.js'; // 直建造号（测试可控时钟与数据准备）
import { issueAccessToken } from '../src/auth.js'; // 直签访问令牌
import { purgeDueAccounts } from '../src/privacy.js'; // 到期清理引擎
import { registerTestAccount } from './_auth-helper.js'; // 注册 + 口令登录辅助

const JWT_SECRET = 'account-deletion-test-secret-0123456789abcd'; // 固定测试密钥
const ADMIN_TOKEN = 'account-deletion-admin-token'; // 引导令牌固定值

/** 测试环境：开启自助注册、开启引导超管通道，其余取代码缺省 */
const TEST_ENV: Record<string, string> = {
  MIM_ADMIN_TOKEN: ADMIN_TOKEN, // 引导超管通道
  MIM_REGISTRATION_ENABLED: '1', // 测试内开放注册，便于走真实 HTTP 注册链路
};

let db: Db; // 内存库
let deps: ApiDeps; // 依赖容器
let app: Express; // 待测应用

/** 引导通道请求头 */
function adminHeaders(): Record<string, string> {
  return { 'x-admin-token': ADMIN_TOKEN, 'content-type': 'application/json' };
}

/** 普通用户鉴权头：Bearer + 随机幂等键（写操作强制幂等，缺键 400） */
function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'idempotency-key': `del-${Math.random().toString(36).slice(2)}` };
} // authHeaders 结束

/** 直建用户并签发访问令牌，返回主键 / Mim ID / 令牌 */
function makeUser(displayName = '测试用户'): { userId: string; memberNo: string | null; token: string } {
  const row = createUser(db, { region: 'cn', display_name: displayName, now: new Date().toISOString() }); // 建号并发号
  const token = issueAccessToken(row.id, row.region, JWT_SECRET); // 直签访问令牌
  return { userId: row.id, memberNo: row.member_no, token }; // 交回测试句柄
}

/** 把账号置为待删除态，预约指定时间 */
function markPending(userId: string, scheduledAt: string): void {
  db.prepare("UPDATE users SET status = 'pending_deletion', deletion_scheduled_at = ? WHERE id = ?").run(scheduledAt, userId);
} // markPending 结束

/** 按关联列统计某用户在指定表中的残留行数 */
function countWhere(table: string, col: string, userId: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`).get(userId) as { n: number };
  return row.n; // 残留行数
} // countWhere 结束

/** 按动作码回读审计流水 */
function auditRows(action: string): Array<{ action: string; result: string; payload: string | null }> {
  return db.prepare('SELECT action, result, payload FROM audit_logs WHERE action = ?').all(action) as
    Array<{ action: string; result: string; payload: string | null }>;
} // auditRows 结束

/** 为待删除账号 A 在各数据域写入代表性 PII / 业务行，供清理后逐项断言 */
function seedUserData(userId: string, otherUserId: string, now: string): void {
  db.prepare('INSERT INTO identities (id, user_id, region, provider, identifier, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('ident-a', userId, 'cn', 'phone', '13900000001', now); // 登录身份（手机号）
  db.prepare('INSERT INTO credentials (id, user_id, kind, secret_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('cred-a', userId, 'password', 'bcrypt-hash-secret-material', now); // 口令凭据（哈希禁导出必删）
  db.prepare('INSERT INTO sessions (id, user_id, refresh_token_hash, device_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('sess-a', userId, 'refresh-hash-secret-material', 'device-a', now, now); // 会话（刷新哈希禁导出必删）
  db.prepare('INSERT INTO devices (id, user_id, platform, name, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('dev-a', userId, 'web', '测试浏览器', now, now); // 设备登记
  db.prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, ?, ?, ?)')
    .run(userId, 1200, 80, now); // 钱包余额与积分
  db.prepare('INSERT INTO wallet_transactions (id, user_id, kind, amount_cents, points, ref_type, ref_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('wt-a', userId, 'points', 0, 5, 'checkin', 'day-1', '签到积分', now); // 钱包流水
  db.prepare('INSERT INTO checkins (id, user_id, day, points, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('chk-a', userId, '2026-11-24', 5, now); // 签到记录
  const threadId = 'thread-a'; // 本人主题帖主键（供互动记录外键引用）
  db.prepare(`INSERT INTO community_threads (id, board_id, author_id, title, summary, body, kind, status, created_at, updated_at, last_activity_at)
              VALUES (?, 'board-general', ?, '本人主题帖', '摘要', '正文', 'text', 'published', ?, ?, ?)`)
    .run(threadId, userId, now, now, now); // 本人主题帖
  db.prepare('INSERT INTO community_posts (id, thread_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('post-a', threadId, userId, '本人回复', now); // 本人回复
  db.prepare('INSERT INTO community_thread_likes (thread_id, user_id, created_at) VALUES (?, ?, ?)')
    .run(threadId, userId, now); // 点赞
  db.prepare('INSERT INTO community_favorites (thread_id, user_id, created_at) VALUES (?, ?, ?)')
    .run(threadId, userId, now); // 收藏
  db.prepare('INSERT INTO community_ratings (thread_id, user_id, rating, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(threadId, userId, 5, now, now); // 评分
  db.prepare('INSERT INTO community_purchases (id, user_id, thread_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('cp-a', userId, threadId, 1900, now); // 付费帖购买
  db.prepare('INSERT INTO community_thread_views (thread_id, user_id, created_at) VALUES (?, ?, ?)')
    .run(threadId, userId, now); // 浏览记录
  db.prepare('INSERT INTO direct_messages (id, from_user_id, to_user_id, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('dm-a', userId, otherUserId, '本人发出的私信', now); // 私信往来
  db.prepare('INSERT INTO community_notifications (id, user_id, kind, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('notif-a', userId, 'reply', '收到回复通知', now); // 站内通知
  db.prepare('INSERT INTO orders (id, user_id, source, source_id, status, total_cents, payable_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('order-a', userId, 'community', threadId, 'paid', 1900, 1900, now); // 统一订单
  db.prepare('INSERT INTO payment_intents (id, user_id, purpose, ref_id, provider, amount_cents, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('pi-a', userId, 'asset', threadId, 'sandbox', 1900, 'paid', now); // 支付意图
  db.prepare('INSERT INTO payment_ext_intents (id, user_id, purpose, ref_id, provider, amount_cents, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('pe-a', userId, 'asset', threadId, 'hupijiao', 1900, 'paid', now); // 扩展渠道支付意图
  db.prepare('INSERT INTO creator_earnings (id, user_id, source_type, source_id, gross_cents, platform_fee_cents, net_cents, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('ce-a', userId, 'asset', threadId, 1000, 100, 900, 'settled', now); // 创作收益
  db.prepare('INSERT INTO withdrawal_requests (id, user_id, amount_cents, status, method, account_name, account_no, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('wd-a', userId, 500, 'pending', 'alipay', '张三', '138****0000', now, now); // 提现申请（账户名 / 号 PII 必删）
  db.prepare(`INSERT INTO realname_records (id, user_id, id_type, name_hash, name_masked, id_hash, id_last4, provider, status, created_at, updated_at)
              VALUES (?, ?, 'id_card', 'name-hash', '张**', 'id-hash', '1234', 'manual', 'pending', ?, ?)`)
    .run('rn-a', userId, now, now); // 实名材料（姓名 / 证件哈希必删）
  db.prepare('INSERT INTO invitations (id, code, created_by, max_uses, used_count, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('inv-a', 'INVITE-A', userId, 1, 0, 'active', now, now); // 本人邀请码
  const imId = 'im-a'; // 本人 IM 会话主键
  db.prepare('INSERT INTO im_conversations (id, type, title, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(imId, 'direct', '', userId, now, now); // 本人 IM 会话
  db.prepare('INSERT INTO im_conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
    .run(imId, userId, 'owner', now); // IM 会话成员
  db.prepare('INSERT INTO im_messages (id, conversation_id, sender_user_id, content_type, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('im-msg-a', imId, userId, 'text', '本人 IM 消息', 'sent', now, now); // 本人 IM 消息
  const convId = 'conv-a'; // 本人统一会话主键
  db.prepare('INSERT INTO conversations (id, source, source_id, type, owner_user_id, members_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(convId, 'im', imId, 'direct', userId, JSON.stringify([userId]), now, now); // 统一会话
  db.prepare('INSERT INTO messages (id, conversation_id, source, source_id, sender_user_id, content_type, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('msg-a', convId, 'im', 'im-msg-a', userId, 'text', '本人统一消息', 'sent', now); // 统一消息
  db.prepare(`INSERT INTO content_items (id, source, source_id, container_kind, container_id, author_id, kind, title, status, created_at, updated_at)
              VALUES ('ci-a', 'community_thread', ?, 'board', 'board-general', ?, 'text', '统一内容条目', 'published', ?, ?)`)
    .run(threadId, userId, now, now); // 统一内容条目
  const circleId = 'circle-a'; // 本人圈子主键
  db.prepare('INSERT INTO circles (id, slug, name, owner_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(circleId, 'circle-a', '本人圈子', userId, now); // 自有圈子
  db.prepare('INSERT INTO circle_members (circle_id, user_id, role, status, joined_at) VALUES (?, ?, ?, ?, ?)')
    .run(circleId, userId, 'owner', 'active', now); // 圈子成员
  db.prepare('INSERT INTO circle_posts (id, circle_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('cp-circle-a', circleId, userId, '圈内动态', now); // 圈内动态
  db.prepare('INSERT INTO circle_notices (id, circle_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('cn-a', circleId, userId, '圈内公告', now); // 圈内公告
  db.prepare('INSERT INTO paid_assets (id, code, kind, title, author_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('asset-a', 'ASSET-A', 'article', '本人创作资产', userId, 'published', now, now); // 本人创作资产
  db.prepare('INSERT INTO asset_purchases (id, user_id, asset_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('ap-a', userId, 'asset-a', 900, now); // 资产购买记录
} // seedUserData 结束

beforeEach(() => { // 每例前置：重建内存库与依赖容器
  db = createDatabase(':memory:'); // 全新内存库
  deps = { db, jwtSecret: JWT_SECRET, env: TEST_ENV }; // 复用同一依赖
  app = createApp(deps); // 真实 Express 应用
});

describe('自助注销：申请 / 幂等 / 撤销', () => {
  it('GET /me 回传注销字段与当前冷静期天数', async () => {
    const { token } = makeUser(); // 直建普通用户
    const res = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200); // 已登录可读
    expect(res.body.user.deletion_scheduled_at).toBeNull(); // 未申请注销：预约时间为空
    expect(res.body.user.deletion_grace_days).toBe(7); // 缺省冷静期 7 天
  });

  it('POST /me/deletion 首次申请进入待删除，并写注销申请审计', async () => {
    const { token, userId } = makeUser(); // 直建普通用户
    const res = await request(app).post('/api/v1/me/deletion').set(authHeaders(token));
    expect(res.status).toBe(200); // 申请受理
    expect(res.body.status).toBe('pending_deletion'); // 状态进入待删除
    expect(res.body.grace_days).toBe(7); // 回显冷静期天数
    expect(typeof res.body.deletion_scheduled_at).toBe('string'); // 预约删除时间非空
    const row = db.prepare('SELECT status, deletion_scheduled_at FROM users WHERE id = ?').get(userId) as
      { status: string; deletion_scheduled_at: string | null }; // 回库核对落库状态
    expect(row.status).toBe('pending_deletion'); // 库内状态一致
    expect(row.deletion_scheduled_at).not.toBeNull(); // 库内预约时间已写
    const audits = auditRows('privacy.account_deletion_request'); // 回读注销申请审计
    expect(audits).toHaveLength(1); // 首次申请留一条痕
    expect(audits[0].result).toBe('success'); // 审计结果成功
  });

  it('重复申请幂等：回显既有预约时间，不重置冷静期', async () => {
    let nowIso = '2026-11-24T00:00:00.000Z'; // 注入固定时钟，便于验证时间不被重置
    deps.now = () => nowIso; // 覆盖依赖时钟
    const { token, userId } = makeUser(); // 直建普通用户
    const first = await request(app).post('/api/v1/me/deletion').set(authHeaders(token));
    expect(first.status).toBe(200); // 首次申请成功
    const scheduledFirst = first.body.deletion_scheduled_at as string; // 记录首次预约时间
    nowIso = '2026-11-25T00:00:00.000Z'; // 时钟前进一天，模拟重复申请跨天
    const second = await request(app).post('/api/v1/me/deletion').set(authHeaders(token));
    expect(second.status).toBe(200); // 重复申请受理
    expect(second.body.deletion_scheduled_at).toBe(scheduledFirst); // 回显既有预约时间，不按新时钟重置
    const row = db.prepare('SELECT deletion_scheduled_at FROM users WHERE id = ?').get(userId) as { deletion_scheduled_at: string | null };
    expect(row.deletion_scheduled_at).toBe(scheduledFirst); // 库内预约时间未被覆盖
  });

  it('POST /me/cancel-deletion 撤销后恢复 active，预约时间清空', async () => {
    const { token, userId } = makeUser(); // 直建普通用户
    await request(app).post('/api/v1/me/deletion').set(authHeaders(token)); // 先申请注销
    const res = await request(app).post('/api/v1/me/cancel-deletion').set(authHeaders(token));
    expect(res.status).toBe(200); // 撤销受理
    expect(res.body.status).toBe('active'); // 状态恢复活跃
    expect(res.body.deletion_scheduled_at).toBeNull(); // 预约时间清空
    const row = db.prepare('SELECT status, deletion_scheduled_at FROM users WHERE id = ?').get(userId) as
      { status: string; deletion_scheduled_at: string | null }; // 回库核对
    expect(row.status).toBe('active'); // 库内状态一致
    expect(row.deletion_scheduled_at).toBeNull(); // 库内预约已清空
  });

  it('active 态撤销幂等：回显当前状态，不写库报错', async () => {
    const { token } = makeUser(); // 直建活跃用户
    const res = await request(app).post('/api/v1/me/cancel-deletion').set(authHeaders(token));
    expect(res.status).toBe(200); // 幂等受理
    expect(res.body.status).toBe('active'); // 回显活跃态
    expect(res.body.deletion_scheduled_at).toBeNull(); // 预约为空
  });
});

describe('到期清理引擎', () => {
  it('到期账号逐域删除 PII；双用户交叉不误删；重复执行 purged=0 幂等', () => {
    const now = new Date().toISOString(); // 统一造数时间
    const expired = makeUser('待删除账号'); // 到期待清理账号 A
    const kept = makeUser('保留账号'); // 对照账号 B
    seedUserData(expired.userId, kept.userId, now); // 为 A 写入各域 PII / 业务行
    // 对照账号 B 也写一行钱包与主题帖，证明清理只命中 A
    db.prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, ?, ?, ?)')
      .run(kept.userId, 3000, 200, now); // B 的钱包
    db.prepare(`INSERT INTO community_threads (id, board_id, author_id, title, kind, status, created_at, updated_at, last_activity_at)
                VALUES ('thread-b', 'board-general', ?, 'B 的主题帖', 'text', 'published', ?, ?, ?)`)
      .run(kept.userId, now, now, now); // B 的主题帖
    markPending(expired.userId, '2026-11-20T00:00:00.000Z'); // A 预约时间已到期
    markPending(kept.userId, '2099-12-31T23:59:59.000Z'); // B 不进入待删除（保持 active 更稳妥：改回活跃）
    db.prepare("UPDATE users SET status = 'active', deletion_scheduled_at = NULL WHERE id = ?").run(kept.userId);

    const first = purgeDueAccounts(db, undefined, { now: new Date() }); // 跑第一轮清理
    expect(first.scanned).toBe(1); // 只扫到 A 一个到期候选
    expect(first.purged).toBe(1); // 本轮回收 A
    // A 的各域残留必须为 0
    expect(countWhere('identities', 'user_id', expired.userId)).toBe(0); // 身份已删
    expect(countWhere('credentials', 'user_id', expired.userId)).toBe(0); // 凭据已删
    expect(countWhere('sessions', 'user_id', expired.userId)).toBe(0); // 会话已删
    expect(countWhere('devices', 'user_id', expired.userId)).toBe(0); // 设备已删
    expect(countWhere('wallets', 'user_id', expired.userId)).toBe(0); // 钱包已删
    expect(countWhere('wallet_transactions', 'user_id', expired.userId)).toBe(0); // 流水已删
    expect(countWhere('checkins', 'user_id', expired.userId)).toBe(0); // 签到已删
    expect(countWhere('community_threads', 'author_id', expired.userId)).toBe(0); // 主题帖已删
    expect(countWhere('community_posts', 'author_id', expired.userId)).toBe(0); // 回复已删
    expect(countWhere('community_thread_likes', 'user_id', expired.userId)).toBe(0); // 点赞已删
    expect(countWhere('community_favorites', 'user_id', expired.userId)).toBe(0); // 收藏已删
    expect(countWhere('community_ratings', 'user_id', expired.userId)).toBe(0); // 评分已删
    expect(countWhere('community_purchases', 'user_id', expired.userId)).toBe(0); // 购买已删
    expect(countWhere('community_thread_views', 'user_id', expired.userId)).toBe(0); // 浏览已删
    expect(countWhere('direct_messages', 'from_user_id', expired.userId)).toBe(0); // 私信已删
    expect(countWhere('community_notifications', 'user_id', expired.userId)).toBe(0); // 通知已删
    expect(countWhere('orders', 'user_id', expired.userId)).toBe(0); // 订单已删
    expect(countWhere('payment_intents', 'user_id', expired.userId)).toBe(0); // 支付意图已删
    expect(countWhere('payment_ext_intents', 'user_id', expired.userId)).toBe(0); // 扩展支付已删
    expect(countWhere('creator_earnings', 'user_id', expired.userId)).toBe(0); // 收益已删
    expect(countWhere('withdrawal_requests', 'user_id', expired.userId)).toBe(0); // 提现已删
    expect(countWhere('realname_records', 'user_id', expired.userId)).toBe(0); // 实名材料已删
    expect(countWhere('invitations', 'created_by', expired.userId)).toBe(0); // 邀请码已删
    expect(countWhere('im_messages', 'sender_user_id', expired.userId)).toBe(0); // IM 消息已删
    expect(countWhere('messages', 'sender_user_id', expired.userId)).toBe(0); // 统一消息已删
    expect(countWhere('content_items', 'author_id', expired.userId)).toBe(0); // 统一内容已删
    expect(countWhere('circle_posts', 'author_id', expired.userId)).toBe(0); // 圈内动态已删
    expect(countWhere('circles', 'owner_id', expired.userId)).toBe(0); // 自有圈子已删
    expect(countWhere('paid_assets', 'author_id', expired.userId)).toBe(0); // 创作资产已删
    expect(countWhere('asset_purchases', 'user_id', expired.userId)).toBe(0); // 资产购买已删
    const expiredRow = db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(expired.userId) as { n: number };
    expect(expiredRow.n).toBe(0); // users 主行已删
    // B 的数据原样保留，证明不误删他人
    const keptRow = db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(kept.userId) as { n: number };
    expect(keptRow.n).toBe(1); // B 主行在
    expect(countWhere('wallets', 'user_id', kept.userId)).toBe(1); // B 钱包在
    expect(countWhere('community_threads', 'author_id', kept.userId)).toBe(1); // B 主题帖在

    const second = purgeDueAccounts(db, undefined, { now: new Date() }); // 第二轮重复执行
    expect(second.scanned).toBe(0); // 无到期候选
    expect(second.purged).toBe(0); // 不重复回收，不报错
  });

  it('事务失败整体回滚：用户行与子表不留半删状态', () => {
    const now = new Date().toISOString(); // 造数时间
    const victim = makeUser('回滚测试账号'); // 待清理账号
    seedUserData(victim.userId, victim.userId, now); // 写入各域数据（自引用避免外键干扰）
    markPending(victim.userId, '2026-11-20T00:00:00.000Z'); // 置为到期待删除
    // 建一张未纳入删除矩阵的引用表，外键指向 users(id)：删 users 行必然违反外键，触发事务回滚
    db.prepare('CREATE TABLE test_purge_fk_ref (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id))').run();
    db.prepare('INSERT INTO test_purge_fk_ref (id, user_id) VALUES (?, ?)').run('fk-ref-1', victim.userId);
    const result = purgeDueAccounts(db, undefined, { now: new Date() }); // 跑清理（内部捕获单账号失败）
    expect(result.purged).toBe(0); // 该账号事务回滚，未被回收
    const victimRow = db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(victim.userId) as { n: number };
    expect(victimRow.n).toBe(1); // users 主行仍在
    expect(countWhere('identities', 'user_id', victim.userId)).toBe(1); // 身份子表仍在（回滚生效）
    expect(countWhere('wallets', 'user_id', victim.userId)).toBe(1); // 钱包子表仍在（回滚生效）
    db.prepare('DROP TABLE test_purge_fk_ref').run(); // 清理临时表，不污染后续断言
  });
});

describe('自助导出 GET /me/export', () => {
  it('覆盖各数据域分组，且不含哈希 / 令牌 / 财务敏感列', async () => {
    const account = await registerTestAccount(app, '13933000001'); // 注册普通账号（自动建身份与凭据）
    const now = new Date().toISOString(); // 造数时间
    db.prepare('INSERT INTO wallets (user_id, balance_cents, points, updated_at) VALUES (?, ?, ?, ?)')
      .run(account.userId, 660, 30, now); // 钱包流水域造数
    db.prepare('INSERT INTO wallet_transactions (id, user_id, kind, amount_cents, points, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('wt-exp', account.userId, 'recharge', 660, 0, '充值', now); // 钱包流水造数
    const res = await request(app).get('/api/v1/me/export').set('Authorization', `Bearer ${account.token}`);
    expect(res.status).toBe(200); // 导出受理
    const body = res.body; // 导出包体
    expect(body.schema).toBe('mim.account-export.v1'); // 包结构版本号
    expect(body.profile.id).toBe(account.userId); // 资料回包本人主键
    const sectionKeys = (body.sections as Array<{ key: string }>).map((s) => s.key); // 分组键集合
    expect(sectionKeys).toContain('identities'); // 身份分组在
    expect(sectionKeys).toContain('wallets'); // 钱包分组在
    expect(sectionKeys).toContain('wallet_transactions'); // 流水分组在
    expect(sectionKeys).toContain('community_threads'); // 社区分组在
    expect(sectionKeys).toContain('orders'); // 订单分组在
    const raw = JSON.stringify(body); // 整包序列化后做敏感列扫描
    expect(raw).not.toContain('secret_hash'); // 不带口令哈希列
    expect(raw).not.toContain('refresh_token_hash'); // 不带会话刷新哈希列
    expect(raw).not.toContain('account_name'); // 不带提现账户名
    expect(raw).not.toContain('account_no'); // 不带提现账号
    expect(raw).not.toContain('name_hash'); // 不带实名姓名哈希
    expect(raw).not.toContain('id_hash'); // 不带实名证件哈希
  });

  it('附件文件名与 Content-Disposition 头按契约生成', async () => {
    const account = await registerTestAccount(app, '13933000002'); // 注册普通账号
    const res = await request(app).get('/api/v1/me/export').set('Authorization', `Bearer ${account.token}`);
    expect(res.status).toBe(200); // 导出受理
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8'); // JSON 文本类型
    const disposition = res.headers['content-disposition'] as string; // 附件响应头
    expect(disposition).toMatch(/^attachment; filename="mim-data-\d+-\d{8}\.json"$/); // 文件名口径 mim-data-<号码>-<YYYYMMDD>.json
  });

  it('待删除态账号仍可访问导出（白名单放行）', async () => {
    const { token, userId } = makeUser(); // 直建普通用户
    markPending(userId, '2099-12-31T23:59:59.000Z'); // 置为待删除态
    const res = await request(app).get('/api/v1/me/export').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200); // 白名单放行，待删除态可导出本人数据
  });
});

describe('管理端注销队列与手动清理（RBAC）', () => {
  it('GET /admin/deletions 回队列剩余时间、逾期标记与策略；匿名 401、无权限 403', async () => {
    const future = makeUser('未到期账号'); // 预约在未来
    const overdue = makeUser('已到期账号'); // 预约已到期
    markPending(future.userId, new Date(Date.now() + 3600_000).toISOString()); // 1 小时后到期
    markPending(overdue.userId, new Date(Date.now() - 3600_000).toISOString()); // 1 小时前到期

    const anon = await request(app).get('/api/v1/admin/deletions'); // 匿名访问
    expect(anon.status).toBe(401); // 未登录 401

    const plain = await registerTestAccount(app, '13933000003'); // 普通登录用户，无后台角色
    const forbidden = await request(app).get('/api/v1/admin/deletions').set('Authorization', `Bearer ${plain.token}`);
    expect(forbidden.status).toBe(403); // 无 user:read 权限 403

    const res = await request(app).get('/api/v1/admin/deletions').set(adminHeaders()); // 引导超管
    expect(res.status).toBe(200); // 授权可读
    expect(res.body.total).toBe(2); // 队列总数 2
    expect(res.body.items).toHaveLength(2); // 列表两条
    const futureItem = res.body.items.find((i: { user_id: string }) => i.user_id === future.userId); // 未到期项
    const overdueItem = res.body.items.find((i: { user_id: string }) => i.user_id === overdue.userId); // 已到期项
    expect(futureItem.overdue).toBe(false); // 未到期标记为 false
    expect(futureItem.remaining_seconds).toBeGreaterThan(0); // 剩余秒数为正
    expect(overdueItem.overdue).toBe(true); // 已到期标记为 true
    expect(overdueItem.remaining_seconds).toBe(0); // 到期后剩余秒数钳到 0
    expect(res.body.policy.auto_purge_enabled).toBe(true); // 调度总开关默认开
    expect(res.body.policy.grace_days).toBe(7); // 策略冷静期 7 天
    expect(res.body.policy.sweep_minutes).toBe(60); // 扫描间隔缺省 60 分钟
    expect(res.body.policy.batch_size).toBe(50); // 批量上限缺省 50
    expect(res.body.last_run.at).toBeNull(); // 尚无历史批次时留痕为空
  });

  it('POST /admin/deletions/run 手动触发清理，写 privacy.account_purge 审计并回传 audit_id', async () => {
    const expired = makeUser('手动清理账号'); // 到期待清理账号
    markPending(expired.userId, '2026-11-20T00:00:00.000Z'); // 已到期
    const res = await request(app).post('/api/v1/admin/deletions/run').set(adminHeaders());
    expect(res.status).toBe(200); // 授权触发
    expect(res.body.scanned).toBe(1); // 扫描候选 1
    expect(res.body.purged).toBe(1); // 回收 1
    expect(typeof res.body.audit_id).toBe('string'); // 回传审计主键
    const audits = auditRows('privacy.account_purge'); // 回读清理批次审计
    expect(audits).toHaveLength(1); // 留一条痕
    expect(audits[0].result).toBe('success'); // 结果成功
    const payload = JSON.parse(audits[0].payload ?? '{}') as { source: string; ids_sha256: string[]; scanned: number; purged: number };
    expect(payload.source).toBe('manual'); // 触发来源标记手动
    expect(payload.scanned).toBe(1); // 明细候选数一致
    expect(payload.purged).toBe(1); // 明细回收数一致
    expect(payload.ids_sha256).toHaveLength(1); // 已删 id 摘要集合 1 条
    expect(payload.ids_sha256[0]).toHaveLength(8); // 摘要只存 sha256 前 8 位
  });

  it('普通登录用户手动触发 → 403 FORBIDDEN；匿名 → 401', async () => {
    const plain = await registerTestAccount(app, '13933000004'); // 普通用户
    const forbidden = await request(app).post('/api/v1/admin/deletions/run').set('Authorization', `Bearer ${plain.token}`);
    expect(forbidden.status).toBe(403); // 无 privacy:write 权限 403
    expect(forbidden.body.code).toBe('FORBIDDEN'); // 权限不足错误码
    const anon = await request(app).post('/api/v1/admin/deletions/run'); // 匿名
    expect(anon.status).toBe(401); // 未登录 401
  });
});
