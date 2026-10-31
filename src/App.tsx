/* ==========================================================================
 * 应用根组件 —— Provider 栈 + 布局 + 路由分发
 *
 * 这里是全站唯一的 default export；其余模块一律具名导出。
 * ========================================================================== */

import { AppProviders } from './app/providers'
import { Shell } from './app/shell'
import { resolveRoute } from './app/routes'
import { useRouter } from './app/router'
import { hydrateWallet } from './app/state/wallet'
import { refreshSession } from './data/session'
import { loadRuntimeConfig } from './core/runtime-config'
import { OtaBanner } from './ota'
import { useEffect } from 'react'

function Page(): JSX.Element {
  const { path, query } = useRouter()
  return <>{resolveRoute(path, query)}</>
}

export default function App() {
  useEffect(() => {
    hydrateWallet()
    if (!window.location.hash) window.location.hash = '#/feed'
    // FE-011：启动时校验一次令牌有效性，坏令牌直接清掉，避免带着它打所有接口
    void refreshSession()
    // F6：拉取后台配置并合并到默认值（失败静默回退默认）
    void loadRuntimeConfig()
  }, [])

  return (
    <AppProviders>
      <OtaBanner />
      <Shell>
        <Page />
      </Shell>
    </AppProviders>
  )
}
