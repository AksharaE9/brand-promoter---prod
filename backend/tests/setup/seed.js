'use strict';
/**
 * Deterministic test seed.
 *
 * Creates fixed candidates, users, jobs, applications, and interviews
 * with frozen timestamps so timezone tests are reproducible every run.
 *
 * ALL timestamps use IST (UTC+5:30). The table below shows every fixture's
 * wall-clock IST time and its UTC storage equivalent:
 *
 * Slot A: 2024-03-15 10:00:00 IST  →  2024-03-15 04:30:00 UTC  (normal daytime)
 * Slot B: 2024-03-15 11:45:00 IST  →  2024-03-15 06:15:00 UTC  (near noon)
 * Slot C: 2024-03-15 23:45:00 IST  →  2024-03-15 18:15:00 UTC  (day boundary — same day in IST, different day look in UTC+0)
 * Slot D: 2024-02-29 10:00:00 IST  →  2024-02-29 04:30:00 UTC  (leap year)
 * Slot E: 2024-03-15 14:00:00 IST  →  2024-03-15 08:30:00 UTC  (round 2, for duplicate test)
 */
const bcrypt = require('bcryptjs');
const { prisma } = require('./db');

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // 330 minutes in ms

/** Convert "YYYY-MM-DDTHH:mm:ss IST" to UTC Date */
function istToUtc(istDateStr) {
  const localMs = new Date(istDateStr + 'Z').getTime(); // treat as UTC first
  return new Date(localMs - IST_OFFSET_MS);             // subtract IST offset → true UTC
}

// Fixed fixture identifiers — stable across every CI run
const FIXTURE = {
  HR_EMAIL:         'hr@test.ci',
  HR_PASSWORD:      'TestPassword123!',
  IV_EMAIL:         'iv@test.ci',
  IV_PASSWORD:      'TestPassword123!',
  CANDIDATE_EMAIL:  'candidate@test.ci',
  CANDIDATE_PHONE:  '9999999999',
  ORG_ID:           'ci-test-org',

  // UTC-stored scheduledStart values for interviews
  SLOT_A_UTC: istToUtc('2024-03-15T10:00:00'),  // 10:00 AM IST
  SLOT_B_UTC: istToUtc('2024-03-15T11:45:00'),  // 11:45 AM IST
  SLOT_C_UTC: istToUtc('2024-03-15T23:45:00'),  // 11:45 PM IST (day-boundary test)
  SLOT_D_UTC: istToUtc('2024-02-29T10:00:00'),  // 10:00 AM IST leap year
  SLOT_E_UTC: istToUtc('2024-03-15T14:00:00'),  // 2:00 PM IST (round 2)
};

async function runSeed() {
  // ── Wipe test org data in correct FK order ──────────────────────────────
  await prisma.interview.deleteMany({ where: { organizationId: FIXTURE.ORG_ID } });
  await prisma.application.deleteMany({ where: { organizationId: FIXTURE.ORG_ID } });
  await prisma.candidate.deleteMany({ where: { organizationId: FIXTURE.ORG_ID } });
  await prisma.session.deleteMany({
    where: { user: { email: { in: [FIXTURE.HR_EMAIL, FIXTURE.IV_EMAIL] } } }
  });
  await prisma.user.deleteMany({
    where: { email: { in: [FIXTURE.HR_EMAIL, FIXTURE.IV_EMAIL] } }
  });
  await prisma.job.deleteMany({ where: { organizationId: FIXTURE.ORG_ID } });

  // ── Create users ────────────────────────────────────────────────────────
  const hrHash = await bcrypt.hash(FIXTURE.HR_PASSWORD, 10);
  const ivHash = await bcrypt.hash(FIXTURE.IV_PASSWORD, 10);


  const hrUser = await prisma.user.create({
    data: {
      fullName:       'CI HR User',
      email:          FIXTURE.HR_EMAIL,
      passwordHash:   hrHash,
      role:           'RECRUITER',
      status:         'ACTIVE',
      organizationId: FIXTURE.ORG_ID,
    },
  });

  const ivUser = await prisma.user.create({
    data: {
      fullName:       'CI Interviewer',
      email:          FIXTURE.IV_EMAIL,
      passwordHash:   ivHash,
      role:           'RECRUITER',
      status:         'ACTIVE',
      organizationId: FIXTURE.ORG_ID,
    },
  });

  // ── Create job ──────────────────────────────────────────────────────────
  const job = await prisma.job.create({
    data: {
      title:          'CI Test Engineer',
      department:     'Engineering',
      organizationId: FIXTURE.ORG_ID,
      createdById:    hrUser.id,
    },
  });

  // ── Create candidate ────────────────────────────────────────────────────
  const candidate = await prisma.candidate.create({
    data: {
      fullName:       'CI Test Candidate',
      email:          FIXTURE.CANDIDATE_EMAIL,
      phone:          FIXTURE.CANDIDATE_PHONE,
      preferredRole:  'QA Engineer',
      organizationId: FIXTURE.ORG_ID,
      createdById:    hrUser.id,
      status:         'ACTIVE',
    },
  });

  // ── Create application ──────────────────────────────────────────────────
  const application = await prisma.application.create({
    data: {
      candidateId:    candidate.id,
      jobId:          job.id,
      status:         'IN_PIPELINE',
      organizationId: FIXTURE.ORG_ID,
    },
  });

  // ── Create interviews ───────────────────────────────────────────────────
  const iv1 = await prisma.interview.create({
    data: {
      applicationId:  application.id,
      candidateId:    candidate.id,
      candidateName:  candidate.fullName,
      jobId:          job.id,
      jobTitle:       job.title,
      roundNo:        1,
      round:          'Round 1',
      scheduledStart: FIXTURE.SLOT_A_UTC,
      durationMinutes: 60,
      mode:           'VIRTUAL',
      status:         'SCHEDULED',
      organizationId: FIXTURE.ORG_ID,
      createdById:    hrUser.id,
      interviewerIds: JSON.stringify([ivUser.id]),
      interviewerNames: ivUser.fullName,
    },
  });

  const iv2 = await prisma.interview.create({
    data: {
      applicationId:  application.id,
      candidateId:    candidate.id,
      candidateName:  candidate.fullName,
      jobId:          job.id,
      jobTitle:       job.title,
      roundNo:        2,
      round:          'Round 2',
      scheduledStart: FIXTURE.SLOT_E_UTC,
      durationMinutes: 60,
      mode:           'VIRTUAL',
      status:         'SCHEDULED',
      organizationId: FIXTURE.ORG_ID,
      createdById:    hrUser.id,
      interviewerIds: JSON.stringify([ivUser.id]),
      interviewerNames: ivUser.fullName,
    },
  });

  // Day-boundary interview (11:45 PM IST — Slot C)
  await prisma.interview.create({
    data: {
      applicationId:  application.id,
      candidateId:    candidate.id,
      candidateName:  candidate.fullName,
      jobId:          job.id,
      jobTitle:       job.title,
      roundNo:        3,
      round:          'Round 3',
      scheduledStart: FIXTURE.SLOT_C_UTC,
      durationMinutes: 30,
      mode:           'PHONE',
      status:         'SCHEDULED',
      organizationId: FIXTURE.ORG_ID,
      createdById:    hrUser.id,
      interviewerIds: JSON.stringify([ivUser.id]),
      interviewerNames: ivUser.fullName,
    },
  });

  // Leap year interview (Feb 29, 2024)
  await prisma.interview.create({
    data: {
      applicationId:  application.id,
      candidateId:    candidate.id,
      candidateName:  candidate.fullName,
      jobId:          job.id,
      jobTitle:       job.title,
      roundNo:        4,
      round:          'Round 4',
      scheduledStart: FIXTURE.SLOT_D_UTC,
      durationMinutes: 45,
      mode:           'IN_PERSON',
      status:         'SCHEDULED',
      organizationId: FIXTURE.ORG_ID,
      createdById:    hrUser.id,
      interviewerIds: JSON.stringify([ivUser.id]),
      interviewerNames: ivUser.fullName,
    },
  });

  return { hrUser, ivUser, candidate, application, job, iv1, iv2, ORG_ID: FIXTURE.ORG_ID, FIXTURE };
}

async function seed() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await runSeed();
    } catch (err) {
      if (attempt === 2) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

module.exports = { seed, FIXTURE, istToUtc };

