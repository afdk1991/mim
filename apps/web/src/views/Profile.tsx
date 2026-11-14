// 引入状态钩子：资料表单、四个分区数据与提交中间态
import { useEffect, useState } from 'react';
// 引入 FormEvent 类型
import type { FormEvent } from 'react';
// 引入语言类型
import type { Locale } from '@mim/i18n';
// 引入接口集合与错误文案翻译
import { api, errorText } from '../api';
// 引入用户信息类型：资料保存成功后回传上层刷新全局显示
import type { OAuthProviderInfo, UserInfo } from '../api';
// 引入通用异步加载钩子
import { useAsync } from '../hooks';

/** 组件契约：语言 + 用户更新回调 */
interface Props {
  locale: Locale; // 当前界面语言
  onUserUpdated: (user: UserInfo) => void; // 资料保存后同步全局用户态
} // Props 结束

/** 四个分区标识 */
type Tab = 'profile' | 'entitlements' | 'orders' | 'security';

/** 金额格式化 */
function money(currency: string, amountMinor: number): string {
  const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : `${currency} `; // 常见币种用符号
  return `${symbol}${(amountMinor / 100).toFixed(2)}`; // 分 → 主单位
} // money 结束

/** 个人中心：资料编辑 / 我的权益 / 我的订单 / 账号安全 四块 */
export function Profile({ locale, onUserUpdated }: Props) {
  const isZh = locale !== 'en-US'; // 是否中文文案
  const [tab, setTab] = useState<Tab>('profile'); // 当前分区
  const me = useAsync(() => api.me(), []); // 我的资料
  const entitlements = useAsync(() => api.catalog.getMyEntitlements(), []); // 我的权益
  const orders = useAsync(() => api.commerce.orders({ source: 'module' }), []); // 我的订单（统一只读接口，仅模块线）
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

  const user = me.data?.user; // 当前用户
  const isGuest = !!user?.is_guest; // 访客没有正式账号凭据：账号与设置只在登录后的个人中心出现

  // 访客若因回调落到账号设置分区，自动回到资料分区，避免出现空白页
  useEffect(() => {
    if (isGuest && tab === 'security') setTab('profile'); // 条件分支：按判断结果选择后续处理路径
  }, [isGuest, tab]);

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
    setTab('security'); // 直接落在账号与设置分区
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

  /** 取消待结算订单 */
  async function cancelOrder(id: string) {
    setError(null); // 清空旧错误
    try { // 异常捕获起点：包裹可能抛出错误的操作
      await api.catalog.cancelOrder(id); // 取消接口
      orders.reload(); // 刷新订单列表
    } catch (err) {
      setError(errorText(locale, err)); // 失败提示
    } // try 结束
  } // cancelOrder 结束

  /** 注销申请 / 撤销 */
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

  return ( // 返回当前函数的处理结果
    <div className="page">{/* 执行当前业务步骤 */}
      <header className="page-head">{/* 执行当前业务步骤 */}
        <h1>{isZh ? '个人中心' : 'My account'}</h1>
        {/* 分区切换 */}
        <nav className="profile-tabs">{/* 执行当前业务步骤 */}
          <button type="button" className={`tab${tab === 'profile' ? ' active' : ''}`} onClick={() => setTab('profile')}>{isZh ? '资料' : 'Profile'}</button>
          <button type="button" className={`tab${tab === 'entitlements' ? ' active' : ''}`} onClick={() => setTab('entitlements')}>{isZh ? '我的权益' : 'Entitlements'}</button>
          <button type="button" className={`tab${tab === 'orders' ? ' active' : ''}`} onClick={() => setTab('orders')}>{isZh ? '我的订单' : 'Orders'}</button>
          {!isGuest && (
            <button type="button" className={`tab${tab === 'security' ? ' active' : ''}`} onClick={() => setTab('security')}>{isZh ? '账号与设置' : 'Account & settings'}</button>
          )}
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
            <p className="hint">{isZh ? `内部 ID：${user?.id.slice(0, 8) ?? '-'}　区域：${user?.region === 'cn' ? '中国区' : 'Global'}　状态：${user?.status ?? '-'}` : `Internal ID ${user?.id.slice(0, 8) ?? '-'} · ${user?.region ?? '-'} · ${user?.status ?? '-'}`}</p>
            <button type="submit" className="btn primary" disabled={busy}>{busy ? (isZh ? '保存中…' : 'Saving…') : isZh ? '保存资料' : 'Save'}</button>
          </form>
        ) // 执行当前业务步骤
      ) : null}

      {/* 分区二：我的权益 */}
      {tab === 'entitlements' ? (
        entitlements.loading ? <div className="hint">{isZh ? '加载中…' : 'Loading…'}</div> : (
          <>{/* 执行当前业务步骤 */}
            {entitlements.error ? <div className="chat-error">{errorText(locale, entitlements.error)}</div> : null}
            {(entitlements.data?.entitlements ?? []).length === 0 ? <div className="hint">{isZh ? '还没有解锁任何模块。' : 'No entitlements yet.'}</div> : null}
            {(entitlements.data?.entitlements ?? []).length > 0 ? (
              <table className="products-table">{/* 执行当前业务步骤 */}
                <thead>{/* 执行当前业务步骤 */}
                  <tr>{/* 执行当前业务步骤 */}
                    <th>{isZh ? '模块' : 'Module'}</th>
                    <th>{isZh ? '状态' : 'Status'}</th>
                    <th>{isZh ? '到期' : 'Expires'}</th>
                    <th>{isZh ? '获得时间' : 'Granted'}</th>
                  </tr>
                </thead>
                <tbody>{/* 执行当前业务步骤 */}
                  {(entitlements.data?.entitlements ?? []).map((item) => (
                    <tr key={item.id}>{/* 执行当前业务步骤 */}
                      <td>{/* 执行当前业务步骤 */}
                        <div className="products-name">{item.module_name[locale] ?? item.module_name['zh-CN'] ?? item.module_code}</div>
                        <div className="products-code">{item.module_code}</div>
                      </td>
                      <td><span className={`tag${item.status === 'active' ? ' ok' : ''}`}>{item.status}</span></td>
                      <td>{item.expires_at ?? (isZh ? '永久' : 'Permanent')}</td>
                      <td>{new Date(item.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </>
        ) // 执行当前业务步骤
      ) : null}

      {/* 分区三：我的订单 */}
      {tab === 'orders' ? (
        orders.loading ? <div className="hint">{isZh ? '加载中…' : 'Loading…'}</div> : (
          <>{/* 执行当前业务步骤 */}
            {orders.error ? <div className="chat-error">{errorText(locale, orders.error)}</div> : null}
            {((orders.data?.items ?? []).length === 0) ? <div className="hint">{isZh ? '还没有订单。' : 'No orders yet.'}</div> : null}
            {((orders.data?.items ?? []).length > 0) ? (
              <table className="products-table">{/* 执行当前业务步骤 */}
                <thead>{/* 执行当前业务步骤 */}
                  <tr>{/* 执行当前业务步骤 */}
                    <th>{isZh ? '模块' : 'Module'}</th>
                    <th>{isZh ? '金额' : 'Amount'}</th>
                    <th>{isZh ? '状态' : 'Status'}</th>
                    <th>{isZh ? '下单时间' : 'Created'}</th>
                    <th>{isZh ? '操作' : 'Action'}</th>
                  </tr>
                </thead>
                <tbody>{/* 执行当前业务步骤 */}
                  {(orders.data?.items ?? []).map((order) => {
                    const first = order.items[0]; // 模块线一单一件，取首件快照名与编码
                    return (
                    <tr key={order.id}>{/* 执行当前业务步骤 */}
                      <td>{/* 执行当前业务步骤 */}
                        <div className="products-name">{first?.title ?? order.product_code ?? order.id}</div>
                        <div className="products-code">{order.product_code ?? '—'}</div>
                      </td>
                      <td>{money(order.currency, order.total_cents)}</td>
                      <td><span className={`tag${order.status === 'paid' ? ' ok' : ''}`}>{order.status}</span></td>
                      <td>{new Date(order.created_at).toLocaleDateString()}</td>
                      <td>{/* 执行当前业务步骤 */}
                        {order.status === 'pending' ? (
                          <button type="button" className="btn ghost" onClick={() => void cancelOrder(order.source_id)}>{isZh ? '取消' : 'Cancel'}</button>
                        ) : null}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : null}
          </>
        ) // 执行当前业务步骤
      ) : null}

      {/* 分区四：账号与设置（原独立「设置」页的内容并入此处，仅登录后可见） */}
      {tab === 'security' && !isGuest ? (
        <section className="profile-security">{/* 执行当前业务步骤 */}
          <p className="hint">{/* 执行当前业务步骤 */}
            {isZh ? '登录凭据由服务端签发 JWT，退出登录会吊销 refresh_token；注销账号进入冷静期，期内可撤销。' : 'Sessions are JWT based; signing out revokes the refresh token.'}
          </p>
          <p className="hint member-line">{isZh ? 'Mim ID：' : 'Mim ID: '}<strong className="member-no">{user?.member_no ?? '-'}</strong></p>
          <p className="hint">{/* 执行当前业务步骤 */}
            {isZh ? `内部 ID：${user?.id.slice(0, 8) ?? '-'}　区域：${user?.region === 'cn' ? '中国区' : 'Global'}　状态：${user?.status ?? '-'}` : `Internal ID ${user?.id.slice(0, 8) ?? '-'} · ${user?.region === 'cn' ? 'CN' : 'Global'} · ${user?.status ?? '-'}`}
          </p>
          <p className="hint">{/* 执行当前业务步骤 */}
            {isZh ? '注销后账号进入冷静期，到期执行删除；冷静期内可随时撤销。删除后资料与权益不可恢复。' : 'Deletion enters a cooling-off period; you can cancel it before it executes.'}
          </p>
          <p className="hint">{/* 执行当前业务步骤 */}
            {isZh ? `当前账号状态：${user?.status ?? '-'}` : `Status: ${user?.status ?? '-'}`}
            {user?.deletion_scheduled_at ? `　${isZh ? '注销生效时间' : 'Deletion at'}：${new Date(user.deletion_scheduled_at).toLocaleString()}` : ''}
          </p>
          {user?.status === 'deleting' || user?.deletion_scheduled_at ? (
            <button type="button" className="btn primary" onClick={() => void toggleDeletion(false)}>{isZh ? '撤销注销申请' : 'Cancel deletion'}</button>
          ) : (
            <button
              type="button" // 赋值：更新变量 type 的取值
              className="btn ghost"
              onClick={() => {
                if (window.confirm(isZh ? '确定申请注销账号？冷静期内可撤销。' : 'Request account deletion?')) void toggleDeletion(true); // 不可逆操作先确认
              }}
            >
              {isZh ? '申请注销账号' : 'Request deletion'}
            </button>
          )}

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
