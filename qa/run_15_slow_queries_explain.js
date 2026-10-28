const fs = require('fs');
const path = require('path');
const prisma = require('../backend/src/config/db');

async function main() {
  console.log('=== RUNNING 15 SLOWEST QUERIES WITH EXPLAIN (ANALYZE, BUFFERS) ===\n');

  const queries = [
    {
      name: "Q01: Candidates Paginated with Active Filter & Deleted Guard",
      sql: `EXPLAIN (ANALYZE, BUFFERS) SELECT id, "fullName", phone, email, status, "createdAt" FROM candidates WHERE "organizationId" = 'defaultOrg' AND "isDeleted" = false ORDER BY "updatedAt" DESC LIMIT 50 OFFSET 0;`
    },
    {
      name: "Q02: Candidates Filtered by College and Course",
      sql: `EXPLAIN (ANALYZE, BUFFERS) SELECT id, "fullName", college, course FROM candidates WHERE "organizationId" = 'defaultOrg' AND "isDeleted" = false AND college ILIKE '%Jain%' LIMIT 50;`
    },
    {
      name: "Q03: Candidates Joined with Applications & Job Titles",
      sql: `EXPLAIN (ANALYZE, BUFFERS) SELECT c.id, c."fullName", a.id as app_id, a.status, j.title as job_title FROM candidates c JOIN applications a ON a."candidateId" = c.id LEFT JOIN jobs j ON j.id = a."jobId" WHERE c."organizationId" = 'defaultOrg' AND c."isDeleted" = false LIMIT 50;`
    },
    {
      name: "Q04: Interviews by Organization and Scheduled Start Window (Next 14 Days)",
      sql: `EXPLAIN (ANALYZE, BUFFERS) SELECT id, "candidateName", round, "scheduledStart", status, outcome FROM interviews WHERE "organizationId" = 'defaultOrg' AND "scheduledStart" >= NOW() AND "scheduledStart" <= NOW() + INTERVAL '14 days' ORDER BY "scheduledStart" ASC;`
    },
    {
      name: "Q05: Interviews Filtered by Status with Feedback Lookups",
      sql: `EXPLAIN (ANALYZE, BUFFERS) SELECT id, "candidateId", round, status, feedback FROM interviews WHERE "organizationId" = 'defaultOrg' AND status = 'COMPLETED' LIMIT 50;`
    },
    {
      name: "Q06: InterviewFeedbacks SelectionStatus & OverallRating Aggregation",
      sql: `EXPLAIN (ANALYZE, BUFFERS) SELECT "selectionStatus", AVG("overallRating") as avg_rating, COUNT(*) as count FROM interview_feedbacks GROUP BY "selectionStatus";`
    },
    {
      name: "Q07: CollegeDrive Candidates Enrolled Lookup",
      sql: `EXPLAIN (ANALYZE, BUFFERS) SELECT cdc.id, cdc."fullName", cdc.phone, cd.title FROM college_drive_candidates cdc JOIN college_drives cd ON cd.id = cdc."driveId" WHERE cdc."driveId" = 'cmv7plef60000tbak7gdyv00e';`
    },
    {
      name: "Q08: Quality Checks Queue (Pending Approvals)",
      sql: `EXPLAIN (ANALYZE, BUFFERS) SELECT qc.id, qc.round, qc.status, c."fullName" FROM quality_checks qc JOIN candidates c ON c.id = qc.candidate_id WHERE qc.organization_id = 'defaultOrg' AND qc.status = 'PENDING' ORDER BY qc.entered_queue_at DESC;`
    },
    {
      name: "Q09: External Assessment Results Verification",
      sql: `EXPLAIN (ANALYZE, BUFFERS) SELECT id, candidate_id, provider, status, score_normalised_100, recommendation_normalised FROM external_assessment_results WHERE organization_id = 'defaultOrg' ORDER BY created_at DESC LIMIT 50;`
    },
    {
      name: "Q10: Candidates Full Name Search with Case-Insensitive Pattern",
      sql: `EXPLAIN (ANALYZE, BUFFERS) SELECT id, "fullName", phone, email FROM candidates WHERE "organizationId" = 'defaultOrg' AND "isDeleted" = false AND "fullName" ILIKE '%Sharma%' LIMIT 20;`
    },
    {
      name: "Q11: Candidate Duplicate Detection by Normalized Phone",
      sql: `EXPLAIN (ANALYZE, BUFFERS) SELECT phone_normalized, COUNT(*) FROM candidates WHERE phone_normalized IS NOT NULL AND "isDeleted" = false GROUP BY phone_normalized HAVING COUNT(*) > 1;`
    },
    {
      name: "Q12: Dashboard Metric Multi-Count Subqueries",
      sql: `EXPLAIN (ANALYZE, BUFFERS) SELECT (SELECT COUNT(*) FROM candidates WHERE "organizationId" = 'defaultOrg' AND "isDeleted" = false) as c_cnt, (SELECT COUNT(*) FROM interviews WHERE "organizationId" = 'defaultOrg' AND status = 'COMPLETED') as int_cnt, (SELECT COUNT(*) FROM jobs WHERE "organizationId" = 'defaultOrg' AND "isActive" = true) as job_cnt;`
    },
    {
      name: "Q13: Orphan Interviews Integrity Guard",
      sql: `EXPLAIN (ANALYZE, BUFFERS) SELECT i.id, i."candidateId" FROM interviews i WHERE i."candidateId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM candidates c WHERE c.id = i."candidateId");`
    },
    {
      name: "Q14: Candidates with Resumes in PostgreSQL FileMeta",
      sql: `EXPLAIN (ANALYZE, BUFFERS) SELECT c.id, c."fullName", fm."storageKey", fm."sizeBytes" FROM candidates c JOIN file_metas fm ON fm.id = c."resumeFileId" WHERE c."isDeleted" = false LIMIT 50;`
    },
    {
      name: "Q15: Completed Interviews without Outcome (QA-002 Review Set)",
      sql: `EXPLAIN (ANALYZE, BUFFERS) SELECT id, "candidateId", "candidateName", round, "createdAt" FROM interviews WHERE status = 'COMPLETED' AND outcome IS NULL ORDER BY "createdAt" ASC;`
    }
  ];

  const results = [];

  for (const q of queries) {
    console.log(`Executing ${q.name}...`);
    const planRows = await prisma.$queryRawUnsafe(q.sql);
    const planText = planRows.map(r => r['QUERY PLAN']).join('\n');
    
    // Extract execution time
    const execTimeMatch = planText.match(/Execution Time:\s*([0-9.]+)\s*ms/);
    const planningTimeMatch = planText.match(/Planning Time:\s*([0-9.]+)\s*ms/);
    const execTimeMs = execTimeMatch ? parseFloat(execTimeMatch[1]) : null;
    const planTimeMs = planningTimeMatch ? parseFloat(planningTimeMatch[1]) : null;

    results.push({
      name: q.name,
      execTimeMs,
      planTimeMs,
      planText
    });
  }

  const outPath = path.join(__dirname, 'reports', 'explain_15_queries.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nSuccessfully saved 15 EXPLAIN plans to ${outPath}`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
