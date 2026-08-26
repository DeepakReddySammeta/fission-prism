import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { JWT_SECRET } from '../config';
import { db, type UserRow } from '../db';

export interface AuthUser {
  id: string;
  email: string | null;
}

export const newId = () => randomUUID();

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export function toAuthUser(row: UserRow): AuthUser {
  return { id: row.id, email: row.email };
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/** Fastify preHandler: reads `Authorization: Bearer <jwt>`, attaches the
 * resolved user to the request, or short-circuits with 401. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) return reply.code(401).send({ error: 'not authenticated' });

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string };
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub) as UserRow | undefined;
    if (!row) return reply.code(401).send({ error: 'not authenticated' });
    req.user = toAuthUser(row);
  } catch {
    return reply.code(401).send({ error: 'invalid or expired token' });
  }
}

/** Same as requireAuth but never rejects — attaches req.user when a valid
 * token is present, otherwise leaves it undefined. For routes like
 * /api/plan that work fine for a signed-out guest (mock/live planning) but
 * need to know who's asking for the one case that doesn't: a chat-typed
 * "my plans"/"my bookings" query. */
export async function optionalAuth(req: FastifyRequest) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) return;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string };
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub) as UserRow | undefined;
    if (row) req.user = toAuthUser(row);
  } catch {
    // an invalid/expired token on this route just means "treat as signed out"
  }
}
