import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { cloudConfigMissing } from './lib/supabase'

/* 云端后端缺失：本地模式已移除，应用不再回退 localStorage 演示数据。
   直接渲染配置错误页，提示补齐云端环境变量。 */
function ConfigErrorPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        background: '#0f1115',
        color: '#e6e8eb',
      }}
    >
      <div style={{ maxWidth: 560, lineHeight: 1.7 }}>
        <h1 style={{ fontSize: 20, marginBottom: 12 }}>⚠️ 缺少云端后端配置</h1>
        <p style={{ marginBottom: 12 }}>
          本项目已移除本地演示模式，必须接入云端后端才能启动。请在构建环境中配置以下任意一组变量：
        </p>
        <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
          <li>
            <code>VITE_SUPABASE_URL</code> + <code>VITE_SUPABASE_ANON_KEY</code>（主后端）
          </li>
          <li>
            或 <code>VITE_MIM_API_BASE</code>（CloudBase 备后端）
          </li>
        </ul>
        <p style={{ opacity: 0.7, fontSize: 13 }}>
          配置后重新构建即可。参考仓库 <code>.env.example</code>。
        </p>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {cloudConfigMissing ? <ConfigErrorPage /> : <App />}
  </React.StrictMode>,
)
