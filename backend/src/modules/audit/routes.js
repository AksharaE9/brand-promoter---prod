const express = require('express');
const router = express.Router();
const prisma = require('../../config/db');
const { auth, requireRoles } = require('../../middleware/auth');

const formatLog = (log) => {
  const actorName = log.actorName || 'System';
  const actionPretty = log.action ? log.action.replace(/_/g, ' ') : '';
  const entityNameStr = log.entityName && log.entityName !== 'N/A' && log.entityName !== 'null' ? ` (${log.entityName})` : '';
  
  let description = `${actorName} performed ${actionPretty} on ${log.entityType}${entityNameStr}`;
  if (log.action === 'bulk_upload_completed') {
    const data = typeof log.newData === 'string' ? JSON.parse(log.newData) : (log.newData || {});
    const dateStr = new Date(log.createdAt).toISOString().split('T')[0];
    const flowLabel = data.flow_type === 'candidate' ? 'candidates' :
                      data.flow_type === 'feedback' ? 'feedbacks' :
                      data.flow_type === 'interview_schedule' ? 'interviews' :
                      data.flow_type === 'lead_list' ? 'leads' : 'records';
    description = `${actorName} bulk-uploaded ${data.total_rows || 0} ${flowLabel} on ${dateStr} (${data.created || 0} created, ${data.duplicates || 0} duplicates, ${data.errors || 0} errors)`;
  }

  return {
    ...log,
    actor: {
      fullName: actorName,
      email:    log.actorEmail || '',
      role:     log.actorRole  || 'Admin',
    },
    // Only show entityName if it's a real name — never show raw IDs
    entityName: log.entityName || 'N/A',
    description,
  };
};



const handleSearch = async (req, res) => {
  try {
    const payload = {
      ...req.query,
      ...req.body
    };
    const {
      limit = 20,
      cursor, // Opaque next_cursor base64 token
      entityType,
      action,
      userId,
      startDate,
      endDate,
      search,
      interviewerName
    } = payload;

    const parsedLimit = Math.min(parseInt(limit) || 20, 200);
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

    // ── Keyset (Cursor) Pagination ──────────────────────────────────────────
    let cursorFilter = {};
    if (cursor) {
      const decoded = Buffer.from(cursor, 'base64').toString('utf8');
      const [createdAtStr, id] = decoded.split('|');
      if (createdAtStr && id) {
        const lastCreatedAt = new Date(createdAtStr);
        cursorFilter = {
          OR: [
            {
              createdAt: { lt: lastCreatedAt }
            },
            {
              createdAt: { equals: lastCreatedAt },
              id: { lt: id }
            }
          ]
        };
      }
    }

    // Merge cursor filter into main where clause
    const finalWhere = cursorFilter.OR 
      ? { AND: [where, { OR: cursorFilter.OR }] }
      : where;

    // ── Interviewer filter ──────────────────────────────────────────────────
    if (interviewerName && interviewerName.trim()) {
      const nameSearch = interviewerName.trim().toLowerCase();

      // Find matching interview IDs using a case-insensitive substring match on the interviewerNames
      const matchingInterviews = await prisma.interview.findMany({
        where: {
          organizationId: orgId,
          interviewerNames: {
            contains: nameSearch,
            mode: 'insensitive',
          },
        },
        select: { id: true },
      });

      const matchingIds = matchingInterviews.map((iv) => iv.id);

      if (matchingIds.length === 0) {
        res.setHeader('Accept-Query', 'application/json');
        return res.json({
          success: true,
          data: [],
          next_cursor: null,
          total_estimate: 0,
          pagination: { total: 0, page: 1, limit: parsedLimit, totalPages: 1 }
        });
      }

      // Force entityType to INTERVIEW and restrict by entity IDs
      if (finalWhere.AND) {
        finalWhere.AND.push({ entityType: 'INTERVIEW' });
        finalWhere.AND.push({ entityId: { in: matchingIds } });
      } else {
        finalWhere.entityType = 'INTERVIEW';
        finalWhere.entityId   = { in: matchingIds };
      }
    }

    // ── Free-Text Search Filter (Database-Backed via trigram indexes) ────────
    if (search && search.trim()) {
      const s = search.trim();
      const searchConditions = {
        OR: [
          { actorName: { contains: s, mode: 'insensitive' } },
          { entityName: { contains: s, mode: 'insensitive' } },
          { action: { contains: s, mode: 'insensitive' } },
          { entityType: { contains: s, mode: 'insensitive' } },
          { actorEmail: { contains: s, mode: 'insensitive' } },
        ]
      };

      if (finalWhere.AND) {
        finalWhere.AND.push(searchConditions);
      } else {
        // Convert to AND query
        const originalKeys = Object.keys(finalWhere);
        const originalConditions = {};
        originalKeys.forEach(k => {
          originalConditions[k] = finalWhere[k];
          delete finalWhere[k];
        });
        finalWhere.AND = [originalConditions, searchConditions];
      }
    }

    // ── Fetch Audit Logs ────────────────────────────────────────────────────
    const logs = await prisma.auditLog.findMany({
      where: finalWhere,
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' }
      ],
      take: parsedLimit + 1,
    });

    const hasMore = logs.length > parsedLimit;
    const paginatedLogs = hasMore ? logs.slice(0, parsedLimit) : logs;

    let nextCursor = null;
    if (hasMore && paginatedLogs.length > 0) {
      const lastLog = paginatedLogs[paginatedLogs.length - 1];
      nextCursor = Buffer.from(`${lastLog.createdAt.toISOString()}|${lastLog.id}`).toString('base64');
    }

    // ── Estimated Total Count ───────────────────────────────────────────────
    let totalEstimate = 0;
    const hasFilters = entityType || action || userId || startDate || endDate || search || interviewerName;

    if (!hasFilters) {
      // Query Postgres catalog for approximate row count of audit_logs table
      const countResult = await prisma.$queryRawUnsafe(
        "SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname = 'audit_logs'"
      );
      totalEstimate = Number(countResult?.[0]?.estimate || 0);
    } else {
      // With filters, execute standard COUNT
      totalEstimate = await prisma.auditLog.count({ where: finalWhere });
    }

    const finalLogs = paginatedLogs.map(formatLog);

    res.setHeader('Accept-Query', 'application/json');

    // For compatibility with frontend pagination structure (totalCount / totalPages):
    const pagination = {
      total: totalEstimate,
      totalPages: Math.ceil(totalEstimate / parsedLimit) || 1,
      limit: parsedLimit,
    };

    if (finalLogs.length > 30) {
      const { streamPaginatedJson } = require('../../utils/streamResponse');
      return streamPaginatedJson(res, finalLogs, { hasMore, next_cursor: nextCursor, pagination });
    }

    return res.json({
      success: true,
      data: finalLogs,
      hasMore,
      next_cursor: nextCursor,
      pagination
    });
  } catch (error) {
    console.error('[Audit] Query failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Route handlers supporting standard GET, standard QUERY, and fallback POST /search
router.all('/', auth, requireRoles('SUPER_ADMIN'), async (req, res, next) => {
  if (req.method === 'QUERY' || req.method === 'GET') {
    return handleSearch(req, res);
  }
  next();
});

router.post('/search', auth, requireRoles('SUPER_ADMIN'), handleSearch);

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
