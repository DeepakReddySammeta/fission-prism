import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { A2uiClientAction } from '@a2ui/web_core/v0_9';
import { Surface } from './a2ui/Surface';
import { surfaceData, hasComponent, componentCount } from './a2ui/runtime';
import { downloadTripPdf } from './pdf';
import { useAuth } from './auth/AuthContext';
import { AuthDialog } from './auth/AuthDialog';
import { usePlanner, type Turn } from './planner/PlannerContext';
import { TripBuilderCard } from './components/TripBuilderCard';
import { WeatherCard } from './components/WeatherCard';
import { Stepper } from './components/Stepper';
import { NEW_CHAT_EVENT } from './shell/plannerBus';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fmtDuration, addDays, formatAppointmentDate, CABIN_CLASSES, cabinMultiplier, cabinBaggageKg } from '@/lib/utils';
import { useVoiceSearch } from '@/lib/useVoiceSearch';
import {
  Plane, Hotel, Stethoscope, HeartPulse,
  Wallet, TrendingUp, MapPin, Mic,
  CloudSun,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8787';

interface QuickAction {
  icon: React.ReactNode;
  label: string;
  description?: string;
  query: string;
}

const FEATURED_ACTIONS: QuickAction[] = [
  { icon: <TrendingUp size={18} />, label: 'Give me my portfolio', description: 'Portfolio overview & tips', query: 'Give me my portfolio' },
  { icon: <CloudSun size={18} />, label: "Show me weather in Hyderabad", description: 'Current weather & forecast', query: "Show me weather in Hyderabad" },
  { icon: <HeartPulse size={18} />, label: 'My appointments', description: 'Upcoming & past visits', query: 'My upcoming appointments' },
];

const EXAMPLES = [
  { icon: '+', text: 'Find a dentist near me' },
  { icon: '+', text: 'Show my bookings' },
];


/** Loading placeholders that mirror the real flight/hotel card anatomy —
 * same panel shape, thumbnail, and content rows the live result will fill
 * in — so the swap to real data is a fade, not a layout jump. */
function FlightSkeleton() {
  return (
    <div className="section-card skel-block" aria-hidden>
      <div className="sk skel-heading" />
      <div className="skel-stack">
        {[0, 1, 2].map((i) => (
          <div className="skel-item" key={i} style={{ animationDelay: `${i * 90}ms` }}>
            <div className="sk skel-mono" />
            <div className="skel-body">
              <div className="skel-line-row">
                <span className="sk" style={{ width: '38%', height: 13 }} />
                <span className="sk" style={{ width: 56, height: 13 }} />
              </div>
              <div className="skel-line-row">
                <span className="sk" style={{ width: '52%', height: 11 }} />
                <span className="sk skel-pill" style={{ width: 50 }} />
              </div>
              <span className="sk" style={{ width: '30%', height: 10 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HotelSkeleton() {
  return (
    <div className="section-card skel-block" aria-hidden>
      <div className="sk skel-heading" />
      <div className="skel-grid">
        {[0, 1, 2, 3].map((i) => (
          <div className="skel-vcard" key={i} style={{ animationDelay: `${i * 80}ms` }}>
            <div className="sk skel-vphoto" />
            <div className="skel-vbody">
              <div className="skel-line-row">
                <span className="sk" style={{ width: '55%', height: 14 }} />
                <span className="sk" style={{ width: 48, height: 13 }} />
              </div>
              <span className="sk" style={{ width: '34%', height: 11 }} />
              <div className="skel-chips">
                <span className="sk skel-pill" style={{ width: 46 }} />
                <span className="sk skel-pill" style={{ width: 88 }} />
              </div>
              <div className="skel-line-row skel-foot">
                <span className="sk" style={{ width: 68, height: 14 }} />
                <span className="sk skel-btn" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Renders one turn's user message, AI summary, and results (flights/hotels/
 * trip rail). All the interactive selection state (which flight is expanded,
 * dismissed cross-sell prompts, save/PDF button state) lives locally here,
 * scoped to this turn — it never leaks into other turns or the parent. */
function ChatTurn({ turn, requestAuth }: { turn: Turn; requestAuth: (onAuthed: (token: string) => void) => void }) {
  const storeVersion = useSyncExternalStore(turn.runtime.subscribe, turn.runtime.getSnapshot);
  const { token } = useAuth();
  const { plan } = usePlanner();
  const { runtime, sessionId, intent, loading } = turn;

  const [selectedFlightId, setSelectedFlightId] = useState<string | null>(null);
  const [crossSellDismissed, setCrossSellDismissed] = useState<Set<string>>(new Set());
  const [expandOrigin, setExpandOrigin] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [pdfBusy, setPdfBusy] = useState(false);

  // Scroll the chat to the latest content whenever this turn's store updates
  // (SSE streaming, action confirmations, etc.) — App-level turns.length only
  // catches newly added turns, not content arriving within an existing one.
  useLayoutEffect(() => {
    const scrollEl = document.querySelector('.chat-scroll') as HTMLElement | null;
    if (scrollEl) {
      scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'smooth' });
    }
  }, [storeVersion]);

  // A flight can't be booked from a single click the way a room can — real
  // fares need traveler details, and a round trip needs a return date — so
  // selecting a flight only opens this local form; nothing hits the server
  // until the traveler confirms it.
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [cabinClass, setCabinClass] = useState<string>('Economy');
  const [passengerNames, setPassengerNames] = useState<string[]>(['']);
  const [passengerEmail, setPassengerEmail] = useState('');
  const [wantsReturn, setWantsReturn] = useState(false);
  const [returnDate, setReturnDate] = useState('');
  const [flightConfirmed, setFlightConfirmed] = useState(false);
  const [confirmError, setConfirmError] = useState('');

  // One name field per adult traveler — padded/trimmed as the stepper
  // changes rather than reset, so names already typed aren't lost.
  useEffect(() => {
    setPassengerNames((prev) => {
      const next = [...prev];
      while (next.length < adults) next.push('');
      return next.slice(0, Math.max(adults, 1));
    });
  }, [adults]);
  // Escape hatch out of the combined recommendation card below, into the
  // regular full flights/hotels lists — set once and stays set for the rest
  // of this turn, same as picking a flight never "un-picks" on its own.
  const [showFullOptions, setShowFullOptions] = useState(false);

  // Follow-up chat bubbles for whatever the traveler just did in the trip
  // rail or a confirm card — "you did X" feedback belongs in the
  // conversation, not just a silent state change in the UI off to the side.
  const [actionMessages, setActionMessages] = useState<string[]>([]);
  const pushMessage = useCallback((text: string) => {
    setActionMessages((prev) => [...prev, text]);
  }, []);

  const wantsCombo = !!intent?.wantsBooking && intent.agents.includes('flights') && intent.agents.includes('hotels');

  // Auto-open the detail card for a flight the backend picked (from a
  // date/time or a named flight in the query) — same card a manual click on
  // "Select" would open, just opened for the traveler instead of waiting for
  // the click. "Change flight" (in the card below) already gives the escape
  // hatch back to the full list, so switching away from it needs no new UI.
  // Skipped when a combined flight+room recommendation is expected (below)
  // — that card handles the flight instead, once the room side is also in.
  useEffect(() => {
    if (selectedFlightId || wantsCombo) return;
    const rows: any[] = surfaceData(runtime.getSurface('flights'), '/flights') || [];
    const recommended = rows.find((f) => f.recommended);
    if (recommended) setSelectedFlightId(String(recommended.id));
  }, [runtime, storeVersion, selectedFlightId, wantsCombo]);

  const onAction = useCallback(
    (action: A2uiClientAction) => {
      if (action.name === 'selectFlight') {
        setSelectedFlightId(String(action.context.flightId));
        setFlightConfirmed(false);
        setConfirmError('');
        return; // client-only — the trip only gains a flight on confirmFlight below
      }
      if (action.name === 'viewRecordDetail') {
        // A genuinely new chat exchange — a real user message, then a real
        // assistant response below it — not the same card silently swapping
        // its own content. Reuses the exact "show me details of my X" flow a
        // typed query already goes through (see intent.ts), so this needs no
        // action/session round trip of its own.
        const records: any[] = surfaceData(runtime.getSurface('records'), '/records') || [];
        const record = records.find((r) => String(r.id) === String(action.context.recordId));
        // The trailing "plan" is deliberate, not decorative — the backend's
        // my-records detector requires a recognized noun (plan/trip/
        // booking/...) to even recognize this as a records query at all,
        // and a free-text title like "Manali Escape" won't necessarily
        // contain one. "plan" specifically (not "trip"/"booking") also keeps
        // its search pool unfiltered by booking status, so this still finds
        // an unbooked saved plan by the same name.
        if (record) plan(`Show me details of my ${record.title} plan`);
        return;
      }
      if (action.name === 'exploreDestination') {
        // Drilling into a suggestion is just the same "where should I go"
        // question, scoped to it — a fresh chat turn, not a mutation of this
        // card, so the sub-places render exactly like the top-level list did.
        const name = String(action.context.name || '').trim();
        if (name) plan(`Best places to visit in ${name}`);
        return;
      }
      if (action.name === 'scheduleTrip') {
        // The exit from inspiration into the real booking flow — synthesizes
        // the same "plan a trip" phrasing the normal flights/hotels pipeline
        // already understands, so nothing new is needed on the backend for
        // this to pick up flights + hotels as usual.
        const region = String(action.context.region || '').trim();
        const nights = Number(action.context.durationNights) || 3;
        if (region) plan(`Plan a trip to ${region} for ${nights} nights`);
        return;
      }
      if (action.name === 'viewDoctorProfile' || action.name === 'startDoctorBooking') {
        // Same client-side-synthesis pattern as exploreDestination above —
        // a genuinely new chat turn, not this same list card silently
        // swapping to a profile card in place. The two fixed phrasings here
        // are matched exactly by detectDoctorLookup on the backend (see
        // that function's own comment) — never natural language a person
        // actually types, so there's no ambiguity to resolve.
        const name = String(action.context.name || '').trim();
        if (name) plan(action.name === 'startDoctorBooking' ? `Book an appointment with ${name}` : `View profile for ${name}`);
        return;
      }
      if (action.name === 'selectHotel') {
        // Same fresh-turn pattern as viewDoctorProfile above — a real new
        // exchange, not this grid card swapping to a rooms card in place.
        // The exact "View rooms at <name>" phrasing is matched by
        // detectHotelRoomsLookup on the backend (before the LLM, so the
        // hotel name is never read as a destination); it jumps straight to
        // that hotel's rooms with no "← Back to hotels" button, since a
        // fresh turn has no list above it to go back to.
        const hotels: any[] = surfaceData(runtime.getSurface('hotels'), '/hotels') || [];
        const hotel = hotels.find((h) => String(h.id) === String(action.context.hotelId));
        if (hotel?.name) plan(`View rooms at ${hotel.name}`);
        return;
      }
      if (!sessionId) return;
      if (action.name === 'selectRoom') {
        const rooms: any[] = surfaceData(runtime.getSurface('hotels'), '/rooms') || [];
        const room = rooms.find((r) => String(r.id) === String(action.context.roomId));
        if (room) pushMessage(`🏨 ${room.name} added to your trip — ₹${room.price}/night. Add the lead guest name in the trip card, then Confirm booking.`);
      }
      if (action.name === 'bookTrip') {
        pushMessage('🎉 Booking confirmed! Check the trip summary alongside for your reference number.');
      }
      if (action.name === 'confirmAppointment') {
        // The doctor's name/hospital aren't part of this action's own
        // context (only the id is) — read them from the surface's already-
        // resolved data model, the same way selectRoom above reads the room
        // list rather than duplicating that data into the action context.
        const doctor = surfaceData(runtime.getSurface('health'), '/doctor') as { name?: string } | undefined;
        pushMessage(
          `✅ Appointment confirmed with ${doctor?.name || 'the doctor'} on ${formatAppointmentDate(String(action.context.preferredDate || ''))} `
          + `at ${action.context.preferredTime}. The reference will show on the confirmation above.`
        );
      }
      fetch(`${API}/api/action`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ ...action, sessionId }),
      });
    },
    [sessionId, runtime, pushMessage, plan, token]
  );

  // The runtime is created in PlannerContext before this component mounts;
  // wire our action handler into it (and keep it fresh as closures change).
  useEffect(() => {
    runtime.setActionHandler(onAction);
    return () => runtime.setActionHandler(undefined);
  }, [runtime, onAction]);

  const confirmFlight = useCallback(() => {
    if (!sessionId || !selectedFlightId) return;
    const names = passengerNames.slice(0, adults);
    if (names.some((n) => !n.trim()) || !passengerEmail.trim()) {
      setConfirmError('A name for each traveler and a contact email are required.');
      return;
    }
    if (wantsReturn && !returnDate) {
      setConfirmError('Pick a return date, or turn off round trip.');
      return;
    }
    setConfirmError('');
    setFlightConfirmed(true);
    const flights: any[] = surfaceData(runtime.getSurface('flights'), '/flights') || [];
    const flight = flights.find((f) => String(f.id) === selectedFlightId);
    if (flight) {
      const total = flight.price * (adults + children) * cabinMultiplier(cabinClass);
      pushMessage(`✈️ Flight held — ${flight.airline} ${flight.flightNumber}, ${cabinClass}, ₹${total} for ${names.join(', ')}.`);
    }
    fetch(`${API}/api/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'confirmFlight',
        surfaceId: 'flights',
        sourceComponentId: 'flight_detail',
        timestamp: new Date().toISOString(),
        context: {
          flightId: selectedFlightId,
          passengerNames: names.map((n) => n.trim()),
          passengerEmail: passengerEmail.trim(),
          adults, children, cabinClass,
          returnDate: wantsReturn ? returnDate : undefined,
        },
        sessionId,
      }),
    });
  }, [sessionId, selectedFlightId, passengerNames, adults, children, cabinClass, passengerEmail, wantsReturn, returnDate, runtime, pushMessage]);


  const expand = useCallback(
    (agent: 'flights' | 'hotels', origin?: string) => {
      if (!sessionId) return;
      setCrossSellDismissed((prev) => new Set(prev).add(agent));
      fetch(`${API}/api/expand`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, agent, origin }),
      });
    },
    [sessionId]
  );

  // Accepts an optional freshly-issued token so it can be re-invoked as the
  // AuthDialog's onSuccess callback right after sign-in, before `token` from
  // useAuth() above has re-rendered into this closure.
  const saveTrip = useCallback(
    async (freshToken?: string) => {
      if (!sessionId) return;
      const authToken = freshToken || token;
      if (!authToken) { requestAuth(saveTrip); return; }
      setSaveState('saving');
      const res = await fetch(`${API}/api/plans`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ sessionId }),
      });
      setSaveState(res.ok ? 'saved' : 'idle');
      pushMessage(res.ok ? '💾 Saved to My Plans — find it anytime from the sidebar.' : "⚠️ Couldn't save this trip — please try again.");
    },
    [sessionId, token, requestAuth, pushMessage]
  );

  const downloadPdf = useCallback(async () => {
    if (!sessionId || pdfBusy) return;
    setPdfBusy(true);
    try {
      await downloadTripPdf(sessionId, API);
      pushMessage('📄 Your PDF is ready and downloading now.');
    } catch {
      // best-effort export — a failed fetch/image embed shouldn't crash the page
      pushMessage("⚠️ Couldn't generate the PDF — please try again.");
    } finally {
      setPdfBusy(false);
    }
  }, [sessionId, pdfBusy, pushMessage]);

  const flightsSurface = runtime.getSurface('flights');
  const hotelsSurface = runtime.getSurface('hotels');
  const tripSurface = runtime.getSurface('trip');
  // Plain snapshots of each surface's data model — `SurfaceModel.dataModel`
  // is a reactive store, not the raw object, so read the root through it.
  const flightsData: any = surfaceData(flightsSurface, '/') || {};
  const hotelsData: any = surfaceData(hotelsSurface, '/') || {};
  const canDownload = !!tripSurface && componentCount(tripSurface) > 0;
  // A chat-asked "my plans"/"my bookings" (records list) or "details of my
  // X trip" (recordDetail) query — rendered inline in the turn's own main
  // area, not the trip-rail sidebar (that only watches surfaceId 'trip').
  const recordsSurface = runtime.getSurface('records');
  const recordDetailSurface = runtime.getSurface('recordDetail');
  // A chat-asked "my upcoming appointments"/"past appointments" query —
  // its own surfaceId, same reasoning as recordsSurface above.
  const appointmentsSurface = runtime.getSurface('appointments');
  // The personal finance agent — a budget breakdown, a logged expense, a
  // savings goal, or a spending summary, depending on what was typed. No
  // buttons/actions of its own — purely conversation-driven.
  const financeSurface = runtime.getSurface('finance');
  // "Best places to visit in X" — inspiration, not a flights/hotels search;
  // its own surface so it renders alongside (never instead of) those.
  const destinationsSurface = runtime.getSurface('destinations');
  // "I have chest pain" / "find me a dentist" — doctor list, drill-down
  // profile, and the appointment form/confirmation all share this one
  // surfaceId, the same way hotels list vs. rooms detail do.
  const healthSurface = runtime.getSurface('health');

  const expectedAgents = intent?.agents || [];
  const flightsPending = expectedAgents.includes('flights') && !(flightsSurface && componentCount(flightsSurface) > 0);
  const hotelsPending = expectedAgents.includes('hotels') && !(hotelsSurface && componentCount(hotelsSurface) > 0);
  // When a trip expects BOTH flights and hotels, the two agents stream back
  // independently and hotels often wins the race. Rendering a full hotels
  // list above a still-loading flights skeleton strands that skeleton in the
  // middle looking blank — so hold the hotels section (skeleton and all)
  // until flights have actually rendered, keeping the order flights → hotels.
  const bothExpected = expectedAgents.includes('flights') && expectedAgents.includes('hotels');
  const flightsRendered = !!flightsSurface && componentCount(flightsSurface) > 0;
  const holdHotelsForFlights = bothExpected && !flightsRendered;
  // Weather is a live, real-world reading tied to an actual trip — it should
  // never appear for a bare inspiration query ("best places to visit...")
  // or any other non-booking intent, only once flights/hotels are genuinely
  // being searched for a real destination.
  const wantsBookingWeather = expectedAgents.includes('flights') || expectedAgents.includes('hotels');
  // A standalone "what's the weather in X" query (see detectWeatherIntent on
  // the backend) — the same card, just on its own rather than as a side dish
  // to a flights/hotels search, and with its own heading/empty state.
  const isWeatherLookup = intent?.intent === 'check_weather';

  const selectedFlight = useMemo(() => {
    if (!selectedFlightId || !flightsSurface) return null;
    const rows: any[] = flightsData.flights || [];
    return rows.find((f) => f.id === selectedFlightId) || null;
  }, [selectedFlightId, flightsSurface, flightsData]);

  const showFlightsFullList = flightsSurface && componentCount(flightsSurface) > 0 && !selectedFlight;
  const showAddHotels = !loading && expectedAgents.length === 1 && expectedAgents[0] === 'flights'
    && !hotelsSurface && !crossSellDismissed.has('hotels');
  const showAddFlights = !loading && expectedAgents.length === 1 && expectedAgents[0] === 'hotels'
    && !flightsSurface && !crossSellDismissed.has('flights');

  // The combined recommendation card: one flight + one room together instead
  // of a full flights list and a full hotels list — only for a query that
  // used booking language and expects both. `roomsData` only has this shape
  // (hotel/rooms/booking) once the backend's auto-jump has already replaced
  // the hotel list with one hotel's rooms (see runAgents/confirmFlight in
  // server.ts); `recommendedRoomRow` stays null until that's happened.
  const recommendedFlightRow = wantsCombo
    ? ((flightsData.flights || []) as any[]).find((f: any) => f.recommended) || null
    : null;
  const roomsData = wantsCombo ? hotelsData : null;
  const recommendedRoomRow = wantsCombo
    ? (roomsData?.rooms || []).find((r: any) => r.recommended) || null
    : null;
  // Stays visible after confirming too (canDownload no longer hides it) —
  // the traveler asked to book something specific and should keep seeing
  // exactly what that was, right alongside the trip summary rail, not have
  // it vanish once confirmed.
  const comboVisible = wantsCombo && !showFullOptions;
  const comboReady = comboVisible && recommendedFlightRow && recommendedRoomRow;
  const comboWaiting = comboVisible && !comboReady;

  return (
    <>
      <div className="chat-msg-user reveal">{turn.query}</div>

      {intent?.summary ? (
        <div className="chat-msg-ai reveal">
          <span className="chat-ai-avatar" aria-hidden>F</span>
          <p>{intent.summary}</p>
        </div>
      ) : loading ? (
        <div className="chat-msg-ai reveal">
          <span className="chat-ai-avatar" aria-hidden>F</span>
          <p className="chat-thinking">Thinking…</p>
        </div>
      ) : null}

      <main className={`results${canDownload && !wantsCombo ? ' has-rail' : ''}`}>
        <div className="results-main">
          {intent?.destination && (wantsBookingWeather || isWeatherLookup) && (
            <WeatherCard destination={intent.destination} standalone={isWeatherLookup} />
          )}

          {componentCount(destinationsSurface) > 0 && (
            <div className="reveal">
              <Surface surface={destinationsSurface} className="surface-destinations" />
            </div>
          )}

          {componentCount(healthSurface) > 0 && (
            // Keyed the same way the hotels list/room-detail swap is —
            // doctor list, one doctor's profile+booking form, and the
            // booking confirmation all share this surfaceId, and without a
            // key change React would patch the DOM in place instead of
            // replaying the fade-in across what's really three different
            // screens.
            <div
              className="reveal"
              key={hasComponent(healthSurface, 'panel_book') ? 'profile' : hasComponent(healthSurface, 'ref_badge') ? 'confirmed' : 'list'}
            >
              <Surface surface={healthSurface} className="surface-health" />
            </div>
          )}

          {componentCount(recordsSurface) > 0 && !(componentCount(recordDetailSurface) > 0) && (
            <div className="reveal">
              <Surface surface={recordsSurface} className="surface-records" />
            </div>
          )}

          {componentCount(appointmentsSurface) > 0 && (
            <div className="reveal">
              <Surface surface={appointmentsSurface} className="surface-appointments" />
            </div>
          )}

          {componentCount(financeSurface) > 0 && (
            <div className="reveal">
              <Surface surface={financeSurface} className="surface-finance" />
            </div>
          )}

          {componentCount(recordDetailSurface) > 0 && (
            <div className="flight-detail-card reveal">
              <Surface surface={recordDetailSurface} className="surface-record-detail" />
            </div>
          )}

          {comboWaiting && (
            <div className="reveal">
              {!recommendedFlightRow ? <FlightSkeleton /> : <HotelSkeleton />}
            </div>
          )}

          {comboReady && (
            <TripBuilderCard
              sessionId={sessionId!}
              pushMessage={pushMessage}
              onBrowseAll={() => setShowFullOptions(true)}
              flightRow={recommendedFlightRow}
              roomsData={roomsData}
              roomRow={recommendedRoomRow}
              intentAdults={intent?.adults}
              intentChildren={intent?.children}
              tripSurface={tripSurface}
              canDownload={canDownload}
              saveTrip={() => saveTrip()}
              downloadPdf={downloadPdf}
              saveState={saveState}
              pdfBusy={pdfBusy}
            />
          )}

          {(!wantsCombo || showFullOptions) && (<>
          {(flightsPending || showFlightsFullList) && (
            <div className="reveal">
              {flightsPending ? <FlightSkeleton /> : (
                <Surface surface={flightsSurface!} className="surface-flights" />
              )}
            </div>
          )}

          {selectedFlight && (
            <div className="flight-detail-card reveal">
              <div className="flight-detail-head">
                <span className="a2-monogram" style={{ background: 'var(--paper-dim)', color: 'var(--navy)' }} aria-hidden>
                  {String(selectedFlight.code || selectedFlight.airline?.slice(0, 2) || '').toUpperCase()}
                </span>
                <div className="flight-detail-title">
                  <strong>{selectedFlight.airline}</strong>
                  <span className="muted"> {selectedFlight.flightNumber}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedFlightId(null);
                    setFlightConfirmed(false);
                    setConfirmError('');
                  }}
                >
                  Change flight
                </Button>
              </div>

              {selectedFlight.tag === 'Recommended' && (
                <p className="a2-caption">
                  Matches what you asked for — pick "Change flight" above to see other options.
                </p>
              )}

              <div className="flight-detail-route">
                <div className="flight-detail-point">
                  <span className="flight-detail-time">{selectedFlight.departTime}</span>
                  <span className="muted">{selectedFlight.from}</span>
                </div>
                <div className="flight-detail-path">
                  <span className="muted">
                    {selectedFlight.stopsLabel}{selectedFlight.layoverCity ? ` · via ${selectedFlight.layoverCity}` : ''}
                  </span>
                  <div className="flight-detail-line" />
                  <span className="muted">{fmtDuration(selectedFlight.durationMins)}</span>
                </div>
                <div className="flight-detail-point">
                  <span className="flight-detail-time">{selectedFlight.arriveTime}</span>
                  <span className="muted">{selectedFlight.to}</span>
                </div>
              </div>

              <div className="flight-detail-facts">
                <div><span className="muted">Cabin</span><strong>{cabinClass}</strong></div>
                <div><span className="muted">Baggage</span><strong>{cabinBaggageKg(cabinClass)} kg</strong></div>
                <div><span className="muted">Aircraft</span><strong>{selectedFlight.aircraft}</strong></div>
                <div>
                  <span className="muted">Fare</span>
                  <strong>
                    ₹{selectedFlight.price * (adults + children) * cabinMultiplier(cabinClass)}
                    {(adults + children) > 1 ? <span className="muted"> ({adults + children}×)</span> : null}
                  </strong>
                </div>
              </div>

              {flightConfirmed ? (
                <div className="flight-confirmed-banner">
                  <span>✅ Flight held for {passengerNames.slice(0, adults).filter(Boolean).join(', ')}{wantsReturn ? ' · round trip' : ''}</span>
                </div>
              ) : (
                <div className="flight-booking-form">
                  <p className="a2-field-label">A real fare needs a few details before it can be booked</p>

                  <div className="a2-row" style={{ gap: 12 }}>
                    <Stepper label="Adults" value={adults} onChange={setAdults} min={1} />
                    <Stepper label="Children" value={children} onChange={setChildren} min={0} />
                  </div>

                  <div className="a2-field">
                    <span className="a2-field-label">Cabin class</span>
                    <div className="a2-choicepicker">
                      {CABIN_CLASSES.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={`a2-choice${cabinClass === c ? ' a2-choice-active' : ''}`}
                          onClick={() => setCabinClass(c)}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="a2-row" style={{ gap: 12, flexWrap: 'wrap' }}>
                    {passengerNames.slice(0, adults).map((n, i) => (
                      <label className="a2-field" style={{ flex: 1, minWidth: 160 }} key={i}>
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
                    <label className="a2-field" style={{ flex: 1, minWidth: 160 }}>
                      <span className="a2-field-label">Email</span>
                      <input
                        className="a2-field-input"
                        type="email"
                        value={passengerEmail}
                        onChange={(e) => setPassengerEmail(e.target.value)}
                        placeholder="you@example.com"
                      />
                    </label>
                  </div>
                  <label className="flight-return-toggle">
                    <input
                      type="checkbox"
                      checked={wantsReturn}
                      onChange={(e) => setWantsReturn(e.target.checked)}
                    />
                    <span>Book a return flight too</span>
                  </label>
                  {wantsReturn && (
                    <label className="a2-field">
                      <span className="a2-field-label">Return date</span>
                      <input
                        className="a2-field-input"
                        type="date"
                        // A return before the outbound flight even leaves
                        // makes no sense — restrict to the day after
                        // whatever date the traveler actually booked, not
                        // just "today" (which let a return date land before
                        // a future-dated outbound flight).
                        min={selectedFlight.date ? addDays(selectedFlight.date, 1) : new Date().toISOString().slice(0, 10)}
                        value={returnDate}
                        onChange={(e) => setReturnDate(e.target.value)}
                      />
                    </label>
                  )}
                  {confirmError && <p className="flight-form-error">{confirmError}</p>}
                  <Button size="sm" onClick={confirmFlight}>Confirm flight</Button>
                </div>
              )}
            </div>
          )}

          {showAddHotels && (
            <div className="cross-sell reveal">
              <span>Add a stay in {intent?.destination}?</span>
              <Button size="sm" onClick={() => expand('hotels')}>Add hotels</Button>
              <button className="link-btn" onClick={() => setCrossSellDismissed((p) => new Set(p).add('hotels'))}>Not now</button>
            </div>
          )}

          {showAddFlights && (
            <div className="cross-sell reveal">
              <span>Flying in? Add flights to {intent?.destination}.</span>
              <Input
                className="cross-sell-input h-auto"
                placeholder="From city"
                value={expandOrigin}
                onChange={(e) => setExpandOrigin(e.target.value)}
              />
              <Button
                size="sm"
                disabled={!expandOrigin.trim()}
                onClick={() => expand('flights', expandOrigin.trim())}
              >
                Add flights
              </Button>
              <button className="link-btn" onClick={() => setCrossSellDismissed((p) => new Set(p).add('flights'))}>Not now</button>
            </div>
          )}

          {(hotelsPending || holdHotelsForFlights || componentCount(hotelsSurface) > 0) && (
            // Keyed by which "shape" of the hotels surface this is — the
            // hotel list and a single hotel's room view share the same
            // surfaceId, so without a key change here React would just patch
            // the existing DOM in place and the whole list-to-detail swap
            // would happen with no transition at all.
            <div className="reveal" key={(hotelsPending || holdHotelsForFlights) ? 'pending' : hasComponent(hotelsSurface, 'room_list') ? 'rooms' : 'list'}>
              {(hotelsPending || holdHotelsForFlights) ? <HotelSkeleton /> : (
                <Surface surface={hotelsSurface!} className="surface-hotels" />
              )}
            </div>
          )}
          </>)}
        </div>

        {canDownload && !wantsCombo && (
          <aside className="trip-rail reveal">
            <Surface surface={tripSurface!} className="surface-trip" />
            <Button variant="default" className="w-[calc(100%-32px)] mx-4 mb-2" onClick={() => saveTrip()} disabled={saveState === 'saving'}>
              {saveState === 'saved' ? 'Saved ✓' : saveState === 'saving' ? 'Saving…' : 'Save to My Plans'}
            </Button>
            <Button variant="outline" className="w-[calc(100%-32px)] mx-4 mb-4" onClick={downloadPdf} disabled={pdfBusy}>
              {pdfBusy ? 'Preparing PDF…' : 'Download trip as PDF'}
            </Button>
          </aside>
        )}
      </main>

      {actionMessages.map((msg, i) => (
        <div className="chat-msg-ai reveal" key={i}>
          <span className="chat-ai-avatar" aria-hidden>F</span>
          <p>{msg}</p>
        </div>
      ))}
    </>
  );
}

function QuickActionsGrid({ onQuery }: { onQuery: (q: string) => void }) {
  return (
    <div className="quick-actions-grid reveal">
      {FEATURED_ACTIONS.map((item, idx) => (
        <button
          key={item.label}
          className="quick-action-card"
          style={{ animationDelay: `${idx * 60}ms` }}
          onClick={() => onQuery(item.query)}
          title={item.query}
        >
          <span className="quick-action-icon" aria-hidden>{item.icon}</span>
          <span className="quick-action-body">
            <span className="quick-action-label">{item.label}</span>
            {item.description && (
              <span className="quick-action-desc">{item.description}</span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const { turns, plan } = usePlanner();
  const [inputValue, setInputValue] = useState('');
  const [authOpen, setAuthOpen] = useState(false);
  const authResolveRef = useRef<((token: string) => void) | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Voice search is nothing more than "speech, converted to the same text a
  // typed query would be" — it fills the composer live while listening, then
  // submits exactly like hitting Enter once the browser detects silence.
  const voice = useVoiceSearch(setInputValue, (text) => { setInputValue(''); plan(text); });

  const requestAuth = useCallback((onAuthed: (token: string) => void) => {
    authResolveRef.current = onAuthed;
    setAuthOpen(true);
  }, []);

  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns.length]);

  // The composer's own text is page-local state (unlike the conversation
  // itself, it doesn't need to survive navigating away), but "New chat"
  // should still clear it when clicked while already on this page.
  useEffect(() => {
    const onNewChat = () => setInputValue('');
    window.addEventListener(NEW_CHAT_EVENT, onNewChat);
    return () => window.removeEventListener(NEW_CHAT_EVENT, onNewChat);
  }, []);

  const showConversation = turns.length > 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = inputValue;
    setInputValue('');
    plan(q);
  };

  return (
    <div className={`chat-page${showConversation ? '' : ' chat-page-empty'}`}>
      {showConversation && (
        <div className="chat-scroll" ref={chatScrollRef}>
          <div className="chat-stream">
            {turns.map((turn) => <ChatTurn key={turn.id} turn={turn} requestAuth={requestAuth} />)}
          </div>
        </div>
      )}

      <div className="chat-composer">
        <div className={`chat-composer-inner${showConversation ? '' : ' chat-composer-inner-centered'}`}>
          {!showConversation && (
            <div className="chat-brand-hero">
              <div className="brand">
                <span className="brand-mark">F</span>
                <div>
                  <h1>Fission Prism</h1>
                  <p className="brand-tagline">Travel, health & finance — all in one place</p>
                </div>
              </div>
            </div>
          )}

          {!showConversation && <QuickActionsGrid onQuery={plan} />}

          <form className="query-form" onSubmit={submit}>
            <div className="query-input-wrap">
              <Input
                className="query-input"
                placeholder={voice.listening ? 'Listening…' : 'Ask about travel, health, or finance…'}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
              />
            </div>
            {voice.supported && (
              <button
                type="button"
                className={`mic-btn${voice.listening ? ' mic-btn-active' : ''}`}
                onClick={() => (voice.listening ? voice.stop() : voice.start())}
                aria-label={voice.listening ? 'Stop voice search' : 'Search by voice'}
                title={voice.listening ? 'Stop voice search' : 'Search by voice'}
              >
                <Mic size={20} />
              </button>
            )}
            <Button size="lg" className="h-12" type="submit">
              Plan
            </Button>
          </form>

          <div className="examples">
            {EXAMPLES.map((ex, i) => (
              <button
                key={ex.text}
                className="example-chip"
                style={{ animationDelay: `${i * 60}ms` }}
                onClick={() => plan(ex.text)}
              >
                <span className="example-icon" aria-hidden>{ex.icon}</span>
                <span>{ex.text}</span>
              </button>
            ))}
          </div>

        </div>
      </div>

      <AuthDialog
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSuccess={(token) => { const cb = authResolveRef.current; authResolveRef.current = null; cb?.(token); }}
        reason="Sign in to save this trip to My Plans."
      />
    </div>
  );
}
