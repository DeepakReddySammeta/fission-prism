import { A2UIStore } from '../a2ui/store';
import type { ComponentDef } from '../types';

const KEY = 'voyage-ai-conversations';
const MAX_CONVERSATIONS = 30;

interface SerializedSurface {
  id: string;
  theme: any;
  dataModel: any;
  components: [string, ComponentDef][];
}

export interface SerializedTurn {
  id: string;
  sessionId: string | null;
  query: string;
  intent: any;
  surfaces: SerializedSurface[];
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

function serializeStore(store: A2UIStore): SerializedSurface[] {
  return Array.from(store.surfaces.entries()).map(([id, s]) => ({
    id, theme: s.theme, dataModel: s.dataModel, components: Array.from(s.components.entries()),
  }));
}

export function hydrateStore(surfaces: SerializedSurface[]): A2UIStore {
  const store = new A2UIStore();
  for (const s of surfaces) {
    store.surfaces.set(s.id, { id: s.id, theme: s.theme, dataModel: s.dataModel, components: new Map(s.components) });
  }
  return store;
}

/** Persists one conversation's full visible state — every turn's query,
 * intent, and rendered A2UI content — so a Recent clicked after a page
 * refresh restores exactly what was there. Not a live re-answer: asking the
 * same question again could easily come back with different flights,
 * hotels, or prices than what the traveler actually saw and picked from. */
export function saveConversation(
  id: string,
  turns: { id: string; sessionId: string | null; query: string; intent: any; store: A2UIStore }[]
) {
  if (turns.length === 0) return;
  const all = readAll();
  all[id] = {
    id,
    turns: turns.map((t) => ({
      id: t.id, sessionId: t.sessionId, query: t.query, intent: t.intent,
      surfaces: serializeStore(t.store),
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
