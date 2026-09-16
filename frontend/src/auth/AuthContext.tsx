import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Identity comes from the Fission AI Portal shell, not from Prism.
 *
 * Prism runs as an iframe microfrontend inside the portal. The handshake, as
 * the shell implements it (MicrofrontendLoader.tsx in the portal repo):
 *
 *   1. we post  { type: 'MFE_READY' }            → shell
 *   2. shell posts { type: 'SHELL_AUTH', payload: { user, isAuthenticated,
 *                    permissions, appName } }     → us
 *   3. we post  { type: 'REQUEST_ACCESS_TOKEN' } → shell
 *   4. shell posts { type: 'SHELL_ACCESS_TOKEN', payload: { accessToken } }
 *
 * The shell only accepts messages from the iframe's own origin and only sends
 * to it, so both sides are pinned. There is no sign-in UI here any more: a
 * user who reaches this app has already been authenticated by the portal and
 * checked against the app's allowed groups.
 */

/** The portal shell's origin. Messages from anywhere else are ignored — an
 * unpinned listener would let any page that embeds Prism assert an identity
 * simply by posting one. */
const SHELL_ORIGIN = import.meta.env.VITE_PORTAL_ORIGIN || '';

/** How long to wait for the shell to answer MFE_READY before concluding
 * nothing is listening (opened directly rather than through the portal). */
const HANDSHAKE_TIMEOUT_MS = 5000;

export interface AuthUser {
  id: string;
  email: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  ready: boolean;
  /** True when this page is not running inside the portal shell — the app is
   * reachable but every signed-in feature will 401. Surfaced so the UI can
   * say so plainly instead of failing one request at a time. */
  standalone: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface ShellUser {
  id: string;
  username: string;
  email?: string;
  displayName?: string;
  groups?: string[];
}

function toAuthUser(shellUser: ShellUser | null): AuthUser | null {
  if (!shellUser?.id) return null;
  return { id: shellUser.id, email: shellUser.email ?? null };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [standalone, setStandalone] = useState(false);
  // `ready` is what the rest of the app waits on, and it must only ever be
  // set once — a late SHELL_AUTH must not flip the app back to "loading".
  const settledRef = useRef(false);

  useEffect(() => {
    const embedded = window.parent !== window;

    if (!embedded || !SHELL_ORIGIN) {
      // Opened directly. Nothing to hand us an identity, so don't sit on a
      // spinner waiting for a message that cannot arrive.
      settledRef.current = true;
      setStandalone(true);
      setReady(true);
      return;
    }

    const settle = () => {
      if (settledRef.current) return;
      settledRef.current = true;
      setReady(true);
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== SHELL_ORIGIN) return;

      if (event.data?.type === 'SHELL_AUTH') {
        const { user: shellUser, isAuthenticated } = event.data.payload ?? {};
        setUser(isAuthenticated ? toAuthUser(shellUser) : null);
        // The shell sends SHELL_AUTH with accessToken: null by design; the
        // real token is a separate round trip so it is always fresh.
        window.parent.postMessage({ type: 'REQUEST_ACCESS_TOKEN' }, SHELL_ORIGIN);
        settle();
      }

      if (event.data?.type === 'SHELL_ACCESS_TOKEN') {
        setToken(event.data.payload?.accessToken ?? null);
      }
    };

    window.addEventListener('message', handleMessage);
    window.parent.postMessage({ type: 'MFE_READY' }, SHELL_ORIGIN);

    // The shell sends SHELL_AUTH on its own once it sees MFE_READY, but if it
    // never does (older shell, misconfigured origin) the app would hang on a
    // spinner forever. Fall through to signed-out instead.
    const timer = window.setTimeout(() => {
      if (!settledRef.current) setStandalone(true);
      settle();
    }, HANDSHAKE_TIMEOUT_MS);

    return () => {
      window.removeEventListener('message', handleMessage);
      window.clearTimeout(timer);
    };
  }, []);

  const value = useMemo(
    () => ({ user, token, ready, standalone }),
    [user, token, ready, standalone]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
