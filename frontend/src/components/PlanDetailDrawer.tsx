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

  useEffect(() => {
    if (!planId || !token) { setPlan(null); return; }
    let cancelled = false;
    setPlan(null);
    fetch(`${API}/api/plans/${planId}`, { headers: { authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setPlan(d); });
    return () => { cancelled = true; };
  }, [planId, token]);

  useEffect(() => {
    if (!planId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [planId, onClose]);

  if (!planId) return null;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="plan-drawer" role="dialog" aria-modal="true">
        <button className="drawer-close" onClick={onClose} aria-label="Close">×</button>
        {!plan ? (
          <p className="muted" style={{ padding: 24 }}>Loading…</p>
        ) : (
          <>
            {plan.imageUrl && <div className="drawer-hero-img" style={{ backgroundImage: `url(${plan.imageUrl})` }} />}
            <div className="drawer-body">
              <h2 className="a2-h1">{plan.title}</h2>
              <p className="a2-caption">{plan.destination} · Saved {new Date(plan.createdAt).toLocaleDateString()}</p>
              <div style={{ marginTop: 18 }}>
                <TripSummaryDisplay trip={plan.trip} hotelDetails={plan.hotelDetails} flightDetails={plan.flightDetails} />
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
