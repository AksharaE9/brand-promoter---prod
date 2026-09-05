'use strict';
/**
 * index.js — Production Server Bootstrap Entrypoint.
 * Imports the Express `app` from src/app.js to ensure perfect consistency
 * across development, production, and automated integration tests.
 */
const http = require("http");
require("dotenv").config();
const { app, PORT } = require("./app");
const { initSocket } = require("./config/socket");
const prisma = require("./config/db");
const sse = require("./utils/sse");
const { warmCaches } = require("./utils/cacheWarmer");

const isVercel = !!process.env.VERCEL;
let syncWorker = null;
let scheduleSyncJob = null;
let importWorker = null;
let notificationScheduler = null;

const shouldLoadWorkers = !isVercel;

function validateEnv() {
  const required = [
    'DATABASE_URL',
    'JWT_SECRET',
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error(`\n[CRITICAL STARTUP ERROR] Missing required environment variables: ${missing.join(', ')}`);
    console.error('The server cannot boot without these configurations. Please check your Render environment settings or local .env file.\n');
    process.exit(1);
  }

  // Soft warnings for optional but important production variables
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.CORS_ORIGIN) warnings.push('CORS_ORIGIN');
    if (!process.env.FRONTEND_URL) warnings.push('FRONTEND_URL (email action links and CORS origins will use safe fallbacks)');
    if (!process.env.BREVO_API_KEY) warnings.push('BREVO_API_KEY (transactional email and SMS dispatches will be paused)');

    if (warnings.length > 0) {
      console.warn(`[WARNING] The following production environment variables are missing: ${warnings.join(', ')}`);
    }
  }
}

async function bootstrap() {
  try {
    // Validate required environment variables before starting any connections
    validateEnv();

    // Warm up DB connection pool synchronously before listening, with retries for cold-start resilience
    const maxRetries = 5;
    let connected = false;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[Prisma] Connecting to Neon DB (attempt ${attempt}/${maxRetries})...`);
        const dbWarmStart = Date.now();
        await prisma.$connect();
        console.log(`[Prisma] Neon DB connection established successfully in ${Date.now() - dbWarmStart}ms`);
        connected = true;
        break;
      } catch (err) {
        console.warn(`[Prisma] Connection attempt ${attempt} failed:`, err.message);
        if (attempt < maxRetries) {
          console.log(`[Prisma] Waiting 3 seconds before next retry...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
          console.error('[Prisma] CRITICAL: Failed to connect to Neon DB after multiple retries.');
          throw err;
        }
      }
    }

    // Pre-warm critical cache keys (non-blocking)
    warmCaches().catch(err => {
      console.error('[CacheWarmer] Warm-up failed:', err.message);
    });

    // Load in-process background workers
    if (shouldLoadWorkers) {
      try {
        const syncModule = require("./jobs/schedulingSyncWorker");
        syncWorker = syncModule.worker;
        scheduleSyncJob = syncModule.scheduleSyncJob;
        importWorker = require("./jobs/bulkImportWorker").worker;
        notificationScheduler = require("./jobs/notificationScheduler");
        console.log('[Workers] In-process background workers loaded successfully.');
      } catch (err) {
        console.warn("[Workers] Background workers failed to load:", err.message);
      }
    }

    const server = http.createServer(app);
    initSocket(server);

    server.listen(PORT, () => {
      console.log(`[ATS-STABILIZED-V3.0] Server is running on port ${PORT}`);
    });

    // Start the scheduling sync job (only if not on Vercel)
    if (scheduleSyncJob) {
      scheduleSyncJob().catch(err => {
        console.error('[SchedulingSync] Failed to schedule sync job:', err);
      });
    }

    // Start the notification scheduler (only if not on Vercel)
    if (notificationScheduler) {
      notificationScheduler.startScheduler();
    }

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log('[Server] Shutting down, closing workers...');
      try {
        if (syncWorker) await syncWorker.close();
        if (importWorker) await importWorker.close();
        if (notificationScheduler) notificationScheduler.stopScheduler();
        console.log('[Server] Workers closed successfully.');
      } catch (err) {
        console.error('[Server] Error closing workers:', err);
      }
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // ── Performance: Keep-alive optimization ─────────────────
    server.keepAliveTimeout = 65000;   // prevents premature TCP close
    server.headersTimeout = 66000;     // must be > keepAliveTimeout

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(`[CRITICAL] Port ${PORT} is already in use. Please kill the existing process and try again.`);
      } else {
        console.error("[SERVER ERROR]", err);
      }
      process.exit(1);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[UncaughtException SafetyNet] Logged uncaught exception:", err);
  // Log and keep serving — don't let one bad request crash the whole process for everyone else.
});

bootstrap();