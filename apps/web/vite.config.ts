// defineConfig / configDefaults 来自 vitest 入口：同一份配置既给 Vite，也给 vitest 测试运行器
import { configDefaults, defineConfig } from 'vitest/config';
// React 插件：负责 JSX 转换与开发期 Fast Refresh
import react from '@vitejs/plugin-react';
// 仅类型：构建期 HTML 注入插件需要 Vite 的插件类型
import type { Plugin } from 'vite';

// 本地后端地址：开发期由 dev server 反向代理，前端不必承担跨域配置
const API_TARGET = 'http://127.0.0.1:8787';

/**
 * SEO 静态注入插件：在不改 index.html（该文件另有开发线在改）的前提下，
 * 构建期把描述、关键词、规范链接与社交分享卡写进 <head>。
 * 运行时 site-options 仍会按后台配置覆盖标题 / 描述 / og 图，二者不冲突：
 * 这里给的是「首字节就有」的静态兜底，保证不执行 JS 的爬虫也能读到站点摘要。
 */
function seoPlugin(): Plugin {
  // 注入片段：全部为 meta / link，不含内联脚本，避免触发生产 CSP 的 script-src 限制
  const tags = [
    '<meta name="description" content="Mim 是内容、社区与交易一体化平台：图文、视频与图集社区，付费阅读与付费资产，以及实物 / 自动发卡 / 人工发货三类商城商品。" />',
    '<meta name="keywords" content="Mim,社区,论坛,商城,付费阅读,图集,视频,内容平台" />',
    '<meta name="author" content="Mim" />',
    '<meta name="robots" content="index,follow,max-image-preview:large" />',
    '<meta name="theme-color" content="#3b6ef5" />',
    // canonical 不在这里写死：SPA 单页多路由，静态 "/" 会把所有页面都指向首页；
    // 改由 App 在路由变化时按真实地址写入（见 App.tsx 的标题 effect）。
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="Mim" />',
    '<meta property="og:locale" content="zh_CN" />',
    '<meta property="og:title" content="Mim-内容、社区与交易一体化" />',
    '<meta property="og:description" content="内容、社区与交易在一处完成：匿名可读的社区内容，以及完整展示全部商品的社区商城。" />',
    '<meta name="twitter:card" content="summary" />',
    '<meta name="twitter:title" content="Mim-内容、社区与交易一体化" />',
    '<meta name="twitter:description" content="内容、社区与交易在一处完成：匿名可读的社区内容，以及完整展示全部商品的社区商城。" />',
  ].map((tag) => `    ${tag}`).join('\n'); // 统一缩进，便于查看产物
  return {
    name: 'mim-seo-inject', // 插件名：仅在构建期出现
    transformIndexHtml(html) {
      return html.replace('</head>', `${tags}\n  </head>`); // 插到 head 末尾，不打断既有脚本顺序
    },
  }; // 插件对象结束
} // seoPlugin 结束

// Vite 配置对象：仅影响开发服务器与构建产物，不参与运行时逻辑
export default defineConfig({
  // 启用 React 插件；构建期再叠加 SEO 静态注入
  plugins: [react(), seoPlugin()],
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
    // 关闭 sourcemap：避免生产环境公开还原源码、内部路径与注释，调试改用本地构建
    sourcemap: false,
    // 人工分包：把稳定第三方与工作区共享包从视图 chunk 中剥离，避免两个 1MB+ 大共享 chunk；
    // 路由级 React.lazy 拆分保持不变，异步 chunk 仍按需加载
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // React 运行时（react / react-dom）独立成包，首屏与各视图复用同一份
          if (id.includes('react-dom') || /[\\/]node_modules[\\/]react[\\/]/.test(id)) return 'vendor-react';
          // 工作区共享包：@mim/i18n 与 @mim/core-domain，同时兼容 node_modules 软链与源码目录路径
          if (/[\\/]packages[\\/]i18n[\\/]/.test(id) || /[\\/]@mim[\\/]i18n[\\/]/.test(id)) return 'vendor-i18n';
          if (/[\\/]packages[\\/]core-domain[\\/]/.test(id) || /[\\/]@mim[\\/]core-domain[\\/]/.test(id)) return 'vendor-domain';
          return undefined; // 其余模块保持既有懒加载 / 视图归属
        },
      },
    },
  }, // 构建配置结束
  // 测试运行器配置：只收单元 / 组件测试；浏览器 E2E 由 Playwright 跑，不能被 vitest 当作用例收集
  test: {
    // 继承 vitest 默认排除项（node_modules / dist 等），再排除 Playwright 的 e2e 目录
    exclude: [...configDefaults.exclude, 'e2e/**'],
  }, // 测试配置结束
}); // 配置结束
