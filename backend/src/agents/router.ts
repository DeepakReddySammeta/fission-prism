/**
 * The router. One LLM call reads the user's message and decides which tool the
 * server should run, with its arguments — there is no keyword/regex layer in
 * front of it and no ordering between domains to get wrong. Adding a
 * capability means adding a tool to the prompt below and a case in
 * /api/plan's switch, nothing else.
 *
 * The model classifies and extracts; it never produces user data. Amounts,
 * dates and names it pulls out of the message are re-validated here before
 * anything downstream writes them to the database (see toRoute).
 */
import { generateJSON } from '../llm';
import { LLM_ROUTER_MODEL } from '../config';
import { DOCTORS, SPECIALTIES } from '../mock/doctors';
import { CATEGORIES, normalizeCategory, type FinanceQuery } from './finance';

/** A chat-asked "my plans"/"my bookings" lookup against the user's own saved
 * trips — `reference` is set when they named one ("my Kerala trip") rather
 * than asking for the whole list. */
export interface MyRecordsIntent {
  recordType: 'plans' | 'bookings';
  filter: 'upcoming' | 'past' | 'all';
  reference?: string;
  /** The same three-way split the My Bookings page's own tabs use: a saved
   * trip with both a flight and a room is 'trips', flight-only is 'flights',
   * room-only is 'rooms'. Undefined means show everything. */
  bookingType?: 'trips' | 'flights' | 'rooms';
}

/** A chat-asked "my appointments" lookup. 'unsupported' covers cancel/
 * reschedule, which this app has no flow for — declined plainly rather than
 * silently showing the list instead. */
export type AppointmentsQuery =
  | { kind: 'list'; filter: 'upcoming' | 'past' | 'today' | 'all'; reference?: string }
  | { kind: 'unsupported'; action: string };

export interface TripArgs {
  intent: 'plan_trip' | 'browse_flights' | 'browse_hotels';
  origin?: string;
  destination: string;
  durationNights?: number;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  children?: number;
  /** True when the message says book/reserve rather than show/plan — drives
   * auto-picking one flight and one room instead of listing everything. */
  wantsBooking?: boolean;
  flightTargetTime?: string;
  flightQuery?: string;
  hotelQuery?: string;
}

export type Route =
  | { tool: 'trip'; summary: string; trip: TripArgs }
  | { tool: 'destinations'; summary: string; destinations: { region: string; season?: string; durationNights?: number } }
  | { tool: 'weather'; summary: string; weather: { place: string } }
  | { tool: 'doctors'; summary: string; doctors: { symptom?: string; specialty?: string; ageGroup?: 'child' | 'adult' | 'senior' } }
  | { tool: 'doctor_lookup'; summary: string; doctor_lookup: { doctorName: string; view: 'profile' | 'book'; preferredDate?: string; preferredTime?: string } }
  | { tool: 'hotel_rooms'; summary: string; hotel_rooms: { hotelName: string } }
  | { tool: 'my_records'; summary: string; my_records: MyRecordsIntent }
  | { tool: 'appointments'; summary: string; appointments: AppointmentsQuery }
  | { tool: 'finance'; summary: string; finance: FinanceQuery }
  | { tool: 'books'; summary: string; books: { query: string } }
  | { tool: 'movies'; summary: string; movies: { query: string } }
  /** Off-topic, too vague, or missing something a tool needs — `summary` is
   * the question back to the user, or the honest "I can't do that". */
  | { tool: 'clarify'; summary: string };

/** Which of the three sidebar "apps" a tool belongs to. The router already
 * knows this, so the frontend doesn't have to re-classify the raw query with
 * its own keyword list — it just reads what ran. */
export const APP_OF: Record<Route['tool'], 'trip' | 'health' | 'finance' | 'books' | 'movies' | null> = {
  trip: 'trip', destinations: 'trip', weather: 'trip', hotel_rooms: 'trip', my_records: 'trip',
  doctors: 'health', doctor_lookup: 'health', appointments: 'health',
  finance: 'finance',
  books: 'books',
  movies: 'movies',
  clarify: null,
};

/* -------------------------------- prompt -------------------------------- */

function instructions(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are the router for an assistant that plans India-focused domestic trips, finds doctors and manages appointments, and tracks personal finances. You never speak to the user in prose — your entire output is one JSON object the server executes.

Today is ${today}.

Pick exactly ONE tool:
{ "tool": "<tool>", "summary": "<one short sentence shown to the user above the result>", "<tool>": { ...that tool's arguments } }
Include the argument object for the chosen tool only, named exactly as the tool. Never invent flights, hotels, prices, doctors or amounts — other agents produce those after you run.

TOOLS

trip — flights and/or a stay for a real journey.
  { "intent": "plan_trip" | "browse_flights" | "browse_hotels", "origin": string?, "destination": string,
    "durationNights": number?, "checkIn": "YYYY-MM-DD"?, "checkOut": "YYYY-MM-DD"?,
    "adults": number?, "children": number?, "wantsBooking": boolean?,
    "flightTargetTime": "HH:MM"?, "flightQuery": string?, "hotelQuery": string? }
  "plan_trip" when both an origin and a destination are named, "browse_flights" for flights only, "browse_hotels" for stays only.
  Normalise Indian city names to their modern form: Bangalore->Bengaluru, Bombay->Mumbai, Calcutta->Kolkata, Madras->Chennai, Trivandrum->Thiruvananthapuram, Pondicherry->Puducherry, Mysore->Mysuru, Gurgaon->Gurugram.
  Resolve relative dates against today's date; "the weekend"/"next weekend" means the coming Saturday and Sunday.
  "wantsBooking" is true when they say book/reserve, false for show/plan/find.
  "flightTargetTime" is a clock time they gave for the flight; "flightQuery"/"hotelQuery" name a specific airline/flight/hotel to pick out of the results ("book the IndiGo flight").
  Use clarify instead if no destination is named, or if flights are wanted but no origin is.

destinations — inspiration rather than a search: "where should I go", "best places to visit in Kerala in monsoon".
  { "region": string, "season": string?, "durationNights": number? }

weather — "what's the weather in Goa", "Delhi weather tomorrow", "how hot is it in Chennai".
  { "place": string }

doctors — a symptom or specialty search: "I have chest pain", "find me a dentist for my 5-year-old".
  { "symptom": string?, "specialty": string?, "ageGroup": "child" | "adult" | "senior"? }
  Map the symptom to the closest specialty, one of: ${SPECIALTIES.join(', ')}.

doctor_lookup — the message names ONE specific doctor: "who is Dr Pooja Hegde", "View profile for Dr. Karthik Rao", "book an appointment with dr kartik rao tomorrow at 4pm".
  { "doctorName": string, "view": "profile" | "book", "preferredDate": "YYYY-MM-DD"?, "preferredTime": "H:MM AM/PM"? }
  "book" when they want to book, otherwise "profile".
  The roster is exactly these doctors — return the name spelled as it appears here, correcting whatever misspelling the user typed ("dr kartik rao" -> "Dr. Karthik Rao"): ${DOCTORS.map((d) => d.name).join(', ')}.
  If the name they typed is nobody on that list, use clarify and say so.

hotel_rooms — the message names ONE specific hotel and wants its rooms: "View rooms at Sunset Bay Hotel", "give me the details of sunset bay".
  { "hotelName": string }

my_records — the user's own saved trips/bookings: "my plans", "my upcoming bookings", "details of my Kerala trip", "my flight-only bookings".
  { "recordType": "plans" | "bookings", "filter": "upcoming" | "past" | "all", "reference": string?, "bookingType": "trips" | "flights" | "rooms"? }
  "bookings" only when they say booking/reservation/booked. "reference" is the trip they named ("kerala").

appointments — the user's own booked doctor appointments: "my appointments", "anything today", "past appointments with Dr Rao".
  { "kind": "list", "filter": "upcoming" | "past" | "today" | "all", "reference": string? }
  Cancelling or rescheduling is not supported: { "kind": "unsupported", "action": "cancel" }.

finance — anything about the user's own money. Exactly one of these argument shapes:
  { "kind": "set_budget", "income": number?, "allocations": [{ "category": <category>, "amount": number }] }  — "I earn 60000, rent is 20000, 8000 food"
  { "kind": "log_expense", "amount": number, "category": <category>, "note": string? }  — "spent 500 on groceries"
  { "kind": "set_goal", "name": string, "targetAmount": number, "targetDate": "YYYY-MM-DD"? }  — "save 50000 for a laptop by December"
  { "kind": "contribute_goal", "name": string?, "amount": number }  — "put 5000 into my laptop goal"
  { "kind": "list_goals" }  — "my savings goals"
  { "kind": "goals_analysis", "goalName": string?, "adHocAmount": number?, "adHocTargetDate": "YYYY-MM-DD"? }  — "are my goals achievable", "how can I plan saving 1 lakh for my bike" (goalName "bike", adHocAmount 100000)
  { "kind": "summary", "period": "this_month" | "last_month" | "all", "question": "total" | "biggest" | "compare" | "remaining", "category": <category>? }  — "how much have I spent this month", "what's my biggest expense", "am I spending more than last month"
  { "kind": "portfolio" }  — "my finances", "financial overview"
  { "kind": "expenses_breakdown" }  — "where does my money go"
  { "kind": "cash_flow" }  — "income vs expenses over time"
  { "kind": "budget_utilization" }  — "how much of my budget have I used"
  { "kind": "recent_expenses" }  — "my recent transactions"
  { "kind": "unsupported", "action": "<what they asked for>" }  — connecting a bank, paying a bill, investment advice
  Amounts: "60k" -> 60000, "1 lakh"/"1L" -> 100000, "5,00,000" -> 500000. Always a plain number.
  Categories: ${CATEGORIES.join(', ')}. Use "Other" when nothing fits.

books — reading recommendations, book search, or anything the user wants to read. "find me books on python", "reading recommendations for personal finance", "who wrote The Alchemist", "what should I read about investing", "search Harry Potter".
  { "query": string }

movies — movie search, recommendations, or anything about films. "find me movies with Tom Hanks", "top rated sci-fi movies", "what's the movie Inception about", "search The Dark Knight".
  { "query": string }

clarify — off-topic, too vague, or missing something a tool needs. No argument object; put the question, or the honest "I can't do that yet", in "summary".

"summary" is what the user reads. Write it as the assistant would speak: warm, one sentence, no markdown.`;
}

/* ------------------------------ validation ------------------------------ */

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Positive finite number, tolerating a numeric string ("60000", "₹500"). */
function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v.replace(/[^\d.]/g, '')) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

const iso = (v: unknown): string | undefined =>
  (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

/** Everything the finance tool can write to the database goes through here
 * first: an amount the model didn't actually find in the message must never
 * become a row. A shape missing its required fields degrades to 'unclear',
 * which answers with the "here's what I can do" hint rather than a silent
 * no-op or a bogus write. */
function toFinance(a: any): FinanceQuery {
  const kind = a?.kind;
  switch (kind) {
    case 'set_budget': {
      const income = num(a.income);
      const allocations = (Array.isArray(a.allocations) ? a.allocations : [])
        .map((x: any) => ({ category: normalizeCategory(str(x?.category)), amount: num(x?.amount) }))
        .filter((x: any): x is { category: any; amount: number } => x.amount !== undefined);
      if (income === undefined && allocations.length === 0) return { kind: 'unclear' };
      return { kind: 'set_budget', income, allocations };
    }
    case 'log_expense': {
      const amount = num(a.amount);
      if (amount === undefined) return { kind: 'unclear' };
      return { kind: 'log_expense', amount, category: normalizeCategory(str(a.category)), note: str(a.note) };
    }
    case 'set_goal': {
      const name = str(a.name);
      const targetAmount = num(a.targetAmount);
      if (!name || targetAmount === undefined) return { kind: 'unclear' };
      return { kind: 'set_goal', name, targetAmount, targetDate: iso(a.targetDate) };
    }
    case 'contribute_goal': {
      const amount = num(a.amount);
      if (amount === undefined) return { kind: 'unclear' };
      return { kind: 'contribute_goal', name: str(a.name), amount };
    }
    case 'goals_analysis':
      return {
        kind: 'goals_analysis',
        goalName: str(a.goalName),
        adHocAmount: num(a.adHocAmount),
        adHocTargetDate: iso(a.adHocTargetDate),
      };
    case 'summary':
      return {
        kind: 'summary',
        period: oneOf(a.period, ['this_month', 'last_month', 'all'] as const, 'this_month'),
        question: oneOf(a.question, ['total', 'biggest', 'compare', 'remaining'] as const, 'total'),
        category: a.category ? normalizeCategory(str(a.category)) : undefined,
      };
    case 'unsupported':
      return { kind: 'unsupported', action: str(a.action) || 'do that' };
    case 'list_goals':
    case 'portfolio':
    case 'expenses_breakdown':
    case 'cash_flow':
    case 'budget_utilization':
    case 'recent_expenses':
      return { kind };
    default:
      return { kind: 'unclear' };
  }
}

/** Shown when the model answered but its answer named no runnable tool — a
 * genuine "I don't understand you". */
const FALLBACK = "I didn't quite catch that — try naming a trip (\"Hyderabad to Goa next weekend\"), a symptom, or something about your budget.";

/** Shown when the LLM call itself failed (no key, timeout, rate limit). The
 * user's message was very likely fine, so saying "I didn't catch that" would
 * blame them for an outage and invite them to rephrase something that needs
 * no rephrasing. */
const UNAVAILABLE = "I couldn't reach my language model just now, so I haven't read your message yet — please try again in a moment.";

/** Coerces the model's raw JSON into a Route. Anything missing the argument
 * its tool can't run without falls back to clarify, so a bad generation asks
 * a question instead of half-running a tool. */
export function toRoute(raw: any): Route {
  const summary = str(raw?.summary) || FALLBACK;
  const args = raw?.[raw?.tool] ?? {};

  switch (raw?.tool) {
    case 'trip': {
      const destination = str(args.destination);
      const origin = str(args.origin);
      const intent = oneOf(args.intent, ['plan_trip', 'browse_flights', 'browse_hotels'] as const, 'plan_trip');
      if (!destination) return { tool: 'clarify', summary };
      // A flights search with no origin can't run (getFlightOptions needs a
      // from-city), so ask rather than emitting an empty screen.
      if (!origin && intent !== 'browse_hotels') {
        return { tool: 'clarify', summary: `Which city are you flying from to ${destination}?` };
      }
      return {
        tool: 'trip',
        summary,
        trip: {
          intent, origin, destination,
          durationNights: num(args.durationNights),
          checkIn: iso(args.checkIn),
          checkOut: iso(args.checkOut),
          adults: num(args.adults),
          children: typeof args.children === 'number' && args.children > 0 ? args.children : undefined,
          wantsBooking: args.wantsBooking === true,
          flightTargetTime: str(args.flightTargetTime),
          flightQuery: str(args.flightQuery),
          hotelQuery: str(args.hotelQuery),
        },
      };
    }
    case 'destinations': {
      const region = str(args.region);
      return region
        ? { tool: 'destinations', summary, destinations: { region, season: str(args.season), durationNights: num(args.durationNights) } }
        : { tool: 'clarify', summary };
    }
    case 'weather': {
      const place = str(args.place);
      return place ? { tool: 'weather', summary, weather: { place } } : { tool: 'clarify', summary };
    }
    case 'doctors':
      return {
        tool: 'doctors',
        summary,
        doctors: {
          symptom: str(args.symptom),
          specialty: str(args.specialty),
          ageGroup: args.ageGroup ? oneOf(args.ageGroup, ['child', 'adult', 'senior'] as const, 'adult') : undefined,
        },
      };
    case 'doctor_lookup': {
      const doctorName = str(args.doctorName);
      return doctorName
        ? {
            tool: 'doctor_lookup',
            summary,
            doctor_lookup: {
              doctorName,
              view: oneOf(args.view, ['profile', 'book'] as const, 'profile'),
              preferredDate: iso(args.preferredDate),
              preferredTime: str(args.preferredTime),
            },
          }
        : { tool: 'clarify', summary };
    }
    case 'hotel_rooms': {
      const hotelName = str(args.hotelName);
      return hotelName ? { tool: 'hotel_rooms', summary, hotel_rooms: { hotelName } } : { tool: 'clarify', summary };
    }
    case 'my_records':
      return {
        tool: 'my_records',
        summary,
        my_records: {
          recordType: oneOf(args.recordType, ['plans', 'bookings'] as const, 'plans'),
          filter: oneOf(args.filter, ['upcoming', 'past', 'all'] as const, 'all'),
          reference: str(args.reference),
          bookingType: args.bookingType ? oneOf(args.bookingType, ['trips', 'flights', 'rooms'] as const, 'trips') : undefined,
        },
      };
    case 'appointments':
      return {
        tool: 'appointments',
        summary,
        appointments: args.kind === 'unsupported'
          ? { kind: 'unsupported', action: str(args.action) || 'change' }
          : { kind: 'list', filter: oneOf(args.filter, ['upcoming', 'past', 'today', 'all'] as const, 'all'), reference: str(args.reference) },
      };
    case 'books': {
      const query = str(args.query);
      return query ? { tool: 'books', summary, books: { query } } : { tool: 'clarify', summary };
    }
    case 'movies': {
      const query = str(args.query);
      return query ? { tool: 'movies', summary, movies: { query } } : { tool: 'clarify', summary };
    }
    case 'finance':
      return { tool: 'finance', summary, finance: toFinance(args) };
    default:
      return { tool: 'clarify', summary };
  }
}

const ROUTE_TIMEOUT_MS = 8_000;

/** The single entry point for "what does this message want". Returns clarify
 * (never throws) when the LLM is off or the call fails — there is no
 * heuristic second guess, so a routing failure asks the user rather than
 * quietly guessing a domain. */
export async function routeQuery(query: string): Promise<Route> {
  // Its own model (see GROQ_ROUTER_MODEL) so classification and the content/
  // layout agents don't compete for one rate-limit budget, and a low
  // temperature because picking a tool is a decision, not a piece of writing.
  const raw = await generateJSON<any>(instructions(), query, ROUTE_TIMEOUT_MS, {
    model: LLM_ROUTER_MODEL, temperature: 0.1, maxTokens: 700,
  });
  if (!raw) return { tool: 'clarify', summary: UNAVAILABLE };
  return toRoute(raw);
}
