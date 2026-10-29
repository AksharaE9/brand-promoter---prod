const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');

async function get7StateCounts() {
  const cands = await prisma.candidate.findMany({
    where: { organizationId: 'defaultOrg', isDeleted: false },
    select: {
      id: true,
      preferredRole: true,
      resumeFileId: true,
      resumeLinkOriginal: true,
      resumeLinkDownload: true,
      matchScores: { where: { isPrimary: true }, select: { ratingOutOf10: true } },
      resumeParseJobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } }
    }
  });

  const stateCounts = {};
  for (const c of cands) {
    const roleRaw = (c.preferredRole || '').toLowerCase();
    const isExcluded = roleRaw.includes('data analyst') || roleRaw.includes('business analyst') || roleRaw.includes('human resource') || roleRaw.includes('hr intern');
    const isTarget = roleRaw.includes('operations') || roleRaw.includes('bde') || roleRaw.includes('sales') || roleRaw.includes('marketing');
    
    let state = 'UNMAPPED_ROLE';
    if (isExcluded) {
      state = 'NO_JD';
    } else if (isTarget) {
      if (c.matchScores.length > 0) {
        state = 'SCORED';
      } else {
        const latestJob = c.resumeParseJobs[0];
        const hasResume = Boolean(c.resumeFileId || c.resumeLinkOriginal || c.resumeLinkDownload);
        if (latestJob && (latestJob.status === 'RUNNING' || latestJob.status === 'QUEUED')) {
          state = 'QUEUED';
        } else if (latestJob && latestJob.status === 'FAILED') {
          state = 'FAILED';
        } else if (latestJob && latestJob.status === 'UNSUPPORTED_FORMAT') {
          state = 'UNSUPPORTED_FILE';
        } else if (!hasResume) {
          state = 'NO_RESUME';
        } else {
          state = 'QUEUED';
        }
      }
    }
    stateCounts[state] = (stateCounts[state] || 0) + 1;
  }
  console.log(`7-State Counts (Total Candidates = ${cands.length}):`, JSON.stringify(stateCounts, null, 2));
  await prisma.$disconnect();
}
get7StateCounts().catch(console.error);
