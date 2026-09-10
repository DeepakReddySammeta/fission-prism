import type { Intent } from '../planner/PlannerContext';

/** The three domains the platform actually serves — shown in the sidebar
 * under "Apps", with the one matching the current conversation highlighted. */
export type AppId = 'trip' | 'health' | 'finance';

export interface AppDef {
  id: AppId;
  label: string;
  desc: string;
}

// Read-only status indicators in the sidebar — the row matching the current
// conversation lights up; they are not clickable and never issue a query.
export const APPS: AppDef[] = [
  { id: 'trip', label: 'Trip Planner', desc: 'Flights, hotels & itineraries' },
  { id: 'health', label: 'Healthcare', desc: 'Doctors & appointments' },
  { id: 'finance', label: 'Finance', desc: 'Budget, expenses & portfolio' },
];

/** Which app, if any, the given turn belongs to. The backend sets this from
 * the tool its router actually ran (see APP_OF in agents/router.ts) — null
 * when the turn was a clarification or a plain greeting, so the sidebar keeps
 * its current highlight rather than guessing. */
export function classifyApp(intent: Intent | null): AppId | null {
  return intent?.app ?? null;
}
