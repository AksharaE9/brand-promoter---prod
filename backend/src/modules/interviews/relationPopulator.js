'use strict';
const l1 = require('../../utils/l1Cache');
const prisma = require('../../config/db');

const ENTITY_TTL    = 600 * 1000;    // 10 minutes in ms
const ENTITY_PREFIX = 'entity:';

/**
 * Populates relations for a list of interview rounds in ONE operation.
 *
 * @param {object[]} rounds
 * @param {object|null} currentUser
 * @param {object} [opts]
 * @param {boolean} [opts.listMode=false]  When true, skips ALL DB queries and returns a
 *   lean shape built purely from denormalized columns already on the interview row.
 *   Use this for the GET /api/interviews list endpoint to avoid the 4-5 extra DB
 *   fetches (candidates, jobs, users, feedback, internal reports) that were causing
 *   OOM crashes at 250 rows on the 512MB Render instance.
 *
 * Flow (full mode only):
 *   1. Collect all unique IDs (candidates, jobs, users/panelists)
 *   2. Local l1Cache lookup for all of them
 *   3. Database query for misses only, run in parallel
 *   4. Merge results in memory
 */
async function populateInterviewRelations(rounds, currentUser = null, opts = {}) {
  if (!rounds || rounds.length === 0) return rounds;

  // ─── LIST MODE: no DB queries, use only denormalized columns ───────────────
  if (opts.listMode) {
    return rounds.map(round => {
      // Parse interviewerIds JSON so the frontend can use the array
      let interviewerIds = [];
      try {
        interviewerIds = typeof round.interviewerIds === 'string'
          ? JSON.parse(round.interviewerIds)
          : round.interviewerIds;
      } catch (_) {}
      if (!Array.isArray(interviewerIds)) interviewerIds = [];

      // Build a minimal panelist list from the comma-separated interviewerNames string
      // (already stored on the row — no DB join needed)
      const interviewers = round.interviewerNames
        ? round.interviewerNames.split(',').map(n => ({ fullName: n.trim() })).filter(p => p.fullName)
        : [];

      // ── Notes: strip base64 blobs, keep only name + exists flag ──────────────
      // The notes field stores JSON: { phoneFollowUp: { name, data }, emailFollowUp: { name, data }, ... }
      // Sending base64-encoded file data in a list response would balloon the payload.
      // We keep only { name, exists: true } so the frontend can show upload status.
      // Full file data loads via the detail panel endpoint.
      let notesStripped = undefined;
      if (round.notes) {
        try {
          const parsed = typeof round.notes === 'string' ? JSON.parse(round.notes) : round.notes;
          if (parsed && typeof parsed === 'object') {
            const stripBlob = (f) => (f && (f.data || f.exists || f.name)) ? { name: f.name || '', exists: true } : null;
            notesStripped = JSON.stringify({
              phoneFollowUp:   stripBlob(parsed.phoneFollowUp),
              emailFollowUp:   stripBlob(parsed.emailFollowUp),
              morningFollowUp: stripBlob(parsed.morningFollowUp),
              nextSchedule:    parsed.nextSchedule || null,
            });
          }
        } catch (_) { /* malformed notes — leave undefined */ }
      }

      // ── Offer Letter Sent: derive from result field in list mode ──────────────
      // Full mode computes this via fbRecord.offerLetterDocumentUrl — unavailable here.
      // Best available signal without a DB join: result === 'OFFER_LETTER' → show status.
      let offer_letter_sent = '—';
      if (round.result === 'OFFER_LETTER') {
        // We can't confirm both docs are present without the FB join,
        // so we indicate the status is set, not that both docs are uploaded.
        offer_letter_sent = 'Yes';
      }

      return {
        ...round,
        // Lean candidate shape — only what the list sidebar uses
        candidate: round.candidateName
          ? { id: round.candidateId, fullName: round.candidateName }
          : null,
        // Lean job shape
        job: round.jobTitle
          ? { id: round.jobId, title: round.jobTitle }
          : null,
        interviewers,
        interviewerIds,
        // Explicitly null out heavy fields so they never appear in the list response
        feedback: [],
        rescheduleHistory: undefined,
        transferHistory: undefined,
        notes: notesStripped,       // stripped — base64 data removed, existence preserved
        offerLetterUrl: undefined,
        voiceRecordingUrl: undefined,
        voiceRecordingFileId: undefined,
        offer_letter_sent,
        // Virtual helpers the frontend may reference
        _candidateName: round.candidateName || null,
        _jobTitle: round.jobTitle || null,
        _panelNames: interviewers.map(u => u.fullName),
      };
    });
  }

  // Collect all unique IDs needed across all rounds (resolve from application relation if needed)
  const candidateIds = [...new Set(rounds.map(r => r.candidateId || r.application?.candidateId).filter(Boolean))];
  const jobIds       = [...new Set(rounds.map(r => r.jobId || r.application?.jobId).filter(Boolean))];
  
  const interviewerIdsList = rounds.flatMap(r => {
    let ids = [];
    try {
      ids = typeof r.interviewerIds === 'string' ? JSON.parse(r.interviewerIds) : r.interviewerIds;
    } catch (_) {}
    return Array.isArray(ids) ? ids : [];
  });

  const feedbackUserIds = rounds.flatMap(r => {
    let list = [];
    try {
      list = typeof r.feedback === 'string' ? JSON.parse(r.feedback) : r.feedback;
    } catch (_) {}
    return Array.isArray(list) ? list.map(f => f.submittedBy || f.submittedById).filter(Boolean) : [];
  });

  const creatorIds = rounds.map(r => r.createdById).filter(Boolean);
  const panelIds = [...new Set([...interviewerIdsList, ...feedbackUserIds, ...creatorIds].filter(Boolean))];

  let candidateMap = {};
  let jobMap       = {};
  let userMap      = {};

  // Retrieve from local L1 cache
  candidateIds.forEach(id => {
    const val = l1.get(`${ENTITY_PREFIX}candidates:${id}`);
    if (val) candidateMap[id] = val;
  });
  jobIds.forEach(id => {
    const val = l1.get(`${ENTITY_PREFIX}jobs:${id}`);
    if (val) jobMap[id] = val;
  });
  panelIds.forEach(id => {
    const val = l1.get(`${ENTITY_PREFIX}users:${id}`);
    if (val) userMap[id] = val;
  });

  // Find what is still missing
  const missingCandidates = candidateIds.filter(id => !candidateMap[id]);
  const missingJobs       = jobIds.filter(id       => !jobMap[id]);
  const missingPanel      = panelIds.filter(id     => !userMap[id]);

  // Single parallel DB fetch for ALL missing entities
  const dbFetches = [];

  if (missingCandidates.length > 0) {
    dbFetches.push(
      prisma.candidate.findMany({
        where: { id: { in: missingCandidates } },
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          status: true,
          currentStage: true,
          source: true,
          profilePhotoFile: {
            select: {
              storageKey: true
            }
          }
        }
      }).then(docs => {
        docs.forEach(d => {
          candidateMap[d.id] = d;
        });
      })
    );
  }

  if (missingJobs.length > 0) {
    dbFetches.push(
      prisma.job.findMany({
        where: { id: { in: missingJobs } },
        select: {
          id: true,
          title: true,
          department: true,
          location: true
        }
      }).then(docs => {
        docs.forEach(d => {
          jobMap[d.id] = d;
        });
      })
    );
  }

  if (missingPanel.length > 0) {
    dbFetches.push(
      prisma.user.findMany({
        where: { id: { in: missingPanel } },
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          status: true
        }
      }).then(docs => {
        docs.forEach(d => {
          userMap[d.id] = d;
        });
      })
    );
  }

  // Batch fetch feedbacks for the candidates in this list
  let feedbacksList = [];
  if (candidateIds.length > 0) {
    dbFetches.push(
      prisma.interviewFeedback.findMany({
        where: { candidateId: { in: candidateIds }, deletedAt: null },
        include: {
          submittedBy: {
            select: {
              id: true,
              fullName: true,
              email: true,
              role: true,
            }
          }
        }
      }).then(docs => {
        feedbacksList = docs;
      })
    );
  }

  // Fetch candidate internal reports for super admin
  let internalReportsMap = {};
  if (currentUser?.role === 'SUPER_ADMIN' && candidateIds.length > 0) {
    dbFetches.push(
      prisma.candidateInternalReport.findMany({
        where: { candidateId: { in: candidateIds } },
        include: {
          submittedBy: {
            select: { fullName: true }
          }
        },
        orderBy: { submittedAt: 'desc' }
      }).then(reportsList => {
        reportsList.forEach(r => {
          if (!internalReportsMap[r.candidateId]) {
            internalReportsMap[r.candidateId] = [];
          }
          internalReportsMap[r.candidateId].push({
            id: r.id,
            content: r.content,
            submittedAt: r.submittedAt,
            submittedBy: r.submittedBy?.fullName || 'Unknown User'
          });
        });
      }).catch(err => {
        console.error('[relationPopulator] Failed to fetch internal reports:', err.message);
      })
    );
  }

  // ALL DB fetches run in parallel
  if (dbFetches.length > 0) {
    await Promise.all(dbFetches);
  }

  // Save newly fetched entities to local cache
  missingCandidates.forEach(id => {
    if (candidateMap[id]) l1.set(`${ENTITY_PREFIX}candidates:${id}`, candidateMap[id], ENTITY_TTL);
  });
  missingJobs.forEach(id => {
    if (jobMap[id]) l1.set(`${ENTITY_PREFIX}jobs:${id}`, jobMap[id], ENTITY_TTL);
  });
  missingPanel.forEach(id => {
    if (userMap[id]) l1.set(`${ENTITY_PREFIX}users:${id}`, userMap[id], ENTITY_TTL);
  });

  // Merge relations into rounds to keep backwards compatibility with frontend expectation
  return rounds.map(round => {
    const candidateId = round.candidateId || round.application?.candidateId;
    const jobId = round.jobId || round.application?.jobId;

    const candidateObj = candidateId ? candidateMap[candidateId] : null;
    const candidate = candidateObj ? {
      ...candidateObj,
      internalReports: internalReportsMap[candidateId] || []
    } : null;
    const job = jobId ? jobMap[jobId] : null;
    
    let interviewerIds = [];
    try {
      interviewerIds = typeof round.interviewerIds === 'string' ? JSON.parse(round.interviewerIds) : round.interviewerIds;
    } catch (_) {}
    if (!Array.isArray(interviewerIds)) interviewerIds = [];

    const interviewers = interviewerIds.map(id => userMap[id]).filter(Boolean);

    let feedback = [];
    try {
      feedback = typeof round.feedback === 'string' ? JSON.parse(round.feedback) : round.feedback;
    } catch (_) {}
    if (!Array.isArray(feedback)) feedback = [];
    feedback = feedback.filter(f => !f.deletedAt && !f.deleted_at);

    const mappedRoundName = round.round === 'Round 1' ? 'ROUND_1'
                          : round.round === 'Round 2' ? 'ROUND_2'
                          : 'FINAL_ROUND';

    const fbRecord = feedbacksList.find(
      f => f.candidateId === candidateId && f.round === mappedRoundName
    );

    if (feedback.length === 0 && fbRecord) {
      feedback = [{
        id: fbRecord.id,
        submittedById: fbRecord.submittedById,
        submittedBy: fbRecord.submittedBy || { id: fbRecord.submittedById, fullName: 'Unknown Interviewer' },
        feedbackData: fbRecord.feedbackData,
        templateVersion: fbRecord.templateVersion,
        selectionStatus: fbRecord.selectionStatus,
        overallRating: fbRecord.overallRating,
        createdAt: fbRecord.createdAt,
        updatedAt: fbRecord.updatedAt,
      }];
    }

    const populatedFeedback = feedback.map(f => {
      const userId = f.submittedBy || f.submittedById;
      const user = (userId && typeof userId === 'string') ? userMap[userId] : (f.submittedBy && typeof f.submittedBy === 'object' ? f.submittedBy : null);
      return {
        ...f,
        submittedById: userId || user?.id,
        submittedBy: user || f.submittedBy || { id: userId, fullName: 'Unknown Interviewer' }
      };
    });

    // Frontend accesses nested object: round.application.candidate
    const application = round.applicationId ? {
      id: round.applicationId,
      candidateId,
      jobId,
      status: round.status,
      candidate,
      job
    } : null;


    let offer_letter_sent = '—';
    if (round.result === 'OFFER_LETTER') {
      const docPopulated = fbRecord?.offerLetterDocumentUrl && fbRecord.offerLetterDocumentUrl.trim() !== '';
      const attPopulated = fbRecord?.offerLetterEmailAttachmentUrl && fbRecord.offerLetterEmailAttachmentUrl.trim() !== '';
      if (docPopulated && attPopulated) {
        offer_letter_sent = 'Yes';
      } else {
        offer_letter_sent = 'No';
      }
    }

    let offer_letter_document = null;
    if (fbRecord?.offerLetterDocumentUrl) {
      try {
        offer_letter_document = JSON.parse(fbRecord.offerLetterDocumentUrl);
      } catch (_) {
        offer_letter_document = fbRecord.offerLetterDocumentUrl;
      }
    }

    let offer_letter_email_attachment = null;
    if (fbRecord?.offerLetterEmailAttachmentUrl) {
      try {
        offer_letter_email_attachment = JSON.parse(fbRecord.offerLetterEmailAttachmentUrl);
      } catch (_) {
        offer_letter_email_attachment = fbRecord.offerLetterEmailAttachmentUrl;
      }
    }

    const creatorUser = round.createdById ? userMap[round.createdById] : null;
    const createdByName = creatorUser ? creatorUser.fullName : 'Super Admin';

    return {
      ...round,
      candidateId,
      jobId,
      candidate,
      job,
      interviewers,
      feedback: populatedFeedback,
      application,
      offer_letter_sent,
      offer_letter_document,
      offer_letter_email_attachment,
      offer_letter_document_url: fbRecord?.offerLetterDocumentUrl || null,
      offer_letter_email_attachment_url: fbRecord?.offerLetterEmailAttachmentUrl || null,
      _candidateName: candidate?.fullName || round.candidateName || null,
      _jobTitle: job?.title || round.jobTitle || null,
      _panelNames: interviewers.map(u => u.fullName),
      createdByName,
    };
  });
}

module.exports = { populateInterviewRelations };
