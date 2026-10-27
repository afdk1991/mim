/* ==========================================================================
 * PublishPage 统一发布器 —— 按 content_type 分发到「广场动态」或「知识库文章」
 *
 * 单态口径（与原实现一致）：全站统一内容池，广场态（10/11…）进动态流，知识态（20）进文库。
 * 敏感词前置：命中即禁用发布按钮并给出类别标签（sensitiveHitLabels）——
 *             这是机审前置，不等于服务端终审，文案里如实说明。
 * 富字段发布（12 视频 / 13 投票 / 14 抽奖 / 15 快拍）：
 *   这些字段在 Post 模型与 posts 表里都存在，publishPost 也已接收，
 *   因此按类型给出最小可用录入 UI，不假装支持、也不无谓置灰。
 *   快拍由状态层兜底 24h 过期；投票 counts 必须按 options 长度初始化全 0，
 *   否则渲染读 counts[i] 会得到 NaN。
 * 资源（22）不支持：资源表在 server/db/migrations 里没有写入通道，前端也没有上传接口，
 *   这与字段无关，故如实说明而不是笼统写「暂未开放」。
 * ======================================================================== */

import { useState } from 'react'
import { Empty, useToast } from '@/ui'
import { useApp } from '@/app/state/content'
import type { PublishPostOptions } from '@/app/state/content'
import { useRouter } from '@/app/router'
import { cx } from '@/core/utils'
import { CONTENT_TYPE } from '@/domain/content/model'
import type { PostMedia, Visibility } from '@/domain/content/model'
import { articleQualityPass, findSensitiveHits, sensitiveHitLabels } from '@/domain/content/rules'
import { sortTopics, topicsFromPosts } from './content-lib'
import { reportGrowth } from './growth-report'

const IMAGE_EMOJIS = ['⚛️', '🚀', '🎨', '🐱', '🌸', '🍜', '🏔️', '💻', '📱']

interface TypeMeta {
  code: number
  name: string
  hint: string
  /** false = 该类型当前没有可写入通道（与前端字段无关） */
  supported: boolean
}

const TYPES: TypeMeta[] = [
  { code: CONTENT_TYPE.text, name: '动态短文', hint: '纯文字动态，进广场 Feed', supported: true },
  { code: CONTENT_TYPE.image, name: '图文', hint: '带配图的动态', supported: true },
  { code: CONTENT_TYPE.video, name: '视频 / GIF', hint: '填媒体地址与封面，标题与时长可选', supported: true },
  { code: CONTENT_TYPE.vote, name: '投票', hint: '问题 + 至少 2 个选项 + 结束时间，一人一票', supported: true },
  { code: CONTENT_TYPE.lottery, name: '抽奖', hint: '奖品名 + 份数 + 结束时间，到点才能开奖', supported: true },
  { code: CONTENT_TYPE.story, name: '快拍', hint: '不进信息流，发布后 24 小时自动过期', supported: true },
  { code: CONTENT_TYPE.article, name: '博文', hint: 'Markdown 长文，进知识库', supported: true },
  {
    code: CONTENT_TYPE.resource,
    name: '资源',
    hint: '资源表在 server/db/migrations 里没有写入通道，前端也没有上传接口，无法从此处发布',
    supported: false,
  },
]

/** 由地址后缀推断媒体类型：.gif → gif，音频后缀 → audio，其余按视频处理 */
function mediaKindOf(src: string): PostMedia['kind'] {
  const lower = src.trim().toLowerCase()
  if (lower.endsWith('.gif')) return 'gif'
  if (/\.(mp3|m4a|wav|ogg|flac)$/.test(lower)) return 'audio'
  return 'video'
}

export function PublishPage() {
  const app = useApp()
  const toast = useToast()
  const { navigate } = useRouter()

  const [type, setType] = useState<number>(CONTENT_TYPE.text)
  const [body, setBody] = useState('')
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [topic, setTopic] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [visibility, setVisibility] = useState<Visibility>('public')
  /* 富字段录入：视频媒体 / 投票 / 抽奖 */
  const [mediaSrc, setMediaSrc] = useState('')
  const [mediaPoster, setMediaPoster] = useState('')
  const [mediaTitle, setMediaTitle] = useState('')
  const [mediaDuration, setMediaDuration] = useState('')
  const [voteQuestion, setVoteQuestion] = useState('')
  const [voteOptions, setVoteOptions] = useState<string[]>(['', ''])
  const [endsInHours, setEndsInHours] = useState('24')
  const [prize, setPrize] = useState('')
  const [prizeCount, setPrizeCount] = useState('1')
  /* 命名避开全局 location，避免与 window.location 混淆 */
  const [place, setPlace] = useState('')

  const meta = TYPES.find((t) => t.code === type) ?? TYPES[0]!
  const isPlaza = type <= 15
  const checkText = `${title}\n${body}`
  const hits = findSensitiveHits(checkText)
  const labels = sensitiveHitLabels(checkText)
  const titleOk = type !== CONTENT_TYPE.article || title.trim().length > 0

  /* 各类型的必填项：为空时禁用发布并说明缺什么，而不是点了才报错 */
  const hours = Number(endsInHours)
  const endsAtOk = Number.isFinite(hours) && hours > 0
  const optionList = voteOptions.map((s) => s.trim()).filter(Boolean)
  const countOk = Number.isFinite(Number(prizeCount)) && Math.round(Number(prizeCount)) >= 1
  const missing =
    type === CONTENT_TYPE.video && !mediaSrc.trim()
      ? '请填写视频 / GIF 地址'
      : type === CONTENT_TYPE.vote
        ? !voteQuestion.trim()
          ? '请填写投票问题'
          : optionList.length < 2
            ? '投票至少需要 2 个有效选项'
            : !endsAtOk
              ? '请填写大于 0 的结束时间（小时）'
              : ''
        : type === CONTENT_TYPE.lottery
          ? !prize.trim()
            ? '请填写奖品名称'
            : !countOk
              ? '奖品份数至少为 1'
              : !endsAtOk
                ? '请填写大于 0 的结束时间（小时）'
                : ''
          : ''
  const canPublish = meta.supported && body.trim().length > 0 && hits.length === 0 && titleOk && !missing

  const existingTopics = sortTopics(topicsFromPosts(app.state.posts), 'posts').slice(0, 10)

  const submit = (): void => {
    if (!meta.supported) {
      toast(`${meta.name} 暂不支持从发布器创建，请改用对应页面`)
      return
    }
    if (!body.trim()) {
      toast('正文不能为空')
      return
    }
    if (missing) {
      toast(missing)
      return
    }
    if (hits.length > 0) {
      toast(`命中敏感词（${labels.join('/')}）：${hits.join('、')}，发布已阻断`)
      return
    }
    if (isPlaza) {
      const opts: PublishPostOptions = { topic: topic.trim() || null, images, visibility }
      if (type === CONTENT_TYPE.video) {
        const duration = Number(mediaDuration)
        opts.media = {
          kind: mediaKindOf(mediaSrc),
          src: mediaSrc.trim(),
          ...(mediaPoster.trim() ? { poster: mediaPoster.trim() } : {}),
          ...(mediaTitle.trim() ? { title: mediaTitle.trim() } : {}),
          ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
        }
      }
      if (type === CONTENT_TYPE.vote) {
        opts.vote = {
          question: voteQuestion.trim(),
          options: optionList,
          // counts 必须与 options 等长且全 0，否则百分比渲染会 NaN
          counts: optionList.map(() => 0),
          voters: {},
          endsAt: Date.now() + Math.max(1, Math.round(hours)) * 3_600_000,
        }
      }
      if (type === CONTENT_TYPE.lottery) {
        opts.lottery = {
          prize: prize.trim(),
          count: Math.max(1, Math.round(Number(prizeCount))),
          participants: [],
          endsAt: Date.now() + Math.max(1, Math.round(hours)) * 3_600_000,
        }
      }
      // 快拍的 expiresAt 由 publishPost 兜底为 24h，这里只置标记
      if (type === CONTENT_TYPE.story) opts.story = true
      if (place.trim()) opts.location = place.trim()
      app.publishPost(body.trim(), opts)
      reportGrowth('publish_dynamic')
      toast(`已发布：${meta.name}`)
      navigate('/feed')
      return
    }
    const id = app.publishArticle({
      title: title.trim(),
      content: body,
      tags: tags.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean),
    })
    // 博文走质量门：正文去空白不足 50 字不计成长分
    const outcome = reportGrowth('publish_article', articleQualityPass(body))
    toast(outcome.ok ? '文章已发布 🎉' : '文章已发布（正文不足 50 字，本次不计成长分）')
    navigate(`/article/${id}`)
  }

  if (!meta.supported) {
    return (
      <div className="page-grid single">
        <div className="card">
          <h2 className="page-title">📤 统一内容发布器</h2>
          <div className="chip-row">
            {TYPES.map((t) => (
              <button
                key={t.code}
                className={cx('chip', type === t.code && 'active', !t.supported && 'chip-off')}
                onClick={() => setType(t.code)}
                title={t.hint}
              >
                {t.name}
              </button>
            ))}
          </div>
          <Empty emoji="🚧" text={`「${meta.name}」无法从发布器创建`} />
          <p className="muted">{meta.hint}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-grid single">
      <div className="card">
        <h2 className="page-title">📤 统一内容发布器</h2>
        <div className="chip-row">
          {TYPES.map((t) => (
            <button
              key={t.code}
              className={cx('chip', type === t.code && 'active', !t.supported && 'chip-off')}
              onClick={() => setType(t.code)}
              title={t.hint}
            >
              {t.name}
            </button>
          ))}
        </div>
        <p className="muted">{meta.hint}</p>

        {isPlaza ? (
          <>
            <textarea
              className="input"
              rows={5}
              placeholder="这一刻的想法…（支持 #话题# 与 @用户）"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="row wrap" style={{ marginTop: 10 }}>
              <input
                className="input topic-input"
                list="publish-topic-options"
                placeholder="#话题（可选）"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
              <datalist id="publish-topic-options">
                {existingTopics.map((t) => (
                  <option key={t.name} value={t.name} />
                ))}
              </datalist>
            </div>

            {type === CONTENT_TYPE.image ? (
              <div className="emoji-picker" style={{ marginTop: 10 }}>
                {IMAGE_EMOJIS.map((e) => (
                  <button
                    key={e}
                    className={cx('btn btn-sm', images.includes(e) && 'btn-primary')}
                    onClick={() => setImages((s) => (s.includes(e) ? s.filter((x) => x !== e) : [...s, e]))}
                  >
                    {e}
                  </button>
                ))}
              </div>
            ) : null}

            {type === CONTENT_TYPE.video ? (
              <div className="col" style={{ marginTop: 10 }}>
                <h3 className="section-title">🎬 媒体</h3>
                <input
                  className="input"
                  placeholder="媒体地址 src（必填，.gif 自动识别为 GIF）"
                  value={mediaSrc}
                  onChange={(e) => setMediaSrc(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="封面 poster（可选）"
                  value={mediaPoster}
                  onChange={(e) => setMediaPoster(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="标题 title（可选）"
                  value={mediaTitle}
                  onChange={(e) => setMediaTitle(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="时长 duration（秒，可选）"
                  value={mediaDuration}
                  onChange={(e) => setMediaDuration(e.target.value)}
                />
                <small className="muted">
                  媒体地址会被渲染为 {mediaKindOf(mediaSrc) === 'gif' ? 'GIF' : mediaKindOf(mediaSrc) === 'audio' ? '音频' : '视频'}
                  块；无真实片源时卡片降级为海报占位，不会伪造画面。
                </small>
              </div>
            ) : null}

            {type === CONTENT_TYPE.vote ? (
              <div className="col" style={{ marginTop: 10 }}>
                <h3 className="section-title">🗳 投票</h3>
                <input
                  className="input"
                  placeholder="投票问题"
                  value={voteQuestion}
                  onChange={(e) => setVoteQuestion(e.target.value)}
                />
                {voteOptions.map((opt, i) => (
                  <div className="row" key={i}>
                    <input
                      className="input grow"
                      placeholder={`选项 ${i + 1}`}
                      value={opt}
                      onChange={(e) => setVoteOptions((s) => s.map((x, j) => (j === i ? e.target.value : x)))}
                    />
                    <button
                      className="btn btn-ghost btn-sm"
                      aria-label={`删除选项 ${i + 1}`}
                      onClick={() => setVoteOptions((s) => (s.length > 2 ? s.filter((_, j) => j !== i) : s))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button className="btn btn-ghost btn-sm" onClick={() => setVoteOptions((s) => [...s, ''])}>
                  + 增加选项
                </button>
                <div className="row">
                  <span className="muted">结束时间</span>
                  <input
                    className="input"
                    style={{ width: 90 }}
                    inputMode="numeric"
                    placeholder="24"
                    value={endsInHours}
                    onChange={(e) => setEndsInHours(e.target.value)}
                  />
                  <span className="muted">小时后</span>
                </div>
              </div>
            ) : null}

            {type === CONTENT_TYPE.lottery ? (
              <div className="col" style={{ marginTop: 10 }}>
                <h3 className="section-title">🎁 抽奖</h3>
                <input
                  className="input"
                  placeholder="奖品名称"
                  value={prize}
                  onChange={(e) => setPrize(e.target.value)}
                />
                <div className="row">
                  <span className="muted">奖品份数</span>
                  <input
                    className="input"
                    style={{ width: 90 }}
                    inputMode="numeric"
                    placeholder="1"
                    value={prizeCount}
                    onChange={(e) => setPrizeCount(e.target.value)}
                />
                </div>
                <div className="row">
                  <span className="muted">开奖时间</span>
                  <input
                    className="input"
                    style={{ width: 90 }}
                    inputMode="numeric"
                    placeholder="24"
                    value={endsInHours}
                    onChange={(e) => setEndsInHours(e.target.value)}
                  />
                  <span className="muted">小时后</span>
                </div>
              </div>
            ) : null}

            {type === CONTENT_TYPE.story ? (
              <div className="notice-bar" style={{ marginTop: 10 }}>
                📸 快拍不进入信息流，发布后 24 小时自动过期。
              </div>
            ) : null}

            <div className="row wrap" style={{ marginTop: 10 }}>
              <input
                className="input topic-input"
                placeholder="📍 位置（可选）"
                value={place}
                onChange={(e) => setPlace(e.target.value)}
              />
            </div>

            <div className="row" style={{ marginTop: 10 }}>
              <span className="muted">可见范围</span>
              <button
                className={cx('chip', visibility === 'public' && 'active')}
                onClick={() => setVisibility('public')}
              >
                公开
              </button>
              <button className={cx('chip', visibility === 'self' && 'active')} onClick={() => setVisibility('self')}>
                仅自己可见
              </button>
            </div>
          </>
        ) : (
          <>
            <input
              className="input"
              placeholder="文章标题（必填）"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ marginBottom: 10 }}
            />
            <input
              className="input"
              placeholder="标签（逗号分隔，如：React, 性能优化）"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              style={{ marginBottom: 10 }}
            />
            <textarea
              className="input mono-textarea"
              rows={10}
              placeholder={'正文支持 Markdown 块：\n## 二级标题\n- 列表项\n```\n代码块\n```'}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </>
        )}

        {hits.length > 0 ? (
          <div className="notice-bar danger" role="alert">
            ⚠️ 命中敏感词（{labels.join('/')}）：{hits.join('、')} —— 发布已禁用，请修改正文后重试。
            <small>（前端机审前置，正式运营仍需服务端二次审核）</small>
          </div>
        ) : null}

        <div className="row-between" style={{ marginTop: 12 }}>
          <small className="muted">字数：{body.length}</small>
          <div className="row">
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/feed')}>
              取消
            </button>
            <button className="btn btn-primary btn-sm" disabled={!canPublish} onClick={submit}>
              {isPlaza ? '发布动态' : '发布文章'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
