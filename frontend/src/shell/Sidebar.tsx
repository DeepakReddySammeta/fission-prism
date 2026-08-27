import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AuthDialog } from '../auth/AuthDialog';
import { loadRecents, togglePin, removeRecent, RECENTS_EVENT, type RecentEntry } from './recents';
import { newChat } from './plannerBus';
import { usePlanner } from '../planner/PlannerContext';
import { Button } from '@/components/ui/button';

const THEME_KEY = 'fission-exp-theme';

const RECENTS_COLLAPSED = 5;

export function Sidebar() {
  const { user, logout } = useAuth();
  const { plan } = usePlanner();
  const navigate = useNavigate();
  const location = useLocation();
  const [recents, setRecents] = useState<RecentEntry[]>(loadRecents());
  const [authOpen, setAuthOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem(THEME_KEY) as 'dark') || 'light');
  const [profileOpen, setProfileOpen] = useState(false);
  const [recentsExpanded, setRecentsExpanded] = useState(false);
  const [emailExpanded, setEmailExpanded] = useState(false);
  const [navKey, setNavKey] = useState(0);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const refresh = () => setRecents(loadRecents());
    window.addEventListener(RECENTS_EVENT, refresh);
    return () => window.removeEventListener(RECENTS_EVENT, refresh);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    setProfileOpen(false);
    setEmailExpanded(false);
  }, [location.pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    if (profileOpen) {
      document.addEventListener('mousedown', onClick);
      return () => document.removeEventListener('mousedown', onClick);
    }
  }, [profileOpen]);

  const pinned = recents.filter((r) => r.pinned);
  const unpinned = recents.filter((r) => !r.pinned);

  const goHome = () => { navigate('/'); newChat(); setNavKey((k) => k + 1); };
  const sendQuery = (q: string) => { navigate('/'); plan(q); };

  const handleLogout = () => {
    logout();
    setProfileOpen(false);
  };

  return (
    <>
      <aside className="sidebar">
        {/* Brand */}
        <div className="sidebar-top">
          <div className="brand brand-compact" onClick={goHome} role="button" tabIndex={0}>
            <span className="brand-mark">F</span>
            <strong className="sidebar-brand-text">Fission</strong>
          </div>
          <Button className="w-full" onClick={goHome}>
            + New chat
          </Button>
        </div>

        <nav className="sidebar-nav">
          {/* Recents */}
          {pinned.length > 0 && (
            <div className="sidebar-section">
              <div className="sidebar-section-label">Pinned</div>
              {pinned.map((r) => <RecentRow key={r.id} entry={r} onOpen={() => sendQuery(r.query)} />)}
            </div>
          )}

          <div className="sidebar-section">
            <div className="sidebar-section-label">Recents</div>
            {unpinned.length === 0 && <p className="sidebar-empty">Your recent searches will show up here.</p>}
            {(recentsExpanded ? unpinned : unpinned.slice(0, RECENTS_COLLAPSED)).map((r) => (
              <RecentRow key={r.id} entry={r} onOpen={() => sendQuery(r.query)} />
            ))}
            {unpinned.length > RECENTS_COLLAPSED && (
              <button
                className="recents-toggle"
                onClick={() => setRecentsExpanded((s) => !s)}
              >
                {recentsExpanded ? 'Show less' : `Show ${unpinned.length - RECENTS_COLLAPSED} more`}
              </button>
            )}
          </div>
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="footer-row">
            <button
              className="theme-icon-btn"
              onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
              title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
              aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            >
              {theme === 'light' ? '🌙' : '☀️'}
            </button>

            {user ? (
              <div className="profile-dropdown-wrap" ref={profileRef}>
                <button
                  className="profile-trigger-compact"
                  onClick={() => setProfileOpen((s) => !s)}
                  aria-haspopup="true"
                  aria-expanded={profileOpen}
                >
                  <span className="a2-monogram account-avatar" aria-hidden>
                    {(user.email || '?').slice(0, 2).toUpperCase()}
                  </span>
                  <span className="profile-chevron" aria-hidden>{profileOpen ? '▲' : '▼'}</span>
                </button>

                {profileOpen && (
                  <div className="profile-menu profile-menu-up">
                    <div className="profile-menu-header">
                      <span className="a2-monogram account-avatar" aria-hidden>
                        {(user.email || '?').slice(0, 2).toUpperCase()}
                      </span>
                      <span
                        className={`profile-menu-email${emailExpanded ? ' is-expanded' : ''}`}
                        onClick={() => setEmailExpanded((s) => !s)}
                        title={user.email ?? undefined}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setEmailExpanded((s) => !s); }}
                      >
                        {user.email}
                      </span>
                    </div>
                    <div className="profile-menu-divider" />
                    <button className="profile-menu-item" onClick={() => { navigate('/activity'); setProfileOpen(false); }}>
                      <span className="profile-menu-icon" aria-hidden>📋</span>
                      <span>My Activity</span>
                    </button>
                    <div className="profile-menu-divider" />
                    <button className="profile-menu-item profile-menu-item-danger" onClick={handleLogout}>
                      <span className="profile-menu-icon" aria-hidden>→</span>
                      <span>Sign out</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setAuthOpen(true)}>Sign in</Button>
            )}
          </div>
        </div>
      </aside>
      <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />
    </>
  );
}

function RecentRow({ entry, onOpen }: { entry: RecentEntry; onOpen: () => void }) {
  return (
    <div className="recent-row">
      <button className="recent-query" onClick={onOpen} title={entry.query}>{entry.query}</button>
      <button className={`pin-btn${entry.pinned ? ' pinned' : ''}`} onClick={() => togglePin(entry.id)} aria-label="Pin">★</button>
      <button className="remove-btn" onClick={() => removeRecent(entry.id)} aria-label="Remove">×</button>
    </div>
  );
}
