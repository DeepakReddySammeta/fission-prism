// Must be the first import: it populates process.env from backend/.env
// before ./config (and anything ./config re-exports) reads process.env.
import 'dotenv/config';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { OAuth2Client } from 'google-auth-library';
import type { ActionPayload, FlightOption, HotelOption, ParsedIntent, RoomOption, TripSummary } from './types';
import { PORT, LLM_ENABLED, LLM_PROVIDER, LLM_MODEL, GOOGLE_CLIENT_ID, CORS_ORIGINS } from './config';
import {
  parseIntent, detectMyRecordsIntent, detectExplorationIntent, detectAppointmentsQuery,
  type MyRecordsIntent, type AppointmentsQuery,
} from './agents/intent';
import { getFlightOptions } from './agents/flights';
import { getHotelOptions } from './agents/hotels';
import { getDestinationSuggestions } from './agents/destinations';
import { pickRecommendedFlight, pickRecommendedHotel, pickRecommendedRoom } from './agents/recommend';
import { getDoctorMatches, normalizeSpecialty, findDoctorByName, detectDoctorLookup, type DoctorMatch } from './agents/health';
import { detectFinanceQuery, type FinanceQuery } from './agents/finance';
import { getDoctorById } from './mock/doctors';
import {
  createSession, getSession, subscribe, unsubscribe, emit, emitAll,
  type PendingMyRecords, type PlanRecordSummary, type PendingAppointments, type AppointmentSummary,
  type PendingFinance, type CategoryStatus, type GoalSummary, type GoalPlanItem,
  type CashFlowPoint, type RecentExpenseRow,
} from './orchestrator/sessions';
import { indexHotels, findHotelByName, detectHotelRoomsLookup } from './orchestrator/hotelIndex';
import {
  flightsSurface, hotelsSurface, roomsSurface, tripSummarySurface, myRecordsSurface, recordDetailSurface,
  destinationsSurface, doctorsSurface, doctorProfileSurface, doctorBookingFormSurface, appointmentConfirmationSurface,
  appointmentsSurface, budgetBreakdownSurface, expenseLoggedSurface, savingsGoalSurface, savingsGoalsListSurface,
  financeSummarySurface, portfolioSurface, goalsAnalysisSurface,
  expensesBreakdownSurface, cashFlowSurface, budgetUtilizationSurface, recentExpensesSurface,
  inr, formatAppointmentDate, hotelImage, roomImage, destinationImage, flightImage, flightDetails, hotelDetails, cabinPriceMultiplier,
} from './orchestrator/envelopes';
import {
  db, type UserRow, type PlanRow, type AppointmentRow,
  type FinanceProfileRow, type SavingsGoalRow,
} from './db';
import { newId, hashPassword, verifyPassword, signToken, toAuthUser, requireAuth, optionalAuth, type AuthUser } from './auth/auth';
import { loadWeather } from './weather/weather';

const app = Fastify({ logger: false });

// CORS_ORIGIN unset (local dev) → reflect any origin. Set to the deployed
// frontend URL(s) in production and only those are allowed.
app.register(cors, { origin: CORS_ORIGINS.length ? CORS_ORIGINS : true });

/** The value to send as Access-Control-Allow-Origin on the raw SSE response
 * (which bypasses the @fastify/cors plugin). Mirrors the rule above: '*' when
 * no allowlist is configured, otherwise the caller's origin iff it's allowed
 * (and undefined — header omitted, browser blocks — if it isn't). */
function sseAllowOrigin(reqOrigin?: string): string | undefined {
  if (!CORS_ORIGINS.length) return '*';
  return reqOrigin && CORS_ORIGINS.includes(reqOrigin) ? reqOrigin : undefined;
}

app.get('/api/health', async () => ({
  ok: true,
  llm: LLM_ENABLED ? LLM_PROVIDER : 'mock',
  model: LLM_ENABLED ? LLM_MODEL : null,
}));

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

  // "I earn 60000, rent is 20000..." / "spent 500 on groceries" / "save
  // 50000 for a laptop" / "how can I plan saving 1 lakh for my bike" / "how
  // much have I spent this month" — the personal finance agent. Checked
  // FIRST, ahead of detectMyRecordsIntent below: "plan" is that function's
  // own trigger noun for a saved travel plan, so a finance sentence that
  // happens to use the ordinary English verb "plan" ("how can I plan
  // saving...") was being misread as "show me my saved trip plans" before
  // finance ever got a chance to look at it. Finance's own vocabulary
  // (goal/save/budget/income/...) essentially never collides with a real
  // "show my trips" request, so checking it first costs nothing there.
  const financeQuery = detectFinanceQuery(query);
  if (financeQuery) return handleFinanceQuery(financeQuery, req.user);

  // "My plans" / "my upcoming bookings" / "details of my kerala trip" —
  // answered right here in the chat (a records list, or one specific plan's
  // full summary) instead of navigating to /plans or /bookings. No LLM call
  // either way — this is a fast, deterministic classifier (see intent.ts).
  const myRecords = detectMyRecordsIntent(query);
  if (myRecords) return handleMyRecordsQuery(myRecords, req.user);

  // "My upcoming appointments" / "appointments today" / "past appointments
  // with Dr. Rao" — checked before detectDoctorLookup below: "appointment
  // with Dr. Rao" would otherwise match that function's own "mentions a
  // doctor" heuristic and get misread as a request to view Dr. Rao's
  // profile instead of the actual booked appointment.
  const appointmentsQuery = detectAppointmentsQuery(query);
  if (appointmentsQuery) return handleAppointmentsQuery(appointmentsQuery, req.user);

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

  // "View profile for Dr. X" / "Book an appointment with Dr. X" — the two
  // fixed templates App.tsx synthesizes for the doctor list's buttons (see
  // detectDoctorLookup's own comment). A direct lookup, not a search, so no
  // LLM call — same reasoning as the two checks above.
  const doctorLookup = detectDoctorLookup(query);
  if (doctorLookup) {
    const doctor = findDoctorByName(doctorLookup.doctorName);
    const session = createSession();
    if (!doctor) {
      return {
        sessionId: session.id,
        intent: { intent: 'refine', destination: '', agents: [], summary: `I couldn't find ${doctorLookup.doctorName} — they may not be listed anymore.` },
      };
    }
    session.pendingDoctorLookup = doctor;
    session.pendingDoctorView = doctorLookup.kind === 'book' ? 'book' : 'overview';
    session.pendingDoctorHints = doctorLookup.hints;
    return {
      sessionId: session.id,
      intent: {
        intent: 'find_doctor', destination: '', agents: [],
        summary: doctorLookup.kind === 'book'
          ? `Here's the booking form for ${doctor.name}.`
          : `Here's ${doctor.name}'s full profile.`,
      },
    };
  }

  // "View rooms at <hotel>" — the fixed template the hotel grid's button
  // synthesizes (see detectHotelRoomsLookup). A direct jump to that hotel's
  // rooms as a fresh chat turn, not a search — no LLM, same as the checks
  // above. The rooms card renders with no "← Back to hotels" button, since
  // there's no list in this turn to go back to.
  const hotelRooms = detectHotelRoomsLookup(query);
  if (hotelRooms) {
    const match = findHotelByName(hotelRooms.hotelName);
    const session = createSession();
    if (!match) {
      return {
        sessionId: session.id,
        intent: {
          intent: 'refine', destination: '', agents: [],
          summary: `I can't find ${hotelRooms.hotelName} anymore — search for hotels again and I'll pull up its rooms.`,
        },
      };
    }
    session.directHotel = match.hotel;
    session.trip.destination = match.destination;
    // Deliberately intent:'refine' / agents:[] — not 'browse_hotels' — so the
    // turn is *only* this hotel's rooms card: no weather report, no "flying
    // in? add flights" cross-sell, none of the trip-planning scaffolding a
    // real hotels search pulls in. runAgents still fires (it keys off
    // session.directHotel, not the agents list) and renders roomsSurface.
    session.pendingIntent = {
      intent: 'refine', destination: '', agents: [],
      summary: `Here are the rooms at ${match.hotel.name}, in ${titleCase(match.destination)}.`,
    };
    return { sessionId: session.id, intent: session.pendingIntent };
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

  const allowOrigin = sseAllowOrigin(req.headers.origin);
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    // Reverse proxies must not buffer this response or the stream stalls.
    'X-Accel-Buffering': 'no',
    ...(allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin, Vary: 'Origin' } : {}),
  });
  reply.raw.write(': connected\n\n');
  subscribe(sessionId, reply);
  req.raw.on('close', () => unsubscribe(sessionId, reply));

  if (!session.started) {
    session.started = true;
    if (session.pendingMyRecords) {
      emitMyRecords(sessionId, session.pendingMyRecords);
    } else if (session.pendingAppointments) {
      emitAppointments(sessionId, session.pendingAppointments);
    } else if (session.pendingFinance) {
      emitFinance(sessionId, session.pendingFinance);
    } else if (session.pendingExploration) {
      runExploration(sessionId, session.pendingExploration);
    } else if (session.pendingDoctorLookup) {
      runDoctorLookup(sessionId, session.pendingDoctorLookup, session.pendingDoctorView, session.pendingDoctorHints);
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
    const base = pending.recordType === 'bookings' ? 'My Bookings' : 'My Plans';
    const suffix = pending.bookingType === 'trips' ? ' — Full Trips'
      : pending.bookingType === 'flights' ? ' — Flights Only'
      : pending.bookingType === 'rooms' ? ' — Rooms Only'
      : '';
    emitAll(sessionId, myRecordsSurface('records', `${base}${suffix}`, pending.records));
  } else if (pending.kind === 'detail') {
    emitAll(sessionId, recordDetailSurface('recordDetail', pending.record, pending.trip));
  }
  // 'signin' and 'not-found' carry everything needed in the intent summary
  // alone — nothing further to render.
}

/** Renders whatever a chat-asked "my appointments" query resolved to — same
 * deferred-until-SSE-connects reasoning as emitMyRecords. 'signin' and
 * 'unsupported' carry everything needed in the intent summary alone. */
function emitAppointments(sessionId: string, pending: PendingAppointments) {
  // An empty result is fully explained by the chat summary alone ("You
  // don't have any past appointments") — rendering an otherwise-blank card
  // under it would look broken rather than "decent", so skip it.
  if (pending.kind !== 'list' || pending.appointments.length === 0) return;
  const base = pending.filter === 'today' ? "Today's Appointments"
    : pending.filter === 'upcoming' ? 'Upcoming Appointments'
    : pending.filter === 'past' ? 'Past Appointments'
    : 'My Appointments';
  emitAll(sessionId, appointmentsSurface('appointments', base, pending.appointments));
}

/** Renders whatever a chat-typed finance message resolved to — same
 * deferred-until-SSE-connects reasoning as emitMyRecords/emitAppointments.
 * 'signin', 'unsupported', and 'unclear' carry everything needed in the
 * intent summary alone; an empty goals list is skipped the same way an
 * empty appointments list is, for the same "decent, not broken" reason. */
function emitFinance(sessionId: string, pending: PendingFinance) {
  if (pending.kind === 'budget') {
    emitAll(sessionId, budgetBreakdownSurface('finance', pending.income, pending.categories, pending.allocatedTotal));
  } else if (pending.kind === 'expense_logged') {
    emitAll(sessionId, expenseLoggedSurface('finance', pending.amount, pending.category, pending.note, pending.categoryStatus));
  } else if (pending.kind === 'goal') {
    emitAll(sessionId, savingsGoalSurface('finance', pending.goal));
  } else if (pending.kind === 'goals_list' && pending.goals.length > 0) {
    emitAll(sessionId, savingsGoalsListSurface('finance', pending.goals));
  } else if (pending.kind === 'summary' && pending.categories.length > 0) {
    emitAll(sessionId, financeSummarySurface('finance', pending.periodLabel, pending.categories, pending.totalSpent, pending.compare));
  } else if (pending.kind === 'portfolio') {
    emitAll(sessionId, portfolioSurface('finance', pending));
  } else if (pending.kind === 'goals_analysis') {
    emitAll(sessionId, goalsAnalysisSurface(
      'finance', pending.income, pending.expenseTotal, pending.expenseSource, pending.disposable,
      pending.goals, pending.totalRequired, pending.feasible, pending.shortfall, pending.surplus,
      pending.cuts, pending.extensions, pending.singleGoalName, pending.notFoundName,
    ));
  } else if (pending.kind === 'expenses_breakdown') {
    emitAll(sessionId, expensesBreakdownSurface('finance', pending.categories, pending.expenseSource));
  } else if (pending.kind === 'cash_flow' && pending.cashFlow.some((c) => c.income > 0 || c.expenses > 0)) {
    emitAll(sessionId, cashFlowSurface('finance', pending.cashFlow));
  } else if (pending.kind === 'budget_utilization' && pending.limit > 0) {
    emitAll(sessionId, budgetUtilizationSurface('finance', pending.pct, pending.spent, pending.limit));
  } else if (pending.kind === 'recent_expenses' && pending.expenses.length > 0) {
    emitAll(sessionId, recentExpensesSurface('finance', pending.expenses));
  }
}

/** Generates and renders the destination suggestions for a chat-asked
 * "best places to visit in X" query — deferred until the SSE stream
 * connects, same as every other agent-backed response in this app. */
function runExploration(sessionId: string, pending: NonNullable<ReturnType<typeof getSession>>['pendingExploration']) {
  if (!pending) return;
  getDestinationSuggestions(pending.region, pending.season).then(({ destinations, source }) => {
    if (!getSession(sessionId)) return;
    emitAll(sessionId, destinationsSurface('destinations', pending.region, pending.season, pending.durationNights, destinations));
  });
}

/** Renders the profile+booking card for a "View profile for Dr. X"/"Book an
 * appointment with Dr. X" lookup — populates the same session state
 * (doctorsCache/activeDoctorId) the find_doctor flow's own viewDoctorProfile
 * action does, so confirmAppointment works completely unchanged regardless
 * of which path got the traveler to this card. */
function runDoctorLookup(
  sessionId: string, doctor: DoctorMatch, view?: 'overview' | 'book', hints?: { preferredDate?: string; preferredTime?: string }
) {
  const session = getSession(sessionId);
  if (!session) return;
  session.doctorsCache = new Map([[doctor.id, doctor]]);
  session.activeDoctorId = doctor.id;
  if (view === 'book') {
    emitAll(sessionId, doctorBookingFormSurface('health', doctor, session.symptom, hints));
  } else {
    emitAll(sessionId, doctorProfileSurface('health', doctor));
  }
}

function todayIso(): string {
  return toLocalIsoDate(new Date());
}

/** Same shape/filtering the GET /api/plans route already computes for the
 * page version of this list — kept separate rather than shared so neither
 * has to bend around the other's response shape (that route never filters
 * by bookingRef; this one does, for a "my bookings" query specifically). */
function queryUserRecords(
  userId: string, recordType: 'plans' | 'bookings', filter: 'upcoming' | 'past' | 'all',
  bookingType?: 'trips' | 'flights' | 'rooms',
): PlanRecordSummary[] {
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
      hasFlight: Boolean(trip.flight), hasRoom: Boolean(trip.room),
    };
  });

  if (recordType === 'bookings') records = records.filter((r) => r.bookingRef);
  if (filter === 'upcoming') records = records.filter((r) => !r.travelDate || r.travelDate >= today);
  if (filter === 'past') records = records.filter((r) => r.travelDate && r.travelDate < today);
  // Same three-way split as the My Bookings page's own tabs (MyBookings.tsx):
  // both flight and room booked is a full trip, only one is that type alone.
  if (bookingType === 'trips') records = records.filter((r) => r.hasFlight && r.hasRoom);
  if (bookingType === 'flights') records = records.filter((r) => r.hasFlight && !r.hasRoom);
  if (bookingType === 'rooms') records = records.filter((r) => r.hasRoom && !r.hasFlight);
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
  const bookingTypeLabel = myRecords.bookingType === 'trips' ? 'full-trip '
    : myRecords.bookingType === 'flights' ? 'flight-only '
    : myRecords.bookingType === 'rooms' ? 'room-only '
    : '';

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

  const records = queryUserRecords(user.id, myRecords.recordType, myRecords.filter, myRecords.bookingType);

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
    session.pendingMyRecords = { kind: 'list', records, recordType: myRecords.recordType, filter: myRecords.filter, bookingType: myRecords.bookingType };
    return {
      sessionId: session.id,
      intent: {
        intent: 'refine', destination: '', agents: [],
        summary: records.length
          ? `I couldn't find a saved ${label.slice(0, -1)} matching "${myRecords.reference}" — here's your full list instead.`
          : `I couldn't find a saved ${label.slice(0, -1)} matching "${myRecords.reference}", and you don't have any ${filterLabel}${bookingTypeLabel}${label} saved yet.`,
      },
    };
  }

  session.pendingMyRecords = { kind: 'list', records, recordType: myRecords.recordType, filter: myRecords.filter, bookingType: myRecords.bookingType };
  return {
    sessionId: session.id,
    intent: {
      intent: 'refine', destination: '', agents: [],
      summary: records.length
        ? `Here are your ${filterLabel}${bookingTypeLabel}${label}:`
        : `You don't have any ${filterLabel}${bookingTypeLabel}${label} saved yet.`,
    },
  };
}

/** Same shape/reasoning as queryUserRecords above, against the appointments
 * table instead of plans — specialty isn't stored on the row itself (the
 * doctor roster is static mock data, not worth duplicating), so it's
 * resolved here via getDoctorById at query time instead. */
function queryUserAppointments(userId: string, filter: 'upcoming' | 'past' | 'today' | 'all'): AppointmentSummary[] {
  const rows = db.prepare(
    'SELECT * FROM appointments WHERE user_id = ? ORDER BY preferred_date ASC, preferred_time ASC'
  ).all(userId) as AppointmentRow[];

  const today = todayIso();
  let records: AppointmentSummary[] = rows.map((r) => ({
    id: r.id, doctorName: r.doctor_name, specialty: getDoctorById(r.doctor_id)?.specialty || 'General Medicine',
    hospitalName: r.hospital_name, patientName: r.patient_name, preferredDate: r.preferred_date,
    preferredTime: r.preferred_time, appointmentRef: r.appointment_ref, createdAt: r.created_at,
  }));

  if (filter === 'today') records = records.filter((r) => r.preferredDate === today);
  if (filter === 'upcoming') records = records.filter((r) => r.preferredDate >= today);
  if (filter === 'past') {
    records = records.filter((r) => r.preferredDate < today).sort((a, b) => b.preferredDate.localeCompare(a.preferredDate));
  }
  return records;
}

/** Best-effort match of a "my appointment with Dr. X" reference against an
 * already-scoped list — substring either direction against doctor/specialty/
 * hospital, same reasoning as findRecordByReference/findHotelByName: name
 * matching here is a convenience filter, not an identity lookup. */
function filterAppointmentsByReference(appointments: AppointmentSummary[], reference: string): AppointmentSummary[] {
  const q = reference.trim().toLowerCase();
  if (!q) return appointments;
  return appointments.filter((a) => {
    const doctor = a.doctorName.toLowerCase();
    const specialty = a.specialty.toLowerCase();
    const hospital = a.hospitalName.toLowerCase();
    return doctor.includes(q) || q.includes(doctor.replace(/^dr\.?\s*/, '')) || specialty.includes(q) || hospital.includes(q);
  });
}

/** Everything /api/plan needs to do for a chat-asked "my appointments"
 * query — mirrors handleMyRecordsQuery; actual A2UI content is built once
 * the SSE stream connects (see emitAppointments). */
function handleAppointmentsQuery(query: AppointmentsQuery, user: AuthUser | undefined) {
  const session = createSession();

  if (query.kind === 'unsupported') {
    // A decent, honest answer for something outside this app's scope,
    // rather than either ignoring the request or pretending it worked.
    return {
      sessionId: session.id,
      intent: {
        intent: 'refine', destination: '', agents: [],
        summary: `I can't ${query.action} an appointment yet — this app only supports viewing and booking them for now. `
          + `Please contact the hospital directly to ${query.action} it, or ask me to book a new one.`,
      },
    };
  }

  const filterLabel = query.filter === 'all' ? '' : query.filter === 'today' ? "today's " : `${query.filter} `;
  if (!user) {
    session.pendingAppointments = { kind: 'signin' };
    return {
      sessionId: session.id,
      intent: {
        intent: 'refine', destination: '', agents: [],
        summary: `Sign in from the sidebar to see your ${filterLabel}appointments — then ask me again.`,
      },
    };
  }

  let appointments = queryUserAppointments(user.id, query.filter);
  let summary: string;
  if (query.reference) {
    const matched = filterAppointmentsByReference(appointments, query.reference);
    if (matched.length) {
      appointments = matched;
      summary = `Here ${matched.length === 1 ? 'is' : 'are'} your ${filterLabel}appointment${matched.length === 1 ? '' : 's'} matching "${query.reference}":`;
    } else {
      summary = appointments.length
        ? `I couldn't find a ${filterLabel}appointment matching "${query.reference}" — here's your full ${filterLabel}list instead.`
        : `You don't have any ${filterLabel}appointments${appointments.length ? '' : ' at all'}, so nothing matches "${query.reference}" either.`;
    }
  } else {
    summary = appointments.length ? `Here are your ${filterLabel}appointments:` : `You don't have any ${filterLabel}appointments.`;
  }

  session.pendingAppointments = { kind: 'list', appointments, filter: query.filter, reference: query.reference };
  return { sessionId: session.id, intent: { intent: 'refine', destination: '', agents: [], summary } };
}

function monthRange(period: 'this_month' | 'last_month'): { start: string; end: string } {
  const now = new Date();
  const monthIdx = period === 'this_month' ? now.getMonth() : now.getMonth() - 1;
  const start = new Date(now.getFullYear(), monthIdx, 1);
  const end = new Date(now.getFullYear(), monthIdx + 1, 0);
  // toLocalIsoDate, not .toISOString().slice(0,10) — the same UTC rollback
  // bug fixed elsewhere in this file (see toLocalIsoDate's own comment)
  // was silently making "this month" start on the 31st of last month in
  // any timezone ahead of UTC, which broke the expense-trend chart
  // entirely (every day's date fell in the wrong month and never matched
  // a logged expense) and shifted every "this/last month" boundary by a
  // day besides.
  return { start: toLocalIsoDate(start), end: toLocalIsoDate(end) };
}

function getBudgetLimits(userId: string): Map<string, number> {
  const rows = db.prepare('SELECT category, monthly_limit FROM budget_categories WHERE user_id = ?')
    .all(userId) as { category: string; monthly_limit: number }[];
  return new Map(rows.map((r) => [r.category, r.monthly_limit]));
}

function getCategorySpendMap(userId: string, start: string, end: string): Map<string, number> {
  const rows = db.prepare(
    'SELECT category, SUM(amount) as total FROM expenses WHERE user_id = ? AND spent_on BETWEEN ? AND ? GROUP BY category'
  ).all(userId, start, end) as { category: string; total: number }[];
  return new Map(rows.map((r) => [r.category, r.total]));
}

/** Union of every category that has either a limit or any logged spend —
 * a category with neither simply never appears, same reasoning as only
 * showing hospitals/doctors that actually matched a search. */
function buildCategoryStatuses(limits: Map<string, number>, spend: Map<string, number>): CategoryStatus[] {
  const categories = new Set([...limits.keys(), ...spend.keys()]);
  return [...categories].map((category) => ({ category, spent: spend.get(category) || 0, limit: limits.get(category) }));
}

function getMonthlyIncome(userId: string): number | undefined {
  const row = db.prepare('SELECT monthly_income FROM finance_profile WHERE user_id = ?').get(userId) as FinanceProfileRow | undefined;
  return row?.monthly_income ?? undefined;
}

/** The monthly expense figure every planning calculation (portfolio,
 * goals analysis) is built on: budget limits where the user has set them
 * (their stated intent for the month), else actual logged spend this
 * month (the only other honest number available) — never a mix of the
 * two, and the caller is always told which source was used so the number
 * on screen never looks more authoritative than it is. */
function getPlanningExpenses(userId: string): { total: number; source: 'budget' | 'actual'; categories: CategoryStatus[] } {
  const limits = getBudgetLimits(userId);
  const { start, end } = monthRange('this_month');
  const spend = getCategorySpendMap(userId, start, end);
  const categories = buildCategoryStatuses(limits, spend);
  if (limits.size > 0) {
    return { total: [...limits.values()].reduce((s, v) => s + v, 0), source: 'budget', categories };
  }
  return { total: [...spend.values()].reduce((s, v) => s + v, 0), source: 'actual', categories };
}

/** Same fix as finance.ts's toLocalIsoDate — a locally-constructed Date
 * rolls back a day through toISOString() in any timezone ahead of UTC. */
function toLocalIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Abbreviates a rupee amount for a chart label ("₹8,000" -> "₹8k",
 * "₹1,50,000" -> "₹1.5L") — inr()'s full format is right for a stat line
 * but too wide to sit under a bar in a 6-bar chart. */
function shortInr(n: number): string {
  if (n >= 100000) return `₹${(n / 100000).toFixed(n % 100000 === 0 ? 0 : 1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return `₹${Math.round(n)}`;
}

/** Total spend per calendar month, the last 6 months including the
 * current one — the expenses half of getCashFlowTrend's income-vs-
 * expenses series, a month-over-month comparison (as opposed to a single
 * month's daily pace, which doesn't answer "am I spending more than
 * usual"). Zero-filled for any month with nothing logged, same reasoning
 * as every other "don't just omit gaps" series in this file. */
function getMonthlyExpenseHistory(userId: string): { label: string; value: number; amountLabel: string }[] {
  const now = new Date();
  const months: { year: number; month: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() });
  }
  const rangeStart = toLocalIsoDate(new Date(months[0].year, months[0].month, 1));
  const rangeEnd = toLocalIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  const rows = db.prepare(
    "SELECT strftime('%Y-%m', spent_on) as ym, SUM(amount) as total FROM expenses WHERE user_id = ? AND spent_on BETWEEN ? AND ? GROUP BY ym"
  ).all(userId, rangeStart, rangeEnd) as { ym: string; total: number }[];
  const byMonth = new Map(rows.map((r) => [r.ym, r.total]));

  return months.map(({ year, month }) => {
    const ym = `${year}-${String(month + 1).padStart(2, '0')}`;
    const value = byMonth.get(ym) || 0;
    return { label: SHORT_MONTHS[month], value, amountLabel: shortInr(value) };
  });
}

function monthsUntil(targetDate: string): number {
  const now = new Date();
  const target = new Date(targetDate);
  const months = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
  return Math.max(1, months);
}

/** Turns a plain GoalSummary into the feasibility-math shape the analysis
 * surface renders — null monthsRemaining/requiredMonthly for a goal with
 * no target date (nothing to divide by; it stays progress-only). */
function buildGoalPlanItem(g: GoalSummary, assumedTimeline = false): GoalPlanItem {
  const remaining = Math.max(0, g.targetAmount - g.savedAmount);
  if (!g.targetDate) return { ...g, remaining, monthsRemaining: null, requiredMonthly: null, assumedTimeline };
  const monthsRemaining = monthsUntil(g.targetDate);
  return { ...g, remaining, monthsRemaining, requiredMonthly: remaining / monthsRemaining, assumedTimeline };
}

// Categories suggested for cuts first, roughly most- to least-discretionary
// — never Rent/Health/Education/Savings, which aren't the kind of spend a
// budgeting tool should casually suggest trimming.
const DISCRETIONARY_PRIORITY = ['Entertainment', 'Shopping', 'Other', 'Food', 'Transport', 'Bills & Utilities'] as const;

/** When goals don't jointly fit inside disposable income, suggest which
 * categories to trim and by how much — never applied automatically, only
 * ever a suggestion the user can act on themselves. Spreads the shortfall
 * across categories (at most 40% of any one category's current spend) so
 * no single suggestion looks absurd. Reads whichever field getPlanningExpenses
 * actually used as the expense baseline — budget limit when the user has
 * set one (there's usually no logged spend yet to read instead), else
 * actual spend — so a suggested cut is never measured against a number
 * of 0 just because the OTHER field happened to be empty. */
function suggestCuts(categories: CategoryStatus[], expenseSource: 'budget' | 'actual', shortfall: number): { category: string; cutBy: number }[] {
  const suggestions: { category: string; cutBy: number }[] = [];
  let remaining = shortfall;
  for (const cat of DISCRETIONARY_PRIORITY) {
    if (remaining <= 0) break;
    const status = categories.find((c) => c.category === cat);
    const available = (expenseSource === 'budget' ? status?.limit : status?.spent) || 0;
    if (available <= 0) continue;
    const cut = Math.min(remaining, Math.round(available * 0.4));
    if (cut > 0) { suggestions.push({ category: cat, cutBy: cut }); remaining -= cut; }
  }
  return suggestions;
}

/** The alternative to cutting expenses: keep spending as-is and instead
 * push each goal's date out — disposable income split across goals in
 * proportion to how much each currently needs per month, so a goal
 * needing more gets a proportionally bigger share rather than an even
 * split that would starve the largest goal. */
function suggestExtensions(disposable: number, items: GoalPlanItem[]): { name: string; newMonths: number; newDate: string }[] {
  const dated = items.filter((g) => g.requiredMonthly !== null && g.remaining > 0);
  const totalRequired = dated.reduce((s, g) => s + (g.requiredMonthly || 0), 0);
  if (totalRequired <= 0 || disposable <= 0) return [];
  return dated
    .map((g) => {
      const share = disposable * ((g.requiredMonthly || 0) / totalRequired);
      const newMonths = share > 0 ? Math.ceil(g.remaining / share) : Infinity;
      if (!Number.isFinite(newMonths)) return null;
      const d = new Date();
      d.setMonth(d.getMonth() + newMonths);
      return { name: g.name, newMonths, newDate: toLocalIsoDate(d) };
    })
    .filter((e): e is { name: string; newMonths: number; newDate: string } => e !== null);
}

const MOCK_INCOME = 75000;
const MOCK_BUDGET: Record<string, number> = {
  Rent: 20000, Food: 8000, Transport: 4000, 'Bills & Utilities': 3000,
  Shopping: 5000, Entertainment: 4000, Health: 2000, Savings: 10000,
};
// Itemized, varied entries for the current month — so "recent expenses"
// shows plausible individual transactions rather than one suspiciously
// round lump sum per category.
const MOCK_CURRENT_MONTH_EXPENSES: { category: string; amount: number; note: string }[] = [
  { category: 'Rent', amount: 20000, note: 'Monthly rent' },
  { category: 'Food', amount: 450, note: 'Breakfast run' },
  { category: 'Food', amount: 1200, note: 'Groceries' },
  { category: 'Food', amount: 800, note: 'Dinner out' },
  { category: 'Transport', amount: 300, note: 'Cab rides' },
  { category: 'Transport', amount: 250, note: 'Fuel' },
  { category: 'Bills & Utilities', amount: 1800, note: 'Electricity bill' },
  { category: 'Shopping', amount: 2200, note: 'New clothes' },
  { category: 'Entertainment', amount: 600, note: 'Movie night' },
  { category: 'Health', amount: 500, note: 'Pharmacy' },
  { category: 'Savings', amount: 5000, note: 'SIP investment' },
];
// One lump entry per category for each of the 5 months before this one —
// enough for the trend/history charts to show real shape without needing
// dozens of hand-written rows; a true multiplier per month so the bars
// aren't all identical.
const MOCK_PAST_MONTH_MULTIPLIERS = [0.92, 1.08, 0.85, 1.15, 0.95];
const MOCK_GOALS: { name: string; targetAmount: number; savedAmount: number; monthsFromNow: number | null }[] = [
  { name: 'New Laptop', targetAmount: 60000, savedAmount: 60000, monthsFromNow: null }, // already reached
  { name: 'Goa Trip', targetAmount: 80000, savedAmount: 32000, monthsFromNow: 5 },
  { name: 'Emergency Fund', targetAmount: 150000, savedAmount: 20000, monthsFromNow: 10 },
];

/** Seeds a believable starting finance picture — income, a full budget,
 * six months of expense history, and three goals at different stages —
 * so the dashboard has something to show instead of a wall of empty-state
 * hints. Runs only when ALL FOUR finance tables are empty for this user;
 * anything they've actually typed (a real income figure, a real expense,
 * even just one) makes this permanently a no-op, since the very next
 * write upserts on top of whatever's there via the existing ON CONFLICT
 * logic — mock data is a starting point, never something that overwrites
 * or mixes with real numbers once they exist. */
/** Fills in whatever's missing, piece by piece, rather than an all-or-
 * nothing check — an account that already has a real income and 2-3
 * hand-typed budget categories (but has never logged an actual expense,
 * so every chart on the dashboard reads flat/empty) is exactly as much
 * "needs seeding" as a brand-new signup, just for different pieces. Never
 * overwrites anything real: income only fills if genuinely unset,
 * categories are added only where the user hasn't already named that
 * exact category, expense history only backfills when there's zero
 * logged spend at all, goals only seed a starter set when there are none. */
function ensureFinanceSeed(userId: string) {
  const now = new Date().toISOString();

  const profile = db.prepare('SELECT monthly_income FROM finance_profile WHERE user_id = ?').get(userId) as { monthly_income: number | null } | undefined;
  if (!profile || profile.monthly_income === null || profile.monthly_income === undefined) {
    db.prepare(`
      INSERT INTO finance_profile (user_id, monthly_income, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET monthly_income = excluded.monthly_income, updated_at = excluded.updated_at
    `).run(userId, MOCK_INCOME, now);
  }

  const existingCategories = new Set(
    (db.prepare('SELECT category FROM budget_categories WHERE user_id = ?').all(userId) as { category: string }[]).map((r) => r.category)
  );
  for (const [category, limit] of Object.entries(MOCK_BUDGET)) {
    if (existingCategories.has(category)) continue;
    db.prepare('INSERT INTO budget_categories (id, user_id, category, monthly_limit, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(newId(), userId, category, limit, now);
  }

  const hasExpenses = db.prepare('SELECT 1 FROM expenses WHERE user_id = ?').get(userId);
  if (!hasExpenses) {
    for (const e of MOCK_CURRENT_MONTH_EXPENSES) {
      db.prepare('INSERT INTO expenses (id, user_id, category, amount, note, spent_on, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(newId(), userId, e.category, e.amount, e.note, todayIso(), now);
    }
    const today = new Date();
    MOCK_PAST_MONTH_MULTIPLIERS.forEach((mult, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - (i + 1), 15);
      const spentOn = toLocalIsoDate(d);
      for (const [category, limit] of Object.entries(MOCK_BUDGET)) {
        db.prepare('INSERT INTO expenses (id, user_id, category, amount, note, spent_on, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(newId(), userId, category, Math.round(limit * mult), null, spentOn, now);
      }
    });
  }

  const hasGoals = db.prepare('SELECT 1 FROM savings_goals WHERE user_id = ?').get(userId);
  if (!hasGoals) {
    for (const g of MOCK_GOALS) {
      const targetDate = g.monthsFromNow !== null
        ? (() => { const d = new Date(); d.setMonth(d.getMonth() + g.monthsFromNow!); return toLocalIsoDate(d); })()
        : null;
      db.prepare('INSERT INTO savings_goals (id, user_id, name, target_amount, target_date, saved_amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(newId(), userId, g.name, g.targetAmount, targetDate, g.savedAmount, now);
    }
  }
}

/** Current income (the only figure this app tracks — no historical
 * snapshots) paired with real per-month expense totals, the last 6
 * months — feeds the "Income vs Expenses" cash-flow area chart. */
function getCashFlowTrend(userId: string): CashFlowPoint[] {
  const income = getMonthlyIncome(userId) ?? 0;
  return getMonthlyExpenseHistory(userId).map((m) => ({ label: m.label, income, expenses: m.value }));
}

/** Share of this month's total budget LIMIT actually spent — always real
 * spend against a real limit (unlike getPlanningExpenses, which falls
 * back to spend-as-baseline when no limit exists; a "% used" gauge has
 * nothing to mean without an actual limit to measure against). */
function getBudgetUtilization(userId: string): { pct: number; spent: number; limit: number } {
  const limits = getBudgetLimits(userId);
  const limit = [...limits.values()].reduce((s, v) => s + v, 0);
  if (limit <= 0) return { pct: 0, spent: 0, limit: 0 };
  const { start, end } = monthRange('this_month');
  const spend = getCategorySpendMap(userId, start, end);
  const spent = [...spend.values()].reduce((s, v) => s + v, 0);
  return { pct: Math.round((spent / limit) * 100), spent, limit };
}

/** Most recently logged expenses, newest first — for the standalone
 * "recent expenses" widget and the portfolio dashboard's transaction list. */
function getRecentExpenses(userId: string, limit = 8): RecentExpenseRow[] {
  const rows = db.prepare(
    'SELECT category, amount, note, spent_on FROM expenses WHERE user_id = ? ORDER BY spent_on DESC, created_at DESC LIMIT ?'
  ).all(userId, limit) as { category: string; amount: number; note: string | null; spent_on: string }[];
  return rows.map((r) => ({ category: r.category, amount: r.amount, note: r.note, date: r.spent_on }));
}

/** Everything /api/plan needs to do for a chat-typed finance message —
 * unlike every other domain here, this one both reads AND writes on every
 * call (setting a budget, logging a spend, updating a goal are all direct
 * database writes, not just a lookup) — safe to do synchronously since
 * better-sqlite3 is sync, same as confirmAppointment's insert. */
function handleFinanceQuery(query: FinanceQuery, user: AuthUser | undefined) {
  const session = createSession();

  if (query.kind === 'unsupported') {
    const advice = query.action === 'give investment advice' ? ' For investment decisions, please consult a licensed financial advisor.' : '';
    return {
      sessionId: session.id,
      intent: {
        intent: 'refine', destination: '', agents: [],
        summary: `I can't ${query.action} yet — this agent only tracks the budgets, expenses, and savings goals you describe here.${advice}`,
      },
    };
  }
  if (query.kind === 'unclear') {
    return {
      sessionId: session.id,
      intent: {
        intent: 'refine', destination: '', agents: [],
        summary: 'I can help with budgets, expenses, and savings goals — try describing your income and expenses, '
          + 'logging a spend ("spent 500 on groceries"), or setting a goal ("save 50000 for a laptop by December").',
      },
    };
  }
  if (!user) {
    session.pendingFinance = { kind: 'signin' };
    return {
      sessionId: session.id,
      intent: { intent: 'refine', destination: '', agents: [], summary: "Sign in from the sidebar to start tracking your budget — then tell me again." },
    };
  }
  ensureFinanceSeed(user.id);

  if (query.kind === 'set_budget') {
    if (query.income !== undefined) {
      db.prepare(`
        INSERT INTO finance_profile (user_id, monthly_income, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET monthly_income = excluded.monthly_income, updated_at = excluded.updated_at
      `).run(user.id, query.income, new Date().toISOString());
    }
    for (const a of query.allocations) {
      db.prepare(`
        INSERT INTO budget_categories (id, user_id, category, monthly_limit, created_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, category) DO UPDATE SET monthly_limit = excluded.monthly_limit
      `).run(newId(), user.id, a.category, a.amount, new Date().toISOString());
    }

    const income = getMonthlyIncome(user.id);
    const limits = getBudgetLimits(user.id);
    const { start, end } = monthRange('this_month');
    const categories = buildCategoryStatuses(limits, getCategorySpendMap(user.id, start, end));
    const allocatedTotal = [...limits.values()].reduce((s, v) => s + v, 0);
    session.pendingFinance = { kind: 'budget', income, categories, allocatedTotal };

    const parts: string[] = [];
    if (query.income !== undefined) parts.push(`income set to ${inr(query.income)}`);
    if (query.allocations.length) parts.push(`${query.allocations.length} categor${query.allocations.length === 1 ? 'y' : 'ies'} updated`);
    return { sessionId: session.id, intent: { intent: 'refine', destination: '', agents: [], summary: `Got it — ${parts.join(' and ')}. Here's your budget:` } };
  }

  if (query.kind === 'log_expense') {
    db.prepare('INSERT INTO expenses (id, user_id, category, amount, note, spent_on, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newId(), user.id, query.category, query.amount, query.note || null, todayIso(), new Date().toISOString());

    const limits = getBudgetLimits(user.id);
    const { start, end } = monthRange('this_month');
    const spend = getCategorySpendMap(user.id, start, end);
    const status: CategoryStatus = { category: query.category, spent: spend.get(query.category) || 0, limit: limits.get(query.category) };
    session.pendingFinance = { kind: 'expense_logged', amount: query.amount, category: query.category, note: query.note, categoryStatus: status };
    return { sessionId: session.id, intent: { intent: 'refine', destination: '', agents: [], summary: `Logged ${inr(query.amount)} under ${query.category}.` } };
  }

  if (query.kind === 'set_goal') {
    const existing = db.prepare('SELECT * FROM savings_goals WHERE user_id = ? AND name = ?').get(user.id, query.name) as SavingsGoalRow | undefined;
    db.prepare(`
      INSERT INTO savings_goals (id, user_id, name, target_amount, target_date, saved_amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, name) DO UPDATE SET target_amount = excluded.target_amount, target_date = excluded.target_date
    `).run(newId(), user.id, query.name, query.targetAmount, query.targetDate || null, existing?.saved_amount || 0, new Date().toISOString());

    const goal: GoalSummary = { name: query.name, targetAmount: query.targetAmount, savedAmount: existing?.saved_amount || 0, targetDate: query.targetDate || null };
    session.pendingFinance = { kind: 'goal', goal };
    const byPhrase = query.targetDate ? ` by ${formatAppointmentDate(query.targetDate)}` : '';
    return { sessionId: session.id, intent: { intent: 'refine', destination: '', agents: [], summary: `New goal set — ${inr(query.targetAmount)} for ${query.name}${byPhrase}.` } };
  }

  if (query.kind === 'contribute_goal') {
    const goals = db.prepare('SELECT * FROM savings_goals WHERE user_id = ?').all(user.id) as SavingsGoalRow[];
    let target: SavingsGoalRow | undefined;
    if (query.name) {
      const q = query.name.toLowerCase();
      target = goals.find((g) => g.name.toLowerCase().includes(q) || q.includes(g.name.toLowerCase()));
    } else if (goals.length === 1) {
      target = goals[0];
    }
    if (!target) {
      const summary = goals.length === 0
        ? 'You don\'t have any savings goals yet — try "save 50000 for a laptop" first.'
        : `Which goal do you mean? You have: ${goals.map((g) => g.name).join(', ')}.`;
      return { sessionId: session.id, intent: { intent: 'refine', destination: '', agents: [], summary } };
    }

    const newSaved = target.saved_amount + query.amount;
    db.prepare('UPDATE savings_goals SET saved_amount = ? WHERE id = ?').run(newSaved, target.id);
    const goal: GoalSummary = { name: target.name, targetAmount: target.target_amount, savedAmount: newSaved, targetDate: target.target_date };
    session.pendingFinance = { kind: 'goal', goal };
    return {
      sessionId: session.id,
      intent: { intent: 'refine', destination: '', agents: [], summary: `Added ${inr(query.amount)} to ${target.name} — ${inr(newSaved)} of ${inr(target.target_amount)} so far.` },
    };
  }

  if (query.kind === 'list_goals') {
    const goals = db.prepare('SELECT * FROM savings_goals WHERE user_id = ? ORDER BY created_at DESC').all(user.id) as SavingsGoalRow[];
    const summaries: GoalSummary[] = goals.map((g) => ({ name: g.name, targetAmount: g.target_amount, savedAmount: g.saved_amount, targetDate: g.target_date }));
    session.pendingFinance = { kind: 'goals_list', goals: summaries };
    return {
      sessionId: session.id,
      intent: { intent: 'refine', destination: '', agents: [], summary: summaries.length ? 'Here are your savings goals:' : 'You don\'t have any savings goals yet — try "save 50000 for a laptop".' },
    };
  }

  if (query.kind === 'portfolio') {
    const income = getMonthlyIncome(user.id);
    const { total: expenseTotal, source: expenseSource, categories } = getPlanningExpenses(user.id);
    const goalRows = db.prepare('SELECT * FROM savings_goals WHERE user_id = ? ORDER BY created_at DESC').all(user.id) as SavingsGoalRow[];
    const goals: GoalSummary[] = goalRows.map((g) => ({ name: g.name, targetAmount: g.target_amount, savedAmount: g.saved_amount, targetDate: g.target_date }));
    const savingsRate = income !== undefined && income > 0 ? Math.max(0, Math.round(((income - expenseTotal) / income) * 100)) : undefined;
    const cashFlow = getCashFlowTrend(user.id);
    const recentExpenses = getRecentExpenses(user.id, 6);

    session.pendingFinance = {
      kind: 'portfolio', income, expenseTotal, expenseSource, categories, goals, savingsRate,
      cashFlow, recentExpenses,
    };
    const summary = income !== undefined
      ? `Here's your portfolio — ${inr(income)} income vs ${inr(expenseTotal)} in ${expenseSource === 'budget' ? 'budgeted' : 'logged'} expenses.`
      : `Here's your portfolio so far, based on ${inr(expenseTotal)} logged this month — tell me your monthly income too for the full picture.`;
    return { sessionId: session.id, intent: { intent: 'refine', destination: '', agents: [], summary } };
  }

  if (query.kind === 'expenses_breakdown') {
    const { source: expenseSource, categories } = getPlanningExpenses(user.id);
    session.pendingFinance = { kind: 'expenses_breakdown', categories, expenseSource };
    const hasAny = categories.some((c) => c.spent > 0) || categories.some((c) => c.limit);
    return {
      sessionId: session.id,
      intent: {
        intent: 'refine', destination: '', agents: [],
        summary: hasAny ? "Here's your expenses breakdown:" : "You don't have any budget or spending logged yet — tell me your income and expenses first.",
      },
    };
  }

  if (query.kind === 'cash_flow') {
    const cashFlow = getCashFlowTrend(user.id);
    session.pendingFinance = { kind: 'cash_flow', cashFlow };
    const hasAny = cashFlow.some((c) => c.income > 0 || c.expenses > 0);
    return {
      sessionId: session.id,
      intent: {
        intent: 'refine', destination: '', agents: [],
        summary: hasAny ? "Here's your income vs expenses trend:" : "I don't have enough history yet — tell me your income and log a few expenses first.",
      },
    };
  }

  if (query.kind === 'budget_utilization') {
    const { pct, spent, limit } = getBudgetUtilization(user.id);
    session.pendingFinance = { kind: 'budget_utilization', pct, spent, limit };
    const summary = limit > 0
      ? `You've used ${pct}% of your ${inr(limit)} budget this month (${inr(spent)} spent).`
      : "You haven't set a budget yet — tell me your income and expenses first (e.g. \"I earn 70000, 20000 rent, 8000 groceries\").";
    return { sessionId: session.id, intent: { intent: 'refine', destination: '', agents: [], summary } };
  }

  if (query.kind === 'recent_expenses') {
    const expenses = getRecentExpenses(user.id, 8);
    session.pendingFinance = { kind: 'recent_expenses', expenses };
    return {
      sessionId: session.id,
      intent: {
        intent: 'refine', destination: '', agents: [],
        summary: expenses.length ? 'Here are your most recent expenses:' : "You haven't logged any expenses yet — try \"spent 500 on groceries\".",
      },
    };
  }

  if (query.kind === 'goals_analysis') {
    const income = getMonthlyIncome(user.id);
    const { total: expenseTotal, source: expenseSource, categories } = getPlanningExpenses(user.id);
    const disposable = income !== undefined ? income - expenseTotal : undefined;
    const savedGoals = db.prepare('SELECT * FROM savings_goals WHERE user_id = ?').all(user.id) as SavingsGoalRow[];

    let items: GoalPlanItem[] = [];
    let singleGoalName: string | undefined;
    let notFoundName: string | undefined;

    if (query.goalName) {
      const q = query.goalName.toLowerCase();
      const match = savedGoals.find((g) => g.name.toLowerCase().includes(q) || q.includes(g.name.toLowerCase()));
      if (match) {
        items = [buildGoalPlanItem({ name: match.name, targetAmount: match.target_amount, savedAmount: match.saved_amount, targetDate: match.target_date })];
        singleGoalName = match.name;
      } else if (query.adHocAmount !== undefined) {
        const assumedTimeline = !query.adHocTargetDate;
        const targetDate = query.adHocTargetDate || (() => { const d = new Date(); d.setMonth(d.getMonth() + 12); return toLocalIsoDate(d); })();
        items = [buildGoalPlanItem({ name: query.goalName, targetAmount: query.adHocAmount, savedAmount: 0, targetDate }, assumedTimeline)];
        singleGoalName = query.goalName;
      } else {
        notFoundName = query.goalName;
      }
    } else {
      items = savedGoals.map((g) => buildGoalPlanItem({ name: g.name, targetAmount: g.target_amount, savedAmount: g.saved_amount, targetDate: g.target_date }));
    }

    const totalRequired = items.reduce((s, g) => s + (g.requiredMonthly || 0), 0);
    const hasDatedGoal = items.some((g) => g.requiredMonthly !== null);
    const feasible = disposable !== undefined && hasDatedGoal ? totalRequired <= disposable : undefined;
    const shortfall = feasible === false && disposable !== undefined ? Math.round(totalRequired - disposable) : undefined;
    const surplus = feasible === true && disposable !== undefined ? Math.round(disposable - totalRequired) : undefined;
    const cuts = shortfall !== undefined ? suggestCuts(categories, expenseSource, shortfall) : undefined;
    const extensions = shortfall !== undefined && disposable !== undefined ? suggestExtensions(disposable, items) : undefined;

    session.pendingFinance = {
      kind: 'goals_analysis', income, expenseTotal, expenseSource, disposable,
      goals: items, totalRequired, feasible, shortfall, surplus, cuts, extensions, singleGoalName, notFoundName,
    };

    let summary: string;
    if (notFoundName) {
      summary = `You don't have a goal called "${notFoundName}" yet — try "save 50000 for ${notFoundName} by December" to set one.`;
    } else if (items.length === 0) {
      summary = 'You don\'t have any savings goals yet — try "save 50000 for a laptop by December".';
    } else if (income === undefined) {
      summary = "Here's your goals analysis — tell me your monthly income too so I can check if it's achievable.";
    } else if (feasible === false) {
      summary = `You're short by ${inr(shortfall || 0)}/month to hit ${items.length > 1 ? 'all your goals' : 'this goal'} on time — here's how to close the gap:`;
    } else if (feasible === true) {
      summary = `Good news — saving ${inr(totalRequired)}/month covers ${items.length > 1 ? 'all your goals' : 'this goal'}, leaving ${inr(surplus || 0)} spare.`;
    } else {
      summary = 'Set a target date on your goal(s) so I can calculate a monthly figure.';
    }
    return { sessionId: session.id, intent: { intent: 'refine', destination: '', agents: [], summary } };
  }

  // query.kind === 'summary'
  const { start, end } = query.period === 'all' ? { start: '0000-01-01', end: '9999-12-31' } : monthRange(query.period);
  const limits = getBudgetLimits(user.id);
  let categories = buildCategoryStatuses(limits, getCategorySpendMap(user.id, start, end));
  if (query.category) categories = categories.filter((c) => c.category === query.category);
  const totalSpent = categories.reduce((s, c) => s + c.spent, 0);
  const income = getMonthlyIncome(user.id);
  const periodPhrase = query.period === 'this_month' ? 'this month' : query.period === 'last_month' ? 'last month' : 'in total';
  const periodLabel = query.period === 'last_month' ? 'Last Month' : query.period === 'all' ? 'All-Time Spending' : 'This Month';

  let compare: { current: number; previous: number } | undefined;
  if (query.question === 'compare') {
    const last = monthRange('last_month');
    const lastTotal = [...getCategorySpendMap(user.id, last.start, last.end).values()].reduce((s, v) => s + v, 0);
    compare = { current: totalSpent, previous: lastTotal };
  }

  session.pendingFinance = { kind: 'summary', periodLabel, categories, totalSpent, income, compare };

  let summary: string;
  if (categories.length === 0) {
    summary = query.category ? `You haven't logged any ${query.category} spending ${periodPhrase}.` : `You haven't logged any spending ${periodPhrase}.`;
  } else if (query.question === 'biggest') {
    const top = [...categories].sort((a, b) => b.spent - a.spent)[0];
    summary = `Your biggest expense ${periodPhrase} is ${top.category} (${inr(top.spent)}).`;
  } else if (query.question === 'remaining' && query.category) {
    const cat = categories[0];
    summary = cat?.limit !== undefined
      ? `You've spent ${inr(cat.spent)} of your ${inr(cat.limit)} ${query.category} budget — ${inr(Math.max(0, cat.limit - cat.spent))} left.`
      : `You haven't set a budget limit for ${query.category} yet.`;
  } else if (query.question === 'remaining') {
    if (income !== undefined) {
      const remaining = income - totalSpent;
      summary = remaining >= 0
        ? `You have ${inr(remaining)} left ${periodPhrase} out of ${inr(income)}.`
        : `You're ${inr(Math.abs(remaining))} over your ${inr(income)} income ${periodPhrase}.`;
    } else {
      summary = 'Tell me your monthly income (e.g. "I earn 60000 a month") so I can tell you what\'s left.';
    }
  } else if (query.question === 'compare' && compare) {
    const diff = compare.current - compare.previous;
    summary = `You've spent ${inr(compare.current)} this month vs ${inr(compare.previous)} last month`
      + (diff === 0 ? ' — about the same.' : diff > 0 ? `, ${inr(diff)} more.` : `, ${inr(Math.abs(diff))} less.`);
  } else if (query.category) {
    summary = `You've spent ${inr(totalSpent)} on ${query.category} ${periodPhrase}.`;
  } else {
    summary = `You've spent ${inr(totalSpent)} ${periodPhrase}.`;
  }

  return { sessionId: session.id, intent: { intent: 'refine', destination: '', agents: [], summary } };
}

function runAgents(sessionId: string, intent: ParsedIntent) {
  const session = getSession(sessionId);
  if (!session) return;

  // A "give me the details of X hotel" / "View rooms at X" query that matched
  // an already-known hotel — go straight to its rooms instead of running a
  // fresh search. No "← Back to hotels" button: this is its own chat turn,
  // and the session only holds this one hotel, so there's no list to return
  // to (that button's backToHotels would rebuild a one-item list).
  if (session.directHotel) {
    session.activeHotelId = session.directHotel.id;
    session.hotelsCache = new Map([[session.directHotel.id, session.directHotel]]);
    emitAll(sessionId, roomsSurface('hotels', session.directHotel, undefined, undefined, false));
    return;
  }

  const departureDate = intent.checkIn || todayIso();

  // Each agent's surface only appears once its data is ready — live Groq
  // output, with mock only as a last-resort fallback on genuine failure.
  // Nothing is emitted early, so there's no mock data to flash before the
  // real result lands; the frontend shows its own "Thinking…" skeleton in
  // the gap.
  if (intent.agents.includes('flights') && intent.origin) {
    getFlightOptions(intent.origin, intent.destination, departureDate).then(({ flights, source }) => {
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
    getHotelOptions(intent.destination).then(({ hotels, source }) => {
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

  // find_doctor: pure matching against the curated dataset, no LLM call and
  // no async wait — emitted synchronously, unlike flights/hotels/destinations
  // above, since there's no live generation step to wait on.
  if (intent.agents.includes('health')) {
    const matches = getDoctorMatches(intent.specialty, intent.ageGroup);
    session.doctorsCache = new Map(matches.map((d) => [d.id, d]));
    session.symptom = intent.symptom;
    emitAll(sessionId, doctorsSurface('health', normalizeSpecialty(intent.specialty), matches));
  }
}

app.post<{ Body: ActionPayload & { sessionId: string } }>('/api/action', { preHandler: optionalAuth }, async (req, reply) => {
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

  // viewDoctorProfile/startDoctorBooking and backToDoctors are no longer
  // handled here — App.tsx intercepts the first two client-side and
  // synthesizes a genuinely new chat turn instead (see detectDoctorLookup
  // in agents/health.ts), and there's no "back" button left to fire the
  // third (see doctorProfileSurface's own comment on why).

  if (name === 'confirmAppointment') {
    const doctor = session.activeDoctorId ? (session.doctorsCache.get(session.activeDoctorId) as DoctorMatch | undefined) : undefined;
    const patientName = String(context.patientName || '').trim();
    const patientPhone = String(context.patientPhone || '').trim();
    const preferredDate = String(context.preferredDate || '').trim();
    const preferredTime = String(context.preferredTime || '').trim();
    if (doctor && patientName && patientPhone && preferredDate && preferredTime) {
      const appointmentRef = `APT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      db.prepare(`
        INSERT INTO appointments (
          id, user_id, doctor_id, doctor_name, hospital_name, patient_name, patient_age,
          patient_gender, patient_phone, patient_email, reason, preferred_date, preferred_time,
          appointment_ref, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newId(), req.user?.id ?? null, doctor.id, doctor.name, doctor.hospital.name, patientName,
        String(context.patientAge || '') || null, String(context.patientGender || '') || null,
        patientPhone, String(context.patientEmail || '') || null, String(context.reason || '') || null,
        preferredDate, preferredTime, appointmentRef, new Date().toISOString()
      );
      emitAll(sessionId, appointmentConfirmationSurface(
        'health', doctor, doctor.hospital, patientName, preferredDate, preferredTime, appointmentRef
      ));
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

app.get<{ Querystring: { filter?: 'upcoming' | 'past' | 'all' } }>('/api/appointments', { preHandler: requireAuth }, async (req) => {
  const filter = req.query.filter || 'all';
  return queryUserAppointments(req.user!.id, filter);
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
});
