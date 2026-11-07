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
