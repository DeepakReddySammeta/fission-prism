/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Prism's own backend. Used directly for the SSE stream, and for every
   * request when no gateway is configured (standalone dev). */
  readonly VITE_API_URL?: string;
  /** Fission AI Portal gateway base URL. Set it and JSON requests route
   * through the gateway's authenticated proxy instead. */
  readonly VITE_GATEWAY_API_URL?: string;
  /** Origin of the portal shell, for the postMessage handshake. Messages from
   * any other origin are ignored, so this must match the portal exactly. */
  readonly VITE_PORTAL_ORIGIN?: string;
  /** `appName` of Prism's record in the portal's Applications table — the
   * gateway resolves the backend to forward to by this name. */
  readonly VITE_PORTAL_APP_NAME?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
