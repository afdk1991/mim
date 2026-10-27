/* ==========================================================================
 * 配送调度台 —— 骑手队列 + 订单看板（pending → picking → delivering → delivered）
 *
 * 不预置演示数据：骑手与订单全部由用户真实录入。
 * 金额一律「分」：输入框收元 → yuanToFen 转换后再落库，展示用 yuanText。
 *
 * 状态机约束（页面必须守住，否则会出现「骑手消失/订单卡死」）：
 *   - 送达时同步释放骑手（rider.orderId = null）
 *   - 忙碌骑手禁止删除（先完成或删除其订单）
 *   - 单号由 nextCode() 递增生成，不可手写，避免重号
 * ======================================================================== */

import { useEffect, useState } from 'react'
import { DELIVERY_STATUS_TEXT, deliveredTotal, nextCode } from '@/domain/tools/model'
import type { BoardData, DeliveryOrder, DeliveryStatus, Rider } from '@/domain/tools/model'
import { loadSnapshot, saveSnapshot } from '@/data/sync'
import { cx, timeAgo, uid, yuanText, yuanToFen } from '@/core/utils'
import { Empty, Modal, useToast } from '@/ui'

const SCOPE = 'tools.delivery'

const VEHICLE_OPTIONS = [
  { emoji: '🛵', label: '电动车' },
  { emoji: '🚴', label: '单车' },
  { emoji: '🚗', label: '汽车' },
  { emoji: '🚶', label: '步行' },
]

const COLUMNS: DeliveryStatus[] = ['pending', 'picking', 'delivering', 'delivered']

const EMPTY_BOARD: BoardData = { riders: [], orders: [] }

function parseOrder(v: unknown): DeliveryOrder | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.code !== 'string') return null
  if (typeof r.customer !== 'string' || typeof r.address !== 'string' || typeof r.items !== 'string') return null
  if (typeof r.amountFen !== 'number' || !Number.isFinite(r.amountFen)) return null
  if (typeof r.createdAt !== 'number' || !Number.isFinite(r.createdAt)) return null
  const status = COLUMNS.find((s) => s === r.status)
  if (!status) return null
  return {
    id: r.id,
    code: r.code,
    customer: r.customer,
    address: r.address,
    items: r.items,
    amountFen: r.amountFen,
    status,
    riderId: typeof r.riderId === 'string' ? r.riderId : null,
    createdAt: r.createdAt,
  }
}

function parseRider(v: unknown): Rider | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null
  if (typeof r.emoji !== 'string' || typeof r.vehicle !== 'string') return null
  return {
    id: r.id,
    name: r.name,
    emoji: r.emoji,
    vehicle: r.vehicle,
    orderId: typeof r.orderId === 'string' ? r.orderId : null,
  }
}

function parseBoard(raw: unknown): BoardData | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.riders) || !Array.isArray(r.orders)) return null
  const riders: Rider[] = []
  for (const v of r.riders) {
    const x = parseRider(v)
    if (x) riders.push(x)
  }
  const orders: DeliveryOrder[] = []
  for (const v of r.orders) {
    const x = parseOrder(v)
    if (x) orders.push(x)
  }
  return { riders, orders }
}

interface Draft {
  customer: string
  address: string
  items: string
  amount: string
}

const emptyDraft = (): Draft => ({ customer: '', address: '', items: '', amount: '' })

export function DeliveryBoardPage() {
  const toast = useToast()
  const [board, setBoard] = useState<BoardData>(() => loadSnapshot(SCOPE, parseBoard, EMPTY_BOARD))
  const [riderName, setRiderName] = useState<string | null>(null)
  const [riderVehicle, setRiderVehicle] = useState(VEHICLE_OPTIONS[0]!.label)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [assignFor, setAssignFor] = useState<string | null>(null)

  useEffect(() => {
    saveSnapshot(SCOPE, board)
  }, [board])

  const { riders, orders } = board
  const idleRiders = riders.filter((r) => !r.orderId)
  const stats = {
    pending: orders.filter((o) => o.status === 'pending').length,
    active: orders.filter((o) => o.status === 'picking' || o.status === 'delivering').length,
    done: orders.filter((o) => o.status === 'delivered').length,
    revenueFen: deliveredTotal(orders),
  }

  const addRider = (): void => {
    const name = (riderName ?? '').trim()
    if (!name) {
      toast('请填写骑手名称')
      return
    }
    const opt = VEHICLE_OPTIONS.find((v) => v.label === riderVehicle)
    setBoard((b) => ({
      ...b,
      riders: [...b.riders, { id: uid('r'), name, emoji: opt?.emoji ?? '🛵', vehicle: riderVehicle, orderId: null }],
    }))
    setRiderName(null)
    toast('骑手已加入队列')
  }

  const addOrder = (): void => {
    if (!draft) return
    const customer = draft.customer.trim()
    const items = draft.items.trim()
    if (!customer || !items) {
      toast('请填写收件人与物品明细')
      return
    }
    const yuan = Number(draft.amount)
    const amountFen = Number.isFinite(yuan) && yuan > 0 ? yuanToFen(yuan) : 0
    const code = nextCode(orders)
    setBoard((b) => ({
      ...b,
      orders: [
        { id: uid('o'), code, customer, address: draft.address.trim(), items, amountFen, status: 'pending', riderId: null, createdAt: Date.now() },
        ...b.orders,
      ],
    }))
    setDraft(null)
    toast(`订单 ${code} 已进入待分配队列`)
  }

  const assign = (orderId: string, riderId: string): void => {
    setBoard((b) => ({
      riders: b.riders.map((r) => (r.id === riderId ? { ...r, orderId } : r)),
      orders: b.orders.map((o) => (o.id === orderId ? { ...o, status: 'picking', riderId } : o)),
    }))
    setAssignFor(null)
    toast('已分配骑手，进入取货环节')
  }

  /** 状态推进：picking→delivering→delivered（送达时同步释放骑手） */
  const advance = (order: DeliveryOrder): void => {
    if (order.status === 'picking') {
      setBoard((b) => ({ ...b, orders: b.orders.map((o) => (o.id === order.id ? { ...o, status: 'delivering' } : o)) }))
      toast('骑手已取货，配送中')
      return
    }
    if (order.status === 'delivering') {
      setBoard((b) => ({
        riders: b.riders.map((r) => (r.orderId === order.id ? { ...r, orderId: null } : r)),
        orders: b.orders.map((o) => (o.id === order.id ? { ...o, status: 'delivered' } : o)),
      }))
      toast('订单已送达，骑手已释放')
    }
  }

  /** 删除订单：若正挂在骑手身上先释放，避免出现「骑手永远忙碌」 */
  const removeOrder = (order: DeliveryOrder): void => {
    if (!window.confirm(`确定删除订单 ${order.code} 吗？`)) return
    setBoard((b) => ({
      riders: b.riders.map((r) => (r.orderId === order.id ? { ...r, orderId: null } : r)),
      orders: b.orders.filter((o) => o.id !== order.id),
    }))
    toast('订单已删除')
  }

  const removeRider = (rider: Rider): void => {
    if (rider.orderId) {
      toast('该骑手正在配送中，无法删除')
      return
    }
    if (!window.confirm(`确定删除骑手「${rider.name}」吗？`)) return
    setBoard((b) => ({ ...b, riders: b.riders.filter((r) => r.id !== rider.id) }))
    toast('骑手已移除')
  }

  return (
    <div className="page">
      <div className="row-between">
        <h1 className="page-title" style={{ margin: 0 }}>🚚 配送调度台</h1>
        <span className="row">
          <button className="btn btn-ghost btn-sm" onClick={() => { setRiderName(''); setRiderVehicle(VEHICLE_OPTIONS[0]!.label) }}>+ 新增骑手</button>
          <button className="btn btn-primary btn-sm" onClick={() => setDraft(emptyDraft())}>+ 新增订单</button>
        </span>
      </div>

      <div className="stat-row" style={{ margin: '12px 0' }}>
        <span><b>{stats.pending}</b> 待分配订单</span>
        <span><b>{stats.active}</b> 配送进行中</span>
        <span><b>{stats.done}</b> 已送达</span>
        <span><b>¥{yuanText(stats.revenueFen)}</b> 已送达金额</span>
      </div>

      <div className="card">
        <b>骑手队列</b>
        <div className="chip-row" style={{ marginTop: 8 }}>
          {riders.length === 0 ? (
            <span className="muted" style={{ fontSize: 12 }}>还没有骑手，点击右上「+ 新增骑手」添加。</span>
          ) : (
            riders.map((r) => {
              const busyOrder = orders.find((o) => o.id === r.orderId)
              return (
                <span key={r.id} className={cx('chip', busyOrder && 'active')}>
                  {r.emoji} {r.name}
                  <small className="muted"> {busyOrder ? `配送中 · ${busyOrder.code}` : '空闲'}</small>
                  {!busyOrder ? (
                    <button className="icon-btn" style={{ width: 20, height: 20, fontSize: 12 }} title="删除骑手" onClick={() => removeRider(r)}>
                      ✕
                    </button>
                  ) : null}
                </span>
              )
            })
          )}
        </div>
      </div>

      {riders.length === 0 && orders.length === 0 ? (
        <Empty emoji="🚚" text="看板为空：先添加骑手，再新增订单开始调度" />
      ) : null}

      <div className="mall-goods-grid">
        {COLUMNS.map((st) => {
          const list = orders.filter((o) => o.status === st)
          return (
            <div key={st} className="card">
              <b>{DELIVERY_STATUS_TEXT[st]} <span className="tag">{list.length}</span></b>
              {list.length === 0 ? (
                <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>暂无订单</p>
              ) : (
                list.map((o) => {
                  const rider = riders.find((r) => r.id === o.riderId)
                  return (
                    <div key={o.id} className="card" style={{ marginTop: 8, padding: 10 }}>
                      <div className="row-between">
                        <b>{o.code}</b>
                        <span className="row">
                          <b style={{ color: 'var(--danger)' }}>¥{yuanText(o.amountFen)}</b>
                          <button className="icon-btn" style={{ width: 20, height: 20, fontSize: 12 }} title="删除订单" onClick={() => removeOrder(o)}>✕</button>
                        </span>
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>{o.customer} · {o.address || '—'}</div>
                      <div className="muted" style={{ fontSize: 12 }}>🛍️ {o.items}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {timeAgo(o.createdAt)}{rider ? ` · ${rider.emoji} ${rider.name}` : ''}
                      </div>
                      {st === 'pending' ? (
                        <button className="btn btn-primary btn-sm" style={{ marginTop: 6 }} onClick={() => setAssignFor(o.id)}>分配骑手</button>
                      ) : null}
                      {st === 'picking' ? (
                        <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => advance(o)}>取货完成</button>
                      ) : null}
                      {st === 'delivering' ? (
                        <button className="btn btn-primary btn-sm" style={{ marginTop: 6 }} onClick={() => advance(o)}>确认送达</button>
                      ) : null}
                    </div>
                  )
                })
              )}
            </div>
          )
        })}
      </div>

      {riderName !== null ? (
        <Modal title="新增骑手" onClose={() => setRiderName(null)}>
          <input className="input" style={{ marginBottom: 10 }} placeholder="骑手名称" value={riderName} onChange={(e) => setRiderName(e.target.value)} />
          <select className="input" aria-label="交通工具" value={riderVehicle} onChange={(e) => setRiderVehicle(e.target.value)}>
            {VEHICLE_OPTIONS.map((v) => (
              <option key={v.label} value={v.label}>{v.emoji} {v.label}</option>
            ))}
          </select>
          <button className="btn btn-primary" style={{ marginTop: 10, width: '100%' }} onClick={addRider}>添加</button>
        </Modal>
      ) : null}

      {draft ? (
        <Modal title="新增订单" onClose={() => setDraft(null)}>
          <div className="col">
            <input className="input" placeholder="收件人" value={draft.customer} onChange={(e) => setDraft({ ...draft, customer: e.target.value })} />
            <input className="input" placeholder="配送地址（可选）" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
            <input className="input" placeholder="物品明细" value={draft.items} onChange={(e) => setDraft({ ...draft, items: e.target.value })} />
            <input className="input" inputMode="decimal" placeholder="订单金额（元，可选）" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
            <button className="btn btn-primary" onClick={addOrder}>创建订单</button>
          </div>
        </Modal>
      ) : null}

      {assignFor ? (
        <Modal title="选择空闲骑手" onClose={() => setAssignFor(null)}>
          {idleRiders.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>当前没有空闲骑手，先等一单送达吧。</p>
          ) : (
            idleRiders.map((r) => (
              <button key={r.id} className="btn btn-ghost btn-sm" style={{ marginRight: 6, marginBottom: 6 }} onClick={() => assign(assignFor, r.id)}>
                {r.emoji} {r.name} · {r.vehicle}
              </button>
            ))
          )}
        </Modal>
      ) : null}
    </div>
  )
}
