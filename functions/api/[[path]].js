// Cloudflare Pages Functions：/api/* 同源反代到生产 API（https://mim.mixm.top）
//
// 目的：前端产物中 API 源默认为同源（VITE_API_ORIGIN 为空），托管平台若不反代就会打到
// 平台自身域名而 404。此函数把 /api/* 原样透传到自建服务器，前端代码无需感知平台差异。
// 鉴权走 Authorization 头（非 Cookie），故无需处理 Set-Cookie / credentials。

const UPSTREAM = 'https://mim.mixm.top';

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const target = UPSTREAM + url.pathname + url.search;

  const headers = new Headers(request.headers);
  headers.delete('host');

  const init = {
    method: request.method,
    headers,
    redirect: 'manual',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
  }

  return fetch(target, init);
}
