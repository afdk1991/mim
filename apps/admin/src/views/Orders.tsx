// 订单管理：全部商城订单只读总览，处理动作收敛在「发货与售后」
import { useState } from 'react';
import { describeError } from '../api';
import type { Credential } from '../api';
import { listShipmentOrders } from '../api-shop-admin';
import type { AdminShipmentOrderRow, ShipmentFilter } from '../api-shop-admin';
import { useAsync } from '../hooks';

/** 入参：凭证与实时权限码 */
interface Props {
  credential: Credential;
  permissions: string[];
}

/** 订单状态中文口径：与 shop_orders.status 一一对应 */
const STATUS_LABEL: Record<string, string> = {
  pending: '待支付',
  paid: '已支付',
  delivered: '已签收',
  refunded: '已退款',
  cancelled: '已取消',
};

/** 分转元，保留两位小数 */
function formatYuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

/** 订单管理主视图 */
export function Orders({ credential }: Props) {
  // all 由后端按「全部」处理，避免前端并发拉取五种状态
  const state = useAsync(() => listShipmentOrders(credential, 'all' as ShipmentFilter, 100), [credential]);
  const [keyword, setKeyword] = useState('');

  // 全量行：用于区分「确实没有订单」与「搜索无匹配」两种空态
  const allRows = state.data ?? [];
  const rows = allRows.filter((row) => {
    const q = keyword.trim().toLowerCase();
    if (!q) return true;
    return (
      row.id.toLowerCase().includes(q) ||
      row.product_name.toLowerCase().includes(q) ||
      row.product_code.toLowerCase().includes(q) ||
      (row.user_nickname ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="page">
      <header className="page-head">
        <h1>订单管理</h1>
        <p className="page-desc">这里按时间倒序查看全部商城订单与支付状态；发货、签收与售后处理请进入「发货与售后」。</p>
      </header>

      <div className="panel">
        <div className="panel-head">
          <h3>订单总览</h3>
          <span className="muted">共 {rows.length} 条</span>
        </div>

        <div className="row">
          <input
            aria-label="搜索订单"
            placeholder="搜索订单号 / 商品 / 用户"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>

        {state.loading ? <p className="muted">加载中…</p> : null}
        {state.error ? <div className="error">{describeError(state.error)}</div> : null}
        {!state.loading && !state.error && rows.length === 0 ? (
          allRows.length === 0 ? (
            <div className="empty">
              当前没有订单。商城还没有产生订单，用户下单后才会出现在这里；可先到「商品管理」确认商品已上架。
            </div>
          ) : (
            <div className="empty">没有匹配的订单，换个关键词试试。</div>
          )
        ) : null}

        {rows.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>订单</th>
                <th>商品</th>
                <th>用户</th>
                <th>实付</th>
                <th>状态</th>
                <th>下单时间</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row: AdminShipmentOrderRow) => (
                <tr key={row.id}>
                  <td>
                    <code>{row.id.slice(0, 12)}</code>
                  </td>
                  <td>
                    {row.product_name}
                    <div className="muted">{row.product_code}</div>
                  </td>
                  <td>{row.user_nickname ?? row.user_id}</td>
                  <td>
                    {formatYuan(row.payable_cents)} × {row.quantity}
                  </td>
                  <td>
                    <span className={row.status === 'paid' ? 'badge' : 'badge draft'}>
                      {STATUS_LABEL[row.status] ?? row.status}
                    </span>
                  </td>
                  <td className="muted">{row.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
