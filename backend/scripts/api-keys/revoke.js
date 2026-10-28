#!/usr/bin/env node
'use strict';

/**
 * CLI Script: Revoke an external API key by prefix
 *
 * Usage:
 *   node scripts/api-keys/revoke.js --prefix tos_live_... --reason "Contract ended"
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const prisma = require('../../src/config/db');
const { revokeApiKey } = require('../../src/modules/ext/apiKeyService');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { prefix: null, reason: 'Revoked via CLI tool' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--prefix' && args[i + 1]) options.prefix = args[++i];
    else if (args[i] === '--reason' && args[i + 1]) options.reason = args[++i];
  }
  return options;
}

async function main() {
  const opts = parseArgs();
  if (!opts.prefix) {
    console.error('Error: --prefix is required. Example: --prefix tos_live_abcdef12');
    process.exit(1);
  }

  const keyRecord = await prisma.apiKey.findUnique({
    where: { prefix: opts.prefix }
  });

  if (!keyRecord) {
    console.error(`Error: No API key found with prefix "${opts.prefix}".`);
    process.exit(1);
  }

  if (keyRecord.revokedAt) {
    console.log(`API key "${opts.prefix}" is already revoked since ${keyRecord.revokedAt.toISOString()}.`);
    return;
  }

  const admin = await prisma.user.findFirst({
    where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] } },
    select: { id: true }
  });
  const actorId = admin ? admin.id : 'system-cli';

  await revokeApiKey(keyRecord.id, actorId, opts.reason);

  console.log(`\nSuccessfully revoked API key with prefix "${opts.prefix}".`);
  console.log(`Reason: ${opts.reason}`);
  console.log('Revocation takes effect in memory within 60 seconds across all worker nodes.\n');

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Failed to revoke API key:', err);
  process.exit(1);
});
