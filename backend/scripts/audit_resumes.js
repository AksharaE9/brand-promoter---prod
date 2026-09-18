'use strict';

/**
 * audit_resumes.js
 *
 * Full Resume Reconciliation Audit (Phase 1)
 *
 * High-performance, low-memory audit script that pre-fetches file metadata in a single query,
 * verifies local/remote/DB integrity without transferring binary files, classifies every
 * record into Categories A-G, and analyzes correlations with creation dates and filenames.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

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

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

function probeHttpUrl(urlStr, timeoutMs = 2500) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(urlStr);
      const client = parsed.protocol === 'https:' ? https : http;

      const req = client.request(
        urlStr,
        {
          method: 'GET',
          headers: {
            Range: 'bytes=0-100',
            'User-Agent': 'ATS-Resume-Audit/1.0',
          },
          timeout: timeoutMs,
        },
        (res) => {
          const statusCode = res.statusCode || 0;
          const contentType = res.headers['content-type'] || '';
          let contentLength = null;

          if (res.headers['content-length']) {
            contentLength = parseInt(res.headers['content-length'], 10);
          } else if (res.headers['content-range']) {
            const match = res.headers['content-range'].match(/\/(\d+)/);
            if (match) contentLength = parseInt(match[1], 10);
          }

          res.on('data', () => {});
          res.on('end', () => {
            resolve({ statusCode, contentType, contentLength, error: null });
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        resolve({ statusCode: 408, contentType: '', contentLength: null, error: 'Timeout' });
      });

      req.on('error', (err) => {
        resolve({ statusCode: 0, contentType: '', contentLength: null, error: err.message });
      });

      req.end();
    } catch (err) {
      resolve({ statusCode: 0, contentType: '', contentLength: null, error: err.message });
    }
  });
}

function hasSpecialCharacters(str) {
  if (!str) return false;
  const hasMultipleDots = (str.match(/\./g) || []).length > 1;
  const hasSpaces = /\s/.test(str);
  const hasParen = /[()]/.test(str);
  const hasSpecialPunctuation = /[&#+]/.test(str);
  const hasNonAscii = /[^\x00-\x7F]/.test(str);
  return hasMultipleDots || hasSpaces || hasParen || hasSpecialPunctuation || hasNonAscii;
}

async function audit() {
  console.log('======================================================================');
  console.log('  FULL ATS RESUME RECONCILIATION AUDIT (PHASE 1)');
  console.log('======================================================================\n');

  // 1. Pre-fetch file_metas stats in 1 fast query (size of binary, has_data)
  console.log('Pre-fetching file_metas metadata...');
  const fileMetasRaw = await prisma.$queryRaw`
    SELECT id, "storageKey", "originalName", "mimeType", "sizeBytes", 
           LENGTH("file_data") as data_length, 
           ("file_data" IS NOT NULL AND LENGTH("file_data") > 0) as has_data
    FROM "file_metas"
  `;
  const fileMetaMap = new Map();
  fileMetasRaw.forEach((f) => fileMetaMap.set(f.id, f));
  console.log(`Loaded metadata for ${fileMetaMap.size} file_metas records in DB.`);

  // 2. Fetch all candidate records claiming resumes
  const candidates = await prisma.candidate.findMany({
    where: {
      OR: [
        { resumeFileId: { not: null } },
        { resumeLinkOriginal: { not: null } },
        { resumeLinkDownload: { not: null } },
      ],
    },
    select: {
      id: true,
      fullName: true,
      createdAt: true,
      resumeFileId: true,
      resumeLinkOriginal: true,
      resumeLinkDownload: true,
      resumeLinkProvider: true,
      customFields: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Total Candidates with Resume Claims in DB: ${candidates.length}\n`);

  const categoryCounts = {
    OK: 0,
    CATEGORY_A_EPHEMERAL_LOSS: 0,
    CATEGORY_B_LEGACY_URL_FORMAT: 0,
    CATEGORY_C_RETURNS_HTML: 0,
    CATEGORY_D_ORPHANED_DB_ROW: 0,
    CATEGORY_E_FILENAME_RELATED: 0,
    CATEGORY_F_ZERO_BYTE: 0,
    CATEGORY_G_AUTH_ACCESS: 0,
    OTHER_BROKEN: 0,
  };

  const auditRows = [];
  const examplesByCategory = {};

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const resumeFileId = c.resumeFileId;
    const resumeFile = resumeFileId ? fileMetaMap.get(resumeFileId) : null;
    const resumeLink = (c.resumeLinkOriginal || c.resumeLinkDownload || '').trim();

    let storedRef = '';
    let urlScheme = '';
    let storageBackend = '';
    let originalName = '';
    let fetchStatus = null;
    let contentType = '';
    let contentLength = null;
    let verdict = 'OK';
    let category = null;
    let reason = '';

    if (resumeFileId) {
      if (!resumeFile) {
        storedRef = `file_metas ID: ${resumeFileId}`;
        originalName = 'unknown';
        urlScheme = 'db://orphan_id';
        storageBackend = 'Missing file_metas DB row';
        verdict = 'BROKEN';
        category = 'CATEGORY_D_ORPHANED_DB_ROW';
        reason = `candidate.resumeFileId points to non-existent file_metas ID (${resumeFileId})`;
      } else {
        storedRef = resumeFile.storageKey || '';
        originalName = resumeFile.originalName || '';
        urlScheme = storedRef.startsWith('db://') ? 'db://'
                  : storedRef.startsWith('http://') ? 'http://'
                  : storedRef.startsWith('https://') ? 'https://'
                  : storedRef.startsWith('/') ? 'relative_path'
                  : storedRef.startsWith('uploads/') ? 'uploads_relative'
                  : 'unknown';

        // A. PostgreSQL DB BLOB
        if (storedRef.startsWith('db://') || (!storedRef.startsWith('http') && !storedRef.startsWith('/'))) {
          storageBackend = 'PostgreSQL DB BLOB (file_metas)';
          const dataLength = Number(resumeFile.data_length || 0);

          if (!resumeFile.has_data || dataLength === 0) {
            verdict = 'BROKEN';
            category = 'CATEGORY_D_ORPHANED_DB_ROW';
            reason = 'file_metas record has NULL or empty file_data';
          } else {
            verdict = 'OK';
            fetchStatus = 200;
            contentType = resumeFile.mimeType || 'application/pdf';
            contentLength = dataLength;
          }
        }
        // B. Local disk path
        else if (storedRef.startsWith('/') || storedRef.startsWith('uploads/')) {
          storageBackend = 'Container Ephemeral Disk (/uploads/)';
          const cleanPath = storedRef.startsWith('/uploads/') ? storedRef.substring(9)
                          : storedRef.startsWith('uploads/') ? storedRef.substring(8)
                          : storedRef.replace(/^\/+/, '');
          const absPath = path.join(UPLOADS_DIR, cleanPath);
          const exists = fs.existsSync(absPath);

          if (!exists) {
            verdict = 'BROKEN';
            category = 'CATEGORY_A_EPHEMERAL_LOSS';
            reason = `Local disk file wiped by container redeploy (${storedRef})`;
            fetchStatus = 404;
          } else {
            const stats = fs.statSync(absPath);
            if (stats.size === 0) {
              verdict = 'BROKEN';
              category = 'CATEGORY_F_ZERO_BYTE';
              reason = 'Local disk file is 0 bytes';
              fetchStatus = 200;
              contentLength = 0;
            } else {
              verdict = 'OK (local disk - vulnerable to redeploys)';
              fetchStatus = 200;
              contentLength = stats.size;
              contentType = resumeFile.mimeType || 'application/pdf';
            }
          }
        }
        // C. Remote HTTP / Cloud URL
        else if (storedRef.startsWith('http://') || storedRef.startsWith('https://')) {
          storageBackend = 'Remote HTTP / Cloud URL';
          if (storedRef.includes('localhost:') || storedRef.includes('127.0.0.1')) {
            verdict = 'BROKEN';
            category = 'CATEGORY_B_LEGACY_URL_FORMAT';
            reason = `Stored reference points to localhost (${storedRef})`;
          } else {
            const probe = await probeHttpUrl(storedRef, 2500);
            fetchStatus = probe.statusCode;
            contentType = probe.contentType;
            contentLength = probe.contentLength;

            if (probe.statusCode >= 200 && probe.statusCode < 400) {
              if (probe.contentType.includes('text/html')) {
                verdict = 'BROKEN';
                category = 'CATEGORY_C_RETURNS_HTML';
                reason = `Returned HTTP ${probe.statusCode} with text/html Content-Type (SPA catch-all / error page)`;
              } else if (contentLength === 0) {
                verdict = 'BROKEN';
                category = 'CATEGORY_F_ZERO_BYTE';
                reason = 'HTTP response has 0 Content-Length';
              } else {
                verdict = 'OK';
              }
            } else if (probe.statusCode === 401 || probe.statusCode === 403) {
              verdict = 'BROKEN';
              category = 'CATEGORY_G_AUTH_ACCESS';
              reason = `HTTP ${probe.statusCode} Auth/Access denied or signed URL expired`;
            } else if (probe.statusCode === 404) {
              verdict = 'BROKEN';
              category = 'CATEGORY_D_ORPHANED_DB_ROW';
              reason = `HTTP 404 Remote file not found`;
            } else {
              verdict = 'BROKEN';
              category = 'OTHER_BROKEN';
              reason = `HTTP probe returned status ${probe.statusCode} (${probe.error || 'N/A'})`;
            }
          }
        } else {
          storageBackend = 'Unknown key format';
          verdict = 'BROKEN';
          category = 'CATEGORY_B_LEGACY_URL_FORMAT';
          reason = `Unknown storage key format: "${storedRef}"`;
        }
      }
    } else if (resumeLink) {
      storedRef = resumeLink;
      originalName = c.fullName ? `${c.fullName}-resume` : 'cloud-resume';
      urlScheme = storedRef.startsWith('https://') ? 'https://'
                : storedRef.startsWith('http://') ? 'http://'
                : storedRef.startsWith('db://') ? 'db://'
                : 'other';

      if (storedRef.startsWith('http://') || storedRef.startsWith('https://')) {
        const isGoogleDrive = storedRef.includes('drive.google.com') || c.resumeLinkProvider === 'google_drive';
        storageBackend = isGoogleDrive ? 'Google Drive Cloud Link' : 'External Cloud Link';

        if (storedRef.includes('localhost:') || storedRef.includes('127.0.0.1')) {
          verdict = 'BROKEN';
          category = 'CATEGORY_B_LEGACY_URL_FORMAT';
          reason = `Stored link points to localhost (${storedRef})`;
        } else if (isGoogleDrive) {
          verdict = 'OK (External Google Drive Link)';
          fetchStatus = 200;
          contentType = 'text/html / google_drive_viewer';
        } else {
          const probe = await probeHttpUrl(storedRef, 2500);
          fetchStatus = probe.statusCode;
          contentType = probe.contentType;
          contentLength = probe.contentLength;

          if (probe.statusCode >= 200 && probe.statusCode < 400) {
            verdict = 'OK';
          } else {
            verdict = 'BROKEN';
            category = 'CATEGORY_D_ORPHANED_DB_ROW';
            reason = `External link probe failed with HTTP ${probe.statusCode}`;
          }
        }
      } else {
        storageBackend = 'Malformed cloud link';
        verdict = 'BROKEN';
        category = 'CATEGORY_B_LEGACY_URL_FORMAT';
        reason = `Invalid link format: "${storedRef}"`;
      }
    }

    const hasSpecialName = hasSpecialCharacters(originalName);
    if (verdict.startsWith('BROKEN') && hasSpecialName && category !== 'CATEGORY_A_EPHEMERAL_LOSS') {
      if (storedRef.includes(originalName) || !storedRef.startsWith('db://')) {
        category = 'CATEGORY_E_FILENAME_RELATED';
        reason = `Filename contains special characters/spaces/dots: "${originalName}"`;
      }
    }

    if (verdict.startsWith('OK')) {
      categoryCounts.OK++;
    } else if (category && categoryCounts[category] !== undefined) {
      categoryCounts[category]++;
      if (!examplesByCategory[category]) examplesByCategory[category] = [];
      if (examplesByCategory[category].length < 5) {
        examplesByCategory[category].push({
          candidateId: c.id,
          name: c.fullName,
          createdAt: c.createdAt.toISOString().split('T')[0],
          storedRef,
          originalName,
          reason,
        });
      }
    } else {
      categoryCounts.OTHER_BROKEN++;
    }

    auditRows.push({
      candidateId: c.id,
      name: c.fullName,
      createdAt: c.createdAt.toISOString().split('T')[0],
      storedRef,
      urlScheme,
      storageBackend,
      originalName,
      hasSpecialName,
      fetchStatus,
      contentType,
      contentLength,
      verdict,
      category,
      reason,
    });
  }

  console.log('======================================================================');
  console.log('  AUDIT CLASSIFICATION SUMMARY');
  console.log('======================================================================');
  console.log(`Total Candidates Claiming Resume : ${candidates.length}`);
  console.log(`Verified OK                      : ${categoryCounts.OK}`);
  console.log(`Category A (Ephemeral Loss)      : ${categoryCounts.CATEGORY_A_EPHEMERAL_LOSS}`);
  console.log(`Category B (Legacy URL Format)   : ${categoryCounts.CATEGORY_B_LEGACY_URL_FORMAT}`);
  console.log(`Category C (Returns HTML)        : ${categoryCounts.CATEGORY_C_RETURNS_HTML}`);
  console.log(`Category D (Orphaned DB Row)     : ${categoryCounts.CATEGORY_D_ORPHANED_DB_ROW}`);
  console.log(`Category E (Filename-Related)    : ${categoryCounts.CATEGORY_E_FILENAME_RELATED}`);
  console.log(`Category F (Zero-Byte File)      : ${categoryCounts.CATEGORY_F_ZERO_BYTE}`);
  console.log(`Category G (Auth / Expired URL)  : ${categoryCounts.CATEGORY_G_AUTH_ACCESS}`);
  console.log(`Other Broken                     : ${categoryCounts.OTHER_BROKEN}`);
  console.log('======================================================================\n');

  console.log('--- EXAMPLES BY BROKEN CATEGORY ---');
  for (const [cat, examples] of Object.entries(examplesByCategory)) {
    console.log(`\n[${cat}] (${categoryCounts[cat]} total):`);
    examples.forEach((ex) => {
      console.log(`  - Candidate ID: ${ex.candidateId} | Name: "${ex.name}" | Created: ${ex.createdAt}`);
      console.log(`    Stored Ref  : "${ex.storedRef}"`);
      console.log(`    Filename    : "${ex.originalName}"`);
      console.log(`    Failure     : ${ex.reason}`);
    });
  }

  // Correlation analysis
  console.log('\n======================================================================');
  console.log('  CORRELATION ANALYSIS: CREATION DATE & FILENAMES');
  console.log('======================================================================');

  const monthBreakdown = {};
  auditRows.forEach((r) => {
    const month = r.createdAt.substring(0, 7); // YYYY-MM
    if (!monthBreakdown[month]) {
      monthBreakdown[month] = { total: 0, ok: 0, broken: 0, ephemeral: 0, dbBlob: 0, cloudLink: 0 };
    }
    monthBreakdown[month].total++;
    if (r.verdict.startsWith('OK')) monthBreakdown[month].ok++;
    else monthBreakdown[month].broken++;
    if (r.category === 'CATEGORY_A_EPHEMERAL_LOSS') monthBreakdown[month].ephemeral++;
    if (r.storageBackend.includes('DB BLOB')) monthBreakdown[month].dbBlob++;
    if (r.storageBackend.includes('Cloud')) monthBreakdown[month].cloudLink++;
  });

  console.log('Month Breakdown (YYYY-MM):');
  console.table(monthBreakdown);

  // Filename characteristics analysis
  const brokenWithSpecialNames = auditRows.filter((r) => !r.verdict.startsWith('OK') && r.hasSpecialName).length;
  const okWithSpecialNames = auditRows.filter((r) => r.verdict.startsWith('OK') && r.hasSpecialName).length;
  console.log(`\nResumes with spaces, multiple dots, parentheses, or non-ASCII in filename:`);
  console.log(`  - Total with special filenames: ${brokenWithSpecialNames + okWithSpecialNames}`);
  console.log(`  - OK with special filenames   : ${okWithSpecialNames}`);
  console.log(`  - Broken with special names   : ${brokenWithSpecialNames}`);

  // Save audit results to JSON artifact
  fs.writeFileSync(
    path.join(__dirname, 'resume_audit_results.json'),
    JSON.stringify({ categoryCounts, examplesByCategory, monthBreakdown, auditRows }, null, 2)
  );

  await prisma.$disconnect();
  return { categoryCounts, examplesByCategory, monthBreakdown, auditRows };
}

if (require.main === module) {
  audit().catch((err) => {
    console.error('Fatal audit error:', err);
    process.exit(1);
  });
}

module.exports = { audit };
