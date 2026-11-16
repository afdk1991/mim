// 审计流水：查询后台敏感操作的留痕（操作人 / 动作 / 对象 / 结果 / 时间）
import { useState } from 'react'; // 本地筛选与分页状态
import type { Credential } from '../api'; // 凭证类型
import { describeError, listAuditLogs } from '../api'; // 审计查询 + 统一错误文案
import { useAsync } from '../hooks'; // 统一异步加载

interface Props { // 视图入参
  credential: Credential; // 后台凭证
  permissions: string[]; // 当前身份权限码，用于提示只读
} // Props 结束

/** 单页条数：审计行信息密度中等，20 条兼顾翻页成本与可读性 */
const PAGE_SIZE = 20;

/** 结果标签：成功 / 失败两态，失败行需要一眼识别 */
const RESULT_LABEL: Record<'success' | 'failure', string> = {
  success: '成功',
  failure: '失败',
};

/** 把明细对象序列化为可读 JSON；空对象直接显示短横线避免噪音 */
function formatDetail(detail: Record<string, unknown>): string {
  // 无字段时给占位符
  if (Object.keys(detail).length === 0) return '—';
  // 缩进两格便于阅读嵌套结构
  return JSON.stringify(detail, null, 2);
} // formatDetail 结束

/** 审计流水视图主体 */
export function AuditLogs({ credential, permissions }: Props) {
  // 只读身份（缺 rbac:read）时后端会 403，这里先给提示避免误以为页面坏了
  const canRead = permissions.includes('rbac:read');
  // 已提交的筛选条件：与输入框分离，避免每次敲键盘都发请求
  const [filters, setFilters] = useState({ action: '', target_type: '', target_id: '', actor_id: '', result: '' as '' | 'success' | 'failure' });
  // 输入框草稿：点「查询」才写入 filters
  const [draft, setDraft] = useState(filters);
  // 当前页偏移
  const [offset, setOffset] = useState(0);
  // 流水查询：条件或分页变化时重新拉取
  const pageState = useAsync(
    () => listAuditLogs(credential, {
      action: filters.action.trim() || undefined, // 空串不作为条件
      target_type: filters.target_type.trim() || undefined, // 对象类型
      target_id: filters.target_id.trim() || undefined, // 对象主键
      actor_id: filters.actor_id.trim() || undefined, // 操作人
      result: filters.result || undefined, // 结果
      limit: PAGE_SIZE, // 固定单页条数
      offset, // 当前偏移
    }),
    [credential, filters, offset],
  ); // pageState 结束

  /** 提交筛选：条件变化时回到第一页，避免落在越界偏移上 */
  function apply() {
    setFilters(draft);
    setOffset(0);
  } // apply 结束

  /** 重置筛选：清空草稿与已生效条件 */
  function reset() {
    const empty = { action: '', target_type: '', target_id: '', actor_id: '', result: '' as '' | 'success' | 'failure' };
    setDraft(empty);
    setFilters(empty);
    setOffset(0);
  } // reset 结束

  // 当前页数据与总数
  const items = pageState.data?.items ?? [];
  const total = pageState.data?.total ?? 0;

  return (
    <div className="page">
      <header className="page-head">
        <h1>审计流水</h1>
        <p className="page-desc">记录建号、重置口令、角色授予与撤销、提现审核打款、商品改价、套餐增删等敏感操作；口令、令牌、证件号与收款账号等敏感值不会写入明细。</p>
      </header>

      {!canRead && <div className="panel hint">当前账号缺少 rbac:read 权限，无法查看审计流水。</div>}

      <section className="panel">
        <div className="panel-head">
          <h3>筛选</h3>
          <button type="button" className="btn ghost" onClick={pageState.reload}>刷新</button>
        </div>
        <div className="form inline">
          <label>动作码
            <input
              value={draft.action}
              onChange={(event) => setDraft({ ...draft, action: event.target.value })}
              placeholder="如 withdrawal.approve"
            />
          </label>
          <label>对象类型
            <input
              value={draft.target_type}
              onChange={(event) => setDraft({ ...draft, target_type: event.target.value })}
              placeholder="如 user / product"
            />
          </label>
          <label>对象主键
            <input
              value={draft.target_id}
              onChange={(event) => setDraft({ ...draft, target_id: event.target.value })}
              placeholder="需同时填写对象类型"
            />
          </label>
          <label>操作人
            <input
              value={draft.actor_id}
              onChange={(event) => setDraft({ ...draft, actor_id: event.target.value })}
              placeholder="用户 ID 或 admin-bootstrap"
            />
          </label>
          <label>结果
            <select value={draft.result} onChange={(event) => setDraft({ ...draft, result: event.target.value as '' | 'success' | 'failure' })}>
              <option value="">全部</option>
              <option value="success">成功</option>
              <option value="failure">失败</option>
            </select>
          </label>
          <button type="button" className="btn primary" disabled={!canRead} onClick={apply}>查询</button>
          <button type="button" className="btn ghost" onClick={reset}>重置</button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>流水</h3>
          <span className="muted">共 {total} 条</span>
        </div>

        {pageState.loading && <p className="muted">加载中…</p>}
        {Boolean(pageState.error) && <p className="error">{describeError(pageState.error)}</p>}
        {items.length === 0 && !pageState.loading && !pageState.error ? <p className="empty">当前筛选下没有审计记录</p> : null}

        {items.map((row) => (
          <article className="panel" key={row.id} style={{ marginBottom: 12 }}>
            <div className="panel-head">
              <h3>{row.action} · {row.target_type}{row.target_id ? `:${row.target_id}` : ''}</h3>
              <span className={`badge ${row.result === 'success' ? 'success' : 'warning'}`}>{RESULT_LABEL[row.result]}</span>
            </div>
            <div className="deploy-kv">
              <span>时间 {row.created_at.slice(0, 19).replace('T', ' ')}</span>
              <span>操作人 {row.actor_id ?? '—'}</span>
              <span>区域 {row.region ?? '—'}</span>
              <span>IP {row.ip ?? '—'}</span>
              <span>请求 {row.request_id ?? '—'}</span>
            </div>
            <details style={{ marginTop: 8 }}>
              <summary className="muted">操作明细</summary>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>{formatDetail(row.detail)}</pre>
            </details>
          </article>
        ))}

        <div className="pager">
          <button className="btn ghost" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>上一页</button>
          <span className="muted">{total === 0 ? '0 / 0' : `${offset + 1}-${Math.min(offset + PAGE_SIZE, total)} / ${total}`}</span>
          <button className="btn ghost" type="button" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>下一页</button>
        </div>
      </section>
    </div>
  );
} // AuditLogs 结束
