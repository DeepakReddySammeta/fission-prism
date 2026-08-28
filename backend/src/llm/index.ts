import { LLM_ENABLED, LLM_PROVIDER, LLM_MODEL, LLM_TIMEOUT_SCALE, GROQ_MODEL, BEDROCK_MODEL } from '../config';
import { createGroqBackend } from './groq';
import { createBedrockBackend } from './bedrock';
import type { CompleteFn } from './types';

// Pick the backend once, at module load. Everything downstream is provider-
// agnostic: it just calls `backend(instructions, userContent, timeoutMs)`.
const backend: CompleteFn | null = !LLM_ENABLED
  ? null
  : LLM_PROVIDER === 'bedrock'
    ? createBedrockBackend(BEDROCK_MODEL)
    : createGroqBackend(GROQ_MODEL);

const providerLabel = LLM_PROVIDER === 'bedrock' ? 'AWS Bedrock' : 'Groq';
const missingHint = LLM_PROVIDER === 'bedrock'
  ? 'set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (or AWS_USE_IAM_ROLE=true on AWS) to turn this on'
  : 'set GROQ_API_KEY to turn this on';

let callCount = 0;

// The provider is fast and consistent enough that this is a plain performance/
// consistency nicety, not something reliability depends on — repeating the
// exact same query (a clicked Recent, the same "Flights from X to Y" twice)
// answers instantly instead of paying for a fresh generation, and this is
// fictional demo content where a stable repeat answer is a feature, not a
// staleness bug. In-memory only: a cold cache just re-fills itself within a
// couple of seconds per query.
const cache = new Map<string, unknown>();

function cacheKey(instructions: string, userContent: string): string {
  let h = 0;
  for (let i = 0; i < instructions.length; i++) h = (h * 31 + instructions.charCodeAt(i)) >>> 0;
  return `${h}:${userContent.trim().toLowerCase()}`;
}

/**
 * Asks the configured LLM (Groq or AWS Bedrock, per LLM_PROVIDER) for a JSON
 * value matching the shape described in `instructions`. Returns null (never
 * throws) on missing credentials, network error, or unparseable output —
 * callers use that as the signal to fall back to mock data.
 */
export async function generateJSON<T>(instructions: string, userContent: string, timeoutMs = 12_000): Promise<T | null> {
  if (!backend) return null;
  const key = cacheKey(instructions, userContent);
  const label = userContent.slice(0, 60).replace(/\s+/g, ' ');
  if (cache.has(key)) {
    return cache.get(key) as T;
  }
  const callId = ++callCount;
  const started = Date.now();
  const effectiveTimeout = Math.round(timeoutMs * LLM_TIMEOUT_SCALE);
  try {
    const { text, promptTokens, completionTokens } = await backend(instructions, userContent, effectiveTimeout);
    const ms = Date.now() - started;
    if (!text) {
      return null;
    }
    const parsed = JSON.parse(text) as T;
    cache.set(key, parsed);
    return parsed;
  } catch (err) {
    const ms = Date.now() - started;

    return null;
  }
}
