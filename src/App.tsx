import { useEffect, useState } from 'react'
import { AppProvider, useApp } from './store'
import { RouterProvider, useRouter } from './router'
import { Avatar, Empty, TimeAgo, ToastProvider } from './components'
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
import { clearHistory, cx, loadHistory } from './utils'

type NavItem = { href: string; match: string; label: string; badgeKey?: 'notif' | 'msg' }

/** 单一导航：微博与 CSDN 全部功能模块平铺为入口 */
const NAV: NavItem[] = [
  { href: '#/feed', match: '/feed', label: '首页' },
  { href: '#/articles', match: '/article', label: '文章' },
  { href: '#/write', match: '/write', label: '写文章' },
  { href: '#/blog', match: '/blog', label: '我的博客' },
  { href: '#/snippets', match: '/snippets', label: '代码片段' },
  { href: '#/resources', match: '/resources', label: '资源下载' },
  { href: '#/search', match: '/search', label: '搜索' },
  { href: '#/topics', match: '/topics', label: '超话' },
  { href: '#/tags', match: '/tags', label: '标签' },
  { href: '#/notifications', match: '/notifications', label: '通知', badgeKey: 'notif' },
  { href: '#/messages', match: '/messages', label: '私信', badgeKey: 'msg' },
  { href: '#/favorites', match: '/favorites', label: '收藏' },
  { href: '#/history', match: '/history', label: '足迹' },
  { href: '#/my', match: '/my', label: '我的主页' },
  { href: '#/delivery', match: '/delivery', label: '配送台' },
  { href: '#/price', match: '/price', label: '价格监控' },
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

function TopNav() {
  const api = useApp()
  const { path } = useRouter()
  const [theme, setTheme] = useState<'light' | 'dark'>(loadTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="#/feed">Mim</a>
        <div className="topbar-right">
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
      </div>
      <nav className="topbar-inner" style={{ height: 40, paddingTop: 8 }}>
        <div className="subnav">
          {NAV.map((item) => {
            const active = path.startsWith(item.match)
            const badge =
              item.badgeKey === 'notif' ? api.unreadNotifications : item.badgeKey === 'msg' ? api.unreadMessages : 0
            return (
              <a key={item.match} href={item.href} className={cx(active && 'active')}>
                {item.label}
                {badge > 0 && <span className="nav-badge">{badge > 99 ? '99+' : badge}</span>}
              </a>
            )
          })}
        </div>
      </nav>
    </header>
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

    /* ---------- 工具台 ---------- */
    case 'delivery':
      return <DeliveryBoardPage />
    case 'price':
      return <PriceMonitorPage />

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

function Shell() {
  useEffect(() => {
    if (!window.location.hash) window.location.hash = '#/feed'
  }, [])

  return (
    <>
      <TopNav />
      <main className="app-shell">
        <Page />
      </main>
    </>
  )
}

export default function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <RouterProvider>
          <Shell />
        </RouterProvider>
      </ToastProvider>
    </AppProvider>
  )
}
