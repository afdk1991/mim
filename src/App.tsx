import './search-box.css'
import { useEffect, useRef, useState } from 'react'
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
import { matchSearchPages } from './search-index'
import { VipCenterPage } from './vip'
import { LoginPage } from './login'
import { InfoPage } from './info'
import { MallHomePage } from './mall/MallHome'
import { MallGoodsPage } from './mall/MallGoods'
import { MallCartPage } from './mall/MallCart'
import { MallOrdersPage } from './mall/MallOrders'
import { MallWalletPage } from './mall/MallWallet'
import { GrowthPage } from './growth'
import { PublishPage } from './publish'
import { WalletPage } from './wallet'
import { clearHistory, cx, formatCount, loadHistory } from './utils'
import { scheduleOtaCheck } from './ota'
import { WelcomeModal } from './welcome'
import { SettingsPage } from './settings'
import { LivePage } from './media-domain' /* 轮 24 打通：B5 直播推拉流/连麦（模拟） */
import { TeenBanner } from './user-domain'
import { ScheduledTicker } from './content-domain'
import { RanksPage, VideosPage } from './feed-domain' /* 轮 23 打通：B4 视频沉浸流 / 榜单体系路由 */
import './viewswitch.css'

/** 视图模式：广场态（消费/社交/交易）与知识态（生产/学习/开发工具） */
type ViewMode = 'feed' | 'kb'

type NavItem = {
  href: string
  match: string
  label: string
  icon?: string
  badgeKey?: 'notif' | 'msg'
  children?: NavItem[]
  /** 视图归属（开发吧.md 文档三「一个平台三种视图」）：缺省 = 广场/知识双视图可见 */
  views?: ViewMode[]
}

/** 单一导航：全量一级平铺（低频入口不再收纳进「工具箱」，直接可见，搜索/导航双闭环）。
    views 按《开发吧.md》合并矩阵标注视图归属：生活/社交/交易域 → 广场态；
    生产/学习/开发工具域 → 知识态；不标 = 双视图共用（我的/会员）。 */
const NAV: NavItem[] = [
  { href: '#/feed', match: '/feed', label: '首页', icon: '🏠', views: ['feed'] },
  { href: '#/articles', match: '/article', label: '文章', icon: '📝', views: ['kb'] },
  { href: '#/write', match: '/write', label: '写文章', icon: '✍️', views: ['kb'] },
  { href: '#/topics', match: '/topics', label: '超话', icon: '🔥', views: ['feed'] },
  { href: '#/notifications', match: '/notifications', label: '通知', icon: '🔔', badgeKey: 'notif', views: ['feed'] },
  { href: '#/messages', match: '/messages', label: '私信', icon: '✉️', badgeKey: 'msg', views: ['feed'] },
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
      { href: '#/settings', match: '/settings', label: '设置' },
    ],
  },
  {
    href: '#/mall',
    match: '/mall',
    label: '商城',
    icon: '🛒',
    views: ['feed'],
    children: [
      { href: '#/mall', match: '/mall', label: '商城中心' },
      { href: '#/mall/cart', match: '/mall/cart', label: '购物车' },
      { href: '#/mall/orders', match: '/mall/orders', label: '订单' },
      { href: '#/mall/wallet', match: '/mall/wallet', label: '钱包' },
    ],
  },
  { href: '#/vip', match: '/vip', label: 'VIP 会员', icon: '👑' },
  { href: '#/growth', match: '/growth', label: '成长引擎', icon: '🚀' },
  { href: '#/publish', match: '/publish', label: '发布器', icon: '📤' },
  { href: '#/live', match: '/live', label: '直播开播', icon: '📡', views: ['feed'] }, /* 轮 24 打通：B5 直播开播台入口 */
  { href: '#/wallet', match: '/wallet', label: '统一钱包', icon: '💰' },
  { href: '#/snippets', match: '/snippets', label: '代码片段', icon: '💻', views: ['kb'] },
  { href: '#/resources', match: '/resources', label: '资源下载', icon: '📦', views: ['kb'] },
  { href: '#/tags', match: '/tags', label: '标签', icon: '🏷️', views: ['kb'] },
  { href: '#/delivery', match: '/delivery', label: '配送台', icon: '🚚', views: ['feed'] },
  { href: '#/price', match: '/price', label: '价格监控', icon: '📈', views: ['feed'] },
  { href: '#/nav', match: '/nav', label: '路线导航', icon: '🗺️', views: ['feed'] },
  { href: '#/mail', match: '/mail', label: '邮箱', icon: '📬', views: ['feed'] },
  { href: '#/bom', match: '/bom', label: 'BOM 工具台', icon: '🖥️', views: ['kb'] },
  { href: '#/coze', match: '/coze', label: '智能体', icon: '🤖', views: ['kb'] },
  { href: '#/ai', match: '/ai', label: 'AI 资源', icon: '📚', views: ['kb'] },
  { href: '#/manju', match: '/manju', label: '漫剧', icon: '🎬', views: ['feed'] },
  { href: '#/ardot', match: '/ardot', label: '聚合监控', icon: '📊', views: ['kb'] },
  { href: '#/mall/youxuan', match: '/mall/youxuan', label: '优选商城', icon: '🛍️', views: ['feed'] },
  { href: '#/mall/live', match: '/mall/live', label: '直播带货', icon: '📺', views: ['feed'] },
  { href: '#/mall/mix', match: '/mall/mix', label: '本地生活', icon: '🍜', views: ['feed'] },
  { href: '#/mall/laal', match: '/mall/laal', label: '出行服务', icon: '🚗', views: ['feed'] },
  { href: '#/mall/gexm', match: '/mall/gexm', label: '秒杀特惠', icon: '⚡', views: ['feed'] },
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

/* ---------- 三视图（开发吧.md 文档三：广场态/知识态模式开关） ---------- */

const VIEW_KEY = 'mim-view-mode'

function loadView(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    if (v === 'feed' || v === 'kb') return v
  } catch {
    /* ignore */
  }
  return 'feed'
}

function useViewMode() {
  const [view, setView] = useState<ViewMode>(loadView)
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view)
    } catch {
      /* ignore */
    }
  }, [view])
  return [view, setView] as const
}

/** 当前视图下可见的导航项：未标注 views 的条目（我的/会员）双视图常驻 */
function navInView(items: NavItem[], view: ViewMode): NavItem[] {
  return items.filter((it) => !it.views || it.views.includes(view))
}

function SideNav() {
  const api = useApp()
  const { path, navigate } = useRouter()
  const [view, setView] = useViewMode()
  const [open, setOpen] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [dropOpen, setDropOpen] = useState(false)

  const visible = navInView(NAV, view)

  /* 路由变化后自动展开包含当前页的分组 */
  useEffect(() => {
    for (const item of visible) {
      if (!item.children) continue
      if (path.startsWith(item.match) || item.children.some((k) => path.startsWith(k.match))) {
        setOpen(item.label)
        return
      }
    }
  }, [path, view])

  /* 切换视图：若当前页不属于新视图可见范围，则跳到该视图的默认首页 */
  const switchView = (v: ViewMode) => {
    if (v === view) return
    setView(v)
    const hit = navInView(NAV, v).some(
      (item) => path.startsWith(item.match) || item.children?.some((k) => path.startsWith(k.match)),
    )
    if (!hit) navigate(v === 'kb' ? '#/articles' : '#/feed')
  }

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
      {/* 三视图切换器：广场态/知识态合并为单按钮，点击在两视图间切换（开发吧.md 文档三「一个平台三种视图」） */}
      <button
        type="button"
        key={view}
        className="vw-toggle"
        title={`切换到${view === 'feed' ? '知识态' : '广场态'}`}
        onClick={() => switchView(view === 'feed' ? 'kb' : 'feed')}
      >
        <span aria-hidden="true">{view === 'feed' ? '🎬' : '📚'}</span>
        <span className="vw-toggle-label">{view === 'feed' ? '广场态' : '知识态'}</span>
        <span className="vw-toggle-swap" aria-hidden="true">⇄</span>
      </button>
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
    /* 轮 24 打通：B5 多媒体——直播推拉流/连麦（模拟开播台） */
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

const HERO_HISTORY_KEY = 'mim-search-history'

function loadHeroHistory(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HERO_HISTORY_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

/* 热搜标签底色：沸红 / 热橙 / 爆黄 / 新蓝 */
const HERO_TAG_BG: Record<string, string> = {
  沸: '#e64340',
  热: '#ff8200',
  爆: '#f59e0b',
  新: '#2b9cf4',
}

/* 顶部 hero 右侧用户菜单：演示身份切换 + 账号登录态入口。
   演示身份（meId）决定内容作者视角；账号（cloud/local）决定云端数据边界，见 auth.tsx。 */
function UserMenu() {
  const api = useApp()
  const { auth, cloudEnabled, signOut } = useAuth()
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
              <small>{auth.mode === 'cloud' ? (auth.email ?? '云端账号') : '本地演示模式'}</small>
            </div>
          </div>
          <div className="usermenu-sec">演示身份</div>
          {Object.values(api.state.users).map((u) => (
            <button
              key={u.id}
              className={cx('usermenu-item', u.id === api.state.meId && 'active')}
              onClick={() => {
                api.switchDemoUser(u.id)
                setOpen(false)
              }}
            >
              <Avatar emoji={u.emoji} color={u.color} size={22} />
              {u.name}
              {u.id === api.state.meId && <em className="usermenu-check">✓</em>}
            </button>
          ))}
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
              {cloudEnabled ? '登录 / 注册' : '登录（本地演示）'}
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
  const api = useApp()
  const { navigate, path } = useRouter()
  const { auth } = useAuth()
  const [theme, setTheme] = useTheme()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hist, setHist] = useState<string[]>(loadHeroHistory)
  const boxRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLElement>(null)
  /* 复刻微博机制：滚动超过 hero 高度后条件渲染 fixed 顶栏（硬切换，无动画） */
  const [fixedBar, setFixedBar] = useState(false)

  useEffect(() => {
    const onScroll = () => setFixedBar(window.scrollY > (heroRef.current?.offsetHeight ?? 0))
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  /* 点击面板外部关闭 */
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const saveHist = (t: string) => {
    setHist((h) => {
      const next = [t, ...h.filter((x) => x !== t)].slice(0, 8)
      try {
        localStorage.setItem(HERO_HISTORY_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }
  const removeHist = (t: string) => {
    setHist((h) => {
      const next = h.filter((x) => x !== t)
      try {
        localStorage.setItem(HERO_HISTORY_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }
  const clearHist = () => {
    setHist([])
    try {
      localStorage.removeItem(HERO_HISTORY_KEY)
    } catch {
      /* ignore */
    }
  }

  const go = (word?: string) => {
    const kw = (word ?? q).trim()
    if (!kw) return
    saveHist(kw)
    setOpen(false)
    navigate(`/search?q=${encodeURIComponent(kw)}`)
  }

  /* 输入联想：功能入口 + 话题 + 用户 + 文章（全站搜索） */
  const kw = q.trim().toLowerCase()
  const pageHints = kw ? matchSearchPages(q).slice(0, 3) : []
  const topicHints = kw
    ? api.state.topics.filter((t) => t.name.toLowerCase().includes(kw)).slice(0, 4)
    : []
  const userHints = kw
    ? Object.values(api.state.users)
        .filter((u) => u.name.toLowerCase().includes(kw) || u.bio.toLowerCase().includes(kw))
        .slice(0, 4)
    : []
  const articleHints = kw
    ? api.state.articles.filter((a) => a.title.toLowerCase().includes(kw)).slice(0, 3)
    : []
  const noHint =
    kw.length > 0 &&
    pageHints.length === 0 &&
    topicHints.length === 0 &&
    userHints.length === 0 &&
    articleHints.length === 0

  return (
    <>
      {fixedBar && <WbFixedBar />}
      <header className="wb-hero" ref={heroRef}>
      <div className="wb-hero-top">
        <button
          className="icon-btn"
          title={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        {/* 重置的是本地演示种子（seed.ts），云端模式下数据在云端、无演示概念，隐藏入口 */}
        {auth.mode !== 'cloud' && (
          <button
            className="icon-btn"
            title="重置演示数据"
            onClick={() => {
              if (window.confirm('确定要重置所有演示数据吗？')) api.resetDemo()
            }}
          >
            ♻️
          </button>
        )}
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
      <div className="wb-hero-search" ref={boxRef}>
        <div className="wb-hero-bar">
          <span aria-hidden>🔍</span>
          <input
            type="search"
            placeholder="搜索全站内容与功能"
            value={q}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQ(e.target.value)
              setOpen(true)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') go()
              if (e.key === 'Escape') setOpen(false)
            }}
          />
          {q && (
            <button
              className="wb-hero-clear"
              aria-label="清空"
              onClick={() => {
                setQ('')
                setOpen(true)
              }}
            >
              ×
            </button>
          )}
        </div>
        <button className="wb-hero-btn" onClick={() => go()}>
          搜索
        </button>

        {open && (
          <div className="wb-hero-drop">
            {!kw && (
              <>
                {hist.length > 0 && (
                  <>
                    <div className="wb-hero-drop-title">
                      搜索历史
                      <button className="wb-hero-clear-all" onClick={clearHist}>
                        清空
                      </button>
                    </div>
                    <div className="wb-hero-chips">
                      {hist.map((h) => (
                        <span key={h} className="wb-hero-chip">
                          <button className="wb-hero-chip-word" onClick={() => go(h)}>
                            {h}
                          </button>
                          <button
                            className="wb-hero-chip-del"
                            aria-label="删除"
                            onClick={(e) => {
                              e.stopPropagation()
                              removeHist(h)
                            }}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </>
                )}
                <div className="wb-hero-drop-title">🔥 Mim 热搜</div>
                <div className="wb-hero-drop-list">
                  {api.state.hotSearches.slice(0, 8).map((s) => (
                    <button key={s.id} className="wb-hero-drop-item" onClick={() => go(s.text)}>
                      <i className={cx('wb-hero-rank', s.rank <= 3 && 'top')}>{s.rank}</i>
                      <span className="wb-hero-drop-text">{s.text}</span>
                      {s.tag && (
                        <em className="wb-hero-tag" style={{ background: HERO_TAG_BG[s.tag] }}>
                          {s.tag}
                        </em>
                      )}
                      <small>{formatCount(s.heat)}</small>
                    </button>
                  ))}
                </div>
              </>
            )}
            {kw && (
              <>
                {pageHints.length > 0 && (
                  <>
                    <div className="wb-hero-drop-title">🧭 功能入口</div>
                    <div className="wb-hero-drop-list">
                      {pageHints.map((p) => (
                        <button
                          key={p.href}
                          className="wb-hero-drop-item"
                          onClick={() => {
                            saveHist(q.trim())
                            setOpen(false)
                            navigate(p.href.slice(1))
                          }}
                        >
                          <i className="wb-hero-ico" aria-hidden>
                            {p.icon}
                          </i>
                          <span className="wb-hero-drop-text">
                            {p.name}
                            <small>{p.group}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {topicHints.length > 0 && (
                  <>
                    <div className="wb-hero-drop-title">相关话题</div>
                    <div className="wb-hero-drop-list">
                      {topicHints.map((t) => (
                        <button key={t.id} className="wb-hero-drop-item" onClick={() => go(t.name)}>
                          <i className="wb-hero-ico" aria-hidden>
                            💬
                          </i>
                          <span className="wb-hero-drop-text">#{t.name}#</span>
                          <small>{formatCount(t.heat)}</small>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {userHints.length > 0 && (
                  <>
                    <div className="wb-hero-drop-title">相关用户</div>
                    <div className="wb-hero-drop-list">
                      {userHints.map((u) => (
                        <button key={u.id} className="wb-hero-drop-item" onClick={() => go(u.name)}>
                          <Avatar emoji={u.emoji} color={u.color} size={28} />
                          <span className="wb-hero-drop-text">
                            {u.name}
                            <small>{u.bio}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {articleHints.length > 0 && (
                  <>
                    <div className="wb-hero-drop-title">📝 相关文章</div>
                    <div className="wb-hero-drop-list">
                      {articleHints.map((a) => (
                        <button
                          key={a.id}
                          className="wb-hero-drop-item"
                          onClick={() => {
                            saveHist(q.trim())
                            setOpen(false)
                            navigate(`/article/${a.id}`)
                          }}
                        >
                          <i className="wb-hero-ico" aria-hidden>
                            📝
                          </i>
                          <span className="wb-hero-drop-text">{a.title}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {noHint && (
                  <div className="wb-hero-drop-empty">没有找到相关内容，按回车直接搜索「{q.trim()}」</div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </header>
    </>
  )
}

/* ---------- 固定顶栏（滚动过 hero 后出现，复刻微博机制：条件渲染硬切换） ---------- */

function WbFixedBar() {
  const api = useApp()
  const { navigate } = useRouter()
  const [q, setQ] = useState('')
  const [dropOpen, setDropOpen] = useState(false)
  const [hist, setHist] = useState<string[]>(loadHeroHistory)
  const boxRef = useRef<HTMLDivElement>(null)

  /* 点击面板外部关闭 */
  useEffect(() => {
    if (!dropOpen) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setDropOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [dropOpen])

  const saveHist = (t: string) => {
    setHist((h) => {
      const next = [t, ...h.filter((x) => x !== t)].slice(0, 8)
      try {
        localStorage.setItem(HERO_HISTORY_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }
  const removeHist = (t: string) => {
    setHist((h) => {
      const next = h.filter((x) => x !== t)
      try {
        localStorage.setItem(HERO_HISTORY_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }
  const clearHist = () => {
    setHist([])
    try {
      localStorage.removeItem(HERO_HISTORY_KEY)
    } catch {
      /* ignore */
    }
  }

  const go = (word?: string) => {
    const kw = (word ?? q).trim()
    if (!kw) return
    saveHist(kw)
    setQ('')
    setDropOpen(false)
    navigate(`/search?q=${encodeURIComponent(kw)}`)
  }

  /* 输入联想：功能入口 + 话题 + 用户 + 文章（与 hero 搜索模块同源） */
  const kw = q.trim().toLowerCase()
  const pageHints = kw ? matchSearchPages(q).slice(0, 3) : []
  const topicHints = kw ? api.state.topics.filter((t) => t.name.toLowerCase().includes(kw)).slice(0, 3) : []
  const userHints = kw
    ? Object.values(api.state.users)
        .filter((u) => u.name.toLowerCase().includes(kw) || u.bio.toLowerCase().includes(kw))
        .slice(0, 3)
    : []
  const articleHints = kw ? api.state.articles.filter((a) => a.title.toLowerCase().includes(kw)).slice(0, 3) : []
  const noHint =
    kw.length > 0 &&
    pageHints.length === 0 &&
    topicHints.length === 0 &&
    userHints.length === 0 &&
    articleHints.length === 0

  return (
    <div className="wb-fixedbar">
      <div className="wb-fixedbar-inner" ref={boxRef}>
        <span aria-hidden>🔍</span>
        <input
          type="search"
          placeholder="搜索全站内容与功能"
          value={q}
          onFocus={() => setDropOpen(true)}
          onChange={(e) => {
            setQ(e.target.value)
            setDropOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go()
            if (e.key === 'Escape') setDropOpen(false)
          }}
        />
        {dropOpen && !kw && hist.length > 0 && (
          <div className="sidenav-search-drop wb-fixedbar-drop">
            <div className="wb-hero-drop-title">
              搜索历史
              <button className="wb-hero-clear-all" onClick={clearHist}>
                清空
              </button>
            </div>
            <div className="wb-hero-chips">
              {hist.map((h) => (
                <span key={h} className="wb-hero-chip">
                  <button className="wb-hero-chip-word" onClick={() => go(h)}>
                    {h}
                  </button>
                  <button
                    className="wb-hero-chip-del"
                    aria-label="删除"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeHist(h)
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
        {dropOpen && kw && (
          <div className="sidenav-search-drop">
            {noHint ? (
              <button className="sidenav-search-item" onClick={() => go()}>
                没有匹配的内容，回车搜索「{q.trim()}」
              </button>
            ) : (
              <>
                {pageHints.map((p) => (
                  <button
                    key={p.href}
                    className="sidenav-search-item"
                    onClick={() => {
                      setQ('')
                      setDropOpen(false)
                      navigate(p.href.slice(1))
                    }}
                  >
                    <i aria-hidden="true">{p.icon}</i>
                    <span className="sidenav-search-name">{p.name}</span>
                    <em>{p.group}</em>
                  </button>
                ))}
                {topicHints.map((t) => (
                  <button key={t.id} className="sidenav-search-item" onClick={() => go(t.name)}>
                    <i aria-hidden="true">💬</i>
                    <span>#{t.name}#</span>
                    <em>话题</em>
                  </button>
                ))}
                {userHints.map((u) => (
                  <button key={u.id} className="sidenav-search-item" onClick={() => go(u.name)}>
                    <i aria-hidden="true">{u.emoji}</i>
                    <span className="sidenav-search-name">{u.name}</span>
                    <em>{u.bio}</em>
                  </button>
                ))}
                {articleHints.map((a) => (
                  <button
                    key={a.id}
                    className="sidenav-search-item"
                    onClick={() => {
                      setQ('')
                      setDropOpen(false)
                      navigate(`/article/${a.id}`)
                    }}
                  >
                    <i aria-hidden="true">📝</i>
                    <span>{a.title}</span>
                    <em>文章</em>
                  </button>
                ))}
                <button className="sidenav-search-item sidenav-search-all" onClick={() => go()}>
                  查看全部搜索结果
                </button>
              </>
            )}
          </div>
        )}
      </div>
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
  )
}
