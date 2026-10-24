/* 全站统一播放器（音频 / 视频通用）
   ------------------------------------------------------------------
   设计要点（满足「统一 / 复用 / 跨页不中断 / 桌面+移动」）：
   1. 单一媒体元素：全站只有 <video> 一个真实媒体节点，由 PlayerProvider
      渲染在「路由之上」，因此切换页面（hash 路由不卸载根节点）时播放不中断。
   2. 复用：所有页面/模块通过 usePlayer() 调起播放，不各自实现播放逻辑。
   3. 控制：播放 / 暂停 / 进度拖拽（桌面鼠标 + 移动端触摸，统一用 Pointer 事件）
      / 上一首下一首 / 音量 / 循环 / 画中画，迷你条与展开面板共用同一套控件。
   4. 持久化：当前曲目 + 进度 + 音量 + 播放列表写入 localStorage，
      刷新后可「继续播放」（浏览器禁止自动出声，需用户点一下）。
   样式见 player.css（前缀 .mim-player-*）。 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { cx } from './utils'
import './player.css' /* 播放器样式（前缀 .mim-player-*） */

export type MediaKind = 'audio' | 'video'

export interface MediaTrack {
  id: string
  title: string
  /** 来源 / 创作者 / 专辑等副信息 */
  artist?: string
  kind: MediaKind
  /** 直链（mp4/webm/ogg/mp3/wav/m4a ...） */
  src: string
  /** emoji 或图片地址，迷你条 / 音频大封面用 */
  poster?: string
  cover?: string
  license?: string
  /** 副标题 / 来源说明 */
  meta?: string
  /** 已知时长（秒），用于未加载元数据时占位 */
  durationHint?: number
}

export type PlayStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'

export interface PlayOptions {
  /** 起始秒数（续播用） */
  position?: number
  playlist?: MediaTrack[]
  playlistIndex?: number
}

export type PlayerProgressCb = (trackId: string, sec: number, ended: boolean) => void

/* ------------------------- 纯函数工具（可单测） ------------------------- */

const AUDIO_RE = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)(?:[?#]|$)/i
const VIDEO_RE = /\.(mp4|webm|ogv|mov|m4v|avi|m3u8)(?:[?#]|$)/i

/** 由 URL 推断媒体类型；默认按视频处理（<video> 也能播音频） */
export function detectMediaKind(url: string): MediaKind {
  const u = url.split('?')[0]
  if (AUDIO_RE.test(u)) return 'audio'
  if (VIDEO_RE.test(u)) return 'video'
  // m3u8 / 无扩展名兜底为视频（多数流媒体为视频）
  return 'video'
}

/** 秒 → mm:ss / h:mm:ss */
export function formatMediaTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const s = Math.floor(sec % 60)
  const m = Math.floor((sec / 60) % 60)
  const h = Math.floor(sec / 3600)
  const pad = (n: number) => String(n).padStart(2, '0')
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`
  return `${pad(m)}:${pad(s)}`
}

/** 播放列表切歌：下一首（可循环回绕） */
export function nextIndex(len: number, cur: number, loop: boolean): number {
  if (len <= 1) return loop ? cur : cur
  return cur + 1 >= len ? (loop ? 0 : len - 1) : cur + 1
}

/** 播放列表切歌：上一首（可循环回绕） */
export function prevIndex(len: number, cur: number, loop: boolean): number {
  if (len <= 1) return loop ? cur : cur
  return cur - 1 < 0 ? (loop ? len - 1 : 0) : cur - 1
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/* ------------------------- 持久化快照 ------------------------- */

const PK = 'mim-player-v1'

interface PersistState {
  track: MediaTrack | null
  position: number
  volume: number
  muted: boolean
  loop: boolean
  playlist: MediaTrack[]
  index: number
}

function loadPersist(): PersistState {
  const fallback: PersistState = {
    track: null,
    position: 0,
    volume: 1,
    muted: false,
    loop: false,
    playlist: [],
    index: 0,
  }
  try {
    const raw = localStorage.getItem(PK)
    if (!raw) return fallback
    const o = JSON.parse(raw) as Partial<PersistState>
    return {
      track: o.track ?? null,
      position: typeof o.position === 'number' && o.position >= 0 ? o.position : 0,
      volume: typeof o.volume === 'number' ? clamp(o.volume, 0, 1) : 1,
      muted: !!o.muted,
      loop: !!o.loop,
      playlist: Array.isArray(o.playlist) ? o.playlist : [],
      index: typeof o.index === 'number' ? o.index : 0,
    }
  } catch {
    return fallback
  }
}

function savePersist(s: PersistState): void {
  try {
    localStorage.setItem(PK, JSON.stringify(s))
  } catch {
    /* 隐私模式忽略 */
  }
}

/* ------------------------- Context 设计：控制与状态分离 -------------------------
   控制 context 引用稳定（不随播放进度变化），仅状态 context 高频更新，
   避免无关的页面组件在播放时反复重渲染。 */

interface PlayerControl {
  play: (track: MediaTrack, opts?: PlayOptions) => void
  toggle: () => void
  pause: () => void
  seek: (sec: number) => void
  seekRatio: (r: number) => void
  next: () => void
  prev: () => void
  setVolume: (v: number) => void
  toggleMute: () => void
  toggleLoop: () => void
  setExpand: (v: boolean) => void
  close: () => void
  togglePiP: () => void
  registerProgress: (cb: PlayerProgressCb) => () => void
}

interface PlayerState {
  current: MediaTrack | null
  status: PlayStatus
  currentTime: number
  duration: number
  buffered: number
  volume: number
  muted: boolean
  isExpand: boolean
  loop: boolean
  playlist: MediaTrack[]
  index: number
  supportsPiP: boolean
}

const ControlCtx = createContext<PlayerControl | null>(null)
const StateCtx = createContext<PlayerState | null>(null)

/* ------------------------- Provider ------------------------- */

export function PlayerProvider({ children }: { children: ReactNode }) {
  const init = useMemo(loadPersist, [])

  const mediaRef = useRef<HTMLVideoElement>(null)
  const wantPlayRef = useRef(false)
  const pendingPosRef = useRef(0)
  const posRef = useRef(init.position)
  const lastEmitRef = useRef(0)
  const listenersRef = useRef<Set<PlayerProgressCb>>(new Set())
  const currentRef = useRef<MediaTrack | null>(init.track)

  const [current, setCurrent] = useState<MediaTrack | null>(init.track)
  const [status, setStatus] = useState<PlayStatus>(init.track ? 'paused' : 'idle')
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolumeState] = useState(init.volume)
  const [muted, setMuted] = useState(init.muted)
  const [isExpand, setExpand] = useState(false)
  const [loop, setLoop] = useState(init.loop)
  const [playlist, setPlaylist] = useState<MediaTrack[]>(init.playlist)
  const [index, setIndex] = useState(init.index)
  const [supportsPiP, setSupportsPiP] = useState(false)

  /* 同步 currentRef，供回调同步读取最新值 */
  useEffect(() => {
    currentRef.current = current
  }, [current])

  /* 画中画能力探测 */
  useEffect(() => {
    setSupportsPiP(
      typeof document !== 'undefined' &&
        'pictureInPictureEnabled' in document &&
        (document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled === true,
    )
  }, [])

  /* 节流上报进度（每 ≥5s 一次），供调用方（如漫剧续播）持久化 */
  const emitProgress = useCallback((ended: boolean) => {
    const t = currentRef.current
    if (!t) return
    const sec = posRef.current
    lastEmitRef.current = sec
    listenersRef.current.forEach((cb) => cb(t.id, sec, ended))
  }, [])

  const persist = useCallback(() => {
    savePersist({
      track: currentRef.current,
      position: posRef.current,
      volume,
      muted,
      loop,
      playlist,
      index,
    })
  }, [volume, muted, loop, playlist, index])

  /* 切换曲目 / 列表 / 音量 / 循环 时落盘 */
  useEffect(() => {
    persist()
  }, [persist])

  /* 加载新 src（单一媒体元素，不随路由卸载 → 跨页不中断） */
  useEffect(() => {
    const el = mediaRef.current
    if (!el) return
    if (!current) {
      el.removeAttribute('src')
      el.load()
      setStatus('idle')
      setDuration(0)
      setCurrentTime(0)
      setBuffered(0)
      return
    }
    if (el.src !== current.src) {
      el.src = current.src
      el.load()
      setStatus('loading')
    }
    el.loop = loop
    if (wantPlayRef.current) {
      const p = el.play()
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          setStatus('paused')
          wantPlayRef.current = false
        })
      } else {
        wantPlayRef.current = false
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, loop])

  /* 仅恢复音量/静音到元素（首挂载） */
  useEffect(() => {
    const el = mediaRef.current
    if (el) {
      el.volume = volume
      el.muted = muted
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* 键盘：空格播放/暂停（输入框聚焦时不拦截） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.code === 'Space' && currentRef.current) {
        e.preventDefault()
        const el = mediaRef.current
        if (el) {
          if (el.paused) void el.play().catch(() => {})
          else el.pause()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* ----------------- 控制动作（引用稳定） ----------------- */

  const play = useCallback((track: MediaTrack, opts?: PlayOptions) => {
    setPlaylist(opts?.playlist ?? [track])
    setIndex(opts?.playlistIndex ?? 0)
    const sameAsCurrent =
      currentRef.current != null && currentRef.current.id === track.id && currentRef.current.src === track.src
    if (sameAsCurrent) {
      pendingPosRef.current = opts?.position ?? mediaRef.current?.currentTime ?? 0
      void mediaRef.current?.play().catch(() => {})
      return
    }
    pendingPosRef.current = opts?.position ?? 0
    wantPlayRef.current = true
    setCurrent(track)
    setExpand(true)
  }, [])

  const toggle = useCallback(() => {
    const el = mediaRef.current
    if (!el || !currentRef.current) return
    if (el.paused) void el.play().catch(() => {})
    else el.pause()
  }, [])

  const pause = useCallback(() => {
    mediaRef.current?.pause()
  }, [])

  const seek = useCallback((sec: number) => {
    const el = mediaRef.current
    if (!el) return
    const d = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : duration
    el.currentTime = clamp(sec, 0, d || sec)
  }, [duration])

  const seekRatio = useCallback((r: number) => {
    const el = mediaRef.current
    if (!el) return
    const d = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : duration
    if (!d) return
    el.currentTime = clamp(r, 0, 1) * d
  }, [duration])

  const goTo = useCallback(
    (i: number) => {
      const list = playlistRef.current
      if (list.length === 0) return
      const idx = clamp(i, 0, list.length - 1)
      const t = list[idx]
      if (!t) return
      setIndex(idx)
      pendingPosRef.current = 0
      wantPlayRef.current = true
      setCurrent(t)
    },
    // playlistRef 在下方声明
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const playlistRef = useRef<MediaTrack[]>(playlist)
  useEffect(() => {
    playlistRef.current = playlist
  }, [playlist])

  const next = useCallback(() => {
    const list = playlistRef.current
    if (list.length <= 1) {
      const el = mediaRef.current
      if (el) el.currentTime = 0
      return
    }
    goTo(nextIndex(list.length, indexRef.current, loopRef.current))
  }, [goTo])

  const prev = useCallback(() => {
    const el = mediaRef.current
    if (el && el.currentTime > 3) {
      el.currentTime = 0
      return
    }
    const list = playlistRef.current
    if (list.length <= 1) return
    goTo(prevIndex(list.length, indexRef.current, loopRef.current))
  }, [goTo])

  const indexRef = useRef(index)
  useEffect(() => {
    indexRef.current = index
  }, [index])
  const loopRef = useRef(loop)
  useEffect(() => {
    loopRef.current = loop
  }, [loop])

  const setVolume = useCallback((v: number) => {
    const nv = clamp(v, 0, 1)
    setVolumeState(nv)
    const el = mediaRef.current
    if (el) {
      el.volume = nv
      if (nv > 0 && el.muted) {
        el.muted = false
        setMuted(false)
      }
    }
  }, [])

  const toggleMute = useCallback(() => {
    const el = mediaRef.current
    const nm = !mutedStateRef.current
    setMuted(nm)
    if (el) el.muted = nm
  }, [])
  const mutedStateRef = useRef(muted)
  useEffect(() => {
    mutedStateRef.current = muted
  }, [muted])

  const toggleLoop = useCallback(() => setLoop((l) => !l), [])

  const close = useCallback(() => {
    const el = mediaRef.current
    if (el) {
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
    setCurrent(null)
    currentRef.current = null
    setExpand(false)
    setStatus('idle')
    setDuration(0)
    setCurrentTime(0)
    setBuffered(0)
  }, [])

  const togglePiP = useCallback(() => {
    const el = mediaRef.current
    if (!el) return
    const anyDoc = document as Document & {
      exitPictureInPicture?: () => Promise<void>
    }
    const vEl = el as HTMLVideoElement & {
      requestPictureInPicture?: () => Promise<unknown>
    }
    if (document.pictureInPictureElement) {
      void anyDoc.exitPictureInPicture?.()
    } else {
      void vEl.requestPictureInPicture?.()
    }
  }, [])

  const registerProgress = useCallback((cb: PlayerProgressCb) => {
    listenersRef.current.add(cb)
    return () => {
      listenersRef.current.delete(cb)
    }
  }, [])

  /* ----------------- 媒体元素原生事件 ----------------- */

  const onLoadedMetadata = () => {
    const el = mediaRef.current
    if (!el) return
    setDuration(el.duration)
    if (pendingPosRef.current > 0 && el.duration > 0 && pendingPosRef.current < el.duration * 0.95) {
      el.currentTime = pendingPosRef.current
    }
    pendingPosRef.current = 0
    setStatus(el.paused ? 'paused' : 'playing')
  }

  const onTimeUpdate = () => {
    const el = mediaRef.current
    if (!el) return
    const sec = el.currentTime
    posRef.current = sec
    setCurrentTime(sec)
    if (el.buffered.length > 0) {
      try {
        setBuffered(el.buffered.end(el.buffered.length - 1))
      } catch {
        /* ignore */
      }
    }
    if (sec - lastEmitRef.current >= 5) emitProgress(false)
  }

  const onPlay = () => setStatus('playing')
  const onPause = () => {
    setStatus((s) => (s === 'ended' ? s : 'paused'))
    emitProgress(false)
    persist()
  }
  const onEnded = () => {
    setStatus('ended')
    emitProgress(true)
    persist()
    const list = playlistRef.current
    if (!loopRef.current && list.length > 1) {
      goTo(nextIndex(list.length, indexRef.current, loopRef.current))
    }
  }
  const onError = () => setStatus('error')
  const onProgress = () => {
    const el = mediaRef.current
    if (el && el.buffered.length > 0) {
      try {
        setBuffered(el.buffered.end(el.buffered.length - 1))
      } catch {
        /* ignore */
      }
    }
  }
  const onVolumeChange = () => {
    const el = mediaRef.current
    if (!el) return
    setVolumeState(el.volume)
    setMuted(el.muted)
  }

  /* body 类：为内容区预留底部留白，避免迷你条遮挡 */
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.body.classList.toggle('player-active', !!current)
    return () => document.body.classList.remove('player-active')
  }, [current])

  const control: PlayerControl = useMemo(
    () => ({
      play,
      toggle,
      pause,
      seek,
      seekRatio,
      next,
      prev,
      setVolume,
      toggleMute,
      toggleLoop,
      setExpand,
      close,
      togglePiP,
      registerProgress,
    }),
    [
      play,
      toggle,
      pause,
      seek,
      seekRatio,
      next,
      prev,
      setVolume,
      toggleMute,
      toggleLoop,
      setExpand,
      close,
      togglePiP,
      registerProgress,
    ],
  )

  const state: PlayerState = useMemo(
    () => ({
      current,
      status,
      currentTime,
      duration,
      buffered,
      volume,
      muted,
      isExpand,
      loop,
      playlist,
      index,
      supportsPiP,
    }),
    [current, status, currentTime, duration, buffered, volume, muted, isExpand, loop, playlist, index, supportsPiP],
  )

  return (
    <ControlCtx.Provider value={control}>
      <StateCtx.Provider value={state}>
        {children}
        <GlobalPlayer
          mediaRef={mediaRef}
          handlers={{
            onLoadedMetadata,
            onTimeUpdate,
            onPlay,
            onPause,
            onEnded,
            onError,
            onProgress,
            onVolumeChange,
          }}
        />
      </StateCtx.Provider>
    </ControlCtx.Provider>
  )
}

/* ------------------------- 全局播放条（迷你 + 展开） ------------------------- */

interface MediaHandlers {
  onLoadedMetadata: () => void
  onTimeUpdate: () => void
  onPlay: () => void
  onPause: () => void
  onEnded: () => void
  onError: () => void
  onProgress: () => void
  onVolumeChange: () => void
}

function GlobalPlayer({
  mediaRef,
  handlers,
}: {
  mediaRef: React.RefObject<HTMLVideoElement>
  handlers: MediaHandlers
}) {
  const ctrl = usePlayerControl()
  const st = usePlayerState()
  if (!st.current) return null

  const isAudio = st.current.kind === 'audio'
  const ratio = st.duration > 0 ? clamp(st.currentTime / st.duration, 0, 1) : 0
  const bufRatio = st.duration > 0 && st.buffered > 0 ? clamp(st.buffered / st.duration, 0, 1) : 0
  const playing = st.status === 'playing'
  const cover = st.current.poster || st.current.cover || (isAudio ? '🎵' : '🎬')

  return (
    <div
      className={cx(
        'mim-player-root',
        st.isExpand && 'is-expand',
        isAudio && 'is-audio',
        st.status === 'error' && 'is-error',
      )}
    >
      {/* 展开面板（底部抽屉式，常驻 DOM；折叠时由 CSS display:none 隐藏，
          但单一媒体元素始终保持挂载 → 跨页 / 折叠均不中断播放） */}
      <div className="mim-player-sheet" role="dialog" aria-label="播放器">
        <div className="mim-sheet-head">
          <span className="muted mim-sheet-kind">{isAudio ? '音频' : '视频'} · 全站通用播放器</span>
          <button className="icon-btn" aria-label="收起" onClick={() => ctrl.setExpand(false)}>
            ⌄
          </button>
        </div>

        <div className="mim-sheet-stage">
          {/* 全站唯一真实媒体元素：视频在此显示，音频保持隐藏（仅出声） */}
          <video
            ref={mediaRef}
            className="mim-player-media"
            preload="metadata"
            playsInline
            onLoadedMetadata={handlers.onLoadedMetadata}
            onTimeUpdate={handlers.onTimeUpdate}
            onPlay={handlers.onPlay}
            onPause={handlers.onPause}
            onEnded={handlers.onEnded}
            onError={handlers.onError}
            onProgress={handlers.onProgress}
            onVolumeChange={handlers.onVolumeChange}
          />
          {isAudio && (
            <div className="mim-sheet-audio">
              <span className="mim-sheet-audio-cover">{cover}</span>
            </div>
          )}
        </div>

          <div className="mim-sheet-meta">
            <div className="mim-sheet-title">{st.current.title}</div>
            <div className="muted mim-sheet-sub">
              {st.current.artist || st.current.meta || ''}
              {st.current.license ? ` · 📜 ${st.current.license}` : ''}
            </div>
          </div>

          <div className="mim-sheet-controls">
            <SeekBar ratio={ratio} buffered={bufRatio} onSeek={ctrl.seekRatio} />
            <div className="mim-sheet-time">
              <span>{formatMediaTime(st.currentTime)}</span>
              <span>{st.duration > 0 ? formatMediaTime(st.duration) : '--:--'}</span>
            </div>
            <div className="mim-sheet-btns">
              <button className="icon-btn" aria-label="上一首" onClick={ctrl.prev}>
                ⏮
              </button>
              <button
                className="mim-btn-play"
                aria-label={playing ? '暂停' : '播放'}
                onClick={ctrl.toggle}
              >
                {st.status === 'loading' ? '…' : playing ? '⏸' : '▶'}
              </button>
              <button className="icon-btn" aria-label="下一首" onClick={ctrl.next}>
                ⏭
              </button>
              <button
                className={cx('icon-btn', st.loop && 'active')}
                aria-label="循环"
                title="列表循环"
                onClick={ctrl.toggleLoop}
              >
                🔁
              </button>
              {!isAudio && st.supportsPiP && (
                <button className="icon-btn" aria-label="画中画" title="画中画" onClick={ctrl.togglePiP}>
                  ⧉
                </button>
              )}
              <VolumeControl
                volume={st.volume}
                muted={st.muted}
                onVolume={ctrl.setVolume}
                onToggleMute={ctrl.toggleMute}
              />
            </div>
            {st.status === 'error' && (
              <div className="mim-player-err">媒体加载失败：直链可能失效或跨域受限，请更换片源。</div>
            )}
          </div>
        </div>

      {/* 迷你条（常驻底部） */}
      <div className="mim-player-bar">
        <button
          className="mim-bar-cover"
          aria-label="展开播放器"
          onClick={() => ctrl.setExpand(!st.isExpand)}
        >
          <span className="mim-bar-cover-emoji">{cover}</span>
          {playing && <span className="mim-bar-eq" aria-hidden><i /><i /><i /></span>}
        </button>

        <div className="mim-bar-main">
          <div className="mim-bar-meta">
            <span className="mim-bar-title">{st.current.title}</span>
            <span className="mim-bar-sub muted">{st.current.artist || st.current.meta || ''}</span>
          </div>
          <div className="mim-bar-progress">
            <SeekBar ratio={ratio} buffered={bufRatio} onSeek={ctrl.seekRatio} thin />
            <div className="mim-bar-time muted">
              {formatMediaTime(st.currentTime)}
              {st.duration > 0 ? ` / ${formatMediaTime(st.duration)}` : ''}
            </div>
          </div>
        </div>

        <div className="mim-bar-actions">
          <button className="icon-btn" aria-label="上一首" onClick={ctrl.prev}>
            ⏮
          </button>
          <button className="mim-btn-play" aria-label={playing ? '暂停' : '播放'} onClick={ctrl.toggle}>
            {st.status === 'loading' ? '…' : playing ? '⏸' : '▶'}
          </button>
          <button className="icon-btn" aria-label="下一首" onClick={ctrl.next}>
            ⏭
          </button>
          <button
            className={cx('icon-btn mim-bar-loop', st.loop && 'active')}
            aria-label="循环"
            onClick={ctrl.toggleLoop}
          >
            🔁
          </button>
          <VolumeControl
            volume={st.volume}
            muted={st.muted}
            onVolume={ctrl.setVolume}
            onToggleMute={ctrl.toggleMute}
          />
          <button
            className="icon-btn"
            aria-label={st.isExpand ? '收起' : '展开'}
            onClick={() => ctrl.setExpand(!st.isExpand)}
          >
            {st.isExpand ? '⌄' : '⤢'}
          </button>
          <button className="icon-btn" aria-label="关闭" onClick={ctrl.close}>
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------- 可复用子组件 ------------------------- */

/** 进度条：桌面鼠标 + 移动端触摸统一用 Pointer 事件，支持拖拽与点击定位 */
function SeekBar({
  ratio,
  buffered,
  onSeek,
  thin,
}: {
  ratio: number
  buffered: number
  onSeek: (r: number) => void
  thin?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const ratioFromEvent = (clientX: number): number => {
    const el = ref.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    return clamp((clientX - r.left) / r.width, 0, 1)
  }

  return (
    <div
      className={cx('mim-seek', thin && 'mim-seek-thin')}
      ref={ref}
      role="slider"
      aria-label="播放进度"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        onSeek(ratioFromEvent(e.clientX))
      }}
      onPointerMove={(e) => {
        if (dragging.current) onSeek(ratioFromEvent(e.clientX))
      }}
      onPointerUp={(e) => {
        if (dragging.current) {
          dragging.current = false
          onSeek(ratioFromEvent(e.clientX))
        }
      }}
    >
      <div className="mim-seek-buf" style={{ width: `${buffered * 100}%` }} />
      <div className="mim-seek-fill" style={{ width: `${ratio * 100}%` }} />
      <div className="mim-seek-thumb" style={{ left: `${ratio * 100}%` }} />
    </div>
  )
}

/** 音量控制：桌面显示滑杆，移动端折叠为静音切换（由 CSS 控制显隐） */
function VolumeControl({
  volume,
  muted,
  onVolume,
  onToggleMute,
}: {
  volume: number
  muted: boolean
  onVolume: (v: number) => void
  onToggleMute: () => void
}) {
  return (
    <span className="mim-vol">
      <button className="icon-btn" aria-label={muted ? '取消静音' : '静音'} onClick={onToggleMute}>
        {muted || volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}
      </button>
      <input
        className="mim-vol-range"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={muted ? 0 : volume}
        aria-label="音量"
        onChange={(e) => onVolume(Number(e.target.value))}
      />
    </span>
  )
}

/* ------------------------- Hooks ------------------------- */

export function usePlayerControl(): PlayerControl {
  const ctx = useContext(ControlCtx)
  if (!ctx) throw new Error('usePlayerControl 必须在 <PlayerProvider> 内使用')
  return ctx
}

export function usePlayerState(): PlayerState {
  const ctx = useContext(StateCtx)
  if (!ctx) throw new Error('usePlayerState 必须在 <PlayerProvider> 内使用')
  return ctx
}

/** 便捷聚合：同时取控制与状态（小组件用） */
export function usePlayer(): PlayerControl & PlayerState {
  return { ...usePlayerControl(), ...usePlayerState() }
}
