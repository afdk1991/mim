// React 钩子：状态、副作用与稳定回调
import { useCallback, useEffect, useState } from 'react';

// 全部视图标识：8 个业务视图 + 登录伪视图（原「设置」已并入个人中心，不再单独成页）
export type AppView =
  | 'store' // 功能模块页
  | 'products' // 商品列表（商城配套的密集列表页，含加购）
  | 'cart' // 购物车（清单 / 移除 / 清空 / 结算）
  | 'account' // 个人中心（资料 / 权益 / 订单 / 账号与设置）
  | 'sites' // 统一入口配置清单（44 个入口驱动的模块目录）
  | 'deployments' // 部署汇总（所有部署仓库与部署项的效果 / 结果 / 异常）
  | 'navigation' // 导航站（全站资源目录 + 可达性状态 + 推荐位）
  | 'search' // 统一搜索（模块 / 入口 / 导航 / 社区 / 商品）
  | 'community' // 社区与变现（论坛 / 付费阅读 / VIP / 钱包 / 独立商城 / 推广）
  | 'commerce' // 商业化中台（资产 / 支付 / 履约 / 资金 / 外观 / 成长 / 翻译）
  | 'comic' // 漫剧 AI 剧工作台
  | 'chat' // IM 聊天 + 视频通话
  | 'login'; // 未登录专用的登录伪视图

// 路由状态：仅需当前视图标识
export interface AppRoute {
  view: AppView; // 当前视图
} // 路由结构结束

// 视图 → 地址栏路径段（模块功能名称，2026-11-11 全平台统一）：
// 对外地址一律为 https://<域名>/<模块功能名>，与 App.tsx 导航文案一一对应，
// 不再使用 store / comic / sites / login 这类与功能名对不上的缩写段。
export const VIEW_SEGMENTS: Record<AppView, string> = {
  store: 'marketplace', // 商城目录（匿名可浏览）
  products: 'products', // 商品列表（与功能名一致）
  cart: 'cart', // 购物车（与功能名一致）
  account: 'account', // 个人中心（与功能名一致；账号设置在此，不再单独设「设置」页）
  sites: 'entry-catalog', // 入口配置清单（44 个入口驱动的模块目录）
  deployments: 'deployments', // 部署汇总（原名即功能名，保持不变）
  navigation: 'navigation', // 导航站（原名即功能名，保持不变）
  search: 'search', // 统一搜索（与功能名一致）
  community: 'community', // 社区与变现（论坛 + 知识付费 + VIP + 钱包 + 独立商城）
  commerce: 'commerce', // 商业化中台（资产 / 履约 / 资金 / 外观 / 成长）
  comic: 'comic-studio', // 漫剧 AI 剧工作台
  chat: 'chat', // 聊天（原名即功能名，保持不变）
  login: 'signin', // 登录（对外语义为登录动作，非内部伪视图名）
};

// 路径段 → 视图的反向索引：由 VIEW_SEGMENTS 派生，保证正反两向永不走样
const SEGMENT_VIEWS: ReadonlyMap<string, AppView> = new Map(
  (Object.keys(VIEW_SEGMENTS) as AppView[]).map((view) => [VIEW_SEGMENTS[view], view]), // [路径段, 视图] 二元组
);

// 改名前的旧路径段：线上旧链接、旧书签与外部引用仍需可达，
// 命中后由 resolveSegment 原地改写为新路径（等价 301，不新增历史记录）。
// 已改名的四个视图之外的段（chat / settings / deployments）新名与旧名相同，写在表里只为口径完整。
const LEGACY_SEGMENTS: Readonly<Record<string, AppView>> = {
  store: 'store', // 旧：商城 → marketplace
  sites: 'sites', // 旧：入口配置清单 → entry-catalog
  comic: 'comic', // 旧：漫剧 AI 剧 → comic-studio
  login: 'login', // 旧：登录 → signin
  profile: 'account', // 旧口径：个人中心 → account（新增视图同时兼容曾用名）
  settings: 'account', // 旧：独立「设置」页已并入个人中心，旧链接落到 /account，不再保留空设置页
  chat: 'chat', // 未改名（新旧一致）
  deployments: 'deployments', // 未改名（新旧一致）
  products: 'products', // 未改名（新旧一致）
  cart: 'cart', // 未改名（新旧一致）
  forum: 'community', // 旧口径：论坛 / 社区 → community（同一视图的曾用名）
};

// 全部视图均为单段路径（如 /comic-studio），保证 vite base './' 下相对资源解析正确
const VIEWS: AppView[] = Object.keys(VIEW_SEGMENTS) as AppView[]; // 视图全集：由映射表派生的唯一真源

// 自定义路由事件名：pushState 不会触发 popstate，编程式导航后派发此事件通知 hook 更新
const ROUTE_EVENT = 'mim:route'; // 同窗口内导航专用，跨标签页不需要（各标签页独立渲染）

// 挂载前缀缓存：一次推断后复用，避免每次导航都重新计算
let cachedBase: string | null = null; // null 表示尚未推断

// 推断应用挂载前缀：根部署为 '/'，GitHub Pages 子路径部署为 '/mim/'
// 原理：vite base './' 让产物 script 用相对路径引用 assets，浏览器绝对化后该模块 URL 的
// '/assets/' 之前部分即为挂载前缀；本模块就在 assets 目录内，故 import.meta.url 可直接推断
export function baseOf(): string {
  if (cachedBase !== null) return cachedBase; // 命中缓存直接返回
  let base = '/'; // 默认根部署
  try {
    // 当前模块的绝对 URL，形如 https://host/mim/assets/index-xxx.js（dev 下为 /src/router.ts，不含 /assets/）
    const url = new URL(import.meta.url); // import.meta.url 由浏览器保证为绝对地址
    const idx = url.pathname.indexOf('/assets/'); // 定位产物资源目录
    if (idx >= 0) base = url.pathname.slice(0, idx + 1); // 保留尾斜杠：'/mim/' 或 '/'
  } catch {
    base = '/'; // 非浏览器环境（测试 / SSR）兜底为根部署
  }
  cachedBase = base; // 写入缓存
  return base; // 返回推断结果
} // baseOf 结束

// 把地址栏路径剥离挂载前缀后拆段，返回首个非空段；无段时返回空串
function firstSegment(): string {
  const base = baseOf(); // 挂载前缀
  let path = window.location.pathname; // 当前路径，如 '/mim/store' 或 '/store'
  if (base !== '/' && path.startsWith(base)) path = path.slice(base.length); // 剥离 '/mim/' 前缀，余 'store'
  else if (base !== '/' && path === base.slice(0, -1)) path = ''; // 无尾斜杠的 '/mim' 视为子路径根
  return path.split('/').filter(Boolean)[0] ?? ''; // 取首个非空段；空路径返回空串
} // firstSegment 结束

// 把路径段解析为视图：先按新路径段（模块功能名）精确匹配；未命中再查旧路径段，
// 命中旧段时把地址原地改写为新路径（等价 301：保留查询串与 hash，不新增历史记录）。
// 两向都不命中返回 null，交由调用方做安全回退。
function resolveSegment(seg: string): AppView | null {
  if (!seg) return null; // 空段（根路径）不做匹配
  const canonical = SEGMENT_VIEWS.get(seg); // 优先匹配新路径段
  if (canonical) return canonical; // 已是新路径，无需改写
  const legacy = LEGACY_SEGMENTS[seg]; // 再匹配改名前的旧路径段
  if (!legacy) return null; // 未知段：交给调用方回退
  // 旧段命中：改写为新路径，查询串与 hash 原样保留（不丢 ?tads 清理后的其他参数）
  const target = baseOf() + VIEW_SEGMENTS[legacy] + window.location.search + window.location.hash;
  window.history.replaceState(null, '', target); // 原地替换，不新增浏览历史
  return legacy; // 返回旧段对应的视图
} // resolveSegment 结束

// 解析当前地址栏为路由：兼容旧 hash 链接（#/view）与未知路径（安全回退 store）
export function parseLocation(): AppRoute {
  if (typeof window === 'undefined') return { view: 'store' }; // 非浏览器环境兜底
  // 旧 hash 链接兼容：改造前线上地址一律为 #/<view>，老书签 / 外链仍可能带 hash 进入
  const hashSeg = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)[0] ?? ''; // hash 首段
  if (hashSeg) { // 存在旧 hash 路径
    const hashView = VIEWS.find((v) => v === hashSeg) ?? null; // hash 段是老口径的视图标识，直接按视图名匹配
    // 已知视图落到其新路径，已删除的旧页面（如 #/site/*）统一回退商城
    const target = baseOf() + VIEW_SEGMENTS[hashView ?? 'store'];
    window.history.replaceState(null, '', target); // 原地改写为路径形式，不新增历史记录
    return { view: hashView ?? 'store' }; // 返回匹配结果或安全回退
  } // hash 兼容分支结束
  const seg = firstSegment(); // 路径首段
  const view = resolveSegment(seg); // 新段直接命中；旧段命中并原地重定向
  return view ? { view } : { view: 'store' }; // 未知路径与根路径都回落到商城目录
} // parseLocation 结束

// 由路由生成路径：所有导航入口统一走这里，保证链接格式一致（含子路径部署前缀）
export function hrefOf(route: AppRoute): string {
  return baseOf() + VIEW_SEGMENTS[route.view]; // 形如 '/marketplace' 或 '/mim/marketplace'
} // hrefOf 结束

// 编程式跳转：pushState 写入路径并派发路由事件；同地址时直接返回（popstate 与事件均不触发）
export function navigate(route: AppRoute): void {
  if (typeof window === 'undefined') return; // 非浏览器环境直接忽略
  const next = hrefOf(route); // 目标路径
  if (window.location.pathname === next && window.location.hash === '') return; // 已在目标地址，无需重复写入
  window.history.pushState(null, '', next); // 写入历史，地址栏变为 /<view>
  window.dispatchEvent(new Event(ROUTE_EVENT)); // pushState 不触发 popstate，手动通知 hook
} // navigate 结束

// 路由 hook：把地址栏路径变成 React 状态，并监听前进/后退（popstate）与编程式导航（ROUTE_EVENT）
export function useAppRoute(): [AppRoute, (route: AppRoute) => void] {
  const [route, setRoute] = useState<AppRoute>(() => parseLocation()); // 初始值来自地址栏，刷新与直达深链接后仍停留在当前视图
  useEffect(() => { // 订阅地址栏变化
    const onChange = () => setRoute(parseLocation()); // 重新解析地址栏
    window.addEventListener('popstate', onChange); // 前进 / 后退
    window.addEventListener(ROUTE_EVENT, onChange); // pushState 编程式导航
    return () => { // 卸载时清理两类监听
      window.removeEventListener('popstate', onChange); // 移除前进 / 后退监听
      window.removeEventListener(ROUTE_EVENT, onChange); // 移除路由事件监听
    }; // 清理函数结束
  }, []); // 仅挂载时注册一次
  const go = useCallback((next: AppRoute) => { // 稳定引用的跳转函数
    navigate(next); // 写地址栏并广播（同地址时 navigate 内部直接返回、不广播）
    setRoute(next); // 同步本地状态：同地址点击也有反馈，异地址与广播结果幂等
  }, []); // 无依赖，引用恒定
  return [route, go]; // 返回当前路由与跳转函数
} // useAppRoute 结束
