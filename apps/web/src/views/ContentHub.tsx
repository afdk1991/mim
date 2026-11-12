/**
 * 内容栏目页：公告列表 / 更新日志时间线 / 推广计划卡片。
 * 三个接口独立拉取，任一 404 或返回空数组时静默隐藏对应栏目，不报错、不白屏。
 */

import { useEffect, useState } from 'react'; // 状态与副作用
import type { Locale } from '@mim/i18n'; // 语言类型
import { api } from '../api'; // 接口客户端
import type { AnnouncementItem, ChangelogItem, PromotionItem } from '../api'; // 内容条目类型

interface Props { // 视图参数
  locale: Locale; // 当前界面语言
}

type ContentTab = 'announcements' | 'changelog' | 'promotions'; // 内部栏目切换

/** 按语言取文案。 */
function tr(locale: Locale, zh: string, en: string): string {
  return locale === 'en-US' ? en : zh;
}

/** ISO 时间截取日期部分；非法时间回落空串。 */
function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const time = Date.parse(iso);
  return Number.isNaN(time) ? '' : new Date(time).toISOString().slice(0, 10);
}

export function ContentHub({ locale }: Props) {
  const [tab, setTab] = useState<ContentTab>('announcements'); // 当前栏目
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]); // 公告清单
  const [changelog, setChangelog] = useState<ChangelogItem[]>([]); // 更新日志
  const [promotions, setPromotions] = useState<PromotionItem[]>([]); // 推广计划
  const [loaded, setLoaded] = useState(false); // 首屏是否完成拉取（用于空态区分加载中）

  /** 并行拉取三个栏目；各自失败回落空数组，互不影响。 */
  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([
      api.content.announcements(20),
      api.content.changelog(30),
      api.content.promotions(),
    ]).then(([ann, cl, promo]) => {
      if (cancelled) return;
      setAnnouncements(ann.status === 'fulfilled' ? ann.value.items : []);
      setChangelog(cl.status === 'fulfilled' ? cl.value.items : []);
      setPromotions(promo.status === 'fulfilled' ? promo.value.items : []);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  const tabs: Array<{ key: ContentTab; label: string; count: number }> = [
    { key: 'announcements', label: tr(locale, '公告', 'Announcements'), count: announcements.length },
    { key: 'changelog', label: tr(locale, '更新日志', 'Changelog'), count: changelog.length },
    { key: 'promotions', label: tr(locale, '推广计划', 'Promotions'), count: promotions.length },
  ];

  return (
    <div className="page content-hub">
      <header className="page-head">
        <h1>{tr(locale, '公告与动态', 'News & Updates')}</h1>
        <p className="muted">{tr(locale, '产品公告、版本更新与推广计划统一收录于此。', 'Announcements, release notes and promotions in one place.')}</p>
      </header>

      <nav className="community-chips content-tabs">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            className={tab === item.key ? 'is-active' : ''}
            onClick={() => setTab(item.key)}
          >
            {item.label} <em>{item.count}</em>
          </button>
        ))}
      </nav>

      {!loaded ? (
        <p className="hint">{tr(locale, '加载中…', 'Loading…')}</p>
      ) : tab === 'announcements' && announcements.length === 0 ? (
        <div className="community-empty">{tr(locale, '暂无公告', 'No announcements')}</div>
      ) : tab === 'changelog' && changelog.length === 0 ? (
        <div className="community-empty">{tr(locale, '暂无更新日志', 'No changelog entries')}</div>
      ) : tab === 'promotions' && promotions.length === 0 ? (
        <div className="community-empty">{tr(locale, '暂无推广计划', 'No active promotions')}</div>
      ) : null}

      {tab === 'announcements' && announcements.length > 0 && (
        <ul className="plain-list announcement-list">
          {announcements.map((item) => (
            <li className="panel announcement-row" key={item.id}>
              <div className="panel-head">
                <h3>{item.title}</h3>
                {item.pinned ? <span className="deploy-badge">{tr(locale, '置顶', 'Pinned')}</span> : null}
              </div>
              <p className="muted">{item.body}</p>
              {item.published_at ? <span className="muted">{fmtDate(item.published_at)}</span> : null}
            </li>
          ))}
        </ul>
      )}

      {tab === 'changelog' && changelog.length > 0 && (
        <ol className="changelog-timeline">
          {changelog.map((item) => (
            <li className="changelog-entry" key={item.id}>
              <div className="changelog-version">
                <span className="deploy-badge">{item.version}</span>
                {item.published_at ? <span className="muted">{fmtDate(item.published_at)}</span> : null}
              </div>
              <h3>{item.title}</h3>
              <p className="muted">{item.body}</p>
            </li>
          ))}
        </ol>
      )}

      {tab === 'promotions' && promotions.length > 0 && (
        <div className="commerce-grid promotions-grid">
          {promotions.map((item) => (
            <a className="panel promotion-card" key={item.id} href={item.target_url || undefined}>
              <div className="panel-head">
                <h3>{item.name}</h3>
                <span className="deploy-badge muted">{item.status}</span>
              </div>
              <p className="muted">{item.summary}</p>
              <span className="muted">
                {fmtDate(item.starts_at)}{item.ends_at ? ` ~ ${fmtDate(item.ends_at)}` : ''}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
