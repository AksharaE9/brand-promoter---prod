#!/usr/bin/env node
/**
 * check-bundle-size.js
 *
 * Reads frontend/.bundle-budget.json and scans frontend/dist/assets/
 * for the largest .js chunk. Exits 1 if any chunk exceeds the budget.
 * Used as a required CI step before deploy.
 */
const { readFileSync, readdirSync, statSync, existsSync } = require('fs');
const { join, resolve } = require('path');

const REPO_ROOT    = resolve(__dirname, '..');
const DIST_ASSETS  = join(REPO_ROOT, 'frontend', 'dist', 'assets');
const BUDGET_FILE  = join(REPO_ROOT, 'frontend', '.bundle-budget.json');

if (!existsSync(BUDGET_FILE)) {
  console.error('[BundleCheck] ERROR: .bundle-budget.json not found at:', BUDGET_FILE);
  console.error('[BundleCheck] Run: node scripts/generate-bundle-budget.js to create it');
  process.exit(1);
}

if (!existsSync(DIST_ASSETS)) {
  console.error('[BundleCheck] ERROR: dist/assets/ not found. Run: npm run build in frontend/ first.');
  process.exit(1);
}

const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf-8'));
const maxBudgetKb = budget.maxChunkKb;

if (!maxBudgetKb || maxBudgetKb <= 0) {
  console.error('[BundleCheck] ERROR: Invalid maxChunkKb in budget file:', budget);
  process.exit(1);
}

const files = readdirSync(DIST_ASSETS);
const jsChunks = files.filter(f => f.endsWith('.js'));

if (jsChunks.length === 0) {
  console.error('[BundleCheck] ERROR: No .js chunks found in dist/assets/');
  process.exit(1);
}

const chunkSizes = jsChunks.map(f => {
  const fullPath = join(DIST_ASSETS, f);
  const sizeBytes = statSync(fullPath).size;
  const sizeKb = Math.round(sizeBytes / 1024);
  return { file: f, sizeKb };
});

chunkSizes.sort((a, b) => b.sizeKb - a.sizeKb);

console.log(`\n[BundleCheck] Budget: ${maxBudgetKb}KB per chunk`);
console.log('[BundleCheck] Chunk sizes:');

let overBudget = false;
chunkSizes.forEach(({ file, sizeKb }) => {
  const over = sizeKb > maxBudgetKb;
  const status = over ? '❌ OVER BUDGET' : '✅';
  console.log(`  ${status} ${file}: ${sizeKb}KB`);
  if (over) overBudget = true;
});

if (overBudget) {
  console.error(`\n[BundleCheck] FAIL: One or more chunks exceed the ${maxBudgetKb}KB budget.`);
  console.error('[BundleCheck] To update the budget: node scripts/generate-bundle-budget.js');
  process.exit(1);
} else {
  console.log(`\n[BundleCheck] PASS: All chunks are within the ${maxBudgetKb}KB budget.`);
  process.exit(0);
}
