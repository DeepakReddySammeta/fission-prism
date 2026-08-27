import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Mirrors formatAppointmentDate in backend/src/orchestrator/envelopes.ts —
// "2026-08-28" -> "Fri 28 August", built manually (not toLocaleDateString)
// so the wording doesn't drift with the viewer's browser locale.
export function formatAppointmentDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`;
}

// Mirrors CABIN_CLASSES/CABIN_PRICE_MULTIPLIER/CABIN_BAGGAGE_KG in
// backend/src/orchestrator/envelopes.ts — the listed fare is the Economy
// price, and a higher cabin multiplies it rather than needing its own
// stored price. Kept as a manual duplicate per this repo's frontend/backend
// type-mirroring convention (see types.ts).
export const CABIN_CLASSES = ['Economy', 'Premium Economy', 'Business', 'First'] as const;

const CABIN_PRICE_MULTIPLIER: Record<string, number> = {
  Economy: 1, 'Premium Economy': 1.35, Business: 2.2, First: 3.6,
};
const CABIN_BAGGAGE_KG: Record<string, number> = {
  Economy: 15, 'Premium Economy': 20, Business: 30, First: 40,
};

export function cabinMultiplier(cabinClass?: string | null): number {
  return CABIN_PRICE_MULTIPLIER[cabinClass || 'Economy'] ?? 1;
}

export function cabinBaggageKg(cabinClass?: string | null): number {
  return CABIN_BAGGAGE_KG[cabinClass || 'Economy'] ?? 15;
}

export function fmtDuration(mins: number): string {
  if (!Number.isFinite(mins) || mins < 0) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
