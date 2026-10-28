'use strict';
/**
 * src/config/db.js
 * Singleton PrismaClient for Neon DB (PostgreSQL)
 * Import this wherever you need database access: const prisma = require('./config/db');
 */

const { PrismaClient } = require('@prisma/client');

// Optimize connection parameters for database connections.
// Under PERF_POOLER_OPTIMIZED, connection_limit defaults to 8 (sized for single-process 512MB RAM)
// instead of 25 to avoid connection thrashing and excess memory per connection.
function getOptimizedDbUrl(dbUrl) {
  if (!dbUrl) return dbUrl;
  let optimized = dbUrl;
  const isPerfOptimized = process.env.PERF_POOLER_OPTIMIZED === 'true';
  const connectionLimit = isPerfOptimized
    ? (process.env.DB_CONNECTION_LIMIT || '8')
    : (process.env.DB_CONNECTION_LIMIT || '25');

  if (!optimized.includes('connection_limit')) {
    const separator = optimized.includes('?') ? '&' : '?';
    optimized = `${optimized}${separator}connection_limit=${connectionLimit}`;
  }
  if (!optimized.includes('pool_timeout')) {
    const separator = optimized.includes('?') ? '&' : '?';
    optimized = `${optimized}${separator}pool_timeout=${isPerfOptimized ? '20' : '45'}`;
  }
  if (!optimized.includes('connect_timeout')) {
    const separator = optimized.includes('?') ? '&' : '?';
    optimized = `${optimized}${separator}connect_timeout=45`;
  }
  if (isPerfOptimized && (optimized.includes('-pooler') || process.env.DB_PGBOUNCER === 'true') && !optimized.includes('pgbouncer=true')) {
    const separator = optimized.includes('?') ? '&' : '?';
    optimized = `${optimized}${separator}pgbouncer=true`;
  }
  return optimized;
}

let prisma;

if (process.env.NODE_ENV === 'production') {
  const dbUrl = getOptimizedDbUrl(process.env.DATABASE_URL);
  prisma = new PrismaClient({
    log: ['error', 'warn'],
    datasources: {
      db: {
        url: dbUrl,
      },
    },
  });
} else {
  // In development, reuse the same client to avoid too many connections
  if (!global.__prisma) {
    const devLog = process.env.DEBUG_PRISMA === 'true' ? ['query', 'error', 'warn'] : ['error'];
    const dbUrl = getOptimizedDbUrl(process.env.DATABASE_URL);
    global.__prisma = new PrismaClient({
      log: devLog,
      errorFormat: 'pretty',
      datasources: dbUrl ? {
        db: {
          url: dbUrl,
        },
      } : undefined,
    });
  }
  prisma = global.__prisma;
}

// Transparent database query retry middleware to handle transient Neon DB connection drops / resets.
let perfStorage = null;
try {
  perfStorage = require('../utils/perfContext').perfContextStorage;
} catch (_) {}

prisma.$use(async (params, next) => {
  const ctx = perfStorage ? perfStorage.getStore() : null;
  const t0 = process.hrtime.bigint();
  let retries = 3;
  while (retries > 0) {
    try {
      const result = await next(params);
      if (ctx) {
        ctx.dbCount++;
        ctx.dbDuration += Number(process.hrtime.bigint() - t0) / 1e6;
      }
      return result;
    } catch (err) {
      const isConnectionError =
        err.code === 'P1001' || // Can't reach database
        err.code === 'P1017' || // Server closed connection
        (err.message && (
          err.message.includes('Server has closed the connection') ||
          err.message.includes("Can't reach database server") ||
          err.message.includes('forcibly closed') ||
          err.message.includes('ConnectionReset') ||
          err.message.includes('socket hang up')
        ));

      if (isConnectionError && retries > 1) {
        retries--;
        console.warn(`[PrismaRetry] Database query failed due to connection drop/reset. Retrying in 1s... (Attempts left: ${retries})`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      throw err;
    }
  }
});

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

module.exports = prisma;
