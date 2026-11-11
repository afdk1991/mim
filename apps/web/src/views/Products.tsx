// 引入状态钩子：筛选条件、购物车摘要与加载中间态
import { useEffect, useMemo, useState } from 'react';
// 引入语言类型
import type { Locale } from '@mim/i18n';
// 引入接口集合与错误文案翻译
import { api, errorText } from '../api';
// 引入购物车摘要类型
import type { CartSummary } from '../api';
// 引入路由跳转：去购物车 / 去个人中心
import { navigate } from '../router';
// 引入通用异步加载钩子
import { useAsync } from '../hooks';

/** 组件契约：仅需语言 */
interface Props {
  locale: Locale; // 当前界面语言
} // Props 结束

/** 可购买性筛选项：全部 / 免费 / 付费 / 已解锁 */
type AvailabilityFilter = 'all' | 'free' | 'paid' | 'owned'; // 联合类型即筛选点全集

/** 模块条目：列表接口的最小字段集（与 api.catalog.getModules 对齐） */
interface ModuleRow {
  code: string; // 模块编码
  name: Record<string, string>; // 多语言名称
  summary: Record<string, string>; // 多语言简介
  category_slug: string | null; // 所属二级分类
  capability: string | null; // 真实能力键（null = 规划中）
  stars: number; // Star 数
  language: string | null; // 编程语言
  license: string | null; // 开源许可
  current_price: { currency: string; amount_minor: number } | null; // 当前价（null = 免费/待定价）
} // ModuleRow 结束

/** 金额格式化：分 → 主币种两位小数；免费返回「免费」 */
function priceText(locale: Locale, price: { currency: string; amount_minor: number } | null): string {
  if (!price || price.amount_minor === 0) return locale === 'en-US' ? 'Free' : '免费'; // 无价或 0 价即免费
  const symbol = price.currency === 'CNY' ? '¥' : price.currency === 'USD' ? '$' : `${price.currency} `; // 常见币种用符号，其余用代码
  return `${symbol}${(price.amount_minor / 100).toFixed(2)}`; // 金额按最小货币单位换算
} // priceText 结束

/** 商品列表页：独立于商城的密集列表视图，支持搜索 / 分类 / 可购买性 / 排序 / 加购 */
export function Products({ locale }: Props) {
  const isZh = locale !== 'en-US'; // 是否中文文案
  const [q, setQ] = useState(''); // 关键词（提交时生效）
  const [keyword, setKeyword] = useState(''); // 已提交关键词
  const [category, setCategory] = useState('all'); // 分类过滤（一级或二级 slug）
  const [availability, setAvailability] = useState<AvailabilityFilter>('all'); // 可购买性过滤
  const [sort, setSort] = useState<'recommended' | 'stars' | 'updated'>('recommended'); // 排序
  const [page, setPage] = useState(1); // 当前页
  const pageSize = 30; // 每页条数：列表视图一屏可读量
  const [cart, setCart] = useState<CartSummary | null>(null); // 购物车摘要（角标用）
  const [added, setAdded] = useState<string | null>(null); // 最近加购成功的模块编码（行内提示）
  const [error, setError] = useState<string | null>(null); // 操作错误

  const taxonomy = useAsync(() => api.catalog.getTaxonomy(), []); // 分类导航（仅取一级分类做下拉）
  const entitlements = useAsync(() => api.catalog.getMyEntitlements(), []); // 我的权益（判定「已解锁」）
  const modules = useAsync(() => api.catalog.getModules({ q: keyword || undefined, category, sort, page, pageSize }), [keyword, category, sort, page]); // 模块列表

  // 首次进入拉一次购物车：角标与「已在车中」提示
  useEffect(() => {
    void api.cart.get().then(setCart).catch(() => setCart(null)); // 失败静默：不阻塞浏览
  }, []); // 仅挂载时

  // 已解锁模块编码集合：判定行内按钮显示「已解锁」
  const ownedCodes = useMemo(() => new Set((entitlements.data?.entitlements ?? []).map((item) => item.module_code)), [entitlements.data]);

  // 按可购买性过滤：在客户端过滤当前页，避免为筛选再改后端契约
  const rows = useMemo(() => {
    const list = modules.data?.modules ?? []; // 当前页模块
    if (availability === 'all') return list; // 不过滤
    if (availability === 'owned') return list.filter((item) => ownedCodes.has(item.code)); // 仅已解锁
    if (availability === 'free') return list.filter((item) => !item.current_price || item.current_price.amount_minor === 0); // 仅免费
    return list.filter((item) => item.current_price && item.current_price.amount_minor > 0); // 仅付费
  }, [modules.data, availability, ownedCodes]);

  /** 加购：成功后刷新购物车角标并标记该行 */
  async function addToCart(code: string) {
    setError(null); // 清空旧错误
    try {
      const result = await api.cart.add(code); // 后端幂等：已在车中直接回放
      setCart(result.cart); // 更新角标
      setAdded(code); // 行内提示
      window.setTimeout(() => setAdded((current) => (current === code ? null : current)), 1200); // 1.2s 后自动清除
    } catch (err) {
      setError(errorText(locale, err)); // 失败提示（如已解锁 409）
    } // try 结束
  } // addToCart 结束

  // 定时清空关键词提示不需要额外逻辑：搜索按钮提交时直接改 keyword

  return (
    <div className="page">
      <header className="page-head">
        <h1>{isZh ? '商品列表' : 'Products'}</h1>
        {/* 购物车入口与角标 */}
        <button type="button" className="btn ghost" onClick={() => navigate({ view: 'cart' })}>
          {isZh ? '购物车' : 'Cart'}
          {cart && cart.count > 0 ? <span className="cart-badge">{cart.count}</span> : null}
        </button>
      </header>

      {/* 筛选栏：关键词 / 分类 / 可购买性 / 排序 */}
      <section className="products-filter">
        <form
          className="products-search"
          onSubmit={(event) => {
            event.preventDefault(); // 阻止整页刷新
            setPage(1); // 搜索回到第一页
            setKeyword(q.trim()); // 提交关键词
          }}
        >
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder={isZh ? '搜索模块名称或编码' : 'Search modules'} />
          <button type="submit" className="btn">{isZh ? '搜索' : 'Search'}</button>
        </form>
        <select
          value={category}
          onChange={(event) => {
            setPage(1); // 换分类回到第一页
            setCategory(event.target.value); // 写分类
          }}
        >
          <option value="all">{isZh ? '全部分类' : 'All categories'}</option>
          {(taxonomy.data?.groups ?? []).map((group) => (
            <option key={group.slug} value={group.slug}>{isZh ? group.name : group.name_en ?? group.name}</option>
          ))}
        </select>
        <select value={availability} onChange={(event) => setAvailability(event.target.value as AvailabilityFilter)}>
          <option value="all">{isZh ? '全部商品' : 'All'}</option>
          <option value="free">{isZh ? '免费' : 'Free'}</option>
          <option value="paid">{isZh ? '付费' : 'Paid'}</option>
          <option value="owned">{isZh ? '已解锁' : 'Unlocked'}</option>
        </select>
        <select value={sort} onChange={(event) => setSort(event.target.value as 'recommended' | 'stars' | 'updated')}>
          <option value="recommended">{isZh ? '推荐排序' : 'Recommended'}</option>
          <option value="stars">{isZh ? '按 Star' : 'By stars'}</option>
          <option value="updated">{isZh ? '按更新' : 'By updated'}</option>
        </select>
      </section>

      {error ? <div className="chat-error">{error}</div> : null}
      {modules.loading ? <div className="hint">{isZh ? '加载中…' : 'Loading…'}</div> : null}
      {modules.error ? <div className="chat-error">{errorText(locale, modules.error)}</div> : null}

      {/* 密集列表：表格式，便于批量扫读与加购 */}
      <table className="products-table">
        <thead>
          <tr>
            <th>{isZh ? '模块' : 'Module'}</th>
            <th>{isZh ? '分类' : 'Category'}</th>
            <th>{isZh ? '价格' : 'Price'}</th>
            <th>{isZh ? '能力' : 'Capability'}</th>
            <th>{isZh ? '操作' : 'Action'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const name = row.name[locale] ?? row.name['zh-CN'] ?? row.code; // 名称按当前语言回落
            const owned = ownedCodes.has(row.code); // 是否已解锁
            const free = !row.current_price || row.current_price.amount_minor === 0; // 是否免费
            return (
              <tr key={row.code}>
                <td>
                  <div className="products-name">{name}</div>
                  <div className="products-code">{row.code}</div>
                </td>
                <td>{row.category_slug ?? '-'}</td>
                <td>{priceText(locale, row.current_price)}</td>
                <td>
                  {row.capability ? <span className="tag ok">{isZh ? '可用' : 'Ready'}</span> : row.code.startsWith('cat.') ? <span className="tag">{isZh ? '规划中' : 'Planned'}</span> : <span className="tag">{isZh ? '配套权益' : 'Add-on'}</span>}
                </td>
                <td>
                  {owned ? (
                    <span className="tag ok">{isZh ? '已解锁' : 'Unlocked'}</span>
                  ) : (
                    <button type="button" className="btn ghost" onClick={() => void addToCart(row.code)} disabled={added === row.code}>
                      {added === row.code ? (isZh ? '已加入' : 'Added') : free ? (isZh ? '免费领取' : 'Get free') : (isZh ? '加入购物车' : 'Add to cart')}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!modules.loading && rows.length === 0 ? <div className="hint">{isZh ? '没有符合条件的商品' : 'No products found'}</div> : null}

      {/* 分页：仅上一页 / 下一页，配合页码显示 */}
      <div className="products-pager">
        <button type="button" className="btn ghost" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
          {isZh ? '上一页' : 'Prev'}
        </button>
        <span className="hint">
          {isZh ? `第 ${modules.data?.page ?? page} / ${Math.max(1, modules.data?.total_pages ?? 1)} 页` : `Page ${modules.data?.page ?? page} / ${Math.max(1, modules.data?.total_pages ?? 1)}`}
        </span>
        <button
          type="button"
          className="btn ghost"
          disabled={page >= (modules.data?.total_pages ?? 1)}
          onClick={() => setPage((value) => value + 1)}
        >
          {isZh ? '下一页' : 'Next'}
        </button>
      </div>
    </div>
  );
} // Products 结束
