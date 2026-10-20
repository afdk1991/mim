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
import { MallProvider } from './mall/store'
import { AuthProvider, useAuth } from './auth'
import { LoginPage } from './login'
import { MallHomePage } from './mall/MallHome'
import { MallGoodsPage } from './mall/MallGoods'
import { MallCartPage } from './mall/MallCart'
import { MallOrdersPage } from './mall/MallOrders'
import { MallWalletPage } from './mall/MallWallet'
import { clearHistory, cx, formatCount, loadHistory } from './utils'
import { scheduleOtaCheck } from './ota'
import { WelcomeModal } from './welcome'

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

/* 低频内容页 + 9 个工具台：收敛进「工具箱」下拉，避免一级导航平铺 20+ 项 */
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

function SideNav() {
  const api = useApp()
  const { path } = useRouter()
  const [open, setOpen] = useState<string | null>(null)

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
      return param ? <PostDetailPage id={param} /> : <Empty text="缺少动态 id" />
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
    case 'login':
      return <LoginPage />

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

/* 仿微博顶部 hero：深色星空横幅 + 右上工具区 + 居中 logo + 完整搜索模块（下拉：历史/热搜/联想/清空） */
function WbHero() {
  const api = useApp()
  const { navigate } = useRouter()
  const [theme, setTheme] = useTheme()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hist, setHist] = useState<string[]>(loadHeroHistory)
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

  /* 输入联想：话题 + 用户 */
  const kw = q.trim().toLowerCase()
  const topicHints = kw
    ? api.state.topics.filter((t) => t.name.toLowerCase().includes(kw)).slice(0, 4)
    : []
  const userHints = kw
    ? Object.values(api.state.users)
        .filter((u) => u.name.toLowerCase().includes(kw) || u.bio.toLowerCase().includes(kw))
        .slice(0, 4)
    : []
  const noHint = kw.length > 0 && topicHints.length === 0 && userHints.length === 0

  return (
    <header className="wb-hero">
      <div className="wb-hero-top">
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
            placeholder="搜索 Mim 内容"
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
                {noHint && (
                  <div className="wb-hero-drop-empty">没有找到相关内容，按回车直接搜索「{q.trim()}」</div>
                )}
              </>
            )}
          </div>
        )}
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
