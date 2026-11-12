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
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ProgressMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
} // readProgress 结束

/** 写入单个进度：静默失败，播放本身不受影响 */
function writeProgress(key: string, seconds: number): void {
  try {
    const map = readProgress();
    map[key] = Math.max(0, Math.round(seconds));
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
  } catch {
    /* 本地存储不可用（隐私模式 / 配额满）时忽略，不阻塞播放 */
  }
} // writeProgress 结束

/** 秒数格式化为 mm:ss，用于列表与进度提示 */
function formatTime(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
} // formatTime 结束

interface Props {
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
        if (cancelled) return;
        // 服务端下发相对片源：同源部署直接可用，跨源托管补 API 源后再播放
        const resolved = res.items.map((work) => ({
          ...work,
          cover: resolvePublicUrl(work.cover),
          episodes: work.episodes.map((ep) => ({ ...ep, src: resolvePublicUrl(ep.src) })),
        }));
        setWorks(resolved);
        // 默认选中第一部作品的第一集，让访客打开就能看
        const first = resolved[0];
        if (first) {
          setActiveWorkId(first.id);
          setActiveEpisode(0);
        }
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []); // 仅挂载时拉取一次

  // 我的作品：仅在已登录时请求；失败时给出提示但不影响演示片库
  useEffect(() => {
    if (!hasSession) {
      setMine([]);
      return;
    }
    let cancelled = false; // 卸载保护
    api.comic
      .theater()
      .then((res) => {
        if (!cancelled) {
          // 预签名地址可能是相对路径（本地存储驱动），统一归一化后再交给播放器
          setMine(res.items.map((item) => ({ ...item, src: resolvePublicUrl(item.src) })));
          setMineError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setMineError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [hasSession]); // 登录态变化时重取

  // 当前播放源：优先本人成片（选中即播放），否则演示作品当前集
  const activeWork = works.find((w) => w.id === activeWorkId) ?? null; // 选中的演示作品
  const activeMine = mine.find((m) => m.id === mineActiveId) ?? null; // 选中的本人成片
  const source: PlaySource | null = useMemo(() => {
    if (activeMine) {
      return {
        key: `mine:${activeMine.id}`,
        title: activeMine.title,
        subtitle: `${activeMine.project_title} · v${activeMine.version_no}`,
        src: activeMine.src,
      };
    }
    if (!activeWork) return null;
    const ep = activeWork.episodes[activeEpisode] ?? activeWork.episodes[0];
    if (!ep) return null;
    return {
      key: `show:${activeWork.id}:${ep.no}`,
      title: ep.title,
      subtitle: activeWork.title,
      src: ep.src,
      poster: activeWork.cover,
    };
  }, [activeMine, activeWork, activeEpisode]); // 依赖当前选择

  // 片库筛选：形态 + 标题/标签搜索，结果仍保持服务端原始顺序
  const filteredWorks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return works.filter((work) => {
      if (kindFilter !== 'all' && work.kind !== kindFilter) return false;
      if (!q) return true;
      return `${work.title} ${work.subtitle} ${work.tags.join(' ')}`.toLowerCase().includes(q);
    });
  }, [works, kindFilter, query]);

  // 继续观看：本地有播放进度的作品，按进度倒序，最多展示 4 部
  const continueItems = useMemo(() => {
    const progress = readProgress();
    return works
      .map((work) => {
        const first = work.episodes[0];
        return { work, seconds: first ? progress[`show:${work.id}:${first.no}`] ?? 0 : 0 };
      })
      .filter((item) => item.seconds > 0)
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 4);
  }, [works]);

  // 打开新播放源时：读出上次进度，等元数据加载后跳转
  useEffect(() => {
    if (!source) return;
    const saved = readProgress()[source.key] ?? 0;
    setResumeAt(saved);
  }, [source?.key]); // 仅当播放源切换时读取

  // 元数据就绪：恢复到上次位置（接近结尾则从头开始）
  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video || !resumeAt) return;
    if (Number.isFinite(video.duration) && resumeAt < video.duration - 2) {
      video.currentTime = resumeAt;
    }
  }, [resumeAt]); // 依赖恢复位置

  // 播放进度落盘：每 5 秒最多写一次，避免高频 localStorage 写入
  const lastSaved = useRef(0); // 上次落盘时间（秒）
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || !source) return;
    if (Math.abs(video.currentTime - lastSaved.current) < 5) return;
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
    if (!activeWork) return;
    if (activeEpisode + 1 < activeWork.episodes.length) setActiveEpisode(activeEpisode + 1);
  } // nextEpisode 结束

  // 首屏加载失败：展示可重试的错误提示
  if (loading && works.length === 0) {
    return <div className="hint">{isZh ? '正在加载放映厅…' : 'Loading theater…'}</div>;
  }
  if (error && works.length === 0) {
    return (
      <div className="error">
        {isZh ? '放映厅加载失败：' : 'Failed to load theater: '}
        {error}
      </div>
    );
  }

  return (
    <div className="theater">
      {/* 顶部说明：明确这里就是看片入口 */}
      <header className="theater-head">
        <div>
          <h2 className="theater-title">{isZh ? '放映厅' : 'Theater'}</h2>
          <p className="muted">
            {isZh
              ? '直接播放漫剧与 AI 剧成片；演示片源开放授权，登录后还能看自己的作品。'
              : 'Watch comic dramas and AI dramas directly. Demo reels are openly licensed; sign in to watch your own films.'}
          </p>
        </div>
        {/* 匿名时展示登录入口，登录后可看「我的作品」 */}
        {!hasSession && (
          <button type="button" className="btn primary small" onClick={onSignIn}>
            {isZh ? '登录看我的作品' : 'Sign in for my films'}
          </button>
        )}
      </header>

      {/* 播放器 + 剧集信息：左侧画面，右侧剧集与简介 */}
      {source && (
        <section className="theater-stage">
          <div className="theater-player-wrap">
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
                if (!activeMine && activeWork && activeEpisode + 1 < activeWork.episodes.length) {
                  setActiveEpisode(activeEpisode + 1);
                }
              }}
              onPause={() => videoRef.current && source && writeProgress(source.key, videoRef.current.currentTime)}
            />
            <div className="theater-now">
              <span className="theater-now-title">{source.title}</span>
              <span className="theater-now-sub">{source.subtitle}</span>
            </div>
          </div>

          <aside className="theater-side">
            {/* 演示作品的集数切换；本人成片不显示集数 */}
            {activeWork && !activeMine && (
              <div className="theater-episodes">
                <h3 className="theater-side-title">{isZh ? '剧集' : 'Episodes'}</h3>
                {activeWork.episodes.map((ep, index) => (
                  <button
                    key={ep.no}
                    type="button"
                    className={`theater-ep${index === activeEpisode ? ' active' : ''}`}
                    onClick={() => setActiveEpisode(index)}
                  >
                    <span>{ep.title}</span>
                    <span className="muted">{formatTime(ep.duration_sec)}</span>
                  </button>
                ))}
                {/* 只有一集时也保留结构，按钮禁用避免误解 */}
                <button
                  type="button"
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
              <div className="theater-meta">
                <h3 className="theater-side-title">
                  {activeWork.title}
                  <span className="theater-kind">
                    {activeWork.kind === 'comic-drama' ? (isZh ? '漫剧' : 'Comic') : (isZh ? 'AI 剧' : 'AI drama')}
                  </span>
                </h3>
                <p className="muted">{activeWork.subtitle}</p>
                <div className="theater-tags">
                  {activeWork.tags.map((tag) => (
                    <span key={tag} className="theater-tag">{tag}</span>
                  ))}
                </div>
              </div>
            )}

            {/* 本人成片信息 */}
            {activeMine && (
              <div className="theater-meta">
                <h3 className="theater-side-title">{activeMine.title}</h3>
                <p className="muted">
                  {activeMine.project_title} · {isZh ? '版本' : 'v'}
                  {activeMine.version_no} · {formatTime(activeMine.duration_sec)}
                </p>
                <button type="button" className="btn ghost block small" onClick={() => setMineActiveId(null)}>
                  {isZh ? '返回演示片库' : 'Back to showcase'}
                </button>
              </div>
            )}
          </aside>
        </section>
      )}

      {/* 继续观看：有本地进度的作品优先露出，点一下即可续播 */}
      {continueItems.length > 0 && (
        <section className="theater-section">
          <h3 className="theater-side-title">{isZh ? '继续观看' : 'Continue watching'}</h3>
          <div className="theater-continue">
            {continueItems.map(({ work, seconds }) => (
              <button key={work.id} type="button" className="theater-continue-card" onClick={() => selectWork(work)}>
                <img className="theater-cover" src={work.cover} alt={work.title} loading="lazy" />
                <span className="theater-card-body">
                  <span className="theater-card-title">{work.title}</span>
                  <span className="muted">{isZh ? '已看到 ' : 'At '}{formatTime(seconds)}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 演示片库网格：形态筛选 + 搜索 + 点击卡片切换作品 */}
      <section className="theater-section">
        <div className="theater-toolbar">
          <h3 className="theater-side-title">{isZh ? '演示片库' : 'Showcase'}</h3>
          <div className="theater-chips" role="group" aria-label={isZh ? '按形态筛选' : 'Filter by kind'}>
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
        <div className="theater-grid">
          {filteredWorks.length === 0 && <p className="muted">{isZh ? '没有匹配的作品，换个关键词试试。' : 'No matching works. Try another keyword.'}</p>}
          {filteredWorks.map((work) => (
            <button
              key={work.id}
              type="button"
              className={`theater-card${work.id === activeWorkId && !activeMine ? ' active' : ''}`}
              onClick={() => selectWork(work)}
            >
              <img className="theater-cover" src={work.cover} alt={work.title} loading="lazy" />
              <span className="theater-card-body">
                <span className="theater-card-title">{work.title}</span>
                <span className="muted">{work.subtitle}</span>
                <span className="theater-card-meta">
                  <span className="theater-kind">
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
      <section className="theater-section">
        <h3 className="theater-side-title">{isZh ? '我的作品' : 'My films'}</h3>
        {!hasSession ? (
          <p className="muted">
            {isZh ? '登录后可在这里观看自己生成的漫剧与 AI 剧成片。' : 'Sign in to watch your generated films here.'}
          </p>
        ) : mineError ? (
          <p className="error">
            {isZh ? '作品加载失败：' : 'Failed to load films: '}
            {mineError}
          </p>
        ) : mine.length === 0 ? (
          <div className="theater-empty">
            <p className="muted">
              {isZh ? '还没有可播放的成片：先在创作工作台一键成片，成片会自动出现在这里。' : 'No playable films yet. Generate one in the workbench and it shows up here.'}
            </p>
            <button type="button" className="btn primary small" onClick={onOpenWorkbench}>
              {isZh ? '去创作工作台' : 'Open workbench'}
            </button>
          </div>
        ) : (
          <div className="theater-grid">
            {mine.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`theater-card theater-card-mine${item.id === mineActiveId ? ' active' : ''}`}
                onClick={() => selectMine(item)}
              >
                <span className="theater-card-body">
                  <span className="theater-card-title">{item.title}</span>
                  <span className="muted">{item.project_title}</span>
                  <span className="theater-card-meta">
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
  );
} // ComicTheater 结束
