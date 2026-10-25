import './publish.css'
import './content-domain.css'
import { useEffect, useState } from 'react'
import { Empty, Modal, TimeAgo, useToast } from './components'
import { MediaTranscodeWorkbench } from './media-domain' /* 轮 24 打通：B5 上传/转码工作台 */
import { getCurrentUserId, useAuth } from './auth'
import { useApp } from './store'
import { cloudEnabled } from './lib/supabase'
import { readPrivacy } from './user-domain'
import {
  SCHED_EVT,
  STORY_TTL,
  LOCATION_PRESETS,
  VIDEO_POSTERS,
  cancelSchedule,
  enqueueSchedule,
  findSensitiveHits,
  loadSchedule,
  sensitiveHitLabels,
  type ScheduleItem,
} from './content-domain'
import { cx, formatDate } from './utils'
import type { PostLottery, PostMedia, PostVote } from './types'

/** 统一内容发布器（开发吧.md「内容统一模型：基表 + 扩展表」）
 *  单态（2026-10-23）：全站统一内容池，不再按 domain 路由；
 *  扩展表只存差异化字段：content_ext_dynamic / content_ext_article。
 *  轮 15 打通：提交不再只落本地预览——按 content_type 真发布进 store
 *  （动态/图文→广场 Feed，博文→知识库），并触发成长引擎记分；落库预览保留作 JSON 展示。
 *  轮 17 打通：发布记录按真实登录身份隔离（mim-publish-v1:<userId>），
 *  本地模式一次性迁移旧全局 key；切号即重载。 */

/** content_type：10动态短文/11图文/12视频GIF/13投票/14抽奖/15快拍；20博文/22资源
 *  轮 21 打通：广场态扩展 B2 内容类型 12-15 */
type ContentType = 10 | 11 | 12 | 13 | 14 | 15 | 20 | 22

/** pay_policy：0免费 1单买 2订阅专栏 3VIP可见（demo 提供 0/1/3） */
const PAY_POLICY: { code: 0 | 1 | 3; label: string }[] = [
  { code: 0, label: '免费' },
  { code: 1, label: '单买' },
  { code: 3, label: 'VIP 可见' },
]

/** 轮 21 打通：B2 可见范围（visible_scope 收敛为 公开/仅自己，与 Post.visibility 对齐） */
type VisCode = 'public' | 'self'
const VISIBLE_SCOPE: { code: VisCode; label: string }[] = [
  { code: 'public', label: '公开' },
  { code: 'self', label: '仅自己' },
]

/** content_type 元信息：编码 / 名称 / 建议提示 */
const TYPE_META: Record<ContentType, { name: string; hint: string }> = {
  10: { name: '动态短文', hint: '纯文字动态，进广场 Feed' },
  11: { name: '图文', hint: '带图动态（媒体上传后续接入）' },
  12: { name: '视频 / GIF', hint: 'emoji 海报占位视频或 GIF 动图' },
  13: { name: '投票', hint: '2-4 选项，一人一票，截止锁定' },
  14: { name: '抽奖', hint: '奖品 + 份数，可立即开奖' },
  15: { name: '快拍', hint: '24 小时故事，过期自动消失' },
  20: { name: '博文', hint: 'Markdown 长文，进知识库与 RAG 索引' },
  22: { name: '资源', hint: '可下载附件（配额设置后续接入）' },
}

/** 轮 21 打通：B2 发布扩展参数（随发布/定时队列透传给 publishPost api） */
type B2Fields = {
  topic: string | null
  images: string[]
  media?: PostMedia
  vote?: PostVote
  lottery?: PostLottery
  location?: string
  visibility: VisCode
  story?: boolean
  expiresAt?: number
}

/** 落库预览：一条记录 = 基表行 + 扩展表行 */
interface PublishedItem {
  id: number // 模拟雪花 ID（demo 用时间戳）
  at: number
  extTable: 'content_ext_dynamic' | 'content_ext_article'
  preview: Record<string, unknown>
}

/* 轮 17 打通：旧全局 key 仅作一次性迁移源；发布记录按登录身份分 key 隔离 */
const PUB_LEGACY = 'mim-publish-v1'
const publishKeyFor = (userId: string) => `mim-publish-v1:${userId}`

/** 校验并解析发布记录（缺失/非法返回 null） */
function parsePublish(raw: string | null): PublishedItem[] | null {
  try {
    const parsed: unknown = JSON.parse(raw ?? 'null')
    if (!Array.isArray(parsed)) return null
    return parsed.filter(
      (x): x is PublishedItem =>
        typeof x === 'object' && x !== null && typeof (x as PublishedItem).id === 'number',
    )
  } catch {
    return null
  }
}

/** 读取当前身份的发布记录（页面重载场景显式传 userId，避免与身份单例同步竞态） */
function loadPublish(userId: string = getCurrentUserId()): PublishedItem[] {
  const key = publishKeyFor(userId)
  const own = parsePublish(localStorage.getItem(key))
  if (own) return own
  /* 本地模式首次访问时把旧全局 key 历史数据一次性迁移到当前身份
     （云端真实模式跳过迁移：老共享 key 存的是演示期数据，不注入真实身份，与钱包/商城一致） */
  if (!cloudEnabled) {
    const legacy = parsePublish(localStorage.getItem(PUB_LEGACY))
    if (legacy) {
      try {
        localStorage.setItem(key, JSON.stringify(legacy))
      } catch {
        /* ignore */
      }
      return legacy
    }
  }
  return []
}

/** seo_slug 自动生成（知识态专用；广场态 NULL） */
function genSlug(): string {
  return `mim-${Date.now().toString(36)}`
}

/** 表单分隔输入 → 数组（话题/标签/@ 用户共用；轮 15 提为模块级供 submit 发布使用） */
function splitList(s: string, extra?: RegExp): string[] {
  return s.split(extra ?? /[,，\s#]+/).map((x) => x.trim()).filter(Boolean)
}

export function PublishPage() {
  const toast = useToast()
  /* 轮 15 打通：接入全局 store——真发布进广场 Feed / 知识库
     轮 21 打通：取全量 api（state/me/deletePost 供批量管理使用） */
  const api = useApp()
  /* 作者锚点绑真实登录身份（本地未登录为 'local'），不再写死演示 user_id */
  const { auth } = useAuth()

  /* ---------- 表单状态 ---------- */
  const [contentType, setContentType] = useState<ContentType>(10)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [payPolicy, setPayPolicy] = useState<0 | 1 | 3>(0)
  const [priceYuan, setPriceYuan] = useState('')
  /* 广场态动态 index_flag 默认 0：不进搜索引擎/AI 抓取（RAG 红线），用户可手动开启 */
  const [indexFlag, setIndexFlag] = useState(false)
  const [seoSlug, setSeoSlug] = useState('')
  /* 动态扩展字段 */
  const [topics, setTopics] = useState('')
  const [atUsers, setAtUsers] = useState('')
  const [visibleScope, setVisibleScope] = useState<VisCode>('public')
  /* 文章扩展字段 */
  const [columnId, setColumnId] = useState('')
  const [tags, setTags] = useState('')
  const [codeLangs, setCodeLangs] = useState('')
  const [vipVisible, setVipVisible] = useState(false)

  /* ---------- 轮 21 打通：B2 内容域表单状态 ---------- */
  /* 4. 位置 / 8. 可见性 / 5. 定时 */
  const [location, setLocation] = useState('')
  const [scheduleOn, setScheduleOn] = useState(false)
  const [scheduleAt, setScheduleAt] = useState('')
  /* 1. 视频/GIF */
  const [mediaType, setMediaType] = useState<'video' | 'gif'>('video')
  const [mediaPoster, setMediaPoster] = useState(VIDEO_POSTERS[0])
  const [mediaDur, setMediaDur] = useState('15')
  /* 2. 投票 */
  const [voteOpts, setVoteOpts] = useState<string[]>(['', '', '', ''])
  const [voteHours, setVoteHours] = useState(24)
  /* 3. 抽奖 */
  const [lotteryPrize, setLotteryPrize] = useState('')
  const [lotteryCount, setLotteryCount] = useState('3')
  const [lotteryHours, setLotteryHours] = useState(24)

  /* ---------- 已发布列表 ---------- */
  const [published, setPublished] = useState<PublishedItem[]>(loadPublish)
  const [openId, setOpenId] = useState<number | null>(null)

  /* ---------- 轮 21 打通：定时队列（按身份分 key）+ 批量管理 ---------- */
  const [sched, setSched] = useState<ScheduleItem[]>(() => loadSchedule())
  const [batchOpen, setBatchOpen] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())

  /* 轮 17 打通：切号（登录/登出）即重载对应身份的发布记录（显式传 userId 防竞态） */
  useEffect(() => {
    setPublished(loadPublish(auth.userId))
  }, [auth.userId])

  /* 轮 21 打通：切号重载定时队列；任何队列写入（含 App 级轮询发出）经 SCHED_EVT 实时同步 */
  useEffect(() => {
    setSched(loadSchedule(auth.userId))
  }, [auth.userId])
  useEffect(() => {
    const sync = () => setSched(loadSchedule(getCurrentUserId()))
    window.addEventListener(SCHED_EVT, sync)
    return () => window.removeEventListener(SCHED_EVT, sync)
  }, [])

  /* 单态：不再用独立 domain 开关，isPlaza 由 content_type 派生（10-15 广场 / 20-22 知识） */
  const isPlaza = contentType <= 15
  const types: ContentType[] = [10, 11, 12, 13, 14, 15, 20, 22]
  const priceFen = Math.round((parseFloat(priceYuan) || 0) * 100)

  /* 轮 21 打通：9. 敏感词前置——输入过程实时检测（纯前端词库，渲染期计算即可）
     词库已按「导流营销 / 金融违规 / 黑产违规 / 色情低俗 / 暴力违法」分类，
     提示一并给出命中类别，便于用户知道该改哪类表述 */
  const sensHits = findSensitiveHits(body)
  const sensLabels = sensitiveHitLabels(body)
  /* 轮 21 打通：8. 与 B1 账号级隐私叠加取更严者——账号级为「仅自己」时本条强制 self */
  const acctSelf = readPrivacy(auth.userId).posts === 'self'
  const effVisibility: VisCode = acctSelf ? 'self' : visibleScope

  /* 单态：content_type 直接切换内容类型，无独立域开关 */

  /* ---------- 轮 21 打通：按广场 content_type 构造 B2 扩展发布参数（校验失败 toast 并返回 null） ---------- */
  const buildB2 = (): B2Fields | null => {
    const common: B2Fields = {
      topic: splitList(topics)[0] ?? null,
      images: [],
      location: location.trim() || undefined,
      visibility: effVisibility,
    }
    if (contentType === 12) {
      /* 视频/GIF：emoji 海报占位，视频附时长（秒） */
      const dur = Math.max(1, Math.round(parseFloat(mediaDur) || 0))
      return {
        ...common,
        media: { type: mediaType, poster: mediaPoster, ...(mediaType === 'video' ? { duration: dur } : {}) },
      }
    }
    if (contentType === 13) {
      /* 投票：2-4 个不重复选项；随机铺少量底票让百分比条可信 */
      const options = voteOpts.map((x) => x.trim()).filter(Boolean)
      if (options.length < 2 || options.length > 4 || new Set(options).size !== options.length) {
        toast('投票需要 2-4 个不重复的选项')
        return null
      }
      const votes = Object.fromEntries(options.map((o) => [o, 3 + Math.floor(Math.random() * 28)] as const))
      return { ...common, vote: { options, votes, endsAt: Date.now() + voteHours * 3_600_000, voters: {} } }
    }
    if (contentType === 14) {
      /* 抽奖：奖品名 + 份数 + 截止时间 */
      if (!lotteryPrize.trim()) {
        toast('请填写奖品名称')
        return null
      }
      const count = Math.max(1, Math.round(parseFloat(lotteryCount) || 0))
      return {
        ...common,
        lottery: { prize: lotteryPrize.trim(), count, endsAt: Date.now() + lotteryHours * 3_600_000, participants: [] },
      }
    }
    if (contentType === 15) {
      /* 快拍：24h 过期 */
      return { ...common, story: true, expiresAt: Date.now() + STORY_TTL }
    }
    return common
  }

  /* ---------- 构造落库预览（基表 content + 扩展表；b2 为轮 21 扩展参数，可选） ---------- */
  const buildPreview = (b2?: B2Fields): PublishedItem | { error: string } => {
    if (!body.trim()) return { error: '正文不能为空' }
    if (!isPlaza && !title.trim()) return { error: '知识态内容标题必填（广场态 title 为 NULL）' }
    if (payPolicy === 1 && priceFen <= 0) return { error: '单买策略必须填写大于 0 的价格' }

    const id = Date.now()
    const now = new Date().toISOString()
    /* 金额一律存「分」整数（结算铁律）；广场态标题为 NULL、seo_slug 为 NULL */
    const base: Record<string, unknown> = {
      id,
      user_id: auth.userId, // 真实登录身份（本地未登录为 'local'）
      domain: isPlaza ? 1 : 2,
      content_type: contentType,
      title: isPlaza ? null : title.trim(),
      body_draft: body,
      body_render: null, // 渲染缓存由服务端生成，本地预览留空不伪造
      pay_policy: payPolicy,
      price: priceFen,
      status: 2, // 已发布
      audit_level: 0, // 机审通过（demo 模拟）
      seo_slug: isPlaza ? null : (seoSlug.trim() || genSlug()),
      canonical: null,
      index_flag: isPlaza ? (indexFlag ? 1 : 0) : 1,
      stat_view: 0,
      stat_like: 0,
      stat_comment: 0,
      stat_collect: 0,
      hot_score: 0,
      quality_score: 0,
      created_at: now,
      updated_at: now,
    }
    /* 扩展表只存差异化字段（轮 21 打通：is_vote / is_lottery / story_expire_at 随 B2 类型如实填充） */
    const extTable = isPlaza ? 'content_ext_dynamic' : 'content_ext_article'
    const ext: Record<string, unknown> = isPlaza
      ? {
          content_id: id,
          topic_ids: splitList(topics),
          at_user_ids: splitList(atUsers, /[,，\s@]+/),
          visible_scope: b2?.visibility ?? effVisibility,
          location: b2?.location ?? null,
          media_ids: b2?.media ? [`poster:${b2.media.poster}`] : [], // 媒体上传未接入，海报占位不入 media_id
          is_vote: !!b2?.vote,
          is_lottery: !!b2?.lottery,
          story_expire_at: b2?.story && b2.expiresAt ? new Date(b2.expiresAt).toISOString() : null,
          b2: b2 ?? null,
        }
      : {
          content_id: id,
          column_id: columnId.trim() || null,
          tag_ids: splitList(tags),
          code_langs: splitList(codeLangs),
          read_time: Math.max(1, Math.ceil(body.length / 400)), // 按 400 字/分钟估
          vip_visible: vipVisible,
          download_quota: null, // 配额设置未接入，不伪造默认值
          version_no: 1,
        }
    return { id, at: Date.now(), extTable, preview: { base, ext } }
  }

  const submit = () => {
    /* 轮 21 打通：9. 敏感词前置——命中即阻断（即时发布与定时入库一体拦截） */
    if (sensHits.length > 0) {
      toast(`命中敏感词（${sensLabels.join('/')}）：${sensHits.join('、')}，发布已阻断`)
      return
    }
    if (!body.trim()) {
      toast('正文不能为空')
      return
    }
    /* 轮 21 打通：5. 定时发布——不立即入库，进按身份分 key 的定时队列，由 App 级 30s 轮询到点经 publishPost api 发出 */
    if (isPlaza && scheduleOn) {
      const at = new Date(scheduleAt).getTime()
      if (!scheduleAt || Number.isNaN(at) || at <= Date.now()) {
        toast('请选择一个未来的定时时间')
        return
      }
      const b2 = buildB2()
      if (!b2) return
      enqueueSchedule({ at, content: body.trim(), ...b2 })
      toast('已加入定时队列，到点自动发出 ⏰')
      return
    }
    const item = buildPreview()
    if ('error' in item) {
      toast(item.error)
      return
    }
    /* 轮 15 打通：按 domain/content_type 真发布进 store（触发成长引擎记分），落库预览保留作 JSON 展示 */
    if (isPlaza && (contentType === 10 || contentType === 11)) {
      /* 广场态：动态短文/图文 → publishPost 进 Feed（轮 21：附带位置/可见性） */
      const b2 = buildB2()
      if (!b2) return
      api.publishPost(body.trim(), b2)
      toast(`已发布进广场动态流（${TYPE_META[contentType].name} · 记分 publish_dynamic）`)
    } else if (isPlaza && contentType >= 12 && contentType <= 15) {
      /* 轮 21 打通：视频/GIF / 投票 / 抽奖 / 快拍 → publishPost 带 B2 扩展参数进 Feed */
      const b2 = buildB2()
      if (!b2) return
      const item2 = buildPreview(b2)
      if ('error' in item2) {
        toast(item2.error)
        return
      }
      api.publishPost(body.trim(), b2)
      toast(`已发布进广场动态流（${TYPE_META[contentType].name} · 记分 publish_dynamic）`)
      persistPublished(item2)
      setOpenId(item2.id)
      setBody('')
      return
    } else if (!isPlaza && contentType === 20) {
      /* 知识态博文 → publishArticle 进知识库（≥50 字触发 publish_article 质量记分） */
      api.publishArticle({ title: title.trim(), content: body, tags: splitList(tags) })
      toast('已发布进知识库（博文 · 记分 publish_article）')
    } else {
      /* 资源（22）暂无 store 创建路径：仅保留落库预览 */
      toast('资源类型暂无 store 创建路径：仅保留落库预览（后续轮次扩展）')
    }
    persistPublished(item)
    setOpenId(item.id)
    setBody('')
    setTitle('')
  }

  /* 轮 21 打通：发布记录持久化抽函数（批量删除/清空共用存储 key） */
  const persistPublished = (item: PublishedItem) => {
    setPublished((prev) => {
      const next = [item, ...prev]
      try {
        localStorage.setItem(publishKeyFor(getCurrentUserId()), JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }

  /* 轮 21 打通：10. 批量管理——勾选后循环走现有 deletePost api */
  const myPosts = api.state.posts.filter((p) => p.authorId === api.me.id)
  const toggleAll = () => {
    setChecked(checked.size === myPosts.length ? new Set() : new Set(myPosts.map((p) => p.id)))
  }
  const toggleOne = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const batchDelete = () => {
    if (checked.size === 0) return
    const n = checked.size
    for (const id of checked) api.deletePost(id)
    setChecked(new Set())
    toast(`已批量删除 ${n} 条动态 🗑️`)
  }

  const clearAll = () => {
    setPublished([])
    setOpenId(null)
    try {
      localStorage.removeItem(publishKeyFor(getCurrentUserId()))
    } catch {
      /* ignore */
    }
    toast('已清空发布记录')
  }

  return (
    <div className="page-grid single">
      <div className="pb-page">
        <header className="pb-head">
          <h2>📤 统一内容发布器</h2>
          <p className="pb-sub">
            基表 <code>content</code> + 双扩展表（开发吧.md 内容统一模型）——
            单态下统一内容池，不再按 <code>domain</code> 路由；动态/图文进广场 Feed，博文/资源进知识库
          </p>
        </header>

        {/* content_type 选择 */}
        <div className="pb-types">
          {types.map((t) => (
            <button
              key={t}
              type="button"
              className={cx('pb-type-btn', contentType === t && 'active')}
              onClick={() => setContentType(t)}
            >
              <b>{t}</b>
              <span>{TYPE_META[t].name}</span>
              <i>{TYPE_META[t].hint}</i>
            </button>
          ))}
        </div>

        {/* 表单 */}
        <div className="pb-form">
          {!isPlaza && (
            <label className="pb-field">
              <span>标题（知识态必填）</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="博文 / 资源标题" />
            </label>
          )}
          <label className="pb-field">
            <span>正文（body_draft 原始 Markdown）</span>
            <textarea
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={isPlaza ? '这一刻的想法…' : '支持 ## 标题 / ``` 代码块 / - 列表'}
            />
          </label>

          {/* 轮 21 打通：9. 敏感词前置——输入过程实时提示（命中高亮），发布时阻断 */}
          {sensHits.length > 0 && (
            <div className="wt-sens" role="alert">
              ⚠️ 命中敏感词（{sensLabels.join('/')}）：
              {sensHits.map((w) => (
                <i key={w} className="wt-hit">
                  {w}
                </i>
              ))}
              ，发布将被阻断，请修改正文
            </div>
          )}

          {isPlaza ? (
            /* ---- 动态扩展字段（轮 21 打通：B2 内容域 12-15 表单） ---- */
            <>
              <div className="pb-grid2">
                <label className="pb-field">
                  <span>话题 topic_ids</span>
                  <input value={topics} onChange={(e) => setTopics(e.target.value)} placeholder="#前端 #AI（逗号分隔）" />
                </label>
                <label className="pb-field">
                  <span>@ 用户 at_user_ids</span>
                  <input value={atUsers} onChange={(e) => setAtUsers(e.target.value)} placeholder="@alice, @bob" />
                </label>
              </div>

              {/* 1. 视频/GIF：海报占位 + 时长 */}
              {contentType === 12 && (
                <fieldset className="pb-field">
                  <span>🎬 视频 / GIF（emoji 海报占位）</span>
                  <div className="pb-chips">
                    <button type="button" className={cx('pb-chip', mediaType === 'video' && 'active')} onClick={() => setMediaType('video')}>
                      视频（含时长）
                    </button>
                    <button type="button" className={cx('pb-chip', mediaType === 'gif' && 'active')} onClick={() => setMediaType('gif')}>
                      GIF 动图
                    </button>
                  </div>
                  <div className="pb-chips">
                    {VIDEO_POSTERS.map((p) => (
                      <button key={p} type="button" className={cx('pb-chip', mediaPoster === p && 'active')} onClick={() => setMediaPoster(p)}>
                        {p}
                      </button>
                    ))}
                  </div>
                  {mediaType === 'video' && (
                    <input inputMode="numeric" value={mediaDur} onChange={(e) => setMediaDur(e.target.value)} placeholder="时长（秒），如 15" />
                  )}
                  {/* 轮 24 打通：B5 上传/转码工作台（文件选择 → URL.createObjectURL 本地预览 → 模拟转码进度 → 完成标记） */}
                  <MediaTranscodeWorkbench />
                </fieldset>
              )}

              {/* 2. 投票：2-4 选项 + 截止时长 */}
              {contentType === 13 && (
                <fieldset className="pb-field">
                  <span>📊 投票选项（填 2-4 个，留空的忽略）</span>
                  {voteOpts.map((o, i) => (
                    <input
                      key={i}
                      value={o}
                      onChange={(e) => setVoteOpts(voteOpts.map((x, j) => (j === i ? e.target.value : x)))}
                      placeholder={`选项 ${i + 1}`}
                    />
                  ))}
                  <span className="pb-muted">截止时长：{voteHours} 小时后自动锁定</span>
                  <input
                    type="range"
                    min={1}
                    max={72}
                    value={voteHours}
                    onChange={(e) => setVoteHours(Number(e.target.value))}
                  />
                </fieldset>
              )}

              {/* 3. 抽奖：奖品 + 份数 + 截止 */}
              {contentType === 14 && (
                <fieldset className="pb-field">
                  <span>🎁 抽奖设置</span>
                  <input value={lotteryPrize} onChange={(e) => setLotteryPrize(e.target.value)} placeholder="奖品名称，如：Mim 定制周边礼盒" />
                  <div className="pb-grid2">
                    <label className="pb-field">
                      <span>中奖份数</span>
                      <input inputMode="numeric" value={lotteryCount} onChange={(e) => setLotteryCount(e.target.value)} />
                    </label>
                    <label className="pb-field">
                      <span>开奖时间（小时后）</span>
                      <input inputMode="numeric" value={lotteryHours} onChange={(e) => setLotteryHours(Number(e.target.value) || 1)} />
                    </label>
                  </div>
                </fieldset>
              )}

              {/* 4. 位置 */}
              <label className="pb-field">
                <span>📍 位置（可选）</span>
                <select value={location} onChange={(e) => setLocation(e.target.value)}>
                  <option value="">不显示位置</option>
                  {LOCATION_PRESETS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>

              {/* 8. 可见范围（轮 21 打通：收敛为 公开/仅自己，与账号级隐私取更严者） */}
              <label className="pb-field">
                <span>可见范围 visible_scope{acctSelf ? '（账号级隐私=仅自己，本条强制仅自己）' : ''}</span>
                <div className="pb-chips">
                  {VISIBLE_SCOPE.map((v) => (
                    <button
                      key={v.code}
                      type="button"
                      className={cx('pb-chip', effVisibility === v.code && 'active')}
                      onClick={() => setVisibleScope(v.code)}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </label>

              {/* 5. 定时发布 */}
              <label className="pb-check">
                <input type="checkbox" checked={scheduleOn} onChange={(e) => setScheduleOn(e.target.checked)} />
                <span>⏰ 定时发布（进按身份隔离的定时队列，App 每 30s 轮询到点自动发出）</span>
              </label>
              {scheduleOn && (
                <label className="pb-field">
                  <span>计划发出时间</span>
                  <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
                </label>
              )}

              <label className="pb-check">
                <input type="checkbox" checked={indexFlag} onChange={(e) => setIndexFlag(e.target.checked)} />
                <span>
                  允许搜索引擎 / AI 抓取（index_flag=1）——
                  <b className="pb-danger">广场动态默认 0：绝不进 RAG 索引</b>
                </span>
              </label>
            </>
          ) : (
            /* ---- 文章扩展字段 ---- */
            <>
              <div className="pb-grid2">
                <label className="pb-field">
                  <span>专栏 column_id</span>
                  <input value={columnId} onChange={(e) => setColumnId(e.target.value)} placeholder="如 col-101（留空=未投稿）" />
                </label>
                <label className="pb-field">
                  <span>标签 tag_ids</span>
                  <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="React, 性能优化" />
                </label>
                <label className="pb-field">
                  <span>代码语言 code_langs</span>
                  <input value={codeLangs} onChange={(e) => setCodeLangs(e.target.value)} placeholder="ts, python" />
                </label>
                <label className="pb-field">
                  <span>SEO slug（留空自动生成）</span>
                  <input value={seoSlug} onChange={(e) => setSeoSlug(e.target.value)} placeholder="react-perf-guide" />
                </label>
              </div>
              <label className="pb-check">
                <input type="checkbox" checked={vipVisible} onChange={(e) => setVipVisible(e.target.checked)} />
                <span>VIP 可见标记 vip_visible（作用于本篇，不改全局权益）</span>
              </label>
            </>
          )}

          {/* 付费策略：两态通用 */}
          <label className="pb-field">
            <span>付费策略 pay_policy（广场态打赏 / 知识态订阅共用一张费率表）</span>
            <div className="pb-chips">
              {PAY_POLICY.map((p) => (
                <button
                  key={p.code}
                  type="button"
                  className={cx('pb-chip', payPolicy === p.code && 'active')}
                  onClick={() => setPayPolicy(p.code)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </label>
          {payPolicy === 1 && (
            <label className="pb-field">
              <span>价格（元）→ 落库存「分」整数</span>
              <input
                inputMode="decimal"
                value={priceYuan}
                onChange={(e) => setPriceYuan(e.target.value)}
                placeholder="如 9.90"
              />
              <i className="pb-muted">落库值：price = {priceFen} 分</i>
            </label>
          )}

          <button type="button" className="pb-submit" onClick={submit} disabled={sensHits.length > 0}>
            {scheduleOn && isPlaza ? '加入定时队列（构造落库预览 JSON）' : '发布（构造落库预览 JSON）'}
          </button>
          {sensHits.length > 0 && <i className="pb-muted">命中敏感词，发布按钮已禁用</i>}
        </div>

        {/* 已发布列表 */}
        <h3 className="pb-sec-title">已发布（{published.length}）</h3>
        {published.length === 0 ? (
          <Empty text="还没有发布记录，填一份试试" />
        ) : (
          <div className="pb-list">
            {published.map((item) => {
              const base = item.preview.base as Record<string, unknown>
              const open = openId === item.id
              return (
                <div key={item.id} className="pb-item">
                  <button type="button" className="pb-item-head" onClick={() => setOpenId(open ? null : item.id)}>
                    <b className="pb-domain-tag" data-d={String(base.domain)}>
                      {base.domain === 1 ? '广场' : '知识'}
                    </b>
                    <span className="pb-item-title">{String(base.title ?? '(无标题动态)')}</span>
                    <span className="pb-item-meta">
                      #{String(base.content_type)} · {item.extTable} · <TimeAgo ts={item.at} />
                    </span>
                    <i className="pb-item-arrow">{open ? '▲' : '▼'}</i>
                  </button>
                  {open && <pre className="pb-json">{JSON.stringify(item.preview, null, 2)}</pre>}
                </div>
              )
            })}
          </div>
        )}
        {published.length > 0 && (
          <button type="button" className="pb-clear" onClick={clearAll}>
            清空发布记录
          </button>
        )}

        {/* 轮 21 打通：5. 定时队列——展示 / 取消（App 级 30s 轮询负责到点发出） */}
        <h3 className="pb-sec-title">⏰ 定时队列（{sched.length}）</h3>
        {sched.length === 0 ? (
          <Empty text="暂无定时发布，勾选「定时发布」并选时间即可加入队列" />
        ) : (
          <div className="wt-sched-list">
            {sched.map((s) => (
              <div key={s.id} className="wt-sched-item">
                <span className="wt-sched-time">{formatDate(s.at)}</span>
                <span className="wt-sched-text">
                  {s.content}
                  {s.story ? ' · 快拍' : ''}
                  {s.media ? ` · ${s.media.type === 'gif' ? 'GIF' : '视频'}` : ''}
                  {s.vote ? ' · 投票' : ''}
                  {s.lottery ? ' · 抽奖' : ''}
                  {s.visibility === 'self' ? ' · 仅自己' : ''}
                </span>
                <button
                  type="button"
                  className="pb-clear"
                  onClick={() => {
                    cancelSchedule(s.id)
                    toast('已取消该条定时发布')
                  }}
                >
                  取消
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 轮 21 打通：10. 批量管理我的动态——Modal 勾选 + 全选 + 批量删除 */}
        <button type="button" className="pb-clear" onClick={() => setBatchOpen(true)}>
          批量管理我的动态（{myPosts.length}）
        </button>
        {batchOpen && (
        <Modal onClose={() => setBatchOpen(false)} title="批量管理我的动态">
          <div className="wt-batch-bar">
            <label className="pb-check">
              <input
                type="checkbox"
                checked={myPosts.length > 0 && checked.size === myPosts.length}
                onChange={toggleAll}
              />
              <span>全选（{checked.size}/{myPosts.length}）</span>
            </label>
            <button type="button" className="btn-danger" disabled={checked.size === 0} onClick={batchDelete}>
              删除选中（{checked.size}）
            </button>
          </div>
          {myPosts.length === 0 ? (
            <Empty text="你还没有发布过动态" />
          ) : (
            <div className="wt-batch-list">
              {myPosts.map((p) => (
                <label key={p.id} className="wt-batch-item">
                  <input type="checkbox" checked={checked.has(p.id)} onChange={() => toggleOne(p.id)} />
                  <span className="wt-batch-text">{p.content || '（无文字）'}</span>
                  <small>{formatDate(p.createdAt)}</small>
                </label>
              ))}
            </div>
          )}
        </Modal>
        )}

        {/* 红线声明 */}
        <p className="pb-warn">
          ⚠️ 单态说明（开发吧.md）：全站统一内容池，不再按 domain 路由；广场动态默认
          <b>index_flag=0 不进 RAG 索引</b>；点赞/评论/收藏/审核全走 content_id，不写两套交互逻辑。
        </p>
      </div>
    </div>
  )
}
