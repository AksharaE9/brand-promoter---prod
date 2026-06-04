'use strict';
const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
require("dotenv").config();
const { initSocket } = require("./config/socket");

const authRoutes = require("./modules/auth/routes");
const userRoutes = require("./modules/users/routes");
const candidateRoutes = require("./modules/candidates/routes");
const applicationRoutes = require("./modules/applications/routes");
const pipelineRoutes = require("./modules/pipeline/routes");
const interviewRoutes = require("./modules/interviews/routes");
const jobRoutes = require("./modules/jobs/routes");
const reportRoutes = require("./modules/reports/routes");
const salesRoutes = require("./modules/sales/routes");
const dashboardRoutes = require("./modules/dashboard/routes");
const collegeDriveRoutes = require("./modules/college-drives/routes");
const auditRoutes = require("./modules/audit/routes");
const notificationRoutes = require("./modules/notifications/routes");
const { worker: syncWorker, scheduleSyncJob } = require("./jobs/schedulingSyncWorker");
const { worker: importWorker } = require("./jobs/bulkImportWorker");
const compression = require("compression");
const { notFound, errorHandler } = require("./middleware/error-handler");
const { setSecurityHeaders } = require("./middleware/security");
const { timingMiddleware } = require("./middleware/timing");
const dedupMiddleware = require("./middleware/deduplication");
const cc = require("./middleware/cacheHeaders");
const { authLimiter, apiLimiter, analyticsLimiter, uploadLimiter } = require("./middleware/rateLimiter");

const app = express();
const PORT = process.env.PORT || 4000;
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map(o => o.trim())
  : [];

// ── Performance: Compression (first middleware) ──────────────
app.use(compression({
  level: 6,               // level 1-9: 6 is optimal speed/ratio
  threshold: 512,         // compress responses over 512 bytes
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    if (req.path.includes('/sse/stream')) return false; // never compress SSE
    return compression.filter(req, res);
  },
  chunkSize: 16 * 1024,   // 16KB chunks
}));

// ── Performance: Timing middleware ───────────────────────────
app.use(timingMiddleware);

// ── Performance: Request Deduplication ───────────────────────
app.use(dedupMiddleware);

// ── Security: Headers ────────────────────────────────────────
app.disable('x-powered-by');

// Trust proxy if behind nginx/load balancer/Render
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes("*") || allowedOrigins.length === 0) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      if (
        origin.endsWith(".vercel.app") ||
        /^https:\/\/brand-promoter-prod-.*\.vercel\.app$/.test(origin) ||
        /^http:\/\/localhost:\d+$/.test(origin)
      ) {
        return callback(null, true);
      }
      callback(null, false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
    optionsSuccessStatus: 204,
  }),
);
app.use(setSecurityHeaders);
app.use(express.json({ limit: "4mb" })); // Increased for large bulk uploads
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads"), { maxAge: '1d' }));

app.get("/api/health", async (req, res) => {
  const redis = require('./utils/redisClient');
  const sse = require('./utils/sse');
  
  let redisHealthy = false;
  try {
    redisHealthy = await redis.isHealthy();
  } catch { /* ignore */ }

  res.json({
    success: true,
    message: "ATS Backend is running",
    timestamp: new Date().toISOString(),
    services: {
      redis: {
        healthy: redisHealthy,
        ...redis.getConnectionInfo(),
      },
      sse: sse.getStats(),
    },
  });
});

// Cache Metrics Monitoring Endpoint (GET /api/health/cache — admin only)
const { requireRoles } = require("./middleware/auth");
const { auth } = require("./middleware/auth");
const { getCacheMetrics } = require("./utils/cache");
const sseManager = require("./utils/sse");

app.get("/api/health/cache", auth, requireRoles("SUPER_ADMIN"), (req, res) => {
  const cacheStats = getCacheMetrics();
  const sseStats = sseManager.getStats();
  res.json({ success: true, cache: cacheStats, sse: sseStats, uptime: process.uptime() });
});

// ── Mount Routes with Rate Limiters & Cache Headers ───────────
app.use("/api/auth", authLimiter, authRoutes);

// Apply API Limiter and appropriate Cache Control headers to specific route categories
app.use("/api/users", apiLimiter, cc(120), userRoutes);
app.use("/api/team", apiLimiter, cc(120), require("./modules/team/routes"));
app.use("/api/settings", apiLimiter, cc(300), require("./modules/settings/routes"));
app.use("/api/jobs", apiLimiter, cc(60), jobRoutes);

// Dynamic endpoints (no browser caching, default rate limiters)
app.use("/api/candidates/bulk-upload", uploadLimiter, require("./routes/bulkUpload"));
app.use("/api/candidates", apiLimiter, cc(0), candidateRoutes);
app.use("/api/applications", apiLimiter, cc(0), applicationRoutes);
app.use("/api/pipeline", apiLimiter, cc(0), pipelineRoutes);
app.use("/api/interviews", apiLimiter, cc(0), interviewRoutes);
app.use("/api/reports", apiLimiter, cc(0), reportRoutes);
app.use("/api/sales", apiLimiter, cc(0), salesRoutes);
app.use("/api/dashboard", apiLimiter, cc(0), dashboardRoutes);
app.use("/api/college-drives", apiLimiter, cc(0), collegeDriveRoutes);
app.use("/api/audit-logs", apiLimiter, cc(0), auditRoutes);
app.use("/api/notifications", apiLimiter, cc(0), notificationRoutes);
app.use("/api/sse", cc(0), require("./routes/sse"));
app.use("/api/files", apiLimiter, cc(0), require("./modules/files/routes"));
app.use("/api/analytics", analyticsLimiter, cc(0), require("./modules/analytics/routes"));

app.use(notFound);
app.use(errorHandler);

async function bootstrap() {
  try {
    const redis = require('./utils/redisClient');
    // Warm up Redis connection before accepting traffic
    await redis.warmup();

    const server = http.createServer(app);
    initSocket(server);

    server.listen(PORT, () => {
      console.log(`[ATS-STABILIZED-V3.0] Server is running on port ${PORT}`);
    });

    // Start the scheduling sync job
    scheduleSyncJob().catch(err => {
      console.error('[SchedulingSync] Failed to schedule sync job:', err);
    });

    // Pre-warm critical cache keys (non-blocking)
    const { warmCaches } = require('./utils/cacheWarmer');
    warmCaches().catch(err => {
      console.error('[CacheWarmer] Warm-up failed:', err.message);
    });

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log('[Server] Shutting down, closing workers...');
      try {
        await syncWorker.close();
        await importWorker.close();
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
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

bootstrap();