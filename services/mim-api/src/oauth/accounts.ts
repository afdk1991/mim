/**
 * 第三方身份绑定与账号创建。
 *
 * 与 routes/auth.ts 的分工：
 *   - 本模块只处理 oauth_accounts / oauth_login_tickets 两张表与 users 建号；
 *   - 路由负责 HTTP 参数、state 校验与响应形状。
 * 这样「同一个人用微信和 GitHub 各登一次」的绑定规则只有一处实现。
 */

import { randomBytes } from 'node:crypto'; // 生成不可预测的一次性登录票据
import { AppError, uuidv7 } from '@mim/core-domain'; // 统一异常与主键
import { OAUTH_TICKET_TTL_SECONDS } from '../config.js'; // 票据有效期
import { createUser, readUser } from '../identity.js'; // 统一建号（自动分配 Mim ID）
import { sha256 } from '../auth.js'; // 票据只存摘要
import type { Db, Region, UserRow } from '../types.js'; // 数据层类型
import type { OAuthProfile, OAuthProviderSpec } from './providers.js'; // 统一资料与 provider 定义

/** oauth_accounts 行的最小视图 */
export interface OAuthAccountRow { // 仅列调用方需要的字段
  id: string; // 绑定记录主键
  user_id: string; // 归属用户
  provider: string; // 提供方
  provider_user_id: string; // 提供方用户 ID
  union_id: string | null; // 跨应用统一 ID
  nickname: string; // 昵称
  avatar_url: string | null; // 头像
  email: string | null; // 邮箱
  created_at: string; // 首次绑定时间
  updated_at: string; // 最近更新时间
} // OAuthAccountRow 结束

/** 按「提供方 + 提供方用户 ID」查绑定；这是唯一键，最多一行 */
export function findOAuthAccount(db: Db, provider: string, providerUserId: string): OAuthAccountRow | undefined { // 登录入口使用
  return db // 查询起点
    .prepare('SELECT * FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?') // 唯一键查询
    .get(provider, providerUserId) as OAuthAccountRow | undefined; // 单行或 undefined
} // findOAuthAccount 结束

/** 按 unionId 查绑定：微信 / 抖音同一人可能换 openid，unionid 仍应指向同一账号 */
export function findOAuthAccountByUnion(db: Db, provider: string, unionId: string): OAuthAccountRow | undefined { // 防止同人两号
  return db // 查询起点
    .prepare('SELECT * FROM oauth_accounts WHERE provider = ? AND union_id = ?') // unionid 唯一索引
    .get(provider, unionId) as OAuthAccountRow | undefined; // 单行或 undefined
} // findOAuthAccountByUnion 结束

/** 列出某用户已绑定的第三方身份（个人中心展示，不含原始资料） */
export function listOAuthAccounts(db: Db, userId: string): Array<Pick<OAuthAccountRow, 'provider' | 'nickname' | 'avatar_url' | 'email' | 'created_at'>> { // 只暴露展示字段
  return db // 查询起点
    .prepare('SELECT provider, nickname, avatar_url, email, created_at FROM oauth_accounts WHERE user_id = ? ORDER BY created_at ASC') // 按绑定时间排序
    .all(userId) as Array<Pick<OAuthAccountRow, 'provider' | 'nickname' | 'avatar_url' | 'email' | 'created_at'>>; // 类型断言贴合查询列
} // listOAuthAccounts 结束

/** 写入或刷新绑定：同一 (provider, provider_user_id) 重复授权时只更新资料，不产生第二行 */
export function upsertOAuthAccount(
  db: Db, // 对象字段 db：记录一项配置或数据
  userId: string, // 对象字段 userId：记录一项配置或数据
  spec: OAuthProviderSpec, // 对象字段 spec：记录一项配置或数据
  profile: OAuthProfile, // 对象字段 profile：记录一项配置或数据
  now: string, // 对象字段 now：记录一项配置或数据
): void { // 执行当前业务步骤
  const existing = findOAuthAccount(db, spec.id, profile.providerUserId); // 先查是否已绑定
  if (existing) { // 已绑定分支
    if (existing.user_id !== userId) { // 属于其他账号
      throw new AppError('AUTH_OAUTH_ALREADY_BOUND', 'this provider account is already linked to another user', { provider: spec.id }); // 409 提示先解绑
    } // 归属校验结束
    db.prepare( // 同账号重复授权：刷新昵称 / 头像 / 邮箱与更新时间
      `UPDATE oauth_accounts
       SET union_id = COALESCE(?, union_id), nickname = ?, avatar_url = ?, email = ?, raw_profile = ?, updated_at = ?
       WHERE id = ?`,
    ).run( // 绑定参数
      profile.unionId ?? null, // 新 unionid 为空时保留旧值
      profile.nickname, // 昵称
      profile.avatarUrl ?? null, // 头像
      profile.email ?? null, // 邮箱
      JSON.stringify(profile.raw), // 原始快照
      now, // 更新时间
      existing.id, // 目标行
    ); // 结束执行
    return; // 刷新后直接返回
  } // 已绑定分支结束

  // 未绑定：若 unionid 已属于别的账号，同样拒绝（防止同人开出第二个 Mim 账号）
  if (profile.unionId) { // 只有返回 unionid 的提供方才检查
    const byUnion = findOAuthAccountByUnion(db, spec.id, profile.unionId); // 按 unionid 查
    if (byUnion && byUnion.user_id !== userId) throw new AppError('AUTH_OAUTH_ALREADY_BOUND', 'this provider union id is already linked to another user', { provider: spec.id }); // 409
  } // union 校验结束

  db.prepare( // 插入新绑定
    `INSERT INTO oauth_accounts
     (id, user_id, provider, provider_user_id, union_id, nickname, avatar_url, email, raw_profile, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run( // 绑定参数
    uuidv7(), // 绑定主键
    userId, // 归属用户
    spec.id, // 提供方
    profile.providerUserId, // 提供方用户 ID
    profile.unionId ?? null, // unionid 联合标识
    profile.nickname, // 昵称
    profile.avatarUrl ?? null, // 头像
    profile.email ?? null, // 邮箱
    JSON.stringify(profile.raw), // 原始快照
    now, // 创建时间
    now, // 更新时间
  ); // 结束执行
} // upsertOAuthAccount 结束

/**
 * 首次第三方登录建号：用户、绑定记录在同一事务内完成。
 * 展示名优先用提供方昵称，没有则留空待用户完善。
 */
export function createUserFromOAuth(
  db: Db, // 对象字段 db：记录一项配置或数据
  spec: OAuthProviderSpec, // 对象字段 spec：记录一项配置或数据
  profile: OAuthProfile, // 对象字段 profile：记录一项配置或数据
  region: Region, // 对象字段 region：记录一项配置或数据
  now: string, // 对象字段 now：记录一项配置或数据
): UserRow { // 执行当前业务步骤
  return db.transaction(() => { // 建号与绑定必须同生共死
    const user = createUser(db, { region, display_name: profile.nickname, now }); // 自动分配 Mim ID 号码
    upsertOAuthAccount(db, user.id, spec, profile, now); // 写入绑定
    return user; // 交出含号码的新用户
  })(); // 执行事务
} // createUserFromOAuth 结束

/** 统计用户的可用登录方式数量（可选排除某提供方），用于解绑前的兜底校验 */
export function countLoginMethods(db: Db, userId: string, excludeProvider?: string): number { // 三种方式合计
  const identityCount = (db.prepare('SELECT COUNT(*) AS n FROM identities WHERE user_id = ?').get(userId) as { n: number }).n; // 手机/邮箱身份
  const passwordCount = (db.prepare("SELECT COUNT(*) AS n FROM credentials WHERE user_id = ? AND kind = 'password'").get(userId) as { n: number }).n; // 自建口令
  const oauthCount = (db.prepare('SELECT COUNT(*) AS n FROM oauth_accounts WHERE user_id = ? AND provider != ?').get(userId, excludeProvider ?? '') as { n: number }).n; // 其它第三方
  return identityCount + passwordCount + oauthCount; // 合计可用方式
} // countLoginMethods 结束

/** 解绑：至少保留一种可用登录方式，避免把账号锁死 */
export function unlinkOAuthAccount(db: Db, userId: string, provider: string): boolean { // 返回是否真的删除了绑定
  const exists = db.prepare('SELECT id FROM oauth_accounts WHERE user_id = ? AND provider = ?').get(userId, provider) as { id: string } | undefined; // 先确认已绑定
  if (!exists) return false; // 未绑定视为幂等成功
  if (countLoginMethods(db, userId, provider) === 0) { // 解绑后没有任何登录方式
    throw new AppError('AUTH_OAUTH_LAST_METHOD', 'cannot unlink the last sign-in method', { provider }); // 拒绝，防止账号无法再登录
  } // 兜底校验结束
  db.prepare('DELETE FROM oauth_accounts WHERE user_id = ? AND provider = ?').run(userId, provider); // 删除绑定
  return true; // 告知调用方已删除
} // unlinkOAuthAccount 结束

/** 签发一次性登录票据：后端回调 302 回前端时只带票据，正式令牌由前端再换 */
export function issueLoginTicket(db: Db, userId: string, now: string): string { // 返回明文票据（仅此一次）
  const ticket = randomBytes(32).toString('base64url'); // 32 字节熵，不可预测
  const expiresAt = new Date(Date.parse(now) + OAUTH_TICKET_TTL_SECONDS * 1000).toISOString(); // 相对注入时钟计算，测试可冻结
  db.prepare('INSERT INTO oauth_login_tickets (ticket_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(sha256(ticket), userId, now, expiresAt); // 只存摘要
  return ticket; // 明文交给重定向地址
} // issueLoginTicket 结束

/** 消费票据：一次性、限时，返回归属用户；无效返回 null */
export function consumeLoginTicket(db: Db, ticket: string, now: string): string | null { // 路由兑换令牌时调用
  const row = db.prepare('SELECT user_id, expires_at, consumed_at FROM oauth_login_tickets WHERE ticket_hash = ?').get(sha256(ticket)) as // 按摘要查
    | { user_id: string; expires_at: string; consumed_at: string | null } // 命中
    | undefined; // 未命中
  if (!row || row.consumed_at || Date.parse(row.expires_at) <= Date.parse(now)) return null; // 不存在 / 已用 / 过期统一拒绝
  db.prepare('UPDATE oauth_login_tickets SET consumed_at = ? WHERE ticket_hash = ?').run(now, sha256(ticket)); // 标记消费
  return row.user_id; // 交出归属用户
} // consumeLoginTicket 结束

/** 读取票据归属用户（兑换后仍需读用户行） */
export function readTicketUser(db: Db, userId: string): UserRow | undefined { // 复用 identity 的读取
  return readUser(db, userId); // 单行读取
} // readTicketUser 结束
