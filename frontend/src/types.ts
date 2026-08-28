/**
 * Domain types for the trip-planning app.
 *
 * The A2UI *protocol* types (envelopes, component defs, the catalog
 * allowlist) used to live here too; they now come from `@a2ui/web_core`
 * and the local catalog in `src/a2ui/`, so this file is just the domain
 * shapes plus the catalog id.
 *
 * These domain shapes are still hand-mirrored from `backend/src/types.ts`
 * (no shared package for two tiny apps) — if you change a field in one copy,
 * mirror it in the other. The backend copy keeps the full A2UI protocol
 * section; this one doesn't need it.
 */

/** Must equal the `catalogId` the backend puts in every `createSurface`
 * envelope (`backend/src/types.ts` `CATALOG_ID`) and the id the local
 * `Catalog` is constructed with (`src/a2ui/catalog.ts`). */
export const CATALOG_ID = 'https://voyage.ai/catalogs/travel/v1';

/* ---------------- Domain types (trip planning) ---------------- */

export type IntentKind = 'plan_trip' | 'browse_hotels' | 'browse_flights' | 'refine' | 'explore_destinations' | 'find_doctor';

export interface ParsedIntent {
  intent: IntentKind;
  origin?: string;
  /** For "find_doctor", this is unused (destination is a travel concept) —
   * always "" for that intent. Kept required rather than optional so every
   * other intent path (which does rely on it) can't accidentally forget it. */
  destination: string;
  durationNights?: number;
  agents: Array<'flights' | 'hotels' | 'health'>;
  /** free-text constraint carried over from a refinement message, e.g. "cheaper", "5-star only" */
  refinement?: string;
  /** best-effort ISO dates (YYYY-MM-DD) extracted from the query, if present */
  checkIn?: string;
  checkOut?: string;
  /** Set when no destination phrase was found but the message looks like it
   * might be naming a specific hotel (e.g. "give me the details of sunset
   * bay hotel"). The server tries to resolve this against hotels already
   * shown earlier in this run before falling back to asking for a city. */
  hotelNameQuery?: string;
  /** Best-effort clock time ("HH:MM", 24h) extracted when the user gave a
   * time for booking a flight (e.g. "book a flight at 10am"). Drives
   * auto-picking one flight from the results instead of just listing them. */
  flightTargetTime?: string;
  /** Free text naming a specific flight/airline to book (e.g. "book the
   * IndiGo flight", "book flight 6E-203"), matched against results the same
   * best-effort way `hotelNameQuery` matches hotel names. */
  flightQuery?: string;
  /** Free text naming a specific hotel to book within a full plan_trip flow
   * (as opposed to `hotelNameQuery`, which only resolves a standalone
   * hotel-only message with no destination at all). */
  hotelQuery?: string;
  /** True when the message uses booking language ("book", "reserve") rather
   * than just browsing ("show me", "plan a trip"). Drives auto-picking one
   * flight/hotel even when no specific time or name was given — falling
   * back to the cheapest, the same default hotel picks already use. */
  wantsBooking?: boolean;
  /** Best-effort traveler count extracted from the query ("for 2 adults",
   * "a family of 4") — pre-fills the trip-builder card's traveler steppers
   * instead of always starting from the generic 2-adults default. */
  adults?: number;
  children?: number;
  /** a short, friendly one-liner introducing the results — always present,
   * LLM-generated when available, templated otherwise. */
  summary: string;

  /* ---- "find_doctor" only ---- */
  symptom?: string;
  specialty?: string;
  ageGroup?: 'child' | 'adult' | 'senior';
}

export interface FlightOption {
  id: string;
  airline: string;
  flightNumber: string;
  from: string;
  to: string;
  /** ISO date (YYYY-MM-DD) this flight departs on — every flight in one
   * search shares the same date (the app doesn't support multi-date
   * search), so this is stamped on post-generation rather than asked of
   * the mock generator or the LLM. */
  date: string;
  departTime: string;
  arriveTime: string;
  durationMins: number;
  stops: number;
  price: number;
  /** Set on exactly one flight in a result set when the user's query gave
   * enough to auto-pick one (a target time or a named flight/airline). */
  recommended?: boolean;
}

export interface RoomOption {
  id: string;
  name: string;
  price: number;
  imageSeed: string;
  capacity: number;
  /** Set on exactly one room when a hotel/room got auto-picked for a
   * booking-intent query — mirrors FlightOption.recommended. */
  recommended?: boolean;
}

export interface HotelOption {
  id: string;
  name: string;
  area: string;
  rating: number;
  price: number;
  imageSeed: string;
  rooms: RoomOption[];
}

/** One suggestion in an "explore destinations" response — a place worth
 * considering, not yet a flight/hotel search. `name` is what a follow-up
 * drill-down or a "Schedule a trip" click feeds back in as the next query's
 * destination. */
export interface DestinationSuggestion {
  id: string;
  name: string;
  blurb: string;
  bestFor: string;
  imageSeed: string;
}

export interface PlanRequest {
  query: string;
  sessionId?: string;
}

/* ---------------- Find a doctor ---------------- */

export interface HospitalOption {
  id: string;
  name: string;
  area: string;
  address: string;
  phone: string;
  accreditation: string[];
  highlights: string[];
}

export interface DoctorOption {
  id: string;
  name: string;
  gender: 'male' | 'female';
  qualifications: string;
  specialty: string;
  expertise: string[];
  yearsExperience: number;
  languages: string[];
  rating: number;
  consultationFee: number;
  opdTimings: string;
  bio: string;
  photoSeed: string;
  hospitalId: string;
}

export interface AppointmentBooking {
  id: string;
  doctorId: string;
  doctorName: string;
  hospitalName: string;
  patientName: string;
  patientAge: number;
  patientGender: string;
  patientPhone: string;
  patientEmail?: string;
  reason: string;
  preferredDate: string;
  preferredTime: string;
  appointmentRef: string;
  createdAt: string;
}

export interface TripSummary {
  destination: string;
  origin?: string;
  nights?: number;
  flight?: FlightOption;
  /** A one-way return leg, added only if the traveler asked for one when
   * confirming the outbound flight. */
  returnFlight?: FlightOption;
  returnDate?: string;
  hotel?: HotelOption;
  room?: RoomOption;
  bookingRef?: string;
  /** Included in totalPrice, broken out for display — a flat percentage of
   * the flight + room subtotal, standing in for real taxes/service fees. */
  taxesAndFees?: number;
  totalPrice?: number;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  children?: number;
  guestName?: string;
  passengerName?: string;
  passengerEmail?: string;
  /** One name per adult traveler — collected by both the trip-builder
   * card's combined confirm step and the solo flight-confirm form.
   * `passengerName` (singular) is kept as passengerNames[0] for whatever
   * still reads it directly (e.g. the confirmed-flight banner). */
  passengerNames?: string[];
  /** Picked when confirming the flight — multiplies the listed (Economy)
   * fare; see cabinPriceMultiplier. Undefined means Economy, the fare's own
   * listed cabin, no upgrade chosen. */
  cabinClass?: string;
}

/** Mirrors backend/src/weather/weather.ts — a live third-party reading, not
 * a governed record, hence kept as its own type rather than folded into
 * TripSummary. */
export interface WeatherReading {
  place: string;
  temperatureC: number;
  feelsLikeC: number;
  humidityPercent: number;
  windKph: number;
  condition: string;
  isDay: boolean;
  observedAt: string;
  timezone: string;
  provider: string;
  daily: { date: string; minC: number; maxC: number; condition: string }[];
}
