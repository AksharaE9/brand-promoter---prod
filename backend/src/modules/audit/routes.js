const express = require('express');
const router = express.Router();
const prisma = require('../../config/db');
const { auth, requireRoles } = require('../../middleware/auth');

const formatLog = (log) => ({
  ...log,
  actor: {
    fullName: log.actorName  || 'System',
    email:    log.actorEmail || '',
    role:     log.actorRole  || 'Admin',
  },
  // Only show entityName if it's a real name — never show raw IDs
  entityName: log.entityName || 'N/A',
});


// GET /api/audit-logs — paginated, filtered
router.get('/', auth, requireRoles('SUPER_ADMIN'), async (req, res) => {
  try {
    const {
      limit = 50, page = 1,
      entityType, action, userId,
      startDate, endDate, search,
    } = req.query;

    const parsedLimit = Math.min(parseInt(limit) || 50, 200);
    const pageNum     = Math.max(1, parseInt(page) || 1);
    const offset      = (pageNum - 1) * parsedLimit;
    const orgId       = req.user.organizationId || 'defaultOrg';

    const where = {
      organizationId: orgId,
      isDeleted: false,
    };

    if (entityType) where.entityType = entityType;
    if (action)     where.action     = action;
    if (userId)     where.actorUserId = userId;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate)   where.createdAt.lte = new Date(endDate + 'T23:59:59.999Z');
    }

    let logs;
    let totalCount;

    if (search) {
      // Search: fetch more, filter in-memory
      const allLogs = await prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 5000,
      });
      const s = search.toLowerCase();
      const filtered = allLogs.filter(log =>
        (log.actorName  || '').toLowerCase().includes(s) ||
        (log.entityName || '').toLowerCase().includes(s) ||
        (log.action     || '').toLowerCase().includes(s) ||
        (log.entityType || '').toLowerCase().includes(s) ||
        (log.actorEmail || '').toLowerCase().includes(s)
      );
      totalCount = filtered.length;
      logs = filtered.slice(offset, offset + parsedLimit);
    } else {
      [logs, totalCount] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: offset,
          take: parsedLimit,
        }),
        prisma.auditLog.count({ where }),
      ]);
    }

    const finalLogs = logs.map(formatLog);
    const hasMore = offset + finalLogs.length < totalCount;
    const pagination = {
      total: totalCount,
      page: pageNum,
      limit: parsedLimit,
      totalPages: Math.ceil(totalCount / parsedLimit) || 1,
    };

    if (finalLogs.length > 30) {
      const { streamPaginatedJson } = require('../../utils/streamResponse');
      return streamPaginatedJson(res, finalLogs, { hasMore, pagination });
    }

    return res.json({ success: true, data: finalLogs, hasMore, pagination });
  } catch (error) {
    console.error('[Audit] Query failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/audit-logs/:id — single detail
router.get('/:id', auth, requireRoles('SUPER_ADMIN'), async (req, res) => {
  try {
    const log = await prisma.auditLog.findUnique({ where: { id: req.params.id } });
    if (!log) return res.status(404).json({ success: false, message: 'Log not found' });
    res.json({ success: true, data: formatLog(log) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
