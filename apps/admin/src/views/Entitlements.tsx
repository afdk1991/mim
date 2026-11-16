// 权益：会员套餐、价格档位与权益清单维护
import { useState } from 'react';
import { describeError } from '../api';
import type { Credential } from '../api';
import { listAdminVipPlans, updateAdminVipPlan } from '../api-shop-admin';
import type { AdminVipPlan } from '../api-shop-admin';
import { useAsync } from '../hooks';

/** 入参：凭证与实时权限码 */
interface Props {
  credential: Credential;
  permissions: string[];
}

/** 分转元，保留两位小数 */
function formatYuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

/** 权益主视图 */
export function Entitlements({ credential, permissions }: Props) {
  const canWrite = permissions.includes('commerce:write');
  const state = useAsync(() => listAdminVipPlans(credential), [credential]);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  /** 切换套餐启停：下架后前台不再展示、不可新购 */
  async function toggle(row: AdminVipPlan) {
    setBusyCode(row.code);
    setError('');
    setNotice('');
    try {
      await updateAdminVipPlan(credential, row.code, { active: !row.active });
      setNotice(`${row.name} 已${row.active ? '停用' : '启用'}`);
      state.reload();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusyCode(null);
    }
  }

  const rows = state.data ?? [];

  return (
    <div className="page">
      <header className="page-head">
        <h2>权益</h2>
        <p className="page-desc">这里查看会员套餐的等级、价格、有效期与权益清单，并控制套餐是否在前台开放购买。</p>
      </header>

      {!canWrite ? <div className="hint">当前身份只有只读权限，无法启停套餐。</div> : null}
      {notice ? <div className="success">{notice}</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <div className="panel">
        <div className="panel-head">
          <h3>会员套餐</h3>
          <span className="muted">共 {rows.length} 个</span>
        </div>

        {state.loading ? <p className="muted">加载中…</p> : null}
        {state.error ? <div className="error">{describeError(state.error)}</div> : null}
        {!state.loading && !state.error && rows.length === 0 ? <div className="empty">还没有配置会员套餐</div> : null}

        {rows.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>套餐</th>
                <th>等级</th>
                <th>价格</th>
                <th>有效期</th>
                <th>权益清单</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.name}
                    <div className="muted">
                      <code>{row.code}</code>
                    </div>
                  </td>
                  <td>Lv.{row.level}</td>
                  <td>{formatYuan(row.price_cents)}</td>
                  <td>{row.duration_days} 天</td>
                  <td>
                    {row.perks.length > 0 ? row.perks.join('、') : <span className="muted">未填写</span>}
                  </td>
                  <td>
                    <span className={row.active ? 'badge' : 'badge draft'}>{row.active ? '开放' : '停用'}</span>
                  </td>
                  <td>
                    {canWrite ? (
                      <button
                        className="btn ghost"
                        type="button"
                        disabled={busyCode === row.code}
                        onClick={() => toggle(row)}
                      >
                        {row.active ? '停用' : '启用'}
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
