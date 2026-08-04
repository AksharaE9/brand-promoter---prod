/**
 * migrate-local-resumes-to-cloudinary.js
 *
 * Runs locally to upload all local files from backend/uploads/ats-resumes/ to Cloudinary,
 * and updates their storage keys in the database.
 * If files are missing/unrecoverable, flags them as such in the candidate's customFields.
 */

'use strict';

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const { uploadFileToCloudinary } = require('../src/config/cloudinary');

const prisma = new PrismaClient();
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

async function main() {
  console.log('════════════════════════════════════════════════════════════');
  console.log('  ATS Resume Migration to Cloudinary & Status Cleanup');
  console.log('════════════════════════════════════════════════════════════\n');

  try {
    // 1. Fetch all candidates with their resumeFile metadata
    const candidates = await prisma.candidate.findMany({
      where: { isDeleted: false },
      include: { resumeFile: true }
    });

    console.log(`Found ${candidates.length} active candidates in the database.`);

    let migratedCount = 0;
    let missingCount = 0;
    let skippedCount = 0;
    const missingCandidatesList = [];

    for (const candidate of candidates) {
      const fileMeta = candidate.resumeFile;
      if (!fileMeta) {
        skippedCount++;
        continue;
      }

      const storageKey = fileMeta.storageKey || '';
      const isAbsolute = storageKey.startsWith('http://') || storageKey.startsWith('https://');

      // If it's already an absolute URL (like a Cloudinary URL or Google Drive link), skip upload
      if (isAbsolute) {
        skippedCount++;
        continue;
      }

      // Resolve relative path
      const relativePath = storageKey.startsWith('/') ? storageKey.slice(1) : storageKey;
      const localFilePath = path.join(__dirname, '..', relativePath);

      if (fs.existsSync(localFilePath)) {
        // File exists locally! Upload to Cloudinary.
        console.log(`Uploading local file for candidate [${candidate.fullName}]: ${relativePath}...`);
        const buffer = fs.readFileSync(localFilePath);
        const mimeType = fileMeta.mimeType || 'application/pdf';

        const cloudUrl = await uploadFileToCloudinary(buffer, relativePath, mimeType);
        if (cloudUrl && cloudUrl.startsWith('http')) {
          // Update FileMeta in database
          await prisma.fileMeta.update({
            where: { id: fileMeta.id },
            data: { storageKey: cloudUrl }
          });
          console.log(`  └─ Success: ${cloudUrl}\n`);
          migratedCount++;
        } else {
          console.warn(`  └─ Failed Cloudinary upload for candidate [${candidate.fullName}]\n`);
        }
      } else {
        // Local file does not exist! It is unrecoverable.
        console.warn(`⚠️  File missing on disk for candidate [${candidate.fullName}]: ${relativePath}`);
        
        // Flag candidate customFields
        const currentCustomFields = candidate.customFields && typeof candidate.customFields === 'object'
          ? candidate.customFields
          : {};
        
        await prisma.candidate.update({
          where: { id: candidate.id },
          data: {
            customFields: {
              ...currentCustomFields,
              resumeStatus: 'missing'
            }
          }
        });

        missingCount++;
        missingCandidatesList.push({
          id: candidate.id,
          fullName: candidate.fullName,
          email: candidate.email,
          phone: candidate.phone,
          expectedKey: storageKey,
          createdAt: candidate.createdAt
        });
      }
    }

    // 2. Scan for any remaining orphaned file_metas that point to missing local files
    console.log('\nScanning for remaining local file_metas...');
    const allFileMetas = await prisma.fileMeta.findMany();
    let orphanedMissingCount = 0;
    
    for (const fm of allFileMetas) {
      const storageKey = fm.storageKey || '';
      const isAbsolute = storageKey.startsWith('http://') || storageKey.startsWith('https://');
      if (isAbsolute) continue;

      const relativePath = storageKey.startsWith('/') ? storageKey.slice(1) : storageKey;
      const localFilePath = path.join(__dirname, '..', relativePath);
      if (!fs.existsSync(localFilePath)) {
        // Orphans: check if they are linked to any candidate and update
        const linkedCandidates = await prisma.candidate.findMany({
          where: { resumeFileId: fm.id }
        });
        for (const lc of linkedCandidates) {
          const currentCustomFields = lc.customFields && typeof lc.customFields === 'object' ? lc.customFields : {};
          await prisma.candidate.update({
            where: { id: lc.id },
            data: {
              customFields: {
                ...currentCustomFields,
                resumeStatus: 'missing'
              }
            }
          });
          orphanedMissingCount++;
        }
      }
    }

    console.log('\n════════════════════════════════════════════════════════════');
    console.log('  MIGRATION SUMMARY');
    console.log('════════════════════════════════════════════════════════════');
    console.log(`  Candidates Migrated successfully : ${migratedCount}`);
    console.log(`  Missing / Unrecoverable Resumes   : ${missingCount + orphanedMissingCount}`);
    console.log(`  Skipped (Already cloud/no resume) : ${skippedCount}`);
    console.log('════════════════════════════════════════════════════════════\n');

    if (missingCandidatesList.length > 0) {
      console.log('🚨 UNRECOVERABLE CANDIDATE RESUMES:');
      console.table(missingCandidatesList.map(c => ({
        Name: c.fullName,
        Email: c.email,
        Phone: c.phone,
        ExpectedPath: c.expectedKey,
        CreatedAt: c.createdAt.toISOString()
      })));
    }

  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
