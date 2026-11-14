/**
 * 分享卡片：复制链接 + 本地生成二维码 + 分享文案。
 * 二维码与链接均在前端生成，不请求第三方分享 / 二维码服务。
 */

import { useMemo, useState } from 'react';
import type { Locale } from '@mim/i18n';
import { baseOf } from '../router';
import { buildShareText, buildShareUrl, type ShareKind } from '../lib/share';
import { tr } from '../lib/messages';
import { QrCode } from './QrCode';

interface Props {
  /** 内容类型：帖子 / 资产 / 商品 */
  kind: ShareKind;
  /** 内容标识（帖子 id / 资产 code / 商品 code） */
  id: string;
  /** 分享标题 */
  title: string;
  /** 补充说明（可选，并入分享文案） */
  description?: string;
  locale: Locale;
}

/** 兼容旧浏览器 / 非安全上下文的复制兜底 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const textarea = document.createElement('textarea'); // 临时文本域承载选中
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy'); // 旧浏览器兜底
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/** 分享卡片组件：详情页内嵌使用 */
export function ShareCard({ kind, id, title, description, locale }: Props) {
  const [copied, setCopied] = useState(false); // 链接是否已复制反馈

  // 绝对分享链接：当前源 + 挂载前缀 + 深链接路径
  const url = useMemo(() => {
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    return buildShareUrl(kind, id, origin, baseOf());
  }, [kind, id]);

  const shareText = useMemo(() => {
    const base = buildShareText(locale, title, url);
    return description ? `${base}\n${description}` : base;
  }, [locale, title, description, url]);

  async function onCopy() {
    const ok = await copyText(url);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000); // 反馈 2 秒后撤销
    }
  }

  return (
    <section className="share-card panel">
      <div className="panel-head">
        <h3>{tr(locale, 'web.share.title')}</h3>
      </div>
      <div className="share-card-body">
        <div className="share-card-qr">
          <QrCode text={url} size={148} />
          <span className="hint">{tr(locale, 'web.share.qr')}</span>
        </div>
        <div className="share-card-main">
          <label className="share-field">
            <span className="hint">{tr(locale, 'web.share.copy')}</span>
            <span className="share-link">{url}</span>
          </label>
          <button type="button" className="btn ghost small" onClick={() => void onCopy()}>
            {copied ? tr(locale, 'web.share.copied') : tr(locale, 'web.share.copy')}
          </button>
          <label className="share-field">
            <span className="hint">{tr(locale, 'web.share.text')}</span>
            <textarea className="share-text" rows={3} readOnly value={shareText} onFocus={(event) => event.target.select()} />
          </label>
        </div>
      </div>
    </section>
  );
}
