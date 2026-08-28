import React, { useEffect, useState } from 'react';
import type { SurfaceModel } from '@a2ui/web_core/v0_9';
import { Surface } from '../a2ui/Surface';
import { Button } from '@/components/ui/button';
import { fmtDuration } from '@/lib/utils';
import { Stepper } from './Stepper';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8787';

/** Saving is just "remember this destination/selection for later" — it
 * doesn't require finishing a booking first (the backend only ever required
 * a destination, never a bookingRef; this was previously hidden behind the
 * "booked" phase for no real reason). */
function SaveForLaterLink({ saveTrip, saveState }: { saveTrip: () => void; saveState: 'idle' | 'saving' | 'saved' }) {
  return (
    <button type="button" className="link-btn trip-builder-save-link" onClick={saveTrip} disabled={saveState === 'saving'}>
      {saveState === 'saved' ? 'Saved to My Plans ✓' : saveState === 'saving' ? 'Saving…' : 'Save this plan for later'}
    </button>
  );
}

interface Props {
  sessionId: string;
  pushMessage: (text: string) => void;
  onBrowseAll: () => void;
  flightRow: any;
  roomsData: any;
  roomRow: any;
  intentAdults?: number;
  intentChildren?: number;
  tripSurface: SurfaceModel<any> | undefined;
  canDownload: boolean;
  saveTrip: () => void;
  downloadPdf: () => void;
  saveState: 'idle' | 'saving' | 'saved';
  pdfBusy: boolean;
}

/** One card, three phases, covering the whole "book something specific" flow
 * end to end: review the auto-picked flight+room and adjust travelers/dates
 * (prefilled from the query) → fill in the mandatory names → one real
 * confirm that books both legs and shows the final summary right here, with
 * Save/Download alongside it. Replaces the old split between a "confirmed"
 * card and a separate sidebar that then asked to confirm again. */
export function TripBuilderCard({
  sessionId, pushMessage, onBrowseAll,
  flightRow, roomsData, roomRow, intentAdults, intentChildren,
  tripSurface, canDownload, saveTrip, downloadPdf, saveState, pdfBusy,
}: Props) {
  const [phase, setPhase] = useState<'review' | 'details'>('review');
  const [adults, setAdults] = useState(intentAdults || 2);
  const [children, setChildren] = useState(intentChildren || 0);
  const [checkIn, setCheckIn] = useState(roomsData?.booking?.checkIn || '');
  const [checkOut, setCheckOut] = useState(roomsData?.booking?.checkOut || '');
  const [guestName, setGuestName] = useState('');
  const [passengerNames, setPassengerNames] = useState<string[]>(['']);
  const [error, setError] = useState('');

  // The passenger-name list tracks the adults stepper — one name per adult
  // traveler, trimmed/padded as it changes rather than reset each time.
  useEffect(() => {
    setPassengerNames((prev) => {
      const next = [...prev];
      while (next.length < adults) next.push('');
      return next.slice(0, Math.max(adults, 1));
    });
  }, [adults]);

  if (canDownload && tripSurface) {
    return (
      <div className="flight-detail-card trip-reco-card reveal">
        <Surface surface={tripSurface} className="surface-trip" />
        <div className="trip-builder-actions">
          <Button onClick={saveTrip} disabled={saveState === 'saving'}>
            {saveState === 'saved' ? 'Saved ✓' : saveState === 'saving' ? 'Saving…' : 'Save to My Plans'}
          </Button>
          <Button variant="outline" onClick={downloadPdf} disabled={pdfBusy}>
            {pdfBusy ? 'Preparing PDF…' : 'Download trip as PDF'}
          </Button>
        </div>
      </div>
    );
  }

  const travelers = adults + children;
  const flightTotal = flightRow ? flightRow.price * travelers : 0;

  const confirmBooking = () => {
    if (roomRow && !guestName.trim()) { setError('Enter the lead guest name to confirm.'); return; }
    if (flightRow && passengerNames.slice(0, adults).some((n) => !n.trim())) {
      setError('Enter a name for each traveler.');
      return;
    }
    setError('');
    pushMessage(
      `✅ Trip confirmed — ${flightRow?.airline ?? 'your flight'} + ${roomsData?.hotel?.name ?? 'your stay'} (${roomRow?.name ?? 'room'}). Save it or download the PDF whenever you like.`
    );
    fetch(`${API}/api/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'confirmTrip',
        surfaceId: 'trip',
        sourceComponentId: 'trip_builder',
        timestamp: new Date().toISOString(),
        context: {
          flightId: flightRow?.id,
          roomId: roomRow?.id,
          adults, children, checkIn, checkOut,
          guestName: guestName.trim(),
          passengerNames: passengerNames.slice(0, adults),
        },
        sessionId,
      }),
    });
  };

  return (
    <div className="flight-detail-card trip-reco-card reveal">
      <div className="a2-h2">Your recommended trip</div>
      <p className="a2-caption">
        {phase === 'review'
          ? 'Matches what you asked for — adjust anything below, then continue.'
          : 'Just need a few details to finish booking.'}
      </p>
      <p className="a2-caption trip-reco-route">
        {flightRow.from} → {flightRow.to}{checkIn && checkOut ? ` · ${checkIn} → ${checkOut}` : ''}
      </p>

      <div className="trip-reco-leg">
        <span className="a2-monogram" style={{ background: 'var(--paper-dim)', color: 'var(--navy)' }} aria-hidden>
          {String(flightRow.code || flightRow.airline?.slice(0, 2) || '').toUpperCase()}
        </span>
        <div className="trip-reco-leg-info">
          <div><strong>{flightRow.airline}</strong> <span className="muted">{flightRow.flightNumber}</span></div>
          <div className="muted">{flightRow.from} → {flightRow.to} · {flightRow.departTime} → {flightRow.arriveTime}</div>
          <div className="muted">{fmtDuration(flightRow.durationMins)} · {flightRow.stopsLabel}</div>
        </div>
        <div className="trip-reco-leg-price">
          ₹{flightTotal}{travelers > 1 ? <span className="muted"> ({travelers}×)</span> : null}
        </div>
      </div>

      {roomRow && (
        <div className="trip-reco-leg">
          <span className="a2-monogram" style={{ background: 'var(--paper-dim)', color: 'var(--navy)' }} aria-hidden>🏨</span>
          <div className="trip-reco-leg-info">
            <div><strong>{roomsData?.hotel?.name}</strong> <span className="muted">· {roomsData?.hotel?.area}</span></div>
            <div className="muted">{roomRow.name} · {checkIn} → {checkOut}</div>
          </div>
          <div className="trip-reco-leg-price">₹{roomRow.price}<span className="muted"> /night</span></div>
        </div>
      )}

      {phase === 'review' ? (
        // Keyed so switching phases remounts this block (and replays the
        // fade-in) instead of React just patching new fields into the same
        // persistent node — a phase change is a big enough content swap that
        // it should never look like a sudden, un-transitioned jump.
        <div className="reveal" key="review">
          <div className="trip-builder-fields">
            <Stepper label="Adults" value={adults} onChange={setAdults} min={1} />
            <Stepper label="Children" value={children} onChange={setChildren} min={0} />
            {roomRow && (
              <>
                <label className="a2-field">
                  <span className="a2-field-label">Check-in</span>
                  <input type="date" className="a2-field-input" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
                </label>
                <label className="a2-field">
                  <span className="a2-field-label">Check-out</span>
                  <input type="date" className="a2-field-input" min={checkIn} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
                </label>
              </>
            )}
          </div>
          <div className="trip-builder-actions">
            <Button onClick={() => setPhase('details')}>Continue</Button>
            <Button variant="outline" onClick={onBrowseAll}>Browse all options</Button>
          </div>
          <SaveForLaterLink saveTrip={saveTrip} saveState={saveState} />
        </div>
      ) : (
        <div className="reveal" key="details">
          <div className="flight-booking-form">
            {passengerNames.slice(0, adults).map((n, i) => (
              <label className="a2-field" key={i}>
                <span className="a2-field-label">Traveler {i + 1} name</span>
                <input
                  className="a2-field-input"
                  value={n}
                  onChange={(e) => setPassengerNames((prev) => {
                    const next = [...prev];
                    next[i] = e.target.value;
                    return next;
                  })}
                  placeholder="Full name"
                />
              </label>
            ))}
            {roomRow && (
              <label className="a2-field">
                <span className="a2-field-label">Lead guest name (for the room)</span>
                <input className="a2-field-input" value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Full name" />
              </label>
            )}
            {error && <p className="flight-form-error">{error}</p>}
          </div>
          <div className="trip-builder-actions">
            <Button onClick={confirmBooking}>Confirm booking</Button>
            <Button variant="outline" onClick={() => setPhase('review')}>Back</Button>
          </div>
          <SaveForLaterLink saveTrip={saveTrip} saveState={saveState} />
        </div>
      )}
    </div>
  );
}
