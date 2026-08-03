/** Canonical role filter options for candidate pool. */
export const ROLE_OPTIONS = [
  'BDE',
  'BDE Intern',
  'SME',
  'SME Intern',
  'BDE/SME',
  'Brand Promoter',
  'Brand Promoter - Shop Events',
  'Business Analyst',
  'Business Analyst Intern',
  'Data Analyst',
  'Data Analyst Intern',
  'HR',
  'HR Intern',
  'HR & Operations',
  'Operations',
  'Operations Intern',
  'Marketing Executive',
  'Marketing Intern',
  'Sales & Marketing',
  'Telesales',
  'Developer',
  'Developer Intern',
  'Team Lead',
  'Field Sales Associate',
];

/**
 * Normalize free-text role strings for alias lookup.
 * Collapses spacing/punctuation so "BDE- Intern", "bde intern", "BDE  Intern" match.
 */
export function normalizeRoleKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_]+/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/&/g, ' and ')
    .replace(/[/|]+/g, '/')
    .replace(/,/g, ' ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[()]/g, '')
    .trim();
}

/** Map messy DB spellings / case / punctuation → canonical role. */
const ROLE_ALIASES = {
  // BDE
  bde: 'BDE',
  bd: 'BDE',
  'business development executive': 'BDE',
  'business development executive full time': 'BDE',
  'bde full time': 'BDE',
  'bde-full time': 'BDE',
  'bde callings': 'BDE',
  'bde-telecalling': 'BDE',
  'bde and marketing': 'BDE',
  'bde and marketing ': 'BDE',
  'bde part time': 'BDE',
  'bde/ops': 'BDE',
  'ops and bde': 'BDE',
  'bde or hr intern': 'BDE Intern',
  'ba hr': 'Business Analyst',
  'ba bde-intern': 'Business Analyst Intern',
  'hr ops': 'HR & Operations',

  // BDE Intern
  'bde intern': 'BDE Intern',
  'bde-intern': 'BDE Intern',
  'bde internship': 'BDE Intern',
  'business development executive intern': 'BDE Intern',
  'business development intern': 'BDE Intern',

  // SME
  sme: 'SME',
  'sme full time': 'SME',
  'sme part time': 'SME',

  // SME Intern
  'sme intern': 'SME Intern',

  // BDE/SME
  'bde/sme': 'BDE/SME',
  'bde and sme': 'BDE/SME',
  'sme/bde': 'BDE/SME',
  'sme and bde': 'BDE/SME',
  'sme bde': 'BDE/SME',
  'bde/sme full time': 'BDE/SME',
  'ops/bde/sme': 'BDE/SME',

  // Brand Promoter
  bp: 'Brand Promoter',
  'brand promoter': 'Brand Promoter',
  'early bird-bp': 'Brand Promoter',
  'early bird - bp': 'Brand Promoter',
  'women in bp': 'Brand Promoter',

  // Brand Promoter - Shop Events
  'brand promoter-shop events': 'Brand Promoter - Shop Events',
  'brand promoter - shop events': 'Brand Promoter - Shop Events',
  'shop event': 'Brand Promoter - Shop Events',
  shopsmart: 'Brand Promoter - Shop Events',

  // Business Analyst
  ba: 'Business Analyst',
  'business analyst': 'Business Analyst',
  'business analytics': 'Business Analyst',

  // Business Analyst Intern
  'ba intern': 'Business Analyst Intern',
  'ba-intern': 'Business Analyst Intern',
  'business analyst intern': 'Business Analyst Intern',
  'business analyst-intern': 'Business Analyst Intern',
  'business aalyst intern': 'Business Analyst Intern',

  // Data Analyst
  'data analyst': 'Data Analyst',

  // Data Analyst Intern
  'data analyst intern': 'Data Analyst Intern',
  'data analytics intern': 'Data Analyst Intern',
  'data anlyst intern': 'Data Analyst Intern',
  'fdata analyst intern': 'Data Analyst Intern',

  // HR
  hr: 'HR',
  'human resource': 'HR',
  'human resource executive': 'HR',
  'human resource full time': 'HR',
  'hr full time': 'HR',

  // HR Intern
  'hr intern': 'HR Intern',
  'hr-intern': 'HR Intern',
  'hr interns': 'HR Intern',
  'human resource intern': 'HR Intern',
  'hr learning intern': 'HR Intern',
  'hr part time intern': 'HR Intern',
  'hr and intern': 'HR Intern',

  // HR & Operations
  'hr and operations': 'HR & Operations',
  'hr and operations intern': 'HR & Operations',
  'hr and ops': 'HR & Operations',
  'hr/ops': 'HR & Operations',
  'hr / ops': 'HR & Operations',
  'ops/hr': 'HR & Operations',
  'ba and operations': 'HR & Operations',
  'ba and ops': 'HR & Operations',

  // Operations
  ops: 'Operations',
  operations: 'Operations',
  om: 'Operations',
  'business ops': 'Operations',
  'business operations': 'Operations',
  'operations executive': 'Operations',
  'operations management': 'Operations',
  'operation management': 'Operations',
  'ops management': 'Operations',
  'ops full time': 'Operations',
  'marketing and ops': 'Operations',
  'marketing and operations': 'Operations',

  // Operations Intern
  'ops intern': 'Operations Intern',
  'ops-intern': 'Operations Intern',
  'operations intern': 'Operations Intern',
  'operations interns': 'Operations Intern',
  'operation intern': 'Operations Intern',
  'ope-intern': 'Operations Intern',
  'oprations intern': 'Operations Intern',
  'business operations intern': 'Operations Intern',
  'business operation intern': 'Operations Intern',
  'operation sintern': 'Operations Intern',

  // Marketing Executive
  me: 'Marketing Executive',
  marketing: 'Marketing Executive',
  'marketing executive': 'Marketing Executive',
  'marketing executive-full time': 'Marketing Executive',
  'marketing executive full time': 'Marketing Executive',

  // Marketing Intern
  'marketing intern': 'Marketing Intern',
  'marketing executive intern': 'Marketing Intern',
  'me and bde': 'Marketing Intern',

  // Sales & Marketing
  's and m': 'Sales & Marketing',
  's and m intern': 'Sales & Marketing',
  's&m': 'Sales & Marketing',
  's&m intern': 'Sales & Marketing',
  'sales and marketing': 'Sales & Marketing',
  'sales and marketing intern': 'Sales & Marketing',
  'sales and marketing executive': 'Sales & Marketing',
  'sales and marketing exevcutive': 'Sales & Marketing',
  'sales executive': 'Sales & Marketing',

  // Telesales / Telecalling
  telesales: 'Telesales',
  'tele sales': 'Telesales',
  'telesales executive': 'Telesales',
  'telesales executives': 'Telesales',
  'telesales exceutive': 'Telesales',
  'tele sales executive': 'Telesales',
  'telesales full time': 'Telesales',
  'tele sales executive full time': 'Telesales',
  'telesales intern': 'Telesales',
  telecalling: 'Telesales',
  'tele calling': 'Telesales',
  'tele calling executive': 'Telesales',
  'telecalling full time': 'Telesales',
  telicalling: 'Telesales',
  'telicalling role': 'Telesales',
  tellicalling: 'Telesales',
  'tellicalling part time': 'Telesales',
  'telecalling part-time sme': 'SME',
  'telecallingpart-time sme': 'SME',
  'tellicalling sme part time': 'SME',
  'tellicalling part time sme': 'SME',
  'tellicalling sme/bde part time': 'BDE/SME',
  'tellicalling bde/sme': 'BDE/SME',
  'tellicalling sme/bde': 'BDE/SME',
  'tellicalling bde': 'BDE',

  // Developer
  developer: 'Developer',
  dev: 'Developer',
  'software developer': 'Developer',
  'web developer': 'Developer',
  web: 'Developer',
  'frontend engineer': 'Developer',
  'backend engineer': 'Developer',
  'qa engineer': 'Developer',
  'ci test engineer': 'Developer',
  'test software engineer': 'Developer',

  // Developer Intern
  'developer intern': 'Developer Intern',

  // Team Lead
  'team lead': 'Team Lead',

  // Field Sales
  'field sales associate': 'Field Sales Associate',
};

/** Resolve any stored role/job title to a canonical role, or null if unknown/junk. */
export function canonicalizeRole(value) {
  const key = normalizeRoleKey(value);
  if (!key) return null;

  // Ignore junk / non-role values
  if (
    key === '-' ||
    key === 'na' ||
    key === 'n/a' ||
    key === 'all' ||
    key === 'full time' ||
    key === 'not mentioned' ||
    key === 'yet to be decided' ||
    /^\d+$/.test(key)
  ) {
    return null;
  }

  if (ROLE_ALIASES[key]) return ROLE_ALIASES[key];

  // Compact key without spaces/hyphens for a few stubborn variants
  const compact = key.replace(/[\s-]/g, '');
  const compactHit = Object.entries(ROLE_ALIASES).find(([alias]) => alias.replace(/[\s-]/g, '') === compact);
  if (compactHit) return compactHit[1];

  const exact = ROLE_OPTIONS.find((r) => normalizeRoleKey(r) === key);
  return exact || null;
}

/** True when candidate role belongs to the selected role filter. */
export function matchesRoleFilter(candidateRole, filterValue) {
  if (!filterValue || filterValue === 'All') return true;
  return canonicalizeRole(candidateRole) === filterValue;
}
