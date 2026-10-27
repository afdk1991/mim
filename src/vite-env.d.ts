/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 自托管后端地址；未设置时前端回退同源 /api */
  readonly VITE_MIM_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
