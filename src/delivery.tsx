import { useEffect, useState } from 'react'
import { Modal, useToast } from './components'
import { cx, timeAgo, uid } from './utils'

/* ============================================================
 * 配送调度台 —— 重新开发自合并源码 delivery-router（配送调度应用）
 * 纯前端 mock：订单看板 / 骑手分配 / 配送进度，localStorage 持久化
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

const STORAGE_KEY = 'mim-delivery-v1'

function seedData(): BoardData {
  const min = (n: number) => Date.now() - n * 60_000
  const hr = (n: number) => Date.now() - n * 3_600_000
  return {
    riders: [
      { id: 'r1', name: '小飞哥', emoji: '🦸', vehicle: '🛵 电动车', orderId: 'o3' },
      { id: 'r2', name: '闪电侠', emoji: '⚡', vehicle: '🚴 单车', orderId: 'o4' },
      { id: 'r3', name: '王师傅', emoji: '👨‍🔧', vehicle: '🚗 汽车', orderId: 'o5' },
      { id: 'r4', name: '阿疾', emoji: '🐱', vehicle: '🛵 电动车', orderId: null },
      { id: 'r5', name: '大鹏', emoji: '🕊️', vehicle: '🚴 单车', orderId: null },
    ],
    orders: [
      { id: 'o1', code: 'D-2041', customer: '陈小姐', address: '桂花园小区 3 栋', items: '杨枝甘露 ×2', amount: 32.5, status: 'pending', riderId: null, createdAt: min(6) },
      { id: 'o2', code: 'D-2042', customer: '李先生', address: '科技园 B 座 12F', items: '黄焖鸡米饭套餐', amount: 26, status: 'pending', riderId: null, createdAt: min(14) },
      { id: 'o3', code: 'D-2043', customer: '周女士', address: '幸福里 7-201', items: '向日葵花束', amount: 58, status: 'picking', riderId: 'r1', createdAt: min(25) },
      { id: 'o4', code: 'D-2044', customer: '赵同学', address: '大学城公寓 2-508', items: 'Switch 游戏卡带', amount: 299, status: 'delivering', riderId: 'r2', createdAt: min(52) },
      { id: 'o5', code: 'D-2045', customer: '吴先生', address: '中央公园 9 栋', items: '6 寸生日蛋糕', amount: 128, status: 'delivering', riderId: 'r3', createdAt: hr(1.5) },
      { id: 'o6', code: 'D-2039', customer: '郑阿姨', address: '老街 38 号', items: '常备药箱补货', amount: 46.8, status: 'delivered', riderId: 'r4', createdAt: hr(3) },
    ],
  }
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
    /* 忽略损坏的本地数据，重新播种 */
  }
  return seedData()
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

const SPAWN_CUSTOMERS = ['孙同学', '钱经理', '冯阿姨', '褚先生', '卫女士', '蒋同学']
const SPAWN_ITEMS = ['冰美式 ×2', '榴莲披萨 9 寸', '猫粮 5kg', '数据线 ×3', '水果捞大份', '打印纸一箱']
const SPAWN_ADDRESSES = ['枫林路 21 号', '云端大厦 8F', '翡翠湾 5-301', '南门宿舍 402', '滨河花园 12 栋']

export function DeliveryBoardPage() {
  const [board, setBoard] = useState<BoardData>(loadBoard)
  const [assignFor, setAssignFor] = useState<string | null>(null)
  const toast = useToast()

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(board))
    } catch {
      /* ignore */
    }
  }, [board])

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

  function spawn() {
    const order: DeliveryOrder = {
      id: uid('o'),
      code: 'D-' + Math.floor(2100 + Math.random() * 800),
      customer: pick(SPAWN_CUSTOMERS),
      address: pick(SPAWN_ADDRESSES),
      items: pick(SPAWN_ITEMS),
      amount: Math.round((15 + Math.random() * 280) * 10) / 10,
      status: 'pending',
      riderId: null,
      createdAt: Date.now(),
    }
    setBoard((b) => ({ ...b, orders: [order, ...b.orders] }))
    toast('新订单已进入待分配队列')
  }

  function resetBoard() {
    if (!window.confirm('确定要重置配送看板的演示数据吗？')) return
    setBoard(seedData())
    toast('看板已重置')
  }

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">🚚 配送调度台</h2>

        <div className="stat-row">
          <div className="stat-box"><b>{stats.pending}</b><span>待分配订单</span></div>
          <div className="stat-box"><b>{stats.active}</b><span>配送进行中</span></div>
          <div className="stat-box"><b>{stats.done}</b><span>今日已送达</span></div>
          <div className="stat-box"><b>¥{stats.revenue.toFixed(1)}</b><span>今日营收</span></div>
        </div>

        <div className="card">
          <div className="board-toolbar">
            <b>骑手队列</b>
            <div className="toolbar-actions">
              <button className="btn btn-primary btn-sm" onClick={spawn}>+ 模拟新订单</button>
              <button className="btn btn-ghost btn-sm" onClick={resetBoard}>重置看板</button>
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
                </span>
              )
            })}
          </div>
        </div>

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
    </div>
  )
}
