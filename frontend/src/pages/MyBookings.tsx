import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AuthDialog } from '../auth/AuthDialog';
import { PlanDetailDrawer } from '../components/PlanDetailDrawer';
import type { TripSummary } from '../types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8787';

interface PlanSummary {
  id: string;
  title: string;
  destination: string;
  imageUrl: string | null;
  createdAt: string;
  totalPrice?: number;
  bookingRef?: string;
}

interface BookingRecord {
  id: string;
  title: string;
  imageUrl: string | null;
  createdAt: string;
  trip: TripSummary;
}

/** A compact summary for the grid — the full flight/hotel/room/pricing
 * breakdown (TripSummaryDisplay) is a lot to show once per card across a
 * whole grid of bookings; that level of detail belongs on the "View full
 * plan" page, one booking at a time. This card answers just "which trip is
 * this, when, and how much" at a glance. */
function BookingCard({ booking, onOpen }: { booking: BookingRecord; onOpen: (id: string) => void }) {
  const { trip } = booking;
  const dateRange = trip.checkIn && trip.checkOut ? `${trip.checkIn} → ${trip.checkOut}` : null;

  return (
    <div className="booking-card-v2 reveal" onClick={() => onOpen(booking.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen(booking.id); }}>
      {/* Image */}
      <div className="bc-image-wrap">
        {booking.imageUrl ? (
          <div className="bc-image" style={{ backgroundImage: `url(${booking.imageUrl})` }} />
        ) : (
          <div className="bc-image-fallback">
            <span>🧳</span>
          </div>
        )}
        {trip.bookingRef && (
          <div className="bc-status">
            <span className="bc-status-dot" />
            <span>Booked</span>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="bc-body">
        <div className="bc-title-row">
          <h3 className="bc-title">{booking.title}</h3>
          <span className="bc-arrow" aria-hidden>→</span>
        </div>

        <p className="bc-meta">Booked {new Date(booking.createdAt).toLocaleDateString()}</p>

        <div className="bc-tags">
          {trip.flight && (
            <span className="bc-tag">
              <span className="bc-tag-icon" aria-hidden>✈️</span>
              <span>{trip.flight.airline}</span>
            </span>
          )}
          {trip.hotel && (
            <span className="bc-tag">
              <span className="bc-tag-icon" aria-hidden>🏨</span>
              <span>{trip.hotel.name}</span>
            </span>
          )}
        </div>

        {dateRange && <p className="bc-dates">{dateRange}</p>}

        <div className="bc-footer">
          {trip.totalPrice ? (
            <span className="bc-price">₹{trip.totalPrice.toLocaleString()}</span>
          ) : (
            <span />
          )}
          <span className="bc-action">View details</span>
        </div>
      </div>
    </div>
  );
}

/** A confirmed booking is just a saved plan whose trip reached a bookingRef
 * — no separate storage, no separate "book" step beyond the one already in
 * the trip rail. This page is a filtered, richer-detail view of "My Plans"
 * for exactly the ones that got there.
 *
 * There are three distinct ways a traveler ends up here, and the tabs are
 * mutually exclusive along exactly those lines rather than "has a flight" /
 * "has a room" (which would double-list a full trip in both tabs, showing
 * the same combined card twice):
 *   1. Full trip  — booked both a flight and a room in the same session.
 *   2. Flight only — e.g. already has a hotel booked elsewhere.
 *   3. Room only   — e.g. already has a flight booked elsewhere.
 */
type DateFilter = 'all' | 'upcoming' | 'past';

export default function MyBookings() {
  const { user, token, ready } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const dateFilter: DateFilter = (searchParams.get('filter') as DateFilter) || 'all';
  const [bookings, setBookings] = useState<BookingRecord[] | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [openPlanId, setOpenPlanId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setBookings(null); return; }
    let cancelled = false;
    (async () => {
      const res = await fetch(`${API}/api/plans`, { headers: { authorization: `Bearer ${token}` } });
      const plans: PlanSummary[] = res.ok ? await res.json() : [];
      const booked = plans.filter((p) => p.bookingRef);
      const details = await Promise.all(
        booked.map(async (p) => {
          const r = await fetch(`${API}/api/plans/${p.id}`, { headers: { authorization: `Bearer ${token}` } });
          return r.ok ? await r.json() : null;
        })
      );
      if (!cancelled) setBookings(details.filter(Boolean) as BookingRecord[]);
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (!ready) return null;

  if (!user) {
    return (
      <div className="plans-page bookings-page-bg">
        <div className="bookings-header">
          <div className="bookings-header-icon" aria-hidden>🎫</div>
          <div className="bookings-header-text">
            <h1 className="a2-h1">My Bookings</h1>
            <div className="bookings-header-line" />
          </div>
        </div>
        <div className="empty-state-box">
          <div className="empty-icon" aria-hidden>🔐</div>
          <h3>Sign in to continue</h3>
          <p>Sign in to see your confirmed bookings and manage your trips.</p>
          <Button onClick={() => setAuthOpen(true)}>Sign in</Button>
        </div>
        <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />
      </div>
    );
  }

  if (bookings === null) {
    return (
      <div className="plans-page bookings-page-bg">
        <div className="bookings-header">
          <div className="bookings-header-icon" aria-hidden>🎫</div>
          <div className="bookings-header-text">
            <h1 className="a2-h1">My Bookings</h1>
            <div className="bookings-header-line" />
          </div>
        </div>
        <div className="empty-state-box">
          <div className="empty-icon" aria-hidden>⏳</div>
          <h3>Loading your trips…</h3>
        </div>
      </div>
    );
  }

  if (bookings.length === 0) {
    return (
      <div className="plans-page bookings-page-bg">
        <div className="bookings-header">
          <div className="bookings-header-icon" aria-hidden>🎫</div>
          <div className="bookings-header-text">
            <h1 className="a2-h1">My Bookings</h1>
            <div className="bookings-header-line" />
          </div>
        </div>
        <div className="empty-state-box">
          <div className="empty-icon" aria-hidden>✈️</div>
          <h3>No bookings yet</h3>
          <p>Confirm a flight or a room, then save the trip to see it here.</p>
        </div>
      </div>
    );
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const dateFiltered = bookings.filter((b) => {
    if (dateFilter === 'all') return true;
    const travelDate = b.trip.checkIn || b.trip.flight?.date || null;
    return dateFilter === 'upcoming' ? (!travelDate || travelDate >= todayIso) : (!!travelDate && travelDate < todayIso);
  });

  const fullTrips = dateFiltered.filter((b) => b.trip.flight && b.trip.room);
  const flightsOnly = dateFiltered.filter((b) => b.trip.flight && !b.trip.room);
  const roomsOnly = dateFiltered.filter((b) => b.trip.room && !b.trip.flight);

  const categories = [
    { value: 'trips', label: 'Full Trips', items: fullTrips, empty: 'No complete trips (flight + room) booked yet.' },
    { value: 'flights', label: 'Flights Only', items: flightsOnly, empty: 'No flight-only bookings yet.' },
    { value: 'rooms', label: 'Rooms Only', items: roomsOnly, empty: 'No room-only bookings yet.' },
  ];

  return (
    <div className="plans-page bookings-page-bg">
      <div className="bookings-header">
        <div className="bookings-header-icon" aria-hidden>🎫</div>
        <div className="bookings-header-text">
          <h1 className="a2-h1">My Bookings</h1>
          <div className="bookings-header-line" />
        </div>
      </div>

      <Tabs defaultValue="trips">
        <div className="bookings-toolbar-wrap">
          <div className="bookings-tabs">
            <TabsList>
              {categories.map((c) => (
                <TabsTrigger key={c.value} value={c.value}>
                  {c.label}
                  <span className="tab-count">{c.items.length}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <Select
            value={dateFilter}
            onValueChange={(v) => setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              if (v === 'all') next.delete('filter'); else next.set('filter', v);
              return next;
            })}
          >
            <SelectTrigger className="bookings-select-trigger w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent className="bookings-select-content">
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="upcoming">Upcoming</SelectItem>
              <SelectItem value="past">Past</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {categories.map((c) => (
          <TabsContent key={c.value} value={c.value}>
            <div className="bookings-content" key={`${c.value}-${dateFilter}`}>
              {c.items.length === 0 ? (
                <div className="empty-state-box">
                  <div className="empty-icon" aria-hidden>📭</div>
                  <h3>{c.label}</h3>
                  <p>{c.empty}</p>
                </div>
              ) : (
                <div className="bookings-grid stagger-reveal">
                  {c.items.map((b, i) => (
                    <div key={b.id} style={{ animationDelay: `${i * 80}ms` }}>
                      <BookingCard booking={b} onOpen={setOpenPlanId} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        ))}
      </Tabs>
      <PlanDetailDrawer planId={openPlanId} onClose={() => setOpenPlanId(null)} />
    </div>
  );
}
