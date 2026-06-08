'use strict';
const { db: adminDb } = require('../../config/firebase');
const { getCache, setCache } = require('../../utils/cache');
const { populateInterviews } = require('../../services/schedulingCacheService');
const crypto = require('crypto');

const SEARCH_CACHE_TTL = 20; // 20 seconds — search results go stale quickly
const SEARCH_DOC_LIMIT = 200; // Capped to 200 documents for database read efficiency

function hashSearchQuery(orgId, searchTerm, filters) {
  const key = `${orgId}:${searchTerm}:${JSON.stringify(filters)}`;
  return crypto.createHash('md5').update(key).digest('hex').slice(0, 16);
}

async function searchInterviews(orgId, searchTerm, filters = {}) {
  const queryHash = hashSearchQuery(orgId, searchTerm, filters);
  const cacheKey  = `interviews:search:${orgId}:${queryHash}`;

  // Check cache first — search results have short TTL
  const cached = await getCache(cacheKey);
  if (cached) return { data: cached, source: 'cache' };

  // Firestore fetch — strictly limited to SEARCH_DOC_LIMIT
  let query = adminDb.collection('interviews')
    .where('organizationId', '==', orgId)
    .where('isDeleted', '==', false)
    .orderBy('scheduledStart', 'desc')
    .limit(SEARCH_DOC_LIMIT);

  if (filters.status)        query = query.where('status', '==', filters.status);
  if (filters.candidateId)   query = query.where('candidateId', '==', filters.candidateId);
  if (filters.interviewerId) query = query.where('interviewerIds', 'array-contains', filters.interviewerId);

  const snap = await query.get();
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Populate candidate and job info before filtering
  const populated = await populateInterviews(all, { skipFeedbacks: true });

  // In-memory search on populated dataset
  const term = searchTerm.toLowerCase().trim();
  const results = term
    ? populated.filter(r => {
        const candName = (r.application?.candidate?.fullName || '').toLowerCase();
        const jobTitle = (r.application?.job?.title || '').toLowerCase();
        const roundName = (r.round || '').toLowerCase();
        return candName.includes(term) || jobTitle.includes(term) || roundName.includes(term);
      })
    : populated;

  // Cache the search results
  await setCache(cacheKey, results, SEARCH_CACHE_TTL);

  return { data: results, source: 'firestore', totalScanned: all.length };
}

module.exports = { searchInterviews };
