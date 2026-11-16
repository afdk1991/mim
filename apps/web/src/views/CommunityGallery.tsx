/**
 * 社区图库 / 视频面板（2026-11-15）
 *
 * 边界：
 *   - 图库不等于图床：只做浏览、检索、收藏、按帖 / 按作者聚合；上传仍走社区发帖的预签名链路。
 *   - 视频不等于放映厅：只展示帖子里的视频与封面，不接管漫剧 / AI 剧业务。
 *   - 锁定项由服务端隐藏地址；这里只渲染锁标与「去原帖解锁」。
 *   - 灯箱只遍历未锁定且有地址的条目，锁定项不进入放大队列。
 */

import { useEffect, useMemo, useState } from 'react'; // 引入依赖、类型或本地模块绑定
import type { Locale } from '@mim/i18n'; // 语言标签
import { errorText } from '../api'; // 统一错误文案
import { favoriteGalleryItem, fetchGalleryCollections, fetchGalleryItems, unfavoriteGalleryItem } from '../api/gallery.js'; // 图库端点
import type { GalleryCollection, GalleryItem } from '../api/gallery.js'; // 图库类型
import './community-gallery.css'; // 灯箱 / 新增筛选控件样式：独立文件，不改共享 styles.css

interface Props { // 接口 Props：约束对象的字段与类型形态
  locale: Locale; // 语言
  kind: 'image' | 'video'; // 面板类型：图库 / 视频
  hasSession: boolean; // 是否登录：收藏需要会话
  boards?: Array<{ slug: string; name: string }>; // 板块下拉：复用社区概览已加载的板块
  onOpenThread: (threadId: string) => void; // 打开原帖
  onRequireLogin: () => void; // 未登录时引导登录
} // 接口结束

/** 视频时长：秒 → m:ss。 */
function durationText(seconds: number): string { // 定义函数 durationText
  if (!seconds || seconds < 0) return ''; // 未知时长不展示
  const m = Math.floor(seconds / 60); // 分钟
  const s = Math.floor(seconds % 60); // 秒
  return `${m}:${String(s).padStart(2, '0')}`; // 归一化到 2 位秒
} // 函数结束

/** 分辨率：宽 × 高，未知返回空串。 */
function resolutionText(width: number, height: number): string { // 定义函数 resolutionText
  if (!width || !height) return ''; // 未知分辨率不展示
  return `${width}×${height}`; // 直接展示像素
} // 函数结束

/** 作者头像占位：取名字首字，没有名字时用「匿」。 */
function authorInitial(name: string): string { // 定义函数 authorInitial
  return (name || '匿').slice(0, 1); // 单字头像
} // 函数结束

export function CommunityGallery({ locale, kind, hasSession, boards = [], onOpenThread, onRequireLogin }: Props) { // 组件：图库 / 视频双面板
  const [items, setItems] = useState<GalleryItem[]>([]); // 当前媒体
  const [total, setTotal] = useState(0); // 总数
  const [loading, setLoading] = useState(true); // 加载态
  const [busy, setBusy] = useState(false); // 加载更多 / 收藏
  const [error, setError] = useState<string | null>(null); // 错误提示
  const [notice, setNotice] = useState<string | null>(null); // 成功提示
  const [q, setQ] = useState(''); // 关键词
  const [sort, setSort] = useState<'latest' | 'oldest' | 'favorites'>('latest'); // 排序
  const [favoritedOnly, setFavoritedOnly] = useState(false); // 只看我的收藏
  const [boardSlug, setBoardSlug] = useState(''); // 板块筛选：与社区论坛的板块状态各自独立
  const [dateFrom, setDateFrom] = useState(''); // 上传时间下界
  const [dateTo, setDateTo] = useState(''); // 上传时间上界
  const [authorFilter, setAuthorFilter] = useState<{ id: string; name: string } | null>(null); // 作者聚合入口
  const [view, setView] = useState<'items' | 'thread' | 'author'>('items'); // 展示维度
  const [collections, setCollections] = useState<GalleryCollection[]>([]); // 聚合结果
  const [collectionsTotal, setCollectionsTotal] = useState(0); // 聚合总数
  const [lightboxId, setLightboxId] = useState<string | null>(null); // 灯箱当前媒体

  const kindLabel = kind === 'video' ? '视频' : '图库'; // 面板标题

  /** 公共筛选条件：面板、关键词、板块、时间区间与作者入口对两个视图一视同仁。 */
  const filters = useMemo(() => ({ // 定义筛选条件
    q: q.trim(), // 关键词
    kind, // 面板类型
    board_slug: boardSlug || undefined, // 板块
    from: dateFrom || undefined, // 时间下界
    to: dateTo || undefined, // 时间上界
    author_id: authorFilter?.id, // 作者聚合入口
  }), [q, kind, boardSlug, dateFrom, dateTo, authorFilter?.id]); // 依赖筛选字段

  useEffect(() => { // 切换面板或筛选时重新拉取
    let cancelled = false; // 卸载后不再写入状态
    const timer = window.setTimeout(() => { // 搜索输入做 250ms 防抖
      void (async () => { // 异步执行
        setLoading(true); // 进入加载态
        setError(null); // 清空旧错误
        try { // 异常捕获起点
          if (view === 'items') { // 媒体列表
            const page = await fetchGalleryItems({ ...filters, sort, favorited: favoritedOnly, limit: 24 }); // 拉首页
            if (!cancelled) { setItems(page.items); setTotal(page.total); } // 写入
          } else { // 聚合视图
            const page = await fetchGalleryCollections(view, { ...filters, limit: 24 }); // 拉分组
            if (!cancelled) { setCollections(page.collections); setCollectionsTotal(page.total); } // 写入
          } // 结束条件分支
        } catch (err) { // 异常捕获
          if (!cancelled) setError(errorText(locale, err)); // 统一文案
        } finally { // 无论成败
          if (!cancelled) setLoading(false); // 退出加载态
        } // 结束异常处理
      })(); // 立即执行
    }, 250); // 防抖时长
    return () => { cancelled = true; window.clearTimeout(timer); }; // 清理
  }, [locale, filters, sort, favoritedOnly, view]); // 依赖筛选条件

  useEffect(() => { setLightboxId(null); }, [filters, sort, favoritedOnly, view]); // 筛选变化后关闭灯箱，避免看到已不属于当前结果集的图

  const shown = useMemo(() => (view === 'items' ? total : collectionsTotal), [view, total, collectionsTotal]); // 当前视图总数

  /** 灯箱队列：只收可见且拿到地址的媒体，锁定项不进放大流。 */
  const viewable = useMemo(() => items.filter((row) => !row.locked && !!row.url), [items]); // 可放大媒体
  const lightboxIndex = lightboxId ? viewable.findIndex((row) => row.id === lightboxId) : -1; // 当前序号
  const lightboxItem = lightboxIndex >= 0 ? viewable[lightboxIndex] : null; // 当前媒体

  /** 左右翻：首尾循环，队列只有一项时原地不动。 */
  function stepLightbox(delta: number) { // 定义函数 stepLightbox
    if (lightboxIndex < 0 || viewable.length === 0) return; // 无队列直接返回
    const next = (lightboxIndex + delta + viewable.length) % viewable.length; // 循环取模
    setLightboxId(viewable[next].id); // 切换
  } // 函数结束

  useEffect(() => { // 灯箱键盘：Esc 关闭，左右方向键翻页
    if (!lightboxItem) return; // 未打开不挂监听
    const onKey = (event: KeyboardEvent) => { // 键盘处理
      if (event.key === 'Escape') { event.preventDefault(); setLightboxId(null); } // Esc 关闭
      else if (event.key === 'ArrowLeft') { event.preventDefault(); stepLightbox(-1); } // 上一张
      else if (event.key === 'ArrowRight') { event.preventDefault(); stepLightbox(1); } // 下一张
    }; // 处理结束
    window.addEventListener('keydown', onKey); // 绑定
    return () => window.removeEventListener('keydown', onKey); // 解绑
  }, [lightboxItem, lightboxIndex, viewable]); // 队列变化时重绑

  /** 进入作者聚合：复用既有 collections 路由，不新增接口。 */
  function openAuthor(authorId: string | null, authorName: string) { // 定义函数 openAuthor
    if (!authorId) return; // 无作者 id（匿名内容）不提供聚合
    setAuthorFilter({ id: authorId, name: authorName || '该作者' }); // 记住作者
    setView('thread'); // 用「按帖子」维度展示该作者的内容
  } // 函数结束

  async function loadMore() { // 加载更多
    if (busy) return; // 防重复
    setBusy(true); // 进入忙碌态
    try { // 异常捕获起点
      if (view === 'items') { // 媒体列表
        const page = await fetchGalleryItems({ ...filters, sort, favorited: favoritedOnly, limit: 24, offset: items.length }); // 下一页
        setItems((prev) => { // 去重追加
          const seen = new Set(prev.map((item) => item.id)); // 已有主键
          return [...prev, ...page.items.filter((item) => !seen.has(item.id))]; // 合并
        }); // 写入
        setTotal(page.total); // 更新总数
      } else { // 聚合视图
        const page = await fetchGalleryCollections(view, { ...filters, limit: 24, offset: collections.length }); // 下一页
        setCollections((prev) => [...prev, ...page.collections]); // 追加
        setCollectionsTotal(page.total); // 更新总数
      } // 结束条件分支
    } catch (err) { // 异常捕获
      setError(errorText(locale, err)); // 统一文案
    } finally { // 无论成败
      setBusy(false); // 退出忙碌态
    } // 结束异常处理
  } // 函数结束

  async function toggleFavorite(item: GalleryItem) { // 收藏 / 取消收藏
    if (!hasSession) { onRequireLogin(); return; } // 未登录先引导
    if (item.locked) { onOpenThread(item.thread_id); return; } // 锁定项先去原帖解锁
    setBusy(true); // 防重复
    try { // 异常捕获起点
      const result = item.favorited ? await unfavoriteGalleryItem(item.id) : await favoriteGalleryItem(item.id); // 切换
      setItems((prev) => prev.map((row) => (row.id === item.id // 同步本地状态
        ? { ...row, favorited: result.favorited, favorite_count: Math.max(0, row.favorite_count + (result.favorited ? 1 : -1)) } // 更新计数
        : row))); // 结束映射
      setNotice(result.favorited ? '已加入收藏' : '已取消收藏'); // 提示
    } catch (err) { // 异常捕获
      setError(errorText(locale, err)); // 统一文案
    } finally { // 无论成败
      setBusy(false); // 退出忙碌态
    } // 结束异常处理
  } // 函数结束

  return (
    <div className="community-gallery">
      <div className="community-section-head">
        <div>
          <h2>{kindLabel}</h2>
          <p>{kind === 'video' ? '社区帖子里的视频，锁定内容需先解锁原帖。' : '社区帖子里的图片，可检索、收藏，并按帖或作者聚合。'}</p>
        </div>
        <span className="community-gallery-count">共 {shown} {view === 'items' ? '条' : '组'}</span>
      </div>

      <div className="community-gallery-toolbar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === 'video' ? '搜索视频标题 / 作者' : '搜索图片标题 / 作者'} />
        <select value={boardSlug} onChange={(e) => setBoardSlug(e.target.value)} aria-label="按板块筛选">
          <option value="">全部板块</option>
          {boards.map((row) => <option key={row.slug} value={row.slug}>{row.name}</option>)}
        </select>
        <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} aria-label="上传时间下界" />
        <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} aria-label="上传时间上界" />
        <select value={view} onChange={(e) => setView(e.target.value as 'items' | 'thread' | 'author')}>
          <option value="items">全部媒体</option>
          <option value="thread">按帖子</option>
          <option value="author">按作者</option>
        </select>
        {view === 'items' && (
          <select value={sort} onChange={(e) => setSort(e.target.value as 'latest' | 'oldest' | 'favorites')}>
            <option value="latest">最新</option>
            <option value="oldest">最早</option>
            <option value="favorites">收藏最多</option>
          </select>
        )}
        {view === 'items' && (
          <button
            type="button"
            className={favoritedOnly ? 'is-active' : ''}
            onClick={() => { if (!hasSession) { onRequireLogin(); return; } setFavoritedOnly((v) => !v); }}
          >
            {favoritedOnly ? '看全部' : '我的收藏'}
          </button>
        )}
        {authorFilter && (
          <button type="button" className="is-active" onClick={() => setAuthorFilter(null)}>
            作者：{authorFilter.name} ×
          </button>
        )}
      </div>

      {(error || notice) && (
        <div className="community-flash">
          {error && <span className="is-error">{error}</span>}
          {notice && <span>{notice}</span>}
          <button type="button" onClick={() => { setError(null); setNotice(null); }}>关闭</button>
        </div>
      )}

      {loading && <div className="community-empty">正在加载{kindLabel}…</div>}
      {!loading && view === 'items' && items.length === 0 && <div className="community-empty">暂无{kindLabel}内容。</div>}
      {!loading && view !== 'items' && collections.length === 0 && <div className="community-empty">暂无可聚合的{kindLabel}内容。</div>}

      {!loading && view === 'items' && items.length > 0 && (
        <div className="community-gallery-grid">
          {items.map((item) => (
            <article key={item.id} className={`community-gallery-card${item.locked ? ' is-locked' : ''}`}>
              <div className="community-gallery-media">
                {item.locked ? (
                  <button type="button" className="community-gallery-lock" onClick={() => onOpenThread(item.thread_id)}>
                    <span>付费内容</span>
                    <strong>解锁后可查看</strong>
                  </button>
                ) : item.kind === 'video' ? (
                  <>
                    <video src={item.url} poster={item.poster_url || undefined} controls playsInline preload="metadata" />
                    <button type="button" className="community-gallery-expand" onClick={() => setLightboxId(item.id)} aria-label="放大查看">⤢</button>
                  </>
                ) : (
                  <button type="button" className="community-gallery-open" onClick={() => setLightboxId(item.id)} aria-label={`放大查看 ${item.thread_title}`}>
                    <img src={item.url} alt={item.thread_title} loading="lazy" />
                  </button>
                )}
                {item.kind === 'video' && !item.locked && (durationText(item.duration_seconds) || resolutionText(item.width, item.height)) && (
                  <span className="community-gallery-badge">
                    {[durationText(item.duration_seconds), resolutionText(item.width, item.height)].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
              <div className="community-gallery-body">
                <button type="button" className="community-gallery-title" onClick={() => onOpenThread(item.thread_id)}>{item.thread_title}</button>
                <p className="community-gallery-meta">
                  {item.author_id ? (
                    <button type="button" className="community-gallery-author" onClick={() => openAuthor(item.author_id, item.author_name)} title={`查看 ${item.author_name || '该作者'} 的内容`}>
                      <span className="community-gallery-avatar" aria-hidden="true">{authorInitial(item.author_name)}</span>
                      <span>{item.author_name || '匿名作者'}</span>
                    </button>
                  ) : (
                    <span>{item.author_name || '匿名作者'}</span>
                  )}
                  <span> · {item.board_name}</span>
                </p>
                <div className="community-gallery-actions">
                  <button type="button" onClick={() => void toggleFavorite(item)} disabled={busy}>
                    {item.locked ? '去解锁' : item.favorited ? '★ 已收藏' : '☆ 收藏'}
                  </button>
                  <span>{item.favorite_count} 收藏</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {!loading && view !== 'items' && collections.length > 0 && (
        <div className="community-gallery-collections">
          {collections.map((group) => (
            <button
              key={group.key}
              type="button"
              className="community-gallery-collection"
              onClick={() => { if (view === 'author' && group.author_id) openAuthor(group.author_id, group.author_name); else onOpenThread(group.thread_id); }}
            >
              {group.cover_url ? <img src={group.cover_url} alt={group.label} loading="lazy" /> : <span className="community-gallery-collection-fallback">{group.count}</span>}
              <div>
                <strong>{group.label}</strong>
                <em>{group.count} 个{kindLabel === '视频' ? '视频' : '图片'}{view === 'author' && group.author_name ? ` · ${group.author_name}` : ''}</em>
              </div>
            </button>
          ))}
        </div>
      )}

      {!loading && ((view === 'items' && items.length < total) || (view !== 'items' && collections.length < collectionsTotal)) && (
        <button type="button" className="community-gallery-more" onClick={() => void loadMore()} disabled={busy}>
          {busy ? '加载中…' : '加载更多'}
        </button>
      )}

      {lightboxItem && (
        <div className="community-lightbox" role="dialog" aria-modal="true" onClick={() => setLightboxId(null)}>
          <button type="button" className="community-lightbox-close" onClick={() => setLightboxId(null)} aria-label="关闭">×</button>
          {viewable.length > 1 && (
            <button type="button" className="community-lightbox-nav is-prev" onClick={(e) => { e.stopPropagation(); stepLightbox(-1); }} aria-label="上一张">‹</button>
          )}
          <figure className="community-lightbox-stage" onClick={(e) => e.stopPropagation()}>
            {lightboxItem.kind === 'video' ? (
              <video src={lightboxItem.url} poster={lightboxItem.poster_url || undefined} controls autoPlay playsInline />
            ) : (
              <img src={lightboxItem.url} alt={lightboxItem.thread_title} />
            )}
            <figcaption className="community-lightbox-caption">
              <strong>{lightboxItem.thread_title}</strong>
              <span>{lightboxIndex + 1} / {viewable.length}</span>
            </figcaption>
          </figure>
          {viewable.length > 1 && (
            <button type="button" className="community-lightbox-nav is-next" onClick={(e) => { e.stopPropagation(); stepLightbox(1); }} aria-label="下一张">›</button>
          )}
        </div>
      )}
    </div>
  );
}
