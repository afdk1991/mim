// Cloudflare Pages Functions 兜底路由：SPA history 路由回退（铁律八线上可用性保障）
//
// 背景（2026-11-08 实测取证）：Pages 项目一旦挂载 Functions bundle，所有请求先经
// Functions 路由器，未匹配到函数路由且未命中静态资源时直接返回 404（含自定义 404.html），
// 静态目录内的 `_redirects`（`/* /index.html 200`）被整体旁路、不会生效。
// 表现为 /store /comic /chat /settings /login 五条深链接全部 404。
// 因此 SPA 回退改由本兜底函数实现：未命中资源（404）的 GET 页面请求重写为 index.html。
// 路由匹配说明：`/api/*` 由更具体的 functions/api/[[path]].js 处理，不会进入本函数。

// 导出 Pages Functions 约定的 onRequest 处理器（Cloudflare 运行时按文件名路由自动挂载）
export async function onRequest(context) {
  // context 由平台注入，含 request、env、next() 等；next() 将请求交给链路上的下一处理者
  const { request, env, next } = context;
  // 解析请求 URL，用于读取路径（pathname），后续判断是否为 /api 前缀
  const url = new URL(request.url);
  // 运行时能力探测：Cloudflare Pages 同时提供 next() 与 env.ASSETS；
  // EdgeOne Makers 等平台会挂载本文件却没有这两个能力，直接调用会抛错并返回
  // 「Error return from script」（HTTP 545 + 24 字节纯文本），把整站非静态路径打挂。
  const canDelegate = typeof next === 'function';
  // 仅在静态资源绑定可用时才做 index.html 重写，否则无从取回 SPA 入口
  const canRewrite = Boolean(env && env.ASSETS && typeof env.ASSETS.fetch === 'function');
  // 缺任一能力即视为「非 Cloudflare 运行时」：返回 404，把回退交给平台静态层（404.html / 视图目录）
  if (!canDelegate || !canRewrite) {
    // 明确 404：不伪装成 200，避免错误页被缓存或收录
    return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  // 先把请求放行：静态资源（/assets/*、/spa.js、/404.html 等）命中时直接返回 200 资源
  const response = await next();
  // 读取客户端 Accept 头；缺省为空串，避免对 null 调用 includes 抛错
  const accept = request.headers.get('accept') || '';
  // 判定是否为「浏览器地址栏导航」类请求：接受 HTML 才值得回退到 SPA 入口页
  const acceptsHtml = accept.includes('text/html');
  // 命中 SPA 回退条件：GET 导航 + 资源未命中（404）+ 非 /api 前缀 + 客户端接受 HTML
  if (request.method === 'GET' && response.status === 404 && !url.pathname.startsWith('/api/') && acceptsHtml) {
    // 从静态资源绑定重新取 /index.html（状态 200），实现 history 路由的服务端回退
    return env.ASSETS.fetch(new URL('/index.html', url));
  }
  // 其余请求（命中资源、/api 反代、非 GET、非 HTML 客户端）原样返回，不做任何改写
  return response;
}

// 双运行时兼容导出：EdgeOne Makers 等平台只认 `export default`，缺失时会直接以
// 「Error return from script」（HTTP 545 + 24 字节纯文本）失败，把整个站点除静态文件外的路径打挂。
// EdgeOne 运行时没有 Cloudflare 的 `env.ASSETS` 绑定，无法在此重取 /index.html，
// 因此默认导出只返回 404，交由平台静态层回落 dist/404.html 或构建期生成的视图目录。
// 用法：部署到 EdgeOne 时该函数不再抛错；部署到 Cloudflare Pages 时仍走上面的命名导出。
export default async function onRequestFallback() {
  // 明确的 404 响应：不返回 200，避免把错误页伪装成正常内容被搜索引擎收录
  return new Response('Not Found', {
    // 状态码 404 触发平台自身的 404.html / 视图目录回退链路
    status: 404,
    // 纯文本响应，避免浏览器对未知类型做嗅探
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
