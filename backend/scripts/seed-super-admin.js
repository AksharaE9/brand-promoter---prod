/**
 * scripts/seed-super-admin.js
 * Seeds the Super Admin user admin@ats.local with mustChangePassword: true
 */
require('dotenv').config();
const prisma = require('../src/config/db');
const bcrypt = require('bcryptjs');

async function seed() {
  console.log("🚀 Seeding Super Admin user...");

  const email = "admin@ats.local";
  const initialPassword = process.env.SEED_INITIAL_PASSWORD ?? "ChangeMe@123";

  try {
    const existing = await prisma.user.findUnique({
      where: { email }
    });

    if (existing) {
      console.log(`User ${email} already exists — leaving password untouched.`);
      // Only fix the role if it's wrong; do not overwrite the hash.
      if (existing.role !== 'SUPER_ADMIN') {
        // Demote other superadmins to satisfy the only_one_super_admin unique constraint
        await prisma.user.updateMany({
          where: { role: 'SUPER_ADMIN', email: { not: email } },
          data: { role: 'RECRUITER' }
        });
        
        await prisma.user.update({
          where: { id: existing.id },
          data: { role: 'SUPER_ADMIN' }
        });
        console.log(`Corrected role to SUPER_ADMIN for existing user.`);
      }
    } else {
      // Demote other superadmins to satisfy the only_one_super_admin unique constraint
      await prisma.user.updateMany({
        where: { role: 'SUPER_ADMIN' },
        data: { role: 'RECRUITER' }
      });

      const passwordHash = await bcrypt.hash(initialPassword, 12);
      const user = await prisma.user.create({
        data: {
          fullName: "System Administrator",
          email,
          passwordHash,
          role: "SUPER_ADMIN",
          status: "ACTIVE",
          organizationId: "defaultOrg",
          mustChangePassword: true,
          isActive: true,
          isDeleted: false,
        },
      });

      console.log("\n✅ Super Admin user seeded successfully.");
      console.log("----------------------------------");
      console.log(`User ID:        ${user.id}`);
      console.log(`Login Email:    ${user.email}`);
      console.log(`Login Password: ${initialPassword}`);
      console.log("----------------------------------\n");
    }
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  }
}

seed();
