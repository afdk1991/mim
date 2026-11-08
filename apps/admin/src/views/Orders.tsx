// 商城订单管理视图：跨用户订单列表（状态/区域/关键字过滤 + 分页）+ 人工结算表单
// 当前无在线支付网关，用户下单后订单为 pending，由运营对账后在管理端调用结算接口完成发放
import type { FormEvent } from 'react'; // 表单事件类型：提交处理器使用
import { useState } from 'react'; // 过滤、分页与结算表单状态钩子
// 类型与接口：只引入本视图用到的部分，避免无谓打包体积
import type { AdminOrderPage, AdminOrderRow, Credential } from '../api';
import { describeError, listOrders, settleOrder } from '../api'; // 错误转文案 + 订单列表 + 结算
// 通用异步加载钩子：统一 loading / error / reload
import { useAsync } from '../hooks';

// 每页条数：与后端默认上限对齐
const PAGE_SIZE = 20;

// 订单状态中文文案：与后端 module_orders.status 的 CHECK 约束一一对应
const STATUS_LABEL: Record<string, string> = {
  // 待结算：已下单未付款
  pending: '待结算',
  // 已结算：权益已发放
  paid: '已结算',
  // 已取消：用户主动取消
  cancelled: '已取消',
}; // 状态文案表结束

// 状态徽章样式：复用 styles.css 的 badge 修饰类
const STATUS_BADGE: Record<string, string> = {
  // 待结算：中性样式，提示需要人工处理
  pending: 'draft',
  // 已结算：绿色
  paid: 'active',
  // 已取消：红色警示（终态且不可恢复）
  cancelled: 'danger',
}; // 徽章映射结束

// 状态过滤选项：空串表示不过滤
const STATUS_OPTIONS: Array<{ value: '' | 'pending' | 'paid' | 'cancelled'; label: string }> = [
  // 全部
  { value: '', label: '全部状态' },
  // 待结算（运营主要关注这一档）
  { value: 'pending', label: '待结算' },
  // 已结算
  { value: 'paid', label: '已结算' },
  // 已取消
  { value: 'cancelled', label: '已取消' },
]; // 状态选项结束

// 区域过滤选项：空串表示跨区域
const REGION_OPTIONS: Array<{ value: '' | 'cn' | 'global'; label: string }> = [
  // 跨区域
  { value: '', label: '全部区域' },
  // 中国大陆
  { value: 'cn', label: 'cn（中国大陆）' },
  // 海外
  { value: 'global', label: 'global（海外）' },
]; // 区域选项结束

// 多语言取值：优先中文名，缺失回退到调用方给定值
function pickLocale(field: Record<string, string | undefined>, fallback: string): string {
  // 依次尝试 zh-CN / en / 兜底
  return field['zh-CN'] ?? field.en ?? fallback;
} // pickLocale 结束

// 金额格式化：分转元并保留两位小数
function formatAmount(amountMinor: number, currency: string): string {
  // 币种与金额同时展示，避免跨区域误读
  return `${(amountMinor / 100).toFixed(2)} ${currency}`;
} // formatAmount 结束

// 渠道中文名：人工结算为默认口径，在线渠道用于与渠道账单对账
const CHANNEL_LABEL: Record<string, string> = {
  // 人工 / 线下转账对账后结算
  manual: '人工结算',
  // 支付宝
  alipay: '支付宝',
  // 微信支付
  wechat: '微信支付',
  // Stripe
  stripe: 'Stripe',
}; // 渠道映射结束

// 组件入参
interface OrdersProps {
  // 当前凭证：引导令牌或 Bearer
  credential: Credential;
  // 当前生效权限码，用于结算按钮门禁
  permissions: string[];
} // OrdersProps 结束

// 订单管理组件主体
export function Orders({ credential, permissions }: OrdersProps) {
  // 读权限：列表要求 entitlement:read（与后端 GET /orders/manage 一致）
  const canRead = permissions.includes('entitlement:read');
  // 结算权限：与后端 POST /orders/:id/settle 的 entitlement:grant 一致
  const canSettle = permissions.includes('entitlement:grant');

  // 搜索框输入值（未提交）
  const [keyword, setKeyword] = useState('');
  // 已提交的关键字：点击搜索才生效，避免每次按键都打请求
  const [applied, setApplied] = useState('');
  // 状态过滤：默认只看待结算，运营日常最需要处理的档位
  const [statusFilter, setStatusFilter] = useState<'' | 'pending' | 'paid' | 'cancelled'>('pending');
  // 区域过滤：空串表示跨区域
  const [regionFilter, setRegionFilter] = useState<'' | 'cn' | 'global'>('');
  // 当前分页偏移量：0 表示第一页
  const [offset, setOffset] = useState(0);

  // 订单列表：无读权限时不发请求，由视图层降级为权限提示
  const listState = useAsync<AdminOrderPage | null>(
    () =>
      canRead
        ? listOrders(credential, {
            // 空关键字不携带
            q: applied || undefined,
            // 状态过滤
            status: statusFilter || undefined,
            // 区域过滤
            region: regionFilter || undefined,
            // 每页条数
            limit: PAGE_SIZE,
            // 当前偏移
            offset,
          })
        : Promise.resolve(null),
    // 任一条件变化重新拉取
    [credential, canRead, applied, statusFilter, regionFilter, offset],
  );

  // 结算表单：目标订单 ID
  const [settleId, setSettleId] = useState('');
  // 结算表单：备注原因，写入权益审计事件
  const [settleReason, setSettleReason] = useState('');
  // 结算请求在途标记，避免重复提交
  const [busy, setBusy] = useState(false);
  // 结算错误文案
  const [settleError, setSettleError] = useState<string | null>(null);
  // 结算成功回执
  const [receipt, setReceipt] = useState<AdminOrderRow | null>(null);

  // 当前页订单与总数：无权限或加载前按空处理
  const rows = listState.data?.orders ?? [];
  const total = listState.data?.total ?? 0;

  // 提交搜索：把输入值落到 applied 并回到第一页
  function submitSearch(event: FormEvent) {
    // 阻止表单默认跳转
    event.preventDefault();
    // 去空白后生效
    setApplied(keyword.trim());
    // 条件变化回到第一页
    setOffset(0);
  } // submitSearch 结束

  // 切换状态过滤：立即生效并回到第一页
  function changeStatus(value: string) {
    // 仅接受已知枚举值，其余回退为不过滤
    setStatusFilter(value === 'pending' || value === 'paid' || value === 'cancelled' ? value : '');
    // 回到第一页
    setOffset(0);
  } // changeStatus 结束

  // 切换区域过滤：立即生效并回到第一页
  function changeRegion(value: string) {
    // 仅接受 cn/global，其余回退为跨区域
    setRegionFilter(value === 'cn' || value === 'global' ? value : '');
    // 回到第一页
    setOffset(0);
  } // changeRegion 结束

  // 上一页：偏移量不允许为负
  function prevPage() {
    // 最小到 0
    setOffset((value) => Math.max(0, value - PAGE_SIZE));
  } // prevPage 结束

  // 下一页：由按钮 disabled 保证不越界
  function nextPage() {
    // 推进一页
    setOffset((value) => value + PAGE_SIZE);
  } // nextPage 结束

  // 把行内订单 ID 填入结算表单：免手抄，降低结算错单风险
  function fillSettle(row: AdminOrderRow) {
    // 填入订单 ID
    setSettleId(row.id);
    // 预填备注：模块名 + 单号片段，便于事后审计追溯
    setSettleReason(`订单 ${row.id.slice(0, 8)} / ${row.module_code} 线下到账`);
    // 清掉上一轮错误与回执，避免旧提示误导
    setSettleError(null);
    setReceipt(null);
  } // fillSettle 结束

  // 提交结算：必填校验 → 调用接口 → 保存回执并刷新列表
  async function submitSettle(event: FormEvent) {
    // 阻止表单默认跳转
    event.preventDefault();
    // 清空上一轮结果
    setSettleError(null);
    setReceipt(null);
    // 订单 ID 必填
    const id = settleId.trim();
    if (!id) {
      // 缺项提示
      setSettleError('请填写订单 ID');
      // 提前结束
      return;
    } // 校验失败分支结束
    // 置为在途，禁用按钮
    setBusy(true);
    try {
      // 调用结算接口：后端在同一事务内把订单置 paid 并发放权益
      const settled = await settleOrder(credential, id, settleReason.trim() || undefined);
      // 保存回执用于展示（含发放后的权益主键）
      setReceipt(settled);
      // 列表刷新，状态列立即由「待结算」变为「已结算」
      listState.reload();
    } catch (error) {
      // 失败统一转可读文案（如已取消订单 409）
      setSettleError(describeError(error));
    } finally {
      // 解除在途
      setBusy(false);
    } // try/catch/finally 结束
  } // submitSettle 结束

  // 回执展示字段：抽成数组后用 map 渲染，避免重复 JSX
  const receiptRows = receipt
    ? [
        { label: '订单 ID', value: receipt.id }, // 订单主键
        { label: '状态', value: STATUS_LABEL[receipt.status] ?? receipt.status }, // 结算后状态
        { label: '用户', value: receipt.user_id }, // 归属用户
        { label: '模块', value: receipt.module_code }, // 模块编码
        { label: '金额', value: formatAmount(receipt.amount_minor, receipt.currency) }, // 成交金额
        { label: '渠道', value: CHANNEL_LABEL[receipt.channel] ?? receipt.channel }, // 结算渠道，便于与渠道账单核对
        { label: '渠道交易号', value: receipt.channel_txn_id ?? '—' }, // 回调结算时才有值
        { label: '权益 ID', value: receipt.entitlement_id ?? '—' }, // 发放后的权益主键
        { label: '结算时间', value: receipt.paid_at ?? '—' }, // 结算时间
      ]
    : []; // 无回执则不渲染

  // 渲染
  return (
    <div className="page">{/* 页面根容器 */}
      <div className="page-head">{/* 页头：标题与说明 */}
        <h2>商城订单</h2>{/* 页面标题 */}
        <span className="count">人工结算：对账后在此结算，后端同事务发放权益并写审计</span>{/* 说明口径 */}
      </div>{/* 页头结束 */}

      {!canRead ? (// 无读权限时整块降级为提示
        <div className="hint">当前身份缺少 entitlement:read 权限，无法查看订单列表</div>
      ) : (// 有权限时渲染列表
        <div className="panel">{/* 列表面板 */}
          <div className="panel-head">{/* 面板头：标题 + 页码 */}
            <h3>订单列表</h3>{/* 面板标题 */}
            <span className="muted">第 {Math.floor(offset / PAGE_SIZE) + 1} 页</span>{/* 当前页码 */}
          </div>{/* 面板头结束 */}
          <form className="row" onSubmit={submitSearch}>{/* 过滤工具行 */}
            <input
              value={keyword}// 受控值
              onChange={(event) => setKeyword(event.target.value)}// 只更新输入态
              placeholder="搜索模块编码 / 用户 ID"// 搜索范围提示
              style={{ maxWidth: 320 }}// 限宽，避免挤压下拉
            />{/* 输入框结束 */}
            <select value={statusFilter} onChange={(event) => changeStatus(event.target.value)} aria-label="状态过滤">{/* 状态下拉 */}
              {STATUS_OPTIONS.map((option) => (// 逐项渲染
                <option key={option.value} value={option.value}>{option.label}</option>// 选项
              ))}
            </select>{/* 状态下拉结束 */}
            <select value={regionFilter} onChange={(event) => changeRegion(event.target.value)} aria-label="区域过滤">{/* 区域下拉 */}
              {REGION_OPTIONS.map((option) => (// 逐项渲染
                <option key={option.value} value={option.value}>{option.label}</option>// 选项
              ))}
            </select>{/* 区域下拉结束 */}
            <button className="btn" type="submit">搜索</button>{/* 提交按钮：仅关键字需要点击生效 */}
          </form>{/* 过滤行结束 */}

          {listState.loading ? <p className="muted">加载中…</p> : null}{/* 加载占位 */}
          {listState.error ? (// 加载失败提示
            <div className="error">
              {describeError(listState.error)}{/* 错误文案 */}
              <button className="btn ghost" type="button" onClick={() => listState.reload()}>重试</button>{/* 手动重拉 */}
            </div>
          ) : null}{/* 无错误不渲染 */}
          {!listState.loading && !listState.error && rows.length === 0 ? (// 空态
            <div className="empty">没有符合条件的订单</div>
          ) : null}{/* 空态结束 */}
          {rows.length > 0 ? (// 有数据渲染表格
            <table className="table">{/* 表格容器 */}
              <thead>
                <tr>
                  <th>订单</th>{/* 订单号（短）与创建时间 */}
                  <th>用户</th>{/* 下单用户 */}
                  <th>模块</th>{/* 模块名与编码 */}
                  <th>金额</th>{/* 成交金额 */}
                  <th>状态</th>{/* 状态徽章 */}
                  <th>操作</th>{/* 行级操作 */}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (// 逐行渲染订单
                  <tr key={row.id}>{/* 以订单主键为 key */}
                    <td>
                      <code>{row.id.slice(0, 8)}</code>{/* 短单号，等宽便于核对 */}
                      <div className="muted">{row.created_at}</div>{/* 下单时间副文案 */}
                    </td>
                    <td>
                      <code>{row.user_id}</code>{/* 用户 ID */}
                      {row.user_display_name ? <div className="muted">{row.user_display_name}</div> : null}{/* 展示名（有则显示） */}
                    </td>
                    <td>
                      {pickLocale(row.module_name, row.module_code)}{/* 模块展示名 */}
                      <div className="muted">{row.module_code}</div>{/* 模块编码副文案 */}
                    </td>
                    <td>
                      {formatAmount(row.amount_minor, row.currency)}{/* 金额 */}
                      <div className="muted">{CHANNEL_LABEL[row.channel] ?? row.channel}</div>{/* 渠道副文案，便于对账 */}
                      {row.channel_txn_id ? <div className="muted">交易号 {row.channel_txn_id}</div> : null}{/* 渠道交易号（回调结算才有） */}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[row.status] ?? 'builtin'}`}>{STATUS_LABEL[row.status] ?? row.status}</span>{/* 状态徽章 */}
                      {row.paid_at ? <div className="muted">{row.paid_at}</div> : null}{/* 结算时间（已结算才显示） */}
                    </td>
                    <td>
                      {canSettle && row.status === 'pending' ? (// 仅待结算且有权时给结算入口
                        <button className="btn ghost" type="button" onClick={() => fillSettle(row)}>填入结算</button>
                      ) : null}{/* 结算入口条件渲染结束 */}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}{/* 表格结束 */}
          <div className="pager">{/* 分页器 */}
            <button className="btn ghost" type="button" disabled={offset === 0} onClick={prevPage}>上一页</button>{/* 首页禁用 */}
            <span className="muted">
              {total === 0 ? '0 / 0' : `${offset + 1}-${Math.min(offset + PAGE_SIZE, total)} / ${total}`}{/* 区间与总数 */}
            </span>
            <button className="btn ghost" type="button" disabled={offset + PAGE_SIZE >= total} onClick={nextPage}>下一页</button>{/* 末页禁用 */}
          </div>{/* 分页器结束 */}
        </div>
      )}{/* 列表区结束 */}

      <div className="panel">{/* 结算面板 */}
        <div className="panel-head">
          <h3>结算订单</h3>{/* 面板标题 */}
        </div>
        {!canSettle ? (// 无 entitlement:grant 时降级
          <div className="hint">当前身份缺少 entitlement:grant 权限，无法结算订单</div>
        ) : (// 有权限渲染表单
          <form className="form" onSubmit={(event) => void submitSettle(event)}>{/* 结算表单 */}
            <label className="field">
              <span>订单 ID</span>{/* 字段名 */}
              <input
                value={settleId}// 受控值
                onChange={(event) => setSettleId(event.target.value)}// 同步输入
                placeholder="ord_xxx"// 示例
                disabled={busy}// 在途禁用
              />{/* 输入框结束 */}
            </label>
            <label className="field">
              <span>结算备注（写入权益审计事件）</span>{/* 字段名 */}
              <input
                value={settleReason}// 受控值
                onChange={(event) => setSettleReason(event.target.value)}// 同步输入
                placeholder="如：线下转账已到账"// 常见备注
                disabled={busy}// 在途禁用
              />{/* 输入框结束 */}
            </label>
            {settleError ? <div className="error">{settleError}</div> : null}{/* 失败提示 */}
            <div className="row">
              <button className="btn primary" type="submit" disabled={busy}>{/* 提交按钮 */}
                {busy ? '结算中…' : '结算'}{/* 在途文案 */}
              </button>
              <button
                className="btn ghost"// 次级样式
                type="button"// 非提交按钮
                disabled={busy}// 在途禁用
                onClick={() => {// 点击重置表单
                  setSettleId('');// 清空订单 ID
                  setSettleReason('');// 清空备注
                  setSettleError(null);// 清空错误
                  setReceipt(null);// 清空回执
                }}
              >
                清空
              </button>
            </div>
          </form>
        )}{/* 结算区结束 */}
        {receiptRows.length > 0 ? (// 有回执时渲染结果表
          <table className="table">
            <tbody>
              {receiptRows.map((row) => (// 逐字段渲染
                <tr key={row.label}>
                  <th>{row.label}</th>{/* 字段名 */}
                  <td><code>{row.value}</code></td>{/* 字段值，等宽便于复制 */}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}{/* 回执表结束 */}
      </div>{/* 结算面板结束 */}
    </div>
  );
} // Orders 组件结束
