const { Client } = require('pg');
require('dotenv').config();

async function list() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
  console.log(JSON.stringify(r.rows.map(row => row.table_name), null, 2));
  await c.end();
}

list();
