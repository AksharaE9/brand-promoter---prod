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
  console.log('=== RESUME REPAIR & HONEST FLAGGING MIGRATION ===\n');

  let repairedCount = 0;
  let flaggedMissingCount = 0;
  let unchangedOkCount = 0;

  const candidatesNeedingReupload = [];

  const candidates = await prisma.candidate.findMany({
    where: {
      isDeleted: false,
      OR: [
        { resumeFileId: { not: null } },
        { resumeFile: { isNot: null } },
        { resumeLinkOriginal: { not: null } },
        { resumeLinkDownload: { not: null } },
      ],
    },
    include: {
      resumeFile: true,
      applications: {
        include: {
          job: { select: { title: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${candidates.length} candidate records claiming resumes.\n`);

  for (const candidate of candidates) {
    const resumeFile = candidate.resumeFile;
    const fileStorageKey = resumeFile?.storageKey || '';
    const originalLink = (candidate.resumeLinkOriginal || '').trim();
    const downloadLink = (candidate.resumeLinkDownload || '').trim();
    const custom = (candidate.customFields && typeof candidate.customFields === 'object')
      ? { ...candidate.customFields }
      : {};

    // 1. Check if Category B - localhost:4000 format that can be repaired
    if (resumeFile && (fileStorageKey.includes('localhost:4000') || fileStorageKey.includes('127.0.0.1:4000'))) {
      if (resumeFile.fileData && resumeFile.fileData.length > 0) {
        // REPAIRABLE! Convert to db://<id>
        const newKey = `db://${resumeFile.id}`;
        await prisma.fileMeta.update({
          where: { id: resumeFile.id },
          data: { storageKey: newKey },
        });
        // Clear any old missing flags if present
        if (custom.resumeStatus || custom.resumeUnavailableReason) {
          delete custom.resumeStatus;
          delete custom.resumeUnavailableReason;
          await prisma.candidate.update({
            where: { id: candidate.id },
            data: { customFields: Object.keys(custom).length ? custom : null },
          });
        }
        repairedCount++;
        console.log(`[REPAIRED] Candidate ${candidate.id} (${candidate.fullName}) — Updated FileMeta ${resumeFile.id} storageKey to ${newKey}`);
        continue;
      }
    }

    // 2. Check if DB binary exists and is valid
    if (resumeFile && (fileStorageKey.startsWith('db://') || (resumeFile.fileData && resumeFile.fileData.length > 0))) {
      if (resumeFile.fileData && resumeFile.fileData.length > 0) {
        unchangedOkCount++;
        continue;
      }
    }

    // 3. Check if valid external Google Drive link
    const isGoogleDrive = (originalLink && originalLink.includes('drive.google.com')) || (downloadLink && downloadLink.includes('drive.google.com'));
    if (isGoogleDrive) {
      unchangedOkCount++;
      continue;
    }

    // 4. Handle Unrecoverable: Category B file:///
    if (originalLink.startsWith('file:///') || downloadLink.startsWith('file:///')) {
      const reason = 'Stored resume link was a local file:/// path on recruiter device; file was never uploaded to server.';
      custom.resumeStatus = 'MISSING';
      custom.resumeUnavailableReason = reason;

      await prisma.candidate.update({
        where: { id: candidate.id },
        data: { customFields: custom },
      });

      flaggedMissingCount++;
      candidatesNeedingReupload.push({
        candidateId: candidate.id,
        fullName: candidate.fullName,
        phone: candidate.phone,
        email: candidate.email,
        jobRole: candidate.applications?.[0]?.job?.title || candidate.preferredRole || 'N/A',
        category: 'Category B (Local file:/// path)',
        reason,
        createdAt: candidate.createdAt.toISOString(),
      });
      continue;
    }

    // 5. Handle Unrecoverable: Category E / G Cloudinary URLs
    const isCloudinary = (fileStorageKey && fileStorageKey.includes('cloudinary.com')) ||
      (originalLink && originalLink.includes('cloudinary.com')) ||
      (downloadLink && downloadLink.includes('cloudinary.com'));

    if (isCloudinary) {
      const reason = 'Legacy Cloudinary storage account is defunct. File is permanently unrecoverable from third-party host.';
      custom.resumeStatus = 'MISSING';
      custom.resumeUnavailableReason = reason;

      await prisma.candidate.update({
        where: { id: candidate.id },
        data: { customFields: custom },
      });

      flaggedMissingCount++;
      candidatesNeedingReupload.push({
        candidateId: candidate.id,
        fullName: candidate.fullName,
        phone: candidate.phone,
        email: candidate.email,
        jobRole: candidate.applications?.[0]?.job?.title || candidate.preferredRole || 'N/A',
        category: 'Category E/G (Defunct Cloudinary)',
        reason,
        createdAt: candidate.createdAt.toISOString(),
      });
      continue;
    }

    // 6. Handle Unrecoverable: Category D (Expired S3 or orphaned reference)
    if (originalLink.includes('s3') || downloadLink.includes('s3') || (!resumeFile?.fileData && !isGoogleDrive)) {
      const reason = 'External storage link expired or file object does not exist in persistent storage.';
      custom.resumeStatus = 'MISSING';
      custom.resumeUnavailableReason = reason;

      await prisma.candidate.update({
        where: { id: candidate.id },
        data: { customFields: custom },
      });

      flaggedMissingCount++;
      candidatesNeedingReupload.push({
        candidateId: candidate.id,
        fullName: candidate.fullName,
        phone: candidate.phone,
        email: candidate.email,
        jobRole: candidate.applications?.[0]?.job?.title || candidate.preferredRole || 'N/A',
        category: 'Category D (Orphaned / Expired Storage Object)',
        reason,
        createdAt: candidate.createdAt.toISOString(),
      });
      continue;
    }
  }

  console.log('\n=== MIGRATION COMPLETE ===');
  console.log(`Total Candidates Processed: ${candidates.length}`);
  console.log(`- Repaired (Category B localhost:4000 -> db://): ${repairedCount}`);
  console.log(`- Verified OK (DB BLOB / Google Drive):         ${unchangedOkCount}`);
  console.log(`- Flagged MISSING (Recruiter action required):  ${flaggedMissingCount}`);

  // Save actionable export for recruiters
  const exportPath = path.join(__dirname, 'candidates_needing_resume_reupload.json');
  fs.writeFileSync(exportPath, JSON.stringify(candidatesNeedingReupload, null, 2), 'utf8');
  console.log(`\nActionable list saved to: ${exportPath}`);

  // Also write CSV version for recruiters
  const csvHeaders = 'Candidate ID,Full Name,Phone,Email,Job Role,Failure Category,Reason,Created Date\n';
  const csvRows = candidatesNeedingReupload.map(c => 
    `"${c.candidateId}","${c.fullName.replace(/"/g, '""')}","${c.phone}","${c.email || ''}","${(c.jobRole || '').replace(/"/g, '""')}","${c.category}","${c.reason.replace(/"/g, '""')}","${c.createdAt}"`
  ).join('\n');
  const csvPath = path.join(__dirname, 'candidates_needing_resume_reupload.csv');
  fs.writeFileSync(csvPath, csvHeaders + csvRows, 'utf8');
  console.log(`Recruiter CSV export saved to: ${csvPath}\n`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
