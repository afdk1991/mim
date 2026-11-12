// 导航站视图：全站资源目录 + 三态可达性 + 分组检索 + 推荐位 + 收录入口
import { useState } from 'react'; // 表单与筛选的本地状态
import type { FormEvent } from 'react'; // 表单提交事件类型
import type { Locale } from '@mim/i18n'; // 语言类型
// 接口客户端与错误文案翻译器
import { api, errorText } from '../api';
// 共享类型：单条链接与三态
import type { NavLink, NavStatus } from '../api';
// 通用异步加载钩子：统一 loading / error / reload
import { useAsync } from '../hooks';

// 视图契约：文案跟随全局语言
interface Props {
  // 当前界面语言
  locale: Locale;
} // Props 结束

// 按语言取文案
function tr(locale: Locale, zh: string, en: string): string {
  return locale === 'en-US' ? en : zh; // 英文取英文，其余中文
} // tr 结束

// 三态 → 徽标样式与文案；未探测不冒充可达
const STATUS_META: Record<NavStatus, { cls: string; zh: string; en: string }> = {
  ok: { cls: 'ok', zh: '✅ 可达', en: '✅ Reachable' },
  broken: { cls: 'fail', zh: '🔴 失效', en: '🔴 Broken' },
  unknown: { cls: 'muted', zh: '⚪ 未探测', en: '⚪ Untested' },
}; // STATUS_META 结束

// 时间显示：取到分钟即可，避免表格被长 ISO 串撑开
function shortTime(value: string | null): string {
  if (!value) return '—'; // 未探测
  return value.replace('T', ' ').slice(0, 16); // ISO → YYYY-MM-DD HH:mm
} // shortTime 结束

// 状态徽标
function StatusBadge({ status, locale }: { status: NavStatus; locale: Locale }) {
  const meta = STATUS_META[status]; // 三态固定存在，无需兜底
  return <span className={`deploy-badge ${meta.cls}`}>{tr(locale, meta.zh, meta.en)}</span>; // 徽标
} // StatusBadge 结束

// 导航站主视图
export function Navigation({ locale }: Props) {
  // 已提交关键词（与输入框分离，避免每敲一个字就请求）
  const [applied, setApplied] = useState('');
  // 输入框值
  const [keyword, setKeyword] = useState('');
  // 分组筛选，空串表示全部
  const [group, setGroup] = useState('');
  // 新建表单字段
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [description, setDescription] = useState('');
  const [recommended, setRecommended] = useState(false);
  // 忙碌标记：区分批量检测 / 单条检测 / 新建 / 推荐位切换，避免整页卡住
  const [busy, setBusy] = useState<string | null>(null);
  // 操作反馈
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 目录：筛选变化即重新拉取（响应内同时带汇总）
  const list = useAsync(() => api.navigation.links({ q: applied || undefined, group: group || undefined }), [applied, group]);
  // 条目与汇总的兜底值
  const items: NavLink[] = list.data?.items ?? [];
  const summary = list.data?.summary;

  // 提交检索
  function submitSearch(event: FormEvent) {
    event.preventDefault(); // 阻止表单默认跳转
    setApplied(keyword.trim()); // 落到已提交关键词触发请求
  } // submitSearch 结束

  // 新建入口：收录一条链接（写操作由 request 自动带幂等键与访客令牌）
  async function createLink(event: FormEvent) {
    event.preventDefault(); // 阻止默认提交
    if (!name.trim() || !url.trim()) { // 必填校验
      setError(tr(locale, '名称与地址必填。', 'Name and URL are required.'));
      return; // 提前返回
    } // 校验结束
    setBusy('create'); // 标记新建中
    setError(null); // 清旧错误
    setMessage(null); // 清旧提示
    try {
      await api.navigation.create({ // 调用收录接口
        name: name.trim(), // 名称
        url: url.trim(), // 地址（http(s) 或站内 / 开头）
        group: newGroup.trim() || undefined, // 分组，空则后端落「其他」
        description: description.trim() || undefined, // 说明选填
        recommended, // 推荐位
      });
      setName(''); setUrl(''); setNewGroup(''); setDescription(''); setRecommended(false); // 成功后清空，便于连续录入
      setMessage(tr(locale, '已收录 ✓', 'Link added ✓')); // 成功提示
      list.reload(); // 刷新目录
    } catch (err) {
      setError(errorText(locale, err)); // 统一错误文案
    } finally {
      setBusy(null); // 释放忙碌标记
    } // try 结束
  } // createLink 结束

  // 全目录探测：服务端逐条 GET，回写状态与耗时
  async function checkAll() {
    setBusy('all'); // 标记批量探测
    setError(null); // 清旧错误
    setMessage(null); // 清旧提示
    try {
      const result = await api.navigation.checkAll(); // 触发探测
      setMessage(tr(locale, `已探测 ${result.checked} 条：可达 ${result.summary.ok} / 失效 ${result.summary.broken}`, `Checked ${result.checked}: ${result.summary.ok} reachable / ${result.summary.broken} broken`)); // 结果提示
      list.reload(); // 刷新列表
    } catch (err) {
      setError(errorText(locale, err)); // 错误文案
    } finally {
      setBusy(null); // 释放
    } // try 结束
  } // checkAll 结束

  // 单条探测
  async function checkOne(id: string) {
    setBusy(`check:${id}`); // 按主键标记，避免与其它操作互斥
    setError(null); // 清旧错误
    try {
      const result = await api.navigation.check(id); // 探测并回写
      setMessage(tr(locale, `已探测：${result.item.name} → ${STATUS_META[result.item.status].zh}`, `Checked: ${result.item.name} → ${STATUS_META[result.item.status].en}`)); // 提示
      list.reload(); // 刷新
    } catch (err) {
      setError(errorText(locale, err)); // 错误文案
    } finally {
      setBusy(null); // 释放
    } // try 结束
  } // checkOne 结束

  // 推荐位切换：只改标记，不动可达性状态
  async function toggleRecommended(item: NavLink) {
    setBusy(`rec:${item.id}`); // 标记该条
    setError(null); // 清旧错误
    try {
      await api.navigation.update(item.id, { recommended: !item.recommended }); // 取反后写回
      list.reload(); // 刷新
    } catch (err) {
      setError(errorText(locale, err)); // 错误文案
    } finally {
      setBusy(null); // 释放
    } // try 结束
  } // toggleRecommended 结束

  // 按分组聚合渲染：保持后端排序（分组名 + 推荐位优先 + 名称）
  const groups = Array.from(new Set(items.map((item) => item.group))); // 分组顺序取首次出现顺序

  return (
    <div className="page">
      <header className="page-head">
        <h1>{tr(locale, '导航站', 'Navigation')}</h1>
        <p className="muted">
          {tr(locale, '全站资源链接目录与分类；服务端探测可达性并标记失效，推荐位优先展示。只维护目录与状态，不承载被链系统的内容。', 'Site-wide link directory with grouping; reachability is probed server-side and broken links are flagged. Only the directory and status are maintained here.')}
        </p>
      </header>

      <section className="panel">
        <div className="panel-head"><h3>{tr(locale, '目录概览', 'Directory overview')}</h3></div>
        <div className="deploy-stats">
          <div className="deploy-stat"><span className="deploy-stat-value">{summary?.total ?? '—'}</span><span className="muted">{tr(locale, '链接总数', 'Links')}</span></div>
          <div className="deploy-stat"><span className="deploy-stat-value">{summary?.ok ?? '—'}</span><span className="muted">{tr(locale, '可达', 'Reachable')}</span></div>
          <div className="deploy-stat"><span className="deploy-stat-value">{summary?.broken ?? '—'}</span><span className="muted">{tr(locale, '失效', 'Broken')}</span></div>
          <div className="deploy-stat"><span className="deploy-stat-value">{summary?.unknown ?? '—'}</span><span className="muted">{tr(locale, '未探测', 'Untested')}</span></div>
          <div className="deploy-stat"><span className="deploy-stat-value">{summary?.groups.length ?? '—'}</span><span className="muted">{tr(locale, '分组', 'Groups')}</span></div>
        </div>
        <p className="muted">
          {tr(locale, '最近探测', 'Last check')}: {shortTime(summary?.last_checked_at ?? null)}
          {' · '}
          <button type="button" className="btn primary" disabled={busy === 'all'} onClick={checkAll}>
            {busy === 'all' ? tr(locale, '检测中…', 'Checking…') : tr(locale, '检测全部', 'Check all')}
          </button>
        </p>
      </section>

      <form className="form inline" onSubmit={submitSearch}>
        <label className="grow">
          {tr(locale, '搜索', 'Search')}
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={tr(locale, '名称 / 地址 / 说明', 'Name / URL / description')} />
        </label>
        <button type="submit" className="btn primary">{tr(locale, '检索', 'Search')}</button>
      </form>

      <div className="deploy-columns">
        {(summary?.groups ?? []).map((g) => (
          <button key={g.name} type="button" className={`btn ghost${group === g.name ? ' active' : ''}`} onClick={() => setGroup(group === g.name ? '' : g.name)}>
            {g.name} {g.count}
          </button>
        ))}
      </div>

      {list.error ? <p className="error">{errorText(locale, list.error)}</p> : null}{/* 目录读取失败：统一错误文案 */}
      {error && <p className="error">{error}</p>}
      {message && <p className="hint">{message}</p>}

      {list.loading ? (
        <p className="hint">{tr(locale, '加载中…', 'Loading…')}</p>
      ) : items.length === 0 ? (
        <p className="hint">{tr(locale, '没有匹配的链接。', 'No matching links.')}</p>
      ) : (
        groups.map((groupName) => (
          <section className="panel" key={groupName}>
            <div className="panel-head"><h3>{groupName}</h3></div>
            <ul className="plain-list">
              {items.filter((item) => item.group === groupName).map((item) => (
                <li key={item.id} className="deploy-row">
                  <a className="link" href={item.url} target="_blank" rel="noreferrer">{item.recommended ? '★ ' : ''}{item.name}</a>
                  <div className="muted"><code>{item.url}</code> · {item.description || '—'}</div>
                  <div className="deploy-kv">
                    <StatusBadge status={item.status} locale={locale} />
                    <span>{tr(locale, 'HTTP', 'HTTP')}: <code>{item.http_status ?? '—'}</code></span>
                    <span>{tr(locale, '耗时', 'Latency')}: {item.latency_ms === null ? '—' : `${item.latency_ms} ms`}</span>
                    <span>{tr(locale, '探测时间', 'Checked')}: {shortTime(item.last_checked_at)}</span>
                    <button type="button" className="btn ghost" disabled={busy === `check:${item.id}`} onClick={() => checkOne(item.id)}>
                      {busy === `check:${item.id}` ? tr(locale, '检测中…', 'Checking…') : tr(locale, '检测', 'Check')}
                    </button>
                    <button type="button" className="btn ghost" disabled={busy === `rec:${item.id}`} onClick={() => toggleRecommended(item)}>
                      {item.recommended ? tr(locale, '取消推荐', 'Unpin') : tr(locale, '设为推荐', 'Pin')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <section className="panel">
        <div className="panel-head"><h3>{tr(locale, '收录入口', 'Add a link')}</h3></div>
        <form className="form inline" onSubmit={createLink}>
          <label>
            {tr(locale, '名称', 'Name')}
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder={tr(locale, '如：工作台', 'e.g. Workbench')} />
          </label>
          <label className="grow">
            {tr(locale, '地址', 'URL')}
            <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder={tr(locale, 'https://… 或 /路径', 'https://… or /path')} />
          </label>
          <label>
            {tr(locale, '分组', 'Group')}
            <input value={newGroup} onChange={(event) => setNewGroup(event.target.value)} placeholder={tr(locale, '选填，默认「其他」', 'optional, default “Other”')} />
          </label>
          <label className="grow">
            {tr(locale, '说明', 'Description')}
            <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={tr(locale, '选填', 'optional')} />
          </label>
          <label>
            <span>{tr(locale, '推荐位', 'Pin')}</span>
            <input type="checkbox" checked={recommended} onChange={(event) => setRecommended(event.target.checked)} />
          </label>
          <button type="submit" className="btn primary" disabled={busy === 'create'}>
            {busy === 'create' ? tr(locale, '提交中…', 'Saving…') : tr(locale, '新建', 'Add')}
          </button>
        </form>
        <p className="muted">{tr(locale, '地址只接受 http(s) 或站内相对路径；站内相对路径探测时按当前环境 origin 补齐。', 'Only http(s) URLs or site-relative paths are accepted; relative paths are resolved against the runtime origin during probing.')}</p>
      </section>
    </div>
  );
} // Navigation 组件结束
