import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { t } from '@mim/i18n';
import type { Locale } from '@mim/i18n';
import { api, errorText } from '../api';
import type { UserInfo } from '../api';
import { useAsync } from '../hooks';

interface Props {
  locale: Locale;
  onUserUpdated: (user: UserInfo) => void;
}

export function Settings({ locale, onUserUpdated }: Props) {
  const state = useAsync(() => api.me(), []);
  const [displayName, setDisplayName] = useState('');
  const [localeValue, setLocaleValue] = useState<Locale>('zh-CN');
  const [timezone, setTimezone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loaded = state.data;

  useEffect(() => {
    if (!loaded) return;
    setDisplayName(loaded.user.display_name);
    setLocaleValue(loaded.user.locale === 'en-US' ? 'en-US' : 'zh-CN');
    setTimezone(loaded.user.timezone);
  }, [loaded]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.updateMe({
        display_name: displayName.trim(),
        locale: localeValue,
        timezone: timezone.trim(),
      });
      onUserUpdated(result.user);
      setMessage(`${t(locale, 'settings.save')} ✓`);
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setBusy(false);
    }
  }

  async function requestDeletion() {
    if (!window.confirm(t(locale, 'settings.requestDeletion'))) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.requestDeletion();
      setMessage(`${t(locale, 'settings.requestDeletion')} ✓`);
      state.reload();
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setBusy(false);
    }
  }

  async function cancelDeletion() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.cancelDeletion();
      setMessage(`${t(locale, 'settings.cancelDeletion')} ✓`);
      state.reload();
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setBusy(false);
    }
  }

  if (state.loading) return <div className="hint">{t(locale, 'common.loading')}</div>;
  if (state.error || !state.data) {
    return <div className="error">{errorText(locale, state.error)}</div>;
  }

  const me = state.data;
  const pending = me.user.deletion_scheduled_at != null;

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t(locale, 'nav.settings')}</h1>
      </header>

      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}
      {pending && (
        <p className="warning">
          {t(locale, 'settings.deletionPending')}: {me.user.deletion_scheduled_at?.slice(0, 10)}
        </p>
      )}

      <div className="split">
        <section className="panel">
          <header className="panel-head">
            <h2>{t(locale, 'settings.account')}</h2>
          </header>
          <form className="form" onSubmit={save}>
            <label>
              <span>{t(locale, 'settings.displayName')}</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={40}
              />
            </label>
            <label>
              <span>{t(locale, 'settings.locale')}</span>
              <select
                value={localeValue}
                onChange={(event) => setLocaleValue(event.target.value as Locale)}
              >
                <option value="zh-CN">中文</option>
                <option value="en-US">English</option>
              </select>
            </label>
            <label>
              <span>{t(locale, 'settings.timezone')}</span>
              <input
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                placeholder="Asia/Shanghai"
              />
            </label>
            <button type="submit" className="btn primary" disabled={busy}>
              {t(locale, 'settings.save')}
            </button>
          </form>
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2>{t(locale, 'settings.plan')}</h2>
          </header>
          <ul className="plain-list">
            <li>
              <span>{t(locale, 'settings.region')}</span>
              <span className="badge">{me.user.region === 'cn' ? '中国区' : 'Global'}</span>
            </li>
            <li>
              <span>{t(locale, 'settings.plan')}</span>
              <span className="badge role-owner">
                {locale === 'zh-CN' ? me.plan.name_zh : me.plan.name_en}
              </span>
            </li>
            <li>
              <span>{t(locale, 'plans.orders')}</span>
              <span className="muted">{me.counts.projects}</span>
            </li>
            {me.subscription && (
              <li>
                <span>{me.subscription.cycle}</span>
                <span className="muted">{me.subscription.status}</span>
              </li>
            )}
          </ul>

          <header className="panel-head">
            <h2>{t(locale, 'settings.deletion')}</h2>
          </header>
          <p className="muted">{t(locale, 'settings.deletionTip')}</p>
          {pending ? (
            <button type="button" className="btn ghost" onClick={cancelDeletion} disabled={busy}>
              {t(locale, 'settings.cancelDeletion')}
            </button>
          ) : (
            <button type="button" className="btn danger" onClick={requestDeletion} disabled={busy}>
              {t(locale, 'settings.requestDeletion')}
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
