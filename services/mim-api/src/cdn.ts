/**
 * CDN 适配层（安全加固与性能包，2026-11-13）。
 *
 * 两层职责：
 *   1. 回源缓存契约：按资源类别给出 Cache-Control 策略（带 hash 的不可变长缓存 /
 *      HTML-SWR no-cache / API 私有 no-store / 缺省短缓存）。本层只产出响应头契约，
 *      不替代真实 CDN；
 *   2. 主动刷新适配：cloudflare / edgeone / cloudfront / none。未配齐凭证一律
 *      configured=false，purge 返回 CDN_NOT_CONFIGURED，绝不假装刷新成功。
 *
 * 不新增第三方依赖：HTTP 调用走全局 fetch；CloudFront 的 SigV4 签名未在本包实现，
 * 即使凭证齐备也标记 configured=false，待主控接入 AWS SDK 后补齐。
 */

export type CdnProvider = 'cloudflare' | 'edgeone' | 'cloudfront' | 'none'; // 导出类型 CdnProvider：跨模块共享的类型定义

const PROVIDERS: ReadonlyArray<CdnProvider> = ['cloudflare', 'edgeone', 'cloudfront', 'none']; // 常量 PROVIDERS：保存固定配置或一次性派生值

/** 缓存策略类别：不可变 hash 产物 / HTML 协商缓存 / API 私有 / 缺省公共短缓存 */
export type CdnCacheCategory = 'immutable-asset' | 'html-swr' | 'api-private' | 'default-public';

export interface CdnCachePolicy { // 导出接口 CdnCachePolicy：跨模块共享的对象契约
  category: CdnCacheCategory; // 对象字段 category：记录一项配置或数据
  'Cache-Control': string; // 执行当前业务步骤
} // 代码块结束

/** 带内容 hash 的静态产物：路径段含 8 位以上 hash 且扩展名属于静态资源 */
const HASHED_ASSET = /(?:[-_.][a-zA-Z0-9]{8,}\.)(?:js|css|png|jpe?g|webp|svg|woff2?|ico|mp4|webm|avif|gif)$/i;

/** 按路径与内容类型判定回源缓存策略（纯函数，便于单测与中间件复用）。 */
export function classifyCachePolicy(pathname: string, contentType?: string): CdnCachePolicy {
  if (pathname.startsWith('/api/')) { // 条件分支：按判断结果选择后续处理路径
    return { category: 'api-private', 'Cache-Control': 'private, no-store' }; // 返回当前函数的处理结果
  } // 代码块结束
  if ((contentType ?? '').includes('text/html') || /\.html?$/i.test(pathname)) { // 条件分支：按判断结果选择后续处理路径
    return { category: 'html-swr', 'Cache-Control': 'no-cache' }; // 返回当前函数的处理结果
  } // 代码块结束
  if (HASHED_ASSET.test(pathname)) { // 条件分支：按判断结果选择后续处理路径
    return { category: 'immutable-asset', 'Cache-Control': 'public, max-age=31536000, immutable' }; // 返回当前函数的处理结果
  } // 代码块结束
  return { category: 'default-public', 'Cache-Control': 'public, max-age=60' }; // 返回当前函数的处理结果
} // 代码块结束

/** 解析配置的 CDN 厂商；非法值回落 none。 */
export function detectCdnProvider(env: Record<string, string | undefined>): CdnProvider {
  const raw = (env.MIM_CDN_PROVIDER ?? '').trim().toLowerCase(); // 常量 raw：保存固定配置或一次性派生值
  return (PROVIDERS as readonly string[]).includes(raw) ? (raw as CdnProvider) : 'none'; // 返回当前函数的处理结果
} // 代码块结束

/** 各厂商刷新所需的环境变量清单。 */
function requiredVars(provider: CdnProvider): string[] {
  switch (provider) { // 执行当前业务步骤
    case 'cloudflare': // switch 分支取值：命中后执行对应处理
      return ['MIM_CDN_CLOUDFLARE_ZONE_ID', 'MIM_CDN_CLOUDFLARE_API_TOKEN']; // 返回当前函数的处理结果
    case 'edgeone': // switch 分支取值：命中后执行对应处理
      return ['MIM_CDN_EDGEONE_ZONE_ID', 'MIM_CDN_EDGEONE_API_KEY']; // 返回当前函数的处理结果
    case 'cloudfront': // switch 分支取值：命中后执行对应处理
      return ['MIM_CDN_CLOUDFRONT_DISTRIBUTION_ID', 'MIM_CDN_AWS_ACCESS_KEY_ID', 'MIM_CDN_AWS_SECRET_ACCESS_KEY']; // 返回当前函数的处理结果
    default: // 对象字段 default：记录一项配置或数据
      return []; // 返回当前函数的处理结果
  } // 代码块结束
} // 代码块结束

export interface CdnStatus { // 导出接口 CdnStatus：跨模块共享的对象契约
  provider: CdnProvider; // 对象字段 provider：记录一项配置或数据
  /** 凭证齐备且本包已实现刷新调用；false 时 purge 不得视为成功 */
  configured: boolean;
  /** 缺失的必填变量名（已实现厂商）；未实现厂商单列原因 */
  missing: string[];
  note?: string; // 执行当前业务步骤
  cache_policy: CdnCachePolicy[]; // 对象字段 cache_policy：记录一项配置或数据
} // 代码块结束

/** 如实描述当前 CDN 配置状态：不读取凭证值，只回显齐备度与策略清单。 */
export function describeCdn(env: Record<string, string | undefined>): CdnStatus {
  const provider = detectCdnProvider(env); // 常量 provider：保存固定配置或一次性派生值
  const missing = requiredVars(provider).filter((v) => !(env[v] ?? '').trim()); // 常量 missing：保存固定配置或一次性派生值
  const implemented = provider !== 'cloudfront' && provider !== 'none'; // 常量 implemented：保存固定配置或一次性派生值
  const note = // 常量 note：保存固定配置或一次性派生值
    provider === 'cloudfront' // 赋值：更新变量 provider 的取值
      ? 'CloudFront 刷新需 SigV4 签名，本包未实现，待主控接入 AWS SDK'
      : provider === 'none' // 执行当前业务步骤
        ? '未配置 CDN 厂商（MIM_CDN_PROVIDER 缺省为 none）' // 执行当前业务步骤
        : undefined; // 执行当前业务步骤
  return { // 返回当前函数的处理结果
    provider, // 执行当前业务步骤
    configured: implemented && missing.length === 0, // 对象字段 configured：记录一项配置或数据
    missing, // 执行当前业务步骤
    note, // 执行当前业务步骤
    cache_policy: [ // 对象字段 cache_policy：记录一项配置或数据
      classifyCachePolicy('/assets/app.abc123456.js'), // 调用 classifyCachePolicy 并处理其返回结果
      classifyCachePolicy('/index.html', 'text/html'), // 调用 classifyCachePolicy 并处理其返回结果
      classifyCachePolicy('/api/v1/me'), // 调用 classifyCachePolicy 并处理其返回结果
      classifyCachePolicy('/static/banner.png'), // 调用 classifyCachePolicy 并处理其返回结果
    ], // 执行当前业务步骤
  }; // 代码块结束
} // 代码块结束

export interface PurgeResult { // 导出接口 PurgeResult：跨模块共享的对象契约
  ok: boolean; // 对象字段 ok：记录一项配置或数据
  provider: CdnProvider; // 对象字段 provider：记录一项配置或数据
  configured: boolean; // 对象字段 configured：记录一项配置或数据
  purged: string[]; // 对象字段 purged：记录一项配置或数据
  error?: string; // 执行当前业务步骤
  status?: number; // 执行当前业务步骤
  attempted_at: string; // 对象字段 attempted_at：记录一项配置或数据
} // 代码块结束

const PURGE_TIMEOUT_MS = 8_000; // 常量 PURGE_TIMEOUT_MS：保存固定配置或一次性派生值

/**
 * 主动刷新指定 URL 清单。未配置 / 未实现 / 上游失败均返回 ok=false，
 * 错误信息与 HTTP 状态如实回传；不抛异常给路由层，由路由落审计。
 */
export async function purgeCdn(env: Record<string, string | undefined>, urls: string[]): Promise<PurgeResult> {
  const status = describeCdn(env); // 常量 status：保存固定配置或一次性派生值
  const attemptedAt = new Date().toISOString(); // 常量 attemptedAt：保存固定配置或一次性派生值
  const clean = [...new Set(urls.map((u) => u.trim()).filter(Boolean))]; // 常量 clean：保存固定配置或一次性派生值

  if (!status.configured) { // 条件分支：按判断结果选择后续处理路径
    const reason = status.missing.length > 0 ? `missing ${status.missing.join(', ')}` : status.note ?? 'provider not configured'; // 常量 reason：保存固定配置或一次性派生值
    return { ok: false, provider: status.provider, configured: false, purged: [], error: `CDN_NOT_CONFIGURED: ${reason}`, attempted_at: attemptedAt }; // 返回当前函数的处理结果
  } // 代码块结束
  if (clean.length === 0) { // 条件分支：按判断结果选择后续处理路径
    return { ok: false, provider: status.provider, configured: true, purged: [], error: 'empty urls', attempted_at: attemptedAt }; // 返回当前函数的处理结果
  } // 代码块结束

  try { // 异常捕获起点：包裹可能抛出错误的操作
    if (status.provider === 'cloudflare') { // 条件分支：按判断结果选择后续处理路径
      const zone = env.MIM_CDN_CLOUDFLARE_ZONE_ID!.trim(); // 常量 zone：保存固定配置或一次性派生值
      const token = env.MIM_CDN_CLOUDFLARE_API_TOKEN!.trim(); // 常量 token：保存固定配置或一次性派生值
      const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, { // 常量 res：保存固定配置或一次性派生值
        method: 'POST', // 对象字段 method：记录一项配置或数据
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, // 对象字段 headers：记录一项配置或数据
        body: JSON.stringify({ files: clean }), // 对象字段 body：记录一项配置或数据
        signal: AbortSignal.timeout(PURGE_TIMEOUT_MS), // 对象字段 signal：记录一项配置或数据
      }); // 代码块结束
      if (!res.ok) { // 条件分支：按判断结果选择后续处理路径
        return { ok: false, provider: status.provider, configured: true, purged: [], status: res.status, error: `cloudflare purge HTTP ${res.status}`, attempted_at: attemptedAt }; // 返回当前函数的处理结果
      } // 代码块结束
      return { ok: true, provider: status.provider, configured: true, purged: clean, status: res.status, attempted_at: attemptedAt }; // 返回当前函数的处理结果
    } // 代码块结束

    if (status.provider === 'edgeone') { // 条件分支：按判断结果选择后续处理路径
      const zone = env.MIM_CDN_EDGEONE_ZONE_ID!.trim(); // 常量 zone：保存固定配置或一次性派生值
      const key = env.MIM_CDN_EDGEONE_API_KEY!.trim(); // 常量 key：保存固定配置或一次性派生值
      const res = await fetch(`https://api.edgeone.ai/v2/edgecache/${zone}/purge`, { // 常量 res：保存固定配置或一次性派生值
        method: 'POST', // 对象字段 method：记录一项配置或数据
        headers: { 'x-edgeone-api-key': key, 'content-type': 'application/json' }, // 对象字段 headers：记录一项配置或数据
        body: JSON.stringify({ urls: clean }), // 对象字段 body：记录一项配置或数据
        signal: AbortSignal.timeout(PURGE_TIMEOUT_MS), // 对象字段 signal：记录一项配置或数据
      }); // 代码块结束
      if (!res.ok) { // 条件分支：按判断结果选择后续处理路径
        return { ok: false, provider: status.provider, configured: true, purged: [], status: res.status, error: `edgeone purge HTTP ${res.status}`, attempted_at: attemptedAt }; // 返回当前函数的处理结果
      } // 代码块结束
      return { ok: true, provider: status.provider, configured: true, purged: clean, status: res.status, attempted_at: attemptedAt }; // 返回当前函数的处理结果
    } // 代码块结束

    return { ok: false, provider: status.provider, configured: false, purged: [], error: 'CDN_NOT_CONFIGURED: provider purge not implemented', attempted_at: attemptedAt }; // 返回当前函数的处理结果
  } catch (err) { // 代码块结束
    return { // 返回当前函数的处理结果
      ok: false, // 对象字段 ok：记录一项配置或数据
      provider: status.provider, // 对象字段 provider：记录一项配置或数据
      configured: true, // 对象字段 configured：记录一项配置或数据
      purged: [], // 对象字段 purged：记录一项配置或数据
      error: err instanceof Error ? err.message : String(err), // 对象字段 error：记录一项配置或数据
      attempted_at: attemptedAt, // 对象字段 attempted_at：记录一项配置或数据
    }; // 代码块结束
  } // 代码块结束
} // 代码块结束
