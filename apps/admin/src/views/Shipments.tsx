// 发货与售后工作台：待发货录单 → 已发货推进 → 已签收，以及售后退款审批
// 订单状态不新增 shipped（CHECK 约束固定），已发货由 shipments 行派生
import type { FormEvent } from 'react'; // 表单事件类型
import { useState } from 'react'; // 过滤、录单与售后处理状态
import type { Credential } from '../api';
import { describeError } from '../api';
import type {
  AdminAfterSalesRow,
  AdminShipmentOrderRow,
  ShipmentFilter,
  ShipmentStatus,
} from '../api-shop-admin';
import {
  createShipment,
  handleAfterSales,
  listAfterSales,
  listShipmentOrders,
  updateShipment,
} from '../api-shop-admin';
import { useAsync } from '../hooks'; // 统一 loading / error / reload

// 发货筛选页签：覆盖运营日常关注的三个档位
const FILTER_TABS: Array<{ value: ShipmentFilter; label: string }> = [
  { value: 'to_ship', label: '待发货' },
  { value: 'shipped', label: '已发货' },
  { value: 'delivered', label: '已签收' },
];

// 物流状态中文名
const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  pending: '待揽收',
  picked: '已揽收',
  transit: '运输中',
  delivered: '已签收',
  exception: '异常',
};

// 售后类型中文名
const AFTER_SALES_KIND_LABEL: Record<string, string> = {
  refund_only: '仅退款',
  return_refund: '退货退款',
  repair: '维修',
};

// 售后状态中文名
const AFTER_SALES_STATUS_LABEL: Record<string, string> = {
  pending: '待处理',
  approved: '已同意',
  rejected: '已驳回',
  cancelled: '已撤销',
};

// 金额格式化：分转元
function formatYuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

// 组件入参
interface ShipmentsProps {
  credential: Credential;
  permissions: string[];
}

/** 发货与售后工作台 */
export function Shipments({ credential, permissions }: ShipmentsProps) {
  // 写权限：与后端 requirePermission('commerce:write') 对齐
  const canWrite = permissions.includes('commerce:write');
  // 当前发货页签
  const [filter, setFilter] = useState<ShipmentFilter>('to_ship');

  // 订单列表：无写权限时不发请求
  const listState = useAsync<AdminShipmentOrderRow[]>(
    () => (canWrite ? listShipmentOrders(credential, filter) : Promise.resolve([])),
    [credential, canWrite, filter],
  );

  // 录单表单：订单 ID / 物流公司 / 运单号
  const [shipOrderId, setShipOrderId] = useState('');
  const [carrier, setCarrier] = useState('');
  const [trackingNo, setTrackingNo] = useState('');
  // 录单在途与错误
  const [shipping, setShipping] = useState(false);
  const [shipError, setShipError] = useState<string | null>(null);
  // 状态推进在途的物流单 ID，避免重复点击
  const [advancingId, setAdvancingId] = useState<string | null>(null);

  // 售后列表：默认待处理
  const [afterSalesAll, setAfterSalesAll] = useState(false);
  const afterSalesState = useAsync<AdminAfterSalesRow[]>(
    () => (canWrite ? listAfterSales(credential, afterSalesAll ? 'all' : 'pending') : Promise.resolve([])),
    [credential, canWrite, afterSalesAll],
  );
  // 售后处理在途与错误
  const [handlingId, setHandlingId] = useState<string | null>(null);
  const [afterSalesError, setAfterSalesError] = useState<string | null>(null);
  // 处理备注
  const [handleNote, setHandleNote] = useState('');

  // 行内「填写单号」：把订单 ID 与收货信息填进表单，减少手抄错误
  function fillOrder(row: AdminShipmentOrderRow) {
    setShipOrderId(row.id);
    setShipError(null);
    setCarrier('');
    setTrackingNo('');
  }

  // 提交录单：建发货单并默认推进为运输中
  async function submitShip(event: FormEvent) {
    event.preventDefault();
    setShipError(null);
    const orderId = shipOrderId.trim();
    if (!orderId || !carrier.trim() || !trackingNo.trim()) {
      setShipError('订单 ID、物流公司、运单号均为必填');
      return;
    }
    setShipping(true);
    try {
      await createShipment(credential, orderId, {
        carrier: carrier.trim(),
        tracking_no: trackingNo.trim(),
        status: 'transit',
      });
      setShipOrderId('');
      setCarrier('');
      setTrackingNo('');
      listState.reload();
    } catch (error) {
      setShipError(describeError(error));
    } finally {
      setShipping(false);
    }
  }

  // 推进单个物流单状态
  async function advance(shipmentId: string, status: ShipmentStatus) {
    setAdvancingId(shipmentId);
    try {
      await updateShipment(credential, shipmentId, { status });
      listState.reload();
    } catch (error) {
      setShipError(describeError(error));
    } finally {
      setAdvancingId(null);
    }
  }

  // 处理售后：同意即退款入余额
  async function handleRequest(id: string, action: 'approve' | 'reject') {
    setAfterSalesError(null);
    setHandlingId(id);
    try {
      await handleAfterSales(credential, id, { action, note: handleNote.trim() || undefined });
      setHandleNote('');
      afterSalesState.reload();
      listState.reload();
    } catch (error) {
      setAfterSalesError(describeError(error));
    } finally {
      setHandlingId(null);
    }
  }

  const rows = listState.data ?? [];
  const afterSalesRows = afterSalesState.data ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <h2>发货与售后</h2>
        <span className="count">待发货 → 录入运单（已发货）→ 签收；售后退款退回钱包余额</span>
      </div>

      {!canWrite ? (
        <div className="hint">当前身份缺少 commerce:write 权限，无法操作发货与售后</div>
      ) : (
        <>
          <div className="panel">
            <div className="panel-head">
              <h3>发货任务</h3>
              <span className="muted">共 {rows.length} 条</span>
            </div>
            <div className="row">
              {FILTER_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  className={tab.value === filter ? 'btn primary' : 'btn ghost'}
                  onClick={() => setFilter(tab.value)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {listState.loading ? <p className="muted">加载中…</p> : null}
            {listState.error ? <div className="error">{describeError(listState.error)}</div> : null}
            {!listState.loading && !listState.error && rows.length === 0 ? (
              <div className="empty">当前页签没有订单</div>
            ) : null}

            {rows.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>订单</th>
                    <th>商品</th>
                    <th>收货信息</th>
                    <th>物流</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <code>{row.id.slice(0, 12)}</code>
                        <div className="muted">{row.created_at}</div>
                        <div className="muted">
                          {formatYuan(row.payable_cents)} × {row.quantity}
                        </div>
                      </td>
                      <td>
                        {row.product_name}
                        <div className="muted">{row.product_code}</div>
                      </td>
                      <td>
                        {row.shipping ? (
                          <>
                            {row.shipping.name} {row.shipping.phone}
                            <div className="muted">{row.shipping.address}</div>
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                        {row.user_nickname ? <div className="muted">用户 {row.user_nickname}</div> : null}
                      </td>
                      <td>
                        {row.shipment_id ? (
                          <>
                            {row.carrier} {row.tracking_no}
                            <div className="muted">
                              {SHIPMENT_STATUS_LABEL[row.shipment_status ?? 'pending'] ?? row.shipment_status}
                              {row.shipped_at ? ` · ${row.shipped_at}` : ''}
                            </div>
                          </>
                        ) : (
                          <span className="badge draft">待发货</span>
                        )}
                      </td>
                      <td>
                        {!row.shipment_id ? (
                          <button className="btn ghost" type="button" onClick={() => fillOrder(row)}>
                            填写单号
                          </button>
                        ) : null}
                        {row.shipment_id && row.shipment_status !== 'delivered' ? (
                          <>
                            <button
                              className="btn ghost"
                              type="button"
                              disabled={advancingId === row.shipment_id}
                              onClick={() => void advance(row.shipment_id!, 'delivered')}
                            >
                              标记签收
                            </button>
                            <button
                              className="btn ghost"
                              type="button"
                              disabled={advancingId === row.shipment_id}
                              onClick={() => void advance(row.shipment_id!, 'exception')}
                            >
                              标记异常
                            </button>
                          </>
                        ) : null}
                        {row.after_sales_pending > 0 ? <div className="muted">售后待处理 {row.after_sales_pending}</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>录入运单</h3>
            </div>
            <form className="form" onSubmit={(event) => void submitShip(event)}>
              <label className="field">
                <span>订单 ID</span>
                <input value={shipOrderId} onChange={(event) => setShipOrderId(event.target.value)} placeholder="order-xxx" disabled={shipping} />
              </label>
              <label className="field">
                <span>物流公司</span>
                <input value={carrier} onChange={(event) => setCarrier(event.target.value)} placeholder="如：顺丰速运" disabled={shipping} />
              </label>
              <label className="field">
                <span>运单号</span>
                <input value={trackingNo} onChange={(event) => setTrackingNo(event.target.value)} placeholder="如：SF1234567890" disabled={shipping} />
              </label>
              {shipError ? <div className="error">{shipError}</div> : null}
              <div className="row">
                <button className="btn primary" type="submit" disabled={shipping}>
                  {shipping ? '提交中…' : '发货'}
                </button>
              </div>
            </form>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>售后申请</h3>
              <button className="btn ghost" type="button" onClick={() => setAfterSalesAll((value) => !value)}>
                {afterSalesAll ? '仅看待处理' : '查看全部'}
              </button>
            </div>
            {afterSalesState.loading ? <p className="muted">加载中…</p> : null}
            {afterSalesState.error ? <div className="error">{describeError(afterSalesState.error)}</div> : null}
            {!afterSalesState.loading && !afterSalesState.error && afterSalesRows.length === 0 ? (
              <div className="empty">没有售后申请</div>
            ) : null}

            {afterSalesRows.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>申请</th>
                    <th>订单 / 商品</th>
                    <th>理由</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {afterSalesRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <code>{row.id.slice(0, 10)}</code>
                        <div className="muted">{AFTER_SALES_KIND_LABEL[row.kind] ?? row.kind}</div>
                        <div className="muted">{row.created_at}</div>
                      </td>
                      <td>
                        <code>{row.order_id.slice(0, 12)}</code>
                        <div className="muted">{row.product_name}</div>
                        <div className="muted">
                          实付 {formatYuan(row.payable_cents)} · 订单 {row.order_status}
                        </div>
                      </td>
                      <td>{row.reason}</td>
                      <td>
                        <span className="badge draft">{AFTER_SALES_STATUS_LABEL[row.status] ?? row.status}</span>
                        {row.admin_note ? <div className="muted">{row.admin_note}</div> : null}
                      </td>
                      <td>
                        {row.status === 'pending' ? (
                          <>
                            <input
                              value={handleNote}
                              onChange={(event) => setHandleNote(event.target.value)}
                              placeholder="处理备注（选填）"
                              style={{ maxWidth: 180 }}
                            />
                            <div className="row">
                              <button
                                className="btn primary"
                                type="button"
                                disabled={handlingId === row.id}
                                onClick={() => void handleRequest(row.id, 'approve')}
                              >
                                同意退款
                              </button>
                              <button
                                className="btn ghost"
                                type="button"
                                disabled={handlingId === row.id}
                                onClick={() => void handleRequest(row.id, 'reject')}
                              >
                                驳回
                              </button>
                            </div>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {afterSalesError ? <div className="error">{afterSalesError}</div> : null}
          </div>
        </>
      )}
    </div>
  );
}
