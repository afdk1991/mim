import { useEffect } from 'react'
import { AppProvider, useApp } from './store'
import { RouterProvider, useRouter } from './router'
import { Avatar, Empty, ToastProvider } from './components'
import {
  FavoritesPage,
  FeedPage,
  MessagesPage,
  MyProfilePage,
  NotificationsPage,
  PostDetailPage,
  ProfilePage,
  TopicPage,
} from './weibo'
import {
  ArticleDetailPage,
  ArticleEditorPage,
  ArticlesPage,
  BlogHomePage,
  ResourcesPage,
  SearchPage,
  SnippetsPage,
} from './csdn'
import { cx } from './utils'

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
  { href: '#/notifications', match: '/notifications', label: '通知', badgeKey: 'notif' },
  { href: '#/messages', match: '/messages', label: '私信', badgeKey: 'msg' },
  { href: '#/favorites', match: '/favorites', label: '收藏' },
  { href: '#/my', match: '/my', label: '我的主页' },
]

function TopNav() {
  const api = useApp()
  const { path } = useRouter()

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="#/feed">Mim</a>
        <div className="topbar-right">
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
    case 'notifications':
      return <NotificationsPage />
    case 'messages':
      return <MessagesPage />
    case 'favorites':
      return <FavoritesPage />
    case 'my':
      return <MyProfilePage />
    case 'user':
      return param ? <ProfilePage id={param} /> : <Empty text="缺少用户 id" />

    /* ---------- CSDN ---------- */
    case 'articles':
      return <ArticlesPage />
    case 'article':
      return param ? <ArticleDetailPage id={param} /> : <Empty text="缺少文章 id" />
    case 'write':
      return <ArticleEditorPage draftId={param} />
    case 'blog':
      return <BlogHomePage />
    case 'snippets':
      return <SnippetsPage />
    case 'resources':
      return <ResourcesPage />
    case 'search':
      return <SearchPage key={query.get('q') ?? ''} />

    default:
      return <Empty emoji="🧭" text="页面不存在，检查一下地址吧" />
  }
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
