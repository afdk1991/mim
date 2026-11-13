#!/usr/bin/env node
/**
 * CDN 接入实测探测（安全加固与性能包，2026-11-13）。
 *
 * 对同一静态资源连发两次，读取回源 / 边缘响应头证据：
 *   - cf-cache-status（Cloudflare）、x-cache（CloudFront / 通用）、age（边缘缓存时长）、server；
 *   - 命中任一缓存特征头判定 CDN: detected，否则 CDN: not-detected。
 *
 * 诚实约定：未检测到边缘特征不伪造结论；探测失败 / 无网络记 not-detected 并打印 not-configured。
 * 退出码恒为 0（探测类门禁，仅给证据；阻断由 CI 人工或后续阈值规则决定）。
 *
 * 用法：
 *   node scripts/verify-cdn.mjs
 *   MIM_CDN_BASE=https://mim.mixm.top MIM_CDN_PROBE_PATH=/ node scripts/verify-cdn.mjs
 */

const BASE = (process.env.MIM_CDN_BASE ?? 'https://mim.mixm.top').replace(/\/+$/, '');
const PATHNAME = process.env.MIM_CDN_PROBE_PATH ?? '/';
const PROBE_URL = `${BASE}${PATHNAME.startsWith('/') ? PATHNAME : `/${PATHNAME}`}`;
const TIMEOUT_MS = 10_000;

const CACHE_HEADERS = ['cf-cache-status', 'x-cache', 'age', 'server', 'via', 'x-served-by'];

function evidence(headers) {
  const out = {};
  for (const name of CACHE_HEADERS) {
    const value = headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}

function looksCached(headers) {
  const cf = headers.get('cf-cache-status');
  if (cf && !/^(off|no-cache)$/i.test(cf)) return { by: 'cf-cache-status', value: cf };
  const xCache = headers.get('x-cache');
  if (xCache && /hit|miss|cached|cloudfront|edge/i.test(xCache)) return { by: 'x-cache', value: xCache };
  if (headers.has('age') && headers.get('age') !== null && headers.get('age') !== undefined) {
    return { by: 'age', value: headers.get('age') };
  }
  return null;
}

async function probeOnce(tag) {
  const res = await fetch(PROBE_URL, {
    method: 'GET',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'follow',
  });
  return { tag, status: res.status, headers: evidence(res.headers) };
}

async function main() {
  console.log(`[verify-cdn] 探测目标: ${PROBE_URL}`);
  const samples = [];
  let failure = null;

  for (const tag of ['第 1 次', '第 2 次']) {
    try {
      samples.push(await probeOnce(tag));
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
      console.error(`[verify-cdn] ${tag} 请求失败: ${failure}`);
    }
  }

  let detected = null;
  for (const sample of samples) {
    const hit = looksCached(new Map(Object.entries(sample.headers)));
    if (hit) { detected = hit; break; }
  }

  for (const sample of samples) {
    console.log(`  ${sample.tag} HTTP ${sample.status}`);
    for (const [k, v] of Object.entries(sample.headers)) console.log(`    ${k}: ${v}`);
  }

  if (detected) {
    console.log(`CDN: detected（${detected.by}=${detected.value}）`);
  } else {
    console.log('CDN: not-detected');
    console.log('not-configured: 响应头中未观察到边缘缓存特征（cf-cache-status / x-cache / age）；如已接入 CDN，请复核回源头是否被回源服务覆盖。');
    if (failure) console.log(`probe-error: ${failure}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(`[verify-cdn] 执行异常: ${err instanceof Error ? err.message : String(err)}`);
  console.log('CDN: not-detected');
  console.log('not-configured: 探测脚本自身异常，未取得边缘证据。');
  process.exit(0);
});
