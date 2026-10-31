/* ==========================================================================
 * 入口 —— 主题先行（避免首屏闪白），随后挂载 React
 * ======================================================================== */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

import './ui/styles/theme.css'
import './ui/styles/base.css'
import './ui/styles/layout.css'
import './ui/styles/components.css'

import { initTheme } from './core/theme'
import { checkOta } from './ota'
import { setTrackIdentity, startTelemetry, track, trackFirstPaint } from './core/telemetry'
import { currentUid } from './data/session'

initTheme()

// 埋点：先注入身份源再启动队列（启动后所有 page_view 都自动带上公共属性）
setTrackIdentity(() => currentUid())
startTelemetry()
track('app_launch')

// 启动期静默 OTA 检测：失败/无更新一律降级，吞错不打断启动（UI 横幅由 useOta 提供）
void checkOta().catch(() => {})

const el = document.getElementById('root')
if (!el) throw new Error('#root 节点缺失，index.html 可能被改动')

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// 首帧口径（埋点规范 §5）：挂载后第一帧的时间戳，作为 FCP 基线数据源。
// 放在 render 之后而不是之前 —— 之前测的是「React 还没开始画」的时间，不是用户可见时间。
requestAnimationFrame(() => {
  trackFirstPaint(performance.now())
})
