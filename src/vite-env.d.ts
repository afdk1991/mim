/// <reference types="vite/client" />

/* 以下三个 CloudBase 变量为「有意保留的兼容声明」，非死代码：
   运行时后端选择已统一由 src/lib/supabase.ts 的 resolveBackend() 承担
   （VITE_MIM_BACKEND / VITE_SUPABASE_* / VITE_MIM_API_BASE），此处三个变量
   当前确无任何代码读取，且 .env.example 与 CI 均未配置。
   保留目的：历史配置（含 CloudBase 静态托管方案）若回填，TS 不会报未知属性。
   清理前请先确认无外部脚本/部署流程依赖。 */
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
