/**
 * 下载分发视图（/download）：软件包 / 源码包的私有分发站。
 *
 * 承接域名表里的 store 域（软件源码下载分发）。旧路径段 /store 已在路由层归属商城（改写为 /marketplace），
 * 因此这里使用 /download 作为独立路径段，不与商城抢段。
 *
 * 数据面全部复用 routes/media.ts 已有接口，本视图不新增任何后端路由：
 * - POST /media/presign/upload   取直传凭证，浏览器再 PUT 到签名地址
 * - GET  /media/presign/download 为对象键换短时下载地址（即分发链接）
 *
 * 口径与 cloud 一致：私有桶 + 签名，不提供公有读直链。
 * 分发包不是图片，因此不走 public-upload；公有读只留给图床的 public/ 前缀。
 */

import { useState } from 'react'; // 视图只用到基础状态 Hook，无副作用请求
import type { Locale } from '@mim/i18n'; // 语言标识类型
import { api, errorText, resolvePublicUrl } from '../api'; // 统一请求层、错误文案与预签名地址归一化

interface Props { // 视图入参
  locale: Locale; // 当前语言
  hasSession: boolean; // 是否已登录：未登录不请求鉴权接口
} // Props 结束

/** 中英双语文案选择器 */
function tr(locale: Locale, zh: string, en: string): string {
  return locale === 'en-US' ? en : zh; // 非英文一律回落中文
} // tr 结束

/** 字节数转可读文本；未知大小返回短横线 */
function fmtSize(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—'; // 非法值不编造数字
  if (bytes < 1024) return `${bytes} B`; // 1KB 以内直接显示字节
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; // KB 保留一位小数
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`; // MB 保留一位小数
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`; // 超过 1GB 用两位小数
} // fmtSize 结束

/**
 * 按文件名推断 MIME：浏览器对 exe / dmg / tar 等常给空 type，
 * 空值会让服务端把对象键后缀退化成 .bin，这里按已知分发包后缀补齐。
 * 与 services/mim-api/src/storage.ts 的 MIME_EXT 保持同一口径。
 */
function mimeForName(name: string): string {
  const lower = name.toLowerCase(); // 后缀判断统一小写
  const pairs: Array<[string, string]> = [ // [后缀, MIME] 对照表，顺序无关（后缀互不重叠）
    ['.zip', 'application/zip'], // 通用压缩包 / 源码包
    ['.tar', 'application/x-tar'], // tar 归档
    ['.gz', 'application/gzip'], // gzip 单文件
    ['.apk', 'application/vnd.android.package-archive'], // Android 安装包
    ['.exe', 'application/x-msdownload'], // Windows 可执行文件
    ['.dmg', 'application/x-apple-diskimage'], // macOS 磁盘映像
  ]; // 对照表结束
  const hit = pairs.find(([ext]) => lower.endsWith(ext)); // 命中哪个后缀就用哪个 MIME
  return hit ? hit[1] : 'application/octet-stream'; // 未知类型按二进制流处理，服务端回落 .bin
} // mimeForName 结束

/** 分发链接有效期选项：与后端 60s ~ 7 天区间一致 */
const TTL_OPTIONS: Array<{ seconds: number; zh: string; en: string }> = [
  { seconds: 3600, zh: '1 小时', en: '1 hour' }, // 临时内测分发
  { seconds: 86400, zh: '24 小时', en: '24 hours' }, // 默认：一天内可反复下载
  { seconds: 604800, zh: '7 天', en: '7 days' }, // 后端允许的最长有效期
]; // TTL_OPTIONS 结束

interface Issued { // 已签发的分发结果
  key: string; // 对象键
  url: string; // 短时下载地址
  name: string; // 展示用文件名 / 对象键末段
  checksum: string | null; // 本地驱动 PUT 回传的 SHA-256；S3 直传没有该响应头，为 null
} // Issued 结束

export function Download({ locale, hasSession }: Props) { // 视图主体
  const [file, setFile] = useState<File | null>(null); // 待上传分发包
  const [ttl, setTtl] = useState<number>(86400); // 分发链接有效期（秒）
  const [uploading, setUploading] = useState(false); // 直传进行中
  const [error, setError] = useState<string | null>(null); // 上传失败文案
  const [issued, setIssued] = useState<Issued | null>(null); // 本次上传的签发结果

  const [keyInput, setKeyInput] = useState(''); // 重新签发用的对象键
  const [signing, setSigning] = useState(false); // 重新签发进行中
  const [signError, setSignError] = useState<string | null>(null); // 重新签发失败文案
  const [resigned, setResigned] = useState<Issued | null>(null); // 重新签发结果

  const [copied, setCopied] = useState<string | null>(null); // 刚复制成功的链接（用于短暂反馈）

  /** 复制分发链接：剪贴板不可用时静默失败，链接仍可手动选中复制 */
  async function copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url); // 现代浏览器需 HTTPS 或 localhost
      setCopied(url); // 记录已复制，按钮文案短暂变化
      window.setTimeout(() => setCopied(null), 1500); // 1.5 秒后恢复，避免状态常驻
    } catch {
      /* 非安全上下文或用户拒绝授权：不阻断流程 */
    } // try/catch 结束
  } // copy 结束

  /** 直传分发包并立即签发一条分发链接 */
  async function submitUpload(): Promise<void> {
    if (!file) return; // 未选文件直接返回
    setUploading(true); // 进入上传态
    setError(null); // 清空上次错误
    setIssued(null); // 清空上次结果
    try {
      const mime = file.type || mimeForName(file.name); // 浏览器给空 type 时按后缀补齐
      const presign = await api.media.presignUpload({ // 申请直传凭证：对象键由服务端生成
        asset_type: 'final', // 分发包按「长期保留产物」归类，不参与中间产物过期清理
        mime, // 与对象键后缀推导同一口径
        size_bytes: file.size, // 体积供服务端限额校验
      }); // presignUpload 调用结束
      // 直传字节：必须原样带上签名要求的方法与请求头，否则签名校验失败
      const put = await fetch(presign.upload.url, { method: presign.upload.method, headers: presign.upload.headers, body: file });
      if (!put.ok) throw new Error(`upload failed: ${put.status}`); // 非 2xx 视为失败，不伪造成功
      const download = await api.media.presignDownload(presign.object_key, ttl); // 立刻按所选有效期签发分发链接
      setIssued({
        key: presign.object_key, // 服务端生成的对象键，后续重新签发只需它
        url: resolvePublicUrl(download.download.url), // 相对地址归一化为可直接打开的绝对地址
        name: file.name, // 保留原始文件名用于展示（对象键里是 uuid，不含原名）
        checksum: put.headers.get('x-object-checksum'), // 本地驱动会回传；S3 直传没有该头
      }); // 结果记录结束
      setFile(null); // 清空选择，避免重复上传同一文件
    } catch (err) {
      setError(errorText(locale, err)); // 失败只报错，不伪造成功状态
    } finally {
      setUploading(false); // 无论成败都退出上传态
    } // finally 结束
  } // submitUpload 结束

  /** 为已有对象键重新签发分发链接（例如上个月上传、链接已过期） */
  async function submitResign(): Promise<void> {
    const key = keyInput.trim(); // 去掉首尾空白，避免复制粘贴带入空格
    if (!key) return; // 空键直接返回
    setSigning(true); // 进入签发态
    setSignError(null); // 清空上次错误
    setResigned(null); // 清空上次结果
    try {
      const download = await api.media.presignDownload(key, ttl); // 复用同一签发接口，按所选有效期
      setResigned({
        key, // 回显用户输入的对象键
        url: resolvePublicUrl(download.download.url), // 归一化为绝对地址
        name: key.split('/').pop() || key, // 末段作为展示名
        checksum: null, // 重新签发不经过 PUT，无校验和可回显
      }); // 结果记录结束
    } catch (err) {
      setSignError(errorText(locale, err)); // 跨用户 / 不存在统一走服务端 404 文案
    } finally {
      setSigning(false); // 退出签发态
    } // finally 结束
  } // submitResign 结束

  /** 结果面板：上传与重新签发共用同一套展示 */
  function renderIssued(item: Issued) {
    return (
      <div className="panel">
        <p className="muted">
          {tr(locale, '分发对象', 'Artifact')} · {item.name}
        </p>
        <p className="muted">
          object_key: <code>{item.key}</code>
        </p>
        {item.checksum ? (
          <p className="muted">
            SHA-256: <code>{item.checksum}</code>
          </p>
        ) : null}
        <p className="muted" style={{ wordBreak: 'break-all' }}>
          <code>{item.url}</code>
        </p>
        <p>
          <a className="btn ghost small" href={item.url} target="_blank" rel="noreferrer">
            {tr(locale, '打开分发链接', 'Open distribution link')}
          </a>{' '}
          <button type="button" className="btn ghost small" onClick={() => void copy(item.url)}>
            {copied === item.url ? tr(locale, '已复制', 'Copied') : tr(locale, '复制链接', 'Copy link')}
          </button>
        </p>
        <p className="muted">
          {tr(
            locale,
            '链接为短时签名，到期后需用对象键重新签发；对象键请自行留存（手工上传的包不会登记进产物列表）。',
            'The link is a short-lived signature. Re-sign with the object key after it expires. Keep the key — manually uploaded packages are not registered as assets.',
          )}
        </p>
      </div>
    ); // 结果面板结束
  } // renderIssued 结束

  if (!hasSession) { // 未登录：不请求、不展示任何对象信息
    return (
      <div className="page download">
        <div className="page-head">
          <h1>{tr(locale, '下载分发', 'Downloads')}</h1>
          <p className="muted">{tr(locale, '软件包与源码包的私有分发：只签发短时链接，不开放公有读。', 'Private distribution for packages and source archives: short-lived links only, never public-read.')}</p>
        </div>
        <div className="panel">
          <p className="muted">{tr(locale, '登录后可上传分发包并签发下载链接。', 'Sign in to upload packages and issue download links.')}</p>
        </div>
      </div>
    ); // 未登录视图结束
  } // 未登录分支结束

  return (
    <div className="page download">
      <div className="page-head">
        <h1>{tr(locale, '下载分发', 'Downloads')}</h1>
        <p className="muted">
          {tr(
            locale,
            '分发包直传私有桶，下载一律走服务端签发的短时链接。桶配置缺失时服务端启动即报错，不会降级为公有读。',
            'Packages go straight into a private bucket; downloads always use short-lived signed links. Missing bucket config fails at startup — it never falls back to public-read.',
          )}
        </p>
      </div>

      {/* 上传区：复用 /media/presign/upload，上传成功立刻签发分发链接 */}
      <div className="panel">
        <div className="panel-head">
          <h2>{tr(locale, '上传分发包', 'Upload package')}</h2>
        </div>
        <p className="muted">
          {tr(
            locale,
            '支持 zip / tar / gz / apk / exe / dmg 及任意二进制文件；对象键由服务端生成，首段固定为你的用户 ID。',
            'Supports zip / tar / gz / apk / exe / dmg and any binary file. The object key is generated server-side with your user ID as the first segment.',
          )}
        </p>
        <p>
          <input
            type="file"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null); // 取第一个文件；取消选择时为 null
              setIssued(null); // 换文件即清掉上次结果
              setError(null); // 同时清掉上次错误
            }}
          />
        </p>
        {file ? (
          <p className="muted">
            {file.name} · {fmtSize(file.size)} · {tr(locale, '将按', 'as')} <code>{file.type || mimeForName(file.name)}</code>
          </p>
        ) : null}
        <p>
          <label className="muted">
            {tr(locale, '分发链接有效期', 'Link lifetime')}{' '}
            <select value={ttl} onChange={(event) => setTtl(Number(event.target.value))}>
              {TTL_OPTIONS.map((option) => (
                <option key={option.seconds} value={option.seconds}>
                  {locale === 'en-US' ? option.en : option.zh}
                </option>
              ))}
            </select>
          </label>
        </p>
        <p>
          <button type="button" className="btn primary" disabled={!file || uploading} onClick={() => void submitUpload()}>
            {uploading ? tr(locale, '上传中…', 'Uploading…') : tr(locale, '上传并签发链接', 'Upload and issue link')}
          </button>
        </p>
        {error ? <p className="error">{error}</p> : null}
        {issued ? renderIssued(issued) : null}
      </div>

      {/* 重新签发：为已上传的对象键换一条新链接 */}
      <div className="panel">
        <div className="panel-head">
          <h2>{tr(locale, '重新签发链接', 'Re-sign a link')}</h2>
        </div>
        <p className="muted">
          {tr(
            locale,
            '填入之前上传时返回的对象键，按上方所选有效期换一条新链接。只能签发自己名下的对象，他人对象一律 404。',
            'Paste an object key returned by a previous upload to issue a fresh link with the lifetime selected above. Only your own objects can be signed; other users get a 404.',
          )}
        </p>
        <p>
          <input
            type="text"
            value={keyInput}
            placeholder="<user_id>/uploads/<uuid>.zip"
            onChange={(event) => setKeyInput(event.target.value)}
            style={{ width: '100%', maxWidth: '520px' }}
          />
        </p>
        <p>
          <button type="button" className="btn ghost" disabled={!keyInput.trim() || signing} onClick={() => void submitResign()}>
            {signing ? tr(locale, '签发中…', 'Signing…') : tr(locale, '签发下载链接', 'Issue download link')}
          </button>
        </p>
        {signError ? <p className="error">{signError}</p> : null}
        {resigned ? renderIssued(resigned) : null}
      </div>
    </div>
  ); // 已登录视图结束
} // Download 结束
