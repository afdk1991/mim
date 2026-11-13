/** 公共页面区块渲染器：消费后台 page_blocks 配置，首页 / 论坛共用 */

import { useEffect, useState } from 'react'; // 引入依赖、类型或本地模块绑定
import { api } from '../api'; // 引入依赖、类型或本地模块绑定
import type { CommunityThread, PageBlock, ShopProduct } from '../api'; // 引入依赖、类型或本地模块绑定
import { baseOf } from '../router'; // 引入依赖、类型或本地模块绑定

interface Props { // 视图参数
  page: 'home' | 'forum' | string; // 页面标识
  locale?: 'zh-CN' | 'en-US'; // 语言
} // 代码块结束

/** 站内链接补挂载前缀，外链原样返回。 */
function hrefOf(raw: unknown): string {
  const value = typeof raw === 'string' ? raw : ''; // 常量 value：保存固定配置或一次性派生值
  if (!value) return baseOf(); // 空链接回站点根
  if (/^https?:\/\//i.test(value)) return value; // 外链不改写
  return baseOf() + value.replace(/^\//, ''); // 站内路径补 /mim/ 等前缀
} // 代码块结束

/** 单块渲染：未知类型降级为提示，不抛错、不阻断整页。 */
function Block({ block }: { block: PageBlock }) {
  const config = block.config ?? {}; // 常量 config：保存固定配置或一次性派生值
  if (block.kind === 'hero') { // 条件分支：按判断结果选择后续处理路径
    return ( // 返回当前函数的处理结果
      <section className="page-block hero">{/* 执行当前业务步骤 */}
        <h2>{String(config.title ?? 'Mim')}</h2>
        {config.subtitle ? <p className="muted">{String(config.subtitle)}</p> : null}
        {config.cta && typeof config.cta === 'object' ? (
          <a className="btn primary" href={hrefOf((config.cta as Record<string, unknown>).href)}>{String((config.cta as Record<string, unknown>).label ?? '进入')}</a>
        ) : null}
      </section>
    ); // 执行当前业务步骤
  } // 代码块结束
  if (block.kind === 'features') { // 条件分支：按判断结果选择后续处理路径
    const items = Array.isArray(config.items) ? (config.items as Array<Record<string, unknown>>) : []; // 常量 items：保存固定配置或一次性派生值
    return ( // 返回当前函数的处理结果
      <section className="page-block">{/* 执行当前业务步骤 */}
        <div className="commerce-grid">{/* 执行当前业务步骤 */}
          {items.map((item) => (
            <article className="panel" key={String(item.title ?? Math.random())}>{/* 执行当前业务步骤 */}
              <div className="panel-head"><h3>{String(item.title ?? '')}</h3></div>
              <p className="muted">{String(item.text ?? '')}</p>
            </article>
          ))}
        </div>
      </section>
    ); // 执行当前业务步骤
  } // 代码块结束
  if (block.kind === 'tabs') { // 条件分支：按判断结果选择后续处理路径
    const tabs = Array.isArray(config.tabs) ? config.tabs.map(String) : []; // 常量 tabs：保存固定配置或一次性派生值
    return ( // 返回当前函数的处理结果
      <section className="page-block tabs">{/* 执行当前业务步骤 */}
        {tabs.map((tab) => <span className="deploy-badge muted" key={tab}>{tab}</span>)}
      </section>
    ); // 执行当前业务步骤
  } // 代码块结束
  if (block.kind === 'notice' || block.kind === 'announcements') { // 条件分支：按判断结果选择后续处理路径
    return ( // 返回当前函数的处理结果
      <section className="page-block notice">{/* 执行当前业务步骤 */}
        <div className="panel-head"><h3>{String(config.title ?? (block.kind === 'notice' ? '公告' : '最新公告'))}</h3></div>
        <p className="muted">{String(config.text ?? config.subtitle ?? '产品公告、更新日志与推广计划见社区公告板块。')}</p>
        <a className="link" href={hrefOf('/community')}>查看社区公告</a>
      </section>
    ); // 执行当前业务步骤
  } // 代码块结束
  if (block.kind === 'button') { // 条件分支：按判断结果选择后续处理路径
    const variant = config.variant === 'ghost' ? 'ghost' : 'primary'; // 常量 variant：保存固定配置或一次性派生值
    return ( // 返回当前函数的处理结果
      <section className="page-block block-button">{/* 执行当前业务步骤 */}
        <a className={`btn ${variant}`} href={hrefOf(config.href)}>{String(config.label ?? '查看详情')}</a>
      </section>
    ); // 执行当前业务步骤
  } // 代码块结束
  if (block.kind === 'image_text') { // 条件分支：按判断结果选择后续处理路径
    const align = config.align === 'right' ? 'right' : 'left'; // 常量 align：保存固定配置或一次性派生值
    return ( // 返回当前函数的处理结果
      <section className={`page-block image-text align-${align}`}>{/* 执行当前业务步骤 */}
        {config.image_url ? <img src={hrefOf(config.image_url)} alt={String(config.title ?? '')} loading="lazy" /> : null}
        <div className="image-text-body">{/* 执行当前业务步骤 */}
          {config.title ? <h3>{String(config.title)}</h3> : null}
          {config.body ? <p className="muted">{String(config.body)}</p> : null}
          {config.href ? <a className="link" href={hrefOf(config.href)}>{String(config.link_label ?? '了解更多')}</a> : null}
        </div>
      </section>
    ); // 执行当前业务步骤
  } // 代码块结束
  if (block.kind === 'announcement') { // 条件分支：按判断结果选择后续处理路径
    return ( // 返回当前函数的处理结果
      <section className="page-block notice">{/* 执行当前业务步骤 */}
        <div className="panel-head">{/* 执行当前业务步骤 */}
          <h3>{String(config.title ?? '公告')}</h3>
          {config.pinned ? <span className="deploy-badge">置顶</span> : null}
        </div>
        <p className="muted">{String(config.body ?? config.text ?? '')}</p>
      </section>
    ); // 执行当前业务步骤
  } // 代码块结束
  if (block.kind === 'product_grid') { // 条件分支：按判断结果选择后续处理路径
    return <ProductGrid />; // 返回当前函数的处理结果
  } // 代码块结束
  return ( // 返回当前函数的处理结果
    <section className="page-block">{/* 执行当前业务步骤 */}
      <div className="panel-head"><h3>{block.kind}</h3><span className="deploy-badge muted">区块</span></div>
    </section>
  ); // 执行当前业务步骤
} // 代码块结束

/** 商品网格区块：直接消费商城接口，卡片可点进商品列表。 */
function ProductGrid() {
  const [products, setProducts] = useState<ShopProduct[]>([]); // 赋值：更新变量 const 的取值
  useEffect(() => {
    let cancelled = false; // 可变变量 cancelled：运行过程中会被重新赋值
    void api.shop.products().then((data) => { if (!cancelled) setProducts(data.products.slice(0, 6)); }).catch(() => { /* 网络失败保留空态 */ });
    return () => { cancelled = true; }; // 返回当前函数的处理结果
  }, []);
  if (products.length === 0) return <section className="page-block"><p className="muted">商城商品加载中…</p></section>; // 条件分支：按判断结果选择后续处理路径
  return ( // 返回当前函数的处理结果
    <section className="page-block">{/* 执行当前业务步骤 */}
      <div className="commerce-grid">{/* 执行当前业务步骤 */}
        {products.map((product) => (
          <a className="panel product" key={product.code} href={hrefOf('/products')}>{/* 执行当前业务步骤 */}
            {product.cover_url ? <img src={hrefOf(product.cover_url)} alt={product.name} loading="lazy" /> : null}
            <div className="panel-head"><h3>{product.name}</h3><span className="deploy-badge">{`¥${(product.price_cents / 100).toFixed(2)}`}</span></div>
            <p className="muted">{product.summary}</p>
          </a>
        ))}
      </div>
    </section>
  ); // 执行当前业务步骤
} // 代码块结束

/** 公告数据：社区公告板块最新三帖，失败时静默。 */
function useAnnouncements(enabled: boolean): CommunityThread[] {
  const [items, setItems] = useState<CommunityThread[]>([]); // 赋值：更新变量 const 的取值
  useEffect(() => {
    if (!enabled) return undefined; // 条件分支：按判断结果选择后续处理路径
    let cancelled = false; // 可变变量 cancelled：运行过程中会被重新赋值
    void api.community.threads({ board: 'announce', limit: 3 }).then((data) => { if (!cancelled) setItems(data.items); }).catch(() => { /* 公告加载失败不影响页面 */ });
    return () => { cancelled = true; }; // 返回当前函数的处理结果
  }, [enabled]);
  return items; // 返回当前函数的处理结果
} // 代码块结束

/** 页面区块入口。 */
export function PageBlocks({ page, locale = 'zh-CN' }: Props) {
  const [blocks, setBlocks] = useState<PageBlock[]>([]); // 赋值：更新变量 const 的取值
  const [failed, setFailed] = useState(false); // 赋值：更新变量 const 的取值
  const announcements = useAnnouncements(page === 'home' || page === 'forum'); // 常量 announcements：保存固定配置或一次性派生值
  useEffect(() => {
    let cancelled = false; // 可变变量 cancelled：运行过程中会被重新赋值
    void api.commerce.page(page).then((data) => { if (!cancelled) setBlocks(data.blocks); }).catch(() => { if (!cancelled) setFailed(true); }); // 执行当前业务步骤
    return () => { cancelled = true; }; // 返回当前函数的处理结果
  }, [page]);
  if (failed && blocks.length === 0) return null; // 区块接口不可用时整页照常渲染
  // 前台按 sort_order 升序渲染（后端已排序，前端再兜底一次，防止乱序配置打乱版面）
  const orderedBlocks = [...blocks].sort((a, b) => a.sort_order - b.sort_order);
  const hasAnnouncementBlock = blocks.some((block) => block.kind === 'announcements'); // 常量 hasAnnouncementBlock：保存固定配置或一次性派生值
  return ( // 返回当前函数的处理结果
    <div className="page-blocks" data-page={page} data-locale={locale}>{/* 执行当前业务步骤 */}
      {orderedBlocks.map((block) => <Block block={block} key={block.id} />)}
      {hasAnnouncementBlock && announcements.length > 0 ? (
        <section className="page-block">{/* 执行当前业务步骤 */}
          <div className="panel-head"><h3>社区公告</h3></div>
          <ul className="plain-list">{/* 执行当前业务步骤 */}
            {announcements.map((thread) => (
              <li className="deploy-row" key={thread.id}>{/* 执行当前业务步骤 */}
                <a className="link" href={`${baseOf()}community?thread=${encodeURIComponent(thread.id)}`}>{thread.title}</a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  ); // 执行当前业务步骤
} // 代码块结束
