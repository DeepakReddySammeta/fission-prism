import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import type { TripSummary } from '../types';
import { TripSummaryDisplay } from '../components/TripSummaryDisplay';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8787';

interface PlanRecord {
  id: string;
  title: string;
  destination: string;
  imageUrl: string | null;
  createdAt: string;
  trip: TripSummary;
  hotelDetails?: { propertyType: string; reviewCount: number } | null;
  flightDetails?: { cabin: string; aircraft: string } | null;
}

export default function PlanDetail() {
  const { id } = useParams();
  const { token, ready } = useAuth();
  const [plan, setPlan] = useState<PlanRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token || !id) return;
    fetch(`${API}/api/plans/${id}`, { headers: { authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setPlan)
      .catch(() => setError('Could not load this plan.'));
  }, [ready, token, id]);

  if (error) {
    return (
      <div className="plans-page">
        <p className="muted">{error}</p>
        <Link className="link-btn" to="/plans">← Back to My Plans</Link>
      </div>
    );
  }
  if (!plan) return null;

  const { trip } = plan;
  return (
    <div className="plans-page">
      <Link className="link-btn" to="/plans">← My Plans</Link>
      <div className="section-card plan-detail-card reveal">
        {plan.imageUrl && <div className="plan-detail-img" style={{ backgroundImage: `url(${plan.imageUrl})` }} />}
        <h1 className="a2-h2">{plan.title}</h1>
        <p className="a2-caption">Saved {new Date(plan.createdAt).toLocaleDateString()}</p>

        <div style={{ marginTop: 18 }}>
          <TripSummaryDisplay trip={trip} hotelDetails={plan.hotelDetails} flightDetails={plan.flightDetails} />
        </div>
      </div>
    </div>
  );
}
