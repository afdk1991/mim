/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** CloudBase 环境 ID（如 cs-1-xxxxxxxx）；未配置时应用回退纯本地模式 */
  readonly VITE_CLOUDBASE_ENV_ID?: string
  /** CloudBase Publishable Key（公开密钥，安全由 RLS 保障） */
  readonly VITE_CLOUDBASE_ACCESS_KEY?: string
  /** CloudBase 环境地域，默认 ap-shanghai */
  readonly VITE_CLOUDBASE_REGION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
