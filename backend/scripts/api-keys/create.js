#!/usr/bin/env node
'use strict';

/**
 * CLI Script: Issue an API key for external partners (e.g. HireIQ)
 *
 * Usage:
 *   node scripts/api-keys/create.js --name "HireIQ – production" --scopes interviews:read,candidates:read,candidates:read:pii,resumes:read --expires-in 90d --rate-limit 60
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const prisma = require('../../src/config/db');
const { generateApiKey } = require('../../src/modules/ext/apiKeyService');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    name: null,
    scopes: 'interviews:read,candidates:read,candidates:read:pii,resumes:read',
    expiresIn: '90d',
    rateLimit: 60,
    env: 'live',
    orgId: 'defaultOrg'
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--name' && args[i + 1]) options.name = args[++i];
    else if (arg === '--scopes' && args[i + 1]) options.scopes = args[++i];
    else if (arg === '--expires-in' && args[i + 1]) options.expiresIn = args[++i];
    else if (arg === '--rate-limit' && args[i + 1]) options.rateLimit = parseInt(args[++i], 10);
    else if (arg === '--env' && args[i + 1]) options.env = args[++i];
    else if (arg === '--org-id' && args[i + 1]) options.orgId = args[++i];
  }

  return options;
}

async function main() {
  const opts = parseArgs();
  if (!opts.name) {
    console.error('Error: --name is required. Example: --name "HireIQ – production"');
    process.exit(1);
  }

  // Parse expires-in (e.g. 90d -> 90)
  let days = 90;
  if (typeof opts.expiresIn === 'string') {
    const match = opts.expiresIn.match(/^(\d+)(d|days)?$/i);
    if (match) days = parseInt(match[1], 10);
  }

  const scopesList = opts.scopes.split(',').map(s => s.trim()).filter(Boolean);

  // Look up admin user for createdById
  const admin = await prisma.user.findFirst({
    where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] } },
    select: { id: true, email: true }
  });
  const createdById = admin ? admin.id : 'system-cli';

  console.log('Generating scoped API key...');
  const result = await generateApiKey({
    name: opts.name,
    scopes: scopesList,
    environment: opts.env,
    expiresInDays: days,
    rateLimitPerMinute: opts.rateLimit,
    createdById,
    orgId: opts.orgId,
    ip: '127.0.0.1 (CLI)'
  });

  console.log('\n========================================================================');
  console.log('   TALENTOS EXTERNAL API KEY ISSUED (PRINTED ONCE ONLY)');
  console.log('========================================================================');
  console.log(`Key Name:     ${result.apiKey.name}`);
  console.log(`Prefix:       ${result.apiKey.prefix}`);
  console.log(`Scopes:       ${result.apiKey.scopes.join(', ')}`);
  console.log(`Environment:  ${result.apiKey.environment}`);
  console.log(`Expires At:   ${result.apiKey.expiresAt ? result.apiKey.expiresAt.toISOString() : 'Never'}`);
  console.log(`Rate Limit:   ${result.apiKey.rateLimitPerMinute} req/min`);
  console.log('------------------------------------------------------------------------');
  console.log(`FULL API KEY: ${result.fullKey}`);
  console.log('------------------------------------------------------------------------');
  console.log('IMPORTANT: Hand this key to the owner or partner directly.');
  console.log('Only the SHA-256 hash has been stored in Neon PostgreSQL.');
  console.log('The raw key is NOT recoverable once this terminal window is cleared.');
  console.log('========================================================================\n');

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Failed to create API key:', err);
  process.exit(1);
});
