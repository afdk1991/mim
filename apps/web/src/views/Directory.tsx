/**
 * 目录与检索中心（2026-11-25 内容结构批次）。
 *
 * 三段筛选：一级板块（community_boards）→ 二级帖子类型（kind）→ 标签 chips；
 * 站内检索聚合板块 / 帖子 / 标签三组结果；归档按近 12 个月分组；作者公开卡只含身份与创作统计。
 *
 * 借鉴落点：
 *   - arXiv 学科树两级分类（https://arxiv.org/list/cs.AI/new）：板块 = 一级学科，kind = 二级类目；
 *   - GitHub 话题聚类（https://github.com/explore）：标签 chips 按关联热度倒序，点击进入话题过滤；
 *   - 豆瓣小组 + 话题双轨（https://www.douban.com/）：板块入口与标签入口并列，检索结果分组呈现；
 *   - 少数派作者署名与身份徽标（https://sspai.com/）：作者卡展示昵称 / 等级 / 徽章数 / 发帖数，可进作者页。
 *
 * 全部接口匿名可读；本视图不发起任何写操作。样式只复用既有类名 + 文件内隔离前缀，不改共享 styles.css。
 */

import { useEffect, useState } from 'react'; // 状态与副作用
import type { Locale } from '@mim/i18n'; // 语言类型
import { api, errorText } from '../api'; // 接口客户端与统一错误文案
import type { CommunityBoard } from '../api'; // 板块类型
import { currentQuery, navigatePath, pathOf, usePathSegments } from '../router'; // 深链接解析与站内导航
import { EmptyState } from '../empty-state'; // 空态共享组件
import { ListSkeleton } from '../components/list-skeleton'; // 既有列表骨架
import { // 目录专属端点（标签 / 作者卡 / 归档 / 分组检索 / 带过滤列表）
  archiveIndex, // 按月归档
  authorProfile, // 作者公开卡
  directorySearch, // 分组检索
  directoryThreads, // 帖子列表（板块 / 类型 / 标签过滤）
  popularTags, // 热门标签
  type ArchiveMonth, // 归档月份分组
  type AuthorProfilePage, // 作者卡响应
  type CommunityTag, // 标签条目
  type DirectorySearchPage, // 分组检索响应
  type DirectoryThreadItem, // 目录帖子列表项
  type SearchBoardHit, // 检索板块命中
  type SearchTagHit, // 检索标签命中
} from '../api/community.js';

/** 二级类型文案：与后端 community_threads.kind 取值一一对应。 */
const KIND_LABELS: Record<string, string> = { // 类型 → 中文名映射
  text: '图文', // 普通图文主题
  video: '视频', // 视频主题
  gallery: '图集', // 图片集主题
  series: '剧集', // 连载剧集
  qa: '问答', // 问答主题
  poll: '投票', // 投票主题
}; // 映射结束

/** 全部二级类型：筛选 chips 按此清单渲染。 */
const KIND_ORDER: string[] = ['text', 'video', 'gallery', 'series', 'qa', 'poll']; // 顺序：图文 → 视频 → 图集 → 剧集 → 问答 → 投票

/** 查询串过滤项：与地址栏 ?board=&kind=&tag=&q=&author= 一一对应。 */
interface DirectoryFilters { // 过滤状态结构
  q: string; // 检索关键词
  board: string; // 板块 slug（空 = 全部）
  kind: string; // 帖子类型（空 = 全部）
  tag: string; // 标签 slug（空 = 全部）
  author: string; // 作者主键（作者卡深链接）
} // 结构结束

/** 从地址栏读取当前过滤项；缺省回落空串。 */
function readFilters(): DirectoryFilters { // 函数 readFilters：查询串归一化
  const qs = currentQuery(); // 当前查询串
  return { // 逐项读取
    q: qs.get('q') ?? '', // 关键词
    board: qs.get('board') ?? '', // 板块
    kind: qs.get('kind') ?? '', // 类型
    tag: qs.get('tag') ?? '', // 标签
    author: qs.get('author') ?? '', // 作者
  }; // 返回结束
} // readFilters 结束

/** 目录视图入参：仅语言，过滤项全部来自地址栏深链接。 */
interface DirectoryProps { // 入参结构
  locale: Locale; // 当前界面语言
} // 入参结束

/** 目录与检索中心主视图。 */
export function Directory({ locale }: DirectoryProps) { // 组件开始
  const segments = usePathSegments(); // 订阅地址栏变化：前进 / 后退 / 编程导航都能刷新过滤项
  const [filters, setFilters] = useState<DirectoryFilters>(readFilters); // 当前过滤项
  const [boards, setBoards] = useState<CommunityBoard[]>([]); // 板块清单（一级分类）
  const [tags, setTags] = useState<CommunityTag[]>([]); // 热门标签（话题聚类入口）
  const [threads, setThreads] = useState<DirectoryThreadItem[]>([]); // 列表模式帖子
  const [threadTotal, setThreadTotal] = useState(0); // 列表模式命中总数
  const [search, setSearch] = useState<DirectorySearchPage | null>(null); // 检索分组结果
  const [archive, setArchive] = useState<ArchiveMonth[]>([]); // 近 12 个月归档
  const [author, setAuthor] = useState<AuthorProfilePage | null>(null); // 作者公开卡
  const [busy, setBusy] = useState(false); // 加载中骨架开关
  const [error, setError] = useState<string | null>(null); // 局部错误提示
  const [draft, setDraft] = useState(''); // 搜索框草稿（未回车前不污染过滤项）

  // 地址栏变化时同步过滤项：segments 是 usePathSegments 的订阅触发信号
  useEffect(() => { // 副作用：路由事件 → 重读查询串
    setFilters(readFilters()); // 回写过滤状态
  }, [segments]); // 依赖路径段变化

  // 板块清单与热门标签：首屏加载，失败静默留空（空态由各分组自行渲染）
  useEffect(() => { // 副作用：一级分类与话题入口
    let alive = true; // 卸载后丢弃异步结果
    void api.community.overview() // 板块清单来自既有公开聚合端点
      .then((overview) => { if (alive) setBoards(overview.boards ?? []); }) // 写入板块
      .catch(() => { if (alive) setBoards([]); }); // 失败保持空清单
    void popularTags({ limit: 30 }) // 热门标签按关联帖数倒序
      .then((page) => { if (alive) setTags(page.items ?? []); }) // 写入标签
      .catch(() => { if (alive) setTags([]); }); // 失败保持空清单
    void archiveIndex() // 近 12 个月归档
      .then((page) => { if (alive) setArchive(page.months ?? []); }) // 写入月份分组
      .catch(() => { if (alive) setArchive([]); }); // 失败保持空归档
    return () => { alive = false; }; // 清理标记
  }, []); // 仅挂载一次

  // 作者深链接：?author=<id> 拉公开卡；作者不存在由接口 404，页面留空态
  useEffect(() => { // 副作用：作者卡数据
    if (!filters.author) { setAuthor(null); return; } // 无作者参数不请求
    let alive = true; // 卸载后丢弃
    void authorProfile(filters.author) // 公开只读
      .then((page) => { if (alive) setAuthor(page); }) // 写入作者卡
      .catch(() => { if (alive) setAuthor(null); }); // 失败不阻断主视图
    return () => { alive = false; }; // 清理标记
  }, [filters.author]); // 作者参数变化时重取

  // 主数据：有关键词走分组检索，否则走带过滤的帖子列表
  useEffect(() => { // 副作用：检索 / 列表二选一加载
    let alive = true; // 卸载后丢弃异步结果
    setBusy(true); // 打开骨架
    setError(null); // 清空旧错误
    if (filters.q) { // 检索分支：板块 / 帖子 / 标签分组
      void directorySearch({ q: filters.q, board: filters.board, limit: 20 })
        .then((page) => { if (!alive) return; setSearch(page); setThreads([]); setThreadTotal(page.counts?.threads ?? page.total ?? 0); }) // 写入分组结果
        .catch((err) => { if (alive) setError(errorText(locale, err)); }) // 失败提示
        .finally(() => { if (alive) setBusy(false); }); // 关闭骨架
    } else { // 列表分支：板块 / 类型 / 标签组合过滤
      void directoryThreads({ board: filters.board, kind: filters.kind, tag: filters.tag, limit: 20 })
        .then((page) => { if (!alive) return; setThreads(page.items ?? []); setThreadTotal(page.total ?? 0); setSearch(null); }) // 写入列表
        .catch((err) => { if (alive) setError(errorText(locale, err)); }) // 失败提示
        .finally(() => { if (alive) setBusy(false); }); // 关闭骨架
    } // 分支结束
    return () => { alive = false; }; // 清理标记
  }, [filters.q, filters.board, filters.kind, filters.tag, locale]); // 过滤项变化时重取

  /** 合并过滤项并写地址栏；子路径部署前缀由 pathOf 统一补。 */
  function push(next: Partial<DirectoryFilters>): void { // 函数 push：更新过滤并导航
    const merged: DirectoryFilters = { ...filters, ...next }; // 合并新旧过滤
    const qs = new URLSearchParams(); // 新查询串
    if (merged.q) qs.set('q', merged.q); // 关键词非空才保留
    if (merged.board) qs.set('board', merged.board); // 板块
    if (merged.kind) qs.set('kind', merged.kind); // 类型
    if (merged.tag) qs.set('tag', merged.tag); // 标签
    if (merged.author) qs.set('author', merged.author); // 作者
    navigatePath(pathOf('directory', '', qs.toString())); // 写入地址栏并广播路由事件
  } // push 结束

  /** 打开帖子详情：跳社区原帖深链接。 */
  function openThread(threadId: string): void { // 函数 openThread：帖子深链接
    navigatePath(pathOf('community', `post/${encodeURIComponent(threadId)}`)); // /community/post/:id
  } // openThread 结束

  /** 进入作者页：作者卡挂在目录视图内，?author=<id> 深链接。 */
  function openAuthor(authorId: string): void { // 函数 openAuthor：作者公开卡深链接
    navigatePath(pathOf('directory', '', `author=${encodeURIComponent(authorId)}`)); // 保留其余过滤项由 push 口径处理
  } // openAuthor 结束

  /** 触发检索：草稿去空白后作为关键词写入过滤项。 */
  function runSearch(): void { // 函数 runSearch：回车 / 点搜索按钮
    push({ q: draft.trim(), tag: '', author: '' }); // 新关键词下清掉标签与作者过滤，避免交集为空
  } // runSearch 结束

  const searching = filters.q.length > 0; // 是否处于检索分组模式

  return (
    <div className="mim-dir">
      <header className="mim-dir-head">
        <h1>{locale === 'en-US' ? 'Directory' : '内容目录'}</h1>
        <p className="mim-dir-hint">{locale === 'en-US' ? 'Browse boards, types and tags; search across threads, boards and tags.' : '按板块、类型、标签浏览；检索覆盖帖子、板块与话题。'}</p>
      </header>

      {/* 作者公开卡：仅 ?author= 深链接进入时展示；点击徽章 / 署名回作者页本身 */}
      {author && (
        <section className="mim-dir-card mim-dir-author-card" aria-label={locale === 'en-US' ? 'Author profile' : '作者公开卡'}>
          <div className="mim-dir-author-main">
            <strong className="mim-dir-author-name">{author.author.display_name}</strong>
            <span className="mim-dir-author-meta">
              {locale === 'en-US' ? 'ID' : 'ID'} {author.author.member_no ?? '—'}
              {' · '}Lv.{author.author.level}
              {' · '}{author.author.post_count} {locale === 'en-US' ? 'posts' : '帖'}
              {' · '}{author.author.total_likes} {locale === 'en-US' ? 'likes' : '获赞'}
              {' · '}{author.author.badge_count} {locale === 'en-US' ? 'badges' : '徽章'}
            </span>
          </div>
          {author.badges.length > 0 && (
            <div className="mim-dir-badges">
              {author.badges.map((badge) => <em key={badge.code} className="mim-dir-badge">{badge.name}</em>)}
            </div>
          )}
        </section>
      )}

      {/* 检索框：关键词 + 分组结果；回车即搜 */}
      <div className="mim-dir-search-row">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }}
          placeholder={locale === 'en-US' ? 'Search threads, boards, tags…' : '搜索帖子、板块、标签…'}
          aria-label={locale === 'en-US' ? 'Search keyword' : '搜索关键词'}
        />
        <button type="button" className="is-primary" onClick={runSearch}>{locale === 'en-US' ? 'Search' : '搜索'}</button>
        {searching && (
          <button type="button" className="is-plain" onClick={() => { setDraft(''); push({ q: '' }); }}>
            {locale === 'en-US' ? 'Clear' : '清除'}
          </button>
        )}
      </div>

      {/* 一级板块筛选：对齐学科树一级类目；「全部」清空 board */}
      <div className="mim-dir-filters">
        <span className="mim-dir-filter-label">{locale === 'en-US' ? 'Boards' : '板块'}</span>
        <div className="mim-dir-chips">
          <button
            type="button"
            className={`mim-dir-chip ${!filters.board ? 'is-active' : ''}`}
            onClick={() => push({ board: '' })}
          >{locale === 'en-US' ? 'All' : '全部'}</button>
          {boards.map((board) => (
            <button
              key={board.slug}
              type="button"
              className={`mim-dir-chip ${filters.board === board.slug ? 'is-active' : ''}`}
              onClick={() => push({ board: board.slug })}
            >{board.name}<em className="mim-dir-chip-count">{board.thread_count}</em></button>
          ))}
        </div>
      </div>

      {/* 二级类型筛选：text/video/gallery/series/qa/poll */}
      <div className="mim-dir-filters">
        <span className="mim-dir-filter-label">{locale === 'en-US' ? 'Type' : '类型'}</span>
        <div className="mim-dir-chips">
          <button
            type="button"
            className={`mim-dir-chip ${!filters.kind ? 'is-active' : ''}`}
            onClick={() => push({ kind: '' })}
          >{locale === 'en-US' ? 'All' : '全部'}</button>
          {KIND_ORDER.map((kind) => (
            <button
              key={kind}
              type="button"
              className={`mim-dir-chip ${filters.kind === kind ? 'is-active' : ''}`}
              onClick={() => push({ kind })}
            >{KIND_LABELS[kind] ?? kind}</button>
          ))}
        </div>
      </div>

      {/* 标签 chips：话题聚类入口，按关联热度倒序；点击带 tag 进入过滤 */}
      <div className="mim-dir-filters">
        <span className="mim-dir-filter-label">{locale === 'en-US' ? 'Tags' : '标签'}</span>
        <div className="mim-dir-chips">
          {tags.length === 0 && <span className="mim-dir-hint">{locale === 'en-US' ? 'No tags yet.' : '暂无标签。'}</span>}
          {tags.map((tag) => (
            <button
              key={tag.slug}
              type="button"
              className={`mim-dir-chip ${filters.tag === tag.slug ? 'is-active' : ''}`}
              onClick={() => push({ tag: filters.tag === tag.slug ? '' : tag.slug })}
            >#{tag.name}<em className="mim-dir-chip-count">{tag.thread_count ?? 0}</em></button>
          ))}
        </div>
      </div>

      {error && <p className="mim-dir-error" role="alert">{error}</p>}

      {busy && <ListSkeleton count={6} variant="row" />}

      {!busy && searching && search && (
        <div className="mim-dir-groups">
          {/* 板块分组：类目入口命中 */}
          <section className="mim-dir-group">
            <h2>{locale === 'en-US' ? `Boards (${search.counts.boards})` : `板块（${search.counts.boards}）`}</h2>
            {search.boards.length === 0 && <EmptyState kind="set" title={locale === 'en-US' ? 'No matching board' : '没有匹配的板块'} />}
            <div className="mim-dir-board-grid">
              {search.boards.map((board: SearchBoardHit) => (
                <button
                  key={board.slug}
                  type="button"
                  className="mim-dir-board"
                  onClick={() => push({ board: board.slug })}
                >
                  <strong>{board.name}</strong>
                  <span className="mim-dir-hint">{board.description || '—'}</span>
                  <em className="mim-dir-chip-count">{board.thread_count} {locale === 'en-US' ? 'posts' : '帖'}</em>
                </button>
              ))}
            </div>
          </section>

          {/* 帖子分组：沿用既有片段高亮 */}
          <section className="mim-dir-group">
            <h2>{locale === 'en-US' ? `Threads (${search.counts.threads})` : `帖子（${search.counts.threads}）`}</h2>
            {search.items.length === 0 && <EmptyState kind="search" title={locale === 'en-US' ? 'No matching thread' : '没有找到相关帖子'} hint={locale === 'en-US' ? 'Try a shorter or different keyword.' : '换个关键词，或缩短搜索词再试一次。'} />}
            <ul className="plain-list">
              {search.items.map((item) => (
                <li key={item.id}>
                  <button type="button" className="mim-dir-thread" onClick={() => openThread(item.id)}>
                    <span className="mim-dir-meta">{item.board_name} · {KIND_LABELS[item.kind] ?? item.kind} · {item.views} {locale === 'en-US' ? 'views' : '浏览'} · {item.reply_count} {locale === 'en-US' ? 'replies' : '回复'}</span>
                    <strong>{item.title}</strong>
                    {item.snippet && <span className="mim-dir-summary" dangerouslySetInnerHTML={{ __html: item.snippet }} />}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* 标签分组：话题命中 */}
          <section className="mim-dir-group">
            <h2>{locale === 'en-US' ? `Tags (${search.counts.tags})` : `标签（${search.counts.tags}）`}</h2>
            {search.tags.length === 0 && <EmptyState kind="set" title={locale === 'en-US' ? 'No matching tag' : '没有匹配的标签'} />}
            <div className="mim-dir-chips">
              {search.tags.map((tag: SearchTagHit) => (
                <button
                  key={tag.slug}
                  type="button"
                  className="mim-dir-chip"
                  onClick={() => push({ tag: tag.slug, q: '' })}
                >#{tag.name}<em className="mim-dir-chip-count">{tag.thread_count}</em></button>
              ))}
            </div>
          </section>
        </div>
      )}

      {!busy && !searching && (
        <section className="mim-dir-group">
          <h2>{locale === 'en-US' ? `Threads (${threadTotal})` : `帖子（${threadTotal}）`}</h2>
          {threads.length === 0 && (
            <EmptyState
              kind="post"
              title={locale === 'en-US' ? 'No threads under current filters' : '当前筛选下没有帖子'}
              hint={locale === 'en-US' ? 'Try another board, type or tag.' : '换个板块、类型或标签看看。'}
            />
          )}
          <ul className="plain-list">
            {threads.map((item: DirectoryThreadItem) => (
              <li key={item.id}>
                <div className="mim-dir-thread">
                  <button type="button" className="mim-dir-thread-main" onClick={() => openThread(item.id)}>
                    <span className="mim-dir-meta">{item.board_name} · {KIND_LABELS[item.kind] ?? item.kind} · {item.views} {locale === 'en-US' ? 'views' : '浏览'} · {item.reply_count} {locale === 'en-US' ? 'replies' : '回复'}</span>
                    <strong>{item.title}</strong>
                    {item.summary && <span className="mim-dir-summary">{item.summary}</span>}
                  </button>
                  {item.tags && item.tags.length > 0 && (
                    <div className="mim-dir-chips mim-dir-thread-tags">
                      {item.tags.map((tag: CommunityTag) => (
                        <button
                          key={tag.slug}
                          type="button"
                          className="mim-dir-chip is-mini"
                          onClick={() => push({ tag: tag.slug })}
                        >#{tag.name}</button>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 归档：近 12 个月，按月折叠；标题直达原帖 */}
      {!busy && archive.length > 0 && (
        <section className="mim-dir-group">
          <h2>{locale === 'en-US' ? 'Archive' : '按月归档'}</h2>
          <div className="mim-dir-archive">
            {archive.map((month) => (
              <details key={month.month} className="mim-dir-archive-month">
                <summary>{month.month}（{month.count}）</summary>
                <ul className="plain-list">
                  {month.items.map((ref) => (
                    <li key={ref.id}>
                      <button type="button" className="mim-dir-archive-link" onClick={() => openThread(ref.id)}>{ref.title}</button>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </section>
      )}

      <style>{`
        .mim-dir { display: flex; flex-direction: column; gap: var(--sp-4, 16px); }
        .mim-dir-head h1 { margin: 0 0 4px; font-size: 1.35rem; }
        .mim-dir-hint { color: var(--text-muted, #888); font-size: .875rem; }
        .mim-dir-search-row { display: flex; gap: var(--sp-2, 8px); flex-wrap: wrap; align-items: center; }
        .mim-dir-search-row input { flex: 1 1 220px; height: var(--control-h, 40px); padding: 0 10px; border: 1px solid var(--border-strong, #ddd); border-radius: var(--control-radius, 10px); background: var(--surface, #fff); font: inherit; }
        .mim-dir-filters { display: flex; gap: var(--sp-2, 8px); flex-wrap: wrap; align-items: flex-start; }
        .mim-dir-filter-label { min-width: 3.5em; color: var(--text-muted, #888); font-size: .875rem; line-height: var(--control-h, 40px); }
        .mim-dir-chips { display: flex; gap: 6px; flex-wrap: wrap; }
        .mim-dir-chip { display: inline-flex; align-items: center; gap: 4px; padding: 6px 10px; border: 1px solid var(--border-strong, #ddd); border-radius: 999px; background: var(--surface, #fff); font-size: .875rem; cursor: pointer; }
        .mim-dir-chip.is-active { border-color: var(--primary, #3d8bff); color: var(--primary, #3d8bff); }
        .mim-dir-chip.is-mini { padding: 3px 8px; font-size: .8rem; }
        .mim-dir-chip-count { font-style: normal; opacity: .6; font-size: .75rem; }
        .mim-dir-card { border: 1px solid var(--border, #eee); border-radius: var(--radius-md, 12px); padding: var(--sp-3, 12px); background: var(--surface, #fff); }
        .mim-dir-author-main { display: flex; flex-direction: column; gap: 4px; }
        .mim-dir-author-name { font-size: 1.05rem; }
        .mim-dir-author-meta { color: var(--text-muted, #888); font-size: .875rem; }
        .mim-dir-badges { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
        .mim-dir-badge { font-style: normal; padding: 2px 8px; border-radius: var(--radius-sm, 6px); background: var(--surface-muted, #f2f2f5); font-size: .75rem; }
        .mim-dir-group { display: flex; flex-direction: column; gap: var(--sp-2, 8px); }
        .mim-dir-group h2 { margin: 0; font-size: 1rem; }
        .mim-dir-board-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--sp-2, 8px); }
        .mim-dir-board { display: flex; flex-direction: column; gap: 4px; padding: var(--sp-3, 12px); border: 1px solid var(--border, #eee); border-radius: var(--radius-md, 12px); background: var(--surface, #fff); text-align: left; cursor: pointer; }
        .mim-dir-thread { display: flex; flex-direction: column; gap: 6px; }
        .mim-dir-thread-main { display: flex; flex-direction: column; gap: 4px; width: 100%; text-align: left; padding: var(--sp-2, 8px); border: none; background: none; cursor: pointer; }
        .mim-dir-meta { color: var(--text-muted, #888); font-size: .75rem; }
        .mim-dir-summary { color: var(--text-muted, #666); font-size: .875rem; }
        .mim-dir-thread-tags { padding-left: var(--sp-2, 8px); }
        .mim-dir-archive { display: flex; flex-direction: column; gap: var(--sp-2, 8px); }
        .mim-dir-archive-month { border: 1px solid var(--border, #eee); border-radius: var(--radius-md, 12px); padding: var(--sp-2, 8px) var(--sp-3, 12px); background: var(--surface, #fff); }
        .mim-dir-archive-month summary { cursor: pointer; }
        .mim-dir-archive-link { background: none; border: none; padding: 4px 0; font: inherit; cursor: pointer; text-align: left; }
        .mim-dir-error { color: var(--danger, #d33); }
      `}</style>
    </div>
  );
} // Directory 结束
