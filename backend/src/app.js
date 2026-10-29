'use strict';
/**
 * app.js — Express application factory (separated from server bootstrap).
 *
 * This file exports the configured Express `app` so it can be imported by:
 *  - src/index.js  (which calls app.listen)
 *  - test suites   (which use supertest — no .listen() needed)
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const sse = require('./utils/sse');
const { getCacheMetrics } = require('./utils/cache');
const { auth, requireRoles } = require('./middleware/auth');

const authRoutes         = require('./modules/auth/routes');
const userRoutes         = require('./modules/users/routes');
const candidateRoutes    = require('./modules/candidates/routes');
const applicationRoutes  = require('./modules/applications/routes');
const pipelineRoutes     = require('./modules/pipeline/routes');
const interviewRoutes    = require('./modules/interviews/routes');
const jobRoutes          = require('./modules/jobs/routes');
const reportRoutes       = require('./modules/reports/routes');
const salesRoutes        = require('./modules/sales/routes');
const dashboardRoutes    = require('./modules/dashboard/routes');
const collegeDriveRoutes = require('./modules/college-drives/routes');
const auditRoutes        = require('./modules/audit/routes');
const notificationRoutes = require('./modules/notifications/routes');
const schedulingRoutes   = require('./modules/scheduling/routes');


const compression  = require('compression');
const { notFound, errorHandler } = require('./middleware/error-handler');
const { setSecurityHeaders }     = require('./middleware/security');
const { timingMiddleware }        = require('./middleware/timing');
const dedupMiddleware             = require('./middleware/deduplication');
const { authLimiter, apiLimiter, analyticsLimiter, uploadLimiter, globalLimiter, heavyEndpointLimiter } = require('./middleware/rateLimiter');
const responseSizeLogger = require('./middleware/responseSizeLogger');
const cc = require('./middleware/cacheHeaders');
const pushHints = require('./middleware/pushHints');

const app = express();
const PORT = process.env.PORT || 4000;
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : [];

// ── Performance: Compression (Track 4) ──────────────────────────────────────
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    const accept = req.headers.accept || '';
    if (accept.includes('text/event-stream') || req.path?.includes('/sse')) return false;

    // Skip already compressed files
    const url = (req.path || '').toLowerCase();
    if (
      url.endsWith('.pdf') ||
      url.endsWith('.png') ||
      url.endsWith('.jpg') ||
      url.endsWith('.jpeg') ||
      url.endsWith('.docx') ||
      url.endsWith('.xlsx') ||
      url.endsWith('.zip')
    ) {
      return false;
    }

    return compression.filter(req, res);
  },
  chunkSize: 16 * 1024,
}));

const crypto = require('crypto');

app.use((req, res, next) => {
  const incomingId = req.headers['x-request-id'];
  req.clientRequestId = (typeof incomingId === 'string' && incomingId.trim()) ? incomingId.trim() : null;
  req.id = (typeof incomingId === 'string' && incomingId.trim().startsWith('req_be_'))
    ? incomingId.trim()
    : `req_be_${crypto.randomBytes(8).toString('hex')}`;
  res.setHeader('X-Request-Id', req.id);
  next();
});

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes('*')) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      if (
        /^https:\/\/brand-promoter-prod-.*\.vercel\.app$/.test(origin) ||
        // SEC-008: Only allow localhost origins in non-production environments
        (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost:\d+$/.test(origin))
      ) {
        return callback(null, true);
      }
      if (allowedOrigins.length === 0 && process.env.NODE_ENV !== 'production') {
        if (/^https?:\/\/localhost(:\d+)?$/.test(origin) || /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) {
          return callback(null, true);
        }
      }
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS', 'QUERY'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Idempotency-Key'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
    optionsSuccessStatus: 204,
  }),
);

app.use(timingMiddleware);
app.use(require('./middleware/serverTiming'));
app.use(dedupMiddleware);
app.use(pushHints);

app.disable('x-powered-by');


if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(setSecurityHeaders);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ limit: '2mb', extended: true }));
app.use('/uploads', auth, express.static(path.join(__dirname, '..', 'uploads'), { maxAge: '1d' }));

const { concurrencyLimiter } = require('./middleware/concurrencyLimiter');
const { loadSheddingMiddleware, heavyEndpointConcurrency, requestTimeout } = require('./middleware/loadShedding');
const { getEventLoopMetrics, getRouteMetricsSummary } = require('./utils/perfContext');

// ── Global Middleware for all /api routes ──────────────────────────────────
app.use('/api', requestTimeout(25000));
app.use('/api', globalLimiter);
app.use('/api', responseSizeLogger);
app.use('/api', concurrencyLimiter);
app.use('/api', loadSheddingMiddleware);

// ── Health endpoints ──────────────────────────────────────────────────────
const prisma = require('./config/db');

// Load build version info dynamically
let versionInfo = { commit: 'unknown', deployedAt: 'unknown' };
try {
  versionInfo = require('./version.json');
} catch (err) {
  // Fallback if not generated yet
}

// Background database keep-alive ping
// Under PERF_WINDOWED_KEEPALIVE=true, ping is windowed to business hours 08:00 - 21:00 IST Mon-Sat (Track 7.2)
function shouldRunDbKeepAlive() {
  if (process.env.PERF_WINDOWED_KEEPALIVE !== 'true') return true;
  const now = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffsetMs);
  const day = istTime.getUTCDay(); // 0 is Sunday
  if (day === 0) return false;
  const hour = istTime.getUTCHours();
  return hour >= 8 && hour < 21;
}

setInterval(async () => {
  if (!shouldRunDbKeepAlive()) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.warn('[DBKeepAlive] Database ping failed:', err.message);
  }
}, 4 * 60 * 1000);

app.get('/api/version', (req, res) => {
  res.json({
    success: true,
    version: '1.0.0',
    commit: process.env.RENDER_GIT_COMMIT || versionInfo.commit || 'live',
    deployedAt: versionInfo.deployedAt || new Date().toISOString(),
    timestamp: new Date().toISOString(),
    status: 'live',
  });
});

app.get('/api/health', async (req, res) => {
  let dbStatus = 'healthy';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    dbStatus = `unhealthy: ${err.message}`;
  }

  const responseData = {
    success: true,
    message: 'ATS Backend is running',
    timestamp: new Date().toISOString(),
    version: versionInfo,
    services: {
      database: dbStatus,
      sse: sse.getStats(),
    },
  };

  // Expose event loop delay and memory for authorized inspection or admin detail (Part 1.2)
  if (req.query.detail === 'admin' || req.headers['x-perf-debug'] === process.env.LOADTEST_BYPASS_SECRET) {
    responseData.diagnostics = getEventLoopMetrics();
  }

  res.json(responseData);
});

app.get('/api/health/perf-metrics', auth, requireRoles('SUPER_ADMIN'), (req, res) => {
  res.json({
    success: true,
    diagnostics: getEventLoopMetrics(),
    routes: getRouteMetricsSummary(),
    cache: getCacheMetrics(),
    uptime: process.uptime(),
  });
});

app.get('/api/health/cache', auth, requireRoles('SUPER_ADMIN'), (req, res) => {
  const cacheStats = getCacheMetrics();
  const sseStats = sse.getStats();
  res.json({ success: true, cache: cacheStats, sse: sseStats, uptime: process.uptime() });
});

// ── Routes ────────────────────────────────────────────────────────────────

// Heavy endpoints rate limiters — POST uploads only (status/report polling must not be capped at 10/min)
app.post('/api/candidates/bulk-upload', heavyEndpointLimiter);
app.post('/api/interviews/bulk-upload', heavyEndpointLimiter);
app.post('/api/interview-feedback/bulk-upload', heavyEndpointLimiter);
app.post('/api/candidates/bulk-upload/joined', heavyEndpointLimiter);
app.post('/api/candidates/bulk-upload/offer-letter', heavyEndpointLimiter);
app.use('/api/reports', heavyEndpointLimiter);

app.use('/api/auth', authLimiter, authRoutes);

app.use('/api/users', apiLimiter, cc(15), userRoutes);
app.use('/api/team', apiLimiter, cc(15), require('./modules/team/routes'));
app.use('/api/settings', apiLimiter, cc(15), require('./modules/settings/routes'));
app.use('/api/companies', apiLimiter, cc(15), require('./modules/companies/routes'));
app.use('/api/jobs', apiLimiter, cc(15), jobRoutes);
app.post('/api/candidates/bulk-upload', uploadLimiter);
app.use('/api/candidates/bulk-upload', require('./routes/bulkUpload'));
app.post('/api/interview-feedback/bulk-upload', uploadLimiter);
app.use('/api/interview-feedback/bulk-upload', require('./routes/feedbackUpload'));
app.post('/api/interviews/bulk-upload', uploadLimiter);
app.use('/api/interviews/bulk-upload', require('./routes/interviewUpload'));
app.post('/api/candidates/bulk-upload/joined', uploadLimiter);
app.use('/api/candidates/bulk-upload/joined', require('./routes/joinedCandidatesUpload'));
app.post('/api/candidates/bulk-upload/offer-letter', uploadLimiter);
app.use('/api/candidates/bulk-upload/offer-letter', require('./routes/offerLetterUpload'));
app.use('/api/bulk-upload', require('./routes/bulkUploadHistoryRoutes'));
app.use('/api/candidates', require('./routes/internalReports'));
app.use('/api/candidates', apiLimiter, cc(0), candidateRoutes);
app.use('/api/applications', apiLimiter, cc(0), applicationRoutes);
app.use('/api/pipeline', apiLimiter, cc(0), pipelineRoutes);
app.use('/api/interviews', apiLimiter, cc(0), interviewRoutes);
app.use('/api/reports', apiLimiter, cc(0), reportRoutes);
app.use('/api/sales', apiLimiter, cc(0), salesRoutes);
app.use('/api/dashboard', apiLimiter, cc(0), dashboardRoutes);
app.use('/api/college-drives', apiLimiter, cc(0), collegeDriveRoutes);
app.use('/api/audit-logs', apiLimiter, cc(0), auditRoutes);
app.use('/api/notifications', apiLimiter, cc(0), notificationRoutes);
app.use('/api/sse', cc(0), require('./routes/sse'));
app.use('/api/files', apiLimiter, cc(0), require('./modules/files/routes'));
app.use('/api/posted-files', apiLimiter, cc(0), require('./modules/posted-files/routes'));
app.use('/api/analytics', analyticsLimiter, cc(0), require('./modules/analytics/routes'));
app.use('/api/scheduling', apiLimiter, cc(0), schedulingRoutes);
app.use('/api/quality-checks', apiLimiter, cc(0), require('./modules/quality-check/routes'));

// ── Resume Parsing & JD Match Scoring ──────────────────────────────────────
app.use('/api/matching', apiLimiter, cc(0), require('./modules/matching/routes'));

// ── External API (v1) ──────────────────────────────────────────────────────
app.use('/api/v1/ext', require('./modules/ext/routes'));

// ── Integrations: Recruit AI / HireIQ (v1) ─────────────────────────────────
app.use('/api/v1/integrations/recruit-ai', require('./modules/integrations/recruit-ai/routes'));

// ── Client Error Reporting ──────────────────────────────────────────────────
app.use('/api/client-errors', require('./modules/clientErrors/routes'));

app.use(notFound);
app.use(errorHandler);

module.exports = { app, PORT };
