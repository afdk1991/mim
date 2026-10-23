/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** CloudBase 环境 ID（保留兼容，当前运行时不再直接使用） */
  readonly VITE_CLOUDBASE_ENV_ID?: string
  /** CloudBase Publishable Key（保留兼容） */
  readonly VITE_CLOUDBASE_ACCESS_KEY?: string
  /** CloudBase 环境地域（保留兼容） */
  readonly VITE_CLOUDBASE_REGION?: string
  /**
   * Mim 云端后端地址（CloudBase 云函数 mim-api 的 HTTP 访问入口）。
   * 未配置时 supabase 客户端为 null，应用回退「本地演示模式」（localStorage）。
   */
  readonly VITE_MIM_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
