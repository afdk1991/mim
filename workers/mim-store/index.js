// Cloudflare Worker：mim-store 固定入口
// 角色：作为 Mim 的独立边缘入口，统一把请求透传到生产权威终点（腾讯云 CVM）。
// 这样根路径不再返回 404，且 /api/* 等接口与生产保持同一份实现。
// 端口：上游走 443（api.laal.top 已按 SNI 分流接管 443）。历史口径「Mim API 在 8443」
// 已废弃且该端口不可达，写死它会让 Worker 返回 500（无法连接源站），切勿改回。
const ORIGIN = 'https://api.laal.top';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = new URL(url.pathname + url.search, ORIGIN);

    const init = {
      method: request.method,
      headers: request.headers,
      redirect: 'manual',
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }

    const upstream = await fetch(target.toString(), init);
    const headers = new Headers(upstream.headers);
    headers.set('x-mim-worker', 'mim-store');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  },
};
