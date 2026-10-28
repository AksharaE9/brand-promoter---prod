'use strict';

/**
 * scripts/exports/discovery_bca_mca.js
 *
 * Discovery script for BCA / MCA candidates and outcomes in TalentOS ATS.
 * Read-only execution to inspect all course and outcome fields.
 */

const path = require('path');
const fs = require('fs');

const backendNodeModules = path.resolve(__dirname, '../../backend/node_modules');
module.paths.push(backendNodeModules);

require(path.join(backendNodeModules, 'dotenv')).config({
  path: path.resolve(__dirname, '../../backend/.env')
});

const { PrismaClient } = require(path.join(backendNodeModules, '@prisma/client'));

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const s = String(val).replace(/"/g, '""');
  return `"${s}"`;
}

async function main() {
  console.log('--- STARTING BCA/MCA & OUTCOMES DISCOVERY ---');

  // Enforce read-only session
  await prisma.$executeRawUnsafe('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;');
  console.log('Session set to TRANSACTION READ ONLY.');

  const exportsDir = path.resolve(__dirname, '../../exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  // 1. Column names of candidates table
  const candidateCols = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'candidates'
    ORDER BY ordinal_position;
  `);
  console.log('Candidates columns:', candidateCols.map(c => c.column_name).join(', '));

  // 2. Discover all customFields keys in candidates
  const candidateCustomFieldKeys = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT jsonb_object_keys("customFields"::jsonb) AS key_name
    FROM candidates
    WHERE "customFields" IS NOT NULL AND "customFields"::text != 'null' AND "customFields"::text != '{}'
    ORDER BY key_name;
  `).catch(err => {
    console.error('Error fetching customFields keys:', err.message);
    return [];
  });
  console.log('Candidate customFields keys:', candidateCustomFieldKeys.map(k => k.key_name));

  // 3. Check interview_feedbacks columns and feedbackData keys
  const feedbackCols = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'interview_feedbacks'
    ORDER BY ordinal_position;
  `).catch(() => []);
  console.log('InterviewFeedbacks columns:', feedbackCols.map(c => c.column_name).join(', '));

  const feedbackDataKeys = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT jsonb_object_keys("feedbackData"::jsonb) AS key_name
    FROM interview_feedbacks
    WHERE "feedbackData" IS NOT NULL AND "feedbackData"::text != 'null' AND "feedbackData"::text != '{}'
    ORDER BY key_name;
  `).catch(err => {
    console.error('Error fetching feedbackData keys:', err.message);
    return [];
  });
  console.log('InterviewFeedback feedbackData keys:', feedbackDataKeys.map(k => k.key_name));

  // 4. Sample feedbackData values to see how Course / Degree / College are stored
  const sampleFeedbacks = await prisma.$queryRawUnsafe(`
    SELECT round, "selectionStatus", "overallRating", "feedbackData"
    FROM interview_feedbacks
    WHERE "feedbackData"::text ILIKE '%bca%' OR "feedbackData"::text ILIKE '%mca%' OR "feedbackData"::text ILIKE '%course%'
    LIMIT 5;
  `).catch(() => []);
  console.log('Sample feedbackData with bca/mca/course:', JSON.stringify(sampleFeedbacks, null, 2));

  // 5. Check interviews table columns and sample feedback column
  const interviewCols = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'interviews'
    ORDER BY ordinal_position;
  `).catch(() => []);
  console.log('Interviews columns:', interviewCols.map(c => c.column_name).join(', '));

  // 6. Distinct values across all candidate course-related fields
  console.log('\nQuerying distinct course values across fields...');
  const courseSources = [];

  // candidates.course
  const candCourses = await prisma.$queryRawUnsafe(`
    SELECT course AS val, COUNT(*)::int AS count
    FROM candidates
    WHERE course IS NOT NULL AND TRIM(course) != ''
    GROUP BY course
    ORDER BY count DESC;
  `).catch(() => []);
  candCourses.forEach(r => courseSources.push({ source: 'candidates.course', val: r.val, count: r.count }));

  // candidates.college
  const candColleges = await prisma.$queryRawUnsafe(`
    SELECT college AS val, COUNT(*)::int AS count
    FROM candidates
    WHERE college IS NOT NULL AND TRIM(college) != ''
    GROUP BY college
    ORDER BY count DESC;
  `).catch(() => []);
  candColleges.forEach(r => courseSources.push({ source: 'candidates.college', val: r.val, count: r.count }));

  // colleges table: course
  const collegesCourse = await prisma.$queryRawUnsafe(`
    SELECT course AS val, COUNT(*)::int AS count
    FROM colleges
    WHERE course IS NOT NULL AND TRIM(course) != ''
    GROUP BY course
    ORDER BY count DESC;
  `).catch(() => []);
  collegesCourse.forEach(r => courseSources.push({ source: 'colleges.course', val: r.val, count: r.count }));

  // customFields possible course/degree keys
  for (const k of candidateCustomFieldKeys) {
    const key = k.key_name;
    if (/course|degree|education|qualification|branch|stream/i.test(key)) {
      const vals = await prisma.$queryRawUnsafe(`
        SELECT "customFields"->>'${key}' AS val, COUNT(*)::int AS count
        FROM candidates
        WHERE "customFields"->>'${key}' IS NOT NULL AND TRIM("customFields"->>'${key}') != ''
        GROUP BY "customFields"->>'${key}'
        ORDER BY count DESC;
      `).catch(() => []);
      vals.forEach(r => courseSources.push({ source: `candidates.customFields.${key}`, val: r.val, count: r.count }));
    }
  }

  // interview_feedbacks feedbackData keys related to course/degree/education/college
  for (const k of feedbackDataKeys) {
    const key = k.key_name;
    if (/course|degree|education|qualification|branch|stream|college/i.test(key)) {
      const vals = await prisma.$queryRawUnsafe(`
        SELECT "feedbackData"->>'${key}' AS val, COUNT(*)::int AS count
        FROM interview_feedbacks
        WHERE "feedbackData"->>'${key}' IS NOT NULL AND TRIM("feedbackData"->>'${key}') != ''
        GROUP BY "feedbackData"->>'${key}'
        ORDER BY count DESC;
      `).catch(() => []);
      vals.forEach(r => courseSources.push({ source: `interview_feedbacks.feedbackData.${key}`, val: r.val, count: r.count }));
    }
  }

  // Write exports/discovery_courses.csv
  let coursesCsv = 'source_field,course_value,count\n';
  courseSources.forEach(row => {
    coursesCsv += `${escapeCsv(row.source)},${escapeCsv(row.val)},${row.count}\n`;
  });
  fs.writeFileSync(path.join(exportsDir, 'discovery_courses.csv'), coursesCsv, 'utf8');
  console.log(`discovery_courses.csv written with ${courseSources.length} distinct field-value rows.`);

  // 7. Distinct outcomes & statuses across all outcome-related fields
  console.log('\nQuerying distinct outcome/status values across fields...');
  const outcomeSources = [];

  // candidates.status
  const candStatus = await prisma.$queryRawUnsafe(`
    SELECT status AS val, COUNT(*)::int AS count
    FROM candidates
    WHERE status IS NOT NULL
    GROUP BY status
    ORDER BY count DESC;
  `).catch(() => []);
  candStatus.forEach(r => outcomeSources.push({ source: 'candidates.status', val: r.val, count: r.count }));

  // candidates.currentStage
  const candStage = await prisma.$queryRawUnsafe(`
    SELECT "currentStage" AS val, COUNT(*)::int AS count
    FROM candidates
    WHERE "currentStage" IS NOT NULL
    GROUP BY "currentStage"
    ORDER BY count DESC;
  `).catch(() => []);
  candStage.forEach(r => outcomeSources.push({ source: 'candidates.currentStage', val: r.val, count: r.count }));

  // candidates.offerDecision
  const candOfferDecision = await prisma.$queryRawUnsafe(`
    SELECT "offerDecision" AS val, COUNT(*)::int AS count
    FROM candidates
    WHERE "offerDecision" IS NOT NULL
    GROUP BY "offerDecision"
    ORDER BY count DESC;
  `).catch(() => []);
  candOfferDecision.forEach(r => outcomeSources.push({ source: 'candidates.offerDecision', val: r.val, count: r.count }));

  // interviews.status
  const intStatus = await prisma.$queryRawUnsafe(`
    SELECT status AS val, COUNT(*)::int AS count
    FROM interviews
    WHERE status IS NOT NULL
    GROUP BY status
    ORDER BY count DESC;
  `).catch(() => []);
  intStatus.forEach(r => outcomeSources.push({ source: 'interviews.status', val: r.val, count: r.count }));

  // interviews.result
  const intResult = await prisma.$queryRawUnsafe(`
    SELECT result AS val, COUNT(*)::int AS count
    FROM interviews
    WHERE result IS NOT NULL
    GROUP BY result
    ORDER BY count DESC;
  `).catch(() => []);
  intResult.forEach(r => outcomeSources.push({ source: 'interviews.result', val: r.val, count: r.count }));

  // interviews.outcome
  const intOutcome = await prisma.$queryRawUnsafe(`
    SELECT outcome AS val, COUNT(*)::int AS count
    FROM interviews
    WHERE outcome IS NOT NULL
    GROUP BY outcome
    ORDER BY count DESC;
  `).catch(() => []);
  intOutcome.forEach(r => outcomeSources.push({ source: 'interviews.outcome', val: r.val, count: r.count }));

  // interview_feedbacks.selectionStatus
  const fbSelectionStatus = await prisma.$queryRawUnsafe(`
    SELECT "selectionStatus" AS val, COUNT(*)::int AS count
    FROM interview_feedbacks
    WHERE "selectionStatus" IS NOT NULL
    GROUP BY "selectionStatus"
    ORDER BY count DESC;
  `).catch(() => []);
  fbSelectionStatus.forEach(r => outcomeSources.push({ source: 'interview_feedbacks.selectionStatus', val: r.val, count: r.count }));

  // applications.status
  const appStatus = await prisma.$queryRawUnsafe(`
    SELECT status AS val, COUNT(*)::int AS count
    FROM applications
    WHERE status IS NOT NULL
    GROUP BY status
    ORDER BY count DESC;
  `).catch(() => []);
  appStatus.forEach(r => outcomeSources.push({ source: 'applications.status', val: r.val, count: r.count }));

  // quality_checks.status
  const qcStatus = await prisma.$queryRawUnsafe(`
    SELECT status::text AS val, COUNT(*)::int AS count
    FROM quality_checks
    WHERE status IS NOT NULL
    GROUP BY status
    ORDER BY count DESC;
  `).catch(() => []);
  qcStatus.forEach(r => outcomeSources.push({ source: 'quality_checks.status', val: r.val, count: r.count }));

  // Write exports/discovery_outcomes.csv
  let outcomesCsv = 'source_field,outcome_status_value,count\n';
  outcomeSources.forEach(row => {
    outcomesCsv += `${escapeCsv(row.source)},${escapeCsv(row.val)},${row.count}\n`;
  });
  fs.writeFileSync(path.join(exportsDir, 'discovery_outcomes.csv'), outcomesCsv, 'utf8');
  console.log(`discovery_outcomes.csv written with ${outcomeSources.length} distinct field-value rows.`);

  // 8. Specific discovery for BCA / MCA candidates
  console.log('\n--- SPECIFIC BCA / MCA SCAN ---');
  const bcaMcaCandCount = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS count
    FROM candidates
    WHERE (
      course ~* '\\m(bca|mca)\\M' 
      OR college ~* '\\m(bca|mca)\\M'
      OR "jobTitle" ~* '\\m(bca|mca)\\M'
      OR "preferredRole" ~* '\\m(bca|mca)\\M'
      OR "customFields"::text ~* '\\m(bca|mca)\\M'
    );
  `);
  console.log('Candidates matching BCA/MCA regex across fields:', bcaMcaCandCount[0].count);

  // Check interview feedback matching BCA/MCA
  const bcaMcaFbCount = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS count
    FROM interview_feedbacks
    WHERE "feedbackData"::text ~* '\\m(bca|mca)\\M';
  `);
  console.log('Interview feedbacks matching BCA/MCA regex in feedbackData:', bcaMcaFbCount[0].count);

  // Check interviews notes matching BCA/MCA
  const bcaMcaIntNotesCount = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS count
    FROM interviews
    WHERE notes ~* '\\m(bca|mca)\\M' OR feedback::text ~* '\\m(bca|mca)\\M';
  `);
  console.log('Interviews matching BCA/MCA regex in notes/feedback:', bcaMcaIntNotesCount[0].count);

  console.log('--- DISCOVERY FINISHED SUCCESSFULLY ---');
}

main()
  .catch(err => {
    console.error('Fatal discovery error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
