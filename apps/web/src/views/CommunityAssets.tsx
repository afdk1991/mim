/**
 * 付费资产：列表与详情（2026-11-16）。
 *
 * 复用 /api/v1/assets 既有契约，挂在社区视图下的两段深链接：
 *   - /community/assets        列表（可检索 / 按类型筛选）
 *   - /community/assets/:code  详情（试读 + 购买 / 已拥有入口）
 * 匿名可读；购买与「我的资产」要求登录，付费墙由服务端判定，未解锁不下发正文与文件地址。
 */

import { useEffect, useState } from 'react'; // 状态与副作用
import type { Locale } from '@mim/i18n'; // 语言类型
import { ApiError, errorText } from '../api'; // 统一错误文案
import { assetUrl, fetchAsset, fetchAssets, purchaseAsset, type AssetDetail, type AssetKind, type AssetListItem } from '../api/assets'; // 资产端点
import { navigatePath, pathOf } from '../router'; // 站内深链接
import './community-assets.css'; // 本域独立样式：不改 styles.css / tokens.css

interface Props { // 组件契约
  locale: Locale; // 当前语言
  hasSession: boolean; // 是否有登录会话：决定购买按钮与「我的资产」入口行为
  code?: string; // 资产编码；空串表示列表页
  onRequireLogin?: () => void; // 未登录时的登录引导（由 App 负责跳转）
} // Props 结束

const KINDS: Array<{ key: AssetKind; zh: string; en: string }> = [ // 类型筛选项
  { key: 'article', zh: '付费阅读', en: 'Articles' },
  { key: 'download', zh: '下载资源', en: 'Downloads' },
  { key: 'gallery', zh: '图集', en: 'Galleries' },
  { key: 'video', zh: '视频', en: 'Videos' },
]; // 类型筛选项结束

const KIND_LABEL: Record<AssetKind, { zh: string; en: string }> = { // 类型展示名
  article: { zh: '付费阅读', en: 'Article' },
  download: { zh: '下载资源', en: 'Download' },
  gallery: { zh: '图集', en: 'Gallery' },
  video: { zh: '视频', en: 'Video' },
}; // 类型展示名结束

/** 价格文案：0 显示「免费」，其余按元保留两位。 */
function priceLabel(isZh: boolean, cents: number): string {
  if (cents <= 0) return isZh ? '免费' : 'Free';
  return `¥${(cents / 100).toFixed(2)}`;
} // priceLabel 结束

/** 渠道结果文案：购买接口返回的 via。 */
function viaLabel(isZh: boolean, via: string): string {
  if (via === 'owned') return isZh ? '你已拥有该资产' : 'Already owned';
  if (via === 'free') return isZh ? '免费资产已解锁' : 'Unlocked (free)';
  if (via === 'vip') return isZh ? '会员权益已解锁' : 'Unlocked by membership';
  return isZh ? '购买成功，已解锁' : 'Purchase complete';
} // viaLabel 结束

/** 列表页 */
function AssetList({ locale, hasSession, onRequireLogin }: Props) {
  const isZh = locale !== 'en-US'; // 是否中文
  const [draft, setDraft] = useState(''); // 输入框草稿
  const [query, setQuery] = useState(''); // 已提交的关键词
  const [kind, setKind] = useState<AssetKind | ''>(''); // 类型筛选
  const [items, setItems] = useState<AssetListItem[]>([]); // 列表数据
  const [vipLevel, setVipLevel] = useState(0); // 当前会员等级
  const [loading, setLoading] = useState(true); // 加载态
  const [error, setError] = useState(''); // 错误文案

  useEffect(() => { // 关键词 / 类型 / 登录态变化时重新拉取
    let alive = true; // 避免卸载后写状态
    setLoading(true); // 进入加载
    fetchAssets({ q: query, kind })
      .then((res) => {
        if (!alive) return;
        setItems(res.items); // 列表
        setVipLevel(res.vip_level); // 会员等级
        setError(''); // 清空错误
      })
      .catch((err) => { if (alive) setError(errorText(locale, err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [query, kind, locale, hasSession]);

  /** 打开「我的资产」：匿名先引导登录 */
  function openMine() {
    if (!hasSession) { onRequireLogin?.(); return; }
    navigatePath(pathOf('account', '', 'tab=assets'));
  } // openMine 结束

  return (
    <div className="asset-page">
      <header className="asset-head">
        <div>
          <p className="asset-kicker">MIM ASSETS</p>
          <h1>{isZh ? '付费资产' : 'Paid assets'}</h1>
          <p className="asset-sub">
            {isZh ? '付费阅读、下载资源、图集与视频，购买后在「我的资产」中随时访问。' : 'Articles, downloads, galleries and videos. Access your purchases from My assets.'}
          </p>
        </div>
        <div className="asset-head-side">
          <button type="button" className="asset-btn ghost" onClick={() => navigatePath(pathOf('community'))}>
            {isZh ? '返回社区' : 'Back to community'}
          </button>
          <button type="button" className="asset-btn primary" onClick={openMine}>
            {isZh ? '我的资产' : 'My assets'}
          </button>
        </div>
      </header>

      <form
        className="asset-toolbar"
        onSubmit={(event) => { event.preventDefault(); setQuery(draft.trim()); }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={isZh ? '搜索标题或简介' : 'Search title or summary'}
          aria-label={isZh ? '搜索资产' : 'Search assets'}
        />
        <button type="submit" className="asset-btn primary">{isZh ? '搜索' : 'Search'}</button>
        {query ? (
          <button type="button" className="asset-btn ghost" onClick={() => { setDraft(''); setQuery(''); }}>
            {isZh ? '清除' : 'Clear'}
          </button>
        ) : null}
        <div className="asset-filters" role="group" aria-label={isZh ? '按类型筛选' : 'Filter by type'}>
          <button type="button" className={kind === '' ? 'is-on' : ''} onClick={() => setKind('')}>{isZh ? '全部' : 'All'}</button>
          {KINDS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={kind === item.key ? 'is-on' : ''}
              onClick={() => setKind(item.key)}
            >
              {isZh ? item.zh : item.en}
            </button>
          ))}
        </div>
      </form>

      {vipLevel > 0 ? (
        <p className="asset-note">{isZh ? `当前 VIP ${vipLevel}，带会员标识的资产可直接解锁。` : `VIP ${vipLevel}: membership-inclusive assets unlock instantly.`}</p>
      ) : null}
      {error ? <div className="asset-error">{error}</div> : null}
      {loading ? <div className="asset-empty">{isZh ? '加载中…' : 'Loading…'}</div> : null}

      {!loading && !error && items.length === 0 ? (
        <div className="asset-empty">
          <strong>{isZh ? '没有找到匹配的资产' : 'No assets found'}</strong>
          <span>{isZh ? '换个关键词或类型试试。' : 'Try another keyword or type.'}</span>
        </div>
      ) : null}

      <div className="asset-grid">
        {items.map((item) => (
          <button
            key={item.code}
            type="button"
            className="asset-card"
            onClick={() => navigatePath(pathOf('community', `assets/${encodeURIComponent(item.code)}`))}
          >
            <span className="asset-cover">
              {item.cover_url ? (
                <img src={assetUrl(item.cover_url)} alt="" loading="lazy" />
              ) : (
                <span className="asset-cover-fallback">{KIND_LABEL[item.kind][isZh ? 'zh' : 'en']}</span>
              )}
              <span className={`asset-badge${item.unlocked ? ' is-unlocked' : ''}`}>
                {item.unlocked ? (isZh ? '已购' : 'Owned') : priceLabel(isZh, item.price_cents)}
              </span>
            </span>
            <span className="asset-card-body">
              <span className="asset-kind">{KIND_LABEL[item.kind][isZh ? 'zh' : 'en']}{item.vip_free === 1 ? (isZh ? ' · 会员免费' : ' · VIP free') : ''}</span>
              <strong className="asset-title">{item.title}</strong>
              <span className="asset-summary">{item.summary}</span>
              <span className="asset-meta">
                <span>{priceLabel(isZh, item.price_cents)}</span>
                <span>{isZh ? `已售 ${item.sales}` : `${item.sales} sold`}</span>
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
} // AssetList 结束

/** 详情页 */
function AssetDetailView({ locale, hasSession, code = '', onRequireLogin }: Props) {
  const isZh = locale !== 'en-US'; // 是否中文
  const [asset, setAsset] = useState<AssetDetail | null>(null); // 详情数据
  const [loading, setLoading] = useState(true); // 加载态
  const [error, setError] = useState(''); // 加载错误
  const [busy, setBusy] = useState(false); // 购买中间态
  const [notice, setNotice] = useState(''); // 成功提示
  const [buyError, setBuyError] = useState(''); // 购买错误
  const [needRecharge, setNeedRecharge] = useState(false); // 余额不足标记

  useEffect(() => { // 编码变化 / 登录态变化时重新拉取
    let alive = true;
    setLoading(true);
    fetchAsset(code)
      .then((res) => { if (alive) { setAsset(res.asset); setError(''); } })
      .catch((err) => { if (alive) setError(errorText(locale, err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [code, locale, hasSession]);

  /** 余额购买；匿名先引导登录 */
  async function buy() {
    if (!hasSession) { onRequireLogin?.(); return; }
    setBusy(true); setBuyError(''); setNotice(''); setNeedRecharge(false);
    try {
      const result = await purchaseAsset(code); // 服务端判定 free / vip / 余额扣款
      setNotice(viaLabel(isZh, result.via));
      const res = await fetchAsset(code); // 回读最新解锁状态
      setAsset(res.asset);
    } catch (err) {
      if (err instanceof ApiError) {
        const details = err.details as { reason?: string } | undefined;
        if (details?.reason === 'INSUFFICIENT_BALANCE') setNeedRecharge(true);
      }
      setBuyError(errorText(locale, err));
    } finally {
      setBusy(false);
    }
  } // buy 结束

  return (
    <div className="asset-page">
      <div className="asset-detail-top">
        <button type="button" className="asset-btn ghost" onClick={() => navigatePath(pathOf('community', 'assets'))}>
          {isZh ? '返回资产列表' : 'Back to assets'}
        </button>
        <button
          type="button"
          className="asset-btn ghost"
          onClick={() => { if (!hasSession) { onRequireLogin?.(); return; } navigatePath(pathOf('account', '', 'tab=assets')); }}
        >
          {isZh ? '我的资产' : 'My assets'}
        </button>
      </div>

      {loading ? <div className="asset-empty">{isZh ? '加载中…' : 'Loading…'}</div> : null}
      {error ? <div className="asset-error">{error}</div> : null}

      {asset ? (
        <article className="asset-detail">
          <header className="asset-detail-head">
            <span className="asset-kind">
              {KIND_LABEL[asset.kind][isZh ? 'zh' : 'en']}
              {asset.vip_free === 1 ? (isZh ? ' · 会员免费' : ' · VIP free') : ''}
            </span>
            <h1>{asset.title}</h1>
            <p className="asset-sub">{asset.summary}</p>
            <div className="asset-meta asset-meta-wide">
              <span>{priceLabel(isZh, asset.price_cents)}</span>
              <span>{isZh ? `销量 ${asset.sales}` : `${asset.sales} sold`}</span>
              <span>{isZh ? `浏览 ${asset.views}` : `${asset.views} views`}</span>
              <span>{new Date(asset.updated_at).toLocaleDateString()}</span>
            </div>
          </header>

          {asset.cover_url ? (
            <img className="asset-detail-cover" src={assetUrl(asset.cover_url)} alt="" loading="lazy" />
          ) : null}

          {notice ? <div className="asset-ok">{notice}</div> : null}
          {buyError ? <div className="asset-error">{buyError}</div> : null}

          {asset.unlocked ? (
            <div className="asset-owned">
              <strong>{isZh ? '已拥有该资产' : 'You own this asset'}</strong>
              <div className="asset-owned-actions">
                {asset.file_url ? (
                  <a className="asset-btn primary" href={assetUrl(asset.file_url)} target="_blank" rel="noreferrer">
                    {isZh ? '打开 / 下载' : 'Open / download'}
                  </a>
                ) : null}
                <button type="button" className="asset-btn ghost" onClick={() => navigatePath(pathOf('account', '', 'tab=assets'))}>
                  {isZh ? '在「我的资产」中查看' : 'View in My assets'}
                </button>
              </div>
            </div>
          ) : (
            <div className="asset-buy">
              <div className="asset-buy-price">
                <span>{isZh ? '解锁价格' : 'Price'}</span>
                <strong>{priceLabel(isZh, asset.price_cents)}</strong>
              </div>
              <div className="asset-buy-actions">
                <button type="button" className="asset-btn primary" disabled={busy} onClick={() => void buy()}>
                  {busy
                    ? (isZh ? '处理中…' : 'Processing…')
                    : hasSession
                      ? (isZh ? '余额购买' : 'Pay with balance')
                      : (isZh ? '登录后购买' : 'Sign in to buy')}
                </button>
                <button
                  type="button"
                  className="asset-btn ghost"
                  onClick={() => navigatePath(pathOf('checkout', '', `purpose=asset&ref=${encodeURIComponent(asset.code)}`))}
                >
                  {isZh ? '用其他方式支付' : 'Pay another way'}
                </button>
              </div>
              {needRecharge ? (
                <p className="asset-note">
                  {isZh ? '余额不足，可先充值后再购买。' : 'Insufficient balance.'}
                  <button type="button" className="asset-link" onClick={() => navigatePath(pathOf('checkout', '', 'purpose=recharge'))}>
                    {isZh ? '去充值' : 'Recharge'}
                  </button>
                </p>
              ) : null}
            </div>
          )}

          {asset.body ? (
            <div className="asset-body">
              {asset.body}
            </div>
          ) : null}

          {!asset.unlocked ? (
            <p className="asset-locked-hint">
              {asset.kind === 'article'
                ? (isZh ? '以上为试读片段，购买后可阅读全文。' : 'Preview only. Purchase to read the full article.')
                : (isZh ? '购买后可查看完整内容与下载地址。' : 'Purchase to view the full content and download link.')}
            </p>
          ) : null}

          {asset.unlocked && asset.media.length > 0 ? (
            <div className="asset-media">
              {asset.media.map((media, index) => (
                media.kind === 'video' ? (
                  <video key={`${media.url}-${index}`} src={assetUrl(media.url)} poster={media.poster_url ? assetUrl(media.poster_url) : undefined} controls preload="metadata" />
                ) : (
                  <img key={`${media.url}-${index}`} src={assetUrl(media.url)} alt="" loading="lazy" />
                )
              ))}
            </div>
          ) : null}
        </article>
      ) : null}
    </div>
  );
} // AssetDetailView 结束

/** 入口：有 code 渲染详情，否则渲染列表 */
export function CommunityAssets({ locale, hasSession, code = '', onRequireLogin }: Props) {
  return code
    ? <AssetDetailView locale={locale} hasSession={hasSession} code={code} onRequireLogin={onRequireLogin} />
    : <AssetList locale={locale} hasSession={hasSession} onRequireLogin={onRequireLogin} />;
} // CommunityAssets 结束
