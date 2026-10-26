/* 轮 20 打通：用户域（B1）数据层 —— 认证 / 实名 / 隐私设置 / 黑名单 / 青少年模式 / 注销清库 / 多账号清单。
   存储按「真实登录身份 userId」分 key（mim-ud-<uid>:<field>），与 growth/wallet 同款隔离策略；
   所有写入统一派发 UD_EVT，让使用方（含 React 树外的模块级读路径）实时刷新；
   非 hook 场景一律走 getCurrentUserId() 身份单例，与 growth.tsx 的身份切换监听做法一致。 */

import { useCallback, useEffect, useState } from 'react'
import { getCurrentUserId, useAuth } from './auth'
import type { AuthMode } from './permissions'
import { useApp } from './store'
import type { User } from './types'
import { cx } from './utils'

/* ---------- 事件与 key 约定 ---------- */

/** 用户域数据变更事件：页面监听以同步外部写入（同 GROWTH_UPDATE_EVT 的做法） */
export const UD_EVT = 'mim-ud-change'

const udKey = (userId: string, field: string) => `mim-ud-${userId}:${field}`

function dispatchUD(): void {
  window.dispatchEvent(new Event(UD_EVT))
}

function parseJSON(raw: string | null): unknown {
  try {
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

/* ---------- 类型 ---------- */

export type VerifyLevel = 'orange' | 'blue'

export type VerifyState =
  | { status: 'none' }
  | { status: 'pending'; level: VerifyLevel; desc: string; appliedAt: number }
  | { status: 'approved'; level: VerifyLevel; desc: string; appliedAt: number; approvedAt: number }

/** 实名信息：身份证只存脱敏值（前 3 后 4，如 110***********123X） */
export type RealNameState = { name: string; idMasked: string; at: number }

export type PrivacyPolicy = 'all' | 'following' | 'off'
export type PostVisibility = 'public' | 'friends' | 'self'
export type PrivacyState = { posts: PostVisibility; comments: PrivacyPolicy; dm: PrivacyPolicy }

export type TeenState = { enabled: boolean; password: string }

/** 多账号清单条目（存全局 key，不随身份分 key） */
export type UdAccount = { uid: string; label: string; mode: AuthMode; lastAt: number }

const DEFAULT_PRIVACY: PrivacyState = { posts: 'public', comments: 'all', dm: 'all' }

const POLICIES: readonly PrivacyPolicy[] = ['all', 'following', 'off']
const VISIBILITIES: readonly PostVisibility[] = ['public', 'friends', 'self']
const LEVELS: readonly VerifyLevel[] = ['orange', 'blue']

const isPolicy = (v: unknown): v is PrivacyPolicy =>
  typeof v === 'string' && (POLICIES as readonly string[]).includes(v)
const isVisibility = (v: unknown): v is PostVisibility =>
  typeof v === 'string' && (VISIBILITIES as readonly string[]).includes(v)
const isLevel = (v: unknown): v is VerifyLevel =>
  typeof v === 'string' && (LEVELS as readonly string[]).includes(v)

/* ---------- 认证（橙V / 蓝V） ---------- */

export function readVerify(userId: string = getCurrentUserId()): VerifyState {
  const v = parseJSON(localStorage.getItem(udKey(userId, 'verify')))
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (o.status === 'pending' && isLevel(o.level) && typeof o.desc === 'string' && typeof o.appliedAt === 'number') {
      return { status: 'pending', level: o.level, desc: o.desc, appliedAt: o.appliedAt }
    }
    if (
      o.status === 'approved' && isLevel(o.level) && typeof o.desc === 'string' &&
      typeof o.appliedAt === 'number' && typeof o.approvedAt === 'number'
    ) {
      return { status: 'approved', level: o.level, desc: o.desc, appliedAt: o.appliedAt, approvedAt: o.approvedAt }
    }
  }
  return { status: 'none' }
}

export function writeVerify(next: VerifyState): void {
  localStorage.setItem(udKey(getCurrentUserId(), 'verify'), JSON.stringify(next))
  dispatchUD()
}

/* ---------- 实名认证（脱敏存储） ---------- */

export function readRealName(userId: string = getCurrentUserId()): RealNameState | null {
  const v = parseJSON(localStorage.getItem(udKey(userId, 'realname')))
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.name === 'string' && typeof o.idMasked === 'string' && typeof o.at === 'number') {
      return { name: o.name, idMasked: o.idMasked, at: o.at }
    }
  }
  return null
}

export function writeRealName(next: RealNameState): void {
  localStorage.setItem(udKey(getCurrentUserId(), 'realname'), JSON.stringify(next))
  dispatchUD()
}

/* 18 位身份证校验：格式 + 出生日期粗校验 + ISO 7064 MOD 11-2 校验位 */
const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const ID_CHECK = '10X98765432'

export function validateIdCard(id: string): boolean {
  if (!/^\d{17}[\dXx]$/.test(id)) return false
  const y = Number(id.slice(6, 10))
  const m = Number(id.slice(10, 12))
  const d = Number(id.slice(12, 14))
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false
  let sum = 0
  for (let i = 0; i < 17; i++) sum += Number(id[i]) * ID_WEIGHTS[i]
  return ID_CHECK[sum % 11] === id[17].toUpperCase()
}

/** 脱敏：只保留前 3 后 4（110***********123X），完整号码不落盘 */
export function maskIdCard(id: string): string {
  return id.slice(0, 3) + '***********' + id.slice(-4)
}

/* ---------- 隐私设置 ---------- */

export function readPrivacy(userId: string = getCurrentUserId()): PrivacyState {
  const v = parseJSON(localStorage.getItem(udKey(userId, 'privacy')))
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return {
      posts: isVisibility(o.posts) ? o.posts : DEFAULT_PRIVACY.posts,
      comments: isPolicy(o.comments) ? o.comments : DEFAULT_PRIVACY.comments,
      dm: isPolicy(o.dm) ? o.dm : DEFAULT_PRIVACY.dm,
    }
  }
  return DEFAULT_PRIVACY
}

export function writePrivacy(next: PrivacyState): void {
  localStorage.setItem(udKey(getCurrentUserId(), 'privacy'), JSON.stringify(next))
  dispatchUD()
}

/* ---------- 黑名单 ---------- */

export function readBlacklist(userId: string = getCurrentUserId()): string[] {
  const v = parseJSON(localStorage.getItem(udKey(userId, 'blacklist')))
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** 切换拉黑状态，返回切换后是否在黑名单中 */
export function toggleBlacklistUser(id: string): boolean {
  const cur = readBlacklist()
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
  localStorage.setItem(udKey(getCurrentUserId(), 'blacklist'), JSON.stringify(next))
  dispatchUD()
  return next.includes(id)
}

/* ---------- 青少年模式 ---------- */

/** 敏感占位词：青少年模式下 feed 简单关键词过滤（轮 20 demo 粒度） */
const TEEN_WORDS = ['博彩', '色情', '暴力', '成人内容']

export function matchesTeenWords(text: string): boolean {
  const t = text.toLowerCase()
  return TEEN_WORDS.some((w) => t.includes(w.toLowerCase()))
}

export function readTeen(userId: string = getCurrentUserId()): TeenState {
  const v = parseJSON(localStorage.getItem(udKey(userId, 'teen')))
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.enabled === 'boolean' && typeof o.password === 'string') {
      return { enabled: o.enabled, password: o.password }
    }
  }
  return { enabled: false, password: '' }
}

export function writeTeen(next: TeenState): void {
  localStorage.setItem(udKey(getCurrentUserId(), 'teen'), JSON.stringify(next))
  dispatchUD()
}

/* ---------- 多账号清单（全局 key）与注销清库 ---------- */

const ACCOUNTS_KEY = 'mim-ud-accounts'

const isMode = (v: unknown): v is AuthMode => v === 'guest' || v === 'cloud'

export function readAccounts(): UdAccount[] {
  const v = parseJSON(localStorage.getItem(ACCOUNTS_KEY))
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((o) => ({
      uid: typeof o.uid === 'string' ? o.uid : '',
      label: typeof o.label === 'string' ? o.label : '',
      mode: isMode(o.mode) ? o.mode : 'guest',
      lastAt: typeof o.lastAt === 'number' ? o.lastAt : 0,
    }))
    .filter((a) => a.uid !== '')
}

function upsertAccount(acc: UdAccount): void {
  const list = readAccounts().filter((a) => a.uid !== acc.uid)
  list.push(acc)
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

export function removeAccount(uid: string): void {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(readAccounts().filter((a) => a.uid !== uid)))
  } catch {
    /* ignore */
  }
}

/** 登录/使用身份时登记账号清单（多账号切换数据源之一：登录时登记） */
export function registerCurrentAccount(mode: AuthMode, email: string | null): void {
  const uid = getCurrentUserId()
  upsertAccount({
    uid,
    label: mode === 'cloud' ? (email ?? `云端账号 ${uid.slice(0, 8)}`) : '游客身份',
    mode,
    lastAt: Date.now(),
  })
}

/** 扫描 localStorage 里按身份分 key 的数据（growth/mall/wallet/publish/vip/mim-ud-*），反推本机出现过的身份 */
function scanStoredUids(): string[] {
  const re = /^(?:mim-growth-v1|mim-mall-v2|mim-wallet-v1|mim-publish-v1|mim-vip-v1):(.+)$|^mim-ud-(.+):[a-z]+$/
  const out = new Set<string>()
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k) continue
    const m = re.exec(k)
    if (m) out.add(m[1] ?? m[2] ?? '')
  }
  out.delete('')
  return [...out]
}

/** 把扫描到的历史身份合并进账号清单（有新增时派发刷新；设置页挂载时调用一次） */
export function syncDiscoveredAccounts(): void {
  const known = new Set(readAccounts().map((a) => a.uid))
  let changed = false
  for (const uid of scanStoredUids()) {
    if (known.has(uid)) continue
    upsertAccount({
      uid,
      label: uid === 'local' ? '游客身份（本机）' : `历史云端身份 ${uid.slice(0, 8)}`,
      mode: uid === 'local' ? 'guest' : 'cloud',
      lastAt: 0,
    })
    changed = true
  }
  if (changed) dispatchUD()
}

/** 账号注销：清除当前身份相关的所有 localStorage key（mim-ud-<uid>:* 与各中台的 <key>:<uid>），返回清除数量 */
export function purgeIdentityData(uid: string): number {
  const prefix = `mim-ud-${uid}:`
  const suffix = `:${uid}`
  let removed = 0
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i)
    if (k && (k.startsWith(prefix) || k.endsWith(suffix))) {
      localStorage.removeItem(k)
      removed++
    }
  }
  removeAccount(uid)
  dispatchUD()
  return removed
}

/* ---------- Hooks ---------- */

/** 轻量订阅：只读认证状态（VBadge 高频渲染用） */
export function useVerify(): VerifyState {
  const { auth } = useAuth()
  const [v, setV] = useState<VerifyState>(() => readVerify(auth.userId))
  useEffect(() => {
    setV(readVerify(auth.userId))
  }, [auth.userId])
  useEffect(() => {
    const sync = () => setV(readVerify(getCurrentUserId()))
    window.addEventListener(UD_EVT, sync)
    return () => window.removeEventListener(UD_EVT, sync)
  }, [])
  return v
}

/** 轻量订阅：只读青少年模式（全站横幅用） */
export function useTeen(): TeenState {
  const { auth } = useAuth()
  const [t, setT] = useState<TeenState>(() => readTeen(auth.userId))
  useEffect(() => {
    setT(readTeen(auth.userId))
  }, [auth.userId])
  useEffect(() => {
    const sync = () => setT(readTeen(getCurrentUserId()))
    window.addEventListener(UD_EVT, sync)
    return () => window.removeEventListener(UD_EVT, sync)
  }, [])
  return t
}

function readCore(userId: string) {
  return {
    verify: readVerify(userId),
    realname: readRealName(userId),
    privacy: readPrivacy(userId),
    teen: readTeen(userId),
    blacklist: readBlacklist(userId),
  }
}

/** 用户域全量快照：设置页 / feed / 私信等使用；身份切换与 UD_EVT 均会触发重读 */
export function useUserDomain() {
  const { auth } = useAuth()
  const [core, setCore] = useState(() => readCore(auth.userId))
  const [accounts, setAccounts] = useState<UdAccount[]>(readAccounts)

  /* 轮 20 打通：切号（登录/登出）即重载对应身份数据，并登记到多账号清单 */
  useEffect(() => {
    registerCurrentAccount(auth.mode, auth.email)
    setCore(readCore(auth.userId))
    setAccounts(readAccounts())
  }, [auth.userId, auth.mode, auth.email])

  useEffect(() => {
    const sync = () => {
      setCore(readCore(getCurrentUserId()))
      setAccounts(readAccounts())
    }
    window.addEventListener(UD_EVT, sync)
    return () => window.removeEventListener(UD_EVT, sync)
  }, [])

  const toggleBlacklist = useCallback((id: string) => {
    toggleBlacklistUser(id)
  }, [])

  return { ...core, accounts, toggleBlacklist }
}

/* ---------- 共享小组件 ---------- */

/** 用户名旁 V 徽章：本人按用户域认证状态区分橙V/蓝V，他人沿用 User.verified 蓝V */
export function VBadge({ u }: { u: User }) {
  const { state } = useApp()
  const verify = useVerify()
  if (u.id === state.meId) {
    if (verify.status !== 'approved') return null
    return (
      <span
        className={cx('v-badge', verify.level === 'orange' ? 'v-badge-orange' : 'v-badge-blue')}
        title={verify.level === 'orange' ? '个人认证（橙V）' : '机构认证（蓝V）'}
      >
        V
      </span>
    )
  }
  if (!u.verified) return null
  return <span className="v-badge" title="认证用户">V</span>
}

/** 青少年模式全站横幅：Shell 顶部常驻提示（开启期间显示） */
export function TeenBanner() {
  const teen = useTeen()
  if (!teen.enabled) return null
  return (
    <div className="ud-teen-banner" role="status">
      <span>
        🧒 <b>青少年模式已开启</b>：内容已按青少年偏好过滤，每日限用 40 分钟
      </span>
      <a href="#/settings">前往设置关闭</a>
    </div>
  )
}
