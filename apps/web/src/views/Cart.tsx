// 引入状态钩子：购物车数据、结算结果与提交中间态
import { useEffect, useState } from 'react';
// 引入语言类型
import type { Locale } from '@mim/i18n';
// 引入接口集合与错误文案翻译
import { api, errorText } from '../api';
// 引入购物车与结算结果类型、积分抵扣口径
import type { CartCheckoutResult, CartSummary, PointsDeductionConfig } from '../api';
// 引入路由跳转：继续挑选商品 / 去个人中心看订单
import { navigate } from '../router';

/** 组件契约：仅需语言 */
interface Props {
  locale: Locale; // 当前界面语言
} // Props 结束

/** 金额格式化：分 → 两位小数，中文用 ¥ / 英文用 $ */
function money(locale: Locale, currency: string, amountMinor: number): string {
  const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : `${currency} `; // 常见币种用符号
  return `${symbol}${(amountMinor / 100).toFixed(2)}`; // 最小货币单位换算成主单位
} // money 结束

/** 积分抵扣预览：受积分余额与单笔比例上限双重约束；实际扣减以后端 computeDeduction 为准 */
function previewDeduction(totalMinor: number, balance: number, cfg: PointsDeductionConfig) {
  const byBalanceCents = Math.floor((balance / cfg.points_per_yuan) * 100); // 余额可折金额（分）
  const byRatioCents = Math.floor((totalMinor * cfg.max_ratio_percent) / 100); // 单笔比例上限（分）
  const deduct = Math.max(0, Math.min(byBalanceCents, byRatioCents, totalMinor)); // 取三者最小值
  const pointsSpent = cfg.points_per_yuan > 0 ? Math.ceil((deduct / 100) * cfg.points_per_yuan) : 0; // 折算消耗积分
  return { deduct_cents: deduct, points_spent: pointsSpent, payable_cents: Math.max(0, totalMinor - deduct) };
} // previewDeduction 结束

/** 购物车页：清单 / 移除 / 清空 / 结算（免费即时解锁，付费生成待结算订单） */
export function Cart({ locale }: Props) {
  const isZh = locale !== 'en-US'; // 是否中文文案
  const [cart, setCart] = useState<CartSummary | null>(null); // 购物车摘要
  const [loading, setLoading] = useState(true); // 首屏加载态
  const [busy, setBusy] = useState(false); // 结算进行中
  const [error, setError] = useState<string | null>(null); // 错误提示
  const [results, setResults] = useState<CartCheckoutResult[] | null>(null); // 最近一次结算结果
  const [usePoints, setUsePoints] = useState(false); // 结算时是否用积分抵扣（默认不勾）
  const [pointsBalance, setPointsBalance] = useState(0); // 钱包可用积分
  const [pointsCfg, setPointsCfg] = useState<PointsDeductionConfig | null>(null); // 积分抵扣口径（公开只读）

  /** 重新拉取购物车；并行拉钱包积分与站点抵扣口径，任一失败不阻断购物车主流程 */
  async function refresh() {
    const [cartP, walletP, cfgP] = await Promise.allSettled([api.cart.get(), api.wallet.get(), api.commerce.siteConfig()]);
    if (cartP.status === 'fulfilled') {
      setCart(cartP.value); // 写入最新车
      setError(null); // 清空旧错误
    } else {
      setError(errorText(locale, cartP.reason)); // 展示购物车错误
    }
    if (walletP.status === 'fulfilled') setPointsBalance(walletP.value.wallet.points); // 积分余额回落 0
    if (cfgP.status === 'fulfilled') setPointsCfg(cfgP.value.points_deduction ?? null); // 口径缺失回落默认
    setLoading(false); // 结束加载态
  } // refresh 结束

  // 进入页面拉一次
  useEffect(() => {
    void refresh(); // 忽略返回值，错误在 refresh 内部处理
  }, []); // 仅挂载时执行

  /** 移除单个条目 */
  async function remove(code: string) {
    setError(null); // 清空旧错误
    try {
      const result = await api.cart.remove(code); // 后端天然幂等
      setCart(result.cart); // 用响应里的最新车覆盖
    } catch (err) {
      setError(errorText(locale, err)); // 失败提示
    } // try 结束
  } // remove 结束

  /** 清空购物车 */
  async function clear() {
    setError(null); // 清空旧错误
    try {
      const result = await api.cart.clear(); // 清空接口
      setCart(result.cart); // 更新为空车
    } catch (err) {
      setError(errorText(locale, err)); // 失败提示
    } // try 结束
  } // clear 结束

  /** 结算整车 */
  async function checkout() {
    setBusy(true); // 禁用按钮防重复
    setError(null); // 清空旧错误
    setResults(null); // 清空旧结果
    try {
      // 人工结算；仅在抵扣面板可用且勾选时传 use_points，否则不带抵扣入参
      const result = await api.cart.checkout('manual', { use_points: usePoints && deductionAvailable });
      setCart(result.cart); // 用响应覆盖剩余车
      setResults(result.results); // 展示逐条结果
    } catch (err) {
      setError(errorText(locale, err)); // 失败提示
    } finally {
      setBusy(false); // 恢复按钮
    } // try 结束
  } // checkout 结束

  const items = cart?.items ?? []; // 条目快捷引用
  const totals = cart?.totals ?? []; // 合计快捷引用
  const totalMinor = totals.reduce((sum, total) => sum + total.amount_minor, 0); // 应付合计（分，多币种先按首币种预览）
  const totalCurrency = totals[0]?.currency ?? 'CNY'; // 预览币种
  // 站点口径缺失时回落后端默认（100 积分=1 元、单笔上限 30%）；显式关闭或余额 0 时整块隐藏
  const cfg: PointsDeductionConfig = pointsCfg ?? { enabled: true, points_per_yuan: 100, max_ratio_percent: 30 };
  const deductionAvailable = cfg.enabled && pointsBalance > 0 && totalMinor > 0; // 抵扣面板是否展示
  const preview = deductionAvailable && usePoints
    ? previewDeduction(totalMinor, pointsBalance, cfg) // 勾选后按余额 / 比例上限预览抵扣
    : { deduct_cents: 0, points_spent: 0, payable_cents: totalMinor }; // 未勾选：应付即合计

  return (
    <div className="page">
      <header className="page-head">
        <h1>{isZh ? '购物车' : 'Cart'}</h1>
        <div className="products-pager">
          <button type="button" className="btn ghost" onClick={() => navigate({ view: 'products' })}>{isZh ? '继续挑选' : 'Browse products'}</button>
          <button type="button" className="btn ghost" onClick={() => void clear()} disabled={items.length === 0}>{isZh ? '清空' : 'Clear'}</button>
        </div>
      </header>

      {error ? <div className="chat-error">{error}</div> : null}
      {loading ? <div className="hint">{isZh ? '加载中…' : 'Loading…'}</div> : null}
      {!loading && items.length === 0 ? <div className="hint">{isZh ? '购物车是空的，去商品列表挑几件吧。' : 'Your cart is empty.'}</div> : null}

      {/* 清单：逐条展示模块、价格与已拥有状态 */}
      {items.length > 0 ? (
        <table className="products-table">
          <thead>
            <tr>
              <th>{isZh ? '模块' : 'Module'}</th>
              <th>{isZh ? '价格' : 'Price'}</th>
              <th>{isZh ? '状态' : 'Status'}</th>
              <th>{isZh ? '操作' : 'Action'}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const name = item.name[locale] ?? item.name['zh-CN'] ?? item.module_code; // 名称按语言回落
              return (
                <tr key={item.module_code}>
                  <td>
                    <div className="products-name">{name}</div>
                    <div className="products-code">{item.module_code}</div>
                  </td>
                  <td>{item.free ? (isZh ? '免费' : 'Free') : item.price ? money(locale, item.price.currency, item.price.amount_minor) : '-'}</td>
                  <td>
                    {item.owned ? <span className="tag ok">{isZh ? '已拥有' : 'Owned'}</span> : null}
                    {!item.available ? <span className="tag">{isZh ? '已下架' : 'Offline'}</span> : null}
                    {item.free && !item.owned && item.available ? <span className="tag ok">{isZh ? '结算即解锁' : 'Unlocks on checkout'}</span> : null}
                    {!item.free && item.available && !item.owned ? <span className="tag">{isZh ? '生成待结算订单' : 'Creates pending order'}</span> : null}
                  </td>
                  <td>
                    <button type="button" className="btn ghost" onClick={() => void remove(item.module_code)}>{isZh ? '移除' : 'Remove'}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}

      {/* 合计与结算入口 */}
      {items.length > 0 ? (
        <section className="cart-foot">
          {totals.length > 0 ? (
            <span>
              {isZh ? '待结算合计' : 'Total'}：
              {totals.map((total) => money(locale, total.currency, total.amount_minor)).join(' + ')}
            </span>
          ) : (
            <span>{isZh ? '本车全部可即时解锁' : 'All items unlock instantly'}</span>
          )}
          {deductionAvailable ? (
            <div className="cart-points">
              <label className="hint">
                <input type="checkbox" checked={usePoints} onChange={(event) => setUsePoints(event.target.checked)} />{' '}
                {isZh ? '使用积分抵扣' : 'Use points'}
              </label>
              <span className="hint">{isZh ? `可用积分 ${pointsBalance}` : `${pointsBalance} points available`}</span>
              {usePoints ? (
                <>
                  <span className="hint">
                    {isZh ? '本次抵扣' : 'Deduction'}：{money(locale, totalCurrency, preview.deduct_cents)}
                    {isZh ? `（约 ${preview.points_spent} 积分）` : ` (~${preview.points_spent} pts)`}
                  </span>
                  <span className="hint">{isZh ? '应付' : 'Payable'}：{money(locale, totalCurrency, preview.payable_cents)}</span>
                </>
              ) : null}
            </div>
          ) : null}
          <button type="button" className="btn primary" onClick={() => void checkout()} disabled={busy}>
            {busy ? (isZh ? '结算中…' : 'Checking out…') : isZh ? '去结算' : 'Checkout'}
          </button>
        </section>
      ) : null}

      {/* 结算结果：逐条说明成功 / 跳过原因 */}
      {results ? (
        <section className="cart-results">
          {" "}
          {results.map((result) => (
            <div key={result.module_code} className="hint">
              {result.module_code}：
              {result.kind === 'unlocked' ? (isZh ? '已即时解锁 ✓' : 'unlocked ✓') : null}
              {result.kind === 'order' ? (isZh ? `已生成待结算订单 ${result.order?.id.slice(0, 8) ?? ''}` : `pending order ${result.order?.id.slice(0, 8) ?? ''}`) : null}
              {result.kind === 'skipped' ? (isZh ? `已跳过（${result.reason ?? 'unknown'}）` : `skipped (${result.reason ?? 'unknown'})`) : null}
              {result.points_spent ? (isZh ? ` · 抵扣 ${result.points_spent} 积分 / ${money(locale, 'CNY', result.points_deduct_cents ?? 0)}` : ` · ${result.points_spent} points / ${money(locale, 'CNY', result.points_deduct_cents ?? 0)}`) : null}
            </div>
          ))}
          {results.some((result) => result.kind === 'order') ? (
            <button type="button" className="btn ghost" onClick={() => navigate({ view: 'account' })}>{isZh ? '去个人中心查看订单' : 'View orders'}</button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
} // Cart 结束
