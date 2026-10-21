'use strict';
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const fixtureDir = path.join(__dirname, '..', 'tests', 'fixtures');
if (!fs.existsSync(fixtureDir)) fs.mkdirSync(fixtureDir, { recursive: true });

const gopalanCsv = fs.readFileSync(path.join(__dirname, '..', 'scratch', 'college_drive_bulk_upload_template.csv'));
fs.writeFileSync(path.join(fixtureDir, 'gopalan_31_rows.csv'), gopalanCsv);

const nmitCsv = fs.readFileSync(path.join(__dirname, '..', 'scratch', 'college_drive_bulk_upload_template_2.csv'));
fs.writeFileSync(path.join(fixtureDir, 'nmit_26_rows.csv'), nmitCsv);

const wb = XLSX.read(nmitCsv, { type: 'buffer' });
XLSX.writeFile(wb, path.join(fixtureDir, 'nmit_26_rows.xlsx'));

const sqliCsv = nmitCsv.toString().replace("Vinay's Lead", "Vinay'; DROP TABLE candidates; --");
fs.writeFileSync(path.join(fixtureDir, 'nmit_sqli.csv'), sqliCsv);

console.log('Fixtures created successfully in tests/fixtures.');
