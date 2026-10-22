/* mim-mail-proxy：Mim 邮箱聚合代理（Cloudflare Workers，免费额度内）
 *
 * 浏览器无法直连邮箱 IMAP(993)/SMTP(465) 端口，本 Worker 通过
 * cloudflare:sockets 的 connect() 建立隐式 TLS 连接做最小协议中转。
 *
 * 三条路由（均为 POST + JSON）：
 *   /imap/list  {host, port?, user?, pass?, folder?, count?}
 *               → {exists, messages:[{uid,flags,date,from,to,subject,preview}]}
 *   /imap/fetch {host, port?, user?, pass?, folder?, uid}
 *               → {uid, from, to, subject, date, text}
 *   /smtp/send  {host, port?, user?, pass?, from?, to, subject, body}
 *               → {ok: true}
 *
 * 凭据优先级：Worker 环境变量 MAIL_USER / MAIL_PASS → 请求体 user / pass。
 * CORS 仅放行站点域名（BASE_ORIGINS / 环境变量 ALLOW_ORIGIN）。
 */

import { connect, type Socket } from 'cloudflare:sockets'

export interface Env {
  MAIL_USER?: string
  MAIL_PASS?: string
  ALLOW_ORIGIN?: string
}

const BASE_ORIGINS = [
  'https://afdk1991.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

/* ---------------- CORS / 响应 ---------------- */

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const allow = (env.ALLOW_ORIGIN && env.ALLOW_ORIGIN.trim()) || ''
  const ok = (allow && origin === allow) || BASE_ORIGINS.includes(origin)
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
  if (ok) h['Access-Control-Allow-Origin'] = origin
  return h
}

function json(data: unknown, status: number, req: Request, env: Env): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(req, env) },
  })
}

/* ---------------- 编解码工具 ---------------- */

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) ? n : fallback
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH))
  }
  return btoa(bin)
}

const latinStr = (b: Uint8Array): string => new TextDecoder('iso-8859-1').decode(b)

function latinToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

function decodeCharset(bytes: Uint8Array, charset = 'utf-8'): string {
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

const charsetOf = (ct: string): string => ct.match(/charset\s*=\s*"?([\w-]+)"?/i)?.[1] ?? ''

/** RFC 2047 编码词解码：=?charset?B|Q?data?= */
function rfc2047(s: string): string {
  if (!s) return ''
  const joined = s.replace(/(\?=)\s+(=\?)/g, '$1$2') // 相邻编码词间的空白按规范折叠
  return joined.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, cs: string, enc: string, data: string) => {
    try {
      if (enc.toUpperCase() === 'B') return decodeCharset(b64ToBytes(data), cs)
      const q = data.replace(/_/g, ' ')
      const bytes: number[] = []
      for (let i = 0; i < q.length; i++) {
        if (q[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(q.slice(i + 1, i + 3))) {
          bytes.push(Number.parseInt(q.slice(i + 1, i + 3), 16))
          i += 2
        } else {
          bytes.push(q.charCodeAt(i) & 0xff)
        }
      }
      return decodeCharset(new Uint8Array(bytes), cs)
    } catch {
      return data
    }
  })
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** 头部块（已含折行合并）→ 小写键 Map */
function parseHeaderBlock(head: string): Map<string, string> {
  const map = new Map<string, string>()
  let lastKey = ''
  for (const line of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && lastKey) {
      map.set(lastKey, `${map.get(lastKey) ?? ''} ${line.trim()}`)
      continue
    }
    const i = line.indexOf(':')
    if (i > 0) {
      const k = line.slice(0, i).trim().toLowerCase()
      if (!map.has(k)) map.set(k, line.slice(i + 1).trim())
      lastKey = k
    }
  }
  return map
}

/* ---------------- MIME 正文解析 ---------------- */

function findHeadEnd(raw: Uint8Array): number {
  for (let i = 0; i + 3 < raw.length; i++) {
    if (raw[i] === 13 && raw[i + 1] === 10 && raw[i + 2] === 13 && raw[i + 3] === 10) return i
  }
  for (let i = 0; i + 1 < raw.length; i++) {
    if (raw[i] === 10 && raw[i + 1] === 10) return i
  }
  return -1
}

/** Quoted-Printable 字节流解码（含软换行 =CRLF） */
function qpBytesToRaw(bytes: Uint8Array): Uint8Array {
  const isHex = (b: number) =>
    (b >= 48 && b <= 57) || (b >= 65 && b <= 70) || (b >= 97 && b <= 102)
  const out: number[] = []
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    if (b === 0x3d /* '=' */) {
      const b1 = bytes[i + 1]
      const b2 = bytes[i + 2]
      if (b1 === 13 && b2 === 10) {
        i += 2
        continue
      }
      if (b1 === 10) {
        i += 1
        continue
      }
      if (isHex(b1) && isHex(b2)) {
        out.push(Number.parseInt(String.fromCharCode(b1, b2), 16))
        i += 2
        continue
      }
    }
    out.push(b)
  }
  return new Uint8Array(out)
}

/** 按 boundary 拆一级 multipart（latin1 保字节，返回字符串块） */
function splitParts(bodyBytes: Uint8Array, boundary: string): string[] {
  const s = latinStr(bodyBytes)
  const chunks = s.split(`--${boundary}`)
  const parts: string[] = []
  for (let i = 1; i < chunks.length; i++) {
    const c = chunks[i]
    if (c.startsWith('--')) break // closing boundary
    parts.push(c.replace(/^\r?\n/, ''))
  }
  return parts
}

/** 解析单个 MIME 部件为文本；非文本部件返回 null */
function decodePart(part: string): { isHtml: boolean; text: string } | null {
  const m = part.match(/\r\n\r\n|\n\n/)
  if (!m || m.index === undefined || m.index < 0) return null
  const headers = parseHeaderBlock(part.slice(0, m.index))
  const body = part.slice(m.index + m[0].length)
  const ct = headers.get('content-type') ?? ''
  if (/multipart\//i.test(ct)) return null // 简化：不递归嵌套 multipart
  const isHtml = /text\/html/i.test(ct)
  if (ct && !isHtml && !/^text\/plain/i.test(ct)) return null // 只取文本部件
  const cte = (headers.get('content-transfer-encoding') ?? '').trim().toLowerCase()
  const charset = charsetOf(ct) || 'utf-8'
  let text: string
  if (cte === 'base64') {
    text = decodeCharset(b64ToBytes(body.replace(/[^A-Za-z0-9+/=]/g, '')), charset)
  } else if (cte === 'quoted-printable') {
    text = decodeCharset(qpBytesToRaw(latinToBytes(body)), charset)
  } else {
    text = decodeCharset(latinToBytes(body), charset)
  }
  return { isHtml, text }
}

/** 邮件原文 → 纯文本正文（优先 text/plain，回退 text/html） */
function parseMime(raw: Uint8Array): string {
  const headEnd = findHeadEnd(raw)
  if (headEnd < 0) return ''
  const sepLen = raw[headEnd] === 13 ? 4 : 2
  const headers = parseHeaderBlock(new TextDecoder('utf-8').decode(raw.subarray(0, headEnd)))
  const bodyBytes = raw.subarray(headEnd + sepLen)
  const ct = headers.get('content-type') ?? ''
  const boundary = ct.match(/boundary="?([^";]+)"?/i)?.[1]
  if (boundary) {
    let html: string | null = null
    for (const p of splitParts(bodyBytes, boundary)) {
      const d = decodePart(p)
      if (!d || !d.text.trim()) continue
      if (!d.isHtml) return d.text
      if (html === null) html = d.text
    }
    return html !== null ? stripHtml(html) : ''
  }
  const cte = (headers.get('content-transfer-encoding') ?? '').trim().toLowerCase()
  const charset = charsetOf(ct) || 'utf-8'
  let text: string
  if (cte === 'base64') {
    text = decodeCharset(b64ToBytes(latinStr(bodyBytes).replace(/[^A-Za-z0-9+/=]/g, '')), charset)
  } else if (cte === 'quoted-printable') {
    text = decodeCharset(qpBytesToRaw(bodyBytes), charset)
  } else {
    text = decodeCharset(bodyBytes, charset)
  }
  return /text\/html/i.test(ct) ? stripHtml(text) : text
}

/** 列表预览：解码 → （疑似 base64 正文时尝试解码前缀）→ 去标签 → 截 120 字 */
function extractPreview(lit?: Uint8Array): string {
  if (!lit || lit.length === 0) return ''
  let text = decodeCharset(lit).replace(/=\r?\n/g, '')
  const compact = text.replace(/[^A-Za-z0-9+/=\s]/g, '')
  if (compact.length > 40 && compact.length >= text.length * 0.95) {
    try {
      const b64 = compact.replace(/\s+/g, '')
      text = decodeCharset(b64ToBytes(b64.slice(0, Math.floor(b64.length / 4) * 4)))
    } catch {
      /* 保留原文 */
    }
  }
  return stripHtml(text).slice(0, 120)
}

/* ---------------- 行协议连接（共享 IMAP/SMTP） ---------------- */

class LineConn {
  private reader: ReadableStreamDefaultReader<Uint8Array>
  private writer: WritableStreamDefaultWriter<Uint8Array>
  private buf: Uint8Array = new Uint8Array(0)

  constructor(socket: Socket) {
    this.reader = socket.readable.getReader()
    this.writer = socket.writable.getWriter()
  }

  async write(line: string): Promise<void> {
    await this.writer.write(new TextEncoder().encode(`${line}\r\n`))
  }

  async writeRaw(bytes: Uint8Array): Promise<void> {
    await this.writer.write(bytes)
  }

  private append(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.buf.length + chunk.length)
    merged.set(this.buf, 0)
    merged.set(chunk, this.buf.length)
    this.buf = merged
  }

  private indexOfCrlf(): number {
    for (let i = 0; i + 1 < this.buf.length; i++) {
      if (this.buf[i] === 13 && this.buf[i + 1] === 10) return i
    }
    return -1
  }

  private take(n: number): Uint8Array {
    const out = this.buf.subarray(0, n)
    this.buf = this.buf.subarray(n)
    return out
  }

  /** 读一行；行尾 {N} 时继续读 N 字节 literal 一并返回 */
  async readLine(): Promise<{ text: string; literal?: Uint8Array }> {
    for (;;) {
      const i = this.indexOfCrlf()
      if (i >= 0) {
        const line = new TextDecoder().decode(this.take(i))
        this.take(2)
        const m = line.match(/\{(\d+)\}$/)
        if (m) {
          const n = Number.parseInt(m[1], 10)
          while (this.buf.length < n) {
            const { done, value } = await this.reader.read()
            if (done) break
            if (value) this.append(value)
          }
          const literal = this.take(Math.min(n, this.buf.length))
          if (this.buf.length >= 2 && this.buf[0] === 13 && this.buf[1] === 10) this.take(2)
          return { text: line, literal }
        }
        return { text: line }
      }
      const { done, value } = await this.reader.read()
      if (done) {
        const rest = new TextDecoder().decode(this.buf)
        this.buf = new Uint8Array(0)
        return { text: rest }
      }
      if (value) this.append(value)
    }
  }

  async close(): Promise<void> {
    try {
      await this.writer.close()
    } catch {
      /* ignore */
    }
    try {
      this.reader.releaseLock()
    } catch {
      /* ignore */
    }
  }
}

/* ---------------- IMAP ---------------- */

const imapQuote = (s: string): string => s.replace(/([\\"])/g, '\\$1')

class ImapConn {
  private conn: LineConn
  private seq = 0

  private constructor(conn: LineConn) {
    this.conn = conn
  }

  static async open(host: string, port: number): Promise<ImapConn> {
    const socket = connect({ hostname: host, port }, { secureTransport: 'on', allowHalfOpen: false })
    const c = new LineConn(socket)
    const greet = await c.readLine()
    if (!/^\* (OK|PREAUTH)/.test(greet.text)) {
      await c.close()
      throw new Error(`IMAP 服务器响应异常：${greet.text.slice(0, 120)}`)
    }
    return new ImapConn(c)
  }

  async cmd(line: string): Promise<{ status: string; entries: { text: string; literal?: Uint8Array }[] }> {
    const tag = `m${++this.seq}`
    await this.conn.write(`${tag} ${line}`)
    const entries: { text: string; literal?: Uint8Array }[] = []
    for (;;) {
      const r = await this.conn.readLine()
      if (r.text.startsWith(`${tag} `)) {
        return { status: r.text.slice(tag.length + 1).split(' ')[0] ?? '', entries }
      }
      entries.push(r)
    }
  }

  async login(user: string, pass: string): Promise<void> {
    const r = await this.cmd(`LOGIN "${imapQuote(user)}" "${imapQuote(pass)}"`)
    if (r.status !== 'OK') throw new Error('IMAP 登录失败：请检查邮箱账号与授权码')
  }

  async select(folder: string): Promise<number> {
    const r = await this.cmd(`SELECT ${folder === 'INBOX' ? 'INBOX' : `"${imapQuote(folder)}"`}`)
    if (r.status !== 'OK') throw new Error(`IMAP 打开邮箱夹失败：${folder}`)
    for (const e of r.entries) {
      const m = e.text.match(/^\* (\d+) EXISTS/)
      if (m) return Number.parseInt(m[1], 10)
    }
    return 0
  }

  async logout(): Promise<void> {
    try {
      await this.cmd('LOGOUT')
    } catch {
      /* ignore */
    }
    await this.conn.close()
  }
}

interface MailListItem {
  uid: number
  flags: string
  date: string
  from: string
  to: string
  subject: string
  preview: string
}

async function imapList(env: Env, req: Request, b: Record<string, unknown>): Promise<Response> {
  const host = str(b.host)
  if (!host) return json({ error: '缺少 IMAP 服务器地址' }, 400, req, env)
  const port = num(b.port, 993)
  const user = str(env.MAIL_USER ?? b.user).trim()
  const pass = str(env.MAIL_PASS ?? b.pass)
  const folder = str(b.folder, 'INBOX') || 'INBOX'
  const count = Math.min(Math.max(num(b.count, 20), 1), 50)

  const imap = await ImapConn.open(host, port)
  try {
    await imap.login(user, pass)
    const exists = await imap.select(folder)
    const messages: MailListItem[] = []
    if (exists > 0) {
      const start = Math.max(1, exists - count + 1)
      const r = await imap.cmd(
        `FETCH ${start}:${exists} (UID FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)] BODY.PEEK[TEXT]<0.200>)`,
      )
      if (r.status !== 'OK') throw new Error('IMAP 拉取邮件列表失败')
      interface Acc {
        uid: number
        flags: string
        headersRaw: string
        previewRaw?: Uint8Array
      }
      let acc: Acc | null = null
      const push = () => {
        if (!acc) return
        const h = parseHeaderBlock(acc.headersRaw)
        messages.push({
          uid: acc.uid,
          flags: acc.flags,
          date: rfc2047(h.get('date') ?? ''),
          from: rfc2047(h.get('from') ?? ''),
          to: rfc2047(h.get('to') ?? ''),
          subject: rfc2047(h.get('subject') ?? ''),
          preview: extractPreview(acc.previewRaw),
        })
        acc = null
      }
      for (const e of r.entries) {
        if (/^\* \d+ FETCH/.test(e.text)) {
          push()
          acc = {
            uid: Number.parseInt(e.text.match(/UID (\d+)/)?.[1] ?? '0', 10),
            flags: e.text.match(/FLAGS \(([^)]*)\)/)?.[1] ?? '',
            headersRaw: '',
          }
        } else if (acc && e.literal) {
          if (/HEADER\.FIELDS/.test(e.text)) acc.headersRaw = new TextDecoder('utf-8').decode(e.literal)
          else if (/TEXT/.test(e.text)) acc.previewRaw = e.literal
        }
      }
      push()
    }
    await imap.logout()
    return json({ exists, messages: messages.reverse() }, 200, req, env) // 最新在前
  } catch (e) {
    await imap.logout()
    throw e
  }
}

async function imapFetchOne(env: Env, req: Request, b: Record<string, unknown>): Promise<Response> {
  const host = str(b.host)
  if (!host) return json({ error: '缺少 IMAP 服务器地址' }, 400, req, env)
  const port = num(b.port, 993)
  const user = str(env.MAIL_USER ?? b.user).trim()
  const pass = str(env.MAIL_PASS ?? b.pass)
  const folder = str(b.folder, 'INBOX') || 'INBOX'
  const uid = num(b.uid, 0)
  if (uid <= 0) return json({ error: '缺少有效 uid' }, 400, req, env)

  const imap = await ImapConn.open(host, port)
  try {
    await imap.login(user, pass)
    await imap.select(folder)
    const r = await imap.cmd(`UID FETCH ${uid} (BODY.PEEK[])`)
    if (r.status !== 'OK') throw new Error('IMAP 拉取邮件正文失败')
    let raw: Uint8Array | undefined
    for (const e of r.entries) {
      if (e.literal && /BODY\[\]/.test(e.text)) {
        raw = e.literal
        break
      }
    }
    if (!raw) throw new Error('未找到邮件正文数据')
    // 尽力标记已读，失败不影响返回
    try {
      await imap.cmd(`UID STORE ${uid} +FLAGS (\\Seen)`)
    } catch {
      /* ignore */
    }
    const h = parseHeaderBlock(new TextDecoder('utf-8').decode(raw.subarray(0, Math.min(raw.length, 65536))))
    await imap.logout()
    return json(
      {
        uid,
        from: rfc2047(h.get('from') ?? ''),
        to: rfc2047(h.get('to') ?? ''),
        subject: rfc2047(h.get('subject') ?? ''),
        date: rfc2047(h.get('date') ?? ''),
        text: parseMime(raw).slice(0, 200000),
      },
      200,
      req,
      env,
    )
  } catch (e) {
    await imap.logout()
    throw e
  }
}

/* ---------------- SMTP（隐式 TLS 465） ---------------- */

async function smtpSend(env: Env, req: Request, b: Record<string, unknown>): Promise<Response> {
  const host = str(b.host)
  const to = str(b.to).trim()
  if (!host || !to) return json({ error: '缺少 SMTP 服务器或收件人' }, 400, req, env)
  const port = num(b.port, 465)
  const user = str(env.MAIL_USER ?? b.user).trim()
  const pass = str(env.MAIL_PASS ?? b.pass)
  const from = (str(b.from).trim() || user).replace(/[<>\r\n]/g, '')
  const subject = str(b.subject).trim()
  const text = str(b.body)

  const socket = connect({ hostname: host, port }, { secureTransport: 'on', allowHalfOpen: false })
  const conn = new LineConn(socket)
  const expect = async (code: string, what: string): Promise<void> => {
    for (;;) {
      const r = await conn.readLine()
      if (r.text.length >= 4 && r.text[3] === '-') continue // 多行应答
      if (!r.text.startsWith(code)) throw new Error(`${what}失败：${r.text.slice(0, 160)}`)
      return
    }
  }
  try {
    await expect('220', '连接 SMTP')
    await conn.write('EHLO mim')
    for (;;) {
      const r = await conn.readLine()
      if (r.text.length >= 4 && r.text[3] === '-') continue
      break
    }
    await conn.write(`AUTH PLAIN ${bytesToB64(new TextEncoder().encode(`\0${user}\0${pass}`))}`)
    await expect('235', 'SMTP 认证')
    await conn.write(`MAIL FROM:<${from}>`)
    await expect('250', '设置发件人')
    await conn.write(`RCPT TO:<${to.replace(/[<>\r\n]/g, '')}>`)
    await expect('250', '设置收件人')
    await conn.write('DATA')
    await expect('354', '进入发送')
    const b64Header = (v: string) => `=?UTF-8?B?${bytesToB64(new TextEncoder().encode(v))}?=`
    const bodyB64 = bytesToB64(new TextEncoder().encode(text)).replace(/(.{76})/g, '$1\r\n')
    const msg = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject ? b64Header(subject) : '(无主题)'}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      bodyB64,
      '.',
    ]
      .map((l) => (l.startsWith('.') ? `.${l}` : l)) // 点填充
      .join('\r\n')
    await conn.writeRaw(new TextEncoder().encode(`${msg}\r\n`))
    await expect('250', '发送邮件')
    await conn.write('QUIT')
    await conn.close()
    return json({ ok: true }, 200, req, env)
  } catch (e) {
    await conn.close()
    throw e
  }
}

/* ---------------- 入口 ---------------- */

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) })
    if (req.method !== 'POST') return json({ error: '仅支持 POST' }, 405, req, env)
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return json({ error: '请求体必须是 JSON' }, 400, req, env)
    }
    const user = str(env.MAIL_USER ?? body.user).trim()
    const pass = str(env.MAIL_PASS ?? body.pass)
    if (!user || !pass) {
      return json(
        { error: '缺少邮箱凭据：请在 Worker 环境变量配置 MAIL_USER/MAIL_PASS，或请求体传入 user/pass' },
        401,
        req,
        env,
      )
    }
    const pathname = new URL(req.url).pathname
    try {
      if (pathname === '/imap/list') return await imapList(env, req, body)
      if (pathname === '/imap/fetch') return await imapFetchOne(env, req, body)
      if (pathname === '/smtp/send') return await smtpSend(env, req, body)
      return json({ error: '未知路由' }, 404, req, env)
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : '代理请求失败' }, 502, req, env)
    }
  },
}
