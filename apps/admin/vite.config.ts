// defineConfig 提供配置类型提示，避免选项名拼错后静默失效
import { defineConfig } from 'vite';
// React 插件：负责 JSX 转换与开发期 Fast Refresh
import react from '@vitejs/plugin-react';

// 本地后端地址：开发期由 dev server 反向代理，后台前端不必承担跨域配置
const API_TARGET = 'http://127.0.0.1:8787';

// Vite 配置对象：只影响开发服务器与构建产物，不参与运行时逻辑
export default defineConfig({
  // 启用 React 插件
  plugins: [react()],
  // 开发服务器配置：仅本机开发时生效
  server: {
    // 独立端口：与用户端 5173 区分，便于同时打开两个应用对照联调
    port: 5174,
    // 代理表：把同源请求转发给本地 API，前端代码不写死后端域名
    proxy: {
      // 业务接口前缀；changeOrigin 改写 Host 头，避免后端校验来源失败
      '/api': { target: API_TARGET, changeOrigin: true },
      // 健康检查端点同样代理，便于后台在开发期探活
      '/health': { target: API_TARGET, changeOrigin: true },
    }, // 代理表结束
  }, // 开发服务器配置结束
  // 相对 base：同一份产物可挂在任意子路径（/admin/ 或独立域名根路径）
  base: './',
  // 生产构建配置
  build: {
    // 产物目录，与部署脚本、CI 的发布路径约定一致
    outDir: 'dist',
    // 生成 sourcemap：线上报错时可还原到原始 TSX 行号
    sourcemap: true,
  }, // 构建配置结束
}); // 配置结束
