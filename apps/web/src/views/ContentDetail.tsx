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
import { navigatePath, pathOf } from '../router'; // 站内导航与深链接构造

/** 资讯类内容形态：公告 / 更新日志 / 统一内容流。 */
export type ContentKind = 'announcement' | 'changelog' | 'feed';

/** 归一化后的详情视图模型：三种数据源统一成同一份渲染结构。 */
interface DetailItem {
  id: string; // 主键
  title: string; // 标题
  body: string; // 正文
  meta: string; // 元信息行（来源 / 版本 / 时间）
  link?: { label: string; path: string }; // 关联入口（如论坛原帖）
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

/** 单行富文本：图片直出，普通行内链接可点击，其余按纯文本。 */
function RichLine({ line }: { line: string }) {
  const trimmed = line.trim(); // 去掉首尾空白
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
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading'); // 加载状态

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
        return {
          id: hit.id,
          title: hit.title,
          body: hit.body || hit.summary,
          meta: `${feedSourceLabel(locale, hit.source)} · ${fmtTime(hit.created_at)}`,
          // 论坛主题可直达原帖详情；圈子内容暂无独立详情页，不伪造入口
          link: hit.source === 'community_thread'
            ? { label: tr(locale, '查看原帖与评论', 'Open thread and comments'), path: pathOf('community', `post/${encodeURIComponent(hit.source_id)}`) }
            : undefined,
        };
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
      if (alive) setState('missing'); // 接口失败按缺失处理，给出返回入口
    });
    return () => { alive = false; }; // 清理
  }, [kind, id, locale]);

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
      {state === 'loading' && <div className="community-empty">{tr(locale, '正在加载内容…', 'Loading…')}</div>}
      {state === 'missing' && (
        <div className="community-empty">
          {tr(locale, '条目不存在或已下线。', 'This entry does not exist or has been removed.')}
        </div>
      )}
      {state === 'ready' && item && (
        <>
          <p className="community-card-meta">{item.meta}</p>
          <h1>{item.title}</h1>
          {item.link && (
            <a className="content-detail-link" href={item.link.path} onClick={(event) => { event.preventDefault(); navigatePath(item.link!.path); }}>{item.link.label} →</a>
          )}
          <RichBody text={item.body} />
        </>
      )}
    </article>
  );
} // ContentDetail 结束
