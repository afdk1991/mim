/**
 * 本地二维码渲染组件：内容在前端生成 SVG，不请求任何第三方二维码服务。
 * 底层复用仓库已锁定的 qrcode@1.5.4（与后端同一版本，无新增重型依赖）。
 */

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface Props {
  /** 编码内容（链接 / 支付串） */
  text: string;
  /** 渲染边长（px），默认 168 */
  size?: number;
  /** 前景色，默认跟随主色 */
  dark?: string;
  /** 底色，默认卡片表面色 */
  light?: string;
}

/** 二维码 SVG 容器：异步生成后注入；生成中 / 空内容给占位框 */
export function QrCode({ text, size = 168, dark = '#1c2230', light = '#ffffff' }: Props) {
  const [svg, setSvg] = useState<string>(''); // 生成的 SVG 字符串
  const [failed, setFailed] = useState(false); // 生成失败标记（内容过长 / 编码异常）

  useEffect(() => {
    let cancelled = false; // 卸载后丢弃异步结果
    setSvg('');
    setFailed(false);
    if (!text) return; // 空内容不发起生成
    QRCode.toString(text, {
      type: 'svg',
      width: size,
      margin: 1,
      color: { dark, light },
      errorCorrectionLevel: 'M',
    })
      .then((markup) => {
        if (!cancelled) setSvg(markup);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [text, size, dark, light]);

  if (!text) {
    return <div className="qr-code qr-code-empty" style={{ width: size, height: size }} aria-label="empty" />;
  }
  if (failed) {
    return (
      <div className="qr-code qr-code-empty" style={{ width: size, height: size }} aria-label="qr unavailable">
        <span className="hint">QR</span>
      </div>
    );
  }
  // SVG 由本地 qrcode 库生成，无外部注入内容；尺寸锁定在容器内
  return <span className="qr-code" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
