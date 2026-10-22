import { useState } from 'react'
import type { CSSProperties } from 'react'
import { getCurrentUserId } from './auth'
import { Empty, emitToast } from './components'
import { SITE_CONFIG } from './site-config'
import { cx } from './utils'

/* 邮箱聚合：经 worker/mail-proxy（Cloudflare Worker）代理 IMAP 收件 / SMTP 发信。
   浏览器无法直连 993/465 端口，须先部署中转 Worker（见 worker/mail-proxy/README），
   并把 Worker 地址填入 SITE_CONFIG.mailProxyUrl 或前端「账号设置」表单。
   凭据两种模式：① 服务端 Worker 环境变量注入（推荐，前端授权码留空即可）
   ② 前端自填账号 + 授权码（仅保存在本地 localStorage，按登录身份隔离）。
   未配置时展示接入指引，不伪造任何邮件数据。 */

type MailCfg = {
  proxyUrl: string
  imapHost: string
  imapPort: number
  smtpHost: string
  smtpPort: number
  user: string
  pass: string
}

type MailMsg = {
  uid: number
  flags: string[]
  date: string
  from: string
  to: string
  subject: string
  preview: string
}

type MailDetail = MailMsg & { text: string }

type Preset = {
  id: string
  label: string
  imapHost: string
  imapPort: number
  smtpHost: string
  smtpPort: number
  note: string
}

const PRESETS: Preset[] = [
  {
    id: 'qq',
    label: 'QQ 邮箱',
    imapHost: 'imap.qq.com',
    imapPort: 993,
    smtpHost: 'smtp.qq.com',
    smtpPort: 465,
    note: '网页版「设置 → 账户」开启 IMAP/SMTP 服务后生成授权码',
  },
  {
    id: '163',
    label: '网易 163',
    imapHost: 'imap.163.com',
    imapPort: 993,
    smtpHost: 'smtp.163.com',
    smtpPort: 465,
    note: '「设置 → POP3/IMAP/SMTP」开启服务后新增授权密码',
  },
  {
    id: 'gmail',
    label: 'Gmail',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    note: '需开启两步验证后生成「应用专用密码」',
  },
]

const mailKey = () => `mim-mail-v1:${getCurrentUserId()}`

function loadCfg(): MailCfg | null {
  try {
    const raw = localStorage.getItem(mailKey())
    if (!raw) return null
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== 'object') return null
    const o = v as Record<string, unknown>
    const proxyUrl = typeof o.proxyUrl === 'string' ? o.proxyUrl.trim() : ''
    if (!proxyUrl) return null
    const num = (d: unknown, def: number) =>
      typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : def
    const str = (d: unknown, def: string) => (typeof d === 'string' && d.trim() ? d.trim() : def)
    return {
      proxyUrl,
      imapHost: str(o.imapHost, 'imap.qq.com'),
      imapPort: num(o.imapPort, 993),
      smtpHost: str(o.smtpHost, 'smtp.qq.com'),
      smtpPort: num(o.smtpPort, 465),
      user: typeof o.user === 'string' ? o.user.trim() : '',
      pass: typeof o.pass === 'string' ? o.pass : '',
    }
  } catch {
    return null
  }
}

async function callApi(
  cfg: MailCfg,
  path: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = cfg.proxyUrl.replace(/\/+$/, '') + path
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: cfg.user, pass: cfg.pass, ...payload }),
  })
  let d: Record<string, unknown> = {}
  try {
    d = (await r.json()) as Record<string, unknown>
  } catch {
    /* 非 JSON 响应按空对象处理，走下方 HTTP 状态报错 */
  }
  if (!r.ok) {
    throw new Error(
      typeof d.error === 'string' && d.error ? d.error : `请求失败（HTTP ${r.status}）`,
    )
  }
  return d
}

/* 从「名字 <addr@x.com>」中提取尖括号内地址，用于回复 */
function extractAddr(from: string): string {
  const m = /<([^>]+)>/.exec(from)
  return m ? (m[1] ?? from.trim()) : from.trim()
}

const fmtTime = (s: string): string => {
  const t = new Date(s).getTime()
  if (!Number.isFinite(t)) return s
  return new Date(t).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--line, #d8dbe2)',
  fontSize: 14,
  boxSizing: 'border-box',
  background: 'transparent',
  color: 'inherit',
}

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: 'var(--muted, #8a8f99)',
  margin: '10px 0 4px',
}

/* ================= 首次接入：服务器配置表单 ================= */

function SetupForm({ onSaved }: { onSaved: (cfg: MailCfg) => void }) {
  const [preset, setPreset] = useState<Preset>(PRESETS[0] as Preset)
  const [proxyUrl, setProxyUrl] = useState<string>(SITE_CONFIG.mailProxyUrl)
  const [imapHost, setImapHost] = useState(PRESETS[0] ? PRESETS[0].imapHost : 'imap.qq.com')
  const [imapPort, setImapPort] = useState('993')
  const [smtpHost, setSmtpHost] = useState(PRESETS[0] ? PRESETS[0].smtpHost : 'smtp.qq.com')
  const [smtpPort, setSmtpPort] = useState('465')
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const pick = (p: Preset) => {
    setPreset(p)
    setImapHost(p.imapHost)
    setImapPort(String(p.imapPort))
    setSmtpHost(p.smtpHost)
    setSmtpPort(String(p.smtpPort))
  }

  const buildCfg = (): MailCfg => ({
    proxyUrl: proxyUrl.trim(),
    imapHost: imapHost.trim() || preset.imapHost,
    imapPort: Number(imapPort) || preset.imapPort,
    smtpHost: smtpHost.trim() || preset.smtpHost,
    smtpPort: Number(smtpPort) || preset.smtpPort,
    user: user.trim(),
    pass: pass.trim(),
  })

  const doTest = async () => {
    const cfg = buildCfg()
    if (!cfg.proxyUrl) {
      setErr('请先填写代理 Worker 地址（部署 worker/mail-proxy 后获得）')
      return
    }
    setBusy(true)
    setErr('')
    try {
      await callApi(cfg, '/imap/list', { host: cfg.imapHost, port: cfg.imapPort, count: 1 })
      emitToast('连接成功，IMAP 收件箱可访问')
    } catch (e) {
      setErr(e instanceof Error ? e.message : '连接失败')
    } finally {
      setBusy(false)
    }
  }

  const doSave = () => {
    const cfg = buildCfg()
    if (!cfg.proxyUrl) {
      setErr('请先填写代理 Worker 地址（部署 worker/mail-proxy 后获得）')
      return
    }
    if (!cfg.user) {
      setErr('请填写邮箱账号')
      return
    }
    if (!cfg.pass) {
      setErr('若 Worker 已配置服务端凭据（MAIL_USER/MAIL_PASS）可留空授权码，否则请填写授权码')
      return
    }
    try {
      localStorage.setItem(mailKey(), JSON.stringify(cfg))
    } catch {
      /* 存储失败不阻塞使用（本次会话内仍可用） */
    }
    onSaved(cfg)
    emitToast('邮箱配置已保存')
  }

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">📬 邮箱聚合</h2>
        <div className="card">
          <p className="muted" style={{ margin: '0 0 4px', fontSize: 13 }}>
            通过 IMAP 收件 / SMTP 发信接入真实邮箱。浏览器无法直连 993/465 端口，
            需先部署中转 Worker：<code>worker/mail-proxy</code>
            （Cloudflare Workers 免费额度内运行，见其 README）。
          </p>

          <label style={labelStyle}>邮箱服务商预设</label>
          <div className="chip-row" style={{ margin: '0 0 4px' }}>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={cx('chip', preset.id === p.id && 'active')}
                onClick={() => pick(p)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
            {preset.note}
          </p>

          <label style={labelStyle}>代理 Worker 地址（必填）</label>
          <input
            style={inputStyle}
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
            placeholder="https://mim-mail-proxy.<子域>.workers.dev"
          />

          <label style={labelStyle}>IMAP 服务器</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={inputStyle}
              value={imapHost}
              onChange={(e) => setImapHost(e.target.value)}
              placeholder="imap.qq.com"
            />
            <input
              style={{ ...inputStyle, width: 90 }}
              value={imapPort}
              onChange={(e) => setImapPort(e.target.value)}
              placeholder="993"
              inputMode="numeric"
            />
          </div>

          <label style={labelStyle}>SMTP 服务器</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={inputStyle}
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
              placeholder="smtp.qq.com"
            />
            <input
              style={{ ...inputStyle, width: 90 }}
              value={smtpPort}
              onChange={(e) => setSmtpPort(e.target.value)}
              placeholder="465"
              inputMode="numeric"
            />
          </div>

          <label style={labelStyle}>邮箱账号</label>
          <input
            style={inputStyle}
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="you@qq.com"
            autoComplete="username"
          />

          <label style={labelStyle}>授权码</label>
          <input
            style={inputStyle}
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="Worker 已配置服务端凭据时可留空"
            autoComplete="current-password"
          />

          {err && (
            <p style={{ margin: '10px 0 0', color: '#e5484d', fontSize: 13 }}>{err}</p>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn btn-ghost btn-sm" onClick={doTest} disabled={busy}>
              {busy ? '测试中…' : '测试连接'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={doSave} disabled={busy}>
              保存并使用
            </button>
          </div>

          <p className="muted" style={{ margin: '12px 0 0', fontSize: 12 }}>
            安全说明：授权码仅保存在你本机浏览器（按登录身份隔离），请求只发往你自建的
            Worker；推荐在 Worker 侧配置环境变量 MAIL_USER / MAIL_PASS，
            前端留空授权码即走服务端凭据模式，本机不留任何凭据。
          </p>
        </div>
      </div>
    </div>
  )
}

/* ================= 已配置：收件箱 / 详情 / 写信 ================= */

type View = 'list' | 'detail' | 'draft'

function MailBox({ cfg, onReset }: { cfg: MailCfg; onReset: () => void }) {
  const [msgs, setMsgs] = useState<MailMsg[]>([])
  const [readSet, setReadSet] = useState<Set<number>>(new Set())
  const [cur, setCur] = useState<MailDetail | null>(null)
  const [view, setView] = useState<View>('list')
  const [draft, setDraft] = useState({ to: '', subject: '', body: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')

  const refresh = async () => {
    if (busy) return
    setBusy('refresh')
    setErr('')
    try {
      const d = await callApi(cfg, '/imap/list', {
        host: cfg.imapHost,
        port: cfg.imapPort,
        count: 30,
      })
      const arr = Array.isArray(d.messages) ? (d.messages as unknown[]) : []
      const list: MailMsg[] = []
      for (const it of arr) {
        if (!it || typeof it !== 'object') continue
        const o = it as Record<string, unknown>
        list.push({
          uid: typeof o.uid === 'number' ? o.uid : 0,
          flags: Array.isArray(o.flags) ? o.flags.map(String) : [],
          date: typeof o.date === 'string' ? o.date : '',
          from: typeof o.from === 'string' ? o.from : '',
          to: typeof o.to === 'string' ? o.to : '',
          subject: typeof o.subject === 'string' && o.subject ? o.subject : '(无主题)',
          preview: typeof o.preview === 'string' ? o.preview : '',
        })
      }
      list.sort((a, b) => b.uid - a.uid)
      setMsgs(list)
      setCur(null)
      setView('list')
      emitToast(`已拉取 ${list.length} 封邮件`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '拉取失败')
    } finally {
      setBusy('')
    }
  }

  const openMsg = async (m: MailMsg) => {
    if (busy) return
    setBusy('open')
    setErr('')
    try {
      const d = await callApi(cfg, '/imap/fetch', {
        host: cfg.imapHost,
        port: cfg.imapPort,
        uid: m.uid,
      })
      const text = typeof d.text === 'string' ? d.text : ''
      setCur({ ...m, text })
      setView('detail')
      setReadSet((s) => new Set(s).add(m.uid))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '读取失败')
    } finally {
      setBusy('')
    }
  }

  const send = async () => {
    if (busy) return
    if (!draft.to.trim() || !draft.subject.trim() || !draft.body.trim()) {
      setErr('收件人、主题、正文均不能为空')
      return
    }
    setBusy('send')
    setErr('')
    try {
      await callApi(cfg, '/smtp/send', {
        host: cfg.smtpHost,
        port: cfg.smtpPort,
        from: cfg.user,
        to: draft.to.trim(),
        subject: draft.subject.trim(),
        body: draft.body,
      })
      emitToast('邮件已发送')
      setDraft({ to: '', subject: '', body: '' })
      setView('list')
    } catch (e) {
      setErr(e instanceof Error ? e.message : '发送失败')
    } finally {
      setBusy('')
    }
  }

  const replyTo = (m: MailDetail) => {
    setDraft({
      to: extractAddr(m.from),
      subject: m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`,
      body: '',
    })
    setErr('')
    setView('draft')
  }

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">📬 邮箱聚合</h2>

        <div
          className="card"
          style={{
            marginBottom: 10,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <strong style={{ fontSize: 14 }}>{cfg.user || '服务端凭据模式'}</strong>
          <span className="muted" style={{ fontSize: 12 }}>
            {cfg.imapHost}:{cfg.imapPort} · {cfg.smtpHost}:{cfg.smtpPort}
            {!cfg.pass ? ' · 凭据由 Worker 环境变量注入' : ''}
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm" onClick={refresh} disabled={!!busy}>
            {busy === 'refresh' ? '拉取中…' : '刷新收件箱'}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setErr('')
              setView('draft')
            }}
            disabled={!!busy}
          >
            写信
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onReset} disabled={!!busy}>
            账号设置
          </button>
        </div>

        {err && (
          <div className="card" style={{ marginBottom: 10 }}>
            <p style={{ margin: 0, color: '#e5484d', fontSize: 13 }}>{err}</p>
          </div>
        )}

        {view === 'draft' && (
          <div className="card">
            <label style={labelStyle}>收件人</label>
            <input
              style={inputStyle}
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              placeholder="to@example.com"
            />
            <label style={labelStyle}>主题</label>
            <input
              style={inputStyle}
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              placeholder="邮件主题"
            />
            <label style={labelStyle}>正文</label>
            <textarea
              style={{ ...inputStyle, minHeight: 180, resize: 'vertical' }}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              placeholder="邮件正文…"
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn btn-primary btn-sm" onClick={send} disabled={!!busy}>
                {busy === 'send' ? '发送中…' : '发送'}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setErr('')
                  setView(cur ? 'detail' : 'list')
                }}
                disabled={!!busy}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {view === 'detail' && cur && (
          <div className="card">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setErr('')
                setView('list')
              }}
              disabled={!!busy}
            >
              ← 返回列表
            </button>
            <h3 style={{ margin: '10px 0 4px', fontSize: 16, wordBreak: 'break-word' }}>
              {cur.subject}
            </h3>
            <p className="muted" style={{ margin: '0 0 10px', fontSize: 12, wordBreak: 'break-all' }}>
              发件人：{cur.from || '未知'} · {fmtTime(cur.date)}
              {cur.to ? ` · 收件人：${cur.to}` : ''}
            </p>
            <div
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 480,
                overflowY: 'auto',
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
              {cur.text || '(空正文)'}
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-primary btn-sm" onClick={() => replyTo(cur)} disabled={!!busy}>
                回复
              </button>
            </div>
          </div>
        )}

        {view === 'list' && (
          <div>
            {msgs.length === 0 ? (
              <div className="card">
                <Empty emoji="📭" text="点击「刷新收件箱」拉取 IMAP 邮件" />
              </div>
            ) : (
              msgs.map((m) => {
                const unread = !readSet.has(m.uid)
                return (
                  <div
                    key={m.uid}
                    className="card"
                    style={{
                      marginBottom: 8,
                      cursor: busy ? 'wait' : 'pointer',
                      display: 'flex',
                      gap: 10,
                      alignItems: 'flex-start',
                    }}
                    onClick={() => void openMsg(m)}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        marginTop: 6,
                        flexShrink: 0,
                        background: unread ? '#4f7cff' : 'transparent',
                      }}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 8,
                          alignItems: 'baseline',
                        }}
                      >
                        <strong
                          style={{
                            fontSize: 14,
                            fontWeight: unread ? 600 : 400,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {m.subject}
                        </strong>
                        <span className="muted" style={{ fontSize: 12, flexShrink: 0 }}>
                          {fmtTime(m.date)}
                        </span>
                      </div>
                      <div
                        className="muted"
                        style={{
                          fontSize: 12,
                          marginTop: 2,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {m.from || '未知发件人'} · {m.preview || '（无预览）'}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ================= 页面入口 ================= */

export function EmailHubPage() {
  const [cfg, setCfg] = useState<MailCfg | null>(() => loadCfg())

  if (!cfg) {
    return <SetupForm onSaved={(c) => setCfg(c)} />
  }

  return (
    <MailBox
      cfg={cfg}
      onReset={() => {
        try {
          localStorage.removeItem(mailKey())
        } catch {
          /* ignore */
        }
        setCfg(null)
      }}
    />
  )
}
