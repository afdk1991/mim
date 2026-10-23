import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // 相对路径 base：同时兼容 GitHub Pages 子路径（/<repo>/）与 EdgeOne 根路径部署
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
  test: {
    // 固定 vmForks 池：实测默认 forks 池在本机（Windows + Node 22.22 + vitest 5.0.5）
    // 下 Worker 状态（__vitest_worker__）注入失败，全部测试文件报
    // "Cannot read properties of undefined (reading 'config')" / "failed to find the current suite"。
    // vmForks/vmThreads 的 vm 模块运行器走另一条 provideWorkerState 路径，正常；
    // 该池跨平台可用，CI（ubuntu）同样兼容。
    pool: 'vmForks',
  },
})
