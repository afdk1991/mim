// 分类导航管理视图：两级分类树（19 个一级 + 205 个二级）的后台增删改查
import { useState } from 'react'; // 本地状态：编辑草稿、新建表单、忙碌与提示
import type { FormEvent } from 'react'; // 表单提交事件类型
import type { Credential, CategoryGroupView, CategoryItemView } from '../api'; // 仅类型导入：凭证与分类视图
import { createCategory, deleteCategory, describeError, listCategories, updateCategory } from '../api'; // 分类 CRUD 四个调用
import { useAsync } from '../hooks'; // 统一 loading / error / data 三态

// 组件入参：凭证与权限由 App 下发，写操作按 module:write 控制
interface CategoriesProps {
  // 当前身份凭证
  credential: Credential;
  // 当前身份生效权限码
  permissions: string[];
} // 入参接口结束

// 单行编辑草稿：键为分类 slug，值为待提交的三个可改字段
interface RowDraft {
  // 中文名
  name: string;
  // 英文名（空串表示清空为 null）
  name_en: string;
  // 排序权重（字符串便于输入框受控，提交时转数字）
  sort_order: string;
} // RowDraft 结束

/**
 * 分类管理视图：只做三件事——看树、改文案/排序、增删分类。
 * 设计约束（与后端一致）：slug 与父级不可改（会打断模块归属与前缀判定），故界面不提供这两个输入框。
 */
export function Categories({ credential, permissions }: CategoriesProps) {
  // 写权限：没有 module:write 时所有写操作按钮禁用
  const canWrite = permissions.includes('module:write');
  // 分类树查询：首次挂载后拉取，写操作后手动 reload
  const treeState = useAsync(() => listCategories(credential), [credential]);
  // 逐行编辑草稿：只保存被用户改过的行
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  // 新建表单：parent 空串表示建一级分类
  const [form, setForm] = useState<{ slug: string; name: string; name_en: string; parent: string }>({ slug: '', name: '', name_en: '', parent: '' });
  // 是否展开新建面板
  const [createOpen, setCreateOpen] = useState(false);
  // 忙碌标记：写入期间禁用按钮，避免重复提交
  const [busy, setBusy] = useState<string | null>(null);
  // 成功提示
  const [message, setMessage] = useState<string | null>(null);
  // 失败提示
  const [error, setError] = useState<string | null>(null);

  // 取某行当前值：有草稿用草稿，否则用服务端值
  function valueOf(row: CategoryItemView, field: keyof RowDraft): string {
    // 草稿优先
    const draft = drafts[row.slug];
    // 已改过即用草稿值
    if (draft) return draft[field];
    // 未改过则回显服务端值（英文名可能为 null，统一转空串便于受控输入）
    if (field === 'name_en') return row.name_en ?? '';
    // 排序权重转字符串
    if (field === 'sort_order') return String(row.sort_order);
    // 剩下的是中文名
    return row.name;
  } // valueOf 结束

  // 写入草稿：只改一个字段，其余字段沿用当前显示值
  function edit(row: CategoryItemView, field: keyof RowDraft, next: string) {
    // 先补齐基线，避免只改一个字段时把其它字段写成空
    const base: RowDraft = drafts[row.slug] ?? {
      name: row.name,
      name_en: row.name_en ?? '',
      sort_order: String(row.sort_order),
    }; // 基线结束
    setDrafts({ ...drafts, [row.slug]: { ...base, [field]: next } }); // 合并新值
  } // edit 结束

  // 提交某行的修改：只下发真正变化的字段，避免无意义更新
  async function save(row: CategoryItemView) {
    // 无草稿即没有改动
    const draft = drafts[row.slug];
    // 直接返回，不打扰用户
    if (!draft) return;
    setBusy(row.slug); // 标记忙碌
    setError(null); // 清空上次错误
    try {
      // 组装差异字段
      const payload: { name?: string; name_en?: string | null; sort_order?: number } = {};
      // 中文名变化才下发
      if (draft.name !== row.name) payload.name = draft.name;
      // 英文名变化才下发；空串按「清空」处理
      if (draft.name_en !== (row.name_en ?? '')) payload.name_en = draft.name_en.length > 0 ? draft.name_en : null;
      // 排序变化才下发，非法数字直接拦在本地
      if (draft.sort_order !== String(row.sort_order)) {
        // 解析为整数
        const parsed = Number.parseInt(draft.sort_order, 10);
        // 非数字或负数视为非法
        if (Number.isNaN(parsed) || parsed < 0) throw new Error('排序权重必须是非负整数');
        payload.sort_order = parsed;
      } // 排序分支结束
      // 无任何变化则提示后结束
      if (Object.keys(payload).length === 0) {
        setMessage('没有改动');
        return;
      } // 空改动分支结束
      // 调 PATCH
      await updateCategory(credential, row.slug, payload);
      // 成功后清掉该行草稿
      const next = { ...drafts };
      delete next[row.slug];
      setDrafts(next);
      setMessage(`已保存：${row.slug}`);
      treeState.reload(); // 重新拉树，确保计数与新值一致
    } catch (caught) {
      // 失败提示服务端文案
      setError(describeError(caught));
    } finally {
      setBusy(null); // 解除忙碌
    } // try 结束
  } // save 结束

  // 删除分类：后端对「有子级 / 有模块引用」会 409，这里直接把错误透出
  async function remove(row: CategoryItemView) {
    setBusy(row.slug); // 标记忙碌
    setError(null); // 清空错误
    try {
      // 调 DELETE
      await deleteCategory(credential, row.slug);
      setMessage(`已删除：${row.slug}`);
      treeState.reload(); // 重新拉树
    } catch (caught) {
      // 409 场景（仍有子级或模块）在此提示
      setError(describeError(caught));
    } finally {
      setBusy(null); // 解除忙碌
    } // try 结束
  } // remove 结束

  // 提交新建表单
  async function submitCreate(event: FormEvent) {
    event.preventDefault(); // 阻止整页刷新
    setError(null); // 清空错误
    setBusy('create'); // 标记创建中
    try {
      // 调 POST：parent 为空即一级分类
      await createCategory(credential, {
        slug: form.slug.trim(), // 标识去掉首尾空白
        name: form.name.trim(), // 中文名必填
        name_en: form.name_en.trim() || undefined, // 英文名选填
        parent_slug: form.parent || undefined, // 父分类选填
      });
      setMessage(`已创建：${form.slug.trim()}`);
      setForm({ slug: '', name: '', name_en: '', parent: '' }); // 清空表单
      setCreateOpen(false); // 收起面板
      treeState.reload(); // 刷新树
    } catch (caught) {
      // 400 / 409 / 404 都在这里提示
      setError(describeError(caught));
    } finally {
      setBusy(null); // 解除忙碌
    } // try 结束
  } // submitCreate 结束

  // 加载中
  if (treeState.loading) return <div className="page"><div className="muted">加载分类树…</div></div>;
  // 加载失败：给出可读原因与重试入口
  if (treeState.error) {
    return (
      <div className="page">
        <div className="error">{describeError(treeState.error)}</div>
        <button className="btn primary" type="button" onClick={() => treeState.reload()}>重试</button>
      </div>
    );
  } // 错误分支结束
  // 数据缺失兜底
  if (!treeState.data) return null;
  // 分类树与计数
  const { groups, total_groups, total_items } = treeState.data;

  // 渲染参数化行：一级与二级共用同一套输入与按钮
  function renderRow(row: CategoryItemView, level: 1 | 2) {
    // 该行是否正在写
    const rowBusy = busy === row.slug;
    // 该行有无草稿
    const dirty = drafts[row.slug] !== undefined;
    // 单行渲染
    return (
      <div key={row.slug} className={level === 1 ? 'row cat-row-g1' : 'row cat-row-g2'}>
        <span className="cat-slug">{row.slug}</span>
        <label className="field">
          <span>中文名</span>
          <input
            value={valueOf(row, 'name')}
            disabled={!canWrite}
            onChange={(event) => edit(row, 'name', event.target.value)}
          />
        </label>
        <label className="field">
          <span>英文名</span>
          <input
            value={valueOf(row, 'name_en')}
            placeholder="留空则英文站回落中文"
            disabled={!canWrite}
            onChange={(event) => edit(row, 'name_en', event.target.value)}
          />
        </label>
        <label className="field" style={{ maxWidth: 120 }}>
          <span>排序</span>
          <input
            value={valueOf(row, 'sort_order')}
            disabled={!canWrite}
            onChange={(event) => edit(row, 'sort_order', event.target.value)}
          />
        </label>
        <span className="count">{row.module_count} 个模块</span>
        <button className="btn" type="button" disabled={!canWrite || !dirty || rowBusy} onClick={() => save(row)}>
          {rowBusy ? '保存中…' : '保存'}
        </button>
        <button className="btn ghost" type="button" disabled={!canWrite || rowBusy} onClick={() => remove(row)}>
          删除
        </button>
      </div>
    );
  } // renderRow 结束

  // 页面渲染
  return (
    <div className="page">
      <div className="page-head">
        <h2>分类导航</h2>
        <div className="row">
          <span className="count">
            共 {total_groups} 个一级分类 / {total_items} 个二级条目 · slug 与父级不可改（会打断模块归属）
          </span>
          <button className="btn primary" type="button" disabled={!canWrite} onClick={() => setCreateOpen(!createOpen)}>
            {createOpen ? '收起新建' : '新建分类'}
          </button>
        </div>
      </div>

      {message && <div className="muted">{message}</div>}
      {error && <div className="error">{error}</div>}

      {createOpen && (
        <form className="panel" onSubmit={submitCreate}>
          <div className="row">
            <label className="field" style={{ maxWidth: 200 }}>
              <span>slug（小写字母开头，可含数字与连字符）</span>
              <input value={form.slug} required onChange={(event) => setForm({ ...form, slug: event.target.value })} />
            </label>
            <label className="field" style={{ maxWidth: 220 }}>
              <span>中文名</span>
              <input value={form.name} required onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label className="field" style={{ maxWidth: 240 }}>
              <span>英文名（选填）</span>
              <input value={form.name_en} onChange={(event) => setForm({ ...form, name_en: event.target.value })} />
            </label>
            <label className="field" style={{ maxWidth: 240 }}>
              <span>父分类（留空即一级）</span>
              <select value={form.parent} onChange={(event) => setForm({ ...form, parent: event.target.value })}>
                <option value="">（一级分类）</option>
                {groups.map((group: CategoryGroupView) => (
                  <option key={group.slug} value={group.slug}>
                    {group.name}（{group.slug}）
                  </option>
                ))}
              </select>
            </label>
            <button className="btn primary" type="submit" disabled={busy !== null || !canWrite}>
              {busy === 'create' ? '创建中…' : '创建'}
            </button>
          </div>
          <div className="muted">二级条目的 slug 必须以「父 slug-」开头（例如 store-01），否则会被公开树的组装规则判为不归属父级。</div>
        </form>
      )}

      <div className="panel">
        {groups.map((group: CategoryGroupView) => (
          <div key={group.slug} className="cat-group">
            {renderRow(group, 1)}
            {group.items.map((item: CategoryItemView) => renderRow(item, 2))}
          </div>
        ))}
      </div>
    </div>
  ); // JSX 返回结束
} // Categories 组件结束
