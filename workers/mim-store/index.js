// Cloudflare Worker：mim-store 固定入口
// 角色：作为 Mim 的独立边缘入口，统一把请求透传到生产权威终点（腾讯云 CVM）。
// 这样根路径不再返回 404，且 /api/* 等接口与生产保持同一份实现。
const ORIGIN = 'https://mim.mixm.top';

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
