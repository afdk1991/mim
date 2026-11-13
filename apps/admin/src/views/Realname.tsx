// 实名审核队列：脱敏信息审阅、通过 / 驳回流转
import { useState } from 'react'; // 驳回输入状态
import type { Credential, RealnameQueueItem } from '../api'; // 类型
import { describeError, listRealnameQueue, reviewRealname } from '../api'; // 实名 API
import { useAsync } from '../hooks'; // 统一异步加载

interface Props { // 入参
  credential: Credential; // 凭证
  permissions: string[]; // 权限
} // Props 结束

/** 证件类型中文名 */
const ID_TYPE: Record<string, string> = { id_card: '身份证', passport: '护照', other: '其他证件' }; // 类型文案

/** 实名审核视图主体 */
export function Realname({ credential, permissions }: Props) { // 业务步骤
  const canRead = permissions.includes('user:read'); // 队列读权限
  const canReview = permissions.includes('rbac:write'); // 审核写权限
  const queueState = useAsync(() => (canRead ? listRealnameQueue(credential) : Promise.resolve<RealnameQueueItem[]>([])), [credential, canRead]); // 待审队列
  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null); // 驳回表单
  const [error, setError] = useState(''); // 错误
  const [notice, setNotice] = useState(''); // 提示
  const [busy, setBusy] = useState(false); // 操作中

  /** 执行审核：通过无原因，驳回原因必填 */
  async function review(id: string, decision: 'approve' | 'reject', reason?: string) {
    setBusy(true); // 进入忙碌态
    setError(''); // 清空错误
    setNotice(''); // 清空提示
    try { // 业务步骤
      await reviewRealname(credential, id, { decision, reason: reason?.trim() || undefined }); // 提交审核
      setNotice(decision === 'approve' ? '已通过实名审核' : '已驳回实名申请'); // 结果提示
      setRejecting(null); // 收起驳回表单
      queueState.reload(); // 刷新队列
    } catch (err) {
      setError(describeError(err)); // 统一错误
    } finally {
      setBusy(false); // 退出忙碌态
    } // 业务步骤
  } // review 结束

  const queue = queueState.data ?? []; // 队列数据

  return ( // 返回当前函数的处理结果
    <div className="page">{/* 执行当前业务步骤 */}
      <header className="page-head">{/* 执行当前业务步骤 */}
        <h1>实名审核</h1>
        <p className="muted">证件明文不入库，仅展示脱敏姓名与证件后四位；按提交时间先到先审。</p>
      </header>

      {!canRead && <div className="panel error">当前账号缺少 user:read 权限。</div>}
      {!canReview && canRead && <div className="panel hint">当前账号可查看队列，但没有 rbac:write 权限，不能执行审核。</div>}
      {error && <div className="panel error">{error}</div>}
      {notice && <div className="panel hint">{notice}</div>}

      <section className="panel">{/* 执行当前业务步骤 */}
        <div className="panel-head"><h3>待审队列</h3><span className="muted">{queue.length} 条</span><button type="button" className="btn ghost" onClick={queueState.reload}>刷新</button></div>
        {queueState.loading && <p className="muted">加载中…</p>}
        {Boolean(queueState.error) && <p className="error">{describeError(queueState.error)}</p>}
        {queue.length === 0 && !queueState.loading ? <p className="empty">暂无待审实名申请</p> : null}
        {queue.map((row) => (
          <article className="panel" key={row.id} style={{ marginBottom: 12 }}>{/* 执行当前业务步骤 */}
            <div className="panel-head"><h3>{row.name_masked} · {ID_TYPE[row.id_type] ?? row.id_type}</h3><span className="badge warning">{row.status}</span></div>
            <div className="deploy-kv">{/* 执行当前业务步骤 */}
              <span>证件后四位 {row.id_last4}</span>
              <span>用户 {row.user_id}</span>
              <span>通道 {row.provider}</span>
              <span>提交 {row.created_at.slice(0, 16)}</span>
            </div>
            <div className="deploy-columns">{/* 执行当前业务步骤 */}
              <button type="button" className="btn primary small" disabled={busy || !canReview} onClick={() => void review(row.id, 'approve')}>通过</button>
              <button type="button" className="btn ghost small" disabled={busy || !canReview} onClick={() => setRejecting({ id: row.id, reason: '' })}>驳回</button>
            </div>
            {rejecting?.id === row.id && (
              <div className="form inline" style={{ marginTop: 10 }}>{/* 执行当前业务步骤 */}
                <label className="grow">驳回原因<input value={rejecting.reason} onChange={(event) => setRejecting({ ...rejecting, reason: event.target.value })} placeholder="必填，将展示给申请人" /></label>
                <button type="button" className="btn primary" disabled={busy || rejecting.reason.trim().length === 0} onClick={() => void review(row.id, 'reject', rejecting.reason)}>确认驳回</button>
                <button type="button" className="btn ghost" onClick={() => setRejecting(null)}>取消</button>
              </div>
            )}
          </article>
        ))}
      </section>
    </div>
  ); // 执行当前业务步骤
} // Realname 结束
