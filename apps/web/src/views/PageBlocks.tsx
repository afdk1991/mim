/** 公共页面区块渲染器：消费后台 page_blocks 配置，首页 / 论坛共用 */

import { useEffect, useState } from 'react';
import { api } from '../api';
import type { CommunityThread, PageBlock, ShopProduct } from '../api';
import { baseOf } from '../router';

interface Props { // 视图参数
  page: 'home' | 'forum' | string; // 页面标识
  locale?: 'zh-CN' | 'en-US'; // 语言
}

/** 站内链接补挂载前缀，外链原样返回。 */
function hrefOf(raw: unknown): string {
  const value = typeof raw === 'string' ? raw : '';
  if (!value) return baseOf(); // 空链接回站点根
  if (/^https?:\/\//i.test(value)) return value; // 外链不改写
  return baseOf() + value.replace(/^\//, ''); // 站内路径补 /mim/ 等前缀
}

/** 单块渲染：未知类型降级为提示，不抛错、不阻断整页。 */
function Block({ block }: { block: PageBlock }) {
  const config = block.config ?? {};
  if (block.kind === 'hero') {
    return (
      <section className="page-block hero"> // 区块 page-block
        <h2>{String(config.title ?? 'Mim')}</h2> // 标题
        {config.subtitle ? <p className="muted">{String(config.subtitle)}</p> : null}
        {config.cta && typeof config.cta === 'object' ? (
          <a className="btn primary" href={hrefOf((config.cta as Record<string, unknown>).href)}>{String((config.cta as Record<string, unknown>).label ?? '进入')}</a> // 链接
        ) : null}
      </section>
    );
  }
  if (block.kind === 'features') {
    const items = Array.isArray(config.items) ? (config.items as Array<Record<string, unknown>>) : [];
    return (
      <section className="page-block"> // 区块 page-block
        <div className="commerce-grid"> // 区块 commerce-grid
          {items.map((item) => (
            <article className="panel" key={String(item.title ?? Math.random())}> // 区块 panel
              <div className="panel-head"><h3>{String(item.title ?? '')}</h3></div> // 区块 panel-head
              <p className="muted">{String(item.text ?? '')}</p> // 区块 muted
            </article>
          ))}
        </div>
      </section>
    );
  }
  if (block.kind === 'tabs') {
    const tabs = Array.isArray(config.tabs) ? config.tabs.map(String) : [];
    return (
      <section className="page-block tabs"> // 区块 page-block
        {tabs.map((tab) => <span className="deploy-badge muted" key={tab}>{tab}</span>)}
      </section>
    );
  }
  if (block.kind === 'notice' || block.kind === 'announcements') {
    return (
      <section className="page-block notice"> // 区块 page-block
        <div className="panel-head"><h3>{String(config.title ?? (block.kind === 'notice' ? '公告' : '最新公告'))}</h3></div> // 区块 panel-head
        <p className="muted">{String(config.text ?? config.subtitle ?? '产品公告、更新日志与推广计划见社区公告板块。')}</p> // 区块 muted
        <a className="link" href={hrefOf('/community')}>查看社区公告</a> // 链接
      </section>
    );
  }
  if (block.kind === 'product_grid') {
    return <ProductGrid />;
  }
  return (
    <section className="page-block"> // 区块 page-block
      <div className="panel-head"><h3>{block.kind}</h3><span className="deploy-badge muted">区块</span></div> // 区块 panel-head
    </section>
  );
}

/** 商品网格区块：直接消费商城接口，卡片可点进商品列表。 */
function ProductGrid() {
  const [products, setProducts] = useState<ShopProduct[]>([]);
  useEffect(() => {
    let cancelled = false;
    void api.shop.products().then((data) => { if (!cancelled) setProducts(data.products.slice(0, 6)); }).catch(() => { /* 网络失败保留空态 */ });
    return () => { cancelled = true; };
  }, []);
  if (products.length === 0) return <section className="page-block"><p className="muted">商城商品加载中…</p></section>;
  return (
    <section className="page-block"> // 区块 page-block
      <div className="commerce-grid"> // 区块 commerce-grid
        {products.map((product) => (
          <a className="panel product" key={product.code} href={hrefOf('/products')}> // 链接
            {product.cover_url ? <img src={hrefOf(product.cover_url)} alt={product.name} loading="lazy" /> : null}
            <div className="panel-head"><h3>{product.name}</h3><span className="deploy-badge">{`¥${(product.price_cents / 100).toFixed(2)}`}</span></div>
            <p className="muted">{product.summary}</p> // 区块 muted
          </a>
        ))}
      </div>
    </section>
  );
}

/** 公告数据：社区公告板块最新三帖，失败时静默。 */
function useAnnouncements(enabled: boolean): CommunityThread[] {
  const [items, setItems] = useState<CommunityThread[]>([]);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    void api.community.threads({ board: 'announce', limit: 3 }).then((data) => { if (!cancelled) setItems(data.items); }).catch(() => { /* 公告加载失败不影响页面 */ });
    return () => { cancelled = true; };
  }, [enabled]);
  return items;
}

/** 页面区块入口。 */
export function PageBlocks({ page, locale = 'zh-CN' }: Props) {
  const [blocks, setBlocks] = useState<PageBlock[]>([]);
  const [failed, setFailed] = useState(false);
  const announcements = useAnnouncements(page === 'home' || page === 'forum');
  useEffect(() => {
    let cancelled = false;
    void api.commerce.page(page).then((data) => { if (!cancelled) setBlocks(data.blocks); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [page]);
  if (failed && blocks.length === 0) return null; // 区块接口不可用时整页照常渲染
  const hasAnnouncementBlock = blocks.some((block) => block.kind === 'announcements');
  return (
    <div className="page-blocks" data-page={page} data-locale={locale}> // 区块 page-blocks
      {blocks.map((block) => <Block block={block} key={block.id} />)}
      {hasAnnouncementBlock && announcements.length > 0 ? (
        <section className="page-block"> // 区块 page-block
          <div className="panel-head"><h3>社区公告</h3></div> // 区块 panel-head
          <ul className="plain-list"> // 区块 plain-list
            {announcements.map((thread) => (
              <li className="deploy-row" key={thread.id}> // 区块 deploy-row
                <a className="link" href={`${baseOf()}community?thread=${encodeURIComponent(thread.id)}`}>{thread.title}</a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
