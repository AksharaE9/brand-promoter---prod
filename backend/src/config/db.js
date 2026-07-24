'use strict';
/**
 * src/config/db.js
 * Singleton PrismaClient for Neon DB (PostgreSQL)
 * Import this wherever you need database access: const prisma = require('./config/db');
 */

const { PrismaClient } = require('@prisma/client');

// Optimize connection parameters for serverless Neon DB to handle cold starts.
// pool_timeout=45 and connect_timeout=45 allow up to 45 seconds for cold-start database compute spin-ups.
function getOptimizedDbUrl(dbUrl) {
  if (!dbUrl) return dbUrl;
  let optimized = dbUrl;
  if (!optimized.includes('connection_limit')) {
    const separator = optimized.includes('?') ? '&' : '?';
    optimized = `${optimized}${separator}connection_limit=25`;
  }
  if (!optimized.includes('pool_timeout')) {
    const separator = optimized.includes('?') ? '&' : '?';
    optimized = `${optimized}${separator}pool_timeout=45`;
  }
  if (!optimized.includes('connect_timeout')) {
    const separator = optimized.includes('?') ? '&' : '?';
    optimized = `${optimized}${separator}connect_timeout=45`;
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
prisma.$use(async (params, next) => {
  let retries = 3;
  while (retries > 0) {
    try {
      return await next(params);
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
