/**
 * qrcode 模块本地类型声明（仓库未在 web 侧安装 @types/qrcode）。
 * 仅声明前端实际用到的 toString(SVG) 与 toDataURL 两个入口。
 */
declare module 'qrcode' {
  export interface QrCodeOptions {
    type?: 'svg' | 'canvas' | 'png' | 'terminal';
    width?: number;
    margin?: number;
    color?: { dark?: string; light?: string };
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  }
  export function toString(text: string, options?: QrCodeOptions): Promise<string>;
  export function toDataURL(text: string, options?: QrCodeOptions): Promise<string>;
  const QRCode: {
    toString: typeof toString;
    toDataURL: typeof toDataURL;
  };
  export default QRCode;
}
