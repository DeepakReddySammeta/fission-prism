import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { A2UIStore } from '../a2ui/store';
import { upsertRecent } from '../shell/recents';
import { NEW_CHAT_EVENT } from '../shell/plannerBus';
import { useAuth } from '../auth/AuthContext';
import { saveConversation, loadConversation, hydrateStore } from './persistence';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8787';

export interface Intent {
  destination: string;
  origin?: string;
  agents: Array<'flights' | 'hotels'>;
  summary?: string;
  /** True when the query used booking language ("book...") — the combined
   * flight+room recommendation card only applies when this is set, so the
   * frontend doesn't have to guess from partial data as flights/hotels
   * surfaces arrive independently and can race either way. */
  wantsBooking?: boolean;
  /** Traveler count extracted from the query ("for 2 adults") — prefills
   * the trip-builder card's steppers instead of always starting at 2/0. */
  adults?: number;
  children?: number;
}

/** One question-and-answer exchange in the conversation. Each turn owns its
 * own backend session + A2UI store, so earlier turns stay fully live (their
 * Select/Book buttons keep working) even after later turns are added — the
 * whole point of a persistent chat history instead of replacing the view. */
export interface Turn {
  id: string;
  sessionId: string | null;
  query: string;
  intent: Intent | null;
  loading: boolean;
  store: A2UIStore;
}

/** One "chat" the way ChatGPT/Claude mean it — its own scrollback of turns,
 * kept alive (SSE connections and all) even while another conversation is
 * the one on screen. "+ New chat" starts one of these instead of wiping the
 * current one; a Recent switches `activeId` to an existing one instead of
 * re-asking its first query against the LLM. */
export interface Conversation {
  id: string;
  turns: Turn[];
}

interface PlannerContextValue {
  turns: Turn[];
  plan: (q: string) => Promise<void>;
  resetPlanner: () => void;
  /** Switches to an existing conversation by id (a Recent's id). If it's
   * still in memory, this is a pure, instant, no-network switch. If not
   * (e.g. the tab was refreshed since), it's restored from localStorage
   * instead — the exact flights/hotels/prices originally shown, not a fresh
   * re-answer that could easily come back different. `fallbackQuery` is
   * only used as a last resort, when nothing was ever persisted for this id
   * either (very first run, or localStorage was cleared) — then this re-asks
   * fresh rather than leaving the traveler looking at a blank chat. */
  openConversation: (id: string, fallbackQuery: string) => void;
}

const PlannerContext = createContext<PlannerContextValue | null>(null);

/** Owns every conversation — their turns, A2UI stores, and open SSE
 * connections — one level above the router, so navigating to My Plans or My
 * Bookings and back never unmounts any of it. */
export function PlannerProvider({ children }: { children: React.ReactNode }) {
  const firstIdRef = useRef(crypto.randomUUID());
  const [conversations, setConversations] = useState<Conversation[]>([{ id: firstIdRef.current, turns: [] }]);
  const [activeId, setActiveId] = useState<string>(firstIdRef.current);
  const esMapRef = useRef<Map<string, EventSource>>(new Map());
  // AuthProvider is an ancestor of this provider (see main.tsx), so this is
  // safe to read directly — needed so a chat-typed "my plans"/"my bookings"
  // query can be answered for the right account instead of always looking
  // signed-out to the backend.
  const { token } = useAuth();

  const turns = conversations.find((c) => c.id === activeId)?.turns ?? [];

  // A turn's id is globally unique, so finding which conversation owns it
  // (rather than assuming "the active one") keeps a background conversation's
  // SSE updates landing correctly even after the traveler has switched away
  // from it to look at a different chat.
  const updateTurn = useCallback((id: string, patch: Partial<Turn>) => {
    setConversations((prev) => {
      const next = prev.map((c) => (
        c.turns.some((t) => t.id === id)
          ? { ...c, turns: c.turns.map((t) => (t.id === id ? { ...t, ...patch } : t)) }
          : c
      ));
      // Persist whichever conversation this turn actually belongs to (not
      // necessarily the active one — a background conversation's own SSE
      // updates land here too) so a Recent clicked after a refresh restores
      // this exact content instead of nothing.
      const owner = next.find((c) => c.turns.some((t) => t.id === id));
      if (owner) saveConversation(owner.id, owner.turns);
      return next;
    });
  }, []);

  const plan = useCallback(async (q: string, targetConversationId?: string) => {
    if (!q.trim()) return;
    const id = crypto.randomUUID();
    const store = new A2UIStore();
    const conversationId = targetConversationId || activeId;
    setConversations((prev) => prev.map((c) => (
      c.id === conversationId ? { ...c, turns: [...c.turns, { id, sessionId: null, query: q, intent: null, loading: true, store }] } : c
    )));

    const res = await fetch(`${API}/api/plan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ query: q }),
    });
    const data = await res.json();

    const { sessionId: sid, intent: parsedIntent } = data;
    updateTurn(id, { sessionId: sid, intent: parsedIntent });
    upsertRecent(conversationId, q, parsedIntent?.destination);

    const es = new EventSource(`${API}/api/events/${sid}`);
    esMapRef.current.set(id, es);
    es.addEventListener('a2ui', (e: MessageEvent) => {
      store.apply(JSON.parse(e.data));
      updateTurn(id, { loading: false });
    });
  }, [activeId, updateTurn, token]);

  // "+ New chat" — the current conversation (if it actually has anything in
  // it) stays exactly as it is, reachable again from Recents; a truly empty
  // current chat is reused instead of piling up empty entries.
  const startNewChat = useCallback(() => {
    const current = conversations.find((c) => c.id === activeId);
    if (!current || current.turns.length === 0) return;
    const newId = crypto.randomUUID();
    setConversations((prev) => [...prev, { id: newId, turns: [] }]);
    setActiveId(newId);
  }, [activeId, conversations]);

  const openConversation = useCallback((id: string, fallbackQuery: string) => {
    if (conversations.some((c) => c.id === id)) {
      setActiveId(id);
      return;
    }

    const persisted = loadConversation(id);
    if (persisted && persisted.turns.length > 0) {
      const restoredTurns: Turn[] = persisted.turns.map((t) => {
        const store = hydrateStore(t.surfaces);
        // Keep listening for further live updates (e.g. clicking Select on a
        // restored flight still works) as long as the backend session — an
        // in-memory process independent of this page refresh — is still up.
        // Already-`started` sessions don't re-run their agents on a second
        // subscribe, so this is purely "keep listening," never a re-answer.
        if (t.sessionId) {
          const es = new EventSource(`${API}/api/events/${t.sessionId}`);
          esMapRef.current.set(t.id, es);
          es.addEventListener('a2ui', (e: MessageEvent) => {
            store.apply(JSON.parse(e.data));
            updateTurn(t.id, { loading: false });
          });
        }
        return { id: t.id, sessionId: t.sessionId, query: t.query, intent: t.intent, loading: false, store };
      });
      setConversations((prev) => [...prev, { id, turns: restoredTurns }]);
      setActiveId(id);
      return;
    }

    // Nothing in memory AND nothing ever persisted (very first run, or
    // localStorage was cleared) — only now fall back to asking fresh. `plan`
    // takes an explicit target id since the setActiveId above hasn't
    // committed yet — plan() would otherwise still read the *previous*
    // activeId from this render's closure.
    setConversations((prev) => [...prev, { id, turns: [] }]);
    setActiveId(id);
    plan(fallbackQuery, id);
  }, [conversations, plan, updateTurn]);

  useEffect(() => {
    const onNewChat = () => startNewChat();
    window.addEventListener(NEW_CHAT_EVENT, onNewChat);
    return () => {
      window.removeEventListener(NEW_CHAT_EVENT, onNewChat);
    };
  }, [startNewChat]);

  // Every turn keeps its SSE connection open for the life of the app (closing
  // it would silently break that turn's buttons — the POST would still land,
  // but the pushed envelope reflecting it would never arrive), regardless of
  // which conversation is currently the one on screen — only close them all
  // when the provider itself unmounts (app teardown).
  useEffect(() => () => { esMapRef.current.forEach((es) => es.close()); }, []);

  return (
    <PlannerContext.Provider value={{ turns, plan, resetPlanner: startNewChat, openConversation }}>
      {children}
    </PlannerContext.Provider>
  );
}

export function usePlanner(): PlannerContextValue {
  const ctx = useContext(PlannerContext);
  if (!ctx) throw new Error('usePlanner must be used within PlannerProvider');
  return ctx;
}
