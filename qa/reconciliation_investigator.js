'use strict';

const path = require('path');
require('../backend/node_modules/dotenv').config({ path: path.resolve(__dirname, '../backend/.env') });
const prisma = require('../backend/src/config/db');

async function investigate() {
  console.log('=== QA LOOP 2: DATA DISCREPANCY INVESTIGATION ===\n');

  // 1. NMIT Investigation
  console.log('--- 1. NMIT Investigation ---');
  const nmitDrive = await prisma.collegeDrive.findFirst({
    where: { title: { contains: 'Nitte Meenakshi' } }
  });
  if (nmitDrive) {
    const nmitCandidates = await prisma.$queryRawUnsafe(`
      SELECT c.id, c."fullName", c.email, c.phone, c.status as "candidateStatus",
             i.id as "interviewId", i."roundNo", i.round, i.status as "interviewStatus", i.outcome, i.notes,
             i."updatedAt"
      FROM "college_drive_candidates" cdc
      JOIN "candidates" c ON cdc."candidateId" = c.id
      LEFT JOIN "interviews" i ON i."candidateId" = c.id
      WHERE cdc."driveId" = '${nmitDrive.id}'
      ORDER BY c."fullName" ASC, i."roundNo" ASC
    `);
    console.log(`NMIT Total Candidate-Interview rows: ${nmitCandidates.length}`);
    const targets = ['Ayush Madanpotra', 'Nag Prathik', 'Jesto Gigi Kadavi', 'Dhruthi', 'Sai Prateesh', 'Sujith'];
    nmitCandidates.forEach(row => {
      if (targets.some(t => row.fullName.toLowerCase().includes(t.toLowerCase()))) {
        console.log(`[NMIT Target] ${row.fullName} | Round: ${row.roundNo} (${row.round}) | Status: ${row.interviewStatus} | Outcome: ${row.outcome}`);
      }
    });

    // Check unique candidates in NMIT
    const uniqueCands = Array.from(new Set(nmitCandidates.map(r => r.id)));
    console.log(`Unique NMIT candidate IDs in drive: ${uniqueCands.length}`);
  }

  // 2. Jain Investigation
  console.log('\n--- 2. Jain Investigation ---');
  const jainDrive = await prisma.collegeDrive.findFirst({
    where: { title: { contains: 'JAIN' } }
  });
  if (jainDrive) {
    const jainCandidates = await prisma.$queryRawUnsafe(`
      SELECT c.id, c."fullName", c.email, c.phone, c.status as "candidateStatus",
             i.id as "interviewId", i."roundNo", i.round, i.status as "interviewStatus", i.outcome, i.notes
      FROM "college_drive_candidates" cdc
      JOIN "candidates" c ON cdc."candidateId" = c.id
      LEFT JOIN "interviews" i ON i."candidateId" = c.id
      WHERE cdc."driveId" = '${jainDrive.id}'
      ORDER BY c."fullName" ASC, i."roundNo" ASC
    `);
    console.log(`Jain Total Candidate-Interview rows: ${jainCandidates.length}`);
    const jainTargets = ['Dhruvanth', 'Pranav', 'Sanjay', 'Harsha Vardhan'];
    jainCandidates.forEach(row => {
      if (jainTargets.some(t => row.fullName.toLowerCase().includes(t.toLowerCase()))) {
        console.log(`[Jain Target] ${row.fullName} | Round: ${row.roundNo} | Outcome: ${row.outcome}`);
      }
    });
    const uniqueJain = Array.from(new Set(jainCandidates.map(r => r.id)));
    console.log(`Unique Jain candidate IDs in drive: ${uniqueJain.length}`);
  }

  // 3. MVJ Soumya Badiger Investigation
  console.log('\n--- 3. MVJ Soumya Badiger Investigation ---');
  const soumya = await prisma.$queryRawUnsafe(`
    SELECT c.id, c."fullName", c.status as "candStatus",
           i.id as "intvId", i."roundNo", i.round, i.status, i.outcome, i.notes, i."updatedAt"
    FROM "candidates" c
    JOIN "interviews" i ON i."candidateId" = c.id
    WHERE c."fullName" ILIKE '%Soumya%Badiger%'
  `);
  console.table(soumya);

  // 4. BGS Investigation (Santosh khul & Round 2)
  console.log('\n--- 4. BGS College Investigation ---');
  const bgsDrive = await prisma.collegeDrive.findFirst({
    where: { title: { contains: 'BGS' } }
  });
  if (bgsDrive) {
    const bgsRounds = await prisma.$queryRawUnsafe(`
      SELECT i."roundNo", i.round, i.outcome, COUNT(*) as count
      FROM "college_drive_candidates" cdc
      JOIN "candidates" c ON cdc."candidateId" = c.id
      JOIN "interviews" i ON i."candidateId" = c.id
      WHERE cdc."driveId" = '${bgsDrive.id}'
      GROUP BY i."roundNo", i.round, i.outcome
      ORDER BY i."roundNo", i.outcome
    `);
    console.table(bgsRounds);

    const santosh = await prisma.$queryRawUnsafe(`
      SELECT c.id, c."fullName", c.email, c.phone, cdc."driveId"
      FROM "candidates" c
      LEFT JOIN "college_drive_candidates" cdc ON cdc."candidateId" = c.id
      WHERE c."fullName" ILIKE '%Santosh%'
    `);
    console.log('Santosh candidates in DB:', santosh);
  }

  // 5. Gopalan Brunda B Investigation
  console.log('\n--- 5. Gopalan Brunda B Investigation ---');
  const brunda = await prisma.$queryRawUnsafe(`
    SELECT c.id, c."fullName", c.status as "candStatus",
           i.id as "intvId", i."roundNo", i.round, i.status, i.outcome, i.notes
    FROM "candidates" c
    JOIN "interviews" i ON i."candidateId" = c.id
    WHERE c."fullName" ILIKE '%Brunda%'
  `);
  console.table(brunda);

  // 6. Non-drive candidates & No-shows
  console.log('\n--- 6. Non-drive Candidates & No-shows ---');
  const nonDriveNames = ['Nitya Shree', 'Priya G', 'Rakshita', 'Sham S', 'Vignesh Balaji', 'Soheb Baig', 'Srinivasa', 'Sushmitha'];
  for (const name of nonDriveNames) {
    const matches = await prisma.$queryRawUnsafe(`
      SELECT c.id, c."fullName", c.email, c.status as "candStatus",
             i.id as "intvId", i."roundNo", i.round, i.status as "intvStatus", i.outcome
      FROM "candidates" c
      LEFT JOIN "interviews" i ON i."candidateId" = c.id
      WHERE c."fullName" ILIKE '%${name}%'
    `);
    console.log(`Candidate [${name}]: ${matches.length} row(s) found`);
    if (matches.length > 0) console.table(matches);
  }

  await prisma.$disconnect();
}

investigate().catch(err => {
  console.error('Investigation failed:', err);
  process.exit(1);
});
