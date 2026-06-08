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
      page = 1,
      entityType,
      action,
      userId,
      startDate,
      endDate,
      search
    } = req.query;

    const parsedLimit = Math.min(parseInt(limit) || 50, 200); // cap at 200
    const pageNum = Math.max(1, parseInt(page) || 1);
    const offset = (pageNum - 1) * parsedLimit;
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
    let totalCount = 0;
    let nextCursor = null;
    let hasMore = false;

    try {
      if (useCursorPagination) {
        // Happy path: run count query
        try {
          const countSnap = await query.count().get();
          totalCount = countSnap.data().count;
        } catch (cntErr) {
          console.warn('[Audit] Count query failed, falling back:', cntErr.message);
        }

        // Execute offset paginated query
        const snapshot = await query.offset(offset).limit(parsedLimit).get();
        const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        finalLogs = logs.map(log => ({
          ...log,
          actor: {
            fullName: log.actorName || log.actorUserId || "System",
            email:    log.actorEmail || "",
            role:     log.actorRole  || "Admin",
          },
          entityName: log.entityName || log.entityId || "N/A",
        }));

        hasMore = offset + finalLogs.length < totalCount;
        nextCursor = hasMore && snapshot.docs[snapshot.docs.length - 1] ? snapshot.docs[snapshot.docs.length - 1].ref.path : null;
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

        totalCount = logs.length;
        const paginated = logs.slice(offset, offset + parsedLimit);
        hasMore = offset + parsedLimit < logs.length;
        nextCursor = hasMore && paginated[paginated.length - 1] ? `auditLogs/${paginated[paginated.length - 1].id}` : null;

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
    } catch (dbError) {
      console.warn('[Audit] Main query failed, using index-free fallback. Error:', dbError.message);
      
      let fallbackQuery = firestore.collection("auditLogs")
        .where("organizationId", "==", orgId)
        .where("isDeleted", "==", false)
        .select(...fields);

      if (entityType) fallbackQuery = fallbackQuery.where("entityType", "==", entityType);
      if (action)     fallbackQuery = fallbackQuery.where("action",     "==", action);
      if (userId)     fallbackQuery = fallbackQuery.where("actorUserId", "==", userId);

      const fetchLimit = 10000;
      const snapshot = await fallbackQuery.limit(fetchLimit).get();
      let logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // 1. Date range filter
      if (startDate) {
        const startISO = new Date(startDate).toISOString();
        logs = logs.filter(log => log.createdAt && log.createdAt >= startISO);
      }
      if (endDate) {
        const endISO = new Date(endDate).toISOString();
        logs = logs.filter(log => log.createdAt && log.createdAt <= endISO);
      }

      // 2. Search
      if (search) {
        const s = search.toLowerCase();
        logs = logs.filter(log =>
          (log.actorName   || "").toLowerCase().includes(s) ||
          (log.entityName  || "").toLowerCase().includes(s) ||
          (log.action      || "").toLowerCase().includes(s) ||
          (log.entityType  || "").toLowerCase().includes(s)
        );
      }

      // 3. Sort by createdAt desc
      logs.sort((a, b) => {
        const ad = a.createdAt ? new Date(a.createdAt) : new Date(0);
        const bd = b.createdAt ? new Date(b.createdAt) : new Date(0);
        return bd - ad;
      });

      // 4. Pagination
      totalCount = logs.length;
      const paginated = logs.slice(offset, offset + parsedLimit);
      hasMore = offset + parsedLimit < logs.length;
      nextCursor = hasMore && paginated[paginated.length - 1] ? `auditLogs/${paginated[paginated.length - 1].id}` : null;

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

    const pagination = {
      total: totalCount,
      page: pageNum,
      limit: parsedLimit,
      totalPages: Math.ceil(totalCount / parsedLimit) || 1
    };

    if (finalLogs.length > 30) {
      const { streamPaginatedJson } = require("../../utils/streamResponse");
      return streamPaginatedJson(res, finalLogs, { nextCursor, hasMore, pagination });
    }

    res.json({
      success: true,
      data: finalLogs,
      nextCursor,
      hasMore,
      pagination
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
