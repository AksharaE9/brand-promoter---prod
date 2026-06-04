const { db: firestore } = require("../../config/firebase");
const { getCache, setCache } = require("../../utils/cache");

const activePromises = new Map();

const ANALYTICS_CACHE_TTL = 30;      // 30 seconds for analytics data
const STAGES_CACHE_TTL   = 120;      // 2 minutes for pipeline stages (changes rarely)

/**
 * Shared data loader for analytics endpoints.
 * Fetches candidates, applications, and interviews for an organization,
 * caches them in Redis for 30s, and deduplicates parallel requests in memory.
 *
 * @param {string} orgId - Organization ID
 * @returns {Promise<{candidates: Array, apps: Array, interviews: Array}>}
 */
async function getOrgAnalyticsData(orgId) {
  const cacheKey = `analytics_data_loader:${orgId}`;

  // 1. Check Redis first (fast path)
  try {
    const cached = await getCache(cacheKey);
    if (cached !== null) return cached;
  } catch (_) { /* fall through to Firestore */ }

  // 2. Promise deduplication — if another request is already fetching, share it
  if (activePromises.has(cacheKey)) {
    return activePromises.get(cacheKey);
  }

  const promise = (async () => {
    // Fetch all three collections in parallel
    const [candidatesSnap, appsSnap, interviewsSnap] = await Promise.all([
      firestore.collection("candidates").get(),
      firestore.collection("applications").get(),
      firestore.collection("interviews").get(),
    ]);

    const candidates = candidatesSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.isDeleted !== true)
      .filter(c => (c.organizationId || "defaultOrg") === orgId);

    // Filter apps to only those belonging to candidates in this org
    const candidateIds = new Set(candidates.map(c => c.id));
    const apps = appsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(a => candidateIds.has(a.candidateId));

    // Build apps map for interview lookup
    const appsMap = {};
    apps.forEach(a => { appsMap[a.id] = a; });

    // Filter interviews to those belonging to apps in this org
    const interviews = interviewsSnap.docs
      .map(d => {
        const data = d.data();
        const app = appsMap[data.applicationId];
        return {
          id: d.id,
          ...data,
          candidateId: app ? app.candidateId : null,
        };
      })
      .filter(i => i.candidateId && candidateIds.has(i.candidateId));

    const result = { candidates, apps, interviews };

    // 3. Persist to Redis cache
    try {
      await setCache(cacheKey, result, ANALYTICS_CACHE_TTL);
    } catch (_) { /* non-fatal */ }

    return result;
  })();

  activePromises.set(cacheKey, promise);

  try {
    return await promise;
  } finally {
    activePromises.delete(cacheKey);
  }
}

/**
 * Helper to get pipeline stages — cached for 2 minutes.
 */
async function getPipelineStages() {
  const cacheKey = "global:pipeline_stages";

  // 1. Try Redis
  try {
    const cached = await getCache(cacheKey);
    if (cached !== null) return cached;
  } catch (_) { /* fall through */ }

  // 2. Promise deduplication
  if (activePromises.has(cacheKey)) {
    return activePromises.get(cacheKey);
  }

  const promise = (async () => {
    const stagesSnap = await firestore.collection("pipeline_stages").get();
    const stages = stagesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    try {
      await setCache(cacheKey, stages, STAGES_CACHE_TTL);
    } catch (_) { /* non-fatal */ }

    return stages;
  })();

  activePromises.set(cacheKey, promise);

  try {
    return await promise;
  } finally {
    activePromises.delete(cacheKey);
  }
}

module.exports = {
  getOrgAnalyticsData,
  getPipelineStages,
};
