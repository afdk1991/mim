// React 状态与副作用钩子：会话状态、登录提示与启动静默校验；lazy/Suspense 做路由级懒加载
import { lazy, Suspense, useEffect, useState } from 'react';
// i18n 工具：语言归一化与文案取值
import { normalizeLocale, t } from '@mim/i18n';
// 仅类型导入：语言枚举
import type { Locale } from '@mim/i18n';
// api 命名空间、会话读写工具、会话变更事件与启动静默校验
import {
  api, // 业务接口集合：退出登录时调用 logout
  clearSession, // 清空本地会话并广播登出
  ensureGuestSession, // 免登录体验：本地无会话时自动领匿名访客会话
  getSession, // 读取当前内存会话
  setSession, // 登录成功后持久化会话并广播登录态
  verifySession, // 用 /me 静默校验本地会话是否仍有效
  SESSION_CHANGED_EVENT, // 登录 / 退出 / 失效 / 跨标签页同步的统一事件名
} from './api';
// 仅类型导入：登录结果、会话、会话变更原因、用户信息与语言配置结构
import type { I18nSettings, LoginResult, Session, SessionChangeReason, UserInfo } from './api';
// 本地新增界面文案字典（收银台 / 播放器 / 分享 / 语言切换）
import { tr } from './lib/messages';
// 登录页组件：按需登录统一入口，体积小保持 eager 引入
import { Login } from './views/Login';
// 公告置顶条：轻量组件，随首屏加载
import { AnnouncementBar } from './components/AnnouncementBar';
// 外观解析与 CSS 变量注入：主题色 / 圆角 / 字体 / 列表样式 / 导航配置
import { DEFAULT_THEME, applyThemeVars, mergeNavItems, resolveTheme } from './appearance';
import type { ResolvedTheme } from './appearance'; // 引入依赖、类型或本地模块绑定
import { APP_VERSION } from './version'; // 当前 semver：由构建期 package.json 注入

// 路由级懒加载：每个视图独立 chunk，进入对应路由时才下载执行；命名导出经 then 适配为默认导出
const Store = lazy(() => import('./views/Store').then((m) => ({ default: m.Store }))); // 功能模块页（商城目录）
const Products = lazy(() => import('./views/Products').then((m) => ({ default: m.Products }))); // 商品列表
const Cart = lazy(() => import('./views/Cart').then((m) => ({ default: m.Cart }))); // 购物车
const Profile = lazy(() => import('./views/Profile').then((m) => ({ default: m.Profile }))); // 个人中心
const Sites = lazy(() => import('./views/Sites').then((m) => ({ default: m.Sites }))); // 统一入口配置清单
const Deployments = lazy(() => import('./views/Deployments').then((m) => ({ default: m.Deployments }))); // 部署汇总
const Navigation = lazy(() => import('./views/Navigation').then((m) => ({ default: m.Navigation }))); // 导航站
const Search = lazy(() => import('./views/Search').then((m) => ({ default: m.Search }))); // 统一搜索
const Community = lazy(() => import('./views/Community').then((m) => ({ default: m.Community }))); // 社区与变现
const CommerceCenter = lazy(() => import('./views/CommerceCenter').then((m) => ({ default: m.CommerceCenter }))); // 商业化中台
const ComicStudio = lazy(() => import('./views/ComicStudio').then((m) => ({ default: m.ComicStudio }))); // 漫剧 AI 剧模块
const Chat = lazy(() => import('./views/Chat').then((m) => ({ default: m.Chat }))); // IM 聊天 + 视频通话
const ChatPreview = lazy(() => import('./views/ChatPreview').then((m) => ({ default: m.ChatPreview }))); // 聊天只读演示
const Tools = lazy(() => import('./views/Tools').then((m) => ({ default: m.Tools }))); // 自研工具发布目录
const ContentHub = lazy(() => import('./views/ContentHub').then((m) => ({ default: m.ContentHub }))); // 公告 / 更新日志 / 推广计划栏目
const Releases = lazy(() => import('./views/Releases').then((m) => ({ default: m.Releases }))); // 版本迭代：时间线 + 能力地图
const Circles = lazy(() => import('./views/Circles').then((m) => ({ default: m.Circles }))); // 圈子：成员制社群（与板块独立）
// 零依赖路径路由：把 /<view> 单段路径映射到对应视图，刷新、直达深链接与前进后退均可用（旧 #/<view> 链接自动改写为路径形式）
import { useAppRoute, baseOf } from './router'; // 路径路由 hook：地址栏 /<view> 驱动视图切换
// 仅类型导入：视图标识（新增视图必须同步 navItems 与下方渲染分支）
import type { AppView } from './router';

// 前台语言本地兜底键：后端语言配置不可用 / 无后台写权限时，把前台偏好落到本地
const FRONT_LOCALE_KEY = 'mim.locale.front';

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

// 免登录体验：全站不再有「此功能需登录后使用」的门禁集合。
// 匿名访客进入站点时后端自动签发一个访客会话（POST /auth/guest），
// 商城下单、购物车、个人中心、聊天、漫剧工作台等全部按已登录路径工作；
// 访客可随时登录 / 注册，把身份升级为正式账号。

// 应用根组件：所有视图免登录可用（访客会话自动建立），登录仅用于把身份升级为正式账号
export function App() {
  // 会话状态：初始值从 localStorage 恢复（api.ts 已做结构校验），实现刷新后保持登录
  const [session, setLocalSession] = useState<Session | null>(getSession());
  // 当前视图由地址栏路径驱动（对外路径段为模块功能名称，如 /marketplace）：根路径与未知路径经 parseLocation 回落到商城
  const [route, go] = useAppRoute(); // go 为统一跳转入口，所有导航按钮都改用它（pushState 写入 /<模块功能名>）
  // 登录提示：null 默认无提示，expired 为登录态失效后的重登说明（免登录体验下不再有「需登录」提示）
  const [gateNotice, setGateNotice] = useState<'expired' | null>(null);
  // 外观主题：后台下发配置清洗后的设计令牌；接口不可达或脏数据时回落默认外观，不白屏
  const [theme, setTheme] = useState<ResolvedTheme>(DEFAULT_THEME);

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
      applyThemeVars(resolved); // 写入 :root CSS 变量与数据集
    }).catch(() => {
      if (!alive) return; // 条件分支：按判断结果选择后续处理路径
      setTheme(DEFAULT_THEME); // 离线 / 配置缺失：回落默认外观
      applyThemeVars(DEFAULT_THEME); // 同步注入默认令牌，避免首帧停留在 CSS 兜底色
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

  // 免登录体验：本地没有会话时自动向后端领一个匿名访客会话，全站立即进入可用态
  useEffect(() => {
    if (getSession()) return; // 已有会话（正式账号或访客）无需再建号
    let cancelled = false; // 组件卸载后不再改状态，避免卸载后 setState 警告
    void ensureGuestSession().then((ok) => { // 执行当前业务步骤
      if (cancelled || !ok) return; // 建号失败（离线 / 限流）保留只读降级界面，可由用户点击重试
      setLocalSession(getSession()); // 会话已由 ensureGuestSession 写入内存与 localStorage
    }); // then 结束
    return () => { // 返回当前函数的处理结果
      cancelled = true; // 标记已卸载
    }; // 清理函数结束
  }, []); // 仅挂载时尝试一次，登录成功后会走会话变更事件

  // 登录成功回调：持久化会话并清除登录提示；保留原 hash 让直达内页的用户原地解锁
  function handleLogin(result: LoginResult) {
    // 写会话到 localStorage 并广播（Login 内部已写一次，此处幂等覆盖）
    setSession(result);
    // 同步内存会话，触发主布局按已登录态重渲染
    setLocalSession(result);
    // 登录成功后清除登录提示
    setGateNotice(null);
    // login 伪视图仅作登录中转，成功后回默认页；其余 hash 原地解锁
    if (route.view === 'login') go({ view: 'store' });
  } // handleLogin 结束

  // 退出登录：先尽力调用后端登出，再清理本地会话并回到匿名可浏览的商城页
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
    // 退出后回到商城页：匿名可浏览，刷新与回退均安全
    go({ view: 'store' });
  } // handleLogout 结束

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

  // 访客会话建立失败后的重试入口：离线恢复或限流窗口过后可再触发一次，保证功能可用
  function retryGuestSession() { // 无返回值，仅驱动界面状态
    void ensureGuestSession().then((ok) => { // 重新领访客会话
      if (ok) setLocalSession(getSession()); // 成功后同步界面会话
    }); // then 结束
  } // retryGuestSession 结束

  // 内置导航项：顺序即展示顺序；后台配置的 nav_items 按 view 覆盖文案 / 显隐，未覆盖的内置项原样保留。
  // 2026-11-13 导航收口（16 项一级 → 12 项平铺，无分组标题）：把「同一件事的第二个入口」收进上级，
  // 页面与路由全部保留（直链 / 搜索 / 站内跳转仍可达），只是不再各占一行侧栏。
  const navDefaults: Array<{ view: AppView; label: string; hidden?: boolean }> = [
    // 商城：功能模块目录（分类 + 卡片 + 详情面板）
    { view: 'store', label: locale === 'en-US' ? 'Store' : '商城' },
    // 商品列表（原一级入口）：密集列表 + 加购，与「商城」同一批商品的另一种视图 → 合并进商城（hidden）
    { view: 'products', label: locale === 'en-US' ? 'Products' : '商品列表', hidden: true },
    // 购物车：待购模块与结算
    { view: 'cart', label: locale === 'en-US' ? 'Cart' : '购物车' },
    // 个人中心：资料 / 权益 / 订单 / 账号与设置
    { view: 'account', label: locale === 'en-US' ? 'Account' : '个人中心' },
    // 社区：论坛 / 付费阅读 / VIP / 钱包 / 独立商城 / 推广；「圈子」为其成员制板块
    { view: 'community', label: locale === 'en-US' ? 'Community' : '社区' },
    // 圈子（原一级入口）：成员制社群，已并入社区页的「圈子」板块 → hidden
    { view: 'circles', label: locale === 'en-US' ? 'Circles' : '圈子', hidden: true },
    // 漫剧 AI 剧工作台
    { view: 'comic', label: locale === 'en-US' ? 'Comic Studio' : '漫剧 AI 剧' },
    // IM 聊天 + 视频通话
    { view: 'chat', label: locale === 'en-US' ? 'Chat' : '聊天' },
    // 商业化中台：付费资产 / 交易履约 / 资金分成 / 外观页面 / 成长国际化
    { view: 'commerce', label: locale === 'en-US' ? 'Commerce' : '商业化中台' },
    // 导航站：全站资源目录 + 可达性状态 + 推荐位
    { view: 'navigation', label: locale === 'en-US' ? 'Navigation' : '导航站' },
    // 入口配置清单（原一级入口）：44 个入口的模块目录，已并入导航站的「入口清单」板块 → hidden
    { view: 'sites', label: locale === 'en-US' ? 'Entry Catalog' : '入口配置清单', hidden: true },
    // 部署汇总（原一级入口）：部署仓库 / 部署项核对表，已并入版本页的「部署汇总」板块 → hidden
    { view: 'deployments', label: locale === 'en-US' ? 'Deployments' : '部署汇总', hidden: true },
    // 统一搜索：模块 / 入口 / 导航 / 社区 / 商品一站检索
    { view: 'search', label: locale === 'en-US' ? 'Search' : '统一搜索' },
    // 版本迭代：把 V0.0.0 → 当前版本的完整时间线与能力地图放到前台
    { view: 'releases', label: locale === 'en-US' ? `Releases V${APP_VERSION}` : `版本 V${APP_VERSION}` },
    // 自研工具发布目录：插件 / 脚本 / 防护工具
    { view: 'tools', label: locale === 'en-US' ? 'Tools' : '自研工具' },
    // 公告 / 更新日志 / 推广计划栏目
    { view: 'content', label: locale === 'en-US' ? 'News' : '公告动态' },
  ]; // 内置导航项定义结束
  // 合并后台导航配置：未知视图忽略，显隐与文案以后台配置为准，缺省回落内置项；
  // hidden 项是「已合并进上级」的二级入口，页面保留但不上侧栏（后台显式配置 visible 不能把它强行拉回）
  const navItems = mergeNavItems(navDefaults, theme.navItems).filter((item) => item.visible && !item.hidden);
  // 隐藏的二级入口落到哪个一级入口：用于「在 /products 时侧栏仍高亮商城」。
  // 没有这张表时，隐藏页面的 route.view 不在侧栏里，active 计数为 0，用户会以为"没选中任何页面"。
  const SUB_VIEW_PARENT: Partial<Record<AppView, AppView>> = {
    products: 'store', // 商品列表 → 商城
    circles: 'community', // 圈子 → 社区
    sites: 'navigation', // 入口配置清单 → 导航站
    deployments: 'releases', // 部署汇总 → 版本
  }; // 二级 → 一级映射结束
  // 侧栏高亮依据：当前在隐藏二级页时按上级高亮，其余按自身
  const activeNavView: AppView = SUB_VIEW_PARENT[route.view] ?? route.view;
  // 合并后的二级入口：被收进上级的那几个页面不再占侧栏，但在上级页顶部给一条直达条，
  // 且从二级页也能一键回到上级，保证「合并」不会把入口变没（2026-11-13 导航收口配套）
  const subEntries: Array<{ view: AppView; label: string }> =
    route.view === 'store'
      ? [{ view: 'products', label: locale === 'en-US' ? 'Product list view' : '商品列表（列表视图）' }]
      : route.view === 'products'
        ? [{ view: 'store', label: locale === 'en-US' ? 'Back to Store' : '返回商城' }]
        : route.view === 'community'
          ? [{ view: 'circles', label: locale === 'en-US' ? 'Circles' : '圈子（成员制社群）' }]
          : route.view === 'circles'
            ? [{ view: 'community', label: locale === 'en-US' ? 'Back to Community' : '返回社区' }]
            : route.view === 'navigation'
              ? [{ view: 'sites', label: locale === 'en-US' ? 'Entry catalog' : '入口配置清单（44 个入口）' }]
              : route.view === 'sites'
                ? [{ view: 'navigation', label: locale === 'en-US' ? 'Back to Navigation' : '返回导航站' }]
                : route.view === 'releases'
                  ? [{ view: 'deployments', label: locale === 'en-US' ? 'Deployments' : '部署汇总（12 个部署项）' }]
                  : route.view === 'deployments'
                    ? [{ view: 'releases', label: locale === 'en-US' ? 'Back to Releases' : '返回版本' }]
                    : [];

  // 主布局：左侧栏 + 右侧内容区；访客与正式账号共用同一骨架，登录只用于升级身份
  const needsSession =
    route.view === 'products' ||
    route.view === 'cart' ||
    route.view === 'account' ||
    route.view === 'community' ||
    route.view === 'commerce'; // 商业化中台接口需要令牌（访客会话同样可用）

  // 主布局：左侧栏 + 右侧内容区；匿名与已登录共用同一骨架，仅内容区与底部操作不同
  return (
    // 布局容器：data-list-style 把后台列表样式口径透传给列表变体选择器
    <div className="layout" data-list-style={theme.listStyle} data-nav-layout={theme.navLayout}>
      {/* 公告置顶条：无置顶公告时组件自身静默不渲染 */}
      <AnnouncementBar locale={locale} onOpen={() => go({ view: 'content' })} />
      {/* 左侧导航栏 */}
      <aside className="sidebar">{/* 侧边栏：品牌 + 导航 + 底部用户区 */}
        {/* 品牌区：仅保留应用名（旧定位标语已按用户指令于 2026-11-10 删除） */}
        <div className="brand">{/* 品牌区：应用名单独成组 */}
          {/* 应用名（i18n） */}
          <span className="brand-name">{t(locale, 'app.name')}</span>{/* 应用名，走 i18n 词典 */}
        </div>{/* 品牌区结束 */}
        {/* 导航按钮列表 */}
        <nav className="nav">{/* 导航容器：按钮由 navItems 顺序决定 */}
          {/* 遍历导航项：12 项平铺，不再渲染分组标题 */}
          {navItems.map((item) => (
            <button
              // 导航项唯一键
              key={item.view}
              // 普通按钮
              type="button"
              // 当前视图高亮 active
              className={`nav-item${activeNavView === item.view ? ' active' : ''}`}
              // 点击切换视图（配置视图已在合并阶段按内置白名单收敛）
              onClick={() => go({ view: item.view as AppView })}
            >
              {/* 导航文案 */}
              {item.label}{/* 导航文案，随语言切换 */}
            </button> // 单个导航按钮结束，回到 map 回调的表达式内部
          ))}{/* 导航项遍历结束 */}
        </nav>{/* 导航容器结束 */}
        {/* 侧边栏底部：已登录显示用户区与退出，匿名显示登录入口 */}
        <div className="sidebar-footer">{/* 吸底容器：margin-top:auto 把它推到侧栏底部 */}
          {session ? ( // 有会话分支（访客或正式账号）：显示身份 + 登录升级 / 退出
            <>{/* 执行当前业务步骤 */}
              {/* 显示名，缺失时回退到 id 前 8 位 */}
              <span className="user-name">{session.user.display_name || session.user.id.slice(0, 8)}</span>{/* 显示名，缺失时回退到 id 前 8 位 */}
              {/* 身份标识：访客显式标注「免登录」，正式账号显示区域 */}
              <span className="user-region">{session.user.is_guest ? (locale === 'en-US' ? 'Guest · no sign-in' : '访客 · 免登录') : session.user.region === 'cn' ? '中国区' : 'Global'}</span>{/* 身份标识结束 */}
              {session.user.is_guest ? ( // 访客分支：不提供退出（退出后会立刻再建访客），改为登录升级入口
                <button type="button" className="btn primary block" onClick={() => go({ view: 'login' })}>{/* 登录 / 注册升级按钮 */}
                  {locale === 'en-US' ? 'Sign in / Sign up' : '登录 / 注册正式账号'}{/* 升级文案 */}
                </button> // 升级按钮结束
              ) : ( // 正式账号分支：正常退出登录
                <button type="button" className="btn ghost block" onClick={handleLogout}>{/* 退出登录按钮 */}
                  {t(locale, 'action.logout')}{/* 退出文案，走 i18n 词典 */}
                </button> // 退出按钮结束
              )}{/* 身份分支结束 */}
            </> // 有会话分支结束
          ) : ( // 会话尚未建立分支：提供登录入口，同时自动建号正在后台进行
            <button type="button" className="btn primary block" onClick={() => go({ view: 'login' })}>{/* 登录入口按钮 */}
              {locale === 'en-US' ? 'Sign in' : '登录'}{/* 登录按钮文案，随语言切换 */}
            </button> // 登录入口按钮结束
          )}{/* 底部按登录态分支结束 */}
        </div>{/* 侧边栏底部结束 */}
      </aside>{/* 侧边栏结束 */}

      {/* 右侧内容区：商城匿名可浏览；收费 / 私密视图匿名时内嵌登录卡片 */}
      <main className="main">{/* 内容区容器：窄屏断点下与侧栏上下堆叠 */}
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
        {/* 功能模块页：匿名可浏览目录，解锁动作在页面内引导登录 */}
        {route.view === 'store' && <Store locale={locale} />}{/* 功能模块页 */}
        {/* 商品列表：密集列表 + 筛选 + 加购，仅已登录渲染（匿名由上方内嵌登录卡片接管） */}
        {route.view === 'products' && session && <Products locale={locale} />}{/* 商品列表 */}
        {/* 购物车：清单 / 移除 / 清空 / 结算，仅已登录渲染 */}
        {route.view === 'cart' && session && <Cart locale={locale} />}{/* 购物车 */}
        {/* 个人中心：资料 / 权益 / 订单 / 账号安全，仅已登录渲染 */}
        {route.view === 'account' && session && (
          <Profile locale={locale} onUserUpdated={handleUserUpdated} /> // 个人中心：资料保存后同步全局用户态
        )}{/* 个人中心表达式容器结束 */}
        {/* 统一入口配置清单：44 个入口驱动的模块目录，访客会话免登录可浏览 */}
        {route.view === 'sites' && <Sites locale={locale} onOpenView={(view) => go({ view })} />}{/* 站点模块矩阵：清单内的跳转由 App 统一注入 */}
        {/* 部署汇总：统一字段展示所有部署仓库与部署项的效果 / 结果 / 异常 */}
        {route.view === 'deployments' && <Deployments locale={locale} />}{/* 部署汇总 */}
        {route.view === 'navigation' && <Navigation locale={locale} />}{/* 导航站：目录 + 可达性 + 推荐位 */}
        {/* 统一搜索：浏览公开，不需要会话；结果按来源分组 */}
        {route.view === 'search' && <Search locale={locale} />}{/* 统一搜索视图 */}
        {/* 社区与变现：论坛 / 付费阅读 / VIP / 钱包 / 独立商城 / 推广，访客会话建立后直接可用 */}
        {route.view === 'community' && session && <Community locale={locale} />}{/* 社区与变现视图 */}
        {/* 商业化中台：付费资产 / 履约 / 提现分成 / 页面搭建 / 成长私信 / 翻译 */}
        {route.view === 'commerce' && session && <CommerceCenter locale={locale} />}{/* 商业化中台视图 */}
        {/* 自研工具发布目录：公开浏览，管理端增删改在视图内按会话态展示 */}
        {route.view === 'tools' && <Tools locale={locale} hasSession={!!session} />}{/* 工具目录视图 */}
        {/* 公告 / 更新日志 / 推广计划栏目：公开只读，空数据静默隐藏；会话态展示管理端 CRUD */}
        {route.view === 'content' && <ContentHub locale={locale} hasSession={!!session} />}{/* 内容栏目视图 */}
        {/* 版本迭代：完整版本时间线 + 能力地图，公开可看 */}
        {route.view === 'releases' && <Releases locale={locale} onOpen={(view) => go({ view })} />}{/* 版本迭代视图 */}
        {/* 圈子：公开浏览清单；加入 / 审核 / 发动态公告在视图内按会话态与角色展示 */}
        {route.view === 'circles' && <Circles locale={locale} hasSession={!!session} />}{/* 圈子视图 */}
        {/* 收费 / 私密视图（商品列表 / 购物车 / 个人中心）：访客会话建立后直接可用，无需登录 */}
        {needsSession && !session && ( // 会话尚未就绪（通常只在离线或建号失败时出现）
          <div className="page">{/* 降级占位：说明正在建立免登录会话并提供重试 */}
            <p className="hint">{locale === 'en-US' ? 'Setting up your anonymous session…' : '正在建立免登录会话…'}</p>{/* 状态说明 */}
            <button type="button" className="btn ghost" onClick={retryGuestSession}>{/* 重试按钮 */}
              {locale === 'en-US' ? 'Retry' : '重试'}{/* 重试文案 */}
            </button> // 重试按钮结束
          </div> // 占位容器结束
        )}{/* 会话就绪占位结束 */}
        {/* 漫剧 AI 剧模块：放映厅匿名可看片，创作工作台在模块内按需登录 */}
        {route.view === 'comic' && (
          <ComicStudio locale={locale} hasSession={!!session} onSignIn={() => go({ view: 'login' })} />
        )}{/* 漫剧模块渲染结束 */}
        {/* IM 聊天 + 视频通话：会话列表 + 消息 + 视频通话，仅已登录渲染 */}
        {route.view === 'chat' && session && <Chat locale={locale} />}{/* 聊天视图 */}
        {/* 匿名聊天只读演示：展示完整聊天布局与示例消息，输入区禁用，登录后才可收发 */}
        {route.view === 'chat' && !session && (
          <ChatPreview locale={locale} onSignIn={() => go({ view: 'login' })} /> // 只读演示，登录引导回到登录视图
        )}{/* 匿名聊天演示结束 */}
        {/* 登录伪视图：访客（含免登录访客）可在此登录或注册，把身份升级为正式账号 */}
        {route.view === 'login' && (!session || session.user.is_guest) && (
          <Login embedded onLogin={handleLogin} notice={gateNotice} /> // 登录 / 注册入口
        )}{/* 登录伪视图结束 */}
        {/* 登录伪视图：正式账号已登录时提示无需重复登录 */}
        {route.view === 'login' && session && !session.user.is_guest && (
          <div className="page"><p className="hint">{locale === 'en-US' ? 'Already signed in.' : '当前已登录，无需重复登录。'}</p></div> // 已登录提示
        )}{/* 已登录登录伪视图结束 */}
        </Suspense>{/* 懒加载边界结束 */}
      </main>{/* 内容区结束 */}
    </div> // 布局容器结束，JSX 根元素到此闭合
  ); // 主布局渲染结束
} // App 组件结束

// 重新导出 Locale 类型，便于其他模块从 App.tsx 引入
export type { Locale };
