import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const FRONTEND_ROOT = resolve(__dirname, '../..');
const DIST_ASSETS  = join(FRONTEND_ROOT, 'dist', 'assets');
const BUDGET_FILE  = join(FRONTEND_ROOT, '.bundle-budget.json');

/**
 * Test 29: Frontend production build completes with zero errors.
 *
 * This test verifies that the dist/ directory exists and contains assets,
 * which is only possible if the build succeeded without fatal errors.
 * Build warnings-as-errors are enforced by the CI workflow (--mode production).
 */
describe('Test 29: Frontend production build', () => {
  it('build output exists and contains JavaScript chunks (zero build errors)', () => {
    // The dist/ dir must exist — if not, the build failed
    expect(existsSync(DIST_ASSETS)).toBe(true);

    const files = readdirSync(DIST_ASSETS);
    const jsChunks = files.filter(f => f.endsWith('.js'));
    const cssFiles = files.filter(f => f.endsWith('.css'));

    // Must have at least one JS chunk and one CSS file
    expect(jsChunks.length).toBeGreaterThan(0);
    expect(cssFiles.length).toBeGreaterThan(0);

    // Verify the entry chunk exists
    const hasEntry = jsChunks.some(f => f.includes('index') || f.includes('main') || f.includes('react-core'));
    expect(hasEntry).toBe(true);
  });
});

/**
 * Test 30: Frontend bundle size for Interviews chunk stays under budget.
 *
 * Reads .bundle-budget.json for the max allowed chunk size, then scans
 * dist/assets/ to find the largest .js chunk and asserts it's within budget.
 */
describe('Test 30: Bundle size budget enforcement', () => {
  it('no single JS chunk exceeds the agreed bundle size budget', () => {
    // Budget file must exist
    expect(existsSync(BUDGET_FILE)).toBe(true);

    const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf-8'));
    const maxBudgetKb = budget.maxChunkKb;
    expect(maxBudgetKb).toBeGreaterThan(0);

    // Scan all .js chunks in dist/assets/
    const files = readdirSync(DIST_ASSETS);
    const jsChunks = files.filter(f => f.endsWith('.js'));
    expect(jsChunks.length).toBeGreaterThan(0);

    const chunkSizes = jsChunks.map(f => {
      const fullPath = join(DIST_ASSETS, f);
      const sizeBytes = statSync(fullPath).size;
      const sizeKb = Math.round(sizeBytes / 1024);
      return { file: f, sizeKb };
    });

    // Sort by size descending for best error message
    chunkSizes.sort((a, b) => b.sizeKb - a.sizeKb);
    const largest = chunkSizes[0];

    // Log all chunks for visibility in CI output
    console.log('\n[Bundle Sizes]');
    chunkSizes.forEach(({ file, sizeKb }) => {
      const status = sizeKb > maxBudgetKb ? '❌ OVER BUDGET' : '✅';
      console.log(`  ${status} ${file}: ${sizeKb}KB (budget: ${maxBudgetKb}KB)`);
    });

    // The largest chunk must not exceed the budget
    expect(largest.sizeKb).toBeLessThanOrEqual(maxBudgetKb);
  });
});
