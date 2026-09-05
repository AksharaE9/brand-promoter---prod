'use strict';
const prisma = require('../../config/db');

/**
 * LEAN list projection — used ONLY for GET /api/interviews list responses.
 *
 * Deliberately excluded (these load via a separate detail endpoint only):
 *   - feedback           (potentially large JSON blob per row)
 *   - rescheduleHistory  (history array)
 *   - transferHistory    (history array)
 *   - offerLetterUrl     (URL / large string)
 *   - voiceRecordingUrl  (URL / large string)
 *   - voiceRecordingFileId
 *   - application join   (unnecessary for list; candidateName/jobTitle already denormalized on the row)
 *
 * Conditionally included (with server-side stripping in relationPopulator.js listMode):
 *   - notes              Fetched but base64 file data is stripped before sending.
 *                        Only { name, exists: true } metadata is sent, to support
 *                        Excel View's follow-up upload status columns. Safe for payload limits.
 *
 * The denormalized columns candidateName, jobTitle, interviewerNames are already
 * stored directly on the interview row and are sufficient for list-view rendering.
 * No cross-table joins are needed here.
 */
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
  mode: true,
  status: true,
  result: true,
  organizationId: true,
  interviewerIds: true,
  interviewerNames: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  // Included for Excel View follow-up upload status.
  // IMPORTANT: base64 file blobs within this field are stripped by
  // relationPopulator.js (listMode) before the response is sent, so
  // the payload stays lean. Only { name, exists: true } metadata is sent.
  notes: true,
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
  date,
}) {
  // Safety cap: 100 rows max per page.
  // Was 250 before the lean-projection fix — that caused OOM crashes on the 512MB Render instance
  // because relation population fetched full feedback/candidate/user objects for every row.
  // Restore to 250 only after confirming the lean projection keeps payloads well under 200KB
  // via `curl .../api/interviews?limit=250 | wc -c` on a production-like dataset.
  const lim = Math.min(150, Math.max(1, parseInt(limit) || 20));

  // Base query filter (excluding deleted candidates and orphaned interviews)
  const where = {
    organizationId: orgId,
    candidateId: { not: null },
    application: {
      candidate: {
        isDeleted: false
      }
    }
  };

  // Support date filter (YYYY-MM-DD format in IST timezone)
  if (date) {
    const parts = date.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      
      // Midnight IST of that date
      const start = new Date(Date.UTC(year, month, day, 0, 0, 0));
      start.setUTCMinutes(start.getUTCMinutes() - 330); // subtract 5.5 hours
      
      // End of IST of that date
      const end = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
      end.setUTCMinutes(end.getUTCMinutes() - 330); // subtract 5.5 hours
      
      where.scheduledStart = {
        gte: start,
        lte: end
      };
    }
  }

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
          candidate: {
            phone: {
              contains: q
            }
          }
        }
      },
      {
        application: {
          candidate: {
            phoneNormalized: {
              contains: q
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

  if (candidateId) {
    where.candidateId = candidateId;
  }
  if (jobId) {
    where.jobId = jobId;
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
