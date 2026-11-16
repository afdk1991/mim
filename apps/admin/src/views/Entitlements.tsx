// 权益：会员套餐的新建与删除、价格档位与权益清单维护
import { useState } from 'react'; // 新建表单与行内操作状态
import { describeError } from '../api'; // 统一错误文案
import type { Credential } from '../api'; // 凭证类型
import { createAdminVipPlan, deleteAdminVipPlan, listAdminVipPlans, updateAdminVipPlan } from '../api-shop-admin'; // 套餐四类操作
import type { AdminVipPlan, PlanPayload } from '../api-shop-admin'; // 视图与入参类型
import { useAsync } from '../hooks'; // 统一异步加载

/** 入参：凭证与实时权限码 */
interface Props {
  credential: Credential; // 凭证
  permissions: string[]; // 实时权限码
}

/** 套餐编码规则：与后端 PLAN_CODE_RE 完全一致 */
const PLAN_CODE_RE = /^[a-z0-9][a-z0-9_-]{1,59}$/;

/** 分转元，保留两位小数 */
function formatYuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`; // 金额统一走分存储
}

/** 元串转分：允许 0，非法或负数返回 null */
function toCents(raw: string): number | null {
  const value = Number(raw); // 先按数字解析
  if (!Number.isFinite(value) || value < 0) return null; // 非数字或负数拒绝
  return Math.round(value * 100); // 统一按分四舍五入
}

/** 权益清单解析：支持换行、顿号、逗号分隔，去空去重 */
function parsePerks(raw: string): string[] {
  const parts = raw.split(/[\n、,，]/).map((item) => item.trim()).filter(Boolean); // 统一分隔符
  return [...new Set(parts)]; // 去重，避免同一权益重复上架
}

/** 新建套餐草稿：数字字段用字符串承载，提交时再转换 */
interface Draft {
  code: string; // 套餐编码
  name: string; // 套餐名
  level: string; // 会员等级 1-10
  price: string; // 售价（元）
  days: string; // 有效期天数
  perks: string; // 权益清单，一行一条
  active: boolean; // 启停
}

/** 空草稿：提交成功后复位到这里 */
const EMPTY_DRAFT: Draft = { code: '', name: '', level: '1', price: '', days: '30', perks: '', active: true };

/** 字段级错误提示：紧跟输入框，避免提交后才知道哪里错 */
function FieldError({ text }: { text?: string }) {
  if (!text) return null; // 无错误不占位
  return <span style={{ color: 'var(--danger)', fontSize: 'var(--fs-xs)' }}>{text}</span>; // 就地红字
}

/** 权益主视图 */
export function Entitlements({ credential, permissions }: Props) {
  const canWrite = permissions.includes('commerce:write'); // 与后端 requireCommerceWrite 对齐
  const state = useAsync(() => listAdminVipPlans(credential), [credential]); // 套餐全量列表
  const [busyCode, setBusyCode] = useState<string | null>(null); // 行内操作中的套餐编码
  const [creating, setCreating] = useState(false); // 新建提交中
  const [notice, setNotice] = useState(''); // 成功提示
  const [error, setError] = useState(''); // 接口错误
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT); // 新建草稿
  const [errors, setErrors] = useState<Record<string, string>>({}); // 字段错误

  /** 切换套餐启停：下架后前台不再展示、不可新购 */
  async function toggle(row: AdminVipPlan) {
    setBusyCode(row.code); // 锁定当前行
    setError(''); // 清空旧错误
    setNotice(''); // 清空旧提示
    try {
      await updateAdminVipPlan(credential, row.code, { active: !row.active }); // 反转启停
      setNotice(`${row.name} 已${row.active ? '停用' : '启用'}`); // 成功提示
      state.reload(); // 刷新列表
    } catch (err) {
      setError(describeError(err)); // 统一错误
    } finally {
      setBusyCode(null); // 解锁行
    }
  }

  /** 新建套餐：先就地校验，通过后再发请求 */
  async function submitCreate() {
    const nextErrors: Record<string, string> = {}; // 收集字段错误
    const code = draft.code.trim(); // 编码只收小写
    if (!code) nextErrors.code = '套餐编码必填'; // 空值
    else if (!PLAN_CODE_RE.test(code)) nextErrors.code = '需以小写字母或数字开头，3-60 位，仅含小写字母、数字、- 和 _';
    const name = draft.name.trim(); // 名称去首尾空格
    if (!name) nextErrors.name = '套餐名必填'; // 空值
    else if (name.length > 80) nextErrors.name = '套餐名最多 80 字'; // 上限对齐后端
    const level = Number(draft.level.trim()); // 等级
    if (!Number.isInteger(level) || level < 1 || level > 10) nextErrors.level = '等级需为 1-10 的整数';
    const priceCents = toCents(draft.price.trim()); // 售价转分
    if (priceCents === null) nextErrors.price = '售价需为不小于 0 的数字'; // 金额格式
    const days = Number(draft.days.trim()); // 有效期天数
    if (!Number.isInteger(days) || days < 1 || days > 3650) nextErrors.days = '有效期需为 1-3650 的整数（天）';
    const perks = parsePerks(draft.perks); // 权益清单
    if (perks.length > 20) nextErrors.perks = '权益清单最多 20 条'; // 上限对齐后端
    else if (perks.some((perk) => perk.length > 80)) nextErrors.perks = '单条权益最长 80 字'; // 单条上限
    setErrors(nextErrors); // 渲染错误
    if (Object.keys(nextErrors).length > 0) return; // 有错不发请求
    const payload: PlanPayload = {
      code, // 编码
      name, // 名称
      level, // 等级
      price_cents: priceCents as number, // 售价（分）
      duration_days: days, // 有效期天数
      perks, // 权益清单
      active: draft.active, // 启停
    }; // payload 组装结束
    setCreating(true); // 进入提交态
    setError(''); // 清空旧错误
    setNotice(''); // 清空旧提示
    try {
      await createAdminVipPlan(credential, payload); // 创建套餐
      setNotice(`套餐 ${name} 已创建`); // 成功提示
      setDraft(EMPTY_DRAFT); // 复位表单
      setErrors({}); // 清空错误
      state.reload(); // 刷新列表
    } catch (err) {
      setError(describeError(err)); // 编码重复等业务错误直接展示
    } finally {
      setCreating(false); // 退出提交态
    }
  }

  /** 删除套餐：破坏性操作先二次确认；仍有会员归属时后端返回 409 */
  async function remove(row: AdminVipPlan) {
    const ok = window.confirm(`确认删除套餐「${row.name}」？删除后不可恢复；仍有会员归属的套餐会被后端拒绝删除，请先改为停用。`); // 二次确认
    if (!ok) return; // 用户取消
    setBusyCode(row.code); // 锁定当前行
    setError(''); // 清空旧错误
    setNotice(''); // 清空旧提示
    try {
      await deleteAdminVipPlan(credential, row.code); // 删除
      setNotice(`套餐 ${row.name} 已删除`); // 成功提示
      state.reload(); // 刷新列表
    } catch (err) {
      setError(describeError(err)); // 统一错误
    } finally {
      setBusyCode(null); // 解锁行
    }
  }

  const rows = state.data ?? []; // 列表数据

  return (
    <div className="page">
      <header className="page-head">
        <h1>权益</h1>
        <p className="page-desc">这里新建与维护会员套餐的等级、价格、有效期与权益清单，并控制套餐是否在前台开放购买。</p>
      </header>

      {!canWrite ? <div className="hint">当前身份只有只读权限，无法新建、启停或删除套餐。</div> : null}
      {notice ? <div className="success">{notice}</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <section className="panel">
        <div className="panel-head">
          <h3>新建套餐</h3>
          <span className="muted">编码创建后不可修改，权益清单一行一条</span>
        </div>
        <div className="form inline">
          <label>
            套餐编码
            <input
              value={draft.code}
              onChange={(event) => setDraft({ ...draft, code: event.target.value })}
              placeholder="vip-pro-30d"
              aria-invalid={Boolean(errors.code)}
            />
            <FieldError text={errors.code} />
          </label>
          <label className="grow">
            套餐名
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="专业会员 30 天"
              aria-invalid={Boolean(errors.name)}
            />
            <FieldError text={errors.name} />
          </label>
          <label>
            等级（1-10）
            <input
              value={draft.level}
              onChange={(event) => setDraft({ ...draft, level: event.target.value })}
              inputMode="numeric"
              aria-invalid={Boolean(errors.level)}
            />
            <FieldError text={errors.level} />
          </label>
          <label>
            售价（元）
            <input
              value={draft.price}
              onChange={(event) => setDraft({ ...draft, price: event.target.value })}
              placeholder="29.00"
              inputMode="decimal"
              aria-invalid={Boolean(errors.price)}
            />
            <FieldError text={errors.price} />
          </label>
          <label>
            有效期（天）
            <input
              value={draft.days}
              onChange={(event) => setDraft({ ...draft, days: event.target.value })}
              inputMode="numeric"
              aria-invalid={Boolean(errors.days)}
            />
            <FieldError text={errors.days} />
          </label>
          <label className="check">
            <input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />
            立即开放
          </label>
        </div>
        <label className="field">
          权益清单
          <textarea
            value={draft.perks}
            onChange={(event) => setDraft({ ...draft, perks: event.target.value })}
            rows={3}
            placeholder={'选填，一行一条，例如：\n无限私信\n专属徽章\n优先客服'}
            aria-invalid={Boolean(errors.perks)}
          />
          <FieldError text={errors.perks} />
        </label>
        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" className="btn primary" disabled={creating || !canWrite} onClick={() => void submitCreate()}>
            {creating ? '创建中…' : '创建套餐'}
          </button>
          <button type="button" className="btn ghost" disabled={creating} onClick={() => { setDraft(EMPTY_DRAFT); setErrors({}); }}>
            清空
          </button>
        </div>
      </section>

      <div className="panel">
        <div className="panel-head">
          <h3>会员套餐</h3>
          <span className="muted">共 {rows.length} 个</span>
        </div>

        {state.loading ? <p className="muted">加载中…</p> : null}
        {state.error ? <p className="error">列表加载失败：{describeError(state.error)}</p> : null}
        {!state.loading && !state.error && rows.length === 0 ? (
          <div className="empty">
            还没有配置会员套餐，因为后台从未创建过。
            <br />
            下一步：用上方「新建套餐」填写编码、等级与售价，创建后前台会员页即可展示并购买。
          </div>
        ) : null}

        {rows.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>套餐</th>
                <th>等级</th>
                <th>价格</th>
                <th>有效期</th>
                <th>权益清单</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.name}
                    <div className="muted">
                      <code>{row.code}</code>
                    </div>
                  </td>
                  <td>Lv.{row.level}</td>
                  <td>{formatYuan(row.price_cents)}</td>
                  <td>{row.duration_days} 天</td>
                  <td>
                    {row.perks.length > 0 ? row.perks.join('、') : <span className="muted">未填写</span>}
                  </td>
                  <td>
                    <span className={row.active ? 'badge' : 'badge draft'}>{row.active ? '开放' : '停用'}</span>
                  </td>
                  <td>
                    {canWrite ? (
                      <div className="row">
                        <button
                          className="btn ghost small"
                          type="button"
                          disabled={busyCode === row.code}
                          onClick={() => void toggle(row)}
                        >
                          {row.active ? '停用' : '启用'}
                        </button>
                        <button
                          className="btn ghost small"
                          type="button"
                          disabled={busyCode === row.code}
                          onClick={() => void remove(row)}
                        >
                          删除
                        </button>
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
