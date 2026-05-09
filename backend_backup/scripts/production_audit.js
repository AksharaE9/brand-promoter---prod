const { Client } = require('pg');

async function audit() {
    const dbUrl = "postgresql://neondb_owner:npg_H0bDF5VRjgWX@ep-icy-sea-ams6dsdx-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require";
    const client = new Client({ connectionString: dbUrl });

    try {
        await client.connect();
        console.log('--- 🛡️ PRODUCTION DATA AUDIT ---');

        // 1. Core Counts
        const counts = [
            'users', 'jobs', 'candidates', 'applications', 'products', 'sales_tracking'
        ];
        for (const t of counts) {
            const { rows } = await client.query(`SELECT COUNT(*) FROM "${t}"`);
            console.log(`[COUNT] ${t.padEnd(15)} : ${rows[0].count}`);
        }

        // 2. Role Integrity
        const { rows: roles } = await client.query(`SELECT role, COUNT(*) FROM users GROUP BY role`);
        console.log('\n[ROLES] User Distribution:');
        roles.forEach(r => console.log(`  - ${r.role.padEnd(12)}: ${r.count}`));

        // 3. Foreign Key Health Check (Dangling refs)
        console.log('\n[FK CHECK] Integrity Sweep:');
        
        const { rows: orphanApplications } = await client.query(`
            SELECT COUNT(*) FROM applications a 
            LEFT JOIN candidates c ON a.candidate_id = c.id 
            WHERE c.id IS NULL AND a.candidate_id IS NOT NULL
        `);
        console.log(`  - Orphan Applications (No Candidate) : ${orphanApplications[0].count}`);

        const { rows: orphanJobs } = await client.query(`
            SELECT COUNT(*) FROM jobs j 
            LEFT JOIN users u ON j.created_by = u.id 
            WHERE u.id IS NULL AND j.created_by IS NOT NULL
        `);
        console.log(`  - Orphan Jobs (No Creator)           : ${orphanJobs[0].count}`);

        const { rows: orphanTracking } = await client.query(`
            SELECT COUNT(*) FROM sales_tracking st 
            LEFT JOIN products p ON st.product_id = p.id 
            WHERE p.id IS NULL
        `);
        console.log(`  - Orphan Sales Tracking (No Product) : ${orphanTracking[0].count}`);

        // 4. Performance Check
        const start = Date.now();
        await client.query('SELECT 1');
        console.log(`\n[PERF] DB Ping Latency: ${Date.now() - start}ms`);

        console.log('\n--- 🛡️ AUDIT COMPLETED SUCCESSFULLY ---');

    } catch (error) {
        console.error('✖ Audit failed:', error.message);
    } finally {
        await client.end();
    }
}

audit();
