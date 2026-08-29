'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { auth, requireRoles } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../utils/errors');
const { validateFile } = require('../utils/fileValidator');
const { processBulkFeedbackUpload, getJobStatus } = require('../jobs/bulkFeedbackUpload.processor');
const { getErrorReportPath } = require('../lib/bulkUploadErrorReport');
const { pipelineJobStatusMap } = require('../lib/streamingBulkUploadPipeline');

const router = express.Router();
router.use(auth);

// Ensure temporary upload directory exists
const TEMP_DIR = path.join(__dirname, '..', '..', 'uploads', 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const { MAX_UPLOAD_BYTES } = require('../config/uploadLimits');

// Multer Disk Storage for handling files
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TEMP_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `bulk_feedback_${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    try {
      validateFile(file, 'bulkData');
      cb(null, true);
    } catch (err) {
      cb(err);
    }
  },
});

// ── GET /api/interview-feedback/bulk-upload/template/download ──────────────────────
router.get(
  '/template/download',
  requireRoles('SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER', 'USER'),
  asyncHandler(async (req, res) => {
    const { FEEDBACK_TEMPLATE_BY_ROUND, COMBINED_FEEDBACK_TEMPLATE, generateTemplate, verifyBufferSignature } = require('../lib/interviewTemplates');
    const round = req.query.round; // ROUND_1, ROUND_2, FINAL_ROUND
    const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';

    let schema;
    let filename;

    if (round && FEEDBACK_TEMPLATE_BY_ROUND[round]) {
      schema = FEEDBACK_TEMPLATE_BY_ROUND[round];
      filename = `feedback-template-${round.toLowerCase().replace(/_/g, '-')}.${format}`;
    } else {
      schema = COMBINED_FEEDBACK_TEMPLATE;
      filename = `feedback-template-all-rounds.${format}`;
    }

    try {
      const buffer = await generateTemplate(schema, format);
      verifyBufferSignature(buffer, format);

      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv; charset=utf-8');
      res.setHeader('Content-Length', buffer.length.toString());

      return res.end(buffer);
    } catch (err) {
      console.error('Template download failed:', err);
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ success: false, error: 'Template generation failed' });
    }
  })
);

const { BULK_UPLOAD_LIMITS } = require('../config/bulkUploadLimits');
const { countFileRows } = require('../lib/csvXlsxStreamParser');
const { checkOrgConcurrency, checkUserCooldown } = require('../lib/streamingBulkUploadPipeline');

// ── POST /api/interview-feedback/bulk-upload ──────────────────────
// Immediate 202 Accepted response with background pipeline processing
router.post(
  '/',
  requireRoles('SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER', 'USER'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const orgId = req.user?.organizationId || 'defaultOrg';

    // 1. Org Concurrency Guard (Max 1 concurrent job per org)
    const concurrency = checkOrgConcurrency(orgId);
    if (concurrency.blocked) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      }
      return res.status(409).json({
        success: false,
        error: {
          code: 'CONCURRENCY_LOCKED',
          message: `A bulk upload is already in progress for your organization (${concurrency.progress}% complete). Please wait for it to finish.`,
        },
      });
    }

    // 2. Per-user Cooldown Guard (60s cooldown after completing a job)
    const cooldown = checkUserCooldown(userId, userRole);
    if (cooldown.blocked) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      }
      return res.status(429).json({
        success: false,
        error: {
          code: 'COOLDOWN_ACTIVE',
          message: `Please wait ${cooldown.retryAfterSeconds} seconds before starting another bulk upload.`,
          retryAfterSeconds: cooldown.retryAfterSeconds,
        },
      });
    }

    if (!req.file) {
      throw new ApiError(400, 'File is required (field: file)');
    }

    const fileExt = path.extname(req.file.originalname).toLowerCase();

    // 3. Pre-parse Row Count Check (reject oversized files before parsing full rows)
    let rowCount = 0;
    try {
      rowCount = await countFileRows(req.file.path, fileExt);
    } catch (err) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      }
      throw new ApiError(400, `Failed to parse spreadsheet row count: ${err.message}`);
    }

    if (rowCount > BULK_UPLOAD_LIMITS.MAX_ROWS) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      }
      const suggestedFiles = Math.ceil(rowCount / BULK_UPLOAD_LIMITS.MAX_ROWS);
      throw new ApiError(
        400,
        `This sheet has ${rowCount.toLocaleString()} rows. The maximum limit is ${BULK_UPLOAD_LIMITS.MAX_ROWS} rows per upload. Please split it into ${suggestedFiles} smaller files.`
      );
    }

    const jobId = uuidv4();
    const defaultRound = req.body.defaultRound || null;

    setImmediate(async () => {
      try {
        await processBulkFeedbackUpload({
          jobId,
          filePath: req.file.path,
          fileType: fileExt,
          uploadedBy: req.user?.id || null,
          userRole,
          organizationId: orgId,
          defaultRound,
          sourceFilename: req.file.originalname,
        });
      } catch (err) {
        console.error(`[BulkFeedbackRoute] Job ${jobId} error:`, err.message);
      }
    });

    res.status(202).json({
      success: true,
      jobId,
      data: {
        jobId,
        status: 'active',
        message: 'Feedback file accepted. Job queued for background processing.',
      },
    });
  })
);

// ── GET /api/interview-feedback/bulk-upload/:jobId (Status Check) ─────────────────
router.get(
  '/:jobId',
  requireRoles('SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER', 'USER'),
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;
    const status = getJobStatus(jobId);

    if (!status) {
      throw new ApiError(404, `Job with ID "${jobId}" not found`);
    }

    res.json({
      success: true,
      data: status,
    });
  })
);

// ── GET /api/interview-feedback/bulk-upload/:jobId/report (Download CSV Error/Warning Report)
router.get(
  '/:jobId/report',
  requireRoles('SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER', 'USER'),
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;
    const filePath = getErrorReportPath(jobId);

    if (!filePath || !fs.existsSync(filePath)) {
      throw new ApiError(404, `Error report for job "${jobId}" not found`);
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bulk_feedback_report_${jobId}.csv"`);
    res.sendFile(filePath);
  })
);

module.exports = router;
