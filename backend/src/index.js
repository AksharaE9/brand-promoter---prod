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
const compression = require("compression");
const { notFound, errorHandler } = require("./middleware/error-handler");
const { createRateLimiter, setSecurityHeaders } = require("./middleware/security");
const { timingMiddleware } = require("./middleware/timing");

const app = express();
const PORT = process.env.PORT || 4000;
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map(o => o.trim())
  : [];

// ── Performance: Compression (first middleware) ──────────────
app.use(compression({
  level: 6,               // best speed/size balance
  threshold: 1024,        // only compress responses over 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

// ── Performance: Timing middleware ───────────────────────────
app.use(timingMiddleware);

// ── Security: Headers ────────────────────────────────────────
app.disable('x-powered-by');

// Trust proxy if behind nginx/load balancer/Render
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);

      // If '*' is allowed, allow all
      if (allowedOrigins.includes("*") || allowedOrigins.length === 0) {
        return callback(null, true);
      }

      // Check if origin matches allowed list
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Allow vercel preview apps and localhost
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
app.use(createRateLimiter({ max: 500, message: "Too many API requests. Please retry shortly." })); // Increased for higher concurrency
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads"), { maxAge: '1d' }));

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "ATS Backend is running",
    timestamp: new Date().toISOString(),
  });
});

// ── Refined Cache-Control headers ────────────────────────────
app.use((req, res, next) => {
  if (req.method === "GET" && req.path.startsWith("/api/")) {
    // Skip caching for auth, SSE streams, and health
    const noCachePaths = ["/api/auth/", "/api/health", "/api/notifications/stream"];
    const shouldNoCache = noCachePaths.some(p => req.path.includes(p));

    // Dynamic data — no browser cache
    const dynamicPaths = ["/api/notifications", "/api/candidates"];
    const isDynamic = dynamicPaths.some(p => req.path.startsWith(p));

    if (shouldNoCache) {
      // No caching at all
    } else if (isDynamic) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    } else {
      // Static-ish data (jobs, team, analytics, dashboard)
      res.setHeader("Cache-Control", "private, max-age=30, stale-while-revalidate=120");
    }
  }
  next();
});

app.use("/api/auth", createRateLimiter({ max: 20, message: "Too many authentication attempts. Please wait." }));
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/team", require("./modules/team/routes"));
app.use("/api/settings", require("./modules/settings/routes"));
app.use("/api/files", require("./modules/files/routes"));
app.use("/api/analytics", require("./modules/analytics/routes"));
app.use("/api/candidates/bulk-upload", require("./routes/bulkUpload"));
app.use("/api/candidates", candidateRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/pipeline", pipelineRoutes);
app.use("/api/interviews", interviewRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/college-drives", collegeDriveRoutes);
app.use("/api/audit-logs", auditRoutes);
app.use("/api/notifications", notificationRoutes);

app.use(notFound);
app.use(errorHandler);

async function bootstrap() {
  try {
    const server = http.createServer(app);
    initSocket(server);

    server.listen(PORT, () => {
      console.log(`[ATS-STABILIZED-V3.0] Server is running on port ${PORT}`);
    });

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