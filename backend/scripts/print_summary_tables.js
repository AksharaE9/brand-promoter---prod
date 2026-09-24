'use strict';
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'bgs_duplicate_check_results.json'), 'utf8'));

console.log('=== USERS ===');
console.table(data.allUsers);

console.log('\n=== JOBS ===');
console.table(data.allJobs);

console.log('\n=== COLLEGES ===');
console.table(data.allColleges.map(c => ({ id: c.id, name: c.name, location: c.location })));

console.log('\n=== COLLEGE DRIVES ===');
console.table(data.allDrives.map(d => ({ id: d.id, title: d.title, collegeId: d.collegeId, dateFrom: d.dateFrom, status: d.status })));
