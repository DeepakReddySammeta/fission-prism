import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8787';
const STORAGE_KEY = 'fission-exp-token';

export interface AuthUser {
  id: string;
  email: string | null;
}

interface AuthResult {
  token: string;
  user: AuthUser;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<AuthResult>;
  signup: (email: string, password: string) => Promise<AuthResult>;
  loginWithGoogle: (credential: string) => Promise<AuthResult>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!token) { setReady(true); return; }
    fetch(`${API}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setUser(data.user))
      .catch(() => { setToken(null); localStorage.removeItem(STORAGE_KEY); })
      .finally(() => setReady(true));
  }, [token]);

  const applyAuth = useCallback((data: { token: string; user: AuthUser }) => {
    localStorage.setItem(STORAGE_KEY, data.token);
    setToken(data.token);
    setUser(data.user);
  }, []);

  // Returns the fresh { token, user } directly — callers that need to act on
  // the new auth state immediately (e.g. saving something right after
  // sign-in) can't rely on this.token/this.user, since a just-triggered
  // setState hasn't re-rendered yet and the caller's own closure is stale.
  const request = useCallback(async (path: string, body: unknown): Promise<AuthResult> => {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    applyAuth(data);
    return data;
  }, [applyAuth]);

  const login = useCallback((email: string, password: string) => request('/api/auth/login', { email, password }), [request]);
  const signup = useCallback((email: string, password: string) => request('/api/auth/signup', { email, password }), [request]);
  const loginWithGoogle = useCallback((credential: string) => request('/api/auth/google', { credential }), [request]);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, token, ready, login, signup, loginWithGoogle, logout }),
    [user, token, ready, login, signup, loginWithGoogle, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
