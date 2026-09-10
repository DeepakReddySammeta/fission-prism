import { LLM_ENABLED, LLM_MODEL, LLM_ROUTER_MODEL, LLM_TIMEOUT_SCALE, LLM_PROVIDER, BEDROCK_MODEL, GROQ_MODEL } from '../config';
import { createBedrockBackend } from './bedrock';
import { createGroqBackend } from './groq';
import type { CompleteFn, CompleteOptions } from './types';

// LLM_PROVIDER picks the backend; everything downstream is unchanged by that
// — callers just invoke `backend(instructions, userContent, timeoutMs)`.
const backend: CompleteFn | null = !LLM_ENABLED ? null
  : LLM_PROVIDER === 'bedrock' ? createBedrockBackend(BEDROCK_MODEL)
  : createGroqBackend(GROQ_MODEL);

const missingHint = LLM_PROVIDER === 'bedrock'
  ? 'set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (or AWS_USE_IAM_ROLE=true on AWS) to turn this on'
  : 'set GROQ_API_KEY to turn this on';

let callCount = 0;

/**
 * How long a rate-limited call may wait before its one retry. A 429 tells us
 * exactly when the budget frees up, so retrying instantly (as the previous
 * code did) is a guaranteed second failure — the reason a screen would come
 * back as "couldn't generate" while the data behind it was perfectly fine.
 * Capped so a genuinely exhausted quota fails honestly instead of hanging:
 * the SDK's own blind retries are still off (see groq.ts/bedrock.ts), and
 * this waits only when the provider named a delay we can actually sit out.
 */
const RATE_LIMIT_MAX_WAIT_MS = 20_000;

/** Milliseconds the provider asked us to wait, for a rate-limit error only.
 * Reads Retry-After, falling back to the precise figure Groq puts in the
 * message body when the header has been rounded to whole seconds. */
function retryAfterMs(err: unknown): number | null {
  const e = err as { status?: number; headers?: any; message?: string };
  if (e?.status !== 429) return null;
  const h = e.headers;
  const raw = typeof h?.get === 'function' ? h.get('retry-after') : h?.['retry-after'];
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs > 0) return secs * 1000;
  const m = /try again in ([\d.]+)\s*s/i.exec(e.message ?? '');
  return m ? Number(m[1]) * 1000 : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The provider is fast and consistent enough that this is a plain performance/
// consistency nicety, not something reliability depends on — repeating the
// exact same query (a clicked Recent, the same "Flights from X to Y" twice)
// answers instantly instead of paying for a fresh generation, and this is
// fictional demo content where a stable repeat answer is a feature, not a
// staleness bug. In-memory only: a cold cache just re-fills itself within a
// couple of seconds per query.
const cache = new Map<string, unknown>();

function cacheKey(instructions: string, userContent: string, model?: string): string {
  let h = 0;
  for (let i = 0; i < instructions.length; i++) h = (h * 31 + instructions.charCodeAt(i)) >>> 0;
  return `${model || ''}:${h}:${userContent.trim().toLowerCase()}`;
}

/** One line at startup, so "why is everything mock data" is answerable without
 * reading the config. */
if (!backend) {
  console.warn(`[llm] disabled — no AWS credentials found; ${missingHint}. Running on mock data.`);
} else {
  console.log(`[llm] ${LLM_PROVIDER === 'bedrock' ? 'AWS Bedrock' : 'Groq'}, model ${LLM_MODEL} (routing on ${LLM_ROUTER_MODEL})`);
}

/**
 * Asks Claude on AWS Bedrock for a JSON value matching the shape described in
 * `instructions`. Returns null (never throws) on missing credentials, network
 * error, or unparseable output — callers use that as the signal to fall back
 * to mock data.
 */
export async function generateJSON<T>(
  instructions: string, userContent: string, timeoutMs = 12_000, options?: CompleteOptions,
): Promise<T | null> {
  if (!backend) return null;
  const key = cacheKey(instructions, userContent, options?.model);
  const label = userContent.slice(0, 60).replace(/\s+/g, ' ');
  if (cache.has(key)) {
    return cache.get(key) as T;
  }
  const callId = ++callCount;
  const started = Date.now();
  const effectiveTimeout = Math.round(timeoutMs * LLM_TIMEOUT_SCALE);
  // At most two passes, and only ever a second one for a rate limit the
  // provider told us how long to wait out.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { text, promptTokens, completionTokens } = await backend(instructions, userContent, effectiveTimeout, options);
      const ms = Date.now() - started;
      if (!text) {
        console.warn(`[llm#${callId}] empty response after ${ms}ms — "${label}"`);
        return null;
      }
      const parsed = JSON.parse(text) as T;
      // Prompt/completion counts, so "why is this account rate limited" and
      // "is the max-token cap too tight" are answerable from the log rather
      // than guessed at (see LLM_MAX_TOKENS).
      console.log(`[llm#${callId}] ${ms}ms  in ${promptTokens ?? '?'} / out ${completionTokens ?? '?'} — "${label}"`);
      cache.set(key, parsed);
      return parsed;
    } catch (err) {
      const ms = Date.now() - started;
      const waitMs = attempt === 1 ? retryAfterMs(err) : null;
      if (waitMs !== null && waitMs <= RATE_LIMIT_MAX_WAIT_MS) {
        console.warn(`[llm#${callId}] rate limited after ${ms}ms, waiting ${(waitMs / 1000).toFixed(1)}s for the quota — "${label}"`);
        await sleep(waitMs + 250);
        continue;
      }
      // Every caller treats null as "fall back to mock/hand-written output", so
      // without this line a provider 403, a timeout and a truncated-JSON parse
      // failure are indistinguishable from each other and from a healthy miss.
      const reason = err instanceof SyntaxError ? 'unparseable JSON' : (err as Error)?.message ?? String(err);
      console.warn(`[llm#${callId}] failed after ${ms}ms — ${reason} — "${label}"`);
      return null;
    }
  }
  return null;
}
