'use strict';
const fs = require('fs');
const XLSX = require('xlsx');
const prisma = require('../src/config/db');

async function run() {
  // 1. Read files
  const files = {
    selected: 'C:/Users/ASUS/Downloads/Cambridge_Selected.xlsx',
    rejected: 'C:/Users/ASUS/Downloads/Cambridge_Rejected.xlsx',
    onHold: 'C:/Users/ASUS/Downloads/Cambrige_OnHold.xlsx'
  };

  const rows = [];
  for (const [listType, filePath] of Object.entries(files)) {
    const wb = XLSX.readFile(filePath);
    const sheetName = wb.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
    const headers = data[0];
    for (let i = 1; i < data.length; i++) {
      const r = data[i];
      if (!r || r.length === 0 || r[0] === undefined || r[0] === null || r[0] === '') continue;
      const rowObj = {};
      headers.forEach((h, idx) => {
        rowObj[h] = r[idx] !== undefined ? r[idx] : null;
      });
      rowObj._list = listType;
      rows.push(rowObj);
    }
  }

  // Sort rows by serial #
  rows.sort((a, b) => Number(a['#']) - Number(b['#']));
  console.log('Total candidates found across files:', rows.length);

  // Check serial numbers present vs missing
  const serials = rows.map(r => Number(r['#']));
  console.log('Serials list:', serials.join(', '));
  for (let i = 1; i <= 36; i++) {
    if (!serials.includes(i)) {
      console.log('MISSING SERIAL NUMBER:', i);
    }
  }

  // 2. Query DB Users
  const users = await prisma.user.findMany({
    where: { isDeleted: false },
    select: { id: true, fullName: true, email: true, role: true }
  });
  console.log('\n--- USERS in DB ---');
  users.forEach(u => console.log(`ID: ${u.id}, Name: "${u.fullName}", Email: "${u.email}", Role: ${u.role}`));

  // 3. Query DB Colleges
  const colleges = await prisma.college.findMany();
  console.log('\n--- COLLEGES in DB ---');
  colleges.forEach(c => console.log(`ID: ${c.id}, Name: "${c.name}", Location: "${c.location}"`));

  // 4. Query DB College Drives
  const drives = await prisma.collegeDrive.findMany();
  console.log('\n--- COLLEGE DRIVES in DB ---');
  drives.forEach(d => console.log(`ID: ${d.id}, Title: "${d.title}", CollegeId: "${d.collegeId}", DateFrom: "${d.dateFrom}"`));

  // 5. Query DB Jobs
  const jobs = await prisma.job.findMany();
  console.log('\n--- JOBS in DB ---');
  jobs.forEach(j => console.log(`ID: ${j.id}, Title: "${j.title}", Dept: "${j.department}", Active: ${j.isActive}`));

  // 6. Query DB Candidates to match against names
  const allCandidates = await prisma.candidate.findMany({
    where: { isDeleted: false },
    select: { id: true, fullName: true, email: true, phone: true, college: true, preferredRole: true, status: true }
  });
  console.log('\nTotal active candidates in DB:', allCandidates.length);

  // Levenshtein / similarity helper
  function similarity(s1, s2) {
    s1 = (s1 || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    s2 = (s2 || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (s1 === s2) return 1.0;
    if (!s1 || !s2) return 0.0;
    const l1 = s1.length, l2 = s2.length;
    const d = [];
    for (let i = 0; i <= l1; i++) {
      d[i] = [i];
      for (let j = 1; j <= l2; j++) {
        if (i === 0) { d[i][j] = j; }
        else {
          const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
          d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        }
      }
    }
    const maxLen = Math.max(l1, l2);
    return 1 - (d[l1][l2] / maxLen);
  }

  console.log('\n--- CANDIDATE DUPLICATE SEARCH RESULTS ---');
  const matchResults = [];
  for (const r of rows) {
    const rawName = String(r['Name'] || '');
    const cleanName = rawName.replace(/[\*\s]+/g, ' ').trim();
    const serial = r['#'];
    const list = r._list;

    let bestMatch = null;
    let bestScore = 0;
    let matchType = 'none';

    for (const cand of allCandidates) {
      const dbName = cand.fullName || '';
      const normDb = dbName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normRaw = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '');
      
      if (normDb === normRaw) {
        bestMatch = cand;
        bestScore = 1.0;
        matchType = 'exact';
        break;
      }

      const score = similarity(cleanName, dbName);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = cand;
      }
    }

    if (bestScore >= 0.85 && matchType !== 'exact') {
      matchType = `fuzzy (${bestScore.toFixed(2)})`;
    }

    matchResults.push({
      serial,
      name: rawName,
      list,
      existingMatch: bestScore >= 0.85 ? 'Yes' : 'No',
      matchType: bestScore >= 0.85 ? matchType : 'none',
      score: Number(bestScore.toFixed(2)),
      matchedDetails: bestScore >= 0.85 ? `${bestMatch.fullName} (ID: ${bestMatch.id}, College: ${bestMatch.college})` : 'None',
      action: bestScore >= 0.85 ? (matchType === 'exact' ? 'ADD ROUND' : 'HOLD') : 'CREATE'
    });
  }

  console.table(matchResults);

  // Check ratings details
  console.log('\n--- RATINGS BREAKDOWN ---');
  const ratingCounts = {};
  rows.forEach(r => {
    const rating = r['Rating'];
    const key = rating === null || rating === undefined ? 'BLANK' : rating;
    ratingCounts[key] = (ratingCounts[key] || 0) + 1;
  });
  console.log(ratingCounts);

  // Check rows with 7.5 rating
  console.log('\n--- ROWS WITH 7.5 RATING ---');
  const r75 = rows.filter(r => r['Rating'] == 7.5);
  r75.forEach(r => console.log(`#${r['#']} ${r['Name']} [${r._list}] Panelist: ${r['Panelist']}, Comments: ${r['Comments']}`));

  // Check panelist distribution
  console.log('\n--- PANELIST DISTRIBUTION ---');
  const panelistCounts = {};
  rows.forEach(r => {
    const p = r['Panelist'] || 'BLANK';
    panelistCounts[p] = (panelistCounts[p] || 0) + 1;
  });
  console.log(panelistCounts);

  // Check roles distribution
  console.log('\n--- ROLES DISTRIBUTION ---');
  const roleCounts = {};
  rows.forEach(r => {
    const role = r['Role'] || 'BLANK';
    roleCounts[role] = (roleCounts[role] || 0) + 1;
  });
  console.log(roleCounts);

  // Check specific candidates mentioned in prompt
  console.log('\n--- CANDIDATES HIGHLIGHTED IN PROMPT ---');
  const specificSerials = [9, 10, 16, 21, 29, 30, 31];
  rows.filter(r => specificSerials.includes(Number(r['#']))).forEach(r => {
    console.log(`\n#${r['#']} ${r['Name']} [${r._list}]`);
    console.log(`  Panelist: ${r['Panelist']}`);
    console.log(`  Role: ${r['Role']}`);
    console.log(`  Rating: ${r['Rating']}`);
    console.log(`  Comments: ${r['Comments']}`);
    console.log(`  Other Notes: ${r['Other Notes']}`);
    console.log(`  DOJ: ${r['DOJ']}`);
  });

  await prisma.$disconnect();
}

run().catch(console.error);
