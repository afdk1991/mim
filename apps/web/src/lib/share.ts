/**
 * 分享链接与分享文案构造纯函数（无 DOM 依赖，可独立单测）。
 */

import type { Locale } from '@mim/i18n';

/** 内容类型：社区帖子 / 付费资产（商品） */
export type ShareKind = 'thread' | 'asset' | 'product';

/** 由类型与标识构造站内相对路径（播放器 / 详情深链接） */
export function buildSharePath(kind: ShareKind, id: string): string {
  const safe = encodeURIComponent(id);
  if (kind === 'thread') return `watch/thread/${safe}`;
  if (kind === 'asset') return `watch/asset/${safe}`;
  return `watch/product/${safe}`;
}

/** 拼接绝对链接：相对路径补当前站点源，便于粘贴到微信 / 微博等外部渠道 */
export function buildShareUrl(kind: ShareKind, id: string, origin: string, basePath: string): string {
  const path = buildSharePath(kind, id);
  const normalizedBase = basePath.startsWith('/') ? basePath : `/${basePath}`;
  const base = normalizedBase === '/' ? '' : normalizedBase.replace(/\/$/, '');
  return `${origin}${base}/${path}`;
}

/** 生成分享文案：标题 + 链接；中英两套口径 */
export function buildShareText(locale: Locale, title: string, url: string): string {
  const cleanTitle = title.trim() || 'Mim';
  return locale === 'en-US' ? `${cleanTitle} — ${url}` : `${cleanTitle} ${url}`;
}
