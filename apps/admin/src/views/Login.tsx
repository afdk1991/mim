// 登录视图：管理员令牌（超管引导通道）与账号密码（RBAC 通道）两种入口
import { useState } from 'react';
// 复用统一 API 客户端与凭证持久化函数，避免各视图重复处理鉴权细节
import { describeError, getAdminMe, loginWithPassword, saveCredential, type Credential } from '../api';

// 登录模式：token 走 x-admin-token 自定义头，password 走 /auth/password 换 JWT
type Mode = 'token' | 'password';

// 组件入参
interface LoginProps {
  // 校验通过后把凭证交给 App，由 App 渲染主界面
  onDone: (credential: Credential) => void;
  // 被动退出时的提示文案（如凭证过期被踢回）
  notice?: string;
} // 入参仅两项：成功回调 + 可选提示，保持组件边界最小

// 登录组件：内部完成「先校验 → 再落盘 → 再回调」三步，避免坏凭证被写进 localStorage
export function Login({ onDone, notice }: LoginProps) {
  // 当前页签：默认令牌模式，因为首次部署时系统里通常还没有任何管理员账号
  const [mode, setMode] = useState<Mode>('token');
  // 令牌输入框
  const [token, setToken] = useState('');
  // 账号输入框，支持手机号或邮箱
  const [identifier, setIdentifier] = useState('');
  // 密码输入框
  const [password, setPassword] = useState('');
  // 错误提示；空串表示无错误
  const [error, setError] = useState('');
  // 提交中标记，用于禁用按钮防重复点击
  const [busy, setBusy] = useState(false);

  // 提交处理：先得到候选凭证，再调 /admin/me 验证身份，成功才持久化
  async function submit(event: React.FormEvent) {
    // 阻止表单默认的整页提交行为
    event.preventDefault();
    // 清空上一轮错误
    setError('');
    // 进入提交态
    setBusy(true);
    // 候选凭证：尚未落盘，避免无效令牌污染本地存储
    let candidate: Credential | null = null;
    // 统一 try/catch：任何一步失败都回到表单并提示
    try {
      // 分支一：引导令牌模式（X-Admin-Token 超管引导通道）
      if (mode === 'token') {
        // 去除首尾空白，避免复制粘贴带入不可见字符
        const value = token.trim();
        // 空值直接中断
        if (!value) throw new Error('请输入管理员令牌');
        // 组装令牌凭证
        candidate = { kind: 'token', value };
      } else { // 分支二入口：账号密码模式（JWT Bearer 通道）
        // 分支二：账号密码模式，先换访问令牌
        const session = await loginWithPassword(identifier.trim(), password);
        // 组装 Bearer 凭证
        candidate = { kind: 'bearer', value: session.access_token };
      } // 两条分支都收敛到 candidate，后续校验逻辑共用
      // 校验：/admin/me 需要 rbac:read，可同时验证令牌有效性与基础读权限
      await getAdminMe(candidate);
      // 校验通过后才写入 localStorage
      saveCredential(candidate);
      // 通知 App 切换到主界面
      onDone(candidate);
    } catch (err) { // 任一步失败都在此统一兜底提示
      // 把异常统一格式化为可读文案
      setError(describeError(err));
    } finally { // finally 保证 busy 一定复位，避免按钮卡死在提交态
      // 无论成败都退出提交态
      setBusy(false);
    } // try/catch/finally 结束
  } // submit 结束

  // 页签文案表：抽到 TS 位置，便于用注释解释且避免重复 JSX
  const tabs: Array<{ key: Mode; label: string }> = [
    // 引导通道：只需一个与环境变量一致的字符串
    { key: 'token', label: '管理员令牌' },
    // 账号通道：走真实登录接口，权限由 RBAC 实时计算
    { key: 'password', label: '账号密码' },
  ]; // tabs 常量表结束

  // 顶部提示：被动退出时展示原因
  const noticeBar = notice ? <div className="warning">{notice}</div> : null;
  // 错误提示：登录失败时展示
  const errorBar = error ? <div className="error">{error}</div> : null;

  // 渲染：无侧栏的居中卡片
  return (
    <div className="login-wrap"> {/* 全屏居中布局容器 */}
      <form className="login-card" onSubmit={submit}> {/* 登录卡片表单，回车即触发 submit */}
        <div className="login-title">Mim 管理后台</div> {/* 主标题 */}
        <div className="login-sub">角色权限 · 权益发放 · 模块状态</div> {/* 副标题：点明后台三大能力域 */}
        {noticeBar} {/* 被动退出原因提示，无则渲染空 */}
        <div className="tabs"> {/* 登录模式页签容器 */}
          {tabs.map((tab) => ( // 遍历页签定义渲染按钮
            // 页签按钮：点击切换模式并清空错误
            <button
              key={tab.key} // React 列表稳定 key
              type="button" // 显式声明非提交按钮，避免误触发表单提交
              className={mode === tab.key ? 'tab active' : 'tab'} // 当前模式高亮 active 样式
              onClick={() => { // 点击切换登录模式
                // 切换模式
                setMode(tab.key);
                // 清空错误，避免旧提示误导
                setError('');
              }} // onClick 处理器结束
            > {/* 按钮属性区结束，进入按钮文案 */}
              {tab.label} {/* 页签文案：管理员令牌 / 账号密码 */}
            </button> // 单个页签按钮结束（回到 tabs.map 回调的 JS 上下文）
          ))} {/* tabs.map 渲染结束 */}
        </div> {/* 页签容器结束 */}
        {mode === 'token' ? ( // 令牌模式（X-Admin-Token 超管引导通道）表单分支
          // 令牌模式：单字段表单
          <div className="form">
            <label className="field"> {/* 令牌字段容器：标签 + 输入框 */}
              <span>管理员令牌</span> {/* 字段名 */}
              <input // 令牌输入框：对应 X-Admin-Token 鉴权头
                type="password" // 掩码显示，防旁观者窥屏
                value={token} // 受控绑定 token 状态
                autoComplete="off" // 禁止浏览器自动保存令牌
                placeholder="与服务端 MIM_ADMIN_TOKEN 一致" // 提示令牌来源：服务端环境变量
                onChange={(event) => setToken(event.target.value)} // 输入即写入 token
              /> {/* 令牌输入框结束 */}
            </label> {/* 令牌字段结束 */}
            <p className="hint">引导令牌拥有全部权限，仅在首个超管账号建立前使用。</p> {/* 安全提示：说明引导令牌权限边界 */}
            <button className="btn primary" type="submit" disabled={busy}> {/* 提交按钮，busy 时禁用防重复提交 */}
              {busy ? '验证中…' : '进入后台'} {/* 按提交态切换按钮文案 */}
            </button> {/* 提交按钮结束 */}
          </div> // 令牌模式表单结束（回到 mode 三元表达式的 JS 上下文）
        ) : ( // 账号密码模式（JWT Bearer 通道）表单分支
          // 账号模式：手机号/邮箱 + 密码
          <div className="form">
            <label className="field"> {/* 账号字段容器 */}
              <span>手机号 / 邮箱</span> {/* 账号字段名 */}
              <input // 账号输入框：手机号或邮箱
                value={identifier} // 受控绑定 identifier 状态
                autoComplete="username" // 允许浏览器记住登录标识
                placeholder="登录标识" // 输入提示
                onChange={(event) => setIdentifier(event.target.value)} // 输入即写入 identifier
              /> {/* 账号输入框结束 */}
            </label> {/* 账号字段结束 */}
            <label className="field"> {/* 密码字段容器 */}
              <span>密码</span> {/* 密码字段名 */}
              <input // 密码输入框
                type="password" // 掩码显示
                value={password} // 受控绑定 password 状态
                autoComplete="current-password" // 允许密码管理器填充当前密码
                placeholder="账号密码" // 输入提示
                onChange={(event) => setPassword(event.target.value)} // 输入即写入 password
              /> {/* 密码输入框结束 */}
            </label> {/* 密码字段结束 */}
            <p className="hint">账号需已被授予含 rbac:read 的角色，否则将被拒绝进入。</p> {/* 权限提示：无 rbac:read 将被 /admin/me 校验拒绝 */}
            <button className="btn primary" type="submit" disabled={busy}> {/* 登录提交按钮，busy 时禁用 */}
              {busy ? '登录中…' : '登录'} {/* 按提交态切换按钮文案 */}
            </button> {/* 登录按钮结束 */}
          </div> // 账号密码表单结束（回到 mode 三元表达式的 JS 上下文）
        )} {/* 模式条件渲染结束 */}
        {errorBar} {/* 登录失败错误提示，无则渲染空 */}
      </form> {/* 登录卡片表单结束 */}
    </div> // 居中容器结束，根元素闭合
  ); // return 语句结束
} // Login 组件结束
