/**
 * Self-check for toRoute — the gate between whatever the model returned and
 * the tools that act on it, including the finance ones that write rows. Every
 * case here is "the model got sloppy in a way that must not reach a handler".
 *
 * Run: npx tsx src/tools/router.selfcheck.ts
 */
import assert from 'node:assert';
import { toRoute } from '../agents/router';

const r = (raw: any) => toRoute(raw);

// Happy path: a full trip request survives intact, and agents follow the kind.
const trip = r({
  tool: 'trip', summary: 'Here are your options.',
  trip: { intent: 'plan_trip', origin: 'Hyderabad', destination: 'Goa', checkIn: '2026-01-10', adults: 2, wantsBooking: true },
});
assert.equal(trip.tool, 'trip');
assert.equal(trip.tool === 'trip' && trip.trip.destination, 'Goa');
assert.equal(trip.tool === 'trip' && trip.trip.wantsBooking, true);

// A flights search with no origin can't run — ask instead of rendering nothing.
assert.equal(r({ tool: 'trip', summary: 's', trip: { intent: 'plan_trip', destination: 'Goa' } }).tool, 'clarify');
// A hotels-only search needs no origin.
assert.equal(r({ tool: 'trip', summary: 's', trip: { intent: 'browse_hotels', destination: 'Goa' } }).tool, 'trip');
// No destination at all is a clarification, whatever the model called it.
assert.equal(r({ tool: 'trip', summary: 's', trip: { intent: 'plan_trip', origin: 'Delhi' } }).tool, 'clarify');
// Junk dates are dropped rather than passed to the flights agent.
const loose = r({ tool: 'trip', summary: 's', trip: { intent: 'browse_hotels', destination: 'Goa', checkIn: 'next friday', adults: '3' } });
assert.equal(loose.tool === 'trip' && loose.trip.checkIn, undefined);
assert.equal(loose.tool === 'trip' && loose.trip.adults, 3);

// An unknown tool, or none at all, never guesses a domain.
assert.equal(r({ tool: 'wat', summary: 's' }).tool, 'clarify');
assert.equal(r(null).tool, 'clarify');
assert.equal(r({ tool: 'weather', summary: 's', weather: {} }).tool, 'clarify');

// Finance: nothing without a real amount becomes a row.
const fin = (a: any) => {
  const out = r({ tool: 'finance', summary: 's', finance: a });
  assert.equal(out.tool, 'finance');
  return out.tool === 'finance' ? out.finance : ({} as any);
};
assert.equal(fin({ kind: 'log_expense', category: 'Food' }).kind, 'unclear');
assert.equal(fin({ kind: 'log_expense', amount: 0, category: 'Food' }).kind, 'unclear');
assert.equal(fin({ kind: 'log_expense', amount: 'five hundred' }).kind, 'unclear');
assert.equal(fin({ kind: 'set_goal', name: 'Laptop' }).kind, 'unclear');
assert.equal(fin({ kind: 'contribute_goal', name: 'Laptop' }).kind, 'unclear');
assert.equal(fin({ kind: 'set_budget', allocations: [] }).kind, 'unclear');
assert.equal(fin({}).kind, 'unclear');

const expense = fin({ kind: 'log_expense', amount: '₹500', category: 'groceries', note: 'weekly run' });
assert.equal(expense.kind === 'log_expense' && expense.amount, 500);
assert.equal(expense.kind === 'log_expense' && expense.category, 'Food', 'a synonym category is normalised, not dumped in Other');

const budget = fin({ kind: 'set_budget', income: 60000, allocations: [{ category: 'Rent', amount: 20000 }, { category: 'Food' }] });
assert.equal(budget.kind === 'set_budget' && budget.allocations.length, 1, 'an allocation with no amount is dropped, not written as 0');

// Enum-ish fields fall back to a safe default rather than reaching the DB raw.
const summary = fin({ kind: 'summary', period: 'since forever', question: 'why' });
assert.equal(summary.kind === 'summary' && summary.period, 'this_month');
assert.equal(summary.kind === 'summary' && summary.question, 'total');

// Appointments: cancel/reschedule stays declined, not silently listed.
const appt = r({ tool: 'appointments', summary: 's', appointments: { kind: 'unsupported', action: 'cancel' } });
assert.equal(appt.tool === 'appointments' && appt.appointments.kind, 'unsupported');

console.log('router selfcheck ok');
