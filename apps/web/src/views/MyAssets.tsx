/**
 * 我的资产（2026-11-16）：个人中心页签，列出已购资产与访问方式。
 * 需登录：路由层 account 视图本身要求会话，接口 /assets/mine/list 也要求登录。
 */

import { useEffect, useState } from 'react'; // 状态与副作用
import type { Locale } from '@mim/i18n'; // 语言类型
import { errorText } from '../api'; // 统一错误文案
import { assetUrl, fetchMyAssets, type AssetKind, type MyAssetItem } from '../api/assets'; // 资产端点
import { navigatePath, pathOf } from '../router'; // 站内深链接
import './community-assets.css'; // 与资产列表 / 详情共用同一份样式

const KIND_LABEL: Record<AssetKind, { zh: string; en: string }> = { // 类型展示名
  article: { zh: '付费阅读', en: 'Article' },
  download: { zh: '下载资源', en: 'Download' },
  gallery: { zh: '图集', en: 'Gallery' },
  video: { zh: '视频', en: 'Video' },
}; // 类型展示名结束

/** 实付金额文案：元，保留两位。 */
function amountLabel(cents: number, isZh: boolean): string {
  if (cents <= 0) return isZh ? '免费获取' : 'Free';
  return `¥${(cents / 100).toFixed(2)}`;
} // amountLabel 结束

export function MyAssets({ locale }: { locale: Locale }) {
  const isZh = locale !== 'en-US'; // 是否中文
  const [items, setItems] = useState<MyAssetItem[]>([]); // 已购资产
  const [loading, setLoading] = useState(true); // 加载态
  const [error, setError] = useState(''); // 错误文案

  useEffect(() => { // 挂载时拉取
    let alive = true;
    setLoading(true);
    fetchMyAssets()
      .then((res) => { if (alive) { setItems(res.items); setError(''); } })
      .catch((err) => { if (alive) setError(errorText(locale, err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [locale]);

  return (
    <section className="asset-mine">
      <div className="asset-mine-head">
        <p className="asset-sub">
          {isZh ? '已购资产可直接打开或下载；未提供文件的资产可回到详情页查看完整内容。' : 'Open or download your purchases. Assets without a file stay available in their detail page.'}
        </p>
        <button type="button" className="asset-btn ghost" onClick={() => navigatePath(pathOf('community', 'assets'))}>
          {isZh ? '去资产商店' : 'Browse assets'}
        </button>
      </div>

      {loading ? <div className="asset-empty">{isZh ? '加载中…' : 'Loading…'}</div> : null}
      {error ? <div className="asset-error">{error}</div> : null}
      {!loading && !error && items.length === 0 ? (
        <div className="asset-empty">
          <strong>{isZh ? '还没有购买过资产' : 'No purchases yet'}</strong>
          <span>{isZh ? '去资产商店看看付费阅读、下载资源与图集。' : 'Explore articles, downloads and galleries in the asset store.'}</span>
        </div>
      ) : null}

      <ul className="asset-mine-list">
        {items.map((item) => (
          <li key={`${item.code}-${item.created_at}`} className="asset-mine-item">
            <span className="asset-mine-cover">
              {item.cover_url ? <img src={assetUrl(item.cover_url)} alt="" loading="lazy" /> : <span>{KIND_LABEL[item.kind][isZh ? 'zh' : 'en']}</span>}
            </span>
            <div className="asset-mine-body">
              <span className="asset-kind">{KIND_LABEL[item.kind][isZh ? 'zh' : 'en']}</span>
              <strong>{item.title}</strong>
              <span className="asset-summary">{item.summary}</span>
              <span className="asset-meta">
                <span>{amountLabel(item.amount_cents, isZh)}</span>
                <span>{new Date(item.created_at).toLocaleDateString()}</span>
              </span>
            </div>
            <div className="asset-mine-actions">
              {item.file_url ? (
                <a className="asset-btn primary" href={assetUrl(item.file_url)} target="_blank" rel="noreferrer">
                  {isZh ? '打开 / 下载' : 'Open / download'}
                </a>
              ) : null}
              <button
                type="button"
                className="asset-btn ghost"
                onClick={() => navigatePath(pathOf('community', `assets/${encodeURIComponent(item.code)}`))}
              >
                {isZh ? '查看内容' : 'View asset'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
} // MyAssets 结束
