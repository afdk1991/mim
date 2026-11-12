/** 社区论坛与变现中心：论坛 / 付费阅读 / VIP / 钱包 / 独立商城 / 推广 */

import { useEffect, useState } from 'react';
import type { Locale } from '@mim/i18n';
import { api, errorText } from '../api';
import type {
  CommunityBoard,
  CommunityPost,
  CommunityThread,
  CommunityThreadDetail,
  ShopOrder,
  ShopProduct,
  ThreadKind,
  VipPlan,
  WalletSnapshot,
  WalletTransaction,
} from '../api';

interface Props {
  locale: Locale;
}

type Tab = 'forum' | 'vip' | 'wallet' | 'shop' | 'referral';

const KIND_LABEL: Record<ThreadKind, string> = {
  text: '图文',
  video: '视频',
  gallery: '图集',
  series: '剧集',
  qa: '问答',
  poll: '投票',
};

const PRODUCT_KIND: Record<ShopProduct['kind'], string> = {
  physical: '实物 · 快递',
  virtual_auto: '虚拟 · 自动发卡',
  virtual_manual: '虚拟 · 人工发货',
};

const ORDER_STATUS: Record<ShopOrder['status'], string> = {
  pending: '待支付',
  paid: '已支付',
  delivered: '已发货',
  refunded: '已退款',
  cancelled: '已取消',
};

const TX_KIND: Record<WalletTransaction['kind'], string> = {
  recharge: '充值',
  consume: '消费',
  refund: '退款',
  commission: '分成',
  withdraw: '提现',
  points: '积分',
};

function yuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

function coverSrc(url: string | null): string {
  if (!url) return '';
  if (/^(https?:)?\//.test(url)) return url;
  return `${import.meta.env.BASE_URL}${url.replace(/^\//, '')}`;
}

function dateOnly(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

/** 社区与变现页 */
export function Community({ locale }: Props) {
  const [tab, setTab] = useState<Tab>('forum');
  const [boards, setBoards] = useState<CommunityBoard[]>([]);
  const [stats, setStats] = useState({ threads: 0, views: 0, likes: 0 });
  const [wallet, setWallet] = useState<WalletSnapshot | null>(null);
  const [vipLevel, setVipLevel] = useState(0);
  const [vipExpires, setVipExpires] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [board, setBoard] = useState('all');
  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState<'latest' | 'hot' | 'views' | 'replies' | 'favorites' | 'rating'>('latest');
  const [query, setQuery] = useState('');
  const [threads, setThreads] = useState<CommunityThread[]>([]);
  const [selected, setSelected] = useState<{ thread: CommunityThreadDetail; posts: CommunityPost[]; liked: boolean; unlocked: boolean; favorited: boolean } | null>(null);

  const [composerOpen, setComposerOpen] = useState(false);
  const [draftBoard, setDraftBoard] = useState('general');
  const [draftKind, setDraftKind] = useState<ThreadKind>('text');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftSummary, setDraftSummary] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftPrice, setDraftPrice] = useState('0');
  const [draftMedia, setDraftMedia] = useState('');
  const [draftPoll, setDraftPoll] = useState('');
  const [reply, setReply] = useState('');;

  const [plans, setPlans] = useState<VipPlan[]>([]);
  const [walletDetail, setWalletDetail] = useState<{ checked_in_today: boolean; transactions: WalletTransaction[] } | null>(null);
  const [redeemCode, setRedeemCode] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [favorites, setFavorites] = useState<CommunityThread[]>([]);

  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [buying, setBuying] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [coupon, setCoupon] = useState('');
  const [shipName, setShipName] = useState('');
  const [shipPhone, setShipPhone] = useState('');
  const [shipAddress, setShipAddress] = useState('');
  const [lastOrder, setLastOrder] = useState<{ order_id: string; payable_cents: number; delivery_kind: string } | null>(null);

  const [referral, setReferral] = useState<{ code: string; invited: { count: number; commission: number }; commission_cents: number } | null>(null);
  const [bindCode, setBindCode] = useState('');

  async function loadOverview() {
    try {
      const data = await api.community.overview();
      setBoards(data.boards);
      setStats(data.stats);
      setWallet(data.wallet);
      setVipLevel(data.vip_level);
      setVipExpires(data.vip?.expires_at ?? null);
      setError(null);
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setLoading(false);
    }
  }

  async function loadThreads() {
    try {
      const data = await api.community.threads({ board, kind, sort, q: query, limit: 40 });
      setThreads(data.items);
      setError(null);
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  async function loadWallet() {
    try {
      const data = await api.wallet.get();
      setWallet(data.wallet);
      setWalletDetail({ checked_in_today: data.checked_in_today, transactions: data.transactions });
      setVipLevel(data.vip_level);
      if (vipExpires === null) setVipExpires(null);
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  async function loadShop() {
    try {
      const [p, o] = await Promise.all([api.shop.products(), api.shop.orders()]);
      setProducts(p.products);
      setOrders(o.items);
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  async function loadPlans() {
    try {
      const data = await api.vip.plans();
      setPlans(data.plans);
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  async function loadReferral() {
    try {
      setReferral(await api.referral.get());
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  useEffect(() => {
    void loadOverview();
    void loadPlans();
  }, []);

  useEffect(() => {
    if (tab === 'forum') void loadThreads();
  }, [board, kind, sort]);

  useEffect(() => {
    if (tab === 'wallet') void loadWallet();
    if (tab === 'shop') void loadShop();
    if (tab === 'referral') void loadReferral();
  }, [tab]);

  useEffect(() => {
    if (!favoritesOpen) return;
    api.community
      .favorites()
      .then((data) => setFavorites(data.items))
      .catch((err) => setError(errorText(locale, err)));
  }, [favoritesOpen]);

  async function openThread(id: string) {
    try {
      const data = await api.community.thread(id);
      setSelected(data);
      setReply('');
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  async function unlockThread(id: string) {
    try {
      const result = await api.community.unlock(id);
      setNotice(result.via === 'vip' ? 'VIP 权益直接解锁' : result.charged_cents > 0 ? `已扣 ${yuan(result.charged_cents)} 解锁` : '已解锁');
      await Promise.all([openThread(id), loadOverview()]);
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  async function submitReply() {
    if (!selected || !reply.trim()) return;
    try {
      await api.community.reply(selected.thread.id, reply.trim());
      setReply('');
      await openThread(selected.thread.id);
      setNotice('回复已发布');
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  async function toggleLike() {
    if (!selected) return;
    try {
      const result = await api.community.like(selected.thread.id);
      setSelected({ ...selected, liked: result.liked, thread: { ...selected.thread, likes: selected.thread.likes + (result.liked ? 1 : -1) } });
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  async function toggleFavorite() {
    if (!selected) return;
    try {
      const result = await api.community.favorite(selected.thread.id);
      setSelected({ ...selected, favorited: result.favorited });
      setNotice(result.favorited ? '已加入收藏' : '已取消收藏');
      await loadOverview();
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  async function rateThread(rating: number) {
    if (!selected) return;
    try {
      await api.community.rate(selected.thread.id, rating);
      await openThread(selected.thread.id);
      setNotice(`已评 ${rating} 星`);
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  async function vote(optionId: string) {
    if (!selected) return;
    try {
      await api.community.vote(selected.thread.id, optionId);
      await openThread(selected.thread.id);
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  async function joinBoard(slug: string) {
    try {
      const result = await api.community.joinBoard(slug);
      setNotice(result.charged_cents > 0 ? `已扣 ${yuan(result.charged_cents)} 加入板块` : '已加入板块');
      setBoard(slug);
      await Promise.all([loadOverview(), loadThreads()]);
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  async function transferPoints() {
    const points = Number(transferAmount);
    if (!transferTo.trim() || !Number.isInteger(points) || points <= 0) {
      setError('请填写接收方 Mim ID 与正整数积分');
      return;
    }
    try {
      const result = await api.wallet.transferPoints({ to_member_no: transferTo.trim(), points });
      setNotice(`已转 ${result.points} 积分给 ${result.to}`);
      setTransferTo('');
      setTransferAmount('');
      await loadWallet();
    } catch (err) {
      setError(errorText(locale, err));
    }
  }
  async function createThread() {
    if (!draftTitle.trim() || !draftBody.trim()) {
      setError('标题与正文必填');
      return;
    }
    try {
      const mediaLines = draftMedia
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const pollLines = draftPoll
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const media = mediaLines.map((url) => ({
        kind: draftKind === 'video' && /\.(mp4|mov|m3u8|webm)(\?|$)/i.test(url) ? ('video' as const) : ('image' as const),
        url,
      }));
      const created = await api.community.createThread({
        board_slug: draftBoard,
        title: draftTitle.trim(),
        summary: draftSummary.trim(),
        body: draftBody.trim(),
        kind: draftKind,
        price_cents: Math.max(0, Math.round(Number(draftPrice || '0') * 100)),
        media,
        poll_options: draftKind === 'poll' ? pollLines : undefined,
      });
      setDraftTitle('');
      setDraftSummary('');
      setDraftBody('');
      setDraftPrice('0');
      setDraftMedia('');
      setDraftPoll('');
      setComposerOpen(false);
      setNotice('帖子已发布');
      await loadThreads();
      await openThread(created.thread_id);
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  async function subscribe(code: string) {
    try {
      const result = await api.vip.subscribe(code);
      setNotice(`开通成功，VIP ${result.level} 到期 ${dateOnly(result.expires_at)}`);
      await Promise.all([loadOverview(), loadWallet()]);
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  async function checkin() {
    try {
      const result = await api.wallet.checkin();
      setNotice(`签到 +${result.points} 积分`);
      await loadWallet();
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  async function redeem() {
    if (!redeemCode.trim()) return;
    try {
      const result = await api.wallet.redeem(redeemCode.trim());
      setNotice(`充值成功 ${yuan(result.amount_cents)}`);
      setRedeemCode('');
      await loadWallet();
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  async function placeOrder(product: ShopProduct) {
    try {
      const payload: { product_code: string; quantity: number; coupon_code?: string; shipping?: { name: string; phone: string; address: string } } = {
        product_code: product.code,
        quantity,
      };
      if (coupon.trim()) payload.coupon_code = coupon.trim();
      if (product.kind === 'physical') {
        if (!shipName.trim() || !shipPhone.trim() || !shipAddress.trim()) {
          setError('实物商品请填写收货人、手机号与地址');
          return;
        }
        payload.shipping = { name: shipName.trim(), phone: shipPhone.trim(), address: shipAddress.trim() };
      }
      const result = await api.shop.order(payload);
      setLastOrder(result);
      setNotice(result.discount_cents > 0 ? `下单成功，优惠 ${yuan(result.discount_cents)}` : '下单成功');
      setBuying(null);
      setCoupon('');
      setQuantity(1);
      await Promise.all([loadShop(), loadWallet()]);
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  async function confirmOrder(id: string) {
    try {
      await api.shop.confirm(id);
      setNotice('已确认收货');
      await loadShop();
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  async function refundOrder(id: string) {
    try {
      const result = await api.shop.refund(id);
      setNotice(`已退款 ${yuan(result.refunded_cents)} 到余额`);
      await Promise.all([loadShop(), loadWallet()]);
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  async function bindReferral() {
    if (!bindCode.trim()) return;
    try {
      await api.referral.bind(bindCode.trim());
      setNotice('邀请码绑定成功');
      setBindCode('');
      await loadReferral();
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  const currentBoard = boards.find((b) => b.slug === board);

  return (
    <section className="community-wrap">
      <header className="community-hero">
        <div>
          <p className="community-kicker">COMMUNITY & CREATOR ECONOMY</p>
          <h1>社区 · 知识付费 · 独立商城</h1>
          <p className="community-sub">论坛、付费阅读、VIP、钱包积分、卡密商品与推广分成，全部走同一套账户与余额。</p>
        </div>
        <div className="community-hero-side">
          <div className="community-stat"><span>帖子</span><strong>{stats.threads}</strong></div>
          <div className="community-stat"><span>浏览</span><strong>{stats.views}</strong></div>
          <div className="community-stat"><span>余额</span><strong>{wallet ? yuan(wallet.balance_cents) : '—'}</strong></div>
          <div className="community-stat"><span>积分</span><strong>{wallet?.points ?? 0}</strong></div>
          <div className={`community-vip-chip${vipLevel > 0 ? ' is-on' : ''}`}>
            {vipLevel > 0 ? `VIP ${vipLevel}${vipExpires ? ` · ${dateOnly(vipExpires)}` : ''}` : '未开通 VIP'}
          </div>
        </div>
      </header>

      {(error || notice) && (
        <div className="community-flash">
          {error && <span className="is-error">{error}</span>}
          {notice && <span>{notice}</span>}
          <button type="button" onClick={() => { setError(null); setNotice(null); }}>关闭</button>
        </div>
      )}

      <nav className="community-tabs">
        {([
          ['forum', '论坛'],
          ['vip', 'VIP 会员'],
          ['wallet', '钱包 / 积分'],
          ['shop', '独立商城'],
          ['referral', '推广分成'],
        ] as Array<[Tab, string]>).map(([key, label]) => (
          <button key={key} type="button" className={tab === key ? 'is-active' : ''} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>

      {loading && <div className="community-empty">正在加载社区数据…</div>}

      {!loading && tab === 'forum' && (
        <div className="community-forum">
          <div className="community-toolbar">
            <div className="community-chips">
              <button type="button" className={board === 'all' ? 'is-active' : ''} onClick={() => setBoard('all')}>全部</button>
              {boards.map((b) => (
                <button
                  key={b.slug}
                  type="button"
                  className={`${board === b.slug ? 'is-active' : ''}${b.price_cents > 0 && !b.joined ? ' is-locked' : ''}`}
                  onClick={() => {
                    if (b.price_cents > 0 && !b.joined && b.slug !== board) {
                      void joinBoard(b.slug);
                      return;
                    }
                    setBoard(b.slug);
                  }}
                  title={b.price_cents > 0 && !b.joined ? `付费板块：${yuan(b.price_cents)} 加入` : b.description}
                >
                  {b.icon} {b.name} <em>{b.thread_count}</em>
                  {b.price_cents > 0 && <span className="community-board-price">{b.joined ? '已加入' : yuan(b.price_cents)}</span>}
                </button>
              ))}
              <button type="button" className={favoritesOpen ? 'is-active' : ''} onClick={() => setFavoritesOpen((v) => !v)}>我的收藏</button>
            </div>
            <div className="community-filters">
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="all">全部形态</option>
                {(Object.keys(KIND_LABEL) as ThreadKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
              <button type="button" className={sort === 'latest' ? 'is-active' : ''} onClick={() => setSort('latest')}>最新</button>
              <button type="button" className={sort === 'hot' ? 'is-active' : ''} onClick={() => setSort('hot')}>热门</button>
              <button type="button" className={sort === 'views' ? 'is-active' : ''} onClick={() => setSort('views')}>浏览</button>
              <button type="button" className={sort === 'replies' ? 'is-active' : ''} onClick={() => setSort('replies')}>回帖</button>
              <button type="button" className={sort === 'favorites' ? 'is-active' : ''} onClick={() => setSort('favorites')}>收藏</button>
              <button type="button" className={sort === 'rating' ? 'is-active' : ''} onClick={() => setSort('rating')}>评分</button>
              <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void loadThreads(); }} placeholder="搜索帖子…" />
              <button type="button" onClick={() => void loadThreads()}>搜索</button>
              <button type="button" className="is-primary" onClick={() => setComposerOpen((v) => !v)}>发帖</button>
            </div>
          </div>

          {composerOpen && (
            <div className="community-composer">
              <div className="community-form-row">
                <label>板块
                  <select value={draftBoard} onChange={(e) => setDraftBoard(e.target.value)}>
                    {boards.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
                  </select>
                </label>
                <label>形态
                  <select value={draftKind} onChange={(e) => setDraftKind(e.target.value as ThreadKind)}>
                    {(Object.keys(KIND_LABEL) as ThreadKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                  </select>
                </label>
                <label>付费价格（元，0 为免费）
                  <input value={draftPrice} onChange={(e) => setDraftPrice(e.target.value)} inputMode="decimal" />
                </label>
              </div>
              <input className="community-title-input" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder="标题（4–80 字）" maxLength={80} />
              <input value={draftSummary} onChange={(e) => setDraftSummary(e.target.value)} placeholder="摘要（可选）" maxLength={200} />
              <textarea value={draftBody} onChange={(e) => setDraftBody(e.target.value)} placeholder="正文（至少 10 字）" rows={6} />
              {(draftKind === 'gallery' || draftKind === 'video' || draftKind === 'series') && (
                <textarea
                  value={draftMedia}
                  onChange={(e) => setDraftMedia(e.target.value)}
                  placeholder="媒体地址，每行一个：图集填图片 URL；视频帖填 .mp4/.m3u8 直链（站内路径以 / 开头）"
                  rows={3}
                />
              )}
              {draftKind === 'poll' && (
                <textarea value={draftPoll} onChange={(e) => setDraftPoll(e.target.value)} placeholder="投票选项，每行一个（2–10 个）" rows={3} />
              )}
              <div className="community-actions">
                <button type="button" className="is-primary" onClick={() => void createThread()}>发布</button>
                <button type="button" onClick={() => setComposerOpen(false)}>取消</button>
              </div>
            </div>
          )}

          {favoritesOpen && (
            <div className="community-favorites">
              <div className="community-section-head"><div><h3>我的收藏</h3><p>共 {favorites.length} 篇</p></div></div>
              {favorites.length === 0 && <div className="community-empty">还没有收藏，详情页点「收藏」即可加入。</div>}
              {favorites.map((t) => (
                <button key={t.id} type="button" className="community-favorite-row" onClick={() => void openThread(t.id)}>
                  <span>{t.board_name}</span>
                  <strong>{t.title}</strong>
                  <em>{dateOnly((t as CommunityThread & { favorited_at?: string }).favorited_at ?? t.last_activity_at)}</em>
                </button>
              ))}
            </div>
          )}

          <div className="community-list">
            {threads.length === 0 && <div className="community-empty">这个筛选下还没有帖子，发一篇试试。</div>}
            {threads.map((t) => (
              <article key={t.id} className="community-card" onClick={() => void openThread(t.id)}>
                <div className="community-cover">
                  {t.cover_url ? <img src={coverSrc(t.cover_url)} alt={t.title} loading="lazy" /> : <span>{KIND_LABEL[t.kind]}</span>}
                  <em className={`community-kind kind-${t.kind}`}>{KIND_LABEL[t.kind]}</em>
                  {t.price_cents > 0 && <em className="community-price">{yuan(t.price_cents)}</em>}
                </div>
                <div className="community-card-body">
                  <div className="community-card-meta">
                    <span>{t.board_name}</span>
                    <span>{t.author_name || 'Mim 官方'}</span>
                    <span>{dateOnly(t.last_activity_at)}</span>
                  </div>
                  <h3>{t.title}{t.locked && <span className="community-lock">付费</span>}</h3>
                  <p>{t.summary || '—'}</p>
                  <div className="community-card-foot">
                    <span>{t.views} 浏览</span>
                    <span>{t.likes} 赞</span>
                    <span>{t.reply_count} 回复</span>
                    {typeof t.favorite_count === 'number' && <span>{t.favorite_count} 收藏</span>}
                    {t.rating_avg ? <span>{t.rating_avg} 分</span> : null}
                    <span className="community-more">查看 →</span>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {selected && (
            <div className="community-detail">
              <div className="community-detail-head">
                <div>
                  <span className="community-card-meta">{selected.thread.board_name} · {KIND_LABEL[selected.thread.kind]} · {selected.thread.author_name || 'Mim 官方'}</span>
                  <h2>{selected.thread.title}</h2>
                  <p>{selected.thread.summary}</p>
                </div>
                <button type="button" onClick={() => setSelected(null)}>关闭</button>
              </div>
              {selected.thread.cover_url && <img className="community-detail-cover" src={coverSrc(selected.thread.cover_url)} alt={selected.thread.title} />}
              {selected.unlocked && (selected.thread.media?.length ?? 0) > 0 && (
                <div className="community-media">
                  {selected.thread.media!.map((item, index) => (
                    <div key={`${item.url}-${index}`} className={`community-media-item is-${item.kind}`}>
                      {item.kind === 'video' ? (
                        <video src={coverSrc(item.url)} poster={item.poster_url ? coverSrc(item.poster_url) : undefined} controls playsInline preload="metadata" />
                      ) : (
                        <img src={coverSrc(item.url)} alt={`${selected.thread.title} ${index + 1}`} loading="lazy" />
                      )}
                    </div>
                  ))}
                </div>
              )}
              {selected.unlocked ? (
                <div className="community-detail-body">
                  {selected.thread.poll && (
                    <div className="community-poll">
                      <div className="community-poll-head"><strong>投票</strong><span>{selected.thread.poll.total} 票</span></div>
                      {selected.thread.poll.options.map((option) => {
                        const percent = selected.thread.poll!.total > 0 ? Math.round((option.votes / selected.thread.poll!.total) * 100) : 0;
                        return (
                          <button key={option.id} type="button" className={`community-poll-option${option.mine ? ' is-mine' : ''}`} onClick={() => void vote(option.id)}>
                            <span className="community-poll-bar" style={{ width: `${percent}%` }} />
                            <span className="community-poll-label">{option.label}{option.mine ? ' ✓' : ''}</span>
                            <em>{option.votes} 票 · {percent}%</em>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {selected.thread.body.split('\n').filter(Boolean).map((line, i) => <p key={i}>{line}</p>)}
                  <div className="community-detail-actions">
                    <button type="button" className={selected.liked ? 'is-active' : ''} onClick={() => void toggleLike()}>
                      {selected.liked ? '已赞' : '点赞'} · {selected.thread.likes}
                    </button>
                    <button type="button" className={selected.favorited ? 'is-active' : ''} onClick={() => void toggleFavorite()}>
                      {selected.favorited ? '已收藏' : '收藏'}
                    </button>
                    <span className="community-rating">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button key={star} type="button" className={(selected.thread.my_rating ?? 0) >= star ? 'is-active' : ''} onClick={() => void rateThread(star)} aria-label={`${star} 星`}>
                          ★
                        </button>
                      ))}
                      <em>{selected.thread.rating_avg ? `${selected.thread.rating_avg} 分` : '暂无评分'}{selected.thread.rating_count ? ` · ${selected.thread.rating_count} 人` : ''}</em>
                    </span>
                    <span>{selected.thread.views} 浏览</span>
                  </div>
                  <div className="community-replies">
                    <h4>回复 · {selected.posts.length}</h4>
                    {selected.posts.map((p) => (
                      <div key={p.id} className="community-reply">
                        <strong>{p.author_name || 'Mim 用户'}</strong>
                        <span>{p.author_member_no || ''} · {dateOnly(p.created_at)}</span>
                        <p>{p.content}</p>
                      </div>
                    ))}
                    <div className="community-reply-form">
                      <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} placeholder="写下你的回复…" />
                      <button type="button" className="is-primary" onClick={() => void submitReply()}>回复</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="community-paywall">
                  <strong>{selected.thread.board_locked ? '该板块需要加入后查看' : '这是一篇付费内容'}</strong>
                  <p>{selected.thread.board_locked ? '加入板块后可阅读全部帖子与回复；VIP 会员可直接加入。' : '解锁后可阅读全文与全部回复；VIP 会员可直接查看。'}</p>
                  {selected.thread.board_locked ? (
                    <button type="button" className="is-primary" onClick={() => void joinBoard(selected.thread.board_slug)}>
                      {yuan(selected.thread.board_price_cents ?? 0)} 加入板块
                    </button>
                  ) : (
                    <button type="button" className="is-primary" onClick={() => void unlockThread(selected.thread.id)}>
                      {yuan(selected.thread.price_cents)} 解锁
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!loading && tab === 'vip' && (
        <div className="community-vip">
          <div className="community-section-head">
            <div>
              <h2>VIP 会员</h2>
              <p>付费帖直接查看、积分每月发放、专属徽章与答疑优先级。</p>
            </div>
            {vipLevel > 0 && <span className="community-vip-current">当前 VIP {vipLevel}{vipExpires ? `，到期 ${dateOnly(vipExpires)}` : ''}</span>}
          </div>
          <div className="community-plan-grid">
            {plans.map((p) => (
              <article key={p.code} className={`community-plan${vipLevel >= p.level ? ' is-current' : ''}`}>
                <span className="community-plan-level">LV {p.level}</span>
                <h3>{p.name}</h3>
                <strong className="community-plan-price">{yuan(p.price_cents)}<small> / {p.duration_days} 天</small></strong>
                <ul>{p.perks.map((perk) => <li key={perk}>{perk}</li>)}</ul>
                <button type="button" className="is-primary" onClick={() => void subscribe(p.code)}>{vipLevel >= p.level ? '续费' : '开通'}</button>
              </article>
            ))}
          </div>
        </div>
      )}

      {!loading && tab === 'wallet' && wallet && (
        <div className="community-wallet">
          <div className="community-wallet-cards">
            <div className="community-wallet-card">
              <span>可用余额</span>
              <strong>{yuan(wallet.balance_cents)}</strong>
              <small>余额可用于付费帖、VIP 与商城下单</small>
            </div>
            <div className="community-wallet-card">
              <span>积分</span>
              <strong>{wallet.points}</strong>
              <small>每日签到 +5 积分</small>
            </div>
          </div>
          <div className="community-wallet-actions">
            <button type="button" className="is-primary" disabled={walletDetail?.checked_in_today} onClick={() => void checkin()}>
              {walletDetail?.checked_in_today ? '今天已签到' : '签到领 5 积分'}
            </button>
            <div className="community-inline-form">
              <input value={redeemCode} onChange={(e) => setRedeemCode(e.target.value)} placeholder="输入充值卡密，如 MIM-DEMO-100" />
              <button type="button" onClick={() => void redeem()}>兑换</button>
            </div>
            <div className="community-inline-form">
              <input value={transferTo} onChange={(e) => setTransferTo(e.target.value)} placeholder="接收方 Mim ID（数字）" />
              <input value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} inputMode="numeric" placeholder="积分" />
              <button type="button" onClick={() => void transferPoints()}>转积分</button>
            </div>
          </div>
          <p className="community-hint">演示卡密：<code>MIM-DEMO-100</code>（¥100）、<code>MIM-DEMO-500</code>（¥500），每张仅可使用一次。</p>
          <div className="community-table">
            <div className="community-table-head"><span>类型</span><span>金额</span><span>积分</span><span>说明</span><span>时间</span></div>
            {(walletDetail?.transactions ?? []).map((t) => (
              <div key={t.id} className="community-table-row">
                <span>{TX_KIND[t.kind]}</span>
                <span className={t.amount_cents < 0 ? 'is-down' : t.amount_cents > 0 ? 'is-up' : ''}>{t.amount_cents === 0 ? '—' : yuan(t.amount_cents)}</span>
                <span>{t.points > 0 ? `+${t.points}` : '—'}</span>
                <span>{t.note}</span>
                <span>{dateOnly(t.created_at)}</span>
              </div>
            ))}
            {!walletDetail?.transactions.length && <div className="community-empty">还没有流水，先签到或用演示卡密充值。</div>}
          </div>
        </div>
      )}

      {!loading && tab === 'shop' && (
        <div className="community-shop">
          <div className="community-section-head">
            <div><h2>独立商城</h2><p>实物快递、自动发卡密、人工发货三类商品，统一走余额与优惠码。</p></div>
          </div>
          <div className="community-shop-grid">
            {products.map((p) => (
              <article key={p.code} className="community-product">
                {p.cover_url && <img src={coverSrc(p.cover_url)} alt={p.name} loading="lazy" />}
                <div className="community-product-body">
                  <span className={`community-product-kind kind-${p.kind}`}>{PRODUCT_KIND[p.kind]}</span>
                  <h3>{p.name}</h3>
                  <p>{p.summary}</p>
                  <div className="community-product-meta"><strong>{yuan(p.price_cents)}</strong><span>可售 {p.available}</span></div>
                  <small>{p.delivery_note}</small>
                  {buying === p.code ? (
                    <div className="community-buy-form">
                      <label>数量<input value={quantity} onChange={(e) => setQuantity(Math.min(10, Math.max(1, Number(e.target.value) || 1)))} inputMode="numeric" /></label>
                      <label>优惠码<input value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="MIM10 / VIP20" /></label>
                      {p.kind === 'physical' && (
                        <>
                          <input value={shipName} onChange={(e) => setShipName(e.target.value)} placeholder="收货人" />
                          <input value={shipPhone} onChange={(e) => setShipPhone(e.target.value)} placeholder="手机号" />
                          <input value={shipAddress} onChange={(e) => setShipAddress(e.target.value)} placeholder="详细地址" />
                        </>
                      )}
                      <div className="community-actions">
                        <button type="button" className="is-primary" onClick={() => void placeOrder(p)}>确认下单</button>
                        <button type="button" onClick={() => setBuying(null)}>取消</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="is-primary" disabled={p.available <= 0} onClick={() => { setBuying(p.code); setQuantity(1); }}>{p.available <= 0 ? '已售罄' : '立即购买'}</button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {lastOrder && (
            <div className="community-order-result">
              订单 <code>{lastOrder.order_id.slice(0, 18)}…</code> 已创建，实付 {yuan(lastOrder.payable_cents)}。
              {lastOrder.delivery_kind === 'virtual_auto' ? ' 卡密见下方订单列表。' : ''}
            </div>
          )}
          <h3 className="community-subhead">我的订单</h3>
          <div className="community-orders">
            {orders.length === 0 && <div className="community-empty">还没有订单。</div>}
            {orders.map((o) => (
              <article key={o.id} className="community-order">
                <div className="community-order-main">
                  <strong>{o.product_name}</strong>
                  <span>{ORDER_STATUS[o.status]} · {o.delivery_kind} · {dateOnly(o.created_at)}</span>
                  <span>原价 {yuan(o.amount_cents)}，优惠 {yuan(o.discount_cents)}，实付 {yuan(o.payable_cents)}</span>
                  {o.delivered_content && <code>{o.delivered_content}</code>}
                </div>
                <div className="community-order-actions">
                  {o.status === 'paid' && <button type="button" onClick={() => void confirmOrder(o.id)}>确认收货</button>}
                  {o.status !== 'refunded' && o.status !== 'cancelled' && <button type="button" onClick={() => void refundOrder(o.id)}>退款</button>}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {!loading && tab === 'referral' && (
        <div className="community-referral">
          <div className="community-section-head"><div><h2>推广分成</h2><p>邀请码绑定后，被邀请人首单按实付 5% 返到你的余额。</p></div></div>
          <div className="community-referral-grid">
            <div className="community-ref-card">
              <span>我的邀请码</span>
              <strong>{referral?.code ?? '—'}</strong>
              <button type="button" onClick={() => { if (referral) void navigator.clipboard?.writeText(referral.code); setNotice('邀请码已复制'); }}>复制</button>
            </div>
            <div className="community-ref-card"><span>已邀请</span><strong>{referral?.invited.count ?? 0} 人</strong></div>
            <div className="community-ref-card"><span>累计佣金</span><strong>{yuan(referral?.commission_cents ?? 0)}</strong></div>
          </div>
          <div className="community-inline-form">
            <input value={bindCode} onChange={(e) => setBindCode(e.target.value)} placeholder="输入朋友的邀请码" />
            <button type="button" onClick={() => void bindReferral()}>绑定邀请码</button>
          </div>
          <p className="community-hint">当前板块：{currentBoard?.name ?? '全部'}。推广绑定仅一次，不能绑定自己的邀请码。</p>
        </div>
      )}
    </section>
  );
}
