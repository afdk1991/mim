/**
 * 邀请码：生成 / 禁用 / 统计 / 核销数据层。
 *
 * 并发语义：核销走条件 UPDATE（`used_count < max_uses` 且 status='active' 且未过期），
 * 命中行数为 1 才写核销记录；与建号在同一事务内完成，任一失败整体回滚，不会超发。
 */

import { randomBytes } from 'node:crypto'; // 邀请码随机字符
import { AppError, uuidv7 } from '@mim/core-domain'; // 统一异常与主键
import type { Db } from './types.js'; // 数据库句柄

/** 注册门槛是否开启：仅显式 =1 才拦截，缺省 / 其他值一律保持现状放行 */
export function isInviteRequired(env: Record<string, string | undefined>): boolean { // 读开关
  return (env.MIM_REGISTER_INVITE_REQUIRED ?? '').trim() === '1'; // 默认 0：不破坏已上线注册
} // isInviteRequired 结束

/** 邀请码字符集：去除易混字符（0/O、1/I/L），便于口头传递 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 个字符

/** 生成一枚 8 位邀请码（大写） */
export function generateInviteCode(): string { // 纯函数便于测试固定注入
  const bytes = randomBytes(8); // 8 字节熵
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join(''); // 映射到字符集
} // generateInviteCode 结束

/** 建码入参 */
export interface CreateInviteInput {
  createdBy: string | null; // 创建人用户 ID；系统生成可空
  maxUses: number; // 可用次数，≥1
  expiresAt: string | null; // 过期时间 ISO；null 长期有效
  boundIdentifier: string | null; // 绑定归一化手机 / 邮箱；null 不限制
  note: string | null; // 备注
  code?: string; // 测试可固定码，缺省随机
} // CreateInviteInput 结束

/** 创建一枚邀请码；返回落库行 */
export function createInvite(db: Db, input: CreateInviteInput, now: string): InviteRow { // 单行创建
  const code = (input.code ?? generateInviteCode()).toUpperCase(); // 统一大写存储
  const id = uuidv7(); // 主键
  db.prepare( // 插入语句
    `INSERT INTO invitations (id, code, created_by, max_uses, used_count, expires_at, bound_identifier, status, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, 'active', ?, ?, ?)`,
  ).run( // 绑定参数
    id, code, input.createdBy, input.maxUses, input.expiresAt, input.boundIdentifier, input.note, now, now, // 初始计数 0
  ); // 结束执行
  return getInviteByCode(db, code)!; // 回读
} // createInvite 结束

/** 邀请码行视图 */
export interface InviteRow {
  id: string; // 主键
  code: string; // 邀请码
  created_by: string | null; // 创建人
  max_uses: number; // 可用次数
  used_count: number; // 已用次数
  expires_at: string | null; // 过期时间
  bound_identifier: string | null; // 绑定标识
  status: 'active' | 'disabled' | 'exhausted'; // 状态
  note: string | null; // 备注
  created_at: string; // 创建时间
  last_used_at: string | null; // 最近核销时间
} // InviteRow 结束

/** 按码查行（大小写不敏感） */
export function getInviteByCode(db: Db, code: string): InviteRow | undefined { // 单行
  return db.prepare('SELECT * FROM invitations WHERE UPPER(code) = UPPER(?)').get(code.trim()) as InviteRow | undefined; // 归一比对
} // getInviteByCode 结束

/** 列出全部邀请码（管理端），按创建时间倒序 */
export function listInvitations(db: Db): InviteRow[] { // 只读列表
  return db.prepare('SELECT * FROM invitations ORDER BY created_at DESC').all() as InviteRow[]; // 全量回读
} // listInvitations 结束

/** 核销记录行 */
export interface RedemptionRow {
  id: string; // 核销记录主键
  invitation_id: string; // 邀请码主键
  code: string; // 冗余邀请码便于列表展示
  user_id: string; // 注册用户
  identifier: string | null; // 归一化注册标识
  created_at: string; // 核销时间
} // RedemptionRow 结束

/** 查询核销记录；可按邀请码过滤 */
export function listRedemptions(db: Db, code?: string): RedemptionRow[] { // 只读
  if (code) { // 按码过滤分支
    return db // 查询起点
      .prepare( // 联表取冗余码
        `SELECT r.id, r.invitation_id, i.code, r.user_id, r.identifier, r.created_at
           FROM invitation_redemptions r JOIN invitations i ON i.id = r.invitation_id
          WHERE UPPER(i.code) = UPPER(?) ORDER BY r.created_at DESC`,
      ) // prepare 结束
      .all(code.trim()) as RedemptionRow[]; // 过滤结果
  } // 过滤分支结束
  return db // 全量核销记录
    .prepare( // 联表取冗余码
      `SELECT r.id, r.invitation_id, i.code, r.user_id, r.identifier, r.created_at
         FROM invitation_redemptions r JOIN invitations i ON i.id = r.invitation_id
        ORDER BY r.created_at DESC`,
    ) // prepare 结束
    .all() as RedemptionRow[]; // 全量结果
} // listRedemptions 结束

/** 汇总统计：码量 / 活跃 / 已核销次数 */
export function invitationStats(db: Db): { total: number; active: number; redemptions: number } { // 聚合只读
  const total = (db.prepare('SELECT COUNT(*) AS n FROM invitations').get() as { n: number }).n; // 码总量
  const active = (db.prepare("SELECT COUNT(*) AS n FROM invitations WHERE status = 'active'").get() as { n: number }).n; // 活跃码
  const redemptions = (db.prepare('SELECT COUNT(*) AS n FROM invitation_redemptions').get() as { n: number }).n; // 总核销
  return { total, active, redemptions }; // 交出统计
} // invitationStats 结束

/** 禁用一枚邀请码：幂等，已禁用 / 耗尽也可再次置为 disabled */
export function disableInvite(db: Db, code: string): boolean { // 返回是否命中存在的码
  const row = getInviteByCode(db, code); // 先查存在性
  if (!row) return false; // 不存在返回 false，路由据此 404
  db.prepare("UPDATE invitations SET status = 'disabled', updated_at = ? WHERE id = ?").run(new Date().toISOString(), row.id); // 置禁用
  return true; // 命中并更新
} // disableInvite 结束

/** 把拒绝原因归类到明确错误码 */
function rejectForRow(row: InviteRow | undefined, now: string): never { // 统一抛错出口
  if (!row) throw new AppError('AUTH_INVITE_INVALID', 'invitation code is invalid'); // 不存在
  if (row.status === 'disabled') throw new AppError('AUTH_INVITE_INVALID', 'invitation code is disabled', { code: row.code }); // 已禁用
  if (row.expires_at && Date.parse(row.expires_at) <= Date.parse(now)) { // 过期判定
    throw new AppError('AUTH_INVITE_EXPIRED', 'invitation code has expired', { code: row.code }); // 过期单独码
  } // 过期结束
  if (row.used_count >= row.max_uses) { // 次数耗尽
    throw new AppError('AUTH_INVITE_INVALID', 'invitation code has exhausted', { code: row.code }); // 耗尽归无效
  } // 耗尽结束
  throw new AppError('AUTH_INVITE_INVALID', 'invitation code is not usable'); // 兜底
} // rejectForRow 结束

/**
 * 核销邀请码：必须在建号事务内调用（拿到新用户 ID 后）。
 * 条件 UPDATE 保证并发下不超发；失败抛明确错误码，事务随之回滚。
 */
export function redeemInvite(
  db: Db,
  code: string | undefined, // 请求体传入的码
  identifier: string | null, // 归一化注册标识（绑定码核对用）
  userId: string, // 本次注册的新用户
  now: string,
): void {
  const trimmed = (code ?? '').trim(); // 去空白
  if (!trimmed) throw new AppError('AUTH_INVITE_REQUIRED', 'invitation code is required'); // 缺码走门槛码
  const row = getInviteByCode(db, trimmed); // 查码
  if (!row) rejectForRow(row, now); // 不存在
  if (row.bound_identifier && identifier && row.bound_identifier !== identifier) { // 绑定身份不匹配
    throw new AppError('AUTH_INVITE_INVALID', 'invitation code is bound to another identifier', { code: row.code }); // 400
  } // 绑定校验结束

  const result = db // 条件核销：活跃 + 有余量 + 未过期才扣减
    .prepare( // 预编译原子扣减语句
      `UPDATE invitations
         SET used_count = used_count + 1,
             last_used_at = ?,
             status = CASE WHEN used_count + 1 >= max_uses THEN 'exhausted' ELSE status END,
             updated_at = ?
       WHERE id = ? AND status = 'active' AND used_count < max_uses
         AND (expires_at IS NULL OR expires_at > ?)`, // 三重可用性条件
    ) // prepare 结束
    .run(now, now, row.id, now); // 绑定时间与主键
  if (result.changes !== 1) rejectForRow(getInviteByCode(db, row.code), now); // 并发被抢走 / 状态变化，归类拒绝

  db.prepare( // 写核销记录
    'INSERT INTO invitation_redemptions (id, invitation_id, user_id, identifier, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(uuidv7(), row.id, userId, identifier, now); // 绑定参数
} // redeemInvite 结束
