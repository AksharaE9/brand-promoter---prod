/** Canonical place filter options for candidate pool. */
export const PLACE_OPTIONS = [
  'Bangalore',
  'Chennai',
  'Hyderabad',
  'Kochi',
  'Remote',
  'Mumbai',
];

/** Map messy DB spellings/case variants → canonical place. */
const PLACE_ALIASES = {
  bangalore: 'Bangalore',
  banglore: 'Bangalore',
  bengaluru: 'Bangalore',
  bengalooru: 'Bangalore',
  blr: 'Bangalore',
  chennai: 'Chennai',
  madras: 'Chennai',
  hyderabad: 'Hyderabad',
  hyd: 'Hyderabad',
  hydrabad: 'Hyderabad',
  kochi: 'Kochi',
  cochin: 'Kochi',
  ernakulam: 'Kochi',
  remote: 'Remote',
  wfh: 'Remote',
  'work from home': 'Remote',
  mumbai: 'Mumbai',
  bombay: 'Mumbai',
};

function normalizePlaceKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Resolve any stored location string to a canonical place, or null if unknown. */
export function canonicalizePlace(value) {
  const key = normalizePlaceKey(value);
  if (!key) return null;
  if (PLACE_ALIASES[key]) return PLACE_ALIASES[key];
  const exact = PLACE_OPTIONS.find((p) => p.toLowerCase() === key);
  return exact || null;
}

/** True when candidate location belongs to the selected place filter. */
export function matchesPlaceFilter(candidateLocation, filterValue) {
  if (!filterValue || filterValue === 'All') return true;
  return canonicalizePlace(candidateLocation) === filterValue;
}
