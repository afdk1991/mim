import { useEffect, useState } from 'react';
import type { Locale } from '@mim/i18n';
import {
  api,
  errorText,
  type ComicProject,
  type Film,
  type GenerationJob,
  type JobType,
  type SuggestKind,
} from '../api';
import { useAsync } from '../hooks';

interface Props {
  locale: Locale;
}

const STATUS_LABEL: Record<string, Record<Locale, string>> = {
  draft: { 'zh-CN': '草稿', 'en-US': 'Draft' },
  storyboarded: { 'zh-CN': '分镜已确认', 'en-US': 'Storyboarded' },
  generating: { 'zh-CN': '生成中', 'en-US': 'Generating' },
  rendered: { 'zh-CN': '已渲染', 'en-US': 'Rendered' },
  published: { 'zh-CN': '已发布', 'en-US': 'Published' },
  archived: { 'zh-CN': '已归档', 'en-US': 'Archived' },
};

const JOB_TYPE_LABEL: Record<JobType, Record<Locale, string>> = {
  text: { 'zh-CN': '文本', 'en-US': 'Text' },
  image: { 'zh-CN': '图像', 'en-US': 'Image' },
  video: { 'zh-CN': '视频', 'en-US': 'Video' },
  tts: { 'zh-CN': '配音', 'en-US': 'TTS' },
  compose: { 'zh-CN': '合成', 'en-US': 'Compose' },
};

const JOB_STATUS_LABEL: Record<string, Record<Locale, string>> = {
  queued: { 'zh-CN': '排队中', 'en-US': 'Queued' },
  running: { 'zh-CN': '运行中', 'en-US': 'Running' },
  succeeded: { 'zh-CN': '已成功', 'en-US': 'Succeeded' },
  failed: { 'zh-CN': '已失败', 'en-US': 'Failed' },
  canceled: { 'zh-CN': '已取消', 'en-US': 'Canceled' },
};

const FILM_STATUS_LABEL: Record<string, Record<Locale, string>> = {
  draft: { 'zh-CN': '草稿', 'en-US': 'Draft' },
  reviewing: { 'zh-CN': '审核中', 'en-US': 'Reviewing' },
  published: { 'zh-CN': '已发布', 'en-US': 'Published' },
  archived: { 'zh-CN': '已归档', 'en-US': 'Archived' },
};

export function ComicWorkbench({ locale }: Props) {
  const listState = useAsync(() => api.comic.listProjects(), []);
  const projects: ComicProject[] = listState.data?.items ?? [];
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
      setMessage(locale === 'en-US' ? `Created: ${result.project.title}` : `已创建: ${result.project.title}`);
      setNewTitle('');
      listState.reload();
      setSelectedId(result.project.id);
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

  // 仅在首次加载（尚无数据）时占位；reload 期间保留已渲染的列表与详情，
  // 避免卸载 ProjectDetail 导致当前标签页被重置回「创作」。
  if (listState.loading && !listState.data) return <div className="hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</div>;
  if (listState.error && !listState.data) return <div className="error">{errorText(locale, listState.error)}</div>;

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
      {listState.error != null && <p className="error">{errorText(locale, listState.error)}</p>}
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

// ---------- 工程详情（创作 / 生成任务 / 成片 三个标签页） ----------

type DetailTab = 'create' | 'jobs' | 'films';

function ProjectDetail({ locale, projectId, onChange }: { locale: Locale; projectId: string; onChange: () => void }) {
  const detailState = useAsync(() => api.comic.getProject(projectId), [projectId]);
  const [tab, setTab] = useState<DetailTab>('create');

  // 切换工程时回到创作标签页
  useEffect(() => {
    setTab('create');
  }, [projectId]);

  // reload 期间保留已渲染内容，避免 JobsTab/FilmsTab 被卸载后丢失输入与轮询状态。
  if (!detailState.data) {
    if (detailState.loading) return <div className="hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</div>;
    return <div className="error">{errorText(locale, detailState.error)}</div>;
  }

  const { project, characters, latest_storyboard } = detailState.data;
  const reloadAll = () => {
    detailState.reload();
    onChange();
  };

  const TAB_LABEL: Record<DetailTab, Record<Locale, string>> = {
    create: { 'zh-CN': '创作', 'en-US': 'Create' },
    jobs: { 'zh-CN': '生成任务', 'en-US': 'Jobs' },
    films: { 'zh-CN': '成片', 'en-US': 'Films' },
  };

  return (
    <div>
      <header className="panel-head">
        <h2>{project.title}</h2>
        <span className="badge">{STATUS_LABEL[project.status]?.[locale] ?? project.status}</span>
      </header>
      <p className="muted">{project.synopsis ?? (locale === 'en-US' ? 'No synopsis' : '暂无简介')}</p>
      {detailState.error != null && <p className="error">{errorText(locale, detailState.error)}</p>}

      <div className="form-inline" role="tablist">
        {(['create', 'jobs', 'films'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`btn ${tab === t ? 'primary' : 'ghost'}`}
            onClick={() => setTab(t)}
          >
            {TAB_LABEL[t][locale]}
          </button>
        ))}
      </div>

      {tab === 'create' && (
        <CreateTab
          locale={locale}
          projectId={projectId}
          characters={characters}
          onChanged={() => detailState.reload()}
        />
      )}
      {tab === 'jobs' && (
        <JobsTab
          locale={locale}
          projectId={projectId}
          projectStatus={project.status}
          storyboardId={latest_storyboard?.id ?? null}
          onProjectChange={reloadAll}
          onProjectRefresh={detailState.reload}
        />
      )}
      {tab === 'films' && (
        <FilmsTab locale={locale} projectId={projectId} projectStatus={project.status} onProjectChange={reloadAll} />
      )}
    </div>
  );
}

// ---------- 创作标签页：角色设定 + AI 建议 ----------

function CreateTab({
  locale,
  projectId,
  characters,
  onChanged,
}: {
  locale: Locale;
  projectId: string;
  characters: Array<{ id: string; name: string; appearance_prompt: string }>;
  onChanged: () => void;
}) {
  const [suggestKind, setSuggestKind] = useState<SuggestKind>('storyboard');
  const [suggestPrompt, setSuggestPrompt] = useState('');
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestResult, setSuggestResult] = useState<string | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const [charNameVal, setCharNameVal] = useState('');
  const [charPromptVal, setCharPromptVal] = useState('');
  const [charBusy, setCharBusy] = useState(false);
  const [charError, setCharError] = useState<string | null>(null);
  const [charMsg, setCharMsg] = useState<string | null>(null);

  async function handleSuggest() {
    setSuggestBusy(true);
    setSuggestError(null);
    setSuggestResult(null);
    try {
      const result = await api.comic.suggest(projectId, suggestKind, suggestPrompt);
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
      onChanged();
    } catch (err) {
      setCharError(errorText(locale, err));
    } finally {
      setCharBusy(false);
    }
  }

  return (
    <div>
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
          <select value={suggestKind} onChange={(e) => setSuggestKind(e.target.value as SuggestKind)}>
            <option value="storyboard">{locale === 'en-US' ? 'Storyboard' : '分镜表'}</option>
            <option value="script">{locale === 'en-US' ? 'Script' : '剧本'}</option>
            <option value="dialogue">{locale === 'en-US' ? 'Dialogue' : '对白'}</option>
            <option value="voice">{locale === 'en-US' ? 'Voice' : '配音'}</option>
          </select>
          <input
            value={suggestPrompt}
            onChange={(e) => setSuggestPrompt(e.target.value)}
            placeholder={locale === 'en-US' ? 'Optional prompt…' : '可选提示词…'}
          />
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

// ---------- 生成任务标签页：列表 / 创建 / 状态机操作 ----------

function JobsTab({
  locale,
  projectId,
  projectStatus,
  storyboardId,
  onProjectChange,
  onProjectRefresh,
}: {
  locale: Locale;
  projectId: string;
  projectStatus: ComicProject['status'];
  storyboardId: string | null;
  onProjectChange: () => void;
  /** 仅重载工程详情（不重载左侧列表），用于轮询时同步工程状态 */
  onProjectRefresh: () => void;
}) {
  const jobsState = useAsync(() => api.comic.listJobs(projectId), [projectId]);
  const jobs: GenerationJob[] = jobsState.data?.items ?? [];
  const hasActive = jobs.some((j) => j.status === 'queued' || j.status === 'running');
  const { reload: reloadJobs } = jobsState;

  // 有排队/运行中任务时每 3 秒轮询一次：任务列表与工程详情同步刷新，
  // 使 compose 成功导致的 project → rendered 能及时反映到成片门槛上。
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => {
      reloadJobs();
      onProjectRefresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [hasActive, reloadJobs, onProjectRefresh]);

  const [jobType, setJobType] = useState<JobType>('text');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // AI 编排能力：provider / 支持的任务类型 / 存储（capabilities 横幅 + provider 感知派发）
  const capsState = useAsync(() => api.ai.capabilities(), []);
  const caps = capsState.data?.ai ?? null;
  const supportedTypes = caps?.supported_job_types ?? null;
  const typeSupported = (t: JobType) => !supportedTypes || supportedTypes.includes(t);

  const canDispatch = projectStatus === 'storyboarded' || projectStatus === 'generating';
  const canDispatchType = canDispatch && typeSupported(jobType);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.comic.createJob(projectId, {
        job_type: jobType,
        storyboard_id: storyboardId ?? undefined,
        payload: prompt.trim() ? { prompt: prompt.trim() } : {},
      });
      setMessage(
        locale === 'en-US'
          ? `Job queued: ${JOB_TYPE_LABEL[result.job.job_type]['en-US']}`
          : `任务已排队：${JOB_TYPE_LABEL[result.job.job_type]['zh-CN']}`,
      );
      setPrompt('');
      reloadJobs();
      onProjectChange();
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setBusy(false);
    }
  }

  /** 取消 / 重试走 comic 域端点；start/complete/fail 骨架端点已由 ai-orchestrator 接管，UI 不再暴露 */
  async function handleAction(job: GenerationJob, action: 'cancel' | 'retry') {
    if (action === 'cancel' && !window.confirm(locale === 'en-US' ? 'Cancel this job?' : '确认取消此任务？')) return;
    setError(null);
    setMessage(null);
    try {
      await api.comic.jobAction(job.id, action);
      reloadJobs();
      onProjectChange();
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  /** 立即运行：同步触发 ai-orchestrator 执行（POST /ai/jobs/:id/run）；成本超限 / provider 未配置等失败原因透传 */
  async function handleRun(job: GenerationJob) {
    setError(null);
    setMessage(null);
    try {
      const { run } = await api.ai.runJob(job.id);
      if (run.status === 'succeeded') {
        setMessage(locale === 'en-US' ? `Job succeeded via ${run.provider}` : `任务已成功（provider：${run.provider}）`);
      } else if (run.status === 'failed') {
        setError(`${run.error_code ?? 'FAILED'}${run.message ? ` — ${run.message}` : ''}`);
      } else {
        setMessage(run.message ?? (locale === 'en-US' ? 'Skipped' : '已跳过'));
      }
      reloadJobs();
      onProjectChange();
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  /** 下载成功产物：预签名 GET → 新窗口打开 */
  async function handleDownload(objectKey: string) {
    setError(null);
    try {
      const res = await api.media.presignDownload(objectKey);
      window.open(res.download.url, '_blank', 'noopener');
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  /** draft 工程快捷入口：写入一条示例分镜并确认，使工程进入 storyboarded 后才可派发任务 */
  async function handleQuickConfirm() {
    setBusy(true);
    setError(null);
    try {
      await api.comic.saveStoryboard(projectId, {
        shots: [
          {
            index: 1,
            description: locale === 'en-US' ? 'Opening shot: establish the scene.' : '开场镜头：交代故事场景。',
            dialogue: '',
          },
        ],
        confirm: true,
      });
      setMessage(locale === 'en-US' ? 'Storyboard confirmed ✓' : '分镜已确认 ✓');
      onProjectChange();
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <section className="sub-panel">
        <header className="panel-head">
          <h3>{locale === 'en-US' ? 'Dispatch Job' : '派发任务'}</h3>
        </header>

        {caps && (
          <p className="muted small">
            {locale === 'en-US' ? 'Provider: ' : '模型提供方：'}
            <code>{caps.provider}</code>
            {caps.mock_provider && (locale === 'en-US' ? ' (mock)' : '（mock）')}
            {' · '}
            {locale === 'en-US' ? 'types: ' : '支持类型：'}
            {caps.supported_job_types.join(' / ')}
            {' · '}
            {locale === 'en-US' ? 'storage: ' : '存储：'}
            {caps.storage.driver}
            {!caps.provider_configured && !caps.mock_provider && (
              <span className="error">{locale === 'en-US' ? ' · NOT CONFIGURED' : ' · 未配置'}</span>
            )}
          </p>
        )}

        {error && <p className="error">{error}</p>}
        {message && <p className="success">{message}</p>}

        {!canDispatch && (
          <div className="hint">
            <p>
              {locale === 'en-US'
                ? 'Jobs can be dispatched after the storyboard is confirmed (project status: storyboarded).'
                : '工程需先确认分镜（状态变为「分镜已确认」）后才能派发任务。'}
            </p>
            {projectStatus === 'draft' && (
              <button type="button" className="btn primary" onClick={handleQuickConfirm} disabled={busy}>
                {locale === 'en-US' ? 'Confirm sample storyboard' : '确认示例分镜'}
              </button>
            )}
          </div>
        )}

        <div className="form-inline">
          <select value={jobType} onChange={(e) => setJobType(e.target.value as JobType)} disabled={!canDispatch}>
            {(Object.keys(JOB_TYPE_LABEL) as JobType[]).map((t) => (
              <option key={t} value={t} disabled={!typeSupported(t)}>
                {JOB_TYPE_LABEL[t][locale]}
                {!typeSupported(t) ? (locale === 'en-US' ? ' (unsupported)' : '（不支持）') : ''}
              </option>
            ))}
          </select>
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={locale === 'en-US' ? 'Prompt (optional)…' : '提示词（可选）…'}
            disabled={!canDispatch}
          />
          <button type="button" className="btn primary" onClick={handleCreate} disabled={busy || !canDispatchType}>
            {busy ? (locale === 'en-US' ? 'Dispatching…' : '派发中…') : locale === 'en-US' ? 'Dispatch' : '派发'}
          </button>
        </div>
      </section>

      <section className="sub-panel">
        <header className="panel-head">
          <h3>{locale === 'en-US' ? 'Jobs' : '任务列表'}</h3>
          {hasActive && <span className="badge">{locale === 'en-US' ? 'Auto-refreshing' : '自动刷新中'}</span>}
        </header>

        {jobsState.loading && <p className="hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</p>}
        {jobsState.error != null && <p className="error">{errorText(locale, jobsState.error)}</p>}

        <ul className="list">
          {jobs.map((job) => (
            <li key={job.id} className="list-item">
              <div className="list-item-main">
                <strong>{JOB_TYPE_LABEL[job.job_type]?.[locale] ?? job.job_type}</strong>
                <span className="badge">{JOB_STATUS_LABEL[job.status]?.[locale] ?? job.status}</span>
              </div>
              <div className="list-item-sub">
                <span className="muted small">{new Date(job.created_at).toLocaleString()}</span>
                {job.error_code && <span className="error small">{job.error_code}</span>}
              </div>
              {typeof job.result?.object_key === 'string' && (
                <div className="muted small">
                  object_key: {job.result.object_key}
                  {' · '}
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => handleDownload(job.result!.object_key as string)}
                  >
                    {locale === 'en-US' ? 'Download' : '下载产物'}
                  </button>
                </div>
              )}
              {job.status === 'succeeded' && job.job_type === 'image' && typeof job.result?.object_key === 'string' && (
                <AssetThumb objectKey={job.result.object_key as string} />
              )}
              <div className="form-inline">
                {job.status === 'queued' && (
                  <>
                    <button type="button" className="btn primary small" onClick={() => handleRun(job)}>
                      {locale === 'en-US' ? 'Run now' : '立即运行'}
                    </button>
                    <button type="button" className="btn ghost danger small" onClick={() => handleAction(job, 'cancel')}>
                      {locale === 'en-US' ? 'Cancel' : '取消'}
                    </button>
                  </>
                )}
                {job.status === 'running' && (
                  <button type="button" className="btn ghost danger small" onClick={() => handleAction(job, 'cancel')}>
                    {locale === 'en-US' ? 'Cancel' : '取消'}
                  </button>
                )}
                {job.status === 'failed' && (
                  <button type="button" className="btn ghost small" onClick={() => handleAction(job, 'retry')}>
                    {locale === 'en-US' ? 'Retry' : '重试'}
                  </button>
                )}
              </div>
            </li>
          ))}
          {!jobsState.loading && jobs.length === 0 && (
            <li className="hint">{locale === 'en-US' ? 'No jobs yet.' : '尚无任务。'}</li>
          )}
        </ul>
      </section>
    </div>
  );
}

// ---------- 成片标签页：列表 / 创建 / 发布流 ----------

function FilmsTab({
  locale,
  projectId,
  projectStatus,
  onProjectChange,
}: {
  locale: Locale;
  projectId: string;
  projectStatus: ComicProject['status'];
  onProjectChange: () => void;
}) {
  const filmsState = useAsync(() => api.comic.listFilms(projectId), [projectId]);
  const jobsState = useAsync(() => api.comic.listJobs(projectId), [projectId]);
  const films: Film[] = filmsState.data?.items ?? [];

  // 成功的 compose 任务产物可作为成片版本的 object_key
  const composeObjects = (jobsState.data?.items ?? [])
    .filter((j) => j.job_type === 'compose' && j.status === 'succeeded')
    .map((j) => ({
      jobId: j.id,
      objectKey: typeof j.result?.object_key === 'string' ? j.result.object_key : '',
      createdAt: j.created_at,
    }))
    .filter((o) => o.objectKey);

  const canCreate = projectStatus === 'rendered' || projectStatus === 'published';

  // 工程产物面板（media 域：GET /media/assets?project_id=，每项已附 download_url）
  const assetsState = useAsync(() => api.media.listAssets(projectId), [projectId]);
  const assets = assetsState.data?.items ?? [];

  const [expandedFilmId, setExpandedFilmId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [objectKey, setObjectKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleCreate() {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.comic.createFilm(projectId, {
        title: title.trim(),
        object_key: objectKey || undefined,
      });
      setMessage(locale === 'en-US' ? `Film created: ${result.film.title}` : `成片已创建：${result.film.title}`);
      setTitle('');
      setObjectKey('');
      filmsState.reload();
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setBusy(false);
    }
  }

  async function handleAction(film: Film, action: 'submit-review' | 'publish' | 'archive') {
    if (action === 'archive' && !window.confirm(locale === 'en-US' ? 'Archive this film?' : '确认归档此成片？')) return;
    setError(null);
    setMessage(null);
    try {
      await api.comic.publishFilm(film.id, action);
      filmsState.reload();
      onProjectChange();
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  async function handleReject(film: Film) {
    const reason = window.prompt(locale === 'en-US' ? 'Reject reason:' : '驳回原因：');
    if (!reason?.trim()) return;
    setError(null);
    try {
      await api.comic.rejectFilm(film.id, reason.trim());
      filmsState.reload();
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  return (
    <div>
      <section className="sub-panel">
        <header className="panel-head">
          <h3>{locale === 'en-US' ? 'Create Film' : '创建成片'}</h3>
        </header>

        {error && <p className="error">{error}</p>}
        {message && <p className="success">{message}</p>}

        {!canCreate && (
          <p className="hint">
            {locale === 'en-US'
              ? 'Films can be created after a compose job succeeds (project status: rendered).'
              : '需合成任务成功（工程状态变为「已渲染」）后才能创建成片。'}
          </p>
        )}

        <div className="form-inline">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={locale === 'en-US' ? 'Film title…' : '成片标题…'}
            disabled={!canCreate}
          />
          <select value={objectKey} onChange={(e) => setObjectKey(e.target.value)} disabled={!canCreate}>
            <option value="">{locale === 'en-US' ? 'No object key' : '不关联产物'}</option>
            {composeObjects.map((o) => (
              <option key={o.jobId} value={o.objectKey}>
                {o.objectKey}（{new Date(o.createdAt).toLocaleString()}）
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn primary"
            onClick={handleCreate}
            disabled={busy || !canCreate || !title.trim()}
          >
            {busy ? (locale === 'en-US' ? 'Creating…' : '创建中…') : locale === 'en-US' ? 'Create' : '创建'}
          </button>
        </div>
      </section>

      <section className="sub-panel">
        <header className="panel-head">
          <h3>{locale === 'en-US' ? 'Films' : '成片列表'}</h3>
        </header>

        {filmsState.loading && <p className="hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</p>}
        {filmsState.error != null && <p className="error">{errorText(locale, filmsState.error)}</p>}

        <ul className="list">
          {films.map((film) => (
            <li key={film.id} className="list-item">
              <div className="list-item-main">
                <strong>{film.title}</strong>
                <span className="badge">{FILM_STATUS_LABEL[film.status]?.[locale] ?? film.status}</span>
              </div>
              <div className="list-item-sub">
                <span className="muted small">{new Date(film.updated_at).toLocaleString()}</span>
              </div>
              {film.review_note && (
                <div className="muted small">
                  {locale === 'en-US' ? 'Review note: ' : '审核备注：'}
                  {film.review_note}
                </div>
              )}
              <div className="form-inline">
                {film.status === 'draft' && (
                  <button type="button" className="btn ghost small" onClick={() => handleAction(film, 'submit-review')}>
                    {locale === 'en-US' ? 'Submit Review' : '提交审核'}
                  </button>
                )}
                {film.status === 'reviewing' && (
                  <>
                    <button type="button" className="btn primary small" onClick={() => handleAction(film, 'publish')}>
                      {locale === 'en-US' ? 'Publish' : '发布'}
                    </button>
                    <button type="button" className="btn ghost danger small" onClick={() => handleReject(film)}>
                      {locale === 'en-US' ? 'Reject' : '驳回'}
                    </button>
                  </>
                )}
                {(film.status === 'draft' || film.status === 'published') && (
                  <button type="button" className="btn ghost danger small" onClick={() => handleAction(film, 'archive')}>
                    {locale === 'en-US' ? 'Archive' : '归档'}
                  </button>
                )}
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => setExpandedFilmId(expandedFilmId === film.id ? null : film.id)}
                >
                  {locale === 'en-US' ? 'Versions' : '版本'}
                </button>
              </div>
              {expandedFilmId === film.id && <FilmVersionsPanel filmId={film.id} locale={locale} />}
            </li>
          ))}
          {!filmsState.loading && films.length === 0 && (
            <li className="hint">{locale === 'en-US' ? 'No films yet.' : '尚无成片。'}</li>
          )}
        </ul>
      </section>

      <section className="sub-panel">
        <header className="panel-head">
          <h3>{locale === 'en-US' ? 'Project Assets' : '工程产物'}</h3>
        </header>

        {assetsState.loading && <p className="hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</p>}
        {assetsState.error != null && <p className="error">{errorText(locale, assetsState.error)}</p>}

        <ul className="list">
          {assets.map((a) => (
            <li key={a.id} className="list-item">
              <div className="list-item-main">
                <strong>{a.asset_type}</strong>
                <span className="badge">{a.mime}</span>
              </div>
              <div className="list-item-sub">
                <span className="muted small">
                  {a.size_bytes != null ? `${(a.size_bytes / 1024).toFixed(1)} KB · ` : ''}
                  {new Date(a.created_at).toLocaleString()}
                  {a.expires_at ? ` · ${locale === 'en-US' ? 'expires' : '过期'} ${new Date(a.expires_at).toLocaleDateString()}` : ''}
                </span>
                <a className="btn ghost small" href={a.download_url} target="_blank" rel="noreferrer">
                  {locale === 'en-US' ? 'Download' : '下载'}
                </a>
              </div>
              {a.asset_type === 'image' && (
                <div style={{ marginTop: 4 }}>
                  <img
                    src={a.download_url}
                    alt={a.object_key}
                    style={{ maxWidth: 180, maxHeight: 180, borderRadius: 8 }}
                  />
                </div>
              )}
            </li>
          ))}
          {!assetsState.loading && assets.length === 0 && (
            <li className="hint">{locale === 'en-US' ? 'No assets yet.' : '尚无产物。'}</li>
          )}
        </ul>
      </section>
    </div>
  );
}

/** 成功 image 任务的内联预览：按需预签名 GET（URL 有 TTL，组件随任务行挂载时拉取一次） */
function AssetThumb({ objectKey }: { objectKey: string }) {
  const state = useAsync(() => api.media.presignDownload(objectKey), [objectKey]);
  if (!state.data) return null;
  return (
    <div style={{ marginTop: 4 }}>
      <img
        src={state.data.download.url}
        alt={objectKey}
        style={{ maxWidth: 180, maxHeight: 180, borderRadius: 8 }}
      />
    </div>
  );
}

/** 成片版本列表面板：展开时按 filmId 拉取（GET /comic/films/:id → versions），版本产物经预签名下载/播放 */
function FilmVersionsPanel({ filmId, locale }: { filmId: string; locale: Locale }) {
  const state = useAsync(() => api.comic.getFilm(filmId), [filmId]);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload(objectKey: string) {
    setError(null);
    try {
      const res = await api.media.presignDownload(objectKey);
      window.open(res.download.url, '_blank', 'noopener');
    } catch (err) {
      setError(errorText(locale, err));
    }
  }

  if (state.loading && !state.data) {
    return <p className="hint">{locale === 'en-US' ? 'Loading versions…' : '版本加载中…'}</p>;
  }
  if (state.error != null && !state.data) {
    return <p className="error">{errorText(locale, state.error)}</p>;
  }

  const versions = state.data?.versions ?? [];
  return (
    <div style={{ marginTop: 6 }}>
      {error && <p className="error">{error}</p>}
      <ul className="list">
        {versions.map((v) => (
          <li key={v.id} className="list-item">
            <div className="list-item-main">
              <strong>v{v.version_no}</strong>
              <span className="badge">
                {v.published_at ? (locale === 'en-US' ? 'published' : '已发布') : locale === 'en-US' ? 'unpublished' : '未发布'}
              </span>
            </div>
            <div className="list-item-sub">
              <span className="muted small">
                {new Date(v.created_at).toLocaleString()}
                {v.size_bytes != null ? ` · ${(v.size_bytes / 1024).toFixed(1)} KB` : ''}
                {v.duration_sec != null ? ` · ${v.duration_sec}s` : ''}
              </span>
              {v.object_key && (
                <button type="button" className="btn ghost small" onClick={() => handleDownload(v.object_key!)}>
                  {locale === 'en-US' ? 'Download / Play' : '下载 / 播放'}
                </button>
              )}
            </div>
          </li>
        ))}
        {versions.length === 0 && (
          <li className="hint">{locale === 'en-US' ? 'No versions.' : '暂无版本。'}</li>
        )}
      </ul>
    </div>
  );
}
