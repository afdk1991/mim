/**
 * 云存储视图（/cloud）：私有桶 + 短时签名基线。
 *
 * 数据面全部复用 routes/media.ts 已有接口，本视图不新增任何后端路由：
 * - POST /media/presign/upload   取直传凭证，再由浏览器 PUT 到签名地址
 * - GET  /media/presign/download 为指定对象键换短时下载地址
 * - GET  /media/assets           列出本人全部产物（服务端已附即时 download_url）
 * - GET  /media/thumb            图片缩略图（鉴权端点，失败回退原图）
 *
 * 口径：只呈现「服务端签发短时 URL」这一条路径，不提供公有读直链。
 * 若存储驱动配置不完整，服务端会在启动阶段直接失败（STORAGE_CONFIG_INVALID），
 * 不会静默降级为本地磁盘或公有读，因此前端无需为「降级」写任何分支。
 */

import { useEffect, useMemo, useState } from 'react'; // 视图只用到这四个基础 Hook
import type { Locale } from '@mim/i18n'; // 语言标识类型
import { api, errorText, resolvePublicUrl } from '../api'; // 统一请求层、错误文案与预签名地址归一化
import type { AssetType, ListedAsset } from '../api'; // 产物类型与列表项

interface Props { // 视图入参
  locale: Locale; // 当前语言
  hasSession: boolean; // 是否已登录：未登录不请求鉴权接口
} // Props 结束

/** 中英双语文案选择器 */
function tr(locale: Locale, zh: string, en: string): string {
  return locale === 'en-US' ? en : zh; // 非英文一律回落中文
} // tr 结束

/** 字节数转可读文本；未知大小返回短横线 */
function fmtSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '—'; // 未知体积不编造数字
  if (bytes < 1024) return `${bytes} B`; // 1KB 以内直接显示字节
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; // KB 保留一位小数
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`; // MB 保留一位小数
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`; // 超过 1GB 用两位小数
} // fmtSize 结束

/** 创建时间只保留日期部分，与资讯视图口径一致 */
function fmtDate(iso?: string | null): string {
  if (!iso) return '—'; // 无时间显示短横线
  return iso.slice(0, 10); // ISO 字符串前 10 位即 YYYY-MM-DD
} // fmtDate 结束

/** 由 MIME 推断产物类型：后端只接受 image / video / audio / text / final 五类 */
function assetTypeOf(mime: string): AssetType {
  if (mime.startsWith('image/')) return 'image'; // 图片
  if (mime.startsWith('video/')) return 'video'; // 视频
  if (mime.startsWith('audio/')) return 'audio'; // 音频
  return 'text'; // 其余一律按通用文件处理（含 pdf / zip 等）
} // assetTypeOf 结束

/** 对象键末段作为展示名，避免整条 user_id/project/uuid.ext 撑爆卡片 */
function keyLabel(key: string): string {
  const parts = key.split('/'); // 按路径段拆分
  return parts[parts.length - 1] || key; // 取最后一段；异常键回退原键
} // keyLabel 结束

export function Cloud({ locale, hasSession }: Props) { // 视图主体
  const [assets, setAssets] = useState<ListedAsset[]>([]); // 本人产物列表
  const [loaded, setLoaded] = useState(false); // 首次加载是否结束（区分「加载中」与「空」）
  const [error, setError] = useState<string | null>(null); // 列表加载错误文案
  const [file, setFile] = useState<File | null>(null); // 待上传文件
  const [uploading, setUploading] = useState(false); // 直传进行中
  const [uploadError, setUploadError] = useState<string | null>(null); // 直传失败文案
  const [uploaded, setUploaded] = useState<{ key: string; url: string; name: string } | null>(null); // 直传成功后的对象键与签名下载地址

  useEffect(() => { // 登录态变化时重新拉取
    if (!hasSession) { // 未登录不请求鉴权接口，避免必然 401
      setAssets([]); // 清空列表
      setLoaded(true); // 标记已结束，直接展示登录提示
      setError(null); // 顺手清掉上一次的错误
      return; // 结束本次副作用
    } // 未登录分支结束
    let cancelled = false; // 卸载保护：组件已卸载则不再 setState
    setLoaded(false); // 重新进入加载态
    setError(null); // 清空旧错误
    void api.media
      .listAssets(undefined, { limit: 50 }) // 不传工程 ID，后端返回本人全部未过期产物
      .then((res) => {
        if (cancelled) return; // 已卸载则丢弃结果
        setAssets(res.items); // 保存列表
        setLoaded(true); // 标记加载完成
      })
      .catch((err) => {
        if (cancelled) return; // 已卸载则丢弃错误
        setError(errorText(locale, err)); // 统一英文/中文错误文案
        setLoaded(true); // 失败也要退出加载态
      });
    return () => {
      cancelled = true; // 清理时置位，避免竞态覆盖新结果
    };
  }, [hasSession, locale]); // 依赖登录态与语言

  const uploadTarget = useMemo(() => (file ? assetTypeOf(file.type || 'application/octet-stream') : null), [file]); // 预判产物类型仅用于界面提示，真正校验仍在服务端

  async function submitUpload(): Promise<void> {
    if (!file) return; // 未选文件直接返回
    setUploading(true); // 进入上传态
    setUploadError(null); // 清空上次错误
    setUploaded(null); // 清空上次结果
    try {
      const mime = file.type || 'application/octet-stream'; // 浏览器偶尔给空 MIME，兜底成二进制流
      const presign = await api.media.presignUpload({ // 申请直传凭证：对象键由服务端生成，客户端不拼接
        asset_type: assetTypeOf(mime), // 与服务端 ASSET_TYPES 对齐
        mime, // 文件 MIME
        size_bytes: file.size, // 体积用于服务端额度校验
      });
      // 直传字节：必须原样带上签名要求的方法与请求头，否则签名校验失败
      const put = await fetch(presign.upload.url, { method: presign.upload.method, headers: presign.upload.headers, body: file });
      if (!put.ok) throw new Error(`upload failed: ${put.status}`); // 非 2xx 视为失败，交给统一错误提示
      const download = await api.media.presignDownload(presign.object_key); // 上传成功立即换取短时下载地址，供用户当场取回
      setUploaded({ key: presign.object_key, url: resolvePublicUrl(download.download.url), name: file.name }); // 记录成功结果
      setFile(null); // 清空选择，避免重复上传同一文件
    } catch (err) {
      setUploadError(errorText(locale, err)); // 失败时只报错，不伪造成功状态
    } finally {
      setUploading(false); // 无论成败都退出上传态
    } // finally 结束
  } // submitUpload 结束

  if (!hasSession) { // 未登录：不请求、不展示任何对象信息
    return (
      <div className="page cloud">
        <div className="page-head">
          <h1>{tr(locale, '云存储', 'Cloud storage')}</h1>
          <p className="muted">{tr(locale, '私有桶 + 短时签名，不提供公有读直链。', 'Private bucket with short-lived signed URLs. No public-read links.')}</p>
        </div>
        <div className="panel">
          <p className="muted">{tr(locale, '登录后可查看自己的文件并直传。', 'Sign in to view your files and upload directly.')}</p>
        </div>
      </div>
    ); // 未登录视图结束
  } // 未登录分支结束

  return (
    <div className="page cloud">
      <div className="page-head">
        <h1>{tr(locale, '云存储', 'Cloud storage')}</h1>
        <p className="muted">
          {tr(
            locale,
            '对象一律由服务端签发短时地址：上传走预签名 PUT，下载走预签名 GET。桶配置缺失时服务端启动即报错，不会降级为公有读。',
            'All objects are served through short-lived URLs signed by the API: presigned PUT for upload, presigned GET for download. Missing bucket config fails at startup — it never falls back to public-read.',
          )}
        </p>
      </div>

      {/* 直传区：复用 /media/presign/upload；上传成功立刻给出短时下载地址 */}
      <div className="panel">
        <div className="panel-head">
          <h2>{tr(locale, '直传文件', 'Direct upload')}</h2>
        </div>
        <p className="muted">
          {tr(
            locale,
            '文件经签名地址直传对象存储，不经过本服务中转。上传后返回对象键与短时下载地址；创作产物列表只收录生成任务登记的产物，手工直传的对象不会自动出现在下方列表。',
            'Files go straight to object storage via a signed URL. You get an object key and a short-lived download link. The asset list below only contains objects registered by generation jobs — manual uploads are not auto-added.',
          )}
        </p>
        <p>
          <input
            type="file"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null); // 取第一个文件；取消选择时为 null
              setUploaded(null); // 换文件即清掉上次结果，避免误认
              setUploadError(null); // 同时清掉上次错误
            }}
          />
        </p>
        {file ? (
          <p className="muted">
            {file.name} · {fmtSize(file.size)} · {tr(locale, '将按类型归类为', 'classified as')} <code>{uploadTarget}</code>
          </p>
        ) : null}
        <p>
          <button type="button" className="btn primary" disabled={!file || uploading} onClick={() => void submitUpload()}>
            {uploading ? tr(locale, '上传中…', 'Uploading…') : tr(locale, '开始上传', 'Upload')}
          </button>
        </p>
        {uploadError ? <p className="error">{uploadError}</p> : null}
        {uploaded ? (
          <div className="panel">
            <p className="muted">{tr(locale, '上传成功', 'Uploaded')} · {uploaded.name}</p>
            <p className="muted">object_key: <code>{uploaded.key}</code></p>
            <p>
              <a className="btn ghost small" href={uploaded.url} target="_blank" rel="noreferrer">
                {tr(locale, '打开短时下载地址', 'Open signed download URL')}
              </a>
            </p>
          </div>
        ) : null}
      </div>

      {/* 文件列表：/media/assets 已附即时 download_url */}
      <div className="panel">
        <div className="panel-head">
          <h2>{tr(locale, '我的文件', 'My files')}</h2>
          <span className="deploy-badge">{assets.length}</span>
        </div>
        {!loaded ? <p className="hint">{tr(locale, '加载中…', 'Loading…')}</p> : null}
        {loaded && error ? <p className="error">{error}</p> : null}
        {loaded && !error && assets.length === 0 ? (
          <p className="community-empty">{tr(locale, '暂无已登记的产物。', 'No registered assets yet.')}</p>
        ) : null}
        {loaded && !error && assets.length > 0 ? (
          <ul className="plain-list announcement-list">
            {assets.map((asset) => (
              <li key={asset.id} className="panel announcement-row">
                <div className="panel-head">
                  <h3>{keyLabel(asset.object_key)}</h3>
                  <span className="deploy-badge">{asset.asset_type}</span>
                </div>
                <p className="muted">
                  {asset.mime} · {fmtSize(asset.size_bytes)} · {fmtDate(asset.created_at)}
                  {asset.expires_at ? ` · ${tr(locale, '有效至', 'valid until')} ${fmtDate(asset.expires_at)}` : ''}
                </p>
                <p>
                  <a className="btn ghost small" href={resolvePublicUrl(asset.download_url)} target="_blank" rel="noreferrer">
                    {tr(locale, '下载', 'Download')}
                  </a>
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  ); // 已登录视图结束
} // Cloud 结束
