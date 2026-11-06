// 引入 useState：维护登录表单的全部本地状态（语言、区域、模式、账号、各类凭证）
import { useState } from 'react';
// 引入 FormEvent 类型：为表单提交处理函数的入参做类型标注
import type { FormEvent } from 'react';
// 引入 t 函数：按当前 locale 从 i18n 词条表取文案
import { t } from '@mim/i18n';
// 引入 Locale 类型：把语言取值约束为 'zh-CN' | 'en-US'
import type { Locale } from '@mim/i18n';
// 引入接口客户端、错误文案翻译器、会话持久化工具
import { api, errorText, setSession } from '../api';
// 引入登录相关类型：登录结果、身份提供方、账号区域
import type { LoginResult, Provider, Region } from '../api';

// 组件对外契约：登录成功后把结果回调给上层
interface Props {
  // 回调函数：携带用户信息与令牌，由上层切换为已登录视图
  onLogin: (result: LoginResult) => void;
  // 内嵌模式：true 时去掉整屏最小高度与渐变背景，便于嵌入主布局内容区（默认 false 整屏展示）
  embedded?: boolean;
}

// 登录页组件：同时支持「密码登录」与「验证码登录」两种模式
export function Login({ onLogin, embedded = false }: Props) {
  // 本页语言状态，默认简体中文；顶部按钮可在中英之间切换
  const [locale, setLocale] = useState<Locale>('zh-CN');
  // 账号区域状态，默认中国区；决定账号标识用手机号还是邮箱
  const [region, setRegion] = useState<Region>('cn');
  // 登录方式状态，默认密码登录；验证码模式下需先发送验证码
  const [mode, setMode] = useState<'password' | 'code'>('password');
  // 账号标识输入值：中国区为手机号，Global 区为邮箱
  const [identifier, setIdentifier] = useState('');
  // 密码输入值，仅在密码登录模式下参与提交
  const [password, setPassword] = useState('');
  // 验证码输入值，仅在验证码登录模式下参与提交
  const [code, setCode] = useState('');
  // 开发态验证码回显：后端在非生产环境直接返回验证码，便于本地联调
  const [devCode, setDevCode] = useState<string | null>(null);
  // 请求进行中标记：用于禁用按钮，防止重复发送验证码或重复登录
  const [busy, setBusy] = useState(false);
  // 错误提示：null 表示无错误，有值时在表单下方以红字展示
  const [error, setError] = useState<string | null>(null);

  // 由区域推导身份提供方：中国区走手机号，Global 区走邮箱
  const provider: Provider = region === 'cn' ? 'phone' : 'email';
  // 账号输入框标题：随提供方在「手机号 / 邮箱」文案之间切换
  const identifierLabel = provider === 'phone' ? t(locale, 'auth.phone') : t(locale, 'auth.email');

  // 切换区域：整体清空已填内容，避免手机号被当作邮箱提交
  function switchRegion(next: Region) {
    // 写入目标区域
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
  function switchMode(next: 'password' | 'code') {
    // 写入目标登录方式
    setMode(next);
    // 清空验证码，切回密码模式后不再复用
    setCode('');
    // 清空密码，切到验证码模式后不再复用
    setPassword('');
    // 清空开发态验证码回显
    setDevCode(null);
    // 清空旧错误提示
    setError(null);
  }

  // 发送验证码：由验证码模式下的「发送验证码」按钮触发
  async function sendCode() {
    // 进入请求中状态，按钮随即被禁用
    setBusy(true);
    // 请求前清空旧错误，保证提示与本次请求对应
    setError(null);
    try {
      // 调用后端下发验证码；trim 去掉首尾空格以通过服务端格式校验
      const result = await api.requestCode(region, provider, identifier.trim());
      // 保存后端返回的开发态验证码；生产环境一般为 null 不展示
      setDevCode(result.dev_code);
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
      // 二选一发起登录请求，两条分支都返回统一的登录凭证
      const result =
        // 密码模式：区域 + 账号标识 + 密码换取会话
        mode === 'password'
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

  // 渲染登录页：整屏独立展示，或以 embedded 模式内嵌到主布局内容区
  return (
    // 登录页外层容器：负责整屏居中与背景；embedded 时仅保留居中能力
    <div className={embedded ? 'auth-wrap embedded' : 'auth-wrap'}>
      <div className="auth-card">{/* 登录卡片：承载标题、切换器与登录表单 */}
        <div className="auth-head">{/* 卡片头部：品牌信息 + 语言切换 */}
          <div>{/* 品牌信息纵向排列 */}
            <h1>{t(locale, 'app.name')}</h1>{/* 应用名，取自 i18n 词条 */}
            <p className="muted">{t(locale, 'app.tagline')}</p>{/* 一句话标语，弱化为灰色辅助文案 */}
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

          {mode === 'password' ? ( // 按登录模式切换凭证输入区
            <label>{/* 密码模式：单个密码输入框 */}
              <span>{t(locale, 'auth.password')}</span>{/* 密码标题，走 i18n */}
              <input
                // 受控值绑定 password
                value={password}
                // 每次输入同步回状态
                onChange={(event) => setPassword(event.target.value)}
                // 密码类型，输入内容以圆点显示
                type="password"
                // 提示浏览器按当前密码做自动填充
                autoComplete="current-password"
                // 必填
                required
              />{/* 密码输入框结束 */}
            </label> // 结束密码输入项
          ) : (
            <label>{/* 验证码模式：验证码输入框与发送按钮同行 */}
              <span>{t(locale, 'auth.code')}</span>{/* 验证码标题，走 i18n */}
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

          <button type="submit" className="btn primary block" disabled={busy}>{/* 提交按钮：请求中禁用 */}
            {busy ? t(locale, 'common.loading') : t(locale, 'auth.login')}{/* 忙碌时显示加载文案，否则显示「登录」 */}
          </button>{/* 结束提交按钮 */}
        </form>{/* 结束登录表单 */}
      </div>{/* 结束登录卡片 */}
    </div>
  );
}
