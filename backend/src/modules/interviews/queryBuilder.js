'use strict';
const prisma = require('../../config/db');

// Only these fields are needed for the interview list view
const LIST_SELECT_FIELDS = {
  id: true,
  applicationId: true,
  candidateId: true,
  candidateName: true,
  jobId: true,
  jobTitle: true,
  roundNo: true,
  round: true,
  scheduledStart: true,
  durationMinutes: true,
  mode: true,
  meetingLink: true,
  zohoLink: true,
  status: true,
  result: true,
  outcome: true,
  outcomeSetAt: true,
  notes: true,
  organizationId: true,
  createdById: true,
  interviewerIds: true,
  interviewerNames: true,
  feedback: true,
  rescheduleHistory: true,
  transferHistory: true,
  offerLetterUrl: true,
  voiceRecordingFileId: true,
  voiceRecordingUrl: true,
  createdAt: true,
  updatedAt: true,
  // Select application to resolve candidateId and jobId
  application: {
    select: {
      id: true,
      candidateId: true,
      jobId: true,
      status: true,
    }
  }
};

async function buildInterviewListQuery({
  orgId,
  status,
  jobId,
  candidateId,
  applicationId,
  interviewerId,
  search,
  cursor,
  limit = 20,
}) {
  const lim = Math.min(100, Math.max(1, parseInt(limit) || 20));

  // Base query filter
  const where = {
    organizationId: orgId,
  };

  // Apply filters
  if (status) {
    where.status = status;
  }
  if (applicationId) {
    where.applicationId = applicationId;
  }

  if (search && search.trim()) {
    const q = search.trim();
    where.OR = [
      {
        candidateName: {
          contains: q,
          mode: 'insensitive'
        }
      },
      {
        jobTitle: {
          contains: q,
          mode: 'insensitive'
        }
      },
      {
        application: {
          candidate: {
            fullName: {
              contains: q,
              mode: 'insensitive'
            }
          }
        }
      },
      {
        application: {
          job: {
            title: {
              contains: q,
              mode: 'insensitive'
            }
          }
        }
      }
    ];
  }

  const applicationWhere = {};
  if (candidateId) {
    applicationWhere.candidateId = candidateId;
  }
  if (jobId) {
    applicationWhere.jobId = jobId;
  }

  if (Object.keys(applicationWhere).length > 0) {
    if (where.AND) {
      where.AND.push({ application: applicationWhere });
    } else {
      where.application = applicationWhere;
    }
  }

  if (interviewerId) {
    where.interviewerIds = {
      array_contains: interviewerId
    };
  }

  // Handle cursor-based pagination (avoid Prisma's subqueries for tie-breakers)
  if (cursor) {
    try {
      const cursorDoc = await prisma.interview.findUnique({
        where: { id: cursor },
        select: { id: true, scheduledStart: true }
      });
      if (cursorDoc) {
        const cursorCondition = {
          OR: [
            {
              scheduledStart: {
                lt: cursorDoc.scheduledStart
              }
            },
            {
              scheduledStart: cursorDoc.scheduledStart,
              id: {
                lt: cursorDoc.id
              }
            }
          ]
        };

        if (where.OR) {
          const existingOr = where.OR;
          delete where.OR;
          where.AND = [
            { OR: existingOr },
            cursorCondition
          ];
        } else if (where.AND) {
          where.AND.push(cursorCondition);
        } else {
          where.AND = [cursorCondition];
        }
      }
    } catch (err) {
      console.warn('[QueryBuilder] Cursor lookup failed, starting from beginning:', err.message);
    }
  }

  const orderBy = [];
  if (candidateId || applicationId) {
    orderBy.push({ roundNo: 'asc' });
  } else {
    orderBy.push({ scheduledStart: 'desc' });
    orderBy.push({ id: 'desc' });
  }

  const queryParams = {
    where,
    orderBy,
    take: lim,
    select: LIST_SELECT_FIELDS,
  };

  return { queryParams, limit: lim };
}

module.exports = { buildInterviewListQuery, LIST_SELECT_FIELDS };
