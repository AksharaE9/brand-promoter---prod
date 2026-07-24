/**
 * scripts/seed-super-admin.js
 * Seeds the Super Admin users admin@ats.local and superadmin@gmail.com with mustChangePassword: true
 */
require('dotenv').config();
const prisma = require('../src/config/db');
const bcrypt = require('bcryptjs');

const superAdmins = [
  { email: 'admin@ats.local', fullName: 'System Super Admin' },
  { email: 'superadmin@gmail.com', fullName: 'Additional Super Admin' },
];

async function seed() {
  console.log("🚀 Seeding Super Admin users...");

  try {
    for (const { email, fullName } of superAdmins) {
      // Formulate environment variable name: e.g. SEED_INITIAL_PASSWORD_ADMIN_ATS_LOCAL
      const envKey = `SEED_INITIAL_PASSWORD_${email.replace(/[@.]/g, '_').toUpperCase()}`;
      const password = process.env[envKey] || 'CHANGE_ME_ON_FIRST_LOGIN';
      const passwordHash = await bcrypt.hash(password, 12);

      const existing = await prisma.user.findUnique({
        where: { email }
      });

      if (existing) {
        // Idempotent: don't overwrite password if user already exists.
        // Just ensure they have the SUPER_ADMIN role.
        if (existing.role !== 'SUPER_ADMIN') {
          await prisma.user.update({
            where: { id: existing.id },
            data: { role: 'SUPER_ADMIN' }
          });
          console.log(`🔧 Corrected role to SUPER_ADMIN for existing user: ${email}`);
        } else {
          console.log(`ℹ️ Super Admin ${email} already exists with correct role.`);
        }
      } else {
        const user = await prisma.user.create({
          data: {
            fullName,
            email,
            passwordHash,
            role: 'SUPER_ADMIN',
            status: 'ACTIVE',
            organizationId: 'defaultOrg',
            mustChangePassword: true,
            isActive: true,
            isDeleted: false,
          }
        });
        console.log(`✅ Seeded new super admin: ${email}`);
      }
    }

    console.log("\n✅ Super Admin seeding completed successfully.\n");
    process.exit(0);
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  }
}

seed();
