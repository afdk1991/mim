// React 状态钩子：会话与当前视图
import { useState } from 'react';
// i18n 工具：语言归一化与文案取值
import { normalizeLocale, t } from '@mim/i18n';
// 仅类型导入：语言枚举
import type { Locale } from '@mim/i18n';
// api 命名空间与会话读写工具
import { api, clearSession, getSession, setSession } from './api';
// 仅类型导入：会话与用户信息结构
import type { Session, UserInfo } from './api';
// 登录页组件（未登录时渲染）
import { Login } from './views/Login';
// 设置页组件
import { Settings } from './views/Settings';
// 功能模块页（原「商店」视图，展示 Mim 功能模块列表）
import { Store } from './views/Store';
// 漫剧 AI 剧工作台
import { ComicWorkbench } from './views/ComicWorkbench';
// 站点地图：DNSPod 备注结构化的站点模块视图（本轮新增）
import { SiteMap } from './views/SiteMap';

// 顶层视图枚举：新增视图必须同步 navItems 与下方渲染分支
type View = 'store' | 'comic' | 'sitemap' | 'settings';

// 路由状态：当前只有一个 view 字段（无 URL 路由）
interface Route {
  view: View;
}

// 应用根组件
export function App() {
  // 会话状态：初始值从 localStorage 恢复，实现刷新后保持登录
  const [session, setLocalSession] = useState<Session | null>(getSession());
  // 当前视图，默认进入功能模块页
  const [route, setRoute] = useState<Route>({ view: 'store' });

  // 未登录：只渲染登录页，不展示侧边导航（站点地图因此需登录后可见）
  if (!session) {
    return (
      <Login
        // 登录成功回调：写入会话并跳转到功能模块页
        onLogin={(result) => {
          // 持久化会话到 localStorage
          setSession(result);
          // 同步更新内存状态
          setLocalSession(result);
          // 登录后默认落在功能模块页
          setRoute({ view: 'store' });
        }}
      />
    );
  }

  // 已登录：取出用户信息
  const user = session.user;
  // 语言归一化，非法值回退到默认语言
  const locale: Locale = normalizeLocale(user.locale);

  // 退出登录：先尽力调用后端登出，再清理本地会话
  async function handleLogout() {
    try {
      // 通知后端注销当前 token
      await api.logout();
    } catch {
      /* 退出登录时的网络失败不阻塞本地清理 */
    }
    // 清理 localStorage 中的会话
    clearSession();
    // 清空内存会话，触发回到登录页
    setLocalSession(null);
  }

  // 设置页更新用户信息后的回调：替换会话中的 user 并持久化
  function handleUserUpdated(next: UserInfo) {
    // 保留原 token 等字段，仅替换 user
    const updated: Session = { ...session!, user: next };
    // 写入 localStorage
    setSession(updated);
    // 同步内存状态
    setLocalSession(updated);
  }

  // 侧边导航项：顺序即展示顺序（功能模块 → 漫剧 → 站点地图 → 设置）
  const navItems: Array<{ view: View; label: string }> = [
    // 功能模块页
    { view: 'store', label: locale === 'en-US' ? 'Modules' : '功能模块' },
    // 漫剧 AI 剧工作台
    { view: 'comic', label: locale === 'en-US' ? 'Comic Studio' : '漫剧 AI 剧' },
    // 站点地图（DNSPod 备注结构化视图）
    { view: 'sitemap', label: locale === 'en-US' ? 'Site Map' : '站点地图' },
    // 设置页，文案走 i18n 词典
    { view: 'settings', label: t(locale, 'nav.settings') },
  ];

  // 已登录主布局：左侧栏 + 右侧内容区
  return (
    // 布局容器
    <div className="layout">
      {/* 左侧导航栏 */}
      <aside className="sidebar">
        {/* 品牌区：应用名 + 标语 */}
        <div className="brand">
          {/* 应用名（i18n） */}
          <span className="brand-name">{t(locale, 'app.name')}</span>
          {/* 应用标语（i18n） */}
          <span className="brand-tagline">{t(locale, 'app.tagline')}</span>
        </div>
        {/* 导航按钮列表 */}
        <nav className="nav">
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
              onClick={() => setRoute({ view: item.view })}
            >
              {/* 导航文案 */}
              {item.label}
            </button>
          ))}
        </nav>
        {/* 侧边栏底部：用户信息 + 退出按钮 */}
        <div className="sidebar-footer">
          {/* 显示名，缺失时回退到 id 前 8 位 */}
          <span className="user-name">{user.display_name || user.id.slice(0, 8)}</span>
          {/* 区域标识 */}
          <span className="user-region">{user.region === 'cn' ? '中国区' : 'Global'}</span>
          {/* 退出登录按钮 */}
          <button type="button" className="btn ghost block" onClick={handleLogout}>
            {/* 退出文案（i18n） */}
            {t(locale, 'action.logout')}
          </button>
        </div>
      </aside>

      {/* 右侧内容区：按当前视图渲染对应页面 */}
      <main className="main">
        {/* 功能模块页 */}
        {route.view === 'store' && <Store locale={locale} />}
        {/* 漫剧 AI 剧工作台 */}
        {route.view === 'comic' && <ComicWorkbench locale={locale} />}
        {/* 站点地图 */}
        {route.view === 'sitemap' && <SiteMap locale={locale} />}
        {/* 设置页，需要用户更新回调 */}
        {route.view === 'settings' && (
          <Settings locale={locale} onUserUpdated={handleUserUpdated} />
        )}
      </main>
    </div>
  );
}

// 重新导出 Locale 类型，便于其他模块从 App.tsx 引入
export type { Locale };
