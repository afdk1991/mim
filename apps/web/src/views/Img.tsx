/**
 * 图床视图（/img）：公有读前缀 + 稳定直链。
 *
 * 与云存储（/cloud）的关系：
 * - 私有基线完全一致：上传仍由服务端签发预签名 PUT，客户端不持有任何存储凭证；
 * - 唯一差别是对象落在 `public/` 前缀下，读取时免签名并附带 `cache-control: public`，
 *   因此可以拿到稳定直链（由 `MIM_STORAGE_PUBLIC_BASE_URL` 决定）。
 * - 该前缀之外的对象一律仍要签名，所以这里不存在「整桶公开」的口子。
 */

import { useState } from 'react'; // 只需要文件选择与提交状态
import type { Locale } from '@mim/i18n'; // 语言标识
import { api, errorText } from '../api'; // 请求层与错误文案

interface Props { // 视图入参
  locale: Locale; // 当前语言
  hasSession: boolean; // 未登录时不请求鉴权接口
} // Props 结束

/** 中英双语文案选择器 */
function tr(locale: Locale, zh: string, en: string): string {
  return locale === 'en-US' ? en : zh; // 非英文一律回落中文
} // tr 结束

export function Img({ locale, hasSession }: Props) { // 视图主体
  const [file, setFile] = useState<File | null>(null); // 待上传图片
  const [busy, setBusy] = useState(false); // 上传中
  const [error, setError] = useState<string | null>(null); // 失败文案
  const [result, setResult] = useState<{ url: string; key: string; name: string } | null>(null); // 成功结果

  async function submit(): Promise<void> {
    if (!file) return; // 未选文件不提交
    setBusy(true); // 进入上传态
    setError(null); // 清旧错误
    setResult(null); // 清旧结果
    try {
      const mime = file.type || 'image/png'; // 浏览器偶发空 MIME，按 png 兜底（服务端仍会校验前缀）
      const presign = await api.media.presignPublicUpload({ mime, size_bytes: file.size }); // 申请公有前缀的直传凭证
      const put = await fetch(presign.upload.url, { method: presign.upload.method, headers: presign.upload.headers, body: file }); // 原样带签名要求的方法与请求头
      if (!put.ok) throw new Error(`upload failed: ${put.status}`); // 非 2xx 视为失败
      setResult({ url: presign.public_url, key: presign.object_key, name: file.name }); // 记录稳定直链与对象键
      setFile(null); // 清空选择，避免重复上传
    } catch (err) {
      setError(errorText(locale, err)); // 失败只报错，不伪造直链
    } finally {
      setBusy(false); // 退出上传态
    } // finally 结束
  } // submit 结束

  if (!hasSession) { // 未登录：只展示口径说明
    return (
      <div className="page img-host">
        <div className="page-head">
          <h1>{tr(locale, '图床', 'Image host')}</h1>
          <p className="muted">{tr(locale, '只有 public/ 前缀免签名，其余对象仍需签名。', 'Only the public/ prefix is unsigned; everything else still needs a signature.')}</p>
        </div>
        <div className="panel">
          <p className="muted">{tr(locale, '登录后可上传图片并获取稳定直链。', 'Sign in to upload images and get stable links.')}</p>
        </div>
      </div>
    ); // 未登录视图结束
  } // 未登录分支结束

  return (
    <div className="page img-host">
      <div className="page-head">
        <h1>{tr(locale, '图床', 'Image host')}</h1>
        <p className="muted">
          {tr(
            locale,
            '图片直传后落 public/ 前缀，读取免签名并允许 CDN 缓存；直链基线取自 MIM_STORAGE_PUBLIC_BASE_URL，未配置时服务端直接报错。',
            'Images land under the public/ prefix and are served without a signature with CDN caching. The link base comes from MIM_STORAGE_PUBLIC_BASE_URL; if it is missing the API fails explicitly.',
          )}
        </p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{tr(locale, '上传图片', 'Upload image')}</h2>
        </div>
        <p>
          <input
            type="file"
            accept="image/*"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null); // 取首个图片
              setResult(null); // 换图即清旧结果
              setError(null); // 同时清旧错误
            }}
          />
        </p>
        {file ? (
          <p className="muted">
            {file.name} · {(file.size / 1024).toFixed(1)} KB
          </p>
        ) : null}
        <p>
          <button type="button" className="btn primary" disabled={!file || busy} onClick={() => void submit()}>
            {busy ? tr(locale, '上传中…', 'Uploading…') : tr(locale, '上传并取直链', 'Upload and get link')}
          </button>
        </p>
        {error ? <p className="error">{error}</p> : null}
      </div>

      {result ? (
        <div className="panel">
          <div className="panel-head">
            <h2>{tr(locale, '直链已就绪', 'Link ready')}</h2>
          </div>
          <p className="muted">
            {result.name} · object_key: <code>{result.key}</code>
          </p>
          <p>
            <a className="btn ghost small" href={result.url} target="_blank" rel="noreferrer">
              {tr(locale, '打开图片', 'Open image')}
            </a>
          </p>
          <p className="muted">
            <code>{result.url}</code>
          </p>
          <img src={result.url} alt={result.name} style={{ maxWidth: '100%', borderRadius: '8px' }} />
        </div>
      ) : null}
    </div>
  ); // 已登录视图结束
} // Img 结束
