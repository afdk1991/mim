// 权益管理视图：发放与回收模块权益，两个动作各自按权限点门禁
import type { FormEvent } from 'react';
import { useState } from 'react';
// 只引入本视图需要的类型与接口函数，避免无谓的打包体积
import type { Credential, EntitlementView } from '../api';
import { describeError, grantEntitlement, listModules, revokeEntitlement } from '../api';
// 通用异步加载钩子：负责 loading / error / reload
import { useAsync } from '../hooks';

// 回收成功回执：后端只回最小字段集，故单独声明类型
interface RevokedReceipt {
  // 权益主键
  id: string;
  // 权益归属用户
  user_id: string;
  // 回收后状态，固定 revoked
  status: string;
  // 乐观锁版本号
  version: number;
  // 更新时间
  updated_at: string;
}

// 组件入参
interface EntitlementsProps {
  // 当前凭证：引导令牌或 Bearer
  credential: Credential;
  // 当前生效权限码，用于按钮级门禁
  permissions: string[];
}

// 多语言取值：入参放宽为可选值，规避 TS2869「?? 右侧不可达」
function pickLocale(field: Record<string, string | undefined>, fallback: string): string {
  // 优先简体中文，其次英文，最后回退到调用方给定值
  return field['zh-CN'] ?? field.en ?? fallback;
}

// 权益管理组件主体
export function Entitlements({ credential, permissions }: EntitlementsProps) {
  // 两个动作的权限门禁互相独立：可能出现只能发放不能回收的身份
  const canGrant = permissions.includes('entitlement:grant');
  const canRevoke = permissions.includes('entitlement:revoke');
  // 模块列表：发放表单的模块下拉需要 code 与展示名
  const modules = useAsync(() => listModules(credential), [credential]);
  // ── 发放表单状态 ──
  const [grantUserId, setGrantUserId] = useState('');
  const [grantModule, setGrantModule] = useState('');
  const [grantRegion, setGrantRegion] = useState<'cn' | 'global'>('cn');
  const [grantExpires, setGrantExpires] = useState('');
  // ── 回收表单状态 ──
  const [revokeId, setRevokeId] = useState('');
  const [revokeReason, setRevokeReason] = useState('');
  // 同一时刻只允许一个请求在途，避免重复提交
  const [busy, setBusy] = useState<'grant' | 'revoke' | null>(null);
  // 两个表单各自独立的错误与成功回执
  const [grantError, setGrantError] = useState<string | null>(null);
  const [grantReceipt, setGrantReceipt] = useState<EntitlementView | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revokeReceipt, setRevokeReceipt] = useState<RevokedReceipt | null>(null);

  // 模块下拉选项：抽到 TS 位置便于逐项注释
  const moduleOptions = (modules.data ?? []).map((item) => ({
    // 提交值使用模块码
    value: item.code,
    // 展示文案为「中文名（模块码）」
    label: `${pickLocale(item.name, item.code)}（${item.code}）`,
  }));

  // 发放回执展示字段：抽成数组后用 map 渲染，避免重复 JSX
  const grantRows = grantReceipt
    ? [
        { label: '权益 ID', value: grantReceipt.id },
        { label: '用户', value: grantReceipt.user_id },
        { label: '模块', value: grantReceipt.module_code },
        { label: '状态', value: grantReceipt.status },
        { label: '到期', value: grantReceipt.expires_at ?? '永久' },
        { label: '版本', value: String(grantReceipt.version) },
      ]
    : [];

  // 回收回执展示字段
  const revokeRows = revokeReceipt
    ? [
        { label: '权益 ID', value: revokeReceipt.id },
        { label: '用户', value: revokeReceipt.user_id },
        { label: '状态', value: revokeReceipt.status },
        { label: '版本', value: String(revokeReceipt.version) },
        { label: '时间', value: revokeReceipt.updated_at },
      ]
    : [];

  // 提交发放：必填校验 → 调用接口 → 保存回执
  async function submitGrant(event: FormEvent) {
    // 阻止表单默认跳转，保持单页体验
    event.preventDefault();
    // 清空上一轮结果，避免旧提示误导
    setGrantError(null);
    setGrantReceipt(null);
    // 前端先做必填校验，减少无效请求
    if (!grantUserId.trim() || !grantModule) {
      // 提示缺项
      setGrantError('请填写用户 ID 并选择模块');
      // 提前结束
      return;
    }
    // 置为在途，禁用按钮
    setBusy('grant');
    // 统一收尾
    try {
      // 调用发放接口：到期时间转为 ISO 字符串，留空表示永久有效
      const receipt = await grantEntitlement(credential, {
        // 去掉首尾空白，避免脏输入
        user_id: grantUserId.trim(),
        // 选中的模块码
        module_code: grantModule,
        // 数据区域
        region: grantRegion,
        // 仅在填写了到期时间时携带
        expires_at: grantExpires ? new Date(grantExpires).toISOString() : undefined,
      });
      // 保存回执用于展示
      setGrantReceipt(receipt);
    } catch (error) {
      // 失败统一转为可读文案
      setGrantError(describeError(error));
    } finally {
      // 无论成败都解除在途
      setBusy(null);
    }
  }

  // 提交回收：必填校验 → 调用接口 → 保存回执
  async function submitRevoke(event: FormEvent) {
    // 阻止表单默认跳转
    event.preventDefault();
    // 清空上一轮结果
    setRevokeError(null);
    setRevokeReceipt(null);
    // 权益 ID 必填
    if (!revokeId.trim()) {
      // 提示缺项
      setRevokeError('请填写权益 ID');
      // 提前结束
      return;
    }
    // 置为在途
    setBusy('revoke');
    // 统一收尾
    try {
      // 调用回收接口：原因选填，空字符串按未填处理
      const receipt = await revokeEntitlement(credential, revokeId.trim(), revokeReason.trim() || undefined);
      // 保存回执
      setRevokeReceipt(receipt);
    } catch (error) {
      // 失败提示
      setRevokeError(describeError(error));
    } finally {
      // 解除在途
      setBusy(null);
    }
  }

  // 渲染
  return (
    <div className="page">
      <div className="page-head">
        <h2>权益管理</h2>
        <span className="count">发放与回收都会写入 entitlement_events 审计</span>
      </div>
      <div className="split">
        <div className="panel">
          <div className="panel-head">
            <h3>发放权益</h3>
          </div>
          {!canGrant ? (
            // 缺权限时只读提示，不渲染表单
            <div className="hint">当前身份缺少 entitlement:grant 权限</div>
          ) : (
            <form className="form" onSubmit={(event) => void submitGrant(event)}>
              <label className="field">
                <span>用户 ID</span>
                <input
                  value={grantUserId}
                  onChange={(event) => setGrantUserId(event.target.value)}
                  placeholder="usr_xxx"
                  disabled={busy !== null}
                />
              </label>
              <label className="field">
                <span>模块</span>
                <select
                  value={grantModule}
                  onChange={(event) => setGrantModule(event.target.value)}
                  disabled={busy !== null}
                >
                  <option value="">请选择模块</option>
                  {moduleOptions.map((option) => (
                    // 每个模块一个选项
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>区域</span>
                <select
                  value={grantRegion}
                  onChange={(event) => setGrantRegion(event.target.value === 'global' ? 'global' : 'cn')}
                  disabled={busy !== null}
                >
                  <option value="cn">cn（中国大陆）</option>
                  <option value="global">global（海外）</option>
                </select>
              </label>
              <label className="field">
                <span>到期时间（留空永久）</span>
                <input
                  type="datetime-local"
                  value={grantExpires}
                  onChange={(event) => setGrantExpires(event.target.value)}
                  disabled={busy !== null}
                />
              </label>
              {modules.error ? (
                // 模块列表拉取失败不影响提交，仅提示可能选不到模块
                <div className="warning">模块列表加载失败：{describeError(modules.error)}</div>
              ) : null}
              {grantError ? (
                // 发放失败提示
                <div className="error">{grantError}</div>
              ) : null}
              <div className="row">
                <button className="btn primary" type="submit" disabled={busy !== null}>
                  {busy === 'grant' ? '发放中…' : '发放'}
                </button>
                <button
                  className="btn ghost"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    // 一键重置表单
                    setGrantUserId('');
                    setGrantModule('');
                    setGrantExpires('');
                    setGrantError(null);
                    setGrantReceipt(null);
                  }}
                >
                  清空
                </button>
              </div>
            </form>
          )}
          {grantRows.length > 0 ? (
            // 发放成功回执
            <table className="table">
              <tbody>
                {grantRows.map((row) => (
                  // 每行一个字段
                  <tr key={row.label}>
                    <th>{row.label}</th>
                    <td>
                      <code>{row.value}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
        <div className="panel">
          <div className="panel-head">
            <h3>回收权益</h3>
          </div>
          {!canRevoke ? (
            // 缺权限时只读提示
            <div className="hint">当前身份缺少 entitlement:revoke 权限</div>
          ) : (
            <form className="form" onSubmit={(event) => void submitRevoke(event)}>
              <label className="field">
                <span>权益 ID</span>
                <input
                  value={revokeId}
                  onChange={(event) => setRevokeId(event.target.value)}
                  placeholder="ent_xxx"
                  disabled={busy !== null}
                />
              </label>
              <label className="field">
                <span>回收原因（选填）</span>
                <input
                  value={revokeReason}
                  onChange={(event) => setRevokeReason(event.target.value)}
                  placeholder="如：退款 / 违规 / 人工纠正"
                  disabled={busy !== null}
                />
              </label>
              {revokeError ? (
                // 回收失败提示
                <div className="error">{revokeError}</div>
              ) : null}
              <div className="row">
                <button className="btn danger" type="submit" disabled={busy !== null}>
                  {busy === 'revoke' ? '回收中…' : '回收'}
                </button>
                <button
                  className="btn ghost"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    // 一键重置表单
                    setRevokeId('');
                    setRevokeReason('');
                    setRevokeError(null);
                    setRevokeReceipt(null);
                  }}
                >
                  清空
                </button>
              </div>
            </form>
          )}
          {revokeRows.length > 0 ? (
            // 回收成功回执
            <table className="table">
              <tbody>
                {revokeRows.map((row) => (
                  // 每行一个字段
                  <tr key={row.label}>
                    <th>{row.label}</th>
                    <td>
                      <code>{row.value}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
      <p className="muted">
        说明：后端暂未提供权益列表接口，本页仅回显最近一次操作结果；查询权益请在数据库或后续版本的分页列表中使用。
      </p>
    </div>
  );
}
