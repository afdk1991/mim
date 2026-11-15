/**
 * 社区图库 / 视频面板（2026-11-15）
 *
 * 边界：
 *   - 图库不等于图床：只做浏览、检索、收藏、按帖 / 按作者聚合；上传仍走社区发帖的预签名链路。
 *   - 视频不等于放映厅：只展示帖子里的视频与封面，不接管漫剧 / AI 剧业务。
 *   - 锁定项由服务端隐藏地址；这里只渲染锁标与「去原帖解锁」。
 */

import { useEffect, useMemo, useState } from 'react'; // 引入依赖、类型或本地模块绑定
import type { Locale } from '@mim/i18n'; // 语言标签
import { errorText } from '../api'; // 统一错误文案
import { favoriteGalleryItem, fetchGalleryCollections, fetchGalleryItems, unfavoriteGalleryItem } from '../api/gallery.js'; // 图库端点
import type { GalleryCollection, GalleryItem } from '../api/gallery.js'; // 图库类型

interface Props { // 接口 Props：约束对象的字段与类型形态
  locale: Locale; // 语言
  kind: 'image' | 'video'; // 面板类型：图库 / 视频
  hasSession: boolean; // 是否登录：收藏需要会话
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

export function CommunityGallery({ locale, kind, hasSession, onOpenThread, onRequireLogin }: Props) { // 组件：图库 / 视频双面板
  const [items, setItems] = useState<GalleryItem[]>([]); // 当前媒体
  const [total, setTotal] = useState(0); // 总数
  const [loading, setLoading] = useState(true); // 加载态
  const [busy, setBusy] = useState(false); // 加载更多 / 收藏
  const [error, setError] = useState<string | null>(null); // 错误提示
  const [notice, setNotice] = useState<string | null>(null); // 成功提示
  const [q, setQ] = useState(''); // 关键词
  const [sort, setSort] = useState<'latest' | 'oldest' | 'favorites'>('latest'); // 排序
  const [favoritedOnly, setFavoritedOnly] = useState(false); // 只看我的收藏
  const [view, setView] = useState<'items' | 'thread' | 'author'>('items'); // 展示维度
  const [collections, setCollections] = useState<GalleryCollection[]>([]); // 聚合结果
  const [collectionsTotal, setCollectionsTotal] = useState(0); // 聚合总数

  const kindLabel = kind === 'video' ? '视频' : '图库'; // 面板标题

  useEffect(() => { // 切换面板或筛选时重新拉取
    let cancelled = false; // 卸载后不再写入状态
    const timer = window.setTimeout(() => { // 搜索输入做 250ms 防抖
      void (async () => { // 异步执行
        setLoading(true); // 进入加载态
        setError(null); // 清空旧错误
        try { // 异常捕获起点
          if (view === 'items') { // 媒体列表
            const page = await fetchGalleryItems({ q: q.trim(), kind, sort, favorited: favoritedOnly, limit: 24 }); // 拉首页
            if (!cancelled) { setItems(page.items); setTotal(page.total); } // 写入
          } else { // 聚合视图
            const page = await fetchGalleryCollections(view, { q: q.trim(), kind, limit: 24 }); // 拉分组
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
  }, [locale, kind, q, sort, favoritedOnly, view]); // 依赖筛选条件

  const shown = useMemo(() => (view === 'items' ? total : collectionsTotal), [view, total, collectionsTotal]); // 当前视图总数

  async function loadMore() { // 加载更多
    if (busy) return; // 防重复
    setBusy(true); // 进入忙碌态
    try { // 异常捕获起点
      if (view === 'items') { // 媒体列表
        const page = await fetchGalleryItems({ q: q.trim(), kind, sort, favorited: favoritedOnly, limit: 24, offset: items.length }); // 下一页
        setItems((prev) => { // 去重追加
          const seen = new Set(prev.map((item) => item.id)); // 已有主键
          return [...prev, ...page.items.filter((item) => !seen.has(item.id))]; // 合并
        }); // 写入
        setTotal(page.total); // 更新总数
      } else { // 聚合视图
        const page = await fetchGalleryCollections(view, { q: q.trim(), kind, limit: 24, offset: collections.length }); // 下一页
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
                  <video src={item.url} poster={item.poster_url || undefined} controls playsInline preload="metadata" />
                ) : (
                  <img src={item.url} alt={item.thread_title} loading="lazy" />
                )}
                {item.kind === 'video' && !item.locked && (durationText(item.duration_seconds) || resolutionText(item.width, item.height)) && (
                  <span className="community-gallery-badge">
                    {[durationText(item.duration_seconds), resolutionText(item.width, item.height)].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
              <div className="community-gallery-body">
                <button type="button" className="community-gallery-title" onClick={() => onOpenThread(item.thread_id)}>{item.thread_title}</button>
                <p>{item.author_name || '匿名作者'} · {item.board_name}</p>
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
            <button key={group.key} type="button" className="community-gallery-collection" onClick={() => onOpenThread(group.thread_id)}>
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
    </div>
  );
}
