import { useEffect, useState } from 'react'
import { Empty, Modal, useToast } from './components'
import { cx, timeAgo, uid } from './utils'
import { pullToolState, pushToolState } from './lib/tool-cloud'

/* ============================================================
 * 配送调度台 —— 重新开发自合并源码 delivery-router（配送调度应用）
 * 订单看板 / 骑手分配 / 配送进度，全部数据由用户真实输入创建，不预置任何演示数据。
 * 持久化：localStorage 即时落地 + 云端 documents 表整包快照同步（登录后自动跨端恢复）。
 * ============================================================ */

export type OrderStatus = 'pending' | 'picking' | 'delivering' | 'delivered'

interface Rider {
  id: string
  name: string
  emoji: string
  vehicle: string
  orderId: string | null
}

interface DeliveryOrder {
  id: string
  code: string
  customer: string
  address: string
  items: string
  amount: number
  status: OrderStatus
  riderId: string | null
  createdAt: number
}

interface BoardData {
  riders: Rider[]
  orders: DeliveryOrder[]
}

const STATUS_META: Record<OrderStatus, { label: string; emoji: string }> = {
  pending: { label: '待分配', emoji: '🕒' },
  picking: { label: '待取货', emoji: '📦' },
  delivering: { label: '配送中', emoji: '🛵' },
  delivered: { label: '已送达', emoji: '✅' },
}

const STATUS_ORDER: OrderStatus[] = ['pending', 'picking', 'delivering', 'delivered']

const STORAGE_KEY = 'mim-delivery-v2'

/* 新增骑手时的交通工具选项 */
const VEHICLE_OPTIONS = [
  { emoji: '🛵', label: '电动车' },
  { emoji: '🚴', label: '单车' },
  { emoji: '🚗', label: '汽车' },
  { emoji: '🚶', label: '步行' },
]

function emptyBoard(): BoardData {
  return { riders: [], orders: [] }
}

function loadBoard(): BoardData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as BoardData
      if (parsed && Array.isArray(parsed.riders) && Array.isArray(parsed.orders)) {
        // 元素级校验：剔除脏数据，避免损坏存档导致看板渲染异常
        const riders = parsed.riders.filter(
          (r): r is Rider =>
            !!r && typeof r === 'object' &&
            typeof r.id === 'string' && typeof r.name === 'string' &&
            typeof r.emoji === 'string' && typeof r.vehicle === 'string' &&
            (typeof r.orderId === 'string' || r.orderId === null),
        )
        const orders = parsed.orders.filter(
          (o): o is DeliveryOrder =>
            !!o && typeof o === 'object' &&
            typeof o.id === 'string' && typeof o.code === 'string' &&
            typeof o.customer === 'string' && typeof o.address === 'string' &&
            typeof o.items === 'string' &&
            typeof o.amount === 'number' && Number.isFinite(o.amount) &&
            STATUS_ORDER.includes(o.status) &&
            (typeof o.riderId === 'string' || o.riderId === null) &&
            typeof o.createdAt === 'number' && Number.isFinite(o.createdAt),
        )
        return { riders, orders }
      }
    }
  } catch {
    /* 忽略损坏的本地数据，从空看板开始 */
  }
  return emptyBoard()
}

/* 按现有单号递增生成下一个订单号（D-xxxx） */
function nextCode(existing: DeliveryOrder[]): string {
  let max = 2000
  for (const o of existing) {
    const n = parseInt(o.code.replace(/[^0-9]/g, ''), 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return 'D-' + (max + 1)
}

export function DeliveryBoardPage() {
  const [board, setBoard] = useState<BoardData>(loadBoard)
  const [assignFor, setAssignFor] = useState<string | null>(null)
  const [riderDraft, setRiderDraft] = useState<null | { name: string; vehicle: string }>(null)
  const [orderDraft, setOrderDraft] = useState<null | { customer: string; address: string; items: string; amount: string }>(null)
  const toast = useToast()

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(board))
    } catch {
      /* ignore */
    }
    pushToolState(STORAGE_KEY, board) // 云端整包快照（未登录/未配置时静默跳过）
  }, [board])

  /* 云端恢复（轮 6）：mount 拉取快照 → 写回本地 → 重载（幂等触发上方保存钩子回推） */
  useEffect(() => {
    void pullToolState(STORAGE_KEY).then((d) => {
      if (!d || typeof d !== 'object') return
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)) } catch { /* ignore */ }
      setBoard(loadBoard())
    })
  }, [])

  const { riders, orders } = board
  const idleRiders = riders.filter((r) => !r.orderId)
  const delivered = orders.filter((o) => o.status === 'delivered')
  const stats = {
    pending: orders.filter((o) => o.status === 'pending').length,
    active: orders.filter((o) => o.status === 'picking' || o.status === 'delivering').length,
    done: delivered.length,
    revenue: delivered.reduce((s, o) => s + o.amount, 0),
  }

  function assign(orderId: string, riderId: string) {
    setBoard((b) => ({
      riders: b.riders.map((r) => (r.id === riderId ? { ...r, orderId } : r)),
      orders: b.orders.map((o) => (o.id === orderId ? { ...o, status: 'picking' as OrderStatus, riderId } : o)),
    }))
    setAssignFor(null)
    toast('已分配骑手，商家备货中')
  }

  function advance(order: DeliveryOrder) {
    if (order.status === 'picking') {
      setBoard((b) => ({
        ...b,
        orders: b.orders.map((o) => (o.id === order.id ? { ...o, status: 'delivering' as OrderStatus } : o)),
      }))
      toast('骑手已取货，配送中 🛵')
    } else if (order.status === 'delivering') {
      setBoard((b) => ({
        riders: b.riders.map((r) => (r.orderId === order.id ? { ...r, orderId: null } : r)),
        orders: b.orders.map((o) => (o.id === order.id ? { ...o, status: 'delivered' as OrderStatus } : o)),
      }))
      toast('订单已送达 ✅')
    }
  }

  /* 新增骑手：名称必填，交通工具从选项中选取 */
  function addRider() {
    const name = riderDraft!.name.trim()
    if (!name) {
      toast('请填写骑手名称')
      return
    }
    const opt = VEHICLE_OPTIONS.find((v) => v.label === riderDraft!.vehicle)
    setBoard((b) => ({
      ...b,
      riders: [...b.riders, { id: uid('r'), name, emoji: opt?.emoji ?? '🛵', vehicle: riderDraft!.vehicle, orderId: null }],
    }))
    setRiderDraft(null)
    toast('骑手已加入队列')
  }

  /* 新增订单：收件人与物品必填，金额可选 */
  function addOrder() {
    const customer = orderDraft!.customer.trim()
    const items = orderDraft!.items.trim()
    if (!customer || !items) {
      toast('请填写收件人与物品明细')
      return
    }
    const amount = Math.round(Number(orderDraft!.amount) * 10) / 10
    const order: DeliveryOrder = {
      id: uid('o'),
      code: nextCode(orders),
      customer,
      address: orderDraft!.address.trim() || '—',
      items,
      amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
      status: 'pending',
      riderId: null,
      createdAt: Date.now(),
    }
    setBoard((b) => ({ ...b, orders: [order, ...b.orders] }))
    setOrderDraft(null)
    toast('订单已进入待分配队列')
  }

  function clearBoard() {
    if (!window.confirm('确定清空全部骑手与订单数据吗？')) return
    setBoard(emptyBoard())
    toast('看板已清空')
  }

  /* 删除单个订单：若订单正挂在骑手身上，先释放骑手 */
  function removeOrder(order: DeliveryOrder) {
    if (!window.confirm(`确定删除订单 ${order.code} 吗？`)) return
    setBoard((b) => ({
      riders: b.riders.map((r) => (r.orderId === order.id ? { ...r, orderId: null } : r)),
      orders: b.orders.filter((o) => o.id !== order.id),
    }))
    toast('订单已删除')
  }

  /* 删除骑手：仅允许删除空闲骑手（忙碌骑手需先完成/删除其订单） */
  function removeRider(rider: Rider) {
    if (rider.orderId) {
      toast('该骑手正在配送中，无法删除')
      return
    }
    if (!window.confirm(`确定删除骑手「${rider.name}」吗？`)) return
    setBoard((b) => ({ ...b, riders: b.riders.filter((r) => r.id !== rider.id) }))
    toast('骑手已移除')
  }

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">🚚 配送调度台</h2>

        <div className="stat-row">
          <div className="stat-box"><b>{stats.pending}</b><span>待分配订单</span></div>
          <div className="stat-box"><b>{stats.active}</b><span>配送进行中</span></div>
          <div className="stat-box"><b>{stats.done}</b><span>已送达</span></div>
          <div className="stat-box"><b>¥{stats.revenue.toFixed(1)}</b><span>累计营收</span></div>
        </div>

        <div className="card">
          <div className="board-toolbar">
            <b>骑手队列</b>
            <div className="toolbar-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setRiderDraft({ name: '', vehicle: VEHICLE_OPTIONS[0].label })}>+ 新增骑手</button>
              <button className="btn btn-primary btn-sm" onClick={() => setOrderDraft({ customer: '', address: '', items: '', amount: '' })}>+ 新增订单</button>
              {(riders.length > 0 || orders.length > 0) && (
                <button className="btn btn-ghost btn-sm" onClick={clearBoard}>清空数据</button>
              )}
            </div>
          </div>
          <div className="rider-strip">
            {riders.map((r) => {
              const busyOrder = orders.find((o) => o.id === r.orderId)
              return (
                <span key={r.id} className={cx('rider-chip', busyOrder && 'busy')}>
                  <i>{r.emoji}</i>
                  <span>
                    <b>{r.name}</b>
                    <small>{busyOrder ? '配送中 · ' + busyOrder.code : '空闲'}</small>
                  </span>
                  {!busyOrder && (
                    <button
                      className="rider-chip-del"
                      title="删除该骑手"
                      onClick={() => removeRider(r)}
                    >
                      ✕
                    </button>
                  )}
                </span>
              )
            })}
          </div>
          {riders.length === 0 && (
            <p className="muted" style={{ margin: '8px 0' }}>还没有骑手，点击「+ 新增骑手」添加。</p>
          )}
        </div>

        {orders.length === 0 && riders.length === 0 && (
          <Empty emoji="🚚" text="看板为空：先添加骑手，再新增订单开始调度" />
        )}

        <div className="kanban">
          {STATUS_ORDER.map((st) => {
            const list = orders.filter((o) => o.status === st)
            const meta = STATUS_META[st]
            return (
              <div key={st} className="kanban-col">
                <div className="kanban-col-title">
                  <span>{meta.emoji} {meta.label}</span>
                  <span className="kanban-count">{list.length}</span>
                </div>
                {list.length === 0 && <p className="kanban-empty">暂无订单</p>}
                {list.map((o) => {
                  const rider = riders.find((r) => r.id === o.riderId)
                  return (
                    <div key={o.id} className="kanban-order">
                      <div className="ko-head">
                        <b>{o.code}</b>
                        <span className="ko-amount">¥{o.amount}</span>
                        <button
                          className="ko-del"
                          title="删除该订单"
                          onClick={() => removeOrder(o)}
                        >
                          ✕
                        </button>
                      </div>
                      <p className="ko-line">{o.customer} · {o.address}</p>
                      <p className="ko-line muted">🛍️ {o.items}</p>
                      <p className="ko-line muted">
                        <time>{timeAgo(o.createdAt)}</time>
                        {rider && <span> · {rider.emoji} {rider.name}</span>}
                      </p>
                      {st === 'pending' && (
                        <button className="btn btn-primary btn-sm ko-btn" onClick={() => setAssignFor(o.id)}>
                          分配骑手
                        </button>
                      )}
                      {st === 'picking' && (
                        <button className="btn btn-ghost btn-sm ko-btn" onClick={() => advance(o)}>取货完成</button>
                      )}
                      {st === 'delivering' && (
                        <>
                          <div className="progress-track">
                            <i className="progress-seg done" />
                            <i className="progress-seg done" />
                            <i className="progress-seg" />
                          </div>
                          <button className="btn btn-primary btn-sm ko-btn" onClick={() => advance(o)}>确认送达</button>
                        </>
                      )}
                      {st === 'delivered' && (
                        <div className="progress-track">
                          <i className="progress-seg done" />
                          <i className="progress-seg done" />
                          <i className="progress-seg done" />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {assignFor && (
        <Modal title="选择空闲骑手" onClose={() => setAssignFor(null)}>
          {idleRiders.length === 0 && <p className="ko-line muted">当前没有空闲骑手，先等一单送达吧。</p>}
          {idleRiders.map((r) => (
            <button key={r.id} className="rider-pick" onClick={() => assign(assignFor, r.id)}>
              <i>{r.emoji}</i>
              <span>
                <b>{r.name}</b>
                <small>{r.vehicle}</small>
              </span>
            </button>
          ))}
        </Modal>
      )}

      {riderDraft && (
        <Modal title="新增骑手" onClose={() => setRiderDraft(null)}>
          <input
            className="input"
            placeholder="骑手名称"
            value={riderDraft.name}
            onChange={(e) => setRiderDraft({ ...riderDraft, name: e.target.value })}
            style={{ marginBottom: 10 }}
          />
          <select
            className="input"
            aria-label="交通工具"
            value={riderDraft.vehicle}
            onChange={(e) => setRiderDraft({ ...riderDraft, vehicle: e.target.value })}
            style={{ marginBottom: 10 }}
          >
            {VEHICLE_OPTIONS.map((v) => (
              <option key={v.label} value={v.label}>{v.emoji} {v.label}</option>
            ))}
          </select>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={addRider}>添加</button>
        </Modal>
      )}

      {orderDraft && (
        <Modal title="新增订单" onClose={() => setOrderDraft(null)}>
          <input
            className="input"
            placeholder="收件人"
            value={orderDraft.customer}
            onChange={(e) => setOrderDraft({ ...orderDraft, customer: e.target.value })}
            style={{ marginBottom: 10 }}
          />
          <input
            className="input"
            placeholder="配送地址（可选）"
            value={orderDraft.address}
            onChange={(e) => setOrderDraft({ ...orderDraft, address: e.target.value })}
            style={{ marginBottom: 10 }}
          />
          <input
            className="input"
            placeholder="物品明细"
            value={orderDraft.items}
            onChange={(e) => setOrderDraft({ ...orderDraft, items: e.target.value })}
            style={{ marginBottom: 10 }}
          />
          <input
            className="input"
            type="number"
            placeholder="订单金额（元，可选）"
            value={orderDraft.amount}
            onChange={(e) => setOrderDraft({ ...orderDraft, amount: e.target.value })}
            style={{ marginBottom: 10 }}
          />
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={addOrder}>创建订单</button>
        </Modal>
      )}
    </div>
  )
}
