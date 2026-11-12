// 引入 useState / useEffect / useRef：维护登录表单状态、消费第三方回调参数，并防止票据被重复兑换
import { useEffect, useRef, useState } from 'react';
// 引入 FormEvent 类型：为表单提交处理函数的入参做类型标注
import type { FormEvent } from 'react';
// 引入 t 函数：按当前 locale 从 i18n 词条表取文案
import { t } from '@mim/i18n';
// 引入 Locale 类型：把语言取值约束为 'zh-CN' | 'en-US'
import type { Locale } from '@mim/i18n';
// 引入接口客户端、错误文案翻译器、会话持久化工具
import { api, errorText, setSession } from '../api';
// 引入登录相关类型：登录结果、身份提供方、账号区域、第三方提供方
import type { LoginResult, OAuthProviderInfo, Provider, Region } from '../api';

/** 从地址栏移除 OAuth 回传参数：票据与错误码都只消费一次，刷新不应重放 */
function clearOAuthParams(): void {
  const url = new URL(window.location.href); // 当前地址
  for (const key of ['oauth_ticket', 'oauth_error', 'return_to']) url.searchParams.delete(key); // 逐个删除
  window.history.replaceState(null, '', url.pathname + url.search + url.hash); // 原地替换，不新增历史
} // clearOAuthParams 结束

/** 把后端 OAuth 错误码翻译成当前语言的可读提示 */
function oauthErrorText(locale: Locale, code: string): string {
  const table: Record<string, [string, string]> = { // [中文, 英文]
    AUTH_OAUTH_NOT_CONFIGURED: ['该第三方登录尚未在本部署配置，请联系管理员', 'This provider is not configured on this deployment.'],
    AUTH_OAUTH_STATE_INVALID: ['授权链接已过期或被重复使用，请重新发起', 'The authorization link expired. Please start again.'],
    AUTH_OAUTH_DENIED: ['已取消第三方授权', 'Authorization was cancelled.'],
    AUTH_OAUTH_EXCHANGE_FAILED: ['第三方平台返回异常，请稍后重试', 'The provider returned an error. Please retry.'],
    AUTH_OAUTH_ALREADY_BOUND: ['该第三方账号已绑定到其他 Mim 账号', 'This third-party account is linked to another Mim account.'],
    AUTH_OAUTH_LAST_METHOD: ['至少需要保留一种登录方式', 'Keep at least one sign-in method.'],
    AUTH_OAUTH_TICKET_INVALID: ['登录票据已失效，请重新登录', 'The sign-in ticket is invalid. Please sign in again.'],
  }; // 映射表结束
  const pair = table[code]; // 命中映射
  if (!pair) return code; // 未知码原样显示，便于排障
  return locale === 'en-US' ? pair[1] : pair[0]; // 按语言取一侧
} // oauthErrorText 结束

// 组件对外契约：登录成功后把结果回调给上层
interface Props {
  // 回调函数：携带用户信息与令牌，由上层切换为已登录视图
  onLogin: (result: LoginResult) => void;
  // 内嵌模式：true 时去掉整屏最小高度与渐变背景，便于嵌入主布局内容区（默认 false 整屏展示）
  embedded?: boolean;
  // 按需登录提示：required 为访问收费功能的登录说明，expired 为登录态失效后的重登说明，null 不展示
  notice?: 'required' | 'expired' | null;
}

// 登录页组件：同时支持「密码登录」与「验证码登录」两种模式，并作为按需登录的统一入口（整屏或内嵌）
export function Login({ onLogin, embedded = false, notice = null }: Props) {
  // 本页语言状态，默认简体中文；顶部按钮可在中英之间切换
  const [locale, setLocale] = useState<Locale>('zh-CN');
  // 账号区域状态，默认中国区；决定账号标识用手机号还是邮箱
  const [region, setRegion] = useState<Region>('cn');
  // 登录方式状态，默认密码登录；验证码模式需先发送验证码，注册模式创建自建账号
  const [mode, setMode] = useState<'password' | 'code' | 'register'>('password');
  // 账号标识输入值：中国区为手机号，Global 区为邮箱
  const [identifier, setIdentifier] = useState('');
  // 密码输入值，密码登录与注册模式共用
  const [password, setPassword] = useState('');
  // 注册模式下的展示名（可选），注册成功后作为用户昵称
  const [displayName, setDisplayName] = useState('');
  // 验证码输入值，仅在验证码登录模式下参与提交
  const [code, setCode] = useState('');
  // 开发态验证码回显：后端在非生产环境直接返回验证码，便于本地联调
  const [devCode, setDevCode] = useState<string | null>(null);
  // 请求进行中标记：用于禁用按钮，防止重复发送验证码或重复登录
  const [busy, setBusy] = useState(false);
  // 错误提示：null 表示无错误，有值时在表单下方以红字展示
  const [error, setError] = useState<string | null>(null);
  // 部署可用登录方式：用于在验证码通道未配置时给出明确提示，避免用户反复触发 503
  const [channels, setChannels] = useState<{ sms: boolean; email: boolean; password: boolean; register: boolean } | null>(null);
  // 第三方登录提供方清单：含未配置凭证的项，前端据此置灰而不是隐藏
  const [oauthProviders, setOauthProviders] = useState<OAuthProviderInfo[]>([]);
  // 正在跳转的第三方提供方：只禁用被点击的那一个，允许用户改点别家
  const [oauthBusy, setOauthBusy] = useState<string | null>(null);
  // 第三方回调错误码：由 ?oauth_error= 带回，展示为可读文案
  const [oauthError, setOauthError] = useState<string | null>(null);
  // 注册成功但尚未进入工作台：先展示自动分配的 Mim ID，用户确认后再切换视图
  const [registered, setRegistered] = useState<LoginResult | null>(null);
  // 票据只消费一次：开发环境 StrictMode 会让挂载 effect 跑两遍，重复兑换必然 401
  const oauthHandled = useRef(false);
  // 图形验证码：服务端开启 MIM_CAPTCHA_REQUIRED 时，发码前必须先通过
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaId, setCaptchaId] = useState('');
  const [captchaSvg, setCaptchaSvg] = useState('');
  const [captchaCode, setCaptchaCode] = useState('');

  // 挂载时查安全状态；需要验证码时立即取一张
  useEffect(() => {
    api.securityStatus()
      .then((status) => {
        setCaptchaRequired(status.captcha_required);
        if (status.captcha_required) {
          api.captcha().then((item) => {
            setCaptchaId(item.id);
            setCaptchaSvg(item.svg);
          }).catch(() => setCaptchaRequired(false));
        }
      })
      .catch(() => setCaptchaRequired(false));
  }, []);

  // 挂载时查一次通道能力；失败静默降级，不阻塞登录主流程
  useEffect(() => {
    api.authChannels().then(setChannels).catch(() => setChannels(null));
  }, []);

  // 区域变化时重新拉提供方清单：中国区与海外区可用项不同
  useEffect(() => {
    api.oauthProviders(region).then((result) => setOauthProviders(result.providers)).catch(() => setOauthProviders([]));
  }, [region]);

  // 挂载时消费第三方回调参数：票据换会话 / 错误码展示；处理完立即从地址栏移除，避免刷新重放
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorCode = params.get('oauth_error');
    const ticket = params.get('oauth_ticket');
    if (errorCode) {
      setOauthError(errorCode); // 展示失败原因（如 AUTH_OAUTH_STATE_INVALID）
      clearOAuthParams(); // 清掉参数，刷新不再提示
      return; // 错误优先，不再尝试兑换
    }
    if (!ticket || oauthHandled.current) return; // 无票据或已处理
    oauthHandled.current = true; // 标记已消费，防止重复兑换
    setBusy(true); // 兑换期间禁用提交
    api.oauthExchange(ticket)
      .then((result) => {
        setSession(result); // 写入本地会话
        clearOAuthParams(); // 清理地址栏
        onLogin(result); // 切换为已登录视图
      })
      .catch((err) => setOauthError(errorText(locale, err))) // 票据过期等失败提示
      .finally(() => setBusy(false)); // 恢复按钮
  }, []);

  // 由区域推导身份提供方：中国区走手机号，Global 区走邮箱
  const provider: Provider = region === 'cn' ? 'phone' : 'email';
  // 账号输入框标题：随提供方在「手机号 / 邮箱」文案之间切换
  const identifierLabel = provider === 'phone' ? t(locale, 'auth.phone') : t(locale, 'auth.email');
  // 登录提示文案：免登录体验下只有「登录态失效」一种提示，旧的功能门禁提示已移除
  const gateText = notice // 有提示才计算文案
    ? (locale === 'en-US' ? 'Your session has expired. Please sign in again.' : '登录状态已失效，请重新登录。') // 失效态：登录后又被令牌失效踢回，明确要求重新登录
    : ''; // 无提示时为空串，JSX 条件渲染不输出节点

  // 切换区域：整体清空已填内容，避免手机号被当作邮箱提交
  function switchRegion(next: Region) {    // 写入目标区域
    setRegion(next);
    // 清空账号标识，因为两种区域的标识格式完全不同
    setIdentifier('');
    // 清空密码，避免沿用上一区域输入的凭证
    setPassword('');
    // 清空验证码，旧验证码对新区域无效
    setCode('');
    // 清空开发态验证码回显
    setDevCode(null);
    // 清空旧错误提示，避免误导用户
    setError(null);
  }

  // 切换登录方式：清空两种凭证，防止残留值被误提交
  function switchMode(next: 'password' | 'code' | 'register') {
    // 写入目标登录方式
    setMode(next);
    // 清空验证码，切回密码模式后不再复用
    setCode('');
    // 清空密码，切到验证码模式后不再复用
    setPassword('');
    // 清空展示名，避免把登录态残留昵称带进注册
    setDisplayName('');
    // 清空开发态验证码回显
    setDevCode(null);
    // 清空旧错误提示
    setError(null);
  }

  // 发起第三方授权：先向后端要授权地址，再整页跳转到提供方
  async function startOAuth(providerId: string) {
    if (oauthBusy) return; // 已有跳转在途，忽略重复点击
    setOauthError(null); // 清空旧错误
    setOauthBusy(providerId); // 只禁用被点的按钮
    try {
      // 由后端生成 state / PKCE 并记录，前端只负责跳转
      const result = await api.oauthAuthorize(providerId, { region, mode: 'login', return_to: '/account' });
      window.location.assign(result.authorization_url); // 交给浏览器完成授权页
    } catch (err) {
      // 未配置凭证、网络异常等在这里暴露
      setOauthError(errorText(locale, err));
      setOauthBusy(null); // 失败后恢复可点
    } // try 结束
  } // startOAuth 结束

  // 发送验证码：由验证码模式下的「发送验证码」按钮触发
  async function sendCode() {
    // 进入请求中状态，按钮随即被禁用
    setBusy(true);
    // 请求前清空旧错误，保证提示与本次请求对应
    setError(null);
    try {
      // 调用后端下发验证码；trim 去掉首尾空格以通过服务端格式校验
      const result = await api.requestCode(
        region,
        provider,
        identifier.trim(),
        captchaRequired ? { id: captchaId, code: captchaCode.trim() } : undefined,
      );
      // 保存后端返回的开发态验证码；生产环境一般为 null 不展示
      setDevCode(result.dev_code);
      // 验证码一次性使用，发送后立即换一张
      if (captchaRequired) {
        setCaptchaCode('');
        const next = await api.captcha();
        setCaptchaId(next.id);
        setCaptchaSvg(next.svg);
      }
    } catch (err) {
      // 把后端或网络异常翻译成当前语言的提示文案
      setError(errorText(locale, err));
    } finally {
      // 无论成功失败都解除按钮禁用，允许重试
      setBusy(false);
    }
  }

  // 表单提交：按当前模式走密码登录或验证码登录
  async function submit(event: FormEvent) {
    // 阻止浏览器默认提交导致的整页刷新
    event.preventDefault();
    // 标记请求中，提交按钮变灰并显示加载文案
    setBusy(true);
    // 提交前清空旧错误
    setError(null);
    try {
      // 三选一发起认证请求，三条分支都返回统一的登录凭证
      const result =
        // 注册模式：账号 + 口令创建自建账号，注册成功即登录
        mode === 'register'
          ? await api.register({
              region,
              identifier: identifier.trim(),
              password,
              display_name: displayName.trim() || undefined,
            })
          // 密码模式：区域 + 账号标识 + 密码换取会话
          : mode === 'password'
            ? await api.loginWithPassword({ region, identifier: identifier.trim(), password })
            // 验证码模式：区域 + 提供方 + 账号标识 + 验证码换取会话
            : await api.login({
                // 账号所属区域
                region,
                // 身份提供方：手机号或邮箱
                provider,
                // 账号标识，去空格后提交
                identifier: identifier.trim(),
                // 用户填写的验证码，去空格后提交
                code: code.trim(),
              });
      // 注册模式先停在成功面板：把自动分配的 Mim ID 展示给用户，再进入工作台
      if (mode === 'register') {
        setRegistered(result); // 暂存结果，等用户确认
        return; // 不在这里写会话，避免直接跳走看不到号码
      }
      // 把令牌写入本地会话存储，供后续接口自动携带
      setSession(result);
      // 通知上层登录成功，触发视图切换
      onLogin(result);
    } catch (err) {
      // 登录失败时展示可读错误，如验证码错误、账号不存在
      setError(errorText(locale, err));
    } finally {
      // 恢复提交按钮可用状态
      setBusy(false);
    }
  }

  // 注册成功：先展示服务端自动分配的 Mim ID，用户确认后再进入工作台
  if (registered) {
    return (
      <div className={embedded ? 'auth-wrap embedded' : 'auth-wrap'}>
        <div className="auth-card">
          <div className="auth-head">
            <h1>{t(locale, 'app.name')}</h1>
          </div>
          <p className="auth-notice" role="status">{locale === 'en-US' ? 'Account created.' : '账号创建成功'}</p>
          <div className="member-no-block">
            <span>{locale === 'en-US' ? 'Your Mim ID' : '你的 Mim ID 号码'}</span>
            <strong className="member-no">{registered.user.member_no}</strong>
            <span className="hint">
              {locale === 'en-US'
                ? 'This number is your public identity in Mim. Keep it for support and sharing.'
                : '该号码是你的对外身份标识，可随时在个人中心查看。'}
            </span>
          </div>
          <button
            type="button"
            className="btn primary block"
            onClick={() => {
              setSession(registered); // 用户确认后才写入会话
              onLogin(registered); // 进入工作台
            }}
          >
            {locale === 'en-US' ? 'Enter Mim' : '进入 Mim'}
          </button>
        </div>
      </div>
    );
  } // 注册成功面板结束

  // 渲染登录页：整屏独立展示，或以 embedded 模式内嵌到主布局内容区
  return (
    // 登录页外层容器：负责整屏居中与背景；embedded 时仅保留居中能力
    <div className={embedded ? 'auth-wrap embedded' : 'auth-wrap'}>
      <div className="auth-card">{/* 登录卡片：承载标题、切换器与登录表单 */}
        <div className="auth-head">{/* 卡片头部：品牌信息 + 语言切换 */}
          <div>{/* 品牌信息：仅保留应用名（旧定位标语已按用户指令于 2026-11-10 删除） */}
            <h1>{t(locale, 'app.name')}</h1>{/* 应用名，取自 i18n 词条 */}
          </div>{/* 结束品牌信息 */}
          <button
            // 语言切换按钮：普通按钮，避免触发表单提交
            type="button"
            // 幽灵小号按钮样式
            className="btn ghost small"
            // 在 zh-CN 与 en-US 之间取反切换
            onClick={() => setLocale(locale === 'zh-CN' ? 'en-US' : 'zh-CN')}
          >
            {locale === 'zh-CN' ? 'EN' : '中文'}{/* 当前为中文时显示 EN，否则显示「中文」 */}
          </button>{/* 结束语言切换按钮 */}
        </div>{/* 结束卡片头部 */}

        {gateText && <p className="auth-notice" role="status">{gateText}</p>}{/* 全站门禁提示：锁定 / 失效说明 */}

        <div className="segmented">{/* 区域分段控件：中国区 / Global */}
          <button
            // 中国区按钮：普通按钮，避免触发表单提交
            type="button"
            // 当前区域为中国区时加 active 高亮
            className={region === 'cn' ? 'active' : ''}
            // 点击切到中国区并清空已填内容
            onClick={() => switchRegion('cn')}
          >
            中国区{/* 中国区入口文案 */}
          </button>{/* 结束中国区按钮 */}
          <button
            // Global 区按钮：普通按钮，避免触发表单提交
            type="button"
            // 当前区域为 global 时加 active 高亮
            className={region === 'global' ? 'active' : ''}
            // 点击切到海外区并清空已填内容
            onClick={() => switchRegion('global')}
          >
            Global{/* 海外区入口文案 */}
          </button>{/* 结束 Global 区按钮 */}
        </div>{/* 结束区域分段控件 */}

        <div className="segmented">{/* 登录方式分段控件：密码 / 验证码 */}
          <button
            // 密码登录按钮：普通按钮，避免触发表单提交
            type="button"
            // 当前为密码模式时高亮
            className={mode === 'password' ? 'active' : ''}
            // 点击切到密码模式并清空验证码
            onClick={() => switchMode('password')}
          >
            {t(locale, 'auth.modePassword')}{/* 密码模式文案，走 i18n */}
          </button>{/* 结束密码登录按钮 */}
          <button
            // 验证码登录按钮：普通按钮，避免触发表单提交
            type="button"
            // 当前为验证码模式时高亮
            className={mode === 'code' ? 'active' : ''}
            // 点击切到验证码模式并清空密码
            onClick={() => switchMode('code')}
          >
            {t(locale, 'auth.modeCode')}{/* 验证码模式文案，走 i18n */}
          </button>{/* 结束验证码登录按钮 */}
          <button
            // 注册按钮：普通按钮，创建自建账号（不依赖短信/邮箱通道）
            type="button"
            // 当前为注册模式时高亮
            className={mode === 'register' ? 'active' : ''}
            // 切到注册模式并清空已填凭证
            onClick={() => switchMode('register')}
          >
            {locale === 'en-US' ? 'Sign up' : '注册'}{/* 注册入口文案 */}
          </button>{/* 结束注册按钮 */}
        </div>{/* 结束登录方式分段控件 */}

        <form className="form" onSubmit={submit}>{/* 登录表单：提交统一由 submit 处理 */}
          <label>{/* 账号输入项：标题随身份提供方变化 */}
            <span>{identifierLabel}</span>{/* 输入框标题：手机号或邮箱 */}
            <input
              // 受控值绑定 identifier
              value={identifier}
              // 每次输入同步回状态
              onChange={(event) => setIdentifier(event.target.value)}
              // 占位示例：手机号或邮箱格式
              placeholder={provider === 'phone' ? '13800138000' : 'you@example.com'}
              // 提示浏览器按用户名做自动填充
              autoComplete="username"
              // 必填，交给浏览器做基础校验
              required
            />{/* 账号输入框结束 */}
          </label>{/* 结束账号输入项 */}

          {mode === 'register' && ( // 注册模式：可选昵称，留空则回退为账号前 8 位展示
            <label>{/* 昵称输入项 */}
              <span>{locale === 'en-US' ? 'Display name (optional)' : '昵称（可选）'}</span>{/* 昵称标题 */}
              <input
                // 受控值绑定 displayName
                value={displayName}
                // 每次输入同步回状态
                onChange={(event) => setDisplayName(event.target.value)}
                // 最多 64 位，与后端校验上限一致
                maxLength={64}
                // 昵称非必填
                placeholder={locale === 'en-US' ? 'Your name' : '可留空'}
              />{/* 昵称输入框结束 */}
            </label> // 结束昵称输入项
          )}{/* 结束注册昵称条件渲染 */}

          {mode !== 'code' ? ( // 密码与注册模式共用密码输入框，验证码模式换成验证码行
            <label>{/* 密码输入项 */}
              <span>{mode === 'register' ? (locale === 'en-US' ? 'Password (min 8, letters + digits)' : '设置密码（至少 8 位，含字母与数字）') : t(locale, 'auth.password')}</span>{/* 标题随模式切换 */}
              <input
                // 受控值绑定 password
                value={password}
                // 每次输入同步回状态
                onChange={(event) => setPassword(event.target.value)}
                // 密码类型，输入内容以圆点显示
                type="password"
                // 注册提示浏览器生成新密码，登录提示填充当前密码
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                // 注册要求至少 8 位，登录保持后端最小 1 位校验
                minLength={mode === 'register' ? 8 : 1}
                // 必填
                required
              />{/* 密码输入框结束 */}
            </label> // 结束密码输入项
          ) : (
            <label>{/* 验证码模式：验证码输入框与发送按钮同行 */}
              <span>{t(locale, 'auth.code')}</span>{/* 验证码标题，走 i18n */}
              {captchaRequired && (
                <div className="login-captcha">
                  <span className="login-captcha-image" dangerouslySetInnerHTML={{ __html: captchaSvg }} />
                  <input
                    value={captchaCode}
                    onChange={(event) => setCaptchaCode(event.target.value)}
                    placeholder={locale === 'en-US' ? 'Image code' : '图形验证码'}
                    maxLength={10}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      api.captcha().then((item) => {
                        setCaptchaId(item.id);
                        setCaptchaSvg(item.svg);
                        setCaptchaCode('');
                      }).catch((err) => setError(errorText(locale, err)));
                    }}
                  >
                    换一张
                  </button>
                </div>
              )}
              <div className="row">{/* 水平排列验证码输入框与发送按钮 */}
                <input
                  // 受控值绑定 code
                  value={code}
                  // 每次输入同步回状态
                  onChange={(event) => setCode(event.target.value)}
                  // 六位数字验证码的占位示例
                  placeholder="000000"
                  // 移动端唤起数字键盘
                  inputMode="numeric"
                  // 最多 6 位，与后端校验规则保持一致
                  maxLength={6}
                  // 必填
                  required
                />{/* 验证码输入框结束 */}
                <button
                  // 发送验证码按钮：普通按钮，避免触发表单提交
                  type="button"
                  // 幽灵按钮样式
                  className="btn ghost"
                  // 点击请求下发验证码
                  onClick={sendCode}
                  // 请求中或账号为空时禁用，避免发起无效请求
                  disabled={busy || identifier.trim().length === 0}
                >
                  {t(locale, 'auth.sendCode')}{/* 按钮文案，走 i18n */}
                </button>{/* 结束发送验证码按钮 */}
              </div>{/* 结束验证码行容器 */}
            </label> // 结束验证码输入项
          )}{/* 结束按模式切换凭证输入区 */}

          {devCode && ( // 开发态验证码回显：仅在接口返回 dev_code 时出现
            <p className="dev-code">{/* 开发提示行，便于本地联调读取验证码 */}
              {t(locale, 'auth.codeSent')}: <strong>{devCode}</strong>{/* 「验证码已发送」+ 明文验证码 */}
            </p> // 结束开发提示行
          )}{/* 结束开发态回显 */}

          {error && <p className="error">{error}</p>}{/* 错误提示：仅在 error 非空时渲染 */}
          {oauthError && <p className="error">{oauthError}</p>}{/* 第三方登录错误：票据失效 / 授权被拒 / 未配置 */}

          {mode === 'code' && channels && !(provider === 'phone' ? channels.sms : channels.email) && ( // 通道未配置时明确引导改用密码或注册
            <p className="hint">{locale === 'en-US' ? 'Verification channel is not configured on this deployment. Use password or sign up instead.' : '当前部署未配置该验证码通道，请改用密码登录或注册。'}</p>
          )}{/* 通道提示结束 */}

          <button type="submit" className="btn primary block" disabled={busy}>{/* 提交按钮：请求中禁用 */}
            {busy // 忙碌时显示加载文案，否则按模式显示「注册 / 登录」
              ? t(locale, 'common.loading')
              : mode === 'register'
                ? (locale === 'en-US' ? 'Create account' : '注册并登录')
                : t(locale, 'auth.login')}{/* 按钮文案结束 */}
          </button>{/* 结束提交按钮 */}
        </form>{/* 结束登录表单 */}

        {oauthProviders.length > 0 && ( // 第三方登录区：9 家全部展示，未配置凭证的置灰
          <div className="oauth-section">
            <div className="oauth-divider"><span>{locale === 'en-US' ? 'Or continue with' : '或使用第三方账号'}</span></div>
            <div className="oauth-grid">
              {oauthProviders
                .filter((item) => item.region === 'both' || item.region === region) // 只展示当前区域可用项
                .map((item) => (
                  <button
                    key={item.id} // 提供方标识唯一
                    type="button" // 不触发表单提交
                    className="btn ghost oauth-btn"
                    disabled={!item.configured || oauthBusy !== null} // 未配置或已有跳转在途时禁用
                    title={item.configured ? undefined : (locale === 'en-US' ? 'Credentials not configured on this deployment' : '该提供方尚未在本部署配置凭证')}
                    onClick={() => void startOAuth(item.id)} // 发起授权并整页跳转
                  >
                    <span>{locale === 'en-US' ? item.label_en : item.label}</span>
                    {!item.configured && <span className="oauth-badge">{locale === 'en-US' ? 'N/A' : '未配置'}</span>}
                    {oauthBusy === item.id && <span className="oauth-badge">{t(locale, 'common.loading')}</span>}
                  </button>
                ))}
            </div>
          </div>
        )}{/* 第三方登录区结束 */}
      </div>{/* 结束登录卡片 */}
    </div>
  );
}
