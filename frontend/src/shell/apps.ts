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

// Finance and the my-records/appointments lookups all come back from the
// backend as intent:"refine" (see server.ts), so the structured intent alone
// can't tell those apart — a light keyword pass over the raw query fills the
// gap. Checked health → finance → trip so "book an appointment" reads as
// health, not travel ("book").
const HEALTH_RE = /\b(doctor|dentist|dermatolog|cardiolog|neurolog|physician|specialist|appointment|clinic|hospital|symptom|pain|fever|cough|cold|flu|migraine|headache|rash|nausea|checkup|check-up|consult|prescription|dental|tooth|health)\w*/i;
const FINANCE_RE = /\b(budget|expense|expenses|spend|spending|portfolio|invest|investment|stock|shares|mutual|sip|saving|savings|income|salary|money|finance|financial|networth|debt|loan|emi|wallet)\w*/i;
const TRIP_RE = /\b(trip|travel|flight|flights|fly|hotel|hotels|stay|resort|holiday|vacation|getaway|destination|itinerar|booking|book|weather|beach|tour|sightsee|visit)\w*/i;

/** Which app, if any, the given turn belongs to. Returns null when nothing
 * matches (a bare greeting, a clarification reply) so the sidebar simply
 * shows no highlight rather than guessing. */
export function classifyApp(query: string, intent: Intent | null): AppId | null {
  const agents = intent?.agents ?? [];
  const kind = intent?.intent ?? '';

  if (agents.includes('health') || kind === 'find_doctor') return 'health';
  if (
    agents.includes('flights') ||
    agents.includes('hotels') ||
    kind === 'plan_trip' || kind === 'browse_hotels' || kind === 'browse_flights' ||
    kind === 'explore_destinations'
  ) {
    return 'trip';
  }

  const q = (query || '').toLowerCase();
  if (HEALTH_RE.test(q)) return 'health';
  if (FINANCE_RE.test(q)) return 'finance';
  if (TRIP_RE.test(q)) return 'trip';
  return null;
}
