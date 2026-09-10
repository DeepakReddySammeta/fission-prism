/**
 * Personal Finance / Budget agent — the taxonomy and the request shapes.
 * The router (agents/router.ts) fills a FinanceQuery in from the user's
 * message; server.ts executes it against the database. Everything here is
 * the user's own numbers, so router.ts re-validates every amount it extracts
 * before any of it becomes a row.
 */

export const CATEGORIES = [
  'Food', 'Transport', 'Rent', 'Bills & Utilities', 'Shopping',
  'Entertainment', 'Health', 'Education', 'Savings', 'Other',
] as const;
export type Category = typeof CATEGORIES[number];

const CATEGORY_SYNONYMS: Record<string, Category> = {
  food: 'Food', groceries: 'Food', grocery: 'Food', dining: 'Food', restaurant: 'Food',
  restaurants: 'Food', eating: 'Food', snacks: 'Food', snack: 'Food', coffee: 'Food',
  tea: 'Food', lunch: 'Food', dinner: 'Food', breakfast: 'Food', takeout: 'Food',
  transport: 'Transport', transportation: 'Transport', commute: 'Transport', commuting: 'Transport',
  fuel: 'Transport', petrol: 'Transport', diesel: 'Transport', cab: 'Transport', cabs: 'Transport',
  uber: 'Transport', ola: 'Transport', taxi: 'Transport', auto: 'Transport', bus: 'Transport', metro: 'Transport',
  rent: 'Rent', housing: 'Rent', lease: 'Rent',
  bills: 'Bills & Utilities', bill: 'Bills & Utilities', utilities: 'Bills & Utilities',
  electricity: 'Bills & Utilities', power: 'Bills & Utilities', wifi: 'Bills & Utilities',
  internet: 'Bills & Utilities', water: 'Bills & Utilities', gas: 'Bills & Utilities',
  phone: 'Bills & Utilities', mobile: 'Bills & Utilities', recharge: 'Bills & Utilities',
  shopping: 'Shopping', clothes: 'Shopping', clothing: 'Shopping', apparel: 'Shopping',
  entertainment: 'Entertainment', movies: 'Entertainment', movie: 'Entertainment',
  netflix: 'Entertainment', subscriptions: 'Entertainment', subscription: 'Entertainment',
  games: 'Entertainment', gaming: 'Entertainment', outing: 'Entertainment', outings: 'Entertainment',
  health: 'Health', medicine: 'Health', medicines: 'Health', medical: 'Health',
  doctor: 'Health', gym: 'Health', fitness: 'Health', pharmacy: 'Health', insurance: 'Health',
  education: 'Education', school: 'Education', course: 'Education', courses: 'Education',
  tuition: 'Education', fees: 'Education', books: 'Education',
  savings: 'Savings', savings_: 'Savings', investment: 'Savings', investments: 'Savings', invest: 'Savings',
};

/** Best-effort match of whatever category word appeared in the message
 * against the fixed taxonomy — same reasoning as normalizeSpecialty in
 * agents/health.ts: exact/synonym match first, 'Other' as the always-valid
 * catch-all (an expense with an unrecognized category is still worth
 * logging, just uncategorized). */
export function normalizeCategory(raw?: string): Category {
  if (!raw) return 'Other';
  const s = raw.trim().toLowerCase();
  const exact = CATEGORIES.find((c) => c.toLowerCase() === s);
  if (exact) return exact;
  if (CATEGORY_SYNONYMS[s]) return CATEGORY_SYNONYMS[s];
  for (const [word, cat] of Object.entries(CATEGORY_SYNONYMS)) {
    if (s.includes(word)) return cat;
  }
  return 'Other';
}

export type FinanceQuery =
  | { kind: 'set_budget'; income?: number; allocations: { category: Category; amount: number }[] }
  | { kind: 'log_expense'; amount: number; category: Category; note?: string }
  | { kind: 'set_goal'; name: string; targetAmount: number; targetDate?: string }
  | { kind: 'contribute_goal'; name?: string; amount: number }
  | { kind: 'list_goals' }
  | { kind: 'summary'; period: 'this_month' | 'last_month' | 'all'; question: 'total' | 'biggest' | 'compare' | 'remaining'; category?: Category }
  | { kind: 'portfolio' }
  /** "give me my goals analysis" (goalName undefined -> every saved goal) or
   * "how do I achieve my emergency fund goal" (goalName set, resolved
   * against saved goals) or "how to achieve my goal to save 1 lakh
   * emergency fund" (goalName + adHocAmount/adHocTargetDate pulled straight
   * out of this message, for a goal that may not even be saved yet — the
   * user should be able to ask "what would it take" before committing to
   * anything, same reasoning as the rest of this file never assuming). */
  | { kind: 'goals_analysis'; goalName?: string; adHocAmount?: number; adHocTargetDate?: string }
  /** Standalone dashboard widgets, each askable by name instead of asking
   * for the whole "portfolio" screen — same data the portfolio card
   * already computes, just rendered alone. */
  | { kind: 'expenses_breakdown' }
  | { kind: 'cash_flow' }
  | { kind: 'budget_utilization' }
  | { kind: 'recent_expenses' }
  | { kind: 'unsupported'; action: string }
  | { kind: 'unclear' };
