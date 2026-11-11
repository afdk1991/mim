// 部署汇总视图：把全部部署仓库与部署项按统一字段铺成一张可筛选、可展开的核对表
import { useEffect, useRef, useState } from 'react'; // 本地状态钩子：搜索词、筛选条件、展开项；ref/effect 供图表挂载与销毁
import type { FormEvent } from 'react'; // 表单事件类型：筛选表单 onSubmit 入参
// 语言类型：约束文案取值为 'zh-CN' | 'en-US'
import type { Locale } from '@mim/i18n';
// 接口客户端与错误文案翻译器
import { api, errorText } from '../api';
// 部署汇总共享类型：单项、结果、异常
import type { DeploymentAnomaly, DeploymentItem, DeploymentResult } from '../api';
// 通用异步加载钩子：统一处理 loading / error / reload
import { useAsync } from '../hooks';
// ECharts：总览面板把部署状态分布画成饼图，替代纯文字罗列，卸载时 dispose 释放实例
import * as echarts from 'echarts';

// 组件对外契约：部署汇总文案跟随全局语言
interface Props {
  // 当前界面语言
  locale: Locale;
} // Props 结束

// 按语言取文案：集中管理双语字符串，避免散落在 JSX 里
function tr(locale: Locale, zh: string, en: string): string {
  // 英文环境取英文，其余取中文
  return locale === 'en-US' ? en : zh;
} // tr 结束

// 部署状态 → 徽标样式 + 文案；失败与未取证不共用同一标识
const STATUS_STYLE: Record<string, { cls: string; zh: string; en: string }> = {
  // 配置完整且本轮取证通过
  OK: { cls: 'ok', zh: '✅ 正常', en: '✅ OK' },
  // 存在阻断性缺陷
  BROKEN: { cls: 'fail', zh: '🔴 阻断 / 失败', en: '🔴 Broken' },
  // 链路已配置但本轮无可信取证
  UNVERIFIED: { cls: 'warn', zh: '🟡 未取证', en: '🟡 Unverified' },
  // 仅手工直传
  MANUAL: { cls: 'warn', zh: '🟡 手工直传', en: '🟡 Manual' },
  // 候选池 / 排除项
  NOT_APPLICABLE: { cls: 'muted', zh: '⚪ 不适用', en: '⚪ N/A' },
}; // STATUS_STYLE 结束

// 部署结果 → 徽标样式 + 文案；空数据（result === null）单独处理
const VERDICT_STYLE: Record<string, { cls: string; zh: string; en: string }> = {
  // 本轮取证通过
  PASS: { cls: 'ok', zh: '✅ 通过', en: '✅ Pass' },
  // 可达但内容层不可核验
  DEGRADED: { cls: 'warn', zh: '🟡 降级可用', en: '🟡 Degraded' },
  // 明确失败 / 不可达
  FAIL: { cls: 'fail', zh: '🔴 失败', en: '🔴 Fail' },
  // 本轮未发起探测
  NOT_TESTED: { cls: 'warn', zh: '🟡 未测', en: '🟡 Not tested' },
  // 探测已发起但无记录
  EMPTY: { cls: 'muted', zh: '⚪ 无记录', en: '⚪ Empty' },
}; // VERDICT_STYLE 结束

// 严重度 → 图标与样式类，异常说明按此分级展示
const SEVERITY_STYLE: Record<string, string> = {
  // 🔴 阻断生产或交付链路
  critical: 'fail',
  // 🟡 信息缺口或潜在悬空
  warning: 'warn',
  // 🟢 设计内行为，不影响结论
  info: 'ok',
}; // SEVERITY_STYLE 结束

// 空值统一显示占位符：避免空白单元格被误读为「漏填」或「0」
function dash(value: string | number | null | undefined): string {
  // null / undefined / 空串统一为破折号
  return value === null || value === undefined || value === '' ? '—' : String(value);
} // dash 结束

// 渲染部署状态徽标：未知状态原样展示，避免脏数据渲染成空白
function StatusBadge({ status, locale }: { status: string; locale: Locale }) {
  // 查表命中按语言取值，未命中原样展示
  const s = STATUS_STYLE[status];
  // 未命中时返回中性徽标
  if (!s) return <span className="deploy-badge muted">{status}</span>;
  // 命中时返回对应配色徽标
  return <span className={`deploy-badge ${s.cls}`}>{tr(locale, s.zh, s.en)}</span>;
} // StatusBadge 结束

// 渲染部署结果：空数据、失败、降级、通过必须彼此可区分
function ResultBadge({ result, locale }: { result: DeploymentResult | null; locale: Locale }) {
  // result 为 null 属于「空数据」，不填充 0、不冒充成功
  if (result === null) {
    // 空数据徽标 + 明确说明
    return <span className="deploy-badge empty">{tr(locale, '⚪ 空数据（本轮无取证）', '⚪ Empty (no evidence)')}</span>;
  } // 空数据分支结束
  // 查表命中按语言取值
  const v = VERDICT_STYLE[result.verdict] ?? { cls: 'muted', zh: result.verdict, en: result.verdict };
  // 返回徽标 + HTTP / 字节数，便于与 curl 输出直接核对
  return (
    <span className={`deploy-badge ${v.cls}`}>
      {tr(locale, v.zh, v.en)} · {dash(result.http_code)} / {dash(result.bytes)}B
    </span>
  );
} // ResultBadge 结束

// 渲染单条异常说明：严重度 + 异常码 + 说明
function AnomalyRow({ anomaly }: { anomaly: DeploymentAnomaly }) {
  // 按严重度取样式类，未知严重度回落灰色
  const cls = SEVERITY_STYLE[anomaly.severity] ?? 'muted';
  // 返回一行异常明细
  return (
    <li className="deploy-anomaly">
      <span className={`deploy-badge ${cls}`}>{anomaly.severity}</span>
      <code>{anomaly.code}</code>
      <span>{anomaly.message}</span>
    </li>
  );
} // AnomalyRow 结束

// 部署状态分布饼图：把 by_status 计数画成 ECharts 环形图，标签走状态字典翻译；无数据不渲染容器。
function StatusPieChart({ byStatus, codes, locale }: {
  byStatus: Record<string, number>; // 各部署状态的计数
  codes: Record<string, string>; // 状态字典：code → 展示文案
  locale: Locale; // 当前语言（字典文案已按语言生成，仅留作未来多语言扩展）
}) {
  const hostRef = useRef<HTMLDivElement | null>(null); // 图表挂载容器
  // 数据快照键：统计对象每次渲染都是新引用，拼成串作 effect 依赖，避免无关重渲染重建图表
  const dataKey = Object.entries(byStatus).map(([code, value]) => `${code}:${value}`).join('|');

  useEffect(() => { // 容器就绪且统计快照变化时（重新）绘图
    const host = hostRef.current; // 取挂载节点
    if (!host || dataKey === '') return; // 无容器或无数据时不建图
    const chart = echarts.init(host); // 初始化 ECharts 实例
    // 映射饼图数据：字典命中按语言取文案，未命中回退原始状态码
    const data = Object.entries(byStatus).map(([code, value]) => ({
      name: codes[code] ?? code,
      value,
    }));
    chart.setOption({ // 环形饼图配置
      tooltip: { trigger: 'item' }, // 悬停扇区显示名称与占比
      legend: { bottom: 0, textStyle: { fontSize: 10 } }, // 底部图例
      series: [{
        type: 'pie', // 饼图
        radius: ['38%', '62%'], // 环形内外半径
        center: ['50%', '46%'], // 居中偏上给图例留位
        label: { fontSize: 10 }, // 扇区标签字号
        data, // 扇区数据
      }],
    }); // 配置结束
    const onResize = () => chart.resize(); // 视口缩放时自适应重排
    window.addEventListener('resize', onResize);
    return () => { // 卸载或数据变化前清理
      window.removeEventListener('resize', onResize); // 移除缩放监听
      chart.dispose(); // 销毁实例，释放 canvas 与事件
    };
  }, [dataKey, codes, locale]); // 依赖：统计快照键 + 字典 + 语言；原始对象引用不进依赖

  if (dataKey === '') return null; // 无状态计数时不渲染容器
  return <div ref={hostRef} className="deploy-status-pie" />; // 图表挂载容器
} // StatusPieChart 结束

// 渲染访问域名：只展示域名（省略协议与路径），点击在新窗口打开完整入口地址
function EntryLink({ entryUrl }: { entryUrl: string | null }) {
  // 空入口：显示占位符并保留说明，避免空白被误读为漏填
  if (!entryUrl) return <span className="muted">—</span>;
  // 解析失败（注册表里可能是非标准地址）时原样展示，不吞掉信息
  let host = entryUrl;
  try {
    host = new URL(entryUrl).host; // 优先只展示主机（含端口），列宽可控
  } catch {
    host = entryUrl; // 解析失败保留原文
  }
  return (
    <a className="link" href={entryUrl} target="_blank" rel="noreferrer" title={entryUrl}>
      {host}
    </a>
  );
} // EntryLink 结束

// 部署汇总主视图：总览 + 筛选 + 核对表 + 展开详情 + 覆盖口径
export function Deployments({ locale }: Props) {
  // 全量汇总：分布统计、覆盖口径与字典
  const overview = useAsync(() => api.deployments.overview(), []);
  // 搜索输入框未提交值
  const [keyword, setKeyword] = useState('');
  // 已提交关键词
  const [applied, setApplied] = useState('');
  // 部署状态筛选
  const [status, setStatus] = useState('');
  // 部署结果筛选（EMPTY 命中空数据项）
  const [verdict, setVerdict] = useState('');
  // 层级筛选
  const [layer, setLayer] = useState('');
  // 平台筛选
  const [platform, setPlatform] = useState('');
  // 当前展开的部署项 id；null 表示全部收起
  const [expanded, setExpanded] = useState<string | null>(null);
  // 清单：任一筛选条件变化即重新拉取
  const list = useAsync(
    () => api.deployments.list({ q: applied || undefined, status: status || undefined, verdict: verdict || undefined, layer: layer || undefined, platform_id: platform || undefined }),
    [applied, status, verdict, layer, platform],
  );
  // 展开项详情：用于取同平台同类项，验证「覆盖同类项、不遗漏不重复」
  const detail = useAsync(
    () => (expanded ? api.deployments.detail(expanded) : Promise.resolve(null)),
    [expanded],
  );

  // 提交筛选：把输入值落到 applied，触发清单重新拉取
  function submitSearch(event: FormEvent) {
    // 阻止表单默认跳转，保持单页体验
    event.preventDefault();
    // 去首尾空白后生效
    setApplied(keyword.trim());
  } // submitSearch 结束

  // 清空全部筛选条件
  function clearFilters() {
    // 清关键词输入
    setKeyword('');
    // 清已提交关键词
    setApplied('');
    // 清状态
    setStatus('');
    // 清结果
    setVerdict('');
    // 清层级
    setLayer('');
    // 清平台
    setPlatform('');
  } // clearFilters 结束

  // 切换展开项：再次点击同一行即收起
  function toggle(id: string) {
    // 用函数式更新避免依赖可能滞后的状态值
    setExpanded((current) => (current === id ? null : id));
  } // toggle 结束

  // 清单加载失败：展示错误 + 重试入口，避免一次请求失败即永久空白
  if (list.error) {
    return (
      <div className="page">
        <header className="page-head"><h1>{tr(locale, '部署汇总', 'Deployment Summary')}</h1></header>
        <p className="error">{errorText(locale, list.error)}</p>
        <p className="muted">{tr(locale, '无法连接部署汇总服务，请检查网络或接口可用性后重试。', 'Cannot reach the deployment summary service. Retry after checking connectivity.')}</p>
        <button type="button" className="btn primary" onClick={() => list.reload()}>{tr(locale, '重试', 'Retry')}</button>
      </div>
    );
  } // 错误态结束

  // 汇总数据，未返回时为 null
  const ov = overview.data;
  // 清单数据，未返回时兜底为空数组
  const items: DeploymentItem[] = list.data?.items ?? [];
  // 是否有任何筛选条件生效
  const filtered = Boolean(applied || status || verdict || layer || platform);

  // 主渲染：页头 + 总览 + 筛选 + 核对表 + 覆盖说明
  return (
    <div className="page">
      <header className="page-head">
        <h1>{tr(locale, '部署汇总', 'Deployment Summary')}</h1>
        <p className="muted">
          {tr(locale, '统一字段展示所有部署仓库与部署项的效果 / 结果 / 异常；空数据、失败状态与缺失信息分别标识，便于核对整体部署情况。', 'All deployment repositories and items in one unified schema; empty data, failures and missing information are explicitly marked.')}
        </p>
        {/* 列规范固定为 8 列，顺序与文档口径一致；点击规范 ID 可展开取证详情 */}
        <p className="muted">
          {tr(locale, '列规范（8 列）：规范 ID / 名称 · 仓库标识 · 平台 / 层级 · 交付链路 · 访问域名 · 部署状态 · 部署结果 · 异常说明；点击规范 ID 展开取证详情。', 'Column spec (8): ID/name · repository · platform/layer · delivery · domain · status · result · anomalies; click the ID to expand evidence.')}
        </p>
        {ov && (
          <p className="muted">
            {tr(locale, '取证时间', 'Captured')}: {ov.captured_at} · HEAD <code>{ov.head}</code> · {tr(locale, '契约', 'schema')} <code>{ov.schema}</code>
          </p>
        )}
      </header>

      <section className="panel">
        <div className="panel-head"><h3>{tr(locale, '总览', 'Overview')}</h3></div>
        <div className="deploy-stats">
          <div className="deploy-stat"><span className="deploy-stat-value">{ov?.total ?? '—'}</span><span className="muted">{tr(locale, '部署项', 'Items')}</span></div>
          <div className="deploy-stat"><span className="deploy-stat-value">{ov?.matrix_platforms ?? '—'}</span><span className="muted">{tr(locale, '矩阵平台', 'Platforms')}</span></div>
          <div className="deploy-stat"><span className="deploy-stat-value">{ov?.git_remotes ?? '—'}</span><span className="muted">{tr(locale, 'git 远端', 'Remotes')}</span></div>
          <div className="deploy-stat"><span className="deploy-stat-value">{ov?.ci_jobs ?? '—'}</span><span className="muted">{tr(locale, 'CI 作业', 'CI jobs')}</span></div>
          <div className="deploy-stat"><span className="deploy-stat-value">{ov?.with_result ?? '—'}</span><span className="muted">{tr(locale, '有取证', 'With evidence')}</span></div>
          <div className="deploy-stat"><span className="deploy-stat-value">{ov?.empty_result ?? '—'}</span><span className="muted">{tr(locale, '空数据', 'Empty data')}</span></div>
          <div className="deploy-stat"><span className="deploy-stat-value">{ov?.anomalies ?? '—'}</span><span className="muted">{tr(locale, '异常', 'Anomalies')}</span></div>
          <div className="deploy-stat"><span className="deploy-stat-value">{ov?.missing_fields ?? '—'}</span><span className="muted">{tr(locale, '缺失信息', 'Missing fields')}</span></div>
          <div className="deploy-stat"><span className="deploy-stat-value">{ov?.worktree_drift ?? '—'}</span><span className="muted">{tr(locale, '工件漂移', 'Artifact drift')}</span></div>
        </div>
        {ov && (
          <p className="muted">
            {tr(locale, '异常分级', 'By severity')}: 🔴 {ov.by_severity.critical ?? 0} · 🟡 {ov.by_severity.warning ?? 0} · 🟢 {ov.by_severity.info ?? 0}
            {' · '}{tr(locale, '状态分布', 'By status')}: {Object.entries(ov.by_status).map(([k, v]) => `${k} ${v}`).join(' / ')}
          </p>
        )}
        {/* 状态分布环形图：与上方文字罗列互为补充，直观对比各状态占比 */}
        {ov && <StatusPieChart byStatus={ov.by_status} codes={ov.status_codes} locale={locale} />}
      </section>

      <form className="form inline" onSubmit={submitSearch}>
        <label className="grow">
          {tr(locale, '搜索', 'Search')}
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={tr(locale, '规范 ID / 名称 / 别名 / 仓库标识', 'ID / name / alias / repository')}
          />
        </label>
        <label>
          {tr(locale, '部署状态', 'Status')}
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{tr(locale, '全部状态', 'All statuses')}</option>
            {Object.keys(ov?.status_codes ?? {}).map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>
        <label>
          {tr(locale, '部署结果', 'Result')}
          <select value={verdict} onChange={(event) => setVerdict(event.target.value)}>
            <option value="">{tr(locale, '全部结果', 'All results')}</option>
            {Object.keys(ov?.verdict_codes ?? {}).map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>
        <label>
          {tr(locale, '层级', 'Layer')}
          <select value={layer} onChange={(event) => setLayer(event.target.value)}>
            <option value="">{tr(locale, '全部层级', 'All layers')}</option>
            {Object.keys(ov?.layer_codes ?? {}).map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>
        <label>
          {tr(locale, '平台', 'Platform')}
          <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
            <option value="">{tr(locale, '全部平台', 'All platforms')}</option>
            {(ov?.platforms ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <button type="submit" className="btn primary">{tr(locale, '筛选', 'Apply')}</button>
        {filtered && (
          <>
            <span className="count">{list.data?.total ?? 0} / {list.data?.registry_total ?? 0}</span>
            <button type="button" className="btn ghost" onClick={clearFilters}>{tr(locale, '清除', 'Clear')}</button>
          </>
        )}
      </form>

      {list.loading ? (
        <p className="hint">{tr(locale, '加载中…', 'Loading…')}</p>
      ) : items.length === 0 ? (
        <p className="hint">
          {tr(locale, '没有匹配的部署项（注册表非空，属筛选无命中，而非空数据）。', 'No items match the filters (registry is not empty; this is an empty filter result, not missing data).')}
        </p>
      ) : (
        <div className="deploy-table-wrap">
          <table className="deploy-table">
            <thead>
              <tr>
                <th>{tr(locale, '规范 ID / 名称', 'ID / Name')}</th>
                <th>{tr(locale, '仓库标识', 'Repository')}</th>
                <th>{tr(locale, '平台 / 层级', 'Platform / Layer')}</th>
                <th>{tr(locale, '交付链路', 'Delivery')}</th>
                <th>{tr(locale, '访问域名', 'Domain')}</th>
                <th>{tr(locale, '部署状态', 'Deploy status')}</th>
                <th>{tr(locale, '部署结果', 'Deploy result')}</th>
                <th>{tr(locale, '异常说明', 'Anomalies')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <DeployRow
                  key={item.id}
                  item={item}
                  locale={locale}
                  expanded={expanded === item.id}
                  related={detail.data?.item.id === item.id ? detail.data.related : []}
                  detailLoading={expanded === item.id && detail.loading}
                  onToggle={() => toggle(item.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ov && (
        <section className="panel">
          <div className="panel-head"><h3>{tr(locale, '覆盖、去重与排除', 'Coverage, dedup & exclusions')}</h3></div>
          <p className="muted">{tr(locale, `矩阵平台 ${ov.coverage.matrix_platforms} 个 / 规范部署项 ${ov.coverage.deployment_items} 个 / 部署作业 ${ov.coverage.deploy_ci_jobs} 个`, `${ov.coverage.matrix_platforms} matrix platforms / ${ov.coverage.deployment_items} items / ${ov.coverage.deploy_ci_jobs} deploy jobs`)}</p>
          <p className="muted">{tr(locale, `去重：${ov.coverage.dedup_note}`, `Dedup: ${ov.coverage.dedup_note}`)}</p>
          <p className="muted">{tr(locale, `补齐：${ov.coverage.added_note}`, `Added: ${ov.coverage.added_note}`)}</p>
          <p className="muted">{tr(locale, `排除：${ov.coverage.excluded_note}`, `Excluded: ${ov.coverage.excluded_note}`)}</p>
          <div className="deploy-columns">
            <div>
              <p className="deploy-section-title">{tr(locale, 'CI 作业', 'CI jobs')}</p>
              <ul className="plain-list">
                {(ov.ci_job_list ?? []).map((job) => (
                  <li key={job.id}><code>{job.id}</code><span className="muted">{job.is_deploy ? tr(locale, '部署作业', 'deploy') : tr(locale, '质量门禁', 'gate')} · {job.role}</span></li>
                ))}
              </ul>
            </div>
            <div>
              <p className="deploy-section-title">{tr(locale, '候选 / 排除项（不计入汇总）', 'Candidates / excluded (not counted)')}</p>
              <ul className="plain-list">
                {(ov.excluded_items ?? []).map((ex) => (
                  <li key={ex.id}><span>{ex.name}</span><span className="muted">{ex.reason}</span></li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}
    </div>
  );
} // Deployments 组件结束

// 单行部署项：折叠态给核对字段，展开态给取证原文 / 异常明细 / 缺失清单 / 同类项
function DeployRow({ item, locale, expanded, related, detailLoading, onToggle }: {
  item: DeploymentItem; // 部署项完整字段
  locale: Locale; // 当前语言
  expanded: boolean; // 是否展开
  related: Array<{ id: string; name: string; layer: string }>; // 同平台同类项
  detailLoading: boolean; // 详情加载中
  onToggle: () => void; // 展开 / 收起回调
}) {
  // 返回一组 <tr>：第一行核对字段，展开时追加一行详情
  return (
    <>
      <tr className={expanded ? 'deploy-row expanded' : 'deploy-row'}>
        <td>
          {/* 规范 ID 兼作展开入口：8 列规范下不再单设「操作」列，点击 ID 查看取证详情 */}
          <button type="button" className="link" onClick={onToggle} title={tr(locale, '展开 / 收起取证详情', 'Toggle evidence detail')}>
            <code>{item.id}</code> {expanded ? '▾' : '▸'}
          </button>
          <div className="muted">{item.name}</div>
        </td>
        <td><code>{dash(item.repository.id)}</code><div className="muted">{dash(item.repository.role)}</div></td>
        <td>{item.platform}<div className="muted">{item.layer} / {item.kind}</div></td>
        <td><code>{item.delivery.mode}</code><div className="muted">{dash(item.delivery.ci_job)}{item.delivery.artifact_in_head === true && item.delivery.artifact_in_worktree === false ? ' · ⚠ 漂移' : ''}</div></td>
        <td><EntryLink entryUrl={item.entry_url} /></td>
        <td><StatusBadge status={item.status} locale={locale} /></td>
        <td><ResultBadge result={item.result} locale={locale} /></td>
        <td>
          {item.anomalies.length === 0
            ? <span className="muted">—</span>
            : <span className="deploy-badge warn">{item.anomalies.length} {tr(locale, '项', 'items')}</span>}
          <div className="muted">{item.anomalies[0]?.code ?? '—'}</div>
          {/* 缺失字段并入「异常说明」列：8 列规范下不再单列，但仍需可见 */}
          {item.missing_fields.length > 0 && (
            <div><span className="deploy-badge missing">⚠ {tr(locale, '缺失', 'missing')} {item.missing_fields.length}</span></div>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="deploy-detail-row">
          <td colSpan={8}>
            <div className="deploy-detail">
              <p className="deploy-section-title">{tr(locale, '部署结果与取证', 'Result & evidence')}</p>
              <p className="muted">
                {item.result === null
                  ? tr(locale, '空数据：本轮无任何取证，未以历史结果冒充现状。', 'Empty data: no evidence captured this round; historical results are not used as current.')
                  : item.result.evidence}
              </p>
              <div className="deploy-kv">
                <span>{tr(locale, '入口', 'Entry')}: <code>{dash(item.entry_url)}</code></span>
                <span>{tr(locale, '耗时', 'Latency')}: {item.result ? dash(item.result.latency_ms) + ' ms' : '—'}</span>
                <span>{tr(locale, '取证时间', 'Captured')}: {dash(item.result?.captured_at)}</span>
                <span>{tr(locale, '工件(HEAD/工作树)', 'Artifact(HEAD/worktree)')}: {dash(String(item.delivery.artifact_in_head))} / {dash(String(item.delivery.artifact_in_worktree))}</span>
              </div>
              <p className="deploy-section-title">{tr(locale, '异常说明', 'Anomalies')}</p>
              {item.anomalies.length === 0
                ? <p className="muted">{tr(locale, '无异常。', 'No anomalies.')}</p>
                : <ul className="plain-list">{item.anomalies.map((a) => <AnomalyRow key={a.code} anomaly={a} />)}</ul>}
              <p className="deploy-section-title">{tr(locale, '缺失信息', 'Missing information')}</p>
              {item.missing_fields.length === 0
                ? <p className="muted">{tr(locale, '信息齐备。', 'Complete.')}</p>
                : <div className="deploy-missing">{item.missing_fields.map((f) => <code key={f}>{f}</code>)}</div>}
              <p className="deploy-section-title">{tr(locale, '统一字段：别名与发布形态（去重依据）', 'Aliases & delivery modes (dedup evidence)')}</p>
              <p className="muted">{item.aliases.join(' · ') || '—'}</p>
              <p className="muted">{item.delivery.modes.join(' · ') || '—'}</p>
              <p className="deploy-section-title">{tr(locale, '同类项（同平台）', 'Related items (same platform)')}</p>
              <p className="muted">
                {detailLoading
                  ? tr(locale, '加载中…', 'Loading…')
                  : related.length === 0
                    ? tr(locale, '无其它同类项。', 'No other items on this platform.')
                    : related.map((r) => `${r.id} (${r.layer})`).join(' · ')}
              </p>
              <p className="deploy-section-title">{tr(locale, '取证来源', 'Sources')}</p>
              <ul className="plain-list">{item.sources.map((s) => <li key={s} className="muted">{s}</li>)}</ul>
            </div>
          </td>
        </tr>
      )}
    </>
  );
} // DeployRow 结束
