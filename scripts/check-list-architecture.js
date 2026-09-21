/**
 * Architecture Check Script: Candidate List Architecture
 *
 * Scans frontend views to verify that candidate list components use:
 * 1. usePaginatedList or useCandidateCounts
 * 2. PaginatedListView
 * 3. Proper decoupled count queries
 */
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const candidatesPage = path.join(projectRoot, 'frontend', 'src', 'pages', 'Candidates.jsx');

let errors = [];

if (!fs.existsSync(candidatesPage)) {
  errors.push(`Candidates.jsx not found at ${candidatesPage}`);
} else {
  const content = fs.readFileSync(candidatesPage, 'utf8');

  if (!content.includes('usePaginatedList')) {
    errors.push('Candidates.jsx must import and use `usePaginatedList`.');
  }

  if (!content.includes('PaginatedListView')) {
    errors.push('Candidates.jsx must use `<PaginatedListView>` for unified candidate rendering.');
  }

  if (!content.includes('useCandidateStatusCounts')) {
    errors.push('Candidates.jsx must use `useCandidateStatusCounts` for decoupled tab counts.');
  }
}

if (errors.length > 0) {
  console.error('❌ Candidate list architecture validation failed:');
  errors.forEach((err) => console.error(`  - ${err}`));
  process.exit(1);
} else {
  console.log('✅ Candidate list architecture validation passed: all required hooks and primitives in place.');
  process.exit(0);
}
