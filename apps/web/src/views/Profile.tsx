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
  const orders = useAsync(() => api.catalog.getMyOrders(), []); // 我的订单
  const [displayName, setDisplayName] = useState(''); // 昵称编辑值
  const [localeValue, setLocaleValue] = useState<Locale>('zh-CN'); // 语言编辑值
  const [timezone, setTimezone] = useState(''); // 时区编辑值
  const [busy, setBusy] = useState(false); // 提交中间态
  const [error, setError] = useState<string | null>(null); // 错误提示
  const [message, setMessage] = useState<string | null>(null); // 成功提示
  const bindings = useAsync(() => api.oauthBindings(), []); // 已绑定的第三方身份
  const [providers, setProviders] = useState<OAuthProviderInfo[]>([]); // 可绑定的第三方清单
  const [linking, setLinking] = useState<string | null>(null); // 正在跳转的提供方

  const user = me.data?.user; // 当前用户

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
    const url = new URL(window.location.href);
    const bound = url.searchParams.get('oauth_bound');
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
    try {
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
    try {
      await api.unlinkOAuth(providerId); // 删除绑定
      bindings.reload(); // 刷新列表
      setMessage(isZh ? '已解除绑定' : 'Unlinked'); // 成功提示
    } catch (err) {
      setError(errorText(locale, err)); // AUTH_OAUTH_LAST_METHOD 等
    } // try 结束
  } // unlinkProvider 结束

  /** 保存资料三项 */
  async function save(event: FormEvent) {
    event.preventDefault(); // 阻止整页刷新
    setBusy(true); // 禁用按钮
    setError(null); // 清空旧错误
    setMessage(null); // 清空旧提示
    try {
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
    try {
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
    try {
      if (request) await api.requestDeletion(); // 发起注销（进入冷静期）
      else await api.cancelDeletion(); // 撤销注销
      me.reload(); // 刷新账号状态
      setMessage(request ? (isZh ? '已提交注销申请，冷静期内可撤销' : 'Deletion requested') : isZh ? '已撤销注销申请' : 'Deletion cancelled'); // 结果提示
    } catch (err) {
      setError(errorText(locale, err)); // 失败提示
    } // try 结束
  } // toggleDeletion 结束

  return (
    <div className="page">
      <header className="page-head">
        <h1>{isZh ? '个人中心' : 'My account'}</h1>
        {/* 分区切换 */}
        <nav className="profile-tabs">
          <button type="button" className={`tab${tab === 'profile' ? ' active' : ''}`} onClick={() => setTab('profile')}>{isZh ? '资料' : 'Profile'}</button>
          <button type="button" className={`tab${tab === 'entitlements' ? ' active' : ''}`} onClick={() => setTab('entitlements')}>{isZh ? '我的权益' : 'Entitlements'}</button>
          <button type="button" className={`tab${tab === 'orders' ? ' active' : ''}`} onClick={() => setTab('orders')}>{isZh ? '我的订单' : 'Orders'}</button>
          <button type="button" className={`tab${tab === 'security' ? ' active' : ''}`} onClick={() => setTab('security')}>{isZh ? '账号与设置' : 'Account & settings'}</button>
        </nav>
      </header>

      {error ? <div className="chat-error">{error}</div> : null}
      {message ? <div className="hint">{message}</div> : null}

      {/* 分区一：资料编辑 */}
      {tab === 'profile' ? (
        me.loading ? <div className="hint">{isZh ? '加载中…' : 'Loading…'}</div> : (
          <form className="profile-form" onSubmit={save}>
            <label>{isZh ? '昵称' : 'Display name'}
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={64} required />
            </label>
            <label>{isZh ? '界面语言' : 'Language'}
              <select value={localeValue} onChange={(event) => setLocaleValue(event.target.value as Locale)}>
                <option value="zh-CN">简体中文</option>
                <option value="en-US">English</option>
              </select>
            </label>
            <label>{isZh ? '时区' : 'Timezone'}
              <input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Asia/Shanghai" />
            </label>
            <p className="hint member-line">{isZh ? 'Mim ID：' : 'Mim ID: '}<strong className="member-no">{user?.member_no ?? '-'}</strong></p>
            <p className="hint">{isZh ? `内部 ID：${user?.id.slice(0, 8) ?? '-'}　区域：${user?.region === 'cn' ? '中国区' : 'Global'}　状态：${user?.status ?? '-'}` : `Internal ID ${user?.id.slice(0, 8) ?? '-'} · ${user?.region ?? '-'} · ${user?.status ?? '-'}`}</p>
            <button type="submit" className="btn primary" disabled={busy}>{busy ? (isZh ? '保存中…' : 'Saving…') : isZh ? '保存资料' : 'Save'}</button>
          </form>
        )
      ) : null}

      {/* 分区二：我的权益 */}
      {tab === 'entitlements' ? (
        entitlements.loading ? <div className="hint">{isZh ? '加载中…' : 'Loading…'}</div> : (
          <>
            {entitlements.error ? <div className="chat-error">{errorText(locale, entitlements.error)}</div> : null}
            {(entitlements.data?.entitlements ?? []).length === 0 ? <div className="hint">{isZh ? '还没有解锁任何模块。' : 'No entitlements yet.'}</div> : null}
            {(entitlements.data?.entitlements ?? []).length > 0 ? (
              <table className="products-table">
                <thead>
                  <tr>
                    <th>{isZh ? '模块' : 'Module'}</th>
                    <th>{isZh ? '状态' : 'Status'}</th>
                    <th>{isZh ? '到期' : 'Expires'}</th>
                    <th>{isZh ? '获得时间' : 'Granted'}</th>
                  </tr>
                </thead>
                <tbody>
                  {(entitlements.data?.entitlements ?? []).map((item) => (
                    <tr key={item.id}>
                      <td>
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
        )
      ) : null}

      {/* 分区三：我的订单 */}
      {tab === 'orders' ? (
        orders.loading ? <div className="hint">{isZh ? '加载中…' : 'Loading…'}</div> : (
          <>
            {orders.error ? <div className="chat-error">{errorText(locale, orders.error)}</div> : null}
            {(orders.data?.orders ?? []).length === 0 ? <div className="hint">{isZh ? '还没有订单。' : 'No orders yet.'}</div> : null}
            {(orders.data?.orders ?? []).length > 0 ? (
              <table className="products-table">
                <thead>
                  <tr>
                    <th>{isZh ? '模块' : 'Module'}</th>
                    <th>{isZh ? '金额' : 'Amount'}</th>
                    <th>{isZh ? '状态' : 'Status'}</th>
                    <th>{isZh ? '下单时间' : 'Created'}</th>
                    <th>{isZh ? '操作' : 'Action'}</th>
                  </tr>
                </thead>
                <tbody>
                  {(orders.data?.orders ?? []).map((order) => (
                    <tr key={order.id}>
                      <td>
                        <div className="products-name">{order.module_name[locale] ?? order.module_name['zh-CN'] ?? order.module_code}</div>
                        <div className="products-code">{order.module_code}</div>
                      </td>
                      <td>{money(order.currency, order.amount_minor)}</td>
                      <td><span className={`tag${order.status === 'paid' ? ' ok' : ''}`}>{order.status}</span></td>
                      <td>{new Date(order.created_at).toLocaleDateString()}</td>
                      <td>
                        {order.status === 'pending' ? (
                          <button type="button" className="btn ghost" onClick={() => void cancelOrder(order.id)}>{isZh ? '取消' : 'Cancel'}</button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </>
        )
      ) : null}

      {/* 分区四：账号与设置（原独立「设置」页的内容并入此处，仅登录后可见） */}
      {tab === 'security' ? (
        <section className="profile-security">
          <p className="hint">
            {isZh ? '登录凭据由服务端签发 JWT，退出登录会吊销 refresh_token；注销账号进入冷静期，期内可撤销。' : 'Sessions are JWT based; signing out revokes the refresh token.'}
          </p>
          <p className="hint member-line">{isZh ? 'Mim ID：' : 'Mim ID: '}<strong className="member-no">{user?.member_no ?? '-'}</strong></p>
          <p className="hint">
            {isZh ? `内部 ID：${user?.id.slice(0, 8) ?? '-'}　区域：${user?.region === 'cn' ? '中国区' : 'Global'}　状态：${user?.status ?? '-'}` : `Internal ID ${user?.id.slice(0, 8) ?? '-'} · ${user?.region === 'cn' ? 'CN' : 'Global'} · ${user?.status ?? '-'}`}
          </p>
          <p className="hint">
            {isZh ? '注销后账号进入冷静期，到期执行删除；冷静期内可随时撤销。删除后资料与权益不可恢复。' : 'Deletion enters a cooling-off period; you can cancel it before it executes.'}
          </p>
          <p className="hint">
            {isZh ? `当前账号状态：${user?.status ?? '-'}` : `Status: ${user?.status ?? '-'}`}
            {user?.deletion_scheduled_at ? `　${isZh ? '注销生效时间' : 'Deletion at'}：${new Date(user.deletion_scheduled_at).toLocaleString()}` : ''}
          </p>
          {user?.status === 'deleting' || user?.deletion_scheduled_at ? (
            <button type="button" className="btn primary" onClick={() => void toggleDeletion(false)}>{isZh ? '撤销注销申请' : 'Cancel deletion'}</button>
          ) : (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                if (window.confirm(isZh ? '确定申请注销账号？冷静期内可撤销。' : 'Request account deletion?')) void toggleDeletion(true); // 不可逆操作先确认
              }}
            >
              {isZh ? '申请注销账号' : 'Request deletion'}
            </button>
          )}

          {/* 第三方登录绑定：绑定后可一键登录，解绑受「至少保留一种方式」约束 */}
          <div className="oauth-bindings">
            <h2>{isZh ? '第三方登录' : 'Third-party sign-in'}</h2>
            <p className="hint">
              {isZh
                ? '绑定后可用对应平台一键登录；解绑时服务端会校验至少保留一种可用登录方式。'
                : 'Link providers for one-tap sign-in. At least one sign-in method must remain.'}
            </p>
            {bindings.loading ? (
              <div className="hint">{isZh ? '加载中…' : 'Loading…'}</div>
            ) : (
              <ul className="oauth-list">
                {(bindings.data?.accounts ?? []).length === 0 ? (
                  <li className="hint">{isZh ? '尚未绑定任何第三方账号。' : 'No linked accounts yet.'}</li>
                ) : null}
                {(bindings.data?.accounts ?? []).map((account) => {
                  const spec = providers.find((item) => item.id === account.provider); // 取展示名
                  return (
                    <li key={account.provider}>
                      <span className="oauth-name">{spec ? (isZh ? spec.label : spec.label_en) : account.provider}</span>
                      <span className="hint">{account.nickname}{account.email ? ` · ${account.email}` : ''}</span>
                      <span className="hint">{new Date(account.created_at).toLocaleDateString()}</span>
                      <button type="button" className="btn ghost" disabled={linking !== null} onClick={() => void unlinkProvider(account.provider)}>
                        {isZh ? '解绑' : 'Unlink'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {bindings.error ? <div className="chat-error">{errorText(locale, bindings.error)}</div> : null}
            <div className="oauth-grid">
              {providers
                .filter((item) => item.configured && !(bindings.data?.accounts ?? []).some((account) => account.provider === item.id)) // 只列可绑定且未绑定的
                .map((item) => (
                  <button key={item.id} type="button" className="btn ghost oauth-btn" disabled={linking !== null} onClick={() => void linkProvider(item.id)}>
                    {linking === item.id
                      ? (isZh ? '跳转中…' : 'Redirecting…')
                      : (isZh ? `绑定 ${item.label}` : `Link ${item.label_en}`)}
                  </button>
                ))}
            </div>
            {providers.some((item) => !item.configured) ? (
              <p className="hint">
                {isZh
                  ? `本部署还有 ${providers.filter((item) => !item.configured).length} 家提供方未配置凭证；补齐环境变量后会自动出现在这里。`
                  : `${providers.filter((item) => !item.configured).length} provider(s) are not configured on this deployment.`}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
} // Profile 结束
