// 提现审核：申请队列、通过 / 驳回 / 标记到账，以及创作分成批量结算
// 引入 React 状态钩子：useState 维护筛选、分页与各表单局部状态
import { useState } from 'react'; // 局部表单状态
// 引入提现队列行 / 状态枚举 / 凭证类型：约束接口数据结构与入参
import type { AdminWithdrawalRow, AdminWithdrawalStatus, Credential } from '../api'; // 凭证与队列行类型
// 引入统一错误文案翻译器：把后端错误对象转成可读提示
import { describeError } from '../api'; // 统一错误文案
// 引入提现审核与分成结算接口：通过 / 驳回 / 标记到账 / 批量结算
import { approveWithdrawal, listAdminWithdrawals, markWithdrawalPaid, rejectWithdrawal, settleCreatorEarnings } from '../api-withdrawals'; // 提现 API
// 引入异步数据钩子：封装队列请求的加载中 / 错误 / 数据三态
import { useAsync } from '../hooks'; // 统一异步加载

// 组件入参契约：凭证随请求鉴权，权限码判定可写
interface Props { // 入参
  credential: Credential; // 凭证
  permissions: string[]; // 权限
} // Props 结束

// 提现状态中文口径：与后端 withdrawal.status 一一对应
const STATUS_LABEL: Record<AdminWithdrawalStatus, string> = {
  pending: '待审核', // 待审核：申请已提交，等待后台处理
  approved: '已通过 · 打款中', // 已通过：余额已扣减，等待线下打款
  rejected: '已驳回', // 已驳回：申请未通过，额度已释放
  paid: '已到账', // 已到账：打款凭证已登记，流程闭环
  cancelled: '已撤销', // 已撤销：申请人主动撤回
};

// 提现方式中文口径：渠道代号翻译成可读名
const METHOD_LABEL: Record<string, string> = { alipay: '支付宝', wechat: '微信', bank: '银行卡' };

/** 每页条数：审核卡片信息密度高，单页 10 条避免长滚动 */
const PAGE_SIZE = 10;

/** 整数分转元展示，仅在渲染时做除法，不参与计算 */
function yuan(cents: number): string {
  // 后端金额以分存储，展示时除以 100 并补两位小数
  return `¥${(cents / 100).toFixed(2)}`;
}

/** 提现审核视图主体 */
export function Withdrawals({ credential, permissions }: Props) {
  // 写权限判定：缺少 commerce:write 时只展示只读队列
  const canWrite = permissions.includes('commerce:write'); // 审核写权限（后端同一权限点）
  // 状态筛选：默认只看待审，切换标签时重置分页
  const [status, setStatus] = useState<AdminWithdrawalStatus | ''>('pending'); // 默认只看待审
  // 分页偏移量：按 PAGE_SIZE 步进，筛选变化时归零
  const [offset, setOffset] = useState(0); // 当前页偏移
  // 队列异步请求：按状态与分页参数拉取，任一依赖变化重新请求
  const queueState = useAsync(
    () => listAdminWithdrawals(credential, status, { limit: PAGE_SIZE, offset }),
    [credential, status, offset],
  ); // 队列
  // 驳回表单状态：null 表示未展开，记录申请编号与驳回原因
  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null); // 驳回表单
  // 到账凭证表单状态：null 表示未展开，记录申请编号与打款凭证号
  const [paying, setPaying] = useState<{ id: string; ref: string } | null>(null); // 到账凭证表单
  // 错误提示文案：写操作失败时展示，空串表示无错误
  const [error, setError] = useState(''); // 错误
  // 成功提示文案：写操作成功后展示，空串表示无提示
  const [notice, setNotice] = useState(''); // 提示
  // 操作进行中标记：期间禁用各写按钮，避免重复提交
  const [busy, setBusy] = useState(false); // 操作中

  /** 统一包装：执行写操作后刷新队列，action 返回成功提示文案 */
  async function run(action: () => Promise<string>) {
    // 进入操作态并清掉旧提示，避免成功失败文案叠加
    setBusy(true);
    setError('');
    setNotice('');
    try {
      // 执行传入的写操作，拿到成功提示文案
      const done = await action();
      // 回填成功提示并收起两个内联表单
      setNotice(done);
      setRejecting(null);
      setPaying(null);
      // 重新拉取队列，让状态与金额变更反映到列表
      queueState.reload();
    } catch (err) {
      // 失败：翻译错误文案展示，操作态在 finally 复位
      setError(describeError(err));
    } finally {
      // 无论成败都退出操作态，恢复按钮可点
      setBusy(false);
    }
  }

  // 当前筛选下的队列行：缺省空数组保证渲染不抛错
  const queue = queueState.data?.items ?? []; // 当前筛选下的队列
  // 各状态计数：用于面板头汇总展示，缺省 undefined 由展示端兜底
  const summary = queueState.data?.summary; // 各状态计数
  // 当前筛选下的总数：驱动分页器区间与末页判定
  const total = queueState.data?.total ?? 0; // 当前筛选下的总数

  return (
    <div className="page">
      {/* 页头：标题与余额口径说明（充值余额不可提现） */}
      <header className="page-head">
        <h1>提现审核</h1>
        <p className="page-desc">可提现余额只累计佣金与创作分成，充值余额不可提现；通过时扣减余额并落提现流水，驳回已通过的申请会原路退回。</p>
      </header>

      {/* 只读权限提示：无写权限时提示只能查看队列 */}
      {!canWrite && <div className="panel hint">当前账号缺少 commerce:write 权限，只能查看队列。</div>}
      {/* 错误提示条：写操作失败时展示 */}
      {error && <div className="panel error">{error}</div>}
      {/* 成功提示条：写操作成功后展示 */}
      {notice && <div className="panel hint">{notice}</div>}

      <section className="panel">
        {/* 队列面板头：标题、各状态计数与手动刷新按钮 */}
        <div className="panel-head">
          <h3>申请队列</h3>
          <span className="muted">
            待审 {summary?.pending ?? 0} · 打款中 {summary?.approved ?? 0} · 已到账 {summary?.paid ?? 0}
          </span>
          <button type="button" className="btn ghost" onClick={queueState.reload}>刷新</button>
        </div>
        {/* 状态筛选标签：点击切换状态并回到第一页 */}
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

        {/* 队列加载中占位 */}
        {queueState.loading && <p className="muted">加载中…</p>}
        {/* 队列读取失败提示 */}
        {Boolean(queueState.error) && <p className="error">{describeError(queueState.error)}</p>}
        {/* 空队列提示：非加载 / 非错误且无行时展示 */}
        {queue.length === 0 && !queueState.loading && !queueState.error ? <p className="empty">当前筛选下没有提现申请</p> : null}

        {/* 队列卡片列表：每条申请一张卡片，承载信息与操作 */}
        {queue.map((row) => (
          <article className="panel" key={row.id} style={{ marginBottom: 12 }}>
            {/* 卡片头：申请人 / 金额与状态徽章 */}
            <div className="panel-head">
              <h3>{row.display_name || row.user_id} · {yuan(row.amount_cents)}</h3>
              <span className={`badge ${row.status === 'pending' ? 'warning' : 'success'}`}>{STATUS_LABEL[row.status]}</span>
            </div>
            {/* 卡片信息区：Mim ID、提现方式、收款人、账号、申请时间与审核留痕 */}
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

            {/* 操作区：待审 / 已通过且有写权限时展示审核按钮 */}
            {canWrite && (row.status === 'pending' || row.status === 'approved') && (
              <div className="deploy-columns">
                {/* 待审：通过按钮，二次确认后扣减可提现余额 */}
                {row.status === 'pending' && (
                  <button type="button" className="btn primary small" disabled={busy} onClick={() => { if (window.confirm(`确认通过 ${row.display_name || row.user_id} 的 ${yuan(row.amount_cents)} 提现？通过后立即扣减可提现余额。`)) void run(async () => { await approveWithdrawal(credential, row.id); return `已通过 ${yuan(row.amount_cents)}`; }); }}>通过</button>
                )}
                {/* 已通过：标记到账按钮，展开凭证录入表单 */}
                {row.status === 'approved' && (
                  <button type="button" className="btn primary small" disabled={busy} onClick={() => setPaying({ id: row.id, ref: '' })}>标记到账</button>
                )}
                {/* 驳回按钮：展开驳回原因内联表单 */}
                <button type="button" className="btn ghost small" disabled={busy} onClick={() => setRejecting({ id: row.id, reason: '' })}>驳回</button>
              </div>
            )}

            {/* 驳回表单：仅当前卡片展开，原因必填后确认驳回 */}
            {rejecting?.id === row.id && (
              <div className="form inline" style={{ marginTop: 10 }}>
                <label className="grow">驳回原因<input value={rejecting.reason} onChange={(event) => setRejecting({ ...rejecting, reason: event.target.value })} placeholder="必填，将展示给申请人" /></label>
                <button type="button" className="btn primary" disabled={busy || rejecting.reason.trim().length === 0} onClick={() => void run(async () => { await rejectWithdrawal(credential, row.id, rejecting.reason.trim()); return '已驳回并释放额度'; })}>确认驳回</button>
                <button type="button" className="btn ghost" onClick={() => setRejecting(null)}>取消</button>
              </div>
            )}

            {/* 到账凭证表单：仅当前卡片展开，凭证号必填后确认到账 */}
            {paying?.id === row.id && (
              <div className="form inline" style={{ marginTop: 10 }}>
                <label className="grow">打款凭证号<input value={paying.ref} onChange={(event) => setPaying({ ...paying, ref: event.target.value })} placeholder="线下打款流水号 / 渠道单号" /></label>
                <button type="button" className="btn primary" disabled={busy || paying.ref.trim().length === 0} onClick={() => void run(async () => { await markWithdrawalPaid(credential, row.id, paying.ref.trim()); return '已标记到账'; })}>确认到账</button>
                <button type="button" className="btn ghost" onClick={() => setPaying(null)}>取消</button>
              </div>
            )}
          </article>
        ))}

        {/* 分页器：上一页 / 区间展示 / 下一页，按 PAGE_SIZE 步进 */}
        <div className="pager">
          <button className="btn ghost" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>上一页</button>
          <span className="muted">{total === 0 ? '0 / 0' : `${offset + 1}-${Math.min(offset + PAGE_SIZE, total)} / ${total}`}</span>
          <button className="btn ghost" type="button" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>下一页</button>
        </div>
      </section>

      {/* 创作分成批量结算区：把过保护期的待结算分成并入可提现余额，幂等不二次入账 */}
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
