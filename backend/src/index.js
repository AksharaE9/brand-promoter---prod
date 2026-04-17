const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const prisma = require("./config/prisma");
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
const { notFound, errorHandler } = require("./middleware/error-handler");
const { createRateLimiter, setSecurityHeaders } = require("./middleware/security");

const app = express();
const PORT = process.env.PORT || 4000;
const allowedOrigin = process.env.CORS_ORIGIN || "*";

app.use((req, res, next) => {
  console.log(`[DEBUG] ${req.method} ${req.url}`);
  next();
});

app.use(
  cors({
    origin: allowedOrigin === "*" ? true : allowedOrigin,
    credentials: true,
  }),
);
app.use(setSecurityHeaders);
app.use(express.json({ limit: "2mb" }));
app.use(createRateLimiter({ max: 240, message: "Too many API requests. Please retry shortly." }));
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "ATS Backend is running",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth", createRateLimiter({ max: 20, message: "Too many authentication attempts. Please wait." }));
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/candidates", candidateRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/pipeline", pipelineRoutes);
app.use("/api/interviews", interviewRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/dashboard", dashboardRoutes);

app.use(notFound);
app.use(errorHandler);

async function bootstrap() {
  try {
    await prisma.$connect();
    const server = app.listen(PORT, () => {
      console.log(`[ATS-STABILIZED-V2.0] Server is running on port ${PORT}`);
    });

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
