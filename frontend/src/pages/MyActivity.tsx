import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AuthDialog } from '../auth/AuthDialog';
import { Button } from '@/components/ui/button';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8787';

type Category = 'all' | 'travel' | 'health';

interface FeatureCard {
  id: string;
  category: Category;
  icon: string;
  title: string;
  description: string;
  link?: string;
  countKey?: 'plans' | 'bookings';
}

const FEATURES: FeatureCard[] = [
  {
    id: 'plans',
    category: 'travel',
    icon: '🗺️',
    title: 'My Plans',
    description: 'Saved trip plans and itineraries',
    link: '/plans',
    countKey: 'plans',
  },
  {
    id: 'bookings',
    category: 'travel',
    icon: '🎫',
    title: 'My Bookings',
    description: 'Confirmed flights and stays',
    link: '/bookings',
    countKey: 'bookings',
  },
  {
    id: 'appointments',
    category: 'health',
    icon: '📅',
    title: 'My Appointments',
    description: 'Upcoming and past visits',
    link: '/appointments',
  },
];

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'travel', label: 'Travel' },
  { value: 'health', label: 'Health' },
];

interface PlanSummary {
  id: string;
  bookingRef?: string;
}

export default function MyActivity() {
  const { user, token, ready } = useAuth();
  const navigate = useNavigate();
  const [category, setCategory] = useState<Category>('all');
  const [counts, setCounts] = useState<{ plans: number; bookings: number }>({ plans: 0, bookings: 0 });
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    if (!token) {
      setCounts({ plans: 0, bookings: 0 });
      return;
    }
    fetch(`${API}/api/plans`, { headers: { authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((plans: PlanSummary[]) => {
        const bookings = plans.filter((p) => p.bookingRef);
        setCounts({ plans: plans.length, bookings: bookings.length });
      });
  }, [token]);

  const handleCardClick = (feature: FeatureCard) => {
    if (feature.link) {
      navigate(feature.link);
    }
  };

  const filtered = category === 'all' ? FEATURES : FEATURES.filter((f) => f.category === category);

  if (!ready) return null;

  if (!user) {
    return (
      <div className="activity-page activity-page-bg">
        <div className="activity-header">
          <div className="activity-header-icon" aria-hidden>📋</div>
          <div>
            <h1 className="a2-h1">My Activity</h1>
            <div className="activity-header-line" />
          </div>
        </div>
        <div className="empty-state-box">
          <div className="empty-icon" aria-hidden>🔐</div>
          <h3>Sign in to continue</h3>
          <p>Sign in to see your plans, bookings, and more in one place.</p>
          <Button onClick={() => setAuthOpen(true)}>Sign in</Button>
        </div>
        <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />
      </div>
    );
  }

  return (
    <div className="activity-page activity-page-bg">
      <div className="activity-header">
        <div className="activity-header-icon" aria-hidden>📋</div>
        <div>
          <h1 className="a2-h1">My Activity</h1>
          <div className="activity-header-line" />
        </div>
      </div>

      <div className="activity-chips">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            className={`trending-chip activity-chip${category === c.value ? ' active' : ''}`}
            onClick={() => setCategory(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state-box">
          <div className="empty-icon" aria-hidden>📭</div>
          <h3>No activity yet</h3>
          <p>Explore the app to see your activity here.</p>
        </div>
      ) : (
        <div className="activity-grid stagger-reveal">
          {filtered.map((f, i) => (
            <div key={f.id} style={{ animationDelay: `${i * 60}ms` }}>
              <div
                className="section-card activity-card"
                onClick={() => handleCardClick(f)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') handleCardClick(f);
                }}
              >
                <div className="activity-card-icon" aria-hidden>{f.icon}</div>
                <div className="activity-card-title">{f.title}</div>
                <div className="activity-card-desc">{f.description}</div>
                {f.countKey && (
                  <div className="activity-card-meta">
                    {counts[f.countKey]} {counts[f.countKey] === 1 ? 'item' : 'items'}
                  </div>
                )}
                <div className="activity-card-cta">
                  {f.link ? (
                    <>
                      <span>View all</span>
                      <span aria-hidden>→</span>
                    </>
                  ) : (
                    <>
                      <span>Start chat</span>
                      <span aria-hidden>→</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
