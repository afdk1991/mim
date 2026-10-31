/* ==========================================================================
 * 设备管理与 OTA 发行 —— #/admin/devices（管理员可用）
 *
 * 数据：全部走服务端 RPC，不走 REST —— devices / device_commands 刻意不在
 *       rest.js 的表白名单里：归属列 owner_id 一旦开放客户端写，
 *       「把别人设备改到自己名下」就只需要一次 PATCH，所以单条设备的
 *       查看也只能靠 device_state 做归属裁定。
 *      · admin_devices        设备列表
 *      · admin_device_commands 指定设备的指令历史
 *      · ota_stats            升级包列表与失败率/熔断状态
 *
 * 坑：
 *  1. 仍然必须包 <AdminGate>：三个 RPC 内部有 requireAdmin，但前端先挡一层，
 *     避免非管理员点进来只看得到一个 403 错误串。
 *  2. 后端未配置 / 未搬到 0009 时，这些 RPC 会返回 schema -> 「过程不存在」，
 *     页面要把这类错误显示为「待迁移引导」而不是假装没有设备。
 *  3. 时间是 timestamptz（PG 返回 Date），展示统一走 formatDate 容错。
 * ======================================================================== */

import { useEffect, useState } from 'react'
import { AdminGate } from '../../app/admin-gate'
import { db } from '../../data/client'
import { errText } from '../../core/result'
import { formatDate } from '../../core/utils'
import { Empty, Tag } from '../../ui'

interface DeviceRow {
  id: string
  sn: string
  model: string
  status: 'pending_activate' | 'offline' | 'online'
  fw_version: string
  build: number
  owner_id: string | null
  last_seen_at?: string | Date | null
  created_at?: string | Date | null
  shadow_version?: number
}

interface CommandRow {
  id: string
  action: string
  payload?: unknown
  status: 'pending' | 'sent' | 'acked' | 'failed'
  fail_reason?: string | null
  created_at?: string | Date | null
  sent_at?: string | Date | null
  acked_at?: string | Date | null
}

interface OtaPkgSummary {
  id: string
  model: string
  version: string
  build: number
  channel: string
  rollout: number
  status: string
  max_fail_rate?: number
  min_samples?: number
  fail_rate?: number
  total_devices?: number
}

const STATUS_TEXT: Record<string, string> = {
  online: '在线',
  offline: '离线',
  pending_activate: '待激活',
}

const CMD_STATUS_TEXT: Record<string, string> = {
  pending: '待下发',
  sent: '已投递',
  acked: '已回执',
  failed: '失败',
}

const OTA_STATUS_TEXT: Record<string, string> = {
  draft: '草稿',
  published: '已发行',
  paused: '已熔断',
  revoked: '已废弃',
}

/** 时间容错：PG Date / 字符串 / 空值三种都要吃掉 */
function fmtTime(v: unknown): string {
  if (!v) return '—'
  if (v instanceof Date) return formatDate(v.getTime()) || '—'
  if (typeof v === 'number') return formatDate(v) || '—'
  return String(v)
}

export function AdminDevicesPage() {
  return (
    <AdminGate>
      <DevicesInner />
    </AdminGate>
  )
}

function DevicesInner() {
  const [devices, setDevices] = useState<DeviceRow[]>([])
  const [commands, setCommands] = useState<CommandRow[]>([])
  const [packages, setPackages] = useState<OtaPkgSummary[]>([])
  const [selected, setSelected] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [loadingCmds, setLoadingCmds] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load(): Promise<void> {
    setLoading(true)
    setError(null)
    const [listRes, otaRes] = await Promise.all([
      db.rpc<{ rows: DeviceRow[] }>('admin_devices', { p_limit: 100 }),
      db.rpc<{ packages: OtaPkgSummary[] }>('ota_stats', {}),
    ])
    setLoading(false)

    if (!listRes.ok) {
      setError(errText(listRes.error))
      // OTA 统计失败不阻断设备列表：0009 未迁移时只缺 OTA 面板
      return
    }
    setDevices(listRes.data.rows ?? [])
    setPackages(otaRes.ok ? otaRes.data.packages ?? [] : [])
  }

  async function loadCommands(deviceId: string): Promise<void> {
    setSelected(deviceId)
    setLoadingCmds(true)
    const r = await db.rpc<{ rows: CommandRow[] }>('admin_device_commands', {
      p_device_id: deviceId,
      p_limit: 50,
    })
    setLoadingCmds(false)
    setCommands(r.ok ? r.data.rows ?? [] : [])
  }

  useEffect(() => {
    void load()
  }, [])

  const online = devices.filter((d) => d.status === 'online').length
  const bound = devices.filter((d) => d.owner_id).length

  return (
    <div className="page page-grid single">
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          📟 设备管理与 OTA
        </h1>
        <div className="grow" />
        <button className="btn btn-ghost btn-sm" onClick={() => void load()} disabled={loading}>
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          设备总览
        </div>
        <div className="kv-table">
          <div className="kv-row">
            <span className="muted">设备总数</span>
            <span>{devices.length}</span>
          </div>
          <div className="kv-row">
            <span className="muted">在线 / 已绑定</span>
            <span>
              {online} / {bound}
            </span>
          </div>
          <div className="kv-row">
            <span className="muted">数据来源</span>
            <span>服务端 RPC（devices 未开放 REST）</span>
          </div>
        </div>
      </div>

      {error ? (
        <div className="card">
          <Empty emoji="⚠️" text={error} />
        </div>
      ) : null}

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          设备列表
        </div>
        {loading ? (
          <p className="muted">加载中…</p>
        ) : devices.length === 0 ? (
          <Empty emoji="📟" text="暂无设备档案（0009 迁移后由出厂流程写入 devices 表）" />
        ) : (
          devices.map((d) => (
            <div key={d.id} className="card" style={{ marginBottom: 8 }}>
              <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                <strong>{d.id}</strong>
                <Tag>{STATUS_TEXT[d.status] ?? d.status}</Tag>
                <div className="grow" />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => void loadCommands(d.id)}
                  disabled={loadingCmds && selected === d.id}
                >
                  {selected === d.id ? '已选中' : '查看指令'}
                </button>
              </div>
              <div className="kv-table">
                <div className="kv-row">
                  <span className="muted">序列号</span>
                  <span>{d.sn}</span>
                </div>
                <div className="kv-row">
                  <span className="muted">机型 / 固件</span>
                  <span>
                    {d.model} · {d.fw_version || '未知'}（build {d.build ?? 0}）
                  </span>
                </div>
                <div className="kv-row">
                  <span className="muted">归属</span>
                  <span>{d.owner_id ? '已绑定用户' : '未绑定'}</span>
                </div>
                <div className="kv-row">
                  <span className="muted">最后上线</span>
                  <span>{fmtTime(d.last_seen_at)}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {selected ? (
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>
            指令历史 · {selected}
          </div>
          {loadingCmds ? (
            <p className="muted">加载中…</p>
          ) : commands.length === 0 ? (
            <Empty emoji="📭" text="该设备暂无下行指令" />
          ) : (
            commands.map((c) => (
              <div key={c.id} className="kv-table" style={{ marginBottom: 6 }}>
                <div className="kv-row">
                  <span className="muted">{fmtTime(c.created_at)}</span>
                  <span>
                    {c.action} <Tag>{CMD_STATUS_TEXT[c.status] ?? c.status}</Tag>
                  </span>
                </div>
                {c.fail_reason ? (
                  <div className="kv-row">
                    <span className="muted">失败原因</span>
                    <span>{c.fail_reason}</span>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          OTA 升级包
        </div>
        {packages.length === 0 ? (
          <Empty emoji="📦" text="暂无升级包（管理员可通过 ota_publish 发行）" />
        ) : (
          packages.map((p) => (
            <div key={p.id} className="kv-table" style={{ marginBottom: 6 }}>
              <div className="kv-row">
                <span className="muted">
                  {p.model} · {p.version}（build {p.build}）
                </span>
                <span>
                  <Tag>{OTA_STATUS_TEXT[p.status] ?? p.status}</Tag>
                </span>
              </div>
              <div className="kv-row">
                <span className="muted">灰度 / 失败率</span>
                <span>
                  {p.rollout}% · {p.fail_rate ?? 0}%（样本 {p.total_devices ?? 0}）
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
