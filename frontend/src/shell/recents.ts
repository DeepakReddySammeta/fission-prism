export interface RecentEntry {
  /** Same id as the Conversation it points to (PlannerContext) — clicking a
   * recent switches to that conversation instead of re-asking the query. */
  id: string;
  query: string;
  destination?: string;
  ts: number;
  pinned: boolean;
}

const KEY = 'voyage-ai-recents';
const MAX_UNPINNED = 10;
export const RECENTS_EVENT = 'voyage-recents';

function notify() {
  window.dispatchEvent(new Event(RECENTS_EVENT));
}

export function loadRecents(): RecentEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

function save(list: RecentEntry[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
  notify();
}

/** Called once per query — including follow-ups within the same
 * conversation. The label (first query asked) and pinned state are kept
 * from any existing entry for this conversation id; only the recency
 * timestamp (and destination, if a later query in the same chat names one)
 * updates, so a conversation floats to the top of Recents as it stays
 * active without spawning a new entry per message. */
export function upsertRecent(conversationId: string, query: string, destination?: string) {
  const all = loadRecents();
  const existing = all.find((r) => r.id === conversationId);
  const rest = all.filter((r) => r.id !== conversationId);
  const entry: RecentEntry = {
    id: conversationId,
    query: existing?.query || query.trim(),
    destination: destination ?? existing?.destination,
    ts: Date.now(),
    pinned: existing?.pinned || false,
  };
  const pinned = rest.filter((r) => r.pinned);
  const unpinned = rest.filter((r) => !r.pinned);
  const merged = entry.pinned ? [entry, ...pinned, ...unpinned] : [...pinned, entry, ...unpinned];
  save([...merged.filter((r) => r.pinned), ...merged.filter((r) => !r.pinned).slice(0, MAX_UNPINNED)]);
}

export function togglePin(id: string) {
  save(loadRecents().map((r) => (r.id === id ? { ...r, pinned: !r.pinned } : r)));
}

export function removeRecent(id: string) {
  save(loadRecents().filter((r) => r.id !== id));
}
