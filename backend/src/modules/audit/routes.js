const express = require('express');
const router = express.Router();
const { db: firestore } = require('../../config/firebase');
const { auth, requireRoles } = require('../../middleware/auth');
const { getCached } = require('../../utils/cache');

/**
 * GET /api/audit-logs
 *
 * Performance fixes applied:
 * - REMOVED: 5x full-collection fetches (users/candidates/applications/jobs/interviews)
 * - Audit logs are denormalized — actorName and entityName are stored AT WRITE TIME
 * - Only fetch the actual audit logs, paginated server-side
 * - In-memory filter only over the paginated slice (not the entire collection)
 */
router.get('/', auth, requireRoles('SUPER_ADMIN'), async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      entityType,
      action,
      userId,
      startDate,
      endDate,
      search
    } = req.query;

    const parsedLimit = Math.min(parseInt(limit) || 50, 200); // cap at 200
    const parsedPage  = Math.max(parseInt(page)  || 1,  1);

    // Build Firestore query — equality filters only (no composite index needed)
    let query = firestore.collection("auditLogs").orderBy("createdAt", "desc");
    if (entityType) query = query.where("entityType", "==", entityType);
    if (action)     query = query.where("action",     "==", action);
    if (userId)     query = query.where("actorUserId","==", userId);

    // Date range filters — Firestore supports range on same field as orderBy
    if (startDate) query = query.where("createdAt", ">=", new Date(startDate).toISOString());
    if (endDate)   query = query.where("createdAt", "<=", new Date(endDate).toISOString());

    // For search we must fetch a larger slice and filter in-memory (no full-text in Firestore)
    // Fetch enough records to paginate from (max 5000 for search, else just what we need)
    const fetchLimit = search ? 5000 : parsedPage * parsedLimit;

    let snapshot;
    try {
      snapshot = await query.limit(fetchLimit).get();
    } catch (indexErr) {
      // orderBy + where composite fallback — fetch without orderBy
      console.warn("[Audit] orderBy fallback:", indexErr.message);
      let fallbackQuery = firestore.collection("auditLogs");
      if (entityType) fallbackQuery = fallbackQuery.where("entityType", "==", entityType);
      if (action)     fallbackQuery = fallbackQuery.where("action",     "==", action);
      if (userId)     fallbackQuery = fallbackQuery.where("actorUserId","==", userId);
      snapshot = await fallbackQuery.limit(fetchLimit).get();
    }

    let logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Sort newest-first (fallback path already has no orderBy)
    logs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    // In-memory search filter (only over fetched slice)
    if (search) {
      const s = search.toLowerCase();
      logs = logs.filter(log =>
        (log.actorName   || "").toLowerCase().includes(s) ||
        (log.entityName  || "").toLowerCase().includes(s) ||
        (log.action      || "").toLowerCase().includes(s) ||
        (log.entityType  || "").toLowerCase().includes(s)
      );
    }

    const total = logs.length;
    const offset = (parsedPage - 1) * parsedLimit;
    const paginated = logs.slice(offset, offset + parsedLimit);

    // Normalize each log for the frontend — use denormalized fields stored at write time
    const normalized = paginated.map(log => ({
      ...log,
      actor: {
        fullName: log.actorName || log.actorUserId || "System",
        email:    log.actorEmail || "",
        role:     log.actorRole  || "Admin",
      },
      entityName: log.entityName || log.entityId || "N/A",
    }));

    res.json({
      success: true,
      data: normalized,
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit),
      }
    });
  } catch (error) {
    console.error('[Audit] Query failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/audit-logs/:id
 *
 * Single log — use denormalized fields stored at write time.
 * Only falls back to a live read if entityName is missing.
 */
router.get('/:id', auth, requireRoles('SUPER_ADMIN'), async (req, res) => {
  try {
    const doc = await firestore.collection("auditLogs").doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'Log not found' });
    }

    const log = { id: doc.id, ...doc.data() };

    // Use denormalized data — no extra reads needed in the happy path
    log.actor = {
      fullName: log.actorName  || log.actorUserId || "System",
      email:    log.actorEmail || "",
      role:     log.actorRole  || "Admin",
    };
    log.entityName = log.entityName || log.entityId || "N/A";

    res.json({ success: true, data: log });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
