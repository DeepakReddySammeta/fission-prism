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
}

const sessions = new Map<string, Session>();

export function createSession(): Session {
  const id = randomUUID();
  const session: Session = {
    id, trip: { destination: '' }, subscribers: new Set(),
    hotelsCache: new Map(), flightsCache: new Map(),
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
