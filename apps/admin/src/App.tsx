// 后台外壳组件：负责登录态、按权限过滤的导航与视图分发
import { useCallback, useEffect, useState } from 'react';
// 身份与错误类型：/admin/me 提供 bootstrap 标记与实时权限码
import { ApiError, describeError, getAdminMe, loadCredential, saveCredential } from './api';
// 仅需类型导入，避免把运行时值打进产物
import type { AdminIdentity, Credential } from './api';
// 通用异步加载钩子：统一 loading / error / reload
import { useAsync } from './hooks';
// 五个业务视图：概览、模块、权益、角色权限、用户
import { Entitlements } from './views/Entitlements';
// 登录页：无凭证时的唯一出口，被动退出提示也由它展示
import { Login } from './views/Login';
// 功能模块管理视图：模块状态流转
import { Modules } from './views/Modules';
// 概览视图：默认落地页，任何已登录身份可见
import { Overview } from './views/Overview';
// 角色与权限矩阵视图
import { Roles } from './views/Roles';
// 用户与授权管理视图
import { Users } from './views/Users';

/** 视图键：与侧栏保持一一对应，避免字符串散落各处 */
type ViewKey = 'overview' | 'modules' | 'entitlements' | 'roles' | 'users';

/** 侧栏条目：permission 为 null 表示无需权限即可见 */
interface NavItem {
  // 视图键
  key: ViewKey;
  // 侧栏文案
  label: string;
  // 访问该视图所需的最小权限码
  permission: string | null;
} // NavItem 结束：key/label/permission 三元组即一个侧栏条目

/** 导航表：顺序即侧栏顺序；权限码与后端 RBAC_PERMISSIONS 保持一致 */
const NAV: NavItem[] = [
  // 概览：任何已登录身份都能看
  { key: 'overview', label: '概览', permission: null },
  // 模块管理：需要读权限才展示
  { key: 'modules', label: '功能模块', permission: 'module:read' },
  // 权益管理：需要读权限才展示
  { key: 'entitlements', label: '权益管理', permission: 'entitlement:read' },
  // 角色与权限：需要 rbac:read
  { key: 'roles', label: '角色与权限', permission: 'rbac:read' },
  // 用户与授权：需要 user:read
  { key: 'users', label: '用户', permission: 'user:read' },
]; // 导航表结束：数组顺序即侧栏渲染顺序

/** 应用根组件：只做「有无凭证」的二选一，具体逻辑全部下沉到 Console */
export function App() {
  // 首屏从 localStorage 恢复凭证，避免刷新即掉登录
  const [credential, setCredential] = useState<Credential | null>(() => loadCredential());
  // 被动退出时携带给登录页的提示文案
  const [notice, setNotice] = useState<string | undefined>(undefined);

  // 登录成功：落盘后切换状态；用 useCallback 固定引用，防止子组件依赖抖动
  const handleLogin = useCallback((next: Credential) => {
    // 先持久化，刷新后仍保持登录
    saveCredential(next);
    // 清掉上一次的被动退出提示
    setNotice(undefined);
    // 切换到已登录分支
    setCredential(next);
  }, []); // 空依赖：登录回调引用稳定，子组件不会因重渲染重复订阅

  // 退出登录：主动退出无提示，凭证失效则带一句说明
  const handleLogout = useCallback((message?: string) => {
    // 清除本地凭证
    saveCredential(null);
    // 记录提示文案
    setNotice(message);
    // 回到登录页
    setCredential(null);
  }, []); // 空依赖：退出回调同样保持引用稳定

  // 无凭证直接渲染登录页，此时不会发起任何鉴权请求
  if (!credential) return <Login onDone={handleLogin} notice={notice} />;
  // 有凭证则进入主控台
  return <Console credential={credential} onLogout={handleLogout} />;
} // App 结束：登录页与主控台二选一分发完毕

/** 主控台入参 */
interface ConsoleProps {
  // 已验证格式的凭证，由 App 保证非空
  credential: Credential;
  // 退出回调：可携带提示文案
  onLogout: (message?: string) => void;
} // ConsoleProps 结束：凭证 + 退出回调即全部入参

/** 主控台：拉取身份 → 过滤导航 → 渲染当前视图 */
function Console({ credential, onLogout }: ConsoleProps) {
  // 当前视图；默认概览，权限不足时会自动回落
  const [view, setView] = useState<ViewKey>('overview');
  // 身份查询：凭证变化时重新校验，同时拿到最新权限
  const identityState = useAsync(() => getAdminMe(credential), [credential]);

  // 凭证失效（401）时自动踢回登录页，避免用户卡在满屏报错上
  useEffect(() => {
    // 取出错误对象
    const error = identityState.error;
    // 仅 401 视为凭证失效；403 表示权限不足，应留在页面内提示
    if (error instanceof ApiError && error.status === 401) {
      // 带提示文案退出，登录页会展示该消息
      onLogout('登录凭证已失效，请重新登录');
    } // 401 分支结束：非 401 错误不自动退出，留给页面内错误态处理
    // 依赖错误对象与退出回调（后者已用 useCallback 固定）
  }, [identityState.error, onLogout]);

  // 首屏身份校验中：给出轻量占位，避免闪现登录页
  if (identityState.loading) {
    // 复用登录页的居中容器样式
    return <div className="login-wrap"><div className="login-card">正在校验身份…</div></div>;
  } // loading 分支结束：校验完成后重渲染进入后续分支

  // 身份查询失败：展示错误并允许手动退出重登
  if (identityState.error) {
    // 错误态同样居中展示
    return (
      <div className="login-wrap"> {/* 复用登录页居中容器，错误态与登录页视觉一致 */}
        <div className="login-card"> {/* 卡片容器：与登录页同款样式 */}
          <h2>无法进入管理后台</h2> {/* 错误标题：表明当前是失败态而非登录表单 */}
          {/* 透出后端扁平错误信封的 code + message */}
          <div className="error">{describeError(identityState.error)}</div> {/* 渲染错误描述文本 */}
          {/* 引导令牌未启用或权限缺失时，用户可换凭证重试 */}
          <button className="btn primary" type="button" onClick={() => onLogout()}>返回登录</button> {/* 点击清凭证回登录页 */}
        </div> {/* login-card 结束 */}
      </div> // login-wrap 结束（此后回到 return 的 JS 上下文）
    ); // 错误态 JSX 返回结束
  } // error 分支结束

  // 极端情况：无错误也无数据，直接不渲染
  if (!identityState.data) return null;
  // 收窄后的身份对象
  const identity: AdminIdentity = identityState.data;

  // 侧栏可见项：permission 为 null 或命中当前权限集合
  const visible = NAV.filter((item) => item.permission === null || identity.permissions.includes(item.permission));
  // 当前视图若不可见（权限被回收），回落到概览，避免渲染空页面
  const activeKey: ViewKey = visible.some((item) => item.key === view) ? view : 'overview';
  // 侧栏底部身份描述：引导通道没有用户主体，单独标注
  const subject = identity.bootstrap ? '引导令牌' : identity.user?.display_name ?? '未知用户';

  // 视图分发：集中在一处便于对照权限
  const content = renderView(activeKey, credential, identity);

  // 渲染三段式布局：侧栏 + 主区
  return (
    <div className="layout"> {/* 整体两栏布局：侧栏 + 主内容区 */}
      <aside className="sidebar"> {/* 左侧栏：品牌 + 导航 + 身份区 */}
        {/* 品牌区：与 web 端一致的命名 */}
        <div className="brand">Mim 管理后台</div> {/* 品牌标题 */}
        <nav className="nav"> {/* 按权限过滤后的导航按钮列表 */}
          {visible.map((item) => ( // 逐条渲染可见导航项
            // 当前视图高亮：nav-item + active
            <button
              key={item.key} // React 列表 key：用视图键稳定标识导航项
              type="button" // 显式声明类型，避免在表单上下文被当作提交按钮
              className={item.key === activeKey ? 'nav-item active' : 'nav-item'} // 当前视图加 active 高亮
              onClick={() => setView(item.key)} // 点击切换到对应视图
              // 属性区收尾，下一行进入按钮子节点
            >
              {item.label} {/* 按钮文案：来自导航表的 label */}
            </button> // 单个导航按钮结束（此处已回到 map 回调的 JS 上下文）
          ))} {/* 导航项渲染完毕，回到 nav 子节点 */}
        </nav> {/* 导航列表结束 */}
        {/* 底部身份区：主体 + 区域 + 退出 */}
        <div className="sidebar-footer"> {/* 侧栏底部容器 */}
          {/* 身份来源：引导令牌或真实用户 */}
          <div className="muted">{subject}</div> {/* 渲染身份主体文案 */}
          {/* 区域标记：cn / global，引导通道无区域时显示 all */}
          <div className="muted">{identity.user?.region ?? 'all'}</div> {/* 渲染区域标记 */}
          {/* 退出登录：清除凭证回登录页 */}
          <button className="btn ghost" type="button" onClick={() => onLogout()}>退出登录</button> {/* 主动退出：无提示直接回登录页 */}
        </div> {/* 身份区结束 */}
      </aside> {/* 侧栏结束 */}
      {/* 主内容区：渲染当前视图 */}
      <main className="main">{content}</main> {/* 主区内嵌当前视图分发结果 */}
    </div> // 布局容器结束（此后回到 return 的 JS 上下文）
  ); // Console 的 JSX 返回结束
} // Console 组件结束

/** 视图分发：key 已在调用方做过权限过滤，这里只做映射 */
function renderView(key: ViewKey, credential: Credential, identity: AdminIdentity) {
  // 概览：纯展示身份与权限统计
  if (key === 'overview') return <Overview identity={identity} />;
  // 模块：状态流转，需要 module:write 才能点按钮
  if (key === 'modules') return <Modules credential={credential} permissions={identity.permissions} />;
  // 权益：发放与回收
  if (key === 'entitlements') return <Entitlements credential={credential} permissions={identity.permissions} />;
  // 角色与权限：角色 CRUD + 权限矩阵
  if (key === 'roles') return <Roles credential={credential} permissions={identity.permissions} />;
  // 用户：分页检索 + 角色授予撤销
  if (key === 'users') return <Users credential={credential} permissions={identity.permissions} />;
  // 兜底：理论上不可达，仍返回概览保证不白屏
  return <Overview identity={identity} />;
} // renderView 结束：五个视图分发完毕
