/* ==========================================================================
 * 邮箱聚合 —— 经代理服务 IMAP 收件 / SMTP 发信
 *
 * 为什么必须走代理：浏览器无法直连 IMAP 993 / SMTP 465，只能由自建中转服务代发代收。
 * 不伪造原则：没有代理地址 / 还没有收过信时一律空态 + 接入指引，绝不造一封假邮件。
 *
 * 凭据两种模式：① 前端自填账号 + 授权码（存本机，按身份隔离）
 *              ② 代理侧已配 MAIL_USER / MAIL_PASS，前端两者留空（本机不留任何凭据）
 * ======================================================================== */

import { useState } from 'react'
import { MAIL_PRESETS, type MailCfg, type MailMsg } from '@/domain/tools/model'
import { SITE_CONFIG } from '@/core/config'
import { loadLocal, saveLocal } from '@/data/sync'
import { cx, timeAgo } from '@/core/utils'
import { Empty, useToast } from '@/ui'

const SCOPE = 'tools'
const FIELD = 'mail'

const DEFAULT_CFG: MailCfg = {
  proxyUrl: SITE_CONFIG.mailProxyUrl,
  imapHost: MAIL_PRESETS[0]!.imapHost,
  imapPort: MAIL_PRESETS[0]!.imapPort,
  smtpHost: MAIL_PRESETS[0]!.smtpHost,
  smtpPort: MAIL_PRESETS[0]!.smtpPort,
  user: '',
  pass: '',
}

function parseCfg(raw: unknown): MailCfg | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const proxyUrl = typeof r.proxyUrl === 'string' ? r.proxyUrl.trim() : ''
  // 没有代理地址 = 没接入，直接回落 null，避免出现「配好了但发不出去」的半吊子状态
  if (!proxyUrl) return null
  const str = (v: unknown, d: string): string => (typeof v === 'string' && v.trim() ? v.trim() : d)
  const port = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d)
  return {
    proxyUrl,
    imapHost: str(r.imapHost, DEFAULT_CFG.imapHost),
    imapPort: port(r.imapPort, DEFAULT_CFG.imapPort),
    smtpHost: str(r.smtpHost, DEFAULT_CFG.smtpHost),
    smtpPort: port(r.smtpPort, DEFAULT_CFG.smtpPort),
    user: typeof r.user === 'string' ? r.user.trim() : '',
    pass: typeof r.pass === 'string' ? r.pass : '',
  }
}

/** 代理约定：POST JSON，失败时优先用响应里的 error 文案 */
async function callApi(cfg: MailCfg, path: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = `${cfg.proxyUrl.replace(/\/+$/, '')}${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: cfg.user, pass: cfg.pass, ...payload }),
  })
  let data: Record<string, unknown> = {}
  try {
    data = (await res.json()) as Record<string, unknown>
  } catch {
    /* 非 JSON 响应按空对象处理，走下方 HTTP 状态报错 */
  }
  if (!res.ok) {
    const msg = typeof data.error === 'string' && data.error ? data.error : `请求失败（HTTP ${res.status}）`
    throw new Error(msg)
  }
  return data
}

/* 「名字 <addr@x.com>」→ 尖括号内地址，回复时用得上 */
function replyAddr(from: string): string {
  const m = /<([^>]+)>/.exec(from)
  return m?.[1] ?? from.trim()
}

function parseMsgList(data: Record<string, unknown>): MailMsg[] {
  const arr = Array.isArray(data.messages) ? (data.messages as unknown[]) : []
  const out: MailMsg[] = []
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    out.push({
      uid: typeof o.uid === 'number' || typeof o.uid === 'string' ? String(o.uid) : '',
      flags: Array.isArray(o.flags) ? o.flags.map(String).join(' ') : typeof o.flags === 'string' ? o.flags : '',
      date: typeof o.date === 'string' ? o.date : '',
      from: typeof o.from === 'string' ? o.from : '',
      to: typeof o.to === 'string' ? o.to : '',
      subject: typeof o.subject === 'string' && o.subject ? o.subject : '(无主题)',
      preview: typeof o.preview === 'string' ? o.preview : '',
    })
  }
  return out.filter((m) => m.uid !== '')
}

/* ---------- 接入配置表单 ---------- */

function SetupForm({ onSaved }: { onSaved: (cfg: MailCfg) => void }) {
  const toast = useToast()
  const [cfg, setCfg] = useState<MailCfg>(DEFAULT_CFG)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const pickPreset = (id: string): void => {
    const p = MAIL_PRESETS.find((x) => x.id === id)
    if (!p) return
    setCfg({ ...cfg, imapHost: p.imapHost, imapPort: p.imapPort, smtpHost: p.smtpHost, smtpPort: p.smtpPort })
  }

  const test = async (): Promise<void> => {
    if (!cfg.proxyUrl) {
      setErr('请先填写代理服务地址')
      return
    }
    setBusy(true)
    setErr('')
    try {
      await callApi(cfg, '/imap/list', { host: cfg.imapHost, port: cfg.imapPort, count: 1 })
      toast('连接成功，IMAP 收件箱可访问')
    } catch (e) {
      setErr(e instanceof Error ? e.message : '连接失败')
    } finally {
      setBusy(false)
    }
  }

  const save = (): void => {
    if (!cfg.proxyUrl) {
      setErr('请先填写代理服务地址')
      return
    }
    // 服务端凭据模式：账号与授权码同时为空
    const serverMode = !cfg.user && !cfg.pass
    if (!serverMode && (!cfg.user || !cfg.pass)) {
      setErr('请填写邮箱账号与授权码；若代理已配置服务端凭据（MAIL_USER/MAIL_PASS）可将两者都留空')
      return
    }
    saveLocal(SCOPE, FIELD, cfg)
    onSaved(cfg)
    toast(serverMode ? '邮箱配置已保存（服务端凭据模式）' : '邮箱配置已保存')
  }

  return (
    <div className="card">
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        通过代理服务接入真实邮箱。浏览器无法直连 993/465 端口，需先部署自己的中转服务（如 Cloudflare Worker），
        并把地址填到下面。
      </p>

      <div className="section-title">邮箱服务商预设</div>
      <div className="chip-row">
        {MAIL_PRESETS.map((p) => (
          <button key={p.id} className={cx('chip', cfg.imapHost === p.imapHost && 'active')} onClick={() => pickPreset(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        {MAIL_PRESETS.find((p) => p.imapHost === cfg.imapHost)?.note ?? '自定义服务商请手工填写服务器地址'}
      </p>

      <div className="section-title">代理服务地址（必填）</div>
      <input className="input" value={cfg.proxyUrl} placeholder="https://mail-proxy.<子域>.workers.dev" onChange={(e) => setCfg({ ...cfg, proxyUrl: e.target.value })} />

      <div className="section-title">IMAP / SMTP 服务器</div>
      <div className="row wrap">
        <input className="input" style={{ maxWidth: 240 }} value={cfg.imapHost} onChange={(e) => setCfg({ ...cfg, imapHost: e.target.value })} placeholder="imap.qq.com" />
        <input className="input" style={{ maxWidth: 100 }} inputMode="numeric" value={String(cfg.imapPort)} onChange={(e) => setCfg({ ...cfg, imapPort: Number(e.target.value) || 993 })} />
        <input className="input" style={{ maxWidth: 240 }} value={cfg.smtpHost} onChange={(e) => setCfg({ ...cfg, smtpHost: e.target.value })} placeholder="smtp.qq.com" />
        <input className="input" style={{ maxWidth: 100 }} inputMode="numeric" value={String(cfg.smtpPort)} onChange={(e) => setCfg({ ...cfg, smtpPort: Number(e.target.value) || 465 })} />
      </div>

      <div className="section-title">凭据（服务端已配置时可留空）</div>
      <input className="input" style={{ marginBottom: 8 }} value={cfg.user} autoComplete="username" placeholder="you@example.com" onChange={(e) => setCfg({ ...cfg, user: e.target.value })} />
      <input className="input" type="password" autoComplete="current-password" value={cfg.pass} placeholder="授权码" onChange={(e) => setCfg({ ...cfg, pass: e.target.value })} />

      {err ? <p style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</p> : null}

      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void test()}>
          {busy ? '测试中…' : '测试连接'}
        </button>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>
          保存并使用
        </button>
      </div>

      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        安全说明：授权码仅保存在本机并按身份隔离，请求只发往你自己的代理服务。
      </p>
    </div>
  )
}

/* ---------- 收件箱 ---------- */

function MailBox({ cfg, onReset }: { cfg: MailCfg; onReset: () => void }) {
  const toast = useToast()
  const [msgs, setMsgs] = useState<MailMsg[]>([])
  const [busy, setBusy] = useState<'refresh' | 'open' | 'send' | ''>('')
  const [err, setErr] = useState('')
  const [cur, setCur] = useState<MailMsg | null>(null)
  const [body, setBody] = useState('')
  const [draft, setDraft] = useState({ to: '', subject: '', text: '' })

  const refresh = async (): Promise<void> => {
    setBusy('refresh')
    setErr('')
    try {
      const data = await callApi(cfg, '/imap/list', { host: cfg.imapHost, port: cfg.imapPort, count: 30 })
      const list = parseMsgList(data).sort((a, b) => Number(b.uid) - Number(a.uid))
      setMsgs(list)
      setCur(null)
      setBody('')
      toast(list.length > 0 ? `已拉取 ${list.length} 封邮件` : '收件箱为空')
    } catch (e) {
      setErr(e instanceof Error ? e.message : '收件失败')
    } finally {
      setBusy('')
    }
  }

  const openMsg = async (m: MailMsg): Promise<void> => {
    setBusy('open')
    setErr('')
    try {
      const data = await callApi(cfg, '/imap/fetch', { host: cfg.imapHost, port: cfg.imapPort, uid: m.uid })
      setCur(m)
      setBody(typeof data.text === 'string' ? data.text : '（无正文）')
      setDraft({ to: replyAddr(m.from), subject: `Re: ${m.subject}`, text: '' })
    } catch (e) {
      setErr(e instanceof Error ? e.message : '读取失败')
    } finally {
      setBusy('')
    }
  }

  const send = async (): Promise<void> => {
    if (!draft.to.trim()) {
      toast('请填写收件人')
      return
    }
    setBusy('send')
    setErr('')
    try {
      await callApi(cfg, '/smtp/send', {
        host: cfg.smtpHost,
        port: cfg.smtpPort,
        to: draft.to.trim(),
        subject: draft.subject.trim() || '(无主题)',
        text: draft.text,
      })
      toast('邮件已发送')
      setDraft({ to: '', subject: '', text: '' })
    } catch (e) {
      setErr(e instanceof Error ? e.message : '发送失败')
    } finally {
      setBusy('')
    }
  }

  return (
    <>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <button className="btn btn-primary btn-sm" disabled={busy !== ''} onClick={() => void refresh()}>
          {busy === 'refresh' ? '收信中…' : '⟳ 收取邮件'}
        </button>
        <span className="grow" />
        <span className="muted" style={{ fontSize: 12 }}>{cfg.user || '服务端凭据模式'}</span>
        <button className="btn btn-ghost btn-sm" onClick={onReset}>重新配置</button>
      </div>

      {err ? (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: 12 }}>
          <b style={{ color: 'var(--danger)' }}>请求失败</b>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{err}</p>
        </div>
      ) : null}

      {cur ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="row-between">
            <b>{cur.subject}</b>
            <button className="btn btn-ghost btn-sm" onClick={() => { setCur(null); setBody('') }}>关闭</button>
          </div>
          <p className="muted" style={{ margin: '4px 0 8px', fontSize: 12 }}>
            {cur.from} · {cur.date ? `${cur.date} · ` : ''}{timeAgo(Date.parse(cur.date) || 0)}
          </p>
          <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 13 }}>{body}</pre>
        </div>
      ) : null}

      {msgs.length === 0 ? (
        <Empty emoji="📭" text="还没收取过邮件：点击「收取邮件」从真实邮箱拉取（需要代理服务可访问）" />
      ) : (
        msgs.map((m) => (
          <div key={m.uid} className="notif-row" role="button" tabIndex={0} onClick={() => void openMsg(m)} onKeyDown={(e) => { if (e.key === 'Enter') void openMsg(m) }}>
            <span className="notif-icon">{m.flags.includes('\\Seen') ? '📖' : '📩'}</span>
            <div className="notif-body">
              <p style={{ margin: 0 }}>{m.subject}</p>
              <small className="muted">{m.from}</small>
              <small className="muted"> · {m.preview}</small>
            </div>
          </div>
        ))
      )}

      <div className="section-title">✍️ 写信</div>
      <div className="card">
        <input className="input" style={{ marginBottom: 8 }} placeholder="收件人" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        <input className="input" style={{ marginBottom: 8 }} placeholder="主题" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
        <textarea className="input" placeholder="正文" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
        <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} disabled={busy === 'send'} onClick={() => void send()}>
          {busy === 'send' ? '发送中…' : '发送'}
        </button>
      </div>
    </>
  )
}

export function EmailHubPage() {
  const [cfg, setCfg] = useState<MailCfg | null>(() => loadLocal(SCOPE, FIELD, parseCfg, null))

  return (
    <div className="page">
      <h1 className="page-title">📬 邮箱聚合</h1>
      {cfg ? <MailBox cfg={cfg} onReset={() => { saveLocal(SCOPE, FIELD, null); setCfg(null) }} /> : <SetupForm onSaved={setCfg} />}
    </div>
  )
}
