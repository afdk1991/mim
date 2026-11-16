// 商品管理：商品台账、上架状态与单价维护；同页签管理优惠码与充值卡密（批量调价走「批量改价」）
import { useState } from 'react'; // 页签、表单与行内编辑状态
import { describeError } from '../api'; // 统一错误文案
import type { Credential } from '../api'; // 凭证类型
import { createAdminProduct, deleteAdminProduct, listAdminProducts, updateAdminProduct } from '../api-shop-admin'; // 商品四类操作
import type { AdminProduct, ProductKind, ProductPayload, ProductStatus } from '../api-shop-admin'; // 视图与入参类型
import { useAsync } from '../hooks'; // 统一异步加载
import { Cards } from './Cards'; // 卡密页签
import { Coupons } from './Coupons'; // 优惠码页签

/** 入参：凭证与实时权限码 */
interface Props {
  credential: Credential; // 凭证
  permissions: string[]; // 实时权限码
}

/** 页签：商品 / 优惠码 / 卡密，三者同属交易资产，不新增大类 */
type Tab = 'products' | 'coupons' | 'cards';

/** 商品编码规则：与后端 PRODUCT_CODE_RE 完全一致 */
const PRODUCT_CODE_RE = /^[a-z0-9][a-z0-9_-]{1,59}$/;

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

/** 新建商品草稿：数字字段用字符串承载，提交时再转换 */
interface Draft {
  code: string; // 商品编码
  name: string; // 商品名
  kind: ProductKind; // 发货方式
  price: string; // 售价（元）
  stock: string; // 库存（实物 / 人工）
  summary: string; // 简介
  deliveryNote: string; // 发货说明
  cardKeys: string; // 卡密批次，一行一张（仅虚拟自动）
  status: ProductStatus; // 上架位
}

/** 空草稿：提交成功后复位到这里 */
const EMPTY_DRAFT: Draft = {
  code: '', // 编码
  name: '', // 名称
  kind: 'physical', // 默认实物
  price: '', // 售价
  stock: '0', // 库存
  summary: '', // 简介
  deliveryNote: '', // 发货说明
  cardKeys: '', // 卡密
  status: 'active', // 默认在售
};

/** 字段级错误提示：紧跟输入框，避免提交后才知道哪里错 */
function FieldError({ text }: { text?: string }) {
  if (!text) return null; // 无错误不占位
  return <span style={{ color: 'var(--danger)', fontSize: 'var(--fs-xs)' }}>{text}</span>; // 就地红字
}

/** 商品管理主视图 */
export function Products({ credential, permissions }: Props) {
  const canWrite = permissions.includes('commerce:write'); // 与后端 requireCommerceWrite 对齐
  const state = useAsync(() => listAdminProducts(credential), [credential]); // 商品全量列表
  const [tab, setTab] = useState<Tab>('products'); // 当前页签
  const [busyCode, setBusyCode] = useState<string | null>(null); // 行内操作中的商品编码
  const [creating, setCreating] = useState(false); // 新建提交中
  const [notice, setNotice] = useState(''); // 成功提示
  const [error, setError] = useState(''); // 接口错误
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({}); // 单价行内草稿
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT); // 新建商品草稿
  const [errors, setErrors] = useState<Record<string, string>>({}); // 新建字段错误

  /** 保存单行单价 */
  async function savePrice(row: AdminProduct) {
    const raw = priceDraft[row.code] ?? (row.price_cents / 100).toFixed(2); // 优先取草稿
    const yuan = Number(raw); // 元串转数字
    if (!Number.isFinite(yuan) || yuan < 0) {
      setError('单价需为不小于 0 的数字'); // 就地拒绝非法输入
      return;
    }
    setBusyCode(row.code); // 锁定当前行
    setError(''); // 清空旧错误
    setNotice(''); // 清空旧提示
    try {
      await updateAdminProduct(credential, row.code, { price_cents: Math.round(yuan * 100) }); // 单价按分提交
      setNotice(`已更新 ${row.name} 的单价`); // 成功提示
      state.reload(); // 刷新列表
    } catch (err) {
      setError(describeError(err)); // 统一错误
    } finally {
      setBusyCode(null); // 解锁行
    }
  }

  /** 切换上架 / 下架 */
  async function toggleStatus(row: AdminProduct) {
    setBusyCode(row.code); // 锁定当前行
    setError(''); // 清空旧错误
    setNotice(''); // 清空旧提示
    try {
      const next = row.status === 'active' ? 'off' : 'active'; // 目标状态
      await updateAdminProduct(credential, row.code, { status: next }); // 提交状态
      setNotice(`${row.name} 已${next === 'active' ? '上架' : '下架'}`); // 成功提示
      state.reload(); // 刷新列表
    } catch (err) {
      setError(describeError(err)); // 统一错误
    } finally {
      setBusyCode(null); // 解锁行
    }
  }

  /** 新建商品：先就地校验，通过后再发请求 */
  async function submitCreate() {
    const nextErrors: Record<string, string> = {}; // 收集字段错误
    const code = draft.code.trim(); // 编码不容错大小写，后端只收小写
    if (!code) nextErrors.code = '商品编码必填'; // 空值
    else if (!PRODUCT_CODE_RE.test(code)) nextErrors.code = '需以小写字母或数字开头，3-60 位，仅含小写字母、数字、- 和 _';
    const name = draft.name.trim(); // 名称去首尾空格
    if (!name) nextErrors.name = '商品名必填'; // 空值
    else if (name.length > 80) nextErrors.name = '商品名最多 80 字'; // 上限对齐后端
    const priceCents = toCents(draft.price.trim()); // 售价转分
    if (priceCents === null) nextErrors.price = '售价需为不小于 0 的数字'; // 金额格式
    const stock = Number(draft.stock.trim() || '0'); // 库存空串按 0
    if (draft.kind !== 'virtual_auto' && (!Number.isInteger(stock) || stock < 0)) nextErrors.stock = '库存需为不小于 0 的整数';
    const keys = draft.cardKeys.split('\n').map((line) => line.trim()).filter(Boolean); // 按行切卡密
    if (keys.length > 500) nextErrors.cardKeys = '单批最多 500 张卡密'; // 上限对齐后端
    else if (keys.some((key) => key.length > 64)) nextErrors.cardKeys = '单张卡密最长 64 字符'; // 单张上限
    else if (draft.kind !== 'virtual_auto' && keys.length > 0) nextErrors.cardKeys = '只有「虚拟自动」商品可以预置卡密';
    setErrors(nextErrors); // 渲染错误
    if (Object.keys(nextErrors).length > 0) return; // 有错不发请求
    const payload: ProductPayload = {
      code, // 编码
      name, // 名称
      kind: draft.kind, // 发货方式
      price_cents: priceCents as number, // 售价（分）
      stock: draft.kind === 'virtual_auto' ? 0 : stock, // 自动发货库存由卡密决定
      summary: draft.summary.trim(), // 简介
      delivery_note: draft.deliveryNote.trim(), // 发货说明
      status: draft.status, // 上架位
    }; // payload 组装结束
    if (draft.kind === 'virtual_auto' && keys.length > 0) payload.card_keys = keys; // 仅在自动发货时携带卡密
    setCreating(true); // 进入提交态
    setError(''); // 清空旧错误
    setNotice(''); // 清空旧提示
    try {
      await createAdminProduct(credential, payload); // 创建商品
      setNotice(`商品 ${name} 已创建`); // 成功提示
      setDraft(EMPTY_DRAFT); // 复位表单
      setErrors({}); // 清空错误
      state.reload(); // 刷新列表
    } catch (err) {
      setError(describeError(err)); // 编码重复等业务错误直接展示
    } finally {
      setCreating(false); // 退出提交态
    }
  }

  /** 删除商品：破坏性操作先二次确认；已有订单引用时后端返回 409 */
  async function remove(row: AdminProduct) {
    const ok = window.confirm(`确认删除商品「${row.name}」？删除后不可恢复；已产生订单或卡密的商品会被后端拒绝删除。`); // 二次确认
    if (!ok) return; // 用户取消
    setBusyCode(row.code); // 锁定当前行
    setError(''); // 清空旧错误
    setNotice(''); // 清空旧提示
    try {
      await deleteAdminProduct(credential, row.code); // 删除
      setNotice(`商品 ${row.name} 已删除`); // 成功提示
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
        <h1>商品管理</h1>
        <p className="page-desc">这里维护商城商品的台账、上架状态与单价，同一页签下还能管理优惠码与充值卡密；需要整批调价时改用「批量改价」，避免逐个改动。</p>
      </header>

      {!canWrite ? <div className="hint">当前身份只有只读权限，无法修改商品、优惠码或卡密。</div> : null}
      {notice ? <div className="success">{notice}</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <div className="tabs">
        <button type="button" className={`tab${tab === 'products' ? ' active' : ''}`} onClick={() => setTab('products')}>商品</button>
        <button type="button" className={`tab${tab === 'coupons' ? ' active' : ''}`} onClick={() => setTab('coupons')}>优惠码</button>
        <button type="button" className={`tab${tab === 'cards' ? ' active' : ''}`} onClick={() => setTab('cards')}>卡密</button>
      </div>

      {tab === 'products' ? (
        <>
          <section className="panel">
            <div className="panel-head">
              <h3>新建商品</h3>
              <span className="muted">编码创建后不可修改，虚拟自动发货可直接预置卡密</span>
            </div>
            <div className="form inline">
              <label>
                商品编码
                <input
                  value={draft.code}
                  onChange={(event) => setDraft({ ...draft, code: event.target.value })}
                  placeholder="mim-pro-30d"
                  aria-invalid={Boolean(errors.code)}
                />
                <FieldError text={errors.code} />
              </label>
              <label className="grow">
                商品名
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="Mim Pro 30 天"
                  aria-invalid={Boolean(errors.name)}
                />
                <FieldError text={errors.name} />
              </label>
              <label>
                发货方式
                <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as ProductKind })}>
                  <option value="physical">实物</option>
                  <option value="virtual_auto">虚拟自动</option>
                  <option value="virtual_manual">虚拟人工</option>
                </select>
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
              {draft.kind !== 'virtual_auto' ? (
                <label>
                  库存
                  <input
                    value={draft.stock}
                    onChange={(event) => setDraft({ ...draft, stock: event.target.value })}
                    placeholder="0"
                    inputMode="numeric"
                    aria-invalid={Boolean(errors.stock)}
                  />
                  <FieldError text={errors.stock} />
                </label>
              ) : null}
              <label>
                状态
                <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ProductStatus })}>
                  <option value="active">在售</option>
                  <option value="off">下架</option>
                </select>
              </label>
            </div>
            <label className="field">
              简介
              <input value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} placeholder="选填，列表页展示的一句话简介" />
            </label>
            <label className="field">
              发货说明
              <input value={draft.deliveryNote} onChange={(event) => setDraft({ ...draft, deliveryNote: event.target.value })} placeholder="选填，下单后展示给用户的发货说明" />
            </label>
            {draft.kind === 'virtual_auto' ? (
              <label className="field">
                预置卡密
                <textarea
                  value={draft.cardKeys}
                  onChange={(event) => setDraft({ ...draft, cardKeys: event.target.value })}
                  rows={4}
                  placeholder={'选填，一行一张，最多 500 张；重复卡密会自动去重'}
                  aria-invalid={Boolean(errors.cardKeys)}
                />
                <FieldError text={errors.cardKeys} />
              </label>
            ) : null}
            <div className="row" style={{ marginTop: 12 }}>
              <button type="button" className="btn primary" disabled={creating || !canWrite} onClick={() => void submitCreate()}>
                {creating ? '创建中…' : '创建商品'}
              </button>
              <button type="button" className="btn ghost" disabled={creating} onClick={() => { setDraft(EMPTY_DRAFT); setErrors({}); }}>
                清空
              </button>
            </div>
          </section>

          <div className="panel">
            <div className="panel-head">
              <h3>全部商品</h3>
              <span className="muted">共 {rows.length} 个</span>
            </div>

            {state.loading ? <p className="muted">加载中…</p> : null}
            {state.error ? <p className="error">列表加载失败：{describeError(state.error)}</p> : null}
            {!state.loading && !state.error && rows.length === 0 ? (
              <div className="empty">
                还没有登记商品，因为后台从未创建过。
                <br />
                下一步：用上方「新建商品」填写编码、名称与售价，创建后前台商城区即可上架销售。
              </div>
            ) : null}

            {rows.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>商品</th>
                    <th>类型</th>
                    <th>单价</th>
                    <th>可售 / 库存</th>
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
                      <td>{row.kind === 'physical' ? '实物' : row.kind === 'virtual_auto' ? '虚拟自动' : '虚拟人工'}</td>
                      <td>
                        {canWrite ? (
                          <input
                            aria-label={`${row.name} 单价`}
                            value={priceDraft[row.code] ?? (row.price_cents / 100).toFixed(2)}
                            onChange={(event) => setPriceDraft((prev) => ({ ...prev, [row.code]: event.target.value }))}
                            inputMode="decimal"
                            size={7}
                          />
                        ) : (
                          formatYuan(row.price_cents)
                        )}
                      </td>
                      <td>
                        {row.available} / {row.kind === 'virtual_auto' ? row.key_count : row.stock}
                      </td>
                      <td>
                        <span className={row.status === 'active' ? 'badge' : 'badge draft'}>
                          {row.status === 'active' ? '在售' : '已下架'}
                        </span>
                      </td>
                      <td>
                        {canWrite ? (
                          <div className="row">
                            <button
                              className="btn ghost small"
                              type="button"
                              disabled={busyCode === row.code}
                              onClick={() => void savePrice(row)}
                            >
                              保存价
                            </button>
                            <button
                              className="btn ghost small"
                              type="button"
                              disabled={busyCode === row.code}
                              onClick={() => void toggleStatus(row)}
                            >
                              {row.status === 'active' ? '下架' : '上架'}
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
        </>
      ) : null}

      {tab === 'coupons' ? <Coupons credential={credential} permissions={permissions} /> : null}
      {tab === 'cards' ? <Cards credential={credential} permissions={permissions} /> : null}
    </div>
  );
}
