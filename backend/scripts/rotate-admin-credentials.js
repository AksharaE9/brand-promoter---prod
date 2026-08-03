'use strict';
/**
 * Rotate ONLY the primary SUPER_ADMIN (admin@ats.local) email + password.
 * Generates a crypto-strong password and bcrypt hash (cost 14).
 *
 * Usage: node scripts/rotate-admin-credentials.js
 */
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const OLD_EMAIL = 'admin@ats.local';
const BCRYPT_ROUNDS = 14;

function generateSecurePassword() {
  // 32 bytes → ~43 char base64url; mix in symbols for policy friendliness
  const core = crypto.randomBytes(32).toString('base64url');
  const extra = crypto.randomBytes(8).toString('hex');
  return `Tx!${core.slice(0, 28)}_${extra}`;
}

function generateSecureEmail() {
  const tag = crypto.randomBytes(4).toString('hex');
  return `admin.${tag}@talentos.secure`;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const admin = await prisma.user.findFirst({
      where: {
        OR: [
          { email: OLD_EMAIL },
          { email: { equals: OLD_EMAIL, mode: 'insensitive' } },
        ],
        isDeleted: false,
      },
    });

    if (!admin) {
      // Fallback: single SUPER_ADMIN named like system admin
      const fallback = await prisma.user.findFirst({
        where: { role: 'SUPER_ADMIN', isDeleted: false, email: { contains: 'admin' } },
        orderBy: { createdAt: 'asc' },
      });
      if (!fallback) {
        throw new Error(`No admin user found for ${OLD_EMAIL}`);
      }
      console.warn(`⚠️  Exact ${OLD_EMAIL} not found; rotating oldest admin-like SUPER_ADMIN: ${fallback.email}`);
    }

    const target = admin || (await prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN', isDeleted: false, email: { contains: 'admin' } },
      orderBy: { createdAt: 'asc' },
    }));

    if (target.role !== 'SUPER_ADMIN') {
      throw new Error(`Refusing to rotate non-SUPER_ADMIN user: ${target.email} (${target.role})`);
    }

    const newEmail = process.env.ADMIN_EMAIL_ROTATE || generateSecureEmail();
    const newPassword = process.env.ADMIN_PASSWORD_ROTATE || generateSecurePassword();
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    // Ensure email not taken by someone else
    const clash = await prisma.user.findFirst({
      where: {
        email: { equals: newEmail, mode: 'insensitive' },
        id: { not: target.id },
        isDeleted: false,
      },
    });
    if (clash) {
      throw new Error(`Email ${newEmail} already in use by another user`);
    }

    // Kill existing sessions for this admin so old tokens stop working
    await prisma.session.deleteMany({ where: { userId: target.id } }).catch(() => {});

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: {
        email: newEmail,
        passwordHash,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        isActive: true,
        mustChangePassword: false,
        updatedAt: new Date(),
      },
      select: { id: true, email: true, role: true, fullName: true },
    });

    // Verify hash rounds to the unique password
    const ok = await bcrypt.compare(newPassword, passwordHash);
    if (!ok) throw new Error('Hash verification failed after rotation');

    const outPath = path.join(__dirname, '..', '.admin-credentials.local');
    const payload = [
      '# GENERATED — do not commit. Primary SUPER_ADMIN only.',
      `# rotatedAt: ${new Date().toISOString()}`,
      `# userId: ${updated.id}`,
      `ADMIN_EMAIL=${updated.email}`,
      `ADMIN_PASSWORD=${newPassword}`,
      `BCRYPT_ROUNDS=${BCRYPT_ROUNDS}`,
      '',
    ].join('\n');
    fs.writeFileSync(outPath, payload, { encoding: 'utf8', mode: 0o600 });

    console.log('\n✅ Admin credentials rotated (SUPER_ADMIN only)\n');
    console.log('----------------------------------');
    console.log(`Previous email : ${target.email}`);
    console.log(`New email      : ${updated.email}`);
    console.log(`New password   : ${newPassword}`);
    console.log(`Hash rounds    : ${BCRYPT_ROUNDS} (bcrypt)`);
    console.log(`Saved locally  : ${outPath}`);
    console.log('----------------------------------\n');
    console.log('Other users (recruiters / interviewers) were NOT changed.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('❌ Rotation failed:', err.message);
  process.exit(1);
});
