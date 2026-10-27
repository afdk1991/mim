/* ==========================================================================
 * PublishPage 统一发布器 —— 按 content_type 分发到「广场动态」或「知识库文章」
 *
 * 单态口径（与原实现一致）：全站统一内容池，广场态（10/11…）进动态流，知识态（20）进文库。
 * 敏感词前置：命中即禁用发布按钮并给出类别标签（sensitiveHitLabels）——
 *             这是机审前置，不等于服务端终审，文案里如实说明。
 * 不支持的类型（12 视频 / 13 投票 / 14 抽奖 / 15 快拍 / 22 资源）：
 *   重建后的 publishPost 仅接收 images / topic / visibility 三类扩展参数，
 *   上述类型缺少媒体与玩法字段的存储出口，因此置灰并说明原因，
 *   不做「点了成功但内容其实没存进去」的假释放。
 * ======================================================================== */

import { useState } from 'react'
import { Empty, useToast } from '@/ui'
import { useApp } from '@/app/state/content'
import { useRouter } from '@/app/router'
import { cx } from '@/core/utils'
import { CONTENT_TYPE } from '@/domain/content/model'
import type { Visibility } from '@/domain/content/model'
import { articleQualityPass, findSensitiveHits, sensitiveHitLabels } from '@/domain/content/rules'
import { sortTopics, topicsFromPosts } from './content-lib'
import { reportGrowth } from './growth-report'

const IMAGE_EMOJIS = ['⚛️', '🚀', '🎨', '🐱', '🌸', '🍜', '🏔️', '💻', '📱']

interface TypeMeta {
  code: number
  name: string
  hint: string
  /** false = 状态层暂无该类型的字段出口 */
  supported: boolean
}

const TYPES: TypeMeta[] = [
  { code: CONTENT_TYPE.text, name: '动态短文', hint: '纯文字动态，进广场 Feed', supported: true },
  { code: CONTENT_TYPE.image, name: '图文', hint: '带配图的动态', supported: true },
  { code: CONTENT_TYPE.video, name: '视频 / GIF', hint: '需 media 字段存储，暂未开放', supported: false },
  { code: CONTENT_TYPE.vote, name: '投票', hint: '需 vote 字段存储，暂未开放', supported: false },
  { code: CONTENT_TYPE.lottery, name: '抽奖', hint: '需 lottery 字段存储，暂未开放', supported: false },
  { code: CONTENT_TYPE.story, name: '快拍', hint: '需 story / expiresAt 字段，暂未开放', supported: false },
  { code: CONTENT_TYPE.article, name: '博文', hint: 'Markdown 长文，进知识库', supported: true },
  { code: CONTENT_TYPE.resource, name: '资源', hint: '资源表无写入通道，暂未开放', supported: false },
]

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

  const meta = TYPES.find((t) => t.code === type) ?? TYPES[0]!
  const isPlaza = type <= 15
  const checkText = `${title}\n${body}`
  const hits = findSensitiveHits(checkText)
  const labels = sensitiveHitLabels(checkText)
  const titleOk = type !== CONTENT_TYPE.article || title.trim().length > 0
  const canPublish = meta.supported && body.trim().length > 0 && hits.length === 0 && titleOk

  const existingTopics = sortTopics(topicsFromPosts(app.state.posts), 'posts').slice(0, 10)

  const submit = (): void => {
    if (!meta.supported) {
      toast(`${meta.name} 暂未开放发布`)
      return
    }
    if (!body.trim()) {
      toast('正文不能为空')
      return
    }
    if (hits.length > 0) {
      toast(`命中敏感词（${labels.join('/')}）：${hits.join('、')}，发布已阻断`)
      return
    }
    if (isPlaza) {
      app.publishPost(body.trim(), { topic: topic.trim() || null, images, visibility })
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
          <Empty emoji="🚧" text={`「${meta.name}」暂未开放：${meta.hint}`} />
          <p className="muted">
            已开放的类型：动态短文 / 图文 / 博文。其余类型待状态层补齐对应存储字段后上线。
          </p>
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
