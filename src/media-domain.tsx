/* 轮 24 打通：B5 多媒体域——上传/转码工作台（模拟）、直播推拉流·连麦（模拟）、视频弹幕、私信语音条。
   样式统一前缀 md-（见 media-domain.css）；localStorage 统一按登录身份分 key：mim-md-<uid>:<bizKey>。 */

import './media-domain.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { getCurrentUserId } from './auth'
import { Avatar, Empty, useToast } from './components'
import {
  MAX_UPLOAD_BYTES,
  canUploadToCloud,
  cloudStorageReady,
  deleteMedia,
  resolveMediaUrl,
  uploadMedia,
} from './lib/cloud-storage'
import { useApp } from './store'
import { cx, formatCount, timeAgo } from './utils'

/* ---------- 通用：身份分 key 与随机工具 ---------- */

/** 所有 B5 存储 key：mim-md-<uid>:<bizKey>（uid = getCurrentUserId() 登录身份锚点） */
const mdKey = (biz: string) => `mim-md-${getCurrentUserId()}:${biz}`

function rndInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1))
}

function fmtSize(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

function fmtDur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/* ================================================================
   1. 上传 / 转码工作台 —— 发布页媒体 tab 挂载
   真实上传路径（已登录 + 云端可用 + 类型/体积合规）：
     选择文件 → base64 → mim-api /storage/upload → CloudBase 存储桶
     → 记录对象 key；预览用签名链接（按需换取，1 小时有效）
   降级路径（未登录 / 未接入云端 / 超 3MB / 非媒体类型）：
     沿用原模拟转码：本地 blob 预览 + 2.5s 进度条，不产生云端文件
   完成记录按身份分 key 持久化，云端条目额外保存 key 以支持刷新后回看
   ================================================================ */

/** 工作台记录：objUrl/mime 仅会话内有效（blob 失效），持久化时剥离 */
type TransRecord = {
  id: string
  name: string
  size: number
  at: number
  status: 'uploading' | 'transcoding' | 'done'
  progress: number
  bitrate?: number
  resolution?: string
  objUrl?: string
  mime?: string
  /** 云端对象：存在即表示文件真实落在存储桶里 */
  cloud?: { key: string; bucket: string }
}

/** 模拟转码输出池（随机分辨率文案） */
const RES_POOL = ['1080P 超清', '720P 高清', '480P 标清', '2K', '4K 超高清']

const TRANSCODE_MS = 2500 // 模拟转码总时长

function loadTransHistory(): TransRecord[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(mdKey('transcode')) ?? '[]')
    if (!Array.isArray(v)) return []
    return v.filter(
      (x): x is TransRecord =>
        typeof x === 'object' && x !== null && typeof (x as TransRecord).name === 'string',
    )
  } catch {
    return []
  }
}

function persistTrans(list: TransRecord[]): void {
  try {
    // objUrl 是会话级 blob，刷新即失效；mime 与 cloud 需要保留（回看预览与云端删除要用）
    localStorage.setItem(
      mdKey('transcode'),
      JSON.stringify(list.map(({ objUrl: _o, ...rest }) => rest)),
    )
  } catch {
    /* ignore */
  }
}

/** 预览：优先会话内本地 blob；云端条目在刷新后按对象 key 换取签名链接回看 */
function MediaPreview({ rec }: { rec: TransRecord }) {
  const [cloudUrl, setCloudUrl] = useState<string | null>(null)
  const key = rec.cloud?.key
  useEffect(() => {
    if (!key) return
    let alive = true
    resolveMediaUrl(key).then((u) => {
      if (alive) setCloudUrl(u)
    })
    return () => {
      alive = false
    }
  }, [key])

  const src = rec.objUrl || cloudUrl || ''
  const mime = rec.mime || ''
  if (!src) return <span className="md-trans-ico" aria-hidden>📄</span>
  if (mime.startsWith('video')) return <video className="md-trans-preview" src={src} controls muted />
  if (mime.startsWith('image')) return <img className="md-trans-preview" src={src} alt={rec.name} />
  if (mime.startsWith('audio')) return <audio className="md-trans-preview" src={src} controls />
  return <span className="md-trans-ico" aria-hidden>📄</span>
}

export function MediaTranscodeWorkbench() {
  const toast = useToast()
  const [items, setItems] = useState<TransRecord[]>(loadTransHistory)
  /* 登录态变化不会触发本组件重渲染，轮询补齐云端可用性（1.5s 一次，开销可忽略） */
  const [cloudReady, setCloudReady] = useState(cloudStorageReady)
  useEffect(() => {
    const t = window.setInterval(() => setCloudReady(cloudStorageReady()), 1500)
    return () => window.clearInterval(t)
  }, [])

  /* 模拟转码推进：transcoding 项每 100ms +4%（2.5s 走完），到点补随机码率/分辨率并持久化 */
  useEffect(() => {
    const t = window.setInterval(() => {
      setItems((list) => {
        let changed = false
        const next = list.map((it) => {
          if (it.status !== 'transcoding') return it
          changed = true
          const progress = Math.min(100, it.progress + (100 / (TRANSCODE_MS / 100)))
          if (progress < 100) return { ...it, progress }
          return {
            ...it,
            progress: 100,
            status: 'done' as const,
            bitrate: rndInt(800, 8200),
            resolution: RES_POOL[Math.floor(Math.random() * RES_POOL.length)],
          }
        })
        if (!changed) return list
        persistTrans(next)
        return next
      })
    }, 100)
    return () => window.clearInterval(t)
  }, [])

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const objUrl = URL.createObjectURL(f)
    const id = `t${Date.now()}`
    const base = { id, name: f.name, size: f.size, at: Date.now(), objUrl, mime: f.type }

    // 云端上传条件：已登录且云端可用 + 类型与体积合规
    const toCloud = cloudStorageReady() && canUploadToCloud(f)
    setItems((list) => [{ ...base, status: toCloud ? 'uploading' : 'transcoding', progress: 0 }, ...list])

    if (!toCloud) {
      toast(
        cloudStorageReady()
          ? `仅本地预览：${f.size > MAX_UPLOAD_BYTES ? '文件超过 3MB 上限' : '仅支持图片 / 音频 / 视频'}`
          : '未登录云端账号，仅本地预览（不会上传）',
      )
      return
    }

    const r = await uploadMedia(f)
    if (r.ok) {
      setItems((list) =>
        list.map((it) =>
          it.id === id
            ? { ...it, status: 'done', progress: 100, cloud: { key: r.data.key, bucket: r.data.bucket } }
            : it,
        ),
      )
      toast('已上传到云端 ☁️')
    } else {
      // 上传失败不丢文件：退回模拟转码，仍可本地预览
      setItems((list) => list.map((it) => (it.id === id ? { ...it, status: 'transcoding' } : it)))
      toast(`云端上传失败，已退回本地预览：${r.error}`)
    }
  }

  /** 删除云端文件（本地记录一并移除）；非云端条目只清本地记录 */
  const removeItem = async (it: TransRecord) => {
    if (it.cloud) {
      const r = await deleteMedia([it.cloud.key])
      if (!r.ok) {
        toast(`云端删除失败：${r.error}`)
        return
      }
    }
    setItems((list) => list.filter((x) => x.id !== it.id))
    toast(it.cloud ? '已删除云端文件' : '已移除本地记录')
  }

  const clearAll = () => {
    setItems([])
    try {
      localStorage.removeItem(mdKey('transcode'))
    } catch {
      /* ignore */
    }
    toast('已清空转码记录')
  }

  return (
    <div className="md-trans">
      <div className="md-trans-head">
        🎞 上传 / 转码工作台
        <span className={cx('md-sim-tag', cloudReady && 'md-cloud-tag')}>
          {cloudReady ? '☁️ 云端存储已就绪' : '本地模拟'}
        </span>
      </div>
      <label className="md-trans-pick">
        <input type="file" accept="video/*,audio/*,image/*" onChange={onPick} />
        <span>
          ＋ 选择文件（视频 / 音频 / 图片，≤ 3MB）
          {cloudReady ? ' → 上传云端 → 签名链接回看' : ' → 本地预览（未登录，不上传）'}
        </span>
      </label>
      {items.length === 0 ? (
        <p className="md-trans-empty">
          {cloudReady
            ? '还没有文件，选择一个试试（将真实上传到云端存储桶）'
            : '还没有文件，选择一个试试（未登录云端账号，仅本地预览）'}
        </p>
      ) : (
        <div className="md-trans-list">
          {items.slice(0, 8).map((it) => (
            <div key={it.id} className="md-trans-item">
              <MediaPreview rec={it} />
              <div className="md-trans-info">
                <b>{it.name}</b>
                <small>{fmtSize(it.size)} · {timeAgo(it.at)}</small>
                {it.status === 'uploading' ? (
                  <>
                    <div className="md-trans-bar md-trans-bar-indet">
                      <span />
                    </div>
                    <small>上传中…</small>
                  </>
                ) : it.status === 'transcoding' ? (
                  <>
                    <div className="md-trans-bar">
                      <span style={{ width: `${it.progress}%` }} />
                    </div>
                    <small>模拟转码中 {Math.round(it.progress)}%</small>
                  </>
                ) : it.cloud ? (
                  <small className="md-trans-st">☁️ 已上传云端 · {it.cloud.bucket}</small>
                ) : (
                  <small className="md-trans-st">
                    ✅ 转码完成 · {it.resolution} · {it.bitrate} kbps（模拟参数）
                  </small>
                )}
              </div>
              <button
                type="button"
                className="md-trans-del"
                onClick={() => removeItem(it)}
                title={it.cloud ? '从云端删除' : '移除本地记录'}
                aria-label={it.cloud ? '从云端删除' : '移除本地记录'}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {items.length > 0 && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll}>
          清空转码记录
        </button>
      )}
    </div>
  )
}

/* ================================================================
   2. 直播开播台（模拟推拉流 / 连麦）——路由 #/live
   开播面板：模拟 RTMP 推流地址（占位）+ 模拟在线人数缓动增长
   + 连麦列表（模拟观众申请 → 同意/拒绝 → 上麦状态）+ 结束直播
   ================================================================ */

type MicApp = { id: string; userId: string; at: number }
type OnMic = { userId: string; since: number }

export function LivePage() {
  const api = useApp()
  const toast = useToast()
  const [live, setLive] = useState(false)
  const [title, setTitle] = useState('')
  const [streamKey, setStreamKey] = useState('')
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [viewers, setViewers] = useState(0)
  const [peak, setPeak] = useState(0)
  const [apps, setApps] = useState<MicApp[]>([])
  const [onAir, setOnAir] = useState<OnMic[]>([])
  const [summary, setSummary] = useState<{ dur: number; peak: number; mic: number } | null>(null)

  const users = useMemo(() => Object.values(api.state.users), [api.state.users])

  /* 在线人数 → 峰值同步 */
  useEffect(() => {
    setPeak((p) => Math.max(p, viewers))
  }, [viewers])

  /* 直播中：1s 时钟 + 在线人数缓动增长（偶有微小回落）+ 每 4.5s 概率性连麦申请（全模拟） */
  useEffect(() => {
    if (!live) return
    const clock = window.setInterval(() => setNow(Date.now()), 1000)
    const flow = window.setInterval(() => {
      setViewers((v) => Math.max(1, v + (Math.random() < 0.15 ? -rndInt(1, 3) : rndInt(1, 7))))
    }, 1200)
    const mic = window.setInterval(() => {
      if (Math.random() > 0.65) return
      setApps((prev) => {
        if (prev.length >= 4) return prev
        const taken = new Set<string>([...prev.map((a) => a.userId), ...onAir.map((o) => o.userId)])
        const pool = users.filter((u) => u.id !== api.me.id && !taken.has(u.id))
        if (pool.length === 0) return prev
        const u = pool[Math.floor(Math.random() * pool.length)]
        return [...prev, { id: `mic${Date.now()}`, userId: u.id, at: Date.now() }]
      })
    }, 4500)
    return () => {
      window.clearInterval(clock)
      window.clearInterval(flow)
      window.clearInterval(mic)
    }
  }, [live, onAir, users, api.me.id])

  const startLive = () => {
    setStreamKey(Math.random().toString(36).slice(2, 8))
    setLive(true)
    setStartedAt(Date.now())
    setNow(Date.now())
    setViewers(rndInt(3, 15))
    setPeak(0)
    setApps([])
    setOnAir([])
    setSummary(null)
    toast('开播成功，模拟推流已就绪（占位地址）🔴')
  }

  const endLive = () => {
    setSummary({ dur: Date.now() - startedAt, peak, mic: onAir.length })
    setLive(false)
    toast('直播已结束')
  }

  const agree = (a: MicApp) => {
    setApps((prev) => prev.filter((x) => x.id !== a.id))
    setOnAir((prev) => [...prev, { userId: a.userId, since: Date.now() }])
    toast(`${api.user(a.userId).name} 已上麦 🎙`)
  }

  const decline = (a: MicApp) => {
    setApps((prev) => prev.filter((x) => x.id !== a.id))
    toast('已拒绝连麦申请')
  }

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">📡 直播开播台</h2>

        {!live && !summary && (
          <div className="card md-live-card">
            <h3 className="md-live-title">
              开播面板 <span className="md-sim-tag">模拟推流</span>
            </h3>
            <label className="md-live-field">
              <span>直播标题</span>
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Mim 直播间（留空用默认标题）"
              />
            </label>
            <p className="md-live-hint">
              开播后生成模拟 RTMP 推流 / HLS 拉流地址（占位域名 live.mim.demo，非真实推流），
              并模拟在线人数缓动增长与观众连麦申请。
            </p>
            <button type="button" className="btn btn-primary md-live-start" onClick={startLive}>
              🔴 开播
            </button>
          </div>
        )}

        {live && (
          <div className="card md-live-card">
            <div className="md-live-head">
              <span className="md-live-dot" aria-hidden />
              <b className="md-live-name">LIVE · {title.trim() || 'Mim 直播间'}</b>
              <em className="md-live-dur">{fmtDur(now - startedAt)}</em>
              <button type="button" className="md-live-end" onClick={endLive}>
                ■ 结束直播
              </button>
            </div>
            <div className="md-live-stats">
              <span>👥 在线 <b>{formatCount(viewers)}</b></span>
              <span>🔝 峰值 <b>{formatCount(peak)}</b></span>
              <span>🎙 连麦 <b>{onAir.length}</b></span>
            </div>
            <div className="md-live-addr">
              <span>推流地址（RTMP · 占位）</span>
              <code>rtmp://live.mim.demo/live/{streamKey}</code>
              <span>拉流地址（HLS · 占位）</span>
              <code>https://cdn.mim.demo/hls/{streamKey}/index.m3u8</code>
            </div>
            <h4 className="md-live-sub">连麦管理（模拟观众申请）</h4>
            {apps.length === 0 && onAir.length === 0 && (
              <Empty emoji="🎙" text="暂无连麦申请，稍等观众举手（模拟）" />
            )}
            {apps.map((a) => (
              <div key={a.id} className="md-live-mic-row">
                <Avatar emoji={api.user(a.userId).emoji} color={api.user(a.userId).color} size={28} />
                <b>{api.user(a.userId).name}</b>
                <small>申请连麦</small>
                <span className="md-live-mic-ops">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => agree(a)}>同意</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => decline(a)}>拒绝</button>
                </span>
              </div>
            ))}
            {onAir.map((o) => (
              <div key={o.userId} className="md-live-mic-row">
                <Avatar emoji={api.user(o.userId).emoji} color={api.user(o.userId).color} size={28} />
                <b>{api.user(o.userId).name}</b>
                <em className="md-live-onair">🎙 上麦中 {fmtDur(now - o.since)}</em>
              </div>
            ))}
          </div>
        )}

        {!live && summary && (
          <div className="card md-live-card">
            <h3 className="md-live-title">📊 本场直播已结束</h3>
            <div className="md-live-stats">
              <span>时长 <b>{fmtDur(summary.dur)}</b></span>
              <span>在线峰值 <b>{formatCount(summary.peak)}</b></span>
              <span>连麦人次 <b>{summary.mic}</b></span>
            </div>
            <button type="button" className="btn btn-primary md-live-start" onClick={startLive}>
              再开一场
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ================================================================
   3. 视频弹幕层——components.tsx VideoPlayerScreen 挂载
   底部输入 + 发送；横向滚动动画（CSS right→left）；按视频 post id 分 key
   localStorage 存储（无 post id 退化为海报 key）；清空按钮；颜色跟随主题变量
   ================================================================ */

type DanmakuMsg = { id: string; text: string; at: number }
type FlyItem = { key: string; text: string; top: number; dur: number }

function loadDanmaku(key: string): DanmakuMsg[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(mdKey(key)) ?? '[]')
    if (!Array.isArray(v)) return []
    return v.filter(
      (x): x is DanmakuMsg =>
        typeof x === 'object' && x !== null && typeof (x as DanmakuMsg).text === 'string',
    )
  } catch {
    return []
  }
}

function saveDanmaku(key: string, list: DanmakuMsg[]): void {
  try {
    localStorage.setItem(mdKey(key), JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

export function DanmakuLayer({ postId, posterKey }: { postId?: string; posterKey?: string }) {
  const toast = useToast()
  /* 轮 24 打通：按视频 post id 分 key；无 post id 的播放器（如快拍流）退化为海报 key */
  const key = postId ? `danmaku:${postId}` : `danmaku:poster:${posterKey ?? 'default'}`
  const [msgs, setMsgs] = useState<DanmakuMsg[]>([])
  const [flying, setFlying] = useState<FlyItem[]>([])
  const [text, setText] = useState('')
  const seq = useRef(0)

  const spawn = useCallback((t: string) => {
    const k = `f${++seq.current}`
    const dur = 6 + Math.random() * 3
    setFlying((f) => [...f, { key: k, text: t, top: 8 + Math.random() * 70, dur }])
    window.setTimeout(() => setFlying((f) => f.filter((x) => x.key !== k)), dur * 1000)
  }, [])

  /* 挂载/切视频：重放历史弹幕（按存序错峰滚出） */
  useEffect(() => {
    const stored = loadDanmaku(key)
    setMsgs(stored)
    setFlying([])
    const timers = stored.slice(-20).map((m, i) => window.setTimeout(() => spawn(m.text), i * 1200))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [key, spawn])

  const send = () => {
    const t = text.trim()
    if (!t) return
    const next = [...msgs, { id: `d${Date.now()}`, text: t, at: Date.now() }].slice(-100)
    setMsgs(next)
    saveDanmaku(key, next)
    spawn(t)
    setText('')
  }

  const clearAll = () => {
    setMsgs([])
    setFlying([])
    saveDanmaku(key, [])
    toast('弹幕已清空')
  }

  return (
    <>
      <div className="md-danmaku-layer" aria-hidden>
        {flying.map((f) => (
          <span
            key={f.key}
            className="md-danmaku-item"
            style={{ top: `${f.top}%`, animationDuration: `${f.dur}s` }}
          >
            {f.text}
          </span>
        ))}
      </div>
      <div className="md-danmaku-bar">
        <input
          className="input"
          value={text}
          placeholder="发条弹幕…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button type="button" className="btn btn-primary btn-sm" onClick={send}>
          发送
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll}>
          清空
        </button>
        <span className="md-danmaku-count">{msgs.length} 条</span>
      </div>
    </>
  )
}

/* ================================================================
   4. 语音条——weibo.tsx 私信输入区挂载
   按住说话（0.5s 起，松开停止）→ 生成语音条气泡（波形 + 时长 + 点击播放动画，
   播放为纯 CSS 动画不发声）；按登录身份 + 会话 id 分 key 存储，写入后广播事件刷新
   ================================================================ */

export const VOICE_EVT = 'mim-md-voice-evt'

type VoiceItem = { id: string; dur: number; at: number }

function loadVoices(convId: string): VoiceItem[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(mdKey(`voice:${convId}`)) ?? '[]')
    if (!Array.isArray(v)) return []
    return v.filter(
      (x): x is VoiceItem =>
        typeof x === 'object' && x !== null && typeof (x as VoiceItem).dur === 'number',
    )
  } catch {
    return []
  }
}

function saveVoices(convId: string, list: VoiceItem[]): void {
  try {
    localStorage.setItem(mdKey(`voice:${convId}`), JSON.stringify(list))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(VOICE_EVT))
}

/** 「按住说话」录音按钮：pointerdown 开始计时，pointerup/leave 停止（<0.5s 丢弃） */
export function VoiceRecordButton({ convId }: { convId: string }) {
  const toast = useToast()
  const [startAt, setStartAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<number | null>(null)

  const stop = () => {
    if (startAt == null) return
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    const dur = (Date.now() - startAt) / 1000
    setStartAt(null)
    setElapsed(0)
    if (dur < 0.5) {
      toast('说话太短（不足 0.5s），已取消')
      return
    }
    const item: VoiceItem = { id: `v${Date.now()}`, dur: Math.round(dur * 10) / 10, at: Date.now() }
    saveVoices(convId, [...loadVoices(convId), item].slice(-50))
    toast(`语音条已发送（${item.dur.toFixed(1)}s · 模拟）🎤`)
  }

  const start = () => {
    if (startAt != null) return
    const t0 = Date.now()
    setStartAt(t0)
    timerRef.current = window.setInterval(() => setElapsed((Date.now() - t0) / 1000), 100)
  }

  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current)
    },
    [],
  )

  return (
    <button
      type="button"
      className={cx('md-voice-btn', startAt != null && 'rec')}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      title="按住说话（模拟录音，松开发送）"
    >
      {startAt != null ? `● 录音中 ${elapsed.toFixed(1)}s` : '🎤 按住说话'}
    </button>
  )
}

/** 会话内语音条气泡列表（右对齐，点击播放 = 纯 CSS 波形动画，不发声） */
export function VoiceBubbleThread({ convId }: { convId: string }) {
  const [list, setList] = useState<VoiceItem[]>(() => loadVoices(convId))
  const [playing, setPlaying] = useState<string | null>(null)

  /* 录音按钮写入后广播 VOICE_EVT 刷新列表；切会话重载 */
  useEffect(() => {
    const sync = () => setList(loadVoices(convId))
    sync()
    window.addEventListener(VOICE_EVT, sync)
    return () => window.removeEventListener(VOICE_EVT, sync)
  }, [convId])

  if (list.length === 0) return null

  const play = (v: VoiceItem) => {
    setPlaying(v.id)
    window.setTimeout(() => setPlaying((p) => (p === v.id ? null : p)), Math.max(600, v.dur * 1000))
  }

  return (
    <>
      {list.map((v) => (
        <div key={v.id} className="md-voice-row">
          <div
            className={cx('bubble md-voice-bubble', playing === v.id && 'on')}
            onClick={() => play(v)}
            role="button"
            title="点击播放（模拟）"
          >
            <span className="md-voice-wave" aria-hidden>
              <i /><i /><i /><i /><i />
            </span>
            <em className="md-voice-dur">{v.dur.toFixed(1)}″</em>
            <span className="md-voice-ico">{playing === v.id ? '◼' : '▶'}</span>
          </div>
          <span className="bubble-time">{timeAgo(v.at)}</span>
        </div>
      ))}
    </>
  )
}
