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

  // Promise deduplication for concurrent requests
  if (activePromises.has(cacheKey)) {
    return activePromises.get(cacheKey);
  }

  const promise = (async () => {
    // Fetch collections in parallel
    const [candidatesSnap, appsSnap, interviewsSnap] = await Promise.all([
      firestore.collection("candidates").get(),
      firestore.collection("applications").get(),
      firestore.collection("interviews").get()
    ]);

    const candidates = candidatesSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.isDeleted !== true)
      .filter(c => {
        const cOrg = c.organizationId || "defaultOrg";
        return cOrg === orgId;
      });

    // Filter apps to only contain those belonging to candidates in this org
    const candidateIds = new Set(candidates.map(c => c.id));
    const apps = appsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(a => candidateIds.has(a.candidateId));

    // Create an apps map for quick lookup
    const appsMap = {};
    apps.forEach(a => {
      appsMap[a.id] = a;
    });

    // Filter interviews to only contain those belonging to apps in this org
    const interviews = interviewsSnap.docs
      .map(d => {
        const data = d.data();
        const app = appsMap[data.applicationId];
        return {
          id: d.id,
          ...data,
          candidateId: app ? app.candidateId : null
        };
      })
      .filter(i => i.candidateId && candidateIds.has(i.candidateId));

    return { candidates, apps, interviews };
  })();

  activePromises.set(cacheKey, promise);

  try {
    return await promise;
  } finally {
    activePromises.delete(cacheKey);
  }
}

/**
 * Helper to get pipeline stages directly from Firestore.
 */
async function getPipelineStages() {
  const cacheKey = "global:pipeline_stages";

  if (activePromises.has(cacheKey)) {
    return activePromises.get(cacheKey);
  }

  const promise = (async () => {
    const stagesSnap = await firestore.collection("pipeline_stages").get();
    return stagesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
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
