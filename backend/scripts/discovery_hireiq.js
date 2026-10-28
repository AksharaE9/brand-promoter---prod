'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const prisma = require('../src/config/db');

async function discoverHireIqData() {
  console.log('=== HIREIQ INTEGRATION DISCOVERY AUDIT ===\n');

  // 1. Candidate Name Audit
  const totalCandidates = await prisma.candidate.count({ where: { isDeleted: false } });
  const sampleNames = await prisma.candidate.findMany({
    where: { isDeleted: false },
    select: { id: true, fullName: true },
    take: 50,
  });
  const namesWithTrailingSpace = sampleNames.filter(c => c.fullName !== c.fullName.trim());
  const allCapsNames = sampleNames.filter(c => c.fullName === c.fullName.toUpperCase() && c.fullName.length > 3);

  console.log('1. CANDIDATE NAME:');
  console.log(`- Total active candidates: ${totalCandidates}`);
  console.log(`- Trailing spaces found in sample: ${namesWithTrailingSpace.length}/50`);
  console.log(`- All-caps names in sample: ${allCapsNames.length}/50`);
  if (namesWithTrailingSpace.length > 0) {
    console.log(`- Example with space: "${namesWithTrailingSpace[0].fullName}"`);
  }

  // 2. Candidate Email Audit
  const candidates = await prisma.candidate.findMany({
    where: { isDeleted: false },
    select: { id: true, email: true },
  });

  let validEmailCount = 0;
  let missingEmailCount = 0;
  let placeholderEmailCount = 0;
  let invalidEmailCount = 0;
  const placeholderSamples = [];
  const invalidSamples = [];

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const placeholderPatterns = ['dummy', 'test', 'example.com', 'none@', 'na@', 'noemail', 'fake', 'placeholder'];

  for (const c of candidates) {
    const raw = (c.email || '').trim().toLowerCase();
    if (!raw || raw === 'n/a' || raw === 'na' || raw === '-' || raw === 'null') {
      missingEmailCount++;
    } else if (placeholderPatterns.some(p => raw.includes(p))) {
      placeholderEmailCount++;
      if (placeholderSamples.length < 5) placeholderSamples.push(raw);
    } else if (!emailRegex.test(raw)) {
      invalidEmailCount++;
      if (invalidSamples.length < 5) invalidSamples.push(raw);
    } else {
      validEmailCount++;
    }
  }

  console.log('\n2. CANDIDATE EMAIL:');
  console.log(`- Valid emails: ${validEmailCount}`);
  console.log(`- Missing emails: ${missingEmailCount}`);
  console.log(`- Placeholder emails: ${placeholderEmailCount} (e.g. ${placeholderSamples.join(', ')})`);
  console.log(`- Malformed/Invalid emails: ${invalidEmailCount} (e.g. ${invalidSamples.join(', ')})`);

  // 3. Role Audit (Applied Role vs Interview Role)
  const sampleInterviews = await prisma.interview.findMany({
    take: 100,
    include: {
      application: {
        include: {
          candidate: { select: { preferredRole: true, fullName: true } },
          job: { select: { id: true, title: true } }
        }
      }
    }
  });

  let roleMismatchCount = 0;
  for (const iv of sampleInterviews) {
    const appliedRole = iv.application?.candidate?.preferredRole;
    const interviewRole = iv.jobTitle || iv.application?.job?.title;
    if (appliedRole && interviewRole && appliedRole.trim().toLowerCase() !== interviewRole.trim().toLowerCase()) {
      roleMismatchCount++;
    }
  }

  console.log('\n3. ROLE (Applied vs Interview):');
  console.log(`- Sample interview count: ${sampleInterviews.length}`);
  console.log(`- Candidates with mismatch between applied role & interview role: ${roleMismatchCount}/${sampleInterviews.length}`);

  // 4. Round & Status Audit
  const totalInterviews = await prisma.interview.count();
  const interviewsByStatus = await prisma.interview.groupBy({
    by: ['status'],
    _count: { id: true }
  });
  const interviewsByOutcome = await prisma.interview.groupBy({
    by: ['outcome'],
    _count: { id: true }
  });

  console.log('\n4. ROUND & STATUS / OUTCOME:');
  console.log(`- Total interviews in DB: ${totalInterviews}`);
  console.log('- Statuses:', interviewsByStatus.map(s => `${s.status}: ${s._count.id}`).join(', '));
  console.log('- Outcomes:', interviewsByOutcome.map(o => `${o.outcome || 'NULL'}: ${o._count.id}`).join(', '));

  // 5. Date & Time Slot Audit
  const scheduledSample = await prisma.interview.findMany({
    where: { scheduledStart: { not: null } },
    select: {
      id: true,
      scheduledStart: true,
      durationMinutes: true,
      mode: true,
      meetingLink: true,
      zohoLink: true,
      interviewerNames: true,
      round: true,
      roundNo: true
    },
    take: 10,
    orderBy: { scheduledStart: 'desc' }
  });

  console.log('\n5. DATE & TIME SLOT:');
  if (scheduledSample.length > 0) {
    const s = scheduledSample[0];
    console.log(`- Example scheduledStart (raw DB UTC): ${s.scheduledStart.toISOString()}`);
    console.log(`- Example in IST (+05:30): ${new Date(s.scheduledStart.getTime() + 5.5 * 3600 * 1000).toISOString().replace('Z', '+05:30')}`);
    console.log(`- Duration: ${s.durationMinutes} mins`);
    console.log(`- Mode: ${s.mode}`);
    console.log(`- Meeting Link: ${s.meetingLink || s.zohoLink || 'None'}`);
    console.log(`- Panelist: ${s.interviewerNames || 'None'}`);
  }

  // 6. Resume Storage Coverage Audit for Scheduled Candidates
  const scheduledInterviews = await prisma.interview.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledStart: { not: null }
    },
    include: {
      application: {
        include: {
          candidate: {
            include: {
              resumeFile: { select: { id: true, originalName: true, mimeType: true, fileData: true } }
            }
          }
        }
      }
    }
  });

  let resumeAvailable = 0;
  let resumeExternalLink = 0;
  let resumeSharedFolder = 0;
  let resumeMissing = 0;
  let resumeNone = 0;

  for (const iv of scheduledInterviews) {
    const cand = iv.application?.candidate;
    if (!cand) {
      resumeNone++;
      continue;
    }

    if (cand.resumeFile?.fileData && cand.resumeFile.fileData.length > 0) {
      resumeAvailable++;
    } else if (cand.resumeLinkOriginal || cand.resumeLinkDownload) {
      const link = cand.resumeLinkOriginal || cand.resumeLinkDownload;
      // Check if it's a shared folder link (e.g. folders/ or drive/folders)
      if (link.includes('/folders/') || link.includes('drive.google.com/drive/u/')) {
        resumeSharedFolder++;
      } else {
        resumeExternalLink++;
      }
    } else if (cand.resumeFileId && (!cand.resumeFile || !cand.resumeFile.fileData)) {
      resumeMissing++;
    } else {
      resumeNone++;
    }
  }

  console.log('\n6. RESUME COVERAGE (Currently Scheduled Interviews):');
  console.log(`- Total scheduled interviews evaluated: ${scheduledInterviews.length}`);
  console.log(`  * available (in PostgreSQL file_metas): ${resumeAvailable}`);
  console.log(`  * external_link (individual Google Drive/direct file): ${resumeExternalLink}`);
  console.log(`  * shared_folder (batch drive folder link): ${resumeSharedFolder}`);
  console.log(`  * file_missing (fileMeta record with null fileData): ${resumeMissing}`);
  console.log(`  * none: ${resumeNone}`);

  // 7. Check Multi-tenancy & Indexes
  const orgSample = await prisma.interview.findFirst({ select: { organizationId: true } });
  console.log('\n7. MULTI-TENANCY & ORG ID:');
  console.log(`- Default/active organizationId: ${orgSample?.organizationId || 'defaultOrg'}`);

  console.log('\nAudit complete.');
  await prisma.$disconnect();
}

discoverHireIqData().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
