'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { auth, requireRoles } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../utils/errors');
const { validateFile } = require('../utils/fileValidator');
const { enqueueJob, getJobStatus } = require('../jobs/bulkCandidateUpload.processor');
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
    cb(null, `bulk_upload_${uuidv4()}${ext}`);
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

const { CANDIDATE_IMPORT_SCHEMA } = require('../lib/candidateImportSchema');

// ── GET /api/candidates/bulk-upload/template/download ──────────────────────
router.get(
  '/template/download',
  requireRoles('SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER', 'USER'),
  asyncHandler(async (req, res) => {
    const headers = CANDIDATE_IMPORT_SCHEMA.map(f => f.required ? `${f.label} *` : f.label);
    const sampleRow = [
      'EXT-1001',
      'Jane Smith',
      'Senior Developer',
      'jane.smith@example.com',
      '+14155552671',
      'https://drive.google.com/file/d/123456789/view',
      'Stanford University',
      'San Francisco',
      'Computer Science',
      'LinkedIn',
      'Acme Corp',
    ];
    const csvContent = headers.join(',') + '\n' + sampleRow.map(v => `"${v}"`).join(',') + '\n';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="candidate_bulk_upload_template.csv"');
    res.send(csvContent);
  })
);

// ── POST /api/candidates/bulk-upload (Main Multipart Upload Endpoint) ──────
// Returns 202 Accepted with jobId in < 1 second. Processing happens in background worker.
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
    const driveId = req.query.driveId || req.body?.driveId || null;

    // Enqueue job for background processing
    await enqueueJob({
      jobId,
      filePath: req.file.path,
      fileType: fileExt,
      uploadedBy: req.user?.id || null,
      organizationId: req.user?.organizationId || 'defaultOrg',
      sourceFilename: req.file.originalname,
      driveId,
    });

    // Immediate 202 Accepted response
    res.status(202).json({
      success: true,
      jobId,
      data: {
        jobId,
        status: 'active',
        message: 'File upload accepted. Job queued for background processing.',
      },
    });
  })
);

// ── Backward-compatible legacy upload route (POST /upload) ────────────────
router.post(
  '/upload',
  requireRoles('SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER', 'USER'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'File is required');
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    const jobId = uuidv4();

    await enqueueJob({
      jobId,
      filePath: req.file.path,
      fileType: fileExt,
      uploadedBy: req.user?.id || null,
      organizationId: req.user?.organizationId || 'defaultOrg',
    });

    res.status(202).json({
      success: true,
      data: {
        jobId,
        sessionId: jobId,
        status: 'active',
        message: 'Upload accepted and queued',
      },
    });
  })
);

// ── GET /api/candidates/bulk-upload/:jobId (Status Check) ─────────────────
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

// Legacy route alias: GET /api/candidates/bulk-upload/jobs/:jobId/status
router.get(
  '/jobs/:jobId/status',
  requireRoles('SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER', 'USER'),
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;
    const status = getJobStatus(jobId);

    if (!status) throw new ApiError(404, 'Job not found');

    res.json({
      success: true,
      data: {
        jobId: status.jobId,
        state: status.state,
        progress: status.progress,
        result: status,
      },
    });
  })
);

// ── GET /api/candidates/bulk-upload/:jobId/report (Download CSV Error Report)
router.get(
  '/:jobId/report',
  requireRoles('SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER', 'USER'),
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;
    const reportPath = getErrorReportPath(jobId);

    if (!reportPath || !fs.existsSync(reportPath)) {
      throw new ApiError(404, 'Error report not found for this job');
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="bulk_upload_report_${jobId}.csv"`);
    fs.createReadStream(reportPath).pipe(res);
  })
);

// Legacy route alias: GET /api/candidates/bulk-upload/jobs/:jobId/errors
router.get(
  '/jobs/:jobId/errors',
  requireRoles('SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER', 'USER'),
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;
    const reportPath = getErrorReportPath(jobId);

    if (!reportPath || !fs.existsSync(reportPath)) {
      throw new ApiError(404, 'Report not found');
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="import_errors_${jobId}.csv"`);
    fs.createReadStream(reportPath).pipe(res);
  })
);

module.exports = router;
