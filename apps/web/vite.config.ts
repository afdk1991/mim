// defineConfig 提供配置类型提示，避免选项名拼错而静默失效
import { defineConfig } from 'vite';
// React 插件：负责 JSX 转换与开发期 Fast Refresh
import react from '@vitejs/plugin-react';

// 本地后端地址：开发期由 dev server 反向代理，前端不必承担跨域配置
const API_TARGET = 'http://127.0.0.1:8787';

// Vite 配置对象：仅影响开发服务器与构建产物，不参与运行时逻辑
export default defineConfig({
  // 启用 React 插件
  plugins: [react()],
  // 开发服务器配置：只在本机开发时生效
  server: {
    // 固定端口：便于后端 CORS 白名单与文档保持一致
    port: 5173,
    // 代理表：把同源请求转发给本地 API，前端代码无需写死后端域名
    proxy: {
      // 业务接口前缀；changeOrigin 改写 Host 头，避免后端校验来源失败
      '/api': { target: API_TARGET, changeOrigin: true },
      // 健康检查端点同样走代理，便于前端在开发期探活
      '/health': { target: API_TARGET, changeOrigin: true },
    }, // 代理表结束
  }, // 开发服务器配置结束
  // 相对 base：同一份产物可挂载在任意子路径（GitHub Pages /mim/、Cloudflare /、Vercel /、自建 /）
  base: './',
  // 生产构建配置
  build: {
    // 产物目录，与部署脚本、CI 的发布路径约定一致
    outDir: 'dist',
    // 生成 sourcemap：线上报错时可还原到原始 TSX 行号，便于定位
    sourcemap: true,
    // 人工分包：把稳定第三方与工作区共享包从视图 chunk 中剥离，避免两个 1MB+ 大共享 chunk；
    // 路由级 React.lazy 拆分保持不变，异步 chunk 仍按需加载
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // React 运行时（react / react-dom）独立成包，首屏与各视图复用同一份
          if (id.includes('react-dom') || /[\\/]node_modules[\\/]react[\\/]/.test(id)) return 'vendor-react';
          // 图表与图引擎：echarts / @antv/g6 本就动态 import，各自独立懒加载包，避免互相牵连
          if (id.includes('echarts')) return 'vendor-echarts';
          if (id.includes('@antv/g6')) return 'vendor-g6';
          // 富文本编辑器 vditor：静态引入于漫剧工作台，独立包随懒加载视图进入
          if (id.includes('vditor')) return 'vendor-markdown';
          // 工作区共享包：@mim/i18n 与 @mim/core-domain，同时兼容 node_modules 软链与源码目录路径
          if (/[\\/]packages[\\/]i18n[\\/]/.test(id) || /[\\/]@mim[\\/]i18n[\\/]/.test(id)) return 'vendor-i18n';
          if (/[\\/]packages[\\/]core-domain[\\/]/.test(id) || /[\\/]@mim[\\/]core-domain[\\/]/.test(id)) return 'vendor-domain';
          return undefined; // 其余模块保持既有懒加载 / 视图归属
        },
      },
    },
  }, // 构建配置结束
}); // 配置结束
