'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { auth, requireRoles } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../utils/errors');
const { processBulkInterviewUpload, getJobStatus } = require('../jobs/bulkInterviewUpload.processor');
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
    cb(null, `bulk_interviews_${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.csv', '.xlsx', '.xls'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new ApiError(415, 'Unsupported file type. Only CSV (.csv) and Excel (.xlsx, .xls) files are allowed.'));
    }
  },
});

// ── GET /api/interviews/bulk-upload/template/download ──────────────────────
router.get(
  '/template/download',
  requireRoles('SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER', 'USER'),
  asyncHandler(async (req, res) => {
    const { INTERVIEW_SCHEDULE_IMPORT_SCHEMA, generateTemplate, verifyBufferSignature } = require('../lib/interviewTemplates');
    const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
    const filename = `interview-schedule-template.${format}`;

    try {
      const buffer = await generateTemplate(INTERVIEW_SCHEDULE_IMPORT_SCHEMA, format);
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

// ── POST /api/interviews/bulk-upload ──────────────────────
router.post(
  '/',
  requireRoles('SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER', 'USER'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (userId) {
      for (const status of pipelineJobStatusMap.values()) {
        if (status.uploadedBy === userId && status.state === 'active') {
          return res.status(409).json({
            success: false,
            message: 'You already have a bulk upload in progress. Please wait for it to complete.'
          });
        }
      }
    }

    if (!req.file) {
      throw new ApiError(400, 'File is required (field: file)');
    }

    const fileExt = path.extname(req.file.originalname).toLowerCase();
    const jobId = uuidv4();
    const defaultRound = req.body.defaultRound || null;
    const defaultMode = req.body.defaultMode || null;

    setImmediate(async () => {
      try {
        await processBulkInterviewUpload({
          jobId,
          filePath: req.file.path,
          fileType: fileExt,
          uploadedBy: req.user?.id || null,
          organizationId: req.user?.organizationId || 'defaultOrg',
          defaultRound,
          defaultMode,
          sourceFilename: req.file.originalname,
        });
      } catch (err) {
        console.error(`[BulkInterviewRoute] Job ${jobId} error:`, err.message);
      }
    });

    res.status(202).json({
      success: true,
      jobId,
      data: {
        jobId,
        status: 'active',
        message: 'Interview schedule file accepted. Job queued for background processing.',
      },
    });
  })
);

// ── GET /api/interviews/bulk-upload/:jobId (Status Check) ─────────────────
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

// ── GET /api/interviews/bulk-upload/:jobId/report (Download CSV Error/Warning Report)
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
    res.setHeader('Content-Disposition', `attachment; filename="bulk_interview_report_${jobId}.csv"`);
    res.sendFile(filePath);
  })
);

module.exports = router;
