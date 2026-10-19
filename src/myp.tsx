import { useEffect, useRef, useState } from 'react'
import { useToast } from './components'
import { cx, uid } from './utils'

/* 直播带货台：重实现自母本 myp-live-mall（WordPress 商城直播系统）的直播带货主链路——
   直播列表（进行中/已结束）→ 直播间（模拟播放画面 + 实时弹幕滚动 + 敏感词过滤 +
   礼物打赏扣积分 + 带货商品抢购返积分）→ 积分流水与两级分销佣金汇总。
   购物车/订单/发票/财务同步不在本轮范围（youxuan 已覆盖交易闭环）。emoji 播放画面零图片依赖。 */

interface LiveGood { id: string; name: string; emoji: string; price: number; hot?: boolean }
interface LiveRoom { id: string; host: string; emoji: string; title: string; status: 'live' | 'ended'; viewers: number; goods: LiveGood[] }
interface PointLog { id: string; label: string; delta: number; at: number }
interface BuyRecord { id: string; name: string; emoji: string; price: number; at: number }
interface Danmu { id: string; from: string; text: string; gift?: boolean }
interface Gift { emoji: string; name: string; cost: number }
interface MypState { points: number; logs: PointLog[]; buys: BuyRecord[] }

const STORAGE_KEY = 'mim-myp-v1'
const INIT_POINTS = 8800
const GIFT_RATE = 0.1      // 直播间下单返积分比例
const COMMISSION = 0.05    // 一级分销佣金比例

const ROOMS: LiveRoom[] = [
  {
    id: 'r1', host: '小美说美妆', emoji: '💄', title: '秋冬护肤专场｜水乳霜 3 折起', status: 'live', viewers: 12456,
    goods: [
      { id: 'g11', name: '水润修护面霜', emoji: '🧴', price: 159, hot: true },
      { id: 'g12', name: '水乳保湿套装', emoji: '💧', price: 219 },
      { id: 'g13', name: '气垫粉底', emoji: '🪞', price: 89 },
    ],
  },
  {
    id: 'r2', host: '阿杰数码', emoji: '🔧', title: '旗舰耳机工厂直降，仅此一场', status: 'live', viewers: 8733,
    goods: [
      { id: 'g21', name: '无线降噪耳机 Pro', emoji: '🎧', price: 399, hot: true },
      { id: 'g22', name: '智能手表 S7 运动版', emoji: '⌚', price: 899 },
      { id: 'g23', name: '蓝牙音箱迷你款', emoji: '🔊', price: 129 },
    ],
  },
  {
    id: 'r3', host: '吃货小厨', emoji: '🍲', title: '深夜零食补给站，全场满 99 减 20', status: 'live', viewers: 15200,
    goods: [
      { id: 'g31', name: '每日坚果 30 包', emoji: '🥜', price: 99, hot: true },
      { id: 'g32', name: '即食鸡胸肉礼包', emoji: '🍗', price: 69 },
      { id: 'g33', name: '冷萃咖啡液 12 条', emoji: '☕', price: 79 },
    ],
  },
  {
    id: 'r4', host: '家居严选官', emoji: '🏠', title: '全屋好物清仓回放', status: 'ended', viewers: 3421,
    goods: [
      { id: 'g41', name: '陶瓷马克杯套装', emoji: '🍵', price: 89 },
      { id: 'g42', name: '记忆棉枕芯', emoji: '🛏', price: 199, hot: true },
    ],
  },
  {
    id: 'r5', host: '穿搭日记', emoji: '👗', title: '秋装上新返场回放', status: 'ended', viewers: 2107,
    goods: [
      { id: 'g51', name: '纯棉宽松卫衣', emoji: '👕', price: 159, hot: true },
      { id: 'g52', name: '轻便防晒夹克', emoji: '🧥', price: 249 },
    ],
  },
]

const GIFTS: Gift[] = [
  { emoji: '❤️', name: '小心心', cost: 10 },
  { emoji: '🌹', name: '浪漫玫瑰', cost: 30 },
  { emoji: '🎁', name: '神秘礼盒', cost: 100 },
  { emoji: '🚀', name: '冲榜火箭', cost: 520 },
]

const BANNED = ['加微信', '转账', '贷款', '赌博', '刷单', '发票']

const DANMU_POOL = [
  '主播讲得好详细', '这个价格直接冲了', '刚拍两件', '求讲解最后一个', '库存还有吗',
  '已回购三次', '支持主播', '返场返场', '比专柜划算太多', '弹幕扣 1 上链接',
  '已下单坐等发货', '主播试试那个蓝色的',
]

const VIEWER_NAMES = [
  '路过的糖', '峰哥', '阿瑶', 'Ken', '小饼干', '老王',
  '追风少年', 'CC', '月亮不打烊', '一颗小梅子', '大橘为重', '凌晨四点的蓝',
]

function loadMyp(): MypState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as MypState
      if (parsed && typeof parsed.points === 'number' && Array.isArray(parsed.logs) && Array.isArray(parsed.buys)) {
        return parsed
      }
    }
  } catch { /* 忽略损坏数据 */ }
  return { points: INIT_POINTS, logs: [], buys: [] }
}

function rand<T,>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }

const randomDanmu = (): Danmu => ({ id: uid(), from: rand(VIEWER_NAMES), text: rand(DANMU_POOL) })

export function MypLivePage() {
  const toast = useToast()
  const [myp, setMyp] = useState<MypState>(loadMyp)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [danmu, setDanmu] = useState<Danmu[]>([])
  const [viewers, setViewers] = useState(0)
  const [text, setText] = useState('')
  const [showGift, setShowGift] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const room = ROOMS.find((r) => r.id === roomId) ?? null

  const save = (next: MypState) => {
    setMyp(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  /* 直播中房间：弹幕自动滚入 + 观看人数轻微波动（会话内模拟，不持久化） */
  useEffect(() => {
    if (!room || room.status !== 'live') return
    const t = setInterval(() => {
      setDanmu((prev) => [...prev.slice(-60), randomDanmu()])
      setViewers((v) => Math.max(100, v + (Math.random() < 0.5 ? 3 : -1)))
    }, 1800)
    return () => clearInterval(t)
  }, [room?.id, room?.status])

  useEffect(() => {
    const el = boxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [danmu.length])

  const enterRoom = (id: string) => {
    const r = ROOMS.find((x) => x.id === id)
    if (!r) return
    setRoomId(id)
    setViewers(r.viewers)
    setDanmu(Array.from({ length: 8 }, randomDanmu))
    setText('')
    setShowGift(false)
  }

  const sendDanmu = () => {
    const t = text.trim()
    if (!t) return
    if (BANNED.some((w) => t.includes(w))) {
      toast('已拦截：弹幕包含敏感词')
      return
    }
    setDanmu((prev) => [...prev.slice(-60), { id: uid(), from: '我', text: t }])
    setText('')
  }

  const sendGift = (g: Gift) => {
    if (myp.points < g.cost) {
      toast(`积分不足，还差 ${g.cost - myp.points} 分`)
      return
    }
    save({
      ...myp,
      points: myp.points - g.cost,
      logs: [...myp.logs, { id: uid(), label: `送出 ${g.emoji} ${g.name}`, delta: -g.cost, at: Date.now() }],
    })
    setDanmu((prev) => [...prev.slice(-60), { id: uid(), from: '我', text: `送出 ${g.emoji} ${g.name}`, gift: true }])
  }

  const buy = (g: LiveGood) => {
    const back = Math.floor(g.price * GIFT_RATE)
    save({
      ...myp,
      points: myp.points + back,
      logs: [...myp.logs, { id: uid(), label: `直播间下单：${g.name}`, delta: back, at: Date.now() }],
      buys: [...myp.buys, { id: uid(), name: g.name, emoji: g.emoji, price: g.price, at: Date.now() }],
    })
    toast(`已抢购：${g.name}，返 ${back} 积分`)
  }

  const reset = () => {
    if (window.confirm('确定重置直播带货演示数据吗？')) save({ points: INIT_POINTS, logs: [], buys: [] })
  }

  /* ---------- 直播列表 ---------- */
  if (!room) {
    const commission = myp.buys.reduce((s, b) => s + b.price * COMMISSION, 0)
    return (
      <div className="page-grid">
        <div>
          <h2 className="page-title">📺 直播带货</h2>
          <div className="myp-rooms">
            {ROOMS.map((r) => (
              <button key={r.id} className="myp-room" onClick={() => enterRoom(r.id)}>
                <span className="myp-cover">
                  {r.emoji}
                  <i className={cx('myp-live-badge', r.status !== 'live' && 'off')}>
                    {r.status === 'live' ? '● 直播中' : '已结束'}
                  </i>
                </span>
                <span className="myp-room-body">
                  <b>{r.title}</b>
                  <small>{r.host} · {r.viewers.toLocaleString()} 人观看 · {r.goods.length} 件好物</small>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="side-card">
            <h3>💎 我的积分</h3>
            <p className="myp-points">{myp.points.toLocaleString()}</p>
            <p className="muted">打赏礼物扣积分 · 直播间下单按 {Math.round(GIFT_RATE * 100)}% 返积分</p>
          </div>
          <div className="side-card">
            <h3>📒 积分流水</h3>
            {myp.logs.length === 0 && <p className="muted">暂无流水，去直播间逛逛吧</p>}
            {myp.logs.slice(-6).reverse().map((l) => (
              <div key={l.id} className="myp-log">
                <span className="myp-log-label">{l.label}</span>
                <span className={l.delta > 0 ? 'myp-plus' : 'myp-minus'}>{l.delta > 0 ? '+' : ''}{l.delta}</span>
              </div>
            ))}
          </div>
          <div className="side-card">
            <h3>🤝 分销汇总</h3>
            <p className="muted">一级下线 3 人 · 二级下线 7 人</p>
            <p>累计佣金：<b className="myp-price">¥{commission.toFixed(2)}</b></p>
            <p className="muted">按直播间下单额 {Math.round(COMMISSION * 100)}% 实时结算，累计下单 {myp.buys.length} 件</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={reset}>重置演示数据</button>
        </div>
      </div>
    )
  }

  /* ---------- 直播间 ---------- */
  return (
    <div className="page-grid">
      <div>
        <button
          className="btn btn-ghost btn-sm"
          style={{ marginBottom: 10 }}
          onClick={() => { setRoomId(null); setDanmu([]) }}
        >
          ← 返回直播列表
        </button>
        <div className="myp-stage">
          <span className="myp-stage-host">{room.emoji}</span>
          {room.status === 'live' ? (
            <>
              <i className="myp-live-badge">● 直播中</i>
              <span className="myp-stage-meta">👁 {viewers.toLocaleString()} 人</span>
            </>
          ) : (
            <span className="myp-stage-ended">本场直播已结束 · 回放可继续购买</span>
          )}
        </div>
        <div className="myp-danmu-box" ref={boxRef}>
          {danmu.map((d) => (
            <p key={d.id} className={cx('myp-danmu', d.gift && 'gift')}>
              <b>{d.from}：</b>{d.text}
            </p>
          ))}
        </div>
        <div className="myp-sendbar">
          <input
            className="input"
            placeholder="说点什么…（发弹幕）"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') sendDanmu() }}
          />
          <button className="btn btn-ghost" title="送礼物" onClick={() => setShowGift(!showGift)}>🎁</button>
          <button className="btn btn-primary" onClick={sendDanmu}>发送</button>
        </div>
        {showGift && (
          <div className="myp-gift-panel">
            {GIFTS.map((g) => (
              <button key={g.name} className="myp-gift" onClick={() => sendGift(g)}>
                <span className="g">{g.emoji}</span>
                {g.name}<br />{g.cost} 积分
              </button>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="side-card">
          <h3>{room.title}</h3>
          <p className="muted">{room.host} · {room.status === 'live' ? '直播进行中' : '回放'}</p>
        </div>
        <div className="side-card">
          <h3>🛒 带货清单</h3>
          <div className="myp-goods">
            {room.goods.map((g) => (
              <div key={g.id} className="myp-good">
                <span className="gi">{g.emoji}</span>
                <span className="ginfo">
                  <b>{g.name}{g.hot && <span className="myp-hot">🔥 主推</span>}</b>
                  <span className="myp-price">¥{g.price}</span>
                </span>
                <button className="btn btn-primary btn-sm" onClick={() => buy(g)}>抢购</button>
              </div>
            ))}
          </div>
        </div>
        <div className="side-card">
          <h3>💎 积分余额</h3>
          <p className="myp-points">{myp.points.toLocaleString()}</p>
        </div>
      </div>
    </div>
  )
}
