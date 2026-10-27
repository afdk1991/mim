/* ==========================================================================
 * 管理后台守卫 —— 唯一有路由级权限校验的区域
 *
 * 「首个管理员」引导是部署可用性的关键路径：新库没有任何管理员时，
 * 若只提示「无权限」，站点将永远进不去后台。
 * ======================================================================== */

import type { ReactNode } from 'react'
import { emitToast, Empty } from '../ui'
import { hasPerm, hasRole, isSignedIn } from '../data/session'
import { db } from '../data/client'
import { errText } from '../core/result'

export function AdminGate({ perm, children }: { perm?: string; children: ReactNode }) {
  if (!isSignedIn()) return <AdminNoAccess kind="login" />
  if (!hasRole('admin')) return <AdminNoAccess kind="role" />
  if (perm && !hasPerm(perm)) return <AdminNoAccess kind="perm" perm={perm} />
  return <>{children}</>
}

export function AdminNoAccess({ kind, perm }: { kind: 'login' | 'role' | 'perm'; perm?: string }) {
  if (kind === 'login') {
    return (
      <div className="page">
        <Empty emoji="🔐" text="请先登录后再进入管理后台" />
        <div className="center">
          <a className="btn btn-primary" href="#/login?url=%23%2Fadmin">
            去登录
          </a>
        </div>
      </div>
    )
  }
  if (kind === 'perm') {
    return (
      <div className="page">
        <Empty emoji="🛡️" text={`缺少权限：${perm ?? ''}`} />
      </div>
    )
  }
  return (
    <div className="page">
      <Empty emoji="🛡️" text="当前账号不是管理员" />
      <div className="card" style={{ marginTop: 12 }}>
        <div className="section-title">如何获得管理员</div>
        <p className="dim" style={{ margin: '0 0 8px' }}>
          若是全新部署且尚无管理员，可把自己设为首个管理员（服务端会校验是否已有管理员）：
        </p>
        {/* 必须走 data 层的 db.rpc：它会带上 Authorization 头。
            此前用裸 fetch 不带令牌，服务端恒定 401，全新库将永远进不去后台。 */}
        <button
          className="btn btn-primary"
          onClick={() => {
            void db.rpc('bootstrap_admin', {}, { write: true }).then((r) => {
              if (r.ok) {
                emitToast('已成为管理员')
                location.reload()
              } else {
                emitToast(errText(r.error))
              }
            })
          }}
        >
          👑 成为首个管理员
        </button>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          已有管理员时，请让对方在「角色管理」中授予 admin 角色。
        </p>
      </div>
    </div>
  )
}
