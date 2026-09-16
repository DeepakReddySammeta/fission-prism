import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { usePlanner } from '../planner/PlannerContext';
import { APPS, classifyApp, type AppId } from './apps';
import { PrismMark } from './PrismMark';
import { Plane, Stethoscope, Wallet, ClipboardList } from 'lucide-react';

const APP_ICONS: Record<AppId, React.ReactNode> = {
  trip: <Plane size={14} />,
  health: <Stethoscope size={14} />,
  finance: <Wallet size={14} />,
};

/**
 * The bar above the workspace.
 *
 * It exists because Prism is embedded in the Fission AI Portal, which brings
 * its own full-height left nav; a second rail beside it read as two competing
 * navs rather than one workspace. So the header takes everything that was
 * only ever being *displayed* rather than scrolled — the domain indicators
 * above all — and Prism's own rail is left holding just new chat and the
 * conversation history, which genuinely need the vertical room.
 */
export function AppHeader() {
  const { turns } = usePlanner();
  const { standalone } = useAuth();
  const navigate = useNavigate();

  // Whichever app the most recent turn belongs to. Held in state rather than
  // recomputed inline so it *sticks*: while a freshly submitted prompt is
  // still in flight (intent not back yet) a bare query often can't be
  // classified, and we must keep the previously active app lit instead of
  // blanking it until the response lands. It only ever changes to a new,
  // confidently classified app — or clears when the chat is emptied.
  const [activeApp, setActiveApp] = useState<AppId | null>(null);
  const lastTurn = turns[turns.length - 1];

  useEffect(() => {
    if (!lastTurn) { setActiveApp(null); return; }
    const resolved = classifyApp(lastTurn.intent);
    if (resolved) setActiveApp(resolved);
  }, [lastTurn?.id, lastTurn?.intent, lastTurn?.loading]);

  return (
    <header className="app-header">
      <div className="app-header-left">
        {/* Inside the portal the app is already named in its sidebar and again
            on the hero — a third mark is just noise. Standalone there is
            nothing else identifying the app, so it earns its place. */}
        {standalone && (
          <div className="app-header-brand">
            <PrismMark size={26} />
            <strong>Prism</strong>
          </div>
        )}

        {/* All three domains stay on screen so the user can see the full scope
            of what Prism answers, not just whichever one the last question
            happened to hit. They are indicators, not controls — the router
            picks the domain from the question itself (see apps.ts), so they
            deliberately carry no button affordance. */}
        <div className="domain-rail" role="status" aria-live="polite">
          {APPS.map((app) => {
            const isActive = activeApp === app.id;
            return (
              <span
                key={app.id}
                className={`domain-item${isActive ? ' domain-item-active' : ''}`}
                title={app.desc}
              >
                <span className="domain-item-icon" aria-hidden>{APP_ICONS[app.id]}</span>
                <span className="domain-item-label">{app.label}</span>
                <span className="sr-only">{isActive ? ' (answering this conversation)' : ''}</span>
              </span>
            );
          })}
        </div>
      </div>

      <div className="app-header-right">
        <button
          className="header-btn"
          onClick={() => navigate('/activity')}
          title="My Activity — plans, bookings and appointments"
        >
          <ClipboardList size={15} />
          <span>Activity</span>
        </button>
      </div>
    </header>
  );
}
