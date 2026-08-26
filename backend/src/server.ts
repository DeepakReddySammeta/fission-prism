// Must be the first import: it populates process.env from backend/.env
// before ./config (and anything ./config re-exports) reads process.env.
import 'dotenv/config';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { OAuth2Client } from 'google-auth-library';
import type { ActionPayload, FlightOption, HotelOption, ParsedIntent, RoomOption, TripSummary } from './types';
import { PORT, LLM_ENABLED, GOOGLE_CLIENT_ID } from './config';
import { parseIntent, detectMyRecordsIntent, detectExplorationIntent, type MyRecordsIntent } from './agents/intent';
import { getFlightOptions } from './agents/flights';
import { getHotelOptions } from './agents/hotels';
import { getDestinationSuggestions } from './agents/destinations';
import { pickRecommendedFlight, pickRecommendedHotel, pickRecommendedRoom } from './agents/recommend';
import { createSession, getSession, subscribe, unsubscribe, emit, emitAll, type PendingMyRecords, type PlanRecordSummary } from './orchestrator/sessions';
import { indexHotels, findHotelByName } from './orchestrator/hotelIndex';
import { flightsSurface, hotelsSurface, roomsSurface, tripSummarySurface, myRecordsSurface, recordDetailSurface, destinationsSurface, hotelImage, roomImage, destinationImage, flightImage, flightDetails, hotelDetails, cabinPriceMultiplier } from './orchestrator/envelopes';
import { db, type UserRow, type PlanRow } from './db';
import { newId, hashPassword, verifyPassword, signToken, toAuthUser, requireAuth, optionalAuth, type AuthUser } from './auth/auth';
import { loadWeather } from './weather/weather';

const app = Fastify({ logger: false });

app.register(cors, { origin: true });

app.get('/api/health', async () => ({ ok: true, llm: LLM_ENABLED ? 'groq' : 'mock' }));

/** Live third-party lookup, not a governed record — see weather/weather.ts.
 * Kept as its own plain GET (no session, no SSE) since it's a side dish to
 * whatever trip is being planned, not part of the flights/hotels pipeline. */
app.get<{ Querystring: { place?: string } }>('/api/weather', async (req, reply) => {
  const place = (req.query.place || '').trim();
  if (!place) return reply.code(400).send({ error: 'place is required' });
  try {
    const reading = await loadWeather(place);
    if (!reading) return reply.code(404).send({ error: 'place not found' });
    return reading;
  } catch {
    return reply.code(502).send({ error: 'weather provider unavailable' });
  }
});

/** Step 1: parse intent, create a session, store what needs generating.
 *  Generation itself only starts once the client subscribes to /api/events
 *  (see below) so we never race an agent finishing before anyone's listening. */
app.post<{ Body: { query: string } }>('/api/plan', { preHandler: optionalAuth }, async (req, reply) => {
  const { query } = req.body;
  if (!query?.trim()) return reply.code(400).send({ error: 'query is required' });

  // "My plans" / "my upcoming bookings" / "details of my kerala trip" —
  // answered right here in the chat (a records list, or one specific plan's
  // full summary) instead of navigating to /plans or /bookings. No LLM call
  // either way — this is a fast, deterministic classifier (see intent.ts).
  const myRecords = detectMyRecordsIntent(query);
  if (myRecords) return handleMyRecordsQuery(myRecords, req.user);

  // "Best places to visit in X" / "where should I go" — inspiration, not a
  // flights/hotels search. Checked before parseIntent for the same reason
  // detectMyRecordsIntent is: a different kind of request, and a fast
  // deterministic check here avoids the main prompt ever having to parse
  // "India in monsoon" as if it were a literal destination string.
  const exploration = detectExplorationIntent(query);
  if (exploration) {
    const session = createSession();
    session.pendingExploration = exploration;
    session.trip.destination = exploration.region;
    const seasonPhrase = exploration.season ? ` for ${exploration.season.toLowerCase()}` : '';
    return {
      sessionId: session.id,
      intent: {
        intent: 'explore_destinations', destination: exploration.region, agents: [],
        summary: `Here are some great places to consider in ${exploration.region}${seasonPhrase} — explore one further, or schedule a trip whenever you're ready.`,
      },
    };
  }

  let intent = await parseIntent(query);
  const session = createSession();

  // No destination was named, but the message looked like it might be
  // naming a specific hotel — if it matches one already shown earlier in
  // this run, skip the clarification and jump straight to that hotel's
  // rooms instead.
  if (!intent.destination && intent.hotelNameQuery) {
    const match = findHotelByName(intent.hotelNameQuery);
    if (match) {
      session.directHotel = match.hotel;
      intent = {
        ...intent,
        destination: match.destination,
        agents: ['hotels'],
        summary: `Here's ${match.hotel.name}, in ${titleCase(match.destination)} — take a look.`,
      };
    }
  }

  session.trip.destination = intent.destination;
  session.trip.origin = intent.origin;
  session.trip.nights = intent.durationNights;
  session.trip.checkIn = intent.checkIn;
  session.trip.checkOut = intent.checkOut;
  session.trip.adults = intent.adults;
  session.trip.children = intent.children;
  session.pendingIntent = intent;

  return { sessionId: session.id, intent };
});

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Structured trip data for the client's PDF export — the 'trip' A2UI
 * surface only carries pre-rendered display strings, not the underlying
 * FlightOption/HotelOption/RoomOption objects, so the PDF needs its own
 * read of the session's actual trip state. */
app.get<{ Params: { sessionId: string } }>('/api/trip/:sessionId', async (req, reply) => {
  const session = getSession(req.params.sessionId);
  if (!session) return reply.code(404).send({ error: 'unknown session' });
  const { trip } = session;
  return {
    ...trip,
    imageUrl: tripImageUrl(trip),
    flightImageUrl: trip.flight ? flightImage(trip.flight.id) : null,
    // Cabin/baggage/aircraft aren't stored on the FlightOption itself (they're
    // derived display fields, same as the flight list already shows) — the
    // PDF wants them too, so compute them the same deterministic way here.
    flightDetails: trip.flight ? flightDetails(trip.flight, trip.cabinClass) : null,
    returnFlightDetails: trip.returnFlight ? flightDetails(trip.returnFlight, trip.cabinClass) : null,
    // Same idea for the hotel — property type/review count/rating breakdown
    // are derived display fields, same as the hotels list already shows.
    hotelDetails: trip.hotel ? hotelDetails(trip.hotel) : null,
  };
});

app.get<{ Params: { sessionId: string } }>('/api/events/:sessionId', async (req, reply) => {
  const { sessionId } = req.params;
  const session = getSession(sessionId);
  if (!session) return reply.code(404).send({ error: 'unknown session' });

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  reply.raw.write(': connected\n\n');
  subscribe(sessionId, reply);
  req.raw.on('close', () => unsubscribe(sessionId, reply));

  if (!session.started) {
    session.started = true;
    if (session.pendingMyRecords) {
      emitMyRecords(sessionId, session.pendingMyRecords);
    } else if (session.pendingExploration) {
      runExploration(sessionId, session.pendingExploration);
    } else {
      const pending = session.pendingIntent as ParsedIntent | undefined;
      if (pending) runAgents(sessionId, pending);
    }
  }
});

/** Renders whatever a chat-asked "my plans"/"my bookings" query resolved to
 * in /api/plan — a card list, or (for a query naming one specific plan) the
 * same trip-summary rendering a live booking already uses, just under a
 * different surfaceId so it appears inline in the chat rather than
 * triggering the trip-rail sidebar (canDownload only watches surfaceId
 * 'trip'). */
function emitMyRecords(sessionId: string, pending: PendingMyRecords) {
  if (pending.kind === 'list') {
    const label = pending.recordType === 'bookings' ? 'My Bookings' : 'My Plans';
    emitAll(sessionId, myRecordsSurface('records', label, pending.records));
  } else if (pending.kind === 'detail') {
    emitAll(sessionId, recordDetailSurface('recordDetail', pending.record, pending.trip));
  }
  // 'signin' and 'not-found' carry everything needed in the intent summary
  // alone — nothing further to render.
}

/** Generates and renders the destination suggestions for a chat-asked
 * "best places to visit in X" query — deferred until the SSE stream
 * connects, same as every other agent-backed response in this app. */
function runExploration(sessionId: string, pending: NonNullable<ReturnType<typeof getSession>>['pendingExploration']) {
  if (!pending) return;
  getDestinationSuggestions(pending.region, pending.season).then(({ destinations }) => {
    if (!getSession(sessionId)) return;
    emitAll(sessionId, destinationsSurface('destinations', pending.region, pending.season, pending.durationNights, destinations));
  });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Same shape/filtering the GET /api/plans route already computes for the
 * page version of this list — kept separate rather than shared so neither
 * has to bend around the other's response shape (that route never filters
 * by bookingRef; this one does, for a "my bookings" query specifically). */
function queryUserRecords(userId: string, recordType: 'plans' | 'bookings', filter: 'upcoming' | 'past' | 'all'): PlanRecordSummary[] {
  const rows = db.prepare(
    'SELECT id, title, destination, image_url, trip_json, created_at FROM plans WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId) as PlanRow[];

  const today = todayIso();
  let records: PlanRecordSummary[] = rows.map((r) => {
    const trip = JSON.parse(r.trip_json) as TripSummary;
    const travelDate = trip.checkIn || trip.flight?.date || null;
    return {
      id: r.id, title: r.title, destination: r.destination, imageUrl: r.image_url, createdAt: r.created_at,
      totalPrice: trip.totalPrice, bookingRef: trip.bookingRef, travelDate,
    };
  });

  if (recordType === 'bookings') records = records.filter((r) => r.bookingRef);
  if (filter === 'upcoming') records = records.filter((r) => !r.travelDate || r.travelDate >= today);
  if (filter === 'past') records = records.filter((r) => r.travelDate && r.travelDate < today);
  return records;
}

/** Best-effort match of a "show me details of my X trip"-style reference
 * against an already-fetched, already-scoped list — same substring-either-
 * direction approach as findHotelByName, for the same reason: destination/
 * title aren't a stable identity, just a best guess at what the traveler means. */
function findRecordByReference(records: PlanRecordSummary[], reference: string): PlanRecordSummary | undefined {
  const q = reference.trim().toLowerCase();
  if (!q) return undefined;
  return records.find((r) => {
    const dest = r.destination.toLowerCase();
    const title = r.title.toLowerCase();
    return dest.includes(q) || q.includes(dest) || title.includes(q);
  });
}

function fetchFullTrip(id: string, userId: string): TripSummary | undefined {
  const row = db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as PlanRow | undefined;
  if (!row || row.user_id !== userId) return undefined;
  return JSON.parse(row.trip_json) as TripSummary;
}

/** So a saved plan's detail view isn't purely read-only — if it named a
 * flight/hotel, this session's own action handlers (backToHotels,
 * selectRoom, bookTrip, ...) can still act on it exactly like a live
 * booking would, the same way `directHotel` hydrates a fresh session
 * from an already-known hotel. */
function hydrateSessionFromTrip(session: NonNullable<ReturnType<typeof getSession>>, trip: TripSummary) {
  session.trip = { ...trip };
  if (trip.flight) session.flightsCache.set(trip.flight.id, trip.flight);
  if (trip.returnFlight) session.flightsCache.set(trip.returnFlight.id, trip.returnFlight);
  if (trip.hotel) {
    session.hotelsCache.set(trip.hotel.id, trip.hotel);
    session.activeHotelId = trip.hotel.id;
  }
}

/** Everything /api/plan needs to do for a chat-asked "my plans"/"my
 * bookings" query — building the actual A2UI content happens later, once
 * the SSE stream connects (see emitMyRecords), matching how every other
 * query defers generation until someone's actually listening. */
function handleMyRecordsQuery(myRecords: MyRecordsIntent, user: AuthUser | undefined) {
  const session = createSession();
  const label = myRecords.recordType === 'bookings' ? 'bookings' : 'plans';
  const filterLabel = myRecords.filter === 'all' ? '' : `${myRecords.filter} `;

  if (!user) {
    session.pendingMyRecords = { kind: 'signin' };
    return {
      sessionId: session.id,
      intent: {
        intent: 'refine', destination: '', agents: [],
        summary: `Sign in from the sidebar to see your saved ${label} — then ask me again.`,
      },
    };
  }

  const records = queryUserRecords(user.id, myRecords.recordType, myRecords.filter);

  if (myRecords.reference) {
    const match = findRecordByReference(records, myRecords.reference);
    if (match) {
      const trip = fetchFullTrip(match.id, user.id);
      if (trip) {
        hydrateSessionFromTrip(session, trip);
        session.pendingMyRecords = { kind: 'detail', record: match, trip };
        return {
          sessionId: session.id,
          intent: { intent: 'refine', destination: '', agents: [], summary: `Here's your ${match.title}:` },
        };
      }
    }
    session.pendingMyRecords = { kind: 'list', records, recordType: myRecords.recordType, filter: myRecords.filter };
    return {
      sessionId: session.id,
      intent: {
        intent: 'refine', destination: '', agents: [],
        summary: records.length
          ? `I couldn't find a saved ${label.slice(0, -1)} matching "${myRecords.reference}" — here's your full list instead.`
          : `I couldn't find a saved ${label.slice(0, -1)} matching "${myRecords.reference}", and you don't have any ${filterLabel}${label} saved yet.`,
      },
    };
  }

  session.pendingMyRecords = { kind: 'list', records, recordType: myRecords.recordType, filter: myRecords.filter };
  return {
    sessionId: session.id,
    intent: {
      intent: 'refine', destination: '', agents: [],
      summary: records.length ? `Here are your ${filterLabel}${label}:` : `You don't have any ${filterLabel}${label} saved yet.`,
    },
  };
}

function runAgents(sessionId: string, intent: ParsedIntent) {
  const session = getSession(sessionId);
  if (!session) return;

  // A "give me the details of X hotel" query that matched an already-known
  // hotel — go straight to its rooms instead of running a fresh search.
  if (session.directHotel) {
    session.activeHotelId = session.directHotel.id;
    session.hotelsCache = new Map([[session.directHotel.id, session.directHotel]]);
    emitAll(sessionId, roomsSurface('hotels', session.directHotel));
    return;
  }

  const departureDate = intent.checkIn || todayIso();

  // Each agent's surface only appears once its data is ready — live Groq
  // output, with mock only as a last-resort fallback on genuine failure.
  // Nothing is emitted early, so there's no mock data to flash before the
  // real result lands; the frontend shows its own "Thinking…" skeleton in
  // the gap.
  if (intent.agents.includes('flights') && intent.origin) {
    getFlightOptions(intent.origin, intent.destination, departureDate).then(({ flights }) => {
      const s = getSession(sessionId);
      if (!s) return;
      // Picked when the query named a time/flight, or just used booking
      // language at all ("book hotel as well with decent price" — no clock
      // time, but "book" is enough to fall back to the cheapest). A bare
      // "plan a trip" keeps showing the plain list, unpicked.
      const recommended = pickRecommendedFlight(flights, {
        targetTime: intent.flightTargetTime, query: intent.flightQuery,
        fallbackToCheapest: intent.wantsBooking,
      });
      const stamped = recommended
        ? flights.map((f) => (f.id === recommended.id ? { ...f, recommended: true } : f))
        : flights;
      s.flightsCache = new Map(stamped.map((f) => [f.id, f]));
      emitAll(sessionId, flightsSurface('flights', stamped));
    });
  }

  if (intent.agents.includes('hotels')) {
    getHotelOptions(intent.destination).then(({ hotels }) => {
      const s = getSession(sessionId);
      if (!s) return;
      s.hotelsCache = new Map(hotels.map((h) => [h.id, h]));
      indexHotels(hotels, intent.destination);

      // "Book hotel as well" with dates given is enough to jump straight to
      // a recommended hotel's rooms right away — no need to wait for a
      // flight to be confirmed first, since the booking dates already come
      // from the parsed intent (the same dates every flight gets stamped
      // with). This turns "full flights list + full hotels list" into "one
      // recommended flight + one recommended room" on the very first
      // response. "Switch" is `backToHotels`, already wired into roomsSurface.
      if (intent.wantsBooking) {
        const hotel = pickRecommendedHotel(hotels, { query: intent.hotelQuery });
        if (hotel) {
          s.activeHotelId = hotel.id;
          const nights = s.trip.nights || 1;
          const checkIn = intent.checkIn;
          const checkOut = intent.checkOut || (checkIn ? addDays(checkIn, nights) : undefined);
          const booking = checkIn && checkOut
            ? { checkIn, checkOut, adults: s.trip.adults || 2, children: s.trip.children || 0 }
            : undefined;
          const room = pickRecommendedRoom(hotel.rooms);
          emitAll(sessionId, roomsSurface('hotels', hotel, booking, room?.id));
          return;
        }
      }

      emitAll(sessionId, hotelsSurface('hotels', hotels));
    });
  }
}

app.post<{ Body: ActionPayload & { sessionId: string } }>('/api/action', async (req, reply) => {
  const { sessionId, name, context } = req.body;
  const session = getSession(sessionId);
  if (!session) return reply.code(404).send({ error: 'unknown session' });

  // Selecting a flight row only expands the client-side detail card + booking
  // form (see App.tsx) — it does NOT touch the trip yet. The trip only gains
  // a flight once the traveler fills in passenger details and confirms.
  if (name === 'confirmFlight') {
    const flight = session.flightsCache.get(context.flightId) as FlightOption | undefined;
    if (flight) {
      session.trip.flight = flight;
      const passengerNames: string[] = Array.isArray(context.passengerNames)
        ? context.passengerNames.map((n: unknown) => String(n).trim()).filter(Boolean)
        : context.passengerName ? [String(context.passengerName).trim()] : [];
      session.trip.passengerNames = passengerNames.length ? passengerNames : undefined;
      session.trip.passengerName = passengerNames[0] || undefined;
      session.trip.passengerEmail = context.passengerEmail || undefined;
      session.trip.cabinClass = context.cabinClass || undefined;
      if (context.adults) session.trip.adults = Number(context.adults);
      if (context.children !== undefined) session.trip.children = Number(context.children);
      session.trip.returnFlight = undefined;
      session.trip.returnDate = undefined;
      if (context.returnDate) {
        const { flights: returnFlights } = await getFlightOptions(flight.to, flight.from, context.returnDate);
        if (returnFlights.length) {
          session.trip.returnFlight = returnFlights[0]; // cheapest — already sorted ascending
          session.trip.returnDate = context.returnDate;
        }
      }
      recomputeTotal(session);
      emitAll(sessionId, tripSummarySurface('trip', session.trip));

      // Reduce clicks: once a flight is confirmed, if this trip also expects
      // a hotel and no room is picked (or already auto-picked up front in
      // runAgents — !session.activeHotelId guards against re-emitting that
      // same jump a second time here), auto-advance straight to a
      // recommended hotel's rooms — the same jump `selectHotel` below
      // already makes, just fired automatically. Dates come from the
      // flight's own date + the trip's night count ("book a room from the
      // departure date for however many nights"). `backToHotels` (already
      // wired into roomsSurface) is the same "switch" escape hatch already
      // proven for the flight recommendation.
      const pendingIntent = session.pendingIntent as ParsedIntent | undefined;
      if (pendingIntent?.agents?.includes('hotels') && !session.trip.room && !session.activeHotelId && session.hotelsCache.size) {
        const hotel = pickRecommendedHotel(
          [...session.hotelsCache.values()] as HotelOption[],
          { query: pendingIntent.hotelQuery }
        );
        if (hotel) {
          session.activeHotelId = hotel.id;
          const nights = session.trip.nights || 1;
          const checkIn = flight.date;
          const checkOut = addDays(checkIn, nights);
          const room = pickRecommendedRoom(hotel.rooms);
          emitAll(sessionId, roomsSurface('hotels', hotel, {
            checkIn, checkOut, adults: session.trip.adults || 2, children: session.trip.children || 0,
          }, room?.id));
        }
      }
    }
  }

  if (name === 'selectHotel') {
    const hotel = session.hotelsCache.get(context.hotelId) as HotelOption | undefined;
    if (hotel) {
      session.activeHotelId = hotel.id;
      const nights = session.trip.nights || 1;
      const checkIn = session.trip.checkIn;
      const checkOut = session.trip.checkOut || (checkIn ? addDays(checkIn, nights) : undefined);
      const booking = checkIn && checkOut
        ? { checkIn, checkOut, adults: session.trip.adults || 2, children: session.trip.children || 0 }
        : undefined;
      emitAll(sessionId, roomsSurface('hotels', hotel, booking));
    }
  }

  if (name === 'backToHotels') {
    session.activeHotelId = undefined;
    emitAll(sessionId, hotelsSurface('hotels', [...session.hotelsCache.values()] as HotelOption[]));
  }

  if (name === 'selectRoom') {
    const hotel = session.activeHotelId ? (session.hotelsCache.get(session.activeHotelId) as HotelOption | undefined) : undefined;
    const room = hotel?.rooms.find((r: RoomOption) => r.id === context.roomId);
    if (hotel && room) {
      session.trip.hotel = hotel;
      session.trip.room = room;
      if (context.checkIn) session.trip.checkIn = context.checkIn;
      if (context.checkOut) session.trip.checkOut = context.checkOut;
      if (context.adults) session.trip.adults = Number(context.adults);
      session.trip.children = context.children ? Number(context.children) : 0;
      recomputeTotal(session);
      emitAll(sessionId, tripSummarySurface('trip', session.trip));
    }
  }

  // The trip-builder card's single confirm step — the whole review-and-book
  // flow (flight + room + traveler counts/dates the traveler adjusted, plus
  // names) lives in one card, so this one action does everything the old
  // confirmTrip + bookTrip pair did across two separate steps: assigns both
  // legs, applies whatever the traveler edited, and finalizes the booking
  // (bookingRef) immediately — there's no second "please confirm again"
  // step left for this flow. A room still needs its lead guest name; a
  // flight-only trip doesn't need one (matches the old bookTrip rule).
  if (name === 'confirmTrip') {
    const flight = context.flightId ? (session.flightsCache.get(context.flightId) as FlightOption | undefined) : undefined;
    const hotel = session.activeHotelId ? (session.hotelsCache.get(session.activeHotelId) as HotelOption | undefined) : undefined;
    const room = hotel && context.roomId ? hotel.rooms.find((r: RoomOption) => r.id === context.roomId) : undefined;
    if (!flight && !(hotel && room)) return reply.code(202).send({ ok: true });

    const adults = context.adults ? Number(context.adults) : (session.trip.adults || 2);
    const children = context.children ? Number(context.children) : (session.trip.children || 0);
    session.trip.adults = adults;
    session.trip.children = children;

    if (flight) {
      session.trip.flight = flight;
      session.trip.returnFlight = undefined;
      session.trip.returnDate = undefined;
      const passengerNames: string[] = Array.isArray(context.passengerNames)
        ? context.passengerNames.map((n: unknown) => String(n).trim()).filter(Boolean)
        : [];
      session.trip.passengerNames = passengerNames.length ? passengerNames : undefined;
      session.trip.passengerName = passengerNames[0] || undefined;
    }
    if (hotel && room) {
      session.trip.hotel = hotel;
      session.trip.room = room;
      const nights = session.trip.nights || 1;
      const checkIn = String(context.checkIn || session.trip.checkIn || flight?.date || todayIso());
      const checkOut = String(context.checkOut || session.trip.checkOut || addDays(checkIn, nights));
      session.trip.checkIn = checkIn;
      session.trip.checkOut = checkOut;
      session.trip.guestName = String(context.guestName || '').trim() || undefined;
    }
    recomputeTotal(session);
    session.trip.bookingRef = `VOY-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    emitAll(sessionId, tripSummarySurface('trip', session.trip));
  }

  // A room or a flight can each be confirmed on its own — a traveler who
  // already booked one leg elsewhere shouldn't be blocked from confirming
  // just the other. A room additionally needs its own lead-guest name,
  // collected here in the trip summary rather than earlier in the room list.
  if (name === 'bookTrip') {
    const guestName = String(context.guestName || '').trim();
    const needsGuestName = !!session.trip.room;
    const canBook = (session.trip.room || session.trip.flight) && (!needsGuestName || guestName);
    if (canBook) {
      if (needsGuestName) session.trip.guestName = guestName;
      session.trip.bookingRef = `VOY-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      emitAll(sessionId, tripSummarySurface('trip', session.trip));
    }
  }

  return reply.code(202).send({ ok: true });
});

/** Cross-sell: pull in the agent that wasn't part of the original intent
 * (e.g. add hotels after a flights-only search) without re-parsing the query.
 * Reuses the same agent functions and surface builders as the initial plan. */
app.post<{ Body: { sessionId: string; agent: 'flights' | 'hotels'; origin?: string } }>('/api/expand', async (req, reply) => {
  const { sessionId, agent, origin } = req.body;
  const session = getSession(sessionId);
  if (!session) return reply.code(404).send({ error: 'unknown session' });

  if (agent === 'flights') {
    const flightOrigin = origin || session.trip.origin;
    if (!flightOrigin) return reply.code(400).send({ error: 'origin required' });
    session.trip.origin = flightOrigin;
    const destination = session.trip.destination;
    const departureDate = session.trip.checkIn || todayIso();
    getFlightOptions(flightOrigin, destination, departureDate).then(({ flights }) => {
      const s = getSession(sessionId);
      if (!s) return;
      s.flightsCache = new Map(flights.map((f) => [f.id, f]));
      emitAll(sessionId, flightsSurface('flights', flights));
    });
  } else {
    const destination = session.trip.destination;
    getHotelOptions(destination).then(({ hotels }) => {
      const s = getSession(sessionId);
      if (!s) return;
      s.hotelsCache = new Map(hotels.map((h) => [h.id, h]));
      indexHotels(hotels, destination);
      emitAll(sessionId, hotelsSurface('hotels', hotels));
    });
  }

  return reply.code(202).send({ ok: true });
});

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A representative photo for a trip — the booked room if there is one, else
 * the hotel, else a generic destination shot so a flights-only trip (saved
 * plan or PDF) never ends up with a blank thumbnail. */
function tripImageUrl(trip: TripSummary): string {
  if (trip.room && trip.hotel) {
    const tier = [...trip.hotel.rooms].sort((a, b) => a.price - b.price).findIndex((r) => r.id === trip.room!.id);
    return roomImage(trip.room.imageSeed, Math.max(tier, 0));
  }
  if (trip.hotel) return hotelImage(trip.hotel.imageSeed);
  return destinationImage(trip.destination);
}

/** A fare/room-night sum was never the real final price — this adds a flat
 * taxes-and-fees line (a stand-in for the real thing: GST, service charges,
 * etc.) so the total shown is the amount actually being confirmed, not a
 * number that would grow again at a real checkout. */
const TAX_RATE = 0.12;

function recomputeTotal(session: NonNullable<ReturnType<typeof getSession>>) {
  const nights = session.trip.nights || 1;
  // Flights are priced per seat — a fare listed for one traveler needs
  // multiplying by however many are actually flying. Rooms aren't: a room's
  // nightly rate is flat regardless of occupancy (within its capacity),
  // matching how hotel pricing actually works. Defaults to 1 (unmultiplied)
  // for any flow that never touches adults/children, preserving old totals.
  const travelers = (session.trip.adults || 0) + (session.trip.children || 0) || 1;
  // The listed fare is the Economy price — Business/First/Premium Economy
  // multiply it, same as a real airline upsell (see cabinPriceMultiplier).
  const cabinMultiplier = cabinPriceMultiplier(session.trip.cabinClass);
  const flightPrice = (session.trip.flight?.price || 0) * travelers * cabinMultiplier;
  const returnPrice = (session.trip.returnFlight?.price || 0) * travelers * cabinMultiplier;
  const roomPrice = session.trip.room ? session.trip.room.price * nights : 0;
  const subtotal = flightPrice + returnPrice + roomPrice;
  if (subtotal) {
    session.trip.taxesAndFees = Math.round(subtotal * TAX_RATE);
    session.trip.totalPrice = subtotal + session.trip.taxesAndFees;
  }
}

/* ---------------- Auth ---------------- */

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

app.post<{ Body: { email: string; password: string } }>('/api/auth/signup', async (req, reply) => {
  const email = req.body.email?.trim().toLowerCase();
  const { password } = req.body;
  if (!email || !password || password.length < 6) {
    return reply.code(400).send({ error: 'a valid email and a password of at least 6 characters are required' });
  }
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    return reply.code(409).send({ error: 'an account with this email already exists' });
  }

  const id = newId();
  const passwordHash = await hashPassword(password);
  db.prepare('INSERT INTO users (id, email, password_hash, google_sub, created_at) VALUES (?, ?, ?, NULL, ?)')
    .run(id, email, passwordHash, new Date().toISOString());

  const user = { id, email };
  return reply.code(201).send({ token: signToken(user), user });
});

app.post<{ Body: { email: string; password: string } }>('/api/auth/login', async (req, reply) => {
  const email = req.body.email?.trim().toLowerCase();
  const row = email ? (db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined) : undefined;
  const ok = row?.password_hash && (await verifyPassword(req.body.password || '', row.password_hash));
  if (!row || !ok) return reply.code(401).send({ error: 'invalid email or password' });

  const user = toAuthUser(row);
  return { token: signToken(user), user };
});

app.post<{ Body: { credential: string } }>('/api/auth/google', async (req, reply) => {
  if (!googleClient) return reply.code(501).send({ error: 'Google sign-in is not configured on this server' });
  if (!req.body.credential) return reply.code(400).send({ error: 'credential is required' });

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: req.body.credential, audience: GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    return reply.code(401).send({ error: 'invalid Google credential' });
  }
  if (!payload?.sub) return reply.code(401).send({ error: 'invalid Google credential' });

  let row = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(payload.sub) as UserRow | undefined;
  if (!row && payload.email) {
    row = db.prepare('SELECT * FROM users WHERE email = ?').get(payload.email) as UserRow | undefined;
    if (row) db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(payload.sub, row.id);
  }
  if (!row) {
    const id = newId();
    db.prepare('INSERT INTO users (id, email, password_hash, google_sub, created_at) VALUES (?, ?, NULL, ?, ?)')
      .run(id, payload.email || null, payload.sub, new Date().toISOString());
    row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
  }

  const user = toAuthUser(row);
  return { token: signToken(user), user };
});

app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => ({ user: req.user }));

/* ---------------- Saved plans ---------------- */

app.post<{ Body: { sessionId: string; title?: string } }>('/api/plans', { preHandler: requireAuth }, async (req, reply) => {
  const { sessionId, title } = req.body;
  const session = getSession(sessionId);
  if (!session || !session.trip.destination) return reply.code(400).send({ error: 'no trip to save yet' });

  const id = newId();
  const imageUrl = tripImageUrl(session.trip);
  db.prepare(`
    INSERT INTO plans (id, user_id, title, destination, image_url, trip_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.user!.id, title?.trim() || `Trip to ${session.trip.destination}`,
    session.trip.destination, imageUrl, JSON.stringify(session.trip), new Date().toISOString()
  );

  return reply.code(201).send({ id });
});

app.get<{ Querystring: { filter?: 'upcoming' | 'past' | 'all' } }>('/api/plans', { preHandler: requireAuth }, async (req) => {
  const rows = db.prepare(
    'SELECT id, title, destination, image_url, trip_json, created_at FROM plans WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.user!.id) as PlanRow[];

  const today = todayIso();
  const withDate = rows.map((r) => {
    const trip = JSON.parse(r.trip_json) as TripSummary;
    // Prefer the room booking's check-in; fall back to the flight's own
    // date for a flight-only trip. A trip with neither has no known travel
    // date at all — bucketed as upcoming so it stays visible rather than
    // silently disappearing from a filtered view.
    const travelDate = trip.checkIn || trip.flight?.date || null;
    return {
      id: r.id, title: r.title, destination: r.destination, imageUrl: r.image_url, createdAt: r.created_at,
      totalPrice: trip.totalPrice, bookingRef: trip.bookingRef, travelDate,
    };
  });

  const { filter } = req.query;
  if (filter === 'upcoming') return withDate.filter((p) => !p.travelDate || p.travelDate >= today);
  if (filter === 'past') return withDate.filter((p) => p.travelDate && p.travelDate < today);
  return withDate;
});

app.get<{ Params: { id: string } }>('/api/plans/:id', { preHandler: requireAuth }, async (req, reply) => {
  const row = db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id) as PlanRow | undefined;
  if (!row || row.user_id !== req.user!.id) return reply.code(404).send({ error: 'not found' });
  const trip = JSON.parse(row.trip_json) as TripSummary;
  return {
    id: row.id, title: row.title, destination: row.destination, imageUrl: row.image_url, createdAt: row.created_at, trip,
    // Same derived display fields the live hotel/room views and the PDF
    // already show — TripSummaryDisplay (the "View full plan" drawer) wants
    // them too, and trip_json only ever stored the base HotelOption/FlightOption.
    hotelDetails: trip.hotel ? hotelDetails(trip.hotel) : null,
    flightDetails: trip.flight ? flightDetails(trip.flight, trip.cabinClass) : null,
  };
});

app.delete<{ Params: { id: string } }>('/api/plans/:id', { preHandler: requireAuth }, async (req, reply) => {
  const row = db.prepare('SELECT user_id FROM plans WHERE id = ?').get(req.params.id) as { user_id: string } | undefined;
  if (!row || row.user_id !== req.user!.id) return reply.code(404).send({ error: 'not found' });
  db.prepare('DELETE FROM plans WHERE id = ?').run(req.params.id);
  return reply.code(204).send();
});

app.listen({ port: PORT, host: '0.0.0.0' }).then(() => {
  console.log(`Voyage AI backend listening on :${PORT} (${LLM_ENABLED ? 'Groq LLM enabled' : 'mock data mode — set GROQ_API_KEY to enable live generation'})`);
});
