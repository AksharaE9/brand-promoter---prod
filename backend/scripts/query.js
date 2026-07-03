/**
 * scripts/query.js
 * Utility script to execute arbitrary SQL queries on CockroachDB.
 * Usage: node scripts/query.js "SELECT 1"
 */
require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const sql = process.argv[2];
  if (!sql) {
    console.error('Please provide a SQL query.');
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    const res = await client.query(sql);
    if (res.rows.length > 0) {
      console.table(res.rows);
    } else {
      console.log('Query executed successfully. Result:', res);
    }
  } catch (err) {
    console.error('Error executing query:', err.message);
  } finally {
    await client.end();
  }
}

main();
