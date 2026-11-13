/**
 * ComicTheater：漫剧 / AI 剧「放映厅」——真正能看片的视频模块。
 *
 * 与 ComicWorkbench（创作工作台）互补：工作台负责剧本、分镜、生成与成片导出；
 * 放映厅负责把成片按作品 / 集数组织起来，用原生播放器直接观看。
 * 匿名访客可看内置演示片库；登录用户额外看到「我的作品」，播放服务端签发的成片地址。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'; // React 状态、副作用与播放器引用
import type { Locale } from '@mim/i18n'; // 语言类型
import { api, resolvePublicUrl } from '../api'; // 业务接口集合 + 公开地址归一化（跨源托管时补 API 源）
import type { ShowcaseWork, TheaterItem } from '../api'; // 放映厅数据类型

/** 播放进度存储键：按「作品 / 集」维度记录，刷新后可从上次位置继续看 */
const PROGRESS_KEY = 'mim.theater.progress.v1';

/** 进度表结构：key -> 秒数 */
type ProgressMap = Record<string, number>;

/** 读取本地进度表：解析失败时回退空表，避免脏数据阻断播放 */
function readProgress(): ProgressMap {
  try { // 异常捕获起点：包裹可能抛出错误的操作
    const raw = localStorage.getItem(PROGRESS_KEY); // 常量 raw：保存固定配置或一次性派生值
    if (!raw) return {}; // 条件分支：按判断结果选择后续处理路径
    const parsed = JSON.parse(raw) as ProgressMap; // 常量 parsed：保存固定配置或一次性派生值
    return parsed && typeof parsed === 'object' ? parsed : {}; // 返回当前函数的处理结果
  } catch {
    return {}; // 返回当前函数的处理结果
  } // 代码块结束
} // readProgress 结束

/** 写入单个进度：静默失败，播放本身不受影响 */
function writeProgress(key: string, seconds: number): void {
  try { // 异常捕获起点：包裹可能抛出错误的操作
    const map = readProgress(); // 常量 map：保存固定配置或一次性派生值
    map[key] = Math.max(0, Math.round(seconds));
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
  } catch {
    /* 本地存储不可用（隐私模式 / 配额满）时忽略，不阻塞播放 */
  }
} // writeProgress 结束

/** 秒数格式化为 mm:ss，用于列表与进度提示 */
function formatTime(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '--:--'; // 条件分支：按判断结果选择后续处理路径
  const m = Math.floor(seconds / 60); // 常量 m：保存固定配置或一次性派生值
  const s = Math.floor(seconds % 60); // 常量 s：保存固定配置或一次性派生值
  return `${m}:${String(s).padStart(2, '0')}`; // 返回当前函数的处理结果
} // formatTime 结束

interface Props { // 接口 Props：约束对象的字段与类型形态
  locale: Locale; // 当前语言
  hasSession: boolean; // 是否已登录：决定是否拉取「我的作品」
  onSignIn: () => void; // 匿名时引导登录
  onOpenWorkbench: () => void; // 空态时引导去创作工作台
} // Props 结束

/** 当前播放源：演示作品的一集，或本人成片 */
interface PlaySource {
  key: string; // 进度键
  title: string; // 标题
  subtitle: string; // 副标题 / 作品名
  src: string; // 视频地址
  poster?: string; // 封面（演示作品有）
} // PlaySource 结束

/** 渲染放映厅 */
export function ComicTheater({ locale, hasSession, onSignIn, onOpenWorkbench }: Props) {
  const isZh = locale !== 'en-US'; // 中文判断，文案随语言切换
  const [works, setWorks] = useState<ShowcaseWork[]>([]); // 演示片库
  const [mine, setMine] = useState<TheaterItem[]>([]); // 本人成片
  const [loading, setLoading] = useState(true); // 首屏加载态
  const [error, setError] = useState<string | null>(null); // 加载失败提示
  const [mineError, setMineError] = useState<string | null>(null); // 我的作品加载失败（不阻断演示播放）
  const [activeWorkId, setActiveWorkId] = useState<string | null>(null); // 当前选中演示作品
  const [activeEpisode, setActiveEpisode] = useState(0); // 当前集下标
  const [kindFilter, setKindFilter] = useState<'all' | 'comic-drama' | 'ai-drama'>('all'); // 形态筛选：全部 / 漫剧 / AI 剧
  const [query, setQuery] = useState(''); // 片库搜索词
  const [mineActiveId, setMineActiveId] = useState<string | null>(null); // 当前播放的本人成片
  const [resumeAt, setResumeAt] = useState(0); // 待恢复的播放位置（秒）
  const videoRef = useRef<HTMLVideoElement | null>(null); // 播放器引用，用于恢复进度

  // 首屏加载：演示片库公开可看，不依赖登录
  useEffect(() => {
    let cancelled = false; // 卸载后不再写状态，避免竞态
    setLoading(true);
    api.comic
      .showcase()
      .then((res) => {
        if (cancelled) return; // 条件分支：按判断结果选择后续处理路径
        // 服务端下发相对片源：同源部署直接可用，跨源托管补 API 源后再播放
        const resolved = res.items.map((work) => ({
          ...work,
          cover: resolvePublicUrl(work.cover),
          episodes: work.episodes.map((ep) => ({ ...ep, src: resolvePublicUrl(ep.src) })),
        }));
        setWorks(resolved);
        // 默认选中第一部作品的第一集，让访客打开就能看
        const first = resolved[0];
        if (first) { // 条件分支：按判断结果选择后续处理路径
          setActiveWorkId(first.id);
          setActiveEpisode(0);
        } // 代码块结束
        setError(null);
      }) // 代码块结束
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err)); // 条件分支：按判断结果选择后续处理路径
      }) // 代码块结束
      .finally(() => {
        if (!cancelled) setLoading(false); // 条件分支：按判断结果选择后续处理路径
      });
    return () => { // 返回当前函数的处理结果
      cancelled = true;
    }; // 代码块结束
  }, []); // 仅挂载时拉取一次

  // 我的作品：仅在已登录时请求；失败时给出提示但不影响演示片库
  useEffect(() => {
    if (!hasSession) { // 条件分支：按判断结果选择后续处理路径
      setMine([]);
      return; // 返回当前函数的处理结果
    } // 代码块结束
    let cancelled = false; // 卸载保护
    api.comic
      .theater()
      .then((res) => {
        if (!cancelled) { // 条件分支：按判断结果选择后续处理路径
          // 预签名地址可能是相对路径（本地存储驱动），统一归一化后再交给播放器
          setMine(res.items.map((item) => ({ ...item, src: resolvePublicUrl(item.src) })));
          setMineError(null);
        } // 代码块结束
      }) // 代码块结束
      .catch((err: unknown) => {
        if (!cancelled) setMineError(err instanceof Error ? err.message : String(err)); // 条件分支：按判断结果选择后续处理路径
      });
    return () => { // 返回当前函数的处理结果
      cancelled = true;
    }; // 代码块结束
  }, [hasSession]); // 登录态变化时重取

  // 当前播放源：优先本人成片（选中即播放），否则演示作品当前集
  const activeWork = works.find((w) => w.id === activeWorkId) ?? null; // 选中的演示作品
  const activeMine = mine.find((m) => m.id === mineActiveId) ?? null; // 选中的本人成片
  const source: PlaySource | null = useMemo(() => { // 常量 source：保存固定配置或一次性派生值
    if (activeMine) { // 条件分支：按判断结果选择后续处理路径
      return { // 返回当前函数的处理结果
        key: `mine:${activeMine.id}`,
        title: activeMine.title,
        subtitle: `${activeMine.project_title} · v${activeMine.version_no}`,
        src: activeMine.src,
      }; // 代码块结束
    } // 代码块结束
    if (!activeWork) return null; // 条件分支：按判断结果选择后续处理路径
    const ep = activeWork.episodes[activeEpisode] ?? activeWork.episodes[0]; // 常量 ep：保存固定配置或一次性派生值
    if (!ep) return null; // 条件分支：按判断结果选择后续处理路径
    return { // 返回当前函数的处理结果
      key: `show:${activeWork.id}:${ep.no}`,
      title: ep.title,
      subtitle: activeWork.title,
      src: ep.src,
      poster: activeWork.cover,
    }; // 代码块结束
  }, [activeMine, activeWork, activeEpisode]); // 依赖当前选择

  // 片库筛选：形态 + 标题/标签搜索，结果仍保持服务端原始顺序
  const filteredWorks = useMemo(() => {
    const q = query.trim().toLowerCase(); // 常量 q：保存固定配置或一次性派生值
    return works.filter((work) => { // 返回当前函数的处理结果
      if (kindFilter !== 'all' && work.kind !== kindFilter) return false; // 条件分支：按判断结果选择后续处理路径
      if (!q) return true; // 条件分支：按判断结果选择后续处理路径
      return `${work.title} ${work.subtitle} ${work.tags.join(' ')}`.toLowerCase().includes(q); // 返回当前函数的处理结果
    });
  }, [works, kindFilter, query]);

  // 继续观看：本地有播放进度的作品，按进度倒序，最多展示 4 部
  const continueItems = useMemo(() => {
    const progress = readProgress(); // 常量 progress：保存固定配置或一次性派生值
    return works // 返回当前函数的处理结果
      .map((work) => {
        const first = work.episodes[0]; // 常量 first：保存固定配置或一次性派生值
        return { work, seconds: first ? progress[`show:${work.id}:${first.no}`] ?? 0 : 0 }; // 返回当前函数的处理结果
      }) // 代码块结束
      .filter((item) => item.seconds > 0)
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 4);
  }, [works]);

  // 打开新播放源时：读出上次进度，等元数据加载后跳转
  useEffect(() => {
    if (!source) return; // 条件分支：按判断结果选择后续处理路径
    const saved = readProgress()[source.key] ?? 0; // 常量 saved：保存固定配置或一次性派生值
    setResumeAt(saved);
  }, [source?.key]); // 仅当播放源切换时读取

  // 元数据就绪：恢复到上次位置（接近结尾则从头开始）
  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current; // 常量 video：保存固定配置或一次性派生值
    if (!video || !resumeAt) return; // 条件分支：按判断结果选择后续处理路径
    if (Number.isFinite(video.duration) && resumeAt < video.duration - 2) { // 条件分支：按判断结果选择后续处理路径
      video.currentTime = resumeAt;
    } // 代码块结束
  }, [resumeAt]); // 依赖恢复位置

  // 播放进度落盘：每 5 秒最多写一次，避免高频 localStorage 写入
  const lastSaved = useRef(0); // 上次落盘时间（秒）
  const handleTimeUpdate = useCallback(() => { // 常量 handleTimeUpdate：保存固定配置或一次性派生值
    const video = videoRef.current; // 常量 video：保存固定配置或一次性派生值
    if (!video || !source) return; // 条件分支：按判断结果选择后续处理路径
    if (Math.abs(video.currentTime - lastSaved.current) < 5) return; // 条件分支：按判断结果选择后续处理路径
    lastSaved.current = video.currentTime;
    writeProgress(source.key, video.currentTime);
  }, [source]); // 依赖当前播放源

  // 选择演示作品：重置集数与本人成片选中态
  function selectWork(work: ShowcaseWork) {
    setMineActiveId(null);
    setActiveWorkId(work.id);
    setActiveEpisode(0);
  } // selectWork 结束

  // 选择本人成片：清空演示选中态，播放签名地址
  function selectMine(item: TheaterItem) {
    setMineActiveId(item.id);
  } // selectMine 结束

  // 下一集：同一作品内切换；已是最后一集则禁用
  function nextEpisode() {
    if (!activeWork) return; // 条件分支：按判断结果选择后续处理路径
    if (activeEpisode + 1 < activeWork.episodes.length) setActiveEpisode(activeEpisode + 1); // 条件分支：按判断结果选择后续处理路径
  } // nextEpisode 结束

  // 首屏加载失败：展示可重试的错误提示
  if (loading && works.length === 0) {
    return <div className="hint">{isZh ? '正在加载放映厅…' : 'Loading theater…'}</div>; // 返回当前函数的处理结果
  } // 代码块结束
  if (error && works.length === 0) { // 条件分支：按判断结果选择后续处理路径
    return ( // 返回当前函数的处理结果
      <div className="error">{/* 执行当前业务步骤 */}
        {isZh ? '放映厅加载失败：' : 'Failed to load theater: '}
        {error}
      </div>
    ); // 执行当前业务步骤
  } // 代码块结束

  return ( // 返回当前函数的处理结果
    <div className="theater">{/* 执行当前业务步骤 */}
      {/* 顶部说明：明确这里就是看片入口 */}
      <header className="theater-head">{/* 执行当前业务步骤 */}
        <div>{/* 执行当前业务步骤 */}
          <h2 className="theater-title">{isZh ? '放映厅' : 'Theater'}</h2>
          <p className="muted">{/* 执行当前业务步骤 */}
            {isZh
              ? '直接播放漫剧与 AI 剧成片；演示片源开放授权，登录后还能看自己的作品。'
              : 'Watch comic dramas and AI dramas directly. Demo reels are openly licensed; sign in to watch your own films.'}
          </p>
        </div>
        {/* 匿名时展示登录入口，登录后可看「我的作品」 */}
        {!hasSession && (
          <button type="button" className="btn primary small" onClick={onSignIn}>{/* 执行当前业务步骤 */}
            {isZh ? '登录看我的作品' : 'Sign in for my films'}
          </button>
        )}
      </header>

      {/* 播放器 + 剧集信息：左侧画面，右侧剧集与简介 */}
      {source && (
        <section className="theater-stage">{/* 执行当前业务步骤 */}
          <div className="theater-player-wrap">{/* 执行当前业务步骤 */}
            <video
              key={source.key} // 切换片源时重建播放器，避免沿用上一条的缓冲
              ref={videoRef}
              className="theater-player"
              src={source.src}
              poster={source.poster}
              controls
              preload="metadata"
              playsInline
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onEnded={() => { // 播完自动进下一集；最后一集停在结尾
                if (!activeMine && activeWork && activeEpisode + 1 < activeWork.episodes.length) { // 条件分支：按判断结果选择后续处理路径
                  setActiveEpisode(activeEpisode + 1);
                } // 代码块结束
              }}
              onPause={() => videoRef.current && source && writeProgress(source.key, videoRef.current.currentTime)}
            />
            <div className="theater-now">{/* 执行当前业务步骤 */}
              <span className="theater-now-title">{source.title}</span>
              <span className="theater-now-sub">{source.subtitle}</span>
            </div>
          </div>

          <aside className="theater-side">{/* 执行当前业务步骤 */}
            {/* 演示作品的集数切换；本人成片不显示集数 */}
            {activeWork && !activeMine && (
              <div className="theater-episodes">{/* 执行当前业务步骤 */}
                <h3 className="theater-side-title">{isZh ? '剧集' : 'Episodes'}</h3>
                {activeWork.episodes.map((ep, index) => (
                  <button
                    key={ep.no}
                    type="button" // 赋值：更新变量 type 的取值
                    className={`theater-ep${index === activeEpisode ? ' active' : ''}`}
                    onClick={() => setActiveEpisode(index)}
                  >
                    <span>{ep.title}</span>
                    <span className="muted">{formatTime(ep.duration_sec)}</span>
                  </button>
                ))}
                {/* 只有一集时也保留结构，按钮禁用避免误解 */}
                <button
                  type="button" // 赋值：更新变量 type 的取值
                  className="btn ghost block small"
                  onClick={nextEpisode}
                  disabled={activeEpisode + 1 >= activeWork.episodes.length}
                >
                  {isZh ? '下一集' : 'Next episode'}
                </button>
              </div>
            )}

            {/* 作品信息：标签与形态 */}
            {activeWork && !activeMine && (
              <div className="theater-meta">{/* 执行当前业务步骤 */}
                <h3 className="theater-side-title">{/* 执行当前业务步骤 */}
                  {activeWork.title}
                  <span className="theater-kind">{/* 执行当前业务步骤 */}
                    {activeWork.kind === 'comic-drama' ? (isZh ? '漫剧' : 'Comic') : (isZh ? 'AI 剧' : 'AI drama')}
                  </span>
                </h3>
                <p className="muted">{activeWork.subtitle}</p>
                <div className="theater-tags">{/* 执行当前业务步骤 */}
                  {activeWork.tags.map((tag) => (
                    <span key={tag} className="theater-tag">{tag}</span>
                  ))}
                </div>
              </div>
            )}

            {/* 本人成片信息 */}
            {activeMine && (
              <div className="theater-meta">{/* 执行当前业务步骤 */}
                <h3 className="theater-side-title">{activeMine.title}</h3>
                <p className="muted">{/* 执行当前业务步骤 */}
                  {activeMine.project_title} · {isZh ? '版本' : 'v'}
                  {activeMine.version_no} · {formatTime(activeMine.duration_sec)}
                </p>
                <button type="button" className="btn ghost block small" onClick={() => setMineActiveId(null)}>{/* 执行当前业务步骤 */}
                  {isZh ? '返回演示片库' : 'Back to showcase'}
                </button>
              </div>
            )}
          </aside>
        </section>
      )}

      {/* 继续观看：有本地进度的作品优先露出，点一下即可续播 */}
      {continueItems.length > 0 && (
        <section className="theater-section">{/* 执行当前业务步骤 */}
          <h3 className="theater-side-title">{isZh ? '继续观看' : 'Continue watching'}</h3>
          <div className="theater-continue">{/* 执行当前业务步骤 */}
            {continueItems.map(({ work, seconds }) => (
              <button key={work.id} type="button" className="theater-continue-card" onClick={() => selectWork(work)}>{/* 执行当前业务步骤 */}
                <img className="theater-cover" src={work.cover} alt={work.title} loading="lazy" />
                <span className="theater-card-body">{/* 执行当前业务步骤 */}
                  <span className="theater-card-title">{work.title}</span>
                  <span className="muted">{isZh ? '已看到 ' : 'At '}{formatTime(seconds)}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 演示片库网格：形态筛选 + 搜索 + 点击卡片切换作品 */}
      <section className="theater-section">{/* 执行当前业务步骤 */}
        <div className="theater-toolbar">{/* 执行当前业务步骤 */}
          <h3 className="theater-side-title">{isZh ? '演示片库' : 'Showcase'}</h3>
          <div className="theater-chips" role="group" aria-label={isZh ? '按形态筛选' : 'Filter by kind'}>{/* 执行当前业务步骤 */}
            {([
              ['all', isZh ? '全部' : 'All'],
              ['comic-drama', isZh ? '漫剧' : 'Comic'],
              ['ai-drama', isZh ? 'AI 剧' : 'AI drama'],
            ] as Array<['all' | 'comic-drama' | 'ai-drama', string]>).map(([key, label]) => (
              <button key={key} type="button" className={kindFilter === key ? 'active' : ''} onClick={() => setKindFilter(key)}>{label}</button>
            ))}
          </div>
          <input className="theater-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={isZh ? '搜索作品 / 标签…' : 'Search title or tag…'} />
        </div>
        <div className="theater-grid">{/* 执行当前业务步骤 */}
          {filteredWorks.length === 0 && <p className="muted">{isZh ? '没有匹配的作品，换个关键词试试。' : 'No matching works. Try another keyword.'}</p>}
          {filteredWorks.map((work) => (
            <button
              key={work.id}
              type="button" // 赋值：更新变量 type 的取值
              className={`theater-card${work.id === activeWorkId && !activeMine ? ' active' : ''}`}
              onClick={() => selectWork(work)}
            >
              <img className="theater-cover" src={work.cover} alt={work.title} loading="lazy" />
              <span className="theater-card-body">{/* 执行当前业务步骤 */}
                <span className="theater-card-title">{work.title}</span>
                <span className="muted">{work.subtitle}</span>
                <span className="theater-card-meta">{/* 执行当前业务步骤 */}
                  <span className="theater-kind">{/* 执行当前业务步骤 */}
                    {work.kind === 'comic-drama' ? (isZh ? '漫剧' : 'Comic') : (isZh ? 'AI 剧' : 'AI drama')}
                  </span>
                  <span className="muted">{isZh ? '共' : ''}{work.episodes.length}{isZh ? '集' : ' ep'}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* 我的作品：登录后可见；空态引导去工作台 */}
      <section className="theater-section">{/* 执行当前业务步骤 */}
        <h3 className="theater-side-title">{isZh ? '我的作品' : 'My films'}</h3>
        {!hasSession ? (
          <p className="muted">{/* 执行当前业务步骤 */}
            {isZh ? '登录后可在这里观看自己生成的漫剧与 AI 剧成片。' : 'Sign in to watch your generated films here.'}
          </p>
        ) : mineError ? (
          <p className="error">{/* 执行当前业务步骤 */}
            {isZh ? '作品加载失败：' : 'Failed to load films: '}
            {mineError}
          </p>
        ) : mine.length === 0 ? (
          <div className="theater-empty">{/* 执行当前业务步骤 */}
            <p className="muted">{/* 执行当前业务步骤 */}
              {isZh ? '还没有可播放的成片：先在创作工作台一键成片，成片会自动出现在这里。' : 'No playable films yet. Generate one in the workbench and it shows up here.'}
            </p>
            <button type="button" className="btn primary small" onClick={onOpenWorkbench}>{/* 执行当前业务步骤 */}
              {isZh ? '去创作工作台' : 'Open workbench'}
            </button>
          </div>
        ) : (
          <div className="theater-grid">{/* 执行当前业务步骤 */}
            {mine.map((item) => (
              <button
                key={item.id}
                type="button" // 赋值：更新变量 type 的取值
                className={`theater-card theater-card-mine${item.id === mineActiveId ? ' active' : ''}`}
                onClick={() => selectMine(item)}
              >
                <span className="theater-card-body">{/* 执行当前业务步骤 */}
                  <span className="theater-card-title">{item.title}</span>
                  <span className="muted">{item.project_title}</span>
                  <span className="theater-card-meta">{/* 执行当前业务步骤 */}
                    <span className="theater-kind">{isZh ? '我的成片' : 'My film'}</span>
                    <span className="muted">v{item.version_no} · {formatTime(item.duration_sec)}</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  ); // 执行当前业务步骤
} // ComicTheater 结束
