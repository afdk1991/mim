// 邀请码管理视图：批量生成、统计、列表禁用与核销记录查询
import { useState } from 'react'; // 表单状态
import type { Credential, InviteRedemption, InviteRow, InviteStats } from '../api'; // 类型
import { createInvites, describeError, disableInvite, listInviteRedemptions, listInvites } from '../api'; // 邀请码 API
import { useAsync } from '../hooks'; // 统一异步加载

interface Props { // 组件入参
  credential: Credential; // 当前凭证
  permissions: string[]; // 权限集合
} // Props 结束

/** 邀请码管理主体 */
export function Invites({ credential, permissions }: Props) { // 业务步骤
  const canRead = permissions.includes('user:read'); // 列表读权限
  const canWrite = permissions.includes('rbac:write'); // 生成 / 禁用权限
  const listState = useAsync(() => (canRead ? listInvites(credential) : Promise.resolve({ invites: [] as InviteRow[], stats: { total: 0, active: 0, redemptions: 0 } as InviteStats })), [credential, canRead]); // 列表与统计
  const [redemptions, setRedemptions] = useState<InviteRedemption[]>([]); // 核销记录
  const [filter, setFilter] = useState(''); // 核销过滤码
  const [count, setCount] = useState('5'); // 批量数量
  const [maxUses, setMaxUses] = useState('1'); // 每码可用次数
  const [days, setDays] = useState('30'); // 有效期天数
  const [note, setNote] = useState(''); // 备注
  const [generated, setGenerated] = useState<string[]>([]); // 本次生成结果
  const [error, setError] = useState(''); // 错误提示
  const [notice, setNotice] = useState(''); // 成功提示
  const [busy, setBusy] = useState(false); // 操作中

  /** 生成邀请码：成功后回显明文码，便于复制分发 */
  async function generate() {
    setBusy(true); // 进入忙碌态
    setError(''); // 清空错误
    setNotice(''); // 清空提示
    try { // 业务步骤
      const rows = await createInvites(credential, { // 业务步骤
        count: Math.max(1, Math.min(100, Number(count) || 1)), // 数量夹在 1–100
        max_uses: Math.max(1, Number(maxUses) || 1), // 可用次数至少 1
        expires_in_days: Math.max(0, Number(days) || 0) || undefined, // 0 表示长期
        note: note.trim() || undefined, // 备注可选
      });
      setGenerated(rows.map((row) => row.code)); // 回显本次码
      setNotice(`已生成 ${rows.length} 枚邀请码`); // 结果摘要
      listState.reload(); // 刷新列表与统计
    } catch (err) {
      setError(describeError(err)); // 统一错误
    } finally {
      setBusy(false); // 退出忙碌态
    } // 业务步骤
  } // generate 结束

  /** 查询核销记录 */
  async function loadRedemptions() {
    setBusy(true); // 进入忙碌态
    setError(''); // 清空错误
    try { // 业务步骤
      setRedemptions(await listInviteRedemptions(credential, filter.trim() || undefined)); // 带可选码过滤
    } catch (err) {
      setError(describeError(err)); // 统一错误
    } finally {
      setBusy(false); // 退出忙碌态
    } // 业务步骤
  } // loadRedemptions 结束

  const stats = listState.data?.stats; // 统计快照
  const invites = listState.data?.invites ?? []; // 码列表

  return ( // 返回当前函数的处理结果
    <div className="page">{/* 执行当前业务步骤 */}
      <header className="page-head">{/* 执行当前业务步骤 */}
        <h1>邀请码管理</h1>
        <p className="muted">注册准入码：批量生成、绑定手机 / 邮箱、限制次数与有效期，并保留逐次核销审计。</p>
      </header>

      {!canRead && <div className="panel error">当前账号缺少 user:read 权限。</div>}
      {error && <div className="panel error">{error}</div>}
      {notice && <div className="panel hint">{notice}</div>}

      <section className="cards">{/* 执行当前业务步骤 */}
        <div className="card"><div className="card-label">码总量</div><div className="card-value">{stats?.total ?? 0}</div></div>
        <div className="card"><div className="card-label">活跃码</div><div className="card-value">{stats?.active ?? 0}</div></div>
        <div className="card"><div className="card-label">核销次数</div><div className="card-value">{stats?.redemptions ?? 0}</div></div>
      </section>

      <section className="panel">{/* 执行当前业务步骤 */}
        <div className="panel-head"><h3>批量生成</h3></div>
        <div className="form inline">{/* 执行当前业务步骤 */}
          <label>数量<input value={count} onChange={(event) => setCount(event.target.value)} inputMode="numeric" /></label>
          <label>每码可用次数<input value={maxUses} onChange={(event) => setMaxUses(event.target.value)} inputMode="numeric" /></label>
          <label>有效期（天）<input value={days} onChange={(event) => setDays(event.target.value)} inputMode="numeric" placeholder="0 表示长期" /></label>
          <label className="grow">备注<input value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <button type="button" className="btn primary" disabled={busy || !canWrite} onClick={() => void generate()}>{busy ? '生成中…' : '生成'}</button>
        </div>
        {generated.length > 0 && (
          <div className="panel hint">{/* 执行当前业务步骤 */}
            <div className="panel-head"><h3>本次生成</h3><button type="button" className="btn ghost" onClick={() => void navigator.clipboard?.writeText(generated.join('\n'))}>复制全部</button></div>
            <div className="perm-grid">{generated.map((code) => <span className="perm-item" key={code}>{code}</span>)}</div>
          </div>
        )}
      </section>

      <section className="panel">{/* 执行当前业务步骤 */}
        <div className="panel-head"><h3>邀请码列表</h3><button type="button" className="btn ghost" onClick={listState.reload}>刷新</button></div>
        {listState.loading && <p className="muted">加载中…</p>}
        {Boolean(listState.error) && <p className="error">{describeError(listState.error)}</p>}
        {invites.length === 0 && !listState.loading ? <p className="empty">暂无邀请码</p> : null}
        {invites.length > 0 && (
          <div className="table-wrap">{/* 执行当前业务步骤 */}
            <table className="table">{/* 执行当前业务步骤 */}
              <thead><tr><th>邀请码</th><th>使用</th><th>状态</th><th>有效期</th><th>备注</th><th>操作</th></tr></thead>
              <tbody>{/* 执行当前业务步骤 */}
                {invites.map((row) => (
                  <tr key={row.id}>{/* 执行当前业务步骤 */}
                    <td><strong>{row.code}</strong>{row.bound_identifier ? <div className="muted">绑定 {row.bound_identifier}</div> : null}</td>
                    <td>{row.used_count} / {row.max_uses}</td>
                    <td><span className={`badge ${row.status === 'active' ? 'success' : row.status === 'exhausted' ? 'warning' : 'danger'}`}>{row.status}</span></td>
                    <td>{row.expires_at ? row.expires_at.slice(0, 10) : '长期'}</td>
                    <td>{row.note ?? '—'}</td>
                    <td>{/* 执行当前业务步骤 */}
                      {row.status === 'active' && (
                        <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => void (async () => {{/* 执行当前业务步骤 */}
                          setBusy(true); // 操作中
                          setError(''); // 清空错误
                          try { // 业务步骤
                            await disableInvite(credential, row.code); // 禁用
                            setNotice(`已禁用 ${row.code}`); // 成功提示
                            listState.reload(); // 刷新
                          } catch (err) {
                            setError(describeError(err)); // 错误
                          } finally {
                            setBusy(false); // 退出
                          } // 业务步骤
                        })()}>禁用</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">{/* 执行当前业务步骤 */}
        <div className="panel-head"><h3>核销记录</h3></div>
        <div className="form inline">{/* 执行当前业务步骤 */}
          <label className="grow">邀请码过滤<input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="留空查看全部" /></label>
          <button type="button" className="btn primary" disabled={busy || !canRead} onClick={() => void loadRedemptions()}>查询</button>
        </div>
        {redemptions.length === 0 ? <p className="empty">尚未查询或暂无记录</p> : (
          <div className="table-wrap">{/* 执行当前业务步骤 */}
            <table className="table">{/* 执行当前业务步骤 */}
              <thead><tr><th>邀请码</th><th>用户</th><th>注册标识</th><th>核销时间</th></tr></thead>
              <tbody>{redemptions.map((row) => <tr key={row.id}><td>{row.code}</td><td>{row.user_id}</td><td>{row.identifier ?? '—'}</td><td>{row.created_at.slice(0, 16)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  ); // 执行当前业务步骤
} // Invites 结束
