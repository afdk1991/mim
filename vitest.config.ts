import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

/* 单元测试配置：只跑 node 环境的纯逻辑与平台契约，不跑 DOM 渲染。
   与 vite.config.ts 共用同一套路径别名，避免测试里 import 路径和业务代码不一致。 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
