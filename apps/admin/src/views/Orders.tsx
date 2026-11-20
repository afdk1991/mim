// 订单管理：全部商城订单只读总览，处理动作收敛在「发货与售后」
// 引入 React 状态钩子：useState 维护搜索框输入文本
import { useState } from 'react';
// 引入错误文案翻译器：把后端错误对象翻译成界面可读提示
import { describeError } from '../api';
// 引入凭证类型：约束组件入参的会话凭证结构
import type { Credential } from '../api';
// 引入后台订单列表接口：拉取发货侧订单行数据
import { listShipmentOrders } from '../api-shop-admin';
// 引入订单行与筛选类型：约束列表行结构与过滤取值范围
import type { AdminShipmentOrderRow, ShipmentFilter } from '../api-shop-admin';
// 引入异步数据钩子：封装加载中 / 错误 / 数据三态的请求编排
import { useAsync } from '../hooks';

/** 入参：凭证与实时权限码 */
interface Props {
  // 当前会话凭证：随接口请求带上鉴权信息
  credential: Credential;
  // 实时权限码列表：本视图只读，不做按钮级门禁
  permissions: string[];
}

/** 订单状态中文口径：与 shop_orders.status 一一对应 */
const STATUS_LABEL: Record<string, string> = {
  pending: '待支付', // 待支付：用户尚未完成付款
  paid: '已支付', // 已支付：付款成功，待发货或已发货
  delivered: '已签收', // 已签收：物流履约完成
  refunded: '已退款', // 已退款：售后退款闭环
  cancelled: '已取消', // 已取消：订单作废不再履约
};

/** 分转元，保留两位小数 */
function formatYuan(cents: number): string {
  // 后端金额以分存储，展示时除以 100 并补齐两位小数
  return `¥${(cents / 100).toFixed(2)}`;
}

/** 订单管理主视图 */
export function Orders({ credential }: Props) {
  // all 由后端按「全部」处理，避免前端并发拉取五种状态
  // 异步拉取订单列表：上限 100 条，凭证变化时重新请求
  const state = useAsync(() => listShipmentOrders(credential, 'all' as ShipmentFilter, 100), [credential]);
  // 搜索关键词状态：受控输入框，初始为空串表示不做筛选
  const [keyword, setKeyword] = useState('');

  // 全量行：用于区分「确实没有订单」与「搜索无匹配」两种空态
  const allRows = state.data ?? [];
  // 本地关键词过滤：对订单号、商品名、商品编码、昵称做大小写不敏感包含匹配
  const rows = allRows.filter((row) => {
    // 归一化查询词：去首尾空白并转小写，匹配不区分大小写
    const q = keyword.trim().toLowerCase();
    // 空关键词直接保留全部行，不做任何过滤
    if (!q) return true;
    // 任一字段命中即保留该行：订单号 / 商品名 / 商品编码 / 用户昵称
    return (
      row.id.toLowerCase().includes(q) ||
      row.product_name.toLowerCase().includes(q) ||
      row.product_code.toLowerCase().includes(q) ||
      (row.user_nickname ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="page">
      {/* 页头：标题与视图说明，提示发货售后在另一视图处理 */}
      <header className="page-head">
        <h1>订单管理</h1>
        <p className="page-desc">这里按时间倒序查看全部商城订单与支付状态；发货、签收与售后处理请进入「发货与售后」。</p>
      </header>

      <div className="panel">
        {/* 面板头：标题与当前可见条数（过滤后） */}
        <div className="panel-head">
          <h3>订单总览</h3>
          <span className="muted">共 {rows.length} 条</span>
        </div>

        {/* 搜索框：受控输入，关键词在前端本地过滤列表 */}
        <div className="row">
          <input
            aria-label="搜索订单"
            placeholder="搜索订单号 / 商品 / 用户"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>

        {/* 加载中提示：异步请求未返回前展示占位文案 */}
        {state.loading ? <p className="muted">加载中…</p> : null}
        {/* 错误提示：请求失败时展示翻译后的错误文案 */}
        {state.error ? <div className="error">{describeError(state.error)}</div> : null}
        {/* 空态分流：全量为空与搜索无匹配给出不同说明文案 */}
        {!state.loading && !state.error && rows.length === 0 ? (
          allRows.length === 0 ? (
            <div className="empty">
              当前没有订单。商城还没有产生订单，用户下单后才会出现在这里；可先到「商品管理」确认商品已上架。
            </div>
          ) : (
            <div className="empty">没有匹配的订单，换个关键词试试。</div>
          )
        ) : null}

        {/* 列表区：存在匹配行时才渲染订单表格 */}
        {rows.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                {/* 表头：订单编号（截断展示） */}
                <th>订单</th>
                {/* 表头：商品名称与编码 */}
                <th>商品</th>
                {/* 表头：下单用户 */}
                <th>用户</th>
                {/* 表头：实付金额与数量 */}
                <th>实付</th>
                {/* 表头：订单状态 */}
                <th>状态</th>
                {/* 表头：下单时间 */}
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
