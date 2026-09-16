import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db, type UserRow } from '../db';

export interface AuthUser {
  id: string;
  email: string | null;
}

export const newId = () => randomUUID();

export function toAuthUser(row: UserRow): AuthUser {
  return { id: row.id, email: row.email };
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/**
 * Identity now comes from the Fission AI Portal gateway, not from a token this
 * server issues. The gateway validates the caller's Cognito JWT, enforces the
 * application's `usersgroups`, and only then forwards the request with:
 *
 *   X-Gateway-Verified: true
 *   X-User-Id:          <cognito sub>
 *   X-Organization-Id:  <org uuid>
 *
 * SECURITY: these headers are trusted unconditionally, so the backend MUST be
 * reachable only from the gateway. Exposed publicly, anyone can set them by
 * hand and read or write any user's plans, bookings and finance data. Lock the
 * security group / VPC down to the gateway's egress before deploying this.
 */
const GATEWAY_VERIFIED_HEADER = 'x-gateway-verified';
const USER_ID_HEADER = 'x-user-id';
const USER_EMAIL_HEADER = 'x-user-email';

function headerValue(req: FastifyRequest, name: string): string | undefined {
  const raw = req.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() || undefined;
}

/**
 * Resolves the portal user into a local `users` row, creating it on first
 * sight. Every domain table keys off `users.id`, so the Cognito sub becomes
 * the primary key directly — no mapping table, and existing foreign keys keep
 * working untouched.
 */
function provisionUser(userId: string, email: string | null): AuthUser {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;

  if (!existing) {
    // A portal account may reuse an email that a legacy local signup already
    // claimed. `email` is UNIQUE, so inserting it verbatim would throw and
    // lock the user out of an app the portal says they may use; the portal is
    // the source of truth for identity, so release the old row's claim first.
    db.prepare('UPDATE users SET email = NULL WHERE email = ? AND id != ?').run(email, userId);
    db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
      .run(userId, email, new Date().toISOString());
    return { id: userId, email };
  }

  if (email && existing.email !== email) {
    db.prepare('UPDATE users SET email = NULL WHERE email = ? AND id != ?').run(email, userId);
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, userId);
    return { id: userId, email };
  }

  return toAuthUser(existing);
}

function resolveGatewayUser(req: FastifyRequest): AuthUser | null {
  if (headerValue(req, GATEWAY_VERIFIED_HEADER)?.toLowerCase() !== 'true') return null;

  const userId = headerValue(req, USER_ID_HEADER);
  if (!userId) return null;

  return provisionUser(userId, headerValue(req, USER_EMAIL_HEADER) ?? null);
}

/** Fastify preHandler: requires a gateway-authenticated caller, or 401. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const user = resolveGatewayUser(req);
  if (!user) return reply.code(401).send({ error: 'not authenticated' });
  req.user = user;
}

/** Same as requireAuth but never rejects — attaches req.user when the gateway
 * identified the caller, otherwise leaves it undefined. For routes like
 * /api/plan that work fine for a signed-out guest (mock/live planning) but
 * need to know who's asking for the one case that doesn't: a chat-typed
 * "my plans"/"my bookings" query. */
export async function optionalAuth(req: FastifyRequest) {
  const user = resolveGatewayUser(req);
  if (user) req.user = user;
}
