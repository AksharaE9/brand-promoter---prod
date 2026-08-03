/**
 * scripts/bootstrap-admin-sql.js
 *
 * Creates/updates the primary SUPER_ADMIN in Postgres.
 * Prefer rotate-admin-credentials.js for credential rotation.
 *
 * Optional env:
 *   ADMIN_EMAIL, ADMIN_PASSWORD
 * If omitted, generates a crypto-unique password (printed once).
 *
 * Run with: node scripts/bootstrap-admin-sql.js
 */
'use strict';
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

async function bootstrap() {
  const prisma = new PrismaClient();
  const email = process.env.ADMIN_EMAIL || 'admin@ats.local';
  const password =
    process.env.ADMIN_PASSWORD ||
    `Tx!${crypto.randomBytes(24).toString('base64url')}`;
  const passwordHash = await bcrypt.hash(password, 14);

  try {
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        passwordHash,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        isActive: true,
      },
      create: {
        fullName: 'System Administrator',
        email,
        passwordHash,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        isActive: true,
        organizationId: 'defaultOrg',
      },
    });

    console.log('\n✅ Super Admin user bootstrapped successfully.');
    console.log('----------------------------------');
    console.log(`Login Email   : ${user.email}`);
    console.log(`Login Password: ${password}`);
    console.log('----------------------------------\n');
  } finally {
    await prisma.$disconnect();
  }
}

bootstrap().catch((err) => {
  console.error('❌ Bootstrap failed:', err);
  process.exit(1);
});
