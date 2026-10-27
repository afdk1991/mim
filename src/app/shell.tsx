/* ==========================================================================
 * Shell —— 布局骨架：顶部 hero / 侧栏导航 / 主内容 / 页脚
 *
 * 与旧实现的两点差异：
 *  1. 导航数据来自 app/nav.ts，组件不再内联 25 个入口
 *  2. 分组展开由当前路径自动推导，不依赖组件内部状态
 * ======================================================================== */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { ADMIN_NAV, NAV, navMatches } from './nav'
import type { NavItem } from './nav'
import { useRouter } from './router'
import { hasRole } from '../data/session'
import { cx } from '../core/utils'
import { SITE_CONFIG } from '../core/config'
import { APP_VERSION } from '../core/version'
import { getTheme, toggleTheme } from '../core/theme'

export function Shell({ children }: { children: ReactNode }) {
  const { path } = useRouter()
  const [, force] = useState(0)
  const items = hasRole('admin') ? [...NAV, ADMIN_NAV] : NAV

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
              <h4>站点</h4>
              <div>
                <a href="#/info/about">关于我们</a>
              </div>
              <div>
                <a href="#/info/terms">服务条款</a>
              </div>
              <div>
                <a href="#/info/privacy">隐私政策</a>
              </div>
            </div>
            <div>
              <h4>联系</h4>
              <div>{SITE_CONFIG.contactEmail}</div>
              <div>{SITE_CONFIG.owner}</div>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            ©2026 Mim · 内容聚合社区 · V{APP_VERSION}
          </div>
        </div>
      </footer>
    </>
  )
}

function SideNav({ items, path }: { items: NavItem[]; path: string }) {
  return (
    <aside className="sidenav">
      <div className="sidenav-brand">Mim</div>
      {items.map((item) => (
        <NavNode key={item.href} item={item} path={path} />
      ))}
      <div className="site-footer" style={{ marginTop: 12 }}>
        <div className="site-footer-cols">
          <div>
            <h4>站点</h4>
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
    const raw = localStorage.getItem(`mim.unread.${kind}`)
    const n = Number(raw ?? 0)
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}
