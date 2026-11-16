// 提现审核：申请队列、通过 / 驳回 / 标记到账，以及创作分成批量结算
import { useState } from 'react'; // 局部表单状态
import type { AdminWithdrawalRow, AdminWithdrawalStatus, Credential } from '../api'; // 凭证与队列行类型
import { describeError } from '../api'; // 统一错误文案
import { approveWithdrawal, listAdminWithdrawals, markWithdrawalPaid, rejectWithdrawal, settleCreatorEarnings } from '../api-withdrawals'; // 提现 API
import { useAsync } from '../hooks'; // 统一异步加载

interface Props { // 入参
  credential: Credential; // 凭证
  permissions: string[]; // 权限
} // Props 结束

const STATUS_LABEL: Record<AdminWithdrawalStatus, string> = {
  pending: '待审核',
  approved: '已通过 · 打款中',
  rejected: '已驳回',
  paid: '已到账',
  cancelled: '已撤销',
};

const METHOD_LABEL: Record<string, string> = { alipay: '支付宝', wechat: '微信', bank: '银行卡' };

/** 每页条数：与用户管理保持一致 */
const PAGE_SIZE = 20;

/** 整数分转元展示，仅在渲染时做除法，不参与计算 */
function yuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

/** 提现审核视图主体 */
export function Withdrawals({ credential, permissions }: Props) {
  const canWrite = permissions.includes('commerce:write'); // 审核写权限（后端同一权限点）
  const [status, setStatus] = useState<AdminWithdrawalStatus | ''>('pending'); // 默认只看待审
  const [offset, setOffset] = useState(0); // 当前页偏移
  const queueState = useAsync(
    () => listAdminWithdrawals(credential, status, { limit: PAGE_SIZE, offset }),
    [credential, status, offset],
  ); // 队列
  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null); // 驳回表单
  const [paying, setPaying] = useState<{ id: string; ref: string } | null>(null); // 到账凭证表单
  const [error, setError] = useState(''); // 错误
  const [notice, setNotice] = useState(''); // 提示
  const [busy, setBusy] = useState(false); // 操作中

  /** 统一包装：执行写操作后刷新队列，action 返回成功提示文案 */
  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const done = await action();
      setNotice(done);
      setRejecting(null);
      setPaying(null);
      queueState.reload();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  const queue = queueState.data?.items ?? []; // 当前筛选下的队列
  const summary = queueState.data?.summary; // 各状态计数
  const total = queueState.data?.total ?? 0; // 当前筛选下的总数

  return (
    <div className="page">
      <header className="page-head">
        <h1>提现审核</h1>
        <p className="page-desc">可提现余额只累计佣金与创作分成，充值余额不可提现；通过时扣减余额并落提现流水，驳回已通过的申请会原路退回。</p>
      </header>

      {!canWrite && <div className="panel hint">当前账号缺少 commerce:write 权限，只能查看队列。</div>}
      {error && <div className="panel error">{error}</div>}
      {notice && <div className="panel hint">{notice}</div>}

      <section className="panel">
        <div className="panel-head">
          <h3>申请队列</h3>
          <span className="muted">
            待审 {summary?.pending ?? 0} · 打款中 {summary?.approved ?? 0} · 已到账 {summary?.paid ?? 0}
          </span>
          <button type="button" className="btn ghost" onClick={queueState.reload}>刷新</button>
        </div>
        <div className="tabs">
          {(['pending', 'approved', 'paid', 'rejected', ''] as Array<AdminWithdrawalStatus | ''>).map((value) => (
            <button
              key={value || 'all'}
              type="button"
              className={`tab${status === value ? ' active' : ''}`}
              onClick={() => { setStatus(value); setOffset(0); }} // 筛选变化重置到第一页
            >
              {value ? STATUS_LABEL[value] : '全部'}
            </button>
          ))}
        </div>

        {queueState.loading && <p className="muted">加载中…</p>}
        {Boolean(queueState.error) && <p className="error">{describeError(queueState.error)}</p>}
        {queue.length === 0 && !queueState.loading && !queueState.error ? <p className="empty">当前筛选下没有提现申请</p> : null}

        {queue.map((row) => (
          <article className="panel" key={row.id} style={{ marginBottom: 12 }}>
            <div className="panel-head">
              <h3>{row.display_name || row.user_id} · {yuan(row.amount_cents)}</h3>
              <span className={`badge ${row.status === 'pending' ? 'warning' : 'success'}`}>{STATUS_LABEL[row.status]}</span>
            </div>
            <div className="deploy-kv">
              <span>Mim ID {row.member_no ?? '—'}</span>
              <span>方式 {METHOD_LABEL[row.method] ?? row.method}</span>
              <span>收款人 {row.account_name}</span>
              <span>账号 {row.account_no}</span>
              <span>申请 {row.created_at.slice(0, 16)}</span>
              {row.reviewer ? <span>审核人 {row.reviewer}</span> : null}
              {row.payout_ref ? <span>凭证 {row.payout_ref}</span> : null}
              {row.review_note ? <span>备注 {row.review_note}</span> : null}
            </div>

            {canWrite && (row.status === 'pending' || row.status === 'approved') && (
              <div className="deploy-columns">
                {row.status === 'pending' && (
                  <button type="button" className="btn primary small" disabled={busy} onClick={() => { if (window.confirm(`确认通过 ${row.display_name || row.user_id} 的 ${yuan(row.amount_cents)} 提现？通过后立即扣减可提现余额。`)) void run(async () => { await approveWithdrawal(credential, row.id); return `已通过 ${yuan(row.amount_cents)}`; }); }}>通过</button>
                )}
                {row.status === 'approved' && (
                  <button type="button" className="btn primary small" disabled={busy} onClick={() => setPaying({ id: row.id, ref: '' })}>标记到账</button>
                )}
                <button type="button" className="btn ghost small" disabled={busy} onClick={() => setRejecting({ id: row.id, reason: '' })}>驳回</button>
              </div>
            )}

            {rejecting?.id === row.id && (
              <div className="form inline" style={{ marginTop: 10 }}>
                <label className="grow">驳回原因<input value={rejecting.reason} onChange={(event) => setRejecting({ ...rejecting, reason: event.target.value })} placeholder="必填，将展示给申请人" /></label>
                <button type="button" className="btn primary" disabled={busy || rejecting.reason.trim().length === 0} onClick={() => void run(async () => { await rejectWithdrawal(credential, row.id, rejecting.reason.trim()); return '已驳回并释放额度'; })}>确认驳回</button>
                <button type="button" className="btn ghost" onClick={() => setRejecting(null)}>取消</button>
              </div>
            )}

            {paying?.id === row.id && (
              <div className="form inline" style={{ marginTop: 10 }}>
                <label className="grow">打款凭证号<input value={paying.ref} onChange={(event) => setPaying({ ...paying, ref: event.target.value })} placeholder="线下打款流水号 / 渠道单号" /></label>
                <button type="button" className="btn primary" disabled={busy || paying.ref.trim().length === 0} onClick={() => void run(async () => { await markWithdrawalPaid(credential, row.id, paying.ref.trim()); return '已标记到账'; })}>确认到账</button>
                <button type="button" className="btn ghost" onClick={() => setPaying(null)}>取消</button>
              </div>
            )}
          </article>
        ))}

        <div className="pager">
          <button className="btn ghost" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>上一页</button>
          <span className="muted">{total === 0 ? '0 / 0' : `${offset + 1}-${Math.min(offset + PAGE_SIZE, total)} / ${total}`}</span>
          <button className="btn ghost" type="button" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>下一页</button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h3>创作分成结算</h3></div>
        <p className="muted">把已过保护期的待结算分成净额并入作者的可提现余额；重复点击不会二次入账。</p>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !canWrite}
          onClick={() => { if (!window.confirm('确认批量结算所有已过保护期的创作分成？结算后金额并入作者可提现余额。')) return; void run(async () => {
            const result = await settleCreatorEarnings(credential);
            return `已结算 ${result.settled} 笔，合计 ${yuan(result.total_cents)}`;
          }); }}
        >
          批量结算创作分成
        </button>
      </section>
    </div>
  );
}
