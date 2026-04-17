const { Client } = require('pg');

async function sync() {
    // Source: Original NEONDB
    const sourceUrl = "postgresql://neondb_owner:npg_dU5ktGjWXT8F@ep-snowy-bird-anijdszq-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require";
    // Destination: User's New Database
    const destUrl = "postgresql://neondb_owner:npg_H0bDF5VRjgWX@ep-icy-sea-ams6dsdx-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require";

    const oldClient = new Client({ connectionString: sourceUrl });
    const newClient = new Client({ connectionString: destUrl });

    try {
        await oldClient.connect();
        await newClient.connect();
        console.log('Connected to both databases.');

        const tables = [
            'users', 
            'files',
            'jobs', 
            'candidates', 
            'candidate_skills',
            'candidate_education',
            'pipeline_stages', 
            'applications',
            'pipeline_events',
            'interviews',
            'interview_feedback',
            'custom_field_definitions', 
            'custom_field_values',
            'audit_logs'
        ];

        // Phase 1: Clean Target
        console.log('Cleaning target database...');
        for (const table of [...tables].reverse()) {
            await newClient.query(`TRUNCATE TABLE "${table}" CASCADE`).catch(() => {});
        }

        // Phase 2: Users (without profile photos)
        console.log(`Syncing table: users (Phase 1)...`);
        const { rows: userRows } = await oldClient.query(`SELECT * FROM users`);
        for (const r of userRows) {
            const row = { ...r, profile_photo_file_id: null };
            const keys = Object.keys(row);
            const columns = keys.map(k => `"${k}"`).join(', ');
            const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
            await newClient.query(`INSERT INTO "users" (${columns}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, Object.values(row));
        }

        // Phase 3: Files
        console.log(`Syncing table: files...`);
        const { rows: fileRows } = await oldClient.query(`SELECT * FROM files`);
        for (const row of fileRows) {
            const keys = Object.keys(row);
            const columns = keys.map(k => `"${k}"`).join(', ');
            const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
            await newClient.query(`INSERT INTO "files" (${columns}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, Object.values(row));
        }

        // Phase 4: User Profile Photo Updates
        console.log('Updating profile photo references...');
        for (const r of userRows) {
            if (r.profile_photo_file_id) {
                await newClient.query(`UPDATE users SET profile_photo_file_id = $1 WHERE id = $2`, [r.profile_photo_file_id, r.id]);
            }
        }

        // Phase 5: Everything else
        const remainingTables = [
            'jobs', 
            'candidates', 
            'candidate_skills',
            'candidate_education',
            'pipeline_stages', 
            'applications',
            'pipeline_events',
            'interviews',
            'interview_feedback',
            'custom_field_definitions', 
            'custom_field_values',
            'audit_logs'
        ];

        for (const table of remainingTables) {
            console.log(`Syncing table: ${table}...`);
            const { rows } = await oldClient.query(`SELECT * FROM ${table}`);
            if (rows.length === 0) { console.log(`  - 0 rows.`); continue; }
            for (const row of rows) {
                const keys = Object.keys(row);
                const columns = keys.map(k => `"${k}"`).join(', ');
                const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
                await newClient.query(`INSERT INTO "${table}" (${columns}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, Object.values(row));
            }
            console.log(`  ✓ Synced ${rows.length} rows.`);
        }

        console.log('\n💎 EXTERNAL MIGRATION COMPLETED SUCCESSFULLY!');

    } catch (error) {
        console.error('\n✖ Migration failed:', error.message);
    } finally {
        await oldClient.end();
        await newClient.end();
    }
}

sync();
