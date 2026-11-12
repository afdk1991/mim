// Cloudflare Worker：mim-api-edge（免费 API 边缘入口）
// 角色：替代原 Sealos 付费容器（余额 0、按日计费，与「只走免费方案」冲突）的
// 第二 API 可达点。把 /health 与 /api/v1/* 透传到生产权威终点（腾讯云 CVM），
// 使 API 在 Cloudflare 全球边缘存在一个真实可探测的免费入口。
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
    headers.set('x-mim-worker', 'mim-api-edge');
    headers.set('x-mim-origin', ORIGIN);

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  },
};
