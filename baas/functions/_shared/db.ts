/**
 * 函数侧访问 PostgREST 的最小客户端（零依赖，只用 fetch）。
 * 说明：
 *   - 用 service_role key 调用时绕过 RLS，仅用于「平台级」逻辑（如后台任务）。
 *     面向终端用户的场景应把用户 JWT 透传（Authorization: Bearer <user jwt>），
 *     这样 RLS 仍按用户身份裁决。
 *   - 向量类型必须传字符串字面量 '[0.1,0.2,...]'，不能传 JSON 数组。
 */
const BASE = Deno.env.get('SUPABASE_URL') ?? 'http://rest:3000'
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

export function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`
}

type Headers = Record<string, string>

function baseHeaders(userJwt?: string): Headers {
  const token = userJwt ?? SERVICE_KEY
  return {
    apikey: token,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

export async function rpc<T>(name: string, args: unknown, userJwt?: string): Promise<T> {
  const res = await fetch(`${BASE}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { ...baseHeaders(userJwt), Prefer: 'return=representation' },
    body: JSON.stringify(args ?? {}),
  })
  if (!res.ok) throw new Error(`rpc ${name} 失败：HTTP ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

export async function rest<T>(path: string, init?: { method?: string; body?: unknown; userJwt?: string }): Promise<T> {
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    method: init?.method ?? 'GET',
    headers: baseHeaders(init?.userJwt),
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })
  if (!res.ok) throw new Error(`rest ${path} 失败：HTTP ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

/**
 * 文本向量化。
 * 配置了 EMBEDDING_API_URL 时走 OpenAI 兼容接口；
 * 未配置时退化为「可复现的伪向量」——仅用于无密钥环境下的联调冒烟，
 * 检索结果无语义，生产必须配置真实模型。
 */
export async function embed(text: string, dim = 1536): Promise<number[]> {
  const url = Deno.env.get('EMBEDDING_API_URL')
  const model = Deno.env.get('EMBEDDING_MODEL') ?? 'text-embedding-3-small'
  const key = Deno.env.get('EMBEDDING_API_KEY') ?? ''

  if (url) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, input: text }),
    })
    if (!res.ok) throw new Error(`向量化失败：HTTP ${res.status}`)
    const data = (await res.json()) as { data: { embedding: number[] }[] }
    return data.data[0].embedding
  }

  // 伪向量：FNV-1a 哈希驱动的确定性向量，L2 归一化
  const v = new Array<number>(dim).fill(0)
  for (let i = 0; i < text.length; i++) {
    let h = 2166136261 ^ text.charCodeAt(i)
    h = (h * 16777619) >>> 0
    v[h % dim] += (h % 97) / 97 - 0.5
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
  return v.map((x) => x / norm)
}
