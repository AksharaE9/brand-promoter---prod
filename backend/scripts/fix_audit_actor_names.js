'use strict';
/**
 * fix_audit_actor_names.js
 *
 * One-time cleanup: finds audit log rows where actorName is a raw UUID/cuid/Firebase UID
 * (i.e., no spaces, looks like an ID) and replaces it with the real user's full name
 * by looking up actorUserId or actorEmail in the users table.
 *
 * Run: node fix_audit_actor_names.js
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Returns true if the string looks like a raw ID (cuid, uuid, Firebase UID)
 * rather than a human name.
 * A real name always has either a space OR is short (like "System").
 */
function looksLikeId(str) {
  if (!str || str === 'System') return false;
  // Has no space AND is longer than 15 chars → likely a cuid/uuid/Firebase UID
  if (!str.includes(' ') && str.length > 15) return true;
  // Matches cuid2 pattern (starts with letter, all alphanumeric, 20-30 chars)
  if (/^[a-z][a-z0-9]{19,29}$/i.test(str)) return true;
  // UUID pattern
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) return true;
  return false;
}

async function fixAuditActorNames() {
  console.log('Scanning audit logs for rows with raw IDs as actorName...\n');

  const allLogs = await prisma.auditLog.findMany({
    select: {
      id: true,
      actorName: true,
      actorUserId: true,
      actorEmail: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const badLogs = allLogs.filter(log => looksLikeId(log.actorName));

  console.log(`Found ${badLogs.length} rows with raw IDs as actorName (out of ${allLogs.length} total).\n`);

  if (badLogs.length === 0) {
    console.log('All audit logs have proper actor names. Nothing to fix.');
    return;
  }

  let fixed = 0;
  let notFound = 0;

  for (const log of badLogs) {
    let realName = null;

    if (log.actorUserId) {
      const user = await prisma.user.findUnique({
        where: { id: log.actorUserId },
        select: { fullName: true },
      });
      if (user?.fullName) realName = user.fullName;
    }

    if (!realName && log.actorEmail) {
      const user = await prisma.user.findFirst({
        where: { email: log.actorEmail },
        select: { fullName: true },
      });
      if (user?.fullName) realName = user.fullName;
    }

    if (realName) {
      await prisma.auditLog.update({
        where: { id: log.id },
        data: { actorName: realName },
      });
      console.log(`  Fixed: "${log.actorName}" -> "${realName}"`);
      fixed++;
    } else {
      await prisma.auditLog.update({
        where: { id: log.id },
        data: { actorName: 'System' },
      });
      console.log(`  Could not resolve user for log ${log.id} -- set to "System"`);
      notFound++;
    }
  }

  console.log(`\nDone. Fixed: ${fixed} | Set to "System": ${notFound}`);
}

fixAuditActorNames()
  .catch(err => {
    console.error('Script failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
