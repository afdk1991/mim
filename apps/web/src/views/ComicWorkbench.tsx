// 引入 React 两个基础 Hook：useEffect 承载副作用（任务轮询、切换工程重置标签），useState 保存交互状态。
import { useEffect, useState } from 'react';
// 引入语言标识类型，让组件内所有文案按 zh-CN / en-US 二选一渲染。
import type { Locale } from '@mim/i18n';
// 从统一 API 模块引入接口聚合对象与领域类型，避免组件内重复声明数据结构。
import {
  // api：后端接口聚合对象，含 comic（漫剧域）/ ai（编排域）/ media（存储域）三组能力。
  api,
  // errorText：把接口或网络异常按当前语言转换成可读的错误文案。
  errorText,
  // ComicProject：漫剧工程实体，其 status 决定各标签页的可操作性。
  type ComicProject,
  // Film：成片实体，成片列表与发布/归档操作使用。
  type Film,
  // ApiError：导出转码降级需要按业务码判断，不能依赖服务端英文原文。
  ApiError,
  // resolvePublicUrl：把预签名相对地址在跨源托管构建下补成可达地址。
  resolvePublicUrl,
  // FilmExportFormat / FilmExportResolution / FilmExportResult：导出面板的选项与结果类型。
  type FilmExportFormat,
  type FilmExportResolution,
  type FilmExportResult,
  // GenerationJob：生成任务实体，status 决定按钮显隐与是否开启轮询。
  type GenerationJob,
  // JobType：任务类型枚举（文本/图像/视频/配音/合成），决定派发时的参数走向。
  type JobType,
  // SuggestKind：AI 建议的种类（分镜表/剧本/对白/配音），用于建议接口入参。
  type SuggestKind,
  // 结束 API 模块的具名导入列表。
} from '../api';
// 引入通用异步 Hook：统一暴露 data / loading / error 与手动 reload 能力。
import { useAsync } from '../hooks';

// 组件外部入参：只需当前语言，其余业务数据由组件内部自行拉取。
interface Props {
  // locale：界面语言，控制标题、按钮与提示文案的双语分支。
  locale: Locale;
  // 结束 Props 接口声明。
}

// 工程状态 → 中英文显示名；键用 string 兜底后端未来新增的未知状态值。
const STATUS_LABEL: Record<string, Record<Locale, string>> = {
  // 草稿：刚创建、分镜未确认，此时不允许派发任务。
  draft: { 'zh-CN': '草稿', 'en-US': 'Draft' },
  // 分镜已确认：工作台据此放行生成任务的派发。
  storyboarded: { 'zh-CN': '分镜已确认', 'en-US': 'Storyboarded' },
  // 生成中：存在排队/运行中任务，界面会开启周期刷新。
  generating: { 'zh-CN': '生成中', 'en-US': 'Generating' },
  // 已渲染：合成任务成功，达到创建成片的状态门槛。
  rendered: { 'zh-CN': '已渲染', 'en-US': 'Rendered' },
  // 已发布：成片已对外发布，仍可继续归档。
  published: { 'zh-CN': '已发布', 'en-US': 'Published' },
  // 已归档：只读留存状态，不再参与创作流程。
  archived: { 'zh-CN': '已归档', 'en-US': 'Archived' },
// 结束工程状态映射表。
};

// 任务类型 → 中英文显示名，供派发下拉框与任务列表共用，保证术语一致。
const JOB_TYPE_LABEL: Record<JobType, Record<Locale, string>> = {
  // 文本：剧本、对白等纯文本产物。
  text: { 'zh-CN': '文本', 'en-US': 'Text' },
  // 图像：角色立绘、关键帧等图片产物。
  image: { 'zh-CN': '图像', 'en-US': 'Image' },
  // 视频：单个分镜对应的视频片段产物。
  video: { 'zh-CN': '视频', 'en-US': 'Video' },
  // 配音：TTS 语音产物，用于角色台词。
  tts: { 'zh-CN': '配音', 'en-US': 'TTS' },
  // 合成：把片段拼接为成片的关键任务，成功后工程进入「已渲染」。
  compose: { 'zh-CN': '合成', 'en-US': 'Compose' },
// 结束任务类型映射表。
};

// 任务状态 → 中英文显示名；后端状态集合可能扩展，故用宽松字符串键。
const JOB_STATUS_LABEL: Record<string, Record<Locale, string>> = {
  // 排队中：等待 AI 编排器取走执行。
  queued: { 'zh-CN': '排队中', 'en-US': 'Queued' },
  // 运行中：已被执行，界面提供取消入口。
  running: { 'zh-CN': '运行中', 'en-US': 'Running' },
  // 已成功：产物 object_key 可下载，也可作为成片版本的来源。
  succeeded: { 'zh-CN': '已成功', 'en-US': 'Succeeded' },
  // 已失败：展示 error_code 并提供重试按钮。
  failed: { 'zh-CN': '已失败', 'en-US': 'Failed' },
  // 已取消：用户主动终止，不再自动重试。
  canceled: { 'zh-CN': '已取消', 'en-US': 'Canceled' },
// 结束任务状态映射表。
};

// 成片状态 → 中英文显示名，驱动发布流中按钮的组合。
const FILM_STATUS_LABEL: Record<string, Record<Locale, string>> = {
  // 草稿：可提交审核，也可直接归档。
  draft: { 'zh-CN': '草稿', 'en-US': 'Draft' },
  // 审核中：可发布或驳回，是两个互斥的终局动作。
  reviewing: { 'zh-CN': '审核中', 'en-US': 'Reviewing' },
  // 已发布：对外可见，仅保留归档操作。
  published: { 'zh-CN': '已发布', 'en-US': 'Published' },
  // 已归档：终态，列表内只读展示。
  archived: { 'zh-CN': '已归档', 'en-US': 'Archived' },
// 结束成片状态映射表。
};

// 漫剧工作台根组件：左栏工程列表 + 右栏选中工程的详情（创作/任务/成片三个标签页）。
export function ComicWorkbench({ locale }: Props) {
  // 拉取工程列表；依赖数组为空表示只在挂载时请求一次，之后靠 reload 手动刷新。
  const listState = useAsync(() => api.comic.listProjects(), []);
  // 用空数组兜底未加载完成的情况，避免下方 map 因 undefined 崩溃。
  const projects: ComicProject[] = listState.data?.items ?? [];
  // 当前选中的工程 id；为 null 时右栏展示引导文案而非详情。
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 新建工程标题的受控输入值。
  const [newTitle, setNewTitle] = useState('');
  // 新建请求进行中标记，用于禁用按钮防止重复提交。
  const [busy, setBusy] = useState(false);
  // 操作级错误文案，与「列表加载错误」分开显示，便于定位问题来源。
  const [error, setError] = useState<string | null>(null);
  // 操作成功提示文案，例如「已创建: xxx」。
  const [message, setMessage] = useState<string | null>(null);

  // 创建工程：校验标题 → 调接口 → 刷新列表并自动选中新工程。
  async function handleCreate() {
    // 标题为空或只有空格时直接返回，避免发出无效请求。
    if (!newTitle.trim()) return;
    // 进入加载态，禁用创建按钮。
    setBusy(true);
    // 清除上一轮错误，避免旧信息误导用户。
    setError(null);
    // 清除上一轮成功提示，保持提示与本次操作对应。
    setMessage(null);
    // 用 try/finally 保证异常时也能复位加载态。
    try {
      // 提交去掉首尾空格的标题，返回服务端创建的工程实体。
      const result = await api.comic.createProject({ title: newTitle.trim() });
      // 按语言给出创建成功提示，并回显服务端确认后的标题。
      setMessage(locale === 'en-US' ? `Created: ${result.project.title}` : `已创建: ${result.project.title}`);
      // 清空输入框，便于连续创建下一个工程。
      setNewTitle('');
      // 重新拉取列表，让新工程出现在左栏。
      listState.reload();
      // 自动选中新工程，右栏立即进入创作界面。
      setSelectedId(result.project.id);
    } catch (err) { // 捕获创建接口异常，转成当前语言的可读提示
      // 接口失败时把错误转换成当前语言的文案展示。
      setError(errorText(locale, err));
    } finally { // 无论成功或失败都复位创建中的加载态
      // 无论成功还是失败都退出加载态。
      setBusy(false);
    } // 结束创建工程的 try 块
  } // 结束 handleCreate 处理函数

  // 删除工程：先二次确认，成功后刷新列表并按需清空选中态。
  async function handleDelete(id: string) {
    // 用户取消确认时直接返回，避免误删。
    if (!window.confirm(locale === 'en-US' ? 'Delete this project?' : '确认删除此工程？')) return;
    // 用 try/catch 包住网络调用，失败时给出可读错误。
    try {
      // 调用删除接口，级联清理交给服务端负责。
      await api.comic.deleteProject(id);
      // 刷新列表，移除被删除的条目。
      listState.reload();
      // 若删除的正是当前选中工程，则清空选中，避免右栏展示已删除数据。
      if (selectedId === id) setSelectedId(null);
    } catch (err) { // 捕获删除接口异常并提示用户
      // 删除失败时展示错误文案。
      setError(errorText(locale, err));
    } // 结束删除工程的 try 块
  } // 结束 handleDelete 处理函数

  // 仅在首次加载（尚无数据）时占位；reload 期间保留已渲染的列表与详情，
  // 避免卸载 ProjectDetail 导致当前标签页被重置回「创作」。
  if (listState.loading && !listState.data) return <div className="hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</div>;
  // 首次加载即失败时整页展示错误，给出重试的明确信号。
  if (listState.error && !listState.data) return <div className="error">{errorText(locale, listState.error)}</div>;

  // 主界面：页头 + 左右分栏布局。
  return (
    // 页面根容器，承载统一的页面内边距与最大宽度样式。
    <div className="page">{/* 页面根容器：承载工作台全部内容 */}
      {/* 页头：工作台标题与一句话能力说明 */}
      <header className="page-head">{/* 页头区域：标题与副标题 */}
        {/* 主标题：漫剧 AI 剧工作台 */}
        <h1>{/* 主标题：按语言渲染 */}{locale === 'en-US' ? 'Comic AI Studio' : '漫剧 AI 剧工作台'}</h1>
        {/* 副标题：强调从剧本到成片的一站式能力 */}
        <p className="muted">{/* 副标题容器：双语说明能力范围 */}
          {/* 按语言分支输出副标题文案 */}
          {locale === 'en-US'
            // 英文副标题
            ? 'AI-assisted creation — script, storyboard, characters, and film generation'
            // 中文副标题
            : 'AI 辅助创作：剧本、分镜、角色、成片一站式'}
        </p>{/* 副标题结束 */}
      </header>{/* 页头结束 */}

      {/* 创建/删除等操作的错误提示 */}
      {error && <p className="error">{error}</p>}{/* 操作级错误：仅在有错误时渲染 */}
      {/* 列表后台刷新失败的提示：数据仍在时以横幅形式展示而非整页报错 */}
      {listState.error != null && <p className="error">{errorText(locale, listState.error)}</p>}{/* 刷新失败横幅：保留旧数据 */}
      {/* 操作成功提示，例如工程创建完成 */}
      {message && <p className="success">{message}</p>}{/* 操作成功提示：成功后短暂展示 */}

      {/* 左右分栏：左侧工程列表占 4 栅格，右侧详情占 8 栅格 */}
      <div className="split">{/* 分栏容器：4/8 栅格布局 */}
        {/* 左栏：工程列表 */}
        <section className="panel col-4">{/* 左栏面板：工程列表与新建入口 */}
          {/* 左栏标题栏 */}
          <header className="panel-head">{/* 标题栏：列表名称 */}
            {/* 列表标题「我的工程」 */}
            <h2>{/* 区块标题：我的工程 */}{locale === 'en-US' ? 'Projects' : '我的工程'}</h2>
          </header>{/* 标题栏结束 */}
          {/* 新建工程表单行：输入标题 + 创建按钮 */}
          <div className="form-inline">{/* 表单行：标题输入与创建按钮 */}
            <input /* 新建工程标题输入框：受控组件 */
              value={/* 受控值：新建工程标题 */ newTitle}
              onChange={/* 同步标题到本地状态，供创建按钮判断可用性 */ (e) => setNewTitle(e.target.value)}
              placeholder={/* 占位文案：提示输入工程标题 */ locale === 'en-US' ? 'New project title…' : '新工程标题…'}
              disabled={/* 请求进行中禁用，避免并发创建 */ busy}
            />{/* 新建工程标题输入框结束 */}
            {/* 创建按钮：标题为空或请求进行中时禁用，避免无效提交 */}
            <button type="button" className="btn primary" onClick={handleCreate} disabled={busy || !newTitle.trim()}>{/* 创建按钮：提交新建请求 */}
              {/* 按钮文案：加号 + 新建 */}
              + {locale === 'en-US' ? 'Create' : '新建'}
            </button>{/* 创建按钮结束 */}
          </div>{/* 新建表单行结束 */}

          {/* 工程卡片列表：点击整行切换右栏详情 */}
          <ul className="list">{/* 工程列表容器 */}
            {/* 逐个工程渲染一行，键用工程 id 保证 React 复用正确 */}
            {projects.map((p) => ( /* 遍历工程，逐行渲染卡片 */
              // 单个工程条目
              <li
                key={p.id}
                className={`list-item${selectedId === p.id ? ' active' : ''}`}
                onClick={() => setSelectedId(p.id)}
              >{/* 工程条目：点击切换选中 */}
                {/* 主信息区：标题 + 状态徽标 */}
                <div className="list-item-main">{/* 主信息区：标题与状态 */}
                  {/* 工程标题 */}
                  <strong>{/* 工程标题 */}{p.title}</strong>
                  {/* 状态徽标：查表失败时直接回显后端原始状态值 */}
                  <span className="badge">{/* 状态徽标：本地化或原始值 */}{STATUS_LABEL[p.status]?.[locale] ?? p.status}</span>
                </div>{/* 主信息区结束 */}
                {/* 次信息区：更新时间 + 删除按钮 */}
                <div className="list-item-sub">{/* 次信息区：更新时间与删除 */}
                  {/* 最近更新时间，按本地时区格式化 */}
                  <span className="muted small">{/* 更新时间：本地化字符串 */}{new Date(p.updated_at).toLocaleString()}</span>
                  <button
                    type="button"
                    className="btn ghost danger small"
                    onClick={/* 内联删除处理：先阻止冒泡再删除 */ (e) => {
                      // 阻止冒泡，避免点删除时同时触发整行的选中事件。
                      e.stopPropagation();
                      // 执行删除，内部会二次确认。
                      handleDelete(p.id);
                    }}
                  >{/* 删除按钮：小号危险样式 */}
                    {/* 删除图标：用乘号表示移除 */}
                    ×
                  </button>{/* 删除按钮结束 */}
                </div>{/* 次信息区结束 */}
              </li> // 工程条目渲染结束
            // 关闭 map 回调与 JSX 表达式容器。
            ))}
            {/* 空列表引导：提示用户先创建工程 */}
            {projects.length === 0 && (
              // 空态提示行
              <li className="hint">{/* 空态提示：引导先创建工程 */}{locale === 'en-US' ? 'No projects yet. Create one above.' : '尚无工程，在上方创建。'}</li>
            // 关闭空态条件渲染。
            )}
          </ul>{/* 工程列表结束 */}
        </section>{/* 左栏面板结束 */}

        {/* 右栏：选中工程详情 */}
        <section className="panel col-8">{/* 右栏面板：选中工程详情 */}
          {/* 有选中工程时渲染详情，否则给出选择引导 */}
          {selectedId ? (
            // 详情组件：状态变更后同时刷新左侧列表的标题/状态
            <ProjectDetail locale={locale} projectId={selectedId} onChange={() => listState.reload()} />
          ) : (
            // 未选中任何工程时的引导文案
            <div className="hint">{/* 引导文案：提示选择工程 */}{locale === 'en-US' ? 'Select a project to start creating.' : '选择左侧工程开始创作。'}</div>
          // 关闭选中态三目表达式。
          )}
        </section>{/* 右栏结束 */}
      </div>{/* 分栏容器结束 */}
    </div>
  );
} // 结束 ComicWorkbench 组件函数

// ---------- 工程详情（创作 / 生成任务 / 成片 三个标签页） ----------

// 详情页标签枚举：创作、生成任务、成片，三者共用同一工程上下文。
type DetailTab = 'create' | 'jobs' | 'films';

// 工程详情面板：负责加载工程聚合数据（工程/角色/最新分镜）并分发到三个标签页。
function ProjectDetail({ locale, projectId, onChange }: { locale: Locale; projectId: string; onChange: () => void }) {
  // 按工程 id 拉取详情；id 变化时 Hook 会重新请求，切工程即换数据。
  const detailState = useAsync(() => api.comic.getProject(projectId), [projectId]);
  // 当前激活的标签页，默认停在创作页。
  const [tab, setTab] = useState<DetailTab>('create');

  // 切换工程时回到创作标签页
  useEffect(() => {
    // 重置标签，避免沿用上一个工程的浏览位置造成误解。
    setTab('create');
  }, [projectId]); // 工程 id 变化时重新拉取详情，保证右栏数据跟随选中项

  // reload 期间保留已渲染内容，避免 JobsTab/FilmsTab 被卸载后丢失输入与轮询状态。
  if (!detailState.data) {
    // 首次加载中：展示占位文案。
    if (detailState.loading) return <div className="hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</div>;
    // 加载失败且无缓存数据：展示错误文案。
    return <div className="error">{errorText(locale, detailState.error)}</div>;
  }

  // 解构详情聚合结果：工程本体、角色列表、最新分镜（可能为空）。
  const { project, characters, latest_storyboard } = detailState.data;
  // 组合刷新：既刷新详情本身，也通知父级刷新左侧列表。
  const reloadAll = () => {
    // 重新请求当前工程详情。
    detailState.reload();
    // 通知父组件重载工程列表，保持标题与状态同步。
    onChange();
  }; // 结束 reload 闭包定义，供子组件在数据变更后回调刷新

  // 标签页 → 双语显示名映射。
  const TAB_LABEL: Record<DetailTab, Record<Locale, string>> = {
    // 创作页：角色设定与 AI 建议。
    create: { 'zh-CN': '创作', 'en-US': 'Create' },
    // 生成任务页：派发与查看任务状态机。
    jobs: { 'zh-CN': '生成任务', 'en-US': 'Jobs' },
    // 成片页：成片创建、发布流与产物管理。
    films: { 'zh-CN': '成片', 'en-US': 'Films' },
  // 结束标签文案表。
  };

  // 详情区域渲染：标题栏 + 标签切换 + 当前标签内容。
  return (
    // 详情根容器
    <div>{/* 详情根容器：标题、标签与内容 */}
      {/* 详情标题栏：工程标题与状态徽标 */}
      <header className="panel-head">{/* 详情标题栏 */}
        {/* 工程标题 */}
        <h2>{/* 当前工程标题 */}{project.title}</h2>
        {/* 状态徽标：未知状态回显原始值 */}
        <span className="badge">{/* 工程状态徽标 */}{STATUS_LABEL[project.status]?.[locale] ?? project.status}</span>
      </header>{/* 详情标题栏结束 */}
      {/* 工程简介：为空时给出占位文案 */}
      <p className="muted">{/* 工程简介：缺失时占位 */}{project.synopsis ?? (locale === 'en-US' ? 'No synopsis' : '暂无简介')}</p>
      {/* 详情刷新失败的横幅提示：已有数据时不清空界面 */}
      {detailState.error != null && <p className="error">{errorText(locale, detailState.error)}</p>}{/* 刷新失败横幅 */}

      {/* 标签切换栏：role=tablist 便于无障碍工具识别为一组标签 */}
      <div className="form-inline" role="tablist">{/* 标签栏：无障碍语义为一组 tab */}
        {/* 遍历三个标签常量，按键渲染按钮 */}
        {(['create', 'jobs', 'films'] as const).map((t) => ( /* 遍历标签常量生成按钮 */
          // 单个标签按钮
          <button
            key={t}
            type="button"
            className={`btn ${tab === t ? 'primary' : 'ghost'}`}
            onClick={() => setTab(t)}
          >{/* 标签按钮：激活态高亮 */}
            {/* 当前语言下的标签名称 */}
            {TAB_LABEL[t][locale]}
          </button>
        ))}{/* 结束标签页按钮的遍历渲染 */}
      </div>{/* 标签栏结束 */}

      {/* 创作页：只在激活时挂载，避免无关请求 */}
      {tab === 'create' && ( /* 仅激活时挂载创作页 */
        // 创作标签页组件
        <CreateTab
          locale={locale}
          projectId={projectId}
          characters={characters}
          onChanged={() => detailState.reload()}
        />
      )}
      {/* 生成任务页：需要最新分镜 id 与工程状态参与判断 */}
      {tab === 'jobs' && ( /* 仅激活时挂载任务页 */
        // 任务标签页组件
        <JobsTab
          locale={locale}
          projectId={projectId}
          projectStatus={project.status}
          storyboardId={latest_storyboard?.id ?? null}
          onProjectChange={reloadAll}
          onProjectRefresh={detailState.reload}
        />
      )}
      {/* 成片页：仅在工程已渲染/已发布时可创建 */}
      {tab === 'films' && ( /* 仅激活时挂载成片页 */
        // 成片标签页组件
        <FilmsTab locale={locale} projectId={projectId} projectStatus={project.status} onProjectChange={reloadAll} />
      )}
    </div>
  );
} // 结束 ProjectDetail 组件函数

// ---------- 创作标签页：角色设定 + AI 建议 ----------

// 创作页：录入角色外观设定，并按需向 AI 请求分镜/剧本/对白/配音建议。
function CreateTab({
  // 界面语言。
  locale,
  // 当前工程 id，角色与建议接口均以其定位。
  projectId,
  // 已有角色列表，由父级详情数据传入。
  characters,
  // 新增角色成功后的回调，用于刷新父级详情。
  onChanged,
}: { // 子组件入参类型声明开始
  // 语言类型声明。
  locale: Locale;
  // 工程 id 类型声明。
  projectId: string;
  // 角色列表结构：id + 名称 + 外观提示词，与后端字段保持一致。
  characters: Array<{ id: string; name: string; appearance_prompt: string }>;
  // 变更回调类型。
  onChanged: () => void;
}) { // 入参类型声明结束，进入 ProjectDetail 函数体
  // AI 建议种类，默认请求分镜表。
  const [suggestKind, setSuggestKind] = useState<SuggestKind>('storyboard');
  // 建议请求的可选提示词，可为空。
  const [suggestPrompt, setSuggestPrompt] = useState('');
  // 建议请求进行中标记，用于禁用生成按钮。
  const [suggestBusy, setSuggestBusy] = useState(false);
  // 建议结果（已格式化 JSON 字符串），为空表示尚未生成。
  const [suggestResult, setSuggestResult] = useState<string | null>(null);
  // 建议请求的错误文案。
  const [suggestError, setSuggestError] = useState<string | null>(null);

  // 新角色名称的受控输入值。
  const [charNameVal, setCharNameVal] = useState('');
  // 新角色外观提示词的受控输入值。
  const [charPromptVal, setCharPromptVal] = useState('');
  // 添加角色请求进行中标记。
  const [charBusy, setCharBusy] = useState(false);
  // 添加角色的错误文案。
  const [charError, setCharError] = useState<string | null>(null);
  // 添加角色的成功提示文案。
  const [charMsg, setCharMsg] = useState<string | null>(null);

  // 请求 AI 建议：把结果序列化后直接展示，便于用户复制到后续流程。
  async function handleSuggest() {
    // 进入加载态，禁用生成按钮。
    setSuggestBusy(true);
    // 清理上一次的错误。
    setSuggestError(null);
    // 清理上一次的结果，避免新旧内容混淆。
    setSuggestResult(null);
    // try/finally 保证加载态一定复位。
    try {
      // 调用建议接口，传入工程、建议种类与可选提示词。
      const result = await api.comic.suggest(projectId, suggestKind, suggestPrompt);
      // 以两空格缩进格式化 JSON，提升可读性。
      setSuggestResult(JSON.stringify(result.suggestion, null, 2));
    } catch (err) { // 捕获新增角色接口异常
      // 失败时展示按语言转换后的错误文案。
      setSuggestError(errorText(locale, err));
    } finally { // 无论成功或失败都复位角色提交的加载态
      // 退出加载态。
      setSuggestBusy(false);
    } // 结束新增角色的 try 块
  } // 结束 handleAddCharacter 处理函数

  // 添加角色：名称与外观描述都必填，成功后清空输入并刷新详情。
  async function handleAddCharacter() {
    // 任一字段为空（含纯空格）时直接返回，避免提交无效数据。
    if (!charNameVal.trim() || !charPromptVal.trim()) return;
    // 进入加载态，禁用添加按钮。
    setCharBusy(true);
    // 清理旧的错误提示。
    setCharError(null);
    // 清理旧的成功提示。
    setCharMsg(null);
    // try/finally 保证加载态复位。
    try {
      // 提交角色名称与外观提示词，后端用于后续图像生成的一致性。
      await api.comic.addCharacter(projectId, {
        name: charNameVal.trim(),
        appearance_prompt: charPromptVal.trim(),
      });
      // 清空名称输入，便于连续添加多个角色。
      setCharNameVal('');
      // 清空外观描述输入。
      setCharPromptVal('');
      // 展示成功提示，按语言分支。
      setCharMsg(locale === 'en-US' ? 'Character added ✓' : '角色已添加 ✓');
      // 通知父级刷新详情，使新角色出现在下方列表。
      onChanged();
    } catch (err) { // 捕获 AI 建议请求异常
      // 失败时展示错误文案。
      setCharError(errorText(locale, err));
    } finally { // 无论成功或失败都复位生成建议的加载态
      // 退出加载态。
      setCharBusy(false);
    } // 结束生成建议的 try 块
  } // 结束 handleSuggest 处理函数

  // 创作页渲染：角色区块 + AI 建议区块。
  return (
    // 创作页根容器
    <div>{/* 创作页根容器：角色与建议两块 */}
      {/* 角色 */}
      <section className="sub-panel">{/* 角色区块：表单与列表 */}
        {/* 角色区块标题栏 */}
        <header className="panel-head">{/* 角色区块标题栏 */}
          {/* 区块标题「角色设定」 */}
          <h3>{/* 区块标题：角色设定 */}{locale === 'en-US' ? 'Characters' : '角色设定'}</h3>
        </header>{/* 角色标题栏结束 */}

        {/* 添加角色的错误提示 */}
        {charError && <p className="error">{charError}</p>}{/* 添加角色错误提示 */}
        {/* 添加角色的成功提示 */}
        {charMsg && <p className="success">{charMsg}</p>}{/* 添加角色成功提示 */}

        {/* 两列表单：名称 + 外观描述 */}
        <div className="form-grid">{/* 两列表单容器 */}
          {/* 名称表单项：label 包裹使点击文案也能聚焦输入框 */}
          <label>{/* 名称表单项 */}
            {/* 字段标签 */}
            <span>{/* 字段标签：名称 */}{locale === 'en-US' ? 'Name' : '名称'}</span>
            {/* 角色名称输入框 */}
            <input value={charNameVal} onChange={(e) => setCharNameVal(e.target.value)} placeholder="主角 A" />{/* 角色名输入框 */}
          </label>
          {/* 外观描述表单项：该提示词会参与图像生成 */}
          <label>{/* 外观描述表单项 */}
            {/* 字段标签 */}
            <span>{/* 字段标签：外观描述 */}{locale === 'en-US' ? 'Appearance Prompt' : '外观描述'}</span>
            <input /* 外观提示词输入框：参与图像生成一致性 */
              value={/* 受控值：外观描述 */ charPromptVal}
              onChange={/* 同步外观描述到本地状态 */ (e) => setCharPromptVal(e.target.value)}
              placeholder={/* 占位示例：提示写法 */ locale === 'en-US' ? 'young man, black hair…' : '青年男性，黑发…'}
            />
          </label>
        </div>
        {/* 添加按钮：两字段都有值时才可用 */}
        <button
          type="button"
          className="btn primary"
          disabled={charBusy || !charNameVal.trim() || !charPromptVal.trim()}
          onClick={handleAddCharacter}
        >{/* 添加角色按钮：必填项齐全才可用 */}
          {/* 按钮文案随请求状态切换为「添加中…」 */}
          {charBusy ? (locale === 'en-US' ? 'Adding…' : '添加中…') : locale === 'en-US' ? 'Add Character' : '添加角色'}
        </button>

        {/* 已有角色列表：无角色时不渲染该区块 */}
        {characters.length > 0 && ( /* 有角色时才渲染列表 */
          // 角色列表容器
          <ul className="list">{/* 角色列表容器 */}
            {/* 逐个角色渲染一行，键用角色 id */}
            {characters.map((c) => ( /* 遍历角色渲染条目 */
              // 单个角色条目
              <li key={c.id} className="list-item">{/* 角色条目 */}
                {/* 主信息区：角色名 + 外观提示词 */}
                <div className="list-item-main">{/* 主信息区：名称与提示词 */}
                  {/* 角色名称 */}
                  <strong>{/* 角色名称 */}{c.name}</strong>
                  {/* 外观提示词：灰字小号展示，便于核对生成一致性 */}
                  <span className="muted small">{/* 外观提示词 */}{c.appearance_prompt}</span>
                </div>{/* 主信息区结束 */}
              </li> // 角色条目渲染结束
            ))}{/* 结束角色列表的遍历渲染 */}
          </ul>
        )}
      </section>{/* 角色区块结束 */}

      {/* AI 建议 */}
      <section className="sub-panel">{/* AI 建议区块：表单与结果 */}
        {/* AI 建议区块标题栏 */}
        <header className="panel-head">{/* 建议区块标题栏 */}
          {/* 区块标题「AI 建议」 */}
          <h3>{/* 区块标题：AI 建议 */}{locale === 'en-US' ? 'AI Suggestions' : 'AI 建议'}</h3>
        </header>{/* 建议标题栏结束 */}

        {/* 建议请求表单行：种类 + 提示词 + 生成按钮 */}
        <div className="form-inline">{/* 建议表单行 */}
          {/* 建议种类下拉：切换后决定后端返回的产物结构 */}
          <select value={suggestKind} onChange={(e) => setSuggestKind(e.target.value as SuggestKind)}>{/* 建议种类下拉 */}
            {/* 分镜表：按镜头顺序给出画面与台词结构 */}
            <option value="storyboard">{/* 选项：分镜表 */}{locale === 'en-US' ? 'Storyboard' : '分镜表'}</option>
            {/* 剧本：完整剧情文本 */}
            <option value="script">{/* 选项：剧本 */}{locale === 'en-US' ? 'Script' : '剧本'}</option>
            {/* 对白：角色台词集合 */}
            <option value="dialogue">{/* 选项：对白 */}{locale === 'en-US' ? 'Dialogue' : '对白'}</option>
            {/* 配音：TTS 语音方案建议 */}
            <option value="voice">{/* 选项：配音 */}{locale === 'en-US' ? 'Voice' : '配音'}</option>
          </select>
          <input /* 建议提示词输入框：可选补充说明 */
            value={/* 受控值：建议提示词 */ suggestPrompt}
            onChange={/* 同步提示词到本地状态 */ (e) => setSuggestPrompt(e.target.value)}
            placeholder={/* 占位文案：提示可留空 */ locale === 'en-US' ? 'Optional prompt…' : '可选提示词…'}
          />
          {/* 生成按钮：请求进行中时禁用，文案切换为「生成中…」 */}
          <button type="button" className="btn primary" onClick={handleSuggest} disabled={suggestBusy}>{/* 生成建议按钮 */}
            {suggestBusy ? (locale === 'en-US' ? 'Generating…' : '生成中…') : locale === 'en-US' ? 'Generate' : '生成建议'}
          </button>
        </div>{/* 建议表单行结束 */}

        {/* 建议请求的错误提示 */}
        {suggestError && <p className="error">{suggestError}</p>}{/* 建议请求错误提示 */}
        {/* 建议结果：以代码块形式展示格式化后的 JSON */}
        {suggestResult && ( /* 有结果时才渲染代码块 */
          // 只读代码块容器
          <pre className="code-block">{/* 建议结果代码块 */}
            {/* 建议内容本体 */}
            <code>{/* JSON 文本本体 */}{suggestResult}</code>
          </pre>
        )}
      </section>{/* AI 建议区块结束 */}
    </div>
  );
} // 结束 CreateTab 组件函数

// ---------- 生成任务标签页：列表 / 创建 / 状态机操作 ----------

// 生成任务页：派发任务、查看任务状态，并支持立即运行/取消/重试与产物下载。
function JobsTab({
  // 界面语言。
  locale,
  // 当前工程 id。
  projectId,
  // 工程状态，决定是否允许派发任务。
  projectStatus,
  // 最新分镜 id，派发时作为关联字段（可为空）。
  storyboardId,
  // 变更回调：任务变化后同时刷新列表与详情。
  onProjectChange,
  // 仅刷新详情：轮询时使用，避免整列表重载打断输入。
  onProjectRefresh,
}: { // 任务面板入参类型声明开始
  // 语言类型声明。
  locale: Locale;
  // 工程 id 类型声明。
  projectId: string;
  // 工程状态复用工程实体的 status 字段类型，保证与后端枚举一致。
  projectStatus: ComicProject['status'];
  // 分镜 id 允许为空，表示尚未生成分镜。
  storyboardId: string | null;
  // 全局变更回调类型。
  onProjectChange: () => void;
  /** 仅重载工程详情（不重载左侧列表），用于轮询时同步工程状态 */
  onProjectRefresh: () => void;
}) { // 入参类型声明结束，进入 JobsTab 函数体
  // 拉取当前工程的生成任务列表；切换工程时自动重载。
  const jobsState = useAsync(() => api.comic.listJobs(projectId), [projectId]);
  // 空数组兜底，保证下方 some/map 安全调用。
  const jobs: GenerationJob[] = jobsState.data?.items ?? [];
  // 是否存在排队/运行中的任务：决定是否开启自动轮询。
  const hasActive = jobs.some((j) => j.status === 'queued' || j.status === 'running');
  // 取出 reload 并重命名，避免与详情刷新函数混淆。
  const { reload: reloadJobs } = jobsState;

  // 有排队/运行中任务时每 3 秒轮询一次：任务列表与工程详情同步刷新，
  // 使 compose 成功导致的 project → rendered 能及时反映到成片门槛上。
  useEffect(() => {
    // 没有活跃任务时不必轮询，直接退出副作用。
    if (!hasActive) return;
    // 定时器：每 3 秒拉取一次任务列表与工程详情。
    const timer = setInterval(() => {
      // 刷新任务列表，更新各任务状态。
      reloadJobs();
      // 刷新工程详情，使工程状态与成片门槛同步。
      onProjectRefresh();
    }, 3000); // 每 3 秒轮询一次，及时反映排队/运行中任务的最新状态
    // 清理函数：活跃状态结束或组件卸载时停止轮询，避免内存泄漏。
    return () => clearInterval(timer);
  }, [hasActive, reloadJobs, onProjectRefresh]); // 仅当存在活跃任务时开启轮询，避免无谓请求

  // 待派发的任务类型，默认文本。
  const [jobType, setJobType] = useState<JobType>('text');
  // 派发任务的提示词，可为空（部分任务类型不需要）。
  const [prompt, setPrompt] = useState('');
  // 派发请求进行中标记。
  const [busy, setBusy] = useState(false);
  // 任务操作（派发/运行/取消/重试/下载）的错误文案。
  const [error, setError] = useState<string | null>(null);
  // 任务操作的成功提示文案。
  const [message, setMessage] = useState<string | null>(null);

  // AI 编排能力：provider / 支持的任务类型 / 存储（capabilities 横幅 + provider 感知派发）
  const capsState = useAsync(() => api.ai.capabilities(), []);
  // 能力详情：为空表示尚未加载完成或接口不可用。
  const caps = capsState.data?.ai ?? null;
  // 后端声明的可支持任务类型；为 null 时表示不做类型限制。
  const supportedTypes = caps?.supported_job_types ?? null;
  // 判断某任务类型当前是否可派发：无限制则全部可派发。
  const typeSupported = (t: JobType) => !supportedTypes || supportedTypes.includes(t);

  // 派发门槛：工程需已完成分镜确认（或已在生成中）才允许建任务。
  const canDispatch = projectStatus === 'storyboarded' || projectStatus === 'generating';
  // 组合门槛：工程状态允许且所选类型被 provider 支持。
  const canDispatchType = canDispatch && typeSupported(jobType);

  // 派发任务：按所选类型与提示词创建任务，成功后刷新任务列表与工程状态。
  async function handleCreate() {
    // 进入加载态，禁用派发按钮。
    setBusy(true);
    // 清理上一轮错误。
    setError(null);
    // 清理上一轮提示。
    setMessage(null);
    // try/finally 保证加载态复位。
    try {
      // 创建任务：关联分镜（若有），仅在有提示词时附带 payload。
      const result = await api.comic.createJob(projectId, {
        job_type: jobType,
        storyboard_id: storyboardId ?? undefined,
        payload: prompt.trim() ? { prompt: prompt.trim() } : {},
      });
      // 提示排队成功，并回显任务类型的本地化名称。
      setMessage(
        locale === 'en-US'
          ? `Job queued: ${JOB_TYPE_LABEL[result.job.job_type]['en-US']}`
          : `任务已排队：${JOB_TYPE_LABEL[result.job.job_type]['zh-CN']}`,
      );
      // 清空提示词，避免误把上一条提示词带到下一个任务。
      setPrompt('');
      // 刷新任务列表，让新任务立即出现。
      reloadJobs();
      // 刷新工程详情与左侧列表，同步状态变化。
      onProjectChange();
    } catch (err) { // 捕获派发任务接口异常
      // 派发失败时展示错误文案。
      setError(errorText(locale, err));
    } finally { // 无论成功或失败都复位派发按钮的加载态
      // 退出加载态。
      setBusy(false);
    } // 结束派发任务的 try 块
  } // 结束 handleDispatch 处理函数

  /** 取消 / 重试走 comic 域端点；start/complete/fail 骨架端点已由 ai-orchestrator 接管，UI 不再暴露 */
  async function handleAction(job: GenerationJob, action: 'cancel' | 'retry') {
    // 取消属于破坏性操作，先二次确认；重试无需确认。
    if (action === 'cancel' && !window.confirm(locale === 'en-US' ? 'Cancel this job?' : '确认取消此任务？')) return;
    // 清理旧的错误提示。
    setError(null);
    // 清理旧的成功提示。
    setMessage(null);
    // try/catch 包住接口调用。
    try {
      // 调用状态机动作端点执行取消或重试。
      await api.comic.jobAction(job.id, action);
      // 刷新任务列表以反映新状态。
      reloadJobs();
      // 同步刷新工程详情与左侧列表。
      onProjectChange();
    } catch (err) { // 捕获「立即运行」接口异常
      // 动作失败时展示错误文案。
      setError(errorText(locale, err));
    } // 结束立即运行的 try 块
  } // 结束 handleRun 处理函数

  /** 立即运行：同步触发 ai-orchestrator 执行（POST /ai/jobs/:id/run）；成本超限 / provider 未配置等失败原因透传 */
  async function handleRun(job: GenerationJob) {
    // 清理旧的错误提示。
    setError(null);
    // 清理旧的成功提示。
    setMessage(null);
    // try/catch 包住同步执行调用。
    try {
      // 触发编排器立即执行该任务，返回执行结果（状态/供应商/错误）。
      const { run } = await api.ai.runJob(job.id);
      // 成功：提示实际执行的 provider，便于核对模型来源。
      if (run.status === 'succeeded') {
        setMessage(locale === 'en-US' ? `Job succeeded via ${run.provider}` : `任务已成功（provider：${run.provider}）`);
      // 失败：拼接错误码与错误信息，方便排查成本超限或未配置等问题。
      } else if (run.status === 'failed') {
        setError(`${run.error_code ?? 'FAILED'}${run.message ? ` — ${run.message}` : ''}`);
      // 其它情况（如跳过）：展示后端给出说明或统一的「已跳过」文案。
      } else {
        setMessage(run.message ?? (locale === 'en-US' ? 'Skipped' : '已跳过'));
      }
      // 刷新任务列表，展示执行后的状态。
      reloadJobs();
      // 同步刷新工程详情与左侧列表。
      onProjectChange();
    } catch (err) { // 捕获取消任务接口异常
      // 请求本身失败时展示错误文案。
      setError(errorText(locale, err));
    } // 结束取消任务的 try 块
  } // 结束 handleCancel 处理函数

  /** 下载成功产物：预签名 GET → 新窗口打开 */
  async function handleDownload(objectKey: string) {
    // 清理旧的错误提示。
    setError(null);
    // try/catch 包住预签名请求。
    try {
      // 向后端换取带 TTL 的下载地址，避免直接暴露存储凭证。
      const res = await api.media.presignDownload(objectKey);
      // 新窗口打开地址；noopener 防止被打开页面通过 window.opener 反向操控。
      window.open(resolvePublicUrl(res.download.url), '_blank', 'noopener');
    } catch (err) { // 捕获预签名下载地址请求异常
      // 预签名失败时展示错误文案。
      setError(errorText(locale, err));
    } // 结束预签名下载的 try 块
  } // 结束 handleDownload 处理函数

  /** draft 工程快捷入口：写入一条示例分镜并确认，使工程进入 storyboarded 后才可派发任务 */
  async function handleQuickConfirm() {
    // 进入加载态，禁用快捷按钮。
    setBusy(true);
    // 清理旧的错误提示。
    setError(null);
    // try/finally 保证加载态复位。
    try {
      // 保存一条示例分镜并直接确认，推动工程状态机前进。
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
      // 提示分镜已确认，用户可继续派发任务。
      setMessage(locale === 'en-US' ? 'Storyboard confirmed ✓' : '分镜已确认 ✓');
      // 刷新工程详情与左侧列表，使状态徽标更新。
      onProjectChange();
    } catch (err) { // 捕获写入示例分镜接口异常
      // 保存失败时展示错误文案。
      setError(errorText(locale, err));
    } finally { // 无论成功或失败都复位示例分镜按钮的加载态
      // 退出加载态。
      setBusy(false);
    } // 结束示例分镜的 try 块
  } // 结束 seedSampleStoryboard 处理函数

  // 任务页渲染：派发区块 + 任务列表区块。
  return (
    // 任务页根容器
    <div>{/* 任务页根容器：派发与列表两块 */}
      {/* 派发区块 */}
      <section className="sub-panel">{/* 派发区块：能力横幅与派发表单 */}
        {/* 派发区块标题栏 */}
        <header className="panel-head">{/* 派发区块标题栏 */}
          {/* 区块标题「派发任务」 */}
          <h3>{/* 区块标题：派发任务 */}{locale === 'en-US' ? 'Dispatch Job' : '派发任务'}</h3>
        </header>{/* 派发标题栏结束 */}

        {/* 能力横幅：展示 provider、支持类型与存储驱动，便于判断为何无法派发 */}
        {caps && ( /* 能力加载完成后才展示横幅 */
          // 单行小字：把三项能力信息用分隔符拼在一起
          <p className="muted small">{/* 能力横幅：provider/类型/存储 */}
            {/* 模型提供方标签 */}
            {locale === 'en-US' ? 'Provider: ' : '模型提供方：'}
            {/* 提供方名称，等宽字体便于辨识 */}
            <code>{/* 提供方名称 */}{caps.provider}</code>
            {/* 若为 mock 提供方则额外标注，提示产物非真实生成 */}
            {caps.mock_provider && (locale === 'en-US' ? ' (mock)' : '（mock）')}
            {/* 信息分隔符 */}
            {' · '}
            {/* 支持类型标签 */}
            {locale === 'en-US' ? 'types: ' : '支持类型：'}
            {/* 支持的任务类型列表，用斜杠连接 */}
            {caps.supported_job_types.join(' / ')}
            {/* 信息分隔符 */}
            {' · '}
            {/* 存储驱动标签 */}
            {locale === 'en-US' ? 'storage: ' : '存储：'}
            {/* 存储驱动名称，如 local / s3 */}
            {caps.storage.driver}
            {/* 既未配置真实提供方也不是 mock 时，明确告警不可生成 */}
            {!caps.provider_configured && !caps.mock_provider && (
              // 红色告警片段
              <span className="error">{/* 未配置告警 */}{locale === 'en-US' ? ' · NOT CONFIGURED' : ' · 未配置'}</span>
            )}
          </p>
        )}

        {/* 任务操作错误提示 */}
        {error && <p className="error">{error}</p>}{/* 任务操作错误提示 */}
        {/* 任务操作成功提示 */}
        {message && <p className="success">{message}</p>}{/* 任务操作成功提示 */}

        {/* 未达派发门槛时给出说明与快捷入口 */}
        {!canDispatch && ( /* 未达门槛时给出引导 */
          // 提示容器
          <div className="hint">{/* 门槛提示容器 */}
            {/* 说明为何不能派发：需先确认分镜 */}
            <p>{/* 说明：需先确认分镜 */}
              {locale === 'en-US'
                ? 'Jobs can be dispatched after the storyboard is confirmed (project status: storyboarded).'
                : '工程需先确认分镜（状态变为「分镜已确认」）后才能派发任务。'}
            </p>
            {/* 仅草稿态提供「确认示例分镜」的快捷通路 */}
            {projectStatus === 'draft' && ( /* 草稿态才给快捷入口 */
              // 快捷确认按钮，请求期间禁用
              <button type="button" className="btn primary" onClick={handleQuickConfirm} disabled={busy}>{/* 快捷确认示例分镜 */}
                {locale === 'en-US' ? 'Confirm sample storyboard' : '确认示例分镜'}
              </button>
            )}
          </div>
        )}

        {/* 派发表单行：类型 + 提示词 + 派发按钮 */}
        <div className="form-inline">{/* 派发表单行 */}
          {/* 任务类型下拉：未达门槛时整体禁用 */}
          <select value={jobType} onChange={(e) => setJobType(e.target.value as JobType)} disabled={!canDispatch}>{/* 任务类型下拉 */}
            {/* 遍历全部任务类型生成选项 */}
            {(Object.keys(JOB_TYPE_LABEL) as JobType[]).map((t) => ( /* 遍历任务类型生成选项 */
              // 单个选项：provider 不支持的类型置灰
              <option key={t} value={t} disabled={!typeSupported(t)}>{/* 类型选项：不支持则置灰 */}
                {/* 类型本地化名称 */}
                {JOB_TYPE_LABEL[t][locale]}
                {/* 不支持时补一句提示，避免用户以为是故障 */}
                {!typeSupported(t) ? (locale === 'en-US' ? ' (unsupported)' : '（不支持）') : ''}
              </option>
            ))}{/* 结束任务类型下拉项的遍历渲染 */}
          </select>
          <input /* 派发提示词输入框：可选 */
            value={/* 受控值：派发提示词 */ prompt}
            onChange={/* 同步提示词到本地状态 */ (e) => setPrompt(e.target.value)}
            placeholder={/* 占位文案：提示可留空 */ locale === 'en-US' ? 'Prompt (optional)…' : '提示词（可选）…'}
            disabled={/* 未达门槛时禁用输入 */ !canDispatch}
          />
          {/* 派发按钮：加载中或类型不被支持时禁用，文案随状态切换 */}
          <button type="button" className="btn primary" onClick={handleCreate} disabled={busy || !canDispatchType}>{/* 派发按钮 */}
            {busy ? (locale === 'en-US' ? 'Dispatching…' : '派发中…') : locale === 'en-US' ? 'Dispatch' : '派发'}
          </button>
        </div>
      </section>{/* 派发任务区块结束 */}

      {/* 任务列表区块 */}
      <section className="sub-panel">{/* 任务列表区块 */}
        {/* 列表标题栏，右侧展示自动刷新徽标 */}
        <header className="panel-head">{/* 列表标题栏 */}
          {/* 区块标题「任务列表」 */}
          <h3>{/* 区块标题：任务列表 */}{locale === 'en-US' ? 'Jobs' : '任务列表'}</h3>
          {/* 有活跃任务时提示正在轮询，解释列表自动变化的原因 */}
          {hasActive && <span className="badge">{locale === 'en-US' ? 'Auto-refreshing' : '自动刷新中'}</span>}{/* 轮询状态徽标 */}
        </header>{/* 列表标题栏结束 */}

        {/* 加载占位：仅在无数据时出现，reload 期间保留旧列表 */}
        {jobsState.loading && <p className="hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</p>}{/* 加载占位 */}
        {/* 列表刷新失败的错误横幅 */}
        {jobsState.error != null && <p className="error">{errorText(locale, jobsState.error)}</p>}{/* 刷新失败横幅 */}

        {/* 任务列表容器 */}
        <ul className="list">{/* 任务列表容器 */}
          {/* 逐个任务渲染一行，键用任务 id */}
          {jobs.map((job) => ( /* 遍历任务渲染条目 */
            // 单个任务条目
            <li key={job.id} className="list-item">{/* 任务条目 */}
              {/* 主信息区：类型 + 状态徽标 */}
              <div className="list-item-main">{/* 主信息区：类型与状态 */}
                {/* 任务类型本地化名称，查表失败时回显原始类型 */}
                <strong>{/* 任务类型名称 */}{JOB_TYPE_LABEL[job.job_type]?.[locale] ?? job.job_type}</strong>
                {/* 任务状态徽标，查表失败时回显原始状态 */}
                <span className="badge">{/* 任务状态徽标 */}{JOB_STATUS_LABEL[job.status]?.[locale] ?? job.status}</span>
              </div>{/* 主信息区结束 */}
              {/* 次信息区：创建时间 + 错误码 */}
              <div className="list-item-sub">{/* 次信息区：时间与错误码 */}
                {/* 任务创建时间，按本地时区格式化 */}
                <span className="muted small">{/* 创建时间：本地化字符串 */}{new Date(job.created_at).toLocaleString()}</span>
                {/* 失败任务的错误码，便于快速判断原因 */}
                {job.error_code && <span className="error small">{job.error_code}</span>}{/* 错误码展示 */}
              </div>{/* 任务头部信息结束 */}
              {/* 产物信息：仅当结果中存在 object_key 时才展示下载入口 */}
              {typeof job.result?.object_key === 'string' && ( /* 有产物才展示下载 */
                // 产物行容器
                <div className="muted small">{/* 产物信息行 */}
                  {/* 展示存储对象键，便于与后端日志对齐 */}
                  object_key: {job.result.object_key}
                  {/* 字段分隔符 */}
                  {' · '}
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => handleDownload(job.result!.object_key as string)}
                  >{/* 下载产物按钮 */}
                    {/* 按钮文案：下载产物 */}
                    {locale === 'en-US' ? 'Download' : '下载产物'}
                  </button>
                </div> // 产物行渲染结束
              )}
              {/* 图像类任务成功后内联展示缩略图，免去下载再查看 */}
              {job.status === 'succeeded' && job.job_type === 'image' && typeof job.result?.object_key === 'string' && (
                // 缩略图组件：内部自行换取预签名地址
                <AssetThumb objectKey={job.result.object_key as string} />
              )}{/* 图像产物内联预览 */}
              {/* 操作按钮区：按任务状态给出不同动作 */}
              <div className="form-inline">{/* 操作按钮区 */}
                {/* 排队中：可立即运行或取消 */}
                {job.status === 'queued' && ( /* 排队态的动作 */
                  // 片段包裹两个并列按钮
                  <>{/* 并列按钮片段 */}
                    {/* 立即运行：同步触发编排器执行 */}
                    <button type="button" className="btn primary small" onClick={() => handleRun(job)}>{/* 立即运行按钮 */}
                      {locale === 'en-US' ? 'Run now' : '立即运行'}
                    </button>
                    {/* 取消：放弃该排队任务 */}
                    <button type="button" className="btn ghost danger small" onClick={() => handleAction(job, 'cancel')}>{/* 取消任务按钮 */}
                      {locale === 'en-US' ? 'Cancel' : '取消'}
                    </button>
                  </>
                )}
                {/* 运行中：只允许取消，避免重复执行 */}
                {job.status === 'running' && ( /* 运行态只允许取消 */
                  <button type="button" className="btn ghost danger small" onClick={() => handleAction(job, 'cancel')}>{/* 取消运行中任务 */}
                    {locale === 'en-US' ? 'Cancel' : '取消'}
                  </button>
                )}
                {/* 失败：允许原地重试，省去重新填写提示词 */}
                {job.status === 'failed' && ( /* 失败态允许重试 */
                  <button type="button" className="btn ghost small" onClick={() => handleAction(job, 'retry')}>{/* 重试按钮 */}
                    {locale === 'en-US' ? 'Retry' : '重试'}
                  </button>
                )}
              </div>{/* 任务操作按钮组结束 */}
            </li>
          ))}{/* 结束任务列表的遍历渲染 */}
          {/* 空列表引导：加载完成且确实没有任务时才展示 */}
          {!jobsState.loading && jobs.length === 0 && ( /* 空态才展示引导 */
            // 空态提示行
            <li className="hint">{/* 空态提示：尚无任务 */}{locale === 'en-US' ? 'No jobs yet.' : '尚无任务。'}</li>
          )}
        </ul>{/* 任务列表结束 */}
      </section>
    </div> // 任务面板根容器渲染结束
  );
} // 结束 JobsTab 组件函数

// ---------- 成片标签页：列表 / 创建 / 发布流 ----------

// 成片页：从合成产物创建成片，并驱动「草稿 → 审核中 → 已发布 / 已归档」的发布流。
function FilmsTab({
  // 界面语言。
  locale,
  // 当前工程 id。
  projectId,
  // 工程状态，决定是否允许创建成片。
  projectStatus,
  // 变更回调：成片状态变化后同步刷新工程详情与左侧列表。
  onProjectChange,
}: { // 成片面板入参类型声明开始
  // 语言类型声明。
  locale: Locale;
  // 工程 id 类型声明。
  projectId: string;
  // 工程状态复用工程实体类型，保证与后端枚举一致。
  projectStatus: ComicProject['status'];
  // 变更回调类型。
  onProjectChange: () => void;
}) { // 入参类型声明结束，进入 FilmsTab 函数体
  // 拉取成片列表；切换工程时自动重载。
  const filmsState = useAsync(() => api.comic.listFilms(projectId), [projectId]);
  // 同时拉取任务列表：用于筛出成功的合成产物作为成片来源。
  const jobsState = useAsync(() => api.comic.listJobs(projectId), [projectId]);
  // 空数组兜底，保证下方 map 安全调用。
  const films: Film[] = filmsState.data?.items ?? [];

  // 成功的 compose 任务产物可作为成片版本的 object_key
  const composeObjects = (jobsState.data?.items ?? [])
    // 只保留合成成功、确实产出可播放成片的任务。
    .filter((j) => j.job_type === 'compose' && j.status === 'succeeded')
    // 映射为下拉框需要的精简结构：任务 id、对象键、创建时间。
    .map((j) => ({
      jobId: j.id,
      objectKey: typeof j.result?.object_key === 'string' ? j.result.object_key : '',
      createdAt: j.created_at,
    }))
    // 过滤掉没有对象键的异常记录，避免下拉出现空值项。
    .filter((o) => o.objectKey);

  // 创建门槛：工程已渲染或已发布（即已具备可用成片产物）。
  const canCreate = projectStatus === 'rendered' || projectStatus === 'published';

  // 工程产物面板（media 域：GET /media/assets?project_id=，每项已附 download_url）
  const assetsState = useAsync(() => api.media.listAssets(projectId), [projectId]);
  // 空数组兜底，保证产物列表渲染安全。
  const assets = assetsState.data?.items ?? [];

  // 当前展开版本面板的成片 id；再次点击同一成片则收起。
  const [expandedFilmId, setExpandedFilmId] = useState<string | null>(null);
  // 当前展开导出面板的成片 id；与版本面板互斥，避免同一行堆两块表单。
  const [exportFilmId, setExportFilmId] = useState<string | null>(null);

  // 新成片标题的受控输入值。
  const [title, setTitle] = useState('');
  // 新成片关联的产物对象键；空串表示不关联任何产物。
  const [objectKey, setObjectKey] = useState('');
  // 创建请求进行中标记。
  const [busy, setBusy] = useState(false);
  // 成片操作（创建/发布/归档/驳回）的错误文案。
  const [error, setError] = useState<string | null>(null);
  // 成片操作的成功提示文案。
  const [message, setMessage] = useState<string | null>(null);

  // 创建成片：标题必填，产物可选；成功后刷新成片列表。
  async function handleCreate() {
    // 标题为空（含纯空格）时直接返回，避免无效请求。
    if (!title.trim()) return;
    // 进入加载态，禁用创建按钮。
    setBusy(true);
    // 清理旧的错误提示。
    setError(null);
    // 清理旧的成功提示。
    setMessage(null);
    // try/finally 保证加载态复位。
    try {
      // 提交标题与可选对象键；空串转为 undefined 让后端使用默认值。
      const result = await api.comic.createFilm(projectId, {
        title: title.trim(),
        object_key: objectKey || undefined,
      });
      // 提示创建成功，并回显服务端确认后的标题。
      setMessage(locale === 'en-US' ? `Film created: ${result.film.title}` : `成片已创建：${result.film.title}`);
      // 清空标题输入，便于继续创建下一个成片。
      setTitle('');
      // 清空产物选择，避免复用上一次的产物。
      setObjectKey('');
      // 刷新成片列表，让新成片出现在下方。
      filmsState.reload();
    } catch (err) { // 捕获创建成片接口异常
      // 创建失败时展示错误文案。
      setError(errorText(locale, err));
    } finally { // 无论成功或失败都复位创建成片的加载态
      // 退出加载态。
      setBusy(false);
    } // 结束创建成片的 try 块
  } // 结束 handleCreate 处理函数

  // 发布流动作：提交审核 / 发布 / 归档，均由同一端点驱动状态机。
  async function handleAction(film: Film, action: 'submit-review' | 'publish' | 'archive') {
    // 归档属于破坏性操作，先二次确认；其余动作直接执行。
    if (action === 'archive' && !window.confirm(locale === 'en-US' ? 'Archive this film?' : '确认归档此成片？')) return;
    // 清理旧的错误提示。
    setError(null);
    // 清理旧的成功提示。
    setMessage(null);
    // try/catch 包住状态机调用。
    try {
      // 调用成片发布流端点执行对应动作。
      await api.comic.publishFilm(film.id, action);
      // 刷新成片列表，反映新的状态与按钮组合。
      filmsState.reload();
      // 同步刷新工程详情与左侧列表。
      onProjectChange();
    } catch (err) { // 捕获提交审核接口异常
      // 动作失败时展示错误文案。
      setError(errorText(locale, err));
    } // 结束提交审核的 try 块
  } // 结束 handleSubmit 处理函数

  // 驳回：必须填写原因，原因会落库并展示在成片列表上。
  async function handleReject(film: Film) {
    // 弹出输入框收集驳回原因，用户取消时返回 null。
    const reason = window.prompt(locale === 'en-US' ? 'Reject reason:' : '驳回原因：');
    // 未填写或只有空白时放弃提交，保证驳回理由可追溯。
    if (!reason?.trim()) return;
    // 清理旧的错误提示。
    setError(null);
    // try/catch 包住驳回请求。
    try {
      // 提交驳回原因，由后端把成片退回草稿态。
      await api.comic.rejectFilm(film.id, reason.trim());
      // 刷新成片列表，展示新的状态与审核备注。
      filmsState.reload();
    } catch (err) { // 捕获驳回成片接口异常
      // 驳回失败时展示错误文案。
      setError(errorText(locale, err));
    } // 结束驳回成片的 try 块
  } // 结束 handleReject 处理函数

  // 成片页渲染：创建区 + 成片列表 + 工程产物。
  return (
    // 成片页根容器
    <div>{/* 成片页根容器：创建、列表与产物 */}
      {/* 创建成片区 */}
      <section className="sub-panel">{/* 创建成片区 */}
        {/* 创建区标题栏 */}
        <header className="panel-head">{/* 创建区标题栏 */}
          {/* 区块标题「创建成片」 */}
          <h3>{/* 区块标题：创建成片 */}{locale === 'en-US' ? 'Create Film' : '创建成片'}</h3>
        </header>{/* 创建标题栏结束 */}

        {/* 创建操作的错误提示 */}
        {error && <p className="error">{error}</p>}{/* 成片操作错误提示 */}
        {/* 创建操作的成功提示 */}
        {message && <p className="success">{message}</p>}{/* 成片操作成功提示 */}

        {/* 未达创建门槛时说明前置条件，避免用户反复尝试 */}
        {!canCreate && ( /* 未达门槛时说明前置条件 */
          // 提示文案：需先有成功的合成任务
          <p className="hint">{/* 门槛提示文案 */}
            {locale === 'en-US'
              ? 'Films can be created after a compose job succeeds (project status: rendered).'
              : '需合成任务成功（工程状态变为「已渲染」）后才能创建成片。'}
          </p>
        )}

        {/* 创建表单行：标题 + 产物选择 + 创建按钮 */}
        <div className="form-inline">{/* 创建表单行 */}
          <input /* 成片标题输入框 */
            value={/* 受控值：成片标题 */ title}
            onChange={/* 同步标题到本地状态 */ (e) => setTitle(e.target.value)}
            placeholder={/* 占位文案：成片标题 */ locale === 'en-US' ? 'Film title…' : '成片标题…'}
            disabled={/* 未达门槛时禁用 */ !canCreate}
          />
          {/* 产物下拉：列出所有成功的合成产物，可留空不关联 */}
          <select value={objectKey} onChange={(e) => setObjectKey(e.target.value)} disabled={!canCreate}>{/* 产物下拉 */}
            {/* 空值选项：创建一个暂不关联产物的占位成片 */}
            <option value="">{/* 空值项：不关联产物 */}{locale === 'en-US' ? 'No object key' : '不关联产物'}</option>
            {/* 逐个合成产物生成选项，键用任务 id 保证唯一 */}
            {composeObjects.map((o) => ( /* 遍历合成产物生成选项 */
              // 选项展示对象键与生成时间，便于区分多次合成
              <option key={o.jobId} value={o.objectKey}>{/* 单个产物选项 */}
                {o.objectKey}（{new Date(o.createdAt).toLocaleString()}）
              </option>
            ))}{/* 结束源产物下拉项的遍历渲染 */}
          </select>
          <button
            type="button"
            className="btn primary"
            onClick={handleCreate}
            disabled={busy || !canCreate || !title.trim()}
          >{/* 创建成片按钮 */}
            {/* 按钮文案随请求状态切换为「创建中…」 */}
            {busy ? (locale === 'en-US' ? 'Creating…' : '创建中…') : locale === 'en-US' ? 'Create' : '创建'}
          </button>
        </div>
      </section>

      {/* 成片列表区 */}
      <section className="sub-panel">{/* 成片列表区 */}
        {/* 列表标题栏 */}
        <header className="panel-head">{/* 成片列表标题栏 */}
          {/* 区块标题「成片列表」 */}
          <h3>{/* 区块标题：成片列表 */}{locale === 'en-US' ? 'Films' : '成片列表'}</h3>
        </header>{/* 列表标题栏结束 */}

        {/* 加载占位：仅在无数据时出现 */}
        {filmsState.loading && <p className="hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</p>}{/* 加载占位 */}
        {/* 列表刷新失败的错误横幅 */}
        {filmsState.error != null && <p className="error">{errorText(locale, filmsState.error)}</p>}{/* 刷新失败横幅 */}

        {/* 成片列表容器 */}
        <ul className="list">{/* 成片列表容器 */}
          {/* 逐个成片渲染一行，键用成片 id */}
          {films.map((film) => ( /* 遍历成片渲染条目 */
            // 单个成片条目
            <li key={film.id} className="list-item">{/* 成片条目 */}
              {/* 主信息区：标题 + 状态徽标 */}
              <div className="list-item-main">{/* 主信息区：标题与状态 */}
                {/* 成片标题 */}
                <strong>{/* 成片标题 */}{film.title}</strong>
                {/* 成片状态徽标：未知状态回显原始值 */}
                <span className="badge">{/* 成片状态徽标 */}{FILM_STATUS_LABEL[film.status]?.[locale] ?? film.status}</span>
              </div>{/* 主信息区结束 */}
              {/* 次信息区：最近更新时间 */}
              <div className="list-item-sub">{/* 次信息区：更新时间 */}
                {/* 更新时间，按本地时区格式化 */}
                <span className="muted small">{/* 更新时间：本地化字符串 */}{new Date(film.updated_at).toLocaleString()}</span>
              </div>
              {/* 审核备注：仅被驳回过的成片才有 */}
              {film.review_note && ( /* 有审核备注才展示 */
                // 备注行容器
                <div className="muted small">{/* 审核备注行 */}
                  {/* 备注标签 */}
                  {locale === 'en-US' ? 'Review note: ' : '审核备注：'}
                  {/* 驳回原因正文 */}
                  {film.review_note}
                </div>
              )}
              {/* 动作区：按成片状态组合发布流按钮 */}
              <div className="form-inline">{/* 发布流动作区 */}
                {/* 草稿态：可提交审核进入评审 */}
                {film.status === 'draft' && ( /* 草稿态动作 */
                  <button type="button" className="btn ghost small" onClick={() => handleAction(film, 'submit-review')}>{/* 提交审核按钮 */}
                    {locale === 'en-US' ? 'Submit Review' : '提交审核'}
                  </button>
                )}
                {/* 审核中：可发布上线或驳回退回草稿 */}
                {film.status === 'reviewing' && ( /* 审核中动作 */
                  // 片段包裹「发布」与「驳回」两个并列按钮
                  <>{/* 发布与驳回并列 */}
                    {/* 发布：让成片对外可见 */}
                    <button type="button" className="btn primary small" onClick={() => handleAction(film, 'publish')}>{/* 发布按钮 */}
                      {locale === 'en-US' ? 'Publish' : '发布'}
                    </button>
                    {/* 驳回：需填写原因，退回草稿态 */}
                    <button type="button" className="btn ghost danger small" onClick={() => handleReject(film)}>{/* 驳回按钮 */}
                      {locale === 'en-US' ? 'Reject' : '驳回'}
                    </button>
                  </>
                )}
                {/* 草稿或已发布态：可归档下线 */}
                {(film.status === 'draft' || film.status === 'published') && ( /* 可归档状态 */
                  <button type="button" className="btn ghost danger small" onClick={() => handleAction(film, 'archive')}>{/* 归档按钮 */}
                    {locale === 'en-US' ? 'Archive' : '归档'}
                  </button>
                )}
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => { // 打开版本面板时收起导出面板，保持单行只有一块展开区
                    setExportFilmId(null); // 互斥：清掉导出面板
                    setExpandedFilmId(expandedFilmId === film.id ? null : film.id); // 再次点击同一成片则收起
                  }}
                >{/* 版本面板开关：再次点击收起 */}
                  {/* 展开/收起该成片的版本列表 */}
                  {locale === 'en-US' ? 'Versions' : '版本'}
                </button>
                {/* 导出按钮：所有状态都可尝试导出，无产物时由后端返回可读错误 */}
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => { // 打开导出面板时收起版本面板，避免两块表单互相挤压
                    setExpandedFilmId(null); // 互斥：清掉版本面板
                    setExportFilmId(exportFilmId === film.id ? null : film.id); // 再次点击同一成片则收起
                  }}
                >{/* 导出面板开关 */}
                  {locale === 'en-US' ? 'Export' : '导出'}
                </button>
              </div>
              {/* 仅当前展开的成片才挂载版本面板，避免一次性请求所有版本 */}
              {expandedFilmId === film.id && <FilmVersionsPanel filmId={film.id} locale={locale} />}{/* 版本面板：惰性挂载 */}
              {/* 仅当前展开的成片才挂载导出面板，避免预签名地址在打开前就已过期 */}
              {exportFilmId === film.id && <FilmExportPanel filmId={film.id} locale={locale} />}{/* 导出面板：惰性挂载 */}
            </li>
          ))}{/* 结束成片列表的遍历渲染 */}
          {/* 空列表引导：加载完成且确实没有成片时才展示 */}
          {!filmsState.loading && films.length === 0 && ( /* 空态才展示引导 */
            // 空态提示行
            <li className="hint">{/* 空态提示：尚无成片 */}{locale === 'en-US' ? 'No films yet.' : '尚无成片。'}</li>
          )}
        </ul>
      </section>

      {/* 工程产物区：直接展示 media 域中的全部产物，方便核对与下载 */}
      <section className="sub-panel">{/* 工程产物区 */}
        {/* 产物区标题栏 */}
        <header className="panel-head">{/* 产物区标题栏 */}
          {/* 区块标题「工程产物」 */}
          <h3>{/* 区块标题：工程产物 */}{locale === 'en-US' ? 'Project Assets' : '工程产物'}</h3>
        </header>{/* 产物标题栏结束 */}

        {/* 加载占位：仅在无数据时出现 */}
        {assetsState.loading && <p className="hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</p>}{/* 产物加载占位 */}
        {/* 产物列表刷新失败的错误横幅 */}
        {assetsState.error != null && <p className="error">{errorText(locale, assetsState.error)}</p>}{/* 产物刷新失败横幅 */}

        {/* 产物列表容器 */}
        <ul className="list">{/* 产物列表容器 */}
          {/* 逐个产物渲染一行，键用产物 id */}
          {assets.map((a) => ( /* 遍历产物渲染条目 */
            // 单个产物条目
            <li key={a.id} className="list-item">{/* 产物条目 */}
              {/* 主信息区：产物类型 + MIME 徽标 */}
              <div className="list-item-main">{/* 主信息区：类型与 MIME */}
                {/* 产物类型，如 image / video / audio */}
                <strong>{/* 产物类型 */}{a.asset_type}</strong>
                {/* MIME 类型徽标，便于判断能否在浏览器直接预览 */}
                <span className="badge">{/* MIME 徽标 */}{a.mime}</span>
              </div>{/* 主信息区结束 */}
              {/* 次信息区：体积、创建时间、过期时间 + 下载链接 */}
              <div className="list-item-sub">{/* 次信息区：元信息与下载 */}
                {/* 元信息行 */}
                <span className="muted small">{/* 元信息：体积/时间/有效期 */}
                  {/* 体积换算为 KB 展示，缺失时不显示 */}
                  {a.size_bytes != null ? `${(a.size_bytes / 1024).toFixed(1)} KB · ` : ''}
                  {/* 创建时间，按本地时区格式化 */}
                  {new Date(a.created_at).toLocaleString()}
                  {/* 预签名地址有效期提示，提醒过期后需重新获取 */}
                  {a.expires_at ? ` · ${locale === 'en-US' ? 'expires' : '过期'} ${new Date(a.expires_at).toLocaleDateString()}` : ''}
                </span>
                {/* 下载入口：直接复用后端返回的预签名地址，跨源托管时补 API 源 */}
                <a className="btn ghost small" href={resolvePublicUrl(a.download_url)} target="_blank" rel="noreferrer">{/* 下载链接：预签名地址 */}
                  {locale === 'en-US' ? 'Download' : '下载'}
                </a>
              </div>
              {/* 图像类产物额外内联预览，免去下载再查看 */}
              {a.asset_type === 'image' && ( /* 图像产物才预览 */
                // 预览容器：与上方信息拉开一点间距
                <div style={{ marginTop: 4 }}>{/* 预览容器：控制间距 */}
                  <img
                    src={resolvePublicUrl(a.download_url)}
                    alt={a.object_key}
                    style={{ maxWidth: 180, maxHeight: 180, borderRadius: 8 }}
                  />
                </div>
              )}
            </li>
          ))}{/* 结束候选产物列表的遍历渲染 */}
          {/* 空列表引导：加载完成且确实没有产物时才展示 */}
          {!assetsState.loading && assets.length === 0 && ( /* 空态才展示引导 */
            // 空态提示行
            <li className="hint">{/* 空态提示：尚无产物 */}{locale === 'en-US' ? 'No assets yet.' : '尚无产物。'}</li>
          )}
        </ul>
      </section>
    </div>
  );
}

/** 成片导出面板：选格式/分辨率换取一次性预签名下载地址；未配置 ffmpeg 时提供原片直下降级 */
function FilmExportPanel({ filmId, locale }: { filmId: string; locale: Locale }) {
  // 导出格式：默认 mp4，与 compose 产物容器一致，无需服务端转码。
  const [format, setFormat] = useState<FilmExportFormat>('mp4');
  // 导出分辨率：默认 1080p，与 compose 产物尺寸一致，无需服务端转码。
  const [resolution, setResolution] = useState<FilmExportResolution>('1080p');
  // 导出结果：非空时展示下载入口、版本号与凭证有效期。
  const [result, setResult] = useState<FilmExportResult | null>(null);
  // 请求进行中：禁用按钮，避免连点签发多份下载凭证。
  const [busy, setBusy] = useState(false);
  // 局部错误文案：与父级成片列表的错误横幅互不影响。
  const [error, setError] = useState<string | null>(null);
  // 转码不可用：服务端返回带 requested 细节的 403 时，提供一键降级入口。
  const [transcodeUnavailable, setTranscodeUnavailable] = useState(false);

  // 判定「转码不可用」而非「模块未解锁」：二者共用 FEATURE_NOT_AVAILABLE，只有前者带 requested 细节。
  function isTranscodeUnavailable(err: unknown): boolean {
    // 只认统一的接口错误类型，网络异常等不进入降级分支。
    if (!(err instanceof ApiError) || err.code !== 'FEATURE_NOT_AVAILABLE') return false;
    // details 为结构化对象且含 requested 字段，即后端明确回显了被拒绝的格式/分辨率。
    return typeof err.details === 'object' && err.details !== null && 'requested' in err.details;
  } // 结束 isTranscodeUnavailable 判定

  // 发起导出；options 用于降级时强制走 mp4 + 1080p 原片直下。
  async function handleExport(options?: { format: FilmExportFormat; resolution: FilmExportResolution }) {
    // 每次请求前清空旧状态，避免继续展示上一次的过期链接。
    setResult(null); // 清空旧结果
    setError(null); // 清空旧错误
    setTranscodeUnavailable(false); // 复位降级入口
    setBusy(true); // 进入加载态
    try { // 包住接口调用
      // 不传 options 时取当前表单选择，传了则用于一键降级。
      const data = await api.comic.exportFilm(filmId, options ?? { format, resolution }); // 换取预签名下载地址
      setResult(data); // 保存结果，触发下载入口渲染
      setFormat(data.format); // 表单回写实际格式：一键降级后不再停留在不可用的 MOV
      setResolution(data.resolution); // 表单回写实际分辨率：避免再次点击重复触发转码失败
    } catch (err) { // 捕获导出异常
      // 转码不可用时给出可执行的降级提示，而不是把服务端英文原文丢给用户。
      if (isTranscodeUnavailable(err)) { // 转码能力缺失分支
        setError(locale === 'en-US' // 按语言给出降级说明
          ? 'Server transcoding is not configured. Use MP4 / 1080p to download the original film.'
          : '服务器未配置转码，可改用 MP4 / 1080p 直接下载原片。');
        setTranscodeUnavailable(true); // 敞开一键降级入口
      } else { // 其它错误分支
        setError(errorText(locale, err)); // 统一走本地化错误码翻译
      } // 结束错误分支
    } finally { // 无论成败都复位加载态
      setBusy(false); // 退出加载态
    } // 结束 try 块
  } // 结束 handleExport 处理函数

  // 导出面板：说明 + 选项 + 动作 + 错误/降级 + 结果下载入口。
  return (
    // 面板根容器，与上方成片行拉开间距
    <div className="sub-panel" style={{ marginTop: 8 }}>{/* 导出面板根容器 */}
      {/* 面板标题栏 */}
      <header className="panel-head">{/* 导出面板标题栏 */}
        <h3>{/* 导出面板标题 */}{locale === 'en-US' ? 'Export Film' : '导出成片'}</h3>
      </header>{/* 标题栏结束 */}
      {/* 能力说明：区分原片直下与需要转码的选项，并提示凭证有效期 */}
      <p className="hint">{/* 导出能力说明 */}
        {locale === 'en-US'
          ? 'MP4 / 1080p downloads the original file; other options require server-side ffmpeg transcoding. Links expire in 1 hour.'
          : 'MP4 / 1080p 可直接下载原片；其它格式或分辨率需服务端配置 ffmpeg 转码。下载链接 1 小时内有效。'}
      </p>
      {/* 选项行：格式 / 分辨率 / 导出按钮 */}
      <div className="form-inline">{/* 导出表单行 */}
        {/* 格式下拉：mp4 为原片容器，mov 需转码 */}
        <select
          aria-label={locale === 'en-US' ? 'Export format' : '导出格式'}
          value={format}
          onChange={(e) => setFormat(e.target.value as FilmExportFormat)}
          disabled={busy}
        >{/* 格式选择器 */}
          <option value="mp4">MP4</option>
          <option value="mov">MOV</option>
        </select>
        {/* 分辨率下拉：1080p 为原片尺寸，720p 需转码 */}
        <select
          aria-label={locale === 'en-US' ? 'Export resolution' : '导出分辨率'}
          value={resolution}
          onChange={(e) => setResolution(e.target.value as FilmExportResolution)}
          disabled={busy}
        >{/* 分辨率选择器 */}
          <option value="1080p">1080p</option>
          <option value="720p">720p</option>
        </select>
        {/* 导出动作：请求期间禁用防重复签发 */}
        <button
          type="button"
          className="btn primary small"
          onClick={() => void handleExport()}
          disabled={busy}
        >{/* 导出按钮 */}
          {busy // 按加载态切换文案
            ? (locale === 'en-US' ? 'Preparing…' : '准备中…')
            : (locale === 'en-US' ? 'Generate download link' : '生成下载链接')}
        </button>
      </div>
      {/* 错误横幅：含转码不可用的降级说明 */}
      {error && <p className="error">{error}</p>}{/* 导出错误提示 */}
      {/* 一键降级：直接请求 mp4 + 1080p 原片直下，无需用户重新选表单 */}
      {transcodeUnavailable && ( /* 仅在转码不可用时出现 */
        <button
          type="button"
          className="btn ghost small"
          onClick={() => void handleExport({ format: 'mp4', resolution: '1080p' })}
          disabled={busy}
        >{/* 降级按钮 */}
          {locale === 'en-US' ? 'Download original (MP4 / 1080p)' : '直接下载原片（MP4 / 1080p）'}
        </button>
      )}
      {/* 成功结果：版本 / 格式 / 是否转码 / 有效期 + 下载入口 */}
      {result && ( /* 拿到预签名地址后才渲染 */
        <div className="list-item-sub">{/* 结果信息行 */}
          {/* 元信息：版本号、格式、分辨率、是否转码与过期时间 */}
          <span className="muted small">{/* 结果元信息 */}
            {`v${result.version_no} · ${result.format.toUpperCase()} · ${result.resolution} · `}
            {result.transcoded // 按是否转码给出不同说明
              ? (locale === 'en-US' ? 'transcoded' : '已转码')
              : (locale === 'en-US' ? 'original' : '原片直下')}
            {` · ${locale === 'en-US' ? 'expires' : '有效期至'} ${new Date(result.expires_at).toLocaleString()}`}
          </span>
          {/* 下载入口：跨源托管构建下补 API 源，避免打到静态站自身 */}
          <a
            className="btn primary small"
            href={resolvePublicUrl(result.download_url)}
            target="_blank"
            rel="noreferrer"
          >{/* 成片下载链接 */}
            {locale === 'en-US' ? 'Download film' : '下载成片'}
          </a>
        </div>
      )}
    </div>
  );
}

/** 成功 image 任务的内联预览：按需预签名 GET（URL 有 TTL，组件随任务行挂载时拉取一次） */
function AssetThumb({ objectKey }: { objectKey: string }) {
  // 组件挂载时按对象键换取含 TTL 的预览地址，避免长期有效的公开链接。
  const state = useAsync(() => api.media.presignDownload(objectKey), [objectKey]);
  // 尚无数据（加载中或失败）时不渲染，避免出现破图占位。
  if (!state.data) return null;
  // 缩略图渲染。
  return (
    // 外层容器负责与上方信息拉开间距
    <div style={{ marginTop: 4 }}>{/* 缩略图容器：控制间距 */}
      <img
        src={resolvePublicUrl(state.data.download.url)}
        alt={objectKey}
        style={{ maxWidth: 180, maxHeight: 180, borderRadius: 8 }}
      />
    </div>
  );
}

/** 成片版本列表面板：展开时按 filmId 拉取（GET /comic/films/:id → versions），版本产物经预签名下载/播放 */
function FilmVersionsPanel({ filmId, locale }: { filmId: string; locale: Locale }) {
  // 按成片 id 拉取版本列表；面板展开时才挂载，因此请求是惰性的。
  const state = useAsync(() => api.comic.getFilm(filmId), [filmId]);
  // 版本下载动作的局部错误文案，与父级错误互不影响。
  const [error, setError] = useState<string | null>(null);

  // 下载或播放某个版本：先换预签名地址，再在新窗口打开。
  async function handleDownload(objectKey: string) {
    // 清理上一次的错误提示。
    setError(null);
    // try/catch 包住预签名请求。
    try {
      // 换取带 TTL 的下载地址。
      const res = await api.media.presignDownload(objectKey);
      // 新窗口打开；noopener 防止被打开页面反向操作当前页。
      window.open(resolvePublicUrl(res.download.url), '_blank', 'noopener');
    } catch (err) { // 捕获版本记录请求异常
      // 失败时展示错误文案。
      setError(errorText(locale, err));
    } // 结束版本记录的 try 块
  } // 结束 reload 处理函数

  // 首次加载中：展示版本加载占位。
  if (state.loading && !state.data) {
    return <p className="hint">{locale === 'en-US' ? 'Loading versions…' : '版本加载中…'}</p>;
  }
  // 加载失败且无缓存数据：展示错误文案而非空白。
  if (state.error != null && !state.data) {
    return <p className="error">{errorText(locale, state.error)}</p>;
  }

  // 版本数组：空数组兜底，保证下方 map 安全。
  const versions = state.data?.versions ?? [];
  // 面板渲染：错误提示 + 版本列表。
  return (
    // 面板容器：与成片主行拉开间距，形成嵌套视觉层次
    <div style={{ marginTop: 6 }}>{/* 版本面板容器：控制间距 */}
      {/* 版本下载的错误提示 */}
      {error && <p className="error">{error}</p>}{/* 版本下载错误提示 */}
      {/* 版本列表容器 */}
      <ul className="list">{/* 版本列表容器 */}
        {/* 逐个版本渲染一行，键用版本 id */}
        {versions.map((v) => ( /* 遍历版本渲染条目 */
          // 单个版本条目
          <li key={v.id} className="list-item">{/* 版本条目 */}
            {/* 主信息区：版本号 + 发布状态徽标 */}
            <div className="list-item-main">{/* 主信息区：版本号与状态 */}
              {/* 版本号：v 前缀便于快速扫读 */}
              <strong>v{v.version_no}</strong>
              {/* 状态徽标：有发布时间即视为已发布 */}
              <span className="badge">{/* 发布状态徽标 */}
                {v.published_at ? (locale === 'en-US' ? 'published' : '已发布') : locale === 'en-US' ? 'unpublished' : '未发布'}
              </span>
            </div>{/* 主信息区结束 */}
            {/* 次信息区：时间、体积、时长 + 下载入口 */}
            <div className="list-item-sub">{/* 次信息区：元信息与下载 */}
              {/* 元信息行 */}
              <span className="muted small">{/* 元信息：时间/体积/时长 */}
                {/* 版本创建时间，按本地时区格式化 */}
                {new Date(v.created_at).toLocaleString()}
                {/* 体积换算为 KB，缺失时不显示 */}
                {v.size_bytes != null ? ` · ${(v.size_bytes / 1024).toFixed(1)} KB` : ''}
                {/* 时长（秒），缺失时不显示 */}
                {v.duration_sec != null ? ` · ${v.duration_sec}s` : ''}
              </span>
              {/* 有对象键才提供下载/播放入口 */}
              {v.object_key && ( /* 有产物才给下载入口 */
                <button type="button" className="btn ghost small" onClick={() => handleDownload(v.object_key!)}>{/* 下载/播放按钮 */}
                  {locale === 'en-US' ? 'Download / Play' : '下载 / 播放'}
                </button>
              )}
            </div>
          </li>
        ))}{/* 结束历史版本的遍历渲染 */}
        {/* 空版本引导：该成片尚未产生任何版本 */}
        {versions.length === 0 && ( /* 空版本才展示引导 */
          // 空态提示行
          <li className="hint">{/* 空态提示：暂无版本 */}{locale === 'en-US' ? 'No versions.' : '暂无版本。'}</li>
        )}
      </ul>
    </div>
  );
} // 结束 FilmVersionsPanel 组件函数
