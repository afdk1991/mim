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
import { coverSrcset } from '../api/request.js'; // catalog 封面 2x 档派生
import { navigatePath, pathOf } from '../router'; // 站内深链接
import { EmptyState } from '../empty-state'; // 空态共享组件：插图 + 标题 + 说明
import './community-assets.css'; // 本域独立样式：不改 styles.css / tokens.css

interface Props { // 组件契约
  locale: Locale; // 当前语言
  hasSession: boolean; // 是否有登录会话：决定购买按钮与「我的资产」入口行为
  code?: string; // 资产编码；空串表示列表页
  onRequireLogin?: () => void; // 未登录时的登录引导（由 App 负责跳转）
} // Props 结束

const KINDS: Array<{ key: AssetKind; zh: string; en: string }> = [ // 类型筛选项
  { key: 'article', zh: '付费阅读', en: 'Articles' }, // 文章型资产
  { key: 'download', zh: '下载资源', en: 'Downloads' }, // 可下载资源
  { key: 'gallery', zh: '图集', en: 'Galleries' }, // 图集
  { key: 'video', zh: '视频', en: 'Videos' }, // 视频
]; // 类型筛选项结束

const KIND_LABEL: Record<AssetKind, { zh: string; en: string }> = { // 类型展示名（单数形态）
  article: { zh: '付费阅读', en: 'Article' }, // 文章
  download: { zh: '下载资源', en: 'Download' }, // 下载
  gallery: { zh: '图集', en: 'Gallery' }, // 图集
  video: { zh: '视频', en: 'Video' }, // 视频
}; // 类型展示名结束

/** 价格文案：0 显示「免费」，其余按元保留两位。 */
function priceLabel(isZh: boolean, cents: number): string {
  if (cents <= 0) return isZh ? '免费' : 'Free'; // 免费资产不显示金额
  return `¥${(cents / 100).toFixed(2)}`; // 分 → 元，固定两位
} // priceLabel 结束

/** 渠道结果文案：购买接口返回的 via。 */
function viaLabel(isZh: boolean, via: string): string {
  if (via === 'owned') return isZh ? '你已拥有该资产' : 'Already owned'; // 重复购买：服务端识别为已购
  if (via === 'free') return isZh ? '免费资产已解锁' : 'Unlocked (free)'; // 免费资产直接解锁
  if (via === 'vip') return isZh ? '会员权益已解锁' : 'Unlocked by membership'; // 会员免费资产
  return isZh ? '购买成功，已解锁' : 'Purchase complete'; // 其余即余额扣款成功
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
    fetchAssets({ q: query, kind }) // 列表接口匿名可读
      .then((res) => { // 成功分支
        if (!alive) return; // 已卸载：丢弃本次结果
        setItems(res.items); // 列表
        setVipLevel(res.vip_level); // 会员等级
        setError(''); // 清空错误
      })
      .catch((err) => { if (alive) setError(errorText(locale, err)); }) // 失败：统一错误文案
      .finally(() => { if (alive) setLoading(false); }); // 无论成败都退出加载
    return () => { alive = false; }; // 卸载时置灰，防止竞态
  }, [query, kind, locale, hasSession]);

  /** 打开「我的资产」：匿名先引导登录 */
  function openMine() {
    if (!hasSession) { onRequireLogin?.(); return; } // 匿名：先登录
    navigatePath(pathOf('account', '', 'tab=assets')); // 已登录：直达个人中心页签
  } // openMine 结束

  return (
    <div className="asset-page"> {/* 列表页根容器 */}
      {/* 头部：左侧标题与说明，右侧「返回社区 / 我的资产」 */}
      <header className="asset-head"> {/* 页头卡片 */}
        <div> {/* 左侧标题区 */}
          {/* 装饰性英文小标，与中文主标题形成层级 */}
          <p className="asset-kicker">MIM ASSETS</p> {/* 英文小标 */}
          <h1>{isZh ? '付费资产' : 'Paid assets'}</h1> {/* 主标题 */}
          <p className="asset-sub"> {/* 一句话价值说明 */}
            {isZh ? '付费阅读、下载资源、图集与视频，购买后在「我的资产」中随时访问。' : 'Articles, downloads, galleries and videos. Access your purchases from My assets.'} {/* 中英文案 */}
          </p> {/* 说明结束 */}
        </div> {/* 左侧结束 */}
        {/* 右侧操作：返回社区始终可用；「我的资产」匿名时先引导登录 */}
        <div className="asset-head-side"> {/* 右侧按钮组 */}
          <button type="button" className="asset-btn ghost" onClick={() => navigatePath(pathOf('community'))}> {/* 返回社区 */}
            {isZh ? '返回社区' : 'Back to community'} {/* 按钮文案 */}
          </button> {/* 返回社区结束 */}
          <button type="button" className="asset-btn primary" onClick={openMine}> {/* 我的资产 */}
            {isZh ? '我的资产' : 'My assets'} {/* 按钮文案 */}
          </button> {/* 我的资产结束 */}
        </div> {/* 右侧按钮组结束 */}
      </header> {/* 页头结束 */}

      {/* 检索工具条：输入只写草稿，提交后才写入 query 触发请求 */}
      <form
        className="asset-toolbar"
        onSubmit={(event) => { event.preventDefault(); setQuery(draft.trim()); }}
      > {/* 工具条开始 */}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={isZh ? '搜索标题或简介' : 'Search title or summary'}
          aria-label={isZh ? '搜索资产' : 'Search assets'}
        /> {/* 关键词输入，回车即提交 */}
        <button type="submit" className="asset-btn primary">{isZh ? '搜索' : 'Search'}</button> {/* 提交搜索 */}
        {/* 已有生效关键词时才显示「清除」，空态不多一个无效按钮 */}
        {query ? (
          <button type="button" className="asset-btn ghost" onClick={() => { setDraft(''); setQuery(''); }}> {/* 清除 */}
            {isZh ? '清除' : 'Clear'} {/* 按钮文案 */}
          </button> // 清除结束
        ) : null}
        {/* 类型筛选：单选 chips，再次点击当前项不做切换 */}
        <div className="asset-filters" role="group" aria-label={isZh ? '按类型筛选' : 'Filter by type'}> {/* chips 容器 */}
          <button type="button" className={kind === '' ? 'is-on' : ''} onClick={() => setKind('')}>{isZh ? '全部' : 'All'}</button> {/* 全部类型 */}
          {KINDS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={kind === item.key ? 'is-on' : ''}
              onClick={() => setKind(item.key)}
            > {/* 单个类型 chip */}
              {isZh ? item.zh : item.en} {/* 类型名 */}
            </button> // chip 结束
          ))}
        </div> {/* chips 容器结束 */}
      </form> {/* 工具条结束 */}

      {/* 会员提示：仅 vip_level > 0 时出现，说明会员免费资产可直接解锁 */}
      {vipLevel > 0 ? (
        <p className="asset-note">{/* 会员提示 */}{isZh ? `当前 VIP ${vipLevel}，带会员标识的资产可直接解锁。` : `VIP ${vipLevel}: membership-inclusive assets unlock instantly.`}</p>
      ) : null}
      {/* 三态互斥：错误 → 加载 → 空列表，其余才渲染网格 */}
      {error ? <div className="asset-error">{/* 错误条 */}{error}</div> : null}
      {loading ? <div className="asset-empty">{/* 加载占位 */}{isZh ? '加载中…' : 'Loading…'}</div> : null}

      {/* 列表为空时给出可执行的下一步，而不是空白页 */}
      {!loading && !error && items.length === 0 ? (
        <EmptyState kind="search" title={isZh ? '没有找到匹配的资产' : 'No assets found'} hint={isZh ? '换个关键词或类型试试。' : 'Try another keyword or type.'} />
      ) : null}

      {/* 资产网格：整卡为按钮，点击进入详情深链接 */}
      <div className="asset-grid"> {/* 网格容器 */}
        {items.map((item) => (
          <button
            key={item.code}
            type="button"
            className="asset-card"
            onClick={() => navigatePath(pathOf('community', `assets/${encodeURIComponent(item.code)}`))}
          > {/* 整卡按钮：进入详情 */}
            {/* 封面：有图用图，无图退化为类型名占位；右上角标显示价格或「已购」 */}
            <span className="asset-cover"> {/* 封面容器 */}
              {item.cover_url ? (
                <img src={assetUrl(item.cover_url)} srcSet={coverSrcset(item.cover_url)} alt="" loading="lazy" />
              ) : (
                <span className="asset-cover-fallback">{/* 无封面占位 */}{KIND_LABEL[item.kind][isZh ? 'zh' : 'en']}</span>
              )}
              <span className={`asset-badge${item.unlocked ? ' is-unlocked' : ''}`}> {/* 价格 / 已购角标 */}
                {item.unlocked ? (isZh ? '已购' : 'Owned') : priceLabel(isZh, item.price_cents)} {/* 角标文案 */}
              </span> {/* 角标结束 */}
            </span> {/* 封面容器结束 */}
            <span className="asset-card-body"> {/* 文字区 */}
              <span className="asset-kind">{KIND_LABEL[item.kind][isZh ? 'zh' : 'en']}{item.vip_free === 1 ? (isZh ? ' · 会员免费' : ' · VIP free') : ''}</span> {/* 类型 + 会员标识 */}
              <strong className="asset-title">{item.title}</strong> {/* 标题 */}
              <span className="asset-summary">{item.summary}</span> {/* 两行简介 */}
              <span className="asset-meta"> {/* 价格与销量 */}
                <span>{priceLabel(isZh, item.price_cents)}</span> {/* 价格 */}
                <span>{isZh ? `已售 ${item.sales}` : `${item.sales} sold`}</span> {/* 销量 */}
              </span> {/* 元信息结束 */}
            </span> {/* 文字区结束 */}
          </button> // 整卡按钮结束
        ))}
      </div> {/* 网格容器结束 */}
    </div> // 列表页根容器结束
  ); // return 结束
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
    let alive = true; // 卸载后不再写状态
    setLoading(true); // 进入加载态
    fetchAsset(code) // 详情接口匿名可读，未解锁只返回试读
      .then((res) => { if (alive) { setAsset(res.asset); setError(''); } }) // 成功：写入详情并清空错误
      .catch((err) => { if (alive) setError(errorText(locale, err)); }) // 失败：统一错误文案
      .finally(() => { if (alive) setLoading(false); }); // 无论成败都退出加载
    return () => { alive = false; }; // 卸载时置灰
  }, [code, locale, hasSession]);

  /** 余额购买；匿名先引导登录 */
  async function buy() {
    if (!hasSession) { onRequireLogin?.(); return; } // 匿名先登录
    setBusy(true); setBuyError(''); setNotice(''); setNeedRecharge(false); // 重置上一次的提示与余额不足标记
    try {
      const result = await purchaseAsset(code); // 服务端判定 free / vip / owned / 余额扣款
      setNotice(viaLabel(isZh, result.via)); // 展示 via 对应的结果文案
      const res = await fetchAsset(code); // 回读最新解锁状态
      setAsset(res.asset); // 用回读结果刷新按钮与正文
    } catch (err) {
      if (err instanceof ApiError) { // 只有业务错误才带 details
        const details = err.details as { reason?: string } | undefined; // 服务端细分原因
        if (details?.reason === 'INSUFFICIENT_BALANCE') setNeedRecharge(true); // 余额不足：展示充值入口
      }
      setBuyError(errorText(locale, err)); // 统一错误文案（含 401 续期失败）
    } finally {
      setBusy(false); // 解除按钮中间态
    }
  } // buy 结束

  return (
    <div className="asset-page"> {/* 详情页根容器 */}
      {/* 顶部导航：返回列表；「我的资产」匿名时先引导登录 */}
      <div className="asset-detail-top"> {/* 导航容器 */}
        <button type="button" className="asset-btn ghost" onClick={() => navigatePath(pathOf('community', 'assets'))}> {/* 返回列表 */}
          {isZh ? '返回资产列表' : 'Back to assets'} {/* 按钮文案 */}
        </button> {/* 返回列表结束 */}
        <button
          type="button"
          className="asset-btn ghost"
          onClick={() => { if (!hasSession) { onRequireLogin?.(); return; } navigatePath(pathOf('account', '', 'tab=assets')); }}
        > {/* 我的资产 */}
          {isZh ? '我的资产' : 'My assets'} {/* 按钮文案 */}
        </button> {/* 我的资产结束 */}
      </div> {/* 导航容器结束 */}

      {/* 加载与错误互斥；两者都为假时才渲染详情主体 */}
      {loading ? <div className="asset-empty">{/* 加载占位 */}{isZh ? '加载中…' : 'Loading…'}</div> : null}
      {error ? <div className="asset-error">{/* 错误条 */}{error}</div> : null}

      {asset ? (
        <article className="asset-detail"> {/* 详情主体 */}
          {/* 头部：类型（含会员免费标识）、标题、简介与价格 / 销量 / 浏览 / 更新时间 */}
          <header className="asset-detail-head"> {/* 标题区 */}
            <span className="asset-kind"> {/* 类型 + 会员标识 */}
              {KIND_LABEL[asset.kind][isZh ? 'zh' : 'en']} {/* 类型名 */}
              {asset.vip_free === 1 ? (isZh ? ' · 会员免费' : ' · VIP free') : ''} {/* 会员免费后缀 */}
            </span> {/* 类型结束 */}
            <h1>{asset.title}</h1> {/* 标题 */}
            <p className="asset-sub">{asset.summary}</p> {/* 简介 */}
            <div className="asset-meta asset-meta-wide"> {/* 元信息行 */}
              <span>{priceLabel(isZh, asset.price_cents)}</span> {/* 价格 */}
              <span>{isZh ? `销量 ${asset.sales}` : `${asset.sales} sold`}</span> {/* 销量 */}
              <span>{isZh ? `浏览 ${asset.views}` : `${asset.views} views`}</span> {/* 浏览量 */}
              <span>{new Date(asset.updated_at).toLocaleDateString()}</span> {/* 更新时间 */}
            </div> {/* 元信息结束 */}
          </header> {/* 标题区结束 */}

          {/* 封面可选：无封面时不占位，避免详情页出现大块空白 */}
          {asset.cover_url ? (
            <img className="asset-detail-cover" src={assetUrl(asset.cover_url)} srcSet={coverSrcset(asset.cover_url)} alt="" loading="lazy" />
          ) : null}

          {/* 购买结果提示：成功条与错误条分色，余额不足时额外给出充值入口 */}
          {notice ? <div className="asset-ok">{/* 成功提示 */}{notice}</div> : null}
          {buyError ? <div className="asset-error">{/* 购买错误 */}{buyError}</div> : null}

          {/* 解锁态二选一：已购显示文件入口，未购显示价格与两种支付方式 */}
          {asset.unlocked ? (
            <div className="asset-owned"> {/* 已拥有态 */}
              <strong>{isZh ? '已拥有该资产' : 'You own this asset'}</strong> {/* 已购提示 */}
              <div className="asset-owned-actions"> {/* 已购操作组 */}
                {asset.file_url ? (
                  <a className="asset-btn primary" href={assetUrl(asset.file_url)} target="_blank" rel="noreferrer"> {/* 文件直链 */}
                    {isZh ? '打开 / 下载' : 'Open / download'} {/* 按钮文案 */}
                  </a> // 直链结束
                ) : null}
                <button type="button" className="asset-btn ghost" onClick={() => navigatePath(pathOf('account', '', 'tab=assets'))}> {/* 去我的资产 */}
                  {isZh ? '在「我的资产」中查看' : 'View in My assets'} {/* 按钮文案 */}
                </button> {/* 按钮结束 */}
              </div> {/* 操作组结束 */}
            </div> // 已拥有态结束
          ) : (
            <div className="asset-buy"> {/* 未购买态 */}
              <div className="asset-buy-price"> {/* 价格行 */}
                <span>{isZh ? '解锁价格' : 'Price'}</span> {/* 标签 */}
                <strong>{priceLabel(isZh, asset.price_cents)}</strong> {/* 金额 */}
              </div> {/* 价格行结束 */}
              <div className="asset-buy-actions"> {/* 支付方式按钮组 */}
                {/* 主按钮：未登录先登录；已登录走余额扣款，服务端判定免费 / 会员 / 已购 */}
                <button type="button" className="asset-btn primary" disabled={busy} onClick={() => void buy()}> {/* 余额购买 */}
                  {busy
                    ? (isZh ? '处理中…' : 'Processing…')
                    : hasSession
                      ? (isZh ? '余额购买' : 'Pay with balance')
                      : (isZh ? '登录后购买' : 'Sign in to buy')}
                </button> {/* 余额购买结束 */}
                {/* 次按钮：跳既有收银台，复用 purpose=asset&ref=<code> 契约 */}
                <button
                  type="button"
                  className="asset-btn ghost"
                  onClick={() => navigatePath(pathOf('checkout', '', `purpose=asset&ref=${encodeURIComponent(asset.code)}`))}
                > {/* 其他支付方式 */}
                  {isZh ? '用其他方式支付' : 'Pay another way'} {/* 按钮文案 */}
                </button> {/* 其他支付结束 */}
              </div> {/* 支付按钮组结束 */}
              {/* 余额不足：给出充值入口，不把用户留在死路上 */}
              {needRecharge ? (
                <p className="asset-note"> {/* 余额不足提示 */}
                  {isZh ? '余额不足，可先充值后再购买。' : 'Insufficient balance.'} {/* 提示文案 */}
                  <button type="button" className="asset-link" onClick={() => navigatePath(pathOf('checkout', '', 'purpose=recharge'))}> {/* 去充值 */}
                    {isZh ? '去充值' : 'Recharge'} {/* 按钮文案 */}
                  </button> {/* 去充值结束 */}
                </p> // 余额不足提示结束
              ) : null}
            </div> // 未购买态结束
          )}

          {/* 正文：已解锁为全文，未解锁仅为服务端截断的试读片段 */}
          {asset.body ? (
            <div className="asset-body"> {/* 正文容器 */}
              {asset.body} {/* 纯文本，靠 CSS 保留换行 */}
            </div> // 正文结束
          ) : null}

          {/* 未解锁提示：按类型区分「试读」与「完整内容 + 下载地址」两种表述 */}
          {!asset.unlocked ? (
            <p className="asset-locked-hint"> {/* 未解锁提示 */}
              {asset.kind === 'article'
                ? (isZh ? '以上为试读片段，购买后可阅读全文。' : 'Preview only. Purchase to read the full article.')
                : (isZh ? '购买后可查看完整内容与下载地址。' : 'Purchase to view the full content and download link.')}
            </p> // 提示结束
          ) : null}

          {/* 图集 / 视频：仅已解锁且服务端返回 media 时渲染（未购时 media 为空数组） */}
          {asset.unlocked && asset.media.length > 0 ? (
            <div className="asset-media"> {/* 媒体网格 */}
              {asset.media.map((media, index) => (
                media.kind === 'video' ? (
                  <video key={`${media.url}-${index}`} src={assetUrl(media.url)} poster={media.poster_url ? assetUrl(media.poster_url) : undefined} controls preload="metadata" />
                ) : (
                  <img key={`${media.url}-${index}`} src={assetUrl(media.url)} srcSet={coverSrcset(media.url)} alt="" loading="lazy" />
                )
              ))}
            </div> // 媒体网格结束
          ) : null}
        </article> // 详情主体结束
      ) : null}
    </div> // 详情页根容器结束
  ); // return 结束
} // AssetDetailView 结束

/** 入口：有 code 渲染详情，否则渲染列表 */
export function CommunityAssets({ locale, hasSession, code = '', onRequireLogin }: Props) {
  return code
    ? <AssetDetailView locale={locale} hasSession={hasSession} code={code} onRequireLogin={onRequireLogin} />
    : <AssetList locale={locale} hasSession={hasSession} onRequireLogin={onRequireLogin} />;
} // CommunityAssets 结束
