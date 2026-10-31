/* ==========================================================================
 * 管理后台首页 —— 概览卡片 + 后台入口
 *
 * 数据：概览来自后端 roles / permissions / user_roles 三张表的条数；入口按权限显隐。
 * 坑：
 *  1. 整页必须包在 <AdminGate> 里 —— 后台是唯一有路由级权限校验的区域。
 *  2. 后端未就绪时降级为空态 + 引导，绝不用假条数糊弄；部分表失败时只展示成功的部分。
 *  3. 入口链接按权限灰显而不是隐藏，避免管理员不知道后台还有哪些模块。
 * ======================================================================== */

import { useEffect, useState } from 'react'
import { AdminGate } from '../../app/admin-gate'
import { API_BASE } from '../../core/config'
import { APP_VERSION } from '../../core/version'
import { db } from '../../data/client'
import { getSession, hasPerm } from '../../data/session'
import { Empty, Skeleton, Tag } from '../../ui'

interface Overview {
  roles: number | null
  permissions: number | null
  userRoles: number | null
}

/* perm 缺省表示「只要通过 AdminGate 即可进入」——
 * 商品管理 / 充值核销依赖的是管理员角色本身，库里没有对应的按钮级权限点，
 * 若强行填一个不存在的 key，hasPerm 会恒 false，反而把管理员挡在门外。 */
const ENTRIES: Array<{ href: string; icon: string; title: string; perm?: string; desc: string }> = [
  { href: '#/admin/products', icon: '📦', title: '商品管理', desc: '新增 / 编辑商品，控制上下架与库存' },
  { href: '#/admin/recharge', icon: '🪙', title: '充值核销', desc: '核对收款后为用户钱包入账，全程审计留痕' },
  { href: '#/admin/verify', icon: '🎫', title: '券码核销', desc: '输入券码核验是否可用与核销时间' },
  { href: '#/admin/devices', icon: '📟', title: '设备与 OTA', desc: '查看设备档案、下行指令历史与升级包熔断状态' },
  { href: '#/admin/audit', icon: '📜', title: '审计日志', perm: 'audit:view', desc: '查看后台操作与写操作的留痕记录' },
  { href: '#/admin/roles', icon: '🔐', title: '角色管理', perm: 'role:manage', desc: '查看角色、权限与用户授权关系' },
]

export function AdminHomePage() {
  return (
    <AdminGate>
      <AdminHomeInner />
    </AdminGate>
  )
}

function AdminHomeInner() {
  const session = getSession()
  const [loading, setLoading] = useState(true)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const results = await Promise.all([
        db.list<unknown>('roles', { limit: 200 }),
        db.list<unknown>('permissions', { limit: 200 }),
        db.list<unknown>('user_roles', { limit: 200 }),
      ])
      if (!alive) return
      const [roles, perms, userRoles] = results
      setOverview({
        roles: roles.ok ? roles.data.length : null,
        permissions: perms.ok ? perms.data.length : null,
        userRoles: userRoles.ok ? userRoles.data.length : null,
      })
      // 只要有一张表读到了就展示，全部失败才判为后端未就绪
      const firstErr = results.find((r) => !r.ok)
      setError(results.some((r) => r.ok) ? null : firstErr && !firstErr.ok ? firstErr.error.message : null)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="page page-grid single">
      <h1 className="page-title">🛠️ 管理后台</h1>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          当前管理员
        </div>
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <b>{session.name}</b>
          <span className="muted" style={{ fontSize: 12 }}>
            @{session.username || '未设置用户名'} · {session.uid}
          </span>
        </div>
        <div className="chip-row" style={{ marginTop: 8 }}>
          {session.roles.length === 0 ? <Tag>无角色</Tag> : session.roles.map((r) => <Tag key={r}>{r}</Tag>)}
        </div>
      </div>

      <div className="section-title">数据概览</div>
      {loading ? (
        <Skeleton rows={2} height={72} />
      ) : overview && (overview.roles !== null || overview.permissions !== null || overview.userRoles !== null) ? (
        <div className="plan-grid">
          <div className="card plan-card">
            <div className="muted" style={{ fontSize: 12 }}>
              角色
            </div>
            <div className="plan-price">{overview.roles ?? '—'}</div>
          </div>
          <div className="card plan-card">
            <div className="muted" style={{ fontSize: 12 }}>
              权限
            </div>
            <div className="plan-price">{overview.permissions ?? '—'}</div>
          </div>
          <div className="card plan-card">
            <div className="muted" style={{ fontSize: 12 }}>
              用户授权
            </div>
            <div className="plan-price">{overview.userRoles ?? '—'}</div>
          </div>
        </div>
      ) : (
        <div className="card">
          <Empty emoji="🗄️" text="后端尚未返回角色 / 权限数据" />
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            {error ? `原因：${error}` : '原因未知'}
            。请先部署 server 并执行数据库迁移（npm run server:migrate），再刷新本页。
          </p>
        </div>
      )}
      {error && overview && overview.roles !== null ? (
        <p className="muted" style={{ fontSize: 12 }}>
          部分数据表读取失败：{error}（已展示可读到的部分）
        </p>
      ) : null}

      <div className="section-title">后台入口</div>
      <div className="plan-grid">
        {ENTRIES.map((e) => {
          const allowed = e.perm ? hasPerm(e.perm) : true
          return (
            <div key={e.href} className="card plan-card">
              <div className="row" style={{ alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 18 }}>{e.icon}</span>
                <b>{e.title}</b>
                <Tag>{e.perm ? (allowed ? '有权限' : `无 ${e.perm}`) : '管理员可用'}</Tag>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {e.desc}
              </div>
              <a
                className="btn btn-block"
                style={{ marginTop: 12 }}
                href={allowed ? e.href : undefined}
                aria-disabled={allowed ? undefined : true}
              >
                {allowed ? '进入' : '需要权限'}
              </a>
            </div>
          )
        })}
      </div>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          运行时
        </div>
        <div className="kv-table">
          <div className="kv-row">
            <span className="muted">前端版本</span>
            <span>{APP_VERSION}</span>
          </div>
          <div className="kv-row">
            <span className="muted">接口基址</span>
            <span>{API_BASE || '/api'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
