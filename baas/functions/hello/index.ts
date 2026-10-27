/** 冒烟函数：验证 Edge Runtime 与环境变量注入是否正常 */
import { json, preflight } from '../_shared/cors.ts'

export default async function handler(req: Request): Promise<Response> {
  const p = preflight(req)
  if (p) return p

  return json({
    ok: true,
    fn: 'hello',
    method: req.method,
    config: {
      restBase: Deno.env.get('SUPABASE_URL') ?? '(未配置)',
      hasServiceKey: Boolean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')),
      embedding: Deno.env.get('EMBEDDING_API_URL')
        ? Deno.env.get('EMBEDDING_MODEL') ?? 'configured'
        : '(未配置，将使用伪向量)',
      dim: Number(Deno.env.get('EMBEDDING_DIM') ?? 1536),
    },
  })
}
