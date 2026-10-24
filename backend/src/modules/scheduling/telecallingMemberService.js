'use strict';

const prisma = require('../../config/db');
const { ApiError } = require('../../utils/errors');
const { invalidatePattern } = require('../../utils/cache');

/**
 * Returns UTC Date objects for start of date D in IST (00:00:00+05:30)
 * and start of date D+1 in IST (00:00:00+05:30).
 *
 * Example for 2026-10-24:
 * startOfD: 2026-10-23T18:30:00.000Z
 * endOfD:   2026-10-24T18:30:00.000Z
 */
function getIstDayBounds(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return null;
  }
  const startOfD = new Date(`${dateStr}T00:00:00.000+05:30`);
  const [y, m, d] = dateStr.split('-').map(Number);
  const nextUtc = new Date(Date.UTC(y, m - 1, d + 1));
  const nextDateStr = nextUtc.toISOString().slice(0, 10);
  const endOfD = new Date(`${nextDateStr}T00:00:00.000+05:30`);
  return { startOfD, endOfD };
}

/**
 * Clean member name: trims and collapses whitespace.
 */
function cleanMemberName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.trim().replace(/\s+/g, ' ');
}

/**
 * Case-insensitive duplicate name check.
 */
async function checkDuplicateName(name, excludeMemberId = null) {
  const cleaned = cleanMemberName(name);
  if (!cleaned) return null;

  const existing = await prisma.schedulingMember.findFirst({
    where: {
      name: { equals: cleaned, mode: 'insensitive' },
      deletedAt: null,
      ...(excludeMemberId ? { id: { not: excludeMemberId } } : {}),
    },
  });

  return existing;
}

/**
 * Ensure a user account is linked to at most one active member.
 */
async function assertUserLinkable(userId, excludeMemberId = null) {
  if (!userId) return;

  const existingLink = await prisma.schedulingMember.findFirst({
    where: {
      userId,
      deletedAt: null,
      ...(excludeMemberId ? { id: { not: excludeMemberId } } : {}),
    },
    include: { user: true },
  });

  if (existingLink) {
    throw new ApiError(
      409,
      `User account "${existingLink.user?.fullName || userId}" is already linked to telecalling member "${existingLink.name}". Please unlink it first.`
    );
  }
}

/**
 * Invalidates all cached overview data across dates.
 */
async function invalidateTelecallingOverviewCache() {
  try {
    await invalidatePattern('scheduling:overview*');
  } catch (err) {
    console.error('[Scheduling] Failed to invalidate overview cache:', err.message);
  }
}

/**
 * Unified server-side function to retrieve telecalling members.
 * Serves as the single source of truth for:
 * - Manage Team list
 * - Telecaller Overview table & stat cards
 * - Import modal, Report modal, File attachment modal, dropdowns, exports
 *
 * @param {Object} options
 * @param {string} [options.date] - Target date in YYYY-MM-DD
 * @param {boolean} [options.includeInactive=false] - If true, returns both active & inactive members
 * @param {boolean} [options.includeDeleted=false] - If true, returns soft-deleted members
 * @param {string} [options.sortBy='name'] - 'name' (alphabetical) or 'status' (active first, then name)
 */
async function getTelecallingMembers(options = {}) {
  const {
    date = null,
    includeInactive = false,
    includeDeleted = false,
    sortBy = 'name',
  } = options;

  const where = {};

  if (!includeDeleted) {
    where.deletedAt = null;
  }

  if (date) {
    const bounds = getIstDayBounds(date);
    if (bounds) {
      const { startOfD, endOfD } = bounds;

      // Created on or before date D (in IST)
      where.createdAt = { lt: endOfD };

      if (!includeInactive) {
        const todayStr = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date());

        const isTodayOrFuture = date >= todayStr;

        if (isTodayOrFuture) {
          // Part 3.5: Deactivate - Removed from today on; count drops immediately
          where.active = true;
          where.deletedAt = null;
        } else {
          // Part 3.5: Past days' overviews & reports: Kept — history must not vanish
          where.AND = [
            {
              OR: [
                { deletedAt: null },
                { deletedAt: { gte: startOfD } },
              ],
            },
            {
              OR: [
                { active: true, deactivatedAt: null },
                { deactivatedAt: { gte: startOfD } },
              ],
            },
          ];
        }
      }
    }
  } else if (!includeInactive) {
    where.active = true;
  }

  const members = await prisma.schedulingMember.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          status: true,
          isActive: true,
        },
      },
    },
  });

  // Always sort case-insensitively using localeCompare with sensitivity: 'base'
  members.sort((a, b) => {
    if (sortBy === 'status') {
      if (a.active !== b.active) {
        return a.active ? -1 : 1;
      }
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return members;
}

/**
 * Delete a telecalling member:
 * - If member has historical activity (lead lists, reports, or files):
 *   Soft-deletes (active = false, deletedAt = now). Preserves history.
 * - If no history exists:
 *   Hard-deletes from DB.
 */
async function deleteTelecallingMember(memberId, actorUser, organizationId) {
  const existing = await prisma.schedulingMember.findUnique({
    where: { id: memberId },
    include: { user: true },
  });

  if (!existing || existing.deletedAt) {
    throw new ApiError(404, 'Scheduling member not found');
  }

  const myOrg = organizationId || 'defaultOrg';

  // Check candidate assignments on linked user before deleting
  if (existing.userId) {
    const INACTIVE_STATUSES = ['REJECTED', 'JOINED', 'OFFER_DECLINED'];
    const [c1, c2] = await Promise.all([
      prisma.candidate.count({
        where: {
          organizationId: myOrg,
          assignedRecruiterId: existing.userId,
          status: { notIn: INACTIVE_STATUSES },
          isDeleted: false,
        },
      }),
      prisma.candidate.count({
        where: {
          organizationId: myOrg,
          mentorId: existing.userId,
          status: { notIn: INACTIVE_STATUSES },
          isDeleted: false,
        },
      }),
    ]);
    const activeCount = c1 + c2;
    if (activeCount > 0) {
      throw new ApiError(
        400,
        `The linked user has ${activeCount} active candidates. Please reassign them first to delete this member.`
      );
    }
  }

  // Check history
  const [listCount, reportCount, fileCount] = await Promise.all([
    prisma.schedulingLeadList.count({ where: { memberId } }),
    prisma.schedulingDailyReport.count({ where: { memberId } }),
    prisma.schedulingMemberFile.count({ where: { memberId } }),
  ]);

  const hasHistory = listCount > 0 || reportCount > 0 || fileCount > 0;

  if (hasHistory) {
    // Soft-delete
    await prisma.schedulingMember.update({
      where: { id: memberId },
      data: {
        active: false,
        deletedAt: new Date(),
        userId: null, // Unlink user to allow user re-association if needed
      },
    });
  } else {
    // Hard-delete
    await prisma.schedulingMember.delete({
      where: { id: memberId },
    });
  }

  // Invalidate overview cache
  await invalidateTelecallingOverviewCache();

  return { hasHistory, member: existing };
}

module.exports = {
  getIstDayBounds,
  cleanMemberName,
  checkDuplicateName,
  assertUserLinkable,
  invalidateTelecallingOverviewCache,
  getTelecallingMembers,
  deleteTelecallingMember,
};
