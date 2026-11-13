/**
 * 内容栏目页：公告列表 / 更新日志时间线 / 推广计划卡片。
 * 三个公开接口独立拉取，任一 404 或返回空数组时静默隐藏对应栏目，不报错、不白屏。
 * 已登录运营可在本页对三栏目进行增删改（复用 /admin/content/* 契约，挂 appearance:write 权限）；
 * 无会话或无权限时管理面板静默隐藏，公开面不受影响。
 */

import { useEffect, useState } from 'react'; // 状态与副作用
import type { Locale } from '@mim/i18n'; // 语言类型
import { api, errorText } from '../api'; // 接口客户端与错误文案翻译
import type {
  AnnouncementItem,
  ChangelogItem,
  PromotionItem,
  AnnouncementUpsertPayload,
  ChangelogUpsertPayload,
  PromotionUpsertPayload,
} from '../api'; // 内容条目与管理入参类型

interface Props { // 视图参数
  locale: Locale; // 当前界面语言
  hasSession?: boolean; // 是否已有会话；决定是否展示管理端
}

type ContentTab = 'announcements' | 'changelog' | 'promotions'; // 内部栏目切换

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

/** 公告管理表单草稿。 */
interface AnnForm {
  title: string;
  body: string;
  level: 'info' | 'warning' | 'success' | 'danger';
  status: 'draft' | 'published' | 'archived';
  pinned: boolean;
  starts_at: string;
  ends_at: string;
}

const EMPTY_ANN: AnnForm = {
  title: '',
  body: '',
  level: 'info',
  status: 'draft',
  pinned: false,
  starts_at: '',
  ends_at: '',
};

/** 更新日志管理表单草稿：changes 以换行 / 逗号分隔，提交时拆为数组。 */
interface ClForm {
  version: string;
  title: string;
  body: string;
  changes: string;
  published_at: string;
  status: 'draft' | 'published' | 'archived';
}

const EMPTY_CL: ClForm = { version: '', title: '', body: '', changes: '', published_at: '', status: 'draft' };

/** 推广计划管理表单草稿。 */
interface PromoForm {
  name: string;
  summary: string;
  target_url: string;
  code: string;
  starts_at: string;
  ends_at: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  budget_cents: string;
}

const EMPTY_PROMO: PromoForm = { name: '', summary: '', target_url: '', code: '', starts_at: '', ends_at: '', status: 'draft', budget_cents: '0' };

/** 时间字符串：空串回落 null，便于后端 nullable 字段处理。 */
function isoOrNull(raw: string): string | null {
  return raw.trim() ? raw.trim() : null;
}

export function ContentHub({ locale, hasSession = false }: Props) {
  const [tab, setTab] = useState<ContentTab>('announcements'); // 当前公开栏目
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]); // 公告清单
  const [changelog, setChangelog] = useState<ChangelogItem[]>([]); // 更新日志
  const [promotions, setPromotions] = useState<PromotionItem[]>([]); // 推广计划
  const [loaded, setLoaded] = useState(false); // 首屏是否完成拉取（用于空态区分加载中）

  // ===== 管理端状态：仅在 hasSession 时拉取与渲染 =====
  const [manageOpen, setManageOpen] = useState(false); // 管理面板展开态
  const [adminTab, setAdminTab] = useState<ContentTab>('announcements'); // 管理栏目
  const [manageAnn, setManageAnn] = useState<AnnouncementItem[]>([]); // 公告管理清单
  const [manageCl, setManageCl] = useState<ChangelogItem[]>([]); // 日志管理清单
  const [managePromo, setManagePromo] = useState<PromotionItem[]>([]);
  const [adminAllowed, setAdminAllowed] = useState(false); // 任一管理清单可访问才放行入口；401/403/离线静默隐藏 // 推广管理清单
  const [annForm, setAnnForm] = useState<AnnForm>(EMPTY_ANN); // 公告表单草稿
  const [clForm, setClForm] = useState<ClForm>(EMPTY_CL); // 日志表单草稿
  const [promoForm, setPromoForm] = useState<PromoForm>(EMPTY_PROMO); // 推广表单草稿
  const [editingAnn, setEditingAnn] = useState<string | null>(null); // 正在编辑的公告 id
  const [editingCl, setEditingCl] = useState<string | null>(null); // 正在编辑的日志 id
  const [editingPromo, setEditingPromo] = useState<string | null>(null); // 正在编辑的推广 id
  const [busy, setBusy] = useState(false); // 提交忙碌态
  const [notice, setNotice] = useState<string | null>(null); // 成功 / 失败提示

  /** 并行拉取三个公开栏目；各自失败回落空数组，互不影响。 */
  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([
      api.content.announcements(20),
      api.content.changelog(30),
      api.content.promotions(),
    ]).then(([ann, cl, promo]) => {
      if (cancelled) return;
      setAnnouncements(ann.status === 'fulfilled' ? ann.value.items : []);
      setChangelog(cl.status === 'fulfilled' ? cl.value.items : []);
      setPromotions(promo.status === 'fulfilled' ? promo.value.items : []);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  /** 拉取三栏目管理清单（含草稿 / 归档）；未登录或无权限时静默隐藏管理面板。 */
  async function loadManage() {
    if (!hasSession) return;
    const [ann, cl, promo] = await Promise.allSettled([
      api.content.manageAnnouncements(),
      api.content.manageChangelog(),
      api.content.managePromotions(),
    ]);
    setManageAnn(ann.status === 'fulfilled' ? ann.value.items : []);
    setManageCl(cl.status === 'fulfilled' ? cl.value.items : []);
    setManagePromo(promo.status === 'fulfilled' ? promo.value.items : []);
    // 三套管理清单同一权限码；任一可访问即视为有权，全部失败（401/403/离线）则隐藏管理入口
    setAdminAllowed([ann, cl, promo].some((r) => r.status === 'fulfilled'));
  }

  // ===== 公告管理 =====

  function startEditAnn(item: AnnouncementItem) {
    setEditingAnn(item.id);
    setAnnForm({
      title: item.title,
      body: item.body ?? '',
      level: item.level ?? 'info',
      status: item.status ?? 'draft',
      pinned: item.pinned,
      starts_at: fmtDate(item.starts_at),
      ends_at: fmtDate(item.ends_at),
    });
    setNotice(null);
  }

  async function submitAnn() {
    if (!annForm.title.trim()) { setNotice(tr(locale, '请填写公告标题', 'Title is required')); return; }
    setBusy(true); setNotice(null);
    try {
      const payload: AnnouncementUpsertPayload = {
        title: annForm.title.trim(),
        body: annForm.body.trim(),
        level: annForm.level,
        status: annForm.status,
        pinned: annForm.pinned,
        starts_at: isoOrNull(annForm.starts_at),
        ends_at: isoOrNull(annForm.ends_at),
      };
      if (editingAnn) {
        await api.content.updateAnnouncement(editingAnn, payload);
      } else {
        await api.content.createAnnouncement(payload);
      }
      setAnnForm(EMPTY_ANN); setEditingAnn(null);
      await Promise.all([loadManage()]);
      setNotice(tr(locale, '公告已保存', 'Announcement saved'));
    } catch (err) {
      setNotice(errorText(locale, err));
    } finally {
      setBusy(false);
    }
  }

  async function removeAnn(id: string) {
    setBusy(true);
    try {
      await api.content.deleteAnnouncement(id);
      await loadManage();
      setNotice(tr(locale, '公告已删除', 'Announcement deleted'));
    } catch (err) {
      setNotice(errorText(locale, err));
    } finally {
      setBusy(false);
    }
  }

  // ===== 更新日志管理 =====

  function startEditCl(item: ChangelogItem) {
    setEditingCl(item.id);
    setClForm({
      version: item.version,
      title: item.title,
      body: item.body ?? '',
      changes: (item.changes ?? []).join('\n'),
      published_at: fmtDate(item.published_at),
      status: item.status ?? 'draft',
    });
    setNotice(null);
  }

  async function submitCl() {
    if (!clForm.version.trim() || !clForm.title.trim()) {
      setNotice(tr(locale, '请填写版本号与标题', 'Version and title are required'));
      return;
    }
    setBusy(true); setNotice(null);
    try {
      const changes = clForm.changes.split(/[\n,，]+/).map((line) => line.trim()).filter(Boolean);
      const payload: ChangelogUpsertPayload = {
        version: clForm.version.trim(),
        title: clForm.title.trim(),
        body: clForm.body.trim(),
        changes,
        published_at: isoOrNull(clForm.published_at),
        status: clForm.status,
      };
      if (editingCl) {
        await api.content.updateChangelog(editingCl, payload);
      } else {
        await api.content.createChangelog(payload);
      }
      setClForm(EMPTY_CL); setEditingCl(null);
      await loadManage();
      setNotice(tr(locale, '更新日志已保存', 'Changelog saved'));
    } catch (err) {
      setNotice(errorText(locale, err));
    } finally {
      setBusy(false);
    }
  }

  async function removeCl(id: string) {
    setBusy(true);
    try {
      await api.content.deleteChangelog(id);
      await loadManage();
      setNotice(tr(locale, '更新日志已删除', 'Changelog deleted'));
    } catch (err) {
      setNotice(errorText(locale, err));
    } finally {
      setBusy(false);
    }
  }

  // ===== 推广计划管理 =====

  function startEditPromo(item: PromotionItem) {
    setEditingPromo(item.id);
    setPromoForm({
      name: item.name,
      summary: item.summary ?? '',
      target_url: item.target_url ?? '',
      code: item.code ?? '',
      starts_at: fmtDate(item.starts_at),
      ends_at: fmtDate(item.ends_at),
      status: item.status as PromoForm['status'],
      budget_cents: String(item.budget_cents ?? 0),
    });
    setNotice(null);
  }

  async function submitPromo() {
    if (!promoForm.name.trim()) { setNotice(tr(locale, '请填写计划名称', 'Name is required')); return; }
    setBusy(true); setNotice(null);
    try {
      const payload: PromotionUpsertPayload = {
        name: promoForm.name.trim(),
        summary: promoForm.summary.trim(),
        target_url: promoForm.target_url.trim(),
        code: promoForm.code.trim() ? promoForm.code.trim() : null,
        starts_at: isoOrNull(promoForm.starts_at),
        ends_at: isoOrNull(promoForm.ends_at),
        status: promoForm.status,
        budget_cents: Math.max(0, Number(promoForm.budget_cents) || 0),
      };
      if (editingPromo) {
        await api.content.updatePromotion(editingPromo, payload);
      } else {
        await api.content.createPromotion(payload);
      }
      setPromoForm(EMPTY_PROMO); setEditingPromo(null);
      await loadManage();
      setNotice(tr(locale, '推广计划已保存', 'Promotion saved'));
    } catch (err) {
      setNotice(errorText(locale, err));
    } finally {
      setBusy(false);
    }
  }

  async function removePromo(id: string) {
    setBusy(true);
    try {
      await api.content.deletePromotion(id);
      await loadManage();
      setNotice(tr(locale, '推广计划已删除', 'Promotion deleted'));
    } catch (err) {
      setNotice(errorText(locale, err));
    } finally {
      setBusy(false);
    }
  }

  const tabs: Array<{ key: ContentTab; label: string; count: number }> = [
    { key: 'announcements', label: tr(locale, '公告', 'Announcements'), count: announcements.length },
    { key: 'changelog', label: tr(locale, '更新日志', 'Changelog'), count: changelog.length },
    { key: 'promotions', label: tr(locale, '推广计划', 'Promotions'), count: promotions.length },
  ];

  return (
    <div className="page content-hub">
      <header className="page-head">
        <h1>{tr(locale, '公告与动态', 'News & Updates')}</h1>
        <p className="muted">{tr(locale, '产品公告、版本更新与推广计划统一收录于此。', 'Announcements, release notes and promotions in one place.')}</p>
      </header>

      <nav className="community-chips content-tabs">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            className={tab === item.key ? 'is-active' : ''}
            onClick={() => setTab(item.key)}
          >
            {item.label} <em>{item.count}</em>
          </button>
        ))}
      </nav>

      {!loaded ? (
        <p className="hint">{tr(locale, '加载中…', 'Loading…')}</p>
      ) : tab === 'announcements' && announcements.length === 0 ? (
        <div className="community-empty">{tr(locale, '暂无公告', 'No announcements')}</div>
      ) : tab === 'changelog' && changelog.length === 0 ? (
        <div className="community-empty">{tr(locale, '暂无更新日志', 'No changelog entries')}</div>
      ) : tab === 'promotions' && promotions.length === 0 ? (
        <div className="community-empty">{tr(locale, '暂无推广计划', 'No active promotions')}</div>
      ) : null}

      {tab === 'announcements' && announcements.length > 0 && (
        <ul className="plain-list announcement-list">
          {announcements.map((item) => (
            <li className="panel announcement-row" key={item.id}>
              <div className="panel-head">
                <h3>{item.title}</h3>
                {item.pinned ? <span className="deploy-badge">{tr(locale, '置顶', 'Pinned')}</span> : null}
              </div>
              <p className="muted">{item.body}</p>
              {item.published_at ? <span className="muted">{fmtDate(item.published_at)}</span> : null}
            </li>
          ))}
        </ul>
      )}

      {tab === 'changelog' && changelog.length > 0 && (
        <ol className="changelog-timeline">
          {changelog.map((item) => (
            <li className="changelog-entry" key={item.id}>
              <div className="changelog-version">
                <span className="deploy-badge">{item.version}</span>
                {item.published_at ? <span className="muted">{fmtDate(item.published_at)}</span> : null}
              </div>
              <h3>{item.title}</h3>
              <p className="muted">{item.body}</p>
            </li>
          ))}
        </ol>
      )}

      {tab === 'promotions' && promotions.length > 0 && (
        <div className="commerce-grid promotions-grid">
          {promotions.map((item) => (
            <a className="panel promotion-card" key={item.id} href={item.target_url || undefined}>
              <div className="panel-head">
                <h3>{item.name}</h3>
                <span className="deploy-badge muted">{item.status}</span>
              </div>
              <p className="muted">{item.summary}</p>
              <span className="muted">
                {fmtDate(item.starts_at)}{item.ends_at ? ` ~ ${fmtDate(item.ends_at)}` : ''}
              </span>
            </a>
          ))}
        </div>
      )}

      {/* 管理端：会话态且管理清单可访问才展示；401 / 403 / 离线静默隐藏，普通用户不可见 */}
      {hasSession && adminAllowed && (
        <section className="panel content-admin">
          <button
            type="button"
            className="btn ghost"
            onClick={() => { setManageOpen((v) => !v); void loadManage(); }}
          >
            {tr(locale, '管理内容', 'Manage content')}
          </button>
          {manageOpen && (
            <>
              {notice && <p className={notice.includes('权限') || notice.includes('失败') || notice.includes('Error') ? 'error' : 'notice'}>{notice}</p>}
              <nav className="community-chips content-admin-tabs">
                {tabs.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={adminTab === item.key ? 'is-active' : ''}
                    onClick={() => setAdminTab(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>

              {/* 公告管理 */}
              {adminTab === 'announcements' && (
                <div className="content-admin-pane">
                  <div className="tool-form">
                    <input value={annForm.title} placeholder={tr(locale, '标题（必填）', 'Title (required)')} onChange={(e) => setAnnForm({ ...annForm, title: e.target.value })} />
                    <textarea value={annForm.body} rows={3} placeholder={tr(locale, '正文', 'Body')} onChange={(e) => setAnnForm({ ...annForm, body: e.target.value })} />
                    <select value={annForm.level} onChange={(e) => setAnnForm({ ...annForm, level: e.target.value as AnnForm['level'] })}>
                      <option value="info">info</option><option value="warning">warning</option><option value="success">success</option><option value="danger">danger</option>
                    </select>
                    <select value={annForm.status} onChange={(e) => setAnnForm({ ...annForm, status: e.target.value as AnnForm['status'] })}>
                      <option value="draft">{tr(locale, '草稿', 'Draft')}</option>
                      <option value="published">{tr(locale, '已发布', 'Published')}</option>
                      <option value="archived">{tr(locale, '归档', 'Archived')}</option>
                    </select>
                    <label className="hint"><input type="checkbox" checked={annForm.pinned} onChange={(e) => setAnnForm({ ...annForm, pinned: e.target.checked })} /> {tr(locale, '置顶', 'Pinned')}</label>
                    <input type="date" value={annForm.starts_at} onChange={(e) => setAnnForm({ ...annForm, starts_at: e.target.value })} />
                    <input type="date" value={annForm.ends_at} onChange={(e) => setAnnForm({ ...annForm, ends_at: e.target.value })} />
                    <div className="row">
                      <button type="button" className="btn primary" disabled={busy} onClick={() => void submitAnn()}>
                        {editingAnn ? tr(locale, '保存修改', 'Save') : tr(locale, '新建公告', 'Create')}
                      </button>
                      {editingAnn ? <button type="button" className="btn ghost" onClick={() => { setAnnForm(EMPTY_ANN); setEditingAnn(null); }}>{tr(locale, '取消编辑', 'Cancel')}</button> : null}
                    </div>
                  </div>
                  {manageAnn.length > 0 && (
                    <ul className="plain-list tool-manage-list">
                      {manageAnn.map((item) => (
                        <li className="deploy-row" key={item.id}>
                          <span>{item.title}</span>
                          <span className="deploy-badge muted">{item.status ?? '—'}</span>
                          <button type="button" className="btn ghost small" onClick={() => startEditAnn(item)}>{tr(locale, '编辑', 'Edit')}</button>
                          <button type="button" className="btn ghost small" disabled={busy} onClick={() => void removeAnn(item.id)}>{tr(locale, '删除', 'Delete')}</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* 更新日志管理 */}
              {adminTab === 'changelog' && (
                <div className="content-admin-pane">
                  <div className="tool-form">
                    <input value={clForm.version} placeholder={tr(locale, '版本号，如 0.0.9', 'Version, e.g. 0.0.9')} onChange={(e) => setClForm({ ...clForm, version: e.target.value })} />
                    <input value={clForm.title} placeholder={tr(locale, '标题（必填）', 'Title (required)')} onChange={(e) => setClForm({ ...clForm, title: e.target.value })} />
                    <textarea value={clForm.body} rows={3} placeholder={tr(locale, '正文', 'Body')} onChange={(e) => setClForm({ ...clForm, body: e.target.value })} />
                    <textarea value={clForm.changes} rows={3} placeholder={tr(locale, '变更清单（每行一条）', 'Changes (one per line)')} onChange={(e) => setClForm({ ...clForm, changes: e.target.value })} />
                    <input type="date" value={clForm.published_at} onChange={(e) => setClForm({ ...clForm, published_at: e.target.value })} />
                    <select value={clForm.status} onChange={(e) => setClForm({ ...clForm, status: e.target.value as ClForm['status'] })}>
                      <option value="draft">{tr(locale, '草稿', 'Draft')}</option>
                      <option value="published">{tr(locale, '已发布', 'Published')}</option>
                      <option value="archived">{tr(locale, '归档', 'Archived')}</option>
                    </select>
                    <div className="row">
                      <button type="button" className="btn primary" disabled={busy} onClick={() => void submitCl()}>
                        {editingCl ? tr(locale, '保存修改', 'Save') : tr(locale, '新建日志', 'Create')}
                      </button>
                      {editingCl ? <button type="button" className="btn ghost" onClick={() => { setClForm(EMPTY_CL); setEditingCl(null); }}>{tr(locale, '取消编辑', 'Cancel')}</button> : null}
                    </div>
                  </div>
                  {manageCl.length > 0 && (
                    <ul className="plain-list tool-manage-list">
                      {manageCl.map((item) => (
                        <li className="deploy-row" key={item.id}>
                          <span>{item.version} · {item.title}</span>
                          <span className="deploy-badge muted">{item.status ?? '—'}</span>
                          <button type="button" className="btn ghost small" onClick={() => startEditCl(item)}>{tr(locale, '编辑', 'Edit')}</button>
                          <button type="button" className="btn ghost small" disabled={busy} onClick={() => void removeCl(item.id)}>{tr(locale, '删除', 'Delete')}</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* 推广计划管理 */}
              {adminTab === 'promotions' && (
                <div className="content-admin-pane">
                  <div className="tool-form">
                    <input value={promoForm.name} placeholder={tr(locale, '计划名称（必填）', 'Name (required)')} onChange={(e) => setPromoForm({ ...promoForm, name: e.target.value })} />
                    <input value={promoForm.summary} placeholder={tr(locale, '摘要', 'Summary')} onChange={(e) => setPromoForm({ ...promoForm, summary: e.target.value })} />
                    <input value={promoForm.target_url} placeholder={tr(locale, '落地页 URL', 'Target URL')} onChange={(e) => setPromoForm({ ...promoForm, target_url: e.target.value })} />
                    <input value={promoForm.code} placeholder={tr(locale, '推广码（可选）', 'Promo code (optional)')} onChange={(e) => setPromoForm({ ...promoForm, code: e.target.value })} />
                    <input type="date" value={promoForm.starts_at} onChange={(e) => setPromoForm({ ...promoForm, starts_at: e.target.value })} />
                    <input type="date" value={promoForm.ends_at} onChange={(e) => setPromoForm({ ...promoForm, ends_at: e.target.value })} />
                    <select value={promoForm.status} onChange={(e) => setPromoForm({ ...promoForm, status: e.target.value as PromoForm['status'] })}>
                      <option value="draft">{tr(locale, '草稿', 'Draft')}</option>
                      <option value="active">{tr(locale, '进行中', 'Active')}</option>
                      <option value="paused">{tr(locale, '已暂停', 'Paused')}</option>
                      <option value="archived">{tr(locale, '归档', 'Archived')}</option>
                    </select>
                    <input value={promoForm.budget_cents} inputMode="numeric" placeholder={tr(locale, '预算（分）', 'Budget (minor cents)')} onChange={(e) => setPromoForm({ ...promoForm, budget_cents: e.target.value })} />
                    <div className="row">
                      <button type="button" className="btn primary" disabled={busy} onClick={() => void submitPromo()}>
                        {editingPromo ? tr(locale, '保存修改', 'Save') : tr(locale, '新建推广', 'Create')}
                      </button>
                      {editingPromo ? <button type="button" className="btn ghost" onClick={() => { setPromoForm(EMPTY_PROMO); setEditingPromo(null); }}>{tr(locale, '取消编辑', 'Cancel')}</button> : null}
                    </div>
                  </div>
                  {managePromo.length > 0 && (
                    <ul className="plain-list tool-manage-list">
                      {managePromo.map((item) => (
                        <li className="deploy-row" key={item.id}>
                          <span>{item.name}</span>
                          <span className="deploy-badge muted">{item.status}</span>
                          <button type="button" className="btn ghost small" onClick={() => startEditPromo(item)}>{tr(locale, '编辑', 'Edit')}</button>
                          <button type="button" className="btn ghost small" disabled={busy} onClick={() => void removePromo(item.id)}>{tr(locale, '删除', 'Delete')}</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
