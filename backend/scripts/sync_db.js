const { Client } = require('pg');

async function sync() {
    const oldUrl = "postgresql://neondb_owner:npg_dU5ktGjWXT8F@ep-snowy-bird-anijdszq-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require";
    const newUrl = "postgresql://neondb_owner:npg_dU5ktGjWXT8F@ep-snowy-bird-anijdszq-pooler.c-6.us-east-1.aws.neon.tech/ats_sales_v2?sslmode=require";

    const oldClient = new Client({ connectionString: oldUrl });
    const newClient = new Client({ connectionString: newUrl });

    try {
        await oldClient.connect();
        await newClient.connect();
        console.log('Connected to both databases.');

        // 🛡️ TRUNCATE ALL TABLES FIRST (Clean slate)
        const tablesToTruncate = [
            'audit_logs',
            'custom_field_values',
            'custom_field_definitions', 
            'interview_feedback',
            'interviews',
            'pipeline_events',
            'applications',
            'pipeline_stages', 
            'candidate_skills',
            'candidate_education',
            'candidates', 
            'jobs', 
            'files',
            'users'
        ];

        console.log('Cleaning target database...');
        for (const table of tablesToTruncate) {
            await newClient.query(`TRUNCATE TABLE "${table}" CASCADE`);
        }
        console.log('✓ Target database cleaned.');

        // Order of tables matters for Foreign Keys
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

        for (const table of tables) {
            console.log(`Syncing table: ${table}...`);
            const { rows } = await oldClient.query(`SELECT * FROM ${table}`);
            
            if (rows.length === 0) {
                console.log(`  - No data.`);
                continue;
            }

            for (const row of rows) {
                const keys = Object.keys(row);
                const values = Object.values(row);
                const columns = keys.map(k => `"${k}"`).join(', ');
                const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
                
                await newClient.query(
                    `INSERT INTO "${table}" (${columns}) VALUES (${placeholders})`,
                    values
                );
            }
            console.log(`  ✓ Synced ${rows.length} rows.`);
        }

        console.log('\n💎 FULL DATABASE CLONE COMPLETED SUCCESSFULLY!');

    } catch (error) {
        console.error('\n✖ Sync failed:', error.message);
    } finally {
        await oldClient.end();
        await newClient.end();
    }
}

sync();
