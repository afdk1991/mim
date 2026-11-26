/**
 * 首页商品货架：完整展示商城的全部在售商品。
 *
 * 数据源（2026-11-26 与全量目录线对齐）：
 * - 首选 GET /mall/products（全量目录，分页 60/页，高清图走 /mall/img），
 *   该接口由全量目录线上线后自动生效，首页无需再次改动；
 * - 目录接口暂不可用时回退 GET /shop/products（既有独立商城），保证首页不空白。
 *
 * 设计约束：
 * 1) 不在前端截断商品：目录模式按页追加，旧商城模式按批揭示，最终都能看到全部；
 * 2) 首页只做浏览与跳转，组件内不出现「立即购买 / 确认下单 / 结算」按钮，
 *    登录态下也不会误触真实订单，下单统一留在商城页完成；
 * 3) 图片写宽高、懒加载、异步解码；商品请求放到浏览器空闲时执行，不抢首屏；
 * 4) 商品很多时用 content-visibility 跳过屏外卡片绘制（样式在 styles-colorful.css）。
 */

import { useEffect, useMemo, useState } from 'react'; // 状态、副作用与派生缓存
import { api } from '../api'; // 旧独立商城公开接口（兜底数据源）
import type { ShopProduct } from '../api'; // 旧商城商品结构
import { coverSrcset, request, resolvePublicUrl, resolveStaticUrl } from '../api/request'; // 请求器、封面 1x/2x 与公开地址补全
import { formatCurrency } from '@mim/i18n'; // 金额格式化：与全站同一实现
import type { Locale } from '@mim/i18n'; // 语言类型

/** 旧商城模式每次揭示的商品数量：避免商品多时一次性塞满首屏 */
const REVEAL_STEP = 24;
/** 全量目录模式每页数量：与后端 /mall/products 的上限 60 对齐 */
const MALL_PAGE_SIZE = 60;

/** 发货类型 → 中英标签；文案口径与社区商城保持一致 */
const KIND_LABEL: Record<ShopProduct['kind'], { zh: string; en: string }> = {
  physical: { zh: '实物发货', en: 'Physical' }, // 实物快递
  virtual_auto: { zh: '自动发卡', en: 'Auto key' }, // 支付后立即发卡密
  virtual_manual: { zh: '人工发货', en: 'Manual' }, // 人工联系排期
};

/** 全量目录商品：只声明首页用到的字段，避免和后端结构强耦合 */
interface MallProduct {
  id: string; // 本地商品主键
  title: string; // 展示标题
  subtitle?: string | null; // 副标题
  brand?: string | null; // 品牌
  category_path?: string[] | null; // 类目路径
  price_cents: number; // 分/支
  price_source?: string | null; // anonymous 有公开价 / inquiry 需询价
  stock?: number | null; // 展示库存
  cover_url?: string | null; // 封面（/api/v1/mall/img/...）
} // MallProduct 结束

/** 全量目录分页响应 */
interface MallListResponse {
  total: number; // 命中总数
  page: number; // 当前页
  page_size: number; // 每页数量
  items: MallProduct[]; // 当前页商品
} // MallListResponse 结束

/** 首页统一卡片模型：两种数据源都归一到这里，渲染层不区分来源 */
interface ShelfItem {
  key: string; // 稳定键
  name: string; // 商品名
  summary: string; // 简介
  priceCents: number; // 价格（分）
  inquiry: boolean; // 是否需询价（目录里无公开价）
  available: number; // 可售 / 展示库存
  coverUrl: string | null; // 封面原始地址
  badge: string; // 角标文案
  badgeClass: string; // 角标样式后缀
  note: string; // 发货 / 品牌 / 类目说明
  isCatalog: boolean; // 是否全量目录商品（决定封面地址处理方式）
} // ShelfItem 结束

/** 组件入参：首页只需要语言与「进入商城」的导航回调 */
interface ProductShelfProps {
  locale: Locale; // 当前界面语言
  title?: string; // 可选标题覆盖
  description?: string; // 可选说明覆盖
  onOpenShop: () => void; // 只做导航：进入商城页签 / 商城页，绝不下单
} // ProductShelfProps 结束

/** 浏览器空闲回调类型：requestIdleCallback 在部分环境不存在，故单独声明并兜底 */
type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number; // 空闲执行
  cancelIdleCallback?: (handle: number) => void; // 取消空闲执行
}; // IdleWindow 结束

/** 旧商城商品 → 统一卡片 */
function fromShop(product: ShopProduct, isEn: boolean): ShelfItem {
  return {
    key: product.code, // 旧商城用商品编码
    name: product.name, // 名称
    summary: product.summary || '—', // 简介
    priceCents: product.price_cents, // 价格
    inquiry: false, // 旧商城都有明码价
    available: product.available, // 可售
    coverUrl: product.cover_url, // 封面
    badge: isEn ? KIND_LABEL[product.kind].en : KIND_LABEL[product.kind].zh, // 发货类型
    badgeClass: `kind-${product.kind}`, // 角标样式
    note: product.delivery_note, // 发货说明
    isCatalog: false, // 静态封面，可派生 2x
  }; // 返回统一卡片
} // fromShop 结束

/** 全量目录商品 → 统一卡片 */
function fromMall(product: MallProduct, isEn: boolean): ShelfItem {
  const path = Array.isArray(product.category_path) ? product.category_path.filter(Boolean) : []; // 类目路径容错
  const inquiry = product.price_source === 'inquiry' || !product.price_cents; // 无公开价 → 询价
  return {
    key: product.id, // 目录主键
    name: product.title, // 标题
    summary: product.subtitle || path.slice(-2).join(' / ') || '—', // 副标题优先，其次类目
    priceCents: product.price_cents, // 价格
    inquiry, // 是否询价
    available: product.stock ?? 0, // 展示库存
    coverUrl: product.cover_url || null, // 封面
    badge: isEn ? 'Catalog' : '全量目录', // 角标：说明来自全量目录
    badgeClass: 'kind-catalog', // 角标样式
    note: product.brand ? (isEn ? `Brand: ${product.brand}` : `品牌：${product.brand}`) : (path.join(' / ') || '—'), // 品牌或类目
    isCatalog: true, // 目录商品
  }; // 返回统一卡片
} // fromMall 结束

/** 首页商品货架：优先全量目录，失败回退旧商城 */
export function ProductShelf({ locale, title, description, onOpenShop }: ProductShelfProps) {
  const isEn = locale === 'en-US'; // 语言判定：仅用于文案与金额格式
  const [mode, setMode] = useState<'mall' | 'shop'>('shop'); // 当前数据源：目录优先，兜底旧商城
  const [items, setItems] = useState<ShelfItem[]>([]); // 已加载商品全集
  const [total, setTotal] = useState(0); // 后端总数（目录模式）或已加载数（旧商城）
  const [page, setPage] = useState(1); // 目录模式当前页
  const [hasMore, setHasMore] = useState(false); // 目录模式是否还有下一页
  const [visible, setVisible] = useState(REVEAL_STEP); // 旧商城模式已揭示数量
  const [loaded, setLoaded] = useState(false); // 是否完成首读：区分骨架与空态
  const [loadingMore, setLoadingMore] = useState(false); // 追加加载中：防重复点击

  useEffect(() => {
    let alive = true; // 卸载标记：组件销毁后不再回写状态
    /** 首读：先试全量目录，失败回退旧商城，都失败则保持空态 */
    const loadFirst = async () => {
      try {
        const data = await request<MallListResponse>( // 全量目录第 1 页
          `/mall/products?page=1&page_size=${MALL_PAGE_SIZE}&sort=default`,
          { auth: false, idempotency: false }, // 公开只读，无需鉴权与幂等键
        ); // 请求结束
        if (!alive) return; // 已卸载则丢弃
        if (data.total === 0 || data.items.length === 0) throw new Error('catalog empty'); // 目录尚未导入时走旧商城兜底，避免首页空白
        const list = data.items.map((item) => fromMall(item, isEn)); // 归一化
        setMode('mall'); // 记录数据源
        setItems(list); // 第 1 页
        setTotal(data.total); // 后端总数
        setPage(1); // 回到第 1 页
        setHasMore(list.length < data.total); // 是否还有下一页
      } catch {
        try {
          const data = await api.shop.products(); // 兜底：旧独立商城
          if (!alive) return; // 已卸载则丢弃
          const list = data.products.map((item) => fromShop(item, isEn)); // 归一化
          setMode('shop'); // 记录数据源
          setItems(list); // 全部商品
          setTotal(list.length); // 旧商城总数
          setHasMore(false); // 旧商城一次性返回，不再分页
        } catch {
          /* 两个数据源都失败：保留空态，不影响首页其他区块 */
        }
      } finally {
        if (alive) setLoaded(true); // 结束首读
      }
    }; // loadFirst 结束
    const idleWindow = window as IdleWindow; // 取带空闲 API 的窗口类型
    const requestIdle = idleWindow.requestIdleCallback; // 先取出再判断：部分旧浏览器没有该 API
    const cancelIdle = idleWindow.cancelIdleCallback; // 取消函数与请求函数成对使用
    // 优先用 requestIdleCallback（带 1.2s 兜底超时），不支持时退化为 300ms 短延时
    const handle = typeof requestIdle === 'function'
      ? requestIdle.call(idleWindow, () => { void loadFirst(); }, { timeout: 1200 })
      : window.setTimeout(() => { void loadFirst(); }, 300);
    return () => {
      alive = false; // 先标记卸载，防止异步回写
      // 按创建方式清理定时器 / 空闲任务，避免卸载后仍发请求
      if (typeof requestIdle === 'function' && typeof cancelIdle === 'function') cancelIdle.call(idleWindow, handle);
      else window.clearTimeout(handle);
    }; // 清理函数结束
  }, [isEn]); // 语言变化只在标题文案上体现，数据源不变；按 isEn 保持依赖完整

  /** 追加：目录模式拉下一页，旧商城模式多揭示一批 */
  const loadMore = async () => {
    if (loadingMore) return; // 防止重复点击
    if (mode === 'mall' && hasMore) { // 目录模式：按页追加
      setLoadingMore(true); // 锁定按钮
      try {
        const next = await request<MallListResponse>( // 下一页
          `/mall/products?page=${page + 1}&page_size=${MALL_PAGE_SIZE}&sort=default`,
          { auth: false, idempotency: false }, // 公开只读
        ); // 请求结束
        const list = next.items.map((item) => fromMall(item, isEn)); // 归一化
        const merged = [...items, ...list]; // 合并已加载
        setItems(merged); // 回写
        setPage(page + 1); // 页码前进
        setHasMore(merged.length < next.total); // 是否还有
      } catch {
        setHasMore(false); // 失败就停止追加，已加载内容保留
      } finally {
        setLoadingMore(false); // 解锁按钮
      }
    } else if (mode === 'shop') { // 旧商城模式：揭示下一批
      setVisible((count) => count + REVEAL_STEP); // 追加一批
    }
  }; // loadMore 结束

  // 实际渲染的卡片：目录模式已加载多少渲染多少；旧商城模式按揭示数量切片
  const shown = useMemo(() => (mode === 'mall' ? items : items.slice(0, visible)), [mode, items, visible]);
  // 剩余数量：目录模式用后端总数减已加载；旧商城模式用已加载减已揭示
  const remaining = mode === 'mall'
    ? (hasMore ? Math.max(0, total - items.length) : 0)
    : Math.max(0, items.length - visible);
  const heading = title ?? (isEn ? 'Community mall · All products' : '社区商城 · 全部商品'); // 区块标题
  const sub = description ?? (isEn
    ? 'Every product on the shelf is listed here. Ordering and payment stay in the mall page.'
    : '首页完整展示商城在售的全部商品；下单与支付统一在商城页完成，首页不提供任何直接提交入口。'); // 区块说明

  return (
    <section className="product-shelf" data-theme-section="shop" aria-labelledby="product-shelf-title">
      <div className="product-shelf-head">{/* 标题行：标题 / 说明 / 数量 / 进入商城 */}
        <div className="product-shelf-titles">
          <p className="product-shelf-kicker">{isEn ? 'ALL PRODUCTS' : '全部商品'}</p>{/* 小标签 */}
          <h2 id="product-shelf-title">{heading}</h2>{/* 区块标题 */}
          <p className="product-shelf-sub">{sub}</p>{/* 说明：明确首页只浏览不下单 */}
        </div>
        <div className="product-shelf-actions">{/* 右侧：总数 + 导航按钮 */}
          {loaded && <span className="product-shelf-count">{isEn ? `${total} items` : `共 ${total} 件`}</span>}{/* 首读完成后再显示总数，避免先闪一个 0 */}
          <button type="button" className="btn ghost small" onClick={onOpenShop}>{isEn ? 'Open mall' : '进入商城'}</button>
        </div>
      </div>

      {!loaded && ( // 首读骨架：占住网格高度，避免商品出现时整页跳动
        <div className="product-shelf-grid product-shelf-skeleton" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, index) => ( // 固定四张占位卡
            <div className="product-shelf-card" key={`skeleton-${index}`}>
              <span className="product-shelf-cover" />
              <div className="product-shelf-body">
                <span className="product-shelf-line w-70" />
                <span className="product-shelf-line w-100" />
                <span className="product-shelf-line w-40" />
              </div>
            </div>
          ))}
        </div>
      )}

      {loaded && items.length === 0 && ( // 空态：两个数据源都没有在售商品
        <p className="product-shelf-empty">{isEn ? 'No products on sale yet.' : '商城暂无在售商品，稍后再来看看。'}</p>
      )}

      {loaded && items.length > 0 && ( // 有商品时渲染真实卡片
        <div className="product-shelf-grid">
          {shown.map((item, index) => (
            <article className="product-shelf-card" key={item.key}>{/* 单件商品 */}
              <button type="button" className="product-shelf-cover" onClick={onOpenShop} aria-label={isEn ? `Open ${item.name} in mall` : `在商城中查看 ${item.name}`}>{/* 封面按钮只跳转，不提交 */}
                {item.coverUrl ? ( // 有封面走高清图
                  <img
                    src={item.isCatalog ? resolvePublicUrl(item.coverUrl) : resolveStaticUrl(item.coverUrl)} // 目录图走 API 源，旧商城静态封面走 Web 源
                    srcSet={item.isCatalog ? undefined : (coverSrcset(item.coverUrl) || undefined)} // 仅静态封面有 2x 档；目录图本身即高清
                    alt={`${item.name} 商品封面`} // 可读替代文本
                    width={800} // 固定宽高比：预留空间，避免 CLS
                    height={600}
                    loading={index < 4 ? 'eager' : 'lazy'} // 首屏前四张立即取，其余滚动到再取
                    decoding="async" // 异步解码，不阻塞主线程
                  />
                ) : (
                  <span className="product-shelf-placeholder" aria-hidden="true">{item.name.slice(0, 1)}</span> // 无封面用首字占位
                )}
                <span className={`product-shelf-kind ${item.badgeClass}`}>{item.badge}</span>{/* 来源 / 发货类型角标 */}
              </button>
              <div className="product-shelf-body">{/* 文案区 */}
                <h3>{item.name}</h3>{/* 商品名 */}
                <p>{item.summary}</p>{/* 简介 */}
                <div className="product-shelf-meta">{/* 价格与可售 */}
                  <strong>{item.inquiry ? (isEn ? 'Inquire' : '询价') : formatCurrency(item.priceCents, 'CNY', locale)}</strong>
                  <span>{isEn ? `${item.available} left` : `可售 ${item.available}`}</span>
                </div>
                <small>{item.note}</small>{/* 发货 / 品牌说明 */}
                <button type="button" className="product-shelf-link" onClick={onOpenShop}>{isEn ? 'View in mall →' : '去商城查看 →'}</button>{/* 只跳转 */}
              </div>
            </article>
          ))}
        </div>
      )}

      {remaining > 0 && ( // 还有未展示商品时给「加载更多」，保证最终能看到全部
        <div className="product-shelf-more">
          <button type="button" className="btn primary" onClick={() => { void loadMore(); }} disabled={loadingMore}>
            {loadingMore
              ? (isEn ? 'Loading…' : '加载中…')
              : (isEn ? `Show more (${remaining})` : `加载更多商品（还有 ${remaining} 件）`)}
          </button>
        </div>
      )}
    </section>
  ); // 货架视图结束
} // ProductShelf 结束
