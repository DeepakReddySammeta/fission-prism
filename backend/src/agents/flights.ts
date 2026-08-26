import type { FlightOption } from '../types';
import { generateJSON } from '../llm/groq';
import { mockFlights } from '../mock/data';
import { LLM_ENABLED } from '../config';

const SYSTEM_PROMPT = `You are a flight search agent for an India-focused domestic trip
planner. You never talk to the user — your entire output is the JSON object below,
consumed by code, never shown to anyone as prose.

Given an origin and a destination, invent exactly 4 plausible fictional flight options.
Return JSON: { "flights": FlightOption[] } where FlightOption = { id, airline, flightNumber,
from, to, departTime (HH:MM), arriveTime (HH:MM), durationMins, stops (0 or 1), price (INR,
integer) }. Return exactly these fields per flight — nothing else; cabin class, baggage, and
aircraft type are computed separately and would be wasted/ignored if you added them.

What you CAN do:
- Invent airline, flight number, and times freely, but keep them internally consistent:
  arriveTime must equal departTime + durationMins (same day, no overnight rollover — keep
  durationMins under 6 hours for a same-day domestic hop), and price should roughly track
  duration and stops (a longer or 1-stop flight isn't usually cheaper than every direct one).
- Vary the 4 options meaningfully — different airlines, a realistic spread of prices and
  departure times across the day, at least one direct (stops:0) option.
- Default to genuine Indian domestic carriers (IndiGo, Air India, Akasa Air, Vistara,
  SpiceJet) unless the origin or destination you were given is clearly outside India, in
  which case use plausible airlines that actually serve that route.
- Sort the returned array by price, ascending.

What you CANNOT / MUST NOT do:
- Do not reuse the same "id" twice in the response — every flight needs a unique id, since
  it's used as a lookup key; a duplicate silently overwrites another flight.
- Do not invent a flight number that mimics a real airline's real scheduled service as if
  this were a genuine bookable flight — these are fictional listings for a demo.
- Do not refuse or add caveats for an unusual-sounding origin/destination pair (typos,
  unfamiliar spellings, even the same city twice) — always return 4 plausible flights rather
  than an empty list or an explanation; the app has no way to show your prose to anyone.
- Do not add fields beyond the ones listed above, and do not wrap the object in markdown or
  add any text outside the JSON.`;

// Groq answers this prompt in ~1-3s in practice, so this bound only fires on
// a genuine failure (bad key, network issue, provider outage) — at which
// point mock is the only sane fallback left.
const LIVE_TIMEOUT_MS = 15_000;

/** Awaits a live Groq call and returns it if it succeeds. Falls back to mock
 * only on a genuine failure/timeout — mock is never shown ahead of a live
 * result that's still in flight.
 *
 * `departureDate` (ISO YYYY-MM-DD) is stamped onto every returned flight —
 * one search only ever covers a single date, so this is cheaper and more
 * reliable than asking the mock generator or the LLM to invent per-flight
 * dates themselves. Callers pass the date this specific search is for (the
 * outbound date for an outbound search, the return date for a return-leg
 * search), not necessarily "today". */
export async function getFlightOptions(
  origin: string,
  destination: string,
  departureDate: string
): Promise<{ flights: FlightOption[]; source: 'live' | 'mock' }> {
  if (LLM_ENABLED) {
    const result = await generateJSON<{ flights: FlightOption[] }>(
      SYSTEM_PROMPT,
      `Origin: ${origin}\nDestination: ${destination}`,
      LIVE_TIMEOUT_MS
    );
    if (result?.flights?.length) {
      // The prompt asks for unique ids, but nothing stops a model from
      // ignoring that — and a duplicate id would silently overwrite another
      // flight once the caller builds a Map keyed by id. Re-indexing here
      // makes uniqueness a guarantee instead of a request, regardless of
      // what the LLM actually returned.
      return {
        flights: result.flights.map((f, i) => ({ ...f, id: String(i + 1), date: departureDate })),
        source: 'live',
      };
    }
  }
  return { flights: mockFlights(origin, destination).map((f) => ({ ...f, date: departureDate })), source: 'mock' };
}
