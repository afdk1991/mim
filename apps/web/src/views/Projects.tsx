import { useState } from 'react';
import type { FormEvent } from 'react';
import { t } from '@mim/i18n';
import type { Locale } from '@mim/i18n';
import { api, errorText } from '../api';
import { useAsync } from '../hooks';

interface Props {
  locale: Locale;
  onOpenProject: (projectId: string) => void;
}

export function Projects({ locale, onOpenProject }: Props) {
  const state = useAsync(() => api.projects(), []);
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createProject(event: FormEvent) {
    event.preventDefault();
    const value = name.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.createProject({ name: value });
      setName('');
      state.reload();
      onOpenProject(result.project.id);
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setBusy(false);
    }
  }

  async function acceptInvitation(event: FormEvent) {
    event.preventDefault();
    const value = token.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.acceptInvitation(value);
      setToken('');
      setMessage(`${t(locale, 'projects.acceptInvite')} ✓ · ${result.role}`);
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

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t(locale, 'nav.projects')}</h1>
        <span className="count">{state.data.items.length}</span>
      </header>

      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}

      <div className="split">
        <section className="panel">
          <header className="panel-head">
            <h2>{t(locale, 'projects.create')}</h2>
          </header>
          <form className="form" onSubmit={createProject}>
            <label>
              <span>{t(locale, 'projects.name')}</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t(locale, 'projects.name')}
                maxLength={80}
                required
              />
            </label>
            <button type="submit" className="btn primary" disabled={busy}>
              {t(locale, 'action.create')}
            </button>
          </form>
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2>{t(locale, 'projects.acceptInvite')}</h2>
          </header>
          <form className="form" onSubmit={acceptInvitation}>
            <label>
              <span>{t(locale, 'projects.inviteToken')}</span>
              <input
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="019xxxxx-... /iter/i/..."
              />
            </label>
            <button type="submit" className="btn ghost" disabled={busy}>
              {t(locale, 'projects.acceptInvite')}
            </button>
          </form>
        </section>
      </div>

      {state.data.items.length === 0 ? (
        <p className="empty">{t(locale, 'projects.empty')}</p>
      ) : (
        <ul className="project-list">
          {state.data.items.map((project) => (
            <li key={project.id}>
              <button type="button" className="project-card" onClick={() => onOpenProject(project.id)}>
                <div className="project-card-main">
                  <span className="project-name">
                    {project.name}
                    {project.status !== 'active' && (
                      <span className="badge">{t(locale, 'projects.archived')}</span>
                    )}
                  </span>
                  {project.description && <span className="muted">{project.description}</span>}
                </div>
                <span className={`badge role-${project.role}`}>{project.role}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
