import { randomUUID } from 'node:crypto';
import type { Envelope, HotelOption, TripSummary } from '../types';
import type { FastifyReply } from 'fastify';
import { validateEnvelope } from './trust';

/** A saved plan's list-card shape — the same fields the "My Plans"/"My
 * Bookings" pages already list, reused here so a chat-asked "my plans"
 * renders identically instead of needing its own summary shape. */
export interface PlanRecordSummary {
  id: string;
  title: string;
  destination: string;
  imageUrl: string | null;
  createdAt: string;
  totalPrice?: number;
  bookingRef?: string;
  travelDate: string | null;
}

/** What a chat-asked "my plans/bookings" query should render once the SSE
 * stream connects — set in /api/plan, consumed by runAgents instead of the
 * normal ParsedIntent flights/hotels flow. */
export type PendingMyRecords =
  | { kind: 'signin' }
  | { kind: 'list'; records: PlanRecordSummary[]; recordType: 'plans' | 'bookings'; filter: 'upcoming' | 'past' | 'all' }
  | { kind: 'detail'; record: PlanRecordSummary; trip: TripSummary }
  | { kind: 'not-found'; reference: string };

/** A booked doctor's-appointment row for a chat-asked "my appointments"
 * query — flat, unlike PlanRecordSummary, since an appointment has no
 * further "detail" drill-down worth a separate screen (everything worth
 * showing already fits in one list row). */
export interface AppointmentSummary {
  id: string;
  doctorName: string;
  specialty: string;
  hospitalName: string;
  patientName: string;
  preferredDate: string;
  preferredTime: string;
  appointmentRef: string;
  createdAt: string;
}

/** What a chat-asked "my appointments" query should render once the SSE
 * stream connects — set in /api/plan, consumed the same way pendingMyRecords
 * is. 'unsupported' covers a request this app has no flow for yet (cancel/
 * reschedule) — reported plainly rather than silently showing the list. */
export type PendingAppointments =
  | { kind: 'signin' }
  | { kind: 'list'; appointments: AppointmentSummary[]; filter: 'upcoming' | 'past' | 'today' | 'all'; reference?: string }
  | { kind: 'unsupported'; action: string };

/** One category's spend for a budget breakdown or summary — envelopes.ts
 * computes the bar percentage from spent/limit itself, so this only needs
 * to carry the raw numbers. */
export interface CategoryStatus {
  category: string;
  spent: number;
  limit?: number;
}

export interface GoalSummary {
  name: string;
  targetAmount: number;
  savedAmount: number;
  targetDate: string | null;
}

/** GoalSummary plus the feasibility math for one goal — how much still
 * needs saving, over how many months, and the monthly figure that implies.
 * monthsRemaining/requiredMonthly are null when the goal has no target
 * date (progress-only tracking, nothing to divide by). assumedTimeline
 * marks a goal that had no date at all and was given a default 12-month
 * horizon just to produce a concrete number ("how to achieve my goal to
 * save 1 lakh emergency fund" with no "by" clause). */
export interface GoalPlanItem extends GoalSummary {
  remaining: number;
  monthsRemaining: number | null;
  requiredMonthly: number | null;
  assumedTimeline?: boolean;
}

/** What a chat-typed finance message should render once the SSE stream
 * connects — set in /api/plan, consumed the same way pendingMyRecords/
 * pendingAppointments are. 'unsupported' and 'unclear' both carry
 * everything needed in the intent summary alone. */
export type PendingFinance =
  | { kind: 'signin' }
  | { kind: 'budget'; income?: number; categories: CategoryStatus[]; allocatedTotal: number }
  | { kind: 'expense_logged'; amount: number; category: string; note?: string; categoryStatus: CategoryStatus }
  | { kind: 'goal'; goal: GoalSummary }
  | { kind: 'goals_list'; goals: GoalSummary[] }
  | { kind: 'summary'; periodLabel: string; categories: CategoryStatus[]; totalSpent: number; income?: number; compare?: { current: number; previous: number } }
  | {
      kind: 'portfolio'; income?: number; expenseTotal: number; expenseSource: 'budget' | 'actual';
      categories: CategoryStatus[]; goals: GoalSummary[]; savingsRate?: number;
    }
  | {
      kind: 'goals_analysis'; income?: number; expenseTotal: number; expenseSource: 'budget' | 'actual';
      disposable?: number; goals: GoalPlanItem[]; totalRequired: number; feasible?: boolean;
      shortfall?: number; surplus?: number;
      cuts?: { category: string; cutBy: number }[];
      extensions?: { name: string; newMonths: number; newDate: string }[];
      singleGoalName?: string; notFoundName?: string;
    }
  | { kind: 'unsupported'; action: string }
  | { kind: 'unclear' };

export interface Session {
  id: string;
  trip: TripSummary;
  subscribers: Set<FastifyReply>;
  /** hotel currently being viewed, so selectRoom knows which hotel it belongs to */
  activeHotelId?: string;
  hotelsCache: Map<string, any>;
  flightsCache: Map<string, any>;
  pendingIntent?: unknown;
  started?: boolean;
  /** Set when this session was created from a "give me the details of X
   * hotel" style query that resolved to an already-known hotel — runAgents
   * jumps straight to that hotel's room view instead of running the normal
   * flights/hotels search agents. */
  directHotel?: HotelOption;
  /** Set instead of pendingIntent for a chat-asked "my plans"/"my bookings"
   * query — consumed once, when the SSE stream connects (see
   * emitMyRecords). "View details" on a list row re-asks as a fresh chat
   * turn (see App.tsx's viewRecordDetail interception) rather than mutating
   * this session in place, so nothing further needs to be kept here. */
  pendingMyRecords?: PendingMyRecords;
  /** Set instead of pendingIntent for a chat-asked "best places to visit in
   * X" query — consumed once, when the SSE stream connects (see
   * runExploration in server.ts). Drilling into one suggestion or hitting
   * "Schedule a trip" both re-ask as a fresh chat turn rather than mutating
   * this session, same reasoning as pendingMyRecords above. */
  pendingExploration?: { region: string; season?: string; durationNights?: number };
  /** find_doctor: the matched list from this run, keyed by doctor id, so
   * viewDoctorProfile/confirmAppointment can look one up without re-running
   * the (pure, cheap) match — same shape as hotelsCache/flightsCache. */
  doctorsCache: Map<string, any>;
  /** Doctor currently being viewed, so confirmAppointment knows who the
   * booking is for — mirrors activeHotelId. */
  activeDoctorId?: string;
  /** The original symptom text, carried from intent parsing to pre-fill the
   * appointment form's "reason for visit" once a doctor is opened. */
  symptom?: string;
  /** Set instead of pendingIntent for a "View profile for Dr. X" / "Book an
   * appointment with Dr. X" query — consumed once, when the SSE stream
   * connects (see runDoctorLookup in server.ts). Same reasoning as
   * pendingExploration: a direct lookup, not a search. */
  pendingDoctorLookup?: any;
  /** Set instead of pendingIntent for a "my appointments"/"upcoming
   * appointments"/"appointments with Dr. X" query — consumed once, when the
   * SSE stream connects (see emitAppointments in server.ts). Mirrors
   * pendingMyRecords. */
  pendingAppointments?: PendingAppointments;
  /** Set instead of pendingIntent for any chat-typed finance message ("I
   * earn...", "spent 500 on...", "save for a car", "my spending this
   * month") — consumed once, when the SSE stream connects (see
   * emitFinance in server.ts). Mirrors pendingAppointments. */
  pendingFinance?: PendingFinance;
  /** Which card the lookup should render — the read-only profile, or
   * straight to the booking form — 'book' when the request that led here
   * was booking-flavored ("book an appointment with Dr. X", or a chat
   * query naming a doctor with "book" in it), 'overview' otherwise.
   * Consumed alongside pendingDoctorLookup. */
  pendingDoctorView?: 'overview' | 'book';
  /** Date/time already named in a booking-flavored request ("tomorrow
   * morning"), so the booking form arrives pre-filled instead of blank. */
  pendingDoctorHints?: { preferredDate?: string; preferredTime?: string };
}

const sessions = new Map<string, Session>();

export function createSession(): Session {
  const id = randomUUID();
  const session: Session = {
    id, trip: { destination: '' }, subscribers: new Set(),
    hotelsCache: new Map(), flightsCache: new Map(), doctorsCache: new Map(),
  };
  sessions.set(id, session);
  return session;
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function subscribe(id: string, reply: FastifyReply) {
  const s = sessions.get(id);
  if (!s) return;
  s.subscribers.add(reply);
}

export function unsubscribe(id: string, reply: FastifyReply) {
  const s = sessions.get(id);
  s?.subscribers.delete(reply);
}

/** Validates, then broadcasts an envelope to every SSE client on this session. */
export function emit(id: string, envelope: Envelope) {
  const s = sessions.get(id);
  if (!s) return;
  const check = validateEnvelope(envelope);
  if (!check.ok) {
    console.warn(`[trust] dropped envelope on session ${id}: ${check.reason}`);
    return;
  }
  const frame = `event: a2ui\ndata: ${JSON.stringify(envelope)}\n\n`;
  for (const res of s.subscribers) {
    try { res.raw.write(frame); } catch { s.subscribers.delete(res); }
  }
}

export function emitAll(id: string, envelopes: Envelope[]) {
  for (const e of envelopes) emit(id, e);
}
