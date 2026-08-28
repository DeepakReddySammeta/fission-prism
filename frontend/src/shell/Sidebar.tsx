import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AuthDialog } from '../auth/AuthDialog';
import { loadRecents, togglePin, removeRecent, RECENTS_EVENT, type RecentEntry } from './recents';
import { newChat } from './plannerBus';
import { usePlanner } from '../planner/PlannerContext';
import { APPS, classifyApp, type AppId } from './apps';
import { Button } from '@/components/ui/button';
import {
  PanelLeftClose, PanelLeftOpen, Plane, Stethoscope, Wallet,
  Cloud, CloudSun, Briefcase, Bookmark, CalendarDays, Star, ChevronRight,
} from 'lucide-react';

const APP_ICONS: Record<AppId, React.ReactNode> = {
  trip: <Plane size={15} />,
  health: <Stethoscope size={15} />,
  finance: <Wallet size={15} />,
};

const THEME_KEY = 'fission-exp-theme';

const RECENTS_COLLAPSED = 10;

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { user, logout } = useAuth();
  const { turns, openConversation } = usePlanner();
  const navigate = useNavigate();
  const location = useLocation();
  const [recents, setRecents] = useState<RecentEntry[]>(loadRecents());
  const [authOpen, setAuthOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem(THEME_KEY) as 'dark') || 'light');
  const [profileOpen, setProfileOpen] = useState(false);
  const [recentsExpanded, setRecentsExpanded] = useState(false);
  const [emailExpanded, setEmailExpanded] = useState(false);
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

  // Whichever app the most recent turn belongs to. Held in state rather than
  // recomputed inline so it *sticks*: while a freshly submitted prompt is
  // still in flight (intent not back yet) a bare query often can't be
  // classified, and we must keep the previously active app lit instead of
  // blanking the sidebar until the response lands. It only ever changes to a
  // new, confidently classified app — or clears when the chat itself is
  // emptied ("+ New chat").
  const [activeApp, setActiveApp] = useState<AppId | null>(null);
  const lastTurn = turns[turns.length - 1];

  useEffect(() => {
    if (!lastTurn) { setActiveApp(null); return; }
    const resolved = classifyApp(lastTurn.query, lastTurn.intent);
    // resolved === null → in-flight prompt or a plain clarification reply:
    // leave the current highlight exactly as it is.
    if (resolved) setActiveApp(resolved);
  }, [lastTurn?.id, lastTurn?.intent, lastTurn?.loading]);

  const goHome = () => { navigate('/'); newChat(); };
  const openRecent = (entry: RecentEntry) => {
    navigate('/');
    openConversation(entry.id, entry.query);
  };

  const handleLogout = () => {
    logout();
    setProfileOpen(false);
  };

  return (
    <>
      <aside className={`sidebar${collapsed ? ' sidebar-collapsed' : ''}`}>
        {/* Brand */}
        <div className="sidebar-top">
          <div className="sidebar-heading">
            <div className="brand brand-compact" onClick={goHome} role="button" tabIndex={0}>
              <span className="brand-mark">F</span>
              <strong className="sidebar-brand-text">Fission Prism</strong>
            </div>
            <button
              className="sidebar-toggle"
              onClick={onToggle}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
            >
              {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </button>
          </div>
          {!collapsed && <Button className="w-full" onClick={goHome}>+ New chat</Button>}
        </div>

        {!collapsed && <nav className="sidebar-nav">
          {/* Apps — the domain the current chat is being handled by lights up */}
          <div className="sidebar-section sidebar-section-apps">
            <div className="sidebar-section-label">Apps</div>
            <div className="app-list">
              {APPS.map((app) => (
                <div
                  key={app.id}
                  className={`app-row${activeApp === app.id ? ' app-row-active' : ''}`}
                  title={app.desc}
                >
                  <span className="app-row-icon" aria-hidden>{APP_ICONS[app.id]}</span>
                  <span className="app-row-body">
                    <span className="app-row-label">{app.label}</span>
                    <span className="app-row-desc">{app.desc}</span>
                  </span>
                  <span className="app-row-dot" aria-hidden />
                </div>
              ))}
            </div>
          </div>

          {/* Recents */}
          {pinned.length > 0 && (
            <div className="sidebar-section">
              <div className="sidebar-section-label">Pinned</div>
              {pinned.map((r) => <RecentRow key={r.id} entry={r} onOpen={() => openRecent(r)} />)}
            </div>
          )}

          <div className="sidebar-section">
            <div className="sidebar-section-label">Recents</div>
            {unpinned.length === 0 && <p className="sidebar-empty">Your recent searches will show up here.</p>}
            {(recentsExpanded ? unpinned : unpinned.slice(0, RECENTS_COLLAPSED)).map((r) => (
              <RecentRow key={r.id} entry={r} onOpen={() => openRecent(r)} />
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
        </nav>}

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

            {!collapsed && (
              user ? (
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
              )
            )}

            {collapsed && user && (
              <button
                className="account-avatar-collapsed"
                onClick={() => setProfileOpen((s) => !s)}
                title={user.email ?? 'Profile'}
                aria-label="Open profile menu"
              >
                {(user.email || '?').slice(0, 2).toUpperCase()}
              </button>
            )}

            {collapsed && !user && (
              <button
                className="theme-icon-btn"
                onClick={() => setAuthOpen(true)}
                title="Sign in"
                aria-label="Sign in"
              >
                →
              </button>
            )}

            {collapsed && profileOpen && user && (
              <div className="profile-menu profile-menu-up profile-menu-collapsed">
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
        </div>
      </aside>
      <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />
    </>
  );
}

function queryIcon(query: string): React.ReactNode {
  const q = query.toLowerCase();
  if (q.includes('weather')) return <CloudSun size={15} />;
  if (q.includes('trip') || q.includes('travel') || q.includes('flight') || q.includes('hotel')) return <Plane size={15} />;
  if (q.includes('dentist') || q.includes('doctor') || q.includes('health') || q.includes('hospital')) return <Stethoscope size={15} />;
  if (q.includes('appoint') || q.includes('schedule')) return <CalendarDays size={15} />;
  if (q.includes('booking') || q.includes('plan')) return <Bookmark size={15} />;
  if (q.includes('portfolio') || q.includes('invest') || q.includes('finance') || q.includes('stock')) return <Briefcase size={15} />;
  return <Star size={15} />;
}

function RecentRow({ entry, onOpen }: { entry: RecentEntry; onOpen: () => void }) {
  return (
    <div className={`recent-row${entry.pinned ? ' recent-row-pinned' : ''}`}>
      <button className="recent-query" onClick={onOpen} title={entry.query}>
        <span className="recent-icon" aria-hidden>{queryIcon(entry.query)}</span>
        <span className="recent-text">{entry.query}</span>
      </button>
      <span className="recent-chevron" aria-hidden><ChevronRight size={16} strokeWidth={2} /></span>
      <button className={`pin-btn${entry.pinned ? ' pinned' : ''}`} onClick={() => togglePin(entry.id)} aria-label="Pin">★</button>
      <button className="remove-btn" onClick={() => removeRecent(entry.id)} aria-label="Remove">×</button>
    </div>
  );
}
