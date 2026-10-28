// qa/diagnose_gate0.js
const path = require('path');
const { PrismaClient } = require(path.resolve(__dirname, '../backend/node_modules/@prisma/client'));
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } }
});

async function main() {
  console.log('--- 1. DATABASE_URL & HOST AUDIT ---');
  const rawUrl = process.env.DATABASE_URL;
  try {
    const parsed = new URL(rawUrl);
    console.log('Host:', parsed.host);
    console.log('Contains -pooler:', parsed.host.includes('-pooler'));
    console.log('Search params:', parsed.search);
    console.log('Contains pgbouncer=true:', parsed.search.includes('pgbouncer=true'));
  } catch (e) {
    console.log('Could not parse URL:', e.message);
  }

  console.log('\n--- 2. DB CONNECTION & SEQUENTIAL QUERY RTT ---');
  const t0 = Date.now();
  const info = await prisma.$queryRaw`SELECT inet_server_addr(), current_database(), version()`;
  console.log('Initial query connected in:', Date.now() - t0, 'ms');
  console.log('DB Info:', info);

  // Time 20 SELECT 1 queries sequentially
  const times = [];
  for (let i = 0; i < 20; i++) {
    const s = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    times.push(Date.now() - s);
  }
  const min = Math.min(...times);
  const max = Math.max(...times);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log('20 sequential SELECT 1 times (ms):', times);
  console.log(`Min: ${min}ms, Max: ${max}ms, Avg: ${avg.toFixed(1)}ms`);

  console.log('\n--- 3. PG_STAT_ACTIVITY AUDIT ---');
  const activity = await prisma.$queryRaw`
    SELECT application_name, state, client_addr, count(*)::int as count
    FROM pg_stat_activity
    GROUP BY application_name, state, client_addr
    ORDER BY count DESC
  `;
  console.log('pg_stat_activity summary:');
  console.table(activity);

  const totalConnections = await prisma.$queryRaw`
    SELECT count(*)::int as total FROM pg_stat_activity
  `;
  console.log('Total open connections to DB:', totalConnections[0].total);

  console.log('\n--- 4. PRISMA CLIENT SINGLETON AUDIT ---');
  // Check if multiple PrismaClient instances are instantiated in backend codebase
  // (We will also do a grep in the next step)

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Diagnostic error:', err);
  process.exit(1);
});
