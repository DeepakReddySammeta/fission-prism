import type { DoctorOption, HospitalOption } from '../types';
import { DOCTORS, SPECIALTIES, type Specialty } from '../mock/doctors';
import { getHospitalById } from '../mock/hospitals';

// Lives here (domain data), not in envelopes.ts, so this file can map a
// free-text time hint ("morning", "10am") onto one of these fixed slots
// without envelopes.ts importing back into this file.
export const APPOINTMENT_TIME_SLOTS = ['10:00 AM', '11:30 AM', '1:00 PM', '3:00 PM', '4:30 PM'];

/**
 * Pure matching, no LLM call — see the design discussion this grew out of.
 * The LLM's only job (in agents/intent.ts) is turning a symptom into a
 * specialty string; everything from here on is a deterministic lookup
 * against the curated dataset in mock/doctors.ts + mock/hospitals.ts, the
 * same way pickRecommendedFlight/Hotel are pure functions over
 * already-fetched data rather than a generation step.
 */

// The LLM won't always say the specialty exactly as SPECIALTIES spells it
// ("Cardiologist" vs "Cardiology", "Skin specialist" vs "Dermatology") —
// normalized here rather than by asking the prompt to be byte-exact, since
// a model very reliably gets the *concept* right and unreliably gets exact
// string formatting right.
const SPECIALTY_SYNONYMS: Record<string, Specialty> = {
  cardiologist: 'Cardiology', cardiac: 'Cardiology', heart: 'Cardiology',
  neurologist: 'Neurology', brain: 'Neurology',
  gastroenterologist: 'Gastroenterology', gastro: 'Gastroenterology', stomach: 'Gastroenterology', digestive: 'Gastroenterology',
  pediatrician: 'Pediatrics', paediatrician: 'Pediatrics', paediatrics: 'Pediatrics', child: 'Pediatrics',
  dentist: 'Dentistry', dental: 'Dentistry',
  orthopedist: 'Orthopedics', orthopaedic: 'Orthopedics', orthopaedics: 'Orthopedics', bone: 'Orthopedics', joint: 'Orthopedics',
  dermatologist: 'Dermatology', skin: 'Dermatology',
  'ear nose throat': 'ENT', otolaryngology: 'ENT', otolaryngologist: 'ENT',
  ophthalmologist: 'Ophthalmology', eye: 'Ophthalmology',
  gynecologist: 'Gynecology', gynaecologist: 'Gynecology', gynaecology: 'Gynecology', obstetrics: 'Gynecology',
  psychiatrist: 'Psychiatry', mental: 'Psychiatry',
  'general physician': 'General Medicine', physician: 'General Medicine', 'family medicine': 'General Medicine',
};

/** Best-effort match of whatever specialty string the LLM produced against
 * the fixed taxonomy above — exact match first, then synonym table, then a
 * substring check either direction, and only then General Medicine as the
 * catch-all (never an empty result — there's always *a* reasonable doctor
 * to suggest, even for a vague complaint). */
export function normalizeSpecialty(raw?: string): Specialty {
  if (!raw) return 'General Medicine';
  const s = raw.trim().toLowerCase();
  const exact = SPECIALTIES.find((sp) => sp.toLowerCase() === s);
  if (exact) return exact;
  if (SPECIALTY_SYNONYMS[s]) return SPECIALTY_SYNONYMS[s];
  for (const [word, specialty] of Object.entries(SPECIALTY_SYNONYMS)) {
    if (s.includes(word)) return specialty;
  }
  const partial = SPECIALTIES.find((sp) => s.includes(sp.toLowerCase()) || sp.toLowerCase().includes(s));
  return partial || 'General Medicine';
}

export interface DoctorMatch extends DoctorOption {
  hospital: HospitalOption;
}

/**
 * `ageGroup` only ever narrows or redirects — it never overrides a clearly
 * named specialty. A vague complaint ("my child isn't feeling well") with
 * no specific named specialty, though, routes straight to Pediatrics: that
 * case reaches here as normalizeSpecialty's General Medicine catch-all, so
 * checking for it is exactly the right signal that no specific system was
 * named and age is all we have to go on.
 */
export function getDoctorMatches(specialtyRaw: string | undefined, ageGroup?: 'child' | 'adult' | 'senior'): DoctorMatch[] {
  let specialty = normalizeSpecialty(specialtyRaw);
  if (specialty === 'General Medicine' && ageGroup === 'child') specialty = 'Pediatrics';

  const matches = DOCTORS.filter((d) => d.specialty === specialty);
  const pool = matches.length ? matches : DOCTORS.filter((d) => d.specialty === 'General Medicine');

  return [...pool]
    .sort((a, b) => b.rating - a.rating)
    .map((d) => ({ ...d, hospital: getHospitalById(d.hospitalId)! }));
}

/** Doctor names are a small, fixed, known set (unlike hotel names, which
 * come from a fresh LLM/mock search every time) — an exact case-insensitive
 * match is enough, no fuzzy matching needed. */
export function findDoctorByName(name: string): DoctorMatch | undefined {
  const q = name.trim().toLowerCase().replace(/^dr\.?\s*/, '');
  const doctor = DOCTORS.find((d) => d.name.toLowerCase().replace(/^dr\.?\s*/, '') === q);
  return doctor ? { ...doctor, hospital: getHospitalById(doctor.hospitalId)! } : undefined;
}

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

function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 0 : 1 - dist / maxLen;
}

const tokenize = (s: string): string[] =>
  s.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);

// Words that show up around a doctor's name in a typed request but aren't
// part of it — stripped before fuzzy-matching so leftover scheduling/filler
// words (or a misspelled "details") don't drag the match score down.
const LOOKUP_FILLER_WORDS = new Set([
  'give', 'me', 'the', 'of', 'for', 'about', 'on', 'show', 'tell', 'i', 'want', 'to', 'can',
  'you', 'please', 'a', 'an', 'is', 'who', 'doctor', 'dr', 'appointment', 'book', 'with', 'my',
  'need', 'get', 'find', 'know', 'more', 'best', 'good', 'top', 'detail', 'details', 'detaisl',
  'deatils', 'detials', 'deatil', 'info', 'information', 'profile', 'bio', 'and', 'would', 'like',
  'could', 'today', 'tomorrow', 'at', 'am', 'pm', 'morning', 'evening', 'afternoon', 'night',
  'next', 'this', 'that', 'some', 'any', 'from', 'see', 'consult', 'in',
]);

/** Fuzzy match against the fixed, small (24-doctor) roster — tolerant of
 * typos in the name itself ("kartik rao" -> "Karthik Rao") and of extra
 * words around it (scheduling words, a misspelled "details"), by scoring
 * every contiguous window of the leftover tokens against each doctor's
 * name rather than the whole free-text string at once. Safe to try broadly
 * since a fixed, tiny, hand-curated roster makes false positives rare —
 * the caller still gates on a lookup-shaped query before calling this. */
function fuzzyFindDoctorByName(rawQuery: string): DoctorMatch | undefined {
  const tokens = tokenize(rawQuery).filter((t) => !LOOKUP_FILLER_WORDS.has(t));
  if (tokens.length === 0) return undefined;

  let best: { doctor: DoctorOption; score: number } | undefined;
  for (const d of DOCTORS) {
    const nameTokens = tokenize(d.name.replace(/^dr\.?\s*/i, ''));
    const nameStr = nameTokens.join(' ');
    const fullScore = nameSimilarity(tokens.join(' '), nameStr);
    if (!best || fullScore > best.score) best = { doctor: d, score: fullScore };
    for (let winLen = Math.max(1, nameTokens.length - 1); winLen <= nameTokens.length + 1; winLen++) {
      for (let i = 0; i + winLen <= tokens.length; i++) {
        const windowStr = tokens.slice(i, i + winLen).join(' ');
        const score = nameSimilarity(windowStr, nameStr);
        if (!best || score > best.score) best = { doctor: d, score };
      }
    }
  }
  if (best && best.score >= 0.6) return { ...best.doctor, hospital: getHospitalById(best.doctor.hospitalId)! };
  return undefined;
}

export interface BookingHints {
  preferredDate?: string;
  preferredTime?: string;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "tomorrow"/"today"/a weekday name -> a concrete date, so a booking
 * request that already names one doesn't make the user re-enter it in the
 * form. Deliberately modest — no attempt at parsing explicit calendar
 * dates ("on the 5th of September"), just the handful of ways people
 * actually phrase this in a chat message. */
function extractDateHint(query: string): string | undefined {
  const q = query.toLowerCase();
  const today = new Date();
  if (/\btoday\b/.test(q)) return isoDate(today);
  if (/\btomorrow\b/.test(q)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return isoDate(d);
  }
  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(q)) {
      const d = new Date(today);
      const diff = (i - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return isoDate(d);
    }
  }
  return undefined;
}

/** "morning"/"evening"/an explicit "10am" -> the nearest fixed appointment
 * slot the form actually offers, so a request that already names a time
 * arrives pre-picked instead of blank. */
function extractTimeHint(query: string): string | undefined {
  const q = query.toLowerCase();
  const explicit = q.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (explicit) {
    const hour12 = parseInt(explicit[1], 10) % 12;
    const min = explicit[2] ? parseInt(explicit[2], 10) : 0;
    const targetMinutes = (hour12 + (explicit[3] === 'pm' ? 12 : 0)) * 60 + min;
    let best: string | undefined;
    let bestDiff = Infinity;
    for (const slot of APPOINTMENT_TIME_SLOTS) {
      const m = slot.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)!;
      const slotHour12 = parseInt(m[1], 10) % 12;
      const slotMinutes = (slotHour12 + (m[3].toUpperCase() === 'PM' ? 12 : 0)) * 60 + parseInt(m[2], 10);
      const diff = Math.abs(slotMinutes - targetMinutes);
      if (diff < bestDiff) { bestDiff = diff; best = slot; }
    }
    return best;
  }
  if (/\bmorning\b/.test(q)) return '10:00 AM';
  if (/\bafternoon\b/.test(q)) return '1:00 PM';
  if (/\bevening\b/.test(q)) return '4:30 PM';
  return undefined;
}

function extractBookingHints(query: string): BookingHints | undefined {
  const preferredDate = extractDateHint(query);
  const preferredTime = extractTimeHint(query);
  if (!preferredDate && !preferredTime) return undefined;
  return { preferredDate, preferredTime };
}

export interface DoctorLookup {
  kind: 'profile' | 'book';
  doctorName: string;
  hints?: BookingHints;
}

/** Recognizes a request naming one specific doctor — either the two fixed
 * templates App.tsx synthesizes for "View Profile"/"Book Appointment"
 * clicks (exact match, since the client controls that string), or a
 * free-form chat query naming a doctor directly ("give me detaisl of dr.
 * karthik rao", "who is dr pooja hegde", typos included). Checked before
 * parseIntent, same reasoning as detectMyRecordsIntent/detectExplorationIntent
 * — a direct lookup, not a search, so no LLM call needed either way. */
export function detectDoctorLookup(query: string): DoctorLookup | undefined {
  const profileTemplate = query.match(/^View profile for (Dr\.?\s+.+)$/i);
  const bookTemplate = query.match(/^Book an appointment with (Dr\.?\s+.+)$/i);
  const templateKind: 'profile' | 'book' | undefined = profileTemplate ? 'profile' : bookTemplate ? 'book' : undefined;
  const templateCapture = profileTemplate?.[1] ?? bookTemplate?.[1];

  if (templateCapture && templateKind) {
    // The exact synthesized templates (App.tsx's own button clicks) always
    // resolve via a plain exact match. A free-typed message that happens to
    // start with the same words ("book an appointment with dr pooja hegde
    // tomorrow morning") can also land here, though, with trailing words
    // baked into the capture — fall back to the fuzzy matcher for that case
    // instead of reporting "not found" outright.
    const hints = templateKind === 'book' ? extractBookingHints(templateCapture) : undefined;
    const exact = findDoctorByName(templateCapture);
    if (exact) return { kind: templateKind, doctorName: exact.name, hints };
    const fuzzy = fuzzyFindDoctorByName(templateCapture);
    if (fuzzy) return { kind: templateKind, doctorName: fuzzy.name, hints };
    return { kind: templateKind, doctorName: templateCapture.trim(), hints };
  }

  const looksLikeBooking = /\bbook\b/i.test(query);
  const looksLikeLookup =
    looksLikeBooking ||
    /\b(?:det[ai]+ls?|detaisl|deatils?|detials?|info(?:rmation)?|profile|bio|about|who\s+is)\b/i.test(query) ||
    /\bdr\.?\s+[a-z]/i.test(query);
  if (!looksLikeLookup) return undefined;

  const match = fuzzyFindDoctorByName(query);
  if (!match) return undefined;
  const kind = looksLikeBooking ? 'book' : 'profile';
  return { kind, doctorName: match.name, hints: kind === 'book' ? extractBookingHints(query) : undefined };
}
