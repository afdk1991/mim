import { useState } from 'react'
import { APP_VERSION } from './version'
import './welcome.css'

/* 首启弹窗：全局唯一确认门。
   - 记录已同意时的 APP_VERSION；本地无记录或版本变更后再次首启都会重新弹出（版本对齐语义）；
   - 隐私政策链接指向 public/privacy.html（构建时复制进 dist，GitHub Pages 子路径 / EdgeOne 根路径 / 桌面与移动 WebView 壳均按相对路径可达）。 */

const ACK_KEY = 'mim-welcome-ack-v1'

function loadAck(): string {
  try {
    return localStorage.getItem(ACK_KEY) ?? ''
  } catch {
    /* 隐私模式下忽略 */
    return ''
  }
}

export function WelcomeModal() {
  const [ack, setAck] = useState(loadAck)

  if (ack === APP_VERSION) return null

  return (
    <div className="welcome-mask" role="presentation">
      <div className="welcome-card" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <div className="welcome-logo" aria-hidden="true">🧡</div>
        <h2 id="welcome-title">欢迎使用 Mim</h2>
        <span className="welcome-ver" title="当前版本号">V{APP_VERSION}</span>
        <ul className="welcome-points">
          <li>动态流与技术文章构成的内容社区，内置商城中台与 9 个工具台演示模块</li>
          <li>账号与内容数据以云端为真源存储，本机浏览器仅作离线缓存，可随时清除</li>
          <li>本应用不收集任何个人信息，版本更新检查仅传输版本号</li>
        </ul>
        <a className="welcome-privacy" href="./privacy.html" target="_blank" rel="noopener noreferrer">
          📄 阅读完整隐私政策
        </a>
        <button
          className="btn btn-primary welcome-agree"
          onClick={() => {
            try {
              localStorage.setItem(ACK_KEY, APP_VERSION)
            } catch {
              /* 隐私模式下忽略，下次启动会再次弹出 */
            }
            setAck(APP_VERSION)
          }}
        >
          同意并进入
        </button>
      </div>
    </div>
  )
}
