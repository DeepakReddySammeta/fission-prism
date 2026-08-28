import { A2uiRuntime, type A2uiMessage } from '../a2ui/runtime';

const KEY = 'fission-exp-conversations';
const MAX_CONVERSATIONS = 30;

export interface SerializedTurn {
  id: string;
  sessionId: string | null;
  query: string;
  intent: any;
  /** The raw A2UI envelope stream for this turn — replayed into a fresh
   * A2uiRuntime on restore, so a Recent reopened after a refresh shows
   * exactly what was rendered (not a fresh, possibly-different re-answer). */
  messages: A2uiMessage[];
}

interface SerializedConversation {
  id: string;
  turns: SerializedTurn[];
}

function readAll(): Record<string, SerializedConversation> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, SerializedConversation>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // full/unavailable localStorage — this persistence is a nice-to-have,
    // never worth blocking or breaking the live conversation over.
  }
}

/** Persists one conversation's full visible state — every turn's query,
 * intent, and rendered A2UI envelope stream — so a Recent clicked after a
 * page refresh restores exactly what was there. Not a live re-answer: asking
 * the same question again could easily come back with different flights,
 * hotels, or prices than what the traveler actually saw and picked from. */
export function saveConversation(
  id: string,
  turns: { id: string; sessionId: string | null; query: string; intent: any; runtime: A2uiRuntime }[]
) {
  if (turns.length === 0) return;
  const all = readAll();
  all[id] = {
    id,
    turns: turns.map((t) => ({
      id: t.id, sessionId: t.sessionId, query: t.query, intent: t.intent,
      messages: t.runtime.messages,
    })),
  };
  // Evict oldest-saved entries past the cap — insertion order in a plain
  // object is a good enough proxy for recency here.
  const keys = Object.keys(all);
  if (keys.length > MAX_CONVERSATIONS) {
    for (const k of keys.slice(0, keys.length - MAX_CONVERSATIONS)) delete all[k];
  }
  writeAll(all);
}

export function loadConversation(id: string): SerializedConversation | undefined {
  return readAll()[id];
}
