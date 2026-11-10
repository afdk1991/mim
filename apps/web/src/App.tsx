// React 状态与副作用钩子：会话状态、登录提示与启动静默校验
import { useEffect, useState } from 'react';
// i18n 工具：语言归一化与文案取值
import { normalizeLocale, t } from '@mim/i18n';
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
// 仅类型导入：登录结果、会话、会话变更原因与用户信息结构
import type { LoginResult, Session, SessionChangeReason, UserInfo } from './api';
// 登录页组件：按需登录统一入口，支持整屏与内嵌两种形态
import { Login } from './views/Login';
// 设置页组件
import { Settings } from './views/Settings';
// 功能模块页（商城目录，匿名可浏览，解锁动作才要求登录）
import { Store } from './views/Store';
// 站点模块矩阵：45 类备注驱动的模块目录，浏览匿名可访问，写操作才引导登录
import { Sites } from './views/Sites';
// 部署汇总：所有部署仓库 / 部署项的状态、结果与异常，浏览匿名可访问
import { Deployments } from './views/Deployments';
// 漫剧 AI 剧工作台
import { ComicWorkbench } from './views/ComicWorkbench';
// IM 聊天 + 视频通话
import { Chat } from './views/Chat';
// 零依赖路径路由：把 /<view> 单段路径映射到对应视图，刷新、直达深链接与前进后退均可用（旧 #/<view> 链接自动改写为路径形式）
import { useAppRoute } from './router'; // 路径路由 hook：地址栏 /<view> 驱动视图切换
// 仅类型导入：视图标识（新增视图必须同步 navItems 与下方渲染分支）
import type { AppView } from './router';

// 需登录方可使用的视图集合：均为收费或私密功能；匿名访问时在内容区内嵌登录卡片而非整站锁定
const GATED_VIEWS: ReadonlySet<AppView> = new Set(['comic', 'chat', 'settings']); // 商城目录保持匿名可浏览

// 应用根组件：浏览类页面匿名可访问，仅使用收费功能模块时才要求登录（按需登录）
export function App() {
  // 会话状态：初始值从 localStorage 恢复（api.ts 已做结构校验），实现刷新后保持登录
  const [session, setLocalSession] = useState<Session | null>(getSession());
  // 当前视图由地址栏路径驱动（/store 等单段路径）：根路径与未知路径经 parseLocation 回落到功能模块页
  const [route, go] = useAppRoute(); // go 为统一跳转入口，所有导航按钮都改用它（pushState 写入 /<view>）
  // 登录提示：null 默认无提示，expired 为登录态失效后的重登说明，required 为访问收费功能时的登录说明
  const [gateNotice, setGateNotice] = useState<'required' | 'expired' | null>(null);

  // 界面语言：已登录取用户偏好并归一化；未登录传 undefined，自动回退默认语言
  const locale: Locale = normalizeLocale(session?.user.locale);

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

  // 侧边导航项：顺序即展示顺序（商城 → 站点矩阵 → 部署汇总 → 漫剧 → 聊天 → 设置）；匿名可见，点击收费视图时再要求登录
  const navItems: Array<{ view: AppView; label: string }> = [
    // 功能模块商城（用户习惯称「商城」，导航以「商城」呈现便于查找）
    { view: 'store', label: locale === 'en-US' ? 'Store' : '商城' },
    // 站点模块矩阵：按 45 类备注开发的模块目录
    { view: 'sites', label: locale === 'en-US' ? 'Entry Catalog' : '入口配置清单' },
    // 部署汇总：统一字段核对整体部署情况
    { view: 'deployments', label: locale === 'en-US' ? 'Deployments' : '部署汇总' },
    // 漫剧 AI 剧工作台
    { view: 'comic', label: locale === 'en-US' ? 'Comic Studio' : '漫剧 AI 剧' },
    // IM 聊天 + 视频通话
    { view: 'chat', label: locale === 'en-US' ? 'Chat' : '聊天' },
    // 设置页，文案走 i18n 词典
    { view: 'settings', label: t(locale, 'nav.settings') },
  ]; // 导航项定义结束，数组顺序即侧栏展示顺序

  // 当前视图是否属于收费 / 私密功能：命中集合时匿名访客看到内嵌登录卡片
  const gated = GATED_VIEWS.has(route.view);
  // 内嵌登录卡片展示的提示：失效提示优先，其次收费功能登录说明
  const embeddedNotice: 'required' | 'expired' | null = gateNotice ?? (gated ? 'required' : null);

  // 主布局：左侧栏 + 右侧内容区；匿名与已登录共用同一骨架，仅内容区与底部操作不同
  return (
    // 布局容器
    <div className="layout">
      {/* 左侧导航栏 */}
      <aside className="sidebar">{/* 侧边栏：品牌 + 导航 + 底部用户区 */}
        {/* 品牌区：仅保留应用名，旧「跨端任务与轻协作」标语已按用户指令删除 */}
        <div className="brand">{/* 品牌区：应用名单独成组 */}
          {/* 应用名（i18n） */}
          <span className="brand-name">{t(locale, 'app.name')}</span>{/* 应用名，走 i18n 词典 */}
        </div>{/* 品牌区结束 */}
        {/* 导航按钮列表 */}
        <nav className="nav">{/* 导航容器：按钮由 navItems 顺序决定 */}
          {/* 遍历导航项 */}
          {navItems.map((item) => (
            <button
              // 导航项唯一键
              key={item.view}
              // 普通按钮
              type="button"
              // 当前视图高亮 active
              className={`nav-item${route.view === item.view ? ' active' : ''}`}
              // 点击切换视图
              onClick={() => go({ view: item.view })}
            >
              {/* 导航文案 */}
              {item.label}{/* 导航文案，随语言切换 */}
            </button> // 单个导航按钮结束，回到 map 回调的表达式内部
          ))}{/* 导航项遍历结束 */}
        </nav>{/* 导航容器结束 */}
        {/* 侧边栏底部：已登录显示用户区与退出，匿名显示登录入口 */}
        <div className="sidebar-footer">{/* 吸底容器：margin-top:auto 把它推到侧栏底部 */}
          {session ? ( // 已登录分支：用户信息 + 退出按钮
            <>
              {/* 显示名，缺失时回退到 id 前 8 位 */}
              <span className="user-name">{session.user.display_name || session.user.id.slice(0, 8)}</span>{/* 显示名，缺失时回退到 id 前 8 位 */}
              {/* 区域标识 */}
              <span className="user-region">{session.user.region === 'cn' ? '中国区' : 'Global'}</span>{/* 区域标识：cn 显示中国区，其余显示 Global */}
              {/* 退出登录按钮：点击后清理会话并回到商城页 */}
              <button type="button" className="btn ghost block" onClick={handleLogout}>{/* 退出登录按钮 */}
                {/* 退出文案（i18n） */}
                {t(locale, 'action.logout')}{/* 退出文案，走 i18n 词典 */}
              </button>{/* 退出按钮结束 */}
            </> // 已登录分支结束
          ) : ( // 匿名分支：登录入口按钮
            <button type="button" className="btn primary block" onClick={() => go({ view: 'login' })}>{/* 登录入口按钮 */}
              {locale === 'en-US' ? 'Sign in' : '登录'}{/* 登录按钮文案，随语言切换 */}
            </button> // 登录入口按钮结束
          )}{/* 底部按登录态分支结束 */}
        </div>{/* 侧边栏底部结束 */}
      </aside>{/* 侧边栏结束 */}

      {/* 右侧内容区：商城匿名可浏览；收费 / 私密视图匿名时内嵌登录卡片 */}
      <main className="main">{/* 内容区容器：窄屏断点下与侧栏上下堆叠 */}
        {/* 功能模块页：匿名可浏览目录，解锁动作在页面内引导登录 */}
        {route.view === 'store' && <Store locale={locale} />}{/* 功能模块页 */}
        {/* 站点模块矩阵：45 类备注驱动的模块目录，浏览匿名可访问 */}
        {route.view === 'sites' && <Sites locale={locale} />}{/* 站点模块矩阵 */}
        {/* 部署汇总：统一字段展示所有部署仓库与部署项的效果 / 结果 / 异常 */}
        {route.view === 'deployments' && <Deployments locale={locale} />}{/* 部署汇总 */}
        {/* 收费 / 私密视图（漫剧 / 聊天 / 设置）：匿名访问时以内容区内嵌登录卡片替代 */}
        {gated && !session && (
          <Login embedded onLogin={handleLogin} notice={embeddedNotice} /> // 内嵌登录：保留侧栏导航上下文
        )}{/* 内嵌登录条件渲染结束 */}
        {/* 漫剧 AI 剧工作台：分镜与剧集编辑，仅已登录渲染 */}
        {route.view === 'comic' && session && <ComicWorkbench locale={locale} />}{/* 漫剧 AI 剧工作台 */}
        {/* IM 聊天 + 视频通话：会话列表 + 消息 + 视频通话，仅已登录渲染 */}
        {route.view === 'chat' && session && <Chat locale={locale} />}{/* 聊天视图 */}
        {/* 设置页：需要用户更新回调，仅已登录渲染 */}
        {route.view === 'settings' && session && (
          <Settings locale={locale} onUserUpdated={handleUserUpdated} /> // 设置页：传入用户信息更新回调
        )}{/* 设置页表达式容器结束 */}
        {/* 登录伪视图：匿名时提供独立登录入口 */}
        {route.view === 'login' && !session && (
          <Login embedded onLogin={handleLogin} notice={gateNotice} /> // 独立登录入口：内嵌于主布局
        )}{/* 匿名登录伪视图结束 */}
        {/* 登录伪视图：已登录时提示无需重复登录 */}
        {route.view === 'login' && session && (
          <div className="page"><p className="hint">{locale === 'en-US' ? 'Already signed in.' : '当前已登录，无需重复登录。'}</p></div> // 已登录提示
        )}{/* 已登录登录伪视图结束 */}
      </main>{/* 内容区结束 */}
    </div> // 布局容器结束，JSX 根元素到此闭合
  ); // 主布局渲染结束
} // App 组件结束

// 重新导出 Locale 类型，便于其他模块从 App.tsx 引入
export type { Locale };
