/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase 项目地址，如 https://xxxx.supabase.co；未配置时应用回退纯本地模式 */
  readonly VITE_SUPABASE_URL?: string
  /** Supabase anon key（公开密钥，安全由 RLS 保障） */
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
