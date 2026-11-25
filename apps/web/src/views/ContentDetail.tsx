/**
 * 社区内容详情页（深链接）：
 *   - /community/news/announcement/:id 公告
 *   - /community/news/changelog/:id    更新日志
 *   - /community/news/feed/:id         原 /news 统一内容流条目
 * 数据仍来自既有公开只读接口（/announcements、/changelog、/content/items），
 * 不新增数据源、不复制静态文案；条目缺失时给出可返回的提示而不是白屏。
 * 论坛帖子详情由 Community 自身渲染（/community/post/:id），此处只负责资讯类内容。
 */

import { useEffect, useState } from 'react'; // 状态与副作用
import type { Locale } from '@mim/i18n'; // 语言类型
import { api } from '../api'; // 接口客户端
import { authorProfile, threadDetail, type CommunityTag } from '../api/community.js'; // 论坛帖子详情 + 作者公开卡：内容流来源为 community_thread 时补齐媒体、作者与标签口径
import { resolvePublicUrl } from '../api/request.js'; // 公开地址归一化：API 签名链接与 Web 静态产物分流
import type { CommunityThreadMedia } from '../api'; // 帖子媒体（图片 / 视频 + 时长与分辨率）
import { navigatePath, pathOf } from '../router'; // 站内导航与深链接构造
import { EmptyState } from '../empty-state'; // 空态共享组件：插图 + 标题 + 说明 + 操作槽位

/** 资讯类内容形态：公告 / 更新日志 / 统一内容流。 */
export type ContentKind = 'announcement' | 'changelog' | 'feed';

/** 归一化后的详情视图模型：三种数据源统一成同一份渲染结构。 */
interface DetailItem {
  id: string; // 主键
  title: string; // 标题
  body: string; // 正文
  meta: string; // 元信息行（来源 / 版本 / 时间）
  link?: { label: string; path: string }; // 关联入口（如论坛原帖）
  media?: CommunityThreadMedia[]; // 论坛来源的图片 / 视频（锁定帖为空）
  priceCents?: number; // 原帖定价（分），用于锁定提示
  author?: { id: string; name: string; level: number; badgeCount: number; postCount: number } | null; // 作者公开卡：昵称 / 等级 / 徽章数 / 发帖数，点击进作者页
  tags?: CommunityTag[]; // 该帖标签 chips：点击带 tag 跳到目录检索
}

interface Props {
  locale: Locale; // 当前界面语言
  kind: string; // 路径中的形态段，非法值按缺失处理
  id: string; // 条目主键
}

/** 按语言取文案。 */
function tr(locale: Locale, zh: string, en: string): string {
  return locale === 'en-US' ? en : zh; // 返回当前函数的处理结果
} // tr 结束

/** ISO 时间截取到分钟；非法时间回落空串。 */
function fmtTime(iso?: string | null): string {
  if (!iso) return ''; // 无时间
  const time = Date.parse(iso); // 时间戳
  return Number.isNaN(time) ? '' : new Date(time).toISOString().slice(0, 16).replace('T', ' '); // 返回当前函数的处理结果
} // fmtTime 结束

/** 内容流来源文案。 */
function feedSourceLabel(locale: Locale, source: string): string {
  if (source === 'circle_post') return tr(locale, '圈子动态', 'Circle post'); // 圈子动态
  if (source === 'circle_notice') return tr(locale, '圈内公告', 'Circle notice'); // 圈内公告
  return tr(locale, '论坛主题', 'Forum thread'); // 默认论坛主题
} // feedSourceLabel 结束

/** 正文里是否是图片地址（用于直接渲染图片）。 */
const IMAGE_LINE = /^https?:\/\/\S+\.(?:png|jpe?g|gif|webp|svg)(?:\?\S*)?$/i;

/** 正文里是否是视频地址（用于直接渲染播放器）。 */
const VIDEO_LINE = /^https?:\/\/\S+\.(?:mp4|webm|mov|m4v)(?:\?\S*)?$/i;

/** 媒体地址归一化：绝对地址原样用，签名链接 / 静态素材由统一解析器分流补前缀。 */
function mediaSrc(url: string): string {
  if (!url) return ''; // 空串交给调用方按无地址处理
  return resolvePublicUrl(url); // /api/ 签名链接补 API 源，/catalog、/demo 等静态路径补站点前缀
} // mediaSrc 结束

/** 视频时长：秒 → m:ss；未知返回空串。 */
function durationText(seconds?: number): string {
  if (!seconds || seconds < 0) return ''; // 未知时长不展示
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; // 归一化到 2 位秒
} // durationText 结束

/** 帖子媒体网格：图片直接展示，视频带封面、时长与分辨率。 */
function ThreadMedia({ media, title }: { media: CommunityThreadMedia[]; title: string }) {
  return (
    <div className="community-media">
      {media.map((item, index) => (
        <div key={`${item.url}-${index}`} className={`community-media-item is-${item.kind}`}>
          {item.kind === 'video' ? (
            <>
              <video src={mediaSrc(item.url)} poster={item.poster_url ? mediaSrc(item.poster_url) : undefined} controls playsInline preload="metadata" />
              {(durationText(item.duration_seconds) || (item.width && item.height)) && (
                <div className="community-media-meta">
                  {[durationText(item.duration_seconds), item.width && item.height ? `${item.width}×${item.height}` : ''].filter(Boolean).join(' · ')}
                </div>
              )}
            </>
          ) : (
            <img src={mediaSrc(item.url)} alt={`${title} ${index + 1}`} loading="lazy" />
          )}
        </div>
      ))}
    </div>
  );
} // ThreadMedia 结束

/** 单行富文本：图片 / 视频直出，普通行内链接可点击，其余按纯文本。 */
function RichLine({ line }: { line: string }) {
  const trimmed = line.trim(); // 去掉首尾空白
  if (VIDEO_LINE.test(trimmed)) { // 视频直链
    return <video className="rich-video" src={trimmed} controls playsInline preload="metadata" />; // 直接播放
  } // 视频分支结束
  if (IMAGE_LINE.test(trimmed)) { // 图片直链
    return <img className="rich-image" src={trimmed} alt="" loading="lazy" />; // 直接展示图片
  } // 图片分支结束
  const parts = line.split(/(https?:\/\/[^\s]+)/g); // 按链接切分
  return (
    <p>
      {parts.map((part, index) => (
        /^https?:\/\//.test(part)
          ? <a key={index} href={part} target="_blank" rel="noreferrer">{part}</a>
          : <span key={index}>{part}</span>
      ))}
    </p>
  );
} // RichLine 结束

/** 富文本正文：支持 ``` 代码块、图片直链与行内链接。 */
export function RichBody({ text }: { text: string }) {
  const blocks = (text ?? '').replace(/\r\n/g, '\n').split(/```/); // 奇数段为代码块
  return (
    <div className="rich-body">
      {blocks.map((block, index) => (
        index % 2 === 1
          ? <pre key={index}><code>{block.replace(/^[a-zA-Z0-9_-]*\n/, '')}</code></pre>
          : (
            <div key={index}>
              {block.split('\n').filter((line) => line.trim()).map((line, lineIndex) => (
                <RichLine key={lineIndex} line={line} />
              ))}
            </div>
          )
      ))}
    </div>
  );
} // RichBody 结束

/** 返回列表的目标地址：保留公告动态页签与对应子页签。 */
function backPath(kind: string): string {
  const panel = kind === 'feed' ? 'feed' : kind === 'changelog' ? 'changelog' : 'announcements'; // 子页签
  return pathOf('community', '', `ctab=${panel}`); // 落到公告动态对应子页签
} // backPath 结束

/** 资讯条目详情页。 */
export function ContentDetail({ locale, kind, id }: Props) {
  const [item, setItem] = useState<DetailItem | null>(null); // 归一化后的条目
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'failed'>('loading'); // 加载状态：失败与「条目不存在」分开，失败可重试
  const [attempt, setAttempt] = useState(0); // 重试计数：变化时重新触发加载

  useEffect(() => {
    let alive = true; // 卸载后不再写状态
    const load = async (): Promise<DetailItem | null> => {
      if (kind === 'announcement') { // 公告：公开清单中按 id 查找
        const { items } = await api.content.announcements(50);
        const hit = items.find((entry) => entry.id === id);
        return hit ? { id: hit.id, title: hit.title, body: hit.body, meta: `${tr(locale, '公告', 'Announcement')} · ${fmtTime(hit.published_at)}` } : null;
      } // 公告分支结束
      if (kind === 'changelog') { // 更新日志：公开清单中按 id 查找
        const { items } = await api.content.changelog(50);
        const hit = items.find((entry) => entry.id === id);
        return hit ? { id: hit.id, title: hit.title, body: hit.body, meta: `${tr(locale, '更新日志', 'Changelog')} · ${hit.version} · ${fmtTime(hit.published_at)}` } : null;
      } // 日志分支结束
      if (kind === 'feed') { // 统一内容流：论坛 / 圈子动态
        const { items } = await api.content.feed(100);
        const hit = items.find((entry) => entry.id === id);
        if (!hit) return null; // 条目不存在
        const detail: DetailItem = {
          id: hit.id,
          title: hit.title,
          body: hit.body || hit.summary,
          meta: `${feedSourceLabel(locale, hit.source)} · ${fmtTime(hit.created_at)}`,
          // 论坛主题可直达原帖详情；圈子内容暂无独立详情页，不伪造入口
          link: hit.source === 'community_thread'
            ? { label: tr(locale, '查看原帖与评论', 'Open thread and comments'), path: pathOf('community', `post/${encodeURIComponent(hit.source_id)}`) }
            : undefined,
        }; // 详情收口
        if (hit.source === 'community_thread') { // 原帖媒体：与帖子详情同一份付费墙口径
          try { // 原帖不可读时退回内容流摘要，不影响正文展示
            const page = await threadDetail(hit.source_id); // 详情已按解锁态隐藏锁定媒体
            detail.media = page.thread.media ?? []; // 图片 / 视频（含时长与分辨率）
            detail.priceCents = page.thread.price_cents ?? 0; // 用于锁定提示
            detail.tags = (page.thread as { tags?: CommunityTag[] }).tags ?? []; // 标签 chips（元信息不随付费墙隐藏）
            const authorId = page.thread.author_id; // 作者主键：存在才拉公开卡
            if (authorId) { // 作者卡只读聚合：昵称 / 等级 / 徽章数 / 发帖数
              try { // 作者接口失败不阻断正文
                const profile = await authorProfile(authorId); // 公开端点，匿名可读
                detail.author = { // 组装作者卡视图模型
                  id: profile.author.id, // 内部主键（深链接用）
                  name: profile.author.display_name, // 昵称
                  level: profile.author.level, // 等级
                  badgeCount: profile.author.badge_count, // 徽章数
                  postCount: profile.author.post_count, // 发帖数
                }; // 组装结束
              } catch { /* 作者卡缺失：正文照常展示 */ }
            } // 作者拉取结束
          } catch { /* 详情接口失败不阻断，保留摘要 */ }
        } // 论坛来源结束
        return detail; // 返回归一化条目
      } // 内容流分支结束
      return null; // 非法形态
    }; // load 结束
    setState('loading'); // 切换条目时回到加载态
    setItem(null); // 清空旧条目，避免闪旧内容
    void load().then((next) => {
      if (!alive) return; // 已卸载
      if (!next) { setState('missing'); return; } // 条目缺失
      setItem(next);
      setState('ready');
    }).catch(() => {
      if (alive) setState('failed'); // 接口失败：给出重试，而不是误报「条目不存在」
    });
    return () => { alive = false; }; // 清理
  }, [kind, id, locale, attempt]);

  /** 复制当前深链接；剪贴板不可用时降级提示地址。 */
  async function copyLink() {
    const url = window.location.href; // 当前深链接
    try {
      await navigator.clipboard?.writeText(url); // 优先剪贴板
      window.alert(tr(locale, '链接已复制', 'Link copied'));
    } catch {
      window.alert(url); // 降级：展示地址供手动复制
    } // 代码块结束
  } // copyLink 结束

  return (
    <article className="content-detail ui-card ui-card--feature">
      <div className="content-detail-bar">
        <button type="button" onClick={() => navigatePath(backPath(kind))}>{tr(locale, '← 返回列表', '← Back to list')}</button>
        <button type="button" onClick={() => void copyLink()}>{tr(locale, '复制链接', 'Copy link')}</button>
      </div>
      {state === 'loading' && (
        <div className="detail-skeleton" role="status" aria-label={tr(locale, '正在加载内容', 'Loading content')}>
          <span className="skeleton skeleton-line short" />
          <span className="skeleton skeleton-line heading" />
          <span className="skeleton skeleton-line mid" />
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-line thin mid" />
          <span className="skeleton skeleton-line thin" />
          <span className="skeleton skeleton-line thin mid" />
        </div>
      )}
      {state === 'missing' && (
        <EmptyState kind="post" title={tr(locale, '条目不存在或已下线', 'This entry does not exist or has been removed')} hint={tr(locale, '返回列表看看其他内容。', 'Go back to the list for other content.')} />
      )}
      {state === 'failed' && (
        <EmptyState
          kind="default"
          title={tr(locale, '内容加载失败', 'Failed to load')}
          hint={tr(locale, '网络或服务暂时不可用，请稍后重试。', 'The network or service is unavailable. Please try again.')}
          action={<button type="button" className="btn small" onClick={() => setAttempt((n) => n + 1)}>{tr(locale, '重试', 'Retry')}</button>}
        />
      )}
      {state === 'ready' && item && (
        <>
          <p className="community-card-meta">{item.meta}</p>
          {/* 作者公开卡：昵称 / 等级 / 徽章数 / 发帖数，点击进作者页（目录视图 ?author=） */}
          {item.author && (
            <button
              type="button"
              className="content-detail-author"
              onClick={() => navigatePath(pathOf('directory', '', `author=${encodeURIComponent(item.author!.id)}`))}
            >
              <span className="content-detail-author-name">{item.author.name}</span>
              <span className="content-detail-author-meta">Lv.{item.author.level} · {item.author.badgeCount} {tr(locale, '徽章', 'badges')} · {item.author.postCount} {tr(locale, '帖', 'posts')}</span>
            </button>
          )}
          <h1>{item.title}</h1>
          {/* 该帖标签 chips：点击带 tag 跳到目录检索（?tag=） */}
          {item.tags && item.tags.length > 0 && (
            <div className="content-detail-tags">
              {item.tags.map((tag) => (
                <button
                  key={tag.slug}
                  type="button"
                  className="content-detail-tag"
                  onClick={() => navigatePath(pathOf('directory', '', `tag=${encodeURIComponent(tag.slug)}`))}
                >#{tag.name}</button>
              ))}
            </div>
          )}
          {item.link && (
            <a className="content-detail-link" href={item.link.path} onClick={(event) => { event.preventDefault(); navigatePath(item.link!.path); }}>{item.link.label} →</a>
          )}
          {(item.media?.length ?? 0) > 0 && <ThreadMedia media={item.media!} title={item.title} />}
          {(item.media?.length ?? 0) === 0 && (item.priceCents ?? 0) > 0 && (
            <div className="community-paywall">
              <strong>{tr(locale, '这是一篇付费内容', 'This is paid content')}</strong>
              <p>{tr(locale, '图片与视频已按付费墙隐藏，解锁原帖后可查看；作者与 VIP 会员免购。', 'Images and videos are hidden behind the paywall. Unlock the original thread to view them; authors and VIP members are exempt.')}</p>
            </div>
          )}
          <RichBody text={item.body} />
        </>
      )}
      <style>{`
        .content-detail-author { display: inline-flex; flex-direction: column; gap: 2px; align-items: flex-start; padding: var(--sp-2, 8px) 0; border: none; background: none; text-align: left; cursor: pointer; }
        .content-detail-author-name { font-weight: 600; }
        .content-detail-author-meta { color: var(--text-muted, #888); font-size: .8rem; }
        .content-detail-tags { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0; }
        .content-detail-tag { padding: 3px 10px; border: 1px solid var(--border-strong, #ddd); border-radius: 999px; background: var(--surface, #fff); font-size: .8rem; cursor: pointer; }
      `}</style>
    </article>
  );
} // ContentDetail 结束
