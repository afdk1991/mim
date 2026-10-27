import './search-box.css'
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import { SearchField } from './SearchBox'
import { useStickyBar } from './scroll-reveal'
import { APP_VERSION } from './version'
import { AppProvider, useApp } from './store'
import { RouterProvider, useRouter } from './router'
import { Avatar, Empty, TimeAgo, ToastProvider, useToast } from './components'
import {
  FavoritesPage,
  FeedPage,
  FollowingPage,
  MessagesPage,
  MyProfilePage,
  NotificationsPage,
  PostDetailPage,
  ProfilePage,
  TopicPage,
  TopicRankPage,
} from './weibo'
import {
  ArticleDetailPage,
  ArticleEditorPage,
  ArticlesPage,
  BlogHomePage,
  ResourcesPage,
  SearchPage,
  SnippetsPage,
  TagsPage,
} from './csdn'
import { DeliveryBoardPage } from './delivery'
import { PriceMonitorPage } from './price'
import { RouteNavPage } from './nav'
import { EmailHubPage } from './email'
import { BomToolPage } from './bom'
import { CozePanelPage } from './coze'
import { AiResPage } from './ai'
import { ManjuPage } from './manju'
import { ArdotPage } from './ardot'
import { MallProvider, MALL_CHANNEL_META, type MallChannel } from './mall/store'
import { AuthProvider, useAuth } from './auth'
import { PlayerProvider } from './player' /* 全站统一播放器（音频/视频通用，跨页不中断） */
import { fetchAuditLogs, fetchIamRoles, type AuditLogRow, type IamRole } from './lib/cloud-iam'
import { adminBootstrapSupported, bootstrapAdmin, queryHasAnyAdmin } from './lib/admin-bootstrap'
import { matchSearchPages } from './search-index'
import { VipCenterPage } from './vip'
import { LoginPage } from './login'
import { InfoPage } from './info'
import { MallHomePage } from './mall/MallHome'
import { MallGoodsPage } from './mall/MallGoods'
import { MallCartPage } from './mall/MallCart'
import { MallOrdersPage } from './mall/MallOrders'
import { MallWalletPage } from './mall/MallWallet'
import { MallSeckillPage } from './mall/MallSeckill'
import { MallLocalPage } from './mall/MallLocal'
import { MallLivePage } from './mall/MallLive'
import { MallTravelPage } from './mall/MallTravel'
import { BIZ_BY_ROUTE } from './mall/biz/registry'
import { GrowthPage } from './growth'
import { PublishPage } from './publish'
import { WalletPage } from './wallet'
import { clearHistory, cx, formatCount, loadHistory } from './utils'
import { scheduleOtaCheck } from './ota'
import { WelcomeModal } from './welcome'
import { SettingsPage } from './settings'
import { LivePage } from './media-domain' /* 轮 24 打通：B5 直播推拉流/连麦（推流地址支持自有 RTMP） */
import { TeenBanner } from './user-domain'
import { ScheduledTicker } from './content-domain'
import { RanksPage, VideosPage } from './feed-domain' /* 轮 23 打通：B4 视频沉浸流 / 榜单体系路由 */
import { PullSearchBar } from './PullSearchBar' /* 微博式下拉揭示搜索栏（全局，覆盖整个项目） */
/* 单态架构（2026-10-23 决策）：原 PLAZA 广场态 / LEARN 知识态双态隔离已废止，
   全站统一为单一形态——导航、搜索、内容分发不再按视图切分，所有入口常驻可见。
   历史双态方案（三视图切换器 / domain 隔离 / 分域核算）见《开发吧.md》，
   该文件仅作规划留档，不再作为实现约束。 */

type NavItem = {
  href: string
  match: string
  label: string
  icon?: string
  badgeKey?: 'notif' | 'msg'
  children?: NavItem[]
}

/** 单一导航：业务域入口一级平铺（低频入口直接可见，搜索/导航双闭环）；
    个人账户/权益/营收类入口（发布器 · 钱包 · VIP · 成长 · 收藏 · 足迹 · 设置）
    按《开发吧.md》「我的 · Work」定义统一归入「我的」分组二级。 */
const NAV: NavItem[] = [
  { href: '#/feed', match: '/feed', label: '首页', icon: '🏠' },
  { href: '#/articles', match: '/article', label: '文章', icon: '📝' },
  { href: '#/write', match: '/write', label: '写文章', icon: '✍️' },
  { href: '#/topics', match: '/topics', label: '超话', icon: '🔥' },
  { href: '#/notifications', match: '/notifications', label: '通知', icon: '🔔', badgeKey: 'notif' },
  { href: '#/messages', match: '/messages', label: '私信', icon: '✉️', badgeKey: 'msg' },
  {
    href: '#/my',
    match: '/my',
    label: '我的',
    icon: '👤',
    children: [
      { href: '#/my', match: '/my', label: '我的主页' },
      { href: '#/blog', match: '/blog', label: '我的博客' },
      { href: '#/favorites', match: '/favorites', label: '收藏' },
      { href: '#/history', match: '/history', label: '足迹' },
      { href: '#/following', match: '/following', label: '关注列表' },
      /* 个人中心 · Work（开发吧.md「我的·Work」）：创作中心 + 收益/结算 + 会员/成长，与「工具箱」平铺解耦 */
      { href: '#/publish', match: '/publish', label: '发布器' },
      { href: '#/wallet', match: '/wallet', label: '统一钱包' },
      { href: '#/vip', match: '/vip', label: 'VIP 会员' },
      { href: '#/growth', match: '/growth', label: '成长引擎' },
      { href: '#/settings', match: '/settings', label: '设置' },
    ],
  },
  {
    href: '#/mall',
    match: '/mall',
    label: '商城',
    icon: '🛒',
    children: [
      { href: '#/mall', match: '/mall', label: '商城中心' },
      { href: '#/mall/cart', match: '/mall/cart', label: '购物车' },
      { href: '#/mall/orders', match: '/mall/orders', label: '订单' },
      { href: '#/mall/wallet', match: '/mall/wallet', label: '钱包' },
    ],
  },
  { href: '#/live', match: '/live', label: '直播开播', icon: '📡' }, /* 轮 24 打通：B5 直播开播台入口 */
  { href: '#/snippets', match: '/snippets', label: '代码片段', icon: '💻' },
  { href: '#/resources', match: '/resources', label: '资源下载', icon: '📦' },
  { href: '#/tags', match: '/tags', label: '标签', icon: '🏷️' },
  { href: '#/delivery', match: '/delivery', label: '配送台', icon: '🚚' },
  { href: '#/price', match: '/price', label: '价格监控', icon: '📈' },
  { href: '#/nav', match: '/nav', label: '路线导航', icon: '🗺️' },
  { href: '#/mail', match: '/mail', label: '邮箱', icon: '📬' },
  { href: '#/bom', match: '/bom', label: 'BOM 工具台', icon: '🖥️' },
  { href: '#/coze', match: '/coze', label: '智能体', icon: '🤖' },
  { href: '#/ai', match: '/ai', label: 'AI 资源', icon: '📚' },
  { href: '#/manju', match: '/manju', label: '漫剧', icon: '🎬' },
  { href: '#/ardot', match: '/ardot', label: '聚合监控', icon: '📊' },
  { href: '#/mall/youxuan', match: '/mall/youxuan', label: '优选商城', icon: '🛍️' },
  { href: '#/mall/live', match: '/mall/live', label: '直播带货', icon: '📺' },
  { href: '#/mall/mix', match: '/mall/mix', label: '本地生活', icon: '🍜' },
  { href: '#/mall/laal', match: '/mall/laal', label: '出行服务', icon: '🚗' },
  { href: '#/mall/gexm', match: '/mall/gexm', label: '秒杀特惠', icon: '⚡' },
]

/* ---------- 深色模式 ---------- */

const THEME_KEY = 'mim-theme'

function loadTheme(): 'light' | 'dark' {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* ignore */
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(loadTheme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* ignore */
    }
  }, [theme])
  return [theme, setTheme] as const
}

/* ---------- 单态导航：全部入口常驻可见，不再按视图过滤 ---------- */

/** Phase1 L1 IAM：管理后台入口（菜单级 RBAC，仅 admin 角色可见） */
const ADMIN_NAV: NavItem = {
  href: '#/admin',
  match: '/admin',
  label: '管理后台',
  icon: '🛡️',
  children: [
    { href: '#/admin/audit', match: '/admin/audit', label: '审计日志' },
    { href: '#/admin/roles', match: '/admin/roles', label: '角色管理' },
  ],
}

function SideNav() {
  const api = useApp()
  const { path, navigate } = useRouter()
  const { hasRole } = useAuth()
  const [open, setOpen] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [dropOpen, setDropOpen] = useState(false)

  /* 单态：全量 NAV 常驻可见；admin 角色追加管理后台入口 */
  const visible = hasRole('admin') ? [...NAV, ADMIN_NAV] : NAV

  /* 路由变化后自动展开包含当前页的分组（admin 角色异步到位后同样触发一次） */
  useEffect(() => {
    for (const item of visible) {
      if (!item.children) continue
      if (path.startsWith(item.match) || item.children.some((k) => path.startsWith(k.match))) {
        setOpen(item.label)
        return
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, hasRole])

  const hits = matchSearchPages(q)

  const goSearch = () => {
    const kw = q.trim()
    if (!kw) return
    navigate(`#/search?q=${encodeURIComponent(kw)}`)
    setDropOpen(false)
  }

  return (
    <aside className="sidenav">
      <a className="brand" href="#/feed">Mim</a>
      <div
        className="sidenav-search"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOpen(false)
        }}
      >
        <i className="sidenav-search-ico" aria-hidden="true">🔍</i>
        <input
          className="sidenav-search-input"
          type="search"
          placeholder="全站搜索"
          aria-label="全站搜索"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setDropOpen(true)
          }}
          onFocus={() => setDropOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') goSearch()
            if (e.key === 'Escape') setDropOpen(false)
          }}
        />
        {dropOpen && q.trim() !== '' && (
          <div className="sidenav-search-drop">
            {hits.length === 0 ? (
              <button className="sidenav-search-item" onClick={goSearch}>
                没有匹配的功能页，回车搜索「{q.trim()}」
              </button>
            ) : (
              <>
                {hits.slice(0, 8).map((p) => (
                  <button
                    key={p.href}
                    className="sidenav-search-item"
                    onClick={() => {
                      navigate(p.href)
                      setDropOpen(false)
                      setQ('')
                    }}
                  >
                    <i aria-hidden="true">{p.icon}</i>
                    <span className="sidenav-search-name">{p.name}</span>
                    <em>{p.group}</em>
                  </button>
                ))}
                <button className="sidenav-search-item sidenav-search-all" onClick={goSearch}>
                  查看全部搜索结果
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <nav className="sidenav-nav">
        {visible.map((item) => {
          const badge =
            item.badgeKey === 'notif' ? api.unreadNotifications : item.badgeKey === 'msg' ? api.unreadMessages : 0

          /* 无子项：普通链接 */
          if (!item.children) {
            return (
              <a
                key={item.label}
                href={item.href}
                className={cx('sidenav-link', path.startsWith(item.match) && 'active')}
              >
                {item.icon && <i className="sidenav-ico">{item.icon}</i>}
                {item.label}
                {badge > 0 && <span className="nav-badge">{badge > 99 ? '99+' : badge}</span>}
              </a>
            )
          }

          /* 有子项：手风琴分组 */
          const active = path.startsWith(item.match) || item.children.some((k) => path.startsWith(k.match))
          const expanded = open === item.label
          return (
            <div key={item.label} className="sidenav-group">
              <button
                className={cx('sidenav-link sidenav-group-btn', active && 'active')}
                onClick={() => setOpen(expanded ? null : item.label)}
              >
                {item.icon && <i className="sidenav-ico">{item.icon}</i>}
                {item.label}
                <i className="sidenav-caret">{expanded ? '▴' : '▾'}</i>
              </button>
              {expanded && (
                <div className="sidenav-sub">
                  {item.children.map((k) => (
                    <a
                      key={k.match}
                      href={k.href}
                      className={cx('sidenav-link sidenav-sub-link', path.startsWith(k.match) && 'active')}
                    >
                      {k.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        <SiteFooter />
      </nav>
    </aside>
  )
}

function Page() {
  const { path, query } = useRouter()
  const segs = path.split('/').filter(Boolean)
  const [root, param] = segs

  switch (root) {
    /* ---------- 动态 ---------- */
    case undefined:
    case 'feed':
      return <FeedPage />
    case 'post':
      return param ? <PostDetailPage id={param} /> : <Empty text="缺少动态 id" />
    case 'topic':
      return param ? <TopicPage name={decodeURIComponent(param)} /> : <Empty text="缺少话题名" />
    case 'topics':
      return <TopicRankPage />
    /* 轮 23 打通：B4 视频沉浸流 / 榜单体系 */
    case 'videos':
      return <VideosPage />
    case 'ranks':
      return <RanksPage />
    case 'notifications':
      return <NotificationsPage />
    case 'messages':
      return <MessagesPage />
    case 'favorites':
      return <FavoritesPage />
    case 'history':
      return <HistoryPage />
    case 'my':
      return <MyProfilePage />
    case 'following':
      return <FollowingPage />
    case 'user':
      return param ? <ProfilePage id={param} /> : <Empty text="缺少用户 id" />

    /* ---------- 文章 ---------- */
    case 'articles':
      return <ArticlesPage />
    case 'article':
      return param ? <ArticleDetailPage id={param} /> : <Empty text="缺少文章 id" />
    case 'write':
      return <ArticleEditorPage draftId={param} editId={query.get('edit') ?? undefined} />
    case 'blog':
      return <BlogHomePage />
    case 'snippets':
      return <SnippetsPage />
    case 'resources':
      return <ResourcesPage />
    case 'search':
      return <SearchPage key={query.get('q') ?? ''} />
    case 'tags':
      return <TagsPage />
    case 'login':
      return <LoginPage />

    /* ---------- 站点信息落地页 ---------- */
    case 'info':
      return param ? <InfoPage slug={param} /> : <Empty emoji="📄" text="请从页脚选择要查看的信息" />

    /* ---------- 商城中台 ---------- */
    case 'mall': {
      if (param === 'goods') return <MallGoodsPage id={segs[2] ?? ''} />
      /* 四大业务会场：#/mall/biz/<kind>。
         单独前缀是为了与频道路由（#/mall/live 等，走商品流）互不干扰：
         频道是「商品归类」，会场是「业务履约」，两者入口并存、都不破坏。 */
      if (param === 'biz') {
        switch (BIZ_BY_ROUTE[segs[2] ?? '']) {
          case 'seckill':
            return <MallSeckillPage />
          case 'local':
            return <MallLocalPage />
          case 'live':
            return <MallLivePage />
          case 'travel':
            return <MallTravelPage />
        }
      }
      /* 频道直达：#/mall/youxuan 等五个频道子路径 → 商城中心预选频道 */
      if (param && param in MALL_CHANNEL_META) return <MallHomePage initial={param as MallChannel} />
      if (param === 'cart') return <MallCartPage />
      if (param === 'orders') return <MallOrdersPage />
      if (param === 'wallet') return <MallWalletPage />
      return <MallHomePage />
    }

    /* ---------- 商业化 ---------- */
    case 'vip':
      return <VipCenterPage />

    /* ---------- 统一中台（开发吧.md 桥接设计：一条引擎服务双视图） ---------- */
    case 'growth':
      return <GrowthPage />
    case 'publish':
      return <PublishPage />
    /* 轮 24 打通：B5 多媒体——直播推拉流/连麦（开播台支持自有 RTMP 地址） */
    case 'live':
      return <LivePage />
    case 'wallet':
      return <WalletPage />

    /* ---------- 用户域（B1：认证/实名/隐私/黑名单/青少年/注销/切换） ---------- */
    case 'settings':
      return <SettingsPage />

    /* ---------- 工具台 ---------- */
    case 'delivery':
      return <DeliveryBoardPage />
    case 'price':
      return <PriceMonitorPage />
    case 'nav':
      return <RouteNavPage />
    case 'mail':
      return <EmailHubPage />
    case 'bom':
      return <BomToolPage />
    case 'coze':
      return <CozePanelPage />
    case 'ai':
      return <AiResPage />
    case 'manju':
      return <ManjuPage />
    case 'ardot':
      return <ArdotPage />

    /* ---------- Phase1 L1 IAM：管理后台（RBAC 菜单级守卫，页内再做权限点校验） ---------- */
    case 'admin':
      if (param === 'audit') return <AdminAuditPage />
      if (param === 'roles') return <AdminRolesPage />
      return <AdminHomePage />

    default:
      return <Empty emoji="🧭" text="页面不存在，检查一下地址吧" />
  }
}

/* ---------- 浏览历史（足迹） ---------- */

interface HistoryRow {
  key: string
  at: number
  icon: string
  label: string
  title: string
  author: string
  href: string
}

function HistoryPage() {
  const api = useApp()
  const { navigate } = useRouter()
  const [items, setItems] = useState(loadHistory)

  const rows: HistoryRow[] = []
  for (const h of items) {
    if (h.kind === 'post') {
      const p = api.state.posts.find((x) => x.id === h.id)
      if (!p) continue
      const first = p.content.split('\n')[0]
      rows.push({
        key: 'post-' + p.id,
        at: h.at,
        icon: '📝',
        label: '动态',
        title: first.length > 60 ? first.slice(0, 60) + '…' : first || '查看动态',
        author: api.user(p.authorId).name,
        href: '#/post/' + p.id,
      })
    } else {
      const a = api.state.articles.find((x) => x.id === h.id)
      if (!a) continue
      rows.push({
        key: 'article-' + a.id,
        at: h.at,
        icon: '📄',
        label: '文章',
        title: a.title,
        author: api.user(a.authorId).name,
        href: '#/article/' + a.id,
      })
    }
  }

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">👣 浏览足迹</h2>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button
            className="btn btn-ghost btn-sm"
            disabled={rows.length === 0}
            onClick={() => {
              clearHistory()
              setItems([])
            }}
          >
            清空足迹
          </button>
        </div>
        <div className="card">
          {rows.length === 0 && <Empty emoji="👣" text="还没有足迹，去看看动态和文章吧" />}
          {rows.map((r) => (
            <div key={r.key} className="notif-row" onClick={() => navigate(r.href)}>
              <span className="notif-icon">{r.icon}</span>
              <div className="notif-body">
                <p>
                  <span className="tag">{r.label}</span>
                  {r.title}
                </p>
                <small>
                  @{r.author} · <TimeAgo ts={r.at} />
                </small>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ---------- Phase1 L1 IAM：管理后台 ----------
   双保险：菜单级（SideNav 仅 admin 可见）+ 页内角色守卫。
   roles 页读 roles/permissions/role_permissions/user_roles；audit 页读 audit_logs。 */

const thCell: CSSProperties = {
  padding: '10px 12px',
  fontWeight: 600,
  color: 'var(--muted, #8a8f99)',
  whiteSpace: 'nowrap',
}
const tdCell: CSSProperties = {
  padding: '9px 12px',
  verticalAlign: 'top',
}

function fmtTs(s: string | number | null | undefined): string {
  if (!s) return '—'
  const t = typeof s === 'number' ? s : Date.parse(String(s))
  if (!Number.isFinite(t)) return String(s)
  return new Date(t).toLocaleString('zh-CN', { hour12: false })
}

function shortId(s: string | null | undefined): string {
  if (!s) return '系统'
  return s.length > 8 ? `${s.slice(0, 8)}…` : s
}

function detailStr(d: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(d)
    return s.length > 64 ? s.slice(0, 64) + '…' : s
  } catch {
    return ''
  }
}

function AdminGate({ children }: { children: ReactNode }) {
  const { auth, hasRole } = useAuth()
  /* 未登录：先引导登录（登录页在 #/login） */
  if (auth.mode !== 'cloud') return <AdminNoAccess kind="login" />
  /* 已登录但无 admin 角色：给出可操作的授权路径，而非一句无权限 */
  if (!hasRole('admin')) {
    return (
      <AdminNoAccess
        kind="role"
        who={auth.email ?? auth.username ?? auth.userId}
        roles={auth.roles}
      />
    )
  }
  return <>{children}</>
}

/* 管理后台无权限时的引导卡片：
   注册只会自动分配 user 角色，成为 admin 必须显式授权（user_roles 写策略要求调用者已是 admin），
   因此这里必须把「怎么获得权限」讲清楚，否则部署后谁都进不来。 */
function AdminNoAccess({
  kind,
  who,
  roles,
}: {
  kind: 'login' | 'role'
  who?: string
  roles?: string[]
}) {
  const [noAdmin, setNoAdmin] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const supported = adminBootstrapSupported()

  useEffect(() => {
    if (kind !== 'role' || !supported) return
    let alive = true
    queryHasAnyAdmin().then((v) => {
      if (alive) setNoAdmin(v)
    })
    return () => {
      alive = false
    }
  }, [kind, supported])

  async function claim() {
    setBusy(true)
    setMsg('')
    const r = await bootstrapAdmin()
    setMsg(r.msg)
    setBusy(false)
    if (r.ok) setTimeout(() => window.location.reload(), 600)
  }

  if (kind === 'login') {
    return (
      <div className="page-grid single">
        <div>
          <h2 className="page-title">🛡️ 管理后台</h2>
          <div className="card" style={{ padding: 16 }}>
            <p>管理后台仅对已登录的 admin 账号开放。</p>
            <p style={{ marginTop: 8 }}>
              <a className="btn" href="#/login">
                🔐 去登录
              </a>
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">🛡️ 管理后台</h2>
        <div className="card" style={{ padding: 16 }}>
          <p>
            当前账号：<b>{who ?? '—'}</b> · 角色：{roles?.join(' / ') || '—'}
          </p>
          <p style={{ marginTop: 8 }}>该账号没有 admin 角色，因此看不到管理后台。</p>

          {noAdmin === true && supported ? (
            <div style={{ marginTop: 12 }}>
              <p>当前系统还没有任何管理员，你可以成为第一个（成功后该入口自动关闭）：</p>
              <button className="btn" disabled={busy} onClick={claim} style={{ marginTop: 8 }}>
                {busy ? '提交中…' : '👑 成为首个管理员'}
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <p>获得权限的方式（二选一）：</p>
              <ol style={{ marginTop: 6, paddingLeft: 20 }}>
                <li>
                  在 Supabase Dashboard → SQL Editor 执行（把用户名换成你自己的）：
                  <pre
                    style={{
                      marginTop: 6,
                      padding: 10,
                      background: 'var(--bg-soft, #f5f5f5)',
                      borderRadius: 6,
                      overflowX: 'auto',
                    }}
                  >
                    select public.grant_admin_by_name('你的用户名');
                  </pre>
                  脚本文件见仓库 <code>supabase/grant-admin.sql</code>。
                </li>
                <li style={{ marginTop: 6 }}>
                  本地/CI 执行 <code>npm run admin:grant -- 你的用户名</code>（需配置
                  SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF）。
                </li>
              </ol>
              {!supported ? (
                <p style={{ marginTop: 8 }}>
                  当前为 CloudBase 备后端，无上述 RPC；请在云端数据库中直接插入 user_roles 记录。
                </p>
              ) : null}
            </div>
          )}
          {msg ? <p style={{ marginTop: 10 }}>{msg}</p> : null}
        </div>
      </div>
    </div>
  )
}

function AdminHomePage() {
  const { auth } = useAuth()
  return (
    <AdminGate>
      <div className="page-grid single">
        <div>
          <h2 className="page-title">🛡️ 管理后台</h2>
          <div className="card" style={{ padding: 16 }}>
            <p>
              当前账号：{auth.email ?? auth.userId} · 角色：{auth.roles.join(' / ') || '—'}
            </p>
            <p style={{ marginTop: 8 }}>
              <a href="#/admin/audit">📜 审计日志</a> · <a href="#/admin/roles">👥 角色管理</a>
            </p>
          </div>
        </div>
      </div>
    </AdminGate>
  )
}

function AdminAuditPage() {
  const { hasPerm } = useAuth()
  const [logs, setLogs] = useState<AuditLogRow[] | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchAuditLogs()
      .then((r) => {
        if (!alive) return
        setLogs(r)
        if (r === null) setErr('读取审计日志失败（需云端登录且具备 audit:view 权限）')
      })
      .catch((e: unknown) => {
        if (alive) setErr(e instanceof Error ? e.message : '读取审计日志失败')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <AdminGate>
      <div className="page-grid single">
        <div>
          <h2 className="page-title">📜 审计日志</h2>
          {loading ? (
            <div className="card" style={{ padding: 16 }}>
              <p className="muted" style={{ margin: 0 }}>加载中…</p>
            </div>
          ) : !hasPerm('audit:view') ? (
            <div className="card" style={{ padding: 16 }}>
              <Empty emoji="🛡️" text="缺少 audit:view 权限" />
            </div>
          ) : err ? (
            <div className="card" style={{ padding: 16 }}>
              <p style={{ color: '#e5484d', margin: 0 }}>{err}</p>
            </div>
          ) : !logs || logs.length === 0 ? (
            <div className="card" style={{ padding: 16 }}>
              <Empty emoji="📜" text="暂无审计记录（操作行为将按 append-only 写入 audit_logs）" />
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}>
                <thead>
                  <tr style={{ textAlign: 'left', background: 'var(--card-2, #f5f6f8)' }}>
                    <th style={thCell}>时间</th>
                    <th style={thCell}>操作</th>
                    <th style={thCell}>对象</th>
                    <th style={thCell}>操作者</th>
                    <th style={thCell}>详情</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} style={{ borderTop: '1px solid var(--line, #e6e8ec)' }}>
                      <td style={tdCell}>{fmtTs(l.createdAt)}</td>
                      <td style={tdCell}><span className="tag">{l.action}</span></td>
                      <td style={tdCell}>
                        {l.targetType || '—'}
                        {l.targetId ? ` · ${shortId(l.targetId)}` : ''}
                      </td>
                      <td style={tdCell}>{shortId(l.actorId)}</td>
                      <td style={tdCell}>
                        <code style={{ fontSize: 12 }}>{detailStr(l.detail)}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminGate>
  )
}

function AdminRolesPage() {
  const { hasPerm } = useAuth()
  const [roles, setRoles] = useState<IamRole[] | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchIamRoles()
      .then((r) => {
        if (!alive) return
        setRoles(r)
        if (r === null) setErr('读取角色数据失败（需云端登录且具备 role:manage 权限）')
      })
      .catch((e: unknown) => {
        if (alive) setErr(e instanceof Error ? e.message : '读取角色数据失败')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <AdminGate>
      <div className="page-grid single">
        <div>
          <h2 className="page-title">👥 角色管理</h2>
          {loading ? (
            <div className="card" style={{ padding: 16 }}>
              <p className="muted" style={{ margin: 0 }}>加载中…</p>
            </div>
          ) : !hasPerm('role:manage') ? (
            <div className="card" style={{ padding: 16 }}>
              <Empty emoji="🛡️" text="缺少 role:manage 权限" />
            </div>
          ) : err ? (
            <div className="card" style={{ padding: 16 }}>
              <p style={{ color: '#e5484d', margin: 0 }}>{err}</p>
            </div>
          ) : !roles || roles.length === 0 ? (
            <div className="card" style={{ padding: 16 }}>
              <Empty emoji="👥" text="暂无角色数据（请先执行 IAM 迁移 0001 并分配角色）" />
            </div>
          ) : (
            <div>
              {roles.map((r) => (
                <div className="card" key={r.id} style={{ marginBottom: 10, padding: 14 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: 8,
                    }}
                  >
                    <strong style={{ fontSize: 16 }}>{r.name}</strong>
                    <span className="muted" style={{ fontSize: 12, flexShrink: 0 }}>
                      {r.members} 名成员
                    </span>
                  </div>
                  <p className="muted" style={{ margin: '4px 0 8px', fontSize: 13 }}>
                    {r.description || '—'}
                  </p>
                  {r.permissionKeys.length === 0 ? (
                    <span className="muted" style={{ fontSize: 12 }}>无权限点</span>
                  ) : (
                    <div className="chip-row">
                      {r.permissionKeys.map((k) => (
                        <span className="chip" key={k}>
                          {k}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminGate>
  )
}

/* 搜索历史键 / 读取 / 热搜标签底色已统一收至 src/SearchBox.tsx
   （原三处副本：App.tsx / PullSearchBar.tsx 各自维护一份，改动易漏。）
   本文件如需请从 './SearchBox' 引入 loadHeroHistory / HERO_HISTORY_KEY / HERO_TAG_BG。 */

/* 顶部 hero 右侧用户菜单：账号登录态入口（游客 / 云端账号）。
   meId 仅决定内容作者视角；账号（guest/cloud）决定云端数据边界，见 auth.tsx。 */
function UserMenu() {
  const api = useApp()
  const { auth, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  /* 点击面板外部关闭 */
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="usermenu" ref={boxRef}>
      <button className="usermenu-trigger" title="账号与身份" onClick={() => setOpen((v) => !v)}>
        <Avatar emoji={api.me.emoji} color={api.me.color} size={32} />
      </button>
      {open && (
        <div className="usermenu-drop">
          <div className="usermenu-head">
            <Avatar emoji={api.me.emoji} color={api.me.color} size={38} />
            <div>
              <b>{api.me.name}</b>
              <small>{auth.mode === 'cloud' ? (auth.username ?? auth.email ?? '云端账号') : '游客（未登录）'}</small>
            </div>
          </div>
          <div className="usermenu-sec">账号</div>
          {auth.mode === 'cloud' ? (
            <button
              className="usermenu-item"
              onClick={() => {
                void signOut()
                setOpen(false)
              }}
            >
              <span className="usermenu-ico">🚪</span> 退出登录
            </button>
          ) : (
            <a className="usermenu-item" href="#/login" onClick={() => setOpen(false)}>
              <span className="usermenu-ico">🔑</span>
              登录 / 注册
            </a>
          )}
          <a className="usermenu-item" href="#/my" onClick={() => setOpen(false)}>
            <span className="usermenu-ico">👤</span> 个人空间
          </a>
        </div>
      )}
    </div>
  )
}

/* 顶部 hero：深色星空横幅 + 右上工具区 + 居中 logo + 完整搜索模块（下拉：历史/热搜/联想/清空） */
function WbHero() {
  const { path } = useRouter()
  const { auth } = useAuth()
  const [theme, setTheme] = useTheme()
  const heroRef = useRef<HTMLElement>(null)

  /* 搜索模块的词/历史/联想/失焦状态已统一收至 <SearchField>（v3 三处合并）；
     顶部细搜索栏改为常驻组件自行做「下滑隐藏 / 上滑滑入」的滚动联动，见 StickySearchBar。 */
  return (
    <>
      <StickySearchBar heroRef={heroRef} />
      <header className="wb-hero" ref={heroRef}>
      <div className="wb-hero-top">
        <button
          className="icon-btn"
          title={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        {/* 统一登录入口（微博 newlogin 模式）：未登录时显性呈现，携带当前页路径，登录后回跳来源页 */}
        {auth.mode !== 'cloud' && (
          <a className="btn btn-primary btn-sm" href={`#/login?url=${encodeURIComponent(path)}`}>
            登录 / 注册
          </a>
        )}
        <UserMenu />
      </div>
      <a className="wb-hero-logo" href="#/feed">
        <i>👁️</i>
        <b>Mim</b>
        <small>mim.com</small>
      </a>
      <SearchField variant="hero" />
    </header>
    </>
  )
}

/* ---------- 固定顶栏（滚动过 hero 后出现，复刻微博机制：条件渲染硬切换） ---------- */

/* ---------- 顶部细搜索栏：滚动联动（下滑隐藏 / 上滑滑入），替代原来的条件渲染硬切换 ---------- */

function StickySearchBar({ heroRef }: { heroRef: RefObject<HTMLElement | null> }) {
  const visible = useStickyBar(heroRef)
  return (
    <div className={cx('wb-fixedbar', 'is-linked', visible && 'is-shown')}>
      <SearchField variant="fixed" />
    </div>
  )
}

/* ---------- 全站页脚（联系我们 / 站点链接 / 友情链接 / 备案资质 / 版权） ---------- */

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-in">
        <div className="site-footer-contact">
          <b>联系我们</b>
          <p>工作时间：8:30 - 22:00</p>
          <p>
            客服电话：<a href="tel:4006600108">400-660-0108</a>
          </p>
          <p>
            <a href="mailto:kefu@mim.com">kefu@mim.com</a> · <a href="#/mail">在线客服</a>
          </p>
        </div>

        <div className="site-footer-links">
          <a href="#/info/about">关于我们</a>
          <a href="#/info/join">招贤纳士</a>
          <a href="#/info/coop">商务合作</a>
          <a href="#/info/media">寻求报道</a>
          <a href="#/info/terms">协议专区</a>
        </div>

        <div className="site-footer-block">
          <b className="site-footer-title">友情链接</b>
          <div className="site-footer-links">
            <a href="https://www.vcg.com" target="_blank" rel="noreferrer">视觉中国</a>
            <a href="https://500px.com.cn" target="_blank" rel="noreferrer">500px</a>
            <a href="https://www.zhipin.com" target="_blank" rel="noreferrer">直聘网</a>
            <a href="https://www.uisdc.com" target="_blank" rel="noreferrer">优设网</a>
            <a href="https://github.com" target="_blank" rel="noreferrer">GitHub</a>
            <a href="https://stackoverflow.com" target="_blank" rel="noreferrer">Stack Overflow</a>
            <a href="https://developer.mozilla.org" target="_blank" rel="noreferrer">MDN</a>
          </div>
        </div>

        <div className="site-footer-beian">
          <p>
            <a href="https://beian.miit.gov.cn" target="_blank" rel="noreferrer">京ICP备19004658号</a>
            <i className="site-footer-sep">|</i>
            <a href="#/info/op-beian">经营性网站备案信息</a>
            <i className="site-footer-sep">|</i>
            <a href="https://beian.mps.gov.cn" target="_blank" rel="noreferrer">公安备案号11010502030143</a>
            <i className="site-footer-sep">|</i>
            <a href="#/info/license">营业执照</a>
          </p>
          <p>
            <a href="#/info/bj-report">北京互联网违法和不良信息举报中心</a>
            <i className="site-footer-sep">|</i>
            <a href="#/info/parent">家长监护</a>
            <i className="site-footer-sep">|</i>
            <a href="#/info/cn-report">中国互联网举报中心</a>
            <i className="site-footer-sep">|</i>
            <a href="#/info/police110">网络110报警服务</a>
            <i className="site-footer-sep">|</i>
            <a href="#/info/chrome">Chrome商店下载</a>
          </p>
          <p>
            <a href="#/info/account-rules">账号管理规范</a>
            <i className="site-footer-sep">|</i>
            <a href="#/info/disclaimer">版权与免责声明</a>
            <i className="site-footer-sep">|</i>
            <a href="#/info/appeal">版权申诉</a>
            <i className="site-footer-sep">|</i>
            <a href="#/info/publish-license">出版物许可证</a>
          </p>
        </div>

        <p className="site-footer-copy">©2026 Mim · 内容聚合社区 · V{APP_VERSION}</p>
      </div>
    </footer>
  )
}

/* ---------- 移动端精简页脚（桌面隐藏，≤860px 顶栏模式时显示于页面底部） ---------- */

function SiteFooterMini() {
  return (
    <footer className="site-footer-mini">
      <div className="site-footer-mini-links">
        <a href="#/info/about">关于我们</a>
        <i className="site-footer-sep">|</i>
        <a href="#/info/disclaimer">版权与免责声明</a>
        <i className="site-footer-sep">|</i>
        <a href="#/info/account-rules">账号管理规范</a>
        <i className="site-footer-sep">|</i>
        <a href="tel:4006600108">客服电话</a>
      </div>
      <p className="site-footer-mini-beian">
        <a href="https://beian.miit.gov.cn" target="_blank" rel="noreferrer">京ICP备19004658号</a>
        <i className="site-footer-sep">|</i>
        <a href="https://beian.mps.gov.cn" target="_blank" rel="noreferrer">公安备案号11010502030143</a>
      </p>
      <p className="site-footer-mini-copy">©2026 Mim · 内容聚合社区 · V{APP_VERSION}</p>
    </footer>
  )
}

function Shell() {
  const toast = useToast()

  useEffect(() => {
    if (!window.location.hash) window.location.hash = '#/feed'
    /* 移动端 OTA 自动更新（web/桌面 no-op：桌面由 Tauri updater 静默处理） */
    scheduleOtaCheck((msg) => toast(msg))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      {/* 轮 20 打通：青少年模式全站顶部横幅（开启期间常驻） */}
      <TeenBanner />
      {/* 轮 21 打通：定时发布 App 级轮询（挂载即检 + 每 30s 一轮，到点经现有发布 api 入库） */}
      <ScheduledTicker />
      <WbHero />
      {/* 微博式下拉揭示搜索栏：全局常驻，任意页面顶部下拉手势即可揭示 */}
      <PullSearchBar />
      <div className="shell">
        <SideNav />
        <main className="app-shell">
          <Page />
        </main>
      </div>
      <SiteFooterMini />
      <WelcomeModal />
    </>
  )
}

export default function App() {
  return (
    <PlayerProvider>
      <AppProvider>
        <ToastProvider>
          <AuthProvider>
            <MallProvider>
              <RouterProvider>
                <Shell />
              </RouterProvider>
            </MallProvider>
          </AuthProvider>
        </ToastProvider>
      </AppProvider>
    </PlayerProvider>
  )
}
