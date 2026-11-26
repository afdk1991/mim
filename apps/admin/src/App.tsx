// 后台外壳组件：负责登录态、按权限过滤的导航与视图分发
import { Component, useCallback, useEffect, useState } from 'react'; // 业务步骤
// 仅类型导入：子节点结构，避免把类型打进产物
import type { ReactNode } from 'react';
// 身份与错误类型：/admin/me 提供 bootstrap 标记与实时权限码
import { ApiError, describeError, getAdminMe, loadCredential, saveCredential } from './api'; // 业务步骤
// 仅需类型导入，避免把运行时值打进产物
import type { AdminIdentity, Credential } from './api'; // 业务步骤
// 通用异步加载钩子：统一 loading / error / reload
import { useAsync } from './hooks'; // 业务步骤
// 明暗切换：与前台共用 localStorage 键，侧栏提供入口避免管理员无路可退
import { currentThemeMode, setThemeMode } from './theme'; // 业务步骤
// 明暗类型：仅类型导入，避免运行时冗余
import type { ThemeMode } from './theme'; // 业务步骤
// 登录页：无凭证时的唯一出口，被动退出提示也由它展示
import { Login } from './views/Login'; // 业务步骤
// 概览视图：默认落地页，任何已登录身份可见
import { Overview } from './views/Overview'; // 业务步骤
// 角色与权限矩阵视图
import { Roles } from './views/Roles'; // 业务步骤
// 用户与授权管理视图
import { Users } from './views/Users'; // 业务步骤
// 批量改价：固定价 / 百分比 / 金额增减 + 批次回滚
import { PriceBatches } from './views/PriceBatches'; // 业务步骤
// 邀请码准入：批量生成、禁用与核销审计
import { Invites } from './views/Invites'; // 业务步骤
// 实名审核队列
import { Realname } from './views/Realname'; // 业务步骤
// 内容运营：公告 / 更新日志 / 推广计划
import { ContentOps } from './views/ContentOps'; // 业务步骤
// 社区运营：板块审核 / 首页指向 / 推荐权重 / Tab 配置
import { CommunityAdmin } from './views/CommunityAdmin'; // 业务步骤
// 页面搭建：首页 / 论坛区块的顺序、文案、可见性与入口跳转
import { PageBuilder } from './views/PageBuilder'; // 业务步骤
// 主题设置面板：左侧分组 + 右侧设置面板，合并原「外观 / 站点选项 / 设置」三页
import { ThemeSettings } from './views/ThemeSettings'; // 业务步骤
// 成长私信：按条件或指定用户发送系统身份私信
import { GrowthDm } from './views/GrowthDm'; // 业务步骤
import { Withdrawals } from './views/Withdrawals'; // 提现审核：申请队列 / 审核 / 到账（钱包结算层）
// 发货与售后：录单 → 签收推进 → 售后审批
import { Shipments } from './views/Shipments'; // 发货售后工作台
// 商品管理：商品全量台账、上架状态与单价维护
import { Products } from './views/Products'; // 商品管理
// 订单管理：全部商城订单只读总览与状态筛选
import { Orders } from './views/Orders'; // 订单管理
// 权益：会员套餐与权益清单维护
import { Entitlements } from './views/Entitlements'; // 权益
// 审计流水：敏感操作的留痕查询（操作人 / 动作 / 对象 / 结果 / 时间）
import { AuditLogs } from './views/AuditLogs'; // 审计流水
// 账号注销：待删除队列、清理策略与手动触发一轮数据清理
import { Deletions } from './views/Deletions'; // 账号注销队列

/** 视图键：与侧栏保持一一对应，避免字符串散落各处 */
type ViewKey = 'overview' | 'themeSettings' | 'withdrawals' | 'shipments' | 'roles' | 'users' | 'priceBatches' | 'invites' | 'realname' | 'contentOps' | 'communityAdmin' | 'pageBuilder' | 'growthDm' | 'products' | 'orders' | 'entitlements' | 'auditLogs' | 'deletions';

/** 侧栏分组键：按 zibll 子比主题后台的分组口径重排，组名与顺序即信息架构口径 */
type NavGroupKey = 'global' | 'pages' | 'content' | 'users' | 'shop' | 'pay' | 'system';

/** 侧栏条目：permission 为 null 表示无需权限即可见 */
interface NavItem {
  // 视图键
  key: ViewKey;
  // 侧栏文案
  label: string;
  // 访问该视图所需的最小权限码
  permission: string | null;
} // NavItem 结束：key/label/permission 三元组即一个侧栏条目

/** 侧栏分组：组内条目顺序即渲染顺序；权限码与后端 RBAC_PERMISSIONS 保持一致 */
interface NavGroup {
  // 分组键：用于持久化「最近使用组」
  key: NavGroupKey;
  // 分组标题
  label: string;
  // 组内条目
  items: NavItem[];
} // NavGroup 结束

/** 概览独立于四组，固定在侧栏顶部，任何已登录身份可见 */
const OVERVIEW: NavItem = { key: 'overview', label: '概览', permission: null };

/** 七组折叠导航：对齐 zibll 的「全局与功能 / 页面与显示 / 内容 / 用户 / 商城 / 支付 / 系统」口径；
 *  原「外观 / 站点选项 / 设置」三页已合并进「主题设置」面板，功能不丢，只是不再各占一个导航项。 */
const NAV_GROUPS: NavGroup[] = [
  {
    key: 'global',
    label: '全局与功能',
    items: [
      // 主题设置：站点信息 / 外观与配色 / Logo / SEO / 布局 / 搜索 / 移动 Tab / 悬浮 / 多语言 / 分享 / 邮件 / 自定义代码 / 备案 / 注册与登录 / 商城与付费
      { key: 'themeSettings', label: '主题设置', permission: 'appearance:write' },
    ],
  },
  {
    key: 'pages',
    label: '页面与显示',
    items: [
      // 页面搭建：首页 / 论坛区块的顺序、文案、可见性与入口跳转
      { key: 'pageBuilder', label: '页面搭建', permission: 'appearance:write' },
    ],
  },
  {
    key: 'content',
    label: '内容与社区',
    items: [
      // 内容运营：公告 / 更新日志 / 推广计划
      { key: 'contentOps', label: '内容运营', permission: 'appearance:write' },
      // 社区运营：板块审核、首页指向、推荐权重、Tab 配置
      { key: 'communityAdmin', label: '社区运营', permission: 'appearance:write' },
    ],
  },
  {
    key: 'users',
    label: '用户与互动',
    items: [
      // 用户与授权：需要 user:read
      { key: 'users', label: '用户', permission: 'user:read' },
      // 角色与权限：需要 rbac:read
      { key: 'roles', label: '角色与权限', permission: 'rbac:read' },
      // 实名审核：读权限 user:read；审核按钮另需 rbac:write
      { key: 'realname', label: '实名审核', permission: 'user:read' },
      // 邀请码：读权限 user:read；生成 / 禁用按钮另需 rbac:write
      { key: 'invites', label: '邀请码', permission: 'user:read' },
      // 成长私信：发送系统身份私信，需要 messaging:write
      { key: 'growthDm', label: '成长私信', permission: 'messaging:write' },
    ],
  },
  {
    key: 'shop',
    label: '商城与商品',
    items: [
      // 商品管理：商品台账、上架状态与单价
      { key: 'products', label: '商品管理', permission: 'commerce:write' },
      // 订单管理：全部商城订单总览
      { key: 'orders', label: '订单管理', permission: 'commerce:write' },
      // 发货与售后：复用 commerce:write，处理待发货订单与售后申请
      { key: 'shipments', label: '发货与售后', permission: 'commerce:write' },
      // 批量改价：后端 commerce:write 才可提交，导航同权限过滤
      { key: 'priceBatches', label: '批量改价', permission: 'commerce:write' },
    ],
  },
  {
    key: 'pay',
    label: '支付与付费',
    items: [
      // 提现审核：申请队列与到账处理，复用 commerce:write
      { key: 'withdrawals', label: '提现审核', permission: 'commerce:write' },
      // 权益：会员套餐与权益清单
      { key: 'entitlements', label: '权益', permission: 'commerce:write' },
    ],
  },
  {
    key: 'system',
    label: '系统与安全',
    items: [
      // 审计流水：只读查询，复用 rbac:read（与后端查询端点同一权限点）
      { key: 'auditLogs', label: '审计流水', permission: 'rbac:read' },
      // 账号注销：待删除队列读权限 user:read；手动清理按钮另需 privacy:write，视图内置灰
      { key: 'deletions', label: '账号注销', permission: 'user:read' },
    ],
  },
]; // NAV_GROUPS 结束：七组共 15 项，加上独立概览即完整后台入口

/** 平铺索引：用于权限过滤与当前视图归属判断 */
const NAV: NavItem[] = [OVERVIEW, ...NAV_GROUPS.flatMap((group) => group.items)];

/** 「最近使用组」的本地存储键：分组口径改版后升到 v2，避免旧值把新分组映射错 */
const NAV_GROUP_KEY = 'mim.admin.nav.group.v2';

/** 读取上次使用的分组；无记录或值非法时回落「全局与功能」 */
function readLastGroup(): NavGroupKey {
  try {
    const raw = localStorage.getItem(NAV_GROUP_KEY);
    if (raw === 'global' || raw === 'pages' || raw === 'content' || raw === 'users' || raw === 'shop' || raw === 'pay' || raw === 'system') return raw;
  } catch {
    // 隐私模式下读取失败不阻断，按缺省处理
  }
  return 'global';
} // readLastGroup 结束

/** 写入最近使用的分组：存储不可用时仅本次生效 */
function persistLastGroup(group: NavGroupKey): void {
  try {
    localStorage.setItem(NAV_GROUP_KEY, group);
  } catch {
    // 存储不可用不影响导航
  }
} // persistLastGroup 结束

/** 应用根组件：只做「有无凭证」的二选一，具体逻辑全部下沉到 Console */
export function App() { // 业务步骤
  // 首屏从 localStorage 恢复凭证，避免刷新即掉登录
  const [credential, setCredential] = useState<Credential | null>(() => loadCredential());
  // 被动退出时携带给登录页的提示文案
  const [notice, setNotice] = useState<string | undefined>(undefined);

  // 登录成功：落盘后切换状态；用 useCallback 固定引用，防止子组件依赖抖动
  const handleLogin = useCallback((next: Credential) => {
    // 先持久化，刷新后仍保持登录
    saveCredential(next);
    // 清掉上一次的被动退出提示
    setNotice(undefined); // 业务步骤
    // 切换到已登录分支
    setCredential(next); // 业务步骤
  }, []); // 空依赖：登录回调引用稳定，子组件不会因重渲染重复订阅

  // 退出登录：主动退出无提示，凭证失效则带一句说明
  const handleLogout = useCallback((message?: string) => {
    // 清除本地凭证
    saveCredential(null);
    // 记录提示文案
    setNotice(message); // 业务步骤
    // 回到登录页
    setCredential(null); // 业务步骤
  }, []); // 空依赖：退出回调同样保持引用稳定

  // 无凭证直接渲染登录页，此时不会发起任何鉴权请求（保留早返回写法供鉴权门禁静态断言）
  if (!credential) return <Login onDone={handleLogin} notice={notice} />;
  // 有凭证则进入主控台；主控台整棵树包错误边界，渲染抛错时切兜底 UI，接口错误仍由视图内 error 通道处理
  return (
    <AdminErrorBoundary>
      <Console credential={credential} onLogout={handleLogout} />
    </AdminErrorBoundary>
  );
} // App 结束

/** 后台错误边界状态：是否已捕获渲染异常 */
interface AdminBoundaryState {
  hasError: boolean; // 标记进入兜底态
} // 状态结构结束

/** 后台错误边界：与前台 ErrorBoundary 同口径，class 组件捕获子树渲染期异常；不吞接口错误 */
class AdminErrorBoundary extends Component<{ children: ReactNode }, AdminBoundaryState> {
  // 初始状态：未捕获异常，正常渲染子树
  state: AdminBoundaryState = { hasError: false };

  // 派生兜底态：进入本方法即展示兜底卡片
  static getDerivedStateFromError(): AdminBoundaryState {
    return { hasError: true }; // 标记错误态
  }

  // 捕获渲染异常：控制台留痕便于排查，不弹远端告警
  componentDidCatch(error: unknown, info: { componentStack?: string }): void {
    console.error('[Mim Admin] 页面渲染异常', error, info.componentStack); // 打印错误与组件栈
  }

  // 渲染分发：正常态透传子树，异常态给刷新出口
  render() {
    if (!this.state.hasError) return this.props.children; // 未出错原样渲染
    return (
      <div className="login-wrap"> {/* 复用登录页居中容器表面 */}
        <div className="login-card"> {/* 卡片容器 */}
          <h2>页面出了点问题</h2> {/* 错误标题 */}
          <div className="error">后台页面渲染中断，请刷新重试；问题持续存在时可返回登录页重新进入。</div> {/* 错误说明 */}
          <button className="btn primary" type="button" onClick={() => window.location.reload()}>刷新重试</button> {/* 整页刷新重新加载 */}
        </div>
      </div>
    );
  }
} // AdminErrorBoundary 结束

/** 主控台入参 */
interface ConsoleProps {
  // 已验证格式的凭证，由 App 保证非空
  credential: Credential;
  // 退出回调：可携带提示文案
  onLogout: (message?: string) => void;
} // ConsoleProps 结束：凭证 + 退出回调即全部入参

/** 主控台：拉取身份 → 过滤导航 → 渲染当前视图 */
function Console({ credential, onLogout }: ConsoleProps) { // 业务步骤
  // 当前视图；默认概览，权限不足时会自动回落
  const [view, setView] = useState<ViewKey>('overview');
  // 当前明暗：以已写入的 data-theme 为准，按钮文案显示切换目标
  const [mode, setMode] = useState<ThemeMode>(() => currentThemeMode());
  // 展开的分组：默认只展开上次使用的组，其余收起
  const [openGroups, setOpenGroups] = useState<Set<NavGroupKey>>(() => new Set<NavGroupKey>([readLastGroup()]));

  /** 同步 details 原生开关到状态，并记录「最近使用组」 */
  function syncGroup(group: NavGroupKey, open: boolean) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (open) next.add(group);
      else next.delete(group);
      return next;
    });
    if (open) persistLastGroup(group);
  } // syncGroup 结束

  /** 进入组内页面：切换视图并把该组记为最近使用 */
  function openItem(item: NavItem, group: NavGroupKey) {
    setView(item.key);
    persistLastGroup(group);
    setOpenGroups((prev) => (prev.has(group) ? prev : new Set(prev).add(group)));
  } // openItem 结束

  /** 概览快捷入口：按目标视图归属分组复用 openItem，最近使用组与侧栏保持一致 */
  function openFromOverview(view: ViewKey) {
    const group = NAV_GROUPS.find((item) => item.items.some((child) => child.key === view));
    const target = group?.items.find((item) => item.key === view);
    if (group && target) openItem(target, group.key);
    else setView(view);
  } // openFromOverview 结束

  // 切换明暗：立即写入 data-theme 并持久化，与前台共用同一偏好
  function toggleMode() {
    const next: ThemeMode = mode === 'dark' ? 'light' : 'dark'; // 目标模式取反
    setThemeMode(next); // 先切页面并落盘，避免存储异常时没有反馈
    setMode(next); // 同步按钮文案
  } // toggleMode 结束
  // 身份查询：凭证变化时重新校验，同时拿到最新权限
  const identityState = useAsync(() => getAdminMe(credential), [credential]);

  // 凭证失效（401）时自动踢回登录页，避免用户卡在满屏报错上
  useEffect(() => {
    // 取出错误对象
    const error = identityState.error; // 业务步骤
    // 仅 401 视为凭证失效；403 表示权限不足，应留在页面内提示
    if (error instanceof ApiError && error.status === 401) { // 业务步骤
      // 带提示文案退出，登录页会展示该消息
      onLogout('登录凭证已失效，请重新登录');
    } // 401 分支结束：非 401 错误不自动退出，留给页面内错误态处理
    // 依赖错误对象与退出回调（后者已用 useCallback 固定）
  }, [identityState.error, onLogout]);

  // 当前视图所属分组自动展开：从概览或权限回落进入组内页时不会藏在收起项里
  useEffect(() => {
    const group = NAV_GROUPS.find((item) => item.items.some((child) => child.key === view));
    if (!group) return;
    setOpenGroups((prev) => (prev.has(group.key) ? prev : new Set(prev).add(group.key)));
  }, [view]);

  // 首屏身份校验中：给出轻量占位，避免闪现登录页
  if (identityState.loading) { // 业务步骤
    // 复用登录页的居中容器样式
    return <div className="login-wrap"><div className="login-card">正在校验身份…</div></div>;
  } // loading 分支结束：校验完成后重渲染进入后续分支

  // 身份查询失败：展示错误并允许手动退出重登
  if (identityState.error) { // 业务步骤
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
  if (!identityState.data) return null; // 业务步骤
  // 收窄后的身份对象
  const identity: AdminIdentity = identityState.data; // 业务步骤

  // 侧栏可见项：permission 为 null 或命中当前权限集合
  const visible = NAV.filter((item) => item.permission === null || identity.permissions.includes(item.permission));
  // 当前视图若不可见（权限被回收），回落到概览，避免渲染空页面
  const activeKey: ViewKey = visible.some((item) => item.key === view) ? view : 'overview';
  // 概览独立于四组，固定在侧栏顶部
  const overviewVisible = visible.some((item) => item.key === 'overview');
  // 四组按权限过滤：组内全部条目不可见时整组隐藏
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.permission === null || identity.permissions.includes(item.permission)),
  })).filter((group) => group.items.length > 0);
  // 侧栏底部身份描述：引导通道没有用户主体，单独标注
  const subject = identity.bootstrap ? '引导令牌' : identity.user?.display_name ?? '未知用户'; // 业务步骤

  // 视图分发：集中在一处便于对照权限
  const content = renderView(activeKey, credential, identity, openFromOverview); // 业务步骤

  // 渲染三段式布局：侧栏 + 主区
  return (
    <div className="layout"> {/* 整体两栏布局：侧栏 + 主内容区 */}
      <aside className="sidebar"> {/* 左侧栏：品牌 + 导航 + 身份区 */}
        {/* 品牌区：与 web 端一致的命名 */}
        <div className="brand">Mim 管理后台</div> {/* 品牌标题 */}
        <nav className="nav"> {/* 概览 + 四组折叠导航，组内按权限过滤 */}
          {overviewVisible && ( // 概览固定在组外顶部
            <button
              type="button"
              className={activeKey === 'overview' ? 'nav-item active' : 'nav-item'}
              onClick={() => setView('overview')}
            >
              概览
            </button>
          )}
          {groups.map((group) => { // 逐组渲染 details 折叠块
            const open = openGroups.has(group.key); // 受控展开状态
            return (
              <details
                key={group.key}
                className="nav-group"
                open={open}
                onToggle={(event) => syncGroup(group.key, event.currentTarget.open)}
              >
                <summary className="nav-group-title" aria-expanded={open}>
                  <span>{group.label}</span>
                  <span className="nav-group-count">{group.items.length}</span>
                </summary>
                <div className="nav-group-items">
                  {group.items.map((item) => ( // 组内条目：选中态与组内序号
                    <button
                      key={item.key}
                      type="button"
                      className={item.key === activeKey ? 'nav-item active' : 'nav-item'}
                      onClick={() => openItem(item, group.key)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </details>
            );
          })}
        </nav> {/* 导航列表结束 */}
        {/* 底部身份区：主体 + 区域 + 退出 */}
        <div className="sidebar-footer"> {/* 侧栏底部容器 */}
          {/* 身份来源：引导令牌或真实用户 */}
          <div className="muted">{subject}</div> {/* 渲染身份主体文案 */}
          {/* 区域标记：cn / global，引导通道无区域时显示 all */}
          <div className="muted">{identity.user?.region ?? 'all'}</div> {/* 渲染区域标记 */}
          {/* 明暗切换：与前台共用偏好，后台也能自行切回浅色 */}
          <button className="btn ghost" type="button" onClick={toggleMode}>{mode === 'dark' ? '浅色模式' : '暗色模式'}</button> {/* 点击即写入 data-theme 并持久化 */}
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
function renderView(key: ViewKey, credential: Credential, identity: AdminIdentity, onOpen: (view: ViewKey) => void) { // 业务步骤
  // 概览：身份统计 + 常用入口
  if (key === 'overview') return <Overview identity={identity} onOpen={onOpen} />;
  // 提现审核：申请队列、通过 / 驳回 / 标记到账、创作分成结算
  if (key === 'withdrawals') return <Withdrawals credential={credential} permissions={identity.permissions} />;
  // 发货与售后：待发货录单、物流推进与售后审批
  if (key === 'shipments') return <Shipments credential={credential} permissions={identity.permissions} />;
  // 角色与权限：角色 CRUD + 权限矩阵
  if (key === 'roles') return <Roles credential={credential} permissions={identity.permissions} />;
  // 用户：分页检索 + 角色授予撤销
  if (key === 'users') return <Users credential={credential} permissions={identity.permissions} />;
  // 批量改价：提交批次与按快照回滚
  if (key === 'priceBatches') return <PriceBatches credential={credential} permissions={identity.permissions} />;
  // 邀请码：生成 / 列表 / 禁用 / 核销记录
  if (key === 'invites') return <Invites credential={credential} permissions={identity.permissions} />;
  // 实名审核：脱敏队列与通过 / 驳回
  if (key === 'realname') return <Realname credential={credential} permissions={identity.permissions} />;
  // 内容运营：公告 / 更新日志 / 推广计划
  if (key === 'contentOps') return <ContentOps credential={credential} permissions={identity.permissions} />;
  // 社区运营：板块审核、首页指向、审核开关、推荐权重、Tab 配置
  if (key === 'communityAdmin') return <CommunityAdmin credential={credential} permissions={identity.permissions} />;
  // 页面搭建：首页 / 论坛区块的顺序、文案、可见性与入口跳转
  if (key === 'pageBuilder') return <PageBuilder credential={credential} permissions={identity.permissions} />;
  // 主题设置：左侧分组 + 右侧面板，合并原外观 / 站点选项 / 设置三页
  if (key === 'themeSettings') return <ThemeSettings credential={credential} permissions={identity.permissions} />;
  // 成长私信：按条件或指定用户发送系统身份私信
  if (key === 'growthDm') return <GrowthDm credential={credential} permissions={identity.permissions} />;
  // 商品管理：商品台账、上架状态与单价
  if (key === 'products') return <Products credential={credential} permissions={identity.permissions} />;
  // 订单管理：全部商城订单总览
  if (key === 'orders') return <Orders credential={credential} permissions={identity.permissions} />;
  // 权益：会员套餐与权益清单
  if (key === 'entitlements') return <Entitlements credential={credential} permissions={identity.permissions} />;
  // 审计流水：敏感操作留痕查询（只读）
  if (key === 'auditLogs') return <AuditLogs credential={credential} permissions={identity.permissions} />;
  // 账号注销：待删除队列、清理策略与手动清理（写操作另需 privacy:write）
  if (key === 'deletions') return <Deletions credential={credential} permissions={identity.permissions} />;
  // 兜底：理论上不可达，仍返回概览保证不白屏
  return <Overview identity={identity} onOpen={onOpen} />;
} // renderView 结束：全部视图分发完毕
