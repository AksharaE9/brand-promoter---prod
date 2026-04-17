const { Client } = require('pg');

async function provision() {
    // Current connection string from .env (neondb)
    const url = "postgresql://neondb_owner:npg_dU5ktGjWXT8F@ep-snowy-bird-anijdszq-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require";
    const newDbName = 'ats_sales_v2';

    const client = new Client({ connectionString: url });

    try {
        await client.connect();
        console.log('Connected to Neon cluster.');

        // Try to create the new database
        console.log(`Attempting to create database: ${newDbName}`);
        // Use double quotes for DB name just in case
        await client.query(`CREATE DATABASE "${newDbName}"`);
        console.log('✓ Database created successfully.');

    } catch (error) {
        console.error('✖ Provisioning failed:');
        console.error(error.message);
        if (error.message.includes('permission denied')) {
            console.warn('Note: Neon free tier might restrict CREATE DATABASE via SQL.');
        }
    } finally {
        await client.end();
    }
}

provision();
