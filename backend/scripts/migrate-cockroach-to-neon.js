/**
 * scripts/migrate-cockroach-to-neon.js
 * Migrates all data from the old CockroachDB to the new Neon DB.
 * Run with: node scripts/migrate-cockroach-to-neon.js
 */

require('dotenv').config();
const { Client } = require('pg');

async function runMigration() {
  const oldUrl = "postgresql://jishnu123:xJWW7P_Tdvf4oBLWt4Txmg@hoofed-badger-27775.j77.aws-ap-south-1.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full";
  const newUrl = process.env.DATABASE_URL;

  if (!newUrl) {
    console.error("❌ DATABASE_URL is missing in .env");
    process.exit(1);
  }

  console.log("🔌 Connecting to CockroachDB (Source) and Neon DB (Target)...");
  console.log(`Source URL: ${oldUrl.replace(/:([^:@]+)@/, ':****@')}`);
  console.log(`Target URL: ${newUrl.replace(/:([^:@]+)@/, ':****@')}\n`);

  const sourceClient = new Client({ connectionString: oldUrl });
  const targetClient = new Client({ connectionString: newUrl });

  try {
    await sourceClient.connect();
    console.log("✅ Connected to CockroachDB (Source)");
    await targetClient.connect();
    console.log("✅ Connected to Neon DB (Target)\n");

    // Order of tables matters for Foreign Key constraints (dependencies first)
    const tables = [
      'organizations',
      'users',
      'sessions',
      'file_metas',
      'candidates',
      'jobs',
      'pipeline_stages',
      'applications',
      'pipeline_events',
      'interviews',
      'notifications',
      'audit_logs',
      'custom_field_definitions',
      'job_documents',
      'job_questions',
      'colleges',
      'college_drives',
      'college_drive_candidates',
      'products',
      'sales_tracking',
      'sales_activities'
    ];

    // 1. Clean slate: Truncate target tables in reverse order of dependencies
    console.log("🧹 Cleaning target Neon DB (Truncating tables)...");
    const reverseTables = [...tables].reverse();
    for (const table of reverseTables) {
      try {
        await targetClient.query(`TRUNCATE TABLE "${table}" CASCADE`);
        console.log(`  ✓ Truncated table: ${table}`);
      } catch (err) {
        console.warn(`  ⚠️  Warning truncating ${table}: ${err.message}`);
      }
    }
    console.log("✅ Target Neon DB is clean.\n");

    // 2. Fetch from source and insert into target
    console.log("📤 Migrating data table by table...");
    for (const table of tables) {
      console.log(`\n📦 Migrating table: ${table}...`);
      let sourceRows = [];
      try {
        const res = await sourceClient.query(`SELECT * FROM "${table}"`);
        sourceRows = res.rows;
      } catch (err) {
        console.error(`  ❌ Failed to fetch from source table ${table}: ${err.message}`);
        continue;
      }

      if (sourceRows.length === 0) {
        console.log(`  - No rows to migrate.`);
        continue;
      }

      console.log(`  - Found ${sourceRows.length} rows. Copying...`);
      let successCount = 0;
      for (const row of sourceRows) {
        const keys = Object.keys(row);
        const values = Object.values(row);
        const columns = keys.map(k => `"${k}"`).join(', ');
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');

        try {
          await targetClient.query(
            `INSERT INTO "${table}" (${columns}) VALUES (${placeholders})`,
            values
          );
          successCount++;
        } catch (err) {
          console.error(`  ❌ Failed to insert row into target table ${table}:`, err.message);
        }
      }
      console.log(`  ✓ Successfully migrated ${successCount}/${sourceRows.length} rows.`);
    }

    console.log("\n🎉 DATA MIGRATION PROCESS COMPLETED!");
  } catch (error) {
    console.error("\n❌ Migration failed with error:", error.message);
    if (error.message.includes("Request Unit limit")) {
      console.error("\n⚠️  CRITICAL: CockroachDB cluster is disabled because it reached its monthly Request Unit limit.");
      console.error("Please log into your Cockroach Labs Console and upgrade/reactivate your cluster to continue.");
    }
  } finally {
    try { await sourceClient.end(); } catch (_) {}
    try { await targetClient.end(); } catch (_) {}
  }
}

runMigration();
