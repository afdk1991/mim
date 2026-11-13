/**
 * 自研工具发布页：公开浏览工具清单与详情（版本记录 / 下载 / 文档 / 标签），
 * 已登录运营可在本页进行增删改；接口失败给出空态与错误提示，不白屏。
 */

import { useEffect, useState } from 'react'; // 状态与副作用
import type { Locale } from '@mim/i18n'; // 语言类型
import { api, errorText } from '../api'; // 接口客户端与错误文案翻译
import type { ToolItem, ToolUpsertPayload } from '../api'; // 工具视图与入参类型

interface Props { // 视图参数
  locale: Locale; // 当前界面语言
  hasSession?: boolean; // 是否已有会话（访客 / 正式账号）；决定是否展示管理端
} // 代码块结束

/** 按语言取文案。 */
function tr(locale: Locale, zh: string, en: string): string {
  return locale === 'en-US' ? en : zh; // 返回当前函数的处理结果
} // 代码块结束

/** ISO 时间截取日期部分；非法时间回落空串。 */
function fmtDate(iso?: string | null): string {
  if (!iso) return ''; // 条件分支：按判断结果选择后续处理路径
  const time = Date.parse(iso); // 常量 time：保存固定配置或一次性派生值
  return Number.isNaN(time) ? '' : new Date(time).toISOString().slice(0, 10); // 返回当前函数的处理结果
} // 代码块结束

/** 管理表单草稿：标签以逗号 / 空格分隔，提交时拆分为数组。 */
interface FormState {
  slug: string;
  name: string;
  summary: string;
  tags: string;
  download_url: string;
  doc_url: string;
  version: string;
  notes: string;
  status: 'draft' | 'active' | 'archived';
  sort_order: string;
} // 代码块结束

const EMPTY_FORM: FormState = { // 常量 EMPTY_FORM：保存固定配置或一次性派生值
  slug: '',
  name: '',
  summary: '',
  tags: '',
  download_url: '',
  doc_url: '',
  version: '',
  notes: '',
  status: 'active',
  sort_order: '100',
}; // 代码块结束

/** 标签字符串拆分：逗号 / 中文逗号 / 空白分隔，去空去重。 */
function parseTags(raw: string): string[] {
  return [...new Set(raw.split(/[,，\s]+/).map((tag) => tag.trim()).filter(Boolean))]; // 返回当前函数的处理结果
} // 代码块结束

export function Tools({ locale, hasSession = false }: Props) { // 导出函数 Tools：对外暴露的调用入口
  const [items, setItems] = useState<ToolItem[]>([]); // 公开清单
  const [detail, setDetail] = useState<ToolItem | null>(null); // 当前详情
  const [loading, setLoading] = useState(true); // 首屏加载态
  const [error, setError] = useState<string | null>(null); // 清单错误
  const [manageOpen, setManageOpen] = useState(false); // 管理面板展开态
  const [manageItems, setManageItems] = useState<ToolItem[]>([]); // 管理端全状态清单
  const [adminAllowed, setAdminAllowed] = useState(false); // 管理清单拉取成功才放行入口；401/403/离线静默隐藏
  const [form, setForm] = useState<FormState>(EMPTY_FORM); // 表单草稿
  const [editingSlug, setEditingSlug] = useState<string | null>(null); // 正在编辑的工具 slug
  const [busy, setBusy] = useState(false); // 提交忙碌态
  const [notice, setNotice] = useState<string | null>(null); // 成功提示

  /** 拉取公开清单；失败保留空态并记录错误，不阻断页面。 */
  async function loadList() {
    setLoading(true);
    setError(null);
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const data = await api.tools.list(); // 常量 data：保存固定配置或一次性派生值
      setItems(data.items);
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setLoading(false);
    } // 代码块结束
  } // 代码块结束

  /** 拉取管理端清单（含草稿 / 归档）；未登录或无权限时静默隐藏管理面板。 */
  async function loadManage() {
    if (!hasSession) return; // 条件分支：按判断结果选择后续处理路径
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const data = await api.tools.manage(); // 常量 data：保存固定配置或一次性派生值
      setManageItems(data.items);
      setAdminAllowed(true); // 仅在管理清单可访问时展示管理入口
    } catch {
      setAdminAllowed(false); // 无权限或离线时静默隐藏管理面板，公开面不受影响
    } // 代码块结束
  } // 代码块结束

  useEffect(() => {
    void loadList(); // 执行当前业务步骤
    void loadManage(); // 执行当前业务步骤
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 打开详情：失败提示并回到清单态。 */
  async function openDetail(slug: string) {
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const data = await api.tools.detail(slug); // 常量 data：保存固定配置或一次性派生值
      setDetail(data.tool);
    } catch (err) {
      setError(errorText(locale, err));
    } // 代码块结束
  } // 代码块结束

  /** 回填编辑表单。 */
  function startEdit(tool: ToolItem) {
    setEditingSlug(tool.slug);
    setForm({
      slug: tool.slug,
      name: tool.name,
      summary: tool.summary,
      tags: tool.tags.join(', '),
      download_url: tool.download_url,
      doc_url: tool.doc_url,
      version: tool.version_notes[0]?.version ?? '',
      notes: tool.version_notes[0]?.notes ?? '',
      status: (tool.status as FormState['status']) ?? 'active',
      sort_order: String(tool.sort_order),
    });
    setNotice(null);
  } // 代码块结束

  /** 重置表单为新建态。 */
  function resetForm() {
    setEditingSlug(null);
    setForm(EMPTY_FORM);
    setNotice(null);
  } // 代码块结束

  /** 提交新建 / 更新；版本与说明非空时追加一条版本记录。 */
  async function submitForm() {
    if (!form.name.trim()) { // 条件分支：按判断结果选择后续处理路径
      setNotice(tr(locale, '请填写工具名称', 'Name is required'));
      return; // 返回当前函数的处理结果
    } // 代码块结束
    setBusy(true);
    setNotice(null);
    try { // 异常捕获起点：包裹可能抛出错误的操作
      const tags = parseTags(form.tags); // 常量 tags：保存固定配置或一次性派生值
      const versionNote = form.version.trim() // 常量 versionNote：保存固定配置或一次性派生值
        ? { version: form.version.trim(), notes: form.notes.trim(), released_at: new Date().toISOString() }
        : undefined;
      const payload: ToolUpsertPayload = { // 常量 payload：保存固定配置或一次性派生值
        name: form.name.trim(),
        summary: form.summary.trim(),
        tags,
        download_url: form.download_url.trim(),
        doc_url: form.doc_url.trim(),
        status: form.status,
        sort_order: Math.max(0, Number(form.sort_order) || 100),
      }; // 代码块结束
      if (versionNote) payload.version_notes = [versionNote]; // 条件分支：按判断结果选择后续处理路径
      if (editingSlug) { // 条件分支：按判断结果选择后续处理路径
        // 编辑：保留已有版本记录，把新条目插到最前
        const current = manageItems.find((t) => t.slug === editingSlug);
        const prevNotes = current?.version_notes ?? []; // 常量 prevNotes：保存固定配置或一次性派生值
        payload.version_notes = versionNote ? [versionNote, ...prevNotes] : prevNotes;
        await api.tools.update(editingSlug, payload); // 异步等待：挂起至 Promise 落定后再继续
      } else { // 代码块结束
        payload.slug = form.slug.trim().toLowerCase();
        if (!payload.slug) throw new Error(tr(locale, '请填写 slug 标识', 'Slug is required')); // 条件分支：按判断结果选择后续处理路径
        await api.tools.create(payload); // 异步等待：挂起至 Promise 落定后再继续
      } // 代码块结束
      resetForm();
      await Promise.all([loadList(), loadManage()]); // 异步等待：挂起至 Promise 落定后再继续
      setNotice(tr(locale, '已保存', 'Saved'));
    } catch (err) {
      setNotice(errorText(locale, err));
    } finally {
      setBusy(false);
    } // 代码块结束
  } // 代码块结束

  /** 删除工具；成功后刷新两个清单。 */
  async function removeTool(slug: string) {
    setBusy(true);
    try { // 异常捕获起点：包裹可能抛出错误的操作
      await api.tools.remove(slug); // 异步等待：挂起至 Promise 落定后再继续
      if (detail?.slug === slug) setDetail(null); // 条件分支：按判断结果选择后续处理路径
      await Promise.all([loadList(), loadManage()]); // 异步等待：挂起至 Promise 落定后再继续
      setNotice(tr(locale, '已删除', 'Deleted'));
    } catch (err) {
      setNotice(errorText(locale, err));
    } finally {
      setBusy(false);
    } // 代码块结束
  } // 代码块结束

  return ( // 返回当前函数的处理结果
    <div className="page tools-page">{/* 执行当前业务步骤 */}
      <header className="page-head">{/* 执行当前业务步骤 */}
        <h1>{tr(locale, '自研工具', 'Self-built Tools')}</h1>
        <p className="muted">{tr(locale, '团队自研的插件、脚本与防护工具，含版本记录、下载与文档入口。', 'In-house plugins, scripts and protection tools with changelogs, downloads and docs.')}</p>
      </header>

      {error && <p className="error">{error}</p>}

      {detail ? (
        <section className="panel tool-detail">{/* 执行当前业务步骤 */}
          <div className="panel-head">{/* 执行当前业务步骤 */}
            <h2>{detail.name}</h2>
            <span className="deploy-badge">{detail.slug}</span>
          </div>
          <p className="muted">{detail.summary}</p>
          {detail.tags.length > 0 && (
            <div className="tool-tags">{/* 执行当前业务步骤 */}
              {detail.tags.map((tag) => <span className="deploy-badge muted" key={tag}>{tag}</span>)}
            </div>
          )}
          <div className="tool-links">{/* 执行当前业务步骤 */}
            {detail.download_url ? <a className="btn primary" href={detail.download_url}>{tr(locale, '下载', 'Download')}</a> : null}
            {detail.doc_url ? <a className="btn ghost" href={detail.doc_url}>{tr(locale, '文档', 'Docs')}</a> : null}
          </div>
          <h3>{tr(locale, '版本记录', 'Changelog')}</h3>
          {detail.version_notes.length === 0 ? (
            <p className="muted">{tr(locale, '暂无版本记录', 'No version history yet')}</p>
          ) : (
            <ul className="plain-list tool-version-list">{/* 执行当前业务步骤 */}
              {detail.version_notes.map((note) => (
                <li className="deploy-row" key={`${note.version}-${note.released_at ?? ''}`}>{/* 执行当前业务步骤 */}
                  <strong>{note.version}</strong>
                  {note.title ? <span className="muted"> · {note.title}</span> : null}
                  {note.notes ? <p className="muted">{note.notes}</p> : null}
                  {note.released_at ? <span className="muted">{fmtDate(note.released_at)}</span> : null}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn ghost" onClick={() => setDetail(null)}>{tr(locale, '返回清单', 'Back to list')}</button>
        </section>
      ) : loading ? (
        <p className="hint">{tr(locale, '加载中…', 'Loading…')}</p>
      ) : items.length === 0 ? (
        <div className="community-empty">{tr(locale, '暂无上架工具', 'No tools published yet')}</div>
      ) : (
        <div className="commerce-grid tools-grid">{/* 执行当前业务步骤 */}
          {items.map((tool) => (
            <article className="panel tool-card" key={tool.slug}>{/* 执行当前业务步骤 */}
              <div className="panel-head">{/* 执行当前业务步骤 */}
                <h3>{tool.name}</h3>
                <span className="deploy-badge">{tool.version_notes[0]?.version ?? '—'}</span>
              </div>
              <p className="muted">{tool.summary}</p>
              {tool.tags.length > 0 && (
                <div className="tool-tags">{/* 执行当前业务步骤 */}
                  {tool.tags.map((tag) => <span className="deploy-badge muted" key={tag}>{tag}</span>)}
                </div>
              )}
              <div className="row">{/* 执行当前业务步骤 */}
                <button type="button" className="btn ghost small" onClick={() => void openDetail(tool.slug)}>{tr(locale, '详情', 'Details')}</button>
                {tool.doc_url ? <a className="link" href={tool.doc_url}>{tr(locale, '文档', 'Docs')}</a> : null}
              </div>
            </article>
          ))}
        </div>
      )}

      {hasSession && adminAllowed && (
        <section className="panel tool-admin">{/* 执行当前业务步骤 */}
          <button type="button" className="btn ghost" onClick={() => { setManageOpen((v) => !v); void loadManage(); }}>{/* 执行当前业务步骤 */}
            {tr(locale, '管理工具', 'Manage tools')}
          </button>
          {manageOpen && (
            <>{/* 执行当前业务步骤 */}
              {notice && <p className={notice.includes('权限') || notice.includes('失败') ? 'error' : 'notice'}>{notice}</p>}
              <div className="tool-form">{/* 执行当前业务步骤 */}
                <input value={form.slug} disabled={!!editingSlug} placeholder="slug (quick-build-wp)" onChange={(e) => setForm({ ...form, slug: e.target.value })} />
                <input value={form.name} placeholder={tr(locale, '名称', 'Name')} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <input value={form.summary} placeholder={tr(locale, '简介', 'Summary')} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
                <input value={form.tags} placeholder={tr(locale, '标签（逗号分隔）', 'Tags (comma separated)')} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
                <input value={form.download_url} placeholder={tr(locale, '下载地址', 'Download URL')} onChange={(e) => setForm({ ...form, download_url: e.target.value })} />
                <input value={form.doc_url} placeholder={tr(locale, '文档地址', 'Doc URL')} onChange={(e) => setForm({ ...form, doc_url: e.target.value })} />
                <input value={form.version} placeholder={tr(locale, '新版本号（可选）', 'New version (optional)')} onChange={(e) => setForm({ ...form, version: e.target.value })} />
                <input value={form.notes} placeholder={tr(locale, '版本说明（可选）', 'Version notes (optional)')} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as FormState['status'] })}>{/* 执行当前业务步骤 */}
                  <option value="active">{tr(locale, '上架', 'Active')}</option>
                  <option value="draft">{tr(locale, '草稿', 'Draft')}</option>
                  <option value="archived">{tr(locale, '归档', 'Archived')}</option>
                </select>
                <input value={form.sort_order} inputMode="numeric" placeholder="排序" onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
                <div className="row">{/* 执行当前业务步骤 */}
                  <button type="button" className="btn primary" disabled={busy} onClick={() => void submitForm()}>{/* 执行当前业务步骤 */}
                    {editingSlug ? tr(locale, '保存修改', 'Save') : tr(locale, '新建工具', 'Create')}
                  </button>
                  {editingSlug ? <button type="button" className="btn ghost" onClick={resetForm}>{tr(locale, '取消编辑', 'Cancel')}</button> : null}
                </div>
              </div>
              {manageItems.length > 0 && (
                <ul className="plain-list tool-manage-list">{/* 执行当前业务步骤 */}
                  {manageItems.map((tool) => (
                    <li className="deploy-row" key={tool.slug}>{/* 执行当前业务步骤 */}
                      <span>{tool.name}</span>
                      <span className="deploy-badge muted">{tool.status}</span>
                      <button type="button" className="btn ghost small" onClick={() => startEdit(tool)}>{tr(locale, '编辑', 'Edit')}</button>
                      <button type="button" className="btn ghost small" disabled={busy} onClick={() => void removeTool(tool.slug)}>{tr(locale, '删除', 'Delete')}</button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}
    </div>
  ); // 执行当前业务步骤
} // 代码块结束
