export const PORT = Number(process.env.PORT) || 8787;
// Switched from the Fission Labs Anthropic-gateway (Moonshot Kimi K2 models)
// back to Groq: the gateway's only available models were reasoning models
// with unpredictable, often very long "thinking" time before any visible
// output — 8s to 90s+ for the same prompt, with no reliable way to bound or
// disable it. Groq runs standard (non-reasoning) models at genuinely fast,
// consistent inference speed, which is what a live demo actually needs.
export const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
// llama-3.3-70b-versatile (this project's original default) has since been
// retired from Groq's catalog for this key — verified via client.models.list().
// openai/gpt-oss-20b replaces it: measured at ~2.6s for the heaviest prompt
// in the app (6 hotels x 5 rooms each), vs. 45-75s on the previous provider,
// with comparably authentic output (real destination-specific names).
export const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
/** True when a Groq key is present. Every agent falls back to deterministic
 * mock data when this is false, so the whole app runs with zero setup. */
export const LLM_ENABLED = Boolean(GROQ_API_KEY);

/** POC-only fallback so auth works with zero setup. Set a real secret before
 * deploying anywhere shared — every server sharing this default trusts the
 * same tokens. */
export const JWT_SECRET = process.env.JWT_SECRET || 'voyage-ai-dev-secret-not-for-production';
/** Unset by default — the "Continue with Google" button only renders (and
 * /api/auth/google only works) once this is configured. */
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
