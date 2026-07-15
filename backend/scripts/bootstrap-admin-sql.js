/**
 * scripts/bootstrap-admin-sql.js
 * Bootstraps a Super Admin user directly into the SQL Database (Neon/PostgreSQL) via Prisma.
 * Run with: node scripts/bootstrap-admin-sql.js
 */

require('dotenv').config();
const prisma = require('../src/config/db');
const bcrypt = require('bcryptjs');

async function bootstrap() {
  console.log("🚀 Bootstrapping Super Admin user in SQL database...");

  const email = "admin@ats.local";
  const password = "ChangeMe@123";
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        passwordHash,
        status: "ACTIVE",
        role: "SUPER_ADMIN",
        isActive: true,
        isDeleted: false,
      },
      create: {
        fullName: "System Administrator",
        email,
        passwordHash,
        role: "SUPER_ADMIN",
        status: "ACTIVE",
        organizationId: "defaultOrg",
        isActive: true,
        isDeleted: false,
      },
    });

    console.log("\n✅ Super Admin user bootstrapped successfully.");
    console.log("----------------------------------");
    console.log(`User ID:        ${user.id}`);
    console.log(`Login Email:    ${user.email}`);
    console.log(`Login Password: ${password}`);
    console.log("----------------------------------\n");

    process.exit(0);
  } catch (error) {
    console.error("❌ SQL Bootstrap failed:", error);
    process.exit(1);
  }
}

bootstrap();
