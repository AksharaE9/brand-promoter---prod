const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const { v4: uuidv4 } = require("uuid");
const { auth, requireRoles } = require("../middleware/auth");
const { asyncHandler, ApiError } = require("../utils/errors");
const { runBulkImport } = require("../jobs/bulkImportWorker");

const router = express.Router();
router.use(auth);

// In-memory stores
const uploadSessions = new Map();
const jobsData = new Map();

// Set up Multer (Memory Storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      "text/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only CSV and Excel files are allowed."));
    }
  }
});



// GET /template/download
router.get(
  "/template/download",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const headers = [
      "Full Name", "Email", "Phone"
    ];
    const csvContent = headers.join(',') + '\n';
    
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="candidate_bulk_upload_template.csv"');
    res.send(csvContent);
  })
);

// POST /upload
router.post(
  "/upload",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, "File is required");

    let allRows = [];
    try {
      const workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
      if (workbook.SheetNames.length > 0) {
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const sheetRows = XLSX.utils.sheet_to_json(worksheet, { defval: "", raw: false });
        sheetRows.forEach((row, idx) => {
          allRows.push({ ...row, _sheetName: sheetName, _rowIndex: idx + 2 });
        });
      }
    } catch (err) {
      throw new ApiError(400, "Failed to parse file. Ensure it is a valid CSV or XLSX.");
    }

    if (allRows.length === 0) {
      throw new ApiError(400, "The uploaded file is empty.");
    }

    // Extract raw column headers
    const detectedColumns = Object.keys(allRows[0]).filter(k => !k.startsWith('_'));
    const previewRows = allRows.slice(0, 5).map(row => {
      const preview = {};
      detectedColumns.forEach(col => preview[col] = row[col]);
      return preview;
    });

    const sessionId = uuidv4();
    
    // Store parsed data in memory for 30 minutes
    const sessionData = {
      rows: allRows,
      userId: req.user.id,
      organizationId: req.user.organizationId || "defaultOrg"
    };
    uploadSessions.set(sessionId, sessionData);
    
    // Auto-cleanup after 30 minutes
    setTimeout(() => {
      uploadSessions.delete(sessionId);
    }, 30 * 60 * 1000);

    res.json({
      success: true,
      data: {
        sessionId,
        detectedColumns,
        previewRows,
        totalRows: allRows.length
      }
    });
  })
);

// POST /process
router.post(
  "/process",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { sessionId, columnMapping } = req.body;
    
    if (!sessionId || !columnMapping) {
      throw new ApiError(400, "sessionId and columnMapping are required");
    }

    // Check required fields
    const mappedValues = Object.values(columnMapping);
    if (!mappedValues.includes("fullName") || !mappedValues.includes("email")) {
      throw new ApiError(400, "fullName and email are required fields to map.");
    }

    // Verify session exists
    const sessionData = uploadSessions.get(sessionId);
    if (!sessionData) {
      throw new ApiError(404, "Session expired or not found. Please upload the file again.");
    }

    // Add to in-memory Jobs
    const jobId = uuidv4();
    jobsData.set(jobId, { id: jobId, state: "active", progress: 0, result: null });
    
    // Process asynchronously
    runBulkImport(
      sessionData, 
      columnMapping, 
      req.user.id, 
      req.user.organizationId || "defaultOrg",
      (progress) => {
        const job = jobsData.get(jobId);
        if (job) job.progress = progress;
      }
    ).then((result) => {
      const job = jobsData.get(jobId);
      if (job) {
        job.state = "completed";
        job.result = result;
      }
    }).catch((err) => {
      const job = jobsData.get(jobId);
      if (job) {
        job.state = "failed";
      }
      console.error("Bulk import failed:", err);
    });

    res.json({
      success: true,
      data: {
        jobId,
        message: "Import started. Track progress with the jobId."
      }
    });
  })
);

// GET /jobs/:jobId/status
router.get(
  "/jobs/:jobId/status",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const job = jobsData.get(req.params.jobId);
    if (!job) throw new ApiError(404, "Job not found");

    res.json({
      success: true,
      data: {
        jobId: job.id,
        state: job.state,
        progress: job.progress,
        result: job.result
      }
    });
  })
);

// GET /jobs/:jobId/errors
router.get(
  "/jobs/:jobId/errors",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { format, page = 1, limit = 50 } = req.query;
    
    const job = jobsData.get(req.params.jobId);
    if (!job || !job.result) throw new ApiError(404, "Job results not found");
    
    const errors = job.result.errors || [];

    if (format === "csv") {
      const headers = ["Row Number", "Name", "Email", "Error Reasons"];
      let csvContent = headers.join(',') + '\n';
      
      errors.forEach(err => {
        const row = err.rawData || {};
        const name = row.Name || row.fullName || "";
        const email = row.Email || row.email || "";
        const reason = (err.errors || []).join(" | ");
        csvContent += `"${err.rowNumber}","${name}","${email}","${reason}"\n`;
      });
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="import_errors_${req.params.jobId}.csv"`);
      return res.send(csvContent);
    }

    const start = (page - 1) * limit;
    const paginatedErrors = errors.slice(start, start + limit);

    res.json({
      success: true,
      data: {
        errors: paginatedErrors,
        total: errors.length,
        page: Number(page),
        limit: Number(limit)
      }
    });
  })
);

module.exports = router;
