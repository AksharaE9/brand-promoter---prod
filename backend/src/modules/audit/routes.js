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
      limit = 50,
      cursor,
      entityType,
      action,
      userId,
      startDate,
      endDate,
      search
    } = req.query;

    const parsedLimit = Math.min(parseInt(limit) || 50, 200); // cap at 200
    const orgId = req.user.organizationId || "defaultOrg";

    const fields = [
      'entityType', 'action', 'actorUserId', 'createdAt', 'ipAddress',
      'userAgent', 'actorName', 'actorEmail', 'actorRole', 'entityName',
      'entityId', 'organizationId', 'isDeleted'
    ];

    // Build Firestore query — equality filters only
    let query = firestore.collection("auditLogs")
      .where("organizationId", "==", orgId)
      .where("isDeleted", "==", false)
      .select(...fields);

    if (entityType) query = query.where("entityType", "==", entityType);
    if (action)     query = query.where("action",     "==", action);
    if (userId)     query = query.where("actorUserId", "==", userId);

    // Date range filters
    if (startDate) query = query.where("createdAt", ">=", new Date(startDate).toISOString());
    if (endDate)   query = query.where("createdAt", "<=", new Date(endDate).toISOString());

    query = query.orderBy("createdAt", "desc");

    let useCursorPagination = true;
    if (search) {
      useCursorPagination = false;
    }

    let finalLogs = [];
    let nextCursor = null;
    let hasMore = false;

    if (useCursorPagination) {
      const { paginateFirestore } = require("../../utils/pagination");
      const result = await paginateFirestore({ query, limit: parsedLimit, cursor });
      const logs = result.data;

      finalLogs = logs.map(log => ({
        ...log,
        actor: {
          fullName: log.actorName || log.actorUserId || "System",
          email:    log.actorEmail || "",
          role:     log.actorRole  || "Admin",
        },
        entityName: log.entityName || log.entityId || "N/A",
      }));
      nextCursor = result.nextCursor;
      hasMore = result.hasMore;
    } else {
      // In-memory search fallback
      const fetchLimit = 5000;
      const snapshot = await query.limit(fetchLimit).get();
      let logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      if (search) {
        const s = search.toLowerCase();
        logs = logs.filter(log =>
          (log.actorName   || "").toLowerCase().includes(s) ||
          (log.entityName  || "").toLowerCase().includes(s) ||
          (log.action      || "").toLowerCase().includes(s) ||
          (log.entityType  || "").toLowerCase().includes(s)
        );
      }

      let startIndex = 0;
      if (cursor) {
        const idx = logs.findIndex(item => item.id === cursor);
        if (idx !== -1) {
          startIndex = idx + 1;
        }
      }

      const paginated = logs.slice(startIndex, startIndex + parsedLimit);
      nextCursor = (startIndex + parsedLimit < logs.length) ? paginated[paginated.length - 1].id : null;
      hasMore = startIndex + parsedLimit < logs.length;

      finalLogs = paginated.map(log => ({
        ...log,
        actor: {
          fullName: log.actorName || log.actorUserId || "System",
          email:    log.actorEmail || "",
          role:     log.actorRole  || "Admin",
        },
        entityName: log.entityName || log.entityId || "N/A",
      }));
    }

    if (finalLogs.length > 30) {
      const { streamPaginatedJson } = require("../../utils/streamResponse");
      return streamPaginatedJson(res, finalLogs, { nextCursor, hasMore });
    }

    res.json({
      success: true,
      data: finalLogs,
      nextCursor,
      hasMore
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
