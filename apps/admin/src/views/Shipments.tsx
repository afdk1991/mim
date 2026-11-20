// 发货与售后工作台：待发货录单 → 已发货推进 → 已签收，以及售后退款审批
// 订单状态不新增 shipped（CHECK 约束固定），已发货由 shipments 行派生
// 引入 React 表单事件类型：约束提交事件入参
import type { FormEvent } from 'react'; // 表单事件类型
// 引入 React 状态钩子：维护筛选、录单与售后处理状态
import { useState } from 'react'; // 过滤、录单与售后处理状态
// 引入凭证类型：约束组件入参会话凭证结构
import type { Credential } from '../api';
// 引入错误文案翻译器：把后端错误对象转成可读提示
import { describeError } from '../api';
// 引入后台售后 / 发货订单行与筛选 / 物流状态类型
import type {
  AdminAfterSalesRow, // 售后申请行类型
  AdminShipmentOrderRow, // 发货订单行类型
  ShipmentFilter, // 发货筛选页签取值
  ShipmentStatus, // 物流状态枚举
} from '../api-shop-admin';
// 引入发货与售后接口：录单、推进、售后审批与两类列表
import {
  createShipment, // 新建发货单
  handleAfterSales, // 审批售后申请
  listAfterSales, // 售后申请列表
  listShipmentOrders, // 发货订单列表
  updateShipment, // 推进物流单状态
} from '../api-shop-admin';
// 引入异步数据钩子：统一封装加载中 / 错误 / 刷新
import { useAsync } from '../hooks'; // 统一 loading / error / reload

// 发货筛选页签：覆盖运营日常关注的三个档位
const FILTER_TABS: Array<{ value: ShipmentFilter; label: string }> = [
  { value: 'to_ship', label: '待发货' }, // 待发货：已支付未录单
  { value: 'shipped', label: '已发货' }, // 已发货：已录运单待签收
  { value: 'delivered', label: '已签收' }, // 已签收：履约完成
];

// 空态文案：按页签说明事实与下一步，避免误以为页面故障
const EMPTY_HINT: Partial<Record<ShipmentFilter, string>> = {
  to_ship: '当前没有待发货订单。商城产生已支付订单后会出现在这里；可到「订单管理」确认订单是否已支付。',
  shipped: '当前没有已发货订单。在「待发货」页签录入运单后，订单会转到此处。',
  delivered: '当前没有已签收订单。已发货订单标记签收后会出现在这里。',
};

// 物流状态中文名
const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  pending: '待揽收', // 待揽收：运单已建，快递尚未取件
  picked: '已揽收', // 已揽收：快递已取件
  transit: '运输中', // 运输中：在途派送
  delivered: '已签收', // 已签收：收件人签收
  exception: '异常', // 异常：物流异常需人工介入
};

// 售后类型中文名
const AFTER_SALES_KIND_LABEL: Record<string, string> = {
  refund_only: '仅退款', // 仅退款：不退货
  return_refund: '退货退款', // 退货退款：退货后退款
  repair: '维修', // 维修：售后维修处理
};

// 售后状态中文名
const AFTER_SALES_STATUS_LABEL: Record<string, string> = {
  pending: '待处理', // 待处理：等待后台审批
  approved: '已同意', // 已同意：售后通过
  rejected: '已驳回', // 已驳回：售后拒绝
  cancelled: '已撤销', // 已撤销：申请人主动撤回
};

// 金额格式化：分转元
function formatYuan(cents: number): string {
  // 后端金额以分存储，展示时除以 100 并补两位小数
  return `¥${(cents / 100).toFixed(2)}`;
}

// 组件入参
interface ShipmentsProps {
  // 当前会话凭证：随接口请求带上鉴权信息
  credential: Credential;
  // 实时权限码列表：据此判定发货 / 售后写权限
  permissions: string[];
}

/** 发货与售后工作台 */
export function Shipments({ credential, permissions }: ShipmentsProps) {
  // 写权限：与后端 requirePermission('commerce:write') 对齐
  const canWrite = permissions.includes('commerce:write');
  // 当前发货页签：默认待发货
  const [filter, setFilter] = useState<ShipmentFilter>('to_ship');

  // 订单列表：无写权限时不发请求，返回空数组占位
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

  // 售后列表：默认待处理，可切换查看全部
  const [afterSalesAll, setAfterSalesAll] = useState(false);
  const afterSalesState = useAsync<AdminAfterSalesRow[]>(
    () => (canWrite ? listAfterSales(credential, afterSalesAll ? 'all' : 'pending') : Promise.resolve([])),
    [credential, canWrite, afterSalesAll],
  );
  // 售后处理在途与错误
  const [handlingId, setHandlingId] = useState<string | null>(null);
  const [afterSalesError, setAfterSalesError] = useState<string | null>(null);
  // 处理备注：审批同意 / 驳回时随附说明
  const [handleNote, setHandleNote] = useState('');

  // 行内「填写单号」：把订单 ID 与收货信息填进表单，减少手抄错误
  function fillOrder(row: AdminShipmentOrderRow) {
    setShipOrderId(row.id); // 回填订单 ID
    setShipError(null); // 清掉旧录单错误
    setCarrier(''); // 物流公司留空待填
    setTrackingNo(''); // 运单号留空待填
  }

  // 提交录单：建发货单并默认推进为运输中
  async function submitShip(event: FormEvent) {
    event.preventDefault(); // 阻止表单默认提交刷新页面
    setShipError(null); // 清掉旧录单错误
    const orderId = shipOrderId.trim(); // 归一化订单 ID 去空白
    // 三项均为必填：缺任一项拦截并提示，不发起请求
    if (!orderId || !carrier.trim() || !trackingNo.trim()) {
      setShipError('订单 ID、物流公司、运单号均为必填');
      return;
    }
    setShipping(true); // 进入录单在途态
    try {
      // 调录单接口：物流公司 / 运单号去空白，状态默认运输中
      await createShipment(credential, orderId, {
        carrier: carrier.trim(),
        tracking_no: trackingNo.trim(),
        status: 'transit',
      });
      // 录单成功：清空表单三个字段并刷新订单列表
      setShipOrderId('');
      setCarrier('');
      setTrackingNo('');
      listState.reload();
    } catch (error) {
      // 录单失败：翻译错误文案展示，在途态在 finally 复位
      setShipError(describeError(error));
    } finally {
      setShipping(false); // 退出录单在途态
    }
  }

  // 推进单个物流单状态
  async function advance(shipmentId: string, status: ShipmentStatus) {
    setAdvancingId(shipmentId); // 记录在途物流单，禁用其按钮防重复点击
    try {
      // 调推进接口：更新物流单目标状态
      await updateShipment(credential, shipmentId, { status });
      listState.reload(); // 刷新订单列表反映新状态
    } catch (error) {
      setShipError(describeError(error)); // 推进失败展示错误
    } finally {
      setAdvancingId(null); // 清除在途标记
    }
  }

  // 处理售后：同意即退款入余额
  async function handleRequest(id: string, action: 'approve' | 'reject') {
    setAfterSalesError(null); // 清掉旧售后错误
    setHandlingId(id); // 记录在途售后单，禁用其按钮
    try {
      // 调售后审批接口：备注去空白，空则不传
      await handleAfterSales(credential, id, { action, note: handleNote.trim() || undefined });
      setHandleNote(''); // 清空处理备注
      afterSalesState.reload(); // 刷新售后列表
      listState.reload(); // 刷新订单列表联动售后待处理计数
    } catch (error) {
      setAfterSalesError(describeError(error)); // 审批失败展示错误
    } finally {
      setHandlingId(null); // 清除在途标记
    }
  }

  const rows = listState.data ?? []; // 发货订单行：缺省空数组
  const afterSalesRows = afterSalesState.data ?? []; // 售后申请行：缺省空数组

  return (
    <div className="page">
      {/* 页头：标题与履约链路一句话说明 */}
      <div className="page-head">
        <h1>发货与售后</h1>
        <span className="count">待发货 → 录入运单（已发货）→ 签收；售后退款退回钱包余额</span>
      </div>

      {/* 视图说明：完整履约链路与本页职责 */}
      <p className="page-desc">这里处理订单履约的完整链路：待发货订单录入运单后转为已发货，继续推进签收或标记异常，并在同一页审批售后退款。</p>

      {!canWrite ? (
        // 只读权限提示：无 commerce:write 时不展示操作面板
        <div className="hint">当前身份缺少 commerce:write 权限，无法操作发货与售后</div>
      ) : (
        <>
          {/* 发货任务面板：页签 + 列表 */}
          <div className="panel">
            <div className="panel-head">
              <h3>发货任务</h3>
              <span className="muted">共 {rows.length} 条</span>
            </div>
            {/* 状态页签：点击切换发货筛选 */}
            <div className="tabs">
              {FILTER_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  className={`tab${tab.value === filter ? ' active' : ''}`}
                  onClick={() => setFilter(tab.value)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* 列表加载中占位 */}
            {listState.loading ? <p className="muted">加载中…</p> : null}
            {/* 列表读取失败提示 */}
            {listState.error ? <div className="error">{describeError(listState.error)}</div> : null}
            {/* 空态：按当前页签展示对应提示文案 */}
            {!listState.loading && !listState.error && rows.length === 0 ? (
              <div className="empty">{EMPTY_HINT[filter] ?? '当前没有订单。'}</div>
            ) : null}

            {/* 订单表格：有行时渲染 */}
            {rows.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    {/* 表头：订单编号 / 时间 / 金额 */}
                    <th>订单</th>
                    {/* 表头：商品名称与编码 */}
                    <th>商品</th>
                    {/* 表头：收货人信息 */}
                    <th>收货信息</th>
                    {/* 表头：物流状态与操作 */}
                    <th>物流</th>
                    {/* 表头：履约操作按钮 */}
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      {/* 订单列：编号截断、下单时间、金额 × 数量 */}
                      <td>
                        <code>{row.id.slice(0, 12)}</code>
                        <div className="muted">{row.created_at}</div>
                        <div className="muted">
                          {formatYuan(row.payable_cents)} × {row.quantity}
                        </div>
                      </td>
                      {/* 商品列：名称 + 编码 */}
                      <td>
                        {row.product_name}
                        <div className="muted">{row.product_code}</div>
                      </td>
                      {/* 收货信息列：姓名电话地址 + 用户昵称；无收货信息时占位 */}
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
                      {/* 物流列：已有发货单展示承运商 / 单号 / 状态，否则待发货徽章 */}
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
                      {/* 操作列：录单 / 签收 / 异常 / 售后待处理计数 */}
                      <td>
                        {!row.shipment_id ? (
                          <button className="btn ghost" type="button" onClick={() => fillOrder(row)}>
                            填写单号
                          </button>
                        ) : null}
                        {row.shipment_id && row.shipment_status !== 'delivered' ? (
                          <>
                            {/* 标记签收：推进物流单为已签收 */}
                            <button
                              className="btn ghost"
                              type="button"
                              disabled={advancingId === row.shipment_id}
                              onClick={() => void advance(row.shipment_id!, 'delivered')}
                            >
                              标记签收
                            </button>
                            {/* 标记异常：物流异常需人工介入 */}
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

          {/* 录单面板：订单 ID / 物流公司 / 运单号表单 */}
          <div className="panel">
            <div className="panel-head">
              <h3>录入运单</h3>
            </div>
            <form className="form" onSubmit={(event) => void submitShip(event)}>
              {/* 字段：订单 ID，录单在途时禁用 */}
              <label className="field">
                <span>订单 ID</span>
                <input value={shipOrderId} onChange={(event) => setShipOrderId(event.target.value)} placeholder="order-xxx" disabled={shipping} />
              </label>
              {/* 字段：物流公司 */}
              <label className="field">
                <span>物流公司</span>
                <input value={carrier} onChange={(event) => setCarrier(event.target.value)} placeholder="如：顺丰速运" disabled={shipping} />
              </label>
              {/* 字段：运单号 */}
              <label className="field">
                <span>运单号</span>
                <input value={trackingNo} onChange={(event) => setTrackingNo(event.target.value)} placeholder="如：SF1234567890" disabled={shipping} />
              </label>
              {/* 录单错误提示 */}
              {shipError ? <div className="error">{shipError}</div> : null}
              <div className="row">
                {/* 提交按钮：录单在途禁用并切换文案 */}
                <button className="btn primary" type="submit" disabled={shipping}>
                  {shipping ? '提交中…' : '发货'}
                </button>
              </div>
            </form>
          </div>

          {/* 售后申请面板：列表 + 审批操作 */}
          <div className="panel">
            <div className="panel-head">
              <h3>售后申请</h3>
              {/* 切换仅看 / 查看全部 */}
              <button className="btn ghost" type="button" onClick={() => setAfterSalesAll((value) => !value)}>
                {afterSalesAll ? '仅看待处理' : '查看全部'}
              </button>
            </div>
            {/* 售后列表加载中占位 */}
            {afterSalesState.loading ? <p className="muted">加载中…</p> : null}
            {/* 售后列表读取失败提示 */}
            {afterSalesState.error ? <div className="error">{describeError(afterSalesState.error)}</div> : null}
            {/* 售后空态提示 */}
            {!afterSalesState.loading && !afterSalesState.error && afterSalesRows.length === 0 ? (
              <div className="empty">当前没有售后申请。用户对已支付订单发起退款或退货后，申请会出现在这里。</div>
            ) : null}

            {/* 售后表格：有申请时渲染 */}
            {afterSalesRows.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    {/* 表头：申请编号 / 类型 / 时间 */}
                    <th>申请</th>
                    {/* 表头：关联订单与商品 */}
                    <th>订单 / 商品</th>
                    {/* 表头：申请理由 */}
                    <th>理由</th>
                    {/* 表头：售后状态 */}
                    <th>状态</th>
                    {/* 表头：审批操作 */}
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {afterSalesRows.map((row) => (
                    <tr key={row.id}>
                      {/* 申请列：编号截断、售后类型、申请时间 */}
                      <td>
                        <code>{row.id.slice(0, 10)}</code>
                        <div className="muted">{AFTER_SALES_KIND_LABEL[row.kind] ?? row.kind}</div>
                        <div className="muted">{row.created_at}</div>
                      </td>
                      {/* 订单商品列：订单编号、商品名、实付与订单状态 */}
                      <td>
                        <code>{row.order_id.slice(0, 12)}</code>
                        <div className="muted">{row.product_name}</div>
                        <div className="muted">
                          实付 {formatYuan(row.payable_cents)} · 订单 {row.order_status}
                        </div>
                      </td>
                      {/* 理由列：申请人填写的售后说明 */}
                      <td>{row.reason}</td>
                      {/* 状态列：售后状态徽章 + 管理员备注 */}
                      <td>
                        <span className="badge draft">{AFTER_SALES_STATUS_LABEL[row.status] ?? row.status}</span>
                        {row.admin_note ? <div className="muted">{row.admin_note}</div> : null}
                      </td>
                      {/* 操作列：待处理时展示备注输入与同意 / 驳回按钮 */}
                      <td>
                        {row.status === 'pending' ? (
                          <>
                            {/* 处理备注输入框：选填，随审批动作提交 */}
                            <input
                              value={handleNote}
                              onChange={(event) => setHandleNote(event.target.value)}
                              placeholder="处理备注（选填）"
                              style={{ maxWidth: 180 }}
                            />
                            <div className="row">
                              {/* 同意退款：审批通过，退款入钱包余额 */}
                              <button
                                className="btn primary"
                                type="button"
                                disabled={handlingId === row.id}
                                onClick={() => void handleRequest(row.id, 'approve')}
                              >
                                同意退款
                              </button>
                              {/* 驳回：拒绝该售后申请 */}
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
            {/* 售后审批错误提示 */}
            {afterSalesError ? <div className="error">{afterSalesError}</div> : null}
          </div>
        </>
      )}
    </div>
  );
}
