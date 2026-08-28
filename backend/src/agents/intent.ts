import type { ParsedIntent } from '../types';
import { generateJSON } from '../llm';
import { LLM_ENABLED } from '../config';
import { SPECIALTIES } from '../mock/doctors';

const SYSTEM_PROMPT = `You extract structured intent from a user's message, for an app that
does two unrelated things: India-focused domestic trip planning, and finding a doctor by
symptom. You never talk to the user directly — your entire output is the JSON object
described below, consumed by code.

Return JSON matching: { "intent": "plan_trip"|"browse_hotels"|"browse_flights"|"refine"|"find_doctor",
"origin"?: string, "destination": string, "durationNights"?: number,
"agents": ("flights"|"hotels"|"health")[], "checkIn"?: string, "checkOut"?: string,
"flightTargetTime"?: string, "flightQuery"?: string, "hotelQuery"?: string,
"adults"?: number, "children"?: number, "symptom"?: string, "specialty"?: string,
"ageGroup"?: "child"|"adult"|"senior", "summary": string }.
Return exactly these fields — no extra top-level keys, and never invent specific flights,
hotels, prices, or doctor names; those come from other agents that haven't run yet when
you're called.

What you CAN do:
- Classify intent: "plan_trip" when the user names both an origin AND a destination (e.g.
  "Hyderabad to Goa") — include both agents. "browse_hotels" when they only ask about
  hotels/stays — agents:["hotels"]. "browse_flights" when they only ask about flights —
  agents:["flights"].
- Normalize destination/origin to the well-known modern Indian city name even when the
  message uses an older or colloquial name — e.g. "Bangalore" -> "Bengaluru", "Bombay" ->
  "Mumbai", "Calcutta" -> "Kolkata", "Madras" -> "Chennai", "Trivandrum" ->
  "Thiruvananthapuram", "Pondicherry" -> "Puducherry", "Mysore" -> "Mysuru", "Gurgaon" ->
  "Gurugram". This keeps the same place resolving consistently across the rest of the app.
- Extract explicit dates as ISO (YYYY-MM-DD) into checkIn/checkOut, inferring the year as the
  next upcoming occurrence of that date if none is given. If both checkIn and checkOut are
  given, you may also set durationNights to the number of nights between them.
- Extract a booking-time clock reference ("book a flight at 10am", "the 6am flight") into
  flightTargetTime as 24h "HH:MM".
- Extract a named airline/flight number to book ("book the IndiGo flight", "flight 6E-203")
  into flightQuery, or a named hotel within a full trip ("book me into Taj Exotica") into
  hotelQuery.
- Extract a stated traveler count ("for 2 adults", "a family of 4", "for 3 people") into
  adults (and children, if separately mentioned, e.g. "2 adults and 1 child").
- Write "summary" as one short, warm sentence (a travel agent's opening line) reflecting back
  the destination and any origin/dates you understood, setting up the options about to be
  shown. Example: "Planning a 3-night escape to Goa from Hyderabad — here are the best
  flights and stays I found."
- Classify "find_doctor" when the message describes a health symptom/complaint ("migraine for
  2 days", "chest pain", "my stomach hurts", "toothache") or directly asks for a kind of
  doctor/specialist ("I need a cardiologist", "find me a dentist") — agents:["health"],
  destination:"" (this intent has no travel component). Set "symptom" to the complaint
  verbatim (or the named specialty if that's all they gave). Set "specialty" to your best
  inferred category, choosing the closest match from exactly this list: ${SPECIALTIES.join(', ')}
  — always pick one from this list even if imperfect; never invent a specialty not on it.
  Set "ageGroup" only when the message clearly implies one ("my son", "my 6-year-old",
  "my elderly father", "I'm 72") — a specific named symptom (chest pain, migraine, toothache)
  should drive "specialty" on its own; ageGroup there only narrows further. For a vague
  complaint with no specific system named ("my child isn't feeling well", "checkup for my
  father"), ageGroup becomes the primary signal instead — still pick your best "specialty"
  guess (e.g. "General Medicine" is fine here), the matching code applies ageGroup on top.
  Write "summary" as one short, warm sentence acknowledging the complaint and specialty
  found, e.g. "Migraines can be tough — here are neurologists who can help." — see the
  medical-content rules below for what this summary must never do.

What you CANNOT / MUST NOT do:
- Never diagnose, never suggest a cause, never recommend medication, a home remedy, or any
  treatment, and never comment on how serious or minor a symptom sounds — your only medical
  judgment call is which specialty category fits, nothing else. This applies everywhere,
  especially "summary": acknowledge the complaint warmly without evaluating it medically.
- Do not classify "find_doctor" for a message that only mentions a body part or health topic
  in passing without describing an actual complaint or request (e.g. a travel query that
  happens to mention "I have a heart condition so avoid high-altitude places" is still
  "plan_trip" — the message as a whole is asking to plan a trip, not find a doctor).
- Do not guess a destination that was never named or implied. If the message names no place
  at all, or only describes one vaguely ("somewhere warm", "a beach town", "anywhere nice"),
  set intent:"refine", destination:"" (empty string), agents:[], and write a summary that
  asks the user to name a place — do not default to Goa or any other city.
- Do not omit "destination" as a key — always include it, even as "" for the refine case
  above. Every other field marked "?" may be omitted entirely when not applicable; do not
  invent a value for a field the message gives you no basis for.
- Do not treat a vague inspirational question ("best places to visit in monsoon", "where
  should I go this weekend") as a searchable destination — that class of request is handled
  before you're ever called, so if you do see one, treat it exactly like "no place named"
  above rather than inventing a specific city to search.
- Do not mention specific flights, hotel names, room types, or prices in "summary" — you run
  before those searches happen, so anything you say there about numbers would be a guess.
- Do not fabricate a destination outside India unless the user's own message names a place
  outside India — this app only ever searches Indian domestic flights/hotels, but you should
  still faithfully extract whatever the user actually said rather than silently "correcting"
  a real foreign destination to an Indian one.`;

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/** Best-effort extraction of an explicit "12 September" / "September 12" /
 * "2026-09-12" style date. Free-text date parsing is inherently fuzzy, so this
 * only handles the common explicit forms — anything else is left for the
 * room-booking step to default sensibly (today / today+nights). */
function extractDate(q: string): string | undefined {
  const iso = q.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];

  const monthPattern = MONTHS.join('|');
  const dayFirst = q.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})\\b`, 'i'));
  const monthFirst = q.match(new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'));
  const match = dayFirst || monthFirst;
  if (!match) return undefined;

  const day = Number(dayFirst ? match[1] : match[2]);
  const monthName = (dayFirst ? match[2] : match[1]).toLowerCase();
  const month = MONTHS.indexOf(monthName);
  if (month < 0 || day < 1 || day > 31) return undefined;

  const now = new Date();
  let year = now.getFullYear();
  const candidate = new Date(year, month, day);
  if (candidate.getTime() < now.getTime()) year += 1; // roll to next occurrence
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Templated fallback so every response — LLM-generated or not — always has
 * an intro line, matching the project's existing "LLM enhances, heuristics
 * guarantee function" pattern. */
function buildSummary(intent: Pick<ParsedIntent, 'intent' | 'destination' | 'origin' | 'durationNights' | 'specialty'>): string {
  if (intent.intent === 'find_doctor') {
    // Deliberately doesn't repeat the symptom back or comment on it — same
    // "acknowledge, never evaluate" rule the LLM path itself follows.
    return `Here are ${intent.specialty || 'doctors'} you can consult, along with the hospital they practice at.`;
  }
  const dest = titleCase(intent.destination);
  if (intent.intent === 'browse_hotels') {
    return `Here are some great stays in ${dest} — take a look at the options below.`;
  }
  if (intent.intent === 'browse_flights') {
    const origin = intent.origin ? titleCase(intent.origin) : 'your city';
    return `Here are the best flights from ${origin} to ${dest} — pick one to get started.`;
  }
  const nights = intent.durationNights ? ` for ${intent.durationNights} night${intent.durationNights > 1 ? 's' : ''}` : '';
  const origin = intent.origin ? ` from ${titleCase(intent.origin)}` : '';
  return `Planning your trip to ${dest}${origin}${nights} — I've lined up flights and stays for you to compare below.`;
}

/** Phrases that satisfy the destination regexes structurally ("plan a trip
 * for a trip", "somewhere nice") or get echoed back by the LLM, but name no
 * actual place. Anything matching here counts as "no destination given" — the
 * user is asked to name a city instead of being shown a plan for "A Trip". */
const NON_PLACE_PATTERN = /^(a|an|the|my|our|your|some|this|that|next)\s+(trip|holiday|vacation|getaway|tour|journey|break|weekend|week|days?|months?|place|city|town|destination|spot)s?$/;
const NON_PLACE_EXACT = new Set([
  'trip', 'holiday', 'vacation', 'getaway', 'tour', 'journey', 'break', 'holidays',
  'travel', 'travelling', 'traveling', 'somewhere', 'anywhere', 'someplace',
  'me', 'us', 'myself', 'here', 'there', 'now', 'today', 'tomorrow', 'a place',
]);

/** Normalises a raw regex- or LLM-supplied place phrase, returning undefined
 * when it's filler rather than a real place name. */
export function cleanPlace(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().replace(/\s+/g, ' ');
  const key = normalized.toLowerCase();
  if (key.length < 2 || NON_PLACE_EXACT.has(key) || NON_PLACE_PATTERN.test(key)) return undefined;
  return normalized;
}

/** The "tell me where you want to go" nudge, shared by the heuristic and LLM
 * refine paths. Acknowledges an origin city if the user already gave one. */
function buildRefineSummary(origin?: string | null): string {
  const o = cleanPlace(origin);
  return o
    ? `I've got ${titleCase(o)} as your starting point — which city would you like to travel to?`
    : 'Which city would you like to plan for? Name a destination — and where you\'re flying from, if you want flights too — e.g. "trip to Goa from Hyderabad".';
}

/** Best-effort extraction of a clock time the user gave for booking a flight
 * — "10am", "6 am", "2:30pm", "14:00" — returns 24h "HH:MM", or undefined.
 * Checked as 12h-with-meridiem first so "2:30pm" doesn't get misread as the
 * bare 24h "02:30". */
function extractTime(q: string): string | undefined {
  const hm12 = q.match(/\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/i);
  if (hm12) {
    let h = Number(hm12[1]) % 12;
    if (hm12[3].toLowerCase() === 'pm') h += 12;
    const m = hm12[2] ? Number(hm12[2]) : 0;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const hm24 = q.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (hm24) return `${hm24[1].padStart(2, '0')}:${hm24[2]}`;
  return undefined;
}

/** Best-effort extraction of a named flight/airline to book — "book the
 * IndiGo flight", "book flight 6E-203", "reserve the Air India flight" —
 * matched against actual results later, never booked on the strength of
 * this alone. Returns undefined when nothing looks like a flight name. */
function extractFlightQuery(q: string): string | undefined {
  const named = q.match(/\bbook(?:ing)?\b.{0,10}?\b(?:the\s+)?([a-z][\w\s]{1,24}?)\s+flight\b/i);
  if (named) return named[1].trim();
  const numbered = q.match(/\bflight\s*(?:number|no\.?|#)?\s*([a-z]{1,3}[\s-]?\d{2,4})\b/i);
  return numbered ? numbered[1].trim() : undefined;
}

/** Best-effort extraction of a named hotel to book within a full plan_trip
 * message (e.g. "plan a trip to Goa and book me into Taj Exotica") — as
 * opposed to `extractHotelNameQuery` below, which only handles a message
 * that names NO destination at all. */
function extractHotelQuery(q: string): string | undefined {
  const m = q.match(/\bbook(?:ing)?\s+(?:me\s+)?(?:in\s*to|at)\s+(?:the\s+)?([a-z][\w\s]{1,40}?)(?:\s+hotel)?[.,]?\s*$/i)
    || q.match(/\bstay(?:ing)?\s+at\s+(?:the\s+)?([a-z][\w\s]{1,40}?)(?:\s+hotel)?[.,]?\s*$/i);
  return m ? m[1].trim() : undefined;
}

/** True when the message says "book"/"reserve" rather than just "show me"/
 * "plan a trip" — the signal that the traveler wants one option picked and
 * confirmed, not just a list to browse. This is deliberately broader than
 * `flightTargetTime`/`flightQuery`: a query with explicit dates and "book
 * hotel as well" but no clock time should still trigger a pick (falling
 * back to cheapest), not silently do nothing. */
function extractWantsBooking(q: string): boolean {
  return /\bbook(?:ing)?\b|\breserve\b/i.test(q);
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function parseCount(s: string): number | undefined {
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  return NUMBER_WORDS[s.toLowerCase()];
}

/** Best-effort traveler-count extraction — "for 2 adults", "a family of 4",
 * "for 3 people", "2 adults and 1 child". Free-text headcount parsing is
 * inherently fuzzy, so this only covers the common explicit phrasings;
 * anything else falls through to the app's existing default (2 adults). */
function extractPartySize(q: string): { adults?: number; children?: number } {
  const childMatch = q.match(/\b(\d+|one|two|three|four|five)\s+child(?:ren)?\b/i);
  const children = childMatch ? parseCount(childMatch[1]) : undefined;

  const adultMatch = q.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+adults?\b/i);
  if (adultMatch) return { adults: parseCount(adultMatch[1]), children };

  const familyMatch = q.match(/\bfamily of\s+(\d+|one|two|three|four|five|six|seven|eight)\b/i);
  if (familyMatch) return { adults: parseCount(familyMatch[1]), children };

  // "for 3 people/travelers/persons" only counts as a traveler total when
  // it's not immediately followed by "nights"/"days" (a duration clause) —
  // that ambiguity is already handled by the existing nights extraction.
  const peopleMatch = q.match(/\bfor\s+(\d+|one|two|three|four|five|six|seven|eight)\s+(?:people|travell?ers|persons|passengers)\b/i);
  if (peopleMatch) return { adults: parseCount(peopleMatch[1]), children };

  return { children };
}

export interface MyRecordsIntent {
  recordType: 'plans' | 'bookings';
  filter: 'upcoming' | 'past' | 'all';
  /** Set when the message names a specific plan/booking rather than asking
   * for the whole list — "show me details of my Kerala trip" leaves
   * "kerala" here, matched against the user's saved plans by destination or
   * title. Undefined for a bare "my plans"/"my upcoming bookings" query. */
  reference?: string;
  /** The same three-way split the My Bookings page's own tabs use (see
   * MyBookings.tsx): a saved trip with both a flight and a room is 'trips',
   * flight with no room is 'flights', room with no flight is 'rooms'.
   * Undefined means no type was named — show everything, same as the page's
   * default "Full Trips" tab not being forced on chat. */
  bookingType?: 'trips' | 'flights' | 'rooms';
}

/** Optimal-string-alignment edit distance (Levenshtein + adjacent-swap
 * transpositions counted as a single edit), abandoned early once it's
 * certain to exceed `max` — cheap enough to run per word against a short
 * keyword list. Catches the general case (any doubled/missing/swapped/wrong
 * letter, including "plnas" for "plans") instead of patching one specific
 * typo at a time, which a plain regex literal can't do at all: an exact
 * "upcoming" fails outright on "upcomming", and there's no way to
 * special-case every misspelling a real user might type. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prevPrevRow: number[] = [];
  let prevRow = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(row[j - 1] + 1, prevRow[j] + 1, prevRow[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prevPrevRow[j - 2] + 1);
      }
      row.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prevPrevRow = prevRow;
    prevRow = row;
  }
  return prevRow[b.length];
}

/** True when `word` exactly matches, or is a plausible one-typo slip of, one
 * of `candidates`. Short words (<=5 letters) tolerate a 1-character edit;
 * longer ones tolerate 2 — enough for a doubled letter, a dropped letter, or
 * a transposition without also matching genuinely different words. */
function fuzzyIncludes(word: string, candidates: string[]): boolean {
  const maxDist = word.length <= 5 ? 1 : 2;
  return candidates.some((c) => editDistance(word, c, maxDist) <= maxDist);
}

const RECORD_NOUNS = ['plan', 'plans', 'trip', 'trips', 'booking', 'bookings', 'reservation', 'reservations'];
const BOOKING_WORDS = ['booking', 'bookings', 'reservation', 'reservations', 'booked', 'trip', 'trips'];
const UPCOMING_WORDS = ['upcoming', 'future', 'next'];
const PAST_WORDS = ['past', 'previous', 'old', 'history'];
const ROOM_TYPE_WORDS = ['room', 'rooms', 'hotel', 'hotels'];
const FLIGHT_TYPE_WORDS = ['flight', 'flights'];

/** Chat-box equivalent of the "My Plans"/"My Bookings" sidebar links — checked
 * before any LLM call in /api/plan, since this is a navigation request, not
 * a search: no session, no agents, nothing to generate. Deliberately a fuzzy
 * word-level classifier rather than a field on ParsedIntent — a different
 * kind of request entirely, and much faster/more reliable than an LLM round
 * trip for this narrow phrasing (typos and all). */
export function detectMyRecordsIntent(query: string): MyRecordsIntent | undefined {
  const words: string[] = query.toLowerCase().match(/[a-z]+/g) || [];
  // "my" is short enough that fuzzy-matching it risks false positives
  // ("by", "may") — kept as an exact check. The noun ("plans"/"trips"/...)
  // is where typos actually show up, so that's the one worth being tolerant
  // of; "upcoming trip(s)"/"past booking(s)" without "my" still counts too,
  // matching what the sidebar's own "My Bookings" link would show either way.
  const hasMy = words.includes('my');
  const hasRecordNoun = words.some((w) => fuzzyIncludes(w, RECORD_NOUNS));
  const hasUpcoming = words.some((w) => fuzzyIncludes(w, UPCOMING_WORDS));
  const hasPast = words.some((w) => fuzzyIncludes(w, PAST_WORDS));
  if (!hasRecordNoun || !(hasMy || hasUpcoming || hasPast)) return undefined;

  // "Trip(s)"/"booking(s)"/"reservation(s)" read as "the booking I actually
  // have" (My Bookings) — "plan(s)" is the more general saved-for-later
  // sense (My Plans, whether or not it's actually booked yet).
  const recordType: 'plans' | 'bookings' = words.some((w) => fuzzyIncludes(w, BOOKING_WORDS)) ? 'bookings' : 'plans';
  const filter: 'upcoming' | 'past' | 'all' = hasUpcoming ? 'upcoming' : hasPast ? 'past' : 'all';

  // "room"/"hotel" or "flight" narrows to one of the My Bookings page's own
  // tabs (see MyBookings.tsx: full trip = flight+room, flight-only, room-
  // only) — checked before "full trip(s)" since a bare "trip(s)" is already
  // the RECORD_NOUN every records query carries and would otherwise always
  // match here too.
  const hasRoomWord = words.some((w) => fuzzyIncludes(w, ROOM_TYPE_WORDS));
  const hasFlightWord = words.some((w) => fuzzyIncludes(w, FLIGHT_TYPE_WORDS));
  const hasFullTripPhrase = /\b(full|complete)\s+trips?\b/i.test(query);
  const bookingType: 'trips' | 'flights' | 'rooms' | undefined =
    hasRoomWord ? 'rooms' : hasFlightWord ? 'flights' : hasFullTripPhrase ? 'trips' : undefined;

  // Whatever's left after stripping every word this function itself already
  // understood — filler ("show", "me", "of", "details"...), the record noun,
  // the upcoming/past modifier, and the booking-type word — is a best-effort
  // name for a *specific* plan ("show me details of my kerala trip" ->
  // "kerala"), matched later against the user's saved plans by destination/
  // title. Empty means a plain list query. Without this, "show my room
  // bookings" left "room" behind as a reference, which matches no
  // destination and silently ignored the filter (see bookingType above).
  const FILLER = ['show', 'give', 'tell', 'list', 'see', 'view', 'get', 'display', 'what', 'whats',
    'details', 'detail', 'of', 'about', 'on', 'me', 'my', 'the', 'please', 'can', 'you', 'could',
    'is', 'are', 'for', 'a', 'an', 'and'];
  const reference = words
    .filter((w) => !FILLER.includes(w) && !fuzzyIncludes(w, RECORD_NOUNS)
      && !(hasUpcoming && fuzzyIncludes(w, UPCOMING_WORDS)) && !(hasPast && fuzzyIncludes(w, PAST_WORDS))
      && !(hasRoomWord && fuzzyIncludes(w, ROOM_TYPE_WORDS)) && !(hasFlightWord && fuzzyIncludes(w, FLIGHT_TYPE_WORDS))
      && !(hasFullTripPhrase && (w === 'full' || w === 'complete')))
    .join(' ')
    .trim();

  return { recordType, filter, reference: reference || undefined, bookingType };
}

export type AppointmentsQuery =
  | { kind: 'list'; filter: 'upcoming' | 'past' | 'today' | 'all'; reference?: string }
  | { kind: 'unsupported'; action: string };

const APPOINTMENT_NOUNS = ['appointment', 'appointments', 'consultation', 'consultations'];
const TODAY_WORDS = ['today', 'todays'];
const BOOKING_VERBS = ['book', 'booking', 'schedule'];
const APPOINTMENT_ACTION_WORDS = ['cancel', 'reschedule', 'postpone', 'delete', 'remove', 'modify', 'change', 'edit'];

/** Chat-box "show my upcoming appointments" / "do I have anything today" /
 * "past appointments with Dr. Rao" — the health-agent equivalent of
 * detectMyRecordsIntent above, checked the same way (before parseIntent, no
 * LLM call) since this is a direct lookup against the appointments table,
 * not a doctor search. Checked *before* detectDoctorLookup in server.ts —
 * "my appointment with Dr. Rao" would otherwise match that function's own
 * "mentions a doctor" heuristic and get misread as a request to view Dr.
 * Rao's profile instead of the actual booked appointment.
 *
 * A request to cancel/reschedule is recognized but reported as
 * unsupported — this app has no cancellation/rescheduling flow, and
 * silently showing the list instead would look like the request was
 * ignored rather than declined. */
export function detectAppointmentsQuery(query: string): AppointmentsQuery | undefined {
  const words: string[] = query.toLowerCase().match(/[a-z]+/g) || [];
  const hasAppointmentNoun = words.some((w) => fuzzyIncludes(w, APPOINTMENT_NOUNS));
  if (!hasAppointmentNoun) return undefined;

  const actionWord = APPOINTMENT_ACTION_WORDS.find((a) => words.some((w) => fuzzyIncludes(w, [a])));
  if (actionWord) return { kind: 'unsupported', action: actionWord };

  const hasMy = words.includes('my');
  const hasUpcoming = words.some((w) => fuzzyIncludes(w, UPCOMING_WORDS));
  const hasPast = words.some((w) => fuzzyIncludes(w, PAST_WORDS));
  const hasToday = words.some((w) => fuzzyIncludes(w, TODAY_WORDS));

  // "Book my appointment with Dr. Rao" mentions "my" and "appointment" but
  // is a booking request, not a request to list existing ones — defer to
  // detectDoctorLookup/find_doctor unless an explicit time filter makes the
  // "list" reading unambiguous anyway.
  const hasBookingVerb = words.some((w) => fuzzyIncludes(w, BOOKING_VERBS));
  if (hasBookingVerb && !hasUpcoming && !hasPast && !hasToday) return undefined;

  if (!(hasMy || hasUpcoming || hasPast || hasToday)) return undefined;

  const filter: 'upcoming' | 'past' | 'today' | 'all' =
    hasToday ? 'today' : hasUpcoming ? 'upcoming' : hasPast ? 'past' : 'all';

  // Same leftover-words approach as detectMyRecordsIntent's `reference` —
  // "my appointment with dr rao" -> "rao", matched later against the
  // user's own appointments by doctor name.
  const FILLER = ['show', 'give', 'tell', 'list', 'see', 'view', 'get', 'display', 'what', 'whats', 'when',
    'details', 'detail', 'of', 'about', 'on', 'me', 'my', 'the', 'please', 'can', 'you', 'could', 'do',
    'i', 'have', 'any', 'is', 'are', 'for', 'a', 'an', 'and', 'with', 'dr', 'doctor', 'to'];
  const reference = words
    .filter((w) => !FILLER.includes(w) && !fuzzyIncludes(w, APPOINTMENT_NOUNS)
      && !(hasUpcoming && fuzzyIncludes(w, UPCOMING_WORDS)) && !(hasPast && fuzzyIncludes(w, PAST_WORDS))
      && !(hasToday && fuzzyIncludes(w, TODAY_WORDS)))
    .join(' ')
    .trim();

  return { kind: 'list', filter, reference: reference || undefined };
}

const SEASON_WORDS = ['monsoon', 'winter', 'summer', 'spring', 'autumn'];

/** Best-effort season/month extraction — "in monsoon", "in November" —
 * used to tailor destination suggestions, never required. */
function extractSeason(q: string): string | undefined {
  const season = SEASON_WORDS.find((s) => new RegExp(`\\b${s}\\b`, 'i').test(q));
  if (season) return titleCase(season);
  const monthMatch = q.match(new RegExp(`\\b(${MONTHS.join('|')})\\b`, 'i'));
  return monthMatch ? titleCase(monthMatch[1]) : undefined;
}

/** Phrasings that ask "where should I go" rather than naming a destination
 * to search flights/hotels for — deliberately checked before the normal
 * destination-phrase extraction below, since a query like "best places to
 * visit in India in monsoon" would otherwise get misread as a browse_hotels
 * search for the destination "india in monsoon". */
const EXPLORE_PATTERNS = [
  /\bbest places?\b/i, /\bplaces? to visit\b/i, /\bplaces? (?:can|could) i visit\b/i,
  /\bwhere (?:can|should|do) i (?:go|travel|visit)\b/i, /\bwhere to (?:go|travel|visit)\b/i,
  /\btop destinations?\b/i, /\bthings to do\b/i, /\bspots? to (?:visit|see|explore)\b/i,
  /\bplaces? (?:to|worth) (?:explor|see)/i,
];

function isExplorationQuery(q: string): boolean {
  return EXPLORE_PATTERNS.some((p) => p.test(q));
}

/** Best-effort region extraction for an exploration query — strips the
 * season/month clause and any duration clause first (so "in India in
 * monsoon" doesn't swallow "monsoon" into the place name), then looks for an
 * explicit "in <region>". Defaults to "India" — this app's whole domain —
 * when no region is named at all ("best places to visit in monsoon"). */
function extractExplorationRegion(q: string): string {
  let stripped = q;
  SEASON_WORDS.forEach((s) => {
    stripped = stripped.replace(new RegExp(`\\bin\\s+(?:the\\s+)?${s}(?:\\s+season)?\\b`, 'gi'), ' ');
  });
  stripped = stripped.replace(new RegExp(`\\bin\\s+(${MONTHS.join('|')})\\b`, 'gi'), ' ');
  stripped = stripped.replace(/\bfor\s+\d+\s*days?\b/gi, ' ');
  const m = stripped.match(/\bin\s+([a-z][a-z\s]{1,30}?)(?:[.,?]|$)/i);
  return m ? titleCase(m[1].trim()) : 'India';
}

export interface ExplorationIntent {
  region: string;
  season?: string;
  durationNights?: number;
}

/** Chat-box "where should I go" / "best places to visit in X" queries — a
 * different kind of request entirely (inspiration, not a flights/hotels
 * search), so it's checked before parseIntent/the LLM the same way
 * detectMyRecordsIntent is: fast, deterministic, and never at risk of the
 * main plan_trip/browse_* prompt misreading "India in monsoon" as a literal
 * destination string. */
export function detectExplorationIntent(query: string): ExplorationIntent | undefined {
  const q = query.toLowerCase();
  if (!isExplorationQuery(q)) return undefined;
  const region = extractExplorationRegion(q);
  const season = extractSeason(q);
  const nightsMatch = q.match(/(\d+)\s*(night|day)/);
  const durationNights = nightsMatch ? Number(nightsMatch[1]) - (nightsMatch[2] === 'day' ? 1 : 0) : undefined;
  return { region, season, durationNights };
}

/** Best-effort guess at "which hotel might this be naming" when the message
 * has no destination phrase at all — strips common request filler ("give me",
 * "tell me about"...) and leaves whatever's left for the server to try
 * matching against hotels already shown earlier in this run. Never throws
 * and never guesses a city; a wrong/unmatched guess here just falls through
 * to the "which destination did you mean" clarification, same as before. */
function extractHotelNameQuery(q: string): string | undefined {
  const stripped = q
    .replace(/^(?:can you |could you |please )?(?:give me|show me|tell me|i want)\s+/, '')
    .replace(/^(?:the\s+)?details?\s+(?:of|about|on)\s+/, '')
    .replace(/^info(?:rmation)?\s+(?:on|about)\s+/, '')
    .replace(/^about\s+/, '')
    .replace(/^what(?:'s| is)\s+/, '')
    .trim();
  if (!stripped || stripped === q.trim() || stripped.split(/\s+/).length > 6) return undefined;
  return stripped;
}

/** Very small heuristic fallback so intent parsing works even with no LLM key. */
// Symptom/body-part keywords -> specialty, for when there's no LLM to make
// the judgment call. Deliberately narrower and cruder than what the LLM
// prompt can do (no "acknowledge without evaluating" nuance needed here,
// since this path never writes any summary text about the symptom itself)
// — it only has to get the common cases right, the same "heuristic
// guarantees, LLM enhances" bar every other fallback in this file meets.
const SYMPTOM_KEYWORDS: Array<[RegExp, string]> = [
  [/chest pain|heart|palpitat/, 'Cardiology'],
  [/migraine|headache|dizz|seizure/, 'Neurology'],
  [/stomach|abdomen|acid reflux|indigestion|diarrh/, 'Gastroenterology'],
  [/tooth|teeth|dental|gum/, 'Dentistry'],
  [/back pain|knee|joint|fracture|bone/, 'Orthopedics'],
  [/skin|rash|acne/, 'Dermatology'],
  [/ear ache|earache|sinus|sore throat|tonsil/, 'ENT'],
  [/eye|vision|cataract/, 'Ophthalmology'],
  [/pregnan|period|menstrual/, 'Gynecology'],
  [/anxi|stress|depress|can'?t sleep|insomnia/, 'Psychiatry'],
  [/fever|cold|cough|flu|check ?up/, 'General Medicine'],
];
const DOCTOR_REQUEST_WORDS = /\bdoctor\b|\bspecialist\b|\bphysician\b|\bdentist\b|\bappointment\b|\bclinic\b/;

/** Fires before the trip-planning destination logic below so a symptom
 * ("I have chest pain") never gets misread as "please name a city." */
function detectHealthHeuristic(q: string): ParsedIntent | undefined {
  const symptomMatch = SYMPTOM_KEYWORDS.find(([re]) => re.test(q));
  if (!symptomMatch && !DOCTOR_REQUEST_WORDS.test(q)) return undefined;

  const specialty = symptomMatch?.[1] || 'General Medicine';
  const ageGroup: ParsedIntent['ageGroup'] = /\bmy (son|daughter|kid|child|baby)\b|\d\s*-?\s*year-?old (son|daughter|kid|child)/.test(q)
    ? 'child'
    : /\bmy (father|mother|grandfather|grandmother|dad|mom)\b|\belderly\b/.test(q)
      ? 'senior'
      : undefined;

  return {
    intent: 'find_doctor', destination: '', agents: ['health'],
    symptom: q.trim(), specialty, ageGroup,
    summary: buildSummary({ intent: 'find_doctor', destination: '', specialty }),
  };
}

function heuristicIntent(query: string): ParsedIntent {
  const q = query.toLowerCase();
  const health = detectHealthHeuristic(q);
  if (health) return health;

  const nightsMatch = q.match(/(\d+)\s*(night|day)/);
  const durationNights = nightsMatch ? Number(nightsMatch[1]) - (nightsMatch[2] === 'day' ? 1 : 0) : undefined;

  // The negative lookahead keeps "I want to book a trip somewhere nice" from
  // reading "to book..." as if "book" were a destination — without it, "to"
  // followed by a common verb infinitive gets mistaken for "to <place>" and
  // swallows the rest of the sentence as a garbage destination string. The
  // trailing \b is load-bearing: without it "(?!go)" also rejects "to Goa",
  // since "Goa" starts with "go".
  const toMatch = q.match(/(?:to|in|around)\s+(?!(?:book|plan|go|visit|travel|fly|reserve|stay|explore|see)\b)([a-z\s]+?)(?:\s+for|\s+from|$|,|\.)/);
  // "flights for Shimla" / "hotels for Goa" — colloquial alternative to
  // "to/in/around" that the pattern above doesn't cover. Requires the word
  // after "for" to start with a letter, so "for 3 nights" (a duration
  // clause, not a place) never matches here.
  const forMatch = q.match(/\bfor\s+([a-z][a-z\s]*?)(?:\s+for|\s+from|$|,|\.)/);
  const fromMatch = q.match(/from\s+([a-z\s]+?)(?:\s+to|$|,|\.)/);

  const destination = cleanPlace(toMatch ? toMatch[1] : forMatch ? forMatch[1] : undefined);
  const origin = cleanPlace(fromMatch ? fromMatch[1] : undefined);

  // No usable destination in the message — either no "to/for <place>" phrase
  // at all (e.g. "give me the details of sunset bay hotel" — that names a
  // hotel, not a city), or only filler where a place should be ("lets plan
  // for a trip", "book a trip from Delhi"). Asking beats guessing a fallback
  // city or latching onto "a trip" as if it were a destination.
  if (!destination) {
    return {
      intent: 'refine',
      destination: '',
      origin,
      agents: [],
      hotelNameQuery: extractHotelNameQuery(q),
      summary: buildRefineSummary(origin),
    };
  }
  const checkIn = extractDate(q);
  const flightTargetTime = extractTime(q);
  const flightQuery = extractFlightQuery(q);
  const hotelQuery = extractHotelQuery(q);
  const wantsBooking = extractWantsBooking(q);
  const { adults, children } = extractPartySize(q);

  const wantsFlightsOnly = /flight/.test(q) && !/hotel|stay/.test(q);
  // Once an origin is present, treat it as a full trip (flights + hotels)
  // even if the phrasing leans toward "hotels" — the user gave us enough to
  // search flights too, and dropping them (or silently discarding the
  // origin) is worse than showing an extra section.
  const wantsHotelsOnly = /hotel|stay|resort/.test(q) && !/flight/.test(q) && !origin;

  let base: Omit<ParsedIntent, 'summary'>;
  if (wantsFlightsOnly) base = { intent: 'browse_flights', destination, origin, agents: ['flights'], checkIn, flightTargetTime, flightQuery, wantsBooking, adults, children };
  else if (wantsHotelsOnly) base = { intent: 'browse_hotels', destination, agents: ['hotels'], checkIn, hotelQuery, wantsBooking, adults, children };
  else {
    base = {
      intent: 'plan_trip', destination, origin, durationNights,
      agents: origin ? ['flights', 'hotels'] : ['hotels'], checkIn,
      flightTargetTime, flightQuery, hotelQuery, wantsBooking, adults, children,
    };
  }
  return { ...base, summary: buildSummary(base) };
}

/** Whatever produced this intent (LLM or heuristic) — if an origin city is
 * known, flights should always be one of the agents. An LLM can otherwise
 * plausibly read "trip from Dubai to Hyderabad" as accommodation-focused and
 * drop flights entirely, which silently throws away information the user
 * did give us. */
function ensureFlightsWhenOriginKnown(intent: ParsedIntent): ParsedIntent {
  if (!intent.origin || intent.agents.includes('flights')) return intent;
  return { ...intent, intent: 'plan_trip', agents: [...intent.agents, 'flights'] };
}

/** heuristicIntent already scopes to one agent when the wording says so
 * (wantsFlightsOnly/wantsHotelsOnly below) — the LLM path doesn't, since its
 * system prompt's "origin AND destination -> plan_trip, both agents" rule
 * wins even over a message that explicitly only asked to book a flight (or
 * a hotel). This re-applies the same exclusive-wording check regardless of
 * which path produced the intent, so "...book a flight" never expands into
 * a flight+hotel combo just because an origin+destination both happened to
 * be present — and fixes the summary to match, so it doesn't keep
 * mentioning "flight and hotel options" for a flights-only result. */
function applyAgentScopeOverride(q: string, intent: ParsedIntent): ParsedIntent {
  const flightsOnlyWord = /flight/.test(q) && !/hotel|stay/.test(q);
  // Once an origin is present, treat it as a full trip even if the phrasing
  // leans toward "hotel" — the user gave us enough to search flights too,
  // and dropping them is worse than showing an extra section (same
  // reasoning heuristicIntent's own wantsHotelsOnly already applies).
  const hotelsOnlyWord = /hotel|stay|resort/.test(q) && !/flight/.test(q) && !intent.origin;

  if (flightsOnlyWord && !(intent.agents.length === 1 && intent.agents[0] === 'flights')) {
    const corrected: ParsedIntent = { ...intent, intent: 'browse_flights', agents: ['flights'] };
    return { ...corrected, summary: buildSummary(corrected) };
  }
  if (hotelsOnlyWord && !(intent.agents.length === 1 && intent.agents[0] === 'hotels')) {
    const corrected: ParsedIntent = { ...intent, intent: 'browse_hotels', agents: ['hotels'] };
    return { ...corrected, summary: buildSummary(corrected) };
  }
  return intent;
}

// This call blocks the whole /api/plan response — the page can't show
// anything at all until it resolves — so it gets a short timeout even
// though the model can take much longer. The heuristic fallback below is
// fast and already handles the common phrasings well, so a miss here costs
// a nicer LLM-written summary, not correctness.
const INTENT_TIMEOUT_MS = 8_000;

export async function parseIntent(query: string): Promise<ParsedIntent> {
  if (LLM_ENABLED) {
    const result = await generateJSON<ParsedIntent>(SYSTEM_PROMPT, query, INTENT_TIMEOUT_MS);

    // No real place named — either the model said so outright (intent
    // "refine"), or it echoed filler back as the destination ("a trip",
    // "the weekend"). Ask for a city rather than planning a trip to nowhere,
    // and don't fall through to heuristics that might latch onto that same
    // filler word.
    const echoedFiller = !!result
      && result.intent !== 'find_doctor'
      && !!result.destination
      && !cleanPlace(result.destination);
    if (result && (result.intent === 'refine' || echoedFiller)) {
      const q = query.toLowerCase();
      return {
        intent: 'refine',
        destination: '',
        origin: cleanPlace(result.origin),
        agents: [],
        hotelNameQuery: extractHotelNameQuery(q),
        summary: (result.intent === 'refine' && result.summary?.trim())
          || buildRefineSummary(result.origin),
      };
    }

    // find_doctor deliberately has no destination (it's not a travel
    // concept) — the usual "destination must be non-empty" check would
    // otherwise reject every valid find_doctor result and silently fall
    // through to heuristics that know nothing about symptoms.
    const isUsable = result?.intent === 'find_doctor'
      ? !!result.agents?.length
      : !!(result?.destination && result.agents?.length);
    if (isUsable && result) {
      // Drop a filler origin ("me", "a trip") so it doesn't pull in the
      // flights agent or show up in the summary as a starting city.
      result.origin = cleanPlace(result.origin);
      const normalized = ensureFlightsWhenOriginKnown(result);
      // The regex extractors below run either way, whether or not the LLM
      // is enabled — filling in anything the model's JSON left out is cheap
      // and deterministic, so a booking-time/named-flight query still gets
      // auto-picked even if the model missed the new fields.
      const q = query.toLowerCase();
      const fallbackParty = extractPartySize(q);
      const merged: ParsedIntent = {
        ...normalized,
        flightTargetTime: normalized.flightTargetTime || extractTime(q),
        flightQuery: normalized.flightQuery || extractFlightQuery(q),
        hotelQuery: normalized.hotelQuery || extractHotelQuery(q),
        wantsBooking: normalized.wantsBooking ?? extractWantsBooking(q),
        adults: normalized.adults ?? fallbackParty.adults,
        children: normalized.children ?? fallbackParty.children,
        summary: normalized.summary || buildSummary(normalized),
      };
      return applyAgentScopeOverride(q, merged);
    }
  }
  const h = heuristicIntent(query);
  return h;
}
