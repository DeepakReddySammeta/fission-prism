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

/**
 * Which LLM backend the agents talk to: 'groq' (default) or 'bedrock'.
 * Everything else about the app is identical between the two — the provider
 * only changes where `generateJSON` sends its request.
 */
export const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'groq').toLowerCase();

/** AWS Bedrock credentials + model — only read when LLM_PROVIDER=bedrock.
 * These mirror the standard AWS env var names so an existing AWS profile in
 * the environment works without renaming anything. */
export const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || '';
export const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || '';
export const AWS_SESSION_TOKEN = process.env.AWS_SESSION_TOKEN || '';
export const AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
/** A Bedrock inference-profile / model id, e.g. 'us.anthropic.claude-sonnet-5'. */
export const BEDROCK_MODEL = process.env.BEDROCK_MODEL || 'us.anthropic.claude-sonnet-5';

/** True when the active provider has what it needs. Every agent falls back to
 * deterministic mock data when this is false, so the whole app runs with zero
 * setup regardless of which provider is selected. */
export const LLM_ENABLED =
  LLM_PROVIDER === 'bedrock'
    ? Boolean(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY)
    : Boolean(GROQ_API_KEY);

/** Human-readable name of the active model, for logs and /api/health. */
export const LLM_MODEL = LLM_PROVIDER === 'bedrock' ? BEDROCK_MODEL : GROQ_MODEL;

/**
 * Multiplier applied to every agent's per-call LLM timeout. The agent
 * timeouts (8–15s) were tuned for Groq's sub-3s inference; Claude on Bedrock
 * routinely needs 15–30s for the bulk-JSON prompts (6 hotels × 5 rooms), so
 * without this every Bedrock call times out and falls back to mock data.
 * Override with LLM_TIMEOUT_SCALE if your region/model is faster or slower.
 */
export const LLM_TIMEOUT_SCALE = Number(
  process.env.LLM_TIMEOUT_SCALE || (LLM_PROVIDER === 'bedrock' ? 3 : 1),
);

/** POC-only fallback so auth works with zero setup. Set a real secret before
 * deploying anywhere shared — every server sharing this default trusts the
 * same tokens. In production (NODE_ENV=production) an unset/default secret is
 * a hard startup error rather than a silent security hole. */
const DEFAULT_JWT_SECRET = 'voyage-ai-dev-secret-not-for-production';
export const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;

if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEFAULT_JWT_SECRET) {
  throw new Error(
    'JWT_SECRET must be set to a strong random value in production. Generate one with:\n' +
      '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
  );
}
/** Unset by default — the "Continue with Google" button only renders (and
 * /api/auth/google only works) once this is configured. */
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
