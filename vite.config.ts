import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

/* 后端地址：开发期由 MIM_API_BASE 覆盖（默认本机 8787），生产由构建期变量注入。
   与 src/core/config.ts 的 API_BASE 约定保持一致——两者都认可同一组环境变量名，
   避免「构建期用 A、运行期用 B」导致的接口漂移。 */
const API_TARGET = process.env.MIM_API_BASE ?? 'http://127.0.0.1:8787'

export default defineConfig({
  // 相对路径 base：同时兼容 GitHub Pages 子路径（/<repo>/）与根路径部署
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // /api 与 /auth 前缀代理到自托管后端，开发期无需手工处理跨域
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/auth': { target: API_TARGET, changeOrigin: true },
      '/storage': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // 单页应用体积较大，放宽告警阈值避免每次构建刷屏
    chunkSizeWarningLimit: 1200,
  },
})
