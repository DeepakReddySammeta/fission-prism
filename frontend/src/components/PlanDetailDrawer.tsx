import React, { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { TripSummaryDisplay } from './TripSummaryDisplay';
import type { TripSummary } from '../types';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8787';

interface PlanDetail {
  id: string;
  title: string;
  destination: string;
  imageUrl: string | null;
  createdAt: string;
  trip: TripSummary;
  hotelDetails?: { propertyType: string; reviewCount: number } | null;
  flightDetails?: { cabin: string; aircraft: string } | null;
}

/** Slide-over panel for "View full plan" — used by both PlansGallery and
 * MyBookings so neither has to navigate away from its grid (losing scroll
 * position/filter state) just to show one plan's full breakdown. `planId`
 * being non-null is what opens it; the grid page owns that state. */
export function PlanDetailDrawer({ planId, onClose }: { planId: string | null; onClose: () => void }) {
  const { token } = useAuth();
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!planId || !token) { setPlan(null); return; }
    let cancelled = false;
    setPlan(null);
    setClosing(false);
    fetch(`${API}/api/plans/${planId}`, { headers: { authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setPlan(d); });
    return () => { cancelled = true; };
  }, [planId, token]);

  useEffect(() => {
    if (!planId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') triggerClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [planId]);

  const triggerClose = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 1350);
  };

  if (!planId) return null;

  return (
    <>
      <div className={`drawer-backdrop${closing ? ' drawer-backdrop--out' : ''}`} onClick={triggerClose} />
      <div className="plan-drawer-modal" role="dialog" aria-modal="true" onClick={triggerClose}>
        <div className={`plan-drawer-content${closing ? ' plan-drawer-content--out' : ''}`} onClick={(e) => e.stopPropagation()}>
          <button className="drawer-close" onClick={triggerClose} aria-label="Close">×</button>
          {!plan ? (
            <div className="drawer-loading">
              <div className="skel-row" style={{ justifyContent: 'center' }}>
                <div className="skel-col" style={{ maxWidth: 180, alignItems: 'center', gap: 12 }}>
                  <div className="skel-line skel-w-140" />
                  <div className="skel-line skel-w-100" />
                </div>
              </div>
            </div>
          ) : (
            <>
              {plan.imageUrl && (
                <div className="drawer-hero-wrap">
                  <div className="drawer-hero-img" style={{ backgroundImage: `url(${plan.imageUrl})` }} />
                </div>
              )}
              <div className="drawer-body">
                <div className="drawer-header">
                  <h2 className="drawer-title">{plan.title}</h2>
                  <p className="drawer-subtitle">{plan.destination} · Saved {new Date(plan.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="drawer-summary">
                  <TripSummaryDisplay trip={plan.trip} hotelDetails={plan.hotelDetails} flightDetails={plan.flightDetails} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
