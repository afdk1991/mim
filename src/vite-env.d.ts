/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 自托管后端地址；未设置时前端回退同源 /api */
  readonly VITE_MIM_API_BASE?: string
  /** OTA manifest 地址（JSON：{ version, url }）；留空则关闭 OTA 检测 */
  readonly VITE_OTA_MANIFEST?: string
  /** iOS App Store 兜底链接（manifest 无 url 且为 iOS 原生壳时使用） */
  readonly VITE_APP_STORE_URL?: string
  /** 鸿蒙应用市场地址；定义后提供 openAppGallery() 跳转 */
  readonly VITE_APP_GALLERY_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
