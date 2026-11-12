// 统一搜索视图：一个输入框同时检索模块 / 入口 / 导航 / 社区 / 商品，结果按来源分组
import { useState } from 'react'; // 搜索词、来源页签与已提交查询的本地状态
import type { FormEvent, ReactNode } from 'react'; // 表单提交事件与高亮片段类型
import type { Locale } from '@mim/i18n'; // 界面语言
import { api, errorText } from '../api'; // 接口客户端与错误翻译
import type { SearchGroup, SearchHit, SearchScope } from '../api'; // 共享类型
import { baseOf } from '../router'; // 子路径部署时给站内地址补挂载前缀
import { useAsync } from '../hooks'; // 异步加载钩子

// 视图契约
interface Props {
  locale: Locale; // 当前界面语言
} // Props 结束

// 按语言取文案
function tr(locale: Locale, zh: string, en: string): string {
  return locale === 'en-US' ? en : zh; // 英文取英文，其余中文
} // tr 结束

// 来源页签：all 代表不过滤
type ScopeTab = SearchScope | 'all';

// 页签顺序与文案
const TABS: Array<{ value: ScopeTab; zh: string; en: string }> = [
  { value: 'all', zh: '全部', en: 'All' }, // 全部来源
  { value: 'module', zh: '功能模块', en: 'Modules' }, // 模块商城
  { value: 'entry', zh: '统一入口', en: 'Entries' }, // 入口清单
  { value: 'navigation', zh: '导航链接', en: 'Links' }, // 导航站
  { value: 'community', zh: '社区帖子', en: 'Community' }, // 论坛
  { value: 'shop', zh: '独立商城', en: 'Shop' }, // 商城
]; // TABS 结束

// 推荐关键词：首次进入没有查询时给用户一个起点
const SUGGESTIONS = ['商城', '漫剧', '部署', '会员', '开源']; // 与站内现有模块直接相关

// 站内地址补挂载前缀；http(s) 等外链原样返回
function resolveHref(href: string): string {
  if (!href) return '#'; // 无地址时不可点
  return href.startsWith('/') ? baseOf() + href.replace(/^\/+/, '') : href; // /path → /mim/path（根部署时 baseOf 为 /）
} // resolveHref 结束

// 关键词高亮：把命中文本拆成普通段与 <mark> 段，React 自动转义无需手工处理
function highlight(text: string, query: string) {
  if (!query) return text; // 无查询原样返回
  const lower = text.toLowerCase(); // 统一小写定位
  const q = query.toLowerCase(); // 查询同样小写
  const parts: ReactNode[] = []; // 片段收集
  let cursor = 0; // 当前读取位置
  let index = lower.indexOf(q, cursor); // 首次命中位置
  let key = 0; // React 列表 key
  while (index >= 0) { // 逐个命中点切分
    if (index > cursor) parts.push(text.slice(cursor, index)); // 命中前的普通文本
    parts.push(<mark key={key}>{text.slice(index, index + query.length)}</mark>); // 命中片段
    key += 1; // key 自增
    cursor = index + query.length; // 跳过命中片段
    index = lower.indexOf(q, cursor); // 继续找下一个
  } // while 结束
  if (cursor < text.length) parts.push(text.slice(cursor)); // 收尾普通文本
  return parts; // 返回片段数组
} // highlight 结束

// 单条命中卡片
function HitRow({ hit, query, locale }: { hit: SearchHit; query: string; locale: Locale }) {
  const external = /^https?:\/\//i.test(hit.href); // 外部链接新开标签
  return (
    <li className="deploy-row">
      <a className="link" href={resolveHref(hit.href)} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>
        {highlight(hit.title, query)}
      </a>
      <div className="muted">{highlight(hit.subtitle, query)}</div>
      <div className="deploy-kv">
        <span className={`deploy-badge ${hit.score >= 95 ? 'ok' : 'muted'}`}>{hit.score >= 95 ? tr(locale, '高匹配', 'Strong') : tr(locale, '相关', 'Related')}</span>
        <span>{highlight(hit.snippet, query)}</span>
      </div>
    </li>
  ); // 卡片结束
} // HitRow 结束

// 搜索主视图
export function Search({ locale }: Props) {
  const [keyword, setKeyword] = useState(''); // 输入框值
  const [applied, setApplied] = useState(''); // 已提交查询：与输入框分离，避免逐字请求
  const [scope, setScope] = useState<ScopeTab>('all'); // 来源页签

  // 来源规模：用于概览卡片与空态提示
  const summary = useAsync(() => api.search.summary(), []); // 首屏一次
  // 检索结果：未提交查询时不发请求
  const result = useAsync<{ total: number; engine: string; took_ms: number; groups: SearchGroup[] } | null>(
    () => (applied ? api.search.query({ q: applied, scope, limit: 8 }) : Promise.resolve(null)),
    [applied, scope],
  ); // useAsync 结束

  // 提交检索
  function submit(event: FormEvent) {
    event.preventDefault(); // 阻止表单默认跳转
    const value = keyword.trim(); // 去空白
    if (!value) return; // 空查询不发请求
    setApplied(value); // 落到已提交查询触发请求
  } // submit 结束

  // 点推荐词：同时写入输入框与已提交查询
  function pick(word: string) {
    setKeyword(word); // 同步输入框
    setApplied(word); // 立即检索
  } // pick 结束

  const groups: SearchGroup[] = result.data?.groups ?? []; // 结果兜底
  const total = result.data?.total ?? 0; // 总命中
  const engine = result.data?.engine ?? summary.data?.engine ?? 'sqlite'; // 当前引擎

  return (
    <div className="page">
      <header className="page-head">
        <h1>{tr(locale, '统一搜索', 'Search')}</h1>
        <p className="muted">
          {tr(locale, '一次输入同时检索功能模块、统一入口、导航链接、社区帖子与独立商城；配置 Meilisearch 时自动切换远端引擎，不可用时回退本地检索。', 'One query across modules, entries, navigation links, community threads and shop products. Meilisearch is used when configured, with automatic local fallback.')}
        </p>
      </header>

      <form className="form inline" onSubmit={submit}>
        <label className="grow">
          {tr(locale, '关键词', 'Keyword')}
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={tr(locale, '如：商城 / 漫剧 / 部署', 'e.g. marketplace / comic / deploy')} />
        </label>
        <button type="submit" className="btn primary">{tr(locale, '搜索', 'Search')}</button>
      </form>

      <div className="deploy-columns">
        {TABS.map((tab) => (
          <button key={tab.value} type="button" className={`btn ghost${scope === tab.value ? ' active' : ''}`} onClick={() => setScope(tab.value)}>
            {tr(locale, tab.zh, tab.en)}
          </button>
        ))}
      </div>

      <section className="panel">
        <div className="panel-head"><h3>{tr(locale, '可搜范围', 'Coverage')}</h3></div>
        <div className="deploy-stats">
          <div className="deploy-stat"><span className="deploy-stat-value">{summary.data?.total ?? '—'}</span><span className="muted">{tr(locale, '文档总数', 'Documents')}</span></div>
          {(summary.data?.scopes ?? []).map((item) => (
            <div className="deploy-stat" key={item.scope}>
              <span className="deploy-stat-value">{item.count}</span>
              <span className="muted">{tr(locale, item.label, item.scope)}</span>
            </div>
          ))}
          <div className="deploy-stat"><span className="deploy-stat-value">{engine === 'meilisearch' ? 'Meili' : 'SQLite'}</span><span className="muted">{tr(locale, '引擎', 'Engine')}</span></div>
        </div>
      </section>

      {!applied && (
        <section className="panel">
          <div className="panel-head"><h3>{tr(locale, '推荐搜索', 'Try searching')}</h3></div>
          <div className="deploy-columns">
            {SUGGESTIONS.map((word) => (
              <button key={word} type="button" className="btn ghost" onClick={() => pick(word)}>{word}</button>
            ))}
          </div>
        </section>
      )}

      {result.error ? <p className="error">{errorText(locale, result.error)}</p> : null}
      {result.loading ? <p className="hint">{tr(locale, '检索中…', 'Searching…')}</p> : null}

      {applied && !result.loading && total === 0 && (
        <p className="hint">{tr(locale, `没有找到「${applied}」相关内容。`, `No results for “${applied}”.`)}</p>
      )}

      {total > 0 && (
        <p className="muted">
          {tr(locale, `「${applied}」共 ${total} 条命中`, `${total} results for “${applied}”`)} · {result.data?.took_ms ?? 0} ms
        </p>
      )}

      {groups.map((group) => (
        <section className="panel" key={group.scope}>
          <div className="panel-head">
            <h3>{tr(locale, group.label, group.scope)} <span className="muted">({group.count})</span></h3>
          </div>
          <ul className="plain-list">
            {group.items.map((hit) => (
              <HitRow key={hit.id} hit={hit} query={applied} locale={locale} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  ); // 页面结束
} // Search 结束
