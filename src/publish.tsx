import './publish.css'
import { useState } from 'react'
import { Empty, TimeAgo, useToast } from './components'
import { useAuth } from './auth'
import { useApp } from './store'
import { cx } from './utils'

/** 统一内容发布器（开发吧.md「内容统一模型：基表 + 扩展表」）
 *  基表 content：domain 是权限边界（1=广场 2=知识），分发/审核/计费全靠它路由；
 *  扩展表只存差异化字段：content_ext_dynamic / content_ext_article。
 *  轮 15 打通：提交不再只落本地预览——按 domain/content_type 真发布进 store
 *  （动态/图文→广场 Feed，博文→知识库），并触发成长引擎记分；落库预览保留作 JSON 展示。 */

type Domain = 1 | 2

/** content_type：域1=10动态短文/11图文；域2=20博文/22资源（12视频等类型后续轮次扩展） */
type ContentType = 10 | 11 | 20 | 22

/** pay_policy：0免费 1单买 2订阅专栏 3VIP可见（demo 提供 0/1/3） */
const PAY_POLICY: { code: 0 | 1 | 3; label: string }[] = [
  { code: 0, label: '免费' },
  { code: 1, label: '单买' },
  { code: 3, label: 'VIP 可见' },
]

/** 可见范围（content_ext_dynamic.visible_scope） */
const VISIBLE_SCOPE: { code: 'public' | 'fans' | 'self'; label: string }[] = [
  { code: 'public', label: '公开' },
  { code: 'fans', label: '仅粉丝' },
  { code: 'self', label: '仅自己' },
]

/** content_type 元信息：编码 / 名称 / 建议提示 */
const TYPE_META: Record<ContentType, { name: string; hint: string }> = {
  10: { name: '动态短文', hint: '纯文字动态，进广场 Feed' },
  11: { name: '图文', hint: '带图动态（媒体上传后续接入）' },
  20: { name: '博文', hint: 'Markdown 长文，进知识库与 RAG 索引' },
  22: { name: '资源', hint: '可下载附件（配额设置后续接入）' },
}

/** 落库预览：一条记录 = 基表行 + 扩展表行 */
interface PublishedItem {
  id: number // 模拟雪花 ID（demo 用时间戳）
  at: number
  extTable: 'content_ext_dynamic' | 'content_ext_article'
  preview: Record<string, unknown>
}

const PUB_KEY = 'mim-publish-v1'

function loadPublish(): PublishedItem[] {
  try {
    const raw = localStorage.getItem(PUB_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (x): x is PublishedItem =>
        typeof x === 'object' && x !== null && typeof (x as PublishedItem).id === 'number',
    )
  } catch {
    return []
  }
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
  /* 轮 15 打通：接入全局 store——真发布进广场 Feed / 知识库 */
  const { publishPost, publishArticle } = useApp()
  /* 作者锚点绑真实登录身份（本地未登录为 'local'），不再写死演示 user_id */
  const { auth } = useAuth()

  /* ---------- 表单状态 ---------- */
  const [domain, setDomain] = useState<Domain>(1)
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
  const [visibleScope, setVisibleScope] = useState<'public' | 'fans' | 'self'>('public')
  /* 文章扩展字段 */
  const [columnId, setColumnId] = useState('')
  const [tags, setTags] = useState('')
  const [codeLangs, setCodeLangs] = useState('')
  const [vipVisible, setVipVisible] = useState(false)

  /* ---------- 已发布列表 ---------- */
  const [published, setPublished] = useState<PublishedItem[]>(loadPublish)
  const [openId, setOpenId] = useState<number | null>(null)

  const isPlaza = domain === 1
  const types: ContentType[] = isPlaza ? [10, 11] : [20, 22]
  const priceFen = Math.round((parseFloat(priceYuan) || 0) * 100)

  /* 切域：content_type 跟随切换（domain 路由一切） */
  const switchDomain = (d: Domain) => {
    if (d === domain) return
    setDomain(d)
    setContentType(d === 1 ? 10 : 20)
    setIndexFlag(false)
  }

  /* ---------- 构造落库预览（基表 content + 扩展表） ---------- */
  const buildPreview = (): PublishedItem | { error: string } => {
    if (!body.trim()) return { error: '正文不能为空' }
    if (!isPlaza && !title.trim()) return { error: '知识态内容标题必填（广场态 title 为 NULL）' }
    if (payPolicy === 1 && priceFen <= 0) return { error: '单买策略必须填写大于 0 的价格' }

    const id = Date.now()
    const now = new Date().toISOString()
    /* 金额一律存「分」整数（结算铁律）；广场态标题为 NULL、seo_slug 为 NULL */
    const base: Record<string, unknown> = {
      id,
      user_id: auth.userId, // 真实登录身份（本地未登录为 'local'）
      domain,
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
    /* 扩展表只存差异化字段 */
    const extTable = isPlaza ? 'content_ext_dynamic' : 'content_ext_article'
    const ext: Record<string, unknown> = isPlaza
      ? {
          content_id: id,
          topic_ids: splitList(topics),
          at_user_ids: splitList(atUsers, /[,，\s@]+/),
          visible_scope: visibleScope,
          media_ids: [], // 媒体上传未接入，不伪造 media_id
          is_vote: false,
          is_lottery: false,
          story_expire_at: null,
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
    const item = buildPreview()
    if ('error' in item) {
      toast(item.error)
      return
    }
    /* 轮 15 打通：按 domain/content_type 真发布进 store（触发成长引擎记分），落库预览保留作 JSON 展示 */
    if (isPlaza && (contentType === 10 || contentType === 11)) {
      /* 广场态：动态短文/图文 → publishPost 进 Feed（topic 取首个话题；媒体上传未接入，images 留空不伪造） */
      publishPost(body.trim(), { topic: splitList(topics)[0] ?? null, images: [] })
      toast(`已发布进广场动态流（${TYPE_META[contentType].name} · 记分 publish_dynamic）`)
    } else if (!isPlaza && contentType === 20) {
      /* 知识态博文 → publishArticle 进知识库（≥50 字触发 publish_article 质量记分） */
      publishArticle({ title: title.trim(), content: body, tags: splitList(tags) })
      toast('已发布进知识库（博文 · 记分 publish_article）')
    } else {
      /* 资源（22）暂无 store 创建路径：仅保留落库预览 */
      toast('资源类型暂无 store 创建路径：仅保留落库预览（后续轮次扩展）')
    }
    const next = [item, ...published]
    setPublished(next)
    try {
      localStorage.setItem(PUB_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
    setOpenId(item.id)
    setBody('')
    setTitle('')
  }

  const clearAll = () => {
    setPublished([])
    setOpenId(null)
    try {
      localStorage.removeItem(PUB_KEY)
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
            <code>domain</code> 是权限边界：所有分发/审核/计费都靠它路由
          </p>
        </header>

        {/* 域切换：一表两态（广场态 / 知识态） */}
        <div className="pb-domain" role="tablist" aria-label="发布域切换">
          <button
            type="button"
            role="tab"
            aria-selected={isPlaza}
            className={cx('pb-domain-btn', isPlaza && 'active')}
            onClick={() => switchDomain(1)}
          >
            🎬 广场态（domain=1）
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!isPlaza}
            className={cx('pb-domain-btn', !isPlaza && 'active')}
            onClick={() => switchDomain(2)}
          >
            📚 知识态（domain=2）
          </button>
        </div>

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

          {isPlaza ? (
            /* ---- 动态扩展字段 ---- */
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
              <label className="pb-field">
                <span>可见范围 visible_scope</span>
                <div className="pb-chips">
                  {VISIBLE_SCOPE.map((v) => (
                    <button
                      key={v.code}
                      type="button"
                      className={cx('pb-chip', visibleScope === v.code && 'active')}
                      onClick={() => setVisibleScope(v.code)}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </label>
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

          <button type="button" className="pb-submit" onClick={submit}>
            发布（构造落库预览 JSON）
          </button>
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

        {/* 红线声明 */}
        <p className="pb-warn">
          ⚠️ 权限边界红线（开发吧.md）：domain 天然是权限边界——知识态内容<b>绝不进广场 Feed</b>，
          广场动态<b>绝不进 RAG 索引</b>（index_flag 广场默认 0）；点赞/评论/收藏/审核全走 content_id，不写两套交互逻辑。
        </p>
      </div>
    </div>
  )
}
