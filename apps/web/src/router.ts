// React 钩子：状态、副作用与稳定回调
import { useCallback, useEffect, useState } from 'react';

// 全部视图标识：业务视图 + 登录伪视图 + 收银台 / 支付回跳深链接页
export type AppView =
  | 'account' // 个人中心（资料 / 账号与设置）
  | 'community' // 社区与变现（论坛 / 公告动态 / 付费阅读 / VIP / 钱包 / 独立商城 / 推广）
  | 'chat' // IM 聊天 + 视频通话
  | 'circles' // 圈子：成员制社群（与板块 board 概念独立）
  | 'checkout' // 收银台：支付意图二维码 / 渠道唤起 / 状态轮询
  | 'payreturn' // 支付回跳承接页：三态结果展示
  | 'login'; // 未登录专用的登录伪视图

// 路由状态：仅需当前视图标识
export interface AppRoute {
  view: AppView; // 当前视图
} // 路由结构结束

// 视图 → 地址栏路径段（模块功能名称，2026-11-11 全平台统一）：
// 对外地址一律为 https://<域名>/<模块功能名>，与 App.tsx 导航文案一一对应，
// 不再使用与功能名对不上的缩写段；已下线模块不再登记路径段，访问时按未知路径回落社区。
export const VIEW_SEGMENTS: Record<AppView, string> = {
  account: 'account', // 个人中心（资料 / 账号与设置）
  community: 'community', // 社区与变现（论坛 + 公告动态 + 知识付费 + VIP + 钱包 + 独立商城）
  chat: 'chat', // 聊天（原名即功能名，保持不变）
  circles: 'circles', // 圈子（成员制社群，路径段与功能名一致）
  checkout: 'checkout', // 收银台（支付意图二维码 / 渠道唤起）
  payreturn: 'pay-return', // 支付回跳承接页（/pay-return?intent=...）
  login: 'signin', // 登录（对外语义为登录动作，非内部伪视图名）
}; // 代码块结束

// 路径段 → 视图的反向索引：由 VIEW_SEGMENTS 派生，保证正反两向永不走样
const SEGMENT_VIEWS: ReadonlyMap<string, AppView> = new Map(
  (Object.keys(VIEW_SEGMENTS) as AppView[]).map((view) => [VIEW_SEGMENTS[view], view]), // [路径段, 视图] 二元组
); // 执行当前业务步骤

// 改名前的旧路径段：线上旧链接、旧书签与外部引用仍需可达，
// 命中后由 resolveSegment 原地改写为新路径（等价 301，不新增历史记录）。
// 本表收录两类旧别名：段名改过的旧链接，以及 2026-11-15 起并入社区的独立页面旧地址。
// 其余已下线模块的旧段不登记，统一按未知路径回落社区，避免把用户送回已删除页面。
const LEGACY_SEGMENTS: Readonly<Record<string, AppView>> = {
  login: 'login', // 旧：登录 → signin
  profile: 'account', // 旧口径：个人中心 → account（新增视图同时兼容曾用名）
  settings: 'account', // 旧：独立「设置」页已并入个人中心，旧链接落到 /account，不再保留空设置页
  cart: 'account', // 2026-11-15 购物车随模块商城删除：旧链接落到 /account，不再保留空购物车页
  forum: 'community', // 旧口径：论坛 / 社区 → community（同一视图的曾用名）
  announcements: 'community', // 2026-11-15 公告动态并入社区：旧链接原地改写为 /community（生产 nginx 另有 301）
  news: 'community', // 2026-11-15 资讯内容流并入社区「公告动态 → 社区动态」页签，旧链接原地改写为 /community
  releases: 'community', // 2026-11-15 版本记录并入社区「公告动态 → 更新日志」页签，旧链接原地改写为 /community
  deployments: 'community', // 2026-11-15 部署汇总属运维内部信息，公开页面下线，旧链接原地回落到社区
}; // 代码块结束

// 旧地址需要落到「带参数的页签」时的补充查询串：目标视图本身不带子路径，
// 仅靠 LEGACY_SEGMENTS 会落到个人中心首页签，故单独登记查询串，与原有查询串合并。
const LEGACY_QUERY: Readonly<Record<string, string>> = {}; // 当前无需要补页签参数的旧地址

// 全部视图均为单段路径（如 /community），保证 vite base './' 下相对资源解析正确
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
  try { // 异常捕获起点：包裹可能抛出错误的操作
    // 当前模块的绝对 URL，形如 https://host/mim/assets/index-xxx.js（dev 下为 /src/router.ts，不含 /assets/）
    const url = new URL(import.meta.url); // import.meta.url 由浏览器保证为绝对地址
    const idx = url.pathname.indexOf('/assets/'); // 定位产物资源目录
    if (idx >= 0) base = url.pathname.slice(0, idx + 1); // 保留尾斜杠：'/mim/' 或 '/'
  } catch { // 代码块结束
    base = '/'; // 非浏览器环境（测试 / SSR）兜底为根部署
  } // 代码块结束
  cachedBase = base; // 写入缓存
  return base; // 返回推断结果
} // baseOf 结束

// 把地址栏路径剥离挂载前缀后拆段，返回全部非空段（深链接如 /circles/:id 取多段）
export function pathSegments(): string[] {
  const base = baseOf(); // 挂载前缀
  let path = window.location.pathname; // 当前路径，如 '/mim/community' 或 '/community'
  if (base !== '/' && path.startsWith(base)) path = path.slice(base.length); // 剥离 '/mim/' 前缀
  else if (base !== '/' && path === base.slice(0, -1)) path = ''; // 无尾斜杠的 '/mim' 视为子路径根
  return path.split('/').filter(Boolean); // 全部非空段；空路径返回 []
} // pathSegments 结束

// 订阅地址栏多段路径：详情类深链接（/community/post/:id、/community/news/:kind/:id）
// 需要在视图内部感知路径变化；pushState 不触发 popstate，故同时监听路由事件。
export function usePathSegments(): string[] {
  const [segments, setSegments] = useState<string[]>(() =>
    typeof window === 'undefined' ? [] : pathSegments(),
  );
  useEffect(() => {
    const onChange = () => setSegments(pathSegments()); // 地址变化后重新拆段
    window.addEventListener('popstate', onChange); // 前进 / 后退
    window.addEventListener(ROUTE_EVENT, onChange); // 编程式导航
    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener(ROUTE_EVENT, onChange);
    };
  }, []);
  return segments;
} // usePathSegments 结束

// 兼容旧调用：取首个非空段
function firstSegment(): string {
  return pathSegments()[0] ?? ''; // 首段；空路径返回空串
} // firstSegment 结束

// 读取当前查询串（收银台 / 回跳页按 intent 参数取支付意图）
export function currentQuery(): URLSearchParams {
  return new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
}

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
  const search = window.location.search; // 原查询串（含前导问号；可能为空）
  const legacyQuery = LEGACY_QUERY[seg]; // 需要补的页签参数（如旧页签别名 → tab=...）
  const qs = legacyQuery ? `?${legacyQuery}${search ? `&${search.slice(1)}` : ''}` : search; // 页签参数优先，原参数顺延
  const target = baseOf() + VIEW_SEGMENTS[legacy] + qs + window.location.hash;
  window.history.replaceState(null, '', target); // 原地替换，不新增浏览历史
  return legacy; // 返回旧段对应的视图
} // resolveSegment 结束

// 解析当前地址栏为路由：兼容旧 hash 链接（#/view）与未知路径（安全回退社区）
export function parseLocation(): AppRoute {
  if (typeof window === 'undefined') return { view: 'community' }; // 非浏览器环境兜底
  // 旧 hash 链接兼容：改造前线上地址一律为 #/<view>，老书签 / 外链仍可能带 hash 进入
  const hashSeg = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)[0] ?? ''; // hash 首段
  if (hashSeg) { // 存在旧 hash 路径
    const hashView = VIEWS.find((v) => v === hashSeg) ?? LEGACY_SEGMENTS[hashSeg] ?? null; // hash 段既可能是新视图名，也可能是旧段别名
    const hashQuery = hashView && LEGACY_QUERY[hashSeg] ? `?${LEGACY_QUERY[hashSeg]}` : ''; // 旧段需要补页签参数的情况
    // 已知视图落到其新路径，已删除的旧页面统一回退社区
    const target = baseOf() + VIEW_SEGMENTS[hashView ?? 'community'] + hashQuery;
    window.history.replaceState(null, '', target); // 原地改写为路径形式，不新增历史记录
    return { view: hashView ?? 'community' }; // 返回匹配结果或安全回退
  } // hash 兼容分支结束
  const segs = pathSegments(); // 全部路径段
  // 多段深链接：/pay/return 与 /pay-return 支付回跳承接
  if (segs[0] === 'pay' && segs[1] === 'return') return { view: 'payreturn' };
  if (segs[0] === 'pay-return') return { view: 'payreturn' };
  const view = resolveSegment(segs[0] ?? ''); // 新段直接命中；旧段命中并原地重定向
  return view ? { view } : { view: 'community' }; // 未知路径与根路径都回落到社区
} // parseLocation 结束

// 由路由生成路径：所有导航入口统一走这里，保证链接格式一致（含子路径部署前缀）
export function hrefOf(route: AppRoute): string {
  return baseOf() + VIEW_SEGMENTS[route.view]; // 形如 '/community' 或 '/mim/community'
} // hrefOf 结束

// 编程式跳转：pushState 写入路径并派发路由事件；同地址时直接返回（popstate 与事件均不触发）
export function navigate(route: AppRoute): void {
  if (typeof window === 'undefined') return; // 非浏览器环境直接忽略
  const next = hrefOf(route); // 目标路径
  if (window.location.pathname === next && window.location.hash === '') return; // 已在目标地址，无需重复写入
  window.history.pushState(null, '', next); // 写入历史，地址栏变为 /<view>
  window.dispatchEvent(new Event(ROUTE_EVENT)); // pushState 不触发 popstate，手动通知 hook
} // navigate 结束

// 编程式跳转任意站内深链接路径（含多段 / 查询串），绕过单段视图映射
export function navigatePath(path: string): void {
  if (typeof window === 'undefined') return; // 非浏览器环境直接忽略
  if (window.location.pathname + window.location.search === path) return; // 同地址不重复写入
  window.history.pushState(null, '', path); // 写入历史
  window.dispatchEvent(new Event(ROUTE_EVENT)); // 手动通知 hook 重新解析
} // navigatePath 结束

// 由视图与深链接片段构造站内路径（含挂载前缀）
export function pathOf(view: AppView, subPath = '', query = ''): string {
  const base = baseOf(); // 挂载前缀
  const prefix = base === '/' ? '' : base.replace(/\/$/, ''); // 子路径部署下去掉尾斜杠
  const suffix = subPath ? `/${subPath.replace(/^\/+/, '')}` : ''; // 多段深链接
  const qs = query ? `?${query.replace(/^\?/, '')}` : ''; // 查询串
  return `${prefix}/${VIEW_SEGMENTS[view]}${suffix}${qs}`;
} // pathOf 结束

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
