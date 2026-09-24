'use strict';
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const dbUrl = process.env.RENDER_DATABASE_URL || 
  'postgresql://ats_to2n_user:ixDs4gP0kpcwDfffaYASiVjJMIK7B7k0@dpg-d9kugflaeets73a88qhg-a.oregon-postgres.render.com/ats_to2n?sslmode=require';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: dbUrl,
    },
  },
});

// Levenshtein similarity calculation
function levenshteinSimilarity(s1, s2) {
  if (!s1 || !s2) return 0;
  const a = s1.toLowerCase().trim();
  const b = s2.toLowerCase().trim();
  if (a === b) return 1.0;
  
  const m = a.length;
  const n = b.length;
  if (m === 0) return n === 0 ? 1.0 : 0.0;
  if (n === 0) return 0.0;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  const maxLen = Math.max(m, n);
  return 1 - dp[m][n] / maxLen;
}

function normalizeName(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function runCheck() {
  console.log('=== USERS IN ATS ===');
  const allUsers = await prisma.user.findMany({
    select: { id: true, fullName: true, email: true, role: true, isActive: true, status: true }
  });
  console.log(allUsers);

  console.log('\n=== JOBS IN ATS ===');
  const allJobs = await prisma.job.findMany({
    select: { id: true, title: true, isActive: true, department: true, openingsCount: true }
  });
  console.log(allJobs);

  console.log('\n=== COLLEGES IN ATS ===');
  const allColleges = await prisma.college.findMany();
  console.log(allColleges);

  console.log('\n=== COLLEGE DRIVES IN ATS ===');
  const allDrives = await prisma.collegeDrive.findMany();
  console.log(allDrives);

  // Load candidate list from prompt/data
  const candidatesData = [
    { source_list: "Selected", source_row: 2, name: "Shamitha Krishna A", panelist: "Vinay Shetty", role: "Data Analyst Intern", rating: "7.5", doj: "28th Sept", status: "SELECTED" },
    { source_list: "Selected", source_row: 3, name: "Rakshitha S", panelist: "Vinay Shetty", role: "Data Analyst Intern", rating: "7", doj: "28th Sept", status: "SELECTED" },
    { source_list: "Selected", source_row: 4, name: "Ekta V Dhanunjaya", panelist: "Vinay Shetty", role: "Data Analyst Intern", rating: "7", doj: "28th Sept", status: "SELECTED" },
    { source_list: "Selected", source_row: 5, name: "Amrutha", panelist: "Vinay Shetty", role: "Data Analyst Intern", rating: "6", doj: "5th oct", status: "SELECTED" },
    { source_list: "Selected", source_row: 6, name: "Vijetha A naik", panelist: "Vinay Shetty", role: "Data Analyst Intern", rating: "7.5", doj: "28th Sept", status: "SELECTED" },
    { source_list: "Selected", source_row: 7, name: "Gaanavi B", panelist: "Vinay Shetty", role: "Data Analyst Intern", rating: "4", doj: "28th Sept", status: "SELECTED" },
    { source_list: "Selected", source_row: 8, name: "Theertha varshini D", panelist: "Vinay Shetty", role: "Business Analyst Intern", rating: "4", doj: "28th Sept", status: "SELECTED" },
    { source_list: "Selected", source_row: 9, name: "Divya S B", panelist: "Vinay Shetty", role: "Data Analyst Intern", rating: "7", doj: "28th Sept", status: "SELECTED" },
    { source_list: "Selected", source_row: 10, name: "Bindu Shree S", panelist: "Vinay Shetty", role: "Data Analyst Intern", rating: "7", doj: "28th Sept", status: "SELECTED" },
    { source_list: "Selected", source_row: 11, name: "Raksha G", panelist: "Vinay Shetty", role: "Data Analyst Intern", rating: "7", doj: "5th Oct", status: "SELECTED" },
    { source_list: "Selected", source_row: 12, name: "Devansh Verma", panelist: "Vinay Shetty", role: "Data Analyst Intern", rating: "7", doj: "5th Oct", status: "SELECTED" },
    { source_list: "Selected", source_row: 13, name: "Sohan M", panelist: "Vinay Shetty", role: "Business Analyst Intern", rating: "7", doj: "5th Oct", status: "SELECTED" },
    { source_list: "Selected", source_row: 14, name: "Apeksha S", panelist: "Vinay Shetty", role: "Data Analyst Intern", rating: "7", doj: "5th Oct", status: "SELECTED" },
    { source_list: "Selected", source_row: 15, name: "Vaishnavi", panelist: "Praneel", role: "Data Analyst Intern", rating: "7", doj: "October", status: "SELECTED" },
    { source_list: "Selected", source_row: 16, name: "Nisarga", panelist: "Praneel", role: "Data Analyst Intern", rating: "7", doj: "immediate", status: "SELECTED" },
    { source_list: "Selected", source_row: 17, name: "Pragathi GS", panelist: "Praneel", role: "Data Analyst Intern", rating: "7", doj: "immediate", status: "SELECTED" },
    { source_list: "Selected", source_row: 18, name: "Yashwant kumar", panelist: "Praneel", role: "Data Analyst Intern", rating: "7", doj: "immediate", status: "SELECTED" },
    { source_list: "Selected", source_row: 19, name: "shamya MJ", panelist: "Praneel", role: "Data Analyst Intern", rating: "7", doj: "immediate", status: "SELECTED" },
    { source_list: "Selected", source_row: 20, name: "swati", panelist: "Praneel", role: "Data Analyst Intern", rating: "8", doj: "immediate", status: "SELECTED" },
    { source_list: "Selected", source_row: 21, name: "chai l jain", panelist: "Praneel", role: "Data Analyst Intern", rating: "9", doj: "immediate", status: "SELECTED" },
    { source_list: "Selected", source_row: 22, name: "Santosh khul", panelist: "Praneel", role: "Data Analyst Intern", rating: "6", doj: "immediate", status: "SELECTED" },
    { source_list: "Selected", source_row: 23, name: "Bhumika S", panelist: "Praneel", role: "Data Analyst Intern", rating: "7", doj: "immediate", status: "SELECTED" },
    { source_list: "Selected", source_row: 24, name: "harshitha M Mary", panelist: "Praneel", role: "Data Analyst Intern", rating: "9", doj: "immediate", status: "SELECTED" },
    { source_list: "Selected", source_row: 25, name: "Sushmita TK", panelist: "Praneel", role: "Data Analyst Intern", rating: "8", doj: "immediate", status: "SELECTED" },
    { source_list: "Selected", source_row: 26, name: "hitha Sh", panelist: "Praneel", role: "Data Analyst Intern", rating: "8", doj: "immediate", status: "SELECTED" },
    { source_list: "Rejected", source_row: 2, name: "Yashaswini gowda", panelist: "Vinay Shetty", role: "Data Analyst Intern", rating: "5", doj: "5th Sept", status: "REJECTED" },
    { source_list: "Rejected", source_row: 3, name: "N reddy Kumari", panelist: "Vinay Shetty", role: "Data Analyst Intern", rating: "3", doj: "28th Sept", status: "REJECTED" },
    { source_list: "Rejected", source_row: 4, name: "Priyanka", panelist: "Vinay Shetty", role: "Data Analyst Intern", rating: "3", doj: "28th Sept", status: "REJECTED" },
    { source_list: "Rejected", source_row: 5, name: "Dyuti", panelist: "Vinay Shetty", role: "Data Analyst Intern", rating: "6", doj: "28th Sept", status: "REJECTED" },
    { source_list: "Rejected", source_row: 6, name: "Nithyashree T R", panelist: "Vinay Shetty", role: "Data Analyst Intern", rating: "4", doj: "28th Sept", status: "REJECTED" },
    { source_list: "Rejected", source_row: 7, name: "Punya H", panelist: "Vinay Shetty", role: "Data Analyst Intern", rating: "4", doj: "28th Sept", status: "REJECTED" },
    { source_list: "Rejected", source_row: 8, name: "Shubha D C", panelist: "Vinay Shetty", role: "Business Analyst Intern", rating: "4", doj: "28th Sept", status: "REJECTED" },
    { source_list: "Rejected", source_row: 9, name: "Sneha S", panelist: "Vinay Shetty", role: "Data Analyst Intern", rating: "6", doj: "28th Sept", status: "REJECTED" },
    { source_list: "Rejected", source_row: 10, name: "Deekshitha M", panelist: "Vinay Shetty", role: "Data Analyst Intern", rating: "5", doj: "28th Sept", status: "REJECTED" },
    { source_list: "Rejected", source_row: 11, name: "Vinutha V", panelist: "Praneel", role: "Data Analyst Intern", rating: "7", doj: "immediate", status: "REJECTED" },
    { source_list: "Rejected", source_row: 12, name: "saniya B K", panelist: "Praneel", role: "Data Analyst Intern", rating: "5", doj: "immediate", status: "REJECTED" },
    { source_list: "Rejected", source_row: 13, name: "manushree", panelist: "Praneel", role: "Data Analyst Intern", rating: "4", doj: "immediate", status: "REJECTED" },
    { source_list: "Rejected", source_row: 14, name: "Sachin j", panelist: "Praneel", role: "Data Analyst Intern", rating: "5", doj: "immediate", status: "REJECTED" },
    { source_list: "Rejected", source_row: 15, name: "Niranjan k", panelist: "Praneel", role: "Data Analyst Intern", rating: "5", doj: "immediate", status: "REJECTED" },
    { source_list: "Rejected", source_row: 16, name: "Abilash PA", panelist: "Praneel", role: "Data Analyst Intern", rating: "5", doj: "immediate", status: "REJECTED" },
    { source_list: "Rejected", source_row: 17, name: "Arvind", panelist: "Praneel", role: "Data Analyst Intern", rating: "4", doj: "immediate", status: "REJECTED" },
    { source_list: "Rejected", source_row: 18, name: "Santosh khul", panelist: "Praneel", role: "Data Analyst Intern", rating: "2", doj: "immediate", status: "REJECTED" },
    { source_list: "Rejected", source_row: 19, name: "PRATHIBHA KS", panelist: "Praneel", role: "Data Analyst Intern", rating: "4", doj: "immediate", status: "REJECTED" }
  ];

  console.log('\n=== FETCHING ALL CANDIDATES FROM LIVE DB ===');
  const liveCandidates = await prisma.candidate.findMany({
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      college: true,
      status: true,
      createdAt: true,
      isDeleted: true
    }
  });
  console.log(`Loaded ${liveCandidates.length} total candidates from live DB.`);

  console.log('\n=== DUPLICATE ANALYSIS RESULTS ===');
  const results = [];

  for (const item of candidatesData) {
    const rawName = item.name;
    const normName = normalizeName(rawName);
    
    let exactMatches = [];
    let normalizedMatches = [];
    let fuzzyMatches = [];

    for (const live of liveCandidates) {
      const liveRaw = live.fullName || '';
      const liveNorm = normalizeName(liveRaw);

      // Exact match (case-insensitive raw trimmed)
      if (liveRaw.trim().toLowerCase() === rawName.trim().toLowerCase()) {
        exactMatches.push(live);
      } else if (liveNorm === normName && normName.length > 0) {
        normalizedMatches.push(live);
      } else {
        const score = levenshteinSimilarity(rawName, liveRaw);
        const normScore = levenshteinSimilarity(normName, liveNorm);
        const maxScore = Math.max(score, normScore);
        if (maxScore >= 0.85) {
          fuzzyMatches.push({ candidate: live, score: maxScore });
        }
      }
    }

    results.push({
      item,
      exactMatches,
      normalizedMatches,
      fuzzyMatches
    });
  }

  // Print summary of matches
  let matchesFound = 0;
  for (const res of results) {
    const { item, exactMatches, normalizedMatches, fuzzyMatches } = res;
    const hasMatch = exactMatches.length > 0 || normalizedMatches.length > 0 || fuzzyMatches.length > 0;
    if (hasMatch) {
      matchesFound++;
      console.log(`[MATCH FOUND] ${item.name} (${item.source_list} row ${item.source_row}):`);
      if (exactMatches.length > 0) {
        console.log(`  - EXACT:`, exactMatches.map(c => `ID:${c.id} Name:${c.fullName} Phone:${c.phone} College:${c.college}`));
      }
      if (normalizedMatches.length > 0) {
        console.log(`  - NORMALIZED:`, normalizedMatches.map(c => `ID:${c.id} Name:${c.fullName} Phone:${c.phone} College:${c.college}`));
      }
      if (fuzzyMatches.length > 0) {
        console.log(`  - FUZZY (>=0.85):`, fuzzyMatches.map(m => `Score:${m.score.toFixed(2)} ID:${m.candidate.id} Name:${m.candidate.fullName} Phone:${m.candidate.phone} College:${m.candidate.college}`));
      }
    }
  }

  console.log(`\nTotal candidates with any match: ${matchesFound} / ${candidatesData.length}`);

  // Also save the full report to a JSON file for building table
  fs.writeFileSync(
    path.join(__dirname, 'bgs_duplicate_check_results.json'),
    JSON.stringify({ results, allUsers, allJobs, allColleges, allDrives }, null, 2)
  );
  console.log('Results written to scripts/bgs_duplicate_check_results.json');
}

runCheck()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
