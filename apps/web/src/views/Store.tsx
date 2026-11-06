import { useState } from 'react';
import type { Locale } from '@mim/i18n';
import { api, errorText } from '../api';
import { useAsync } from '../hooks';

interface Props {
  locale: Locale;
}

interface ModuleCard {
  code: string;
  name: string;
  summary: string;
  unlock_mode: 'one_time';
  region: string;
  status: string;
  requires: string[];
  current_price: { currency: string; amount_minor: number } | null;
}

export function Store({ locale }: Props) {
  const modulesState = useAsync(() => api.catalog.getModules(), []);
  const entState = useAsync(() => api.catalog.getMyEntitlements(), []);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const modules = (modulesState.data?.modules ?? []) as ModuleCard[];
  const unlocked = new Set((entState.data?.entitlements ?? []).map((e) => e.module_code));
  const loading = modulesState.loading || entState.loading;

  async function handleUnlock(code: string) {
    setBusyCode(code);
    setError(null);
    setMessage(null);
    try {
      await api.catalog.unlockModule(code);
      setMessage(locale === 'en-US' ? 'Unlocked ✓' : '解锁成功 ✓');
      entState.reload();
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setBusyCode(null);
    }
  }

  if (loading) return <div className="hint">{locale === 'en-US' ? 'Loading…' : '加载中…'}</div>;
  if (modulesState.error) return <div className="error">{errorText(locale, modulesState.error)}</div>;

  return (
    <div className="page">
      <header className="page-head">
        <h1>{locale === 'en-US' ? 'Module Store' : '功能模块商城'}</h1>
        <p className="muted">
          {locale === 'en-US'
            ? 'Unlock capabilities one-time; active entitlements survive region switch'
            : '一次性解锁，权益在本区持续有效'}
        </p>
      </header>

      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}

      {modules.length === 0 ? (
        <p className="hint">{locale === 'en-US' ? 'No modules available in this region.' : '本区暂无可用模块。'}</p>
      ) : (
        <div className="grid">
          {modules.map((m) => {
            const owned = unlocked.has(m.code);
            const price = m.current_price
              ? `${(m.current_price.amount_minor / 100).toFixed(2)} ${m.current_price.currency}`
              : locale === 'en-US' ? 'Free' : '免费';
            return (
              <section key={m.code} className="card">
                <header className="card-head">
                  <h3>{m.name}</h3>
                  {owned && <span className="badge">✓ {locale === 'en-US' ? 'Owned' : '已解锁'}</span>}
                </header>
                <p className="muted">{m.summary}</p>
                <div className="card-meta">
                  <code>{m.code}</code>
                  <span>{price}</span>
                </div>
                {m.requires.length > 0 && (
                  <p className="muted small">
                    {locale === 'en-US' ? 'Requires' : '前置'}: {m.requires.join(', ')}
                  </p>
                )}
                {!owned && (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busyCode === m.code}
                    onClick={() => handleUnlock(m.code)}
                  >
                    {busyCode === m.code
                      ? locale === 'en-US'
                        ? 'Unlocking…'
                        : '解锁中…'
                      : locale === 'en-US'
                        ? 'Unlock'
                        : '解锁'}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
