/**
 * Personal Finance / Budget agent — pure parsing/classification, no LLM.
 * Unlike doctors/hotels (curated or generated data), everything here is the
 * user's own numbers, typed straight into chat, so the goal is reliable
 * deterministic extraction (never hallucinate a rupee amount) rather than
 * open-ended NLU. See detectFinanceQuery's own comment for why this is a
 * regex/heuristic classifier, not a ParsedIntent field.
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

/** "60000" / "60k" / "5,00,000" / "5 lakhs" / "₹500" -> a plain number.
 * Handles the Indian lakh/thousand shorthand people actually type instead
 * of requiring the full figure. */
export function parseAmount(text: string): number | undefined {
  const m = text.match(/₹?\s*([\d,]+(?:\.\d+)?)\s*(k|thousand|lakhs?|l)?\b/i);
  if (!m) return undefined;
  const n = parseFloat(m[1].replace(/,/g, ''));
  if (Number.isNaN(n)) return undefined;
  const unit = m[2]?.toLowerCase();
  // A unit word right after a number that's already this big ("800000
  // lakhs") is almost always a typo/redundant slip, not someone meaning
  // 80 billion rupees — "8 lakhs" is the phrasing this is actually for.
  // Applying the multiplier anyway would silently produce an absurd goal
  // amount instead of the plainly-intended one.
  if (n >= 1000) return n;
  if (unit === 'k' || unit === 'thousand') return n * 1000;
  if (unit === 'lakh' || unit === 'lakhs' || unit === 'l') return n * 100000;
  return n;
}

const INCOME_WORDS = ['earn', 'earning', 'income', 'salary', 'make', 'paid'];

/** Splits a multi-clause budget statement ("I earn 60000, rent is 20000,
 * food is around 10000, and 5000 on transport") into an income figure plus
 * one allocation per category clause — each clause parsed independently so
 * one line's wording doesn't affect another's. */
function parseBudgetStatement(query: string): { income?: number; allocations: { category: Category; amount: number }[] } {
  const clauses = query.split(/,|\band\b|&|\n/i).map((c) => c.trim()).filter(Boolean);
  let income: number | undefined;
  const allocations: { category: Category; amount: number }[] = [];

  for (const clause of clauses) {
    const amount = parseAmount(clause);
    if (amount === undefined) continue;
    const lower = clause.toLowerCase();
    if (INCOME_WORDS.some((w) => lower.includes(w))) {
      income = amount;
      continue;
    }
    const words = lower.match(/[a-z]+/g) || [];
    const word = words.find((w) => CATEGORY_SYNONYMS[w]);
    if (word) allocations.push({ category: CATEGORY_SYNONYMS[word], amount });
  }
  return { income, allocations };
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/** Formats a Date as its own local calendar day ("YYYY-MM-DD"), not the
 * day it falls on in UTC. `new Date(y, m, d).toISOString()` silently rolls
 * a locally-constructed midnight back a full day in any timezone ahead of
 * UTC (India included) — "by December 2026" was rendering as "30
 * November" before this fix, a deterministic off-by-one every time, not
 * an edge case. */
function toLocalIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Best-effort target-date parsing for a savings goal — "by December",
 * "by December 2026", "in 6 months", "in 1 year". Modest on purpose: this
 * is a convenience default, not a hard requirement (a goal with no parsed
 * date just tracks progress without a deadline). */
function parseTargetDate(text: string): string | undefined {
  const t = text.toLowerCase();
  const monthMatch = t.match(new RegExp(`\\b(${MONTHS.join('|')})\\b(?:\\s+(\\d{4}))?`));
  if (monthMatch) {
    const monthIdx = MONTHS.indexOf(monthMatch[1]);
    const now = new Date();
    let year = monthMatch[2] ? parseInt(monthMatch[2], 10) : now.getFullYear();
    if (!monthMatch[2] && monthIdx < now.getMonth()) year += 1;
    return toLocalIsoDate(new Date(year, monthIdx, 1));
  }
  const relMatch = t.match(/\bin\s+(\d+)\s*(month|months|year|years)\b/);
  if (relMatch) {
    const n = parseInt(relMatch[1], 10);
    const d = new Date();
    if (relMatch[2].startsWith('month')) d.setMonth(d.getMonth() + n);
    else d.setFullYear(d.getFullYear() + n);
    return toLocalIsoDate(d);
  }
  return undefined;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A raw "for X"/"to buy X" capture can carry the amount along with it
 * ("for a 800000 lakhs car" — the price sits inside the target's own
 * description, not before it) — strip any number+unit tokens back out so
 * the goal name is just "Car", not "800000 Lakhs Car". */
function cleanGoalName(raw: string): string {
  let name = raw.replace(/\b[\d,]+(?:\.\d+)?\s*(?:k|thousand|lakhs?|l|crores?|cr)?\b/gi, '');
  name = name.replace(/\s{2,}/g, ' ').trim();
  return name;
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

// A broad "this message is finance-flavored" signal, used only in two
// places below: to gate the riskiest parse (a bare single category+number
// clause, which could coincidentally match unrelated text) and as the
// final "say something rather than nothing" fallback. Every other check
// below is self-contained and runs regardless of this list, since requests
// like "save X for Y" or "connect my bank account" don't use any of these
// words but are unambiguously finance requests on their own.
const FINANCE_NOUNS = [
  'budget', 'expense', 'expenses', 'spending', 'spend', 'spent', 'saving', 'savings',
  'save', 'income', 'earn', 'earning', 'salary', 'goal', 'goals', 'fund', 'invest', 'investment',
];

const SUMMARY_PATTERNS = [
  /\bhow much (?:have i|did i|do i)\s+spen[dt]\b/i,
  /\bwhat.?s my (?:spending|budget)\b/i,
  /\bwhats my (?:spending|budget)\b/i,
  // Bounded to the same sentence ([^.?!]* rather than .*) so "show me my
  // budget" still matches but doesn't reach across unrelated clauses;
  // broad enough to also catch "give me my last month expenses", where
  // "last month" sits between "my" and "expenses".
  /\b(?:show|give)(?: me)? my\b[^.?!]*\b(?:spending|budget|expenses)\b/i,
  /\bbiggest (?:expense|category)\b/i,
  /\btop category\b/i,
  /\bcompare (?:my )?spending\b/i,
  /\b(?:left|remaining)\b.*\b(?:budget|month)\b/i,
  /\b(?:budget|month)\b.*\b(?:left|remaining)\b/i,
];

const PORTFOLIO_PATTERNS = [
  /\bportfolio\b/i,
  /\b(?:financial|finance) overview\b/i,
  /\boverview of my finances\b/i,
];

// Standalone dashboard-widget requests — checked before SUMMARY_PATTERNS
// since that broader "show/give me my ... expenses" pattern would
// otherwise swallow "give me my expenses breakdown" too.
const EXPENSES_BREAKDOWN_PATTERNS = [
  /\bexpenses?\s+breakdown\b/i,
  /\bspending breakdown\b/i,
  /\bcategory breakdown\b/i,
  /\bbreakdown of my (?:expenses|spending)\b/i,
  /\bwhere (?:did|does|is|are) my money (?:go|going)\b/i,
];
const CASH_FLOW_PATTERNS = [
  /\bcash\s*flow\b/i,
  /\bincome (?:vs\.?|versus|and) expenses?\b/i,
];
const BUDGET_UTILIZATION_PATTERNS = [
  /\bbudget utili[sz]ation\b/i,
  /\bbudget usage\b/i,
  /\bhow much of my budget\b/i,
  /\b(?:%|percent) of (?:my )?budget\b/i,
  /\bhow much (?:have i|did i) used? of my budget\b/i,
];
const RECENT_EXPENSES_PATTERNS = [
  /\brecent (?:expenses?|transactions?|spending)\b/i,
  /\bmy transactions\b/i,
  /\btransaction history\b/i,
  /\blast few expenses\b/i,
];

// Deliberately checked before the plain "goal" checks below — "how do I
// achieve my goal to save 1 lakh" contains the word "goal" but is asking
// for a feasibility plan, not to create or list one.
const GOALS_ANALYSIS_PATTERNS = [
  /\bgoals?\s+analysis\b/i,
  /\banalyz(?:e|ing) my goals?\b/i,
  /\bplan (?:for|to reach) my\b/i,
  /\bam i on track\b/i,
];

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prevDiag = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prevDiag : 1 + Math.min(prevDiag, dp[j], dp[j - 1]);
      prevDiag = temp;
    }
  }
  return dp[n];
}

// "how do i eachieve my car goal" ("eachieve" a plain typo for "achieve")
// was silently falling through to list_goals, because a rigid keyword
// alternation doesn't match a misspelling — same class of bug the doctor
// lookup had to fix earlier for names. Distance tolerance scales with word
// length so short words (hit/meet) don't fuzzy-match half the dictionary.
const ACHIEVE_WORDS = ['achieve', 'reach', 'hit', 'meet', 'attain'];
function hasAchieveVerb(words: string[]): boolean {
  return words.some((w) => ACHIEVE_WORDS.some((target) => {
    const maxDist = target.length <= 4 ? 1 : 2;
    return levenshtein(w, target) <= maxDist;
  }));
}
function isAskingHowToReachGoal(query: string, words: string[]): boolean {
  const hasHowPrefix = /\bhow\s+(?:can|do)\s+i\b/i.test(query) || /\bhow\s+to\b/i.test(query);
  if (!hasHowPrefix) return false;
  if (hasAchieveVerb(words) || /\bsave for\b/i.test(query)) return true;
  // "plan" on its own isn't a safe achieve-synonym to add to ACHIEVE_WORDS
  // — "how do I plan a trip to Goa" would then misfire into this finance
  // check too. Only count "plan" here when the message is unambiguously
  // about saving/a goal as well ("how can I plan saving 1 lakh for my
  // bike" — a real request for a savings plan, not a trip).
  const mentionsPlanVerb = words.some((w) => levenshtein(w, 'plan') <= 1);
  const mentionsSaveOrGoal = /\bsave\b|\bsaving\b|\bsavings\b|\bgoal\b|\bgoals\b|\bfund\b/i.test(query);
  return mentionsPlanVerb && mentionsSaveOrGoal;
}

/** The "on X" phrase that determines the category is usually the whole
 * note too ("spent 4000 on rent" -> note "rent"), which reads as pure
 * duplication next to a category badge that already says Rent. Strips the
 * word that triggered the category match plus common trailing filler
 * ("today", "this month"), keeping only whatever's left as genuinely
 * additional context ("dinner with friends" -> "with friends" survives). */
function cleanExpenseNote(raw: string | undefined, categoryWord: string | undefined): string | undefined {
  if (!raw) return undefined;
  let note = raw.trim();
  if (categoryWord) note = note.replace(new RegExp(`\\b${categoryWord}\\b`, 'i'), '').trim();
  note = note.replace(/\b(today|yesterday|tomorrow|this month|this week|last month|last week)\b/gi, '').trim();
  note = note.replace(/\s{2,}/g, ' ').trim();
  return note || undefined;
}

/** Chat-box entry point for the finance agent — checked before parseIntent
 * the same way detectAppointmentsQuery/detectDoctorLookup are: a different
 * kind of request, no LLM call, and (unlike a symptom or a destination
 * name) numbers here must be extracted exactly right rather than
 * paraphrased, which a deterministic parser guarantees and an LLM doesn't.
 *
 * Each pattern below is checked independently rather than behind one
 * shared "looks financial" gate — a shared gate word list can never cover
 * every real phrasing ("save for a laptop", "add to my fund", "connect my
 * bank account" don't share a single common noun), and the earlier version
 * of this function silently let those fall through to the travel LLM. */
export function detectFinanceQuery(query: string): FinanceQuery | undefined {
  const words: string[] = query.toLowerCase().match(/[a-z]+/g) || [];

  if (/\bbank account\b/i.test(query) || /\b(link|connect|sync)\b.*\bbank\b/i.test(query)) {
    return { kind: 'unsupported', action: 'connect a bank account' };
  }
  // Mentioning stocks/mutual funds/crypto isn't itself a request for
  // advice — "10000 investments in mutual funds" is just a budget line
  // item (see CATEGORY_SYNONYMS: it maps to Savings). Only decline when
  // the message actually asks for a recommendation or opinion.
  const mentionsInvestmentTerms = /\b(invest(?:ing)?|stocks?|stock market|mutual funds?|crypto(?:currency)?)\b/i.test(query);
  const asksForAdvice = /\b(should i|which (?:stocks?|funds?|crypto)|what (?:stocks?|funds?)|recommend|suggest|advice|good (?:idea|time|stocks?)|worth (?:it|buying)|best (?:stocks?|funds?|crypto))\b/i.test(query);
  if (mentionsInvestmentTerms && asksForAdvice) {
    return { kind: 'unsupported', action: 'give investment advice' };
  }
  if (/\b(delete|remove)\b/i.test(query) && /\b(expense|expenses|goal|goals|budget|category)\b/i.test(query)) {
    return { kind: 'unsupported', action: 'delete a saved record' };
  }

  if (PORTFOLIO_PATTERNS.some((p) => p.test(query))) {
    return { kind: 'portfolio' };
  }
  if (EXPENSES_BREAKDOWN_PATTERNS.some((p) => p.test(query))) {
    return { kind: 'expenses_breakdown' };
  }
  if (CASH_FLOW_PATTERNS.some((p) => p.test(query))) {
    return { kind: 'cash_flow' };
  }
  if (BUDGET_UTILIZATION_PATTERNS.some((p) => p.test(query))) {
    return { kind: 'budget_utilization' };
  }
  if (RECENT_EXPENSES_PATTERNS.some((p) => p.test(query))) {
    return { kind: 'recent_expenses' };
  }

  if (GOALS_ANALYSIS_PATTERNS.some((p) => p.test(query)) || isAskingHowToReachGoal(query, words)) {
    // Best-effort name extraction: "my <name> goal/fund" first (more
    // specific), else "<name> goal/fund" anywhere in the message.
    const nameMatch = query.match(/\bmy\s+([a-z][a-z\s]*?)\s+(?:goal|fund)\b/i) || query.match(/\b([a-z][a-z\s]*?)\s+(?:goal|fund)\b/i);
    let goalName = nameMatch?.[1] ? cleanGoalName(nameMatch[1]) : undefined;
    // A richer "for/to save X <name> [by <date>]" capture, for the ad-hoc
    // case where the amount/deadline live in this same message rather
    // than in an already-saved goal (see cleanGoalName's own comment —
    // the amount often sits inside the target's own description). Mirrors
    // set_goal's own name regex (bare "for" included) so "plan saving 1
    // lakh for my bike" extracts "bike" the same way "save 1 lakh for a
    // bike" would when actually creating the goal.
    const adHocNameMatch = query.match(
      /(?:\bfor\b|\bto\s+save\b|\bto\s+buy\b|\bto\s+get\b|\bto\s+purchase\b)\s+(?:a\s+|an\s+|my\s+)?([a-z0-9][a-z0-9\s]*?)(?:\s+by\s+(.+?))?[.?!]*$/i
    );
    if (adHocNameMatch?.[1]) {
      const cleaned = cleanGoalName(adHocNameMatch[1]);
      if (cleaned) goalName = cleaned;
    }
    const adHocAmount = parseAmount(query);
    const adHocTargetDate = adHocNameMatch?.[2] ? parseTargetDate(adHocNameMatch[2]) : undefined;
    return {
      kind: 'goals_analysis',
      goalName: goalName ? titleCase(goalName) : undefined,
      adHocAmount,
      adHocTargetDate,
    };
  }

  if (SUMMARY_PATTERNS.some((p) => p.test(query))) {
    const period: 'this_month' | 'last_month' | 'all' =
      /\blast month\b/i.test(query) ? 'last_month' : /\ball time\b|\boverall\b|\btotal ever\b/i.test(query) ? 'all' : 'this_month';
    const question: 'total' | 'biggest' | 'compare' | 'remaining' =
      /\bcompare\b/i.test(query) ? 'compare'
        : /\bbiggest\b|\btop category\b/i.test(query) ? 'biggest'
        : /\bleft\b|\bremaining\b/i.test(query) ? 'remaining'
        : 'total';
    const categoryWord = words.find((w) => CATEGORY_SYNONYMS[w]);
    return { kind: 'summary', period, question, category: categoryWord ? CATEGORY_SYNONYMS[categoryWord] : undefined };
  }

  // Covers "save 50000 for a laptop" as well as "I want to keep a goal to
  // buy a car", "set a goal for a bike", "goal to get a new phone" — real
  // phrasings for the same request that don't all share "save...for".
  const isGoalTalk = /\bsave\b|\bsaving\b/i.test(query) || /\bgoal\b/i.test(query);
  if (isGoalTalk) {
    const amount = parseAmount(query);
    const nameMatch = query.match(
      /(?:\bfor\b|\bto\s+buy\b|\bto\s+get\b|\bto\s+purchase\b)\s+(?:a\s+|an\s+|my\s+)?([a-z0-9][a-z0-9\s]*?)(?:\s+by\s+(.+?))?[.?!]*$/i
    );
    const name = nameMatch?.[1] ? cleanGoalName(nameMatch[1]) : '';
    if (amount !== undefined && name) {
      return {
        kind: 'set_goal',
        name: titleCase(name),
        targetAmount: amount,
        targetDate: nameMatch![2] ? parseTargetDate(nameMatch![2]) : undefined,
      };
    }
  }

  if (/\badd\b/i.test(query) && /\bto\b/i.test(query) && /\b(fund|goal|savings)\b/i.test(query)) {
    const amount = parseAmount(query);
    const nameMatch = query.match(/\bto\s+(?:my\s+)?([a-z][a-z\s]*?)(?:\s+fund\b|\s+goal\b|\s+savings\b)?[.?!]*$/i);
    if (amount !== undefined) return { kind: 'contribute_goal', name: nameMatch?.[1]?.trim(), amount };
  }

  if (/\bgoals?\b/i.test(query) && /\b(show|list|view|see|what|my)\b/i.test(query) && !/\bfor\b/i.test(query)) {
    return { kind: 'list_goals' };
  }

  if (/\b(spent|paid)\b/i.test(query)) {
    const amount = parseAmount(query);
    if (amount !== undefined) {
      const word = words.find((w) => CATEGORY_SYNONYMS[w]);
      const noteMatch = query.match(/\bon\s+([a-z][a-z\s]{1,30})/i);
      return { kind: 'log_expense', amount, category: word ? CATEGORY_SYNONYMS[word] : 'Other', note: cleanExpenseNote(noteMatch?.[1], word) };
    }
  }

  const hasFinanceNoun = words.some((w) => FINANCE_NOUNS.includes(w));
  const budget = parseBudgetStatement(query);
  // A single category+number clause is the riskiest pattern to accept
  // unconditionally (plenty of non-finance sentences pair a word and a
  // number), so it's gated on an explicit finance word; an income figure
  // or 2+ categories in one message is unambiguous enough on its own.
  if (budget.income !== undefined || budget.allocations.length >= 2 || (budget.allocations.length === 1 && hasFinanceNoun)) {
    return { kind: 'set_budget', income: budget.income, allocations: budget.allocations };
  }

  // A finance word was present but nothing else matched confidently —
  // report that plainly instead of letting it fall through to the travel
  // LLM, which would have no sensible way to answer it. No finance word at
  // all means this was never a finance message to begin with.
  return hasFinanceNoun ? { kind: 'unclear' } : undefined;
}
