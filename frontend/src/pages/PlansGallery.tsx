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

function PlanCard({ plan, onOpen, onDelete }: {
  plan: PlanSummary; onOpen: (id: string) => void; onDelete: (e: React.MouseEvent, p: PlanSummary) => void;
}) {
  return (
    <div
      className="plan-card-v2 reveal"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(plan.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen(plan.id); }}
    >
      <button
        className="plan-card-delete-v2"
        onClick={(e) => onDelete(e, plan)}
        aria-label={`Delete ${plan.title}`}
        title="Delete plan"
      >
        🗑
      </button>
      <div className="pc-image-wrap">
        {plan.imageUrl ? (
          <div className="pc-image" style={{ backgroundImage: `url(${plan.imageUrl})` }} />
        ) : (
          <div className="pc-image-fallback"><span>🗺️</span></div>
        )}
      </div>
      <div className="pc-body">
        <div className="pc-title-row">
          <h3 className="pc-title">{plan.title}</h3>
          <span className="pc-arrow" aria-hidden>→</span>
        </div>
        <p className="pc-meta">{plan.destination} · {new Date(plan.createdAt).toLocaleDateString()}</p>
        <div className="pc-footer">
          {plan.totalPrice ? (
            <span className="pc-price">₹{plan.totalPrice.toLocaleString()}</span>
          ) : (
            <span />
          )}
          <span className="pc-action">View details</span>
        </div>
      </div>
    </div>
  );
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
      <div className="plans-page plans-page-bg">
        <div className="plans-header">
          <div className="plans-header-icon" aria-hidden>🗺️</div>
          <div className="plans-header-text">
            <h1 className="a2-h1">My Plans</h1>
            <div className="plans-header-line" />
          </div>
        </div>
        <div className="empty-state-box">
          <div className="empty-icon" aria-hidden>🔐</div>
          <h3>Sign in to continue</h3>
          <p>Sign in to see the trips you've saved and pick up where you left off.</p>
          <Button onClick={() => setAuthOpen(true)}>Sign in</Button>
        </div>
        <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />
      </div>
    );
  }

  const categories = [
    { value: 'all' as DateFilter, label: 'All', count: plans?.length ?? 0 },
    { value: 'upcoming' as DateFilter, label: 'Upcoming', count: plans?.filter((p) => !p.travelDate || p.travelDate >= new Date().toISOString().slice(0, 10)).length ?? 0 },
    { value: 'past' as DateFilter, label: 'Past', count: plans?.filter((p) => !!p.travelDate && p.travelDate < new Date().toISOString().slice(0, 10)).length ?? 0 },
  ];

  return (
    <div className="plans-page plans-page-bg">
      <div className="plans-header">
        <div className="plans-header-icon" aria-hidden>🗺️</div>
        <div className="plans-header-text">
          <h1 className="a2-h1">My Plans</h1>
          <div className="plans-header-line" />
        </div>
      </div>

      <Tabs value={filter} onValueChange={(v) => setSearchParams(v === 'all' ? {} : { filter: v })}>
        <div className="plans-toolbar-wrap">
          <div className="plans-tabs">
            <TabsList>
              {categories.map((c) => (
                <TabsTrigger key={c.value} value={c.value}>
                  {c.label}
                  <span className="tab-count">{c.count}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </div>

        <TabsContent value={filter}>
          <div className="plans-content" key={`plans-${filter}`}>
            {plans === null && (
              <div className="empty-state-box">
                <div className="empty-icon" aria-hidden>⏳</div>
                <h3>Loading your trips…</h3>
              </div>
            )}
            {plans?.length === 0 && (
              <div className="empty-state-box">
                <div className="empty-icon" aria-hidden>📭</div>
                <h3>No {filter === 'all' ? '' : filter} plans</h3>
                <p>
                  {filter === 'all'
                    ? "No saved plans yet — plan a trip and save it here once you've picked a flight or hotel."
                    : `No ${filter} plans found.`}
                </p>
              </div>
            )}
            {plans && plans.length > 0 && (
              <div className="plans-grid stagger-reveal">
                {plans.map((p, i) => (
                  <div key={p.id} style={{ animationDelay: `${i * 60}ms` }}>
                    <PlanCard plan={p} onOpen={setOpenPlanId} onDelete={requestDelete} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

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
