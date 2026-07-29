/**
 * audit-local-files.js
 *
 * Verifies that all file paths registered in the database actually exist on the local disk.
 *
 * Run: node scripts/audit-local-files.js
 */

'use strict';

require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const RENDER_URL = process.env.DATABASE_URL || 'postgresql://ats_to2n_user:ixDs4gP0kpcwDfffaYASiVjJMIK7B7k0@dpg-d9kugflaeets73a88qhg-a.oregon-postgres.render.com/ats_to2n?sslmode=require';
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

function makeClient() {
  return new Client({
    connectionString: RENDER_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
}

function verifyLocalFile(dbUrl) {
  if (!dbUrl) return { exists: false, isLocal: false, path: null };
  if (!dbUrl.startsWith('/uploads/')) {
    return { exists: false, isLocal: false, path: dbUrl };
  }

  const relativePath = dbUrl.substring(9); // Strip '/uploads/'
  const absolutePath = path.join(UPLOADS_DIR, relativePath);
  const exists = fs.existsSync(absolutePath);

  return { exists, isLocal: true, path: absolutePath };
}

async function main() {
  const db = makeClient();
  await db.connect();

  console.log('═'.repeat(60));
  console.log('  ATS Local Storage Integrity Audit');
  console.log('═'.repeat(60));

  const stats = {
    file_metas: { total: 0, local: 0, present: 0, missing: 0, remote: 0 },
    interviews_offers: { total: 0, local: 0, present: 0, missing: 0, remote: 0 },
    recruitment_reports: { total: 0, local: 0, present: 0, missing: 0, remote: 0 },
    scheduling_files: { total: 0, local: 0, present: 0, missing: 0, remote: 0 }
  };

  const missingFiles = [];

  // 1. file_metas
  const fmRows = await db.query('SELECT id, "storageKey", "originalName" FROM file_metas');
  stats.file_metas.total = fmRows.rows.length;
  for (const row of fmRows.rows) {
    const check = verifyLocalFile(row.storageKey);
    if (check.isLocal) {
      stats.file_metas.local++;
      if (check.exists) stats.file_metas.present++;
      else {
        stats.file_metas.missing++;
        missingFiles.push({ table: 'file_metas', id: row.id, name: row.originalName, path: check.path });
      }
    } else {
      stats.file_metas.remote++;
    }
  }

  // 2. interviews (offerLetterUrl)
  const ivRows = await db.query('SELECT id, "offerLetterUrl" FROM interviews WHERE "offerLetterUrl" IS NOT NULL');
  stats.interviews_offers.total = ivRows.rows.length;
  for (const row of ivRows.rows) {
    const check = verifyLocalFile(row.offerLetterUrl);
    if (check.isLocal) {
      stats.interviews_offers.local++;
      if (check.exists) stats.interviews_offers.present++;
      else {
        stats.interviews_offers.missing++;
        missingFiles.push({ table: 'interviews (offerLetter)', id: row.id, name: 'Offer Letter', path: check.path });
      }
    } else {
      stats.interviews_offers.remote++;
    }
  }

  // 3. recruitment_reports
  const repRows = await db.query('SELECT id, file_url, title FROM recruitment_reports WHERE file_url IS NOT NULL');
  stats.recruitment_reports.total = repRows.rows.length;
  for (const row of repRows.rows) {
    const check = verifyLocalFile(row.file_url);
    if (check.isLocal) {
      stats.recruitment_reports.local++;
      if (check.exists) stats.recruitment_reports.present++;
      else {
        stats.recruitment_reports.missing++;
        missingFiles.push({ table: 'recruitment_reports', id: row.id, name: row.title, path: check.path });
      }
    } else {
      stats.recruitment_reports.remote++;
    }
  }

  // 4. scheduling_member_files
  const sfRows = await db.query('SELECT id, file_url FROM scheduling_member_files WHERE file_url IS NOT NULL');
  stats.scheduling_files.total = sfRows.rows.length;
  for (const row of sfRows.rows) {
    const check = verifyLocalFile(row.file_url);
    if (check.isLocal) {
      stats.scheduling_files.local++;
      if (check.exists) stats.scheduling_files.present++;
      else {
        stats.scheduling_files.missing++;
        missingFiles.push({ table: 'scheduling_member_files', id: row.id, name: 'Scheduling File', path: check.path });
      }
    } else {
      stats.scheduling_files.remote++;
    }
  }

  console.log('\n📊 AUDIT RESULTS SUMMARY');
  console.log('═'.repeat(60));
  
  const tables = [
    { name: 'file_metas (Resumes/Photos)', data: stats.file_metas },
    { name: 'interviews (Offer Letters)', data: stats.interviews_offers },
    { name: 'recruitment_reports', data: stats.recruitment_reports },
    { name: 'scheduling_member_files', data: stats.scheduling_files }
  ];

  for (const t of tables) {
    console.log(`\n  * ${t.name}:`);
    console.log(`    Total Records   : ${t.data.total}`);
    console.log(`    Local Paths     : ${t.data.local}`);
    console.log(`    Verified Present: ${t.data.present}`);
    console.log(`    Missing Local   : ${t.data.missing}`);
    console.log(`    Remote URLs     : ${t.data.remote}`);
  }

  if (missingFiles.length > 0) {
    console.log('\n🚨 MISSING FILES DETECTED:');
    for (const file of missingFiles) {
      console.log(`  - [${file.table}] ID: ${file.id} | Name: ${file.name} | Expected Path: ${file.path}`);
    }
  } else {
    console.log('\n🎉 ALL LOCAL FILES VERIFIED PRESENT ON DISK!');
  }

  await db.end().catch(() => {});
}

main().catch(console.error);
