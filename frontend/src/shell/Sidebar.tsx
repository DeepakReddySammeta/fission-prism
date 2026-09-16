import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadRecents, togglePin, removeRecent, RECENTS_EVENT, type RecentEntry } from './recents';
import { newChat } from './plannerBus';
import { usePlanner } from '../planner/PlannerContext';
import { Button } from '@/components/ui/button';
import {
  Plane, Stethoscope, CloudSun, Briefcase, Bookmark, CalendarDays, Star, X,
} from 'lucide-react';

/** How many unpinned entries show before "Show N more". */
const RECENTS_COLLAPSED = 10;

function queryIcon(query: string): React.ReactNode {
  const q = query.toLowerCase();
  if (q.includes('weather')) return <CloudSun size={14} />;
  if (q.includes('trip') || q.includes('travel') || q.includes('flight') || q.includes('hotel')) return <Plane size={14} />;
  if (q.includes('dentist') || q.includes('doctor') || q.includes('health') || q.includes('hospital')) return <Stethoscope size={14} />;
  if (q.includes('appoint') || q.includes('schedule')) return <CalendarDays size={14} />;
  if (q.includes('booking') || q.includes('plan')) return <Bookmark size={14} />;
  if (q.includes('portfolio') || q.includes('invest') || q.includes('finance') || q.includes('stock')) return <Briefcase size={14} />;
  return <Star size={14} />;
}

function RecentRow({ entry, active, onOpen }: { entry: RecentEntry; active: boolean; onOpen: () => void }) {
  return (
    <div className={`recent-row${active ? ' recent-row-active' : ''}`}>
      <button className="recent-row-main" onClick={onOpen} title={entry.query}>
        <span className="recent-row-icon" aria-hidden>{queryIcon(entry.query)}</span>
        <span className="recent-row-text">{entry.query}</span>
      </button>
      <button
        className={`recent-row-action${entry.pinned ? ' is-pinned' : ''}`}
        onClick={(e) => { e.stopPropagation(); togglePin(entry.id); }}
        aria-label={entry.pinned ? `Unpin ${entry.query}` : `Pin ${entry.query}`}
        title={entry.pinned ? 'Unpin' : 'Pin'}
      >
        <Star size={13} fill={entry.pinned ? 'currentColor' : 'none'} />
      </button>
      <button
        className="recent-row-action"
        onClick={(e) => { e.stopPropagation(); removeRecent(entry.id); }}
        aria-label={`Remove ${entry.query}`}
        title="Remove"
      >
        <X size={13} />
      </button>
    </div>
  );
}

/**
 * New chat and conversation history.
 *
 * Deliberately narrow and deliberately quiet: the portal supplies its own
 * full-height rail immediately to the left, so this one earns its place only
 * by holding what genuinely needs vertical room and constant visibility —
 * the list of past conversations. Everything that was merely being displayed
 * (the domain indicator) or clicked rarely (activity) lives in the header
 * instead, which is what keeps two adjacent rails from reading as two navs.
 */
export function Sidebar() {
  const { activeId, openConversation } = usePlanner();
  const navigate = useNavigate();
  const [recents, setRecents] = useState<RecentEntry[]>(loadRecents());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const refresh = () => setRecents(loadRecents());
    window.addEventListener(RECENTS_EVENT, refresh);
    return () => window.removeEventListener(RECENTS_EVENT, refresh);
  }, []);

  const pinned = recents.filter((r) => r.pinned);
  const unpinned = recents.filter((r) => !r.pinned);
  const shown = expanded ? unpinned : unpinned.slice(0, RECENTS_COLLAPSED);

  const openRecent = (entry: RecentEntry) => {
    navigate('/');
    openConversation(entry.id, entry.query);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <Button className="w-full" onClick={() => { navigate('/'); newChat(); }}>
          + New chat
        </Button>
      </div>

      <nav className="sidebar-nav" aria-label="Recent conversations">
        {recents.length === 0 && (
          <p className="sidebar-empty">Your recent searches will show up here.</p>
        )}

        {pinned.length > 0 && (
          <div className="sidebar-section">
            <div className="sidebar-section-label">Pinned</div>
            {pinned.map((r) => (
              <RecentRow key={r.id} entry={r} active={r.id === activeId} onOpen={() => openRecent(r)} />
            ))}
          </div>
        )}

        {unpinned.length > 0 && (
          <div className="sidebar-section">
            <div className="sidebar-section-label">Recents</div>
            {shown.map((r) => (
              <RecentRow key={r.id} entry={r} active={r.id === activeId} onOpen={() => openRecent(r)} />
            ))}
            {unpinned.length > RECENTS_COLLAPSED && (
              <button className="sidebar-more" onClick={() => setExpanded((s) => !s)}>
                {expanded ? 'Show less' : `Show ${unpinned.length - RECENTS_COLLAPSED} more`}
              </button>
            )}
          </div>
        )}
      </nav>
    </aside>
  );
}
