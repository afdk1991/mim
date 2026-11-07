// React 钩子：状态、副作用与稳定回调
import { useCallback, useEffect, useState } from 'react';

// 全部视图标识：原 4 个业务视图 + 登录伪视图 + 站点目录 + 节点模块页 + 聊天
export type AppView =
  | 'store' // 功能模块页
  | 'comic' // 漫剧 AI 剧工作台
  | 'chat' // IM 聊天 + 视频通话
  | 'sitemap' // 站点地图（DNSPod 备注卡片视图）
  | 'settings' // 设置页
  | 'login' // 未登录专用的登录伪视图
  | 'directory' // 站点目录：8 分类 / 45 节点导航
  | 'node'; // 单节点模块页

// 路由状态：node 视图额外携带 routeKey（'@' 已映射为 'root'）
export interface AppRoute {
  view: AppView; // 当前视图
  key?: string; // node 视图的路由键，如 www / root / gy
} // 路由结构结束

// 已知视图前缀集合：用于把 hash 第一段解析为视图，未知值回退到 store
const VIEWS: AppView[] = ['store', 'comic', 'chat', 'sitemap', 'settings', 'login', 'directory']; // node 由 #/site/<key> 单独解析

// 解析 hash 为路由：兼容无 hash（默认功能模块页）与未知路径（安全回退）
export function parseHash(hash: string): AppRoute {
  const raw = hash.replace(/^#/, '').replace(/^\/+/, ''); // 去掉前导 # 与 /
  const parts = raw.split('/').filter(Boolean); // 拆成路径段
  if (parts[0] === 'site' && parts[1]) { // 节点模块页：#/site/<key>
    return { view: 'node', key: decodeURIComponent(parts[1]) }; // key 可能含编码字符，需解码
  } // 节点分支结束
  const view = VIEWS.find((v) => v === parts[0]); // 在第一段里找已知视图
  return view ? { view } : { view: 'store' }; // 未知路径与空 hash 都回落到功能模块页
} // parseHash 结束

// 由路由生成 hash：所有导航入口统一走这里，保证链接格式一致
export function hrefOf(route: AppRoute): string {
  if (route.view === 'node') return `#/site/${encodeURIComponent(route.key ?? '')}`; // 节点路由
  return `#/${route.view}`; // 其余视图
} // hrefOf 结束

// 编程式跳转：设置 location.hash；同地址时直接同步状态（hashchange 不会重复触发）
export function navigate(route: AppRoute): void {
  if (typeof window === 'undefined') return; // 非浏览器环境（构建期预渲染）直接忽略
  const next = hrefOf(route); // 目标 hash
  if (window.location.hash === next) return; // 已在目标地址，无需重复写入
  window.location.hash = next; // 写入 hash，浏览器触发 hashchange
} // navigate 结束

// 路由 hook：把 location.hash 变成 React 状态，并监听前进/后退与外链跳转
export function useHashRoute(): [AppRoute, (route: AppRoute) => void] {
  const [route, setRoute] = useState<AppRoute>(() =>
    typeof window === 'undefined' ? { view: 'store' } : parseHash(window.location.hash),
  ); // 初始值来自地址栏，刷新后仍停留在当前节点
  useEffect(() => { // 订阅 hash 变化
    const onChange = () => setRoute(parseHash(window.location.hash)); // 重新解析
    window.addEventListener('hashchange', onChange); // 注册监听
    return () => window.removeEventListener('hashchange', onChange); // 卸载时清理
  }, []); // 仅挂载时注册一次
  const go = useCallback((next: AppRoute) => { // 稳定引用的跳转函数
    const hash = hrefOf(next); // 目标 hash
    if (window.location.hash === hash) { // 同地址时 hashchange 不触发
      setRoute(next); // 直接同步状态，保证按钮点击有反馈
      return; // 提前返回
    } // 同地址分支结束
    window.location.hash = hash; // 交给 hashchange 统一驱动状态
  }, []); // 无依赖，引用恒定
  return [route, go]; // 返回当前路由与跳转函数
} // useHashRoute 结束
