import { useState } from 'react';
import { t } from '@mim/i18n';
import type { Locale } from '@mim/i18n';
import { api, errorText, nowIso } from '../api';
import type { DashboardTask } from '../api';
import { useAsync } from '../hooks';

interface Props {
  locale: Locale;
  onOpenProject: (projectId: string) => void;
}

export function Dashboard({ locale, onOpenProject }: Props) {
  const state = useAsync(() => api.dashboard(), []);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggle(task: DashboardTask) {
    setError(null);
    setBusyId(task.id);
    try {
      await api.setTaskStatus(task.id, {
        status: task.status === 'done' ? 'todo' : 'done',
        version: task.version,
        client_updated_at: nowIso(),
      });
      state.reload();
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setBusyId(null);
    }
  }

  if (state.loading) return <div className="hint">{t(locale, 'common.loading')}</div>;
  if (state.error || !state.data) {
    return <div className="error">{errorText(locale, state.error)}</div>;
  }

  const data = state.data;
  const sections: Array<{ key: string; title: string; tasks: DashboardTask[]; tone?: string }> = [
    { key: 'today', title: t(locale, 'tasks.today'), tasks: data.today },
    { key: 'next7', title: t(locale, 'tasks.next7'), tasks: data.next_7_days },
    { key: 'overdue', title: t(locale, 'tasks.overdue'), tasks: data.overdue, tone: 'danger' },
    { key: 'unscheduled', title: t(locale, 'tasks.unscheduled'), tasks: data.unscheduled },
    { key: 'done', title: t(locale, 'tasks.completedToday'), tasks: data.completed_today, tone: 'done' },
  ];

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t(locale, 'nav.dashboard')}</h1>
        <span className="muted">
          {data.date} · {data.timezone}
        </span>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="cards">
        {sections.map((section) => (
          <section className={`panel${section.tone ? ` ${section.tone}` : ''}`} key={section.key}>
            <header className="panel-head">
              <h2>{section.title}</h2>
              <span className="count">{section.tasks.length}</span>
            </header>
            {section.tasks.length === 0 ? (
              <p className="empty">{t(locale, 'tasks.empty')}</p>
            ) : (
              <ul className="task-list">
                {section.tasks.map((task) => (
                  <li key={task.id} className={`task-row${task.status === 'done' ? ' done' : ''}`}>
                    <button
                      type="button"
                      className="check"
                      title={task.status === 'done' ? t(locale, 'action.reopen') : t(locale, 'action.complete')}
                      onClick={() => toggle(task)}
                      disabled={busyId === task.id}
                      aria-pressed={task.status === 'done'}
                    >
                      {task.status === 'done' ? '✓' : ''}
                    </button>
                    <div className="task-main">
                      <span className="task-title">{task.title}</span>
                      <span className="task-meta">
                        <button
                          type="button"
                          className="link"
                          onClick={() => onOpenProject(task.project_id)}
                        >
                          {task.project_name}
                        </button>
                        {task.due_date ? ` · ${task.due_date}` : ''}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
