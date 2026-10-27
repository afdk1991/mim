/* ==========================================================================
 * 路由内核 —— hash 路由（无第三方路由库）
 *
 * 约定：
 *  - location.hash 去掉 # 后为 path，默认 /feed
 *  - 查询串用 ? 拆分，交给 URLSearchParams
 *  - 路由变化自动回到顶部（原实现就此行为有隐式依赖，此处显式保留）
 * ======================================================================== */

import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export interface RouterValue {
  path: string
  query: URLSearchParams
  navigate: (to: string) => void
}

const RouterCtx = createContext<RouterValue>({
  path: '/feed',
  query: new URLSearchParams(),
  navigate: () => {},
})

export function parseHash(hash: string): { path: string; query: URLSearchParams } {
  const raw = hash.replace(/^#/, '')
  const [p = '', qs = ''] = raw.split('?')
  const path = p.startsWith('/') ? p : `/${p}`
  return { path: path === '/' ? '/feed' : path, query: new URLSearchParams(qs) }
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState(() => {
    const { path, query } = parseHash(window.location.hash)
    return { path, query }
  })

  useEffect(() => {
    const onChange = (): void => {
      const { path, query } = parseHash(window.location.hash)
      setValue({ path, query })
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigate = (to: string): void => {
    const next = to.startsWith('#') ? to : `#${to.startsWith('/') ? to : `/${to}`}`
    if (window.location.hash === next) return
    window.location.hash = next
  }

  return <RouterCtx.Provider value={{ ...value, navigate }}>{children}</RouterCtx.Provider>
}

export function useRouter(): RouterValue {
  return useContext(RouterCtx)
}

/** 取路径段：/mall/goods/abc → ['mall','goods','abc'] */
export function segmentsOf(path: string): string[] {
  return path.split('/').filter(Boolean)
}
