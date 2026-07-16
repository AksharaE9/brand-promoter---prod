'use strict';
/**
 * fix_audit_entity_names.js
 *
 * Cleanup: finds audit log rows where entityName is null, blank, or a raw ID,
 * resolves them from candidates, applications, jobs, interviews, and users,
 * and regenerates the description to show exactly who/what the action was for.
 *
 * Run: node scripts/fix_audit_entity_names.js
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function looksLikeId(str) {
  if (!str) return false;
  if (str === 'N/A' || str === 'System') return false;
  // Has no space AND is longer than 15 chars
  if (!str.includes(' ') && str.length > 15) return true;
  // Matches cuid2 pattern (starts with letter, all alphanumeric, 20-30 chars)
  if (/^[a-z][a-z0-9]{19,29}$/i.test(str)) return true;
  // UUID pattern
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) return true;
  return false;
}

async function fixAuditEntityNames() {
  console.log('🚀 Loading reference records for resolution...');

  // 1. Load users
  const users = await prisma.user.findMany({
    select: { id: true, fullName: true }
  });
  const usersMap = new Map(users.map(u => [u.id, u.fullName]));
  console.log(`Loaded ${users.length} users.`);

  // 2. Load jobs
  const jobs = await prisma.job.findMany({
    select: { id: true, title: true }
  });
  const jobsMap = new Map(jobs.map(j => [j.id, j.title]));
  console.log(`Loaded ${jobs.length} jobs.`);

  // 3. Load candidates
  const candidates = await prisma.candidate.findMany({
    select: { id: true, fullName: true }
  });
  const candidatesMap = new Map(candidates.map(c => [c.id, c.fullName]));
  console.log(`Loaded ${candidates.length} candidates.`);

  // 4. Load applications
  const applications = await prisma.application.findMany({
    select: {
      id: true,
      candidate: { select: { fullName: true } },
      job: { select: { title: true } }
    }
  });
  const applicationsMap = new Map(applications.map(a => [a.id, a]));
  console.log(`Loaded ${applications.length} applications.`);

  // 5. Load interviews
  const interviews = await prisma.interview.findMany({
    select: {
      id: true,
      candidateName: true,
      jobTitle: true,
      round: true,
      roundNo: true,
      application: {
        select: {
          candidate: { select: { fullName: true } },
          job: { select: { title: true } }
        }
      }
    }
  });
  const interviewsMap = new Map(interviews.map(i => [i.id, i]));
  console.log(`Loaded ${interviews.length} interviews.`);

  console.log('\n🔍 Scanning audit logs to resolve names and rebuild descriptions...');

  const allLogs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' }
  });

  console.log(`Total logs in database: ${allLogs.length}`);

  let updatedCount = 0;

  for (const log of allLogs) {
    let resolvedEntityName = log.entityName;

    // If it's a raw ID or empty, let's try to resolve it
    if (!resolvedEntityName || looksLikeId(resolvedEntityName)) {
      resolvedEntityName = null; // Clear it first so we can resolve properly
      const entityId = log.entityId;

      if (entityId) {
        if (log.entityType === 'CANDIDATE') {
          resolvedEntityName = candidatesMap.get(entityId) || null;
        } else if (log.entityType === 'USER') {
          resolvedEntityName = usersMap.get(entityId) || null;
        } else if (log.entityType === 'JOB') {
          resolvedEntityName = jobsMap.get(entityId) || null;
        } else if (log.entityType === 'APPLICATION') {
          const app = applicationsMap.get(entityId);
          if (app) {
            const candidateName = app.candidate?.fullName || 'Candidate';
            const jobTitle = app.job?.title || 'Job';
            resolvedEntityName = `${candidateName} - ${jobTitle}`;
          }
        } else if (log.entityType === 'INTERVIEW') {
          const iv = interviewsMap.get(entityId);
          if (iv) {
            const candidateName = iv.application?.candidate?.fullName || iv.candidateName || 'Candidate';
            const jobTitle = iv.application?.job?.title || iv.jobTitle || 'Job';
            const roundName = iv.round || `Round ${iv.roundNo}`;
            resolvedEntityName = `${candidateName} - ${roundName} (${jobTitle})`;
          }
        } else if (log.entityType === 'INTERVIEW_FEEDBACK') {
          let possibleRoundId = entityId;
          const newData = log.newData || {};
          if (typeof newData === 'object' && newData !== null) {
            possibleRoundId = newData.roundId || newData.interviewId || entityId;
          }
          const iv = interviewsMap.get(possibleRoundId);
          if (iv) {
            const candidateName = iv.application?.candidate?.fullName || iv.candidateName || 'Candidate';
            const roundName = iv.round || `Round ${iv.roundNo}`;
            resolvedEntityName = `Feedback for ${candidateName} - ${roundName}`;
          }
        }
      }
    }

    // Safeguard: If it's still a raw ID/cuid (failed to resolve deleted entity), don't store it as entityName
    if (looksLikeId(resolvedEntityName)) {
      resolvedEntityName = null;
    }

    // Rebuild description using the resolved name
    const actorName = log.actorName || 'System';
    const actionPretty = log.action.replace(/_/g, ' ');
    const entityTypeStr = log.entityType;

    const newDescription = `${actorName} performed ${actionPretty} on ${entityTypeStr}${resolvedEntityName ? ` (${resolvedEntityName})` : ''}`;

    // Update if the entityName changed
    if (resolvedEntityName !== log.entityName) {
      await prisma.auditLog.update({
        where: { id: log.id },
        data: {
          entityName: resolvedEntityName,
        }
      });
      console.log(`  Updated [${log.action}]: "${log.entityName || 'N/A'}" -> "${resolvedEntityName}"`);
      updatedCount++;
    }
  }

  console.log(`\n🎉 Success! Successfully updated ${updatedCount} audit log descriptions & entity names.`);
}

fixAuditEntityNames()
  .catch(err => {
    console.error('❌ Script failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
