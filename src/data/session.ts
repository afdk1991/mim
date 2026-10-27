/* ==========================================================================
 * 会话与身份 —— 非 React 的会话单例（供非组件场景读取当前身份）
 *
 * 关键不变量（与原实现一致，不得改动）：
 *  未登录时 uid 恒为 'local'，它是「本机存储锚点」，不是「演示模式」标记。
 * 钱类数据按 uid 隔离，内容归属按 meId 隔离，两者不可混用。
 * ======================================================================== */

import { LOCAL_UID, readJson, removeKey, writeJson } from '../core/storage'
import { emit, EVT } from '../core/events'
import { setTokenProvider } from '../core/http'
import { auth as authApi } from './client'
import type { AuthUser } from './client'
import type { Result } from '../core/result'

const SESSION_KEY = 'mim.session'

export interface Session {
  uid: string
  username: string
  name: string
  emoji: string
  roles: string[]
  permissions: string[]
  token: string | null
}

const GUEST: Session = {
  uid: LOCAL_UID,
  username: '',
  name: '游客',
  emoji: '🙂',
  roles: [],
  permissions: [],
  token: null,
}

function parseSession(raw: unknown): Session | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.uid !== 'string' || !r.uid) return null
  const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  return {
    uid: r.uid,
    username: str(r.username),
    name: str(r.name, '用户'),
    emoji: str(r.emoji, '🙂'),
    roles: arr(r.roles),
    permissions: arr(r.permissions),
    token: typeof r.token === 'string' && r.token ? r.token : null,
  }
}

let current: Session = readJson(SESSION_KEY, parseSession, GUEST)

/** 令牌注入：http 层每次请求前回读，登录/登出后自动生效 */
setTokenProvider(() => (current.token ? current.token : null))

export function getSession(): Session {
  return current
}

/** 未登录也返回 'local'，调用方无需判空 */
export function currentUid(): string {
  return current.uid || LOCAL_UID
}

export function isSignedIn(): boolean {
  return current.uid !== LOCAL_UID && !!current.token
}

export function hasRole(role: string): boolean {
  return current.roles.includes(role)
}

export function hasPerm(perm: string): boolean {
  return current.permissions.includes(perm)
}

function persist(next: Session): void {
  current = next
  writeJson(SESSION_KEY, next)
  emit(EVT.auth)
}

export function setSession(user: AuthUser, token: string): Session {
  const next: Session = {
    uid: user.id,
    username: user.username,
    name: user.name || user.username,
    emoji: user.emoji || '🙂',
    roles: user.roles ?? [],
    permissions: user.permissions ?? [],
    token,
  }
  persist(next)
  return next
}

export function clearSession(): void {
  current = GUEST
  removeKey(SESSION_KEY)
  emit(EVT.auth)
}

/* ---------- 会话动作 ---------- */

export async function signUp(username: string, password: string): Promise<Result<Session>> {
  const r = await authApi.register({ username, password })
  if (!r.ok) return r
  const s = setSession(r.data.user, r.data.token)
  return { ok: true, data: s }
}

export async function signIn(username: string, password: string): Promise<Result<Session>> {
  const r = await authApi.login({ username, password })
  if (!r.ok) return r
  const s = setSession(r.data.user, r.data.token)
  return { ok: true, data: s }
}

export async function signOut(): Promise<void> {
  try {
    await authApi.logout()
  } catch {
    /* 服务端登出失败也要清本地，否则用户永远退不出去 */
  }
  clearSession()
}

/** 启动或 token 变更时校验会话有效性；失效则清空（避免带着坏令牌打所有接口） */
export async function refreshSession(): Promise<void> {
  if (!current.token) return
  const r = await authApi.me()
  if (!r.ok) {
    clearSession()
    return
  }
  persist({ ...current, ...mapUser(r.data) })
}

function mapUser(u: AuthUser): Partial<Session> {
  return {
    uid: u.id,
    username: u.username,
    name: u.name || u.username,
    emoji: u.emoji || '🙂',
    roles: u.roles ?? [],
    permissions: u.permissions ?? [],
  }
}
