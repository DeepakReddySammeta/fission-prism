import Groq from 'groq-sdk';
import { GROQ_API_KEY, GROQ_MODEL, LLM_ENABLED } from '../config';

const client = LLM_ENABLED ? new Groq({ apiKey: GROQ_API_KEY }) : null;

// Logged once at startup so `npm run dev`'s output alone tells you which mode
// a session ran in, without needing to trigger a request first.
console.log(
  `[llm] ${LLM_ENABLED ? 'enabled' : 'disabled — set GROQ_API_KEY to turn this on'} ` +
  `— model=${GROQ_MODEL} via Groq`
);

let callCount = 0;

// Groq is fast and consistent enough that this is a plain performance/
// consistency nicety, not something reliability depends on — repeating the
// exact same query (a clicked Recent, the same "Flights from X to Y" twice)
// answers instantly instead of paying for a fresh generation, and this is
// fictional demo content where a stable repeat answer is a feature, not a
// staleness bug. In-memory only: unlike the previous slow-model workaround,
// there's no need to survive a restart — a cold cache just re-fills itself
// within a couple of seconds per query.
const cache = new Map<string, unknown>();

function cacheKey(instructions: string, userContent: string): string {
  let h = 0;
  for (let i = 0; i < instructions.length; i++) h = (h * 31 + instructions.charCodeAt(i)) >>> 0;
  return `${h}:${userContent.trim().toLowerCase()}`;
}

/**
 * Asks the configured Groq model for a JSON value matching the shape
 * described in `instructions`. Returns null (never throws) on missing key,
 * network error, or unparseable output — callers use that as the signal to
 * fall back to mock data.
 */
export async function generateJSON<T>(instructions: string, userContent: string, timeoutMs = 12_000): Promise<T | null> {
  if (!client) return null;
  const key = cacheKey(instructions, userContent);
  if (cache.has(key)) {
    console.log(`[llm] cache hit for "${userContent.slice(0, 60).replace(/\s+/g, ' ')}"`);
    return cache.get(key) as T;
  }
  const callId = ++callCount;
  const label = userContent.slice(0, 60).replace(/\s+/g, ' ');
  console.log(`[llm] #${callId} → requesting model=${GROQ_MODEL} for "${label}"`);
  try {
    const completion = await client.chat.completions.create(
      {
        model: GROQ_MODEL,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `${instructions}\nRespond with ONLY a single JSON object, no prose, no markdown fences.` },
          { role: 'user', content: userContent },
        ],
      },
      { timeout: timeoutMs }
    );
    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      console.warn(`[llm] #${callId} ← empty response`);
      return null;
    }
    const parsed = JSON.parse(raw) as T;
    cache.set(key, parsed);
    console.log(
      `[llm] #${callId} ← live response used ` +
      `(${completion.usage?.prompt_tokens ?? '?'} in / ${completion.usage?.completion_tokens ?? '?'} out tokens)`
    );
    return parsed;
  } catch (err) {
    console.warn(`[llm] #${callId} ← generation failed: ${(err as Error).message}`);
    return null;
  }
}
