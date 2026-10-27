/* ==========================================================================
 * 身份域模型 —— 认证模式、用户资料、权限判定
 *
 * 权限三层防护（与原实现一致，缺一层就会出现「绕过 UI 直接改数据」）：
 *   1. UI 层 can() 控制显隐
 *   2. 状态层 ownership 兜底拦截
 *   3. 服务端按 owner 过滤（真正的闸门）
 * ======================================================================== */

export type AuthMode = 'guest' | 'cloud'

export type PermAction =
  | 'post:delete'
  | 'article:edit'
  | 'article:delete'
  | 'snippet:delete'
  | 'profile:edit'
  | 'comment:delete'

/** 所有权判定：所有动作统一规则 —— 只能操作自己的内容 */
export function can(
  _mode: AuthMode,
  meId: string,
  _action: PermAction,
  target: { authorId: string },
): boolean {
  return target.authorId === meId
}

/* ---------- 实名与认证 ---------- */

export type VerifyLevel = 'orange' | 'blue'

export type VerifyState =
  | { status: 'none' }
  | { status: 'pending'; level: VerifyLevel; desc: string; appliedAt: number }
  | { status: 'approved'; level: VerifyLevel; desc: string; appliedAt: number; approvedAt: number }

export interface RealNameState {
  name: string
  /** 只存脱敏值（前 3 后 4），完整身份证号不得落盘 */
  idMasked: string
  at: number
}

/** 身份证校验：ISO 7064 MOD 11-2 */
export function validateIdCard(id: string): boolean {
  if (!/^\d{17}[\dXx]$/.test(id)) return false
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const codes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']
  let sum = 0
  for (let i = 0; i < 17; i += 1) sum += Number(id[i]) * weights[i]
  return codes[sum % 11] === id[17]?.toUpperCase()
}

export function maskIdCard(id: string): string {
  if (id.length < 7) return '***'
  return `${id.slice(0, 3)}***********${id.slice(-4)}`
}

/* ---------- 隐私 ---------- */

export type PrivacyPolicy = 'all' | 'following' | 'off'
export type PostVisibility = 'public' | 'friends' | 'self'

export interface PrivacyState {
  posts: PostVisibility
  comments: PrivacyPolicy
  dm: PrivacyPolicy
}

export const DEFAULT_PRIVACY: PrivacyState = { posts: 'public', comments: 'all', dm: 'all' }

/* ---------- 青少年模式 ---------- */

export interface TeenState {
  enabled: boolean
  /** 4 位数字 */
  password: string
}

export const TEEN_PASSWORD_RE = /^\d{4}$/

/* ---------- 账号切换 ---------- */

export interface UdAccount {
  uid: string
  label: string
  mode: AuthMode
  lastAt: number
}
