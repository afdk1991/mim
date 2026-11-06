import { useState } from 'react';
import type { Locale } from '@mim/i18n';
import { api, errorText } from '../api';
import type { SiteModuleItem } from '../api';
import { useAsync } from '../hooks';

interface Props {
  locale: Locale;
}

type ZoneFilter = 'all' | 'laal.top' | 'mixm.top';

const ZONES: Array<{ id: ZoneFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'laal.top', label: 'laal.top' },
  { id: 'mixm.top', label: 'mixm.top' },
];

function categoryName(locale: Locale, name: { zh: string; en: string }): string {
  return locale === 'en-US' ? name.en : name.zh;
}

/** 把 DNSPod 备注（label / description）落成可按 zone 过滤的站点模块视图 */
export function SiteMap({ locale }: Props) {
  const state = useAsync(() => api.site.listModules(), []);
  const [zone, setZone] = useState<ZoneFilter>('all');
  const [category, setCategory] = useState<string>('all');
  const [query, setQuery] = useState('');

  if (state.loading) return <div className="hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</div>;
  if (state.error) return <div className="error">{errorText(locale, state.error)}</div>;

  const modules: SiteModuleItem[] = state.data?.items ?? [];
  const needle = query.trim().toLowerCase();

  const categories = modules.reduce<Array<{ id: string; name: { zh: string; en: string } }>>(
    (acc, item) => {
      if (!acc.some((c) => c.id === item.category)) {
        acc.push({ id: item.category, name: item.category_name });
      }
      return acc;
    },
    [],
  );

  const filtered = modules.filter((item) => {
    if (zone !== 'all' && !item.records.some((r) => r.zone === zone)) return false;
    if (category !== 'all' && item.category !== category) return false;
    if (!needle) return true;
    return [
      item.host,
      item.label,
      item.description,
      ...item.records.flatMap((r) => [r.fqdn, r.record_value, r.label ?? '', r.description ?? '']),
    ]
      .join(' ')
      .toLowerCase()
      .includes(needle);
  });

  const groups = categories
    .map((c) => ({ ...c, items: filtered.filter((m) => m.category === c.id) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{locale === 'en-US' ? 'Site Map' : '站点地图'}</h1>
          <p className="muted">
            {locale === 'en-US'
              ? `${modules.length} modules across 2 zones, grouped by DNSPod remark`
              : `DNSPod 备注结构化的 ${modules.length} 个站点模块，2 个解析 zone`}
          </p>
        </div>
        <span className="badge">{filtered.length} / {modules.length}</span>
      </header>

      <div className="form inline">
        <label className="grow">
          {locale === 'en-US' ? 'Search' : '搜索'}
          <input
            value={query}
            placeholder={locale === 'en-US' ? 'host / remark / record value' : '主机 / 备注 / 解析值'}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          Zone
          <div className="segmented">
            {ZONES.map((z) => (
              <button
                key={z.id}
                type="button"
                className={zone === z.id ? 'active' : ''}
                onClick={() => setZone(z.id)}
              >
                {z.label}
              </button>
            ))}
          </div>
        </label>
      </div>

      <div className="row">
        <button
          type="button"
          className={`btn small${category === 'all' ? ' primary' : ' ghost'}`}
          onClick={() => setCategory('all')}
        >
          {locale === 'en-US' ? 'All' : '全部'}
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`btn small${category === c.id ? ' primary' : ' ghost'}`}
            onClick={() => setCategory(c.id)}
          >
            {categoryName(locale, c.name)}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <p className="hint">{locale === 'en-US' ? 'No matching modules.' : '没有匹配的模块。'}</p>
      ) : (
        groups.map((group) => (
          <section key={group.id}>
            <div className="page-head">
              <h2>{categoryName(locale, group.name)}</h2>
              <span className="count">{group.items.length}</span>
            </div>
            <div className="cards">
              {group.items.map((item) => {
                const records =
                  zone === 'all' ? item.records : item.records.filter((r) => r.zone === zone);
                return (
                  <article key={item.host} className="panel">
                    <div className="panel-head">
                      <strong>{item.label}</strong>
                      <code>{item.host}</code>
                    </div>
                    <p className="muted">{item.description}</p>
                    {records.map((r) => (
                      <div key={r.zone}>
                        <div className="row">
                          <a href={`https://${r.fqdn}`} target="_blank" rel="noreferrer">
                            {r.fqdn}
                          </a>
                          <span className="badge">{r.zone}</span>
                          <span className="badge">{r.record_type}</span>
                          <span className="muted">{r.record_value}</span>
                        </div>
                        {(r.label || r.description) && (
                          <p className="muted">
                            {[r.label, r.description].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </div>
                    ))}
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
