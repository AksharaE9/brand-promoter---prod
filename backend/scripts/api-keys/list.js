#!/usr/bin/env node
'use strict';

/**
 * CLI Script: List active and revoked API keys (Never displays full keys)
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const prisma = require('../../src/config/db');

async function listApiKeys() {
  console.log('=== TALENTOS REGISTERED EXTERNAL API KEYS ===\n');

  const keys = await prisma.apiKey.findMany({
    orderBy: { createdAt: 'desc' }
  });

  if (keys.length === 0) {
    console.log('No API keys found in the database.');
    return;
  }

  const tableData = keys.map(k => {
    let status = 'ACTIVE';
    if (k.revokedAt) status = `REVOKED (${k.revokeReason || 'Manual'})`;
    else if (k.expiresAt && new Date(k.expiresAt) < new Date()) status = 'EXPIRED';

    return {
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      environment: k.environment,
      scopes: Array.isArray(k.scopes) ? k.scopes.join(', ') : '',
      rateLimit: `${k.rateLimitPerMinute}/min`,
      status,
      expiresAt: k.expiresAt ? k.expiresAt.toISOString().slice(0, 10) : 'Never',
      lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : 'Never',
      lastUsedIp: k.lastUsedIp || '-'
    };
  });

  console.table(tableData);
  console.log(`\nTotal registered keys: ${keys.length}\n`);
  await prisma.$disconnect();
}

listApiKeys().catch(err => {
  console.error('Failed to list keys:', err);
  process.exit(1);
});
