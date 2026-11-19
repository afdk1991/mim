// React 状态与副作用钩子：会话状态、登录提示与启动静默校验；lazy/Suspense 做路由级懒加载
import { lazy, Suspense, useEffect, useState } from 'react';
// i18n 工具：语言归一化与文案取值
import { normalizeLocale } from '@mim/i18n';
// 仅类型导入：语言枚举
import type { Locale } from '@mim/i18n';
// api 命名空间、会话读写工具、会话变更事件与启动静默校验
import {
  api, // 业务接口集合：退出登录时调用 logout
  clearSession, // 清空本地会话并广播登出
  getSession, // 读取当前内存会话
  setSession, // 登录成功后持久化会话并广播登录态
  verifySession, // 用 /me 静默校验本地会话是否仍有效
  SESSION_CHANGED_EVENT, // 登录 / 退出 / 失效 / 跨标签页同步的统一事件名
} from './api';
// 仅类型导入：登录结果、会话、会话变更原因、用户信息与语言配置结构
import type { LoginResult, Session, SessionChangeReason, UserInfo } from './api';
// 本地新增界面文案字典（收银台 / 播放器 / 分享 / 语言切换）
import { tr } from './lib/messages';
// 登录页组件：按需登录统一入口，体积小保持 eager 引入
import { Login } from './views/Login';
// 公告置顶条已从全局外壳移除：置顶公告只在社区「公告动态」页签内展示，
// 避免把内部命名（能力地图 / 版本号）与运营文案铺到每一个页面。
// 外观解析与 CSS 变量注入：主题色 / 圆角 / 字体 / 列表样式 / 导航配置
import { DEFAULT_THEME, applyThemeMode, applyThemeVars, currentThemeMode, mergeNavItems, readStoredMode, resolveTheme, setThemeMode } from './appearance';
import type { ResolvedTheme, ThemeMode } from './appearance'; // 引入依赖、类型或本地模块绑定
// 外壳组件：顶部横导航 + 1200px 两栏 + 多列页脚 + 移动端底部 Tab（外壳形态集中在这一个文件）
import { Shell } from './Shell';

// 路由级懒加载：每个视图独立 chunk，进入对应路由时才下载执行；命名导出经 then 适配为默认导出
const Profile = lazy(() => import('./views/Profile').then((m) => ({ default: m.Profile }))); // 个人中心（资料 / 账号与设置）
const Home = lazy(() => import('./views/Home').then((m) => ({ default: m.Home }))); // 门户首页（hero / 入口卡 / 精选帖）
const Community = lazy(() => import('./views/Community').then((m) => ({ default: m.Community }))); // 社区与变现
const Chat = lazy(() => import('./views/Chat').then((m) => ({ default: m.Chat }))); // IM 聊天 + 视频通话
const Circles = lazy(() => import('./views/Circles').then((m) => ({ default: m.Circles }))); // 圈子：成员制社群（与板块独立）
const Checkout = lazy(() => import('./views/Checkout').then((m) => ({ default: m.Checkout }))); // 收银台：/checkout?intent=... 二维码 / 渠道唤起 / 轮询
const PaymentReturn = lazy(() => import('./views/PaymentReturn').then((m) => ({ default: m.PaymentReturn }))); // 支付回跳承接：/pay-return?intent=... 三态结果
// 零依赖路径路由：把 /<view> 单段路径映射到对应视图，刷新、直达深链接与前进后退均可用（旧 #/<view> 链接自动改写为路径形式）
import { useAppRoute, baseOf, navigatePath } from './router'; // 路径路由 hook：地址栏 /<view> 驱动视图切换
// 仅类型导入：视图标识（新增视图必须同步 navItems 与下方渲染分支）
import type { AppView } from './router';

// 前台语言本地兜底键：后端语言配置不可用 / 无后台写权限时，把前台偏好落到本地
const FRONT_LOCALE_KEY = 'mim.locale.front';

// 登录回跳目标暂存键：只存站内路径，登录成功后消费一次（sessionStorage 随标签页生命周期）
const LOGIN_NEXT_KEY = 'mim.login.next';

/** 是否为后台路径（/admin 或 /admin/...）：后台自带管理员校验，不参与全站登录守卫 */
function isAdminPath(): boolean {
  const base = baseOf();
  let path = window.location.pathname;
  if (base !== '/' && path.startsWith(base)) path = path.slice(base.length); // 剥离子路径部署前缀
  const rel = path.replace(/^\/+/, ''); // 归一化为不带前导斜杠的相对路径
  return rel === 'admin' || rel.startsWith('admin/');
}

/** 同站路径校验：仅接受以 / 开头的站内地址，挡掉外部协议、协议相对地址、反斜杠与后台路径 */
function isSafeInternalPath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) return false; // 拒绝相对 / 协议相对地址
  if (path.includes('\\')) return false; // 反斜杠在部分浏览器会被当作斜杠，统一拒绝
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return false; // 拒绝 javascript: / https: 等外部协议
  const rel = path.replace(/^\/+/, '');
  return rel !== 'admin' && !rel.startsWith('admin/'); // 后台不接受前台回跳
}

/** 记录登录前目标；非安全路径、根路径与存储不可用时静默忽略 */
function rememberLoginNext(path: string): void {
  if (!isSafeInternalPath(path)) return;
  const base = baseOf();
  if (path === '/' || path === base || path === base.slice(0, -1)) return; // 根路径登录后直接回社区
  try {
    sessionStorage.setItem(LOGIN_NEXT_KEY, path);
  } catch {
    /* 隐私模式下存储不可用不阻断登录 */
  }
}

/** 取出并清除登录前目标；脏值一律丢弃 */
function takeLoginNext(): string | null {
  try {
    const next = sessionStorage.getItem(LOGIN_NEXT_KEY);
    sessionStorage.removeItem(LOGIN_NEXT_KEY);
    return next && isSafeInternalPath(next) ? next : null;
  } catch {
    return null;
  }
}

/** 读取本地持久化的前台语言偏好；脏值 / 隐私模式回落 null */
function readLocalFrontLocale(): Locale | null {
  try {
    const raw = localStorage.getItem(FRONT_LOCALE_KEY);
    return raw ? normalizeLocale(raw) : null;
  } catch {
    return null;
  }
}

/** 写入本地前台语言偏好；存储不可用时静默忽略 */
function writeLocalFrontLocale(locale: Locale): void {
  try {
    localStorage.setItem(FRONT_LOCALE_KEY, locale);
  } catch {
    /* 存储不可用不阻断切换 */
  }
}

// 身份口径（2026-11-15 起）：全站关闭注册，也不再自动签发免登录访客会话。
// 未登录访问只展示未登录状态，需要身份的视图给登录引导；登录后按正式账号路径工作。

// 应用根组件：未登录可浏览只读页面，需要身份的视图引导登录
export function App() {
  // 会话状态：初始值从 localStorage 恢复（api.ts 已做结构校验），实现刷新后保持登录
  const [session, setLocalSession] = useState<Session | null>(getSession());
  // 当前视图由地址栏路径驱动（对外路径段为模块功能名称，如 /community）：根路径与未知路径经 parseLocation 回落到社区
  const [route, go] = useAppRoute(); // go 为统一跳转入口，所有导航按钮都改用它（pushState 写入 /<模块功能名>）
  // 登录提示：null 默认无提示，expired 为登录态失效后的重登说明
  const [gateNotice, setGateNotice] = useState<'expired' | null>(null);
  // 外观主题：后台下发配置清洗后的设计令牌；接口不可达或脏数据时回落默认外观，不白屏
  const [theme, setTheme] = useState<ResolvedTheme>(DEFAULT_THEME);
  // 明暗：访客本地偏好优先；首帧就应用，避免已选暗色的用户先看到浅色闪屏
  const [mode, setMode] = useState<ThemeMode>(() => {
    const stored = readStoredMode(); // 读取已保存的访客选择
    if (stored) applyThemeMode(stored); // 有偏好立即生效
    return stored ?? 'light'; // 未选择时先按浅色，等站点配置返回再纠正
  });

  // 界面语言：已登录取用户偏好并归一化；未登录传 undefined，自动回退默认语言
  const locale: Locale = normalizeLocale(session?.user.locale);

  // 启动外观消费：拉取公开站点配置 → 清洗主题 → 注入 CSS 变量（主色 / 底色 / 圆角 / 字体 / 列表样式 / 导航项）；
  // 任一环节失败都回落 DEFAULT_THEME，保证首帧有默认外观可用。
  useEffect(() => {
    let alive = true; // 卸载后不再写状态
    void api.commerce.siteConfig().then((config) => { // 执行当前业务步骤
      if (!alive) return; // 条件分支：按判断结果选择后续处理路径
      const resolved = resolveTheme(config.theme); // 逐项清洗脏数据
      setTheme(resolved);
      applyThemeVars(resolved); // 写入 :root CSS 变量与数据集（含明暗口径）
      setMode(currentThemeMode()); // 同步按钮状态：本地偏好优先于站点默认
    }).catch(() => {
      if (!alive) return; // 条件分支：按判断结果选择后续处理路径
      setTheme(DEFAULT_THEME); // 离线 / 配置缺失：回落默认外观
      applyThemeVars(DEFAULT_THEME); // 同步注入默认令牌，避免首帧停留在 CSS 兜底色
      setMode(currentThemeMode()); // 同步按钮状态
    });
    return () => { alive = false; }; // 返回当前函数的处理结果
  }, []);

  // 「把论坛设为网站首页」：仅在访问站点根路径时决定落点，深链接与站内导航一律不拦截。
  // 优先读冻结契约 GET /community/home-setting；404 / 异常时回落 site/config 的 home_view；再失败保持门户首页。
  useEffect(() => {
    const base = baseOf(); // 挂载前缀：根部署 '/'，GitHub Pages '/mim/'
    const path = window.location.pathname.replace(/\/index\.html$/, '/'); // 归一化 index.html 直达
    if (path !== base && path !== '/') return; // 非根路径不处理
    let alive = true; // 组件卸载后不再跳转
    const decideHome = async (): Promise<'community' | 'portal'> => { // 常量 decideHome：保存固定配置或一次性派生值
      try { // 异常捕获起点：包裹可能抛出错误的操作
        const setting = await api.community.homeSetting(); // 冻结契约：论坛 / 门户开关
        return setting.home === 'community' ? 'community' : 'portal'; // 返回当前函数的处理结果
      } catch {
        try { // 异常捕获起点：包裹可能抛出错误的操作
          const config = await api.commerce.siteConfig(); // 降级：旧版站点配置
          return config.home_view === 'community' ? 'community' : 'portal'; // 返回当前函数的处理结果
        } catch {
          return 'portal'; // 再失败：保持现状门户首页
        } // 代码块结束
      } // 代码块结束
    }; // 代码块结束
    void decideHome().then((home) => { if (alive && home === 'community') go({ view: 'community' }); }); // 执行当前业务步骤
    return () => { alive = false; }; // 清理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 会话联动：订阅会话变更事件 + 启动时静默校验令牌有效性
  useEffect(() => {
    // 会话变更处理：登录 / 退出 / 失效 / 跨标签页同步都统一走这里
    const onChange = (event: Event) => {
      // 读取事件携带的会话与原因，避免依赖可能滞后的内存态
      const detail = (event as CustomEvent<{ session: Session | null; reason: SessionChangeReason }>).detail;
      // 以事件为准更新界面会话状态
      setLocalSession(detail?.session ?? null);
      // 仅「失效」保留重登提示，其余来源（登录 / 主动退出 / 同步）清空提示
      setGateNotice(detail?.reason === 'expired' ? 'expired' : null);
    }; // onChange 结束
    // 注册会话变更监听
    window.addEventListener(SESSION_CHANGED_EVENT, onChange);
    // 刷新或直接打开内部页面时：本地有会话才校验，匿名浏览不产生任何鉴权请求
    if (getSession()) {
      // 校验失败兜底登出，防止事件链路异常时界面停留在已登录态
      void verifySession().then((ok) => {
        // 明确失效：清空界面会话并记录重登提示
        if (!ok) {
          // 清空内存会话，回到匿名态
          setLocalSession(null);
          // 记录失效提示，访问收费功能时展示
          setGateNotice('expired');
        } // 失效分支结束
      }); // then 结束
    } // 有会话分支结束
    // 卸载时移除监听，避免重复订阅
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, onChange);
  }, []); // 仅挂载时注册一次，路由变化不重复校验

  // 2026-11-15 口径变更：全站关闭注册并停止免登录访客自动建号。
  // 未登录访问不再触发任何建号请求；本地残留的旧访客会话按未登录处理并清掉，
  // 避免界面把访客当正式账号展示，也避免继续用访客令牌访问需要身份的接口。
  useEffect(() => {
    if (session?.user.is_guest) clearSession(); // 旧访客会话作废：清存储并广播，回到未登录态
  }, []); // 仅挂载时检查一次，登录后写入的是正式账号会话

  // 登录成功回调：持久化会话并清除登录提示；保留原 hash 让直达内页的用户原地解锁
  function handleLogin(result: LoginResult) {
    // 写会话到 localStorage 并广播（Login 内部已写一次，此处幂等覆盖）
    setSession(result);
    // 同步内存会话，触发主布局按已登录态重渲染
    setLocalSession(result);
    // 登录成功后清除登录提示
    setGateNotice(null);
    // 回跳交给下方「已登录 + 登录页」effect：统一消费登录前目标并校验同站路径
  } // handleLogin 结束

  // 退出登录：先尽力调用后端登出，再清理本地会话并回到匿名可浏览的社区页
  async function handleLogout() {
    // try 包住远端登出：网络或鉴权失败都不应阻塞本地清理
    try {
      // 通知后端注销当前 token
      await api.logout();
    } catch { // 捕获任何异常：登出属于尽力而为，失败也继续本地清理
      /* 退出登录时的网络失败不阻塞本地清理 */
    }
    // 清理 localStorage 中的会话并广播登出
    clearSession();
    // 清空内存会话，界面回到匿名态
    setLocalSession(null);
    // 主动退出不显示「已失效」提示
    setGateNotice(null);
    // 退出后停在未登录态：回到社区页，全站守卫随即把用户带到登录页
    go({ view: 'community' });
    // 2026-11-15 口径变更：登出后不再补领访客会话，保持未登录态直到用户主动登录
  } // handleLogout 结束

  // 明暗切换：立即应用并持久化到 localStorage，刷新后保持
  function toggleMode() {
    const next: ThemeMode = mode === 'dark' ? 'light' : 'dark'; // 在两种模式间翻转
    setThemeMode(next); // 写 data-theme + 本地存储
    setMode(next); // 同步按钮文案
  } // toggleMode 结束

  // 设置页更新用户信息后的回调：替换会话中的 user 并持久化
  function handleUserUpdated(next: UserInfo) {
    // 以最新会话为基底，避免把静默续期前的旧令牌写回
    const base = getSession() ?? session!;
    // 保留 token 等字段，仅替换 user
    const updated: Session = { ...base, user: next };
    // 写入 localStorage 并同步界面
    setSession(updated, 'sync');
    // 同步内存状态
    setLocalSession(updated);
  } // handleUserUpdated 结束

  // 内置导航项：顺序即展示顺序；后台配置的 nav_items 按 view 覆盖文案 / 显隐，未覆盖的内置项原样保留。
  // 2026-11-13 导航收口（16 项一级 → 12 项平铺，无分组标题）：把「同一件事的第二个入口」收进上级，
  // 页面与路由全部保留（直链 / 搜索 / 站内跳转仍可达），只是不再各占一行侧栏。
  // 2026-11-15 侧栏收口：社区 · 聊天 · 个人中心 · 社区资讯 · 版本（公告动态并入社区页签）。
  // hidden 项是「已并入上级」的二级入口，页面保留但不上侧栏。
  const navDefaults: Array<{ view: AppView; label: string; hidden?: boolean }> = [
    // 门户首页：hero + 入口卡 + 精选帖
    { view: 'home', label: locale === 'en-US' ? 'Home' : '首页' },
    // 社区：论坛 / 公告动态 / 付费阅读 / VIP / 钱包 / 独立商城 / 推广；「圈子」为其成员制板块
    { view: 'community', label: locale === 'en-US' ? 'Community' : '社区' },
    // IM 聊天 + 视频通话
    { view: 'chat', label: locale === 'en-US' ? 'Chat' : '聊天' },
    // 个人中心：资料 / 账号与设置
    { view: 'account', label: locale === 'en-US' ? 'Account' : '个人中心' },
    // 圈子（原一级入口）：成员制社群，已并入社区页的「圈子」板块 → hidden
    { view: 'circles', label: locale === 'en-US' ? 'Circles' : '圈子', hidden: true },
  ]; // 内置导航项定义结束
  // 合并后台导航配置：未知视图忽略，显隐与文案以后台配置为准，缺省回落内置项；
  // hidden 项是「已合并进上级」的二级入口，页面保留但不上侧栏（后台显式配置 visible 不能把它强行拉回）
  const navItems = mergeNavItems(navDefaults, theme.navItems).filter((item) => item.visible && !item.hidden);
  // 隐藏的二级入口落到哪个一级入口：用于「在 /circles 时侧栏仍高亮社区」。
  // 没有这张表时，隐藏页面的 route.view 不在侧栏里，active 计数为 0，用户会以为"没选中任何页面"。
  const SUB_VIEW_PARENT: Partial<Record<AppView, AppView>> = {
    circles: 'community', // 圈子 → 社区
  }; // 二级 → 一级映射结束
  // 侧栏高亮依据：当前在隐藏二级页时按上级高亮，其余按自身
  const activeNavView: AppView = SUB_VIEW_PARENT[route.view] ?? route.view;
  // 浏览器标签标题：首页（社区）用主名 + 副标题全称，其余页面统一「页面名 - Mim」；
  // 页面名与侧栏同源，收银台 / 支付结果 / 登录这类不入侧栏的伪视图单独补文案。
  const extraPageLabels: Partial<Record<AppView, string>> = {
    checkout: locale === 'en-US' ? 'Checkout' : '收银台',
    payreturn: locale === 'en-US' ? 'Payment result' : '支付结果',
    login: locale === 'en-US' ? 'Sign in' : '登录',
  };
  useEffect(() => {
    const tagline = locale === 'en-US' ? 'Mim-Content, community and commerce' : 'Mim-内容、社区与交易一体化';
    const pageLabel = route.view === 'community' || route.view === 'home' // 首页例外：门户 / 社区即站点首页，用全称而不是「页面名 - Mim」
      ? undefined
      : navItems.find((item) => item.view === route.view)?.label ?? extraPageLabels[route.view];
    document.title = pageLabel ? `${pageLabel} - Mim` : tagline; // 社区与未知视图都按首页全称
  }, [route.view, locale, navItems]); // 视图 / 语言 / 后台导航文案变化时同步标题
  // 合并后的二级入口：被收进上级的页面不再占侧栏。
  // 2026-11-15 访客收敛：社区页顶部不再挂「圈子（成员制社群）」「部署汇总（N 个部署项）」，
  // 两者属于内部命名 / 运维条目数，入口改由社区页内对应板块承载；仅在二级页给一条「返回社区」。
  const subEntries: Array<{ view: AppView; label: string }> =
    route.view === 'circles'
      ? [{ view: 'community', label: locale === 'en-US' ? 'Back to Community' : '返回社区' }]
      : [];

  // 当前有效会话：2026-11-15 起不再自动建访客号，旧访客会话也按未登录处理。
  // 只有正式账号才算登录态，界面据此决定侧栏形态与需要身份的内容区。
  const authedSession = session && !session.user.is_guest ? session : null;
  // 需要登录才能使用的视图：未登录时统一展示登录引导，而不是自动建号或空白。
  // 2026-11-15 门禁口径调整：社区列表 / 帖子详情改为匿名可读，不再列入这里；
  // 社区内的发帖、评论、点赞等互动由页面自身拦截并引导登录。
  const needsSession =
    route.view === 'account' ||
    route.view === 'circles' ||
    route.view === 'checkout' || // 收银台按支付意图查单，需令牌
    route.view === 'payreturn'; // 回跳页按意图编号查单，需令牌

  // 登录守卫（2026-11-15）：需要身份的页面未登录时落到 /signin，登录成功后回到原目标。
  // 单点集中在此，页面自身不再各写一遍；/admin 由后台自己的管理员校验承接，必须排除。
  // 注意：前端守卫只是体验层，接口仍由后端门禁兜底，不能当作安全边界。
  useEffect(() => {
    if (authedSession) return; // 已登录直接放行
    if (route.view === 'login') return; // 登录页是唯一公开例外（注册关闭提示也在该页）
    if (route.view === 'community') return; // 匿名可读：社区列表与帖子详情不跳登录
    if (route.view === 'home') return; // 匿名可读：门户首页不跳登录
    if (isAdminPath()) return; // 后台路由不拦，交给 apps/admin 的管理员校验
    // 记录登录前目标（含挂载前缀、查询串与 hash），登录成功后原样回跳
    rememberLoginNext(window.location.pathname + window.location.search + window.location.hash);
    // 直接给登录引导：不发起任何建号 / 访客请求
    go({ view: 'login' });
  }, [authedSession, route.view, go]);

  // 已登录且停在登录页：消费登录前目标，校验同站路径后回跳；没有目标时回社区。
  useEffect(() => {
    if (!authedSession) return;
    if (route.view !== 'login') return;
    const next = takeLoginNext(); // 取一次即清除，避免下次登录串到旧目标
    if (next) navigatePath(next); // 同站深链接：写地址栏并广播路由事件
    else go({ view: 'community' });
  }, [authedSession, route.view, go]);

  // 主布局：外壳（顶部横导航 + 1200px 两栏 + 多列页脚）统一在 Shell 中组装，
  // 这里只负责按路由选出当前视图；外壳形态回退时改 Shell.tsx 与 styles.css 即可。
  return (
    // 布局容器：data-list-style / data-nav-layout 仍把后台外观口径透传给列表与外壳选择器
    <div className="layout" data-list-style={theme.listStyle} data-nav-layout={theme.navLayout}>
      <Shell
        locale={locale} // 当前语言
        mode={mode} // 当前明暗
        onToggleMode={toggleMode} // 切换明暗
        navItems={navItems} // 一级导航项
        activeView={activeNavView} // 当前高亮视图
        onNavigate={(view) => go({ view })} // 统一跳转入口
        authedSession={authedSession} // 登录态
        onLogout={handleLogout} // 退出登录
        showSide={route.view !== 'login'} // 登录页整屏：关闭右栏挂件
      >
      {/* 右侧内容区：社区匿名可浏览；收费 / 私密视图匿名时内嵌登录卡片 */}
      <>{/* 视图内容片段：Shell 只负责外壳，不感知页面结构 */}
        {/* 合并入口条：被收进上级的二级页面在此给直达 / 返回入口 */}
        {subEntries.length > 0 && (
          <div className="subnav">
            {subEntries.map((entry) => (
              <button key={entry.view} type="button" className="subnav-item" onClick={() => go({ view: entry.view })}>
                {entry.label}
              </button>
            ))}
          </div>
        )}
        {/* Suspense 边界：懒加载视图独立 chunk，加载期展示统一占位，不阻塞骨架 */}
        <Suspense fallback={<div className="page hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</div>}>
        {/* 个人中心：资料 / 账号安全，仅正式账号渲染 */}
        {route.view === 'account' && authedSession && (
          <Profile locale={locale} onUserUpdated={handleUserUpdated} /> // 个人中心：资料保存后同步全局用户态
        )}{/* 个人中心表达式容器结束 */}
        {/* 门户首页：hero + 入口卡 + 精选帖，匿名可读 */}
        {route.view === 'home' && (
          <Home locale={locale} onNavigate={(view) => go({ view })} />
        )}{/* 门户首页视图结束 */}
        {/* 社区与变现：论坛 / 公告动态 / 付费阅读 / VIP / 钱包 / 独立商城 / 推广；列表与详情匿名可读，互动引导登录 */}
        {route.view === 'community' && (
          <Community
            locale={locale}
            hasSession={!!authedSession}
            onRequireLogin={() => { // 社区内互动未登录：记录当前位置后去登录，成功后回到原页面
              rememberLoginNext(window.location.pathname + window.location.search + window.location.hash);
              go({ view: 'login' });
            }}
          />
        )}{/* 社区与变现视图 */}
        {/* 圈子：成员制社群；加入 / 审核 / 发动态公告都需要登录态 */}
        {route.view === 'circles' && authedSession && <Circles locale={locale} hasSession />}{/* 圈子视图 */}
        {/* 收银台：/checkout?intent=... 或 ?purpose=... 现场建单；二维码 / 渠道唤起 / 状态轮询 */}
        {route.view === 'checkout' && authedSession && <Checkout locale={locale} />}{/* 收银台视图 */}
        {/* 支付回跳承接：/pay-return?intent=...，成功 / 处理中 / 失败三态 */}
        {route.view === 'payreturn' && authedSession && <PaymentReturn locale={locale} />}{/* 支付回跳视图 */}
        {/* 未登录且该视图需要身份：守卫会把用户送到 /signin，这里只留瞬时占位，不发起建号请求 */}
        {needsSession && !authedSession && (
          <div className="gate-shell">{/* 门禁页：统一表面 + 明确出口，避免只剩一行裸文本 */}
            <div className="gate-card">
              <span className="gate-mark" aria-hidden="true" />{/* 主色标记，与导航品牌标记同族 */}
              <h2 className="gate-title">{locale === 'en-US' ? 'Sign in required' : '需要登录后访问'}</h2>
              <p className="gate-text">
                {locale === 'en-US'
                  ? 'This page belongs to your account. Sign in to continue; you will return here afterwards.'
                  : '该页面属于账号内数据，登录后会自动回到这里。'}
              </p>
              <ul className="gate-list">
                <li>{locale === 'en-US' ? 'Profile and account security' : '个人资料与账号安全'}</li>
                <li>{locale === 'en-US' ? 'Saves, follows and notifications' : '收藏、关注与消息通知'}</li>
                <li>{locale === 'en-US' ? 'Orders, wallet and after-sales records' : '订单、钱包与售后记录'}</li>
              </ul>
              <button type="button" className="btn primary" onClick={() => go({ view: 'login' })}>
                {locale === 'en-US' ? 'Go to sign in' : '前往登录'}
              </button>
            </div>
          </div>
        )}
        {/* IM 聊天 + 视频通话：会话列表 + 消息 + 视频通话，仅正式账号渲染 */}
        {route.view === 'chat' && authedSession && <Chat locale={locale} />}{/* 聊天视图 */}
        {/* 登录伪视图：未登录时提供登录入口（注册已关闭，不再展示注册分段） */}
        {route.view === 'login' && !authedSession && (
          <Login embedded onLogin={handleLogin} notice={gateNotice} /> // 登录入口
        )}{/* 登录伪视图结束 */}
        {/* 登录伪视图：正式账号已登录时提示无需重复登录 */}
        {route.view === 'login' && authedSession && (
          <div className="gate-shell">{/* 已登录门禁页：与未登录门禁共用一套表面 */}
            <div className="gate-card">
              <span className="gate-mark" aria-hidden="true" />
              <h2 className="gate-title">{locale === 'en-US' ? 'Already signed in' : '当前已登录'}</h2>
              <p className="gate-text">
                {locale === 'en-US' ? 'This account is ready. Head back to the community.' : '账号已就绪，无需重复登录，可以直接回到社区。'}
              </p>
              <ul className="gate-list">
                <li>{locale === 'en-US' ? 'Community and circles' : '社区与圈子内容'}</li>
                <li>{locale === 'en-US' ? 'Profile and account security' : '个人资料与账号安全'}</li>
                <li>{locale === 'en-US' ? 'Orders, wallet and after-sales records' : '订单、钱包与售后记录'}</li>
              </ul>
              <button type="button" className="btn primary" onClick={() => go({ view: 'community' })}>
                {locale === 'en-US' ? 'Back to Community' : '回到社区'}
              </button>
            </div>
          </div>
        )}{/* 已登录登录伪视图结束 */}
        </Suspense>{/* 懒加载边界结束 */}
      </>{/* 视图内容片段结束：外壳的 main 由 Shell 渲染 */}
      </Shell>{/* 外壳结束：顶部导航 / 两栏 / 页脚 / 底部 Tab 都在 Shell 内 */}
      {/* 页脚：已迁入 Shell（多列：品牌 / 导航 / 更多 + 底部版权备案） */}
    </div> // 布局容器结束，JSX 根元素到此闭合
  ); // 主布局渲染结束
} // App 组件结束

// 重新导出 Locale 类型，便于其他模块从 App.tsx 引入
export type { Locale };
