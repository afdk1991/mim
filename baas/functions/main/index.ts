/**
 * Edge Functions 入口（edge-runtime 的 --main-service 指向这里）。
 * 容器内所有函数共用一个服务，按路径第一级分派：
 *   /functions/v1/hello        → hello
 *   /functions/v1/embed        → embed
 *   /functions/v1/rag-search  → rag-search
 * 网关已把 /functions/v1 前缀重写成 /，两种写法都能命中。
 */
import { json } from '../_shared/cors.ts'
import hello from '../hello/index.ts'
import embed from '../embed/index.ts'
import ragSearch from '../rag-search/index.ts'

export type Handler = (req: Request) => Promise<Response> | Response

const routes: Record<string, Handler> = {
  hello,
  embed,
  'rag-search': ragSearch,
}

function resolve(pathname: string): string {
  const seg = pathname.split('/').filter(Boolean)
  // /functions/v1/<name> 或 /<name>
  if (seg[0] === 'functions') return seg[2] ?? ''
  return seg[0] ?? ''
}

Deno.serve(async (req: Request) => {
  const { pathname } = new URL(req.url)
  const name = resolve(pathname)
  const handler = routes[name]

  if (!handler) {
    return json(
      {
        error: `未找到函数：${name || '(空)'}`,
        available: Object.keys(routes).map((n) => `/functions/v1/${n}`),
      },
      404
    )
  }

  try {
    return await handler(req)
  } catch (err) {
    // 统一兜底：函数内部异常也要带 CORS 头，否则浏览器只看到 CORS 错误
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})
