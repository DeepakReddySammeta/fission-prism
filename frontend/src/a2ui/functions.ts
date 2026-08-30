/**
 * A2UI logic functions for the Prism catalog.
 *
 * `required` / `and` / `or` / `not` / `formatString` / `formatNumber` /
 * `pluralize` are reused from `@a2ui/web_core`'s `BASIC_FUNCTIONS` as-is.
 * `formatCurrency` and `formatDuration` are overridden / added here so the
 * on-screen output matches exactly what the hand-rolled renderer used to
 * produce (see the old `frontend/src/a2ui/store.ts` `FUNCTIONS` map):
 *   formatCurrency -> "₹1,23,456"  (en-IN, no decimals)
 *   formatDuration -> "2h 15m"     (from a minute count)
 */
import { z } from 'zod';
import { createFunctionImplementation } from '@a2ui/web_core/v0_9';
import { BASIC_FUNCTIONS } from '@a2ui/web_core/v0_9/basic_catalog';
import type { FunctionImplementation } from '@a2ui/web_core/v0_9';

const KEEP = new Set([
  'required', 'and', 'or', 'not', 'formatString', 'formatNumber', 'pluralize',
]);

const formatCurrency = createFunctionImplementation(
  { name: 'formatCurrency', returnType: 'string', schema: z.object({ value: z.any(), currency: z.any().optional() }).passthrough() },
  (args) => {
    const n = Number(args.value);
    if (!Number.isFinite(n)) return '';
    try {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: (args.currency as string) || 'INR',
        maximumFractionDigits: 0,
      }).format(n);
    } catch {
      return `₹${n}`;
    }
  },
);

const formatDuration = createFunctionImplementation(
  { name: 'formatDuration', returnType: 'string', schema: z.object({ value: z.any() }).passthrough() },
  (args) => {
    const mins = Number(args.value);
    if (!Number.isFinite(mins) || mins < 0) return '';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  },
);

export const catalogFunctions: FunctionImplementation[] = [
  ...BASIC_FUNCTIONS.filter((f) => KEEP.has(f.name)),
  formatCurrency,
  formatDuration,
];
