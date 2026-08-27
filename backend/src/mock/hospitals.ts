import type { HospitalOption } from '../types';

/**
 * Real Hyderabad hospitals — hand-curated, not LLM-generated.
 *
 * Unlike flights/hotels (deliberately fictional), a hospital is a real
 * institution whose specialties and accreditations are public facts, not
 * something to reinvent per query. Address/specialty/accreditation details
 * below were pulled directly from each hospital's own site; anything not
 * independently confirmed is left out rather than guessed.
 */
export const HOSPITALS: HospitalOption[] = [
  {
    id: 'hosp-yashoda-somajiguda',
    name: 'Yashoda Hospitals, Somajiguda',
    area: 'Somajiguda',
    address: '6-3-905, Raj Bhavan Rd, Matha Nagar, Somajiguda, Hyderabad, Telangana 500082',
    phone: '+91 40 4567 4567',
    accreditation: ['NABH', 'NABL', 'ISO'],
    highlights: ['620 beds', '151 doctors', '24/7 emergency', 'Robotic surgery', 'Organ transplant'],
  },
  {
    id: 'hosp-apollo-jubileehills',
    name: 'Apollo Hospitals, Jubilee Hills',
    area: 'Jubilee Hills',
    address: 'Road No. 72, Film Nagar, Jubilee Hills, Hyderabad, Telangana 500033',
    phone: '+91 40 2360 7777',
    accreditation: ['NABH', 'JCI'],
    highlights: ['Multi-organ transplant', 'Cancer centre', 'Cardiac sciences', '24/7 emergency'],
  },
  {
    id: 'hosp-continental-gachibowli',
    name: 'Continental Hospitals',
    area: 'Gachibowli',
    address: 'Plot No 3, Road No. 2, Financial District, Gachibowli, Nanakaramguda, Hyderabad, Telangana 500032',
    phone: '+91 40 6700 0000',
    accreditation: ['NABH'],
    highlights: ['Continental Heart Centre', 'Continental Cancer Centre', 'Brain Tumor Center', 'Robotic surgery', '24/7 emergency'],
  },
  {
    id: 'hosp-kims-secunderabad',
    name: 'KIMS Hospitals, Secunderabad',
    area: 'Begumpet',
    address: '1-8-31/1, Minister Rd, Krishna Nagar Colony, Begumpet, Secunderabad, Telangana 500003',
    phone: '040-44885000',
    accreditation: ['NABH', 'NABL', 'ISO'],
    highlights: ['1,000 beds', 'Multi-organ transplant', 'Cardiac surgery', 'Neurosciences'],
  },
  {
    id: 'hosp-care-banjarahills',
    name: 'CARE Hospitals, Banjara Hills',
    area: 'Banjara Hills',
    address: 'Road No. 1, Banjara Hills, Hyderabad, Telangana 500034',
    phone: '+91 40 6810 6587',
    accreditation: ['NABH'],
    highlights: ['Cardiac sciences', 'Robot-assisted surgery', 'Nephrology', '30+ specialties'],
  },
  {
    id: 'hosp-rainbow-banjarahills',
    name: "Rainbow Children's Hospital, Banjara Hills",
    area: 'Banjara Hills',
    address: 'Banjara Hills Road, Hyderabad, Telangana',
    phone: '7997079970',
    accreditation: ['NABH'],
    highlights: ['Dedicated pediatric hospital', 'NICU & PICU', 'Pediatric cardiology', 'Pediatric neurology'],
  },
];

export function getHospitalById(id: string): HospitalOption | undefined {
  return HOSPITALS.find((h) => h.id === id);
}
