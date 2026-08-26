import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AuthDialog } from '../auth/AuthDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PlanDetailDrawer } from '../components/PlanDetailDrawer';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8787';

type DateFilter = 'all' | 'upcoming' | 'past';

interface PlanSummary {
  id: string;
  title: string;
  destination: string;
  imageUrl: string | null;
  createdAt: string;
  totalPrice?: number;
  travelDate: string | null;
}

export default function PlansGallery() {
  const { user, token, ready } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter: DateFilter = (searchParams.get('filter') as DateFilter) || 'all';
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PlanSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [openPlanId, setOpenPlanId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setPlans(null); return; }
    fetch(`${API}/api/plans?filter=${filter}`, { headers: { authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then(setPlans);
  }, [token, filter]);

  const requestDelete = (e: React.MouseEvent, plan: PlanSummary) => {
    // Sits on top of a card that's otherwise one big <Link> — stop the click
    // from also navigating into the plan it's about to delete.
    e.preventDefault();
    e.stopPropagation();
    setPendingDelete(plan);
  };

  const confirmDelete = async () => {
    if (!token || !pendingDelete) return;
    setDeleting(true);
    const res = await fetch(`${API}/api/plans/${pendingDelete.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const deletedId = pendingDelete.id;
      setPlans((prev) => prev?.filter((p) => p.id !== deletedId) ?? prev);
    }
    setDeleting(false);
    setPendingDelete(null);
  };

  if (!ready) return null;

  if (!user) {
    return (
      <div className="plans-page">
        <h1 className="a2-h1">My Plans</h1>
        <div className="empty-state">
          <p>Sign in to see the trips you've saved.</p>
          <Button onClick={() => setAuthOpen(true)}>Sign in</Button>
        </div>
        <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />
      </div>
    );
  }

  return (
    <div className="plans-page">
      <h1 className="a2-h1">My Plans</h1>
      <Tabs value={filter} onValueChange={(v) => setSearchParams(v === 'all' ? {} : { filter: v })}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
          <TabsTrigger value="past">Past</TabsTrigger>
        </TabsList>
      </Tabs>
      {plans === null && <p className="muted">Loading…</p>}
      {plans?.length === 0 && (
        <div className="empty-state">
          <p>
            {filter === 'all'
              ? "No saved plans yet — plan a trip and save it here once you've picked a flight or hotel."
              : `No ${filter} plans.`}
          </p>
        </div>
      )}
      <div className="plans-grid">
        {plans?.map((p) => (
          <div
            key={p.id}
            className="plan-card reveal"
            role="button"
            tabIndex={0}
            onClick={() => setOpenPlanId(p.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpenPlanId(p.id); }}
          >
            <button
              className="plan-card-delete"
              onClick={(e) => requestDelete(e, p)}
              aria-label={`Delete ${p.title}`}
              title="Delete plan"
            >
              🗑
            </button>
            <div className="plan-card-img" style={p.imageUrl ? { backgroundImage: `url(${p.imageUrl})` } : undefined} />
            <div className="plan-card-body">
              <h3 className="a2-h3">{p.title}</h3>
              <p className="a2-caption">{p.destination} · {new Date(p.createdAt).toLocaleDateString()}</p>
              {p.totalPrice ? <p className="a2-h3">₹{p.totalPrice}</p> : null}
            </div>
          </div>
        ))}
      </div>
      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete this plan?"
        description={pendingDelete ? `"${pendingDelete.title}" will be permanently removed. This can't be undone.` : undefined}
        confirmLabel="Delete"
        destructive
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
      <PlanDetailDrawer planId={openPlanId} onClose={() => setOpenPlanId(null)} />
    </div>
  );
}
