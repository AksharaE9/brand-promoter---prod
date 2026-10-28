const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'reports', 'drive_investigation_results.json'), 'utf8'));

console.log('=== PART 2 ANALYSIS ===\n');

// 1. NMIT
console.log('--- 1. NMIT ANALYSIS ---');
const nmit = data.nmit;
console.log(`NMIT Candidates count: ${nmit.candidates.length}`);
// Check duplicates by phone or email or name
const nmitByPhone = {};
const nmitByName = {};
nmit.candidates.forEach(c => {
  if (c.phone) {
    nmitByPhone[c.phone] = (nmitByPhone[c.phone] || []).concat(c);
  }
  const normName = c.name.toLowerCase().trim();
  nmitByName[normName] = (nmitByName[normName] || []).concat(c);
});
console.log('NMIT phone collisions:');
for (const [phone, list] of Object.entries(nmitByPhone)) {
  if (list.length > 1) {
    console.log(`  Phone ${phone} shared by:`, list.map(x => `${x.name} [${x.id}]`));
  }
}
console.log('NMIT name collisions:');
for (const [name, list] of Object.entries(nmitByName)) {
  if (list.length > 1) {
    console.log(`  Name "${name}" shared by:`, list.map(x => `${x.name} [${x.id}] | Ph: ${x.phone}`));
  }
}
// Check R2 rounds and outcomes
const r2Cands = nmit.candidates.filter(c => c.interviews.some(i => i.roundNo === 2));
console.log(`\nNMIT Candidates with R2 (${r2Cands.length}):`);
r2Cands.forEach(c => {
  const r1 = c.interviews.find(i => i.roundNo === 1);
  const r2 = c.interviews.find(i => i.roundNo === 2);
  console.log(`- ${c.name} [${c.id}]: R1 out=${r1?.outcome}, R2 out=${r2?.outcome}, R2 notes="${(r2?.notes||'').replace(/\n/g, ' ')}"`);
});

// 2. JAIN
console.log('\n--- 2. JAIN ANALYSIS ---');
const jain = data.jain;
console.log(`Jain Candidates in drive: ${jain.candidates.length}`);
jain.candidates.forEach((c, idx) => {
  const r1 = c.interviews.find(i => i.roundNo === 1);
  const r2 = c.interviews.find(i => i.roundNo === 2);
  console.log(`${idx + 1}. [${c.id}] ${c.name} | Ph: ${c.phone} | Created: ${c.createdAt} | R1: ${r1?.outcome} | R2: ${r2?.outcome} | Src: ${c.source}`);
});

// 3. MVJ
console.log('\n--- 3. MVJ ANALYSIS ---');
const mvj = data.mvj;
console.log(`MVJ Candidates count: ${mvj.candidates.length}`);
const soumya = mvj.candidates.find(c => c.name.toLowerCase().includes('soumya'));
console.log('Soumya Badiger:', JSON.stringify(soumya, null, 2));

// Check any candidate where R1 outcome changed or was overwritten
let r1Overwritten = [];
mvj.candidates.forEach(c => {
  const r1 = c.interviews.find(i => i.roundNo === 1);
  const r2 = c.interviews.find(i => i.roundNo === 2);
  if (r1 && r2) {
    if (r1.outcome !== 'SELECTED' && r2.outcome === 'SELECTED') {
      console.log(`MVJ Progressed candidate: ${c.name} [${c.id}]: R1=${r1.outcome}, R2=${r2.outcome}`);
    }
  }
});

// 4. BGS
console.log('\n--- 4. BGS ANALYSIS ---');
const bgs = data.bgs;
console.log(`BGS Candidates count: ${bgs.candidates.length}`);
const bgsR1Selected = bgs.candidates.filter(c => c.interviews.some(i => i.roundNo === 1 && i.outcome === 'SELECTED')).length;
const bgsR1Rejected = bgs.candidates.filter(c => c.interviews.some(i => i.roundNo === 1 && i.outcome === 'REJECTED')).length;
const bgsR2Count = bgs.candidates.filter(c => c.interviews.some(i => i.roundNo === 2)).length;
console.log(`BGS R1 Selected: ${bgsR1Selected}, R1 Rejected: ${bgsR1Rejected}, R2 Count: ${bgsR2Count}`);

// 5. GOPALAN
console.log('\n--- 5. GOPALAN ANALYSIS ---');
const gop = data.gopalan;
console.log(`Gopalan Candidates count: ${gop.candidates.length}`);
gop.candidates.forEach((c, idx) => {
  const ints = c.interviews.map(i => `R${i.roundNo}:${i.outcome}`).join(', ');
  if (c.interviews.length !== 1 || c.name.toLowerCase().includes('brunda')) {
    console.log(`Gopalan special: ${c.name} [${c.id}] -> ${ints} | notes=${c.interviews.map(i => i.notes).join(' ; ')}`);
  }
});
