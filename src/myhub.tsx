/* 我的应用面板：聚合 14 个工具台的本地状态摘要与虚拟资产。
   只读各模块独立 localStorage（松耦合），不改任何工具台代码；
   任一存档缺失或字段异常时指标显示「—」，不影响页面渲染。 */

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
  { href: '#/youxuan', key: 'mim-youxuan-v1', emoji: '🎁', label: '优选商城', stat: (s) => ({ label: '订单', value: fmt(len(s, 'orders')) }) },
  { href: '#/price', key: 'mim-price-v1', emoji: '📉', label: '价格监控', stat: (s) => ({ label: '降价预警', value: fmt(len(s, 'alerts')) }) },
  { href: '#/delivery', key: 'mim-delivery-v1', emoji: '🛵', label: '配送调度', stat: (s) => ({ label: '订单', value: fmt(len(s, 'orders')) }) },
  { href: '#/bom', key: 'mim-bom-v1', emoji: '🧰', label: 'BOM 工具台', stat: (s) => ({ label: '部件用量', value: fmt(keys(s, 'qtys')) }) },
  { href: '#/ai', key: 'mim-ai-v1', emoji: '🤖', label: 'AI 资源', stat: (s) => ({ label: '收藏', value: fmt(len(s, 'favs')) }) },
  { href: '#/manju', key: 'mim-manju-v1', emoji: '🎬', label: '漫剧', stat: (s) => ({ label: '片单收藏', value: fmt(len(s, 'favorites')) }) },
  { href: '#/nav', key: 'mim-nav-v1', emoji: '🗺️', label: '路线导航', stat: (s) => ({ label: '已规划路线', value: fmt(len(s, 'routes')) }) },
  { href: '#/mail', key: 'mim-email-v1', emoji: '📬', label: '邮箱聚合', stat: (s) => ({ label: '邮件', value: fmt(len(s, 'mails')) }) },
  { href: '#/coze', key: 'mim-coze-v1', emoji: '🧪', label: '智能体面板', stat: (s) => ({ label: '检测历史', value: fmt(len(s, 'history')) }) },
  { href: '#/ardot', key: 'mim-ardot-v1', emoji: '📡', label: '聚合监控', stat: (s) => ({ label: '审计日志', value: fmt(len(s, 'logs')) }) },
]

/* 虚拟资产：分散在四个模块里的数字资产汇总 */
const ASSETS: { href: string; emoji: string; label: string; read: () => number | null; prefix?: string }[] = [
  { href: '#/live', emoji: '📺', label: '直播积分', read: () => num(readStore('mim-myp-v1'), 'points') },
  { href: '#/laal', emoji: '🚗', label: '代驾余额', read: () => num(readStore('mim-laal-v1'), 'balance'), prefix: '¥' },
  { href: '#/mix', emoji: '🍜', label: '生活钱包', read: () => num(readStore('mim-mix-v1'), 'wallet'), prefix: '¥' },
  { href: '#/gexm', emoji: '🪙', label: '商城金币', read: () => num(readStore('mim-gexm-v1'), 'points') },
]

export function MyAppHub() {
  return (
    <>
      <div className="card myhub-card">
        <div className="myhub-head">
          <b>💰 我的资产</b>
          <small className="myhub-hint">实时读自各模块本地存档</small>
        </div>
        <div className="myhub-assets">
          {ASSETS.map((a) => (
            <a key={a.label} className="myhub-asset" href={a.href}>
              <span className="myhub-asset-emoji">{a.emoji}</span>
              <b className="myhub-asset-value">{fmt(a.read(), a.prefix ?? '')}</b>
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
            const st = app.stat(readStore(app.key))
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
