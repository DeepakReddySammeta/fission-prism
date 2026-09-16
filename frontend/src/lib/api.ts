/**
 * Where Prism's requests go when it runs inside the Fission AI Portal.
 *
 * Two bases, because they cannot be the same one:
 *
 * - `API` — every JSON call. Routed through the portal gateway's proxy, which
 *   validates the Cognito token, enforces this app's allowed groups, and
 *   forwards to the backend with the caller's identity attached.
 *
 * - `STREAM_API` — the SSE endpoint only, pointed straight at the backend.
 *   The gateway's proxy reads the whole upstream response into memory before
 *   answering (it sets its own Content-Length), so an event stream through it
 *   would deliver nothing until the stream ended — which for /api/events is
 *   never. EventSource also cannot send an Authorization header, so there is
 *   nothing for the gateway to authenticate anyway; the route is keyed by an
 *   unguessable session id instead.
 */

const DIRECT_API = import.meta.env.VITE_API_URL || 'http://localhost:8787';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_API_URL || '';

/** Must match the `appName` of this app's record in the portal's
 * Applications table — the gateway resolves the backend to forward to by
 * looking that name up. */
const PORTAL_APP_NAME = import.meta.env.VITE_PORTAL_APP_NAME || 'Prism';

/** JSON API base. Falls back to talking to the backend directly when no
 * gateway is configured, which is what standalone `npm run dev` does. */
export const API = GATEWAY_URL
  ? `${GATEWAY_URL.replace(/\/$/, '')}/proxy/${PORTAL_APP_NAME}`
  : DIRECT_API;

/** SSE base — always direct, never proxied. See the note above. */
export const STREAM_API = DIRECT_API;
