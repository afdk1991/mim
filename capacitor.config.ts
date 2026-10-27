/* Capacitor 原生壳配置（Android / iOS）
 *
 * 1. 构建产物：webDir 指向 dist/，即 `npm run build` 的输出目录。
 *    vite.config.ts 里 base: './' 使用相对路径，产物可塞进任意原生壳或子目录。
 *    所有 native:* 脚本都先跑 build 再 cap sync / cap open，避免壳里残留旧产物。
 *
 * 2. 离线嵌入：前端路由是自研 hash 路由（src/app/router.tsx），不依赖服务端
 *    history fallback，因此 file:// 或 WebView 本地资源方式加载都能正常工作。
 *
 * 3. 后端地址：由构建期环境变量 VITE_MIM_API_BASE 决定（见 .env.example）。
 *    未配置时前端完全可用，数据落 localStorage；配置后走自托管 server/ 服务。
 *    改后端地址需要重新 build + cap sync，因为变量在构建期被内联。
 */
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.afdk1991.mim',
  appName: 'Mim',
  webDir: 'dist',
  /* Android WebView 默认用 http scheme（capacitor:// 已被弃用、file:// 有 CORS 限制），
     自托管后端是 https 地址时会出现混合内容阻断。改用 https scheme 后
     页面与资源都运行在 https 源下，是 Capacitor 官方推荐做法。 */
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  },
}

export default config
