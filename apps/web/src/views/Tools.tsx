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
}

/** 按语言取文案。 */
function tr(locale: Locale, zh: string, en: string): string {
  return locale === 'en-US' ? en : zh;
}

/** ISO 时间截取日期部分；非法时间回落空串。 */
function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const time = Date.parse(iso);
  return Number.isNaN(time) ? '' : new Date(time).toISOString().slice(0, 10);
}

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
}

const EMPTY_FORM: FormState = {
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
};

/** 标签字符串拆分：逗号 / 中文逗号 / 空白分隔，去空去重。 */
function parseTags(raw: string): string[] {
  return [...new Set(raw.split(/[,，\s]+/).map((tag) => tag.trim()).filter(Boolean))];
}

export function Tools({ locale, hasSession = false }: Props) {
  const [items, setItems] = useState<ToolItem[]>([]); // 公开清单
  const [detail, setDetail] = useState<ToolItem | null>(null); // 当前详情
  const [loading, setLoading] = useState(true); // 首屏加载态
  const [error, setError] = useState<string | null>(null); // 清单错误
  const [manageOpen, setManageOpen] = useState(false); // 管理面板展开态
  const [manageItems, setManageItems] = useState<ToolItem[]>([]); // 管理端全状态清单
  const [form, setForm] = useState<FormState>(EMPTY_FORM); // 表单草稿
  const [editingSlug, setEditingSlug] = useState<string | null>(null); // 正在编辑的工具 slug
  const [busy, setBusy] = useState(false); // 提交忙碌态
  const [notice, setNotice] = useState<string | null>(null); // 成功提示

  /** 拉取公开清单；失败保留空态并记录错误，不阻断页面。 */
  async function loadList() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.tools.list();
      setItems(data.items);
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setLoading(false);
    }
  }

  /** 拉取管理端清单（含草稿 / 归档）；未登录或无权限时静默隐藏管理面板。 */
  async function loadManage() {
    if (!hasSession) return;
    try {
      const data = await api.tools.manage();
      setManageItems(data.items);
    } catch {
      /* 无权限或离线时不展示管理清单，公开面不受影响 */
    }
  }

  useEffect(() => {
    void loadList();
    void loadManage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 打开详情：失败提示并回到清单态。 */
  async function openDetail(slug: string) {
    try {
      const data = await api.tools.detail(slug);
      setDetail(data.tool);
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

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
  }

  /** 重置表单为新建态。 */
  function resetForm() {
    setEditingSlug(null);
    setForm(EMPTY_FORM);
    setNotice(null);
  }

  /** 提交新建 / 更新；版本与说明非空时追加一条版本记录。 */
  async function submitForm() {
    if (!form.name.trim()) {
      setNotice(tr(locale, '请填写工具名称', 'Name is required'));
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const tags = parseTags(form.tags);
      const versionNote = form.version.trim()
        ? { version: form.version.trim(), notes: form.notes.trim(), released_at: new Date().toISOString() }
        : undefined;
      const payload: ToolUpsertPayload = {
        name: form.name.trim(),
        summary: form.summary.trim(),
        tags,
        download_url: form.download_url.trim(),
        doc_url: form.doc_url.trim(),
        status: form.status,
        sort_order: Math.max(0, Number(form.sort_order) || 100),
      };
      if (versionNote) payload.version_notes = [versionNote];
      if (editingSlug) {
        // 编辑：保留已有版本记录，把新条目插到最前
        const current = manageItems.find((t) => t.slug === editingSlug);
        const prevNotes = current?.version_notes ?? [];
        payload.version_notes = versionNote ? [versionNote, ...prevNotes] : prevNotes;
        await api.tools.update(editingSlug, payload);
      } else {
        payload.slug = form.slug.trim().toLowerCase();
        if (!payload.slug) throw new Error(tr(locale, '请填写 slug 标识', 'Slug is required'));
        await api.tools.create(payload);
      }
      resetForm();
      await Promise.all([loadList(), loadManage()]);
      setNotice(tr(locale, '已保存', 'Saved'));
    } catch (err) {
      setNotice(errorText(locale, err));
    } finally {
      setBusy(false);
    }
  }

  /** 删除工具；成功后刷新两个清单。 */
  async function removeTool(slug: string) {
    setBusy(true);
    try {
      await api.tools.remove(slug);
      if (detail?.slug === slug) setDetail(null);
      await Promise.all([loadList(), loadManage()]);
      setNotice(tr(locale, '已删除', 'Deleted'));
    } catch (err) {
      setNotice(errorText(locale, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page tools-page">
      <header className="page-head">
        <h1>{tr(locale, '自研工具', 'Self-built Tools')}</h1>
        <p className="muted">{tr(locale, '团队自研的插件、脚本与防护工具，含版本记录、下载与文档入口。', 'In-house plugins, scripts and protection tools with changelogs, downloads and docs.')}</p>
      </header>

      {error && <p className="error">{error}</p>}

      {detail ? (
        <section className="panel tool-detail">
          <div className="panel-head">
            <h2>{detail.name}</h2>
            <span className="deploy-badge">{detail.slug}</span>
          </div>
          <p className="muted">{detail.summary}</p>
          {detail.tags.length > 0 && (
            <div className="tool-tags">
              {detail.tags.map((tag) => <span className="deploy-badge muted" key={tag}>{tag}</span>)}
            </div>
          )}
          <div className="tool-links">
            {detail.download_url ? <a className="btn primary" href={detail.download_url}>{tr(locale, '下载', 'Download')}</a> : null}
            {detail.doc_url ? <a className="btn ghost" href={detail.doc_url}>{tr(locale, '文档', 'Docs')}</a> : null}
          </div>
          <h3>{tr(locale, '版本记录', 'Changelog')}</h3>
          {detail.version_notes.length === 0 ? (
            <p className="muted">{tr(locale, '暂无版本记录', 'No version history yet')}</p>
          ) : (
            <ul className="plain-list tool-version-list">
              {detail.version_notes.map((note) => (
                <li className="deploy-row" key={`${note.version}-${note.released_at ?? ''}`}>
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
        <div className="commerce-grid tools-grid">
          {items.map((tool) => (
            <article className="panel tool-card" key={tool.slug}>
              <div className="panel-head">
                <h3>{tool.name}</h3>
                <span className="deploy-badge">{tool.version_notes[0]?.version ?? '—'}</span>
              </div>
              <p className="muted">{tool.summary}</p>
              {tool.tags.length > 0 && (
                <div className="tool-tags">
                  {tool.tags.map((tag) => <span className="deploy-badge muted" key={tag}>{tag}</span>)}
                </div>
              )}
              <div className="row">
                <button type="button" className="btn ghost small" onClick={() => void openDetail(tool.slug)}>{tr(locale, '详情', 'Details')}</button>
                {tool.doc_url ? <a className="link" href={tool.doc_url}>{tr(locale, '文档', 'Docs')}</a> : null}
              </div>
            </article>
          ))}
        </div>
      )}

      {hasSession && (
        <section className="panel tool-admin">
          <button type="button" className="btn ghost" onClick={() => { setManageOpen((v) => !v); void loadManage(); }}>
            {tr(locale, '管理工具', 'Manage tools')}
          </button>
          {manageOpen && (
            <>
              {notice && <p className={notice.includes('权限') || notice.includes('失败') ? 'error' : 'notice'}>{notice}</p>}
              <div className="tool-form">
                <input value={form.slug} disabled={!!editingSlug} placeholder="slug (quick-build-wp)" onChange={(e) => setForm({ ...form, slug: e.target.value })} />
                <input value={form.name} placeholder={tr(locale, '名称', 'Name')} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <input value={form.summary} placeholder={tr(locale, '简介', 'Summary')} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
                <input value={form.tags} placeholder={tr(locale, '标签（逗号分隔）', 'Tags (comma separated)')} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
                <input value={form.download_url} placeholder={tr(locale, '下载地址', 'Download URL')} onChange={(e) => setForm({ ...form, download_url: e.target.value })} />
                <input value={form.doc_url} placeholder={tr(locale, '文档地址', 'Doc URL')} onChange={(e) => setForm({ ...form, doc_url: e.target.value })} />
                <input value={form.version} placeholder={tr(locale, '新版本号（可选）', 'New version (optional)')} onChange={(e) => setForm({ ...form, version: e.target.value })} />
                <input value={form.notes} placeholder={tr(locale, '版本说明（可选）', 'Version notes (optional)')} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as FormState['status'] })}>
                  <option value="active">{tr(locale, '上架', 'Active')}</option>
                  <option value="draft">{tr(locale, '草稿', 'Draft')}</option>
                  <option value="archived">{tr(locale, '归档', 'Archived')}</option>
                </select>
                <input value={form.sort_order} inputMode="numeric" placeholder="排序" onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
                <div className="row">
                  <button type="button" className="btn primary" disabled={busy} onClick={() => void submitForm()}>
                    {editingSlug ? tr(locale, '保存修改', 'Save') : tr(locale, '新建工具', 'Create')}
                  </button>
                  {editingSlug ? <button type="button" className="btn ghost" onClick={resetForm}>{tr(locale, '取消编辑', 'Cancel')}</button> : null}
                </div>
              </div>
              {manageItems.length > 0 && (
                <ul className="plain-list tool-manage-list">
                  {manageItems.map((tool) => (
                    <li className="deploy-row" key={tool.slug}>
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
  );
}
