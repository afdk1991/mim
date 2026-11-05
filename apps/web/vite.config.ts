import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/health': { target: API_TARGET, changeOrigin: true },
    },
  },
  // 相对 base：同一份产物可挂载在任意子路径（GitHub Pages /mim/、Cloudflare /、Vercel /、自建 /）
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
