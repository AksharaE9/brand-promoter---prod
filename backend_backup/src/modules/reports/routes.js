const express = require("express");
const PDFDocument = require("pdfkit");
const XLSX = require("xlsx");
const prisma = require("../../config/prisma");
const { auth, requireRoles } = require("../../middleware/auth");
const { verifyAccessToken } = require("../../utils/jwt");
const { asyncHandler, ApiError } = require("../../utils/errors");

const router = express.Router();

// NOTE: We do NOT use global router.use(auth) here to avoid blocking direct PDF downloads via query tokens.
// Instead, we apply it manually to each route.

async function buildRecruiterActivity() {
  const users = await prisma.user.findMany({
    where: { role: "RECRUITER" },
    select: { id: true, fullName: true, email: true, status: true },
  });

  const userIds = users.map((item) => item.id);
  const [jobs, candidates, interviews] = await Promise.all([
    prisma.job.groupBy({
      by: ["createdById"],
      where: { createdById: { in: userIds } },
      _count: { _all: true },
    }),
    prisma.candidate.groupBy({
      by: ["createdById"],
      where: { createdById: { in: userIds } },
      _count: { _all: true },
    }),
    prisma.interview.groupBy({
      by: ["createdById"],
      where: { createdById: { in: userIds } },
      _count: { _all: true },
    }),
  ]);

  const jobsMap = new Map(jobs.map((row) => [row.createdById, row._count._all]));
  const candidatesMap = new Map(candidates.map((row) => [row.createdById, row._count._all]));
  const interviewsMap = new Map(interviews.map((row) => [row.createdById, row._count._all]));

  return users.map((user) => ({
    recruiterId: user.id,
    recruiterName: user.fullName,
    recruiterEmail: user.email,
    status: user.status,
    jobsCreated: jobsMap.get(user.id) || 0,
    candidatesCreated: candidatesMap.get(user.id) || 0,
    interviewsScheduled: interviewsMap.get(user.id) || 0,
  }));
}

async function buildHiringProgress() {
  const jobs = await prisma.job.findMany({
    select: {
      id: true,
      title: true,
      department: true,
      isActive: true,
    },
    orderBy: { createdAt: "desc" },
    take: 500, // Safety limit
  });

  const jobIds = jobs.map(j => j.id);

  const stats = await prisma.application.groupBy({
    by: ["jobId", "status"],
    where: { jobId: { in: jobIds } },
    _count: { _all: true },
  });

  const grouped = new Map();
  stats.forEach((item) => {
    if (!grouped.has(item.jobId)) {
      grouped.set(item.jobId, {
        totalApplications: 0,
        inPipeline: 0,
        selected: 0,
        rejected: 0,
        joined: 0,
      });
    }

    const row = grouped.get(item.jobId);
    row.totalApplications += item._count._all;
    if (item.status === "IN_PIPELINE") row.inPipeline += item._count._all;
    if (item.status === "SELECTED") row.selected += item._count._all;
    if (item.status === "REJECTED") row.rejected += item._count._all;
    if (item.status === "JOINED") row.joined += item._count._all;
  });

  return jobs.map((job) => ({
    jobId: job.id,
    title: job.title,
    department: job.department || "General",
    jobStatus: job.isActive ? "ACTIVE" : "CLOSED",
    ...(grouped.get(job.id) || {
      totalApplications: 0,
      inPipeline: 0,
      selected: 0,
      rejected: 0,
      joined: 0,
    }),
  }));
}

async function buildPipelineInsights({ fromDate, toDate }) {
  const createdAtFilter = {};
  if (fromDate) createdAtFilter.gte = fromDate;
  if (toDate) createdAtFilter.lte = toDate;

  const applicationWhere = Object.keys(createdAtFilter).length > 0 ? { createdAt: createdAtFilter } : {};
  const applications = await prisma.application.findMany({
    where: applicationWhere,
    include: {
      candidate: {
        select: {
          id: true,
          source: true,
        },
      },
      currentStage: {
        select: { id: true, name: true },
      },
      pipelineEvents: {
        orderBy: { movedAt: "asc" },
        include: {
          fromStage: { select: { id: true, name: true } },
          toStage: { select: { id: true, name: true } },
        },
      },
    },
  });

  const totals = {
    totalApplications: applications.length,
    shortlisted: applications.filter((item) => item.shortlisted).length,
    selected: applications.filter((item) => item.status === "SELECTED").length,
    joined: applications.filter((item) => item.status === "JOINED").length,
  };
  totals.selectionRate = totals.totalApplications
    ? Math.round((totals.selected / totals.totalApplications) * 1000) / 10
    : 0;
  totals.joinRate = totals.totalApplications
    ? Math.round((totals.joined / totals.totalApplications) * 1000) / 10
    : 0;

  const sourceMap = new Map();
  applications.forEach((item) => {
    const key = item.candidate?.source?.trim() || "Unknown";
    if (!sourceMap.has(key)) {
      sourceMap.set(key, { source: key, total: 0, selected: 0, joined: 0 });
    }
    const row = sourceMap.get(key);
    row.total += 1;
    if (item.status === "SELECTED" || item.status === "JOINED") row.selected += 1;
    if (item.status === "JOINED") row.joined += 1;
  });
  const sourceFunnel = Array.from(sourceMap.values())
    .map((row) => ({
      ...row,
      selectedRate: row.total ? Math.round((row.selected / row.total) * 1000) / 10 : 0,
      joinedRate: row.total ? Math.round((row.joined / row.total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const stageDurations = new Map();
  applications.forEach((item) => {
    const events = item.pipelineEvents || [];
    for (let idx = 0; idx < events.length; idx += 1) {
      const event = events[idx];
      const stageName = event.toStage?.name || "Unknown";
      const start = new Date(event.movedAt).getTime();
      const end = idx + 1 < events.length ? new Date(events[idx + 1].movedAt).getTime() : Date.now();
      const days = Math.max(0, (end - start) / (1000 * 60 * 60 * 24));

      if (!stageDurations.has(stageName)) {
        stageDurations.set(stageName, { stage: stageName, totalDays: 0, samples: 0 });
      }
      const row = stageDurations.get(stageName);
      row.totalDays += days;
      row.samples += 1;
    }
  });

  const timeInStage = Array.from(stageDurations.values())
    .map((row) => ({
      stage: row.stage,
      sampleSize: row.samples,
      avgDays: Math.round((row.totalDays / Math.max(1, row.samples)) * 10) / 10,
    }))
    .sort((a, b) => b.avgDays - a.avgDays);

  return {
    totals,
    sourceFunnel,
    timeInStage,
  };
}

function sendExcel(res, reportName, rows) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${reportName}-${Date.now()}.xlsx"`,
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.send(buffer);
}

function sendPdf(res, reportName, rows) {
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${reportName}-${Date.now()}.pdf"`,
  );
  res.setHeader("Content-Type", "application/pdf");

  const doc = new PDFDocument({ margin: 50, size: "A4" });
  doc.pipe(res);

  // Header Section
  doc.fillColor("#071f52").fontSize(20).text("Enterprise ATS Report", { align: "left" });
  doc.fillColor("#6b7895").fontSize(10).text(`${reportName.replace("-", " ").toUpperCase()}`, { align: "left" });
  doc.text(`Generated on: ${new Date().toLocaleString()}`, { align: "left" });
  doc.moveDown(2);

  if (rows.length === 0) {
    doc.fontSize(12).fillColor("#333").text("No data available for this report.");
    doc.end();
    return;
  }

  // Table Configuration based on report
  let columns = [];
  if (reportName === "recruiter-activity") {
    columns = [
      { header: "Recruiter", key: "recruiterName", width: 150 },
      { header: "Status", key: "status", width: 70 },
      { header: "Jobs", key: "jobsCreated", width: 60 },
      { header: "Candidates", key: "candidatesCreated", width: 80 },
      { header: "Interviews", key: "interviewsScheduled", width: 80 },
    ];
  } else {
    // Default to hiring-progress
    columns = [
      { header: "Job Title", key: "title", width: 160 },
      { header: "Dept", key: "department", width: 90 },
      { header: "Apps", key: "totalApplications", width: 50 },
      { header: "Pipe", key: "inPipeline", width: 50 },
      { header: "Sel", key: "selected", width: 50 },
      { header: "Join", key: "joined", width: 50 },
    ];
  }

  const startX = 50;
  let startY = doc.y;
  const rowHeight = 25;
  const tableWidth = columns.reduce((acc, col) => acc + col.width, 0);

  // Draw Table Headers
  doc.rect(startX, startY, tableWidth, rowHeight).fill("#1f52cc");
  doc.fillColor("#ffffff").fontSize(10);
  
  let currentX = startX;
  columns.forEach((col) => {
    doc.text(col.header, currentX + 5, startY + 7, { width: col.width - 10, align: "left" });
    currentX += col.width;
  });

  startY += rowHeight;

  // Draw Table Rows
  doc.fillColor("#1b2444").fontSize(9);
  rows.forEach((row, index) => {
    // Alternate row background
    if (index % 2 === 1) {
      doc.rect(startX, startY, tableWidth, rowHeight).fill("#f8fbff");
      doc.fillColor("#1b2444");
    }

    currentX = startX;
    columns.forEach((col) => {
      const val = row[col.key] !== undefined ? String(row[col.key]) : "-";
      doc.text(val, currentX + 5, startY + 8, { width: col.width - 10, align: "left" });
      currentX += col.width;
    });

    // Draw horizontal line
    doc.strokeColor("#ebeff4").lineWidth(0.5).moveTo(startX, startY + rowHeight).lineTo(startX + tableWidth, startY + rowHeight).stroke();

    startY += rowHeight;

    // Page break handling
    if (startY > 750) {
      doc.addPage();
      startY = 50;
      
      // Re-draw headers on new page
      doc.rect(startX, startY, tableWidth, rowHeight).fill("#1f52cc");
      doc.fillColor("#ffffff").fontSize(10);
      currentX = startX;
      columns.forEach((col) => {
        doc.text(col.header, currentX + 5, startY + 7, { width: col.width - 10, align: "left" });
        currentX += col.width;
      });
      startY += rowHeight;
      doc.fillColor("#1b2444").fontSize(9);
    }
  });

  doc.end();
}

router.get(
  "/recruiter-activity",
  [auth, requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER")],
  asyncHandler(async (req, res) => {
    const rows = await buildRecruiterActivity();
    res.json({ success: true, data: rows });
  }),
);

router.get(
  "/hiring-progress",
  [auth, requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER")],
  asyncHandler(async (req, res) => {
    const rows = await buildHiringProgress();
    res.json({ success: true, data: rows });
  }),
);

router.get(
  "/pipeline-insights",
  [auth, requireRoles("SUPER_ADMIN", "RECRUITER", "INTERVIEWER")],
  asyncHandler(async (req, res) => {
    const days = Number.parseInt(req.query.days, 10) || 30;
    const boundedDays = Math.min(Math.max(days, 7), 365);
    const toDate = new Date();
    const fromDate = new Date(Date.now() - boundedDays * 24 * 60 * 60 * 1000);

    const insights = await buildPipelineInsights({ fromDate, toDate });
    res.json({
      success: true,
      meta: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        days: boundedDays,
      },
      data: insights,
    });
  }),
);

router.get(
  "/export",
  asyncHandler(async (req, res) => {
    // Manually handle auth for the export route to support query-param tokens (Strong Fix)
    let token = null;
    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
      token = req.headers.authorization.substring(7).trim();
    } else if (req.query.token) {
      token = req.query.token;
    }

    if (!token) throw new ApiError(401, "Authorization token is required for report export");
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({ 
      where: { id: payload.userId }, 
      select: { role: true, id: true, status: true } 
    });
    
    if (!user || user.status !== "ACTIVE") throw new ApiError(401, "Invalid or inactive user");
    if (!["SUPER_ADMIN", "RECRUITER"].includes(user.role)) throw new ApiError(403, "Forbidden: insufficient permissions");
    
    req.user = user; // Set user for potential downstream use

    const report = String(req.query.report || "").trim();
    const format = String(req.query.format || "excel").trim().toLowerCase();

    if (report === "dailyinterviews") {
      const { start, end, date } = req.query;
      if (!start || !end) throw new ApiError(400, "Start and end ISO timestamps are required");

      const interviews = await prisma.interview.findMany({
        where: { scheduledStart: { gte: new Date(start), lte: new Date(end) } },
        include: {
          application: {
            include: {
              candidate: { select: { fullName: true, email: true, phone: true } },
              job: { select: { title: true } },
            },
          },
          interviewers: { select: { fullName: true } },
        },
        orderBy: { scheduledStart: "asc" },
      });

      res.setHeader("Content-Disposition", `attachment; filename="interviews-${date}.pdf"`);
      res.setHeader("Content-Type", "application/pdf");

      const doc = new PDFDocument({ margin: 50 });
      doc.pipe(res);

      doc.fontSize(22).fillColor("#071f52").text("Daily Interview Schedule", { align: "center" });
      const dateLabel = date || start.toLocaleDateString();
      doc.fontSize(12).fillColor("#6b7895").text(`Date: ${dateLabel}`, { align: "center" });
      doc.moveDown(2.5);

      if (interviews.length === 0) {
        doc.fontSize(14).fillColor("#0f1b3d").text("No interviews scheduled for this day.", { align: "center" });
      } else {
        interviews.forEach((item) => {
          const timeStr = new Date(item.scheduledStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          doc.fontSize(13).fillColor("#071f52").text(`${timeStr} - ${item.application?.candidate?.fullName || "N/A"}`, { underline: true });
          const roundLabel = item.round || `Round ${item.roundNo}`;
          doc.fontSize(10).fillColor("#333").text(`Round: ${roundLabel} | Role: ${item.application?.job?.title || "General"}`);
          
          const interviewerNames = item.interviewers?.map((u) => u.fullName).join(", ") || "N/A";
          doc.text(`Interviewers: ${interviewerNames} | Mode: ${item.mode}`);
          doc.fillColor("#666").text(`Contact: ${item.application?.candidate?.email || item.application?.candidate?.phone || "N/A"}`);
          doc.moveDown(1.5);
        });
      }
      doc.end();
      return;
    }

    if (!["recruiter-activity", "hiring-progress", "dailyinterviews"].includes(report)) {
      throw new ApiError(400, `Invalid report type: [${report}]. Must be recruiter-activity or hiring-progress`);
    }
    if (!["excel", "pdf"].includes(format)) {
      throw new ApiError(400, "format must be excel or pdf");
    }

    const rows =
      report === "recruiter-activity"
        ? await buildRecruiterActivity()
        : await buildHiringProgress();

    if (format === "excel") {
      sendExcel(res, report, rows);
      return;
    }

    sendPdf(res, report, rows);
  }),
);

module.exports = router;
