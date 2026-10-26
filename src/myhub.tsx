/* 我的应用面板：聚合商城中台与 9 个工具台的本地状态摘要与虚拟资产。
   只读各模块独立 localStorage（松耦合），不改任何工具台代码；
   任一存档缺失或字段异常时指标显示「—」，不影响页面渲染。
   商城中台数据按真实登录身份隔离（mim-mall-v2:<userId>，见 mall/store.tsx）。 */

import { useAuth } from './auth'

type Store = Record<string, unknown>

function readStore(key: string): Store | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const v: unknown = JSON.parse(raw)
    return v && typeof v === 'object' ? (v as Store) : null
  } catch {
    return null
  }
}

function num(s: Store | null, k: string): number | null {
  const v = s?.[k]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function len(s: Store | null, k: string): number | null {
  const v = s?.[k]
  return Array.isArray(v) ? v.length : null
}

function keys(s: Store | null, k: string): number | null {
  const v = s?.[k]
  return v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).length : null
}

const fmt = (v: number | null, prefix = '') => (v === null ? '—' : `${prefix}${v}`)

type Stat = { label: string; value: string }

type AppEntry = {
  href: string
  key: string
  emoji: string
  label: string
  stat: (s: Store | null) => Stat
}

/* 各工具台状态摘要（字段与各模块 interface 对齐） */
const APPS: AppEntry[] = [
  { href: '#/mall', key: 'mim-mall-v2', emoji: '🛒', label: '商城', stat: (s) => ({ label: '订单', value: fmt(len(s, 'orders')) }) },
  { href: '#/price', key: 'mim-price-v1', emoji: '📉', label: '价格监控', stat: (s) => ({ label: '降价预警', value: fmt(len(s, 'alerts')) }) },
  { href: '#/delivery', key: 'mim-delivery-v2', emoji: '🛵', label: '配送调度', stat: (s) => ({ label: '订单', value: fmt(len(s, 'orders')) }) },
  { href: '#/bom', key: 'mim-bom-v1', emoji: '🧰', label: 'BOM 工具台', stat: (s) => ({ label: '部件用量', value: fmt(keys(s, 'qtys')) }) },
  { href: '#/ai', key: 'mim-ai-v1', emoji: '🤖', label: 'AI 资源', stat: (s) => ({ label: '收藏', value: fmt(len(s, 'favs')) }) },
  { href: '#/manju', key: 'mim-manju-v1', emoji: '🎬', label: '漫剧', stat: (s) => ({ label: '片单收藏', value: fmt(len(s, 'favorites')) }) },
  { href: '#/nav', key: 'mim-nav-v1', emoji: '🗺️', label: '路线导航', stat: (s) => ({ label: '已规划路线', value: fmt(len(s, 'routes')) }) },
  { href: '#/mail', key: 'mim-email-v1', emoji: '📬', label: '邮箱聚合', stat: (s) => ({ label: '邮件', value: fmt(len(s, 'mails')) }) },
  { href: '#/coze', key: 'mim-coze-v1', emoji: '🧪', label: '智能体面板', stat: (s) => ({ label: '检测历史', value: fmt(len(s, 'history')) }) },
  { href: '#/ardot', key: 'mim-ardot-v1', emoji: '📡', label: '聚合监控', stat: (s) => ({ label: '审计日志', value: fmt(len(s, 'logs')) }) },
]

/* 虚拟资产：读自商城中台（mim-mall-v2）的钱包与积分 */
const ASSETS: { href: string; emoji: string; label: string; read: (mallKey: string) => number | null; prefix?: string }[] = [
  { href: '#/mall/wallet', emoji: '💰', label: '商城余额', read: (k) => num(readStore(k), 'wallet'), prefix: '¥' },
  { href: '#/mall/wallet', emoji: '🪙', label: '商城积分', read: (k) => num(readStore(k), 'points') },
]

export function MyAppHub() {
  const { auth } = useAuth()
  // 商城资产绑真实身份；其余工具台保持共享沙盒
  const mallKey = `mim-mall-v2:${auth.userId}`
  return (
    <>
      <div className="card myhub-card">
        <div className="myhub-head">
          <b>💰 我的资产</b>
          <small className="myhub-hint">实时读自商城中台本地存档</small>
        </div>
        <div className="myhub-assets">
          {ASSETS.map((a) => (
            <a key={a.label} className="myhub-asset" href={a.href}>
              <span className="myhub-asset-emoji">{a.emoji}</span>
              <b className="myhub-asset-value">{fmt(a.read(mallKey), a.prefix ?? '')}</b>
              <small>{a.label}</small>
            </a>
          ))}
        </div>
      </div>
      <div className="card myhub-card">
        <div className="myhub-head">
          <b>🧭 我的应用</b>
          <small className="myhub-hint">工具台状态一览，点击直达</small>
        </div>
        <div className="myhub-grid">
          {APPS.map((app) => {
            const st = app.stat(readStore(app.key === 'mim-mall-v2' ? mallKey : app.key))
            return (
              <a key={app.href} className="myhub-app" href={app.href}>
                <span className="myhub-app-emoji">{app.emoji}</span>
                <span className="myhub-app-info">
                  <b>{app.label}</b>
                  <small>
                    {st.label} · <span className="myhub-app-num">{st.value}</span>
                  </small>
                </span>
              </a>
            )
          })}
        </div>
      </div>
    </>
  )
}
