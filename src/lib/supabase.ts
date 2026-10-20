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
