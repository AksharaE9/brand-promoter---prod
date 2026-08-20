'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const prisma = require('../../config/db');
const { auth, requireRoles } = require('../../middleware/auth');
const { ApiError, asyncHandler } = require('../../utils/errors');
const { logAudit } = require('../../utils/audit');
const sse = require('../../utils/sse');
const { getCached, invalidate } = require('../../utils/cache');


const { parseSheetBuffer } = require('../../lib/sheetParser');
const {
  LEAD_IMPORT_SCHEMA,
  validateLeadRow,
  computeCompletionPercentage,
} = require('../../lib/leadImportSchema');
const { formatDateTime24h, getOrgTimeZone } = require('../../lib/datetimeServer');

const { MAX_UPLOAD_BYTES } = require('../../config/uploadLimits');

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

/** Initial 4 seed member names */
const INITIAL_SEED_MEMBERS = ['Madumathi', 'Vinay', 'Swanand', 'Rishika'];

/**
 * Ensures initial telecalling members are seeded on first load.
 */
async function ensureSeededMembers() {
  try {
    // Rename existing misspelled members if present in database
    await prisma.schedulingMember.updateMany({
      where: { name: 'Madomati' },
      data: { name: 'Madumathi' }
    });
    await prisma.schedulingMember.updateMany({
      where: { name: 'Swanan' },
      data: { name: 'Swanand' }
    });

    const count = await prisma.schedulingMember.count();
    if (count === 0) {
      await prisma.schedulingMember.createMany({
        data: INITIAL_SEED_MEMBERS.map((name) => ({ name, active: true })),
      });
      console.log('[Scheduling] Initial 4 telecalling members seeded successfully.');
    }
  } catch (err) {
    console.error('[Scheduling] Error seeding initial members:', err.message);
  }
}

// Automatically seed on module load
ensureSeededMembers();

/**
 * Get current server date string (YYYY-MM-DD) in org timezone.
 */
function getTodayString(tz = getOrgTimeZone()) {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now); // Output format: YYYY-MM-DD
  return dateStr;
}

/**
 * Resolve member record for authenticated user.
 */
async function resolveMemberForUser(userId) {
  if (!userId) return null;
  return await prisma.schedulingMember.findUnique({
    where: { userId },
  });
}

// Helper middleware to parse body for HTTP QUERY requests if the standard body-parser skipped it
const parseQueryBody = (req, res, next) => {
  if (req.method === 'QUERY' && (!req.body || Object.keys(req.body).length === 0)) {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        if (data) {
          req.body = JSON.parse(data);
        } else {
          req.body = {};
        }
        next();
      } catch (err) {
        res.status(400).json({ success: false, error: 'Invalid JSON body for QUERY request' });
      }
    });
  } else {
    next();
  }
};

const executeLeadsSearch = async (listIds, q, cursor, limit, res) => {
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const listIdInList = listIds.map(id => `'${id}'`).join(',');
  let sql = `SELECT id, "leadData" FROM scheduling_leads WHERE "listId" IN (${listIdInList})`;
  const params = [];
  if (q) {
    sql += ` AND ("leadData"->>'name' ILIKE $1 OR "leadData"->>'phone' ILIKE $1)`;
    params.push(`%${q}%`);
  }
  if (cursor) {
    sql += ` AND id > $${params.length + 1}`;
    params.push(cursor);
  }
  sql += ` ORDER BY id ASC LIMIT $${params.length + 1}`;
  params.push(safeLimit + 1);

  const items = await prisma.$queryRawUnsafe(sql, ...params);
  const hasMore = items.length > safeLimit;
  if (hasMore) {
    items.pop();
  }

  const nextCursor = hasMore ? items[items.length - 1].id : null;

  res.json({
    success: true,
    data: items.map(item => ({ id: item.id, leadData: typeof item.leadData === 'string' ? JSON.parse(item.leadData) : item.leadData })),
    nextCursor,
    hasMore
  });
};

const schedulingSearchHandler = async (req, res) => {
  const q = (req.body.q || '').trim();
  const filters = req.body.filters || {};
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.body.limit, 10) || 50));
  const cursor = req.body.cursor?.trim();

  let targetMemberId = filters.memberId;
  const requestedDate = filters.date || getTodayString();
  const targetDate = new Date(`${requestedDate}T00:00:00.000Z`);

  if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'RECRUITER') {
    const member = await resolveMemberForUser(req.user.id);
    if (!member) {
      return res.json({
        success: true,
        data: [],
        nextCursor: null,
        hasMore: false
      });
    }
    targetMemberId = member.id;
  }

  if (!targetMemberId) {
    const lists = await prisma.schedulingLeadList.findMany({
      where: { listDate: targetDate }
    });
    const listIds = lists.map(l => l.id);
    if (listIds.length === 0) {
      return res.json({ success: true, data: [], nextCursor: null, hasMore: false });
    }
    return await executeLeadsSearch(listIds, q, cursor, limit, res);
  } else {
    const list = await prisma.schedulingLeadList.findFirst({
      where: { memberId: targetMemberId, listDate: targetDate }
    });
    if (!list) {
      return res.json({ success: true, data: [], nextCursor: null, hasMore: false });
    }
    return await executeLeadsSearch([list.id], q, cursor, limit, res);
  }
};

// Scheduling search route with QUERY and POST support
router.all('/search', auth, parseQueryBody, asyncHandler(async (req, res) => {
  if (req.method === 'QUERY' || req.method === 'POST') {
    return await schedulingSearchHandler(req, res);
  }
  res.status(405).set('Allow', 'QUERY, POST').end();
}));

// ─────────────────────────────────────────────
// Member Management Endpoints (Admin)
// ─────────────────────────────────────────────

/**
 * GET /api/scheduling/members
 * Admin: List all members (active and inactive).
 */
router.get(
  '/members',
  auth,
  requireRoles('SUPER_ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    const members = await prisma.schedulingMember.findMany({
      include: {
        user: {
          select: { id: true, fullName: true, email: true, role: true },
        },
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });

    res.json({
      success: true,
      data: members,
    });
  })
);

/**
 * POST /api/scheduling/members
 * Admin: Create a new scheduling member.
 */
router.post(
  '/members',
  auth,
  requireRoles('SUPER_ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    const { name, userId } = req.body;
    if (!name || !name.trim()) {
      throw new ApiError(400, 'Member name is required');
    }

    if (userId) {
      const existingLink = await prisma.schedulingMember.findUnique({
        where: { userId },
      });
      if (existingLink) {
        throw new ApiError(409, 'User account is already linked to another scheduling member');
      }
    }

    const member = await prisma.schedulingMember.create({
      data: {
        name: name.trim(),
        userId: userId || null,
        active: true,
      },
      include: {
        user: {
          select: { id: true, fullName: true, email: true, role: true },
        },
      },
    });

    await logAudit({
      actorUserId: req.user.id,
      action: 'CREATE_SCHEDULING_MEMBER',
      entityType: 'SCHEDULING_MEMBER',
      entityId: member.id,
      newData: { name: member.name, userId: member.userId },
      ipAddress: req.ip,
    });

    res.status(201).json({
      success: true,
      data: member,
    });
  })
);

/**
 * PATCH /api/scheduling/members/:memberId
 * Admin: Update member name, link user account, or toggle active status.
 */
router.patch(
  '/members/:memberId',
  auth,
  requireRoles('SUPER_ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    const { memberId } = req.params;
    const { name, userId, active } = req.body;

    const existing = await prisma.schedulingMember.findUnique({
      where: { id: memberId },
    });
    if (!existing) {
      throw new ApiError(404, 'Scheduling member not found');
    }

    const updateData = {};
    if (name !== undefined && name.trim() !== '') {
      updateData.name = name.trim();
    }
    if (active !== undefined) {
      updateData.active = Boolean(active);
    }
    if (userId !== undefined) {
      if (userId && userId !== existing.userId) {
        const linked = await prisma.schedulingMember.findUnique({ where: { userId } });
        if (linked && linked.id !== memberId) {
          throw new ApiError(409, 'User account is already linked to another scheduling member');
        }
      }
      updateData.userId = userId || null;
    }

    const updated = await prisma.schedulingMember.update({
      where: { id: memberId },
      data: updateData,
      include: {
        user: { select: { id: true, fullName: true, email: true, role: true } },
      },
    });

    await logAudit({
      actorUserId: req.user.id,
      action: 'UPDATE_SCHEDULING_MEMBER',
      entityType: 'SCHEDULING_MEMBER',
      entityId: memberId,
      oldData: existing,
      newData: updated,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      data: updated,
    });
  })
);

/**
 * DELETE /api/scheduling/members/:memberId
 * Admin: Delete a scheduling member. Cascaded deletes are configured in the schema.
 */
router.delete(
  '/members/:memberId',
  auth,
  requireRoles('SUPER_ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    const { memberId } = req.params;

    const existing = await prisma.schedulingMember.findUnique({
      where: { id: memberId },
    });
    if (!existing) {
      throw new ApiError(404, 'Scheduling member not found');
    }

    await prisma.schedulingMember.delete({
      where: { id: memberId },
    });

    await logAudit({
      actorUserId: req.user.id,
      action: 'DELETE_SCHEDULING_MEMBER',
      entityType: 'SCHEDULING_MEMBER',
      entityId: memberId,
      oldData: { name: existing.name, userId: existing.userId },
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      message: 'Scheduling member deleted successfully',
    });
  })
);

// ─────────────────────────────────────────────
// Daily Lead List Import & Export Endpoints (Admin)
// ─────────────────────────────────────────────

/**
 * POST /api/scheduling/members/:memberId/lead-list
 * Admin: Upload multipart CSV/XLSX sheet for member + listDate (YYYY-MM-DD).
 * Re-importing replaces existing list & leads idempotently.
 */
router.post(
  '/members/:memberId/lead-list',
  auth,
  requireRoles('SUPER_ADMIN', 'RECRUITER'),
  memoryUpload.single('file'),
  asyncHandler(async (req, res) => {
    const { memberId } = req.params;
    const { listDate } = req.body;

    const userId = req.user?.id;
    if (userId) {
      const { pipelineJobStatusMap } = require('../../lib/streamingBulkUploadPipeline');
      for (const status of pipelineJobStatusMap.values()) {
        if (status.uploadedBy === userId && status.state === 'active') {
          return res.status(409).json({
            success: false,
            message: 'You already have a bulk upload in progress. Please wait for it to complete.'
          });
        }
      }
    }

    if (!req.file) {
      throw new ApiError(400, 'Lead list file is required (field: file)');
    }
    if (!listDate || !/^\d{4}-\d{2}-\d{2}$/.test(listDate)) {
      throw new ApiError(400, 'Valid listDate (YYYY-MM-DD) is required');
    }

    const member = await prisma.schedulingMember.findUnique({
      where: { id: memberId },
    });
    if (!member) {
      throw new ApiError(404, 'Scheduling member not found');
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
      throw new ApiError(415, 'Unsupported file type. Only .xlsx, .xls, and .csv files are allowed.');
    }

    const { rows: rawRows } = parseSheetBuffer(req.file.buffer);
    if (rawRows.length === 0) {
      throw new ApiError(400, 'Uploaded file contains no readable data rows');
    }

    const { normalizePhoneNumber } = require('../../lib/phoneNormalization');
    const validLeads = [];
    const errors = [];
    const seenPhones = new Map();

    rawRows.forEach((row) => {
      const result = validateLeadRow(row, LEAD_IMPORT_SCHEMA);
      if (result.valid) {
        const phoneNormalized = normalizePhoneNumber(result.leadData.phone);
        if (phoneNormalized && seenPhones.has(phoneNormalized)) {
          errors.push(`[Sheet: ${row._sheetName}, Row ${row._rowIndex}]: Duplicate phone: ${phoneNormalized} — duplicate of row ${seenPhones.get(phoneNormalized)} in the file`);
          return;
        }
        if (phoneNormalized) {
          seenPhones.set(phoneNormalized, row._rowIndex);
        }
        validLeads.push(result.leadData);
      } else {
        const sheetInfo = `[Sheet: ${row._sheetName}, Row ${row._rowIndex}]`;
        errors.push(`${sheetInfo}: ${result.errors.join(', ')}`);
      }
    });

    if (validLeads.length === 0) {
      throw new ApiError(400, `Import failed: No valid rows passed validation. ${errors[0] || ''}`);
    }

    const targetDate = new Date(`${listDate}T00:00:00.000Z`);

    const existingList = await prisma.schedulingLeadList.findFirst({
      where: { memberId, listDate: targetDate },
    });

    // Execute in transaction: create/update lead list + replace lead rows
    const resultList = await prisma.$transaction(async (tx) => {
      let list;
      if (existingList) {
        list = await tx.schedulingLeadList.update({
          where: { id: existingList.id },
          data: {
            importedById: req.user.id,
            importedAt: new Date(),
            totalLeads: validLeads.length,
            sourceFilename: req.file.originalname,
          },
        });
      } else {
        list = await tx.schedulingLeadList.create({
          data: {
            memberId,
            listDate: targetDate,
            importedById: req.user.id,
            totalLeads: validLeads.length,
            sourceFilename: req.file.originalname,
          },
        });
      }

      // Clear existing leads for this list
      await tx.schedulingLead.deleteMany({
        where: { listId: list.id },
      });

      // Create new lead records
      await tx.schedulingLead.createMany({
        data: validLeads.map((leadData) => ({
          listId: list.id,
          leadData,
          phoneNormalized: normalizePhoneNumber(leadData.phone),
        })),
      });

      return list;
    });

    await logAudit({
      actorUserId: req.user.id,
      action: 'IMPORT_LEAD_LIST',
      entityType: 'SCHEDULING_LEAD_LIST',
      entityId: resultList.id,
      newData: { memberId, listDate, totalLeads: validLeads.length, filename: req.file.originalname },
      ipAddress: req.ip,
    });

    const orgId = req.user.organizationId || 'defaultOrg';
    sse.broadcastToOrg(orgId, 'SCHEDULING_LEAD_LIST_UPDATED', { memberId, listDate, count: validLeads.length });
    await invalidate(`scheduling:overview:${listDate}`);



    res.status(200).json({
      success: true,
      message: `Successfully imported ${validLeads.length} leads for ${member.name} on ${listDate}`,
      data: {
        listId: resultList.id,
        totalLeads: validLeads.length,
        skippedCount: errors.length,
        errors,
      },
    });
  })
);

/**
 * GET /api/scheduling/members/:memberId/lead-list/export?date=YYYY-MM-DD
 * Admin: Export lead list for a member on a specific date as CSV.
 */
router.get(
  '/members/:memberId/lead-list/export',
  auth,
  requireRoles('SUPER_ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    const { memberId } = req.params;
    const { date } = req.query;

    const listDate = date || getTodayString();
    const targetDate = new Date(`${listDate}T00:00:00.000Z`);

    const member = await prisma.schedulingMember.findUnique({
      where: { id: memberId },
    });
    if (!member) {
      throw new ApiError(404, 'Scheduling member not found');
    }

    const leadList = await prisma.schedulingLeadList.findFirst({
      where: { memberId, listDate: targetDate },
      include: { leads: true },
    });

    if (!leadList || leadList.leads.length === 0) {
      throw new ApiError(404, `No lead list found for ${member.name} on ${listDate}`);
    }

    // Dynamic headers based on LEAD_IMPORT_SCHEMA + extra leadData keys
    const headersSet = new Set(LEAD_IMPORT_SCHEMA.map((s) => s.key));
    leadList.leads.forEach((l) => {
      if (l.leadData && typeof l.leadData === 'object') {
        Object.keys(l.leadData).forEach((k) => headersSet.add(k));
      }
    });
    const headers = Array.from(headersSet);

    // Escape CSV values
    const escapeCsv = (val) => {
      if (val === undefined || val === null) return '';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    let csvContent = headers.map(escapeCsv).join(',') + '\n';
    leadList.leads.forEach((l) => {
      const data = l.leadData || {};
      const rowVals = headers.map((h) => escapeCsv(data[h] || ''));
      csvContent += rowVals.join(',') + '\n';
    });

    const safeFilename = `${member.name.replace(/[^a-zA-Z0-9]/g, '_')}_leads_${listDate}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.send(csvContent);
  })
);

// ─────────────────────────────────────────────
// Member View: Today's Read-Only Lead List
// ─────────────────────────────────────────────

/**
 * GET /api/scheduling/my-list?date=YYYY-MM-DD
 * Member/Admin: Fetch read-only lead list for current authenticated member (or memberId query for admin).
 */
router.get(
  '/my-list',
  auth,
  asyncHandler(async (req, res) => {
    let targetMemberId = req.query.memberId;
    const requestedDate = req.query.date || getTodayString();
    const targetDate = new Date(`${requestedDate}T00:00:00.000Z`);

    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'RECRUITER') {
      const member = await resolveMemberForUser(req.user.id);
      if (!member) {
        return res.json({
          success: true,
          message: 'No scheduling member linked to this user account',
          data: null,
        });
      }
      targetMemberId = member.id;
    } else if (!targetMemberId) {
      const member = await resolveMemberForUser(req.user.id);
      if (member) {
        targetMemberId = member.id;
      }
    }

    if (!targetMemberId) {
      return res.json({
        success: true,
        message: 'No scheduling member linked to this user account',
        data: null,
      });
    }

    const leadList = await prisma.schedulingLeadList.findFirst({
      where: { memberId: targetMemberId, listDate: targetDate },
      include: {
        member: { select: { id: true, name: true, active: true } },
        leads: { select: { id: true, leadData: true }, take: 100 },
      },
    });

    if (!leadList) {
      return res.json({
        success: true,
        message: 'No list assigned for today',
        data: null,
      });
    }

    res.json({
      success: true,
      data: leadList,
    });
  })
);

// ─────────────────────────────────────────────
// Daily Work Done Report Endpoints
// ─────────────────────────────────────────────

/**
 * POST /api/scheduling/my-report
 * Member/Admin: Submit or edit today's work-done report.
 */
router.post(
  '/my-report',
  auth,
  asyncHandler(async (req, res) => {
    const {
      callsDone,
      callsDidntPick,
      callsPicked,
      scheduledEntries,
      updatedInAts,
      updatedInMail,
      date,
      memberId: requestedMemberId,
    } = req.body;

    let targetMemberId = requestedMemberId;
    if (!targetMemberId || (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'RECRUITER')) {
      const member = await resolveMemberForUser(req.user.id);
      if (!member) {
        throw new ApiError(403, 'Your user account is not linked to an active scheduling member');
      }
      targetMemberId = member.id;
    }

    const reportDateStr = date || getTodayString();
    const targetDate = new Date(`${reportDateStr}T00:00:00.000Z`);

    const cDone = Math.max(0, parseInt(callsDone, 10) || 0);
    const cDidntPick = Math.max(0, parseInt(callsDidntPick, 10) || 0);
    const cPicked = Math.max(0, parseInt(callsPicked, 10) || 0);
    const sEntries = Math.max(0, parseInt(scheduledEntries, 10) || 0);
    const uAts = Math.max(0, parseInt(updatedInAts, 10) || 0);
    const uMail = Math.max(0, parseInt(updatedInMail, 10) || 0);

    let warning = null;
    if (cPicked + cDidntPick !== cDone) {
      warning = `Soft warning: Picked (${cPicked}) + Didn't Pick (${cDidntPick}) = ${cPicked + cDidntPick}, which does not match Total Calls Done (${cDone}).`;
    }

    const existingReport = await prisma.schedulingDailyReport.findFirst({
      where: { memberId: targetMemberId, reportDate: targetDate },
    });

    let report;
    if (existingReport) {
      report = await prisma.schedulingDailyReport.update({
        where: { id: existingReport.id },
        data: {
          callsDone: cDone,
          callsDidntPick: cDidntPick,
          callsPicked: cPicked,
          scheduledEntries: sEntries,
          updatedInAts: uAts,
          updatedInMail: uMail,
          updatedAt: new Date(),
        },
        include: { member: { select: { id: true, name: true } } },
      });
    } else {
      report = await prisma.schedulingDailyReport.create({
        data: {
          memberId: targetMemberId,
          reportDate: targetDate,
          callsDone: cDone,
          callsDidntPick: cDidntPick,
          callsPicked: cPicked,
          scheduledEntries: sEntries,
          updatedInAts: uAts,
          updatedInMail: uMail,
        },
        include: { member: { select: { id: true, name: true } } },
      });
    }

    await logAudit({
      actorUserId: req.user.id,
      action: 'SUBMIT_WORK_DONE_REPORT',
      entityType: 'SCHEDULING_DAILY_REPORT',
      entityId: report.id,
      newData: { targetMemberId, reportDateStr, callsDone: cDone },
      ipAddress: req.ip,
    });

    const orgId = req.user.organizationId || 'defaultOrg';
    sse.broadcastToOrg(orgId, 'SCHEDULING_REPORT_SUBMITTED', { memberId: targetMemberId, reportDate: reportDateStr });
    await invalidate(`scheduling:overview:${reportDateStr}`);



    res.status(200).json({
      success: true,
      message: 'Work done report submitted successfully',
      warning,
      data: report,
    });
  })
);

/**
 * GET /api/scheduling/my-report?date=YYYY-MM-DD
 * Member/Admin: Get work-done report for member on date.
 */
router.get(
  '/my-report',
  auth,
  asyncHandler(async (req, res) => {
    let targetMemberId = req.query.memberId;
    const requestedDate = req.query.date || getTodayString();
    const targetDate = new Date(`${requestedDate}T00:00:00.000Z`);

    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'RECRUITER') {
      const member = await resolveMemberForUser(req.user.id);
      if (!member) {
        return res.json({
          success: true,
          data: null,
        });
      }
      targetMemberId = member.id;
    } else if (!targetMemberId) {
      const member = await resolveMemberForUser(req.user.id);
      if (member) {
        targetMemberId = member.id;
      }
    }

    if (!targetMemberId) {
      return res.json({
        success: true,
        data: null,
      });
    }

    const report = await prisma.schedulingDailyReport.findFirst({
      where: { memberId: targetMemberId, reportDate: targetDate },
      include: { member: { select: { id: true, name: true } } },
    });

    res.json({
      success: true,
      data: report || null,
    });
  })
);

// ─────────────────────────────────────────────
// Member Daily File Attachments Endpoints
// ─────────────────────────────────────────────

/**
 * POST /api/scheduling/members/:memberId/files
 * Admin or Member: Upload a file attachment for a member for a given date.
 */
router.post(
  '/members/:memberId/files',
  auth,
  memoryUpload.single('file'),
  asyncHandler(async (req, res) => {
    const { memberId } = req.params;
    const { note, date } = req.body;

    if (!req.file) {
      throw new ApiError(400, 'File attachment is required (field: file)');
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!['.csv', '.xlsx', '.xls'].includes(ext)) {
      throw new ApiError(415, 'Only CSV and Excel files are allowed for scheduling attachments.');
    }

    const member = await prisma.schedulingMember.findUnique({
      where: { id: memberId },
    });
    if (!member) {
      throw new ApiError(404, 'Scheduling member not found');
    }

    // Permission check: admin OR the linked user themselves
    const isAdmin = req.user.role === 'SUPER_ADMIN' || req.user.role === 'RECRUITER';
    if (!isAdmin && member.userId !== req.user.id) {
      throw new ApiError(403, 'Forbidden: You cannot upload files for this telecaller');
    }

    const { uploadFileToCloudinary } = require('../../config/cloudinary');
    const dest = `scheduling-files/${Date.now()}_${req.file.originalname}`;
    const fileUrl = await uploadFileToCloudinary(req.file.buffer, dest, req.file.mimetype);
    if (!fileUrl) {
      throw new ApiError(500, 'Failed to upload file to storage');
    }

    const targetDateStr = date || req.query.date || getTodayString();
    const forDate = new Date(`${targetDateStr}T00:00:00.000Z`);

    const attachedFile = await prisma.schedulingMemberFile.create({
      data: {
        memberId,
        forDate,
        fileUrl,
        note: note || null,
        uploadedById: req.user.id,
      },
      include: {
        uploadedBy: { select: { id: true, fullName: true } },
      },
    });

    // Invalidate dashboard overview cache
    const cacheKey = `scheduling:overview:${targetDateStr}`;
    await invalidate(cacheKey).catch(() => {});

    // Broadcast SSE event
    const orgId = req.user.organizationId || 'defaultOrg';
    sse.broadcastToOrg(orgId, 'SCHEDULING_MEMBER_FILE_ADDED', { memberId, forDate: targetDateStr });

    res.status(201).json({
      success: true,
      data: attachedFile,
    });
  })
);

// ─────────────────────────────────────────────
// Admin Overview Dashboard Endpoint
// ─────────────────────────────────────────────

/**
 * GET /api/scheduling/admin/overview?date=YYYY-MM-DD
 * Admin: Overview across all active telecalling members for specified date.
 */
router.get(
  '/admin/overview',
  auth,
  requireRoles('SUPER_ADMIN', 'RECRUITER'),
  asyncHandler(async (req, res) => {
    const targetDateStr = req.query.date || getTodayString();
    const skipCache = req.query._t || req.query.fresh ? true : false;
    const cacheKey = `scheduling:overview:${targetDateStr}`;

    if (skipCache) {
      await invalidate(cacheKey);
    }

    const overview = await getCached(cacheKey, async () => {
      const targetDate = new Date(`${targetDateStr}T00:00:00.000Z`);

      const members = await prisma.schedulingMember.findMany({
        where: { active: true },
        include: {
          user: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { name: 'asc' },
      });

      const memberIds = members.map((m) => m.id);

      const [leadLists, dailyReports, memberFiles] = await Promise.all([
        prisma.schedulingLeadList.findMany({
          where: {
            listDate: targetDate,
            memberId: { in: memberIds },
          },
        }),
        prisma.schedulingDailyReport.findMany({
          where: {
            reportDate: targetDate,
            memberId: { in: memberIds },
          },
        }),
        prisma.schedulingMemberFile.findMany({
          where: {
            forDate: targetDate,
            memberId: { in: memberIds },
          },
          include: {
            uploadedBy: { select: { id: true, fullName: true } },
          },
        })
      ]);

      const listMap = new Map(leadLists.map((l) => [l.memberId, l]));
      const reportMap = new Map(dailyReports.map((r) => [r.memberId, r]));
      const filesMap = new Map();
      memberFiles.forEach((f) => {
        if (!filesMap.has(f.memberId)) {
          filesMap.set(f.memberId, []);
        }
        filesMap.get(f.memberId).push(f);
      });

      return members.map((m) => {
        const list = listMap.get(m.id);
        const report = reportMap.get(m.id);
        const files = filesMap.get(m.id) || [];

        const totalLeads = list ? list.totalLeads : 0;
        const callsDone = report ? report.callsDone : 0;
        const completionPercentage = computeCompletionPercentage(callsDone, totalLeads);

        return {
          memberId: m.id,
          memberName: m.name,
          userId: m.userId,
          linkedUser: m.user,
          active: m.active,
          listUploaded: Boolean(list),
          totalLeads,
          sourceFilename: list ? list.sourceFilename : null,
          reportSubmitted: Boolean(report),
          callsDone,
          completionPercentage,
          report: report || null,
          files,
        };
      });
    }, 300000); // 5 min TTL



    res.json({
      success: true,
      date: targetDateStr,
      data: overview,
    });
  })
);

/**
 * Helper to retrieve a scheduling member and verify access permissions.
 * - SUPER_ADMIN and ADMIN have access to all.
 * - A member has access only to their own profile (verified via userId linkage).
 * - RECRUITER (and other roles) are forbidden unless it is their own profile.
 */
async function getAndAuthorizeMember(memberId, user) {
  const member = await prisma.schedulingMember.findUnique({
    where: { id: memberId },
    include: {
      user: {
        select: { id: true, fullName: true, email: true, role: true, status: true },
      },
    },
  });

  if (!member) {
    throw new ApiError(404, 'Scheduling member not found');
  }

  const isOwnProfile = member.userId && user.id === member.userId;
  const hasAdminAccess = user.role === 'SUPER_ADMIN' || user.role === 'RECRUITER' || user.role === 'ADMIN';

  if (!isOwnProfile && !hasAdminAccess) {
    throw new ApiError(403, 'Forbidden: You do not have permission to access this member profile');
  }

  return member;
}

/**
 * GET /api/scheduling/members/:memberId
 * Get member profile header details.
 */
router.get(
  '/members/:memberId',
  auth,
  asyncHandler(async (req, res) => {
    const { memberId } = req.params;
    const member = await getAndAuthorizeMember(memberId, req.user);

    res.json({
      success: true,
      data: {
        id: member.id,
        name: member.name,
        active: member.active,
        createdAt: member.createdAt,
        userId: member.userId,
        linkedUser: member.user ? {
          id: member.user.id,
          fullName: member.user.fullName,
          email: member.user.email,
          role: member.user.role,
          status: member.user.status,
        } : null,
      },
    });
  })
);

/**
 * GET /api/scheduling/members/:memberId/files
 * Fetch all files uploaded for member, grouped by date.
 */
router.get(
  '/members/:memberId/files',
  auth,
  asyncHandler(async (req, res) => {
    const { memberId } = req.params;
    await getAndAuthorizeMember(memberId, req.user);

    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const cursorStr = req.query.cursor;
    const { from, to } = req.query;

    let where = { memberId };

    if (from || to) {
      where.forDate = {};
      if (from) {
        where.forDate.gte = new Date(`${from}T00:00:00.000Z`);
      }
      if (to) {
        where.forDate.lte = new Date(`${to}T23:59:59.999Z`);
      }
    }

    if (cursorStr) {
      try {
        const decoded = JSON.parse(Buffer.from(cursorStr, 'base64').toString('ascii'));
        const { forDate, createdAt, id } = decoded;
        where = {
          ...where,
          OR: [
            {
              forDate: { lt: new Date(forDate) }
            },
            {
              forDate: new Date(forDate),
              createdAt: { lt: new Date(createdAt) }
            },
            {
              forDate: new Date(forDate),
              createdAt: new Date(createdAt),
              id: { lt: id }
            }
          ]
        };
      } catch (err) {
        throw new ApiError(400, 'Invalid cursor');
      }
    }

    const files = await prisma.schedulingMemberFile.findMany({
      where,
      take: limit + 1,
      orderBy: [
        { forDate: 'desc' },
        { createdAt: 'desc' },
        { id: 'desc' }
      ],
      include: {
        uploadedBy: { select: { id: true, fullName: true } }
      }
    });

    const hasMore = files.length > limit;
    if (hasMore) {
      files.pop();
    }

    let nextCursor = null;
    if (hasMore && files.length > 0) {
      const lastItem = files[files.length - 1];
      nextCursor = Buffer.from(JSON.stringify({
        forDate: lastItem.forDate.toISOString(),
        createdAt: lastItem.createdAt.toISOString(),
        id: lastItem.id
      })).toString('base64');
    }

    // Group files by date (YYYY-MM-DD) server-side
    const grouped = [];
    const groupMap = {};

    for (const file of files) {
      const dateStr = file.forDate.toISOString().split('T')[0];
      if (!groupMap[dateStr]) {
        groupMap[dateStr] = [];
        grouped.push({
          date: dateStr,
          files: groupMap[dateStr]
        });
      }
      groupMap[dateStr].push({
        id: file.id,
        filename: file.fileUrl.split('/').pop() || 'file',
        fileUrl: file.fileUrl,
        uploaded_by: file.uploadedBy?.fullName || 'User',
        created_at: file.createdAt,
        note: file.note
      });
    }

    res.json({
      success: true,
      data: grouped,
      nextCursor,
      hasMore
    });
  })
);

/**
 * GET /api/scheduling/members/:memberId/lead-lists
 * Fetch lead lists imported for this member.
 */
router.get(
  '/members/:memberId/lead-lists',
  auth,
  asyncHandler(async (req, res) => {
    const { memberId } = req.params;
    await getAndAuthorizeMember(memberId, req.user);

    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const cursorStr = req.query.cursor;
    const { from, to } = req.query;

    let where = { memberId };

    if (from || to) {
      where.listDate = {};
      if (from) {
        where.listDate.gte = new Date(`${from}T00:00:00.000Z`);
      }
      if (to) {
        where.listDate.lte = new Date(`${to}T23:59:59.999Z`);
      }
    }

    if (cursorStr) {
      try {
        const decoded = JSON.parse(Buffer.from(cursorStr, 'base64').toString('ascii'));
        const { listDate, id } = decoded;
        where = {
          ...where,
          OR: [
            {
              listDate: { lt: new Date(listDate) }
            },
            {
              listDate: new Date(listDate),
              id: { lt: id }
            }
          ]
        };
      } catch (err) {
        throw new ApiError(400, 'Invalid cursor');
      }
    }

    const leadLists = await prisma.schedulingLeadList.findMany({
      where,
      take: limit + 1,
      orderBy: [
        { listDate: 'desc' },
        { id: 'desc' }
      ],
      include: {
        importedBy: { select: { fullName: true } }
      }
    });

    const hasMore = leadLists.length > limit;
    if (hasMore) {
      leadLists.pop();
    }

    let nextCursor = null;
    if (hasMore && leadLists.length > 0) {
      const lastItem = leadLists[leadLists.length - 1];
      nextCursor = Buffer.from(JSON.stringify({
        listDate: lastItem.listDate.toISOString(),
        id: lastItem.id
      })).toString('base64');
    }

    res.json({
      success: true,
      data: leadLists.map(list => ({
        id: list.id,
        list_date: list.listDate.toISOString().split('T')[0],
        total_leads: list.totalLeads,
        imported_by: list.importedBy?.fullName || 'System',
        imported_at: list.importedAt,
        source_filename: list.sourceFilename
      })),
      nextCursor,
      hasMore
    });
  })
);

/**
 * GET /api/scheduling/members/:memberId/reports
 * Fetch daily work-done reports with joined completion percentage.
 */
router.get(
  '/members/:memberId/reports',
  auth,
  asyncHandler(async (req, res) => {
    const { memberId } = req.params;
    await getAndAuthorizeMember(memberId, req.user);

    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const cursorStr = req.query.cursor;
    const { from, to } = req.query;

    const params = [memberId];
    let sql = `
      SELECT
        dr.id,
        dr."memberId",
        dr."reportDate",
        dr."callsDone",
        dr."callsDidntPick",
        dr."callsPicked",
        dr."scheduledEntries",
        dr."updatedInAts",
        dr."updatedInMail",
        dr."submittedAt",
        COALESCE(ll."totalLeads", 0) AS "totalLeadsForDate",
        CASE
          WHEN COALESCE(ll."totalLeads", 0) = 0 THEN 0
          ELSE LEAST(100, ROUND((dr."callsDone"::float / ll."totalLeads"::float) * 100)::integer)
        END AS "completionPercentage"
      FROM scheduling_daily_reports dr
      LEFT JOIN scheduling_lead_lists ll
        ON dr."memberId" = ll."memberId" AND dr."reportDate" = ll."listDate"
      WHERE dr."memberId" = $1
    `;

    if (from) {
      params.push(new Date(`${from}T00:00:00.000Z`));
      sql += ` AND dr."reportDate" >= $${params.length}`;
    }
    if (to) {
      params.push(new Date(`${to}T23:59:59.999Z`));
      sql += ` AND dr."reportDate" <= $${params.length}`;
    }

    if (cursorStr) {
      try {
        const decoded = JSON.parse(Buffer.from(cursorStr, 'base64').toString('ascii'));
        const { reportDate, id } = decoded;
        params.push(new Date(reportDate));
        const paramIndexDate = params.length;
        params.push(id);
        const paramIndexId = params.length;
        sql += ` AND (dr."reportDate" < $${paramIndexDate} OR (dr."reportDate" = $${paramIndexDate} AND dr.id < $${paramIndexId}))`;
      } catch (err) {
        throw new ApiError(400, 'Invalid cursor');
      }
    }

    sql += ` ORDER BY dr."reportDate" DESC, dr.id DESC LIMIT $${params.length + 1}`;
    params.push(limit + 1);

    const reports = await prisma.$queryRawUnsafe(sql, ...params);

    const hasMore = reports.length > limit;
    if (hasMore) {
      reports.pop();
    }

    let nextCursor = null;
    if (hasMore && reports.length > 0) {
      const lastItem = reports[reports.length - 1];
      nextCursor = Buffer.from(JSON.stringify({
        reportDate: lastItem.reportDate,
        id: lastItem.id
      })).toString('base64');
    }

    res.json({
      success: true,
      data: reports.map(r => ({
        id: r.id,
        report_date: new Date(r.reportDate).toISOString().split('T')[0],
        calls_done: r.callsDone,
        calls_didnt_pick: r.callsDidntPick,
        calls_picked: r.callsPicked,
        scheduled_entries: r.scheduledEntries,
        updated_in_ats: r.updatedInAts,
        updated_in_mail: r.updatedInMail,
        submitted_at: r.submittedAt,
        total_leads_for_date: Number(r.totalLeadsForDate),
        completion_percentage: Number(r.completionPercentage)
      })),
      nextCursor,
      hasMore
    });
  })
);

/**
 * GET /api/scheduling/members/:memberId/files/:fileId/download
 * Download a member file attachment.
 */
router.get(
  '/members/:memberId/files/:fileId/download',
  auth,
  asyncHandler(async (req, res) => {
    const { memberId, fileId } = req.params;
    await getAndAuthorizeMember(memberId, req.user);

    const file = await prisma.schedulingMemberFile.findUnique({
      where: { id: fileId }
    });

    if (!file || file.memberId !== memberId) {
      throw new ApiError(404, 'File attachment not found');
    }

    const { fileUrl } = file;
    const fileName = fileUrl.split('/').pop() || 'attachment';

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    const path = require('path');
    const fs = require('fs');

    if (fileUrl.startsWith('/uploads/')) {
      const relativeKey = fileUrl.replace(/^\//, '');
      const localPath = path.join(__dirname, '..', '..', '..', relativeKey);
      if (!fs.existsSync(localPath)) {
        throw new ApiError(404, 'File not found on local storage');
      }
      fs.createReadStream(localPath).pipe(res);
    } else if (fileUrl.startsWith('http')) {
      const https = require('https');
      https.get(fileUrl, (cloudinaryRes) => {
        if (cloudinaryRes.statusCode >= 400) {
          return res.status(cloudinaryRes.statusCode).json({ success: false, message: 'Failed to download from storage' });
        }
        cloudinaryRes.pipe(res);
      }).on('error', (err) => {
        console.error('[Scheduling] Cloudinary stream error:', err.message);
        res.status(500).json({ success: false, message: 'Error streaming file' });
      });
    } else {
      throw new ApiError(400, 'Invalid file URL');
    }
  })
);

module.exports = router;

