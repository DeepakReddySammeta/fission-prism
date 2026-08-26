import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AuthDialog } from '../auth/AuthDialog';
import { loadRecents, togglePin, removeRecent, RECENTS_EVENT, type RecentEntry } from './recents';
import { newChat } from './plannerBus';
import { usePlanner } from '../planner/PlannerContext';
import { Button } from '@/components/ui/button';

const THEME_KEY = 'voyage-ai-theme';

export function Sidebar() {
  const { user, logout } = useAuth();
  const { openConversation } = usePlanner();
  const navigate = useNavigate();
  const [recents, setRecents] = useState<RecentEntry[]>(loadRecents());
  const [authOpen, setAuthOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem(THEME_KEY) as 'dark') || 'light');

  useEffect(() => {
    const refresh = () => setRecents(loadRecents());
    window.addEventListener(RECENTS_EVENT, refresh);
    return () => window.removeEventListener(RECENTS_EVENT, refresh);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const pinned = recents.filter((r) => r.pinned);
  const unpinned = recents.filter((r) => !r.pinned);

  // Opens the actual existing conversation — its turns, live A2UI stores and
  // all — instead of re-asking its first query as a brand new one. Only
  // falls back to actually re-asking (see openConversation) when that
  // conversation isn't in memory any more, e.g. after a page refresh.
  const openRecent = (entry: RecentEntry) => { navigate('/'); openConversation(entry.id, entry.query); };

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="brand brand-compact">
            <span className="brand-mark">V</span>
            <strong>Voyage AI</strong>
          </div>
          <Button className="w-full" onClick={() => { navigate('/'); newChat(); }}>
            + New chat
          </Button>
        </div>

        <nav className="sidebar-nav">
          <NavLink to="/plans" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
            <span className="sidebar-link-icon" aria-hidden>🗂</span> My Plans
          </NavLink>
          <NavLink to="/bookings" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
            <span className="sidebar-link-icon" aria-hidden>🎫</span> My Bookings
          </NavLink>

          {pinned.length > 0 && (
            <div className="sidebar-section">
              <div className="sidebar-section-label">Pinned</div>
              {pinned.map((r) => <RecentRow key={r.id} entry={r} onOpen={() => openRecent(r)} />)}
            </div>
          )}

          <div className="sidebar-section">
            <div className="sidebar-section-label">Recents</div>
            {unpinned.length === 0 && <p className="sidebar-empty">Your recent searches will show up here.</p>}
            {unpinned.map((r) => <RecentRow key={r.id} entry={r} onOpen={() => openRecent(r)} />)}
          </div>
        </nav>

        <div className="sidebar-footer">
          <button className="theme-toggle" onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}>
            <span className="sidebar-link-icon" aria-hidden>{theme === 'light' ? '🌙' : '☀️'}</span>
            {theme === 'light' ? 'Dark mode' : 'Light mode'}
          </button>
          {user ? (
            <div className="account-row">
              <span className="a2-monogram account-avatar" aria-hidden>{(user.email || '?').slice(0, 2).toUpperCase()}</span>
              <span className="account-email">{user.email}</span>
              <button className="link-btn" onClick={logout}>Sign out</button>
            </div>
          ) : (
            <Button className="w-full" variant="secondary" onClick={() => setAuthOpen(true)}>Sign in</Button>
          )}
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
