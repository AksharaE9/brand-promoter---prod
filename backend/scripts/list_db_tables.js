const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function listTables() {
  try {
    await client.connect();
    console.log("Listing all tables in the database...");
    
    const { rows } = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    console.log("Found tables:");
    rows.forEach(r => console.log(` - ${r.table_name}`));
    
  } catch (err) {
    console.error("Error listing tables:", err.message);
  } finally {
    await client.end();
  }
}

listTables();
