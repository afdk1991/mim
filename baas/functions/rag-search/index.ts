/**
 * RAG 检索：把查询文本向量化后走库内 RPC。
 * POST { "query": "文本", "match_count": 8, "threshold": 0.2,
 *        "filter_document": "<uuid>", "hybrid": true }
 *
 * 权限说明（重要）：这里默认用 service_role 调用，会绕过 RLS —— 仅适合「平台级」
 * 检索。若面向终端用户，请把浏览器带来的 Authorization 透传为 userJwt 参数，
 * 让 RLS 按用户身份裁剪结果（db.ts 的 rpc() 已支持第三参）。
 */
import { error, json, preflight } from '../_shared/cors.ts'
import { embed as embedText, rpc, toVectorLiteral } from '../_shared/db.ts'

type Body = {
  query?: string
  match_count?: number
  threshold?: number
  filter_document?: string
  hybrid?: boolean
}

type ChunkRow = {
  chunk_id: number
  document_id: string
  content: string
  similarity?: number
  score?: number
}

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
  if (!body.query?.trim()) return error('query 不能为空')

  const dim = Number(Deno.env.get('EMBEDDING_DIM') ?? 1536)
  const embedding = await embedText(body.query, dim)
  const matchCount = Math.min(Math.max(body.match_count ?? 8, 1), 50)

  // 传入用户 JWT 时按用户身份检索；否则按平台身份（service_role）
  const userJwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  const scoped = body.hybrid === true

  const rows = scoped
    ? await rpc<ChunkRow[]>(
        'hybrid_search',
        {
          query_text: body.query,
          query_embedding: toVectorLiteral(embedding),
          match_count: matchCount,
          rrf_k: 60,
        },
        userJwt
      )
    : await rpc<ChunkRow[]>(
        'match_chunks',
        {
          query_embedding: toVectorLiteral(embedding),
          match_count: matchCount,
          match_threshold: body.threshold ?? 0.0,
          filter_document: body.filter_document ?? null,
        },
        userJwt
      )

  return json({
    mode: scoped ? 'hybrid' : 'vector',
    count: rows.length,
    results: rows,
  })
}
