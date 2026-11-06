import { useState } from 'react';
import type { Locale } from '@mim/i18n';
import { api, errorText } from '../api';
import { useAsync } from '../hooks';

interface Props {
  locale: Locale;
}

interface ProjectItem {
  id: string;
  title: string;
  status: string;
  updated_at: string;
  version: number;
}

const STATUS_LABEL: Record<string, Record<Locale, string>> = {
  draft: { 'zh-CN': '草稿', 'en-US': 'Draft' },
  storyboarded: { 'zh-CN': '分镜已确认', 'en-US': 'Storyboarded' },
  generating: { 'zh-CN': '生成中', 'en-US': 'Generating' },
  rendered: { 'zh-CN': '已渲染', 'en-US': 'Rendered' },
  published: { 'zh-CN': '已发布', 'en-US': 'Published' },
  archived: { 'zh-CN': '已归档', 'en-US': 'Archived' },
};

export function ComicWorkbench({ locale }: Props) {
  const listState = useAsync(() => api.comic.listProjects(), []);
  const projects = (listState.data?.projects ?? []) as ProjectItem[];
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleCreate() {
    if (!newTitle.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.comic.createProject({ title: newTitle.trim() });
      setMessage(locale === 'en-US' ? `Created: ${result.title}` : `已创建: ${result.title}`);
      setNewTitle('');
      listState.reload();
      setSelectedId(result.id);
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(locale === 'en-US' ? 'Delete this project?' : '确认删除此工程？')) return;
    try {
      await api.comic.deleteProject(id);
      listState.reload();
      if (selectedId === id) setSelectedId(null);
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  if (listState.loading) return <div className="hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</div>;
  if (listState.error) return <div className="error">{errorText(locale, listState.error)}</div>;

  return (
    <div className="page">
      <header className="page-head">
        <h1>{locale === 'en-US' ? 'Comic AI Studio' : '漫剧 AI 剧工作台'}</h1>
        <p className="muted">
          {locale === 'en-US'
            ? 'AI-assisted creation — script, storyboard, characters, and film generation'
            : 'AI 辅助创作：剧本、分镜、角色、成片一站式'}
        </p>
      </header>

      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}

      <div className="split">
        {/* 左栏：工程列表 */}
        <section className="panel col-4">
          <header className="panel-head">
            <h2>{locale === 'en-US' ? 'Projects' : '我的工程'}</h2>
          </header>
          <div className="form-inline">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={locale === 'en-US' ? 'New project title…' : '新工程标题…'}
              disabled={busy}
            />
            <button type="button" className="btn primary" onClick={handleCreate} disabled={busy || !newTitle.trim()}>
              + {locale === 'en-US' ? 'Create' : '新建'}
            </button>
          </div>

          <ul className="list">
            {projects.map((p) => (
              <li
                key={p.id}
                className={`list-item${selectedId === p.id ? ' active' : ''}`}
                onClick={() => setSelectedId(p.id)}
              >
                <div className="list-item-main">
                  <strong>{p.title}</strong>
                  <span className="badge">{STATUS_LABEL[p.status]?.[locale] ?? p.status}</span>
                </div>
                <div className="list-item-sub">
                  <span className="muted small">{new Date(p.updated_at).toLocaleString()}</span>
                  <button
                    type="button"
                    className="btn ghost danger small"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(p.id);
                    }}
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
            {projects.length === 0 && (
              <li className="hint">{locale === 'en-US' ? 'No projects yet. Create one above.' : '尚无工程，在上方创建。'}</li>
            )}
          </ul>
        </section>

        {/* 右栏：选中工程详情 */}
        <section className="panel col-8">
          {selectedId ? (
            <ProjectDetail locale={locale} projectId={selectedId} onChange={() => listState.reload()} />
          ) : (
            <div className="hint">{locale === 'en-US' ? 'Select a project to start creating.' : '选择左侧工程开始创作。'}</div>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------- 工程详情 ----------

function ProjectDetail({ locale, projectId, onChange }: { locale: Locale; projectId: string; onChange: () => void }) {
  const detailState = useAsync(() => api.comic.getProject(projectId), [projectId]);
  const [suggestKind, setSuggestKind] = useState<'script' | 'storyboard' | 'dialogue' | 'tts'>('storyboard');
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestResult, setSuggestResult] = useState<string | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const charName = useState('')[0];
  const charPrompt = useState('')[0];
  const [charNameVal, setCharNameVal] = useState('');
  const [charPromptVal, setCharPromptVal] = useState('');
  const [charBusy, setCharBusy] = useState(false);
  const [charError, setCharError] = useState<string | null>(null);
  const [charMsg, setCharMsg] = useState<string | null>(null);

  void charName;
  void charPrompt;

  async function handleSuggest() {
    setSuggestBusy(true);
    setSuggestError(null);
    setSuggestResult(null);
    try {
      const result = await api.comic.suggest(projectId, suggestKind);
      setSuggestResult(JSON.stringify(result.suggestion, null, 2));
    } catch (err) {
      setSuggestError(errorText(locale, err));
    } finally {
      setSuggestBusy(false);
    }
  }

  async function handleAddCharacter() {
    if (!charNameVal.trim() || !charPromptVal.trim()) return;
    setCharBusy(true);
    setCharError(null);
    setCharMsg(null);
    try {
      await api.comic.addCharacter(projectId, {
        name: charNameVal.trim(),
        appearance_prompt: charPromptVal.trim(),
      });
      setCharNameVal('');
      setCharPromptVal('');
      setCharMsg(locale === 'en-US' ? 'Character added ✓' : '角色已添加 ✓');
      detailState.reload();
    } catch (err) {
      setCharError(errorText(locale, err));
    } finally {
      setCharBusy(false);
    }
  }

  if (detailState.loading) return <div className="hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</div>;
  if (detailState.error || !detailState.data) return <div className="error">{errorText(locale, detailState.error)}</div>;

  const proj = detailState.data;
  const characters = (proj.characters ?? []) as Array<{ id: string; name: string; appearance_prompt: string }>;

  return (
    <div>
      <header className="panel-head">
        <h2>{proj.title}</h2>
        <span className="badge">{STATUS_LABEL[proj.status]?.[locale] ?? proj.status}</span>
      </header>
      <p className="muted">{proj.synopsis ?? (locale === 'en-US' ? 'No synopsis' : '暂无简介')}</p>

      {/* 角色 */}
      <section className="sub-panel">
        <header className="panel-head">
          <h3>{locale === 'en-US' ? 'Characters' : '角色设定'}</h3>
        </header>

        {charError && <p className="error">{charError}</p>}
        {charMsg && <p className="success">{charMsg}</p>}

        <div className="form-grid">
          <label>
            <span>{locale === 'en-US' ? 'Name' : '名称'}</span>
            <input value={charNameVal} onChange={(e) => setCharNameVal(e.target.value)} placeholder="主角 A" />
          </label>
          <label>
            <span>{locale === 'en-US' ? 'Appearance Prompt' : '外观描述'}</span>
            <input
              value={charPromptVal}
              onChange={(e) => setCharPromptVal(e.target.value)}
              placeholder={locale === 'en-US' ? 'young man, black hair…' : '青年男性，黑发…'}
            />
          </label>
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={charBusy || !charNameVal.trim() || !charPromptVal.trim()}
          onClick={handleAddCharacter}
        >
          {charBusy ? (locale === 'en-US' ? 'Adding…' : '添加中…') : locale === 'en-US' ? 'Add Character' : '添加角色'}
        </button>

        {characters.length > 0 && (
          <ul className="list">
            {characters.map((c) => (
              <li key={c.id} className="list-item">
                <div className="list-item-main">
                  <strong>{c.name}</strong>
                  <span className="muted small">{c.appearance_prompt}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* AI 建议 */}
      <section className="sub-panel">
        <header className="panel-head">
          <h3>{locale === 'en-US' ? 'AI Suggestions' : 'AI 建议'}</h3>
        </header>

        <div className="form-inline">
          <select value={suggestKind} onChange={(e) => setSuggestKind(e.target.value as typeof suggestKind)}>
            <option value="storyboard">{locale === 'en-US' ? 'Storyboard' : '分镜表'}</option>
            <option value="script">{locale === 'en-US' ? 'Script' : '剧本'}</option>
            <option value="dialogue">{locale === 'en-US' ? 'Dialogue' : '对白'}</option>
            <option value="tts">TTS</option>
          </select>
          <button type="button" className="btn primary" onClick={handleSuggest} disabled={suggestBusy}>
            {suggestBusy ? (locale === 'en-US' ? 'Generating…' : '生成中…') : locale === 'en-US' ? 'Generate' : '生成建议'}
          </button>
        </div>

        {suggestError && <p className="error">{suggestError}</p>}
        {suggestResult && (
          <pre className="code-block">
            <code>{suggestResult}</code>
          </pre>
        )}
      </section>
    </div>
  );
}
