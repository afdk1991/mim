import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Supabase 客户端（supabase.com 国际版 / 火山引擎 Supabase 版通用，仅环境变量取值不同）。
 *
 * 云端未配置（缺 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 构建时注入）时为 null，
 * 应用整体回退纯本地模式（localStorage），保证无云端配置也能随时安全构建上线。
 */
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
    : null

/** 是否已接入云端（true 时读路径/写路径走 Supabase） */
export const cloudEnabled = supabase !== null

/** GoTrue 设置端点（/auth/v1/settings，公开列出已启用的第三方登录 provider）；
   未配置云端时为 null。 */
export const authSettingsUrl: string | null = url
  ? `${url.replace(/\/+$/, '')}/auth/v1/settings`
  : null

/** 匿名 key（公开凭据，供 settings 端点请求头使用） */
export const anonKeyExport = anonKey ?? null
