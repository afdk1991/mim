/* ==========================================================================
 * LivePage 直播开播台 —— 开播 / 结束 / 推流地址 / 连麦申请管理
 *
 * 推流：支持填自有 RTMP 服务器（OBS 等可直接推），留空则给出占位地址并如实标注「非真实推流」。
 * 不伪造原则（重建重点）：
 *   在线人数恒为 0 —— 本机没有真实观众接入通道；有观众时该值必须由真实会话来源写入。
 *   连麦申请恒为空列表 —— 同上，同意 / 拒绝动作保留，接入真实信令后无需改页面。
 *   仅「时长」实时变化，来源为本机时钟的真实计时。
 * 配置持久化：RTMP 服务器地址存 mim.live.rtmpBase（设备级，不随身份变化）。
 * ======================================================================== */

import { useEffect, useState } from 'react'
import { Empty, useToast } from '@/ui'
import { useApp } from '@/app/state/content'
import { cx, formatCount, formatDuration } from '@/core/utils'
import { asString, globalKey, readJson, writeJson } from '@/core/storage'
import { reportGrowth } from './growth-report'

const CONF_KEY = globalKey('live', 'rtmpBase')

interface MicApp {
  id: string
  userId: string
  at: number
}

interface Summary {
  startedAt: number
  endedAt: number
  micAccepted: number
}

export function LivePage() {
  const app = useApp()
  const toast = useToast()

  const [title, setTitle] = useState('')
  const [rtmpBase, setRtmpBase] = useState<string>(() => readJson(CONF_KEY, asString, ''))
  const [live, setLive] = useState(false)
  const [streamKey, setStreamKey] = useState('')
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [apps, setApps] = useState<MicApp[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)

  /* 直播中 1 秒一跳的时钟：唯一真实增长的指标 */
  useEffect(() => {
    if (!live) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [live])

  const customRtmp = rtmpBase.trim().replace(/\/+$/, '')
  const saveRtmpBase = (v: string): void => {
    setRtmpBase(v)
    writeJson(CONF_KEY, v)
  }

  const startLive = (): void => {
    setStreamKey(Math.random().toString(36).slice(2, 8))
    setStartedAt(Date.now())
    setNow(Date.now())
    setApps([])
    setSummary(null)
    setLive(true)
    reportGrowth('live_open') // 走 evaluate：每日上限 1 场
    toast(customRtmp ? '开播成功，用 OBS 等向你的服务器推流 🔴' : '开播成功，已生成占位推流地址（非真实推流）🔴')
  }

  const endLive = (): void => {
    setSummary({ startedAt, endedAt: Date.now(), micAccepted: 0 })
    setLive(false)
    toast('直播已结束')
  }

  const agree = (a: MicApp): void => {
    setApps((prev) => prev.filter((x) => x.id !== a.id))
    toast('已同意连麦 🎙')
  }
  const decline = (a: MicApp): void => {
    setApps((prev) => prev.filter((x) => x.id !== a.id))
    toast('已拒绝连麦申请')
  }

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">📡 直播开播台</h2>

        {!live && !summary ? (
          <div className="card live-card">
            <h3 className="section-title">
              开播面板
              {!customRtmp ? <span className="tag">占位推流</span> : null}
            </h3>
            <label className="field">
              <span>直播标题</span>
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Mim 直播间（留空用默认标题）"
              />
            </label>
            <label className="field">
              <span>自有 RTMP 服务器（可选）</span>
              <input
                className="input"
                value={rtmpBase}
                onChange={(e) => saveRtmpBase(e.target.value)}
                placeholder="rtmp://your-server/live（留空则生成占位地址）"
              />
            </label>
            <p className="muted">
              {customRtmp
                ? '开播后推流地址将基于你的服务器生成，可直接填入 OBS 等推流工具；在线人数与连麦申请只会在有真实观众接入时变化。'
                : '未配置自有服务器时仅生成占位 RTMP 地址（占位域名 live.mim.demo，非真实推流）；在线人数与连麦申请只会在有真实观众接入时变化。'}
            </p>
            <button className="btn btn-primary" onClick={startLive}>
              🔴 开播
            </button>
          </div>
        ) : null}

        {live ? (
          <div className="card live-card">
            <div className="row-between">
              <b className={cx('live-title')}>LIVE · {title.trim() || 'Mim 直播间'}</b>
              <span className="live-dur">{formatDuration(Math.floor((now - startedAt) / 1000))}</span>
              <button className="btn btn-danger btn-sm" onClick={endLive}>
                ■ 结束直播
              </button>
            </div>
            <div className="live-stats">
              <span>
                👥 在线 <b>{formatCount(0)}</b>
              </span>
              <span>
                🎙 连麦 <b>{apps.length}</b>
              </span>
              <span>
                🔝 峰值 <b>{formatCount(0)}</b>
              </span>
            </div>
            <div className="live-addr">
              <div>
                <span className="muted">推流地址（RTMP{customRtmp ? ' · 你的服务器' : ' · 占位'}）</span>
                <code>{customRtmp ? `${customRtmp}/${streamKey}` : `rtmp://live.mim.demo/live/${streamKey}`}</code>
              </div>
              <div>
                <span className="muted">拉流地址</span>
                {customRtmp ? (
                  <span className="muted">由你的流媒体服务提供（HLS/FLV 播放地址请在服务商控制台获取）</span>
                ) : (
                  <code>https://cdn.mim.demo/hls/{streamKey}/index.m3u8（占位）</code>
                )}
              </div>
            </div>
            <h3 className="section-title">🎙 连麦管理</h3>
            {apps.length === 0 ? <Empty emoji="🎙" text="暂无连麦申请（需真实观众接入信令后才会出现）" /> : null}
            {apps.map((a) => (
              <div key={a.id} className="row mic-row">
                <b>{app.state.users.find((u) => u.id === a.userId)?.name ?? a.userId}</b>
                <small className="muted">申请连麦</small>
                <span className="grow" />
                <button className="btn btn-primary btn-sm" onClick={() => agree(a)}>
                  同意
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => decline(a)}>
                  拒绝
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {!live && summary ? (
          <div className="card live-card">
            <h3 className="section-title">📊 本场直播已结束</h3>
            <div className="live-stats">
              <span>
                时长 <b>{formatDuration(Math.floor((summary.endedAt - summary.startedAt) / 1000))}</b>
              </span>
              <span>
                在线峰值 <b>{formatCount(0)}</b>
              </span>
              <span>
                连麦人次 <b>{summary.micAccepted}</b>
              </span>
            </div>
            <p className="muted">在线人数与连麦人次为 0：本次没有真实观众接入。</p>
            <button className="btn btn-primary" onClick={startLive}>
              再开一场
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
