/** 商业化中台：付费资产 / 交易履约 / 资金分成 / 外观页面 / 成长与国际化 */

import { useEffect, useState } from 'react'; // 页面状态
import type { Locale } from '@mim/i18n'; // 语言类型
import { api, errorText } from '../api'; // 接口与错误翻译
import type {
  AfterSale,
  CreatorEarning,
  DirectMessage,
  GrowthSnapshot,
  I18nSettings,
  PageBlock,
  PaidAsset,
  PaidAssetDetail,
  PaidAssetKind,
  PaymentChannel,
  Shipment,
  ShopOrder,
  ThemeSettings,
  Withdrawal,
} from '../api'; // 共享类型

interface Props { // 视图参数
  locale: Locale; // 当前语言
}

type Tab = 'assets' | 'orders' | 'finance' | 'appearance' | 'growth'; // 五个业务页签

/** 分转元。 */
function yuan(cents: number): string { // 统一金额展示
  return `¥${(cents / 100).toFixed(2)}`; // 保留两位
}

/** 按语言取文案。 */
function tr(locale: Locale, zh: string, en: string): string { // 双语
  return locale === 'en-US' ? en : zh; // 英文优先
}

const KIND_LABEL: Record<PaidAssetKind, string> = { article: '付费阅读', download: '付费下载', gallery: '付费图库', video: '付费视频' };
const ORDER_STATUS: Record<string, string> = { pending: '待支付', paid: '已支付', delivered: '已发货', refunded: '已退款', cancelled: '已取消' };
const WITHDRAW_STATUS: Record<string, string> = { pending: '待审核', approved: '待打款', paid: '已打款', rejected: '已驳回' };

/** 商业化中台主视图。 */
export function CommerceCenter({ locale }: Props) { // 导出页面组件
  const [tab, setTab] = useState<Tab>('assets');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); // 请求中

  const [assets, setAssets] = useState<PaidAsset[]>([]);
  const [assetKind, setAssetKind] = useState('all'); // 类型过滤
  const [assetQuery, setAssetQuery] = useState(''); // 关键词
  const [detail, setDetail] = useState<PaidAssetDetail | null>(null);
  const [publishOpen, setPublishOpen] = useState(false); // 发布表单
  const [draft, setDraft] = useState({ code: '', kind: 'article' as PaidAssetKind, title: '', summary: '', body: '', price: '19', file: '', media: '', vip: false }); // 发布草稿（media：每行一个媒体地址）

  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [shipments, setShipments] = useState<Record<string, Shipment | null>>({});
  const [reviewing, setReviewing] = useState<{ id: string; rating: number; content: string } | null>(null);
  const [afterOpen, setAfterOpen] = useState<{ id: string; kind: 'refund' | 'return'; reason: string } | null>(null);
  const [afterSales, setAfterSales] = useState<AfterSale[]>([]);

  const [balance, setBalance] = useState(0); // 可提现余额
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [withdrawDraft, setWithdrawDraft] = useState({ amount: '10', channel: 'alipay' as 'alipay' | 'wechat' | 'bank', account: '' }); // 提现草稿
  const [earnings, setEarnings] = useState<CreatorEarning[]>([]);
  const [earningSummary, setEarningSummary] = useState({ pending: 0, settled: 0 }); // 收益汇总
  const [finance, setFinance] = useState<{ wallets: { users: number; balance: number }; withdrawals: Array<{ status: string; count: number; amount: number }>; earnings: Array<{ status: string; count: number; amount: number }>; orders: { count: number; amount: number } } | null>(null);

  const [theme, setTheme] = useState<ThemeSettings>({});
  const [locales, setLocales] = useState<I18nSettings | null>(null);
  const [page, setPage] = useState('home'); // 页面
  const [blocks, setBlocks] = useState<PageBlock[]>([]);
  const [blockKind, setBlockKind] = useState('notice'); // 新区块类型

  const [growth, setGrowth] = useState<GrowthSnapshot | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState({ to: '', content: '' }); // 私信草稿
  const [ip, setIp] = useState<{ region_code: string; ip_hash_prefix: string; note: string } | null>(null);
  const [text, setText] = useState(''); // 待翻译
  const [translated, setTranslated] = useState(''); // 翻译结果

  const [channels, setChannels] = useState<PaymentChannel[]>([]);

  /** 统一执行包装：错误提示与忙碌态。 */
  async function run(action: () => Promise<void>, success?: string) {
    setBusy(true); // 开始
    setError(null); // 清错误
    setNotice(null); // 清旧提示
    try {
      await action(); // 执行
      if (success) setNotice(success); // 成功提示
    } catch (err) {
      setError(errorText(locale, err)); // 统一错误
    } finally {
      setBusy(false); // 结束
    }
  } // run 结束

  async function loadAssets() { // 拉资产
    const data = await api.commerce.assets({ kind: assetKind, q: assetQuery.trim() }); // 带过滤
    setAssets(data.items); // 写入
  } // loadAssets 结束

  async function loadOrders() { // 拉订单与售后
    const [list, after] = await Promise.all([api.shop.orders(), api.commerce.myAfterSales()]); // 并行
    setOrders(list.items); // 订单
    setAfterSales(after.items); // 售后
  } // loadOrders 结束

  async function loadFinance() { // 拉资金
    const [wd, earn, summary] = await Promise.all([
      api.commerce.withdrawals(), // 提现
      api.commerce.earnings(), // 收益
      api.commerce.financeSummary().catch(() => null),
    ]);
    setBalance(wd.balance_cents); // 余额
    setWithdrawals(wd.items); // 记录
    setEarnings(earn.items); // 收益
    setEarningSummary(earn.summary); // 汇总
    setFinance(summary); // 平台汇总
  } // loadFinance 结束

  async function loadAppearance() { // 拉外观
    const view = await api.commerce.appearance(); // 汇总
    setTheme(view.settings.theme ?? {}); // 主题
    setLocales(view.settings.locales ?? null); // 语言
    const detailPage = await api.commerce.page(page); // 区块
    setBlocks(detailPage.blocks); // 写入
  } // loadAppearance 结束

  async function loadGrowth() { // 拉成长
    const [snap, inbox, region] = await Promise.all([api.commerce.growth(), api.commerce.messages('inbox'), api.commerce.ip()]); // 并行
    setGrowth(snap); // 成长
    setMessages(inbox.items); // 私信
    setIp(region); // 归属地
  } // loadGrowth 结束

  useEffect(() => {
    void run(async () => {
      const ch = await api.commerce.channels(); // 渠道
      setChannels(ch.channels); // 写入
      await loadAssets(); // 资产
    });
  }, []); // 仅首次

  useEffect(() => {
    void run(async () => {
      if (tab === 'assets') await loadAssets(); // 资产
      if (tab === 'orders') await loadOrders(); // 订单
      if (tab === 'finance') await loadFinance(); // 资金
      if (tab === 'appearance') await loadAppearance(); // 外观
      if (tab === 'growth') await loadGrowth(); // 成长
    });
  }, [tab, page]); // tab 与页面变化

  return ( // 页面结构
    <div className="page">
      <header className="page-head">
        <h1>{tr(locale, '商业中台', 'Commerce Center')}</h1>
        <p className="muted">
          {tr(locale, '付费阅读 / 下载 / 图库 / 视频，支付通道、发货售后、提现分成、页面搭建、成长私信与机器翻译同屏管理。', 'Paid content, payment channels, fulfillment, payouts, page builder, growth and translation in one console.')}
        </p>
      </header>

      <div className="deploy-columns">
        {([['assets', '付费资产', 'Assets'], ['orders', '交易履约', 'Orders'], ['finance', '资金分成', 'Finance'], ['appearance', '外观页面', 'Appearance'], ['growth', '成长国际化', 'Growth']] as Array<[Tab, string, string]>).map(([value, zh, en]) => (
          <button key={value} type="button" className={`btn ghost${tab === value ? ' active' : ''}`} onClick={() => setTab(value)}>{tr(locale, zh, en)}</button>
        ))}
      </div>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="hint">{notice}</p> : null}
      {busy ? <p className="hint">{tr(locale, '处理中…', 'Working…')}</p> : null}

      {tab === 'assets' && (
        <>
          <section className="panel">
            <div className="panel-head"><h3>{tr(locale, '资产库', 'Assets')}</h3><span className="muted">{assets.length}</span></div>
            <div className="commerce-badges">
              {channels.map((channel) => <span className={`deploy-badge ${channel.configured ? 'ok' : 'muted'}`} key={channel.id} title={channel.note}>{channel.label}</span>)}
            </div>
            <form className="form inline" onSubmit={(event) => { event.preventDefault(); void run(loadAssets); }}>
              <label>{tr(locale, '类型', 'Kind')}
                <select value={assetKind} onChange={(event) => setAssetKind(event.target.value)}>
                  <option value="all">{tr(locale, '全部', 'All')}</option>
                  {(Object.keys(KIND_LABEL) as PaidAssetKind[]).map((kind) => <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>)}
                </select>
              </label>
              <label className="grow">{tr(locale, '关键词', 'Keyword')}
                <input value={assetQuery} onChange={(event) => setAssetQuery(event.target.value)} placeholder={tr(locale, '标题 / 简介', 'title / summary')} />
              </label>
              <button type="submit" className="btn ghost">{tr(locale, '筛选', 'Filter')}</button>
              <button type="button" className="btn primary" onClick={() => setPublishOpen((open) => !open)}>{tr(locale, '作者发布', 'Publish')}</button>
            </form>
            {publishOpen && (
              <div className="commerce-form">
                {[['code', '资产编码', 'Code'], ['title', '标题', 'Title'], ['summary', '简介', 'Summary'], ['body', '正文 / 试读', 'Body'], ['price', '价格（元）', 'Price (CNY)'], ['file', '文件地址', 'File URL']].map(([key, zh, en]) => (
                  <label key={key}>{tr(locale, zh, en)}
                    <input value={draft[key as keyof typeof draft] as string} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
                  </label>
                ))}
                <label>{tr(locale, '类型', 'Kind')}
                  <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as PaidAssetKind })}>
                    {(Object.keys(KIND_LABEL) as PaidAssetKind[]).map((kind) => <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>)}
                  </select>
                </label>
                <label className="check"><input type="checkbox" checked={draft.vip} onChange={(event) => setDraft({ ...draft, vip: event.target.checked })} />{tr(locale, 'VIP 免费', 'Free for VIP')}</label>
                {(draft.kind === 'gallery' || draft.kind === 'video') && (
                  <label className="grow">{tr(locale, '媒体地址（每行一个）', 'Media URLs (one per line)')}
                    <textarea value={draft.media} onChange={(event) => setDraft({ ...draft, media: event.target.value })} rows={4} placeholder={draft.kind === 'gallery' ? '/catalog/a.jpg' : '/demo/ep1.mp4'} />
                  </label>
                )}
                <button type="button" className="btn primary" disabled={busy} onClick={() => void run(async () => {
                  const media = draft.media.split('\n').map((line) => line.trim()).filter(Boolean).map((url) => ({ kind: draft.kind === 'video' ? ('video' as const) : ('image' as const), url }));
                  await api.commerce.createAsset({ code: draft.code, kind: draft.kind, title: draft.title, summary: draft.summary, body: draft.body, price_cents: Math.round(Number(draft.price) * 100), file_url: draft.file || undefined, vip_free: draft.vip, media }); // 发布
                  setPublishOpen(false); // 收起
                  await loadAssets(); // 刷新
                }, tr(locale, '资产已发布', 'Asset published'))}>{tr(locale, '发布', 'Publish')}</button>
              </div>
            )}
          </section>

          <div className="commerce-grid">
            {assets.map((asset) => (
              <article className="panel" key={asset.code}>
                <div className="panel-head"><h3>{asset.title}</h3><span className="deploy-badge muted">{KIND_LABEL[asset.kind]}</span></div>
                <p className="muted">{asset.summary}</p>
                <div className="deploy-kv"><span>{yuan(asset.price_cents)}</span><span>{asset.vip_free ? tr(locale, 'VIP 免费', 'VIP free') : ''}</span><span>{asset.unlocked ? tr(locale, '已解锁', 'Unlocked') : tr(locale, '未解锁', 'Locked')}</span></div>
                <div className="deploy-columns">
                  <button type="button" className="btn ghost small" onClick={() => void run(async () => setDetail((await api.commerce.asset(asset.code)).asset))}>{tr(locale, '查看', 'View')}</button>
                  {!asset.unlocked && <button type="button" className="btn primary small" disabled={busy} onClick={() => void run(async () => { await api.commerce.purchaseAsset(asset.code); await loadAssets(); }, tr(locale, '已购买解锁', 'Unlocked'))}>{tr(locale, '余额购买', 'Buy with balance')}</button>}
                </div>
              </article>
            ))}
          </div>

          {detail && (
            <section className="panel">
              <div className="panel-head"><h3>{detail.title}</h3><button type="button" className="btn ghost small" onClick={() => setDetail(null)}>{tr(locale, '关闭', 'Close')}</button></div>
              <p>{detail.body}</p>
              {(detail.media?.length ?? 0) > 0 && (
                <div className="commerce-media">
                  {detail.media!.map((item, index) => item.kind === 'video' ? (
                    <div className="commerce-media-item is-video" key={`${item.url}-${index}`}>
                      <video src={item.url} poster={item.poster_url ?? undefined} controls playsInline preload="metadata" />
                    </div>
                  ) : (
                    <a className="commerce-media-item is-image" key={`${item.url}-${index}`} href={item.url} target="_blank" rel="noreferrer">
                      <img src={item.url} alt={`${detail.title} ${index + 1}`} loading="lazy" />
                    </a>
                  ))}
                </div>
              )}
              {detail.file_url ? <a className="link" href={detail.file_url} target="_blank" rel="noreferrer">{tr(locale, '下载文件', 'Download')}</a> : null}
            </section>
          )}
        </>
      )}

      {tab === 'orders' && (
        <>
          <section className="panel">
            <div className="panel-head"><h3>{tr(locale, '我的订单', 'My orders')}</h3><span className="muted">{orders.length}</span></div>
            <ul className="plain-list">
              {orders.map((order) => (
                <li className="deploy-row" key={order.id}>
                  <div className="deploy-kv">
                    <span>{order.product_name ?? order.product_code}</span>
                    <span>{yuan(order.amount_cents)}</span>
                    <span className="deploy-badge muted">{ORDER_STATUS[order.status] ?? order.status}</span>
                  </div>
                  <div className="deploy-columns">
                    <button type="button" className="btn ghost small" onClick={() => void run(async () => { const data = await api.commerce.shipment(order.id); setShipments({ ...shipments, [order.id]: data.shipment }); })}>{tr(locale, '查物流', 'Tracking')}</button>
                    {order.status !== 'pending' && order.status !== 'refunded' && (
                      <button type="button" className="btn ghost small" onClick={() => setReviewing({ id: order.id, rating: 5, content: '' })}>{tr(locale, '评价', 'Review')}</button>
                    )}
                    {order.status === 'paid' || order.status === 'delivered' ? (
                      <button type="button" className="btn ghost small" onClick={() => setAfterOpen({ id: order.id, kind: 'refund', reason: '' })}>{tr(locale, '申请售后', 'After-sales')}</button>
                    ) : null}
                  </div>
                  {shipments[order.id] ? (
                    <div className="commerce-track">
                      <div>{shipments[order.id]!.carrier} · {shipments[order.id]!.tracking_no}</div>
                      <ol>{shipments[order.id]!.events.map((event, index) => <li key={index}>{event.at.slice(0, 16)} · {event.text}</li>)}</ol>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          {reviewing && (
            <section className="panel">
              <div className="panel-head"><h3>{tr(locale, '订单评价', 'Review order')}</h3></div>
              <div className="form inline">
                <label>{tr(locale, '星级', 'Rating')}<input type="number" min={1} max={5} value={reviewing.rating} onChange={(event) => setReviewing({ ...reviewing, rating: Number(event.target.value) })} /></label>
                <label className="grow">{tr(locale, '内容', 'Content')}<input value={reviewing.content} onChange={(event) => setReviewing({ ...reviewing, content: event.target.value })} /></label>
                <button type="button" className="btn primary" onClick={() => void run(async () => { await api.commerce.reviewOrder(reviewing.id, { rating: reviewing.rating, content: reviewing.content }); setReviewing(null); }, tr(locale, '评价已提交', 'Review submitted'))}>{tr(locale, '提交', 'Submit')}</button>
              </div>
            </section>
          )}

          {afterOpen && (
            <section className="panel">
              <div className="panel-head"><h3>{tr(locale, '申请售后', 'After-sales')}</h3></div>
              <div className="form inline">
                <label>{tr(locale, '类型', 'Kind')}<select value={afterOpen.kind} onChange={(event) => setAfterOpen({ ...afterOpen, kind: event.target.value as 'refund' | 'return' })}><option value="refund">{tr(locale, '仅退款', 'Refund')}</option><option value="return">{tr(locale, '退货退款', 'Return')}</option></select></label>
                <label className="grow">{tr(locale, '原因', 'Reason')}<input value={afterOpen.reason} onChange={(event) => setAfterOpen({ ...afterOpen, reason: event.target.value })} /></label>
                <button type="button" className="btn primary" onClick={() => void run(async () => { await api.commerce.applyAfterSales(afterOpen.id, { kind: afterOpen.kind, reason: afterOpen.reason }); setAfterOpen(null); await loadOrders(); }, tr(locale, '售后已提交', 'Submitted'))}>{tr(locale, '提交', 'Submit')}</button>
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-head"><h3>{tr(locale, '售后记录', 'After-sales records')}</h3></div>
            <ul className="plain-list">{afterSales.map((item) => <li className="deploy-row" key={item.id}>{item.order_id} · {item.kind} · {yuan(item.amount_cents)} · <span className="deploy-badge muted">{item.status}</span></li>)}</ul>
          </section>
        </>
      )}

      {tab === 'finance' && (
        <>
          <section className="panel">
            <div className="panel-head"><h3>{tr(locale, '提现', 'Withdraw')}</h3><span className="muted">{tr(locale, '可提现', 'Available')} {yuan(balance)}</span></div>
            <div className="form inline">
              <label>{tr(locale, '金额（元）', 'Amount')}<input value={withdrawDraft.amount} onChange={(event) => setWithdrawDraft({ ...withdrawDraft, amount: event.target.value })} /></label>
              <label>{tr(locale, '渠道', 'Channel')}<select value={withdrawDraft.channel} onChange={(event) => setWithdrawDraft({ ...withdrawDraft, channel: event.target.value as 'alipay' | 'wechat' | 'bank' })}><option value="alipay">支付宝</option><option value="wechat">微信</option><option value="bank">银行卡</option></select></label>
              <label className="grow">{tr(locale, '收款账号', 'Account')}<input value={withdrawDraft.account} onChange={(event) => setWithdrawDraft({ ...withdrawDraft, account: event.target.value })} /></label>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void run(async () => { await api.commerce.applyWithdrawal({ amount_cents: Math.round(Number(withdrawDraft.amount) * 100), channel: withdrawDraft.channel, account: withdrawDraft.account }); await loadFinance(); }, tr(locale, '提现已申请', 'Withdrawal requested'))}>{tr(locale, '申请提现', 'Request')}</button>
            </div>
            <ul className="plain-list">{withdrawals.map((item) => <li className="deploy-row" key={item.id}>{yuan(item.amount_cents)} · {item.channel} · {item.account} · <span className="deploy-badge muted">{WITHDRAW_STATUS[item.status] ?? item.status}</span></li>)}</ul>
          </section>

          <section className="panel">
            <div className="panel-head"><h3>{tr(locale, '创作者收益', 'Creator earnings')}</h3><span className="muted">{tr(locale, '待结算', 'Pending')} {yuan(earningSummary.pending)} · {tr(locale, '已结算', 'Settled')} {yuan(earningSummary.settled)}</span></div>
            <button type="button" className="btn primary small" disabled={busy || earningSummary.pending === 0} onClick={() => void run(async () => { await api.commerce.settleEarnings(); await loadFinance(); }, tr(locale, '收益已转入余额', 'Settled to balance'))}>{tr(locale, '结算到余额', 'Settle')}</button>
            <ul className="plain-list">{earnings.map((item) => <li className="deploy-row" key={item.id}>{item.source_type} · {yuan(item.gross_cents)} → {yuan(item.net_cents)} · <span className="deploy-badge muted">{item.status}</span></li>)}</ul>
          </section>

          {finance ? (
            <section className="panel">
              <div className="panel-head"><h3>{tr(locale, '平台资金', 'Platform funds')}</h3></div>
              <div className="deploy-stats">
                <div className="deploy-stat"><span className="deploy-stat-value">{yuan(finance.wallets.balance)}</span><span className="muted">{tr(locale, '钱包余额', 'Wallet balance')} · {finance.wallets.users}</span></div>
                <div className="deploy-stat"><span className="deploy-stat-value">{finance.orders.count}</span><span className="muted">{tr(locale, '成交订单', 'Paid orders')} · {yuan(finance.orders.amount)}</span></div>
                {finance.withdrawals.map((item) => <div className="deploy-stat" key={`wd-${item.status}`}><span className="deploy-stat-value">{yuan(item.amount)}</span><span className="muted">{tr(locale, '提现', 'Withdraw')} {item.status} · {item.count}</span></div>)}
                {finance.earnings.map((item) => <div className="deploy-stat" key={`er-${item.status}`}><span className="deploy-stat-value">{yuan(item.amount)}</span><span className="muted">{tr(locale, '分成', 'Earnings')} {item.status} · {item.count}</span></div>)}
              </div>
            </section>
          ) : null}
        </>
      )}

      {tab === 'appearance' && (
        <>
          <section className="panel">
            <div className="panel-head"><h3>{tr(locale, '主题与语言', 'Theme & language')}</h3></div>
            <div className="form inline">
              <label>{tr(locale, '主色', 'Accent')}<input type="color" value={theme.accent ?? '#0f766e'} onChange={(event) => setTheme({ ...theme, accent: event.target.value })} /></label>
              <label>{tr(locale, '圆角', 'Radius')}<input type="number" min={0} max={32} value={theme.radius ?? 14} onChange={(event) => setTheme({ ...theme, radius: Number(event.target.value) })} /></label>
              <label>{tr(locale, '前台语言', 'Front locale')}<select value={locales?.front ?? 'zh-CN'} onChange={(event) => setLocales({ ...(locales ?? { front: 'zh-CN', admin: 'zh-CN', supported: ['zh-CN', 'en-US'], machine_translation: false }), front: event.target.value as 'zh-CN' | 'en-US' })}><option value="zh-CN">中文</option><option value="en-US">English</option></select></label>
              <label>{tr(locale, '后台语言', 'Admin locale')}<select value={locales?.admin ?? 'zh-CN'} onChange={(event) => setLocales({ ...(locales ?? { front: 'zh-CN', admin: 'zh-CN', supported: ['zh-CN', 'en-US'], machine_translation: false }), admin: event.target.value as 'zh-CN' | 'en-US' })}><option value="zh-CN">中文</option><option value="en-US">English</option></select></label>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void run(async () => { await api.commerce.updateAppearance('theme', theme as Record<string, unknown>); if (locales) await api.commerce.updateI18n({ front: locales.front, admin: locales.admin, machine_translation: locales.machine_translation }); await loadAppearance(); }, tr(locale, '外观已保存', 'Appearance saved'))}>{tr(locale, '保存', 'Save')}</button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h3>{tr(locale, '页面区块', 'Page blocks')}</h3></div>
            <div className="form inline">
              <label>{tr(locale, '页面', 'Page')}<select value={page} onChange={(event) => setPage(event.target.value)}><option value="home">home</option><option value="forum">forum</option><option value="store">store</option></select></label>
              <label>{tr(locale, '新区块', 'New block')}<input value={blockKind} onChange={(event) => setBlockKind(event.target.value)} /></label>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void run(async () => { await api.commerce.createBlock(page, { kind: blockKind, sort_order: blocks.length + 1, config: { text: blockKind } }); await loadAppearance(); }, tr(locale, '区块已添加', 'Block added'))}>{tr(locale, '添加', 'Add')}</button>
            </div>
            <ul className="plain-list">
              {blocks.map((block, index) => (
                <li className="deploy-row" key={block.id}>
                  <div className="deploy-kv"><span>{block.sort_order}</span><span>{block.kind}</span><span className="muted">{block.id}</span></div>
                  <div className="deploy-columns">
                    <button type="button" className="btn ghost small" disabled={index === 0} onClick={() => void run(async () => { const ids = blocks.map((item) => item.id); [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]; await api.commerce.reorderBlocks(page, ids); await loadAppearance(); })}>↑</button>
                    <button type="button" className="btn ghost small" disabled={index === blocks.length - 1} onClick={() => void run(async () => { const ids = blocks.map((item) => item.id); [ids[index + 1], ids[index]] = [ids[index], ids[index + 1]]; await api.commerce.reorderBlocks(page, ids); await loadAppearance(); })}>↓</button>
                    <button type="button" className="btn ghost small" onClick={() => void run(async () => { await api.commerce.deleteBlock(page, block.id); await loadAppearance(); }, tr(locale, '区块已删除', 'Block deleted'))}>{tr(locale, '删除', 'Delete')}</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {tab === 'growth' && (
        <>
          <section className="panel">
            <div className="panel-head"><h3>{tr(locale, '我的成长', 'My growth')}</h3><span className="muted">Lv.{growth?.level ?? 1} · {growth?.stats.points ?? 0} {tr(locale, '积分', 'points')}</span></div>
            <button type="button" className="btn primary small" disabled={busy} onClick={() => void run(async () => { await api.commerce.syncGrowth(); await loadGrowth(); }, tr(locale, '徽章已同步', 'Badges synced'))}>{tr(locale, '同步徽章', 'Sync badges')}</button>
            <div className="commerce-badges">
              {(growth?.badges ?? []).map((badge) => (
                <span className={`deploy-badge ${badge.awarded ? 'ok' : 'muted'}`} key={badge.code}>{badge.icon} {badge.name}</span>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h3>{tr(locale, '站内私信', 'Direct messages')}</h3><span className="muted">{tr(locale, '归属地', 'Region')}: {ip?.region_code ?? '—'}</span></div>
            <div className="form inline">
              <label>{tr(locale, '对方 Mim ID', 'Recipient ID')}<input value={messageDraft.to} onChange={(event) => setMessageDraft({ ...messageDraft, to: event.target.value })} placeholder="100001" inputMode="numeric" /></label>
              <label className="grow">{tr(locale, '内容', 'Message')}<input value={messageDraft.content} onChange={(event) => setMessageDraft({ ...messageDraft, content: event.target.value })} /></label>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void run(async () => { await api.commerce.sendMessage({ to_member_no: messageDraft.to, content: messageDraft.content }); setMessageDraft({ to: '', content: '' }); await loadGrowth(); }, tr(locale, '私信已发送', 'Message sent'))}>{tr(locale, '发送', 'Send')}</button>
            </div>
            <ul className="plain-list">
              {messages.map((message) => (
                <li className="deploy-row" key={message.id}>
                  <div className="deploy-kv"><span>{message.peer_name} ({message.peer_member_no})</span><span>{message.content}</span></div>
                  {!message.read_at ? <button type="button" className="btn ghost small" onClick={() => void run(async () => { await api.commerce.readMessage(message.id); await loadGrowth(); })}>{tr(locale, '标记已读', 'Mark read')}</button> : <span className="muted">{tr(locale, '已读', 'Read')}</span>}
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <div className="panel-head"><h3>{tr(locale, '机器翻译', 'Machine translation')}</h3><span className="muted">{tr(locale, '前后台语言分离已启用', 'Front/admin locales separated')}</span></div>
            <div className="form inline">
              <label className="grow">{tr(locale, '原文', 'Source')}<input value={text} onChange={(event) => setText(event.target.value)} /></label>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void run(async () => { const result = await api.commerce.translate(text, 'en-US'); setTranslated(result.translated_text); })}>{tr(locale, '译成英文', 'Translate')}</button>
            </div>
            {translated ? <p className="hint">{translated}</p> : null}
          </section>
        </>
      )}
    </div>
  ); // 页面结束
} // CommerceCenter 结束
