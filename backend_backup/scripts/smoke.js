const path = require("path");
const { spawn } = require("child_process");

const apiBase = process.env.API_BASE_URL || "http://localhost:4000/api";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function isApiUp() {
  try {
    const res = await requestWithTimeout(`${apiBase}/health`, { method: "GET" }, 3000);
    return res.ok;
  } catch (_) {
    return false;
  }
}

async function waitForApi(maxWaitMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await isApiUp()) return true;
    await sleep(500);
  }
  return false;
}

function startLocalApi() {
  const backendRoot = path.resolve(__dirname, "..");
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: backendRoot,
    stdio: "pipe",
    env: process.env,
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[api] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[api] ${chunk}`);
  });

  return child;
}

async function stopLocalApi(child) {
  if (!child || child.killed) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      killer.on("close", () => resolve());
      killer.on("error", () => resolve());
    });
    return;
  }
  child.kill("SIGTERM");
}

async function req(path, options = {}) {
  const res = await requestWithTimeout(`${apiBase}${path}`, options);
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }

  if (!res.ok) {
    throw new Error(`${path} failed: ${res.status} ${data?.message || ""}`.trim());
  }
  return data;
}

async function run() {
  let localApi = null;

  if (!(await isApiUp())) {
    localApi = startLocalApi();
    const up = await waitForApi();
    if (!up) {
      await stopLocalApi(localApi);
      throw new Error(`API is not reachable at ${apiBase}.`);
    }
  }

  await req("/health");

  const suffix = Date.now();
  await req("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "Smoke",
      lastName: "Recruiter",
      email: `smoke.recruiter.${suffix}@ats.local`,
      password: "ChangeMe@123",
      role: "RECRUITER",
    }),
  });

  await req("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "Smoke",
      lastName: "Interviewer",
      email: `smoke.interviewer.${suffix}@ats.local`,
      password: "ChangeMe@123",
      role: "INTERVIEWER",
    }),
  });

  const login = await req("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@ats.local",
      password: "ChangeMe@123",
    }),
  });

  const token = login?.data?.token;
  if (!token) {
    throw new Error("No token returned from login");
  }

  const authHeaders = { Authorization: `Bearer ${token}` };
  await Promise.all([
    req("/auth/me", { headers: authHeaders }),
    req("/users", { headers: authHeaders }),
    req("/users/audit-logs?limit=5", { headers: authHeaders }),
    req("/users/interviewers", { headers: authHeaders }),
    req("/candidates?limit=5", { headers: authHeaders }),
    req("/jobs?limit=5", { headers: authHeaders }),
    req("/applications?limit=5", { headers: authHeaders }),
    req("/pipeline/stages", { headers: authHeaders }),
    req("/interviews", { headers: authHeaders }),
    req("/reports/recruiter-activity", { headers: authHeaders }),
    req("/reports/hiring-progress", { headers: authHeaders }),
  ]);

  console.log("Smoke check passed");
  await stopLocalApi(localApi);
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
