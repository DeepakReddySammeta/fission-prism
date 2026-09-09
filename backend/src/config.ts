// Loaded here rather than only in server.ts: config.ts is what actually reads
// process.env, so anything importing it (tools, harnesses, scripts) needs the
// .env already applied or it silently sees an unconfigured, LLM-disabled app.
import 'dotenv/config';

export const PORT = Number(process.env.PORT) || 8787;

/** Groq API key/model — a fast, non-reasoning chat-completions provider with
 * native JSON-object response mode. Selected when LLM_PROVIDER=groq. */
export const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
export const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

/** AWS Bedrock credentials + model — only read when LLM_PROVIDER=bedrock.
 * These mirror the standard AWS env var names so an existing AWS profile in
 * the environment works without renaming anything. */
export const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || '';
export const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || '';
export const AWS_SESSION_TOKEN = process.env.AWS_SESSION_TOKEN || '';
export const AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
/** Set true when the backend runs on AWS with an instance / ECS-task IAM role
 * instead of static keys: the Bedrock SDK then uses the ambient AWS credential
 * chain and no AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY need to be provided. */
export const AWS_USE_IAM_ROLE = /^(1|true|yes)$/i.test(process.env.AWS_USE_IAM_ROLE || '');
/** A Bedrock inference-profile / model id. Claude Haiku 4.5 is the default:
 * on this app's structured-JSON prompts it runs ~2-4x faster than Sonnet at
 * comparable quality, which keeps the "Thinking…" wait short. Override with
 * BEDROCK_MODEL for Sonnet ('us.anthropic.claude-sonnet-5') or Nova. */
export const BEDROCK_MODEL =
  process.env.BEDROCK_MODEL || 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

/** Which LLM backend the agents talk to: 'groq' (default) or 'bedrock'.
 * Everything else about the app is identical between the two — the provider
 * only changes where `generateJSON` sends its request. */
export const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'groq').toLowerCase();

/** True when the active provider has the credentials it needs. Every agent
 * falls back to deterministic mock data when this is false, so the whole app
 * still runs with zero setup — just without live generation. */
export const LLM_ENABLED =
  LLM_PROVIDER === 'bedrock'
    ? (AWS_USE_IAM_ROLE || Boolean(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY))
    : Boolean(GROQ_API_KEY);

/**
 * Output cap per LLM call. Explicit because the provider's own default is both
 * invisible and small enough to truncate a large answer mid-JSON, which surfaces
 * as an unexplained 400 rather than as a short response.
 *
 * A knob because it is not free: providers count `prompt + max_tokens` against
 * a tokens-per-minute quota, so on a throttled account an over-generous cap can
 * make a request fail the rate limit before it is even sent. 8192 suits Bedrock
 * Claude on a normal quota; lower it if the account is tightly throttled.
 */
export const LLM_MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS) || 8192;

/** Human-readable name of the active model, for logs and /api/health. */
export const LLM_MODEL = LLM_PROVIDER === 'bedrock' ? BEDROCK_MODEL : GROQ_MODEL;

/**
 * Multiplier applied to every agent's per-call LLM timeout. The agent
 * timeouts (8-15s) were tuned for Groq's sub-3s inference; Claude on Bedrock
 * routinely needs longer for the bulk-JSON prompts (6 hotels x 5 rooms), so
 * without this every Bedrock call times out and falls back to mock data.
 * Override with LLM_TIMEOUT_SCALE if your region/model is faster or slower.
 */
export const LLM_TIMEOUT_SCALE = Number(
  process.env.LLM_TIMEOUT_SCALE || (LLM_PROVIDER === 'bedrock' ? 2 : 1),
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

/** Allowed browser origin(s) for CORS, comma-separated
 * (e.g. "https://app.example.com,https://www.example.com"). Unset — the
 * default — reflects any origin, which is fine for local dev; set it to the
 * deployed frontend URL(s) in production. */
export const CORS_ORIGINS = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
