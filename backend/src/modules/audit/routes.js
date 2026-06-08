const express = require('express');
const router = express.Router();
const { db: firestore } = require('../../config/firebase');
const { auth, requireRoles } = require('../../middleware/auth');

/**
 * GET /api/audit-logs
 *
 * Returns paginated audit logs for the org. Supports:
 * - Date range: startDate / endDate
 * - Filter: entityType, action (single), userId
 * - Search: actorName / entityName / action / entityType (in-memory)
 * - Cursor pagination: page + limit
 *
 * Fallback: if the composite index is missing, runs an index-free query
 * and sorts/filters in memory.
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

    const parsedLimit = Math.min(parseInt(limit) || 50, 200);
    const pageNum    = Math.max(1, parseInt(page) || 1);
    const offset     = (pageNum - 1) * parsedLimit;
    const orgId      = req.user.organizationId || "defaultOrg";

    const fields = [
      'entityType', 'action', 'actorUserId', 'createdAt', 'ipAddress',
      'userAgent', 'actorName', 'actorEmail', 'actorRole', 'entityName',
      'entityId', 'organizationId', 'isDeleted'
    ];

    // ── Helper: shape a raw Firestore doc into the response format ──
    const formatLog = (log) => ({
      ...log,
      actor: {
        fullName: log.actorName  || log.actorUserId || "System",
        email:    log.actorEmail || "",
        role:     log.actorRole  || "Admin",
      },
      entityName: log.entityName || log.entityId || "N/A",
    });

    // ── Helper: build in-memory page from a filtered array ──
    const paginateInMemory = (logs) => {
      const total     = logs.length;
      const paginated = logs.slice(offset, offset + parsedLimit);
      const hasMore   = offset + parsedLimit < logs.length;
      return { finalLogs: paginated.map(formatLog), totalCount: total, hasMore };
    };

    // ── Attempt primary query (needs composite index) ──
    let baseQuery = firestore.collection("auditLogs")
      .where("organizationId", "==", orgId)
      .where("isDeleted", "==", false)
      .select(...fields);

    if (entityType) baseQuery = baseQuery.where("entityType", "==", entityType);
    if (action)     baseQuery = baseQuery.where("action",     "==", action);
    if (userId)     baseQuery = baseQuery.where("actorUserId","==", userId);

    if (startDate)  baseQuery = baseQuery.where("createdAt", ">=", new Date(startDate).toISOString());
    if (endDate)    baseQuery = baseQuery.where("createdAt", "<=", new Date(endDate + 'T23:59:59.999Z').toISOString());

    let finalLogs  = [];
    let totalCount = 0;
    let hasMore    = false;

    try {
      // Try with orderBy (requires composite index)
      const ordered = baseQuery.orderBy("createdAt", "desc");

      if (!search) {
        // Count query for total
        try {
          const countSnap = await ordered.count().get();
          totalCount = countSnap.data().count;
        } catch (_) {}

        const snapshot = await ordered.offset(offset).limit(parsedLimit).get();
        const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        finalLogs  = logs.map(formatLog);
        hasMore    = offset + finalLogs.length < totalCount;
      } else {
        // Search: fetch more docs, filter in-memory
        const snapshot = await ordered.limit(5000).get();
        let logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const s = search.toLowerCase();
        logs = logs.filter(log =>
          (log.actorName  || "").toLowerCase().includes(s) ||
          (log.entityName || "").toLowerCase().includes(s) ||
          (log.action     || "").toLowerCase().includes(s) ||
          (log.entityType || "").toLowerCase().includes(s) ||
          (log.actorEmail || "").toLowerCase().includes(s)
        );
        ({ finalLogs, totalCount, hasMore } = paginateInMemory(logs));
      }
    } catch (primaryErr) {
      // ── Index-free fallback: fetch without orderBy/date-range, sort in memory ──
      console.warn('[Audit] Primary query failed, using index-free fallback:', primaryErr.message);

      // Try fetching both the org's data AND "defaultOrg" data (legacy logs before orgId was fixed)
      const orgIds = orgId !== "defaultOrg" ? [orgId, "defaultOrg"] : [orgId];
      let allLogs = [];

      for (const qOrgId of orgIds) {
        let fbq = firestore.collection("auditLogs")
          .where("organizationId", "==", qOrgId)
          .where("isDeleted",      "==", false)
          .select(...fields);

        if (entityType) fbq = fbq.where("entityType",  "==", entityType);
        if (action)     fbq = fbq.where("action",       "==", action);
        if (userId)     fbq = fbq.where("actorUserId",  "==", userId);

        try {
          const snap = await fbq.limit(10000).get();
          const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          allLogs.push(...docs);
        } catch (fbErr) {
          console.warn(`[Audit] Fallback query for orgId=${qOrgId} failed:`, fbErr.message);
        }
      }

      // Deduplicate by id
      const seen = new Set();
      allLogs = allLogs.filter(l => {
        if (seen.has(l.id)) return false;
        seen.add(l.id);
        return true;
      });

      // Date range filter in memory
      if (startDate) {
        const startISO = new Date(startDate).toISOString();
        allLogs = allLogs.filter(l => l.createdAt && l.createdAt >= startISO);
      }
      if (endDate) {
        const endISO = new Date(endDate + 'T23:59:59.999Z').toISOString();
        allLogs = allLogs.filter(l => l.createdAt && l.createdAt <= endISO);
      }

      // Search filter in memory
      if (search) {
        const s = search.toLowerCase();
        allLogs = allLogs.filter(l =>
          (l.actorName  || "").toLowerCase().includes(s) ||
          (l.entityName || "").toLowerCase().includes(s) ||
          (l.action     || "").toLowerCase().includes(s) ||
          (l.entityType || "").toLowerCase().includes(s) ||
          (l.actorEmail || "").toLowerCase().includes(s)
        );
      }

      // Sort newest first
      allLogs.sort((a, b) => {
        const ad = a.createdAt ? new Date(a.createdAt) : new Date(0);
        const bd = b.createdAt ? new Date(b.createdAt) : new Date(0);
        return bd - ad;
      });

      ({ finalLogs, totalCount, hasMore } = paginateInMemory(allLogs));
    }

    const pagination = {
      total:      totalCount,
      page:       pageNum,
      limit:      parsedLimit,
      totalPages: Math.ceil(totalCount / parsedLimit) || 1
    };

    if (finalLogs.length > 30) {
      const { streamPaginatedJson } = require("../../utils/streamResponse");
      return streamPaginatedJson(res, finalLogs, { hasMore, pagination });
    }

    return res.json({ success: true, data: finalLogs, hasMore, pagination });
  } catch (error) {
    console.error('[Audit] Query failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/audit-logs/:id — Single log detail
 */
router.get('/:id', auth, requireRoles('SUPER_ADMIN'), async (req, res) => {
  try {
    const doc = await firestore.collection("auditLogs").doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'Log not found' });
    }
    const log = { id: doc.id, ...doc.data() };
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
