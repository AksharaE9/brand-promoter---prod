'use strict';
/**
 * migrateAnomalousRounds.js
 * Scans for interviews with roundNo not in [1, 2, 99] or anomalous round strings,
 * backs up affected records to a local JSON file, and updates them to canonical values.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const prisma = require('../config/db');

async function migrate() {
  console.log('=== Starting Interview Round Number Remediation Migration ===');

  const allInterviews = await prisma.interview.findMany({
    select: {
      id: true,
      candidateId: true,
      candidateName: true,
      roundNo: true,
      round: true,
      status: true,
      createdAt: true,
    },
  });

  const anomalous = allInterviews.filter(
    (iv) => (iv.roundNo !== 1 && iv.roundNo !== 2 && iv.roundNo !== 99) ||
            (iv.round && !['Round 1', 'Round 2', 'Final Round'].includes(iv.round))
  );

  console.log(`[Before Migration] Total interviews scanned: ${allInterviews.length}`);
  console.log(`[Before Migration] Anomalous round records found: ${anomalous.length}`);

  if (anomalous.length === 0) {
    console.log('No anomalous records found. Database is already clean.');
    return { beforeCount: 0, afterCount: 0, migrated: 0 };
  }

  // Save backup to scratch/backup directory
  const backupDir = path.resolve(__dirname, '../../backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const backupFile = path.join(backupDir, `rounds_backup_${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(anomalous, null, 2), 'utf8');
  console.log(`[Backup] Saved ${anomalous.length} records to ${backupFile}`);

  let migratedCount = 0;

  for (const iv of anomalous) {
    let targetRoundNo = iv.roundNo;
    let targetRound = iv.round;

    if (iv.roundNo >= 3 || iv.roundNo === 99 || iv.round === 'Final Round' || iv.round === 'Final' || (iv.round && iv.round.startsWith('Round ') && parseInt(iv.round.replace('Round ', ''), 10) >= 3)) {
      targetRoundNo = 99;
      targetRound = 'Final Round';
    } else if (iv.roundNo === 1 || iv.round === 'Round 1') {
      targetRoundNo = 1;
      targetRound = 'Round 1';
    } else if (iv.roundNo === 2 || iv.round === 'Round 2') {
      targetRoundNo = 2;
      targetRound = 'Round 2';
    } else {
      targetRoundNo = 99;
      targetRound = 'Final Round';
    }

    console.log(`  Updating ID ${iv.id} (${iv.candidateName || 'Candidate'}): roundNo ${iv.roundNo} -> ${targetRoundNo}, round "${iv.round}" -> "${targetRound}"`);

    await prisma.interview.update({
      where: { id: iv.id },
      data: {
        roundNo: targetRoundNo,
        round: targetRound,
      },
    });

    migratedCount++;
  }

  // Count after migration
  const afterInterviews = await prisma.interview.findMany({
    select: {
      id: true,
      roundNo: true,
      round: true,
    },
  });

  const afterAnomalous = afterInterviews.filter(
    (iv) => (iv.roundNo !== 1 && iv.roundNo !== 2 && iv.roundNo !== 99) ||
            (iv.round && !['Round 1', 'Round 2', 'Final Round'].includes(iv.round))
  );

  console.log(`\n=== Migration Complete ===`);
  console.log(`[After Migration] Anomalous records remaining: ${afterAnomalous.length}`);
  console.log(`[After Migration] Successfully migrated records: ${migratedCount}`);

  return {
    beforeCount: anomalous.length,
    afterCount: afterAnomalous.length,
    migrated: migratedCount,
  };
}

if (require.main === module) {
  migrate()
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

module.exports = { migrate };
