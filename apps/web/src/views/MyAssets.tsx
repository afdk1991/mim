/**
 * 我的资产（2026-11-16）：个人中心页签，列出已购资产与访问方式。
 * 需登录：路由层 account 视图本身要求会话，接口 /assets/mine/list 也要求登录。
 */

import { useEffect, useState } from 'react'; // 状态与副作用
import type { Locale } from '@mim/i18n'; // 语言类型
import { errorText } from '../api'; // 统一错误文案
import { assetUrl, fetchMyAssets, type AssetKind, type MyAssetItem } from '../api/assets'; // 资产端点
import { coverSrcset } from '../api/request.js'; // catalog 封面 2x 档派生
import { navigatePath, pathOf } from '../router'; // 站内深链接
import { EmptyState } from '../empty-state'; // 空态共享组件：插图 + 标题 + 说明
import './community-assets.css'; // 与资产列表 / 详情共用同一份样式

const KIND_LABEL: Record<AssetKind, { zh: string; en: string }> = { // 类型展示名
  article: { zh: '付费阅读', en: 'Article' }, // 文章型资产
  download: { zh: '下载资源', en: 'Download' }, // 可下载资源
  gallery: { zh: '图集', en: 'Gallery' }, // 图集
  video: { zh: '视频', en: 'Video' }, // 视频
}; // 类型展示名结束

/** 实付金额文案：元，保留两位；0 显示「免费获取」。 */
function amountLabel(cents: number, isZh: boolean): string { // 金额格式化
  if (cents <= 0) return isZh ? '免费获取' : 'Free'; // 免费资产不显示金额
  return `¥${(cents / 100).toFixed(2)}`; // 分 → 元，固定两位
} // amountLabel 结束

export function MyAssets({ locale }: { locale: Locale }) { // 个人中心「我的资产」页签
  const isZh = locale !== 'en-US'; // 是否中文
  const [items, setItems] = useState<MyAssetItem[]>([]); // 已购资产
  const [loading, setLoading] = useState(true); // 加载态
  const [error, setError] = useState(''); // 错误文案

  useEffect(() => { // 挂载时拉取；locale 变化重新请求一次
    let alive = true; // 卸载后不再写状态
    setLoading(true); // 进入加载态
    fetchMyAssets() // 需登录：401 由统一出口触发续期 / 登出
      .then((res) => { if (alive) { setItems(res.items); setError(''); } }) // 成功：写入清单并清空错误
      .catch((err) => { if (alive) setError(errorText(locale, err)); }) // 失败：统一错误文案
      .finally(() => { if (alive) setLoading(false); }); // 无论成败都退出加载
    return () => { alive = false; }; // 卸载时置灰，防止竞态
  }, [locale]);

  return ( // 渲染页签
    <section className="asset-mine"> {/* 页签根容器 */}
      {/* 说明条：讲清「能打开就打开，不能打开回详情」，右侧给出逛商店入口 */}
      <div className="asset-mine-head"> {/* 说明条容器 */}
        <p className="asset-sub"> {/* 一句话说明 */}
          {isZh ? '已购资产可直接打开或下载；未提供文件的资产可回到详情页查看完整内容。' : 'Open or download your purchases. Assets without a file stay available in their detail page.'} {/* 中英文案 */}
        </p> {/* 说明结束 */}
        <button type="button" className="asset-btn ghost" onClick={() => navigatePath(pathOf('community', 'assets'))}> {/* 去资产商店 */}
          {isZh ? '去资产商店' : 'Browse assets'} {/* 按钮文案 */}
        </button> {/* 按钮结束 */}
      </div> {/* 说明条结束 */}

      {/* 三态互斥：加载 → 错误 → 空列表，其余渲染已购清单 */}
      {loading ? <div className="asset-empty">{/* 加载占位 */}{isZh ? '加载中…' : 'Loading…'}</div> : null}
      {error ? <div className="asset-error">{/* 错误条 */}{error}</div> : null}
      {!loading && !error && items.length === 0 ? ( // 空态：给出可执行的下一步
        <EmptyState kind="order" title={isZh ? '还没有购买过资产' : 'No purchases yet'} hint={isZh ? '去资产商店看看付费阅读、下载资源与图集。' : 'Explore articles, downloads and galleries in the asset store.'} />
      ) : null}

      {/* 已购清单：行内三块（封面 / 文字 / 操作），窄屏自动折行 */}
      <ul className="asset-mine-list"> {/* 清单容器 */}
        {items.map((item) => ( // 每行对应一次购买记录
          <li key={`${item.code}-${item.created_at}`} className="asset-mine-item"> {/* 单条购买记录 */}
            {/* 缩略封面：无封面时退化为类型名 */}
            <span className="asset-mine-cover"> {/* 封面容器 */}
              {item.cover_url ? <img src={assetUrl(item.cover_url)} srcSet={coverSrcset(item.cover_url)} alt="" loading="lazy" /> : <span>{KIND_LABEL[item.kind][isZh ? 'zh' : 'en']}</span>} {/* 有图用图，无图占位 */}
            </span> {/* 封面容器结束 */}
            {/* 文字区：类型、标题、简介、实付金额与购买时间 */}
            <div className="asset-mine-body"> {/* 文字区容器 */}
              <span className="asset-kind">{KIND_LABEL[item.kind][isZh ? 'zh' : 'en']}</span> {/* 类型 */}
              <strong>{item.title}</strong> {/* 标题 */}
              <span className="asset-summary">{item.summary}</span> {/* 简介 */}
              <span className="asset-meta"> {/* 元信息行 */}
                <span>{amountLabel(item.amount_cents, isZh)}</span> {/* 实付金额 */}
                <span>{new Date(item.created_at).toLocaleDateString()}</span> {/* 购买时间 */}
              </span> {/* 元信息结束 */}
            </div> {/* 文字区结束 */}
            {/* 操作区：有文件直链就给「打开 / 下载」，始终保留回详情页的入口 */}
            <div className="asset-mine-actions"> {/* 操作区容器 */}
              {item.file_url ? ( // 仅当服务端下发了访问地址
                <a className="asset-btn primary" href={assetUrl(item.file_url)} target="_blank" rel="noreferrer"> {/* 文件直链 */}
                  {isZh ? '打开 / 下载' : 'Open / download'} {/* 按钮文案 */}
                </a> // 直链结束
              ) : null}
              <button type="button" className="asset-btn ghost" onClick={() => navigatePath(pathOf('community', `assets/${encodeURIComponent(item.code)}`))}> {/* 回详情页 */}
                {isZh ? '查看内容' : 'View asset'} {/* 按钮文案 */}
              </button> {/* 按钮结束 */}
            </div> {/* 操作区结束 */}
          </li> // 单条记录结束
        ))}
      </ul> {/* 清单容器结束 */}
    </section> // 页签根容器结束
  ); // return 结束
} // MyAssets 结束
