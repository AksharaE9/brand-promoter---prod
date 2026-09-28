'use strict';
const fs = require('fs');
const XLSX = require('xlsx');
const prisma = require('../src/config/db');

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

async function run() {
  const files = {
    SELECTED: 'C:/Users/ASUS/Downloads/Cambridge_Selected.xlsx',
    REJECTED: 'C:/Users/ASUS/Downloads/Cambridge_Rejected.xlsx',
    ON_HOLD: 'C:/Users/ASUS/Downloads/Cambrige_OnHold.xlsx'
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

  rows.sort((a, b) => Number(a['#']) - Number(b['#']));

  const allCandidates = await prisma.candidate.findMany({
    where: { isDeleted: false },
    select: { id: true, fullName: true, email: true, phone: true, college: true, preferredRole: true, status: true }
  });

  const table = [];
  for (const r of rows) {
    const rawName = String(r['Name'] || '');
    const cleanName = rawName.replace(/[\*\s]+/g, ' ').trim();
    const serial = Number(r['#']);
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

    let action = 'CREATE';
    if (serial === 31 || serial === 29) {
      action = 'HOLD (Misfile Check)';
    } else if (bestScore >= 0.85) {
      action = 'CREATE (Confirmed Distinct)';
    }

    table.push({
      serial,
      name: rawName,
      list,
      panelist: r['Panelist'] || 'BLANK',
      role: r['Role'],
      rating: r['Rating'] === null || r['Rating'] === undefined ? 'BLANK' : r['Rating'],
      existingMatch: bestScore >= 0.85 ? 'Yes' : 'No',
      matchType: bestScore >= 0.85 ? matchType : 'none',
      score: Number(bestScore.toFixed(2)),
      matchDetails: bestScore >= 0.85 ? `${bestMatch.fullName} [${bestMatch.id}]` : '-',
      action
    });
  }

  console.log(JSON.stringify(table, null, 2));
  await prisma.$disconnect();
}

run().catch(console.error);
