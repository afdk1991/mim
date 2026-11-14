/**
 * 资讯视图（/news）：全站统一内容流。
 * 数据源为后端已有的公开接口 GET /content/items（routes/content-unified.ts），
 * 本视图只做展示与来源筛选，不新增任何接口、不重复实现查询逻辑。
 * 论坛主题 / 圈内动态 / 圈内公告三类来源同构，任一为空时不报错，整页展示空态。
 */

import { useEffect, useState } from 'react'; // 状态与副作用
import type { Locale } from '@mim/i18n'; // 语言类型
import { api, errorText } from '../api'; // 接口客户端与错误文案翻译
import type { ContentFeedItem, ContentFeedSource } from '../api'; // 统一内容流条目与来源类型

interface Props { // 视图参数
  locale: Locale; // 当前界面语言
} // 代码块结束

type NewsTab = 'all' | ContentFeedSource; // 来源筛选：全部 / 论坛主题 / 圈内动态 / 圈内公告

/** 按语言取文案。 */
function tr(locale: Locale, zh: string, en: string): string {
  return locale === 'en-US' ? en : zh; // 返回当前语言的文案
} // 代码块结束

/** ISO 时间截取日期部分；非法时间回落空串。 */
function fmtDate(iso?: string | null): string {
  if (!iso) return ''; // 无时间直接返回空串
  const time = Date.parse(iso); // 解析时间戳
  return Number.isNaN(time) ? '' : new Date(time).toISOString().slice(0, 10); // 统一输出 YYYY-MM-DD
} // 代码块结束

/** 来源徽标文案：三类来源在列表内可一眼区分。 */
function sourceLabel(locale: Locale, source: ContentFeedSource): string {
  if (source === 'community_thread') return tr(locale, '论坛主题', 'Forum thread'); // 论坛主题
  if (source === 'circle_post') return tr(locale, '圈子动态', 'Circle post'); // 圈内动态
  return tr(locale, '圈内公告', 'Circle notice'); // 圈内公告
} // 代码块结束

/** 来源筛选页签：计数来自当前已拉取的条目。 */
function tabsOf(locale: Locale, items: ContentFeedItem[]): Array<{ key: NewsTab; label: string; count: number }> {
  const countOf = (source: ContentFeedSource) => items.filter((item) => item.source === source).length; // 单来源计数
  return [
    { key: 'all', label: tr(locale, '全部', 'All'), count: items.length }, // 全部
    { key: 'community_thread', label: tr(locale, '论坛', 'Forum'), count: countOf('community_thread') }, // 论坛主题
    { key: 'circle_post', label: tr(locale, '圈子动态', 'Posts'), count: countOf('circle_post') }, // 圈内动态
    { key: 'circle_notice', label: tr(locale, '圈内公告', 'Notices'), count: countOf('circle_notice') }, // 圈内公告
  ]; // 页签集合
} // 代码块结束

export function News({ locale }: Props) { // 导出函数 News：资讯视图入口
  const [items, setItems] = useState<ContentFeedItem[]>([]); // 统一内容流
  const [tab, setTab] = useState<NewsTab>('all'); // 当前来源筛选
  const [loaded, setLoaded] = useState(false); // 首屏是否完成拉取（区分加载中与空态）
  const [error, setError] = useState<string | null>(null); // 拉取失败文案；公开接口失败时提示但不白屏

  /** 拉取统一内容流：按发布时间倒序，失败时保留空列表并展示错误文案。 */
  useEffect(() => {
    let cancelled = false; // 组件卸载后丢弃回调，避免对已卸载组件 setState
    void api.content.feed(60).then((res) => {
      if (cancelled) return; // 已卸载：不再更新状态
      setItems([...res.items].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))); // 时间倒序
      setLoaded(true); // 标记首屏完成
    }).catch((err) => {
      if (cancelled) return; // 已卸载：不再更新状态
      setError(errorText(locale, err)); // 错误文案走统一翻译
      setLoaded(true); // 失败也结束加载态，避免一直转圈
    });
    return () => { cancelled = true; }; // 清理：取消后续更新
  }, [locale]); // 语言切换时重新拉取并重算错误文案

  const tabs = tabsOf(locale, items); // 页签与计数
  const visible = tab === 'all' ? items : items.filter((item) => item.source === tab); // 当前筛选结果

  return ( // 返回当前视图
    <div className="page news"> {/* 页面容器 */}
      <header className="page-head"> {/* 标题区 */}
        <h1>{tr(locale, '资讯', 'News')}</h1> {/* 页面标题 */}
        <p className="muted">{tr(locale, '论坛主题、圈子动态与圈内公告统一收录于此，按发布时间倒序展示。', 'Forum threads, circle posts and circle notices in one feed, newest first.')}</p> {/* 说明 */}
      </header>

      <nav className="community-chips"> {/* 来源筛选页签 */}
        {tabs.map((item) => (
          <button
            key={item.key} // 页签唯一标识
            type="button" // 非表单提交
            className={tab === item.key ? 'is-active' : ''} // 选中态复用既有样式
            onClick={() => setTab(item.key)} // 切换筛选
          >
            {item.label} <em>{item.count}</em> {/* 文案 + 计数 */}
          </button>
        ))}
      </nav>

      {!loaded ? ( // 加载中
        <p className="hint">{tr(locale, '加载中…', 'Loading…')}</p>
      ) : error ? ( // 拉取失败：明确提示，不白屏
        <p className="error">{error}</p>
      ) : visible.length === 0 ? ( // 空态
        <div className="community-empty">{tr(locale, '暂无资讯', 'No news yet')}</div>
      ) : ( // 正常列表
        <ul className="plain-list announcement-list">{/* 复用公告列表的无序列表样式 */}
          {visible.map((item) => (
            <li className="panel announcement-row" key={item.id}>{/* 单条资讯 */}
              <div className="panel-head">{/* 标题行 */}
                <h3>{item.title}</h3>
                <span className="deploy-badge">{sourceLabel(locale, item.source)}</span>{/* 来源徽标 */}
              </div>
              <p className="muted">{item.summary || item.body}</p>{/* 摘要优先，无摘要回落正文 */}
              <span className="muted">{fmtDate(item.created_at)}</span>{/* 发布日期 */}
            </li>
          ))}
        </ul>
      )}
    </div>
  ); // 视图结束
} // News 组件结束
