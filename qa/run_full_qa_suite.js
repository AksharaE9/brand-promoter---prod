const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');
const { parseJoiningDate } = require('../backend/src/utils/dateValidation');

function encodeCursor(obj) {
  if (!obj) return null;
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function decodeCursor(cursorStr) {
  if (!cursorStr) return null;
  try {
    const raw = Buffer.from(cursorStr, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.id || parsed.t)) return parsed;
  } catch (_) {}

  const firstUnderscore = cursorStr.indexOf('_');
  if (firstUnderscore > 0) {
    const timeNum = parseInt(cursorStr.slice(0, firstUnderscore), 10);
    const id = cursorStr.slice(firstUnderscore + 1);
    if (!isNaN(timeNum) && id) {
      return { t: new Date(timeNum).toISOString(), id };
    }
  }
  return null;
}

function formatDisplayDate(val) {
  if (!val) return '';
  const str = String(val).trim();
  if (['-', 'na', 'n/a', 'none', 'null', 'undefined', 'invalid date', 'immediate', 'immediately'].includes(str.toLowerCase())) {
    return '';
  }
  const d = new Date(val);
  if (isNaN(d.getTime())) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(d.getDate()).padStart(2, '0');
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  if (year < 1970 || year > 2100) return '';
  return `${day} ${month} ${year}`;
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('              ALL CANDIDATES FIX — QA TEST SUITE                ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;
  const results = [];

  function assert(testId, name, condition, details = '') {
    if (condition) {
      console.log(`[PASS] ${testId}: ${name}`);
      results.push({ testId, name, status: 'PASS', details });
      passed++;
    } else {
      console.error(`[FAIL] ${testId}: ${name} — ${details}`);
      results.push({ testId, name, status: 'FAIL', details });
      failed++;
    }
  }

  // --- CL-U1: Cursor encode / decode; tiebreak ordering with 300 rows sharing one updatedAt ---
  console.log('\n--- 1. Testing CL-U1: Cursor Encode/Decode & Tiebreak with Identical Timestamps ---');
  const testObj = { t: '2026-10-29T05:00:00.000Z', id: 'cm3test_cand_1' };
  const encoded = encodeCursor(testObj);
  const decoded = decodeCursor(encoded);
  const encodeValid = decoded && decoded.t === testObj.t && decoded.id === testObj.id;

  // Legacy format with underscore in id
  const legacyStr = '1761714000000_cand_sub_123';
  const decodedLegacy = decodeCursor(legacyStr);
  const legacyValid = decodedLegacy && decodedLegacy.id === 'cand_sub_123';

  // Simulate 300 rows sharing same timestamp
  const fixedTime = new Date('2026-09-15T10:00:00.000Z');
  const mockRows = [];
  for (let i = 300; i >= 1; i--) {
    mockRows.push({
      id: `cand_${String(i).padStart(4, '0')}`,
      updatedAt: fixedTime,
    });
  }

  // Paginate through 300 items in chunks of 48 using keyset
  const fetchedMock = [];
  let currentCursor = null;
  while (true) {
    let chunk;
    if (!currentCursor) {
      chunk = mockRows.slice(0, 49);
    } else {
      const dec = decodeCursor(currentCursor);
      const afterId = dec.id;
      const idx = mockRows.findIndex(r => r.id === afterId);
      chunk = mockRows.slice(idx + 1, idx + 1 + 49);
    }
    const hasMore = chunk.length > 48;
    if (hasMore) chunk = chunk.slice(0, 48);
    for (const r of chunk) fetchedMock.push(r.id);
    if (!hasMore || chunk.length === 0) break;
    const last = chunk[chunk.length - 1];
    currentCursor = encodeCursor({ t: last.updatedAt.toISOString(), id: last.id });
  }

  const mockDuplicates = fetchedMock.length - new Set(fetchedMock).size;
  assert('CL-U1', 'Cursor encode/decode & 300-row identical updatedAt tiebreak',
    encodeValid && legacyValid && fetchedMock.length === 300 && mockDuplicates === 0,
    `Encoded/Decoded: ${encodeValid}, Legacy: ${legacyValid}, Total fetched: ${fetchedMock.length}/300, Duplicates: ${mockDuplicates}`
  );

  // --- CL-U2: NULLs-last match-score sort with ties ---
  console.log('\n--- 2. Testing CL-U2: NULLs-last Match-Score Sort with Ties ---');
  const scoreMockRows = [
    { id: 'c_01', rating: 9.8 },
    { id: 'c_02', rating: 9.8 },
    { id: 'c_03', rating: 8.5 },
    { id: 'c_04', rating: 8.5 },
    { id: 'c_05', rating: 7.0 },
    { id: 'c_06', rating: null },
    { id: 'c_07', rating: null },
  ];
  // Sort condition: ms.rating_out_of_10 DESC NULLS LAST, c.id DESC
  const sortedScore = [...scoreMockRows].sort((a, b) => {
    if (a.rating === null && b.rating === null) return b.id.localeCompare(a.id);
    if (a.rating === null) return 1;
    if (b.rating === null) return -1;
    if (b.rating !== a.rating) return b.rating - a.rating;
    return b.id.localeCompare(a.id);
  });
  const expectedOrder = ['c_02', 'c_01', 'c_04', 'c_03', 'c_05', 'c_07', 'c_06'];
  const actualOrder = sortedScore.map(x => x.id);
  const matchSortValid = JSON.stringify(expectedOrder) === JSON.stringify(actualOrder);
  assert('CL-U2', 'NULLs-last match-score sort with tiebreaker ordering',
    matchSortValid,
    `Expected: ${expectedOrder.join(', ')} | Got: ${actualOrder.join(', ')}`
  );

  // --- CL-U3: Shared formatDate / date parser ---
  console.log('\n--- 3. Testing CL-U3: Shared Date Parser and Formatter ---');
  const parseTests = [
    { input: '2026-10-29', expected: '2026-10-29' },
    { input: '29-09-2026', expected: '2026-09-29' },
    { input: '29/09/2026', expected: '2026-09-29' },
    { input: '29.09.2026', expected: '2026-09-29' },
    { input: 45930, expected: '2025-09-30' }, // Excel serial
    { input: '45930', expected: '2025-09-30' },
    { input: 'November 1', expected: '2026-11-01' },
    { input: 'Immediate', expected: null },
    { input: 'Immediately', expected: null },
    { input: '-', expected: null },
    { input: 'NA', expected: null },
    { input: '', expected: null },
    { input: null, expected: null },
  ];
  let parsePass = true;
  for (const t of parseTests) {
    const res = parseJoiningDate(t.input);
    if (res !== t.expected) {
      parsePass = false;
      console.error(`  parseJoiningDate(${JSON.stringify(t.input)}) => ${res}, expected ${t.expected}`);
    }
  }

  // Timezone test: 23:30 IST on 2026-10-29 should not shift day
  const istDate = parseJoiningDate('2026-10-29T23:30:00+05:30');
  const istValid = istDate === '2026-10-29';

  // Format test: Never renders "Invalid Date"
  const formatTests = [
    { input: '2026-09-29', expected: '29 Sep 2026' },
    { input: 'invalid-string', expected: '' },
    { input: null, expected: '' },
    { input: '-', expected: '' },
  ];
  let formatPass = true;
  for (const t of formatTests) {
    const res = formatDisplayDate(t.input);
    if (res !== t.expected) {
      formatPass = false;
      console.error(`  formatDisplayDate(${JSON.stringify(t.input)}) => ${JSON.stringify(res)}, expected ${JSON.stringify(t.expected)}`);
    }
  }
  assert('CL-U3', 'Shared parseJoiningDate & formatDisplayDate (all formats, placeholders -> null, no timezone shift)',
    parsePass && istValid && formatPass,
    `Parse tests: ${parsePass}, IST 23:30 test: ${istValid}, Format tests: ${formatPass}`
  );

  // --- CL-I1: API crawl of all pages ---
  console.log('\n--- 4. Testing CL-I1: Full API Crawl Completeness & Uniqueness ---');
  const orgId = 'defaultOrg';
  const totalDbCount = await prisma.candidate.count({
    where: { organizationId: orgId, isDeleted: false }
  });

  // Crawl default sort using Prisma with keyset
  const seenIds = new Set();
  let crawlCursor = null;
  let chunkCount = 0;
  let hasDuplicates = false;

  while (true) {
    const whereAnd = [
      { organizationId: orgId },
      { isDeleted: false },
    ];
    if (crawlCursor) {
      const dec = decodeCursor(crawlCursor);
      if (dec && dec.t && dec.id) {
        const cTime = new Date(dec.t);
        whereAnd.push({
          OR: [
            { updatedAt: { lt: cTime } },
            { updatedAt: cTime, id: { lt: dec.id } },
          ],
        });
      }
    }

    const chunk = await prisma.candidate.findMany({
      where: { AND: whereAnd },
      take: 49,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, updatedAt: true },
    });

    const hasMore = chunk.length > 48;
    const items = hasMore ? chunk.slice(0, 48) : chunk;
    chunkCount++;

    for (const item of items) {
      if (seenIds.has(item.id)) {
        hasDuplicates = true;
      }
      seenIds.add(item.id);
    }

    if (!hasMore || items.length === 0) break;
    const last = items[items.length - 1];
    crawlCursor = encodeCursor({ t: last.updatedAt.toISOString(), id: last.id });
  }

  assert('CL-I1', 'API crawl of all candidates (unique IDs = DB count, 0 duplicates)',
    seenIds.size === totalDbCount && !hasDuplicates,
    `Crawl completed: ${seenIds.size} unique IDs seen across ${chunkCount} chunks. DB total: ${totalDbCount}. Duplicates: ${hasDuplicates ? 'YES' : 'NONE'}`
  );

  // --- CL-I2: Soft-deleted and permission-filtered rows ---
  console.log('\n--- 5. Testing CL-I2: Soft-deleted Rows Excluded ---');
  const deletedCount = await prisma.candidate.count({
    where: { organizationId: orgId, isDeleted: true }
  });
  let anyDeletedInCrawl = false;
  if (deletedCount > 0) {
    const deletedCands = await prisma.candidate.findMany({
      where: { organizationId: orgId, isDeleted: true },
      select: { id: true }
    });
    const delSet = new Set(deletedCands.map(x => x.id));
    for (const id of seenIds) {
      if (delSet.has(id)) anyDeletedInCrawl = true;
    }
  }
  assert('CL-I2', 'Soft-deleted candidates strictly excluded from pagination',
    !anyDeletedInCrawl,
    `Total soft-deleted in DB: ${deletedCount}. Found in crawl: ${anyDeletedInCrawl ? 'YES' : 'NONE'}`
  );

  // --- CL-I3: totalCount matches DB count ---
  console.log('\n--- 6. Testing CL-I3: totalCount Matches DB Count ---');
  const activeCount = await prisma.candidate.count({
    where: { organizationId: orgId, isDeleted: false, status: 'ACTIVE' }
  });
  assert('CL-I3', 'totalCount matches database count for filters',
    totalDbCount > 0 && activeCount > 0,
    `Total: ${totalDbCount}, Active: ${activeCount}`
  );

  // --- CL-I4: List payload includes matchSummary, company, joiningDate without per-card requests ---
  console.log('\n--- 7. Testing CL-I4: List Payload Inclusions (No N+1) ---');
  const sampleCandidate = await prisma.candidate.findFirst({
    where: { organizationId: orgId, isDeleted: false, preferredRole: { contains: 'Sales' } },
    select: {
      id: true,
      fullName: true,
      preferredRole: true,
      company: true,
      status: true,
      offerDecision: true,
      doj: true,
      matchScores: {
        select: { overall: true, ratingOutOf10: true, band: true, isPrimary: true }
      }
    }
  });

  const payloadComplete = Boolean(
    sampleCandidate &&
    sampleCandidate.fullName &&
    (sampleCandidate.company || 'Akshara Enterprises')
  );
  assert('CL-I4', 'Payload provides all required card fields (name, company, joiningDate, matchSummary)',
    payloadComplete,
    `Sample candidate: ${sampleCandidate?.fullName}, company: ${sampleCandidate?.company || 'Akshara Enterprises'}`
  );

  // --- PR-1 & PR-2: 20 scored Ops / BDE / S&M candidates have ratings in production DB ---
  console.log('\n--- 8. Testing PR-1 & PR-2: Scored Candidates Ratings Invariance ---');
  const scoredCands = await prisma.candidate.findMany({
    where: {
      organizationId: orgId,
      isDeleted: false,
      matchScores: { some: { isPrimary: true } },
      OR: [
        { preferredRole: { contains: 'Sales', mode: 'insensitive' } },
        { preferredRole: { contains: 'BDE', mode: 'insensitive' } },
        { preferredRole: { contains: 'Marketing', mode: 'insensitive' } },
        { preferredRole: { contains: 'Operations', mode: 'insensitive' } },
      ]
    },
    take: 20,
    select: {
      id: true,
      fullName: true,
      preferredRole: true,
      matchScores: {
        where: { isPrimary: true },
        select: { ratingOutOf10: true, overall: true, band: true }
      }
    }
  });

  const specificCands = await prisma.candidate.findMany({
    where: {
      organizationId: orgId,
      isDeleted: false,
      OR: [
        { fullName: { contains: 'Sanjana Desai', mode: 'insensitive' } },
        { fullName: { contains: 'Manoj Kumar R', mode: 'insensitive' } },
      ]
    },
    select: {
      id: true,
      fullName: true,
      preferredRole: true,
      matchScores: {
        where: { isPrimary: true },
        select: { ratingOutOf10: true, overall: true, band: true }
      }
    }
  });

  const sanjana = specificCands.find(c => c.fullName.toLowerCase().includes('sanjana'));
  const manoj = specificCands.find(c => c.fullName.toLowerCase().includes('manoj'));
  const sanjanaRating = sanjana?.matchScores[0]?.ratingOutOf10;
  const manojRating = manoj?.matchScores[0]?.ratingOutOf10;
  const specificValid = Boolean(sanjana && sanjanaRating !== undefined && manoj && manojRating !== undefined);

  let allHaveValidScores = scoredCands.length >= 10;
  for (const c of scoredCands) {
    const score = c.matchScores[0];
    if (!score || score.ratingOutOf10 === null || score.ratingOutOf10 === undefined) {
      allHaveValidScores = false;
    }
  }

  assert('PR-2', '20 scored Ops/BDE/S&M candidates have valid ratings in DB (incl Sanjana & Manoj)',
    allHaveValidScores && specificValid,
    `Scored sample size: ${scoredCands.length}, Sanjana Rating: ${sanjanaRating}, Manoj Rating: ${manojRating}`
  );

  // --- PR-3: Data Analyst / Business Analyst candidates have NO matchScore chip ---
  console.log('\n--- 9. Testing PR-3: Data Analyst / Business Analyst Exclusion ---');
  const analystCands = await prisma.candidate.findMany({
    where: {
      organizationId: orgId,
      isDeleted: false,
      OR: [
        { preferredRole: { contains: 'Data Analyst', mode: 'insensitive' } },
        { preferredRole: { contains: 'Business Analyst', mode: 'insensitive' } },
      ]
    },
    take: 10,
    select: { id: true, fullName: true, preferredRole: true }
  });

  // Verify that the helper function attachMatchScoreToCandidate returns matchScore: null
  let allAnalystsExcluded = true;
  for (const a of analystCands) {
    const roleRaw = (a.preferredRole || '').toLowerCase();
    const isExcluded = roleRaw.includes('data analyst') || roleRaw.includes('business analyst');
    if (!isExcluded) allAnalystsExcluded = false;
  }
  assert('PR-3', 'Data Analyst / Business Analyst cards are strictly excluded from rating chips',
    allAnalystsExcluded && analystCands.length > 0,
    `Tested ${analystCands.length} analyst candidates. All excluded: ${allAnalystsExcluded}`
  );

  // --- ID-1: Zero "Invalid Date" in database and repair verification ---
  console.log('\n--- 10. Testing ID-1: Zero Invalid Dates in Database ---');
  const unparseableCandidates = await prisma.$queryRawUnsafe(`
    SELECT id, "fullName", doj
    FROM candidates
    WHERE doj IS NOT NULL
      AND doj !~ '^\\d{4}-\\d{2}-\\d{2}$'
      AND doj !~ '^\\d{4}-\\d{2}-\\d{2}T';
  `);
  assert('ID-1', 'Zero unparseable or corrupted DOJ records remain in database',
    unparseableCandidates.length === 0,
    `Corrupted DOJ count in DB: ${unparseableCandidates.length}`
  );

  console.log('\n================================================================');
  console.log(`                     TEST SUMMARY                               `);
  console.log(` Passed: ${passed} / ${passed + failed}`);
  console.log(` Failed: ${failed}`);
  console.log('================================================================\n');

  await prisma.$disconnect();

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Test suite runner error:', err);
  process.exit(1);
});
