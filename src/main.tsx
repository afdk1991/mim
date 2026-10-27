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

initTheme()

const el = document.getElementById('root')
if (!el) throw new Error('#root 节点缺失，index.html 可能被改动')

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
