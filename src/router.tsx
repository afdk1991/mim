import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

interface RouterCtx {
  path: string
  query: URLSearchParams
  navigate: (to: string) => void
}

const Ctx = createContext<RouterCtx>({ path: '/feed', query: new URLSearchParams(), navigate: () => {} })

function parseHash(): { path: string; query: URLSearchParams } {
  const raw = window.location.hash.replace(/^#/, '') || '/feed'
  const [path, search] = raw.split('?')
  return { path: path || '/feed', query: new URLSearchParams(search || '') }
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(parseHash)

  useEffect(() => {
    const onChange = () => {
      setLoc(parseHash())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const value = useMemo<RouterCtx>(
    () => ({ ...loc, navigate: (to: string) => { window.location.hash = to } }),
    [loc],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRouter() {
  return useContext(Ctx)
}
