import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  A2UI_RATE_LIMIT_WINDOW_MS,
  A2UI_RATE_LIMIT_MAX_REQUESTS,
  A2UI_MAX_PROMPT_LENGTH,
} from '../config';

/* ─── Rate Limiting ─── */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

export async function rateLimitPreHandler(req: FastifyRequest, reply: FastifyReply) {
  const key = req.user?.id || req.ip;
  const now = Date.now();

  let entry = rateLimitStore.get(key);
  if (!entry || now > entry.resetTime) {
    entry = { count: 1, resetTime: now + A2UI_RATE_LIMIT_WINDOW_MS };
    rateLimitStore.set(key, entry);
    return;
  }

  if (entry.count >= A2UI_RATE_LIMIT_MAX_REQUESTS) {
    return reply.code(429).send({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please try again later.',
    });
  }

  entry.count += 1;
}

/* ─── Prompt Size Check ─── */

export async function promptSizePreHandler(req: FastifyRequest, reply: FastifyReply) {
  const query = (req.body as Record<string, unknown> | undefined)?.query;
  const prompt = typeof query === 'string' ? query : '';
  if (prompt.length > A2UI_MAX_PROMPT_LENGTH) {
    return reply.code(400).send({
      error: 'PROMPT_TOO_LARGE',
      message: 'Prompt is too large. Maximum allowed length is 5000 characters.',
      maxLength: A2UI_MAX_PROMPT_LENGTH,
    });
  }
}
