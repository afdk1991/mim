/* ==========================================================================
 * 身份域本机存储 —— 实名 / 认证 / 隐私 / 青少年模式 / 黑名单
 *
 * 键名：mim.identity.<uid>.<field>（按身份隔离，注销时整体清除）
 *
 * 红线：
 *  1. 完整身份证号不得落盘 —— 只存 maskIdCard() 的脱敏值。
 *  2. 所有读取必须带 parse，脏数据回退默认值而非强转，避免半损坏状态白屏。
 * ======================================================================== */

import { emit, EVT } from '../../core/events'
import { asRecord, asString, asStringArray, purgeUid, readJson, removeKey, userKey, writeJson } from '../../core/storage'
import { currentUid } from '../../data/session'
import {
  DEFAULT_PRIVACY,
  type PostVisibility,
  type PrivacyPolicy,
  type PrivacyState,
  type RealNameState,
  type TeenState,
  type VerifyLevel,
  type VerifyState,
} from '../../domain/identity/model'

const SCOPE = 'identity'

const FIELD = {
  realname: 'realname',
  verify: 'verify',
  privacy: 'privacy',
  teen: 'teen',
  blacklist: 'blacklist',
} as const

function key(field: string): string {
  return userKey(SCOPE, currentUid(), field)
}

/* ---------- 实名 ---------- */

/** 只认脱敏值：历史脏数据里若出现完整号段，直接判为非法并回退 null */
function parseRealName(raw: unknown): RealNameState | null {
  const r = asRecord(raw)
  if (!r) return null
  const name = asString(r.name)
  const idMasked = asString(r.idMasked)
  if (name === null || idMasked === null) return null
  if (!idMasked.includes('*')) return null
  return { name, idMasked, at: typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : 0 }
}

export function getRealName(): RealNameState | null {
  return readJson(key(FIELD.realname), parseRealName, null)
}

export function setRealName(v: RealNameState): void {
  writeJson(key(FIELD.realname), v)
  emit(EVT.identity)
}

export function clearRealName(): void {
  removeKey(key(FIELD.realname))
  emit(EVT.identity)
}

/* ---------- 认证 ---------- */

function asLevel(v: unknown): VerifyLevel | null {
  return v === 'orange' || v === 'blue' ? v : null
}

function parseVerify(raw: unknown): VerifyState | null {
  const r = asRecord(raw)
  if (!r) return null
  if (r.status === 'none') return { status: 'none' }
  const level = asLevel(r.level)
  const desc = asString(r.desc) ?? ''
  const appliedAt = typeof r.appliedAt === 'number' && Number.isFinite(r.appliedAt) ? r.appliedAt : 0
  if (level === null) return null
  if (r.status === 'pending') return { status: 'pending', level, desc, appliedAt }
  if (r.status === 'approved') {
    const approvedAt = typeof r.approvedAt === 'number' && Number.isFinite(r.approvedAt) ? r.approvedAt : 0
    return { status: 'approved', level, desc, appliedAt, approvedAt }
  }
  return null
}

const NO_VERIFY: VerifyState = { status: 'none' }

export function getVerify(): VerifyState {
  return readJson(key(FIELD.verify), parseVerify, NO_VERIFY)
}

export function setVerify(v: VerifyState): void {
  writeJson(key(FIELD.verify), v)
  emit(EVT.identity)
}

/* ---------- 隐私 ---------- */

function parsePrivacy(raw: unknown): PrivacyState | null {
  const r = asRecord(raw)
  if (!r) return null
  const posts: PostVisibility =
    r.posts === 'friends' || r.posts === 'self' || r.posts === 'public' ? r.posts : 'public'
  const pol = (v: unknown): PrivacyPolicy => (v === 'following' || v === 'off' || v === 'all' ? v : 'all')
  return { posts, comments: pol(r.comments), dm: pol(r.dm) }
}

export function getPrivacy(): PrivacyState {
  return readJson(key(FIELD.privacy), parsePrivacy, DEFAULT_PRIVACY)
}

export function setPrivacy(v: PrivacyState): void {
  writeJson(key(FIELD.privacy), v)
  emit(EVT.identity)
}

/* ---------- 青少年模式 ---------- */

function parseTeen(raw: unknown): TeenState | null {
  const r = asRecord(raw)
  if (!r) return null
  const password = asString(r.password) ?? ''
  return { enabled: r.enabled === true, password }
}

const TEEN_OFF: TeenState = { enabled: false, password: '' }

export function getTeen(): TeenState {
  return readJson(key(FIELD.teen), parseTeen, TEEN_OFF)
}

export function setTeen(v: TeenState): void {
  writeJson(key(FIELD.teen), v)
  emit(EVT.identity)
}

/* ---------- 黑名单 ---------- */

export function getBlacklist(): string[] {
  return readJson(key(FIELD.blacklist), asStringArray, [] as string[])
}

export function setBlacklist(list: string[]): void {
  writeJson(key(FIELD.blacklist), list)
  emit(EVT.identity)
}

/* ---------- 注销 ---------- */

/** 清除当前身份下全部本机隔离键（含钱包 / 成长 / VIP），返回清除条数 */
export function clearIdentityLocal(): number {
  const n = purgeUid(currentUid())
  emit(EVT.identity)
  return n
}
