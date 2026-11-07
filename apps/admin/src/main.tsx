// 引入 StrictMode：开发期双调用副作用，用于提前暴露不安全的写法
import { StrictMode } from 'react';
// React 18 并发渲染入口：替代已废弃的 ReactDOM.render
import { createRoot } from 'react-dom/client';
// 应用根组件：登录态与视图切换都由它内部处理
import { App } from './App';
// 全局样式：由 Vite 打包注入，保证主题变量与布局类在首屏即生效
import './styles.css';

// 取挂载节点：对应 index.html 中预留的 #root
const container = document.getElementById('root');
// 挂载点缺失说明模板与代码不匹配，直接抛错避免静默白屏
if (!container) throw new Error('#root container not found');

// 创建并发根并渲染：全应用仅此一次挂载调用
createRoot(container).render(
  <StrictMode>{/* 严格模式：包裹整棵组件树，仅在开发构建中生效 */}
    <App />{/* 应用入口组件 */}
  {/* 严格模式包裹结束，其后的逗号即 render 的参数分隔符 */}</StrictMode>,
); // 挂载调用结束
