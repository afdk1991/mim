/**
 * 文本向量化。
 * POST { "input": "文本" } 或 { "input": ["文本1","文本2"] }
 * 未配置 EMBEDDING_API_URL 时返回伪向量（仅用于联调，见 _shared/db.ts）
 */
import { error, json, preflight } from '../_shared/cors.ts'
import { embed as embedText } from '../_shared/db.ts'

type Body = { input?: string | string[] }

export default async function handler(req: Request): Promise<Response> {
  const p = preflight(req)
  if (p) return p
  if (req.method !== 'POST') return error('仅支持 POST', 405)

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return error('请求体不是合法 JSON')
  }

  const inputs = Array.isArray(body.input) ? body.input : [body.input ?? '']
  if (inputs.some((t) => !t.trim())) return error('input 不能为空')

  const dim = Number(Deno.env.get('EMBEDDING_DIM') ?? 1536)
  const vectors = await Promise.all(inputs.map((t) => embedText(t, dim)))

  return json({
    model: Deno.env.get('EMBEDDING_API_URL')
      ? Deno.env.get('EMBEDDING_MODEL') ?? 'configured'
      : 'pseudo-embedding',
    dim: vectors[0].length,
    vectors,
  })
}
