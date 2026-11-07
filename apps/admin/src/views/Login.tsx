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
}

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
      // 分支一：引导令牌模式
      if (mode === 'token') {
        // 去除首尾空白，避免复制粘贴带入不可见字符
        const value = token.trim();
        // 空值直接中断
        if (!value) throw new Error('请输入管理员令牌');
        // 组装令牌凭证
        candidate = { kind: 'token', value };
      } else {
        // 分支二：账号密码模式，先换访问令牌
        const session = await loginWithPassword(identifier.trim(), password);
        // 组装 Bearer 凭证
        candidate = { kind: 'bearer', value: session.access_token };
      }
      // 校验：/admin/me 需要 rbac:read，可同时验证令牌有效性与基础读权限
      await getAdminMe(candidate);
      // 校验通过后才写入 localStorage
      saveCredential(candidate);
      // 通知 App 切换到主界面
      onDone(candidate);
    } catch (err) {
      // 把异常统一格式化为可读文案
      setError(describeError(err));
    } finally {
      // 无论成败都退出提交态
      setBusy(false);
    }
  }

  // 页签文案表：抽到 TS 位置，便于用注释解释且避免重复 JSX
  const tabs: Array<{ key: Mode; label: string }> = [
    // 引导通道：只需一个与环境变量一致的字符串
    { key: 'token', label: '管理员令牌' },
    // 账号通道：走真实登录接口，权限由 RBAC 实时计算
    { key: 'password', label: '账号密码' },
  ];

  // 顶部提示：被动退出时展示原因
  const noticeBar = notice ? <div className="warning">{notice}</div> : null;
  // 错误提示：登录失败时展示
  const errorBar = error ? <div className="error">{error}</div> : null;

  // 渲染：无侧栏的居中卡片
  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-title">Mim 管理后台</div>
        <div className="login-sub">角色权限 · 权益发放 · 模块状态</div>
        {noticeBar}
        <div className="tabs">
          {tabs.map((tab) => (
            // 页签按钮：点击切换模式并清空错误
            <button
              key={tab.key}
              type="button"
              className={mode === tab.key ? 'tab active' : 'tab'}
              onClick={() => {
                // 切换模式
                setMode(tab.key);
                // 清空错误，避免旧提示误导
                setError('');
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {mode === 'token' ? (
          // 令牌模式：单字段表单
          <div className="form">
            <label className="field">
              <span>管理员令牌</span>
              <input
                type="password"
                value={token}
                autoComplete="off"
                placeholder="与服务端 MIM_ADMIN_TOKEN 一致"
                onChange={(event) => setToken(event.target.value)}
              />
            </label>
            <p className="hint">引导令牌拥有全部权限，仅在首个超管账号建立前使用。</p>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? '验证中…' : '进入后台'}
            </button>
          </div>
        ) : (
          // 账号模式：手机号/邮箱 + 密码
          <div className="form">
            <label className="field">
              <span>手机号 / 邮箱</span>
              <input
                value={identifier}
                autoComplete="username"
                placeholder="登录标识"
                onChange={(event) => setIdentifier(event.target.value)}
              />
            </label>
            <label className="field">
              <span>密码</span>
              <input
                type="password"
                value={password}
                autoComplete="current-password"
                placeholder="账号密码"
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <p className="hint">账号需已被授予含 rbac:read 的角色，否则将被拒绝进入。</p>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? '登录中…' : '登录'}
            </button>
          </div>
        )}
        {errorBar}
      </form>
    </div>
  );
}
