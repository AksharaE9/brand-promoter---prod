#!/usr/bin/env node
/**
 * backfill_company.js
 * ──────────────────────────────────────────────────────────────────────────
 * One-time migration: sets the `company` field on all existing candidates.
 *
 * Rules:
 *   - Lal Arjun Biraj    → Vruksha Organics
 *   - Harshith M Gowda   → Vruksha Organics
 *   - All others         → Akshara Enterprises  (default)
 *
 * Also seeds both company names into the Organization.preferences lookup
 * so the dropdown is populated immediately after the backfill.
 *
 * Usage:
 *   node scripts/backfill_company.js [--dry-run]
 *
 * Flags:
 *   --dry-run   Print what would be changed without making any writes.
 *   --org <id>  Target a specific org ID (default: "defaultOrg")
 * ──────────────────────────────────────────────────────────────────────────
 */
require('dotenv').config();
const prisma = require('../src/config/db');

const VRUKSHA  = 'Vruksha Organics';
const AKSHARA  = 'Akshara Enterprises';

// Canonical names of the two exceptions (case-insensitive match)
const EXCEPTIONS = [
  'lal arjun biraj',
  'lalu arjun biraj',
  'harshith m gowda',
  'harshith gowda h v',
];

function normalize(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const orgIdx   = process.argv.indexOf('--org');
  const orgId    = orgIdx !== -1 ? process.argv[orgIdx + 1] : 'defaultOrg';

  console.log('──────────────────────────────────────────────────────────');
  console.log('  ATS Company Backfill Migration');
  console.log(`  Organization: ${orgId}`);
  console.log(`  Mode: ${isDryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log('──────────────────────────────────────────────────────────');

  // ── Step 0: Pre-migration counts ──────────────────────────────────────
  const total = await prisma.candidate.count({
    where: { organizationId: orgId, isDeleted: false },
  });
  const alreadySet = await prisma.candidate.count({
    where: { organizationId: orgId, isDeleted: false, company: { not: null } },
  });

  console.log(`\n[Pre-flight] Total active candidates   : ${total}`);
  console.log(`[Pre-flight] Already have company set  : ${alreadySet}`);
  console.log(`[Pre-flight] Need backfilling          : ${total - alreadySet}`);

  if (alreadySet === total) {
    console.log('\n✅ All candidates already have a company set. Nothing to do.\n');
    return;
  }

  // ── Step 1: Identify the two exceptions ───────────────────────────────
  console.log('\n[Step 1] Looking for named exception candidates...');

  const allNullCandidates = await prisma.candidate.findMany({
    where: { organizationId: orgId, isDeleted: false, company: null },
    select: { id: true, fullName: true, email: true, phone: true },
  });

  const exceptions = allNullCandidates.filter(c =>
    EXCEPTIONS.includes(normalize(c.fullName))
  );

  const others = allNullCandidates.filter(c =>
    !EXCEPTIONS.includes(normalize(c.fullName))
  );

  console.log(`  Found ${exceptions.length} exception candidate(s):`);
  exceptions.forEach(c =>
    console.log(`    ✓ "${c.fullName}" (${c.id}) → ${VRUKSHA}`)
  );

  const foundArjun = exceptions.some(c => ['lal arjun biraj', 'lalu arjun biraj'].includes(normalize(c.fullName)));
  const foundHarshith = exceptions.some(c => ['harshith m gowda', 'harshith gowda h v'].includes(normalize(c.fullName)));
  if (!foundArjun || !foundHarshith) {
    console.warn(`\n  ⚠️  WARNING: Expected 2 exceptions (one Arjun, one Harshith) but found:`);
    if (!foundArjun) console.warn(`    ✗ Arjun exception ('Lal/Lalu Arjun Biraj') — not found or already has a company`);
    if (!foundHarshith) console.warn(`    ✗ Harshith exception ('Harshith M Gowda' / 'HARSHITH GOWDA H V') — not found or already has a company`);
  }

  console.log(`\n  Found ${others.length} candidates to set to "${AKSHARA}"`);

  if (isDryRun) {
    console.log('\n[DRY RUN] Would perform the following writes:');
    if (exceptions.length > 0) {
      console.log(`  UPDATE ${exceptions.length} rows SET company = '${VRUKSHA}'`);
    }
    if (others.length > 0) {
      console.log(`  UPDATE ${others.length} rows SET company = '${AKSHARA}'`);
    }
    console.log('\n  Re-run without --dry-run to apply.\n');
    return;
  }

  // ── Step 2: Write exceptions first ────────────────────────────────────
  if (exceptions.length > 0) {
    console.log(`\n[Step 2] Setting ${exceptions.length} exception(s) to "${VRUKSHA}"...`);
    const exceptionIds = exceptions.map(c => c.id);
    const r1 = await prisma.candidate.updateMany({
      where: { id: { in: exceptionIds } },
      data:  { company: VRUKSHA },
    });
    console.log(`  ✅ Updated ${r1.count} row(s).`);
  }

  // ── Step 3: Set remaining to default ──────────────────────────────────
  if (others.length > 0) {
    console.log(`\n[Step 3] Setting ${others.length} remaining candidates to "${AKSHARA}"...`);
    const otherIds = others.map(c => c.id);
    const r2 = await prisma.candidate.updateMany({
      where: { id: { in: otherIds } },
      data:  { company: AKSHARA },
    });
    console.log(`  ✅ Updated ${r2.count} row(s).`);
  }

  // ── Step 4: Seed companies into Organization.preferences ─────────────
  console.log('\n[Step 4] Seeding companies into organization preferences...');
  try {
    let org = await prisma.organization.findUnique({ where: { id: orgId } });
    let prefs = {};
    if (org?.preferences) {
      prefs = typeof org.preferences === 'string'
        ? JSON.parse(org.preferences)
        : { ...org.preferences };
    }

    const currentCompanies = Array.isArray(prefs.companies) ? prefs.companies : [];
    const merged = [...new Set([...currentCompanies, AKSHARA, VRUKSHA])].sort((a, b) => a.localeCompare(b));
    prefs.companies = merged;

    if (org) {
      await prisma.organization.update({ where: { id: orgId }, data: { preferences: prefs } });
    } else {
      await prisma.organization.create({
        data: { id: orgId, name: 'My Organization', preferences: prefs },
      });
    }
    console.log(`  ✅ Companies seeded: [${merged.join(', ')}]`);
  } catch (err) {
    console.warn(`  ⚠️  Could not seed companies: ${err.message} (non-fatal)`);
  }

  // ── Step 5: Post-migration verification ───────────────────────────────
  console.log('\n[Step 5] Post-migration verification...');
  const groups = await prisma.candidate.groupBy({
    by: ['company'],
    where: { organizationId: orgId, isDeleted: false },
    _count: { company: true },
    orderBy: { _count: { company: 'desc' } },
  });

  const nullCount = await prisma.candidate.count({
    where: { organizationId: orgId, isDeleted: false, company: null },
  });

  console.log('\n  Company distribution:');
  groups.forEach(g => {
    const flag = g.company === VRUKSHA ? ' (✓ exception)' : '';
    console.log(`    "${g.company}": ${g._count.company} candidates${flag}`);
  });
  if (nullCount > 0) {
    console.warn(`  ⚠️  ${nullCount} candidates still have NULL company — investigate!`);
  } else {
    console.log(`  ✅ No NULL company values remain.`);
  }

  console.log('\n──────────────────────────────────────────────────────────');
  console.log('  Backfill complete.');
  console.log('──────────────────────────────────────────────────────────\n');
}

main()
  .catch(err => {
    console.error('\n❌ FATAL:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
