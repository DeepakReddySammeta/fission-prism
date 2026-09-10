import type { DoctorOption, HospitalOption } from '../types';
import { DOCTORS, SPECIALTIES, type Specialty } from '../mock/doctors';
import { getHospitalById } from '../mock/hospitals';

// Lives here (domain data), not in envelopes.ts, so this file can map a
// free-text time hint ("morning", "10am") onto one of these fixed slots
// without envelopes.ts importing back into this file.
export const APPOINTMENT_TIME_SLOTS = ['10:00 AM', '11:30 AM', '1:00 PM', '3:00 PM', '4:30 PM'];

/**
 * Pure matching, no LLM call. The LLM's only job (in agents/router.ts) is
 * turning a symptom into a specialty string and a doctor's name into a
 * corrected one; everything from here on is a deterministic lookup
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

/** Date/time the router pulled out of a "book an appointment with Dr X
 * tomorrow at 4pm" message, used to pre-fill the booking form. */
export interface BookingHints {
  preferredDate?: string;
  preferredTime?: string;
}
