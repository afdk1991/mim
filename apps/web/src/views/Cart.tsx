// 引入状态钩子：购物车数据、结算结果与提交中间态
import { useEffect, useState } from 'react';
// 引入语言类型
import type { Locale } from '@mim/i18n';
// 引入接口集合与错误文案翻译
import { api, errorText } from '../api';
// 引入购物车与结算结果类型
import type { CartCheckoutResult, CartSummary } from '../api';
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

/** 购物车页：清单 / 移除 / 清空 / 结算（免费即时解锁，付费生成待结算订单） */
export function Cart({ locale }: Props) {
  const isZh = locale !== 'en-US'; // 是否中文文案
  const [cart, setCart] = useState<CartSummary | null>(null); // 购物车摘要
  const [loading, setLoading] = useState(true); // 首屏加载态
  const [busy, setBusy] = useState(false); // 结算进行中
  const [error, setError] = useState<string | null>(null); // 错误提示
  const [results, setResults] = useState<CartCheckoutResult[] | null>(null); // 最近一次结算结果

  /** 重新拉取购物车 */
  async function refresh() {
    try {
      const next = await api.cart.get(); // 只读接口
      setCart(next); // 写入状态
      setError(null); // 清空旧错误
    } catch (err) {
      setError(errorText(locale, err)); // 展示错误
    } finally {
      setLoading(false); // 结束加载态
    } // try 结束
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
      const result = await api.cart.checkout('manual'); // 当前唯一可用渠道为人工结算
      setCart(result.cart); // 用响应覆盖剩余车
      setResults(result.results); // 展示逐条结果
    } catch (err) {
      setError(errorText(locale, err)); // 失败提示
    } finally {
      setBusy(false); // 恢复按钮
    } // try 结束
  } // checkout 结束

  const items = cart?.items ?? []; // 条目快捷引用

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
          {(cart?.totals ?? []).length > 0 ? (
            <span>
              {isZh ? '待结算合计' : 'Total'}：
              {(cart?.totals ?? []).map((total) => money(locale, total.currency, total.amount_minor)).join(' + ')}
            </span>
          ) : (
            <span>{isZh ? '本车全部可即时解锁' : 'All items unlock instantly'}</span>
          )}
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
