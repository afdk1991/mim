/* ==========================================================================
 * AI 可转载资源库 —— 分类浏览 / 许可筛选 / 资源详情 / 转载合规自查 / 收藏导出
 *
 * 数据：本页内置真实公开资源目录（逐项附可验证许可说明与官方链接），
 *      与 domain/tools 的 AiResource 一一对应；收藏与自查进度存本机快照 'tools.aires'。
 *
 * 合规设计：署名模板按许可等级自动生成（domain 的 AI_LEVEL_META 是唯一等级真源），
 *      不再像母本那样「精选清单与全量库两套数据」，删/改一处即可全站生效。
 * ======================================================================== */

import { useEffect, useMemo, useState } from 'react'
import { AI_LEVEL_META } from '@/domain/tools/model'
import type { AiLevel, AiResource, AiState } from '@/domain/tools/model'
import { loadSnapshot, saveSnapshot } from '@/data/sync'
import { cx } from '@/core/utils'
import { Badge, Empty, Modal, Tag, useToast } from '@/ui'

const SCOPE = 'tools.aires'

type View = 'lib' | 'detail' | 'comply' | 'favs'
type LevelFilter = AiLevel | 'all'

interface CatDef {
  key: string
  emoji: string
  name: string
  desc: string
}

const CATEGORIES: CatDef[] = [
  { key: 'A', emoji: '🧠', name: '大模型原理与算法', desc: '课程讲义、可视化教程与奠基性论文' },
  { key: 'B', emoji: '🔥', name: '训练与微调工具', desc: '预训练、LoRA/QLoRA 微调与实验管理工具链' },
  { key: 'C', emoji: '🚀', name: '推理部署与优化', desc: '推理引擎、量化与服务化框架' },
  { key: 'D', emoji: '🖥️', name: '服务器硬件与运维', desc: 'Linux 系统、内核文档与集群运维知识库' },
  { key: 'E', emoji: '🌐', name: '计算机网络与存储', desc: 'RFC 标准、数据库与存储官方文档' },
  { key: 'F', emoji: '📊', name: '数据集与评测基准', desc: '预训练语料、指令数据集与公开基准' },
  { key: 'G', emoji: '🎨', name: '配图 / 图标 / 字体素材', desc: '高自由度的转载配图与排版素材' },
  { key: 'H', emoji: '⚠️', name: '中文内容与社区（转载风险区）', desc: '传播价值高但许可最容易被忽略' },
]

const CAT_MAP: Record<string, CatDef> = {}
for (const c of CATEGORIES) CAT_MAP[c.key] = c

const LEVEL_FILTERS: Array<{ key: LevelFilter; label: string }> = [
  { key: 'all', label: '全部许可' },
  { key: 'g', label: AI_LEVEL_META.g.label },
  { key: 'a', label: AI_LEVEL_META.a.label },
  { key: 'r', label: AI_LEVEL_META.r.label },
]

const CHECK_STEPS: Array<{ title: string; hint: string; items: Array<{ id: string; label: string }> }> = [
  {
    title: 'STEP 01 · 确认许可类型',
    hint: '打开原文或仓库，先找到许可声明再动手',
    items: [
      { id: 's1-1', label: '找到原文页或仓库的 LICENSE / 版权声明' },
      { id: 's1-2', label: '判断许可家族：MIT / Apache / CC / 自定义 / 默认版权' },
      { id: 's1-3', label: '确认模型权重、代码、文档许可相互独立' },
    ],
  },
  {
    title: 'STEP 02 · 分清代码与文档',
    hint: '同一项目常有多套许可，不能互相推定',
    items: [
      { id: 's2-1', label: '代码、文档、权重、数据集分别核对' },
      { id: 's2-2', label: '排查商标与 Logo 的使用限制' },
      { id: 's2-3', label: '注意 CC BY-SA 相同方式共享与非商业限制' },
    ],
  },
  {
    title: 'STEP 03 · 按模板署名',
    hint: '署名齐全 + 注明改动，是合规转载的底线',
    items: [
      { id: 's3-1', label: '按许可选择对应署名模板' },
      { id: 's3-2', label: '保留作者、原文链接、许可名称与改动说明' },
      { id: 's3-3', label: '发布前复核原文最新的 LICENSE 状态' },
    ],
  },
]

const STEP_IDS: string[] = CHECK_STEPS.flatMap((s) => s.items.map((i) => i.id))

/** 署名模板按等级生成：限制越多，措辞越保守（保持与 LINE aca_level 语义一致） */
function attributionOf(r: AiResource): string {
  if (r.level === 'r') {
    return `本文部分引用「${r.name}」（${r.link.url}），版权归原作者所有，引用仅作评论与说明之用；整篇转载或翻译需事先取得权利人书面授权。\n改动说明：`
  }
  if (r.level === 'a') {
    return `「${r.name}」原文：${r.link.url}\n${r.lic}\n转载请署名并保留原文链接。\n改动说明：`
  }
  return `本文转载自「${r.name}」（${r.link.url}），采用原项目开源许可授权，保留原作者与出处。\n改动说明：内容有删节与标题调整。`
}

function buildMarkdown(list: AiResource[]): string {
  const lines: string[] = ['# AI 可转载资源清单 · 导出', '', `> 导出于 ${new Date().toLocaleString()} ｜ 共 ${list.length} 项`, '']
  for (const c of CATEGORIES) {
    const rs = list.filter((r) => r.cat === c.key)
    if (rs.length === 0) continue
    lines.push(`## ${c.emoji} ${c.name}`, '')
    for (const r of rs) {
      lines.push(
        `### ${r.name}`,
        `- 类型：${r.type}`,
        `- 许可等级：${AI_LEVEL_META[r.level].label}`,
        `- 许可说明：${r.lic}`,
        `- 主要内容：${r.desc}`,
        `- 来源：${r.link.label} ${r.link.url}`,
        '',
      )
    }
  }
  return lines.join('\n')
}

function downloadMarkdown(name: string, text: string): void {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/* ---------- 资源库数据 ---------- */

const RESOURCES: AiResource[] = [
  {
    id: 'A1', cat: 'A', name: 'Stanford CS336: Language Modeling from Scratch',
    type: '大学课程（课件+作业+录像）', level: 'a',
    lic: '课件/作业版权归 Stanford，公开可下载；引用需注明来源，整篇转载或本地化翻译建议先联系课程组。',
    desc: '从零构建语言模型：tokenizer、Transformer 架构、训练系统、Scaling Law、数据清洗去重，到 SFT 与 RL 对齐。',
    who: '有 PyTorch 与系统优化基础的工程师、研究者',
    link: { label: '课程主页', url: 'https://cs336.stanford.edu/' },
  },
  {
    id: 'A2', cat: 'A', name: 'Harvard NLP《The Annotated Transformer》',
    type: '教程 + 可执行代码', level: 'g',
    lic: '代码仓库 MIT，保留 LICENSE 即可自由使用与改写；网页版文章多以 CC BY-SA 流通，建议引用观点与代码片段并保留原文链接。',
    desc: '逐行注释复现《Attention Is All You Need》，把论文公式与 PyTorch 实现一一对应。',
    who: '需要读懂并改造 Transformer 实现的工程师',
    link: { label: '在线版', url: 'https://nlp.seas.harvard.edu/annotated-transformer/' },
  },
  {
    id: 'A3', cat: 'A', name: 'Attention Is All You Need（arXiv:1706.03762）',
    type: '奠基论文', level: 'r',
    lic: 'arXiv 默认许可：版权归作者，全文转载/翻译需作者授权；摘要与元数据为 CC0。',
    desc: '提出 Transformer 与多头自注意力，取代 RNN/CNN 成为主流架构，是现代大模型的原点。',
    who: '所有从事大模型相关工作的人',
    link: { label: 'arXiv', url: 'https://arxiv.org/abs/1706.03762' },
  },
  {
    id: 'B1', cat: 'B', name: 'Hugging Face Transformers + PEFT',
    type: '开源库 + 模型社区', level: 'g',
    lic: '代码 Apache-2.0 宽松可商用；模型权重按仓库各自授权，须与代码许可分开核对。',
    desc: '主流开源模型训练、微调与推理的一站式库；PEFT 提供 LoRA/QLoRA 等高效微调路线。',
    who: '做训练与微调的算法工程师',
    link: { label: 'GitHub', url: 'https://github.com/huggingface/transformers' },
  },
  {
    id: 'B2', cat: 'B', name: 'PyTorch',
    type: '深度学习框架', level: 'g',
    lic: 'BSD-3-Clause，宽松可商用；官方教程文档的转载另有署名要求。',
    desc: '训练侧主流框架，官方生态覆盖分布式训练、混合精度与编译优化。',
    who: '所有训练方向的工程师',
    link: { label: '官网', url: 'https://pytorch.org/' },
  },
  {
    id: 'C1', cat: 'C', name: 'vLLM',
    type: '推理引擎', level: 'g',
    lic: '代码 Apache-2.0；关联的 PagedAttention 论文转载需另行授权。',
    desc: '用虚拟内存分页思想管理 KV Cache，配合连续批处理大幅提升吞吐，是推理引擎的事实标准方案。',
    who: '负责推理服务成本与吞吐的工程师',
    link: { label: 'GitHub', url: 'https://github.com/vllm-project/vllm' },
  },
  {
    id: 'C2', cat: 'C', name: 'llama.cpp',
    type: '本地/边缘推理运行时', level: 'g',
    lic: '代码 MIT；GGUF 模型文件按各模型自身许可独立核对。',
    desc: '纯 C/C++ 实现的量化模型推理，CPU 与消费级显卡均可运行，适合本地与边缘部署。',
    who: '本地部署与端侧玩家',
    link: { label: 'GitHub', url: 'https://github.com/ggml-org/llama.cpp' },
  },
  {
    id: 'D1', cat: 'D', name: 'Arch Wiki',
    type: '系统管理百科', level: 'a',
    lic: '文本 CC BY-SA 4.0 / GFDL 双许可：转载须署名且相同方式共享，以页面声明为准。',
    desc: '最详尽的 Linux 系统管理实战知识库，覆盖 systemd、网络、存储与性能调优。',
    who: '服务器与桌面 Linux 运维',
    link: { label: 'ArchWiki', url: 'https://wiki.archlinux.org/' },
  },
  {
    id: 'D2', cat: 'D', name: 'Linux 内核官方文档',
    type: '内核文档', level: 'a',
    lic: '内核文档按 GPL-2.0 变体声明流转；建议引用片段并注明出处，整篇转载需谨慎。',
    desc: '内核子系统权威文档：sysctl、cgroups、调度器与内存管理。',
    who: '底层系统工程师与运维排障',
    link: { label: 'kernel.org', url: 'https://docs.kernel.org/' },
  },
  {
    id: 'E1', cat: 'E', name: 'RFC 9110《HTTP Semantics》',
    type: 'IETF 标准', level: 'a',
    lic: 'IETF 许可允许注明出处转载引用；标准正文不得修改。',
    desc: 'HTTP 语义的现行标准：方法、状态码、内容协商与鉴权框架。',
    who: '后端与网关 / API 开发者',
    link: { label: 'IETF', url: 'https://www.rfc-editor.org/rfc/rfc9110' },
  },
  {
    id: 'E2', cat: 'E', name: 'PostgreSQL 官方文档',
    type: '数据库文档', level: 'g',
    lic: 'PostgreSQL License（BSD 类），宽松可商用；转载保留版权声明即可。',
    desc: 'SQL 语法、索引原理、复制与性能调优的权威文档，并有社区中文译本。',
    who: 'DBA 与后端开发者',
    link: { label: '官方文档', url: 'https://www.postgresql.org/docs/' },
  },
  {
    id: 'F1', cat: 'F', name: 'Common Crawl',
    type: '网页抓取语料', level: 'a',
    lic: '语料本身公开，但页面内容版权仍归原权利人，商用前需单独评估。',
    desc: 'PB 级公开网页抓取语料，常见预训练数据来源，需自行清洗与去重。',
    who: '预训练数据工程师',
    link: { label: '官网', url: 'https://commoncrawl.org/' },
  },
  {
    id: 'F2', cat: 'F', name: 'The Pile',
    type: '学术文本语料', level: 'a',
    lic: '代码 MIT；数据为多来源混合许可，含风险子集，使用前逐项阅读声明页。',
    desc: '面向 GPT-3 式研究的 825GB 英文语料，各子集来源与许可有明确说明。',
    who: '复现小规模预训练的研究者',
    link: { label: 'GitHub', url: 'https://github.com/EleutherAI/the-pile' },
  },
  {
    id: 'G1', cat: 'G', name: 'Google Fonts',
    type: '字体素材库', level: 'g',
    lic: '绝大多数字体为 SIL OFL / Apache，宽松可商用；个别字族许可单独查看。',
    desc: '开放字体库，覆盖中文字族，可自托管，转载与内嵌合规简单。',
    who: '技术媒体配图与排版',
    link: { label: '官网', url: 'https://fonts.google.com/' },
  },
  {
    id: 'G2', cat: 'G', name: 'OpenMoji',
    type: '开放图标集', level: 'g',
    lic: '图形 CC BY-SA 4.0（署名+相同方式共享）；代码部分 AGPL-3.0。',
    desc: '3800+ 开放 emoji 与图标，彩色/黑白两版，适合转载文章配图。',
    who: '文章配图与 PPT 插图',
    link: { label: '官网', url: 'https://openmoji.org/' },
  },
  {
    id: 'H1', cat: 'H', name: 'MDN Web Docs（中文）',
    type: 'Web 技术文档', level: 'a',
    lic: '正文 CC BY-SA 2.5，代码示例 CC0；转载需分别处理署名与相同方式共享。',
    desc: 'Web 技术最权威参考，中文站为社区翻译，条目质量与时效参差。',
    who: '前端工程师',
    link: { label: 'MDN', url: 'https://developer.mozilla.org/zh-CN/' },
  },
  {
    id: 'H2', cat: 'H', name: '掘金 / 知乎技术专栏',
    type: '社区文章', level: 'r',
    lic: '默认版权归原作者所有，整篇转载或翻译需取得作者书面授权。',
    desc: '中文技术内容最活跃的传播区，转载风险最高，务必逐项向作者确认。',
    who: '中文内容运营者',
    link: { label: '掘金', url: 'https://juejin.cn/' },
  },
]

const RESOURCE_MAP: Record<string, AiResource> = {}
for (const r of RESOURCES) RESOURCE_MAP[r.id] = r

/* ---------- 持久化 ---------- */

const EMPTY_STATE: AiState = { favs: [], checks: [], updatedAt: 0 }

function parseState(raw: unknown): AiState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  return {
    // 资源可能已从目录移除，失效收藏直接剔除，避免出现打不开的条目
    favs: strList(r.favs).filter((id) => id in RESOURCE_MAP),
    checks: strList(r.checks).filter((id) => STEP_IDS.includes(id)),
    updatedAt: typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : 0,
  }
}

export function AiResPage() {
  const toast = useToast()
  const [state, setState] = useState<AiState>(() => loadSnapshot(SCOPE, parseState, EMPTY_STATE))
  const [view, setView] = useState<View>('lib')
  const [cat, setCat] = useState<string>('all')
  const [level, setLevel] = useState<LevelFilter>('all')
  const [keyword, setKeyword] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    saveSnapshot(SCOPE, state)
  }, [state])

  const list = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return RESOURCES.filter((r) => {
      if (cat !== 'all' && r.cat !== cat) return false
      if (level !== 'all' && r.level !== level) return false
      if (kw && !`${r.name}${r.desc}${r.type}`.toLowerCase().includes(kw)) return false
      return true
    })
  }, [cat, level, keyword])

  const favorites = state.favs.map((id) => RESOURCE_MAP[id]).filter((r): r is AiResource => !!r)
  const shown = view === 'favs' ? favorites : list
  const open = openId ? (RESOURCE_MAP[openId] ?? null) : null

  const toggleFav = (id: string): void => {
    setState((prev) => ({
      ...prev,
      favs: prev.favs.includes(id) ? prev.favs.filter((x) => x !== id) : [...prev.favs, id],
      updatedAt: Date.now(),
    }))
  }

  const toggleCheck = (id: string): void => {
    setState((prev) => ({
      ...prev,
      checks: prev.checks.includes(id) ? prev.checks.filter((x) => x !== id) : [...prev.checks, id],
      updatedAt: Date.now(),
    }))
  }

  const copy = async (text: string, tip: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      toast(tip)
    } catch {
      toast('浏览器拒绝了剪贴板访问，请手动选中复制')
    }
  }

  const checkedCount = STEP_IDS.filter((id) => state.checks.includes(id)).length
  const pct = STEP_IDS.length > 0 ? Math.round((checkedCount / STEP_IDS.length) * 100) : 0

  return (
    <div className="page">
      <h1 className="page-title">🤖 AI 可转载资源库 <span className="tag">{RESOURCES.length} 项</span></h1>

      <div className="tabs">
        <button className={cx('tab-btn', view !== 'comply' && 'active')} onClick={() => setView('lib')}>
          📚 资源库
        </button>
        <button className={cx('tab-btn', view === 'comply' && 'active')} onClick={() => setView('comply')}>
          ✅ 转载合规自查（{pct}%）
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => downloadMarkdown('AI资源清单.md', buildMarkdown(list.length > 0 ? list : RESOURCES))}>
          ⬇ 导出 Markdown
        </button>
      </div>

      {view === 'comply' ? (
        <>
          <div className="card">
            <b>✅ 转载前三步自查</b>
            <span className="muted" style={{ marginLeft: 8 }}>全部勾选完成后即可按模板署名</span>
            <div className="vote-bar" style={{ marginTop: 8 }}>
              <i style={{ width: `${pct}%` }} />
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {checkedCount}/{STEP_IDS.length} 项
            </div>
          </div>

          {CHECK_STEPS.map((step) => (
            <div className="card" key={step.title}>
              <b>{step.title}</b>
              <p className="muted" style={{ margin: '2px 0 6px', fontSize: 13 }}>{step.hint}</p>
              {step.items.map((it) => (
                <label key={it.id} className="row" style={{ gap: 6 }}>
                  <input type="checkbox" checked={state.checks.includes(it.id)} onChange={() => toggleCheck(it.id)} />
                  <span style={{ color: state.checks.includes(it.id) ? 'var(--text-3)' : undefined }}>{it.label}</span>
                </label>
              ))}
            </div>
          ))}

          <div className="card">
            <b>署名模板（按许可等级自动生成）</b>
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              打开任一资源 → 详情内的「复制署名模板」，内容由该资源的许可等级
              （{AI_LEVEL_META.g.label} / {AI_LEVEL_META.a.label} / {AI_LEVEL_META.r.label}）生成。
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="chip-row" style={{ marginBottom: 8 }}>
            <button className={cx('chip', cat === 'all' && 'active')} onClick={() => setCat('all')}>全部分类</button>
            {CATEGORIES.map((c) => (
              <button key={c.key} className={cx('chip', cat === c.key && 'active')} onClick={() => setCat(c.key)}>
                {c.emoji} {c.name}
              </button>
            ))}
          </div>
          <div className="row wrap" style={{ marginBottom: 12 }}>
            <div className="chip-row">
              {LEVEL_FILTERS.map((f) => (
                <button key={f.key} className={cx('chip', level === f.key && 'active')} onClick={() => setLevel(f.key)}>
                  {f.label}
                </button>
              ))}
            </div>
            <span className="grow" />
            <input
              className="input"
              style={{ maxWidth: 220 }}
              placeholder="搜索名称 / 类型 / 简介"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <button className={cx('btn btn-sm', view === 'favs' ? 'btn-primary' : 'btn-ghost')} onClick={() => setView(view === 'favs' ? 'lib' : 'favs')}>
              ⭐ 只看收藏（{favorites.length}）
            </button>
          </div>

          {shown.length === 0 ? (
            <Empty
              emoji="📭"
              text={view === 'favs' ? '还没有收藏任何资源，点卡片上的 ⭐ 收藏' : '没有符合条件的资源，换个分类或关键词试试'}
            />
          ) : (
            shown.map((r) => (
              <div key={r.id} className="card" role="button" tabIndex={0} onClick={() => setOpenId(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(r.id) }}>
                <div className="row wrap">
                  <Badge cls={AI_LEVEL_META[r.level].cls}>{AI_LEVEL_META[r.level].label}</Badge>
                  <b>{r.name}</b>
                  <span className="grow" />
                </div>
                <div className="row wrap" style={{ marginTop: 6 }}>
                  <Tag>{CAT_MAP[r.cat]?.name ?? r.cat}</Tag>
                  <Tag>{r.type}</Tag>
                </div>
                <p className="dim" style={{ margin: '8px 0 0' }}>{r.desc}</p>
                <div className="row wrap" style={{ marginTop: 8 }}>
                  <small className="muted">适合：{r.who}</small>
                  <span className="grow" />
                  <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); toggleFav(r.id) }}>
                    {state.favs.includes(r.id) ? '💔 取消收藏' : '⭐ 收藏'}
                  </button>
                  <a className="btn btn-ghost btn-sm" href={r.link.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                    {r.link.label} ↗
                  </a>
                </div>
              </div>
            ))
          )}
        </>
      )}

      {open ? (
        <Modal title={open.name} onClose={() => setOpenId(null)}>
          <div className="col">
            <div className="row wrap">
              <Badge cls={AI_LEVEL_META[open.level].cls}>{AI_LEVEL_META[open.level].label}</Badge>
              <Tag>{CAT_MAP[open.cat]?.name ?? open.cat}</Tag>
              <Tag>{open.type}</Tag>
            </div>
            <p style={{ margin: 0 }}>{open.desc}</p>
            <div>
              <b style={{ fontSize: 13 }}>许可说明</b>
              <p className="dim" style={{ margin: '4px 0 0', fontSize: 13 }}>{open.lic}</p>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>适合人群：{open.who}</div>
            <div className="row wrap">
              <a className="btn btn-primary btn-sm" href={open.link.url} target="_blank" rel="noreferrer">
                {open.link.label} ↗
              </a>
              <button className="btn btn-ghost btn-sm" onClick={() => toggleFav(open.id)}>
                {state.favs.includes(open.id) ? '💔 取消收藏' : '⭐ 收藏'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => void copy(attributionOf(open), '署名模板已复制')}>
                复制署名模板
              </button>
            </div>
            <div>
              <b style={{ fontSize: 13 }}>署名模板预览</b>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: '4px 0 0' }} className="dim">
                {attributionOf(open)}
              </pre>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
