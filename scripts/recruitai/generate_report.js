'use strict';

/**
 * scripts/recruitai/generate_report.js
 *
 * Pulls current Recruit AI results from the database, calculates reconciliations,
 * and outputs qa/reports/recruitai/initial-pull-report.md
 */

const fs = require('fs');
const path = require('path');
const { generatePullReport } = require('../../backend/src/modules/integrations/recruit-ai/pullReportService');

async function run() {
  console.log('Generating Recruit AI Initial Pull Report...');
  const report = await generatePullReport();

  const outputPath = path.resolve(__dirname, '../../qa/reports/recruitai/initial-pull-report.md');
  fs.writeFileSync(outputPath, report.markdown, 'utf8');

  console.log('Successfully written initial pull report to:', outputPath);
  console.log('Summary metrics:', JSON.stringify(report.summary, null, 2));
}

run()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error generating report:', err);
    process.exit(1);
  });
