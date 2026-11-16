// 优惠码管理：新建、编辑面值与核销门槛、启停与删除；下单结算时用户输入优惠码即抵扣
import { useState } from 'react'; // 新建表单与行内编辑状态
import { describeError } from '../api'; // 统一错误文案
import type { Credential } from '../api'; // 凭证类型
import { // 优惠码四类操作
  createAdminCoupon,
  deleteAdminCoupon,
  listAdminCoupons,
  updateAdminCoupon,
} from '../api-shop-admin';
import type { AdminCoupon, CouponKind, CouponPayload } from '../api-shop-admin'; // 视图与入参类型
import { useAsync } from '../hooks'; // 统一异步加载

/** 入参：凭证与实时权限码 */
interface Props {
  credential: Credential; // 凭证
  permissions: string[]; // 实时权限码
}

/** 优惠码编码规则：与后端 COUPON_CODE_RE 完全一致，前端先转大写再校验 */
const COUPON_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,39}$/;

/** 分转元，保留两位小数 */
function formatYuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`; // 金额统一走分存储
}

/** 元串转分：非法或负数返回 null，避免 NaN 直接送后端 */
function toCents(raw: string): number | null {
  const value = Number(raw); // 先按数字解析
  if (!Number.isFinite(value) || value < 0) return null; // 非数字或负数直接拒绝
  return Math.round(value * 100); // 统一按分四舍五入
}

/** 面值展示：fixed 走金额，percent 走百分比 */
function formatValue(row: AdminCoupon): string {
  return row.kind === 'fixed' ? formatYuan(row.value) : `${row.value}%`; // 两类口径分开展示
}

/** 新建草稿：全部用字符串承载输入，提交时再转数字 */
interface Draft {
  code: string; // 优惠码
  kind: CouponKind; // 类型
  value: string; // 立减金额（元）或折扣百分比
  min: string; // 使用门槛（元）
  maxUses: string; // 次数上限，0 不限
  active: boolean; // 启停
}

/** 空草稿：提交成功后复位到这份常量，避免残留上一次输入 */
const EMPTY_DRAFT: Draft = { code: '', kind: 'fixed', value: '', min: '0', maxUses: '0', active: true };

/** 行内编辑草稿：编码与类型不可改，只暴露面值 / 门槛 / 次数 / 启停 */
interface EditDraft {
  value: string; // 面值（元）或百分比
  min: string; // 门槛（元）
  maxUses: string; // 次数上限
  active: boolean; // 启停
}

/** 更新入参：与 updateAdminCoupon 的 payload 结构一致 */
interface CouponPatch {
  value?: number; // 面值 / 比例
  min_amount_cents?: number; // 门槛（分）
  max_uses?: number; // 次数上限
  active?: boolean; // 启停
}

/** 校验面值与门槛：两类优惠码共用，返回字段错误与数值 */
function validateNumbers(kind: CouponKind, valueRaw: string, minRaw: string, maxRaw: string) {
  const errors: Record<string, string> = {}; // 字段 → 文案
  const minCents = toCents(minRaw.trim() || '0'); // 门槛空串按 0
  if (minCents === null) errors.min = '使用门槛需为不小于 0 的金额'; // 金额格式错
  const maxUses = Number(maxRaw.trim() || '0'); // 次数空串按 0（不限）
  if (!Number.isInteger(maxUses) || maxUses < 0) errors.maxUses = '次数上限需为不小于 0 的整数，0 表示不限'; // 整数校验
  let value = 0; // 面值或百分比
  if (kind === 'fixed') { // 固定立减：按金额校验
    const cents = toCents(valueRaw.trim()); // 元转分
    if (cents === null || cents < 1) errors.value = '立减金额需不小于 0.01 元'; // 后端下限 1 分
    else value = cents; // 通过校验
  } else { // 百分比折扣：按整数百分比校验
    const percent = Number(valueRaw.trim()); // 取整数值
    if (!Number.isInteger(percent) || percent < 1 || percent > 100) errors.value = '折扣百分比需为 1-100 的整数';
    else value = percent; // 通过校验
  }
  return { errors, value, minCents, maxUses }; // 汇总校验结果
}

/** 字段级错误提示：紧跟输入框，避免用户提交后才知道哪里错 */
function FieldError({ text }: { text?: string }) {
  if (!text) return null; // 无错误时不占位
  return <span style={{ color: 'var(--danger)', fontSize: 'var(--fs-xs)' }}>{text}</span>; // 就地红字
}

/** 优惠码面板：嵌在商品管理的「优惠码」页签内 */
export function Coupons({ credential, permissions }: Props) {
  const canWrite = permissions.includes('commerce:write'); // 与后端 requireCommerceWrite 对齐
  const state = useAsync(() => listAdminCoupons(credential), [credential]); // 全量列表（含停用）
  const [busy, setBusy] = useState(false); // 写操作进行中
  const [notice, setNotice] = useState(''); // 成功提示
  const [error, setError] = useState(''); // 接口错误
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT); // 新建草稿
  const [errors, setErrors] = useState<Record<string, string>>({}); // 新建字段错误
  const [editing, setEditing] = useState<AdminCoupon | null>(null); // 正在编辑的优惠码
  const [editDraft, setEditDraft] = useState<EditDraft>({ value: '', min: '0', maxUses: '0', active: true }); // 编辑草稿
  const [editErrors, setEditErrors] = useState<Record<string, string>>({}); // 编辑字段错误
  const rows = state.data ?? []; // 列表数据

  /** 统一执行写操作：成功后提示并刷新列表，失败统一转文案 */
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); // 进入忙碌态
    setError(''); // 清空接口错误
    setNotice(''); // 清空旧提示
    try {
      await action(); // 执行写请求
      setNotice(success); // 成功文案
      state.reload(); // 刷新列表
    } catch (err) {
      setError(describeError(err)); // 409 等业务错误直接展示
    } finally {
      setBusy(false); // 退出忙碌态
    }
  }

  /** 新建：先就地校验，通过后再发请求 */
  function submitCreate() {
    const checked = validateNumbers(draft.kind, draft.value, draft.min, draft.maxUses); // 数值校验
    const nextErrors: Record<string, string> = { ...checked.errors }; // 合并字段错误
    const code = draft.code.trim().toUpperCase(); // 入库统一大写
    if (!code) nextErrors.code = '优惠码必填'; // 空值
    else if (!COUPON_CODE_RE.test(code)) nextErrors.code = '需以大写字母或数字开头，2-40 位，仅含字母、数字、- 和 _';
    setErrors(nextErrors); // 渲染错误
    if (Object.keys(nextErrors).length > 0) return; // 有错不发请求
    const payload: CouponPayload = {
      code, // 大写编码
      kind: draft.kind, // 类型
      value: checked.value, // 面值或百分比
      min_amount_cents: checked.minCents ?? 0, // 门槛（分）
      max_uses: checked.maxUses, // 次数上限
      active: draft.active, // 启停
    }; // payload 组装结束
    void run(async () => {
      await createAdminCoupon(credential, payload); // 创建
      setDraft(EMPTY_DRAFT); // 成功后复位表单
      setErrors({}); // 清空错误
    }, `优惠码 ${code} 已创建`); // 成功文案
  }

  /** 进入编辑：把当前值摊平成草稿 */
  function startEdit(row: AdminCoupon) {
    setEditing(row); // 记录目标行
    setEditErrors({}); // 清空上次错误
    setEditDraft({
      value: row.kind === 'fixed' ? (row.value / 100).toFixed(2) : String(row.value), // 分转元或直接用百分比
      min: (row.min_amount_cents / 100).toFixed(2), // 门槛分转元
      maxUses: String(row.max_uses), // 次数
      active: row.active, // 启停
    }); // 草稿赋值结束
  }

  /** 保存编辑：只提交改动涉及的可编辑字段 */
  function submitEdit() {
    if (!editing) return; // 未选中行直接返回
    const checked = validateNumbers(editing.kind, editDraft.value, editDraft.min, editDraft.maxUses); // 复用数值校验
    setEditErrors(checked.errors); // 渲染错误
    if (Object.keys(checked.errors).length > 0) return; // 有错不发请求
    const payload: CouponPatch = {
      value: checked.value, // 面值 / 比例
      min_amount_cents: checked.minCents ?? 0, // 门槛（分）
      max_uses: checked.maxUses, // 次数上限
      active: editDraft.active, // 启停
    }; // patch 组装结束
    const code = editing.code; // 闭包内固定编码
    void run(async () => {
      await updateAdminCoupon(credential, code, payload); // 局部更新
      setEditing(null); // 关闭编辑面板
    }, `优惠码 ${code} 已更新`); // 成功文案
  }

  /** 删除：破坏性操作先二次确认；已被核销引用时后端返回 409 */
  function remove(row: AdminCoupon) {
    const ok = window.confirm(`确认删除优惠码「${row.code}」？删除后不可恢复；已被订单核销引用的优惠码会被拒绝删除。`); // 二次确认
    if (!ok) return; // 用户取消
    void run(() => deleteAdminCoupon(credential, row.code), `优惠码 ${row.code} 已删除`); // 执行删除
  }

  return (
    <>
      {!canWrite ? <div className="hint">当前身份缺少 commerce:write 权限，只能查看优惠码，不能新建或修改。</div> : null}
      {notice ? <div className="success">{notice}</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <section className="panel">
        <div className="panel-head">
          <h3>新建优惠码</h3>
          <span className="muted">编码入库统一大写，创建后不可修改</span>
        </div>
        <div className="form inline">
          <label>
            优惠码
            <input
              value={draft.code}
              onChange={(event) => setDraft({ ...draft, code: event.target.value.toUpperCase() })} // 输入即转大写
              placeholder="WELCOME10"
              aria-invalid={Boolean(errors.code)}
            />
            <FieldError text={errors.code} />
          </label>
          <label>
            类型
            <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as CouponKind })}>
              <option value="fixed">固定立减</option>
              <option value="percent">百分比折扣</option>
            </select>
          </label>
          <label>
            {draft.kind === 'fixed' ? '立减金额（元）' : '折扣百分比（20 即立减 20%）'}
            <input
              value={draft.value}
              onChange={(event) => setDraft({ ...draft, value: event.target.value })}
              placeholder={draft.kind === 'fixed' ? '10.00' : '20'}
              inputMode="decimal"
              aria-invalid={Boolean(errors.value)}
            />
            <FieldError text={errors.value} />
          </label>
          <label>
            使用门槛（元）
            <input
              value={draft.min}
              onChange={(event) => setDraft({ ...draft, min: event.target.value })}
              placeholder="0"
              inputMode="decimal"
              aria-invalid={Boolean(errors.min)}
            />
            <FieldError text={errors.min} />
          </label>
          <label>
            次数上限
            <input
              value={draft.maxUses}
              onChange={(event) => setDraft({ ...draft, maxUses: event.target.value })}
              placeholder="0"
              inputMode="numeric"
              aria-invalid={Boolean(errors.maxUses)}
            />
            <FieldError text={errors.maxUses} />
          </label>
          <label className="check">
            <input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />
            立即启用
          </label>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" className="btn primary" disabled={busy || !canWrite} onClick={submitCreate}>
            创建优惠码
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => { setDraft(EMPTY_DRAFT); setErrors({}); }}>
            清空
          </button>
        </div>
      </section>

      {editing ? (
        <section className="panel">
          <div className="panel-head">
            <h3>编辑优惠码 {editing.code}</h3>
            <span className="muted">{editing.kind === 'fixed' ? '固定立减' : '百分比折扣'} · 已核销 {editing.used_count} 次</span>
          </div>
          <div className="form inline">
            <label>
              {editing.kind === 'fixed' ? '立减金额（元）' : '折扣百分比'}
              <input
                value={editDraft.value}
                onChange={(event) => setEditDraft({ ...editDraft, value: event.target.value })}
                inputMode="decimal"
                aria-invalid={Boolean(editErrors.value)}
              />
              <FieldError text={editErrors.value} />
            </label>
            <label>
              使用门槛（元）
              <input
                value={editDraft.min}
                onChange={(event) => setEditDraft({ ...editDraft, min: event.target.value })}
                inputMode="decimal"
                aria-invalid={Boolean(editErrors.min)}
              />
              <FieldError text={editErrors.min} />
            </label>
            <label>
              次数上限
              <input
                value={editDraft.maxUses}
                onChange={(event) => setEditDraft({ ...editDraft, maxUses: event.target.value })}
                inputMode="numeric"
                aria-invalid={Boolean(editErrors.maxUses)}
              />
              <FieldError text={editErrors.maxUses} />
            </label>
            <label className="check">
              <input type="checkbox" checked={editDraft.active} onChange={(event) => setEditDraft({ ...editDraft, active: event.target.checked })} />
              启用
            </label>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" className="btn primary" disabled={busy || !canWrite} onClick={submitEdit}>
              保存修改
            </button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setEditing(null)}>
              取消
            </button>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <h3>优惠码列表</h3>
          <span className="muted">共 {rows.length} 张</span>
        </div>

        {state.loading ? <p className="muted">加载中…</p> : null}
        {state.error ? <p className="error">列表加载失败：{describeError(state.error)}</p> : null}
        {!state.loading && !state.error && rows.length === 0 ? (
          <div className="empty">
            还没有优惠码，因为后台从未创建过。
            <br />
            下一步：用上方「新建优惠码」填写编码与面值，创建后用户即可在下单结算时输入该编码抵扣。
          </div>
        ) : null}

        {rows.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>优惠码</th>
                <th>类型</th>
                <th>面值</th>
                <th>门槛</th>
                <th>已核销 / 上限</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <code>{row.code}</code>
                  </td>
                  <td>{row.kind === 'fixed' ? '固定立减' : '百分比折扣'}</td>
                  <td>{formatValue(row)}</td>
                  <td>{row.min_amount_cents > 0 ? `满 ${formatYuan(row.min_amount_cents)}` : <span className="muted">无门槛</span>}</td>
                  <td>
                    {row.used_count} / {row.max_uses === 0 ? '不限' : row.max_uses}
                  </td>
                  <td>
                    <span className={row.active ? 'badge active' : 'badge draft'}>{row.active ? '启用' : '停用'}</span>
                  </td>
                  <td>
                    {canWrite ? (
                      <div className="row">
                        <button type="button" className="btn ghost small" disabled={busy} onClick={() => startEdit(row)}>
                          编辑
                        </button>
                        <button type="button" className="btn ghost small" disabled={busy} onClick={() => remove(row)}>
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
      </section>
    </>
  );
}
