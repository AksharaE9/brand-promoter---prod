'use strict';

/**
 * scripts/exports/export_bangalore_candidates.js
 *
 * Export ATS Candidates to Excel for specific cities and role families.
 * Fully parameterized for Bangalore, Hyderabad, and future cities.
 *
 * Usage:
 *   # Hyderabad Telecalling Export:
 *   node scripts/exports/export_bangalore_candidates.js --city hyderabad --families telecalling [YYYY-MM-DD]
 *
 *   # Bangalore BD / Field Sales / Telecalling Export (Default):
 *   node scripts/exports/export_bangalore_candidates.js [YYYY-MM-DD]
 *   node scripts/exports/export_bangalore_candidates.js --city bangalore --families bd,fieldsales,telecalling [YYYY-MM-DD]
 */

const path = require('path');
const fs = require('fs');

const backendNodeModules = path.resolve(__dirname, '../../backend/node_modules');
module.paths.push(backendNodeModules);

require(path.join(backendNodeModules, 'dotenv')).config({
  path: path.resolve(__dirname, '../../backend/.env')
});

const { PrismaClient } = require(path.join(backendNodeModules, '@prisma/client'));
const ExcelJS = require(path.join(backendNodeModules, 'exceljs'));

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

// Normalize text helper
function normalizeText(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\w\s&/()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Formula injection protection and empty placeholder cleaner
function sanitizeExcelValue(val, isPhone = false) {
  if (val === null || val === undefined) return '';
  const s = String(val).trim();
  const lower = s.toLowerCase();
  if (
    s === '' ||
    lower === 'null' ||
    lower === 'undefined' ||
    lower === 'nan' ||
    s === '-' ||
    s === '--' ||
    s === '---' ||
    lower === 'n/a' ||
    lower === 'na' ||
    lower === 'none'
  ) {
    return '';
  }
  if (!isPhone && (s.startsWith('=') || s.startsWith('+') || s.startsWith('-') || s.startsWith('@'))) {
    return `'${s}`;
  }
  return s;
}

// Convert timestamp / date string to IST Date object for Excel
function toISTDate(dateInput) {
  if (!dateInput) return null;
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(d.getTime() + istOffsetMs);
  return new Date(Date.UTC(
    istTime.getUTCFullYear(),
    istTime.getUTCMonth(),
    istTime.getUTCDate(),
    istTime.getUTCHours(),
    istTime.getUTCMinutes(),
    istTime.getUTCSeconds()
  ));
}

// Phone validator and normalizer
function parsePhone(rawPhone) {
  if (!rawPhone) {
    return { raw: '', normalized: '', isValid: false, isPlaceholder: false, isMissing: true };
  }
  const digits = String(rawPhone).replace(/\D/g, '');
  let clean = digits;
  if (digits.length === 12 && digits.startsWith('91')) clean = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) clean = digits.slice(1);

  const isPlaceholder = /^(0{10}|1{10}|9{10}|1234567890)$/.test(clean);
  const isValid = clean.length === 10 && /^[6-9]/.test(clean) && !isPlaceholder;
  const normalized = isValid ? `+91${clean}` : (clean ? `+91${clean}` : '');

  return {
    raw: String(rawPhone).trim(),
    normalized,
    isValid,
    isPlaceholder,
    isMissing: false
  };
}

// Email validator
function parseEmail(rawEmail) {
  if (!rawEmail) {
    return { raw: '', isValid: false, isPlaceholder: false, isMissing: true };
  }
  const clean = String(rawEmail).trim().toLowerCase();
  const isPlaceholder = !clean || clean === 'n/a' || clean === 'na' || clean.includes('dummy') || clean.includes('test');
  const isValid = clean.includes('@') && clean.includes('.') && !isPlaceholder;

  return {
    raw: String(rawEmail).trim(),
    isValid,
    isPlaceholder,
    isMissing: !clean || clean === 'n/a' || clean === 'na'
  };
}

// ─────────────────────────────────────────────
// ROLE EVALUATION (BD, Field Sales, Telecalling)
// ─────────────────────────────────────────────
function evaluateRole(rawText, targetFamilies = ['Telecalling', 'Business Development', 'Field Sales']) {
  if (!rawText) return null;
  const norm = normalizeText(rawText);
  if (!norm) return null;

  // Explicit false positives exclusions (Part 3.4)
  const isBusinessAnalyst = /\b(?:business\s+analyst|ba\s+intern|ba\b|business\s+analytics)\b/i.test(norm);
  const isDataAnalyst = /\b(?:data\s+analyst|da\b|data\s+analytics)\b/i.test(norm);
  const isTech = /\b(?:developer|software|qa|test\s+engineer|ci\s+test|web\s+developer|tech\+ops)\b/i.test(norm);
  const isHR = /\b(?:human\s+resource|hr\s+intern|hr\b|recruiter)\b/i.test(norm);
  const isOps = /\b(?:operations|ops\s+intern|ops\b|business\s+operations|business\s+ops)\b/i.test(norm);
  const isDigitalMarketing = /\b(?:digital\s+marketing|seo)\b/i.test(norm);
  const isTelecomTech = /\b(?:telecom\s+engineer|telecom\s+technician|telecom)\b/i.test(norm);
  const isTV = /\b(?:television|tv)\b/i.test(norm);
  const isChatSupport = /\b(?:customer\s+support\s*\((?:chat|email|non[- ]?voice)\)|chat\s+support|email\s+support|non[- ]?voice)\b/i.test(norm);

  if (isDigitalMarketing) {
    return { status: 'EXCLUDE', reason: 'Digital marketing / SEO', raw: rawText, norm };
  }
  if (isTelecomTech) {
    return { status: 'EXCLUDE', reason: 'Telecom Engineer / Telecom Technician', raw: rawText, norm };
  }
  if (isTV) {
    return { status: 'EXCLUDE', reason: 'Television / TV', raw: rawText, norm };
  }
  if (isChatSupport) {
    return { status: 'EXCLUDE', reason: 'Customer support (chat / email / non-voice)', raw: rawText, norm };
  }

  // Telecalling regex (Part 3.2 - explicit misspelling family + standard keywords)
  // Handles: telecaller, tele-caller, tele caller, telecalling, tele calling, telecalling executive,
  // tellecaling, tellecalling, telecaling, tele caling, telicaller, telecaler, tellicalling, telicalling
  const telecallingMisspelling = /\b(?:tel+[ei]\s*-?\s*cal+(?:l)?(?:ing|er|ers|ings)?)\b/i;
  const telesalesRegex = /\b(?:telesales|tele\s*sales|tele\s*sales\s*executive|telle\s*sales)\b/i;
  const telemarketingRegex = /\b(?:telemarketing|tele\s*marketing|telemarketer)\b/i;
  const callingRegex = /\b(?:calling\s*executive|calling\s*agent|outbound\s*calling|inbound\s*calling|cold\s*calling|bde\s*\(?callings?\)?)\b/i;
  const voiceRegex = /\b(?:voice\s*process(?:\s*executive)?|bpo\s*voice|international\s*voice|domestic\s*voice)\b/i;
  const insideSalesRegex = /\b(?:inside\s*sales(?:\s*executive|\s*associate)?)\b/i;
  const teleCounsellorRegex = /\b(?:tele\s*counsellor|tele-counselling|tele\s*counselling)\b/i;

  const isTelecalling = telecallingMisspelling.test(norm) ||
    telesalesRegex.test(norm) ||
    telemarketingRegex.test(norm) ||
    callingRegex.test(norm) ||
    voiceRegex.test(norm) ||
    insideSalesRegex.test(norm) ||
    teleCounsellorRegex.test(norm) ||
    norm.includes('marketing intern (telecalling)') ||
    norm.includes('tellicalling') ||
    norm.includes('telicalling');

  // Business Development regex
  const bdRegex = /\b(?:bde|bda|business\s+development|corporate\s+sales|b2b\s+sales|sme|client\s+acquisition|key\s+account|bd\s+sales)\b/i || (/\bbd\b/i.test(norm) && !norm.includes('bds'));
  const isBD = bdRegex.test(norm) || /\bbd\b/i.test(norm);

  // Field Sales regex
  const fieldSalesRegex = /\b(?:field\s+sales|fse|field\s+executive|ground\s+sales|direct\s+sales|outdoor\s+sales|feet\s+on\s+street|field\s+sales\s+associate|kiosk\s+sales|brand\s+promoter|shop\s+events?|women\s+in\s+bp|sales\s+executive|sales\s+officer|territory\s+sales|area\s+sales|sales\s+and\s+marketing|sales\s*&\s*marketing|s\s*&\s*m)\b/i;
  const isBrandPromoter = /\b(?:brand\s+promoter|shop\s+events?|bp|women\s+in\s+bp)\b/i.test(norm);
  const isSalesStandalone = /\b(?:sales)\b/i.test(norm);
  const isFieldSales = fieldSalesRegex.test(norm) || norm.includes('marketing intern (field)') || isBrandPromoter || (isSalesStandalone && !isTelecalling && !isBD);

  // Ambiguous roles for REVIEW (Part 3.3)
  const isCustomerSupportAmbiguous = /\b(?:customer\s+care(?:\s+executive)?|customer\s+support|customer\s+service(?:\s+executive)?)\b/i.test(norm);
  const isAdmissionCounsellor = /\b(?:admission\s+counsellor|admission\s+counselor)\b/i.test(norm);
  const isLeadGen = /\b(?:lead\s+generation(?:\s+executive)?)\b/i.test(norm);
  const isSalesCoordinator = /\b(?:sales\s+coordinator)\b/i.test(norm);
  const isPreSales = /\b(?:pre\s*-?sales(?:\s+executive)?)\b/i.test(norm);
  const isRelationshipExec = /\b(?:relationship\s+executive)\b/i.test(norm);
  const isCollections = /\b(?:collections\s+executive|recovery\s*\(?calling\)?)\b/i.test(norm);

  if (!isBD && !isFieldSales && !isTelecalling) {
    if (isBusinessAnalyst) return { status: 'EXCLUDE', reason: 'Business Analyst / Analytics', raw: rawText, norm };
    if (isDataAnalyst) return { status: 'EXCLUDE', reason: 'Data Analyst', raw: rawText, norm };
    if (isTech) return { status: 'EXCLUDE', reason: 'Technical / Developer', raw: rawText, norm };
    if (isHR) return { status: 'EXCLUDE', reason: 'HR / Recruiter', raw: rawText, norm };
    if (isOps) return { status: 'EXCLUDE', reason: 'Operations', raw: rawText, norm };

    if (isCustomerSupportAmbiguous) {
      return { status: 'REVIEW', reason: 'Customer Care / Support (voice vs chat not stated)', matchedFamily: 'Telecalling', raw: rawText, norm };
    }
    if (isAdmissionCounsellor) {
      return { status: 'REVIEW', reason: 'Admission Counsellor (ambiguous calling)', matchedFamily: 'Telecalling', raw: rawText, norm };
    }
    if (isLeadGen) {
      return { status: 'REVIEW', reason: 'Lead Generation Executive (ambiguous calling)', matchedFamily: 'Telecalling', raw: rawText, norm };
    }
    if (isSalesCoordinator) {
      return { status: 'REVIEW', reason: 'Sales Coordinator (ambiguous)', matchedFamily: 'Telecalling', raw: rawText, norm };
    }
    if (isPreSales) {
      return { status: 'REVIEW', reason: 'Pre-sales Executive (ambiguous)', matchedFamily: 'Telecalling', raw: rawText, norm };
    }
    if (isRelationshipExec) {
      return { status: 'REVIEW', reason: 'Relationship Executive (ambiguous)', matchedFamily: 'Telecalling', raw: rawText, norm };
    }
    if (isCollections) {
      return { status: 'REVIEW', reason: 'Collections Executive / Recovery', matchedFamily: 'Telecalling', raw: rawText, norm };
    }
    if (/\b(?:marketing\s+intern|marketing)\b/i.test(norm)) {
      return { status: 'REVIEW', reason: 'Generic marketing / marketing intern without field/telecalling qualifier', matchedFamily: 'Field Sales / Telecalling', raw: rawText, norm };
    }
    if (/\b(?:marketing\s+executive|me\b)\b/i.test(norm)) {
      return { status: 'REVIEW', reason: 'Generic marketing executive without field qualifier', matchedFamily: 'Field Sales', raw: rawText, norm };
    }
    if (/\b(?:sales\s+engineer|pre\s*sales\s+engineer)\b/i.test(norm)) {
      return { status: 'REVIEW', reason: 'Sales Engineer / Technical sales', matchedFamily: 'Field Sales', raw: rawText, norm };
    }

    return { status: 'EXCLUDE', reason: 'Unrelated role', raw: rawText, norm };
  }

  // Filter matched families according to targetFamilies
  const matchedFamilies = [];
  if (isTelecalling && targetFamilies.includes('Telecalling')) matchedFamilies.push('Telecalling');
  if (isBD && targetFamilies.includes('Business Development')) matchedFamilies.push('Business Development');
  if (isFieldSales && targetFamilies.includes('Field Sales')) matchedFamilies.push('Field Sales');

  if (matchedFamilies.length === 0) {
    return {
      status: 'EXCLUDE',
      reason: `Non-target family (matched ${isBD ? 'BD' : (isFieldSales ? 'Field Sales' : 'Other')})`,
      raw: rawText,
      norm
    };
  }

  const isIntern = /\b(?:intern|internship|interns)\b/i.test(norm);

  return {
    status: 'INCLUDE',
    families: matchedFamilies,
    isIntern,
    matchedKeyword: norm,
    raw: rawText,
    norm
  };
}

// ─────────────────────────────────────────────
// CITY PROFILES (Bangalore & Hyderabad)
// ─────────────────────────────────────────────

// Bangalore
const BANGALORE_CITIES = [
  'bangalore', 'bengaluru', 'banglore', 'bangalor', 'bengalore',
  'banaglore', 'bangaluru', 'bengaluru urban', 'bangalore urban',
  'bengaluru rural', 'bangalore rural', 'blr', 'banagalore', 'benglore',
  'blore', 'banglotre', 'bagalore', 'bengalurur', 'nangloreb'
];

const BANGALORE_LOCALITIES = [
  'whitefield', 'marathahalli', 'marathalli', 'kr puram', 'electronic city',
  'hsr layout', 'koramangala', 'btm layout', 'jayanagar', 'jp nagar',
  'indiranagar', 'hebbal', 'yelahanka', 'yelhanka', 'rajajinagar',
  'malleshwaram', 'mallashwaram', 'banashankari', 'banshankri', 'basavanagudi',
  'peenya', 'yeshwanthpur', 'yashwantpur', 'bellandur', 'beldur', 'sarjapur',
  'sarja pura', 'hoodi', 'mahadevapura', 'varthur', 'kundalahalli',
  'bommanahalli', 'bommasandra', 'hosur road', 'kengeri', 'vijayanagar',
  'vijaynagar', 'rt nagar', 'hennur', 'ramamurthy nagar', 'rammuurthi nagar',
  'ramurthy nagar', 'banaswadi', 'kalyan nagar', 'nagawara', 'chikkabanavara',
  'chikbanavara', 'dasarahalli', 'nelamangala', 'nelmangala', 'hoskote',
  'hosokte', 'devanahalli', 'devnahalli', 'attibele', 'anekal', 'hesarghatta',
  'laggere', 'chikkabidarakallu', 'manjunath nagar', 'harohalli', 'chansandra',
  'chanasandra', 'malleshpalya', 'sunkadakatte', 'anchepalya', 'madanayakanahalli',
  'hal', 'vajarahaali', 'sr nagar', 'gorgunta palya', 'gunjur', 'jaya mahal',
  'nagasandra', 'mudalpalya', 'girinagar', 'thalagatpurra', 'gayathrinagar',
  'avalahalli', 'nice road', 'mallasandra', 'sumanahalli', 'bannerghatta',
  'gottigere', 'baglur', 'baglur cross'
];

function evaluateLocationBangalore(rawLoc, rawArea) {
  const normLoc = normalizeText(rawLoc);
  const normArea = normalizeText(rawArea);

  for (const city of BANGALORE_CITIES) {
    const regex = new RegExp(`\\b${city}\\b`, 'i');
    if (regex.test(normLoc)) {
      return { match: true, type: 'city', matchedText: city, field: 'location' };
    }
  }

  for (const loc of BANGALORE_LOCALITIES) {
    const regex = new RegExp(`\\b${loc}\\b`, 'i');
    if (regex.test(normLoc)) {
      return { match: true, type: 'locality', matchedText: loc, field: 'location' };
    }
    if (regex.test(normArea)) {
      return { match: true, type: 'locality', matchedText: loc, field: 'area' };
    }
  }

  if (/\bhosur\b/i.test(normLoc) || /\bhosur\b/i.test(normArea)) {
    return { match: false, isReview: true, type: 'review_outer_area', reason: 'Hosur (Tamil Nadu border)', field: normLoc.includes('hosur') ? 'location' : 'area' };
  }

  if (normLoc || normArea) {
    return { match: false, isNonCity: true, reason: 'Other city / locality' };
  }

  return { match: false, isBlank: true, reason: 'Blank / missing location' };
}

// Hyderabad (Parts 3.5, 3.6, 3.7, 3.8)
const HYDERABAD_TWIN_CITIES = ['secunderabad', 'secundrabad'];

const HYDERABAD_CITY_SPELLINGS = [
  'hyderabad', 'hyd', 'hydrabad', 'hyderbad', 'hyderebad',
  'hyderabd', 'hydarabad', 'hyderabaad', 'cyberabad',
  'hyderabad telangana', 'ghmc', 'akshara-hyderabad', 'hyderabas'
];

const HYDERABAD_LOCALITIES = [
  'gachibowli', 'madhapur', 'hitec city', 'hitech city', 'kondapur',
  'kukatpally', 'kphb', 'miyapur', 'nizampet', 'bachupally',
  'chandanagar', 'lingampally', 'manikonda', 'nanakramguda',
  'financial district', 'kokapet', 'narsingi', 'ameerpet', 'begumpet',
  'somajiguda', 'panjagutta', 'banjara hills', 'jubilee hills',
  'himayatnagar', 'abids', 'koti', 'nampally', 'lakdikapul',
  'khairatabad', 'mehdipatnam', 'tolichowki', 'attapur', 'charminar',
  'malakpet', 'dilsukhnagar', 'lb nagar', 'kothapet', 'vanasthalipuram',
  'hayathnagar', 'uppal', 'habsiguda', 'tarnaka', 'nacharam',
  'mallapur', 'ecil', 'as rao nagar', 'as rao', 'kapra', 'sainikpuri',
  'malkajgiri', 'alwal', 'bowenpally', 'trimulgherry', 'kompally',
  'suchitra', 'jeedimetla', 'quthbullapur', 'shamshabad',
  'rajendranagar', 'kukatpally housing board'
];

const HYDERABAD_OUTER_AREAS = [
  'telangana', 'ranga reddy', 'rangareddy', 'medchal', 'medchal-malkajgiri',
  'medchal malkajgiri', 'sangareddy', 'patancheru', 'ghatkesar',
  'shamirpet', 'pocharam', 'bhongir'
];

function evaluateLocationHyderabad(rawLoc, rawArea) {
  const normLoc = normalizeText(rawLoc);
  const normArea = normalizeText(rawArea);

  // 1. False positive exclusion: Hyderabad, Sindh / Pakistan (Part 3.8)
  if (/\b(?:sindh|pakistan)\b/i.test(normLoc) || /\b(?:sindh|pakistan)\b/i.test(normArea)) {
    return { match: false, isExcluded: true, reason: 'Hyderabad, Sindh/Pakistan (excluded city)' };
  }

  // 2. Twin city: Secunderabad (Part 3.5)
  for (const twin of HYDERABAD_TWIN_CITIES) {
    const regex = new RegExp(`\\b${twin}\\b`, 'i');
    if (regex.test(normLoc)) {
      return { match: true, type: 'twin_city', matchedText: twin, field: 'location' };
    }
    if (regex.test(normArea)) {
      return { match: true, type: 'twin_city', matchedText: twin, field: 'area' };
    }
  }

  // 3. City name & spellings (Part 3.5)
  for (const city of HYDERABAD_CITY_SPELLINGS) {
    const regex = new RegExp(`\\b${city}\\b`, 'i');
    if (regex.test(normLoc)) {
      return { match: true, type: 'city', matchedText: city, field: 'location' };
    }
    if (regex.test(normArea)) {
      return { match: true, type: 'city', matchedText: city, field: 'area' };
    }
  }

  // 4. Locality written on its own (Part 3.6)
  for (const loc of HYDERABAD_LOCALITIES) {
    const regex = new RegExp(`\\b${loc}\\b`, 'i');
    if (regex.test(normLoc)) {
      return { match: true, type: 'locality', matchedText: loc, field: 'location' };
    }
    if (regex.test(normArea)) {
      return { match: true, type: 'locality', matchedText: loc, field: 'area' };
    }
  }

  // 5. Outer areas & Telangana alone -> Needs Review (Part 3.7)
  for (const outer of HYDERABAD_OUTER_AREAS) {
    const regex = new RegExp(`\\b${outer}\\b`, 'i');
    if (regex.test(normLoc)) {
      return { match: false, isReview: true, type: 'review_outer_area', reason: `Outer area / State: ${outer}`, field: 'location', matchedText: outer };
    }
    if (regex.test(normArea)) {
      return { match: false, isReview: true, type: 'review_outer_area', reason: `Outer area / State: ${outer}`, field: 'area', matchedText: outer };
    }
  }

  // 6. Other cities (Bangalore, Kochi, Chennai, Warangal, etc.)
  if (normLoc || normArea) {
    return { match: false, isNonCity: true, reason: 'Other city / locality' };
  }

  return { match: false, isBlank: true, reason: 'Blank / missing location' };
}

const CITY_PROFILES = {
  bangalore: {
    key: 'bangalore',
    displayName: 'Bangalore',
    defaultFamilies: ['Business Development', 'Field Sales', 'Telecalling'],
    evaluateLocation: evaluateLocationBangalore,
    filePrefix: 'Bangalore_BD_FieldSales_Telecalling_Candidates',
    isSingleFamily: false
  },
  hyderabad: {
    key: 'hyderabad',
    displayName: 'Hyderabad',
    defaultFamilies: ['Telecalling'],
    evaluateLocation: evaluateLocationHyderabad,
    filePrefix: 'Hyderabad_Telecalling_Candidates',
    isSingleFamily: true
  }
};

// Format an entire Excel worksheet with auto-width, frozen headers, and styles
function applySheetStyles(worksheet, isSummary = false) {
  const headerRow = worksheet.getRow(1);
  headerRow.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F4E78' }
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 26;

  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  if (!isSummary) {
    const lastColLetter = worksheet.getColumn(worksheet.columnCount).letter;
    worksheet.autoFilter = `A1:${lastColLetter}1`;
  }

  // Adjust column widths
  worksheet.columns.forEach((column) => {
    let maxLen = 10;
    column.eachCell({ includeEmpty: true }, (cell, rowIdx) => {
      if (rowIdx === 1) {
        maxLen = Math.max(maxLen, cell.value ? String(cell.value).length + 4 : 10);
      } else if (rowIdx <= 100 && cell.value) {
        const valLen = String(cell.value).length;
        maxLen = Math.max(maxLen, Math.min(valLen + 2, 45));
      }
    });
    column.width = Math.min(Math.max(maxLen, 12), 48);
  });
}

// CLI Argument Parsing
function parseCliArgs() {
  const args = process.argv.slice(2);
  let cityArg = 'bangalore';
  let familiesArg = null;
  let dateArg = null;
  let coursesArg = null;
  let outcomesArg = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--city' && args[i + 1]) {
      cityArg = args[++i].toLowerCase();
    } else if (a.startsWith('--city=')) {
      cityArg = a.split('=')[1].toLowerCase();
    } else if ((a === '--families' || a === '--family' || a === '--roles' || a === '--role') && args[i + 1]) {
      familiesArg = args[++i];
    } else if (a.startsWith('--families=') || a.startsWith('--roles=') || a.startsWith('--role=')) {
      familiesArg = a.split('=')[1];
    } else if ((a === '--courses' || a === '--course') && args[i + 1]) {
      coursesArg = args[++i].toLowerCase();
    } else if (a.startsWith('--courses=') || a.startsWith('--course=')) {
      coursesArg = a.split('=')[1].toLowerCase();
    } else if ((a === '--outcomes' || a === '--outcome') && args[i + 1]) {
      outcomesArg = args[++i].toLowerCase();
    } else if (a.startsWith('--outcomes=') || a.startsWith('--outcome=')) {
      outcomesArg = a.split('=')[1].toLowerCase();
    } else if (a === '--date' && args[i + 1]) {
      dateArg = args[++i];
    } else if (a.startsWith('--date=')) {
      dateArg = a.split('=')[1];
    } else if (!a.startsWith('--') && !dateArg) {
      dateArg = a;
    }
  }

  const profile = CITY_PROFILES[cityArg] || CITY_PROFILES.bangalore;

  let targetFamilies = profile.defaultFamilies;
  if (familiesArg) {
    const rawFams = familiesArg.split(',').map(s => s.trim().toLowerCase());
    targetFamilies = [];
    if (rawFams.some(f => f.includes('tele'))) targetFamilies.push('Telecalling');
    if (rawFams.some(f => f.includes('bd') || f.includes('business'))) targetFamilies.push('Business Development');
    if (rawFams.some(f => f.includes('field') || f.includes('sales'))) targetFamilies.push('Field Sales');
    if (targetFamilies.length === 0) targetFamilies = profile.defaultFamilies;
  }

  const todayStr = dateArg || new Date().toISOString().slice(0, 10);

  return { profile, targetFamilies, coursesArg, outcomesArg, cityArg, familiesArg, dateArg, todayStr };
}

async function runCityExport(cliOptions) {
  const { profile, targetFamilies, todayStr } = cliOptions || parseCliArgs();
  console.log(`Starting export pipeline for City: "${profile.displayName}", Families: [${targetFamilies.join(', ')}], Date: ${todayStr}...`);

  // Non-negotiable safety Rule 1.1: Read-only session
  await prisma.$executeRawUnsafe('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;');

  const exportsDir = path.resolve(__dirname, '../../exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  // Step 1: Pre-calculate phone and email frequencies across ALL active candidates for duplicate flagging
  console.log('Calculating contact duplicates across database...');
  const allCandidatesContacts = await prisma.candidate.findMany({
    where: { isDeleted: false, is_test_data: false },
    select: { id: true, phone: true, phoneNormalized: true, email: true }
  });

  const phoneCountMap = {};
  const emailCountMap = {};

  for (const c of allCandidatesContacts) {
    const pInfo = parsePhone(c.phoneNormalized || c.phone);
    if (pInfo.isValid) {
      phoneCountMap[pInfo.normalized] = (phoneCountMap[pInfo.normalized] || 0) + 1;
    }
    const eInfo = parseEmail(c.email);
    if (eInfo.isValid) {
      emailCountMap[eInfo.raw.toLowerCase()] = (emailCountMap[eInfo.raw.toLowerCase()] || 0) + 1;
    }
  }

  // Step 2: Keyset Pagination Streaming (Chunk size 500)
  console.log('Streaming active candidates in chunks of 500...');
  const CHUNK_SIZE = 500;
  let lastId = null;
  let hasMore = true;
  let totalCandidatesProcessed = 0;

  const appRows = [];
  const reviewRows = [];
  const qualityIssues = [];
  const matchRulesStats = {};

  function recordMatchRule(category, tier, keyword, count = 1, note = '') {
    let cleanKw = String(keyword || '').trim();
    if (!cleanKw || cleanKw === '-' || cleanKw === '--') cleanKw = '(blank / dash)';
    if (cleanKw.startsWith('=') || cleanKw.startsWith('+') || cleanKw.startsWith('-') || cleanKw.startsWith('@')) {
      cleanKw = `'${cleanKw}`;
    }
    const key = `${category}||${tier}||${cleanKw}`;
    if (!matchRulesStats[key]) {
      matchRulesStats[key] = { category, tier, keyword: cleanKw, count: 0, note };
    }
    matchRulesStats[key].count += count;
  }

  const softDeletedCount = await prisma.candidate.count({ where: { isDeleted: true } });
  const testDataCount = await prisma.candidate.count({ where: { is_test_data: true } });

  const reconciliation = {
    totalEvaluated: 0,
    excludedSoftDeleted: softDeletedCount,
    excludedTestData: testDataCount,
    includedPeople: 0,
    needsReviewCount: 0,
    droppedNoLocation: 0,
    droppedNonCity: 0,
    excludedRoles: 0
  };

  while (hasMore) {
    const chunk = await prisma.candidate.findMany({
      take: CHUNK_SIZE,
      skip: lastId ? 1 : 0,
      cursor: lastId ? { id: lastId } : undefined,
      orderBy: { id: 'asc' },
      where: {
        isDeleted: false,
        is_test_data: false
      },
      include: {
        applications: {
          where: { isDeleted: false },
          include: {
            job: true,
            interviews: {
              orderBy: { scheduledStart: 'desc' }
            }
          }
        },
        interviewFeedbacks: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          include: {
            submittedBy: {
              select: { fullName: true }
            }
          }
        },
        createdBy: {
          select: { fullName: true }
        }
      }
    });

    if (chunk.length === 0) {
      hasMore = false;
      break;
    }

    totalCandidatesProcessed += chunk.length;
    lastId = chunk[chunk.length - 1].id;

    for (const c of chunk) {
      reconciliation.totalEvaluated++;

      // Candidate contacts
      const pInfo = parsePhone(c.phoneNormalized || c.phone);
      const eInfo = parseEmail(c.email);
      const isDupPhone = pInfo.isValid && (phoneCountMap[pInfo.normalized] > 1);
      const isDupEmail = eInfo.isValid && (emailCountMap[eInfo.raw.toLowerCase()] > 1);

      // Parse customFields
      const cf = (c.customFields && typeof c.customFields === 'object') ? c.customFields : {};

      // Collect role candidates from candidate fields, applications, interviews, customFields (Part 2.1)
      const roleCandidates = [
        { text: c.preferredRole, field: 'candidate.preferredRole' },
        { text: c.jobTitle, field: 'candidate.jobTitle' },
        { text: cf.role_as_written, field: 'candidate.customFields.role_as_written' },
        { text: cf.callingTarget, field: 'candidate.customFields.callingTarget' },
        ...(c.applications || []).map(a => ({ text: a.job?.title, field: 'job.title', job: a.job, app: a })),
        ...((c.applications || []).flatMap(a => (a.interviews || []).map(i => ({ text: i.jobTitle, field: 'interview.jobTitle', job: a.job, app: a, interview: i }))))
      ].filter(r => Boolean(r.text && String(r.text).trim()));

      let bestRoleMatch = null;
      for (const r of roleCandidates) {
        const match = evaluateRole(r.text, targetFamilies);
        if (match?.status === 'INCLUDE') {
          bestRoleMatch = { ...match, field: r.field, text: r.text, job: r.job, app: r.app };
          break;
        } else if (match?.status === 'REVIEW' && !bestRoleMatch) {
          bestRoleMatch = { ...match, field: r.field, text: r.text, job: r.job, app: r.app };
        }
      }

      // If no target role matched
      if (!bestRoleMatch || bestRoleMatch.status === 'EXCLUDE') {
        reconciliation.excludedRoles++;
        recordMatchRule('Role: Excluded', 'EXCLUDE', c.preferredRole || c.jobTitle || 'Unspecified', 1, bestRoleMatch?.reason || 'Non-target role');
        continue;
      }

      // Location match: check candidate fields (location, area, customFields), then job location (Part 2.2)
      let cLocMatch = profile.evaluateLocation(c.location, c.area);
      let matchedLocField = cLocMatch.field === 'area' ? 'candidate.area' : 'candidate.location';

      if (!cLocMatch.match && !cLocMatch.isReview) {
        // Check customFields fromPlace, from_place
        if (cf.fromPlace || cf.from_place) {
          const fpMatch = profile.evaluateLocation(cf.fromPlace || cf.from_place, null);
          if (fpMatch.match || fpMatch.isReview) {
            cLocMatch = fpMatch;
            matchedLocField = cf.fromPlace ? 'candidate.customFields.fromPlace' : 'candidate.customFields.from_place';
          }
        }
      }

      let finalLocMatch = cLocMatch.match ? { ...cLocMatch, field: matchedLocField } : null;
      let isLocationReview = cLocMatch.isReview;
      let locationReviewReason = cLocMatch.reason || '';

      if (!finalLocMatch) {
        // Check linked job location
        for (const a of c.applications || []) {
          if (a.job?.location) {
            const jLocMatch = profile.evaluateLocation(a.job.location, null);
            if (jLocMatch.match) {
              finalLocMatch = { ...jLocMatch, field: 'job.location', type: 'job_location' };
              isLocationReview = false; // Resolved by job location
              break;
            } else if (jLocMatch.isReview && !isLocationReview) {
              isLocationReview = true;
              locationReviewReason = jLocMatch.reason || '';
            }
          }
        }
      }

      // Location check results
      if (!finalLocMatch && !isLocationReview) {
        if (cLocMatch.isBlank) {
          reconciliation.droppedNoLocation++;
          recordMatchRule('Location: Missing / Blank', 'EXCLUDE', 'Blank location', 1, `Dropped because candidate and job location were blank for ${profile.displayName}`);
        } else {
          reconciliation.droppedNonCity++;
          recordMatchRule('Location: Excluded Cities', 'EXCLUDE', c.location || c.area || 'Other city', 1, `Non-${profile.displayName} location`);
        }
        continue;
      }

      // Record matched location rule
      if (finalLocMatch) {
        if (finalLocMatch.type === 'city') {
          recordMatchRule(`Location: City Name (${profile.displayName})`, 'INCLUDE', finalLocMatch.matchedText, 1, `${profile.displayName} city spelling`);
        } else if (finalLocMatch.type === 'twin_city') {
          recordMatchRule(`Location: Twin City (${profile.displayName})`, 'INCLUDE', finalLocMatch.matchedText, 1, `Twin city of ${profile.displayName}`);
        } else if (finalLocMatch.type === 'locality') {
          recordMatchRule(`Location: Locality Match (${profile.displayName})`, 'INCLUDE', finalLocMatch.matchedText, 1, `${profile.displayName} locality`);
        } else {
          recordMatchRule(`Location: Job Location (${profile.displayName})`, 'INCLUDE', finalLocMatch.matchedText, 1, `Matched via linked job location in ${profile.displayName}`);
        }
      } else if (isLocationReview) {
        recordMatchRule(`Location: Needs Review (${profile.displayName})`, 'REVIEW', c.location || c.area || 'Outer area', 1, locationReviewReason);
      }

      // Interview and feedback details
      const latestFeedback = (c.interviewFeedbacks && c.interviewFeedbacks.length > 0) ? c.interviewFeedbacks[0] : null;
      const latestInterview = (c.applications && c.applications.length > 0 && c.applications[0].interviews && c.applications[0].interviews.length > 0)
        ? c.applications[0].interviews[0] : null;

      const totalRounds = Math.max(c.interviewFeedbacks?.length || 0, (c.applications || []).reduce((acc, a) => acc + (a.interviews?.length || 0), 0));
      const latestRoundNum = latestFeedback?.round || (latestInterview?.roundNo ? `Round ${latestInterview.roundNo}` : '');
      const latestRoundDate = toISTDate(latestFeedback?.createdAt || latestInterview?.scheduledStart);
      const latestRoundOutcome = latestFeedback?.selectionStatus || latestInterview?.outcome || latestInterview?.result || '';
      const latestPanelist = latestFeedback?.submittedBy?.fullName || latestFeedback?.feedbackData?.panelists || latestInterview?.interviewerNames || '';
      const latestRating = latestFeedback?.overallRating !== null && latestFeedback?.overallRating !== undefined
        ? latestFeedback.overallRating
        : (cf.raw_rating || cf.rating_verbatim || '');
      const rawComment = latestFeedback?.feedbackData?.comments || latestFeedback?.feedbackData?.rawComments || latestInterview?.notes || cf.rawComments || cf.comments_verbatim || '';
      const latestComment = String(rawComment).slice(0, 500);

      // Offer and Joined status
      const offerStatus = c.offerDecision || (c.status === 'OFFER_SENT' ? 'OFFER_SENT' : '');
      const isJoined = (c.status === 'JOINED' || Boolean(c.doj) || (c.applications || []).some(a => a.status === 'JOINED')) ? 'Yes' : 'No';
      const joiningDate = toISTDate(c.doj || latestFeedback?.feedbackData?.doj || (c.applications && c.applications[0]?.joiningDate));

      const isIntern = bestRoleMatch.isIntern || c.category === 'Intern' ? 'Yes' : 'No';

      // Telecalling-relevant derived fields (Part 4)
      const rawLanguages = String(cf.languages_known || cf.languages_known_verbatim || '').trim();
      const languagesKnown = sanitizeExcelValue(rawLanguages);
      const teluguKnown = rawLanguages ? (/\btelugu\b/i.test(rawLanguages) ? 'Y' : 'N') : '';
      const hindiKnown = rawLanguages ? (/\bhindi\b/i.test(rawLanguages) ? 'Y' : 'N') : '';
      const englishKnown = rawLanguages ? (/\benglish\b/i.test(rawLanguages) ? 'Y' : 'N') : '';
      const priorExperience = sanitizeExcelValue(cf.prior_experience_verbatim || cf.professionalExperience || '');
      const availableTimings = sanitizeExcelValue(cf.timings || cf.timings_verbatim || '');
      const noticePeriod = sanitizeExcelValue(cf.notice_period || '');

      const matchTier = (bestRoleMatch.status === 'INCLUDE' && finalLocMatch) ? 'INCLUDE' : 'REVIEW';
      const reviewReason = [
        bestRoleMatch.status === 'REVIEW' ? `Role: ${bestRoleMatch.reason}` : '',
        isLocationReview ? `Location: ${locationReviewReason}` : ''
      ].filter(Boolean).join('; ');

      const rowData = {
        candidateId: c.id,
        fullName: sanitizeExcelValue(c.fullName),
        phone: pInfo.raw,
        phoneNormalized: pInfo.normalized,
        alternatePhone: sanitizeExcelValue(cf.alternatePhone || ''),
        email: eInfo.raw === 'N/A' ? '' : eInfo.raw,
        phoneValid: pInfo.isValid ? 'Yes' : 'No',
        emailValid: eInfo.isValid ? 'Yes' : 'No',
        roleFamily: (bestRoleMatch.families || [bestRoleMatch.matchedFamily || 'Needs Review']).join(', '),
        roleAsStored: sanitizeExcelValue(bestRoleMatch.text),
        fieldRoleMatched: bestRoleMatch.field,
        keywordMatched: bestRoleMatch.matchedKeyword || bestRoleMatch.norm,
        matchTier,
        jobTitle: sanitizeExcelValue(bestRoleMatch.job?.title || c.jobTitle || ''),
        jobId: bestRoleMatch.job?.id || '',
        isIntern,
        locationAsStored: sanitizeExcelValue(c.location || ''),
        area: sanitizeExcelValue(c.area || ''),
        fieldLocationMatched: finalLocMatch?.field || matchedLocField,
        locationMatchType: finalLocMatch?.type || (isLocationReview ? 'review_outer_area' : ''),
        languagesKnown,
        teluguKnown,
        hindiKnown,
        englishKnown,
        priorExperience,
        availableTimings,
        noticePeriod,
        currentStatus: sanitizeExcelValue(c.status || ''),
        currentStage: sanitizeExcelValue(c.currentStage || ''),
        overallOutcome: sanitizeExcelValue(latestRoundOutcome || c.status || ''),
        totalInterviewRounds: totalRounds || '',
        latestRoundNumber: latestRoundNum,
        latestRoundDate,
        latestRoundOutcome: sanitizeExcelValue(latestRoundOutcome),
        latestRoundPanelist: sanitizeExcelValue(latestPanelist),
        latestRating: latestRating !== '' ? latestRating : '',
        latestFeedbackComment: sanitizeExcelValue(latestComment),
        offerStatus: sanitizeExcelValue(offerStatus),
        joined: isJoined,
        dateOfJoining: joiningDate,
        college: sanitizeExcelValue(c.college || cf.drive_college || cf.college_on_resume || ''),
        course: sanitizeExcelValue(c.course || ''),
        graduationYear: sanitizeExcelValue(c.graduationYear || ''),
        currentCompany: sanitizeExcelValue(c.currentCompany || ''),
        totalExperienceYears: c.totalExperienceYears !== null && c.totalExperienceYears !== undefined ? c.totalExperienceYears : '',
        currentCTC: sanitizeExcelValue(cf.current_ctc || ''),
        expectedCTC: sanitizeExcelValue(cf.expected_ctc || ''),
        source: sanitizeExcelValue(c.source || ''),
        hiringDriveName: sanitizeExcelValue(cf.import_slug || ''),
        recruiter: sanitizeExcelValue(c.assignedRecruiterName || c.createdBy?.fullName || ''),
        createdDate: toISTDate(c.createdAt),
        lastUpdatedDate: toISTDate(c.updatedAt),
        resumeLink: sanitizeExcelValue(c.resumeLinkOriginal || c.resumeLinkDownload || ''),
        linkedIn: sanitizeExcelValue(cf.linkedin || ''),
        duplicatePhone: isDupPhone ? 'Yes' : 'No',
        duplicateEmail: isDupEmail ? 'Yes' : 'No',
        placeholderContact: (pInfo.isPlaceholder || eInfo.isPlaceholder) ? 'Yes' : 'No',
        missingPhone: pInfo.isMissing ? 'Yes' : 'No',
        missingEmail: eInfo.isMissing ? 'Yes' : 'No',
        testRecord: c.is_test_data ? 'Yes' : 'No',
        reviewReason,
        families: bestRoleMatch.families || []
      };

      // Quality issues logging
      if (!pInfo.isValid || pInfo.isPlaceholder || pInfo.isMissing) {
        qualityIssues.push({
          candidateId: c.id,
          fullName: rowData.fullName,
          phone: rowData.phone,
          email: rowData.email,
          roleFamily: rowData.roleFamily,
          issueType: pInfo.isMissing ? 'Missing Phone' : (pInfo.isPlaceholder ? 'Placeholder Phone' : 'Invalid Phone Format'),
          details: `Phone: "${pInfo.raw}"`
        });
      }
      if (isDupPhone) {
        qualityIssues.push({
          candidateId: c.id,
          fullName: rowData.fullName,
          phone: rowData.phone,
          email: rowData.email,
          roleFamily: rowData.roleFamily,
          issueType: 'Duplicate Phone',
          details: `Phone normalized ${pInfo.normalized} shared by ${phoneCountMap[pInfo.normalized]} records`
        });
      }
      if (!eInfo.isValid || eInfo.isPlaceholder || eInfo.isMissing) {
        qualityIssues.push({
          candidateId: c.id,
          fullName: rowData.fullName,
          phone: rowData.phone,
          email: rowData.email,
          roleFamily: rowData.roleFamily,
          issueType: eInfo.isMissing ? 'Missing Email' : (eInfo.isPlaceholder ? 'Placeholder Email' : 'Invalid Email Format'),
          details: `Email: "${eInfo.raw}"`
        });
      }
      if (isDupEmail) {
        qualityIssues.push({
          candidateId: c.id,
          fullName: rowData.fullName,
          phone: rowData.phone,
          email: rowData.email,
          roleFamily: rowData.roleFamily,
          issueType: 'Duplicate Email',
          details: `Email ${eInfo.raw} shared by ${emailCountMap[eInfo.raw.toLowerCase()]} records`
        });
      }

      if (matchTier === 'REVIEW') {
        reconciliation.needsReviewCount++;
        reviewRows.push(rowData);
        recordMatchRule('Review Candidates', 'REVIEW', bestRoleMatch.text, 1, reviewReason);
      } else {
        // Confirmed INCLUDE
        appRows.push(rowData);
        for (const fam of bestRoleMatch.families) {
          recordMatchRule(`Role: ${fam}`, 'INCLUDE', bestRoleMatch.text, 1, `Matched keyword ${bestRoleMatch.matchedKeyword}`);
        }
      }
    }
  }

  console.log(`Finished processing all ${totalCandidatesProcessed} candidate records.`);

  // Step 3: Deduplicate people across records per Part 5.2 (by normalized phone, then email)
  console.log('Deduplicating people for main candidate sheet...');
  const personMap = new Map();

  for (const row of appRows) {
    let personKey;
    if (row.phoneNormalized && row.phoneValid === 'Yes' && row.placeholderContact === 'No') {
      personKey = `phone:${row.phoneNormalized}`;
    } else if (row.email && row.emailValid === 'Yes' && row.placeholderContact === 'No') {
      personKey = `email:${row.email.toLowerCase()}`;
    } else {
      personKey = `id:${row.candidateId}`;
    }

    if (!personMap.has(personKey)) {
      personMap.set(personKey, {
        primary: { ...row },
        allIds: [row.candidateId],
        allFamilies: new Set(row.families)
      });
    } else {
      const entry = personMap.get(personKey);
      entry.allIds.push(row.candidateId);
      row.families.forEach(f => entry.allFamilies.add(f));
      // Refresh with more complete details if needed
      if (!entry.primary.phone && row.phone) entry.primary.phone = row.phone;
      if (!entry.primary.email && row.email) entry.primary.email = row.email;
      if (!entry.primary.locationAsStored && row.locationAsStored) entry.primary.locationAsStored = row.locationAsStored;
      if (row.dateOfJoining) entry.primary.dateOfJoining = row.dateOfJoining;
    }
  }

  const uniquePeopleRows = [];
  let multiRecordPeopleCount = 0;

  for (const entry of personMap.values()) {
    if (entry.allIds.length > 1) {
      multiRecordPeopleCount++;
    }
    const p = entry.primary;
    p.candidateRecordIds = entry.allIds.join(', ');
    p.totalRecordsMerged = entry.allIds.length;
    p.roleFamily = Array.from(entry.allFamilies).join(', ');
    p.families = Array.from(entry.allFamilies);
    uniquePeopleRows.push(p);
  }

  reconciliation.includedPeople = uniquePeopleRows.length;

  console.log(`Deduplicated into ${uniquePeopleRows.length} unique people (${multiRecordPeopleCount} people with multiple candidate records).`);

  // Sort rows: by status, then latest round date descending
  const statusOrder = {
    ACTIVE: 1,
    SCREENING: 2,
    INTERVIEWING: 3,
    OFFER_SENT: 4,
    JOINED: 5,
    ON_HOLD: 6,
    REJECTED: 7,
    OFFER_DECLINED: 8
  };

  function sortRows(a, b) {
    const sA = statusOrder[a.currentStatus] || 99;
    const sB = statusOrder[b.currentStatus] || 99;
    if (sA !== sB) return sA - sB;
    const dateA = a.latestRoundDate ? a.latestRoundDate.getTime() : 0;
    const dateB = b.latestRoundDate ? b.latestRoundDate.getTime() : 0;
    return dateB - dateA;
  }

  uniquePeopleRows.sort(sortRows);
  appRows.sort(sortRows);
  reviewRows.sort(sortRows);

  // Step 4: Build Excel Workbook
  console.log('Building Excel workbook with ExcelJS...');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Antigravity ATS Local Export Script';
  workbook.lastModifiedBy = 'Antigravity ATS Local Export Script';
  workbook.created = new Date();
  workbook.modified = new Date();

  // Column definitions (Part 4)
  const standardColumns = [
    { header: 'Candidate ID', key: 'candidateId' },
    { header: 'Full Name', key: 'fullName' },
    { header: 'Phone (as stored)', key: 'phone' },
    { header: 'Phone Normalised', key: 'phoneNormalized' },
    { header: 'Alternate Phone', key: 'alternatePhone' },
    { header: 'Email', key: 'email' },
    { header: 'Phone Valid?', key: 'phoneValid' },
    { header: 'Email Valid?', key: 'emailValid' },
    { header: 'Role Family', key: 'roleFamily' },
    { header: 'Role As Stored', key: 'roleAsStored' },
    { header: 'Field Role Matched In', key: 'fieldRoleMatched' },
    { header: 'Keyword Matched', key: 'keywordMatched' },
    { header: 'Match Tier', key: 'matchTier' },
    { header: 'Job Title', key: 'jobTitle' },
    { header: 'Job ID', key: 'jobId' },
    { header: 'Is Intern?', key: 'isIntern' },
    { header: 'Location As Stored', key: 'locationAsStored' },
    { header: 'Area / Locality', key: 'area' },
    { header: 'Field Location Matched In', key: 'fieldLocationMatched' },
    { header: 'Location Match Type', key: 'locationMatchType' },
    { header: 'Languages Known', key: 'languagesKnown' },
    { header: 'Telugu? (Y/N)', key: 'teluguKnown' },
    { header: 'Hindi? (Y/N)', key: 'hindiKnown' },
    { header: 'English? (Y/N)', key: 'englishKnown' },
    { header: 'Prior Calling / BPO / Sales Experience', key: 'priorExperience' },
    { header: 'Available Timings / Shift Preference', key: 'availableTimings' },
    { header: 'Notice Period', key: 'noticePeriod' },
    { header: 'Current Status', key: 'currentStatus' },
    { header: 'Current Stage', key: 'currentStage' },
    { header: 'Overall Outcome', key: 'overallOutcome' },
    { header: 'Total Interview Rounds', key: 'totalInterviewRounds' },
    { header: 'Latest Round Number', key: 'latestRoundNumber' },
    { header: 'Latest Round Date', key: 'latestRoundDate' },
    { header: 'Latest Round Outcome', key: 'latestRoundOutcome' },
    { header: 'Latest Round Panelist', key: 'latestRoundPanelist' },
    { header: 'Latest Rating', key: 'latestRating' },
    { header: 'Latest Feedback Comment', key: 'latestFeedbackComment' },
    { header: 'Offer Status', key: 'offerStatus' },
    { header: 'Joined?', key: 'joined' },
    { header: 'Date of Joining', key: 'dateOfJoining' },
    { header: 'College / University', key: 'college' },
    { header: 'Course / Degree', key: 'course' },
    { header: 'Batch / Graduation Year', key: 'graduationYear' },
    { header: 'Current Company', key: 'currentCompany' },
    { header: 'Total Experience (Years)', key: 'totalExperienceYears' },
    { header: 'Current CTC', key: 'currentCTC' },
    { header: 'Expected CTC', key: 'expectedCTC' },
    { header: 'Source', key: 'source' },
    { header: 'Hiring Drive Name', key: 'hiringDriveName' },
    { header: 'Recruiter / Owner', key: 'recruiter' },
    { header: 'Created Date', key: 'createdDate' },
    { header: 'Last Updated Date', key: 'lastUpdatedDate' },
    { header: 'Resume Link', key: 'resumeLink' },
    { header: 'LinkedIn', key: 'linkedIn' },
    { header: 'Duplicate Phone?', key: 'duplicatePhone' },
    { header: 'Duplicate Email?', key: 'duplicateEmail' },
    { header: 'Placeholder Contact?', key: 'placeholderContact' },
    { header: 'Missing Phone?', key: 'missingPhone' },
    { header: 'Missing Email?', key: 'missingEmail' },
    { header: 'Test Record?', key: 'testRecord' }
  ];

  function writeRowsToWorksheet(sheet, rows, extraCols = []) {
    sheet.columns = [...extraCols, ...standardColumns];

    rows.forEach(r => {
      const row = sheet.addRow(r);

      // Explicit string format for phone numbers to prevent formula or scientific notation
      const phoneColIdx = sheet.getColumn('phone').number;
      const phoneNormColIdx = sheet.getColumn('phoneNormalized').number;
      const commentColIdx = sheet.getColumn('latestFeedbackComment').number;

      const pCell = row.getCell(phoneColIdx);
      pCell.value = String(r.phone || '');
      pCell.numFmt = '@';

      const pNormCell = row.getCell(phoneNormColIdx);
      pNormCell.value = String(r.phoneNormalized || '');
      pNormCell.numFmt = '@';

      // Dates format
      const createdColIdx = sheet.getColumn('createdDate').number;
      const updatedColIdx = sheet.getColumn('lastUpdatedDate').number;
      const roundDateColIdx = sheet.getColumn('latestRoundDate').number;
      const dojColIdx = sheet.getColumn('dateOfJoining').number;

      if (r.createdDate) row.getCell(createdColIdx).numFmt = 'dd-mm-yyyy hh:mm';
      if (r.lastUpdatedDate) row.getCell(updatedColIdx).numFmt = 'dd-mm-yyyy hh:mm';
      if (r.latestRoundDate) row.getCell(roundDateColIdx).numFmt = 'dd-mm-yyyy';
      if (r.dateOfJoining) row.getCell(dojColIdx).numFmt = 'dd-mm-yyyy';

      // Text wrapping for feedback comments
      row.getCell(commentColIdx).alignment = { wrapText: true, vertical: 'top' };
    });

    applySheetStyles(sheet);
  }

  // --- SHEET 1: Summary ---
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 42 },
    { header: 'Value', key: 'val', width: 22 },
    { header: 'Description / Notes', key: 'desc', width: 60 }
  ];

  const totalInterns = uniquePeopleRows.filter(r => r.isIntern === 'Yes').length;
  const cityMatches = uniquePeopleRows.filter(r => r.locationMatchType === 'city').length;
  const twinCityMatches = uniquePeopleRows.filter(r => r.locationMatchType === 'twin_city').length;
  const localityMatches = uniquePeopleRows.filter(r => r.locationMatchType === 'locality').length;
  const jobLocationMatches = uniquePeopleRows.filter(r => r.locationMatchType === 'job_location').length;

  const teluguSpeakers = uniquePeopleRows.filter(r => r.teluguKnown === 'Y').length;
  const hindiSpeakers = uniquePeopleRows.filter(r => r.hindiKnown === 'Y').length;
  const englishSpeakers = uniquePeopleRows.filter(r => r.englishKnown === 'Y').length;

  // Status breakdown
  const statusCounts = {};
  uniquePeopleRows.forEach(r => {
    const st = r.currentStatus || 'UNKNOWN';
    statusCounts[st] = (statusCounts[st] || 0) + 1;
  });

  const reconciliationCheckSum = appRows.length + reconciliation.needsReviewCount + reconciliation.droppedNoLocation + reconciliation.droppedNonCity + reconciliation.excludedRoles;

  const summaryData = [
    { metric: 'Run Date & Time (IST)', val: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }), desc: 'Local script execution timestamp' },
    { metric: 'Target City Profile', val: profile.displayName, desc: `City filter profile: ${profile.key}` },
    { metric: 'Target Role Families', val: targetFamilies.join(', '), desc: 'Target ATS role families' },
    { metric: '', val: '', desc: '' },
    { metric: 'Total DB Candidates Evaluated', val: reconciliation.totalEvaluated, desc: 'Active records evaluated in DB (isDeleted=false, is_test_data=false)' },
    { metric: 'Soft-Deleted Records Excluded', val: reconciliation.excludedSoftDeleted, desc: 'Excluded records with isDeleted = true' },
    { metric: 'Archived Test Records Excluded', val: reconciliation.excludedTestData, desc: 'Excluded records flagged is_test_data = true' },
    { metric: '', val: '', desc: '' },
    { metric: 'Total Target Role Matches', val: appRows.length + reconciliation.needsReviewCount + reconciliation.droppedNoLocation + reconciliation.droppedNonCity, desc: 'Candidates matching target keywords or review tier' },
    { metric: `  • Confirmed People Included (${profile.displayName})`, val: uniquePeopleRows.length, desc: `Unique people with confirmed role and ${profile.displayName} location` },
    { metric: '  • Confirmed Application Records', val: appRows.length, desc: 'Total candidate records matching confirmed tier' },
    { metric: '  • Ambiguous Matches (Needs Review)', val: reconciliation.needsReviewCount, desc: 'Ambiguous roles or outer area locations requiring manual review' },
    { metric: '  • Dropped: Blank Location', val: reconciliation.droppedNoLocation, desc: 'Role matched but candidate and job location were blank' },
    { metric: `  • Dropped: Non-${profile.displayName} Location`, val: reconciliation.droppedNonCity, desc: `Role matched but location is outside ${profile.displayName}` },
    { metric: 'Excluded Roles (Non-target)', val: reconciliation.excludedRoles, desc: 'Tech, BA, DA, HR, Ops, or non-target family' },
    { metric: '', val: '', desc: '' },
    { metric: 'RECONCILIATION SUM CHECK', val: `${reconciliationCheckSum} / ${reconciliation.totalEvaluated}`, desc: 'Included Apps + Needs Review + Dropped Blank + Dropped Non-City + Excluded Roles = Total Evaluated' },
    { metric: '', val: '', desc: '' },
    { metric: 'Location Match Breakdown (Unique People):', val: '', desc: '' },
    { metric: '  • City Name / Spelling Match', val: cityMatches, desc: `${profile.displayName} spelling variants` },
    { metric: '  • Twin City Match (Secunderabad)', val: twinCityMatches, desc: 'Secunderabad candidates (twin city)' },
    { metric: '  • Locality Only Match', val: localityMatches, desc: 'Matched via locality name' },
    { metric: '  • Job Location Match (Cross-city)', val: jobLocationMatches, desc: 'Candidate located elsewhere, applied to job in target city' },
    { metric: '', val: '', desc: '' },
    { metric: 'Telecalling Language Capabilities:', val: '', desc: 'Derived from languages known' },
    { metric: '  • Telugu Speakers (Y)', val: teluguSpeakers, desc: 'Candidates with Telugu recorded in languages known' },
    { metric: '  • Hindi Speakers (Y)', val: hindiSpeakers, desc: 'Candidates with Hindi recorded in languages known' },
    { metric: '  • English Speakers (Y)', val: englishSpeakers, desc: 'Candidates with English recorded in languages known' },
    { metric: '', val: '', desc: '' },
    { metric: 'Pipeline Status Counts (Unique People):', val: '', desc: '' },
    ...Object.entries(statusCounts).map(([st, cnt]) => ({
      metric: `  • Status: ${st}`, val: cnt, desc: `Candidates currently in ${st}`
    })),
    { metric: '', val: '', desc: '' },
    { metric: 'Total Interns Flagged (is_intern = Yes)', val: totalInterns, desc: 'Filterable via the is_intern column' },
    { metric: 'Duplicates Merged (Same Person)', val: multiRecordPeopleCount, desc: 'Grouped by normalized phone (+91XXXXXXXXXX) or email' },
    { metric: 'Data Quality Issues Flagged', val: qualityIssues.length, desc: 'Invalid, missing, or duplicate phones / emails (Sheet: Data Quality)' }
  ];

  summaryData.forEach(r => summarySheet.addRow(r));
  applySheetStyles(summarySheet, true);

  if (profile.key === 'hyderabad') {
    // --- HYDERABAD SHEETS (Part 6) ---
    // Sheet 2: Telecalling – Hyderabad
    const mainSheet = workbook.addWorksheet('Telecalling – Hyderabad');
    const mainExtraCols = [
      { header: 'Candidate Record IDs', key: 'candidateRecordIds' },
      { header: 'Total Records Merged', key: 'totalRecordsMerged' }
    ];
    writeRowsToWorksheet(mainSheet, uniquePeopleRows, mainExtraCols);

    // Sheet 3: Applications
    const appSheet = workbook.addWorksheet('Applications');
    writeRowsToWorksheet(appSheet, appRows);

    // Sheet 4: Needs Review
    const reviewSheet = workbook.addWorksheet('Needs Review');
    const reviewExtraCols = [
      { header: 'Review Reason', key: 'reviewReason' }
    ];
    writeRowsToWorksheet(reviewSheet, reviewRows, reviewExtraCols);

    // Sheet 5: Data Quality
    const dqSheet = workbook.addWorksheet('Data Quality');
    dqSheet.columns = [
      { header: 'Candidate ID', key: 'candidateId', width: 28 },
      { header: 'Full Name', key: 'fullName', width: 26 },
      { header: 'Phone', key: 'phone', width: 18 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Role Family', key: 'roleFamily', width: 25 },
      { header: 'Issue Type', key: 'issueType', width: 26 },
      { header: 'Details', key: 'details', width: 55 }
    ];
    qualityIssues.forEach(qi => {
      const row = dqSheet.addRow(qi);
      row.getCell(3).numFmt = '@';
    });
    applySheetStyles(dqSheet);

    // Sheet 6: Match Rules
    const rulesSheet = workbook.addWorksheet('Match Rules');
    rulesSheet.columns = [
      { header: 'Rule Category', key: 'category', width: 34 },
      { header: 'Match Tier', key: 'tier', width: 16 },
      { header: 'Spelling / Keyword / Pattern', key: 'keyword', width: 45 },
      { header: 'Candidates Count', key: 'count', width: 18 },
      { header: 'Rule Reference / Note', key: 'note', width: 50 }
    ];
    const sortedRules = Object.values(matchRulesStats).sort((a, b) => b.count - a.count);
    sortedRules.forEach(r => rulesSheet.addRow(r));
    applySheetStyles(rulesSheet);

  } else {
    // --- BANGALORE SHEETS (Yesterday's structure preserved) ---
    const bdRows = appRows.filter(r => r.families.includes('Business Development'));
    const fieldSalesRows = appRows.filter(r => r.families.includes('Field Sales'));
    const telecallingRows = appRows.filter(r => r.families.includes('Telecalling'));

    bdRows.sort(sortRows);
    fieldSalesRows.sort(sortRows);
    telecallingRows.sort(sortRows);

    // Sheet 2: Business Development
    const bdSheet = workbook.addWorksheet('Business Development');
    writeRowsToWorksheet(bdSheet, bdRows);

    // Sheet 3: Field Sales
    const fieldSalesSheet = workbook.addWorksheet('Field Sales');
    writeRowsToWorksheet(fieldSalesSheet, fieldSalesRows);

    // Sheet 4: Telecalling
    const telecallingSheet = workbook.addWorksheet('Telecalling');
    writeRowsToWorksheet(telecallingSheet, telecallingRows);

    // Sheet 5: Candidates (All)
    const allCandidatesSheet = workbook.addWorksheet('Candidates (All)');
    const allPeopleExtraCols = [
      { header: 'Candidate Record IDs', key: 'candidateRecordIds' },
      { header: 'Total Records Merged', key: 'totalRecordsMerged' }
    ];
    writeRowsToWorksheet(allCandidatesSheet, uniquePeopleRows, allPeopleExtraCols);

    // Sheet 6: Applications
    const appSheet = workbook.addWorksheet('Applications');
    writeRowsToWorksheet(appSheet, appRows);

    // Sheet 7: Needs Review
    const reviewSheet = workbook.addWorksheet('Needs Review');
    const reviewExtraCols = [
      { header: 'Review Reason', key: 'reviewReason' }
    ];
    writeRowsToWorksheet(reviewSheet, reviewRows, reviewExtraCols);

    // Sheet 8: Data Quality
    const dqSheet = workbook.addWorksheet('Data Quality');
    dqSheet.columns = [
      { header: 'Candidate ID', key: 'candidateId', width: 28 },
      { header: 'Full Name', key: 'fullName', width: 26 },
      { header: 'Phone', key: 'phone', width: 18 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Role Family', key: 'roleFamily', width: 25 },
      { header: 'Issue Type', key: 'issueType', width: 26 },
      { header: 'Details', key: 'details', width: 55 }
    ];
    qualityIssues.forEach(qi => {
      const row = dqSheet.addRow(qi);
      row.getCell(3).numFmt = '@';
    });
    applySheetStyles(dqSheet);

    // Sheet 9: Match Rules
    const rulesSheet = workbook.addWorksheet('Match Rules');
    rulesSheet.columns = [
      { header: 'Rule Category', key: 'category', width: 34 },
      { header: 'Match Tier', key: 'tier', width: 16 },
      { header: 'Spelling / Keyword / Pattern', key: 'keyword', width: 45 },
      { header: 'Candidates Count', key: 'count', width: 18 },
      { header: 'Rule Reference / Note', key: 'note', width: 50 }
    ];
    const sortedRules = Object.values(matchRulesStats).sort((a, b) => b.count - a.count);
    sortedRules.forEach(r => rulesSheet.addRow(r));
    applySheetStyles(rulesSheet);
  }

  // Write Excel file
  const outFilename = `${profile.filePrefix}_${todayStr}.xlsx`;
  const outPath = path.join(exportsDir, outFilename);
  console.log(`Saving workbook to: ${outPath}...`);
  await workbook.xlsx.writeFile(outPath);

  console.log(`\nExport successful for ${profile.displayName}!`);
  console.log(`Summary Counts:`);
  console.log(`- Total Unique People Included: ${uniquePeopleRows.length}`);
  console.log(`- Applications rows: ${appRows.length}`);
  console.log(`- Needs Review: ${reviewRows.length}`);
  console.log(`- Data Quality Issues: ${qualityIssues.length}`);
  console.log(`- Dropped (Blank location): ${reconciliation.droppedNoLocation}`);
  console.log(`- Dropped (Non-${profile.displayName} location): ${reconciliation.droppedNonCity}`);
  console.log(`- Excluded Non-target Roles: ${reconciliation.excludedRoles}`);
  console.log(`- Reconciliation Check: ${reconciliationCheckSum} / ${reconciliation.totalEvaluated} (${reconciliationCheckSum === reconciliation.totalEvaluated ? 'PASSED' : 'MISMATCH'})`);
  console.log(`- File size: ${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB`);

  return {
    outPath,
    uniquePeopleCount: uniquePeopleRows.length,
    appCount: appRows.length,
    reviewCount: reviewRows.length,
    qualityCount: qualityIssues.length,
    reconciliation
  };
}

// ============================================================================
// BCA & MCA ON HOLD & REJECTED EXPORT PIPELINE (PART 0, PART 3 - 7)
// ============================================================================

function normalizeCourseText(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[.-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function evaluateCourseBcaMca(cand, recordMatchRule) {
  const cCourse = cand.course || '';
  const cCollege = cand.college || '';
  const fbCourses = (cand.interviewFeedbacks || []).map(f => f.feedbackData?.course || '').filter(Boolean);
  const fbComments = (cand.interviewFeedbacks || []).map(f => f.feedbackData?.comments || '').filter(Boolean);
  const invNotes = (cand.applications || []).flatMap(a => (a.interviews || []).map(i => i.notes || '')).filter(Boolean);
  const comments = [...fbComments, ...invNotes].join('\n');

  const courseNorm = normalizeCourseText(cCourse);
  const collegeNorm = normalizeCourseText(cCollege);
  const commentsNorm = normalizeCourseText(comments);

  // Check explicit course fields
  const isBcaInCandCourse = /\b(bca|bachelor of computer applications?|bachelor in computer applications?)\b/i.test(courseNorm);
  const isMcaInCandCourse = /\b(mca|master of computer applications?|masters in computer applications?|integrated mca)\b/i.test(courseNorm);

  // Check feedback courses
  const isBcaInFb = fbCourses.some(fc => /\b(bca|bachelor of computer applications?|bachelor in computer applications?)\b/i.test(normalizeCourseText(fc)));
  const isMcaInFb = fbCourses.some(fc => /\b(mca|master of computer applications?|masters in computer applications?|integrated mca)\b/i.test(normalizeCourseText(fc)));

  // Check college field
  const isBcaInCollege = /\b(bca)\b/i.test(collegeNorm);
  const isMcaInCollege = /\b(mca)\b/i.test(collegeNorm);

  // Check comments only
  const isBcaInComments = /\b(bca)\b/i.test(commentsNorm);
  const isMcaInComments = /\b(mca)\b/i.test(commentsNorm);
  const isCompAppInComments = /\b(computer applications?)\b/i.test(commentsNorm);

  // Exclusions (Part 3.5)
  const isEngineering = /\b(btech|mtech|b\s*tech|m\s*tech|be|me|bachelor of engineering|bachelor of technology)\b/i.test(courseNorm);
  const isCommerce = /\b(bcom|b\s*com|bachelor of commerce)\b/i.test(courseNorm);
  const isBbaMba = /\b(bba|mba|bachelor of business administration)\b/i.test(courseNorm);

  if (isEngineering && !isBcaInCandCourse && !isMcaInCandCourse) {
    recordMatchRule('Course - Exclude', 'EXCLUDE', cCourse || 'Engineering', 1, 'Engineering degree (B.Tech / BE)');
    return { tier: 'EXCLUDE', reason: 'Engineering degree (B.Tech / BE)', family: null, original: cCourse };
  }
  if (isCommerce && !isBcaInCandCourse && !isMcaInCandCourse) {
    recordMatchRule('Course - Exclude', 'EXCLUDE', cCourse || 'Commerce', 1, 'Commerce degree (B.Com)');
    return { tier: 'EXCLUDE', reason: 'Commerce degree (B.Com)', family: null, original: cCourse };
  }
  if (isBbaMba && !isBcaInCandCourse && !isMcaInCandCourse && !isBcaInFb && !isMcaInFb) {
    recordMatchRule('Course - Exclude', 'EXCLUDE', cCourse || 'Business Admin', 1, 'Business Administration (BBA / MBA)');
    return { tier: 'EXCLUDE', reason: 'Business Administration (BBA / MBA)', family: null, original: cCourse };
  }

  // Course discrepancy: candidate.course exists and feedback course exists and they disagree
  if (cCourse && fbCourses.length > 0) {
    const isSameDegree = (isBcaInCandCourse && isBcaInFb) || (isMcaInCandCourse && isMcaInFb);
    if (!isSameDegree && (isBcaInCandCourse || isMcaInCandCourse || isBcaInFb || isMcaInFb)) {
      const fam = (isMcaInCandCourse || isMcaInFb) ? 'MCA' : 'BCA';
      recordMatchRule('Course - Review', 'REVIEW', `${cCourse} vs ${fbCourses[0]}`, 1, 'Course field and feedback course disagree');
      return {
        tier: 'REVIEW',
        reason: `Course discrepancy: candidates.course is "${cCourse}" but interview feedback recorded "${fbCourses[0]}"`,
        family: fam,
        original: cCourse || fbCourses[0],
        fieldFound: cCourse ? 'candidates.course' : 'interview_feedbacks.course',
        isDiscrepancy: true
      };
    }
  }

  // Both BCA and MCA appearing
  if ((isBcaInCandCourse || isBcaInFb) && (isMcaInCandCourse || isMcaInFb)) {
    recordMatchRule('Course - MCA', 'INCLUDE', cCourse || 'BCA & MCA', 1, 'Student with both BCA and MCA (classified by current degree MCA)');
    return {
      tier: 'INCLUDE',
      family: 'MCA',
      original: cCourse || 'BCA & MCA',
      fieldFound: cCourse ? 'candidates.course' : 'interview_feedbacks.course',
      note: 'Both BCA and MCA appearing (classified by current degree MCA)'
    };
  }

  // MCA Include
  if (isMcaInCandCourse || isMcaInFb || isMcaInCollege) {
    const orig = cCourse || fbCourses.find(fc => /\b(mca)\b/i.test(normalizeCourseText(fc))) || cCollege;
    const fFound = cCourse ? 'candidates.course' : (fbCourses.length ? 'interview_feedbacks.course' : 'candidates.college');
    recordMatchRule('Course - MCA', 'INCLUDE', orig, 1, 'MCA degree confirmed');
    return {
      tier: 'INCLUDE',
      family: 'MCA',
      original: orig,
      fieldFound: fFound
    };
  }

  // BCA Include
  if (isBcaInCandCourse || isBcaInFb || isBcaInCollege) {
    const orig = cCourse || fbCourses.find(fc => /\b(bca)\b/i.test(normalizeCourseText(fc))) || cCollege;
    const fFound = cCourse ? 'candidates.course' : (fbCourses.length ? 'interview_feedbacks.course' : 'candidates.college');
    recordMatchRule('Course - BCA', 'INCLUDE', orig, 1, 'BCA degree confirmed');
    return {
      tier: 'INCLUDE',
      family: 'BCA',
      original: orig,
      fieldFound: fFound
    };
  }

  // Check comments only
  if (isMcaInComments) {
    recordMatchRule('Course - Review', 'REVIEW', 'MCA in comments', 1, 'Course found only in free-text comments');
    return {
      tier: 'REVIEW',
      reason: 'Course found only in interview comments/notes (MCA)',
      family: 'MCA',
      original: 'Found in comments/notes',
      fieldFound: 'interview_notes_or_comments'
    };
  }
  if (isBcaInComments) {
    recordMatchRule('Course - Review', 'REVIEW', 'BCA in comments', 1, 'Course found only in free-text comments');
    return {
      tier: 'REVIEW',
      reason: 'Course found only in interview comments/notes (BCA)',
      family: 'BCA',
      original: 'Found in comments/notes',
      fieldFound: 'interview_notes_or_comments'
    };
  }
  if (isCompAppInComments) {
    recordMatchRule('Course - Review', 'REVIEW', 'Computer Applications in comments', 1, 'Computer application with no degree level stated');
    return {
      tier: 'REVIEW',
      reason: 'Computer applications without degree level stated',
      family: null,
      original: 'Found in comments/notes',
      fieldFound: 'interview_notes_or_comments'
    };
  }

  return { tier: 'EXCLUDE', reason: 'No BCA/MCA pattern', family: null, original: cCourse };
}

function evaluateOutcomesBcaMca(cand, recordMatchRule) {
  const rounds = [];

  for (const fb of (cand.interviewFeedbacks || [])) {
    let rNum = 1;
    if (fb.round === 'ROUND_2' || fb.feedbackData?.roundNumber?.includes('2') || fb.feedbackData?.round === '2') rNum = 2;
    if (fb.round === 'FINAL_ROUND' || fb.feedbackData?.roundNumber?.includes('Final') || fb.feedbackData?.roundNumber?.includes('3')) rNum = 3;

    rounds.push({
      source: 'interview_feedback',
      roundNum: rNum,
      roundName: fb.round,
      status: fb.selectionStatus,
      rating: fb.overallRating,
      panelist: fb.feedbackData?.panelists || fb.feedbackData?.panelist || (fb.submittedBy?.fullName || ''),
      comments: fb.feedbackData?.comments || '',
      doj: fb.feedbackData?.doj || fb.feedbackData?.tentativeDoj || '',
      date: fb.updatedAt || fb.createdAt,
      isPlaceholder: false
    });
  }

  for (const app of (cand.applications || [])) {
    for (const inv of (app.interviews || [])) {
      let rNum = inv.roundNo || 1;
      if (inv.round?.toLowerCase().includes('round 2') || inv.round === 'ROUND_2') rNum = 2;
      if (inv.round?.toLowerCase().includes('final') || inv.round === 'ROUND_3') rNum = 3;

      const isPlaceholder = (inv.notes && inv.notes.includes('[Placeholder]')) ||
        (cand.customFields?.r1_placeholder === true && rNum === 1);

      let outcome = inv.outcome || inv.result;
      if (!outcome && inv.status === 'COMPLETED') {
        outcome = 'COMPLETED_NO_OUTCOME';
      }

      rounds.push({
        source: 'interview',
        roundNum: rNum,
        roundName: inv.round || `Round ${rNum}`,
        status: outcome || inv.status,
        lifecycleStatus: inv.status,
        result: inv.result,
        outcome: inv.outcome,
        rating: null,
        panelist: inv.interviewerNames || '',
        comments: inv.notes || '',
        doj: '',
        date: inv.scheduledStart || inv.createdAt,
        isPlaceholder
      });
    }
  }

  rounds.sort((a, b) => {
    if (a.roundNum !== b.roundNum) return a.roundNum - b.roundNum;
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return da - db;
  });

  let everOnHold = false;
  let everRejected = false;
  let everSelected = false;

  for (const r of rounds) {
    const s = String(r.status || '').toUpperCase();
    if (s.startsWith('REJECT')) everRejected = true;
    if (s.includes('HOLD')) everOnHold = true;
    if (s.startsWith('SELECT')) everSelected = true;
  }

  if (cand.status === 'REJECTED') everRejected = true;
  if (cand.status === 'ON_HOLD') everOnHold = true;

  const roundMap = {};
  for (const r of rounds) {
    const existing = roundMap[r.roundNum];
    if (!existing) {
      roundMap[r.roundNum] = r;
    } else {
      if (r.source === 'interview_feedback' && (r.rating !== null || r.comments)) {
        roundMap[r.roundNum] = { ...existing, ...r, status: r.status || existing.status };
      } else if (r.status && !existing.status) {
        roundMap[r.roundNum] = { ...existing, ...r };
      }
    }
  }

  const distinctRoundNums = Object.keys(roundMap).map(Number).sort((a, b) => a - b);
  const conductedRoundNums = distinctRoundNums.filter(n => {
    const r = roundMap[n];
    return !r.isPlaceholder && r.status && r.status !== 'SCHEDULED' && r.status !== 'RESCHEDULED';
  });

  const currentRoundNum = conductedRoundNums.length > 0
    ? conductedRoundNums[conductedRoundNums.length - 1]
    : (distinctRoundNums.length > 0 ? distinctRoundNums[distinctRoundNums.length - 1] : 0);
  const latestRound = roundMap[currentRoundNum];

  let currentOutcome = null;
  let currentOutcomeCategory = 'OTHER';

  if (cand.customFields?.r2_outcome && currentRoundNum >= 2) {
    currentOutcome = cand.customFields.r2_outcome;
  } else if (latestRound?.status && latestRound.status !== 'SCHEDULED' && latestRound.status !== 'RESCHEDULED') {
    currentOutcome = latestRound.status;
  } else if (cand.status && cand.status !== 'ACTIVE') {
    currentOutcome = cand.status;
  } else if (latestRound?.status) {
    currentOutcome = latestRound.status;
  } else {
    currentOutcome = cand.status || 'ACTIVE';
  }

  const normOutcome = String(currentOutcome || '').toUpperCase();
  if (normOutcome.startsWith('REJECT')) {
    currentOutcomeCategory = 'REJECTED';
    currentOutcome = 'Rejected';
    recordMatchRule('Outcome - Rejected', 'INCLUDE', 'REJECTED', 1, 'Rejected candidate');
  } else if (normOutcome.includes('HOLD')) {
    currentOutcomeCategory = 'ON_HOLD';
    currentOutcome = 'On Hold';
    recordMatchRule('Outcome - On Hold', 'INCLUDE', 'ON_HOLD', 1, 'On Hold candidate');
  } else if (normOutcome.startsWith('SELECT')) {
    currentOutcomeCategory = 'SELECTED';
    currentOutcome = 'Selected';
    recordMatchRule('Outcome - Excluded (Other)', 'EXCLUDE', 'SELECTED', 1, 'Selected candidate');
  } else if (normOutcome.includes('JOIN') || normOutcome.includes('NO_SHOW') || normOutcome.includes('RESPOND')) {
    currentOutcomeCategory = 'DIDNT_JOIN';
    currentOutcome = "Didn't Join / No-Show";
    recordMatchRule('Outcome - Excluded (Other)', 'EXCLUDE', 'DIDNT_JOIN', 1, 'Did not join / No-show');
  } else if (normOutcome === 'COMPLETED_NO_OUTCOME') {
    currentOutcomeCategory = 'COMPLETED_NO_OUTCOME';
    currentOutcome = 'Completed (No Outcome)';
    recordMatchRule('Outcome - Excluded (Other)', 'EXCLUDE', 'COMPLETED_NO_OUTCOME', 1, 'Completed round without recorded outcome');
  } else if (normOutcome === 'PENDING' || normOutcome === 'SCHEDULED' || normOutcome === 'RESCHEDULED') {
    currentOutcomeCategory = 'PENDING';
    currentOutcome = 'Pending / Scheduled';
    recordMatchRule('Outcome - Excluded (Other)', 'EXCLUDE', 'PENDING', 1, 'Pending / Scheduled interview');
  } else {
    recordMatchRule('Outcome - Excluded (Other)', 'EXCLUDE', normOutcome || 'ACTIVE', 1, 'Other active candidate');
  }

  const historyParts = [];
  for (const rNum of distinctRoundNums) {
    const r = roundMap[rNum];
    const stat = r.status || 'No Outcome';
    const rat = (r.rating !== null && r.rating !== undefined) ? ` (${r.rating})` : '';
    historyParts.push(`R${rNum}: ${stat}${rat}`);
  }
  const historyString = historyParts.join(' → ') || 'No Rounds Recorded';

  return {
    currentOutcomeCategory,
    currentOutcome,
    currentRoundNum,
    currentRoundDate: latestRound?.date || cand.updatedAt,
    currentPanelist: latestRound?.panelist || cand.customFields?.r2_panelist || '',
    currentRating: latestRound?.rating !== null ? latestRound?.rating : (cand.customFields?.r2_rating || null),
    currentReason: latestRound?.comments || '',
    currentDoj: latestRound?.doj || cand.doj || '',
    totalRounds: distinctRoundNums.length,
    historyString,
    everOnHold,
    everRejected,
    everSelected
  };
}

function formatCandidateRow(c, courseEval, outcomeEval, phoneCountMap, emailCountMap) {
  const cf = (c.customFields && typeof c.customFields === 'object') ? c.customFields : {};
  const pInfo = parsePhone(c.phoneNormalized || c.phone);
  const eInfo = parseEmail(c.email);
  const isDupPhone = pInfo.isValid && (phoneCountMap[pInfo.normalized] > 1);
  const isDupEmail = eInfo.isValid && (emailCountMap[eInfo.raw.toLowerCase()] > 1);

  const firstApp = c.applications && c.applications.length > 0 ? c.applications[0] : null;
  const job = firstApp?.job;

  const recruiter = c.assignedRecruiterName || c.assignedRecruiter?.fullName || c.createdBy?.fullName || '';
  const resumeLink = c.resumeLinkOriginal || c.resumeLinkDownload || '';
  const college = c.college || cf.college_name || '';
  const yearBatch = c.graduationYear || cf.batch_year || cf.year || '';
  const drive = cf.source || cf.import_source || '';
  const languages = cf.languages || cf.languages_known_verbatim || '';
  const priorExp = c.totalExperienceYears ? `${c.totalExperienceYears} yrs` : (cf.prior_experience_verbatim || cf.professionalExperience || '');
  const familyBg = cf.family || cf.family_background_verbatim || '';
  const locParts = [c.location, c.area].filter(Boolean);
  const locationArea = locParts.join(', ');
  const needsContact = pInfo.isMissing && eInfo.isMissing;

  const flags = [];
  if (isDupPhone) flags.push('Duplicate phone');
  if (isDupEmail) flags.push('Duplicate email');
  if (pInfo.isPlaceholder || eInfo.isPlaceholder) flags.push('Placeholder contact');
  if (pInfo.isMissing) flags.push('Missing phone');
  if (eInfo.isMissing) flags.push('Missing email');
  if (needsContact || cf.needs_contact_details) flags.push('needs_contact_details');
  if (courseEval.tier === 'REVIEW' || courseEval.isDiscrepancy) flags.push('Course ambiguous');

  if (outcomeEval.currentOutcome === 'Selected' && outcomeEval.currentRating !== null && outcomeEval.currentRating <= 4) {
    flags.push('Outcome / rating contradiction (Selected at rating <= 4)');
  }
  if (outcomeEval.currentOutcome === 'Rejected' && outcomeEval.currentRating !== null && outcomeEval.currentRating >= 8) {
    flags.push('Outcome / rating contradiction (Rejected at rating >= 8)');
  }

  return {
    candidateId: c.id,
    fullName: sanitizeExcelValue(c.fullName),
    phoneRaw: pInfo.raw,
    phoneNormalized: pInfo.normalized,
    email: sanitizeExcelValue(c.email === 'N/A' || c.email === 'na' ? '' : c.email),
    phoneValid: pInfo.isValid ? 'Yes' : 'No',
    emailValid: eInfo.isValid ? 'Yes' : 'No',
    needsContactDetails: (needsContact || cf.needs_contact_details) ? 'Yes' : 'No',
    courseFamily: courseEval.family || '',
    courseAsStored: sanitizeExcelValue(courseEval.original),
    fieldFound: courseEval.fieldFound || '',
    matchTier: courseEval.tier,
    yearBatch: sanitizeExcelValue(yearBatch),
    college: sanitizeExcelValue(college),
    drive: sanitizeExcelValue(drive),
    currentOutcome: outcomeEval.currentOutcome,
    currentRoundNo: outcomeEval.currentRoundNum ? String(outcomeEval.currentRoundNum) : '',
    currentRoundDate: toISTDate(outcomeEval.currentRoundDate),
    panelist: sanitizeExcelValue(outcomeEval.currentPanelist),
    rating: outcomeEval.currentRating !== null ? outcomeEval.currentRating : '',
    reason: sanitizeExcelValue(outcomeEval.currentReason),
    doj: sanitizeExcelValue(outcomeEval.currentDoj),
    totalRounds: outcomeEval.totalRounds,
    roundHistory: outcomeEval.historyString,
    everOnHold: outcomeEval.everOnHold ? 'Yes' : 'No',
    everRejected: outcomeEval.everRejected ? 'Yes' : 'No',
    role: sanitizeExcelValue(c.jobTitle || c.preferredRole || job?.title || ''),
    jobId: job?.id || '',
    locationArea: sanitizeExcelValue(locationArea),
    languages: sanitizeExcelValue(languages),
    priorExperience: sanitizeExcelValue(priorExp),
    familyBackground: sanitizeExcelValue(familyBg),
    source: sanitizeExcelValue(c.source || drive || ''),
    recruiterOwner: sanitizeExcelValue(recruiter),
    resumeLink: sanitizeExcelValue(resumeLink),
    createdAt: toISTDate(c.createdAt),
    updatedAt: toISTDate(c.updatedAt),
    flags: flags.join(', ')
  };
}

async function runBcaMcaExport(cliOptions) {
  const { todayStr, cityArg, familiesArg } = cliOptions || parseCliArgs();
  console.log(`Starting BCA/MCA On Hold & Rejected Export Pipeline (Date: ${todayStr})...`);

  // Enforce read-only session
  await prisma.$executeRawUnsafe('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;');

  const exportsDir = path.resolve(__dirname, '../../exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  // Pre-calculate contact frequencies across all active candidates
  console.log('Calculating contact frequencies across active database records...');
  const allContacts = await prisma.candidate.findMany({
    where: { isDeleted: false, is_test_data: false },
    select: { id: true, phone: true, phoneNormalized: true, email: true }
  });

  const phoneCountMap = {};
  const emailCountMap = {};

  for (const c of allContacts) {
    const p = parsePhone(c.phoneNormalized || c.phone);
    if (p.isValid) {
      phoneCountMap[p.normalized] = (phoneCountMap[p.normalized] || 0) + 1;
    }
    const e = parseEmail(c.email);
    if (e.isValid) {
      emailCountMap[e.raw.toLowerCase()] = (emailCountMap[e.raw.toLowerCase()] || 0) + 1;
    }
  }

  const softDeletedCount = await prisma.candidate.count({ where: { isDeleted: true } });
  const testDataCount = await prisma.candidate.count({ where: { is_test_data: true } });

  const CHUNK_SIZE = 500;
  let lastId = null;
  let hasMore = true;
  let totalEvaluated = 0;

  const matchRulesStats = {};
  function recordMatchRule(category, tier, keyword, count = 1, note = '') {
    let cleanKw = String(keyword || '').trim();
    if (!cleanKw || cleanKw === '-' || cleanKw === '--') cleanKw = '(blank / dash)';
    if (cleanKw.startsWith('=') || cleanKw.startsWith('+') || cleanKw.startsWith('-') || cleanKw.startsWith('@')) {
      cleanKw = `'${cleanKw}`;
    }
    const key = `${category}||${tier}||${cleanKw}`;
    if (!matchRulesStats[key]) {
      matchRulesStats[key] = { category, tier, keyword: cleanKw, count: 0, note };
    }
    matchRulesStats[key].count += count;
  }

  const bcaOnHoldRows = [];
  const bcaRejectedRows = [];
  const mcaOnHoldRows = [];
  const mcaRejectedRows = [];
  const everHeldOrRejectedRows = [];
  const needsReviewRows = [];
  const qualityIssues = [];

  const notIncludedCounts = {
    SELECTED: 0,
    PENDING: 0,
    DIDNT_JOIN: 0,
    COMPLETED_NO_OUTCOME: 0,
    OTHER: 0
  };
  let excludedNonTargetCourses = 0;

  console.log('Streaming candidates in chunks of 500...');

  while (hasMore) {
    const chunk = await prisma.candidate.findMany({
      take: CHUNK_SIZE,
      skip: lastId ? 1 : 0,
      cursor: lastId ? { id: lastId } : undefined,
      orderBy: { id: 'asc' },
      where: {
        isDeleted: false,
        is_test_data: false
      },
      include: {
        applications: {
          where: { isDeleted: false },
          include: {
            job: true,
            interviews: {
              orderBy: { scheduledStart: 'desc' }
            }
          }
        },
        interviewFeedbacks: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          include: {
            submittedBy: { select: { fullName: true } }
          }
        },
        assignedRecruiter: { select: { fullName: true } },
        createdBy: { select: { fullName: true } }
      }
    });

    if (chunk.length === 0) {
      hasMore = false;
      break;
    }

    totalEvaluated += chunk.length;
    lastId = chunk[chunk.length - 1].id;

    for (const c of chunk) {
      const courseEval = evaluateCourseBcaMca(c, recordMatchRule);
      const outcomeEval = evaluateOutcomesBcaMca(c, recordMatchRule);

      if (courseEval.tier === 'EXCLUDE') {
        excludedNonTargetCourses++;
        continue;
      }

      const row = formatCandidateRow(c, courseEval, outcomeEval, phoneCountMap, emailCountMap);

      // Track Data Quality issues
      if (row.needsContactDetails === 'Yes') {
        qualityIssues.push({
          candidateId: c.id,
          fullName: row.fullName,
          phone: row.phoneRaw,
          email: row.email,
          courseFamily: row.courseFamily,
          issueType: 'Missing Contact Details',
          details: 'Campus drive candidate with no phone or email recorded (needs_contact_details = Yes)'
        });
      }
      if (row.flags.includes('Duplicate phone')) {
        qualityIssues.push({
          candidateId: c.id,
          fullName: row.fullName,
          phone: row.phoneRaw,
          email: row.email,
          courseFamily: row.courseFamily,
          issueType: 'Duplicate Phone',
          details: `Phone ${row.phoneNormalized} appears multiple times in database`
        });
      }
      if (row.flags.includes('Duplicate email')) {
        qualityIssues.push({
          candidateId: c.id,
          fullName: row.fullName,
          phone: row.phoneRaw,
          email: row.email,
          courseFamily: row.courseFamily,
          issueType: 'Duplicate Email',
          details: `Email ${row.email} appears multiple times in database`
        });
      }
      if (row.flags.includes('Outcome / rating contradiction')) {
        qualityIssues.push({
          candidateId: c.id,
          fullName: row.fullName,
          phone: row.phoneRaw,
          email: row.email,
          courseFamily: row.courseFamily,
          issueType: 'Outcome / Rating Contradiction',
          details: `Candidate outcome is ${row.currentOutcome} at rating ${row.rating} (Reason: ${row.reason.slice(0, 50)})`
        });
      }

      // Check if Ever on hold or rejected
      if (outcomeEval.everOnHold || outcomeEval.everRejected) {
        everHeldOrRejectedRows.push(row);
      }

      // If REVIEW tier: goes to Needs Review sheet
      if (courseEval.tier === 'REVIEW') {
        needsReviewRows.push({ ...row, reviewReason: courseEval.reason });
        // If candidate is also currently On Hold or Rejected, add to respective sheet with Match Tier: REVIEW
        if (courseEval.family === 'BCA') {
          if (outcomeEval.currentOutcomeCategory === 'ON_HOLD') bcaOnHoldRows.push(row);
          else if (outcomeEval.currentOutcomeCategory === 'REJECTED') bcaRejectedRows.push(row);
        } else if (courseEval.family === 'MCA') {
          if (outcomeEval.currentOutcomeCategory === 'ON_HOLD') mcaOnHoldRows.push(row);
          else if (outcomeEval.currentOutcomeCategory === 'REJECTED') mcaRejectedRows.push(row);
        }
        continue;
      }

      // Confirmed INCLUDE BCA / MCA
      if (courseEval.family === 'BCA') {
        if (outcomeEval.currentOutcomeCategory === 'ON_HOLD') {
          bcaOnHoldRows.push(row);
        } else if (outcomeEval.currentOutcomeCategory === 'REJECTED') {
          bcaRejectedRows.push(row);
        } else {
          notIncludedCounts[outcomeEval.currentOutcomeCategory] = (notIncludedCounts[outcomeEval.currentOutcomeCategory] || 0) + 1;
        }
      } else if (courseEval.family === 'MCA') {
        if (outcomeEval.currentOutcomeCategory === 'ON_HOLD') {
          mcaOnHoldRows.push(row);
        } else if (outcomeEval.currentOutcomeCategory === 'REJECTED') {
          mcaRejectedRows.push(row);
        } else {
          notIncludedCounts[outcomeEval.currentOutcomeCategory] = (notIncludedCounts[outcomeEval.currentOutcomeCategory] || 0) + 1;
        }
      }
    }
  }

  // Sort rows
  const sortByDateDesc = (a, b) => {
    const da = a.currentRoundDate ? a.currentRoundDate.getTime() : 0;
    const db = b.currentRoundDate ? b.currentRoundDate.getTime() : 0;
    return db - da;
  };

  bcaOnHoldRows.sort(sortByDateDesc);
  bcaRejectedRows.sort(sortByDateDesc);
  mcaOnHoldRows.sort(sortByDateDesc);
  mcaRejectedRows.sort(sortByDateDesc);
  everHeldOrRejectedRows.sort(sortByDateDesc);
  needsReviewRows.sort(sortByDateDesc);

  // Combined All (current)
  const allCurrentRows = [...bcaOnHoldRows, ...bcaRejectedRows, ...mcaOnHoldRows, ...mcaRejectedRows];
  allCurrentRows.sort(sortByDateDesc);

  console.log(`BCA On Hold: ${bcaOnHoldRows.length}`);
  console.log(`BCA Rejected: ${bcaRejectedRows.length}`);
  console.log(`MCA On Hold: ${mcaOnHoldRows.length}`);
  console.log(`MCA Rejected: ${mcaRejectedRows.length}`);
  console.log(`All Current: ${allCurrentRows.length}`);
  console.log(`Ever Held or Rejected: ${everHeldOrRejectedRows.length}`);
  console.log(`Needs Review: ${needsReviewRows.length}`);

  // Create Excel workbook
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Antigravity ATS Export Engine';
  workbook.created = new Date();
  workbook.modified = new Date();

  const candidateColumns = [
    { header: 'Candidate ID', key: 'candidateId', width: 26 },
    { header: 'Full Name', key: 'fullName', width: 24 },
    { header: 'Phone (as stored)', key: 'phoneRaw', width: 18 },
    { header: 'Phone Normalised', key: 'phoneNormalized', width: 18 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Phone Valid?', key: 'phoneValid', width: 14 },
    { header: 'Email Valid?', key: 'emailValid', width: 14 },
    { header: 'Needs Contact Details?', key: 'needsContactDetails', width: 22 },
    { header: 'Course Family', key: 'courseFamily', width: 16 },
    { header: 'Course as Stored', key: 'courseAsStored', width: 24 },
    { header: 'Field Found In', key: 'fieldFound', width: 26 },
    { header: 'Match Tier', key: 'matchTier', width: 14 },
    { header: 'Year / Batch', key: 'yearBatch', width: 16 },
    { header: 'College / University', key: 'college', width: 28 },
    { header: 'Drive', key: 'drive', width: 26 },
    { header: 'Current Outcome', key: 'currentOutcome', width: 18 },
    { header: 'Round Number', key: 'currentRoundNo', width: 16 },
    { header: 'Date of Round', key: 'currentRoundDate', width: 16 },
    { header: 'Panelist', key: 'panelist', width: 22 },
    { header: 'Rating', key: 'rating', width: 12 },
    { header: 'Reason (Feedback Comment)', key: 'reason', width: 60 },
    { header: 'DOJ as Recorded', key: 'doj', width: 16 },
    { header: 'Total Rounds', key: 'totalRounds', width: 14 },
    { header: 'Round History', key: 'roundHistory', width: 38 },
    { header: 'Ever On Hold?', key: 'everOnHold', width: 14 },
    { header: 'Ever Rejected?', key: 'everRejected', width: 14 },
    { header: 'Role Applied For', key: 'role', width: 24 },
    { header: 'Job ID', key: 'jobId', width: 24 },
    { header: 'Location / Area', key: 'locationArea', width: 24 },
    { header: 'Languages', key: 'languages', width: 24 },
    { header: 'Prior Experience', key: 'priorExperience', width: 28 },
    { header: 'Family Background', key: 'familyBackground', width: 28 },
    { header: 'Source', key: 'source', width: 22 },
    { header: 'Recruiter / Owner', key: 'recruiterOwner', width: 22 },
    { header: 'Resume Link', key: 'resumeLink', width: 30 },
    { header: 'Created Date', key: 'createdAt', width: 16 },
    { header: 'Last Updated', key: 'updatedAt', width: 16 },
    { header: 'Flags', key: 'flags', width: 36 }
  ];

  function writeCandidateSheet(sheet, rows, isReviewSheet = false) {
    if (isReviewSheet) {
      sheet.columns = [...candidateColumns, { header: 'Review Reason', key: 'reviewReason', width: 45 }];
    } else {
      sheet.columns = candidateColumns;
    }

    rows.forEach(r => {
      const row = sheet.addRow(r);

      // Explicit string format for phone numbers
      const phoneColIdx = sheet.getColumn('phoneRaw').number;
      const phoneNormColIdx = sheet.getColumn('phoneNormalized').number;
      const reasonColIdx = sheet.getColumn('reason').number;

      const pCell = row.getCell(phoneColIdx);
      pCell.value = String(r.phoneRaw || '');
      pCell.numFmt = '@';

      const pNormCell = row.getCell(phoneNormColIdx);
      pNormCell.value = String(r.phoneNormalized || '');
      pNormCell.numFmt = '@';

      // Date formats
      const roundDateColIdx = sheet.getColumn('currentRoundDate').number;
      const createdColIdx = sheet.getColumn('createdAt').number;
      const updatedColIdx = sheet.getColumn('updatedAt').number;

      if (r.currentRoundDate) row.getCell(roundDateColIdx).numFmt = 'DD-MM-YYYY';
      if (r.createdAt) row.getCell(createdColIdx).numFmt = 'DD-MM-YYYY';
      if (r.updatedAt) row.getCell(updatedColIdx).numFmt = 'DD-MM-YYYY';

      // Alignment and text wrapping for comments
      row.getCell(reasonColIdx).alignment = { wrapText: true, vertical: 'top' };
    });

    applySheetStyles(sheet);
  }

  // --- SHEET 1: Summary ---
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 44 },
    { header: 'Value', key: 'val', width: 22 },
    { header: 'Description / Notes', key: 'desc', width: 62 }
  ];

  // College & Drive Breakdown
  const driveCounts = {};
  allCurrentRows.forEach(r => {
    const d = r.college || r.drive || 'Off-Campus / Direct';
    driveCounts[d] = (driveCounts[d] || 0) + 1;
  });

  // Role Breakdown
  const roleCounts = {};
  allCurrentRows.forEach(r => {
    const ro = r.role || 'Unspecified';
    roleCounts[ro] = (roleCounts[ro] || 0) + 1;
  });

  // Month Breakdown
  const monthCounts = {};
  allCurrentRows.forEach(r => {
    let m = 'Undated';
    if (r.currentRoundDate) {
      const d = new Date(r.currentRoundDate);
      m = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    }
    monthCounts[m] = (monthCounts[m] || 0) + 1;
  });

  const notIncludedTotal = notIncludedCounts.SELECTED + notIncludedCounts.PENDING + notIncludedCounts.DIDNT_JOIN + notIncludedCounts.COMPLETED_NO_OUTCOME + notIncludedCounts.OTHER;
  // Candidates in needsReview that are not already on main sheets
  const inMainSheets = new Set(allCurrentRows.map(r => r.candidateId));
  const standaloneNeedsReviewCount = needsReviewRows.filter(r => !inMainSheets.has(r.candidateId)).length;
  const reconciliationSum = allCurrentRows.length + notIncludedTotal + standaloneNeedsReviewCount + excludedNonTargetCourses;

  const summaryData = [
    { metric: 'Run Date & Time (IST)', val: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }), desc: 'Script execution timestamp' },
    { metric: 'Export Mode', val: 'BCA & MCA Candidates (On Hold & Rejected)', desc: 'TalentOS ATS Parameterized Export' },
    { metric: 'Target Course Filter', val: 'BCA, MCA', desc: 'Degrees included under evaluation rules' },
    { metric: 'Target Outcome Filter', val: 'On Hold, Rejected', desc: 'Current candidate status / latest round outcome' },
    { metric: '', val: '', desc: '' },
    { metric: 'Total Active DB Candidates Evaluated', val: totalEvaluated, desc: 'Active records scanned with keyset streaming (isDeleted=false, is_test_data=false)' },
    { metric: 'Soft-Deleted Records Excluded', val: softDeletedCount, desc: 'Excluded records with isDeleted = true' },
    { metric: 'Archived Test Records Excluded', val: testDataCount, desc: 'Excluded records flagged is_test_data = true' },
    { metric: '', val: '', desc: '' },
    { metric: 'CURRENT OUTCOME SUMMARY (Main Sheets):', val: '', desc: '' },
    { metric: '  • BCA – On Hold (Current)', val: bcaOnHoldRows.length, desc: 'BCA candidates currently On Hold (Sheet: BCA – On Hold)' },
    { metric: '  • BCA – Rejected (Current)', val: bcaRejectedRows.length, desc: 'BCA candidates currently Rejected (Sheet: BCA – Rejected)' },
    { metric: '  • MCA – On Hold (Current)', val: mcaOnHoldRows.length, desc: 'MCA candidates currently On Hold (Sheet: MCA – On Hold)' },
    { metric: '  • MCA – Rejected (Current)', val: mcaRejectedRows.length, desc: 'MCA candidates currently Rejected (Sheet: MCA – Rejected)' },
    { metric: '  • Total Confirmed People Included (All current)', val: allCurrentRows.length, desc: 'All four sheets combined, 1 row per person (Sheet: All (current))' },
    { metric: '', val: '', desc: '' },
    { metric: 'EVER HELD OR REJECTED (Historical):', val: '', desc: '' },
    { metric: '  • Ever Held or Rejected in Any Round', val: everHeldOrRejectedRows.length, desc: 'Candidates ever On Hold or Rejected, including those later Selected (Sheet: Ever Held or Rejected)' },
    { metric: '', val: '', desc: '' },
    { metric: 'AMBIGUOUS / REVIEW TIER:', val: '', desc: '' },
    { metric: '  • Course Ambiguous (Needs Review)', val: needsReviewRows.length, desc: 'Course discrepancies between candidate and feedback, or in comments only (Sheet: Needs Review)' },
    { metric: '', val: '', desc: '' },
    { metric: 'BCA & MCA CANDIDATES NOT INCLUDED (Other Outcomes):', val: notIncludedTotal, desc: 'Confirmed BCA/MCA candidates with outcomes other than On Hold or Rejected' },
    { metric: '  • Selected (Current)', val: notIncludedCounts.SELECTED, desc: 'Candidates selected in their current/latest round' },
    { metric: '  • Pending / Scheduled / Rescheduled', val: notIncludedCounts.PENDING, desc: 'Candidates with interviews pending, scheduled, or rescheduled' },
    { metric: '  • Didn\'t Join / No-Show / Not Responded', val: notIncludedCounts.DIDNT_JOIN, desc: 'Candidates who did not attend or join' },
    { metric: '  • Completed Round (No Outcome Stored)', val: notIncludedCounts.COMPLETED_NO_OUTCOME, desc: 'Completed lifecycle without an evaluation outcome' },
    { metric: '  • Other Active Candidates (No Interviews)', val: notIncludedCounts.OTHER, desc: 'Imported/added candidates with no interview rounds conducted' },
    { metric: '', val: '', desc: '' },
    { metric: 'EXCLUDED NON-TARGET DEGREES:', val: excludedNonTargetCourses, desc: 'Engineering (B.Tech/BE), Commerce (B.Com), Business (BBA/MBA), MSc' },
    { metric: '', val: '', desc: '' },
    { metric: 'RECONCILIATION SUM CHECK', val: `${reconciliationSum} / ${totalEvaluated}`, desc: `Included (${allCurrentRows.length}) + Not Included (${notIncludedTotal}) + Standalone Review (${standaloneNeedsReviewCount}) + Excluded (${excludedNonTargetCourses}) = Total Evaluated (${totalEvaluated})` },
    { metric: '', val: '', desc: '' },
    { metric: 'DATA QUALITY METRICS:', val: '', desc: '' },
    { metric: '  • Data Quality Issues Flagged', val: qualityIssues.length, desc: 'Missing contacts, contradictions, duplicate contacts (Sheet: Data Quality)' },
    { metric: '  • Candidates with No Phone or Email', val: allCurrentRows.filter(r => r.needsContactDetails === 'Yes').length, desc: 'Campus drive records flagged needs_contact_details' },
    { metric: '', val: '', desc: '' },
    { metric: 'BREAKDOWN BY COLLEGE / DRIVE (Current Included):', val: '', desc: '' },
    ...Object.entries(driveCounts).map(([col, cnt]) => ({
      metric: `  • ${col}`, val: cnt, desc: `Candidates from ${col}`
    })),
    { metric: '', val: '', desc: '' },
    { metric: 'BREAKDOWN BY ROLE APPLIED (Current Included):', val: '', desc: '' },
    ...Object.entries(roleCounts).map(([ro, cnt]) => ({
      metric: `  • ${ro}`, val: cnt, desc: `Candidates applied for ${ro}`
    })),
    { metric: '', val: '', desc: '' },
    { metric: 'BREAKDOWN BY MONTH (Latest Round Date):', val: '', desc: '' },
    ...Object.entries(monthCounts).map(([mo, cnt]) => ({
      metric: `  • ${mo}`, val: cnt, desc: `Candidates evaluated in ${mo}`
    }))
  ];

  summaryData.forEach(r => summarySheet.addRow(r));
  applySheetStyles(summarySheet, true);

  // --- SHEET 2: BCA – On Hold ---
  const bcaHoldSheet = workbook.addWorksheet('BCA – On Hold');
  writeCandidateSheet(bcaHoldSheet, bcaOnHoldRows);

  // --- SHEET 3: BCA – Rejected ---
  const bcaRejSheet = workbook.addWorksheet('BCA – Rejected');
  writeCandidateSheet(bcaRejSheet, bcaRejectedRows);

  // --- SHEET 4: MCA – On Hold ---
  const mcaHoldSheet = workbook.addWorksheet('MCA – On Hold');
  writeCandidateSheet(mcaHoldSheet, mcaOnHoldRows);

  // --- SHEET 5: MCA – Rejected ---
  const mcaRejSheet = workbook.addWorksheet('MCA – Rejected');
  writeCandidateSheet(mcaRejSheet, mcaRejectedRows);

  // --- SHEET 6: All (current) ---
  const allCurrentSheet = workbook.addWorksheet('All (current)');
  writeCandidateSheet(allCurrentSheet, allCurrentRows);

  // --- SHEET 7: Ever Held or Rejected ---
  const everSheet = workbook.addWorksheet('Ever Held or Rejected');
  writeCandidateSheet(everSheet, everHeldOrRejectedRows);

  // --- SHEET 8: Needs Review ---
  const reviewSheet = workbook.addWorksheet('Needs Review');
  writeCandidateSheet(reviewSheet, needsReviewRows, true);

  // --- SHEET 9: Data Quality ---
  const dqSheet = workbook.addWorksheet('Data Quality');
  dqSheet.columns = [
    { header: 'Candidate ID', key: 'candidateId', width: 28 },
    { header: 'Full Name', key: 'fullName', width: 26 },
    { header: 'Phone', key: 'phone', width: 18 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Course Family', key: 'courseFamily', width: 16 },
    { header: 'Issue Type', key: 'issueType', width: 28 },
    { header: 'Details', key: 'details', width: 65 }
  ];
  qualityIssues.forEach(qi => {
    const row = dqSheet.addRow(qi);
    row.getCell(3).numFmt = '@';
  });
  applySheetStyles(dqSheet);

  // --- SHEET 10: Match Rules ---
  const rulesSheet = workbook.addWorksheet('Match Rules');
  rulesSheet.columns = [
    { header: 'Rule Category', key: 'category', width: 28 },
    { header: 'Match Tier', key: 'tier', width: 16 },
    { header: 'Spelling / Keyword / Pattern', key: 'keyword', width: 45 },
    { header: 'Candidates Count', key: 'count', width: 18 },
    { header: 'Rule Reference / Note', key: 'note', width: 55 }
  ];
  const sortedRules = Object.values(matchRulesStats).sort((a, b) => b.count - a.count);
  sortedRules.forEach(r => rulesSheet.addRow(r));
  applySheetStyles(rulesSheet);

  // Save Excel workbook
  const outFilename = `BCA_MCA_OnHold_Rejected_Candidates_${todayStr}.xlsx`;
  const outPath = path.join(exportsDir, outFilename);
  console.log(`Saving workbook to: ${outPath}...`);
  await workbook.xlsx.writeFile(outPath);

  console.log(`\nExport successful! Saved: ${outPath}`);
  console.log(`Summary Counts:`);
  console.log(`- BCA – On Hold: ${bcaOnHoldRows.length}`);
  console.log(`- BCA – Rejected: ${bcaRejectedRows.length}`);
  console.log(`- MCA – On Hold: ${mcaOnHoldRows.length}`);
  console.log(`- MCA – Rejected: ${mcaRejectedRows.length}`);
  console.log(`- All (current) Total: ${allCurrentRows.length}`);
  console.log(`- Ever Held or Rejected: ${everHeldOrRejectedRows.length}`);
  console.log(`- Needs Review: ${needsReviewRows.length}`);
  console.log(`- Data Quality Issues: ${qualityIssues.length}`);
  console.log(`- Candidates Not Included: ${notIncludedTotal}`);
  console.log(`- Excluded Non-Target Degrees: ${excludedNonTargetCourses}`);
  console.log(`- Reconciliation Check: ${reconciliationSum} / ${totalEvaluated} (${reconciliationSum === totalEvaluated ? 'PASSED' : 'MISMATCH'})`);
  console.log(`- File size: ${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB`);

  return {
    outPath,
    bcaOnHoldCount: bcaOnHoldRows.length,
    bcaRejectedCount: bcaRejectedRows.length,
    mcaOnHoldCount: mcaOnHoldRows.length,
    mcaRejectedCount: mcaRejectedRows.length,
    allCurrentCount: allCurrentRows.length,
    everHeldOrRejectedCount: everHeldOrRejectedRows.length,
    needsReviewCount: needsReviewRows.length,
    qualityCount: qualityIssues.length
  };
}

async function runExport() {
  const cliOptions = parseCliArgs();
  if (cliOptions.coursesArg || cliOptions.outcomesArg) {
    return runBcaMcaExport(cliOptions);
  }
  return runCityExport(cliOptions);
}

runExport()
  .catch(err => {
    console.error('Export error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

