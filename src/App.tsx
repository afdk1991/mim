import { useEffect, useState } from 'react'
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
import { MallProvider } from './mall/store'
import { MallHomePage } from './mall/MallHome'
import { MallGoodsPage } from './mall/MallGoods'
import { MallCartPage } from './mall/MallCart'
import { MallOrdersPage } from './mall/MallOrders'
import { MallWalletPage } from './mall/MallWallet'
import { clearHistory, cx, loadHistory } from './utils'
import { scheduleOtaCheck } from './ota'

type NavGroup = { title: string; items: NavItem[] }

type NavItem = {
  href: string
  match: string
  label: string
  icon?: string
  badgeKey?: 'notif' | 'msg'
  children?: NavItem[]
  groups?: NavGroup[]
}

/* 低频内容页 + 14 个工具台：收敛进「工具箱」下拉，避免一级导航平铺 26 项 */
const TOOLBOX_GROUPS: NavGroup[] = [
  {
    title: '内容',
    items: [
      { href: '#/snippets', match: '/snippets', label: '代码片段' },
      { href: '#/resources', match: '/resources', label: '资源下载' },
      { href: '#/tags', match: '/tags', label: '标签' },
    ],
  },
  {
    title: '工具台',
    items: [
      { href: '#/delivery', match: '/delivery', label: '配送台' },
      { href: '#/price', match: '/price', label: '价格监控' },
      { href: '#/nav', match: '/nav', label: '路线导航' },
      { href: '#/mail', match: '/mail', label: '邮箱' },
      { href: '#/bom', match: '/bom', label: 'BOM' },
      { href: '#/coze', match: '/coze', label: '智能体' },
      { href: '#/ai', match: '/ai', label: 'AI资源' },
      { href: '#/manju', match: '/manju', label: '漫剧' },
      { href: '#/ardot', match: '/ardot', label: '聚合监控' },
    ],
  },
]

/** 单一导航：一级只保留高频入口，个人空间与工具箱收进下拉 */
const NAV: NavItem[] = [
  { href: '#/feed', match: '/feed', label: '首页', icon: '🏠' },
  { href: '#/articles', match: '/article', label: '文章', icon: '📝' },
  { href: '#/write', match: '/write', label: '写文章', icon: '✍️' },
  { href: '#/topics', match: '/topics', label: '超话', icon: '🔥' },
  { href: '#/search', match: '/search', label: '搜索', icon: '🔍' },
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
  { href: '#', match: '/__toolbox__', label: '工具箱', icon: '🧰', groups: TOOLBOX_GROUPS },
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

function SideNav() {
  const api = useApp()
  const { path } = useRouter()
  const [theme, setTheme] = useState<'light' | 'dark'>(loadTheme)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  /* 路由变化后自动展开包含当前页的分组 */
  useEffect(() => {
    for (const item of NAV) {
      if (!item.children && !item.groups) continue
      const kids = item.groups ? item.groups.flatMap((g) => g.items) : (item.children ?? [])
      if (path.startsWith(item.match) || kids.some((k) => path.startsWith(k.match))) {
        setOpen(item.label)
        return
      }
    }
  }, [path])

  return (
    <aside className="sidenav">
      <a className="brand" href="#/feed">Mim</a>
      <nav className="sidenav-nav">
        {NAV.map((item) => {
          const badge =
            item.badgeKey === 'notif' ? api.unreadNotifications : item.badgeKey === 'msg' ? api.unreadMessages : 0

          /* 无子项：普通链接 */
          if (!item.children && !item.groups) {
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
          const kids = item.groups ? item.groups.flatMap((g) => g.items) : (item.children ?? [])
          const active = path.startsWith(item.match) || kids.some((k) => path.startsWith(k.match))
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
                  {item.groups
                    ? item.groups.map((g) => (
                        <div key={g.title}>
                          <div className="sidenav-sub-title">{g.title}</div>
                          {g.items.map((k) => (
                            <a
                              key={k.match}
                              href={k.href}
                              className={cx('sidenav-link sidenav-sub-link', path.startsWith(k.match) && 'active')}
                            >
                              {k.label}
                            </a>
                          ))}
                        </div>
                      ))
                    : item.children?.map((k) => (
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
      </nav>
      <div className="sidenav-foot">
        <span className="sidenav-version" title="Mim 版本号">
          V{APP_VERSION}
        </span>
        <button
          className="icon-btn"
          title={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <button
          className="icon-btn"
          title="重置演示数据"
          onClick={() => {
            if (window.confirm('确定要重置所有演示数据吗？')) api.resetDemo()
          }}
        >
          ♻️
        </button>
        <a href="#/my" title="进入个人空间">
          <Avatar emoji={api.me.emoji} color={api.me.color} size={32} />
        </a>
      </div>
    </aside>
  )
}

function Page() {
  const { path, query } = useRouter()
  const segs = path.split('/').filter(Boolean)
  const [root, param] = segs

  switch (root) {
    /* ---------- 微博 ---------- */
    case undefined:
    case 'feed':
      return <FeedPage />
    case 'post':
      return param ? <PostDetailPage id={param} /> : <Empty text="缺少微博 id" />
    case 'topic':
      return param ? <TopicPage name={decodeURIComponent(param)} /> : <Empty text="缺少话题名" />
    case 'topics':
      return <TopicRankPage />
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

    /* ---------- CSDN ---------- */
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

    /* ---------- 商城中台 ---------- */
    case 'mall': {
      if (param === 'goods') return <MallGoodsPage id={segs[2] ?? ''} />
      if (param === 'cart') return <MallCartPage />
      if (param === 'orders') return <MallOrdersPage />
      if (param === 'wallet') return <MallWalletPage />
      return <MallHomePage />
    }

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
        label: '微博',
        title: first.length > 60 ? first.slice(0, 60) + '…' : first || '查看微博',
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
          {rows.length === 0 && <Empty emoji="👣" text="还没有足迹，去看看微博和文章吧" />}
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

/* 仿微博顶部 hero：深色星空横幅 + 居中 logo + 白胶囊搜索框（拼接橙色按钮） */
function WbHero() {
  const { navigate } = useRouter()
  const [q, setQ] = useState('')

  const go = () => {
    if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`)
  }

  return (
    <header className="wb-hero">
      <a className="wb-hero-logo" href="#/feed">
        <i>👁️</i>
        <b>Mim</b>
        <small>mim.com</small>
      </a>
      <div className="wb-hero-search">
        <div className="wb-hero-bar">
          <span aria-hidden>🔍</span>
          <input
            type="search"
            placeholder="搜索微博"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') go()
            }}
          />
        </div>
        <button className="wb-hero-btn" onClick={go}>
          搜索
        </button>
      </div>
    </header>
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
      <WbHero />
      <div className="shell">
        <SideNav />
        <main className="app-shell">
          <Page />
        </main>
      </div>
    </>
  )
}

export default function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <MallProvider>
          <RouterProvider>
            <Shell />
          </RouterProvider>
        </MallProvider>
      </ToastProvider>
    </AppProvider>
  )
}
