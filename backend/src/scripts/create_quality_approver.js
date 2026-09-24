'use strict';

/**
 * scripts/create_quality_approver.js
 * 
 * Safely provision a QUALITY_APPROVER user account with a temporary password
 * flagged with mustChangePassword = true.
 * 
 * Usage:
 *   node src/scripts/create_quality_approver.js <email> [fullName]
 */

require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../config/db');

async function createApprover() {
  const email = (process.argv[2] || process.env.APPROVER_EMAIL || '').trim().toLowerCase();
  const fullName = (process.argv[3] || 'Quality Approver').trim();

  if (!email || !email.includes('@')) {
    console.error('Usage: node src/scripts/create_quality_approver.js <email> [fullName]');
    process.exit(1);
  }

  // Check if user already exists
  const existing = await prisma.user.findUnique({
    where: { email },
  });

  if (existing) {
    if (existing.role === 'QUALITY_APPROVER') {
      console.log(`[Account] User with email ${email} already exists with role QUALITY_APPROVER (ID: ${existing.id}).`);
      return;
    }
    // Update existing user's role to QUALITY_APPROVER
    const updated = await prisma.user.update({
      where: { email },
      data: {
        role: 'QUALITY_APPROVER',
        status: 'ACTIVE',
        isDeleted: false,
      },
    });
    console.log(`[Account] Updated existing user ${email} to role QUALITY_APPROVER.`);
    return;
  }

  // Generate random 14-character secure temporary password
  const tempPassword = 'QA-' + crypto.randomBytes(6).toString('hex') + '!';
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  const createdUser = await prisma.user.create({
    data: {
      email,
      fullName,
      passwordHash,
      role: 'QUALITY_APPROVER',
      status: 'ACTIVE',
      organizationId: 'defaultOrg',
      mustChangePassword: true,
      isActive: true,
      isDeleted: false,
    },
  });

  console.log('\n======================================================');
  console.log('✅ QUALITY_APPROVER Account Created Successfully');
  console.log('======================================================');
  console.log(`Email:              ${createdUser.email}`);
  console.log(`Full Name:          ${createdUser.fullName}`);
  console.log(`Role:               ${createdUser.role}`);
  console.log(`Must Change Pwd:    ${createdUser.mustChangePassword}`);
  console.log(`Temporary Password: ${tempPassword}`);
  console.log('======================================================');
  console.log('Note: Deliver the temporary password to the user securely out of band.\n');
}

createApprover()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Account] Failed to create approver user:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
