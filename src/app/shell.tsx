/* ==========================================================================
 * Shell —— 布局骨架：顶部 hero / 侧栏导航 / 主内容 / 页脚
 *
 * 与旧实现的两点差异：
 *  1. 导航数据来自 app/nav.ts，组件不再内联 25 个入口
 *  2. 分组展开由当前路径自动推导，不依赖组件内部状态
 * ======================================================================== */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ADMIN_NAV, NAV, navMatches } from './nav'
import type { NavItem } from './nav'
import { useRouter } from './router'
import { hasRole } from '../data/session'
import { cx } from '../core/utils'
import { getSiteConfig } from '../core/runtime-config'
import { subscribe, EVT } from '../core/events'
import { APP_VERSION } from '../core/version'
import { getTheme, toggleTheme } from '../core/theme'
import { readRaw } from '../core/storage'

export function Shell({ children }: { children: ReactNode }) {
  const { path } = useRouter()
  const [, force] = useState(0)
  // F6：运行期配置回来后页脚的邮箱 / 主体名也要跟着刷新
  useEffect(() => subscribe(EVT.siteConfig, () => force((n) => n + 1)), [])
  const items = hasRole('admin') ? [...NAV, ADMIN_NAV] : NAV
  const cfg = getSiteConfig()

  return (
    <>
      <header className="wb-hero">
        <span className="wb-logo">Mim</span>
        <div className="grow" />
        <button
          className="icon-btn"
          onClick={() => {
            toggleTheme()
            force((n) => n + 1)
          }}
          aria-label="切换主题"
          title={getTheme() === 'dark' ? '切换到浅色' : '切换到深色'}
        >
          {getTheme() === 'dark' ? '🌙' : '☀️'}
        </button>
        <a className="btn btn-sm" href="#/login">
          登录
        </a>
      </header>

      <div className="shell">
        <SideNav items={items} path={path} />
        <main className="app-shell">{children}</main>
      </div>

      <footer className="site-footer-mini">
        <div className="site-footer">
          <div className="site-footer-cols">
            <div>
              <div className="footer-heading">站点</div>
              <div>
                <a href="#/info/about">关于我们</a>
              </div>
              <div>
                <a href="#/legal/terms">用户协议</a>
              </div>
              <div>
                <a href="#/legal/privacy">隐私政策</a>
              </div>
            </div>
            <div>
              <div className="footer-heading">联系</div>
              <div>{cfg.contactEmail}</div>
              <div>{cfg.owner}</div>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            ©2026 Mim · 内容聚合社区 · V{APP_VERSION}
          </div>
        </div>
      </footer>

      {/* 移动端底部 Tab Bar：仅 ≤860px 显示，桌面端隐藏 */}
      <TabBar path={path} />
    </>
  )
}

function SideNav({ items, path }: { items: NavItem[]; path: string }) {
  return (
    <aside className="sidenav">
      <div className="sidenav-brand">Mim</div>
      {items.map((item) => (
        <NavNode key={item.isSection ? `sec-${item.label}` : item.href} item={item} path={path} />
      ))}
      <div className="site-footer" style={{ marginTop: 12 }}>
        <div className="site-footer-cols">
          <div>
            <div className="footer-heading">站点</div>
            <div>
              <a href="#/info/about">关于我们</a>
            </div>
            <div>
              <a href="#/info/terms">服务条款</a>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}

function NavNode({ item, path }: { item: NavItem; path: string }) {
  /* 分组小标题：不可点击，不参与路由高亮 */
  if (item.isSection) {
    return <div className="sidenav-section">{item.label}</div>
  }
  const active = navMatches(item, path)
  if (!item.children) {
    return (
      <a className={cx('sidenav-link', active && 'active')} href={item.href}>
        {item.icon ? <span>{item.icon}</span> : null}
        <span>{item.label}</span>
        {item.badgeKey ? <BadgeDot kind={item.badgeKey} /> : null}
      </a>
    )
  }
  return (
    <div>
      <a className={cx('sidenav-group-title', active && 'active')} href={item.href}>
        <span>
          {item.icon ? `${item.icon} ` : ''}
          {item.label}
        </span>
      </a>
      {active ? (
        <div className="sidenav-sub">
          {item.children.map((c) => (
            <a
              key={c.href}
              className={cx('sidenav-link', path === c.match && 'active')}
              href={c.href}
            >
              {c.icon ? <span>{c.icon}</span> : null}
              <span>{c.label}</span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** 角标：未读通知 / 未读私信。数据源由页面写入，这里只读不计算 */
function BadgeDot({ kind }: { kind: 'notif' | 'msg' }) {
  const n = readUnread(kind)
  if (n <= 0) return null
  return <span className="sidenav-badge">{n > 99 ? '99+' : n}</span>
}

function readUnread(kind: 'notif' | 'msg'): number {
  try {
    const raw = readRaw(`mim.unread.${kind}`)
    const n = Number(raw ?? 0)
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

/** 移动端底部 Tab Bar：5 项核心入口，≤860px 显示 */
function TabBar({ path }: { path: string }) {
  const tabs = [
    { href: '#/feed', match: '/feed', label: '首页', icon: '🏠' },
    { href: '#/topics', match: '/topics', label: '发现', icon: '🔍' },
    { href: '#/publish', match: '/publish', label: '发布', icon: '✍️' },
    { href: '#/mall', match: '/mall', label: '商城', icon: '🛒' },
    { href: '#/my', match: '/my', label: '我的', icon: '👤' },
  ]
  return (
    <nav className="tabbar" aria-label="主导航">
      {tabs.map((t) => {
        const active = path === t.match || path.startsWith(`${t.match}/`)
        return (
          <a key={t.href} href={t.href} className={cx('tabbar-item', active && 'active')}>
            <span className="tabbar-icon">{t.icon}</span>
            <span className="tabbar-label">{t.label}</span>
          </a>
        )
      })}
    </nav>
  )
}
