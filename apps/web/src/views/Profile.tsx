// 引入状态钩子：资料表单、账号设置数据与提交中间态
import { useEffect, useState } from 'react';
// 引入 FormEvent 类型
import type { FormEvent } from 'react';
// 引入语言类型
import type { Locale } from '@mim/i18n';
// 引入接口集合、错误文案翻译与会话读取
import { api, errorText, getSession } from '../api';
// 引入用户信息类型与个人聚合视图类型
import type { CircleSummary, FavoriteThreadItem, MyGrowthBadge, MyReportItem, OAuthProviderInfo, UserInfo } from '../api';
// 引入通用异步加载钩子
import { useAsync } from '../hooks';
// 引入站内深链接导航
import { navigatePath, pathOf } from '../router';
// 引入空态共享组件
import { EmptyState } from '../empty-state';
// 引入列表骨架统一组件
import { ListSkeleton } from '../components/list-skeleton';
// 引入注销倒计时格式化、逾期判定与导出文件名纯函数
import { exportFileName, formatDateTime, formatRemaining, isOverdue } from '../lib/deletion';
// 引入我的资产页签（付费资产域，2026-11-16）
import { MyAssets } from './MyAssets';

/** 组件契约：语言 + 用户更新回调 */
interface Props {
  locale: Locale; // 当前界面语言
  onUserUpdated: (user: UserInfo) => void; // 资料保存后同步全局用户态
} // Props 结束

/** 四个分区标识：资料编辑、我的内容、我的资产与账号安全 */
type Tab = 'profile' | 'content' | 'assets' | 'security';

/** 全部合法分区，用于校验地址栏 ?tab= 入参 */
const TAB_IDS: readonly Tab[] = ['profile', 'content', 'assets', 'security'];

/** 举报原因文案：键与后端枚举一致，文案仅做本地展示映射 */
const REPORT_REASON: Record<string, string> = { // 原因 → 中文名
  spam: '垃圾广告', // 广告刷屏
  abuse: '辱骂攻击', // 人身攻击
  illegal: '违法信息', // 违法内容
  porn: '色情低俗', // 色情低俗
  other: '其他', // 其他
}; // 常量结束

/** 举报状态文案：pending 待处理 / resolved 已处理 / dismissed 已忽略 */
const REPORT_STATUS: Record<string, string> = { // 状态 → 中文名
  pending: '待处理', // 库内 open 归一化后的待处理态
  resolved: '已处理', // 版主已处置
  dismissed: '已忽略', // 核实未违规，予以忽略
}; // 常量结束

/** 圈子角色文案：与 Circles 视图同一口径 */
function circleRoleLabel(isZh: boolean, role: CircleSummary['my_role']): string { // 角色 → 中文标签
  if (role === 'owner') return isZh ? '圈主' : 'Owner'; // 圈主
  if (role === 'admin') return isZh ? '管理员' : 'Admin'; // 管理员
  return isZh ? '成员' : 'Member'; // 普通成员
} // 函数结束

/** 时间只展示到日，和社区其他位置一致；空值回落空串 */
function day(iso: string | null | undefined): string { // 日期截取
  return iso ? iso.slice(0, 10) : ''; // 非法 / 空值回空串
} // 函数结束

/** 从地址栏 ?tab= 读取初始分区；非法值回落资料分区 */
function initialTab(): Tab {
  if (typeof window === 'undefined') return 'profile'; // 非浏览器环境兜底
  const raw = new URLSearchParams(window.location.search).get('tab'); // 当前页签参数
  return raw && (TAB_IDS as readonly string[]).includes(raw) ? (raw as Tab) : 'profile'; // 合法值直接采用
} // initialTab 结束

/** 个人中心：资料编辑 / 账号与设置 两块 */
export function Profile({ locale, onUserUpdated }: Props) {
  const isZh = locale !== 'en-US'; // 是否中文文案
  const [tab, setTab] = useState<Tab>(() => initialTab()); // 当前分区

  /** 切换分区并把页签写进地址栏：?tab=security 可分享、刷新不丢；资料分区不带参数保持地址干净 */
  function selectTab(next: Tab) {
    setTab(next); // 先切界面，地址栏随后同步
    const url = new URL(window.location.href); // 保留其他查询参数（如 oauth_bound）
    if (next === 'profile') url.searchParams.delete('tab'); // 默认分区不写参数
    else url.searchParams.set('tab', next); // 其余分区显式写入
    window.history.replaceState(null, '', url.pathname + url.search + url.hash); // 原地替换，不新增历史
  } // selectTab 结束
  const me = useAsync(() => api.me(), []); // 我的资料
  const [displayName, setDisplayName] = useState(''); // 昵称编辑值
  const [localeValue, setLocaleValue] = useState<Locale>('zh-CN'); // 语言编辑值
  const [timezone, setTimezone] = useState(''); // 时区编辑值
  const [busy, setBusy] = useState(false); // 提交中间态
  const [error, setError] = useState<string | null>(null); // 错误提示
  const [message, setMessage] = useState<string | null>(null); // 成功提示
  const bindings = useAsync(() => api.oauthBindings(), []); // 已绑定的第三方身份
  const [providers, setProviders] = useState<OAuthProviderInfo[]>([]); // 可绑定的第三方清单
  const [linking, setLinking] = useState<string | null>(null); // 正在跳转的提供方
  const realname = useAsync(() => api.realname.status(), []); // 实名状态：未提交时 record 为 null
  const [realName, setRealName] = useState(''); // 待提交的真实姓名
  const [realIdType, setRealIdType] = useState<'id_card' | 'passport' | 'other'>('id_card'); // 证件类型
  const [realIdNumber, setRealIdNumber] = useState(''); // 待提交的证件号
  const [realBusy, setRealBusy] = useState(false); // 实名提交中间态
  const [exporting, setExporting] = useState(false); // 数据包导出下载中间态
  const [confirmOpen, setConfirmOpen] = useState(false); // 注销二次确认面板是否展开
  const [confirmed, setConfirmed] = useState(false); // 勾选「我已知晓数据不可恢复」
  const [deleteConfirmText, setDeleteConfirmText] = useState(''); // 二次确认输入的 DELETE 文本
  const [bannerDismissed, setBannerDismissed] = useState(false); // 待删除横幅是否已点「知道了」收起

  // ===== 个人聚合：成长 / 收藏 / 圈子 / 举报（私密读，匿名不请求、不渲染骨架） =====
  const hasSession = !!getSession(); // 当前是否有本地会话：无会话时 loader 直接返回空态，不发请求
  const growthLevel = useAsync(async () => { // 等级进度：匿名直接回落 null，不打私密读接口
    if (!hasSession) return null; // 匿名短路：不请求、不渲染占位骨架
    return api.growth.level(); // 已登录回读等级与积分进度
  }, [hasSession]);
  const growthBadges = useAsync(async () => { // 我的徽章：匿名回落空列表
    if (!hasSession) return { badges: [] as MyGrowthBadge[] }; // 匿名短路
    return api.growth.badges(); // 已登录回读徽章墙
  }, [hasSession]);
  const favorites = useAsync(async () => { // 我的收藏：匿名回落空列表
    if (!hasSession) return { items: [] as FavoriteThreadItem[] }; // 匿名短路
    return api.community.favorites(); // 已登录回读收藏帖
  }, [hasSession]);
  const joinedCircles = useAsync(async () => { // 我加入的圈子：匿名回落空列表；成员标记由列表项 i_am_member 前端筛选
    if (!hasSession) return { items: [] as CircleSummary[] }; // 匿名短路
    return api.circles.list(); // 拉公开圈子清单，本地过滤已加入
  }, [hasSession]);
  const myReports = useAsync(async () => { // 我的举报：匿名回落空列表
    if (!hasSession) return { items: [] as MyReportItem[], total: 0 }; // 匿名短路
    return api.community.myReports(); // 已登录回读本人举报单
  }, [hasSession]);

  /** 跳转帖子详情：与社区卡片同一深链接口径 */
  function openThread(id: string) { // 帖子详情导航
    navigatePath(pathOf('community', `post/${encodeURIComponent(id)}`)); // 地址栏变为 /community/post/:id
  } // openThread 结束

  /** 跳转圈子详情：圈子视图挂载后按路径段打开对应圈子 */
  function openCircle(slug: string) { // 圈子详情导航
    navigatePath(pathOf('circles', encodeURIComponent(slug))); // 地址栏变为 /circles/:slug
  } // openCircle 结束

  const user = me.data?.user; // 当前用户
  const pendingAt = user?.deletion_scheduled_at ?? null; // 预约删除时刻；null 表示未申请注销
  const overdue = pendingAt !== null && isOverdue(pendingAt); // 是否已过预约时刻（到期即视为账号已删除）
  const pending = pendingAt !== null && !overdue; // 是否处于冷静期待删除态

  // 资料回填：拿到 /me 结果后同步到表单
  useEffect(() => {
    if (!user) return; // 未加载完成不回填
    setDisplayName(user.display_name); // 昵称
    setLocaleValue(user.locale === 'en-US' ? 'en-US' : 'zh-CN'); // 语言收敛为两种合法值
    setTimezone(user.timezone); // 时区
  }, [user]);

  // 拉取第三方提供方清单（随账号区域变化）
  useEffect(() => {
    api.oauthProviders(user?.region).then((result) => setProviders(result.providers)).catch(() => setProviders([])); // 失败静默降级
  }, [user?.region]);

  // 回调带回 ?oauth_bound=provider 时提示绑定成功，并立即清掉参数避免刷新重复提示
  useEffect(() => {
    const url = new URL(window.location.href); // 常量 url：保存固定配置或一次性派生值
    const bound = url.searchParams.get('oauth_bound'); // 常量 bound：保存固定配置或一次性派生值
    if (!bound) return; // 无绑定回传
    setTab('security'); // 直接落在账号与设置分区（该回传只由账号设置发起，无需改写地址栏）
    setMessage(isZh ? '第三方账号绑定成功' : 'Third-party account linked'); // 成功提示
    url.searchParams.delete('oauth_bound'); // 清理参数
    window.history.replaceState(null, '', url.pathname + url.search + url.hash); // 原地替换
  }, []);

  /** 发起绑定：跳转到提供方授权页，完成后由后端回调并回到本页 */
  async function linkProvider(providerId: string) {
    setError(null); // 清空旧错误
    setLinking(providerId); // 只禁用当前按钮
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const result = await api.oauthAuthorize(providerId, { mode: 'bind', region: user?.region, return_to: '/account' }); // 绑定模式必须带登录态
      window.location.assign(result.authorization_url); // 交给浏览器跳转
    } catch (err) {
      setError(errorText(locale, err)); // 未配置或网络失败
      setLinking(null); // 恢复可点
    } // try 结束
  } // linkProvider 结束

  /** 解绑：服务端保证至少保留一种登录方式 */
  async function unlinkProvider(providerId: string) {
    setError(null); // 清空旧错误
    setMessage(null); // 清空旧提示
    try { // 异常捕获起点：包裹可能抛出错误的操作
      await api.unlinkOAuth(providerId); // 删除绑定
      bindings.reload(); // 刷新列表
      setMessage(isZh ? '已解除绑定' : 'Unlinked'); // 成功提示
    } catch (err) {
      setError(errorText(locale, err)); // AUTH_OAUTH_LAST_METHOD 等
    } // try 结束
  } // unlinkProvider 结束

  /** 提交实名：明文姓名与证件号只发往后端，页面不落本地存储 */
  async function submitRealname(event: FormEvent) {
    event.preventDefault(); // 阻止整页刷新
    setError(null); // 清空旧错误
    setMessage(null); // 清空旧提示
    setRealBusy(true); // 禁用提交按钮
    try { // 异常捕获起点：包裹可能抛出错误的操作
      await api.realname.submit({ id_type: realIdType, name: realName.trim(), id_number: realIdNumber.trim() }); // 后端只存摘要与后四位
      setRealName(''); // 提交成功立即清空姓名输入
      setRealIdNumber(''); // 提交成功立即清空证件号输入
      realname.reload(); // 刷新审核状态
      setMessage(isZh ? '实名资料已提交，等待审核' : 'Real-name submitted for review'); // 明确后续状态
    } catch (err) {
      setError(errorText(locale, err)); // REALNAME_INVALID / REALNAME_ALREADY_SUBMITTED 等
    } finally {
      setRealBusy(false); // 恢复按钮
    } // try 结束
  } // submitRealname 结束

  /** 保存资料三项 */
  async function save(event: FormEvent) {
    event.preventDefault(); // 阻止整页刷新
    setBusy(true); // 禁用按钮
    setError(null); // 清空旧错误
    setMessage(null); // 清空旧提示
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const result = await api.updateMe({ display_name: displayName.trim(), locale: localeValue, timezone: timezone.trim() }); // 局部更新
      onUserUpdated(result.user); // 同步全局用户态
      setMessage(isZh ? '已保存 ✓' : 'Saved ✓'); // 成功提示
    } catch (err) {
      setError(errorText(locale, err)); // 失败提示
    } finally {
      setBusy(false); // 恢复按钮
    } // try 结束
  } // save 结束

  /** 注销申请 / 撤销：成功后刷新账号状态并回写结果提示 */
  async function toggleDeletion(request: boolean) {
    setError(null); // 清空旧错误
    setMessage(null); // 清空旧提示
    try { // 异常捕获起点：包裹可能抛出错误的操作
      if (request) await api.requestDeletion(); // 发起注销（进入冷静期）
      else await api.cancelDeletion(); // 撤销注销
      me.reload(); // 刷新账号状态
      setMessage(request ? (isZh ? '已提交注销申请，冷静期内可撤销' : 'Deletion requested') : isZh ? '已撤销注销申请' : 'Deletion cancelled'); // 结果提示
    } catch (err) {
      setError(errorText(locale, err)); // 失败提示
    } // try 结束
  } // toggleDeletion 结束

  /** 导出本人数据包：Blob 落本地下载，文件名按 Mim ID 与导出日期生成，不整页跳转 */
  async function exportData() {
    setError(null); // 清空旧错误
    setMessage(null); // 清空旧提示
    setExporting(true); // 进入导出中间态，防止重复点击
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const blob = await api.exportAccount(); // 读取 JSON 附件 Blob
      const filename = exportFileName(user?.member_no ?? '', new Date()); // 按号段 + 本地日期拼文件名
      const url = URL.createObjectURL(blob); // 生成本地临时对象地址
      const anchor = document.createElement('a'); // 借隐蔽 <a download> 触发浏览器保存
      anchor.href = url; // 指向本地 Blob
      anchor.download = filename; // 指定保存文件名
      document.body.appendChild(anchor); // 挂入文档后才能触发点击
      anchor.click(); // 触发下载
      anchor.remove(); // 用完即移除节点
      URL.revokeObjectURL(url); // 释放临时对象地址，避免内存泄漏
      setMessage(isZh ? '数据包已开始下载' : 'Data export started'); // 成功提示
    } catch (err) {
      setError(errorText(locale, err)); // 失败提示（无权限 / 网络异常等）
    } finally {
      setExporting(false); // 恢复按钮可点
    } // try 结束
  } // exportData 结束

  /** 提交注销申请：二次确认通过后调用，成功后收起确认面板并重置确认态 */
  async function submitDeletion() {
    await toggleDeletion(true); // 发起注销（进入冷静期）
    setConfirmOpen(false); // 收起二次确认面板
    setConfirmed(false); // 重置勾选
    setDeleteConfirmText(''); // 重置 DELETE 输入
  } // submitDeletion 结束

  /** 撤销注销：冷静期内随时恢复活跃态，并重新展开待删除横幅 */
  async function cancelDeletionRequest() {
    await toggleDeletion(false); // 撤销注销
    setBannerDismissed(false); // 横幅恢复可见
  } // cancelDeletionRequest 结束

  return ( // 返回当前函数的处理结果
    <div className="page">{/* 执行当前业务步骤 */}
      <header className="page-head">{/* 执行当前业务步骤 */}
        <h1>{isZh ? '个人中心' : 'My account'}</h1>
        {/* 分区切换 */}
        <nav className="profile-tabs">{/* 执行当前业务步骤 */}
          <button type="button" className={`tab${tab === 'profile' ? ' active' : ''}`} onClick={() => selectTab('profile')}>{isZh ? '资料' : 'Profile'}</button>
          <button type="button" className={`tab${tab === 'content' ? ' active' : ''}`} onClick={() => selectTab('content')}>{isZh ? '我的内容' : 'My content'}</button>
          <button type="button" className={`tab${tab === 'assets' ? ' active' : ''}`} onClick={() => selectTab('assets')}>{isZh ? '我的资产' : 'My assets'}</button>
          <button type="button" className={`tab${tab === 'security' ? ' active' : ''}`} onClick={() => selectTab('security')}>{isZh ? '账号与设置' : 'Account & settings'}</button>
        </nav>
      </header>

      {error ? <div className="chat-error">{error}</div> : null}
      {message ? <div className="hint">{message}</div> : null}

      {/* 分区一：资料编辑 */}
      {tab === 'profile' ? (
        me.loading ? <div className="hint">{isZh ? '加载中…' : 'Loading…'}</div> : (
          <form className="profile-form" onSubmit={save}>{/* 执行当前业务步骤 */}
            <label>{isZh ? '昵称' : 'Display name'}{/* 执行当前业务步骤 */}
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={64} required />
            </label>
            <label>{isZh ? '界面语言' : 'Language'}{/* 执行当前业务步骤 */}
              <select value={localeValue} onChange={(event) => setLocaleValue(event.target.value as Locale)}>{/* 执行当前业务步骤 */}
                <option value="zh-CN">简体中文</option>
                <option value="en-US">English</option>
              </select>
            </label>
            <label>{isZh ? '时区' : 'Timezone'}{/* 执行当前业务步骤 */}
              <input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Asia/Shanghai" />
            </label>
            <p className="hint member-line">{isZh ? 'Mim ID：' : 'Mim ID: '}<strong className="member-no">{user?.member_no ?? '-'}</strong></p>
            <button type="submit" className="btn primary" disabled={busy}>{busy ? (isZh ? '保存中…' : 'Saving…') : isZh ? '保存资料' : 'Save'}</button>
          </form>
        ) // 执行当前业务步骤
      ) : null}

      {/* 分区二：我的内容（成长等级 / 徽章 / 收藏 / 圈子 / 举报，私密读仅登录后请求） */}
      {tab === 'content' ? (
        <div className="profile-content">{/* 个人聚合区块容器 */}
          {/* 成长：当前等级 + 等级内进度条 + 已获得徽章墙 */}
          <section className="panel">{/* 成长区块 */}
            <div className="panel-head"><h2>{isZh ? '成长等级' : 'Level'}</h2></div>
            {growthLevel.loading ? (
              <ListSkeleton count={1} /> // 等级块首屏骨架：单行占位
            ) : growthLevel.data ? (
              <div>
                <p className="hint">{/* 等级名 + 累计积分 */}
                  {isZh ? '当前等级：' : 'Current level: '}
                  <strong>{growthLevel.data.level?.name ?? '-'}</strong>
                  <span className="muted"> · {isZh ? '累计积分' : 'Points'} {growthLevel.data.lifetime_points}</span>
                </p>
                {/* 进度条：轨道与填充均用既有中性变量，未新增样式类；宽度由接口进度驱动 */}
                <div style={{ width: '100%', height: 8, background: 'var(--surface-3)', borderRadius: 'var(--radius-xs)', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.max(0, Math.min(100, growthLevel.data.progress_percent))}%`, height: '100%', background: 'var(--primary)' }} />
                </div>
                <p className="muted">{/* 距下一级差值；满级给兜底文案 */}
                  {growthLevel.data.next_level
                    ? (isZh ? `距「${growthLevel.data.next_level.name}」还差 ${growthLevel.data.points_to_next} 积分` : `${growthLevel.data.points_to_next} points to ${growthLevel.data.next_level.name}`)
                    : (isZh ? '已达当前最高等级' : 'Max level reached')}
                </p>
              </div>
            ) : (
              <p className="muted">{isZh ? '等级信息暂不可用' : 'Level info unavailable'}</p>
            )}
            {growthLevel.error ? <div className="chat-error">{errorText(locale, growthLevel.error)}</div> : null}

            {/* 徽章墙：只展示已获得徽章；未获得徽章不在前台占位（理由见交付说明），文案全部取接口名称 */}
            <h3>{isZh ? '我的徽章' : 'My badges'}</h3>
            {growthBadges.loading ? (
              <ListSkeleton count={3} /> // 徽章区首屏骨架
            ) : (growthBadges.data?.badges ?? []).filter((badge) => badge.awarded).length === 0 ? (
              <EmptyState kind="cap" title={isZh ? '还没有徽章' : 'No badges yet'} hint={isZh ? '签到、发帖、累计积分等行为达成条件后自动获得徽章。' : 'Earn badges by checking in, posting and reaching point milestones.'} />
            ) : (
              <div className="oauth-grid">{/* 复用既有按钮网格排布徽章 */}
                {(growthBadges.data?.badges ?? [])
                  .filter((badge) => badge.awarded)
                  .map((badge) => (
                    <span key={badge.code} className="deploy-badge" title={badge.description}>{badge.icon} {badge.name}</span>
                  ))}
              </div>
            )}
            {growthBadges.error ? <div className="chat-error">{errorText(locale, growthBadges.error)}</div> : null}
          </section>

          {/* 我的收藏：标题 / 所属板块 / 收藏时间，点击进帖子详情 */}
          <section className="panel">{/* 收藏区块 */}
            <div className="panel-head"><h2>{isZh ? '我的收藏' : 'Favorites'}</h2></div>
            {favorites.loading ? (
              <ListSkeleton count={3} /> // 收藏列表首屏骨架
            ) : (favorites.data?.items ?? []).length === 0 ? (
              <EmptyState
                kind="love"
                title={isZh ? '还没有收藏' : 'No favorites yet'}
                hint={isZh ? '逛社区时收藏感兴趣的帖子，这里会集中展示。' : 'Save threads you like and find them here.'}
                action={<button type="button" className="btn ghost" onClick={() => navigatePath(pathOf('community'))}>{isZh ? '去社区逛逛' : 'Browse community'}</button>}
              />
            ) : (
              <ul className="plain-list">{/* 收藏帖列表 */}
                {(favorites.data?.items ?? []).map((thread) => (
                  <li className="deploy-row" key={thread.id} onClick={() => openThread(thread.id)}>{/* 整行点击进详情 */}
                    <span>{thread.title}</span>
                    <span className="muted">{thread.board_name} · {day(thread.favorited_at)}</span>
                  </li>
                ))}
              </ul>
            )}
            {favorites.error ? <div className="chat-error">{errorText(locale, favorites.error)}</div> : null}
          </section>

          {/* 我加入的圈子：名称 / 我的角色 / 成员数，点击进圈子详情；成员标记由列表项 i_am_member 前端筛选 */}
          <section className="panel">{/* 圈子区块 */}
            <div className="panel-head"><h2>{isZh ? '我加入的圈子' : 'My circles'}</h2></div>
            {joinedCircles.loading ? (
              <ListSkeleton count={3} /> // 圈子列表首屏骨架
            ) : (joinedCircles.data?.items ?? []).filter((circle) => circle.i_am_member).length === 0 ? (
              <EmptyState
                kind="user"
                title={isZh ? '还没有加入圈子' : 'No circles joined'}
                hint={isZh ? '加入感兴趣的圈子，和成员一起交流。' : 'Join circles to connect with members.'}
                action={<button type="button" className="btn ghost" onClick={() => navigatePath(pathOf('circles'))}>{isZh ? '发现圈子' : 'Discover circles'}</button>}
              />
            ) : (
              <ul className="plain-list">{/* 已加入圈子列表 */}
                {(joinedCircles.data?.items ?? [])
                  .filter((circle) => circle.i_am_member)
                  .map((circle) => (
                    <li className="deploy-row" key={circle.slug} onClick={() => openCircle(circle.slug)}>{/* 整行点击进圈子详情 */}
                      <span>{circle.name}</span>
                      <span className="muted">{circleRoleLabel(isZh, circle.my_role)} · {isZh ? '成员' : 'Members'} {circle.member_count}</span>
                    </li>
                  ))}
              </ul>
            )}
            {joinedCircles.error ? <div className="chat-error">{errorText(locale, joinedCircles.error)}</div> : null}
          </section>

          {/* 我的举报：理由 / 详情 / 状态 / 时间，关联帖子可点击跳转 */}
          <section className="panel">{/* 举报区块 */}
            <div className="panel-head"><h2>{isZh ? '我的举报' : 'My reports'}</h2></div>
            {myReports.loading ? (
              <ListSkeleton count={3} /> // 举报列表首屏骨架
            ) : (myReports.data?.items ?? []).length === 0 ? (
              <EmptyState kind="cap" title={isZh ? '还没有提交举报' : 'No reports'} hint={isZh ? '发现违规内容时可在帖子或回复上提交举报，处理进度会展示在这里。' : 'Report violating content here; status shows up here.'} />
            ) : (
              <ul className="plain-list">{/* 举报单列表 */}
                {(myReports.data?.items ?? []).map((report) => (
                  <li className="deploy-row" key={report.id}>{/* 单行举报单 */}
                    <span>
                      <span className="deploy-badge">{REPORT_REASON[report.reason] ?? report.reason}</span>
                      {` · ${report.thread_title ?? (report.target_type === 'post' ? (isZh ? '回复' : 'Post') : (isZh ? '帖子' : 'Thread'))}`}
                      {report.detail ? ` — ${report.detail}` : null}
                    </span>
                    <span className="muted">
                      <span className={`deploy-badge${report.status === 'resolved' ? ' ok' : report.status === 'dismissed' ? ' muted' : ''}`}>{REPORT_STATUS[report.status] ?? report.status}</span>
                      {' '}{day(report.created_at)}
                      {report.resolved_at ? ` · ${isZh ? '处理于' : 'Resolved'} ${day(report.resolved_at)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {myReports.error ? <div className="chat-error">{errorText(locale, myReports.error)}</div> : null}
          </section>
        </div>
      ) : null}

      {/* 分区三：我的资产（付费资产域，仅登录后可见；?tab=assets 可直达） */}
      {tab === 'assets' ? (
        <MyAssets locale={locale} />
      ) : null}

      {/* 分区四：账号与设置（原独立「设置」页的内容并入此处，仅登录后可见） */}
      {tab === 'security' ? (
        <section className="profile-security">{/* 执行当前业务步骤 */}
          <p className="hint">{/* 执行当前业务步骤 */}
            {isZh ? '登录状态由服务端安全维护，退出登录后会话立即失效；注销账号进入冷静期，期内可撤销。' : 'Your session is secured by the server and ends immediately on sign-out.'}
          </p>
          <p className="hint member-line">{isZh ? 'Mim ID：' : 'Mim ID: '}<strong className="member-no">{user?.member_no ?? '-'}</strong></p>
          <p className="hint">{/* 执行当前业务步骤 */}
            {isZh ? '注销后账号进入冷静期，到期执行物理删除；冷静期内可随时撤销。删除后资料、权益、内容与订单不可恢复。' : 'Deletion enters a cooling-off period; you can cancel it before it executes.'}
          </p>

          {/* 待删除态：冷静期横幅，展示预约时刻、剩余倒计时与撤销 / 导出入口 */}
          {pending && !bannerDismissed && pendingAt ? (
            <div className="panel deletion-banner">{/* 待删除横幅容器 */}
              <p className="warning">
                {isZh
                  ? `将于 ${formatDateTime(pendingAt)} 删除（${formatRemaining(new Date(pendingAt).getTime() - Date.now())}）`
                  : `Scheduled for deletion at ${formatDateTime(pendingAt)} (${formatRemaining(new Date(pendingAt).getTime() - Date.now())})`}
              </p>
              <div className="deploy-columns">{/* 横幅操作行：撤销 / 导出 / 知道了 */}
                <button type="button" className="btn primary" onClick={() => void cancelDeletionRequest()}>{isZh ? '撤销注销' : 'Cancel deletion'}</button>
                <button type="button" className="btn ghost" disabled={exporting} onClick={() => void exportData()}>
                  {exporting ? (isZh ? '导出中…' : 'Exporting…') : (isZh ? '导出我的数据' : 'Export my data')}
                </button>
                <button type="button" className="btn ghost" onClick={() => setBannerDismissed(true)}>{isZh ? '知道了' : 'Dismiss'}</button>
              </div>
            </div>
          ) : null}

          {/* 已到期：账号删除提示，不再展示注销 / 撤销入口 */}
          {overdue ? (
            <p className="chat-error">{isZh ? '账号已删除，请重新注册。' : 'Account has been deleted. Please sign up again.'}</p>
          ) : null}

          {/* 活跃态：导出入口常驻；注销账号必须勾选不可恢复并输入 DELETE 二次确认 */}
          {!pending && !overdue ? (
            <div className="deletion-actions">{/* 活跃态账号操作行 */}
              <button type="button" className="btn ghost" disabled={exporting} onClick={() => void exportData()}>
                {exporting ? (isZh ? '导出中…' : 'Exporting…') : (isZh ? '导出我的数据' : 'Export my data')}
              </button>
              {!confirmOpen ? (
                <button type="button" className="btn ghost" onClick={() => setConfirmOpen(true)}>{isZh ? '注销账号' : 'Delete account'}</button>
              ) : (
                <div className="panel deletion-confirm">{/* 二次确认面板 */}
                  <p className="warning">{isZh ? '注销后账号进入冷静期，到期执行物理删除；资料、权益、内容与订单不可恢复。' : 'After the cooling-off period your profile, benefits, content and orders are physically deleted and cannot be restored.'}</p>
                  <label className="hint">
                    <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                    {isZh ? '我已知晓数据将不可恢复' : 'I understand the data cannot be recovered'}
                  </label>
                  <label className="profile-form">
                    {isZh ? '输入 DELETE 确认' : 'Type DELETE to confirm'}
                    <input value={deleteConfirmText} onChange={(event) => setDeleteConfirmText(event.target.value)} autoComplete="off" placeholder="DELETE" />
                  </label>
                  <div className="deploy-columns">{/* 确认操作行：提交 / 取消 */}
                    <button
                      type="button"
                      className="btn primary"
                      disabled={!confirmed || deleteConfirmText !== 'DELETE' || busy}
                      onClick={() => void submitDeletion()}
                    >
                      {busy ? (isZh ? '提交中…' : 'Submitting…') : (isZh ? '确认注销' : 'Confirm deletion')}
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => { setConfirmOpen(false); setConfirmed(false); setDeleteConfirmText(''); }}
                    >
                      {isZh ? '取消' : 'Cancel'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {/* 实名认证：本人提交，服务端仅保存摘要与后四位；待审/已通过不再展示表单 */}
          <div className="realname-box">{/* 执行当前业务步骤 */}
            <h2>{isZh ? '实名认证' : 'Identity verification'}</h2>
            {realname.loading ? (
              <div className="hint">{isZh ? '加载中…' : 'Loading…'}</div>
            ) : realname.data?.record ? (
              <div className="realname-status">{/* 执行当前业务步骤 */}
                <p className="hint">{/* 执行当前业务步骤 */}
                  {isZh ? '状态：' : 'Status: '}
                  <span className={`tag${realname.data.record.status === 'approved' ? ' ok' : ''}`}>{/* 执行当前业务步骤 */}
                    {realname.data.record.status === 'approved' ? (isZh ? '已通过' : 'Approved') : realname.data.record.status === 'pending' ? (isZh ? '审核中' : 'Pending') : (isZh ? '已驳回' : 'Rejected')}
                  </span>
                </p>
                <p className="hint">{isZh ? '姓名：' : 'Name: '}{realname.data.record.name_masked}　{isZh ? '证件后四位：' : 'ID last 4: '}{realname.data.record.id_last4}</p>
                {realname.data.record.reject_reason ? <p className="chat-error">{isZh ? '驳回原因：' : 'Reason: '}{realname.data.record.reject_reason}</p> : null}
                {realname.data.record.status === 'rejected' ? (
                  <p className="hint">{isZh ? '可在下方修改资料后重新提交。' : 'You can correct the details and resubmit below.'}</p>
                ) : null}
              </div>
            ) : (
              <p className="hint">{isZh ? '本部署未接入第三方核验，提交后进入人工审核。' : 'Manual review is used on this deployment.'}</p>
            )}
            {!realname.loading && (!realname.data?.record || realname.data.record.status === 'rejected') ? (
              <form className="profile-form realname-form" onSubmit={submitRealname}>{/* 执行当前业务步骤 */}
                <label>{isZh ? '证件类型' : 'Document type'}{/* 执行当前业务步骤 */}
                  <select value={realIdType} onChange={(event) => setRealIdType(event.target.value as 'id_card' | 'passport' | 'other')}>{/* 执行当前业务步骤 */}
                    <option value="id_card">{isZh ? '身份证' : 'ID card'}</option>
                    <option value="passport">{isZh ? '护照' : 'Passport'}</option>
                    <option value="other">{isZh ? '其他证件' : 'Other'}</option>
                  </select>
                </label>
                <label>{isZh ? '真实姓名' : 'Legal name'}{/* 执行当前业务步骤 */}
                  <input value={realName} onChange={(event) => setRealName(event.target.value)} minLength={2} maxLength={30} required autoComplete="name" />
                </label>
                <label>{isZh ? '证件号码' : 'Document number'}{/* 执行当前业务步骤 */}
                  <input value={realIdNumber} onChange={(event) => setRealIdNumber(event.target.value)} maxLength={32} required autoComplete="off" />
                </label>
                <button type="submit" className="btn primary" disabled={realBusy}>{realBusy ? (isZh ? '提交中…' : 'Submitting…') : isZh ? '提交实名认证' : 'Submit for verification'}</button>
              </form>
            ) : null}
            {realname.error ? <div className="chat-error">{errorText(locale, realname.error)}</div> : null}
          </div>

          {/* 第三方登录绑定：绑定后可一键登录，解绑受「至少保留一种方式」约束 */}
          <div className="oauth-bindings">{/* 执行当前业务步骤 */}
            <h2>{isZh ? '第三方登录' : 'Third-party sign-in'}</h2>
            <p className="hint">{/* 执行当前业务步骤 */}
              {isZh
                ? '绑定后可用对应平台一键登录；解绑时服务端会校验至少保留一种可用登录方式。'
                : 'Link providers for one-tap sign-in. At least one sign-in method must remain.'}
            </p>
            {bindings.loading ? (
              <div className="hint">{isZh ? '加载中…' : 'Loading…'}</div>
            ) : (
              <ul className="oauth-list">{/* 执行当前业务步骤 */}
                {(bindings.data?.accounts ?? []).length === 0 ? (
                  <li className="hint">{isZh ? '尚未绑定任何第三方账号。' : 'No linked accounts yet.'}</li>
                ) : null}
                {(bindings.data?.accounts ?? []).map((account) => {
                  const spec = providers.find((item) => item.id === account.provider); // 取展示名
                  return ( // 返回当前函数的处理结果
                    <li key={account.provider}>{/* 执行当前业务步骤 */}
                      <span className="oauth-name">{spec ? (isZh ? spec.label : spec.label_en) : account.provider}</span>
                      <span className="hint">{account.nickname}{account.email ? ` · ${account.email}` : ''}</span>
                      <span className="hint">{new Date(account.created_at).toLocaleDateString()}</span>
                      <button type="button" className="btn ghost" disabled={linking !== null} onClick={() => void unlinkProvider(account.provider)}>{/* 执行当前业务步骤 */}
                        {isZh ? '解绑' : 'Unlink'}
                      </button>
                    </li>
                  ); // 执行当前业务步骤
                })}
              </ul>
            )}
            {bindings.error ? <div className="chat-error">{errorText(locale, bindings.error)}</div> : null}
            <div className="oauth-grid">{/* 执行当前业务步骤 */}
              {providers
                .filter((item) => item.configured && !(bindings.data?.accounts ?? []).some((account) => account.provider === item.id)) // 只列可绑定且未绑定的
                .map((item) => (
                  <button key={item.id} type="button" className="btn ghost oauth-btn" disabled={linking !== null} onClick={() => void linkProvider(item.id)}>{/* 执行当前业务步骤 */}
                    {linking === item.id
                      ? (isZh ? '跳转中…' : 'Redirecting…')
                      : (isZh ? `绑定 ${item.label}` : `Link ${item.label_en}`)}
                  </button>
                ))}
            </div>
            {providers.some((item) => !item.configured) ? (
              <p className="hint">{/* 执行当前业务步骤 */}
                {isZh
                  ? `本部署还有 ${providers.filter((item) => !item.configured).length} 家提供方未配置凭证；补齐环境变量后会自动出现在这里。`
                  : `${providers.filter((item) => !item.configured).length} provider(s) are not configured on this deployment.`}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  ); // 执行当前业务步骤
} // Profile 结束
