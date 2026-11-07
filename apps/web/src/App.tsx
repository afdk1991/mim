// React 状态钩子：会话与当前视图
import { useState } from 'react';
// i18n 工具：语言归一化与文案取值
import { normalizeLocale, t } from '@mim/i18n';
// 仅类型导入：语言枚举
import type { Locale } from '@mim/i18n';
// api 命名空间与会话读写工具
import { api, clearSession, getSession, setSession } from './api';
// 仅类型导入：登录结果、会话与用户信息结构
import type { LoginResult, Session, UserInfo } from './api';
// 登录页组件（未登录时渲染）
import { Login } from './views/Login';
// 设置页组件
import { Settings } from './views/Settings';
// 功能模块页（原「商店」视图，展示 Mim 功能模块列表）
import { Store } from './views/Store';
// 漫剧 AI 剧工作台
import { ComicWorkbench } from './views/ComicWorkbench';
// IM 聊天 + 视频通话
import { Chat } from './views/Chat';
// 站点地图：DNSPod 备注结构化的站点模块视图
import { SiteMap } from './views/SiteMap';
// 站点目录：按 8 分类列出的 45 个可运行节点导航
import { SiteDirectory } from './views/SiteDirectory';
// 单节点模块页：路由 / 导航 / 职责 / 域名映射 / 关联节点
import { SiteNodePage } from './views/SiteNodePage';
// 无依赖 hash 路由：把 #/site/<key> 映射到节点模块页，刷新与前进后退均可用
import { useHashRoute } from './router';
// 仅类型导入：视图标识（新增视图必须同步 navItems 与下方渲染分支）
import type { AppView } from './router';

// 应用根组件
export function App() {
  // 会话状态：初始值从 localStorage 恢复，实现刷新后保持登录
  const [session, setLocalSession] = useState<Session | null>(getSession());
  // 当前视图由地址栏 hash 驱动：无 hash 时 parseHash 回落到功能模块页
  const [route, go] = useHashRoute(); // go 为统一跳转入口，所有导航按钮都改用它

  // 界面语言：已登录取用户偏好并归一化；未登录传 undefined，自动回退默认语言
  const locale: Locale = normalizeLocale(session?.user.locale);
  // 当前视图是否需登录：漫剧、聊天与设置涉及用户数据，未登录时内容区改为内嵌登录卡片
  const needsAuth = route.view === 'comic' || route.view === 'chat' || route.view === 'settings';

  // 登录成功回调：持久化会话；login 伪视图回功能模块页，受保护视图内嵌登录则原地解锁
  function handleLogin(result: LoginResult) {
    // 写会话到 localStorage（Login 内部已写一次，此处幂等覆盖，保证内存与磁盘一致）
    setSession(result);
    // 同步内存会话，触发已登录布局重渲染
    setLocalSession(result);
    // login 伪视图仅作登录中转，成功后回默认页；其余情形停留原视图
    if (route.view === 'login') go({ view: 'store' });
  } // handleLogin 结束

  // 退出登录：先尽力调用后端登出，再清理本地会话
  async function handleLogout() {
    // try 包住远端登出：网络或鉴权失败都不应阻塞本地清理
    try {
      // 通知后端注销当前 token
      await api.logout();
    } catch { // 捕获任何异常：登出属于尽力而为，失败也继续本地清理
      /* 退出登录时的网络失败不阻塞本地清理 */
    }
    // 清理 localStorage 中的会话
    clearSession();
    // 清空内存会话，界面退回访客态
    setLocalSession(null);
    // 退出后回到公开的功能模块页，避免停留在需登录的视图上
    go({ view: 'store' });
  } // handleLogout 结束

  // 设置页更新用户信息后的回调：替换会话中的 user 并持久化
  function handleUserUpdated(next: UserInfo) {
    // 保留原 token 等字段，仅替换 user
    const updated: Session = { ...session!, user: next };
    // 写入 localStorage
    setSession(updated);
    // 同步内存状态
    setLocalSession(updated);
  } // handleUserUpdated 结束

  // 节点模块页（#/site/<key>）由站点目录进入，侧栏高亮回落到 directory，避免出现「无 active」的空导航状态
  const activeView: AppView = route.view === 'node' ? 'directory' : route.view; // 单一映射点，前后台导航状态一致
  // 侧边导航项：顺序即展示顺序（功能模块 → 漫剧 → 站点地图 → 站点目录 → 设置）
  const navItems: Array<{ view: AppView; label: string }> = [
    // 功能模块页
    { view: 'store', label: locale === 'en-US' ? 'Modules' : '功能模块' },
    // 漫剧 AI 剧工作台
    { view: 'comic', label: locale === 'en-US' ? 'Comic Studio' : '漫剧 AI 剧' },
    // IM 聊天 + 视频通话
    { view: 'chat', label: locale === 'en-US' ? 'Chat' : '聊天' },
    // 站点地图（DNSPod 备注结构化视图）
    { view: 'sitemap', label: locale === 'en-US' ? 'Site Map' : '站点地图' },
    // 站点目录：45 个可运行节点的分类导航入口（站点地图每个节点均可跳入）
    { view: 'directory', label: locale === 'en-US' ? 'Site Directory' : '站点目录' },
    // 设置页，文案走 i18n 词典
    { view: 'settings', label: t(locale, 'nav.settings') },
  ]; // 导航项定义结束，数组顺序即侧栏展示顺序

  // 主布局常渲染：左侧栏 + 右侧内容区；登录与否只影响侧栏底部与受保护视图的内容
  return (
    // 布局容器
    <div className="layout">
      {/* 左侧导航栏 */}
      <aside className="sidebar">{/* 侧边栏：品牌 + 导航 + 底部用户区 */}
        {/* 品牌区：应用名 + 标语 */}
        <div className="brand">{/* 品牌区：应用名与标语纵向成组 */}
          {/* 应用名（i18n） */}
          <span className="brand-name">{t(locale, 'app.name')}</span>{/* 应用名，走 i18n 词典 */}
          {/* 应用标语（i18n） */}
          <span className="brand-tagline">{t(locale, 'app.tagline')}</span>{/* 应用标语，随语言切换 */}
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
              // 当前视图高亮 active；节点页统一按 activeView 回落到站点目录
              className={`nav-item${activeView === item.view ? ' active' : ''}`}
              // 点击切换视图
              onClick={() => go({ view: item.view })}
            >
              {/* 导航文案 */}
              {item.label}{/* 导航文案，随语言切换 */}
            </button> // 单个导航按钮结束，回到 map 回调的表达式内部
          ))}{/* 导航项遍历结束 */}
        </nav>{/* 导航容器结束 */}
        {/* 侧边栏底部：已登录显示用户区与退出；未登录显示访客标识与登录入口 */}
        <div className="sidebar-footer">{/* 吸底容器：margin-top:auto 把它推到侧栏底部 */}
          {session ? ( // 已登录分支：用户信息 + 退出按钮
            <>
              {/* 显示名，缺失时回退到 id 前 8 位 */}
              <span className="user-name">{session.user.display_name || session.user.id.slice(0, 8)}</span>{/* 显示名，缺失时回退到 id 前 8 位 */}
              {/* 区域标识 */}
              <span className="user-region">{session.user.region === 'cn' ? '中国区' : 'Global'}</span>{/* 区域标识：cn 显示中国区，其余显示 Global */}
              {/* 退出登录按钮 */}
              <button type="button" className="btn ghost block" onClick={handleLogout}>{/* 退出登录按钮：点击后走 handleLogout */}
                {/* 退出文案（i18n） */}
                {t(locale, 'action.logout')}{/* 退出文案，走 i18n 词典 */}
              </button>{/* 退出按钮结束 */}
            </>
          ) : ( // 访客分支：访客标识 + 登录入口按钮
            <>
              {/* 访客标识：未登录时替代用户名展示 */}
              <span className="user-name">{locale === 'en-US' ? 'Guest' : '未登录'}</span>{/* 访客文案，随语言切换 */}
              {/* 登录入口：进入 login 伪视图，不污染导航高亮 */}
              <button type="button" className="btn primary block" onClick={() => go({ view: 'login' })}>{/* 登录按钮：点击切到 login 伪视图 */}
                {/* 登录文案（复用 auth.login 词条） */}
                {t(locale, 'auth.login')}{/* 登录文案，走 i18n 词典 */}
              </button>{/* 登录按钮结束 */}
            </>
          )}{/* 已登录 / 访客分支结束 */}
        </div>{/* 侧边栏底部结束 */}
      </aside>{/* 侧边栏结束 */}

      {/* 右侧内容区：按当前视图渲染对应页面 */}
      <main className="main">{/* 内容区容器：窄屏断点下与侧栏上下堆叠 */}
        {/* 功能模块页：公开视图，匿名可浏览（解锁操作在 Store 内按会话显隐） */}
        {route.view === 'store' && <Store locale={locale} />}{/* 功能模块页：展示 Mim 能力模块列表 */}
        {/* 站点地图：公开视图，后端 /site/* 接口全部免鉴权 */}
        {route.view === 'sitemap' && <SiteMap locale={locale} />}{/* 站点地图：DNSPod 备注结构化视图 */}
        {/* 站点目录：8 分类 / 45 节点，每个节点都是可点击的 #/site/<key> 入口 */}
        {route.view === 'directory' && <SiteDirectory locale={locale} />}{/* 站点目录：节点导航 */}
        {/* 单节点模块页：按 routeKey 渲染职责、域名映射与关联节点 */}
        {route.view === 'node' && <SiteNodePage locale={locale} routeKey={route.key ?? ''} />}{/* 节点模块页 */}
        {/* 漫剧 AI 剧工作台：仅已登录渲染，未登录由下方内嵌登录兜底 */}
        {route.view === 'comic' && session && <ComicWorkbench locale={locale} />}{/* 漫剧 AI 剧工作台：分镜与剧集编辑 */}
        {/* IM 聊天 + 视频通话：仅已登录渲染，需 WebSocket 连接 */}
        {route.view === 'chat' && session && <Chat locale={locale} />}{/* 聊天视图：会话列表 + 消息 + 视频通话 */}
        {/* 设置页：仅已登录渲染，需要用户更新回调 */}
        {route.view === 'settings' && session && (
          <Settings locale={locale} onUserUpdated={handleUserUpdated} /> // 设置页：传入用户信息更新回调
        )}{/* 设置页表达式容器结束 */}
        {/* 未登录访问受保护视图：内容区内嵌登录卡片并给出提示，登录成功后原地解锁 */}
        {!session && needsAuth && (
          <div>{/* 内嵌登录容器：提示 + 登录卡片 */}
            {/* 登录提示：说明当前视图需要登录 */}
            <p className="hint">{locale === 'en-US' ? 'Sign in to use this section.' : '该功能需登录后使用，请先登录。'}</p>{/* 提示文案，随语言切换 */}
            {/* 内嵌登录：embedded 去掉整屏背景与最小高度 */}
            <Login embedded onLogin={handleLogin} />{/* 登录成功走 handleLogin，原地解锁当前视图 */}
          </div> // 内嵌登录容器结束
        )}{/* 受保护视图门禁分支结束 */}
        {/* login 伪视图：未登录时由侧栏「登录」按钮进入，无额外提示 */}
        {!session && route.view === 'login' && <Login embedded onLogin={handleLogin} />}{/* 伪视图登录成功后回功能模块页 */}
      </main>{/* 内容区结束 */}
    </div> // 布局容器结束，JSX 根元素到此闭合
  ); // 主布局渲染结束
} // App 组件结束

// 重新导出 Locale 类型，便于其他模块从 App.tsx 引入
export type { Locale };
