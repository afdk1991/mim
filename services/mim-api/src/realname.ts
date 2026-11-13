/**
 * 实名认证（人工审核）数据层。
 *
 * 脱敏约定（合规硬约束）：
 *   - 姓名、证件号只写 HMAC-SHA256 摘要，库内不存在明文列；
 *   - 对外只回显脱敏名（张**）与证件号后四位，不回传完整证件信息；
 *   - 未接入第三方核验服务时 provider='manual'，全部记录走人工审核队列。
 */

import { createHmac } from 'node:crypto'; // 摘要用 HMAC，避免裸 sha256 被彩虹表反推
import { AppError, uuidv7 } from '@mim/core-domain'; // 统一异常与主键
import type { Db } from './types.js'; // 数据库句柄类型

/** 证件类型与审核状态，与 schema.d 约束保持一致 */
export type RealnameIdType = 'id_card' | 'passport' | 'other';
export type RealnameStatus = 'pending' | 'approved' | 'rejected'; // 导出类型 RealnameStatus：跨模块共享的类型定义
export type RealnameProvider = 'manual' | 'third_party'; // 导出类型 RealnameProvider：跨模块共享的类型定义

/** 提交入参：原始姓名与证件号只在内存中参与哈希，不落库 */
export interface RealnameSubmitInput {
  idType: RealnameIdType; // 证件类型
  name: string; // 真实姓名（明文仅本次请求内存存在）
  idNumber: string; // 证件号（明文仅本次请求内存存在）
} // RealnameSubmitInput 结束

/** 对外视图：不含任何明文证件字段 */
export interface RealnameView {
  id: string; // 记录主键
  status: RealnameStatus; // 审核状态
  provider: RealnameProvider; // 审核通道
  id_type: RealnameIdType; // 证件类型
  name_masked: string; // 脱敏展示名
  id_last4: string; // 证件号后四位
  reject_reason: string | null; // 驳回原因
  reviewed_at: string | null; // 审核时间
  created_at: string; // 提交时间
} // RealnameView 结束

/** 姓名格式：2~30 位中文 / 字母 / 间隔号，容忍中间空格 */
const NAME_RE = /^[一-龥A-Za-z·•]{2,30}$/; // 轻量校验，不在此做户籍级核验

/** 证件号格式按类型区分：身份证 15/18 位，护照等 5~17 位字母数字 */
function isValidIdNumber(idType: RealnameIdType, value: string): boolean { // 类型化校验
  if (idType === 'id_card') return /^\d{15}$|^\d{17}[\dXx]$/.test(value); // 老 15 位 / 新 18 位
  if (idType === 'passport') return /^[A-Za-z0-9]{5,17}$/.test(value); // 护照 / 旅行证
  return /^[A-Za-z0-9]{4,32}$/.test(value); // 其他证件宽松校验
} // isValidIdNumber 结束

/** HMAC 摘要：密钥来自注入机密，输出十六进制 */
function hmac(secret: string, value: string): string { // 统一摘要口径
  return createHmac('sha256', secret).update(value).digest('hex'); // 十六进制摘要
} // hmac 结束

/** 姓名脱敏：保留首字符，其余以 * 替代（如 张** / 王*） */
export function maskName(name: string): string { // 纯函数便于测试复用
  const trimmed = name.trim(); // 去首尾空白
  if (trimmed.length <= 1) return trimmed; // 单字符不打码（异常输入由校验层拦截）
  return `${trimmed[0]}${'*'.repeat(Math.max(1, trimmed.length - 1))}`; // 首字 + 星号
} // maskName 结束

/** 归一化证件号：去空白、大写，便于同号比对 */
function normalizeId(value: string): string { // 比对与哈希同口径
  return value.replace(/\s+/g, '').toUpperCase(); // 去空格并大写
} // normalizeId 结束

/** 校验提交格式；非法直接抛 REALNAME_INVALID */
function validate(input: RealnameSubmitInput): { name: string; idNumber: string } { // 归一化后交出
  const name = input.name.trim(); // 姓名去空白
  const idNumber = normalizeId(input.idNumber); // 证件号归一
  if (!NAME_RE.test(name)) throw new AppError('REALNAME_INVALID', 'invalid real name', { field: 'name' }); // 姓名非法
  if (!isValidIdNumber(input.idType, idNumber)) { // 证件号非法
    throw new AppError('REALNAME_INVALID', 'invalid id number', { field: 'id_number' }); // 统一错误码
  } // 校验结束
  return { name, idNumber }; // 交出归一化值
} // validate 结束

/** 读某用户的实名记录行 */
function findRecord(db: Db, userId: string): Record<string, unknown> | undefined { // 单行查询
  return db.prepare('SELECT * FROM realname_records WHERE user_id = ?').get(userId) as Record<string, unknown> | undefined; // 未命中为 undefined
} // findRecord 结束

/** 库行 → 对外视图（字段白名单，杜绝漏出哈希列） */
function toView(row: Record<string, unknown>): RealnameView { // 只挑展示字段
  return { // 视图对象
    id: String(row.id), // 记录主键
    status: row.status as RealnameStatus, // 审核状态
    provider: row.provider as RealnameProvider, // 审核通道
    id_type: row.id_type as RealnameIdType, // 证件类型
    name_masked: String(row.name_masked ?? ''), // 脱敏名
    id_last4: String(row.id_last4 ?? ''), // 后四位
    reject_reason: (row.reject_reason as string | null) ?? null, // 驳回原因
    reviewed_at: (row.reviewed_at as string | null) ?? null, // 审核时间
    created_at: String(row.created_at), // 提交时间
  }; // 返回结束
} // toView 结束

/** 判断审核通道：env 显式 third_party 才标记第三方，其余一律 manual */
export function providerOf(env: Record<string, string | undefined>): RealnameProvider { // 读取配置
  return (env.MIM_REALNAME_PROVIDER ?? '').trim() === 'third_party' ? 'third_party' : 'manual'; // 默认人工
} // providerOf 结束

/**
 * 提交实名：新建待审；已通过 / 待审拒绝重复提交；驳回后允许重新提交（同行更新）。
 * 明文姓名与证件号仅在本函数内存中参与哈希与脱敏，写完即弃。
 */
export function submitRealname(
  db: Db, // 对象字段 db：记录一项配置或数据
  secret: string, // 对象字段 secret：记录一项配置或数据
  env: Record<string, string | undefined>, // 对象字段 env：记录一项配置或数据
  userId: string, // 对象字段 userId：记录一项配置或数据
  input: RealnameSubmitInput, // 对象字段 input：记录一项配置或数据
  now: string, // 对象字段 now：记录一项配置或数据
): RealnameView { // 执行当前业务步骤
  const { name, idNumber } = validate(input); // 格式校验 + 归一化
  const existing = findRecord(db, userId); // 查既有记录
  if (existing && (existing.status === 'pending' || existing.status === 'approved')) { // 待审或已通过不可重复提交
    throw new AppError('REALNAME_ALREADY_SUBMITTED', 'realname submission already exists', { status: existing.status }); // 409
  } // 重复提交判定结束

  const nameHash = hmac(secret, `name:${name}`); // 姓名摘要
  const idHash = hmac(secret, `id:${idNumber}`); // 证件号摘要
  const idLast4 = idNumber.slice(-4); // 只留后四位
  const masked = maskName(name); // 脱敏展示名
  const provider = providerOf(env); // 审核通道

  if (existing) { // 驳回后重新提交：同行回到待审，清空审核结论
    db.prepare( // 更新语句
      `UPDATE realname_records
       SET id_type = ?, name_hash = ?, name_masked = ?, id_hash = ?, id_last4 = ?,
           provider = ?, status = 'pending', reject_reason = NULL, reviewed_by = NULL, reviewed_at = NULL, updated_at = ?
       WHERE id = ?`,
    ).run( // 绑定参数
      input.idType, nameHash, masked, idHash, idLast4, provider, now, String(existing.id), // 新摘要与脱敏片段
    ); // 结束执行
    return toView(findRecord(db, userId)!); // 回读视图
  } // 重新提交分支结束

  const id = uuidv7(); // 新记录主键
  db.prepare( // 插入语句
    `INSERT INTO realname_records
       (id, user_id, id_type, name_hash, name_masked, id_hash, id_last4, provider, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).run( // 绑定参数
    id, userId, input.idType, nameHash, masked, idHash, idLast4, provider, now, now, // 只写摘要与脱敏片段
  ); // 结束执行
  return toView(findRecord(db, userId)!); // 回读视图
} // submitRealname 结束

/** 查询本人实名状态；未提交返回 null（不抛 404，便于前端区分表单态） */
export function getMyRealname(db: Db, userId: string): RealnameView | null { // 只读
  const row = findRecord(db, userId); // 查记录
  return row ? toView(row) : null; // 视图或空
} // getMyRealname 结束

/** 管理端待审队列：按提交时间升序，先到先审 */
export function listPendingRealnames(db: Db, limit = 50): Array<RealnameView & { user_id: string }> { // 队列条目带归属用户
  const rows = db // 查询起点
    .prepare( // 预编译队列语句
      `SELECT id, user_id, id_type, name_masked, id_last4, provider, status, reject_reason, reviewed_at, created_at
         FROM realname_records WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`, // 先到先审
    ) // prepare 结束
    .all(limit) as Array<Record<string, unknown>>; // 行集合
  return rows.map((row) => ({ ...toView(row), user_id: String(row.user_id) })); // 补 user_id 后映射视图
} // listPendingRealnames 结束

/** 管理端审核：通过 / 驳回；驳回必须带原因 */
export function reviewRealname(
  db: Db, // 对象字段 db：记录一项配置或数据
  recordId: string, // 对象字段 recordId：记录一项配置或数据
  decision: 'approve' | 'reject', // 对象字段 decision：记录一项配置或数据
  reason: string | null, // 对象字段 reason：记录一项配置或数据
  reviewerId: string, // 对象字段 reviewerId：记录一项配置或数据
  now: string, // 对象字段 now：记录一项配置或数据
): RealnameView { // 执行当前业务步骤
  const row = db.prepare('SELECT * FROM realname_records WHERE id = ?').get(recordId) as Record<string, unknown> | undefined; // 按主键查
  if (!row) throw new AppError('REALNAME_NOT_FOUND', 'realname record not found', { id: recordId }); // 不存在
  if (row.status !== 'pending') throw new AppError('CONFLICT', 'realname record is not pending', { status: row.status }); // 非待审不可改判
  if (decision === 'reject' && !(reason ?? '').trim()) { // 驳回必须写明原因
    throw new AppError('VALIDATION_FAILED', 'reject reason is required', { field: 'reason' }); // 400
  } // 驳回原因校验结束
  const status: RealnameStatus = decision === 'approve' ? 'approved' : 'rejected'; // 目标状态
  db.prepare( // 更新审核结论
    `UPDATE realname_records
       SET status = ?, reject_reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(status, decision === 'reject' ? reason!.trim() : null, reviewerId, now, now, recordId); // 绑定参数
  return toView(db.prepare('SELECT * FROM realname_records WHERE id = ?').get(recordId) as Record<string, unknown>); // 回读视图
} // reviewRealname 结束
