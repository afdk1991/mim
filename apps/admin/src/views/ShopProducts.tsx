// 商品管理视图：独立商城商品的列表 + 新建 / 编辑表单 + 删除确认
import { useState } from 'react'; // 表单与编辑态
import type { AdminProduct, Credential } from '../api'; // 凭证类型与商品视图
import {
  createAdminProduct,
  deleteAdminProduct,
  describeError,
  listAdminProducts,
  updateAdminProduct,
} from '../api'; // 商品 API
import { useAsync } from '../hooks'; // 统一异步加载

/** 入参形态：金额以元为输入，提交时换算分；卡密按行录入 */
interface ProductForm {
  // 商品编码
  code: string;
  // 商品名
  name: string;
  // 简介
  summary: string;
  // 发货方式
  kind: 'physical' | 'virtual_auto' | 'virtual_manual';
  // 售价（元）
  priceYuan: string;
  // 封面图地址
  cover_url: string;
  // 库存
  stock: string;
  // 发货说明
  delivery_note: string;
  // 上架位
  status: 'active' | 'off';
  // 排序权重
  sort_order: string;
  // 卡密批次（每行一条，仅自动发货）
  card_keys: string;
} // ProductForm 结束

/** 空白表单草稿 */
const EMPTY_FORM: ProductForm = { // 初始值集中一处，清空与新建复用
  code: '',
  name: '',
  summary: '',
  kind: 'physical',
  priceYuan: '0',
  cover_url: '',
  stock: '0',
  delivery_note: '',
  status: 'active',
  sort_order: '0',
  card_keys: '',
}; // EMPTY_FORM 结束

interface Props { // 入参
  // 凭证
  credential: Credential;
  // 权限集合
  permissions: string[];
} // Props 结束

/** 金额分转元展示 */
function yuan(value: number): string { // 业务步骤
  return `${(value / 100).toFixed(2)} 元`; // 固定两位小数
} // yuan 结束

/** 商品管理视图主体 */
export function ShopProducts({ credential, permissions }: Props) { // 业务步骤
  const canWrite = permissions.includes('commerce:write'); // 写操作权限点与后端一致
  const listState = useAsync(() => listAdminProducts(credential), [credential]); // 商品列表
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM); // 表单草稿
  const [editingCode, setEditingCode] = useState<string | null>(null); // 正在编辑的商品编码，null 表示新建
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

  /** 表单提交：新建或按编辑态局部更新 */
  function submit() {
    const price_cents = Math.round(Number(form.priceYuan || 0) * 100); // 元转分
    const stock = Math.max(0, Math.round(Number(form.stock || 0))); // 库存取整
    const sort_order = Math.max(0, Math.round(Number(form.sort_order || 0))); // 排序取整
    const cardKeys = form.card_keys.split('\n').map((key) => key.trim()).filter(Boolean); // 每行一条去空
    if (editingCode) { // 编辑分支：编码不可改，其余字段局部提交
      void run(async () => { // 业务步骤
        await updateAdminProduct(credential, editingCode, { // 局部更新
          name: form.name.trim(),
          summary: form.summary,
          price_cents,
          cover_url: form.cover_url.trim() || null,
          stock,
          delivery_note: form.delivery_note,
          status: form.status,
          sort_order,
          card_keys: cardKeys.length > 0 ? cardKeys : undefined,
        }); // 更新请求结束
        setEditingCode(null); // 回到新建态
        setForm(EMPTY_FORM); // 清空表单
      }, '商品已更新'); // 成功提示
      return; // 分支结束
    } // 编辑分支结束
    void run(async () => { // 新建分支
      await createAdminProduct(credential, { // 提交创建入参
        code: form.code.trim(),
        name: form.name.trim(),
        summary: form.summary,
        kind: form.kind,
        price_cents,
        cover_url: form.cover_url.trim() || null,
        stock,
        delivery_note: form.delivery_note,
        status: form.status,
        sort_order,
        card_keys: cardKeys,
      }); // 创建请求结束
      setForm(EMPTY_FORM); // 清空表单
    }, '商品已创建'); // 成功提示
  } // submit 结束

  /** 回填编辑表单 */
  function edit(row: AdminProduct) {
    if (!row) return; // 空行不回填
    setEditingCode(row.code); // 记录编辑目标
    setForm({ // 回填各字段
      code: row.code, // 编码只读展示
      name: row.name, // 名称
      summary: row.summary, // 简介
      kind: row.kind, // 发货方式
      priceYuan: (row.price_cents / 100).toFixed(2), // 分转元
      cover_url: row.cover_url ?? '', // 封面
      stock: String(row.stock), // 库存
      delivery_note: row.delivery_note, // 发货说明
      status: row.status, // 上架位
      sort_order: String(row.sort_order), // 排序
      card_keys: '', // 编辑态追加批次，不回显既有卡密
    }); // 表单回填结束
  } // edit 结束

  /** 删除：二次确认后调用后端删除端点 */
  function remove(code: string) {
    if (!window.confirm(`确认删除商品 ${code}？已有订单引用时后端会拒绝删除。`)) return; // 用户取消不动作
    void run(() => deleteAdminProduct(credential, code), '商品已删除'); // 执行删除
  } // remove 结束

  const products = listState.data ?? []; // 列表兜底空数组

  return ( // 返回当前视图
    <div className="page">{/* 页面容器 */}
      <header className="page-head">{/* 标题行 */}
        <h1>商品管理</h1>
        <p className="muted">独立商城商品：实物 / 自动发货 / 人工发货三种方式，上架后对公开端点可见。</p>
      </header>

      {!canWrite && <div className="panel error">当前账号缺少 commerce:write 权限，仅可查看。</div>}
      {error && <div className="panel error">{error}</div>}
      {notice && <div className="panel hint">{notice}</div>}

      <section className="panel">{/* 表单面板 */}
        <div className="panel-head"><h3>{editingCode ? `编辑商品 ${editingCode}` : '新建商品'}</h3></div>
        <div className="form inline">{/* 行内表单 */}
          <label className="grow">编码（唯一）<input value={form.code} disabled={editingCode !== null} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="demo-ebook" /></label>
          <label className="grow">名称<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>方式{/* 发货方式选择 */}
            <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as ProductForm['kind'] })}>
              <option value="physical">实物</option>
              <option value="virtual_auto">自动发货（卡密）</option>
              <option value="virtual_manual">人工发货</option>
            </select>
          </label>
          <label>售价（元）<input value={form.priceYuan} inputMode="decimal" onChange={(event) => setForm({ ...form, priceYuan: event.target.value })} /></label>
          <label>库存<input value={form.stock} inputMode="numeric" onChange={(event) => setForm({ ...form, stock: event.target.value })} /></label>
          <label>状态{/* 上架位选择 */}
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ProductForm['status'] })}>
              <option value="active">在售</option>
              <option value="off">下架</option>
            </select>
          </label>
          <label>排序<input value={form.sort_order} inputMode="numeric" onChange={(event) => setForm({ ...form, sort_order: event.target.value })} /></label>
        </div>
        <label className="field">简介<input value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} /></label>
        <label className="field">封面图地址<input value={form.cover_url} onChange={(event) => setForm({ ...form, cover_url: event.target.value })} /></label>
        <label className="field">发货说明<input value={form.delivery_note} onChange={(event) => setForm({ ...form, delivery_note: event.target.value })} /></label>
        {form.kind === 'virtual_auto' && ( // 自动发货才展示卡密批次录入
          <label className="field">卡密批次（每行一条）<textarea value={form.card_keys} onChange={(event) => setForm({ ...form, card_keys: event.target.value })} rows={4} /></label>
        )}
        <div className="form inline" style={{ marginTop: 12 }}>{/* 按钮行 */}
          <button type="button" className="btn primary" disabled={busy || !canWrite || form.name.trim().length === 0} onClick={submit}>{editingCode ? '保存修改' : '创建商品'}</button>
          {editingCode && <button type="button" className="btn ghost" onClick={() => { setEditingCode(null); setForm(EMPTY_FORM); }}>取消编辑</button>}
        </div>
      </section>

      <section className="panel">{/* 列表面板 */}
        <div className="panel-head"><h3>商品列表</h3><span className="muted">{products.length}</span></div>
        {listState.loading && <p className="muted">加载中…</p>}
        {products.map((row) => ( // 逐条渲染商品行
          <div className="deploy-row" key={row.id}>{/* 行容器 */}
            <div className="deploy-kv">{/* 主信息列 */}
              <span><strong>{row.name}</strong> · {row.code}</span>
              <span className={`badge ${row.status === 'active' ? 'active' : 'draft'}`}>{row.status === 'active' ? '在售' : '下架'}</span>
              <span className="muted">{row.kind} · {yuan(row.price_cents)} · 可售 {row.available}{row.kind === 'virtual_auto' ? ` / 卡密 ${row.key_count}` : ` / 库存 ${row.stock}`}</span>
            </div>
            <div className="deploy-columns">{/* 操作列 */}
              <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => edit(row)}>编辑</button>
              <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => remove(row.code)}>删除</button>
            </div>
          </div>
        ))}
      </section>
    </div>
  ); // 视图返回结束
} // ShopProducts 结束
