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

export type CdnProvider = 'cloudflare' | 'edgeone' | 'cloudfront' | 'none';

const PROVIDERS: ReadonlyArray<CdnProvider> = ['cloudflare', 'edgeone', 'cloudfront', 'none'];

/** 缓存策略类别：不可变 hash 产物 / HTML 协商缓存 / API 私有 / 缺省公共短缓存 */
export type CdnCacheCategory = 'immutable-asset' | 'html-swr' | 'api-private' | 'default-public';

export interface CdnCachePolicy {
  category: CdnCacheCategory;
  'Cache-Control': string;
}

/** 带内容 hash 的静态产物：路径段含 8 位以上 hash 且扩展名属于静态资源 */
const HASHED_ASSET = /(?:[-_.][a-zA-Z0-9]{8,}\.)(?:js|css|png|jpe?g|webp|svg|woff2?|ico|mp4|webm|avif|gif)$/i;

/** 按路径与内容类型判定回源缓存策略（纯函数，便于单测与中间件复用）。 */
export function classifyCachePolicy(pathname: string, contentType?: string): CdnCachePolicy {
  if (pathname.startsWith('/api/')) {
    return { category: 'api-private', 'Cache-Control': 'private, no-store' };
  }
  if ((contentType ?? '').includes('text/html') || /\.html?$/i.test(pathname)) {
    return { category: 'html-swr', 'Cache-Control': 'no-cache' };
  }
  if (HASHED_ASSET.test(pathname)) {
    return { category: 'immutable-asset', 'Cache-Control': 'public, max-age=31536000, immutable' };
  }
  return { category: 'default-public', 'Cache-Control': 'public, max-age=60' };
}

/** 解析配置的 CDN 厂商；非法值回落 none。 */
export function detectCdnProvider(env: Record<string, string | undefined>): CdnProvider {
  const raw = (env.MIM_CDN_PROVIDER ?? '').trim().toLowerCase();
  return (PROVIDERS as readonly string[]).includes(raw) ? (raw as CdnProvider) : 'none';
}

/** 各厂商刷新所需的环境变量清单。 */
function requiredVars(provider: CdnProvider): string[] {
  switch (provider) {
    case 'cloudflare':
      return ['MIM_CDN_CLOUDFLARE_ZONE_ID', 'MIM_CDN_CLOUDFLARE_API_TOKEN'];
    case 'edgeone':
      return ['MIM_CDN_EDGEONE_ZONE_ID', 'MIM_CDN_EDGEONE_API_KEY'];
    case 'cloudfront':
      return ['MIM_CDN_CLOUDFRONT_DISTRIBUTION_ID', 'MIM_CDN_AWS_ACCESS_KEY_ID', 'MIM_CDN_AWS_SECRET_ACCESS_KEY'];
    default:
      return [];
  }
}

export interface CdnStatus {
  provider: CdnProvider;
  /** 凭证齐备且本包已实现刷新调用；false 时 purge 不得视为成功 */
  configured: boolean;
  /** 缺失的必填变量名（已实现厂商）；未实现厂商单列原因 */
  missing: string[];
  note?: string;
  cache_policy: CdnCachePolicy[];
}

/** 如实描述当前 CDN 配置状态：不读取凭证值，只回显齐备度与策略清单。 */
export function describeCdn(env: Record<string, string | undefined>): CdnStatus {
  const provider = detectCdnProvider(env);
  const missing = requiredVars(provider).filter((v) => !(env[v] ?? '').trim());
  const implemented = provider !== 'cloudfront' && provider !== 'none';
  const note =
    provider === 'cloudfront'
      ? 'CloudFront 刷新需 SigV4 签名，本包未实现，待主控接入 AWS SDK'
      : provider === 'none'
        ? '未配置 CDN 厂商（MIM_CDN_PROVIDER 缺省为 none）'
        : undefined;
  return {
    provider,
    configured: implemented && missing.length === 0,
    missing,
    note,
    cache_policy: [
      classifyCachePolicy('/assets/app.abc123456.js'),
      classifyCachePolicy('/index.html', 'text/html'),
      classifyCachePolicy('/api/v1/me'),
      classifyCachePolicy('/static/banner.png'),
    ],
  };
}

export interface PurgeResult {
  ok: boolean;
  provider: CdnProvider;
  configured: boolean;
  purged: string[];
  error?: string;
  status?: number;
  attempted_at: string;
}

const PURGE_TIMEOUT_MS = 8_000;

/**
 * 主动刷新指定 URL 清单。未配置 / 未实现 / 上游失败均返回 ok=false，
 * 错误信息与 HTTP 状态如实回传；不抛异常给路由层，由路由落审计。
 */
export async function purgeCdn(env: Record<string, string | undefined>, urls: string[]): Promise<PurgeResult> {
  const status = describeCdn(env);
  const attemptedAt = new Date().toISOString();
  const clean = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];

  if (!status.configured) {
    const reason = status.missing.length > 0 ? `missing ${status.missing.join(', ')}` : status.note ?? 'provider not configured';
    return { ok: false, provider: status.provider, configured: false, purged: [], error: `CDN_NOT_CONFIGURED: ${reason}`, attempted_at: attemptedAt };
  }
  if (clean.length === 0) {
    return { ok: false, provider: status.provider, configured: true, purged: [], error: 'empty urls', attempted_at: attemptedAt };
  }

  try {
    if (status.provider === 'cloudflare') {
      const zone = env.MIM_CDN_CLOUDFLARE_ZONE_ID!.trim();
      const token = env.MIM_CDN_CLOUDFLARE_API_TOKEN!.trim();
      const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ files: clean }),
        signal: AbortSignal.timeout(PURGE_TIMEOUT_MS),
      });
      if (!res.ok) {
        return { ok: false, provider: status.provider, configured: true, purged: [], status: res.status, error: `cloudflare purge HTTP ${res.status}`, attempted_at: attemptedAt };
      }
      return { ok: true, provider: status.provider, configured: true, purged: clean, status: res.status, attempted_at: attemptedAt };
    }

    if (status.provider === 'edgeone') {
      const zone = env.MIM_CDN_EDGEONE_ZONE_ID!.trim();
      const key = env.MIM_CDN_EDGEONE_API_KEY!.trim();
      const res = await fetch(`https://api.edgeone.ai/v2/edgecache/${zone}/purge`, {
        method: 'POST',
        headers: { 'x-edgeone-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ urls: clean }),
        signal: AbortSignal.timeout(PURGE_TIMEOUT_MS),
      });
      if (!res.ok) {
        return { ok: false, provider: status.provider, configured: true, purged: [], status: res.status, error: `edgeone purge HTTP ${res.status}`, attempted_at: attemptedAt };
      }
      return { ok: true, provider: status.provider, configured: true, purged: clean, status: res.status, attempted_at: attemptedAt };
    }

    return { ok: false, provider: status.provider, configured: false, purged: [], error: 'CDN_NOT_CONFIGURED: provider purge not implemented', attempted_at: attemptedAt };
  } catch (err) {
    return {
      ok: false,
      provider: status.provider,
      configured: true,
      purged: [],
      error: err instanceof Error ? err.message : String(err),
      attempted_at: attemptedAt,
    };
  }
}
