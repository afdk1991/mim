import { useState } from 'react';
import { normalizeLocale, t } from '@mim/i18n';
import type { Locale } from '@mim/i18n';
import { api, clearSession, getSession, setSession } from './api';
import type { Session, UserInfo } from './api';
import { Dashboard } from './views/Dashboard';
import { Login } from './views/Login';
import { Plans } from './views/Plans';
import { ProjectDetail } from './views/ProjectDetail';
import { Projects } from './views/Projects';
import { Settings } from './views/Settings';

type View = 'dashboard' | 'projects' | 'plans' | 'settings';

interface Route {
  view: View;
  projectId?: string;
}

export function App() {
  const [session, setLocalSession] = useState<Session | null>(getSession());
  const [route, setRoute] = useState<Route>({ view: 'dashboard' });

  if (!session) {
    return (
      <Login
        onLogin={(result) => {
          setSession(result);
          setLocalSession(result);
          setRoute({ view: 'dashboard' });
        }}
      />
    );
  }

  const user = session.user;
  const locale: Locale = normalizeLocale(user.locale);

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      /* 退出登录时的网络失败不阻塞本地清理 */
    }
    clearSession();
    setLocalSession(null);
  }

  function handleUserUpdated(next: UserInfo) {
    const updated: Session = { ...session!, user: next };
    setSession(updated);
    setLocalSession(updated);
  }

  const navItems: Array<{ view: View; label: string }> = [
    { view: 'dashboard', label: t(locale, 'nav.dashboard') },
    { view: 'projects', label: t(locale, 'nav.projects') },
    { view: 'plans', label: t(locale, 'nav.plans') },
    { view: 'settings', label: t(locale, 'nav.settings') },
  ];

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-name">{t(locale, 'app.name')}</span>
          <span className="brand-tagline">{t(locale, 'app.tagline')}</span>
        </div>
        <nav className="nav">
          {navItems.map((item) => (
            <button
              key={item.view}
              type="button"
              className={`nav-item${route.view === item.view ? ' active' : ''}`}
              onClick={() => setRoute({ view: item.view })}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="user-name">{user.display_name || user.id.slice(0, 8)}</span>
          <span className="user-region">{user.region === 'cn' ? '中国区' : 'Global'}</span>
          <button type="button" className="btn ghost block" onClick={handleLogout}>
            {t(locale, 'action.logout')}
          </button>
        </div>
      </aside>

      <main className="main">
        {route.view === 'dashboard' && (
          <Dashboard
            locale={locale}
            onOpenProject={(projectId) => setRoute({ view: 'projects', projectId })}
          />
        )}
        {route.view === 'projects' &&
          (route.projectId ? (
            <ProjectDetail
              locale={locale}
              projectId={route.projectId}
              onBack={() => setRoute({ view: 'projects' })}
            />
          ) : (
            <Projects
              locale={locale}
              onOpenProject={(projectId) => setRoute({ view: 'projects', projectId })}
            />
          ))}
        {route.view === 'plans' && <Plans locale={locale} />}
        {route.view === 'settings' && (
          <Settings locale={locale} onUserUpdated={handleUserUpdated} />
        )}
      </main>
    </div>
  );
}

export type { Locale };
