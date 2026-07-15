'use strict';
/**
 * src/config/db.js
 * Singleton PrismaClient for Neon DB (PostgreSQL)
 * Import this wherever you need database access: const prisma = require('./config/db');
 */

const { PrismaClient } = require('@prisma/client');

let prisma;

if (process.env.NODE_ENV === 'production') {
  let dbUrl = process.env.DATABASE_URL;
  if (dbUrl && !dbUrl.includes('connection_limit')) {
    const separator = dbUrl.includes('?') ? '&' : '?';
    dbUrl = `${dbUrl}${separator}connection_limit=10&pool_timeout=15`;
  }
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
    global.__prisma = new PrismaClient({
      log: ['query', 'error', 'warn'],
      errorFormat: 'pretty',
    });
  }
  prisma = global.__prisma;
}

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

module.exports = prisma;
