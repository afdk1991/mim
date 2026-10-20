import { useEffect, useMemo, useState } from 'react'
import './ai.css'
import { useToast } from './components'
import { cx, uid } from './utils'
import { pullToolState, pushToolState } from './lib/tool-cloud'

/* ============================================================
 * AI 可转载资源库 —— 重新开发自合并源码 ai-server-resources（可转载资源清单站）
 * 资源库（分类/许可筛选）/ 资源详情 / 转载合规自查 / 收藏与 Markdown 导出；资源链接均为真实可访问地址
 * 母本为纯静态多页站点，此处重实现为单页内视图切换；母本「精选 21 项与全量库数据割裂」
 * 的缺陷在此收敛为单一数据源，署名模板改为按许可等级自动生成。
 * ============================================================ */

type Level = 'g' | 'a' | 'r'
type View = 'lib' | 'detail' | 'comply' | 'favs'

interface CatDef {
  key: string
  emoji: string
  name: string
  desc: string
}

interface ResItem {
  id: string
  cat: string
  name: string
  type: string
  level: Level
  lic: string
  desc: string
  who: string
  link: { label: string; url: string }
}

interface CheckItem {
  id: string
  label: string
}

interface AiState {
  favs: string[]
  checks: string[]
  customChecks: CheckItem[]
  updatedAt: number
}

const STORAGE_KEY = 'mim-ai-v1'

/* ---------- 类目（母本 8 大类） ---------- */

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

/* ---------- 许可等级 ---------- */

const LEVELS: Record<Level, { emoji: string; label: string }> = {
  g: { emoji: '🟢', label: '宽松可商用' },
  a: { emoji: '🟡', label: '需署名 / 有限制' },
  r: { emoji: '🔴', label: '需授权 / 仅可引用' },
}

/* ---------- 资源种子数据（每类 2-3 项示例） ---------- */

const RESOURCES: ResItem[] = [
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

/* ---------- 转载合规自查（三步）与署名模板 ---------- */

const CHECK_STEPS: { key: string; title: string; hint: string; items: CheckItem[] }[] = [
  {
    key: 's1', title: 'STEP 01 · 确认许可类型', hint: '打开原文或仓库，先找到许可声明再动手',
    items: [
      { id: 's1-1', label: '找到原文页或仓库的 LICENSE / 版权声明' },
      { id: 's1-2', label: '判断许可家族：MIT / Apache / CC / 自定义 / 默认版权' },
      { id: 's1-3', label: '确认模型权重、代码、文档许可相互独立' },
    ],
  },
  {
    key: 's2', title: 'STEP 02 · 分清代码与文档', hint: '同一项目常有多套许可，不能互相推定',
    items: [
      { id: 's2-1', label: '代码、文档、权重、数据集分别核对' },
      { id: 's2-2', label: '排查商标与 Logo 的使用限制' },
      { id: 's2-3', label: '注意 CC BY-SA 相同方式共享与非商业限制' },
    ],
  },
  {
    key: 's3', title: 'STEP 03 · 按模板署名', hint: '署名齐全 + 注明改动，是合规转载的底线',
    items: [
      { id: 's3-1', label: '按许可选择对应署名模板' },
      { id: 's3-2', label: '保留作者、原文链接、许可名称与改动说明' },
      { id: 's3-3', label: '发布前复核原文最新的 LICENSE 状态' },
    ],
  },
]

const TEMPLATES: { name: string; text: string }[] = [
  { name: 'MIT / BSD 类宽松许可', text: '本文转载自「项目名称」（原文链接），Copyright © 年份 原作者，采用 MIT License 授权。\n改动说明：…' },
  { name: 'Apache-2.0', text: '本文转载自「项目名称」（原文链接），Copyright © 年份 原作者，采用 Apache License 2.0 授权，保留 NOTICE。\n改动说明：…' },
  { name: 'CC BY 4.0 / CC BY-SA 4.0', text: '「内容名称」由原作者发布于原文链接，采用 CC BY 4.0（或 CC BY-SA 4.0）授权；本文转载含改动，说明如下：…' },
  { name: '默认版权（仅引用）', text: '本文部分引用「内容名称」（原文链接），版权归原作者所有，引用仅作评论与说明之用；整篇转载或翻译需事先取得权利人书面授权。' },
]

/* ---------- 持久化 ---------- */

function seedState(): AiState {
  return { favs: ['A2', 'C1'], checks: ['s1-1', 's1-2'], customChecks: [], updatedAt: Date.now() }
}

function loadAi(): AiState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return seedState()
    const obj = JSON.parse(raw) as Partial<AiState> | null
    if (!obj || typeof obj !== 'object') return seedState()
    if (!Array.isArray(obj.favs) || !Array.isArray(obj.checks) || !Array.isArray(obj.customChecks)) return seedState()
    const favs = obj.favs.filter((x): x is string => typeof x === 'string' && RESOURCES.some((r) => r.id === x))
    const checks = obj.checks.filter((x): x is string => typeof x === 'string')
    const customChecks = obj.customChecks.filter(
      (x): x is CheckItem => !!x && typeof x === 'object' && typeof (x as CheckItem).id === 'string' && typeof (x as CheckItem).label === 'string',
    )
    return { favs, checks, customChecks, updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : 0 }
  } catch {
    return seedState()
  }
}

/* ---------- 工具 ---------- */

function copyText(text: string): boolean {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      void navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 走降级方案 */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

function attribution(r: ResItem): string {
  if (r.level === 'r') {
    return `本文部分引用「${r.name}」（${r.link.url}），版权归原作者所有，引用仅作评论与说明之用；整篇转载或翻译需事先取得权利人书面授权。\n改动说明：`
  }
  if (r.level === 'a') {
    return `「${r.name}」原文：${r.link.url}\n${r.lic}\n转载请署名并保留原文链接。\n改动说明：`
  }
  return `本文转载自「${r.name}」（${r.link.url}），采用原项目开源许可授权，保留原作者与出处。\n改动说明：内容有删节与标题调整。`
}

function buildMd(list: ResItem[]): string {
  const lines: string[] = ['# AI 可转载资源清单 · 导出', '', `> 导出于 ${new Date().toLocaleString()} ｜ 共 ${list.length} 项`, '']
  for (const c of CATEGORIES) {
    const rs = list.filter((r) => r.cat === c.key)
    if (!rs.length) continue
    lines.push(`## ${c.emoji} ${c.name}`, '')
    for (const r of rs) {
      const lv = LEVELS[r.level]
      lines.push(`### ${r.name}`, `- 类型：${r.type}`, `- 许可等级：${lv.emoji} ${lv.label}`, `- 许可说明：${r.lic}`, `- 主要内容：${r.desc}`, `- 来源：${r.link.label} ${r.link.url}`, '')
    }
  }
  return lines.join('\n')
}

/* ---------- 小组件（模块级定义，避免每渲染重建导致输入失焦） ---------- */

function LevelBadge({ lv }: { lv: Level }) {
  const m = LEVELS[lv]
  return (
    <span className={cx('ai-lv', 'ai-lv-' + lv)}>
      {m.emoji} {m.label}
    </span>
  )
}

function ResourceCard({ r, fav, onOpen, onFav }: { r: ResItem; fav: boolean; onOpen: (id: string) => void; onFav: (id: string) => void }) {
  return (
    <div className="card ai-res" onClick={() => onOpen(r.id)}>
      <div className="ai-res-head">
        <LevelBadge lv={r.level} />
        <span className="ai-res-name">{r.name}</span>
      </div>
      <div className="ai-res-meta">
        <span className="tag">{CAT_MAP[r.cat]?.name}</span>
        <span className="tag">{r.type}</span>
      </div>
      <p className="ai-res-desc">{r.desc}</p>
      <div className="ai-res-foot">
        <button
          className="btn btn-primary btn-sm"
          onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation()
            onOpen(r.id)
          }}
        >
          查看详情
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation()
            onFav(r.id)
          }}
        >
          {fav ? '💔 取消收藏' : '⭐ 收藏'}
        </button>
        <span className="ai-who">适合：{r.who}</span>
      </div>
    </div>
  )
}

interface ComplyProps {
  checks: string[]
  customChecks: CheckItem[]
  onToggle: (id: string) => void
  onAdd: (label: string) => void
  onRemove: (id: string) => void
  onCopyTpl: (text: string) => void
}

function ComplyView({ checks, customChecks, onToggle, onAdd, onRemove, onCopyTpl }: ComplyProps) {
  const [draft, setDraft] = useState('')
  const stepIds = CHECK_STEPS.reduce<string[]>((acc, s) => acc.concat(s.items.map((i) => i.id)), [])
  const allIds = stepIds.concat(customChecks.map((c) => c.id))
  const done = allIds.filter((id) => checks.includes(id)).length
  const pct = allIds.length ? Math.round((done / allIds.length) * 100) : 0

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const label = draft.trim()
    if (!label) return
    onAdd(label)
    setDraft('')
  }

  return (
    <div>
      <div className="card">
        <b>✅ 转载前三步自查</b>
        <span className="muted">　勾选完成项，全部完成后即可按模板署名</span>
        <div className="ai-progress">
          <div className="ai-progress-bar">
            <div className="ai-progress-fill" style={{ width: pct + '%' }} />
          </div>
          <span className="ai-progress-num">
            {done}/{allIds.length}
          </span>
        </div>
      </div>

      {CHECK_STEPS.map((step) => (
        <div className="card" key={step.key}>
          <div className="ai-step-no">{step.title}</div>
          <p className="muted" style={{ margin: '2px 0 6px', fontSize: 13 }}>
            {step.hint}
          </p>
          {step.items.map((it) => {
            const on = checks.includes(it.id)
            return (
              <label className={cx('ai-check-row', on && 'done')} key={it.id}>
                <input type="checkbox" checked={on} onChange={() => onToggle(it.id)} />
                <span>{it.label}</span>
              </label>
            )
          })}
        </div>
      ))}

      <div className="card">
        <div className="ai-step-no">附加 · 自定义自查项</div>
        {customChecks.map((c) => {
          const on = checks.includes(c.id)
          return (
            <div className="ai-custom-row" key={c.id}>
              <label className={cx('ai-check-row', on && 'done')}>
                <input type="checkbox" checked={on} onChange={() => onToggle(c.id)} />
                <span>{c.label}</span>
              </label>
              <button className="ai-x" title="删除" onClick={() => onRemove(c.id)}>
                ×
              </button>
            </div>
          )
        })}
        <form className="ai-add-row" onSubmit={submit}>
          <input
            className="input"
            value={draft}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
            placeholder="添加自定义自查项，回车或点「添加」…"
          />
          <button className="btn btn-primary btn-sm" type="submit" disabled={!draft.trim()}>
            添加
          </button>
        </form>
      </div>

      <div className="card">
        <b>📋 四套署名模板</b>
        {TEMPLATES.map((t) => (
          <div className="ai-tpl" key={t.name}>
            <div className="ai-tpl-head">
              <b>{t.name}</b>
              <button className="btn btn-ghost btn-sm" onClick={() => onCopyTpl(t.text)}>
                复制
              </button>
            </div>
            <div className="ai-tpl-text">{t.text}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

interface FavsProps {
  items: ResItem[]
  onOpen: (id: string) => void
  onFav: (id: string) => void
  onExport: () => void
  onGoLib: () => void
}

function FavsView({ items, onOpen, onFav, onExport, onGoLib }: FavsProps) {
  if (!items.length) {
    return (
      <div className="card">
        <div className="empty">
          <div className="empty-emoji">⭐</div>
          <p>还没有收藏，先去资源库挑几项吧</p>
          <button className="btn btn-primary btn-sm" onClick={onGoLib}>
            浏览资源库
          </button>
        </div>
      </div>
    )
  }
  return (
    <div>
      <div className="card ai-fav-head">
        <b>⭐ 我的收藏（{items.length}）</b>
        <button className="btn btn-ghost btn-sm" onClick={onExport}>
          📤 导出收藏 Markdown
        </button>
      </div>
      {items.map((r) => (
        <div className="card" key={r.id}>
          <div className="ai-fav-row">
            <LevelBadge lv={r.level} />
            <span className="ai-fav-name" onClick={() => onOpen(r.id)}>
              {r.name}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => onFav(r.id)}>
              移除
            </button>
          </div>
          <p className="ai-res-desc">{r.desc}</p>
        </div>
      ))}
    </div>
  )
}

/* ---------- 页面 ---------- */

export function AiResPage() {
  const toast = useToast()
  const [state, setState] = useState<AiState>(loadAi)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('lib')
  const [from, setFrom] = useState<View>('lib')
  const [selId, setSelId] = useState('')
  const [cat, setCat] = useState('all')
  const [level, setLevel] = useState<Level | 'all'>('all')

  useEffect(() => {
    const t = window.setTimeout(() => setLoading(false), 400)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* 忽略写入失败 */
    }
    pushToolState(STORAGE_KEY, state) // 云端整包快照（未登录/未配置时静默跳过）
  }, [state])

  /* 云端恢复（轮 6）：mount 拉取快照 → 写回本地 → 重载（幂等触发上方保存钩子回推） */
  useEffect(() => {
    void pullToolState(STORAGE_KEY).then((d) => {
      if (!d || typeof d !== 'object') return
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)) } catch { /* ignore */ }
      setState(loadAi())
    })
  }, [])

  const list = useMemo(
    () =>
      RESOURCES.filter(
        (r) => (cat === 'all' || r.cat === cat) && (level === 'all' || r.level === level),
      ),
    [cat, level],
  )

  const favList = useMemo(() => state.favs.map((id) => RESOURCES.find((r) => r.id === id)).filter((r): r is ResItem => !!r), [state.favs])

  const cntG = RESOURCES.filter((r) => r.level === 'g').length
  const cntA = RESOURCES.filter((r) => r.level === 'a').length
  const cntR = RESOURCES.filter((r) => r.level === 'r').length

  const openRes = (id: string, fromView: View) => {
    setFrom(fromView)
    setSelId(id)
    setView('detail')
  }

  const toggleFav = (id: string) => {
    const on = state.favs.includes(id)
    setState({ ...state, favs: on ? state.favs.filter((x) => x !== id) : [...state.favs, id] })
    toast(on ? '已取消收藏' : '❤️ 已加入收藏')
  }

  const toggleCheck = (id: string) => {
    const on = state.checks.includes(id)
    setState({ ...state, checks: on ? state.checks.filter((x) => x !== id) : [...state.checks, id] })
  }

  const addCustom = (label: string) => {
    setState({ ...state, customChecks: [...state.customChecks, { id: uid('ck'), label }] })
    toast('已添加自定义自查项')
  }

  const removeCustom = (id: string) => {
    setState({ ...state, customChecks: state.customChecks.filter((c) => c.id !== id), checks: state.checks.filter((x) => x !== id) })
    toast('已删除该自查项')
  }

  const copyTpl = (text: string) => {
    toast(copyText(text) ? '署名模板已复制 ✅' : '复制失败，请手动选择文本')
  }

  const copyAttr = (r: ResItem) => {
    toast(copyText(attribution(r)) ? '该资源的署名模板已复制 ✅' : '复制失败，请手动选择文本')
  }

  const exportMd = (items: ResItem[], scope: string) => {
    if (!items.length) {
      toast('当前没有可导出的资源')
      return
    }
    toast(copyText(buildMd(items)) ? `已导出「${scope}」${items.length} 项 Markdown 到剪贴板 ✅` : '导出失败，请重试')
  }

  const resetAll = () => {
    if (!window.confirm('重置收藏与自查进度？将恢复为初始样例。')) return
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    setState(seedState())
    setView('lib')
    setCat('all')
    setLevel('all')
    toast('♻️ 收藏与自查进度已重置')
  }

  const cur = RESOURCES.find((r) => r.id === selId)

  return (
    <div className="page-grid single">
      <div>
        <h2 className="page-title">📚 AI 可转载资源库</h2>
        <p className="muted" style={{ margin: '0 0 12px' }}>
          大模型与服务器技术领域的公开可转载资源索引 · 8 大类，逐项标注许可等级与署名方式
        </p>

        <div className="ai-actions">
          <button className={cx('btn btn-sm', view === 'lib' || view === 'detail' ? 'btn-primary' : 'btn-ghost')} onClick={() => setView('lib')}>
            📚 资源库
          </button>
          <button className={cx('btn btn-sm', view === 'comply' ? 'btn-primary' : 'btn-ghost')} onClick={() => setView('comply')}>
            ✅ 合规自查
          </button>
          <button className={cx('btn btn-sm', view === 'favs' ? 'btn-primary' : 'btn-ghost')} onClick={() => setView('favs')}>
            ⭐ 收藏{state.favs.length ? ` ${state.favs.length}` : ''}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => exportMd(list, '当前筛选结果')}>
            📤 导出
          </button>
          <button className="btn btn-ghost btn-sm" onClick={resetAll}>
            ♻️ 重置进度
          </button>
        </div>

        {loading ? (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              ⏳ 正在加载资源库…
            </p>
          </div>
        ) : view === 'detail' && cur ? (
          <div>
            <button className="btn btn-ghost btn-sm" onClick={() => setView(from)}>
              ← 返回{from === 'favs' ? '收藏' : '资源库'}
            </button>
            <div className="card">
              <h3 className="ai-detail-title">{cur.name}</h3>
              <div className="ai-res-meta">
                <LevelBadge lv={cur.level} />
                <span className="tag">{CAT_MAP[cur.cat]?.name}</span>
                <span className="tag">{cur.type}</span>
              </div>
              <p className="ai-section-label">LICENSE / 版权说明</p>
              <div className="ai-note">{cur.lic}</div>
              <p className="ai-section-label">主要内容</p>
              <p className="ai-p">{cur.desc}</p>
              <p className="ai-section-label">适合人群</p>
              <p className="ai-p">{cur.who}</p>
              <p className="ai-section-label">获取渠道</p>
              <p className="ai-p">
                <a className="ai-link" href={cur.link.url} target="_blank" rel="noreferrer">
                  🔗 {cur.link.label}
                </a>
              </p>
              <div className="ai-res-foot">
                <button className={cx('btn', state.favs.includes(cur.id) ? 'btn-ghost' : 'btn-primary')} onClick={() => toggleFav(cur.id)}>
                  {state.favs.includes(cur.id) ? '💔 取消收藏' : '⭐ 加入收藏'}
                </button>
                <button className="btn btn-ghost" onClick={() => copyAttr(cur)}>
                  📋 复制署名模板
                </button>
              </div>
            </div>
          </div>
        ) : view === 'comply' ? (
          <ComplyView
            checks={state.checks}
            customChecks={state.customChecks}
            onToggle={toggleCheck}
            onAdd={addCustom}
            onRemove={removeCustom}
            onCopyTpl={copyTpl}
          />
        ) : view === 'favs' ? (
          <FavsView
            items={favList}
            onOpen={(id) => openRes(id, 'favs')}
            onFav={toggleFav}
            onExport={() => exportMd(favList, '我的收藏')}
            onGoLib={() => setView('lib')}
          />
        ) : (
          <div>
            <div className="card ai-stats">
              <div className="ai-stat">
                <b>{RESOURCES.length}</b>
                <span>项资源</span>
              </div>
              <div className="ai-stat">
                <b>{CATEGORIES.length}</b>
                <span>大类目</span>
              </div>
              <div className="ai-stat">
                <b>{cntG}</b>
                <span>🟢 宽松</span>
              </div>
              <div className="ai-stat">
                <b>{cntA}</b>
                <span>🟡 需署名</span>
              </div>
              <div className="ai-stat">
                <b>{cntR}</b>
                <span>🔴 需授权</span>
              </div>
            </div>

            <div className="card ai-toolbar">
              <div className="ai-chips">
                {['all'].concat(CATEGORIES.map((c) => c.key)).map((key) => (
                  <button className={cx('ai-chip', cat === key && 'on')} key={key} onClick={() => setCat(key)}>
                    {key === 'all' ? '全部类目' : `${CAT_MAP[key].emoji} ${CAT_MAP[key].name}`}
                  </button>
                ))}
              </div>
              <div className="ai-chips">
                {([['all', '全部等级'], ['g', '🟢 宽松可商用'], ['a', '🟡 需署名'], ['r', '🔴 需授权']] as const).map(([key, label]) => (
                  <button className={cx('ai-chip', level === key && 'on')} key={key} onClick={() => setLevel(key)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {list.length ? (
              list.map((r) => <ResourceCard key={r.id} r={r} fav={state.favs.includes(r.id)} onOpen={(id) => openRes(id, 'lib')} onFav={toggleFav} />)
            ) : (
              <div className="card">
                <div className="empty">
                  <div className="empty-emoji">🔍</div>
                  <p>当前筛选条件下没有资源</p>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setCat('all')
                      setLevel('all')
                    }}
                  >
                    清空筛选
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
