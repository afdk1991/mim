/* ==========================================================================
 * 角色与权限 —— #/admin/roles（需要 role:manage 权限）
 *
 * 数据：db.list('roles') / db.list('permissions') / db.list('user_roles')
 * 坑：
 *  1. 只读展示：授权变更必须走服务端（前端直改 user_roles 等于绕过审计），页面不给写入口。
 *  2. 后端未就绪时显示空态 + 引导，绝不预置 admin / editor 之类的假角色 —— 那会让
 *     管理员误以为授权已经存在。
 *  3. 列可能缺失，按可选字段读取并降级为「—」。
 * ======================================================================== */

import { useEffect, useState } from 'react'
import { AdminGate } from '../../app/admin-gate'
import { db } from '../../data/client'
import { Empty, Skeleton, Tag } from '../../ui'

interface RoleRow {
  id?: string | number
  code?: string
  name?: string
  desc?: string
}

interface PermRow {
  id?: string | number
  code?: string
  label?: string
  desc?: string
}

interface UserRoleRow {
  id?: string | number
  user_id?: string
  role_id?: string | number
}

function text(v: unknown): string {
  if (v === null || v === undefined) return '—'
  const s = String(v)
  return s.trim() === '' ? '—' : s
}

interface Bundle {
  roles: RoleRow[]
  permissions: PermRow[]
  userRoles: UserRoleRow[]
  /** 全部失败时才有值 */
  error: string | null
}

export function AdminRolesPage() {
  return (
    <AdminGate perm="role:manage">
      <RolesInner />
    </AdminGate>
  )
}

function RolesInner() {
  const [loading, setLoading] = useState(true)
  const [bundle, setBundle] = useState<Bundle>({ roles: [], permissions: [], userRoles: [], error: null })

  useEffect(() => {
    let alive = true
    void (async () => {
      const results = await Promise.all([
        db.list<RoleRow>('roles', { limit: 200 }),
        db.list<PermRow>('permissions', { limit: 200 }),
        db.list<UserRoleRow>('user_roles', { limit: 200 }),
      ])
      if (!alive) return
      const [roles, perms, userRoles] = results
      const firstErr = results.find((r) => !r.ok)
      setBundle({
        roles: roles.ok ? roles.data : [],
        permissions: perms.ok ? perms.data : [],
        userRoles: userRoles.ok ? userRoles.data : [],
        error: results.some((r) => r.ok) ? null : firstErr && !firstErr.ok ? firstErr.error.message : null,
      })
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [])

  const emptyAll = bundle.roles.length === 0 && bundle.permissions.length === 0 && bundle.userRoles.length === 0

  return (
    <div className="page page-grid single">
      <h1 className="page-title">🔐 角色与权限</h1>

      {loading ? (
        <Skeleton rows={4} height={72} />
      ) : emptyAll ? (
        <div className="card">
          <Empty emoji="🗄️" text="后端未返回角色 / 权限数据" />
          <div className="section-title" style={{ marginTop: 8 }}>
            如何初始化
          </div>
          <div className="step-list">
            <div className="step">
              <span className="step-no">1</span>
              <span>部署 server 并使其可访问（前端接口基址 /api 需能反代到 server）</span>
            </div>
            <div className="step">
              <span className="step-no">2</span>
              <span>执行数据库迁移：npm run server:migrate（建 roles / permissions / user_roles 表）</span>
            </div>
            <div className="step">
              <span className="step-no">3</span>
              <span>刷新本页；首个管理员可在无权限提示页用「成为首个管理员」按钮自助开通</span>
            </div>
          </div>
          {bundle.error ? (
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              最近一次读取失败原因：{bundle.error}
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <div className="card">
            <div className="section-title" style={{ marginTop: 0 }}>
              角色（{bundle.roles.length}）
            </div>
            {bundle.roles.length === 0 ? (
              <Empty emoji="👥" text="角色表为空：由服务端迁移初始化，页面不会预置角色" />
            ) : (
              <div className="col">
                {bundle.roles.map((r, i) => (
                  <div className="rule-row" key={r.id === undefined ? `role-${i}` : String(r.id)}>
                    <Tag>{text(r.code)}</Tag>
                    <span className="grow">{text(r.name)}</span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {text(r.desc)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="section-title" style={{ marginTop: 0 }}>
              权限（{bundle.permissions.length}）
            </div>
            {bundle.permissions.length === 0 ? (
              <Empty emoji="🗝️" text="权限表为空：由服务端迁移初始化" />
            ) : (
              <div className="col">
                {bundle.permissions.map((p, i) => (
                  <div className="rule-row" key={p.id === undefined ? `perm-${i}` : String(p.id)}>
                    <Tag>{text(p.code)}</Tag>
                    <span className="grow">{text(p.label)}</span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {text(p.desc)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="section-title" style={{ marginTop: 0 }}>
              用户授权（{bundle.userRoles.length}）
            </div>
            {bundle.userRoles.length === 0 ? (
              <Empty emoji="🔗" text="还没有用户被授予角色" />
            ) : (
              <div className="col">
                {bundle.userRoles.map((u, i) => (
                  <div className="rule-row" key={u.id === undefined ? `ur-${i}` : String(u.id)}>
                    <span className="grow">{text(u.user_id)}</span>
                    <Tag>{text(u.role_id)}</Tag>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="muted" style={{ fontSize: 12 }}>
            本页只读：授予 / 回收角色必须由服务端接口完成并写审计，前端直改授权会绕过审计链路。
          </p>
        </>
      )}
    </div>
  )
}
