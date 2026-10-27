'use strict';
const prisma = require('../src/config/db');

async function verifyJobA() {
  console.log('=== VERIFYING JOB A (CMR UNIVERSITY) DATABASE EVIDENCE ===\n');

  const drive = await prisma.collegeDrive.findFirst({
    where: { title: { contains: 'CMR University', mode: 'insensitive' } }
  });
  console.log('1. College Drive:', drive ? `FOUND ID: ${drive.id}, dateFrom: ${drive.dateFrom}` : 'NOT FOUND');

  const cdcCount = await prisma.collegeDriveCandidate.count({ where: { driveId: drive.id } });
  console.log(`2. CollegeDriveCandidates count: ${cdcCount} (Target: 33)`);

  const cands = await prisma.candidate.findMany({
    where: { college: 'CMR University', isDeleted: false },
    include: {
      interviewFeedbacks: true,
      applications: {
        include: {
          interviews: true
        }
      }
    }
  });
  console.log(`3. Direct Candidates in CMR University: ${cands.length} (Target: 33)`);

  // BA Candidates check
  const baCands = cands.filter(c => c.preferredRole === 'Business Analyst Intern');
  const baOutcomes = { SELECTED: 0, ON_HOLD: 0, REJECTED: 0 };
  baCands.forEach(c => {
    const fb = c.interviewFeedbacks.find(f => f.round === 'ROUND_1');
    if (fb) baOutcomes[fb.selectionStatus] = (baOutcomes[fb.selectionStatus] || 0) + 1;
  });
  console.log(`4. BA Candidates: ${baCands.length}/17 | Outcomes:`, baOutcomes, '(Expected: 4 Selected, 8 Hold, 5 Rejected)');

  // DA Candidates check (excluding MCA)
  const daCands = cands.filter(c => c.preferredRole === 'Data Analyst Intern' && c.course !== 'MCA');
  const daOutcomes = { SELECTED: 0, ON_HOLD: 0, REJECTED: 0 };
  daCands.forEach(c => {
    const fb = c.interviewFeedbacks.find(f => f.round === 'ROUND_1');
    if (fb) daOutcomes[fb.selectionStatus] = (daOutcomes[fb.selectionStatus] || 0) + 1;
  });
  console.log(`5. DA Candidates (B.Tech): ${daCands.length}/11 | Outcomes:`, daOutcomes, '(Expected: 6 Selected, 0 Hold, 5 Rejected)');

  // MCA Candidates check
  const mcaCands = cands.filter(c => c.course === 'MCA');
  const mcaR1 = { SELECTED: 0 };
  const mcaR2 = { SELECTED: 0, ON_HOLD: 0, REJECTED: 0 };
  mcaCands.forEach(c => {
    const r1 = c.interviewFeedbacks.find(f => f.round === 'ROUND_1');
    const r2 = c.interviewFeedbacks.find(f => f.round === 'ROUND_2');
    if (r1) mcaR1[r1.selectionStatus] = (mcaR1[r1.selectionStatus] || 0) + 1;
    if (r2) mcaR2[r2.selectionStatus] = (mcaR2[r2.selectionStatus] || 0) + 1;
  });
  console.log(`6. MCA Candidates: ${mcaCands.length}/5 | R1 Outcomes:`, mcaR1, '| R2 Outcomes:', mcaR2, '(Expected R2: 1 Selected, 1 Hold, 3 Rejected)');

  // Needs contact details check
  const needsContact = cands.filter(c => c.customFields && c.customFields.needs_contact_details === true);
  console.log(`7. Candidates flagged needs_contact_details: ${needsContact.length}/33`);

  await prisma.$disconnect();
}
verifyJobA().catch(console.error);
