import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { t } from '@mim/i18n';
import type { Locale } from '@mim/i18n';
import { api, errorText, getSession, nowIso } from '../api';
import type { Invitation, Provider, Task } from '../api';
import { useAsync } from '../hooks';

interface Props {
  locale: Locale;
  projectId: string;
  onBack: () => void;
}

const PRIORITIES = ['0', '1', '2', '3'];

export function ProjectDetail({ locale, projectId, onBack }: Props) {
  const state = useAsync(async () => {
    const { project } = await api.project(projectId);
    const [taskResult, memberResult, invitationResult] = await Promise.all([
      api.tasks(projectId),
      api.members(projectId),
      project.role === 'owner'
        ? api.invitations(projectId)
        : Promise.resolve({ items: [] as Invitation[] }),
    ]);
    return {
      project,
      tasks: taskResult.items,
      members: memberResult.items,
      invitations: invitationResult.items,
    };
  }, [projectId]);

  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('0');
  const [parentId, setParentId] = useState('');
  const [provider, setProvider] = useState<Provider>('email');
  const [identifier, setIdentifier] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // FR-03 多端同步：每 4s 拉取 task_events 增量，有变更即刷新列表（满足 5s 内可见）
  useEffect(() => {
    const tasks = state.data?.tasks;
    if (!tasks) return;
    let since = tasks.reduce((max, task) => Math.max(max, task.seq), 0);
    const timer = window.setInterval(() => {
      api
        .syncChanges(projectId, since)
        .then((result) => {
          if (result.items.length === 0) return;
          since = result.next_seq;
          state.reload();
        })
        .catch(() => {
          /* 离线或网络抖动时静默，下一轮重试 */
        });
    }, 4000);
    return () => window.clearInterval(timer);
  }, [projectId, state.data?.tasks, state.reload]);

  function report(err: unknown) {
    setError(errorText(locale, err));
  }

  if (state.loading) return <div className="hint">{t(locale, 'common.loading')}</div>;
  if (state.error || !state.data) {
    return (
      <div className="page">
        <button type="button" className="btn ghost" onClick={onBack}>
          ← {t(locale, 'nav.projects')}
        </button>
        <p className="error">{errorText(locale, state.error)}</p>
      </div>
    );
  }

  const data = state.data;
  const canWrite = data.project.role !== 'viewer';
  const isOwner = data.project.role === 'owner';
  const selfId = getSession()?.user.id;

  async function createTask(event: FormEvent) {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.createTask(projectId, {
        title: value,
        due_date: dueDate || undefined,
        priority: Number(priority),
        parent_id: parentId || undefined,
      });
      setTitle('');
      setDueDate('');
      setParentId('');
      state.reload();
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }

  async function toggleTask(task: Task) {
    setBusy(true);
    setError(null);
    try {
      await api.setTaskStatus(task.id, {
        status: task.status === 'done' ? 'todo' : 'done',
        version: task.version,
        client_updated_at: nowIso(),
      });
      state.reload();
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }

  async function renameTask(task: Task) {
    const next = window.prompt(t(locale, 'tasks.title'), task.title);
    if (!next || !next.trim() || next.trim() === task.title) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateTask(task.id, {
        title: next.trim(),
        version: task.version,
        client_updated_at: nowIso(),
      });
      state.reload();
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }

  async function deleteTask(task: Task) {
    if (!window.confirm(`${t(locale, 'action.delete')} · ${task.title}`)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.deleteTask(task.id);
      if (result.cascaded_children > 0) {
        setMessage(`${t(locale, 'action.delete')} ✓ (${result.cascaded_children})`);
      }
      state.reload();
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (!identifier.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createInvitation(projectId, {
        provider,
        identifier: identifier.trim(),
        role,
      });
      setIdentifier('');
      state.reload();
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(invitation: Invitation) {
    if (!window.confirm(`${t(locale, 'invitations.revoke')} · ${invitation.identifier}`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.revokeInvitation(projectId, invitation.id);
      state.reload();
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }

  async function copyToken(invitation: Invitation) {
    try {
      await navigator.clipboard.writeText(invitation.token);
      setCopiedId(invitation.id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setError(invitation.token);
    }
  }

  async function removeMember(userId: string) {
    if (!window.confirm(t(locale, 'members.remove'))) return;
    setBusy(true);
    setError(null);
    try {
      await api.removeMember(projectId, userId);
      state.reload();
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    setBusy(true);
    setError(null);
    try {
      const created = await api.createExport(projectId);
      const blob = await api.exportDownload(created.export.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${data.project.name}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage(`${t(locale, 'action.export')} ✓ (${created.rows})`);
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }

  async function archiveProject() {
    if (!window.confirm(`${t(locale, 'projects.archived')} · ${data.project.name}`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.archiveProject(projectId);
      state.reload();
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }

  async function deleteProject() {
    const confirmText = `${t(locale, 'action.delete')} · ${data.project.name}\n${t(
      locale,
      'projects.deleteCascadeConfirm',
    )}`;
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.deleteProject(projectId);
      window.alert(
        t(locale, 'projects.deleteCascade', {
          tasks: result.cascaded_tasks,
          subtasks: result.cascaded_subtasks,
        }),
      );
      onBack();
    } catch (err) {
      report(err);
      setBusy(false);
    }
  }

  const topLevel = data.tasks.filter((task) => task.level === 1);

  function renderTask(task: Task, children: Task[]) {
    return (
      <li key={task.id} className="task-block">
        <div className={`task-row${task.status === 'done' ? ' done' : ''}`}>
          <button
            type="button"
            className="check"
            title={task.status === 'done' ? t(locale, 'action.reopen') : t(locale, 'action.complete')}
            onClick={() => toggleTask(task)}
            disabled={!canWrite || busy}
          >
            {task.status === 'done' ? '✓' : ''}
          </button>
          <div className="task-main">
            <span className="task-title">{task.title}</span>
            <span className="task-meta">
              {task.due_date ? `${t(locale, 'tasks.dueDate')}: ${task.due_date}` : ''}
              {task.priority > 0 ? ` · P${task.priority}` : ''}
            </span>
          </div>
          {canWrite && (
            <div className="task-actions">
              <button type="button" className="link" onClick={() => renameTask(task)} disabled={busy}>
                {t(locale, 'action.edit')}
              </button>
              <button type="button" className="link danger" onClick={() => deleteTask(task)} disabled={busy}>
                {t(locale, 'action.delete')}
              </button>
            </div>
          )}
        </div>
        {children.length > 0 && (
          <ul className="task-children">
            {children.map((child) => renderTask(child, []))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="row">
          <button type="button" className="btn ghost small" onClick={onBack}>
            ←
          </button>
          <h1>{data.project.name}</h1>
          <span className={`badge role-${data.project.role}`}>{data.project.role}</span>
          {data.project.status !== 'active' && (
            <span className="badge">{t(locale, 'projects.archived')}</span>
          )}
        </div>
        <div className="row">
          <button type="button" className="btn ghost" onClick={exportCsv} disabled={busy}>
            {t(locale, 'action.export')}
          </button>
          {isOwner && (
            <>
              <button type="button" className="btn ghost" onClick={archiveProject} disabled={busy}>
                {t(locale, 'projects.archived')}
              </button>
              <button type="button" className="btn danger" onClick={deleteProject} disabled={busy}>
                {t(locale, 'action.delete')}
              </button>
            </>
          )}
        </div>
      </header>

      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}

      {canWrite && (
        <section className="panel">
          <header className="panel-head">
            <h2>{t(locale, 'tasks.add')}</h2>
          </header>
          <form className="form inline" onSubmit={createTask}>
            <label className="grow">
              <span>{t(locale, 'tasks.title')}</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
                required
              />
            </label>
            <label>
              <span>{t(locale, 'tasks.dueDate')}</span>
              <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </label>
            <label>
              <span>{t(locale, 'tasks.priority')}</span>
              <select value={priority} onChange={(event) => setPriority(event.target.value)}>
                {PRIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t(locale, 'tasks.parent')}</span>
              <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
                <option value="">{t(locale, 'tasks.topLevel') || '—'}</option>
                {topLevel.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn primary" disabled={busy}>
              {t(locale, 'action.create')}
            </button>
          </form>
        </section>
      )}

      <section className="panel">
        <header className="panel-head">
          <h2>{t(locale, 'tasks.today')}</h2>
          <span className="count">{data.tasks.length}</span>
        </header>
        {topLevel.length === 0 ? (
          <p className="empty">{t(locale, 'tasks.empty')}</p>
        ) : (
          <ul className="task-list">
            {topLevel.map((task) =>
              renderTask(
                task,
                data.tasks.filter((child) => child.parent_id === task.id),
              ),
            )}
          </ul>
        )}
      </section>

      <div className="split">
        <section className="panel">
          <header className="panel-head">
            <h2>{t(locale, 'members.title')}</h2>
            <span className="count">{data.members.length}</span>
          </header>
          <ul className="plain-list">
            {data.members.map((member) => (
              <li key={member.user_id}>
                <span>{member.display_name || member.user_id.slice(0, 8)}</span>
                <span className={`badge role-${member.role}`}>{member.role}</span>
                {isOwner && member.user_id !== selfId && (
                  <button
                    type="button"
                    className="link danger"
                    onClick={() => removeMember(member.user_id)}
                    disabled={busy}
                  >
                    {t(locale, 'members.remove')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        {isOwner && (
          <section className="panel">
            <header className="panel-head">
              <h2>{t(locale, 'invitations.title')}</h2>
            </header>
            <form className="form inline" onSubmit={invite}>
              <label>
                <span>{t(locale, 'invitations.identifier')}</span>
                <input
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  required
                />
              </label>
              <label>
                <span>{t(locale, 'invitations.role')}</span>
                <select value={role} onChange={(event) => setRole(event.target.value as 'editor' | 'viewer')}>
                  <option value="editor">{t(locale, 'invitations.roleEditor')}</option>
                  <option value="viewer">{t(locale, 'invitations.roleViewer')}</option>
                </select>
              </label>
              <label>
                <span>{t(locale, 'auth.phone')} / {t(locale, 'auth.email')}</span>
                <select value={provider} onChange={(event) => setProvider(event.target.value as Provider)}>
                  <option value="phone">{t(locale, 'auth.phone')}</option>
                  <option value="email">{t(locale, 'auth.email')}</option>
                </select>
              </label>
              <button type="submit" className="btn primary" disabled={busy}>
                {t(locale, 'action.invite')}
              </button>
            </form>

            {data.invitations.length === 0 ? (
              <p className="empty">{t(locale, 'common.none')}</p>
            ) : (
              <ul className="plain-list">
                {data.invitations.map((invitation) => (
                  <li key={invitation.id} className="wrap">
                    <span>
                      {invitation.identifier} · {invitation.role} · {invitation.status}
                    </span>
                    <code className="token">{invitation.token}</code>
                    <button type="button" className="link" onClick={() => copyToken(invitation)}>
                      {copiedId === invitation.id ? t(locale, 'invitations.copied') : t(locale, 'invitations.copy')}
                    </button>
                    {invitation.status === 'pending' && (
                      <button
                        type="button"
                        className="link danger"
                        onClick={() => revoke(invitation)}
                        disabled={busy}
                      >
                        {t(locale, 'invitations.revoke')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
