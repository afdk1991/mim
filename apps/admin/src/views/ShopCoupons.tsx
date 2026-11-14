// 优惠码管理视图：列表 + 新建 / 启停 + 删除确认
import { useState } from 'react'; // 表单与页签状态
import type { AdminCoupon, Credential } from '../api'; // 类型
import {
  createAdminCoupon,
  deleteAdminCoupon,
  describeError,
  listAdminCoupons,
  updateAdminCoupon,
} from '../api'; // 优惠码 API
import { useAsync } from '../hooks'; // 统一异步加载

/** 入参形态：金额以元为输入，提交时换算分 */
interface CouponForm {
  // 优惠码
  code: string;
  // 类型
  kind: 'fixed' | 'percent';
  // 面值 / 折扣比例
  value: string;
  // 最低可用金额（元）
  minYuan: string;
  // 最大核销次数，0 不限
  max_uses: string;
  // 启用
  active: boolean;
  // 过期时间（日期串，可空）
  expires_at: string;
} // CouponForm 结束

/** 空白表单草稿 */
const EMPTY_FORM: CouponForm = { // 初始值集中一处
  code: '',
  kind: 'fixed',
  value: '1',
  minYuan: '0',
  max_uses: '0',
  active: true,
  expires_at: '',
}; // EMPTY_FORM 结束

interface Props { // 入参
  credential: Credential; // 凭证
  permissions: string[]; // 权限集合
} // Props 结束

/** 优惠码面值展示：固定立减显示元，百分比显示 % */
function face(row: AdminCoupon): string { // 业务步骤
  return row.kind === 'fixed' ? `${(row.value / 100).toFixed(2)} 元` : `${row.value}%`; // 口径分流
} // face 结束

/** 优惠码管理视图主体 */
export function ShopCoupons({ credential, permissions }: Props) { // 业务步骤
  const canWrite = permissions.includes('commerce:write'); // 写操作权限点
  const listState = useAsync(() => listAdminCoupons(credential), [credential]); // 优惠码列表
  const [form, setForm] = useState<CouponForm>(EMPTY_FORM); // 表单草稿
  const [error, setError] = useState(''); // 错误提示
  const [notice, setNotice] = useState(''); // 成功提示
  const [busy, setBusy] = useState(false); // 操作中

  /** 统一执行写操作：成功后刷新列表 */
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); // 进入忙碌态
    setError(''); // 清空错误
    setNotice(''); // 清空提示
    try { // 业务步骤
      await action(); // 执行
      setNotice(success); // 成功提示
      listState.reload(); // 刷新列表
    } catch (err) {
      setError(describeError(err)); // 统一错误
    } finally {
      setBusy(false); // 退出忙碌态
    } // 业务步骤
  } // run 结束

  /** 提交新建优惠码 */
  function submit() {
    const value = Math.max(1, Math.round(Number(form.value || 0))); // 面值 / 比例取整
    const min_amount_cents = Math.round(Number(form.minYuan || 0) * 100); // 元转分
    const max_uses = Math.max(0, Math.round(Number(form.max_uses || 0))); // 次数取整
    void run(async () => { // 业务步骤
      await createAdminCoupon(credential, { // 提交创建入参
        code: form.code.trim(),
        kind: form.kind,
        value,
        min_amount_cents,
        max_uses,
        active: form.active,
        expires_at: form.expires_at.trim() || null,
      }); // 创建请求结束
      setForm(EMPTY_FORM); // 清空表单
    }, '优惠码已创建'); // 成功提示
  } // submit 结束

  /** 启停切换 */
  function toggle(row: AdminCoupon) {
    void run(() => updateAdminCoupon(credential, row.code, { active: !row.active }), row.active ? '优惠码已停用' : '优惠码已启用'); // 翻转状态
  } // toggle 结束

  /** 删除：二次确认 */
  function remove(row: AdminCoupon) {
    if (!window.confirm(`确认删除优惠码 ${row.code}？已被核销引用时后端会拒绝删除。`)) return; // 用户取消不动作
    void run(() => deleteAdminCoupon(credential, row.code), '优惠码已删除'); // 执行删除
  } // remove 结束

  const coupons = listState.data ?? []; // 列表兜底空数组

  return ( // 返回当前视图
    <div className="page">{/* 页面容器 */}
      <header className="page-head">{/* 标题行 */}
        <h1>优惠码</h1>
        <p className="muted">固定立减或百分比折扣：门槛、次数与有效期按码配置，停用后下单不可用。</p>
      </header>

      {!canWrite && <div className="panel error">当前账号缺少 commerce:write 权限，仅可查看。</div>}
      {error && <div className="panel error">{error}</div>}
      {notice && <div className="panel hint">{notice}</div>}

      <section className="panel">{/* 新建表单面板 */}
        <div className="panel-head"><h3>新建优惠码</h3></div>
        <div className="form inline">{/* 行内表单 */}
          <label className="grow">编码<input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="WELCOME10" /></label>
          <label>类型{/* 类型选择 */}
            <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as CouponForm['kind'] })}>
              <option value="fixed">固定立减</option>
              <option value="percent">百分比折扣</option>
            </select>
          </label>
          <label>{form.kind === 'percent' ? '折扣（1-100）' : '立减金额（元）'}<input value={form.value} inputMode="decimal" onChange={(event) => setForm({ ...form, value: event.target.value })} /></label>
          <label>门槛（元）<input value={form.minYuan} inputMode="decimal" onChange={(event) => setForm({ ...form, minYuan: event.target.value })} /></label>
          <label>最大次数（0 不限）<input value={form.max_uses} inputMode="numeric" onChange={(event) => setForm({ ...form, max_uses: event.target.value })} /></label>
          <label>过期时间<input type="date" value={form.expires_at} onChange={(event) => setForm({ ...form, expires_at: event.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />启用</label>
        </div>
        <button type="button" className="btn primary" disabled={busy || !canWrite || form.code.trim().length === 0} onClick={submit}>创建优惠码</button>
      </section>

      <section className="panel">{/* 列表面板 */}
        <div className="panel-head"><h3>优惠码列表</h3><span className="muted">{coupons.length}</span></div>
        {listState.loading && <p className="muted">加载中…</p>}
        {coupons.map((row) => ( // 逐条渲染优惠码行
          <div className="deploy-row" key={row.id}>{/* 行容器 */}
            <div className="deploy-kv">{/* 主信息列 */}
              <span><strong>{row.code}</strong> · {face(row)}</span>
              <span className={`badge ${row.active ? 'active' : 'draft'}`}>{row.active ? '启用' : '停用'}</span>
              <span className="muted">门槛 {(row.min_amount_cents / 100).toFixed(2)} 元 · 已用 {row.used_count}{row.max_uses > 0 ? ` / ${row.max_uses}` : ' / 不限'}{row.expires_at ? ` · 至 ${row.expires_at.slice(0, 10)}` : ''}</span>
            </div>
            <div className="deploy-columns">{/* 操作列 */}
              <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => toggle(row)}>{row.active ? '停用' : '启用'}</button>
              <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => remove(row)}>删除</button>
            </div>
          </div>
        ))}
      </section>
    </div>
  ); // 视图返回结束
} // ShopCoupons 结束
