// 主工作树本地 E2E 专用配置：API 指向正在运行的 8799；不进入提交
// 引入 Vite 配置定义函数：获取类型提示与配置校验
import { defineConfig } from 'vite';
// 引入 React 插件：启用 JSX 转换与 React 快速刷新
import react from '@vitejs/plugin-react';

// 导出默认 Vite 配置：E2E 场景下独立端口并把接口代理到本地后端
export default defineConfig({
  // 插件列表：仅接入 React 插件
  plugins: [react()],
  // 开发服务器配置：端口、主机与接口代理
  server: {
    port: 5175, // E2E 专用端口，避开默认 5173
    host: 'localhost', // 只监听本机回环，不对外暴露
    // 代理表：把前端开发态的接口请求转发到本地后端 8799
    proxy: {
      '/api': { target: 'http://127.0.0.1:8799', changeOrigin: true }, // 业务接口代理
      '/health': { target: 'http://127.0.0.1:8799', changeOrigin: true }, // 健康检查代理
    },
  },
  base: './', // 相对路径基座：保证 E2E 静态资源在任意端口下可定位
});
