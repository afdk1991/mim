import { useMemo, useState } from 'react'
import { useToast } from './components'
import { cx, timeAgo, uid } from './utils'

/* 邮箱聚合：多账户统一收件箱（mock）。
   覆盖：账户切换、搜索、已读、标星、AI 摘要、模拟新邮件推送。 */

interface MailAccount { id: string; label: string; emoji: string; color: string }
interface Mail {
  id: string; accountId: string; from: string; subject: string
  body: string[]; at: number; read: boolean; starred: boolean; aiSummary: string | null
}
interface EmailState { mails: Mail[] }

const STORAGE_KEY = 'mim-email-v1'

const ACCOUNTS: MailAccount[] = [
  { id: 'qq', label: 'QQ 邮箱', emoji: '🐧', color: '#12b7f5' },
  { id: 'gmail', label: 'Gmail', emoji: '✉️', color: '#ea4335' },
  { id: 'work', label: '企业邮箱', emoji: '🏢', color: '#2b9cf4' },
]

function acctOf(id: string): MailAccount { return ACCOUNTS.find((a) => a.id === id) ?? ACCOUNTS[0] }

function seedMails(): Mail[] {
  const now = Date.now()
  const mk = (accountId: string, from: string, subject: string, body: string[], minsAgo: number, read = false, starred = false): Mail => ({
    id: uid('ml'), accountId, from, subject, body,
    at: now - minsAgo * 60000, read, starred, aiSummary: null,
  })
  return [
    mk('qq', '腾讯云', '您的云服务器即将到期', ['尊敬的用户：', '您的云服务器 qcloud-8721 将于 3 天后到期，到期后数据将保留 7 天。', '请及时续费以免影响业务。', '—— 腾讯云团队'], 35),
    mk('qq', '哔哩哔哩', '你的好友上传了新视频', ['UP主「数码小站」发布了新视频：', '《2026 年了，这台老笔记本还能战吗？》', '点击登录查看完整内容。'], 260),
    mk('qq', '12306', '订票成功通知', ['您已成功购买 10 月 21 日 G1024 次列车车票。', '车次：G1024  08:15 开', '座位：05 车 12A 号', '祝您旅途愉快！'], 1500, true),
    mk('gmail', 'GitHub', '[mim] Weekly digest', ['Your repository afdk1991/mim had activity this week:', '- 3 new stars', '- 12 visitors', 'CI runs: all green ✅'], 90, false, true),
    mk('gmail', 'Newsletter Weekly', 'Issue #88: Frontend in 2026', ['This week in frontend:', 'React 19 stable landed', 'Vite 6 released with rolldown default', 'TypeScript 6.0 beta is out'], 800),
    mk('gmail', 'Stripe', 'Your payout is on the way', ['Hi there,', 'A payout of $1,240.00 was initiated to your bank account ending in 4242.', 'It should arrive in 1-2 business days.'], 2100, true),
    mk('work', '人事部-李莉', '10 月工资条已发放', ['各位同事：', '10 月工资条已通过 OA 系统发放，请登录查看。', '如有疑问请在 3 个工作日内联系人事部。'], 55),
    mk('work', '产品组-周会纪要', '周三评审会纪要与行动项', ['一、评审结论', '- 配送调度台二期通过，预计下周三提测', '- 导航模块 UI 细节返工（地图配色）', '二、行动项', '1. 后端同步网关文档（张伟）', '2. 补充埋点方案（王芳）'], 400, false, true),
    mk('work', '安全中心', '异地登录提醒', ['检测到您的账号于今晨 02:41 在新设备（iOS）登录。', '如非本人操作，请立即修改密码并开启二次验证。'], 1200),
  ]
}

const NEW_TEMPLATES: Array<{ accountId: string; from: string; subject: string; body: string[] }> = [
  { accountId: 'qq', from: '饿了么', subject: '您的订单已送达', body: ['您的外卖订单已由骑手「王师傅」送达，', '感谢使用，欢迎给骑手评价。'] },
  { accountId: 'gmail', from: 'Google Safety', subject: 'New sign-in on Windows', body: ['Your Google Account was just signed in to from a new Windows device.', 'If this was you, no action is needed.'] },
  { accountId: 'work', from: '技术部-值班表', subject: '本周值班安排', body: ['本周值班：周一 张伟 / 周三 李娜 / 周五 王强。', '值班期间请保持电话畅通。'] },
  { accountId: 'qq', from: '网易云音乐', subject: '你的季度听歌报告生成啦', body: ['过去三个月你共听了 1,208 首歌，', '最常听的时段是深夜 23 点。'] },
  { accountId: 'work', from: '运维监控', subject: '告警：磁盘使用率超 85%', body: ['主机 prod-web-02 磁盘使用率 87%，超过阈值。', '请值班同事尽快处理。'] },
]

function loadEmail(): EmailState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as EmailState
      if (parsed && Array.isArray(parsed.mails)) {
        // 元素级校验：剔除脏数据，避免损坏存档导致列表/详情渲染异常
        const mails = parsed.mails.filter(
          (m): m is Mail =>
            !!m && typeof m === 'object' &&
            typeof m.id === 'string' && typeof m.accountId === 'string' &&
            typeof m.from === 'string' && typeof m.subject === 'string' &&
            Array.isArray(m.body) && m.body.every((b): b is string => typeof b === 'string') &&
            typeof m.at === 'number' && Number.isFinite(m.at) &&
            typeof m.read === 'boolean' && typeof m.starred === 'boolean',
        )
        return { mails }
      }
    }
  } catch { /* 忽略损坏数据 */ }
  return { mails: seedMails() }
}

/** 按主题关键词生成 mock AI 摘要 */
function genSummary(m: Mail): string {
  const s = m.subject
  if (/到期|续费|账单|payout|工资/.test(s)) return '账单提醒类邮件：涉及付费或到账事项，建议确认金额与截止日期，避免逾期影响使用。'
  if (/登录|安全|密码|告警/.test(s)) return '安全提醒类邮件：涉及账号登录或系统告警，请核实是否本人操作，必要时立即改密或处理。'
  if (/纪要|评审|周报|digest|值班/.test(s)) return '工作沟通类邮件：包含结论与行动项，建议提取待办并同步给相关同事。'
  if (/订票|车票/.test(s)) return '出行凭证类邮件：含车次与座位信息，出行当日请提前到场，注意保管订单号。'
  return '资讯类邮件：无时效性动作要求，可稍后阅读或直接归档。'
}

export function EmailHubPage() {
  const toast = useToast()
  const [state, setState] = useState<EmailState>(loadEmail)
  const [filter, setFilter] = useState<string>('all')
  const [q, setQ] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  const mails = state.mails
  const save = (next: EmailState) => {
    setState(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  const unreadOf = (acct: string) => mails.filter((m) => m.accountId === acct && !m.read).length
  const totalUnread = mails.filter((m) => !m.read).length
  const starredCount = mails.filter((m) => m.starred).length

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return mails
      .filter((m) => filter === 'all' || m.accountId === filter)
      .filter((m) => !kw || m.subject.toLowerCase().includes(kw) || m.from.toLowerCase().includes(kw) || m.body.join('\n').toLowerCase().includes(kw))
      .sort((a, b) => b.at - a.at)
  }, [mails, filter, q])

  const selected = selectedId ? mails.find((m) => m.id === selectedId) ?? null : null

  const openMail = (m: Mail) => {
    setSelectedId(m.id)
    if (!m.read) save({ mails: mails.map((x) => (x.id === m.id ? { ...x, read: true } : x)) })
  }

  const toggleStar = (m: Mail) => {
    save({ mails: mails.map((x) => (x.id === m.id ? { ...x, starred: !x.starred } : x)) })
    toast(m.starred ? '已取消标星' : '已标星 ⭐')
  }

  const askAi = (m: Mail) => {
    if (m.aiSummary || aiLoading) return
    setAiLoading(true)
    window.setTimeout(() => {
      const summary = genSummary(m)
      setAiLoading(false)
      setState((prev) => {
        const next = { ...prev, mails: prev.mails.map((x) => (x.id === m.id ? { ...x, aiSummary: summary } : x)) }
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
        return next
      })
    }, 1000)
  }

  const recvNew = () => {
    const t = NEW_TEMPLATES[Math.floor(Math.random() * NEW_TEMPLATES.length)]
    const mail: Mail = {
      id: uid('ml'), accountId: t.accountId, from: t.from, subject: t.subject,
      body: t.body, at: Date.now(), read: false, starred: false, aiSummary: null,
    }
    save({ mails: [mail, ...mails] })
    toast(`📬 新邮件：${t.subject}`)
  }

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">📬 邮箱聚合</h2>

        <div className="stat-row">
          <div className="stat-box"><b>{ACCOUNTS.length}</b><span>邮箱账户</span></div>
          <div className="stat-box"><b>{mails.length}</b><span>全部邮件</span></div>
          <div className="stat-box"><b>{totalUnread}</b><span>未读</span></div>
          <div className="stat-box"><b>{starredCount}</b><span>已标星</span></div>
        </div>

        <div className="card">
          <div className="chip-row">
            <span className={cx('chip', filter === 'all' && 'active')} onClick={() => { setFilter('all'); setSelectedId(null) }}>
              📥 全部收件箱{totalUnread > 0 && <i className="acct-badge">{totalUnread}</i>}
            </span>
            {ACCOUNTS.map((a) => (
              <span key={a.id} className={cx('chip', filter === a.id && 'active')} onClick={() => { setFilter(a.id); setSelectedId(null) }}>
                {a.emoji} {a.label}
                {unreadOf(a.id) > 0 && <i className="acct-badge">{unreadOf(a.id)}</i>}
              </span>
            ))}
          </div>
          <div className="board-toolbar" style={{ marginTop: 10 }}>
            <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="搜索主题、发件人或正文…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="toolbar-actions">
              <button className="btn btn-primary btn-sm" onClick={recvNew}>📮 模拟新邮件</button>
            </div>
          </div>
        </div>

        {selected ? (
          <div className="card">
            <div className="board-toolbar">
              <b>📧 {selected.subject}</b>
              <div className="toolbar-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setSelectedId(null)}>← 返回列表</button>
                <button className="btn btn-ghost btn-sm" onClick={() => toggleStar(selected)}>{selected.starred ? '★ 取消标星' : '☆ 标星'}</button>
              </div>
            </div>
            <p className="muted" style={{ margin: '8px 0' }}>
              {acctOf(selected.accountId).emoji} {acctOf(selected.accountId).label} · 来自 {selected.from} · {timeAgo(selected.at)}
            </p>
            <button className="btn btn-ghost btn-sm" onClick={() => askAi(selected)} disabled={aiLoading || !!selected.aiSummary}>
              {aiLoading ? '🤖 AI 正在总结…' : selected.aiSummary ? '🤖 已生成摘要' : '🤖 AI 摘要'}
            </button>
            {selected.aiSummary && (
              <div className="ai-box"><b>AI 摘要：</b>{selected.aiSummary}</div>
            )}
            <div className="mail-body">
              {selected.body.map((line, i) => <p key={i}>{line}</p>)}
            </div>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {list.length === 0 && <p className="muted" style={{ margin: 16 }}>没有匹配的邮件 🔍</p>}
            {list.map((m) => (
              <div key={m.id} className={cx('mail-row', !m.read && 'unread')} onClick={() => openMail(m)}>
                <i className={cx('mail-dot', m.read && 'read')} />
                <div className="mail-main">
                  <p className="mail-subject">{m.subject}{m.starred && <span className="mail-star">⭐</span>}</p>
                  <p className="mail-from">{acctOf(m.accountId).emoji} {m.from}</p>
                  <p className="mail-prev">{m.body[0]}</p>
                </div>
                <small className="muted">{timeAgo(m.at)}</small>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
