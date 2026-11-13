// 主工作树本地 E2E 专用配置：API 指向正在运行的 8799；不进入提交
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    host: 'localhost',
    proxy: {
      '/api': { target: 'http://127.0.0.1:8799', changeOrigin: true },
      '/health': { target: 'http://127.0.0.1:8799', changeOrigin: true },
    },
  },
  base: './',
});
