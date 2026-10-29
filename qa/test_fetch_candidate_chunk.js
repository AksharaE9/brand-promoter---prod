const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');

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

const DEFAULT_COMPANY = 'Akshara Enterprises';

function attachMatchScoreToCandidate(c) {
  if (!c) return c;
  const roleRaw = (c.preferredRole || c.jobTitle || '').toLowerCase();
  const isExcludedRole = roleRaw.includes('data analyst') || roleRaw.includes('business analyst') || roleRaw.includes('human resource') || roleRaw.includes('hr intern');

  if (isExcludedRole) {
    const { matchScores, resumeParseJobs, ...rest } = c;
    return { ...rest, matchScore: null, matchSummary: null };
  }

  const scores = c.matchScores || [];
  const primaryScore = scores.find(s => s.isPrimary) || (scores.length > 0 ? scores[0] : null);
  const isJoinedOrOffered = Boolean(c.status === 'JOINED' || c.status === 'OFFER_SENT' || c.offerDecision === 'JOINED');

  const matchSummary = primaryScore ? {
    rating10: primaryScore.ratingOutOf10,
    score100: primaryScore.overall,
    band: primaryScore.band,
    state: 'SCORED',
  } : null;

  const { matchScores, resumeParseJobs, ...rest } = c;
  return {
    ...rest,
    company: c.company || DEFAULT_COMPANY,
    joiningDate: isJoinedOrOffered ? c.doj : null,
    matchScore: matchSummary,
    matchSummary,
  };
}

const candidateListSelect = {
  id: true,
  fullName: true,
  preferredRole: true,
  location: true,
  area: true,
  source: true,
  email: true,
  phone: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  offerDecision: true,
  doj: true,
  company: true,
  matchScores: {
    select: {
      overall: true,
      ratingOutOf10: true,
      band: true,
      isPrimary: true,
    },
  },
};

function buildCandidateWhere(orgId, filters = {}, user = null, q = '') {
  const andConditions = [
    { organizationId: orgId },
    { isDeleted: false },
  ];

  const cursor = (filters.cursor || '').trim();
  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded && decoded.t && decoded.id && filters.sortBy !== 'matchScore') {
      const cursorTime = new Date(decoded.t);
      if (!isNaN(cursorTime.getTime())) {
        andConditions.push({
          OR: [
            { updatedAt: { lt: cursorTime } },
            { updatedAt: cursorTime, id: { lt: decoded.id } },
          ],
        });
      }
    }
  }

  return { AND: andConditions };
}

async function fetchCandidateChunk({ orgId, filters = {}, user = null, search = '', limit = 48, cursor = '' }) {
  if (filters.sortBy === 'matchScore') {
    const whereClauses = ['c."organizationId" = $1', 'c."isDeleted" = false'];
    const params = [orgId];

    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (decoded && decoded.id) {
        if (decoded.rating !== null && decoded.rating !== undefined) {
          const rIdx = params.length + 1;
          params.push(Number(decoded.rating));
          const idIdx = params.length + 1;
          params.push(decoded.id);
          whereClauses.push(`(
            ms.rating_out_of_10 < $${rIdx}
            OR (ms.rating_out_of_10 = $${rIdx} AND c.id < $${idIdx})
            OR ms.rating_out_of_10 IS NULL
          )`);
        } else {
          const idIdx = params.length + 1;
          params.push(decoded.id);
          whereClauses.push(`(ms.rating_out_of_10 IS NULL AND c.id < $${idIdx})`);
        }
      }
    }

    const limitIdx = params.length + 1;
    params.push(limit + 1);

    const sql = `
      SELECT c.id, ms.rating_out_of_10 as rating
      FROM candidates c
      LEFT JOIN match_scores ms ON ms.candidate_id = c.id AND ms.is_primary = true
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY ms.rating_out_of_10 DESC NULLS LAST, c.id DESC
      LIMIT $${limitIdx};
    `;

    const rawRows = await prisma.$queryRawUnsafe(sql, ...params);
    const hasMore = rawRows.length > limit;
    if (hasMore) rawRows.pop();

    const ids = rawRows.map(r => r.id);
    const candidatesById = new Map();
    if (ids.length > 0) {
      const fetched = await prisma.candidate.findMany({
        where: { id: { in: ids } },
        select: candidateListSelect,
      });
      for (const c of fetched) candidatesById.set(c.id, c);
    }

    const orderedCandidates = ids.map(id => candidatesById.get(id)).filter(Boolean);
    const items = orderedCandidates.map(attachMatchScoreToCandidate);

    const lastRow = rawRows[rawRows.length - 1];
    const nextCursor = (hasMore && lastRow)
      ? encodeCursor({ rating: lastRow.rating !== null ? Number(lastRow.rating) : null, id: lastRow.id })
      : null;

    return { items, nextCursor, hasMore, limit };
  }

  // Default sort
  const where = buildCandidateWhere(orgId, { ...filters, cursor }, user, search);
  const rawItems = await prisma.candidate.findMany({
    where,
    take: limit + 1,
    orderBy: [
      { updatedAt: 'desc' },
      { id: 'desc' },
    ],
    select: candidateListSelect,
  });

  const hasMore = rawItems.length > limit;
  if (hasMore) rawItems.pop();

  const items = rawItems.map(attachMatchScoreToCandidate);
  const lastItem = rawItems[rawItems.length - 1];
  const nextCursor = (hasMore && lastItem)
    ? encodeCursor({ t: lastItem.updatedAt.toISOString(), id: lastItem.id })
    : null;

  return { items, nextCursor, hasMore, limit };
}

async function runTests() {
  console.log('--- TEST 1: Default Keyset Sort ---');
  const dChunk1 = await fetchCandidateChunk({ orgId: 'defaultOrg', limit: 48 });
  console.log(`Default Chunk 1: count=${dChunk1.items.length}, hasMore=${dChunk1.hasMore}, nextCursor=${dChunk1.nextCursor?.slice(0, 20)}...`);
  const dChunk2 = await fetchCandidateChunk({ orgId: 'defaultOrg', limit: 48, cursor: dChunk1.nextCursor });
  console.log(`Default Chunk 2: count=${dChunk2.items.length}, hasMore=${dChunk2.hasMore}, nextCursor=${dChunk2.nextCursor?.slice(0, 20)}...`);
  
  // Overlap check
  const d1Ids = new Set(dChunk1.items.map(x => x.id));
  const dOverlap = dChunk2.items.filter(x => d1Ids.has(x.id));
  console.log(`Default sort overlap: ${dOverlap.length} (Expected 0)`);

  console.log('\n--- TEST 2: Match Score Keyset Sort ---');
  const mChunk1 = await fetchCandidateChunk({ orgId: 'defaultOrg', limit: 48, filters: { sortBy: 'matchScore' } });
  console.log(`MatchScore Chunk 1: count=${mChunk1.items.length}, hasMore=${mChunk1.hasMore}, nextCursor=${mChunk1.nextCursor?.slice(0, 20)}...`);
  const mChunk2 = await fetchCandidateChunk({ orgId: 'defaultOrg', limit: 48, cursor: mChunk1.nextCursor, filters: { sortBy: 'matchScore' } });
  console.log(`MatchScore Chunk 2: count=${mChunk2.items.length}, hasMore=${mChunk2.hasMore}, nextCursor=${mChunk2.nextCursor?.slice(0, 20)}...`);

  const m1Ids = new Set(mChunk1.items.map(x => x.id));
  const mOverlap = mChunk2.items.filter(x => m1Ids.has(x.id));
  console.log(`MatchScore sort overlap: ${mOverlap.length} (Expected 0)`);
  console.log(`MatchScore Chunk 1 first rating: ${mChunk1.items[0]?.matchScore?.rating10}, last: ${mChunk1.items[mChunk1.items.length - 1]?.matchScore?.rating10}`);
  console.log(`MatchScore Chunk 2 first rating: ${mChunk2.items[0]?.matchScore?.rating10}, last: ${mChunk2.items[mChunk2.items.length - 1]?.matchScore?.rating10}`);

  await prisma.$disconnect();
}

runTests().catch(console.error);
