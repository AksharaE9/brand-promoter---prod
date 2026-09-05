'use strict';

/**
 * joinedCandidatesUpload.js
 * Route: POST /api/candidates/bulk-upload/joined
 *        GET  /api/candidates/bulk-upload/joined/template/download
 *        GET  /api/candidates/bulk-upload/joined/:jobId
 *        GET  /api/candidates/bulk-upload/joined/:jobId/report
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { auth, requireRoles } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../utils/errors');
const { validateFile } = require('../utils/fileValidator');
const { processJoinedCandidateUpload, getJobStatus } = require('../jobs/bulkJoinedCandidateUpload.processor');
const { getErrorReportPath, getReportContentType } = require('../lib/bulkUploadErrorReport');
const { BULK_UPLOAD_LIMITS } = require('../config/bulkUploadLimits');
const { countFileRows } = require('../lib/csvXlsxStreamParser');
const { checkOrgConcurrency, checkUserCooldown } = require('../lib/streamingBulkUploadPipeline');
const { MAX_UPLOAD_BYTES } = require('../config/uploadLimits');

const router = express.Router();
router.use(auth);

const TEMP_DIR = path.join(__dirname, '..', '..', 'uploads', 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TEMP_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `bulk_joined_${uuidv4()}${ext}`);
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

// ── GET /template/download ──────────────────────────────────────────────────
router.get(
  '/template/download',
  requireRoles('SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER', 'USER'),
  asyncHandler(async (req, res) => {
    const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
    const filename = `joined_candidates_bulk_upload_template.${format}`;

    const schema = [
      { key: 'name',         label: 'Name',           required: true },
      { key: 'phone',        label: 'Phone Number',   required: true },
      { key: 'email',        label: 'E-Mail',         required: false },
      { key: 'role',         label: 'Role',           required: false },
      { key: 'joiningDate',  label: 'Joining Date',   required: false },
      { key: 'college',      label: 'College',        required: false },
      { key: 'location',     label: 'Location',       required: false },
      { key: 'course',       label: 'Course',         required: false },
      { key: 'source',       label: 'Source',         required: false },
      { key: 'company',      label: 'Company',        required: false },
    ];

    if (format === 'xlsx') {
      try {
        const { generateTemplate, verifyBufferSignature } = require('../lib/interviewTemplates');
        const buffer = await generateTemplate(schema, 'xlsx');
        verifyBufferSignature(buffer, 'xlsx');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Length', buffer.length.toString());
        return res.end(buffer);
      } catch (err) {
        console.error('Joined template download failed:', err);
        return res.status(500).json({ success: false, error: 'Template generation failed' });
      }
    }

    const headers = schema.map(f => f.required ? `${f.label} *` : f.label);
    const sampleRow = ['Rahul Sharma', '+919876543210', 'rahul@example.com', 'Software Engineer', '2024-06-01', 'IIT Bangalore', 'Bangalore', 'B.Tech CSE', 'LinkedIn', 'Akshara Enterprises'];
    const csvContent = headers.join(',') + '\n' + sampleRow.map(v => `"${v}"`).join(',') + '\n';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  })
);

// ── POST / ──────────────────────────────────────────────────────────────────
router.post(
  '/',
  requireRoles('SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER', 'USER'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const orgId = req.user?.organizationId || 'defaultOrg';

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
      throw new ApiError(400,
        `This sheet has ${rowCount.toLocaleString()} rows. The maximum limit is ${BULK_UPLOAD_LIMITS.MAX_ROWS} rows per upload. Please split it into ${suggestedFiles} smaller files.`
      );
    }

    const jobId = uuidv4();

    setImmediate(async () => {
      try {
        await processJoinedCandidateUpload({
          jobId,
          filePath: req.file.path,
          fileType: fileExt,
          uploadedBy: req.user?.id || null,
          userRole,
          organizationId: orgId,
          sourceFilename: req.file.originalname,
        });
      } catch (err) {
        console.error(`[JoinedUploadRoute] Job ${jobId} error:`, err.message);
      }
    });

    res.status(202).json({
      success: true,
      jobId,
      data: {
        jobId,
        status: 'active',
        message: 'Joined candidates file accepted. Job queued for background processing.',
      },
    });
  })
);

// ── GET /:jobId ─────────────────────────────────────────────────────────────
router.get(
  '/:jobId',
  requireRoles('SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER', 'USER'),
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;
    const status = getJobStatus(jobId);
    if (!status) {
      throw new ApiError(404, `Job with ID "${jobId}" not found`);
    }
    res.json({ success: true, data: status });
  })
);

// ── GET /:jobId/report ──────────────────────────────────────────────────────
router.get(
  '/:jobId/report',
  requireRoles('SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER', 'USER'),
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;
    const filePath = getErrorReportPath(jobId);
    if (!filePath || !fs.existsSync(filePath)) {
      throw new ApiError(404, `Error report for job "${jobId}" not found`);
    }
    const contentType = getReportContentType(filePath);
    const ext = filePath.endsWith('.xlsx') ? 'xlsx' : 'csv';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="bulk_joined_report_${jobId}.${ext}"`);
    res.sendFile(filePath);
  })
);

module.exports = router;
