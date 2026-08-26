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
    <div className="section-card plan-detail-card reveal">
      {booking.imageUrl && <div className="plan-detail-img" style={{ backgroundImage: `url(${booking.imageUrl})` }} />}
      <div className="a2-row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 className="a2-h2">{booking.title}</h2>
        <button className="link-btn" onClick={() => onOpen(booking.id)}>View full plan →</button>
      </div>
      <p className="a2-caption">Booked {new Date(booking.createdAt).toLocaleDateString()}</p>

      {(trip.flight || trip.hotel) && (
        <p className="a2-body booking-summary-line">
          {trip.flight && <span>✈ {trip.flight.airline}</span>}
          {trip.hotel && <span>🏨 {trip.hotel.name}</span>}
        </p>
      )}
      {dateRange && <p className="a2-caption">{dateRange}</p>}

      <div className="a2-row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
        {trip.totalPrice ? <p className="a2-h3" style={{ margin: 0 }}>₹{trip.totalPrice}</p> : <span />}
        {trip.bookingRef && <Badge variant="success">Booked</Badge>}
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
      <div className="plans-page">
        <h1 className="a2-h1">My Bookings</h1>
        <div className="empty-state">
          <p>Sign in to see your confirmed bookings.</p>
          <Button onClick={() => setAuthOpen(true)}>Sign in</Button>
        </div>
        <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />
      </div>
    );
  }

  if (bookings === null) {
    return (
      <div className="plans-page">
        <h1 className="a2-h1">My Bookings</h1>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (bookings.length === 0) {
    return (
      <div className="plans-page">
        <h1 className="a2-h1">My Bookings</h1>
        <div className="empty-state">
          <p>No confirmed bookings yet — confirm a flight or a room, then save the trip to see it here.</p>
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
    <div className="plans-page">
      <h1 className="a2-h1">My Bookings</h1>
      <Tabs defaultValue="trips">
        <div className="bookings-toolbar">
          <TabsList>
            {categories.map((c) => (
              <TabsTrigger key={c.value} value={c.value}>{c.label} ({c.items.length})</TabsTrigger>
            ))}
          </TabsList>
          <Select
            value={dateFilter}
            onValueChange={(v) => setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              if (v === 'all') next.delete('filter'); else next.set('filter', v);
              return next;
            })}
          >
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="upcoming">Upcoming</SelectItem>
              <SelectItem value="past">Past</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {categories.map((c) => (
          <TabsContent key={c.value} value={c.value}>
            {c.items.length === 0 ? (
              <p className="muted">{c.empty}</p>
            ) : (
              <div className="bookings-grid">
                {c.items.map((b) => <BookingCard key={b.id} booking={b} onOpen={setOpenPlanId} />)}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
      <PlanDetailDrawer planId={openPlanId} onClose={() => setOpenPlanId(null)} />
    </div>
  );
}
