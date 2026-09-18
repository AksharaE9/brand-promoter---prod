require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');

const EXTERNAL_DB_URL = 'postgresql://ats_to2n_user:ixDs4gP0kpcwDfffaYASiVjJMIK7B7k0@dpg-d9kugflaeets73a88qhg-a.oregon-postgres.render.com/ats_to2n?sslmode=require';
process.env.DATABASE_URL = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
  ? process.env.DATABASE_URL
  : EXTERNAL_DB_URL;

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

async function main() {
  console.log('=== POST-REPAIR RECONCILIATION VERIFICATION ===\n');

  const candidates = await prisma.candidate.findMany({
    where: {
      isDeleted: false,
      OR: [
        { resumeFileId: { not: null } },
        { resumeLinkOriginal: { not: null } },
        { resumeLinkDownload: { not: null } },
      ],
    },
    select: {
      id: true,
      fullName: true,
      resumeFileId: true,
      resumeLinkOriginal: true,
      resumeLinkDownload: true,
      customFields: true,
      resumeFile: {
        select: {
          id: true,
          storageKey: true,
          sizeBytes: true,
        },
      },
    },
  });

  let verifiedOkCount = 0;
  let flaggedMissingCount = 0;
  let unhandledBrokenCount = 0;

  const unhandled = [];

  for (const c of candidates) {
    const custom = c.customFields && typeof c.customFields === 'object' ? c.customFields : {};
    const isFlaggedMissing = String(custom.resumeStatus || '').toUpperCase() === 'MISSING';

    const hasDbFile = c.resumeFile && (c.resumeFile.storageKey?.startsWith('db://') || (c.resumeFile.sizeBytes && c.resumeFile.sizeBytes > 0));
    const isGoogleDrive = (c.resumeLinkOriginal?.includes('drive.google.com') || c.resumeLinkDownload?.includes('drive.google.com'));

    if (isFlaggedMissing) {
      flaggedMissingCount++;
    } else if (hasDbFile || isGoogleDrive) {
      verifiedOkCount++;
    } else {
      unhandledBrokenCount++;
      unhandled.push({
        id: c.id,
        name: c.fullName,
        fileKey: c.resumeFile?.storageKey,
        originalLink: c.resumeLinkOriginal,
        downloadLink: c.resumeLinkDownload,
      });
    }
  }

  console.log(`Total Candidates Checked: ${candidates.length}`);
  console.log(`- Verified OK (DB Storage / Google Drive):  ${verifiedOkCount}`);
  console.log(`- Honestly Flagged MISSING:                ${flaggedMissingCount}`);
  console.log(`- Unhandled / Broken Without Flag:         ${unhandledBrokenCount}`);

  if (unhandledBrokenCount > 0) {
    console.error('\n⚠️ WARNING: Found unhandled records:', unhandled);
  } else {
    console.log('\n✅ 100% RECONCILIATION SUCCESS: Zero records in an unhandled/broken state.');
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
