// 自研工具管理视图：工具清单、版本记录、下载 / 文档地址与上下架维护
import { useState } from 'react'; // 表单状态
import type { AdminTool, Credential, ToolVersionNote } from '../api'; // 类型
import { createTool, deleteTool, describeError, listToolsManage, updateTool } from '../api'; // 工具 API
import { useAsync } from '../hooks'; // 统一异步加载

interface Props { // 入参
  credential: Credential; // 凭证
  permissions: string[]; // 权限
} // Props 结束

/** 把「版本|标题|说明|日期」逐行文本解析为版本记录 */
function parseNotes(text: string): ToolVersionNote[] { // 业务步骤
  return text
    .split('\n') // 每行一条
    .map((line) => line.trim()) // 去空白
    .filter(Boolean) // 丢弃空行
    .map((line) => {
      const [version, title, notes, released_at] = line.split('|').map((item) => item.trim()); // 四段式
      return { version: version || '0.0.0', title: title || undefined, notes: notes || undefined, released_at: released_at || undefined }; // 缺省字段交给后端
    });
} // parseNotes 结束

/** 版本记录回显为可再编辑的逐行文本 */
function notesText(notes: ToolVersionNote[]): string { // 业务步骤
  return notes.map((note) => [note.version, note.title ?? '', note.notes ?? '', note.released_at ?? ''].join(' | ')).join('\n'); // 与解析格式对称
} // notesText 结束

/** 自研工具管理主体 */
export function ToolsAdmin({ credential, permissions }: Props) { // 业务步骤
  const canWrite = permissions.includes('appearance:write'); // 工具写权限复用 appearance:write
  const listState = useAsync(() => listToolsManage(credential), [credential]); // 工具清单
  const [form, setForm] = useState({ slug: '', name: '', summary: '', download_url: '', doc_url: '', tags: '', status: 'active', sort_order: '0', notes: '' }); // 新建表单
  const [editing, setEditing] = useState<string | null>(null); // 正在编辑的 slug
  const [error, setError] = useState(''); // 错误
  const [notice, setNotice] = useState(''); // 提示
  const [busy, setBusy] = useState(false); // 操作中

  /** 新建工具 */
  async function create() {
    setBusy(true); // 进入忙碌态
    setError(''); // 清空错误
    setNotice(''); // 清空提示
    try { // 业务步骤
      await createTool(credential, { // 业务步骤
        slug: form.slug.trim(), // 稳定 slug
        name: form.name.trim(), // 展示名
        summary: form.summary, // 摘要
        version_notes: parseNotes(form.notes), // 版本记录
        download_url: form.download_url.trim(), // 下载地址
        doc_url: form.doc_url.trim(), // 文档地址
        tags: form.tags.split(/[,，]/).map((item) => item.trim()).filter(Boolean), // 标签
        status: form.status, // 状态
        sort_order: Number(form.sort_order) || 0, // 排序
      });
      setNotice('工具已创建'); // 成功提示
      setForm({ slug: '', name: '', summary: '', download_url: '', doc_url: '', tags: '', status: 'active', sort_order: '0', notes: '' }); // 清空
      listState.reload(); // 刷新
    } catch (err) {
      setError(describeError(err)); // 统一错误
    } finally {
      setBusy(false); // 退出忙碌态
    } // 业务步骤
  } // create 结束

  /** 载入一行到编辑表单 */
  function load(tool: AdminTool) { // 业务步骤
    setEditing(tool.slug); // 记录编辑目标
    setForm({ // 业务步骤
      slug: tool.slug, // slug 只读
      name: tool.name, // 名称
      summary: tool.summary, // 摘要
      download_url: tool.download_url, // 下载
      doc_url: tool.doc_url, // 文档
      tags: tool.tags.join(', '), // 标签回显
      status: tool.status, // 状态
      sort_order: String(tool.sort_order), // 排序
      notes: notesText(tool.version_notes), // 版本记录
    });
  } // load 结束

  /** 保存编辑：slug 不提交变更 */
  async function save() {
    if (!editing) return; // 无编辑目标直接返回
    setBusy(true); // 进入忙碌态
    setError(''); // 清空错误
    setNotice(''); // 清空提示
    try { // 业务步骤
      await updateTool(credential, editing, { // 业务步骤
        name: form.name.trim(), // 名称
        summary: form.summary, // 摘要
        version_notes: parseNotes(form.notes), // 版本记录
        download_url: form.download_url.trim(), // 下载
        doc_url: form.doc_url.trim(), // 文档
        tags: form.tags.split(/[,，]/).map((item) => item.trim()).filter(Boolean), // 标签
        status: form.status, // 状态
        sort_order: Number(form.sort_order) || 0, // 排序
      });
      setNotice(`已更新 ${editing}`); // 成功提示
      setEditing(null); // 退出编辑
      listState.reload(); // 刷新
    } catch (err) {
      setError(describeError(err)); // 统一错误
    } finally {
      setBusy(false); // 退出忙碌态
    } // 业务步骤
  } // save 结束

  /** 删除工具 */
  async function remove(slug: string) {
    setBusy(true); // 进入忙碌态
    setError(''); // 清空错误
    setNotice(''); // 清空提示
    try { // 业务步骤
      await deleteTool(credential, slug); // 删除
      setNotice(`已删除 ${slug}`); // 成功提示
      if (editing === slug) setEditing(null); // 清理编辑态
      listState.reload(); // 刷新
    } catch (err) {
      setError(describeError(err)); // 统一错误
    } finally {
      setBusy(false); // 退出忙碌态
    } // 业务步骤
  } // remove 结束

  return (
    <div className="page">
      <header className="page-head">
        <h1>自研工具与开源项目</h1>
        <p className="muted">对外发布：下载包、文档、版本记录与标签；草稿不外露，归档保留历史。</p>
      </header>

      {!canWrite && <div className="panel error">当前账号缺少 appearance:write 权限，仅可查看。</div>}
      {error && <div className="panel error">{error}</div>}
      {notice && <div className="panel hint">{notice}</div>}

      <section className="panel">
        <div className="panel-head"><h3>{editing ? `编辑 ${editing}` : '新建工具'}</h3>{editing ? <button type="button" className="btn ghost" onClick={() => { setEditing(null); setForm({ slug: '', name: '', summary: '', download_url: '', doc_url: '', tags: '', status: 'active', sort_order: '0', notes: '' }); }}>退出编辑</button> : null}</div>
        <div className="form inline">
          <label>slug<input value={form.slug} disabled={Boolean(editing)} onChange={(event) => setForm({ ...form, slug: event.target.value })} placeholder="quick-build-wp" /></label>
          <label>名称<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>状态
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              <option value="active">已发布</option><option value="draft">草稿</option><option value="archived">归档</option>
            </select>
          </label>
          <label>排序<input value={form.sort_order} onChange={(event) => setForm({ ...form, sort_order: event.target.value })} inputMode="numeric" /></label>
        </div>
        <div className="form inline">
          <label className="grow">摘要<input value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} /></label>
          <label className="grow">标签<input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="宝塔, WordPress, 一键部署" /></label>
        </div>
        <div className="form inline">
          <label className="grow">下载地址<input value={form.download_url} onChange={(event) => setForm({ ...form, download_url: event.target.value })} /></label>
          <label className="grow">文档地址<input value={form.doc_url} onChange={(event) => setForm({ ...form, doc_url: event.target.value })} /></label>
        </div>
        <label className="field">版本记录（每行 版本 | 标题 | 说明 | 日期）
          <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={4} />
        </label>
        {editing
          ? <button type="button" className="btn primary" disabled={busy || !canWrite} onClick={() => void save()}>保存修改</button>
          : <button type="button" className="btn primary" disabled={busy || !canWrite || form.slug.trim().length === 0 || form.name.trim().length === 0} onClick={() => void create()}>创建工具</button>}
      </section>

      <section className="panel">
        <div className="panel-head"><h3>工具清单</h3><span className="muted">{(listState.data ?? []).length}</span><button type="button" className="btn ghost" onClick={listState.reload}>刷新</button></div>
        {listState.loading && <p className="muted">加载中…</p>}
        {Boolean(listState.error) && <p className="error">{describeError(listState.error)}</p>}
        {(listState.data ?? []).length === 0 && !listState.loading ? <p className="empty">暂无工具</p> : null}
        {(listState.data ?? []).map((tool) => (
          <article className="deploy-row" key={tool.id}>
            <div>
              <div className="deploy-kv">
                <strong>{tool.name}</strong>
                <span className={`badge ${tool.status === 'active' ? 'success' : 'warning'}`}>{tool.status}</span>
                <span className="muted">/{tool.slug} · 排序 {tool.sort_order}</span>
              </div>
              <p className="muted">{tool.summary || '无摘要'}</p>
              {tool.tags.length > 0 && <div className="perm-grid">{tool.tags.map((tag) => <span className="perm-item" key={tag}>{tag}</span>)}</div>}
            </div>
            <div className="deploy-columns">
              {tool.doc_url ? <a className="btn ghost small" href={tool.doc_url} target="_blank" rel="noreferrer">文档</a> : null}
              {tool.download_url ? <a className="btn ghost small" href={tool.download_url} target="_blank" rel="noreferrer">下载</a> : null}
              <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => load(tool)}>编辑</button>
              <button type="button" className="btn ghost small" disabled={busy || !canWrite} onClick={() => void remove(tool.slug)}>删除</button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
} // ToolsAdmin 结束
