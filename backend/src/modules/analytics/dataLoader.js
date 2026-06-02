const { db: firestore } = require("../../config/firebase");
const { getCache, setCache } = require("../../utils/cache");

const activePromises = new Map();

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

  // 1. Try to read from Redis cache
  const cached = await getCache(cacheKey);
  if (cached) {
    return cached;
  }

  // 2. Promise deduplication for concurrent requests
  if (activePromises.has(cacheKey)) {
    return activePromises.get(cacheKey);
  }

  const promise = (async () => {
    // Fetch collections in parallel
    const [candidatesSnap, appsSnap, interviewsSnap] = await Promise.all([
      firestore.collection("candidates").where("organizationId", "==", orgId).get(),
      firestore.collection("applications").where("organizationId", "==", orgId).get().catch(() => firestore.collection("applications").get()),
      firestore.collection("interviews").where("organizationId", "==", orgId).get()
    ]);

    const candidates = candidatesSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.isDeleted !== true);

    // Filter apps and interviews to only contain those belonging to candidates in this org
    const candidateIds = new Set(candidates.map(c => c.id));
    
    const apps = appsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(a => candidateIds.has(a.candidateId));

    const interviews = interviewsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(i => candidateIds.has(i.candidateId));

    const data = { candidates, apps, interviews };

    // Cache in Redis for 30 seconds
    await setCache(cacheKey, data, 30);
    return data;
  })();

  activePromises.set(cacheKey, promise);

  try {
    return await promise;
  } finally {
    activePromises.delete(cacheKey);
  }
}

/**
 * Helper to get pipeline stages with a longer Redis cache TTL (300 seconds)
 * since stages rarely change.
 */
async function getPipelineStages() {
  const cacheKey = "global:pipeline_stages";
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  if (activePromises.has(cacheKey)) {
    return activePromises.get(cacheKey);
  }

  const promise = (async () => {
    const stagesSnap = await firestore.collection("pipeline_stages").get();
    const stages = stagesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    await setCache(cacheKey, stages, 300);
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
  getPipelineStages
};
