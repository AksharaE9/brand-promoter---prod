# TalentOS Comprehensive Feature Inventory & QA Mapping

Generated: 2026-10-28
Environment: Staging & Production
Branch: main

---

## 1. Status of Recent Builds

| Build Feature | Implementation Location | Database Models / Tables | Status | Notes |
|---|---|---|---|---|
| **Resume Parsing & JD Scoring** | `backend/src/modules/matching/` | `job_descriptions`, `parsed_resumes`, `match_scores`, `resume_parse_jobs` | **IMPLEMENTED** | Multi-role parsing (Ops, BDE, S&M), taxonomy matching, scoring engine, async worker. |
| **External API & API Keys** | `backend/src/modules/ext/` | `api_keys`, `api_key_usage_daily`, `api_key_audit_events` | **IMPLEMENTED** | Scoped keys (`tos_live_...`), HMAC hashing with pepper, token-bucket rate limiter. |
| **HireIQ Feed** | `backend/src/modules/ext/routes.js` | `api_keys`, `interviews`, `candidates` | **IMPLEMENTED** | Dedicated 6-field DTO endpoint (`GET /api/v1/ext/interviews`), resume binary streaming. |
| **Recruit AI Results Sync** | `backend/src/modules/integrations/recruit-ai/` | `integration_providers`, `external_assessment_results`, `integration_inbox_events`, `integration_sync_states` | **IMPLEMENTED** | Outbound schedule dispatcher, inbound webhook with signature verification, normalizer, 15m poller. |
| **Telecalling Team Sync Fix** | `backend/src/modules/scheduling/` | `scheduling_members`, `scheduling_leads` | **IMPLEMENTED** | Direct lookup via `getTelecallingMembers()`, cache invalidation guards. |
| **Session Expiry & Error Classification** | `backend/src/middleware/auth.js`, `error-handler.js` | `sessions`, `users` | **IMPLEMENTED** | Classification of 401/403/500/413, `X-Request-Id` server issuance, smooth sign-out handling. |
| **Drive Bulk-Upload Fix** | `backend/src/routes/bulkUpload.js` | `college_drives`, `candidates` | **IMPLEMENTED** | Gopalan (31 rows) and NMIT (26 rows) regression fixes, deduplication, row-level error reporting. |
| **Follow-up Upload Fix** | `backend/src/modules/files/`, `modules/posted-files/` | `file_metas` | **IMPLEMENTED** | Accepts spaces in filenames, all photo formats (.jpeg, .png, .webp), binary streaming. |
| **BCA/MCA & City Exports** | `backend/scripts/exports/` | N/A | **NOT BUILT / PENDING** | Marked as **UNTESTED-NOT-BUILT**. Export scripts not yet committed to repository. |

---

## 2. Frontend Routes & QA Area Mapping

| Route | Component | Access Roles | Test Area |
|---|---|---|---|
| `/` | `LandingPage` | Public | **A1** |
| `/login` | `LoginPage` | Public | **A1, A2, A5** |
| `/signup` | `SignupPage` | Public | **A1** |
| `/careers` | `PublicCareers` | Public | **Core** |
| `/workspaces` | `WorkspaceSelector` | Authenticated | **A1** |
| `/dashboard` | `Dashboard` | All Roles | **Core** |
| `/candidates` | `Candidates` | All Roles | **B1, B2, B3, B4** |
| `/candidates/:id` | `CandidateProfile` | All Roles | **B5, E1-E4, K2** |
| `/jobs` | `JobsManager` | Admin / Recruiter | **Core** |
| `/jobs/:id` | `JobDetailModule` | Admin / Recruiter | **Core, K13** |
| `/schedule` | `InterviewSchedule` | All Roles | **D1-D8** |
| `/scheduling` | `SchedulingPage` | All Roles | **D1-D9, H1-H4** |
| `/scheduling/members/:memberId` | `MemberProfilePage` | All Roles | **H1-H4** |
| `/drives` | `Drives` | All Roles | **C1-C7** |
| `/posted` | `Posted` | All Roles | **E5** |
| `/sourcing` | `Sourcing` | All Roles | **Core** |
| `/referrals` | `Referrals` | All Roles | **Core** |
| `/quality-check` | `QualityCheckPage` | Approver / Super Admin | **G1, G2, F2** |
| `/analytics` | `Analytics` | Super Admin | **Core** |
| `/reports` | `Reports` | Super Admin | **Core** |
| `/audit` | `AuditLogs` | Super Admin | **Core** |
| `/team` | `Team` | Super Admin | **H1-H4** |
| `/settings` | `Settings` | All Roles / Admin | **A3, Core** |
| `/sales/*` | `SalesLayout` | Admin / Recruiter | **Core** |

---

## 3. Backend Routes & API Namespace Mapping

| Namespace | Base Path | Handled In | Test Area |
|---|---|---|---|
| Auth | `/api/auth` | `modules/auth/routes.js` | **A1–A6** |
| Users | `/api/users` | `modules/users/routes.js` | **Core** |
| Team | `/api/team` | `modules/team/routes.js` | **H1–H4** |
| Candidates | `/api/candidates` | `modules/candidates/routes.js` | **B1–B5** |
| Bulk Uploads | `/api/candidates/bulk-upload` | `routes/bulkUpload.js` | **C3–C7** |
| Applications | `/api/applications` | `modules/applications/routes.js` | **Core** |
| Pipeline | `/api/pipeline` | `modules/pipeline/routes.js` | **Core** |
| Interviews | `/api/interviews` | `modules/interviews/routes.js` | **D1–D8** |
| Scheduling | `/api/scheduling` | `modules/scheduling/routes.js` | **D1–D9, H1–H4** |
| Quality Checks | `/api/quality-checks` | `modules/quality-check/routes.js` | **G1, G2, F2** |
| Files & Resumes | `/api/files` | `modules/files/routes.js` | **E1–E6** |
| Posted Files | `/api/posted-files` | `modules/posted-files/routes.js` | **E5** |
| Matching & Parsing | `/api/matching` | `modules/matching/routes.js` | **K1–K14** |
| External API (v1) | `/api/v1/ext` | `modules/ext/routes.js` | **L1–L9, M1–M4** |
| Recruit AI Integration | `/api/v1/integrations/recruit-ai` | `modules/integrations/recruit-ai/routes.js` | **N1–N7** |
| Health & Version | `/api/health`, `/api/version` | `src/app.js` | **I1–I3** |

---

## 4. Background Workers & Schedulers

| Worker / Scheduler | File | Trigger / Schedule | Purpose | Test Area |
|---|---|---|---|---|
| `schedulingSyncWorker` | `src/jobs/schedulingSyncWorker.js` | Queue / Event | Syncs scheduling changes to Redis/DB | **D6, I1** |
| `bulkImportWorker` | `src/jobs/bulkImportWorker.js` | BullMQ Queue | Processes multi-row candidate CSV/XLSX | **C3–C5, I1** |
| `notificationScheduler` | `src/jobs/notificationScheduler.js` | Cron (1 min) | Delayed alerts and interview notifications | **I2** |
| `resumeHealthCheck` | `src/jobs/resumeHealthCheck.js` | Periodic | Audits resume availability in storage | **E6** |
| `qualityCheckReconciliation`| `src/jobs/qualityCheckReconciliation.js` | Periodic | Reconciles round-2 quality check statuses | **G1, F2** |
| `recruitAiPoller` | `src/modules/integrations/recruit-ai/pollerService.js` | Periodic (15 min) | Pulls completed results with overlap window | **N2, N6** |
| `resumeParseWorker` | `src/modules/matching/resumeParseWorker.js` | In-process Queue | Asynchronous resume parsing & JD scoring | **K2, K12** |

---

## 5. Environment Variables & Feature Flags

| Variable | Required | Staging / Prod Value Description | Validated at Boot |
|---|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string | Yes (`src/index.js`) |
| `JWT_SECRET` | Yes | Secret for JWT signing | Yes (`src/index.js`) |
| `CORS_ORIGIN` | No | Allowed frontend origins (comma-separated) | Warned |
| `FRONTEND_URL` | No | Primary frontend URL | Warned |
| `EXTERNAL_API_ENABLED` | Yes | `true` / `false` (enables `/api/v1/ext/*`) | Active |
| `API_KEY_PEPPER` | Yes | Cryptographic pepper for external API keys | Active |
| `RESUME_PARSING_ENABLED` | Yes | `true` / `false` (enables resume parsing engine) | Active |
| `PARSER_CONCURRENCY` | No | Number of parallel resume parse workers (default: 2) | Active |
| `RECRUITAI_SYNC_ENABLED` | Yes | `true` / `false` (enables Recruit AI sync) | Active |
| `RECRUITAI_API_KEY` | Conditional | Key for Recruit AI dispatch | Active |
| `RECRUITAI_BASE_URL` | Conditional | Host URL for Recruit AI (`https://187.127.137.103`) | Active |
| `RECRUITAI_SCHEDULE_WEBHOOK_URL`| Conditional | Webhook URL on Recruit AI | Active |
| `RECRUITAI_WEBHOOK_SECRET` | No | Secret for incoming webhook HMAC signatures | Active |
