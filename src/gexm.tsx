import './gexm.css'
import { useEffect, useState } from 'react'
import { Empty, useToast } from './components'
import { cx, formatCount, uid } from './utils'

/* Gexm 多端商城台：重实现自母本 gexm-platform（uni-app 全平台商城系统）的多端主链路——
   一套代码四端运行（APP / 小程序 / H5 / PC 形态切换，布局与导航自动适配）→
   首页（轮播 + 限时秒杀倒计时 + 金刚区分类 + 推荐流）→ 分类栏与搜索 →
   商品详情 SKU 选择与收藏 → 会员中心（每日签到 / 连签奖励 / 积分等级成长）→
   离线数据同步台（断网操作暂存本地 · 恢复在线自动逐条同步 · 冲突自动重试解决）。
   购物车 / 订单 / 支付由 youxuan 覆盖，IM 客服 / 登录 / 推送不在本轮范围。emoji 占位零图片依赖。 */

type Term = 'app' | 'mp' | 'h5' | 'pc'
type Tab = 'home' | 'cate' | 'mine'

interface GProduct { id: string; name: string; emoji: string; price: number; sales: number; cat: string; specs: string[]; sec?: { price: number; pct: number } }
interface FavItem { pid: string; spec: string; at: number }
interface PointLog { id: string; label: string; delta: number; at: number }
interface SyncTask { id: string; label: string; status: 'pending' | 'success' | 'conflict'; retries: number; at: number; note?: string }
interface GexmState {
  points: number
  earned: number
  lastCheckin: string
  streak: number
  favs: FavItem[]
  logs: PointLog[]
  syncs: SyncTask[]
}

const STORAGE_KEY = 'mim-gexm-v1'
const CATS = ['数码', '家电', '服饰', '运动', '图书']
const CAT_EMOJI: Record<string, string> = { 全部: '🛍️', 数码: '💻', 家电: '🔌', 服饰: '👕', 运动: '⚽', 图书: '📖' }

const PRODUCTS: GProduct[] = [
  { id: 'x1', name: '4K 运动相机', emoji: '📷', price: 1299, sales: 5321, cat: '数码', specs: ['标准版', '套装版'], sec: { price: 999, pct: 76 } },
  { id: 'x2', name: '机械键盘 87 键', emoji: '⌨️', price: 349, sales: 12066, cat: '数码', specs: ['红轴', '茶轴', '青轴'] },
  { id: 'x3', name: '智能门锁 X3', emoji: '🔐', price: 899, sales: 2840, cat: '数码', specs: ['曜石黑', '太空灰'] },
  { id: 'x4', name: '空气炸锅 5L', emoji: '🍟', price: 299, sales: 20311, cat: '家电', specs: ['经典款', '可视化款'], sec: { price: 219, pct: 89 } },
  { id: 'x5', name: '扫地机器人 S8', emoji: '🤖', price: 1399, sales: 6890, cat: '家电', specs: ['标准版', '集尘版'] },
  { id: 'x6', name: '羊毛格纹围巾', emoji: '🧣', price: 129, sales: 8477, cat: '服饰', specs: ['枫叶红', '雾霭蓝'] },
  { id: 'x7', name: '加绒保暖卫衣', emoji: '🧤', price: 189, sales: 15203, cat: '服饰', specs: ['M', 'L', 'XL'] },
  { id: 'x8', name: 'TPE 瑜伽垫', emoji: '🧘', price: 99, sales: 17650, cat: '运动', specs: ['6mm', '8mm'], sec: { price: 69, pct: 92 } },
  { id: 'x9', name: '羽毛球拍对装', emoji: '🏸', price: 179, sales: 4412, cat: '运动', specs: ['进攻型', '均衡型'] },
  { id: 'x10', name: '科幻三部曲套装', emoji: '📚', price: 128, sales: 9908, cat: '图书', specs: ['平装', '精装'] },
]

const SECKILLS = PRODUCTS.filter((p) => p.sec)

const BANNERS = [
  { emoji: '🛍️', title: '新品首发季', sub: '全平台同步上新 · 低至 5 折' },
  { emoji: '🔥', title: '限时秒杀日', sub: '整点开抢 · 手慢无' },
  { emoji: '🎁', title: '会员专属福利', sub: '签到攒积分 · 兑好礼' },
]

const TERM_META: Record<Term, { label: string; icon: string; desc: string[] }> = {
  app: { label: 'APP', icon: '📱', desc: ['原生沉浸状态栏', '底部 Tab 导航', '推送与离线缓存'] },
  mp: { label: '小程序', icon: '💬', desc: ['右上角胶囊菜单', '轻量即点即用', '微信生态分享'] },
  h5: { label: 'H5', icon: '🌐', desc: ['浏览器直达免安装', '链接即开即分享', '响应式自适应'] },
  pc: { label: 'PC', icon: '🖥️', desc: ['顶部导航宽屏多列', '键鼠交互效率优先', '大图浏览看细节'] },
}

const TAB_META: Record<Tab, string> = { home: '首页', cate: '分类', mine: '我的' }
const TAB_ICON: Record<Tab, string> = { home: '🏠', cate: '🗂️', mine: '👤' }

const LEVELS = [
  { min: 0, name: 'V1 青铜' },
  { min: 100, name: 'V2 白银' },
  { min: 300, name: 'V3 黄金' },
  { min: 600, name: 'V4 铂金' },
  { min: 1000, name: 'V5 钻石' },
]

function levelOf(earned: number) {
  let i = 0
  for (let k = 0; k < LEVELS.length; k++) if (earned >= LEVELS[k].min) i = k
  const cur = LEVELS[i]
  const next = LEVELS[i + 1] ?? null
  const progress = next ? Math.min(100, Math.round(((earned - cur.min) / (next.min - cur.min)) * 100)) : 100
  return { cur, next, progress }
}

function dateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

const defaultState = (): GexmState => ({
  points: 660,
  earned: 660,
  lastCheckin: '',
  streak: 0,
  favs: [{ pid: 'x2', spec: '红轴', at: Date.now() }],
  logs: [{ id: uid('l'), label: '新会员礼包', delta: 660, at: Date.now() }],
  syncs: [],
})

function loadGexm(): GexmState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as GexmState
      if (
        p && typeof p.points === 'number' && typeof p.earned === 'number' &&
        typeof p.lastCheckin === 'string' && typeof p.streak === 'number' &&
        Array.isArray(p.favs) && Array.isArray(p.logs) && Array.isArray(p.syncs)
      ) {
        return p
      }
    }
  } catch { /* 忽略损坏数据 */ }
  return defaultState()
}

function persist(next: GexmState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
}

export function GexmPage() {
  const toast = useToast()
  const [st, setSt] = useState<GexmState>(loadGexm)
  const [term, setTerm] = useState<Term>('app')
  const [tab, setTab] = useState<Tab>('home')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [kw, setKw] = useState('')
  const [cat, setCat] = useState('全部')
  const [sku, setSku] = useState('')
  const [booting, setBooting] = useState(true)
  const [banner, setBanner] = useState(0)
  const [cd, setCd] = useState(5427)
  const [online, setOnline] = useState(true)

  const update = (fn: (prev: GexmState) => GexmState) => {
    setSt((prev) => {
      const next = fn(prev)
      persist(next)
      return next
    })
  }

  /* 会话内动效：首屏骨架、轮播、秒杀倒计时 */
  useEffect(() => {
    const t = window.setTimeout(() => setBooting(false), 700)
    return () => window.clearTimeout(t)
  }, [])
  useEffect(() => {
    const t = window.setInterval(() => setBanner((b) => (b + 1) % BANNERS.length), 4000)
    return () => window.clearInterval(t)
  }, [])
  useEffect(() => {
    const t = window.setInterval(() => setCd((s) => (s <= 1 ? 7200 : s - 1)), 1000)
    return () => window.clearInterval(t)
  }, [])

  /* 离线同步：恢复在线后逐条同步，偶发冲突 → 下一轮自动以本地为准解决 */
  useEffect(() => {
    if (!online || !st.syncs.some((s) => s.status !== 'success')) return
    const t = window.setTimeout(() => {
      setSt((prev) => {
        const target = prev.syncs.find((s) => s.status !== 'success')
        if (!target) return prev
        let task: SyncTask
        if (target.status === 'conflict') {
          task = { ...target, status: 'success', note: '冲突已解决：以本地为准' }
        } else if (Math.random() < 0.2) {
          task = { ...target, status: 'conflict', retries: target.retries + 1 }
        } else {
          task = { ...target, status: 'success' }
        }
        const next: GexmState = { ...prev, syncs: prev.syncs.map((s) => (s.id === target.id ? task : s)) }
        persist(next)
        return next
      })
    }, 800)
    return () => window.clearTimeout(t)
  }, [online, st.syncs])

  const enqueue = (prev: GexmState, label: string): SyncTask[] =>
    [...prev.syncs.slice(-29), { id: uid('s'), label, status: online ? 'success' : 'pending', retries: 0, at: Date.now() }]

  const openDetail = (p: GProduct) => {
    setDetailId(p.id)
    setSku(p.specs[0])
  }

  const toggleFav = (p: GProduct, spec: string) => {
    const exists = st.favs.some((f) => f.pid === p.id && f.spec === spec)
    const label = (exists ? '取消收藏：' : '收藏：') + p.name + ' · ' + spec
    update((prev) => ({
      ...prev,
      favs: exists ? prev.favs.filter((f) => !(f.pid === p.id && f.spec === spec)) : [...prev.favs, { pid: p.id, spec, at: Date.now() }],
      syncs: enqueue(prev, label),
    }))
    toast(exists ? `已取消收藏：${p.name}` : `已收藏：${p.name}（${spec}）`)
  }

  const checkin = () => {
    if (st.lastCheckin === dateStr()) {
      toast('今日已签到，明天再来～')
      return
    }
    const streak = st.lastCheckin === dateStr(-1) ? st.streak + 1 : 1
    const bonus = streak % 7 === 0 ? 20 : 0
    const delta = 5 + bonus
    update((prev) => ({
      ...prev,
      points: prev.points + delta,
      earned: prev.earned + delta,
      streak,
      lastCheckin: dateStr(),
      logs: [...prev.logs, { id: uid('l'), label: bonus ? `连续签到 ${streak} 天奖励` : `每日签到（第 ${streak} 天）`, delta, at: Date.now() }],
      syncs: enqueue(prev, '签到数据同步'),
    }))
    toast(bonus ? `连签奖励！+${delta} 积分` : `签到成功 +${delta} 积分`)
  }

  const reset = () => {
    if (window.confirm('确定重置多端商城演示数据吗？')) {
      const d = defaultState()
      setSt(d)
      persist(d)
      setDetailId(null)
      toast('已恢复默认演示数据')
    }
  }

  /* ---------- 派生数据 ---------- */
  const kwTrim = kw.trim().toLowerCase()
  const matchKw = (p: GProduct) => !kwTrim || p.name.toLowerCase().includes(kwTrim)
  const homeList = PRODUCTS.filter(matchKw)
  const cateList = PRODUCTS.filter((p) => (cat === '全部' || p.cat === cat) && matchKw)
  const detail = PRODUCTS.find((p) => p.id === detailId) ?? null
  const detailFaved = detail ? st.favs.some((f) => f.pid === detail.id && f.spec === sku) : false
  const favCount = st.favs.length
  const pendingCount = st.syncs.filter((s) => s.status !== 'success').length
  const lv = levelOf(st.earned)
  const checkedToday = st.lastCheckin === dateStr()
  const cdText = [Math.floor(cd / 3600), Math.floor((cd % 3600) / 60), cd % 60].map((n) => String(n).padStart(2, '0')).join(':')

  const goTab = (t: Tab) => {
    setTab(t)
    setDetailId(null)
  }

  /* ---------- 商品卡片 ---------- */
  const productCard = (p: GProduct) => (
    <button key={p.id} className="gexm-pcard" onClick={() => openDetail(p)}>
      <span className="gexm-pimg">{p.emoji}</span>
      <b className="gexm-pname">{p.name}</b>
      <span className="gexm-prow">
        <em className="gexm-pprice">¥{p.price}</em>
        <small>{formatCount(p.sales)} 人已看</small>
      </span>
    </button>
  )

  /* ---------- 应用内视图 ---------- */
  const renderHome = () => (
    <>
      <button className="gexm-banner" onClick={() => setBanner((b) => (b + 1) % BANNERS.length)}>
        <span className="gexm-banner-emoji">{BANNERS[banner].emoji}</span>
        <span className="gexm-banner-txt">
          <b>{BANNERS[banner].title}</b>
          <small>{BANNERS[banner].sub}</small>
        </span>
        <span className="gexm-dots">
          {BANNERS.map((_, i) => (
            <i key={i} className={cx('gexm-dot', i === banner && 'on')} onClick={(e) => { e.stopPropagation(); setBanner(i) }} />
          ))}
        </span>
      </button>
      <div className="gexm-seckill">
        <div className="gexm-sec-head">
          <b>⚡ 限时秒杀</b>
          <span className="gexm-cd">{cdText}</span>
        </div>
        <div className="gexm-sec-row">
          {SECKILLS.map((p) => (
            <button key={p.id} className="gexm-sec-item" onClick={() => openDetail(p)}>
              <span className="gexm-sec-emoji">{p.emoji}</span>
              <b>{p.name}</b>
              <em>¥{p.sec!.price}</em>
              <span className="gexm-sec-bar"><i style={{ width: `${p.sec!.pct}%` }} /></span>
              <small>已抢 {p.sec!.pct}%</small>
            </button>
          ))}
        </div>
      </div>
      <div className="gexm-cats">
        {['全部', ...CATS].map((c) => (
          <button key={c} className="gexm-cat" onClick={() => { setCat(c); goTab('cate') }}>
            <i>{CAT_EMOJI[c]}</i>
            {c}
          </button>
        ))}
      </div>
      <p className="gexm-sec-title">{kwTrim ? `🔍 “${kw.trim()}” 搜索结果` : '🔥 为你推荐'}</p>
      <div className="gexm-grid">{homeList.map(productCard)}</div>
      {homeList.length === 0 && <Empty emoji="🔍" text="没有找到相关商品" />}
    </>
  )

  const renderCate = () => (
    <div className="gexm-cate">
      <div className="gexm-rail">
        {['全部', ...CATS].map((c) => (
          <button key={c} className={cx('gexm-rail-item', cat === c && 'active')} onClick={() => setCat(c)}>
            {CAT_EMOJI[c]} {c}
          </button>
        ))}
      </div>
      <div className="gexm-cate-list">
        {cateList.length === 0 ? <Empty emoji="🧺" text="该分类暂无商品" /> : cateList.map(productCard)}
      </div>
    </div>
  )

  const renderMine = () => (
    <>
      <div className="gexm-member">
        <div className="gexm-member-top">
          <span className="gexm-avatar">🧑‍💼</span>
          <span>
            <b>demo 用户</b>
            <small>{lv.cur.name} · 连签 {st.streak} 天</small>
          </span>
          <em className="gexm-member-pts">💎 {st.points} 积分</em>
        </div>
        <div className="gexm-lvl-bar"><i style={{ width: `${lv.progress}%` }} /></div>
        <small className="gexm-lvl-hint">
          {lv.next ? `再获 ${lv.next.min - st.earned} 积分升级 ${lv.next.name}` : '已达最高等级 🎉'}
        </small>
      </div>
      <p className="gexm-sec-title">♡ 我的收藏（{favCount}）</p>
      {favCount === 0 ? (
        <Empty emoji="🤍" text="还没有收藏，去首页逛逛吧" />
      ) : (
        <div className="gexm-favlist">
          {st.favs.map((f) => {
            const p = PRODUCTS.find((x) => x.id === f.pid)
            if (!p) return null
            return (
              <div key={f.pid + f.spec} className="gexm-fav">
                <span className="gexm-fav-emoji">{p.emoji}</span>
                <span className="gexm-fav-main">
                  <b>{p.name}</b>
                  <small>规格：{f.spec} · ¥{p.price}</small>
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => toggleFav(p, f.spec)}>移除</button>
              </div>
            )
          })}
        </div>
      )}
    </>
  )

  const renderDetail = () => (
    <div className="gexm-detail">
      <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setDetailId(null)}>
        ← 返回
      </button>
      <div className="gexm-dimg">{detail!.emoji}</div>
      <div className="gexm-dinfo">
        <b>{detail!.name}</b>
        <span className="tag" style={{ marginLeft: 8 }}>{detail!.cat}</span>
        <p className="gexm-dprice">
          ¥{detail!.sec ? detail!.sec.price : detail!.price}
          {detail!.sec && <small style={{ textDecoration: 'line-through' }}>¥{detail!.price}</small>}
          <small>已售 {formatCount(detail!.sales)}</small>
        </p>
        <p className="muted" style={{ margin: '0 0 4px', fontSize: 13 }}>选择规格</p>
        <div className="gexm-skus">
          {detail!.specs.map((s) => (
            <button key={s} className={cx('gexm-sku', sku === s && 'active')} onClick={() => setSku(s)}>{s}</button>
          ))}
        </div>
        <button className="btn btn-primary" onClick={() => toggleFav(detail!, sku)}>
          {detailFaved ? '♥ 已收藏' : '♡ 收藏商品'}
        </button>
        <p className="muted gexm-dhint">
          演示环境：收藏操作进入数据同步队列{online ? '，实时同步' : '（当前离线，恢复在线后自动同步）'}
        </p>
      </div>
    </div>
  )

  const renderSkeleton = () => (
    <>
      <span className="skel gexm-skel-banner" />
      <div className="gexm-grid">
        {Array.from({ length: term === 'pc' ? 6 : 4 }).map((_, i) => (
          <span key={i} className="skel gexm-skel-card" />
        ))}
      </div>
    </>
  )

  return (
    <div className="page-grid">
      <div>
        <h2 className="page-title">
          🛍️ Gexm 多端商城
          <span className="gexm-term-tag">{TERM_META[term].icon} {TERM_META[term].label} 端预览</span>
        </h2>
        <div className={cx('gexm-device', term)}>
          {term === 'h5' && (
            <div className="gexm-browser"><i /><i /><i /><span>gexm.demo/h5</span></div>
          )}
          {(term === 'app' || term === 'mp') && (
            <div className="gexm-statusbar"><span>9:41</span><span>📶 🔋86%</span></div>
          )}
          {term === 'mp' && (
            <div className="gexm-capsule-row"><span className="gexm-capsule">⋯ ⊙</span></div>
          )}
          {term === 'pc' && (
            <div className="gexm-navbar">
              <b className="gexm-brand">⚡ Gexm</b>
              {(['home', 'cate', 'mine'] as Tab[]).map((t) => (
                <button key={t} className={cx('gexm-navlink', tab === t && !detail && 'active')} onClick={() => goTab(t)}>
                  {TAB_META[t]}
                </button>
              ))}
              <input className="input gexm-search" placeholder="搜索全平台好物" value={kw} onChange={(e) => setKw(e.target.value)} />
              <span className="gexm-nav-pts">💎 {st.points}</span>
            </div>
          )}
          <div className="gexm-app">
            {term !== 'pc' && (
              <div className="gexm-apphead">
                <b className="gexm-brand-sm">⚡ Gexm</b>
                <input className="input gexm-search" placeholder="搜索全平台好物" value={kw} onChange={(e) => setKw(e.target.value)} />
              </div>
            )}
            {booting ? renderSkeleton() : detail ? renderDetail() : tab === 'home' ? renderHome() : tab === 'cate' ? renderCate() : renderMine()}
          </div>
          {term !== 'pc' && (
            <div className="gexm-tabbar">
              {(['home', 'cate', 'mine'] as Tab[]).map((t) => (
                <button key={t} className={cx('gexm-tab', tab === t && !detail && 'active')} onClick={() => goTab(t)}>
                  <i>{TAB_ICON[t]}</i>
                  {TAB_META[t]}
                  {t === 'mine' && favCount > 0 && <em className="gexm-badge">{favCount}</em>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div>
        <div className="side-card">
          <h3>🖥️ 多端运行</h3>
          <div className="gexm-term-row">
            {(Object.keys(TERM_META) as Term[]).map((t) => (
              <button key={t} className={cx('gexm-term-btn', term === t && 'active')} onClick={() => { setTerm(t); setDetailId(null) }}>
                {TERM_META[t].icon} {TERM_META[t].label}
              </button>
            ))}
          </div>
          <ul className="gexm-term-desc">
            {TERM_META[term].desc.map((d) => <li key={d}>{d}</li>)}
          </ul>
          <p className="muted">同一套界面代码，切换端形态自动适配布局与导航。</p>
        </div>
        <div className="side-card">
          <h3>👑 会员成长</h3>
          <p className="gexm-lvl-now">{lv.cur.name}</p>
          <div className="gexm-lvl-bar"><i style={{ width: `${lv.progress}%` }} /></div>
          <p className="muted" style={{ margin: '4px 0 10px', fontSize: 12 }}>
            {lv.next ? `再获 ${lv.next.min - st.earned} 积分升级 ${lv.next.name}` : '已达最高等级'}
          </p>
          <button className="btn btn-primary btn-sm" disabled={checkedToday} onClick={checkin}>
            {checkedToday ? '✅ 今日已签到' : '📅 每日签到 +5 积分'}
          </button>
          <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>已连签 {st.streak} 天 · 每 7 天额外 +20</p>
          <div className="gexm-logs">
            {st.logs.length === 0 ? (
              <p className="muted">暂无积分流水</p>
            ) : (
              st.logs.slice(-4).reverse().map((l) => (
                <div key={l.id} className="gexm-log-row">
                  <span className="gexm-log-label">{l.label}</span>
                  <span className="gexm-log-plus">+{l.delta}</span>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="side-card">
          <h3>🔄 数据同步台</h3>
          <div className="gexm-sync-top">
            <button className={cx('gexm-switch', !online && 'off')} onClick={() => setOnline((o) => !o)} aria-label="切换在线状态">
              <i />
            </button>
            <span>{online ? '🟢 在线' : '🔴 离线（操作暂存本地）'}</span>
          </div>
          {pendingCount > 0 && (
            <p className="gexm-pending">待同步 {pendingCount} 条{online ? '，同步中…' : ''}</p>
          )}
          <div className="gexm-sync-list">
            {st.syncs.length === 0 ? (
              <p className="muted">暂无同步记录，收藏 / 签到等操作后会出现在这里</p>
            ) : (
              st.syncs.slice(-6).reverse().map((s) => (
                <div key={s.id} className="gexm-sync-row" title={s.note}>
                  <span className="gexm-sync-label">{s.label}</span>
                  <span className={cx('gexm-st', s.status)}>
                    {s.status === 'success' ? '已同步' : s.status === 'pending' ? '待同步' : `冲突·重试${s.retries}`}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={reset}>重置演示数据</button>
      </div>
    </div>
  )
}
