// 商品管理：商品台账、上架状态与单价维护（批量调价走「批量改价」）
import { useState } from 'react';
import { describeError } from '../api';
import type { Credential } from '../api';
import { listAdminProducts, updateAdminProduct } from '../api-shop-admin';
import type { AdminProduct } from '../api-shop-admin';
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

/** 商品管理主视图 */
export function Products({ credential, permissions }: Props) {
  const canWrite = permissions.includes('commerce:write');
  const state = useAsync(() => listAdminProducts(credential), [credential]);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});

  /** 保存单行单价 */
  async function savePrice(row: AdminProduct) {
    const raw = priceDraft[row.code] ?? (row.price_cents / 100).toFixed(2);
    const yuan = Number(raw);
    if (!Number.isFinite(yuan) || yuan < 0) {
      setError('单价需为不小于 0 的数字');
      return;
    }
    setBusyCode(row.code);
    setError('');
    setNotice('');
    try {
      await updateAdminProduct(credential, row.code, { price_cents: Math.round(yuan * 100) });
      setNotice(`已更新 ${row.name} 的单价`);
      state.reload();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusyCode(null);
    }
  }

  /** 切换上架 / 下架 */
  async function toggleStatus(row: AdminProduct) {
    setBusyCode(row.code);
    setError('');
    setNotice('');
    try {
      const next = row.status === 'active' ? 'off' : 'active';
      await updateAdminProduct(credential, row.code, { status: next });
      setNotice(`${row.name} 已${next === 'active' ? '上架' : '下架'}`);
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
        <h2>商品管理</h2>
        <p className="page-desc">这里维护商城商品的台账、上架状态与单价；需要整批调价时改用「批量改价」，避免逐个改动。</p>
      </header>

      {!canWrite ? <div className="hint">当前身份只有只读权限，无法修改商品。</div> : null}
      {notice ? <div className="success">{notice}</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <div className="panel">
        <div className="panel-head">
          <h3>全部商品</h3>
          <span className="muted">共 {rows.length} 个</span>
        </div>

        {state.loading ? <p className="muted">加载中…</p> : null}
        {state.error ? <div className="error">{describeError(state.error)}</div> : null}
        {!state.loading && !state.error && rows.length === 0 ? <div className="empty">还没有登记商品</div> : null}

        {rows.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>商品</th>
                <th>类型</th>
                <th>单价</th>
                <th>可售 / 库存</th>
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
                  <td>{row.kind === 'physical' ? '实物' : row.kind === 'virtual_auto' ? '虚拟自动' : '虚拟人工'}</td>
                  <td>
                    {canWrite ? (
                      <input
                        aria-label={`${row.name} 单价`}
                        value={priceDraft[row.code] ?? (row.price_cents / 100).toFixed(2)}
                        onChange={(event) => setPriceDraft((prev) => ({ ...prev, [row.code]: event.target.value }))}
                        inputMode="decimal"
                        size={7}
                      />
                    ) : (
                      formatYuan(row.price_cents)
                    )}
                  </td>
                  <td>
                    {row.available} / {row.kind === 'virtual_auto' ? row.key_count : row.stock}
                  </td>
                  <td>
                    <span className={row.status === 'active' ? 'badge' : 'badge draft'}>
                      {row.status === 'active' ? '在售' : '已下架'}
                    </span>
                  </td>
                  <td>
                    {canWrite ? (
                      <div className="row">
                        <button
                          className="btn ghost"
                          type="button"
                          disabled={busyCode === row.code}
                          onClick={() => savePrice(row)}
                        >
                          保存价
                        </button>
                        <button
                          className="btn ghost"
                          type="button"
                          disabled={busyCode === row.code}
                          onClick={() => toggleStatus(row)}
                        >
                          {row.status === 'active' ? '下架' : '上架'}
                        </button>
                      </div>
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
