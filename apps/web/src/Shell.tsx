// 全站外壳：顶部横导航 + 1200px 居中两栏 + 多列页脚，移动端补底部 Tab。
// 外壳结构只在本文件组装，App.tsx 仅把当前视图作为 children 传进来：
// 需要整体回退外壳形态时，替换本文件与 styles.css「外壳」段即可，无需逐页改视图。
import { useEffect, useState } from 'react';
// 仅类型导入：children 与事件 / 数据契约需要的类型
import type { ReactNode } from 'react';
// i18n 取值：品牌名等通用文案走词典，避免外壳硬编码
import { t } from '@mim/i18n';
// 仅类型导入：语言枚举
import type { Locale } from '@mim/i18n';
// 仅类型导入：视图标识（导航跳转入参）
import type { AppView } from './router';
// 合规静态页深链接：页脚四项合规链接跳 /legal/<kind>，走站内多段路径
import { legalPath, navigatePath } from './router';
// 仅类型导入：会话结构（用户卡与登录态分支）
import type { Session } from './api';
// 仅类型导入：明暗模式（切换按钮展示对向文案）
import type { ThemeMode } from './appearance';
// 站点选项：外壳按后台开关决定吸顶、页脚、底部 Tab 与 Logo 形态
import { DEFAULT_SITE_OPTIONS } from './site-options';
import type { SiteOptions } from './site-options';

/** 导航项：由 App 合并后台配置后传入，外壳只负责渲染与高亮 */
export interface ShellNavItem {
  view: string; // 视图标识：与路由段一致
  label: string; // 展示文案：已按当前语言解析
} // 导航项结构结束

/** 外壳入参：全站共享的会话 / 主题 / 导航状态，视图内容由 children 提供 */
interface ShellProps {
  locale: Locale; // 当前语言
  mode: ThemeMode; // 当前明暗模式
  onToggleMode: () => void; // 切换明暗
  navItems: ShellNavItem[]; // 一级导航项
  activeView: AppView; // 需要高亮的视图（隐藏二级页已由上层映射到上级）
  onNavigate: (view: AppView) => void; // 统一跳转入口
  authedSession: Session | null; // 正式账号会话；null 表示未登录
  onLogout: () => void; // 退出登录
  showSide: boolean; // 是否渲染右栏（登录页等整屏页面关闭）
  site?: SiteOptions; // 站点选项：缺省取默认值，保证外壳可在任何调用方直接渲染
  children: ReactNode; // 当前视图内容
} // 外壳入参结束

/** 站内静态素材地址：按构建期 BASE_URL 拼接，兼容 /mim/ 子路径部署 */
function asset(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`; // public 下的相对路径统一补前缀
} // asset 结束

// 线性图标共用描边：零第三方图标库，直接内联 SVG；颜色继承按钮文字色，选中态自动换主色
const ICON_STROKE = {
  fill: 'none', // 线性图标不填充
  stroke: 'currentColor', // 颜色继承当前文字色
  strokeWidth: 1.7, // 与 14px 字号搭配的线宽
  strokeLinecap: 'round', // 圆头线帽更柔和
  strokeLinejoin: 'round', // 圆角转折
} as const; // 只读常量，避免被意外改写

/** 底部 Tab 图标：按视图给出线性图标，统一 24 网格 */
function TabIcon({ view }: { view: string }) {
  return (
    // 图标容器：装饰性图形，屏幕阅读器跳过，尺寸由 CSS 可再收
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...ICON_STROKE}>
      {/* 首页 / 社区：房子轮廓 */}
      {(view === 'community' || view === 'home') && <><path d="M3.5 10.5 12 3.5l8.5 7" /><path d="M5.5 9.5V20h13V9.5" /></>}
      {/* 聊天：对话气泡 */}
      {view === 'chat' && <path d="M4 5.5h16v11H8.5L4 20z" />}
      {/* 个人中心：头像轮廓 */}
      {view === 'account' && <><circle cx="12" cy="8" r="3.4" /><path d="M5 20c0-3.2 3.1-5.2 7-5.2s7 2 7 5.2" /></>}
      {/* 圈子：单人 + 同伴轮廓 */}
      {view === 'circles' && <><circle cx="9" cy="9" r="3" /><path d="M3.5 19c0-2.6 2.5-4.2 5.5-4.2s5.5 1.6 5.5 4.2" /></>}
      {/* 登录：钥匙轮廓 */}
      {view === 'login' && <><circle cx="9" cy="12" r="3.2" /><path d="M12.2 12H21" /><path d="M18 12v3" /></>}
      {/* 兜底：未知视图给圆点占位，不出现空白 Tab */}
      {!['home', 'community', 'chat', 'account', 'circles', 'login'].includes(view) && <circle cx="12" cy="12" r="4" />}
    </svg>
  ); // 图标返回结束
} // TabIcon 结束

/** 明暗切换图标：暗色时展示太阳（点了变浅色），浅色时展示月亮 */
function ModeIcon({ dark }: { dark: boolean }) {
  return (
    // 与 TabIcon 共用描边口径，保证头部图标观感一致
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" {...ICON_STROKE}>
      {/* 当前暗色：给出去浅色的入口（太阳） */}
      {dark && <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" /></>}
      {/* 当前浅色：给出切暗色的入口（月亮） */}
      {!dark && <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />}
    </svg>
  ); // 图标返回结束
} // ModeIcon 结束

/**
 * 外壳主组件：header + 两栏主体 + 多列页脚 + 移动端底部 Tab。
 * 两栏右栏是站点信息类挂件，整屏视图（登录）可通过 showSide=false 关闭。
 */
export function Shell({
  locale, // 当前语言
  mode, // 当前明暗
  onToggleMode, // 切换明暗
  navItems, // 一级导航
  activeView, // 高亮视图
  onNavigate, // 跳转
  authedSession, // 会话
  onLogout, // 退出
  showSide, // 是否渲染右栏
  site = DEFAULT_SITE_OPTIONS, // 站点选项：调用方未传时按默认行为渲染
  children, // 视图内容
}: ShellProps) {
  // 吸顶头部的滚动阴影标记：与 zibll 一致，滚动后加一层浅阴影
  const [stuck, setStuck] = useState(false);
  // 监听页面滚动：只在越过阈值时切换状态，避免每次滚动都写样式
  useEffect(() => {
    const onScroll = (): void => setStuck(window.scrollY > 4); // 顶部 4px 内视为未滚动
    onScroll(); // 挂载时先同步一次，刷新后停在页面中部也能正确显示
    window.addEventListener('scroll', onScroll, { passive: true }); // 被动监听，不阻塞滚动
    return () => window.removeEventListener('scroll', onScroll); // 卸载时解绑，避免泄漏
  }, []); // 只绑定一次
  // 登录文案：中英各一份，避免模板里反复出现三元
  const signIn = locale === 'en-US' ? 'Sign in' : '登录';
  // 明暗按钮文案：按当前模式给出对向语义，title 与 aria-label 共用
  const modeLabel = mode === 'dark' ? (locale === 'en-US' ? 'Light mode' : '浅色模式') : locale === 'en-US' ? 'Dark mode' : '暗色模式';
  // 底部 Tab 项：优先取后台一级导航，项数上限由「站点选项 → 移动底部 Tab」决定
  const tabItems: ShellNavItem[] = navItems.slice(0, site.mobileTabItemsMax).map((item) => ({ view: item.view, label: item.label }));
  // 未登录且仍有空位：补登录入口，保证移动端随时可登录
  if (!authedSession && tabItems.length < site.mobileTabItemsMax && !tabItems.some((item) => item.view === 'login')) tabItems.push({ view: 'login', label: signIn });
  // 页脚快捷入口：与主导航同源，末位按登录态给个人中心或登录
  const footerTail: ShellNavItem[] = [
    { view: 'circles', label: locale === 'en-US' ? 'Circles' : '圈子' }, // 圈子：成员制板块
    { view: authedSession ? 'account' : 'login', label: authedSession ? (locale === 'en-US' ? 'Account' : '个人中心') : signIn }, // 按登录态分流
  ];
  // 当前年份：版权信息按渲染时计算，不做构建期常量
  const year = new Date().getFullYear();
  // 品牌副标题：与 App 标题口径一致
  const tagline = locale === 'en-US' ? 'Content, community and commerce' : '内容、社区与交易一体化';
  // 默认头像地址：复用主题包素材，构建期按 BASE_URL 拼前缀
  const avatar = asset('zib/img/avatar-default.png');
  // 显示名：缺失时回退 id 前 8 位，头部与挂件共用同一口径
  const displayName = authedSession ? authedSession.user.display_name || authedSession.user.id.slice(0, 8) : '';
  return (
    <>
      {/* 顶部导航：吸顶 + 半透明底 + 滚动阴影，结构对齐 zibll header */}
      <header className={`site-header${stuck && site.stickyHeader ? ' is-stuck' : ''}`} style={site.stickyHeader ? undefined : { position: 'static' }}>{/* 滚动态由 is-stuck 追加阴影；关闭吸顶后退化为静态头部 */}
        <div className="header-inner">{/* 顶栏内容行：1200px 居中 */}
          <button type="button" className="site-brand" onClick={() => onNavigate('community')}>{/* 品牌：点击回社区首页 */}
            <span className="brand-mark" aria-hidden="true" />{/* 主色渐变方块，作为唯一高饱和锚点 */}
            {(() => {
              const logo = mode === 'dark' ? site.logoDarkUrl || site.logoLightUrl : site.logoLightUrl || site.logoDarkUrl; // 按明暗取 Logo，缺一侧时互相兜底
              return logo ? (
                <img className="brand-logo" src={logo} alt={t(locale, 'app.name')} /> // 运营配置了 Logo 时用图，不再叠文字主名
              ) : (
                <span className="brand-text">{/* 品牌文字块：主名 + 副标题两行 */}
                  <span className="brand-name">{t(locale, 'app.name')}</span>{/* 应用名走 i18n 词典 */}
                  <span className="brand-sub">{tagline}</span>{/* 副标题：最小字号档，窄屏隐藏 */}
                </span>
              ); // 品牌分支结束
            })()}
          </button>
          <nav className="site-nav" aria-label={locale === 'en-US' ? 'Main navigation' : '主导航'}>{/* 一级导航：横向平铺 */}
            {navItems.map((item) => ( // 按上层给出的顺序渲染，顺序由后台配置决定
              <button key={item.view} type="button" className={`nav-item${activeView === item.view ? ' active' : ''}`} onClick={() => onNavigate(item.view as AppView)}>{/* 选中态与隐藏二级页的上级映射一致 */}{item.label}
              </button>
            ))}
          </nav>
          <div className="site-actions">{/* 右侧操作区：明暗切换 + 用户入口 */}
            <button type="button" className="icon-btn" onClick={onToggleMode} title={modeLabel} aria-label={modeLabel}>{/* 明暗切换 */}
              <ModeIcon dark={mode === 'dark'} />{/* 图标与文案同源 */}
            </button>
            {authedSession ? ( // 已登录：头像 + 显示名，点击进个人中心
              <button type="button" className="user-chip" onClick={() => onNavigate('account')}>{/* 用户胶囊 */}
                <img className="user-avatar" src={avatar} alt="" />{/* 主题包默认头像 */}
                <span className="user-chip-name">{displayName}</span>{/* 长名由 CSS 截断 */}
              </button>
            ) : ( // 未登录：给登录按钮，不再出现访客身份
              <button type="button" className="btn primary small header-login" onClick={() => onNavigate('login')}>{signIn}</button>
            )}
          </div>
        </div>
      </header>

      {/* 两栏主体：1200px 居中，左内容右挂件；showSide=false 时退化为单列 */}
      <div className={`shell-wrap${showSide ? '' : ' no-side'}`}>{/* 两栏容器 */}
        <main className="main">{children}{/* 视图内容由 App 传入，外壳不感知具体页面 */}</main>
        {showSide && ( // 右栏挂件：登录页等整屏视图关闭
          <aside className="shell-side" aria-label={locale === 'en-US' ? 'Site sidebar' : '站点侧栏'}>{/* 右栏：两张站点挂件 */}
            <section className="widget">{/* 挂件一：账号卡 */}
              <h3 className="widget-head"><span className="title-theme">{locale === 'en-US' ? 'My account' : '我的账号'}</span>{/* zibll 风格标题：左侧 4px 主色竖条 */}</h3>
              <div className="widget-body widget-user">{/* 头像 / 名称 / 元信息 / 主操作 */}
                <img className="widget-avatar" src={avatar} alt="" />{/* 主题包默认头像 */}
                {authedSession ? ( // 已登录：显示名 + 区域 + 退出
                  <>
                    <span className="widget-name">{displayName}</span>{/* 显示名口径与头部一致 */}
                    <span className="widget-meta">{authedSession.user.region === 'cn' ? '中国区' : 'Global'}</span>
                    <button type="button" className="btn ghost block" onClick={onLogout}>{t(locale, 'action.logout')}</button>
                  </>
                ) : ( // 未登录：说明 + 登录入口
                  <>
                    <span className="widget-name">{locale === 'en-US' ? 'Not signed in' : '未登录'}</span>
                    <span className="widget-meta">{locale === 'en-US' ? 'Sign in with an existing account' : '请使用已有账号登录'}</span>
                    <button type="button" className="btn primary block" onClick={() => onNavigate('login')}>{signIn}</button>
                  </>
                )}
              </div>
            </section>
            <section className="widget">{/* 挂件二：站点信息 */}
              <h3 className="widget-head"><span className="title-theme">{locale === 'en-US' ? 'About' : '站点信息'}</span></h3>
              <div className="widget-body widget-about">{/* 简介 + 快捷入口 */}
                <p className="widget-text">{locale === 'en-US' ? 'Content, community and payments in one place.' : '内容、社区与交易一体化。'}</p>
                <ul className="widget-links">{/* 快捷入口与主导航同源，避免两处口径分裂 */}
                  {navItems.map((item) => ( // 一级导航镜像
                    <li key={item.view}>
                      <button type="button" onClick={() => onNavigate(item.view as AppView)}>{item.label}</button>{/* 文字按钮，靠 hover 提亮 */}
                    </li>
                  ))}
                  <li>
                    <button type="button" onClick={() => onNavigate('circles')}>{locale === 'en-US' ? 'Circles' : '圈子'}</button>{/* 导航里没有时也给出圈子入口 */}
                  </li>
                </ul>
              </div>
            </section>
          </aside>
        )}
      </div>

      {/* 多列页脚：品牌简介 / 导航 / 更多，底部一行版权与备案 */}
      {site.showFooter && (<footer className="site-footer">
        <div className="footer-cols">{/* 三列：品牌 1.4fr，其余 1fr */}
          <div className="footer-col footer-col-brand">{/* 品牌列：标记 + 名 + 一句话简介 */}
            <span className="footer-brand-line">{/* 标记与名同一行 */}
              <span className="brand-mark small" aria-hidden="true" />{/* 与头部同族的品牌标记，尺寸降一档 */}
              <span className="footer-brand">{t(locale, 'app.name')}</span>
            </span>
            <p className="footer-note">{locale === 'en-US' ? 'Content, community and payments in one place.' : '内容、社区与交易一体化'}</p>
          </div>
          <div className="footer-col">{/* 导航列 */}
            <h4 className="footer-title">{locale === 'en-US' ? 'Navigate' : '导航'}</h4>
            <ul className="footer-list">
              {navItems.map((item) => ( // 与主导航同源
                <li key={item.view}>
                  <button type="button" onClick={() => onNavigate(item.view as AppView)}>{item.label}</button>
                </li>
              ))}
            </ul>
          </div>
          <div className="footer-col">{/* 更多列：圈子与账号 / 登录 + 合规入口 */}
            <h4 className="footer-title">{locale === 'en-US' ? 'More' : '更多'}</h4>
            <ul className="footer-list">
              {footerTail.map((item) => ( // 按登录态分流的尾部入口
                <li key={item.view}>
                  <button type="button" onClick={() => onNavigate(item.view as AppView)}>{item.label}</button>
                </li>
              ))}
              {/* 合规静态页四项：匿名态也可见，点击进对应 /legal/<kind> 骨架页 */}
              <li><button type="button" onClick={() => navigatePath(legalPath('privacy'))}>{locale === 'en-US' ? 'Privacy' : '隐私政策'}</button></li>
              <li><button type="button" onClick={() => navigatePath(legalPath('terms'))}>{locale === 'en-US' ? 'Terms' : '用户协议'}</button></li>
              <li><button type="button" onClick={() => navigatePath(legalPath('refund'))}>{locale === 'en-US' ? 'Refund' : '退款售后'}</button></li>
              <li><button type="button" onClick={() => navigatePath(legalPath('help'))}>{locale === 'en-US' ? 'Help' : '帮助中心'}</button></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">{/* 版权与备案：最小字号，同一行两端分布 */}
          <span className="footer-copy">© {year} Mim</span>{/* 版权：按渲染年份计算 */}
          {(site.beianIcp || site.beianPolice) && ( // 两项都留空时整块不渲染，避免出现空链接槽
            <span className="footer-beian">{/* 备案号不做成站内按钮，仅普通外链 */}
              {site.beianIcp && ( // ICP 备案号：后台可留空关闭
                <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">{site.beianIcp}</a>
              )}
              {site.beianIcp && site.beianPolice && <span aria-hidden="true">·</span>}{/* 两项都有才显示分隔点 */}
              {site.beianPolice && ( // 公安备案号：后台可留空关闭
                <a href="https://beian.mps.gov.cn/" target="_blank" rel="noopener noreferrer">{site.beianPolice}</a>
              )}
            </span>
          )}
        </div>
      </footer>)}

      {/* 底部 Tab：≤760px 显示，补足 zibll 移动端底部导航；总开关与项数取自站点选项 */}
      {site.mobileTabEnabled && (<nav className="mobile-tabs" aria-label={locale === 'en-US' ? 'Bottom navigation' : '底部导航'}>
        {tabItems.map((item) => ( // 每项：图标 + 短文案
          <button key={item.view} type="button" className={`mobile-tab${activeView === item.view ? ' active' : ''}`} onClick={() => onNavigate(item.view as AppView)}>{/* 选中态跟随当前视图 */}
            <TabIcon view={item.view} />{/* 线性图标 */}
            <span>{item.label}</span>{/* 短文案 */}
          </button>
        ))}
      </nav>)}
    </>
  ); // 外壳返回结束
} // Shell 结束
