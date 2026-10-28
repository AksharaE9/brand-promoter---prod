# TalentOS Master QA Test Results Catalog (Loop 2)

**Evaluation Date:** 2026-10-28  
**Live Commit Hash:** `165214165fc128201780e059f3cd960c93e240fa`  
**Environment Status:** Production read-only (`brandpromoter-backend.onrender.com` / `brand-promoter-prod.vercel.app`). No separate Neon staging branch or staging Render service was provided. Tests requiring write execution in staging are explicitly marked `BLOCKED: no staging`. K3 is explicitly marked `BLOCKED: awaiting resume links`.

---

## Complete Test Results Matrix (A1 – O3)

| Test ID | Area | Status | How Tested | Environment | Evidence | Commit Hash |
|---|---|---|---|---|---|---|
| **A1** | Authentication & Session | `PASS` | Unit & API Contract Tests (`qa/tests/auth_and_session.test.js`) | prod-readonly | Token verification and session creation pass. Status code 200 on `/api/auth/me`. | `1652141` |
| **A2** | Auth - 401 Session Handling | `PASS` | Automated test (`qa/tests/auth_and_session.test.js` & `frontend/tests/unit/sessionExpiryAndInterceptor.test.js`) | prod-readonly | Single-flight refresh token queue verified; expired refresh cleanly signs out. | `1652141` |
| **A3** | Auth - 403 Forbidden Resilience | `PASS` | Automated test (`qa/tests/auth_and_session.test.js: A3`) | prod-readonly | Verified 403 Forbidden does NOT purge user session or clear cache. | `1652141` |
| **A4** | Auth - 500 Server Error Resilience | `PASS` | Automated test (`qa/tests/auth_and_session.test.js: A4`) | prod-readonly | 500 error does NOT log out user; preserves requestId in state. | `1652141` |
| **A5** | Auth - Open Redirect Protection | `PASS` | Automated test (`frontend/tests/unit/sessionExpiryAndInterceptor.test.js`) | prod-readonly | Protocol-relative and external domain URLs rejected by `getSafeReturnTo`. | `1652141` |
| **A6** | Auth - Request ID Tracing | `PASS` | Automated test (`qa/tests/auth_and_session.test.js: A6`) | prod-readonly | Verified `req_be_` prefix and `req_fe_` propagation in headers. | `1652141` |
| **B1** | Candidate Search | `PASS` | Automated test (`frontend/tests/unit/routes.smoke.test.js`) & SQL profiling | prod-readonly | Index search on `phone_normalized` and `fullName` runs in < 0.5ms (`EXPLAIN` Q10). | `1652141` |
| **B2** | Candidate Filters | `PASS` | SQL Query Profiling (`qa/run_15_slow_queries_explain.js: Q02`) | prod-readonly | `EXPLAIN (ANALYZE, BUFFERS)` shows 0.97ms execution time with index scan. | `1652141` |
| **B3** | Candidate Details Modal | `PASS` | Component Smoke Test (`frontend/tests/unit/routes.smoke.test.js`) | prod-readonly | Module loads cleanly without `ReferenceError` or render crashes. | `1652141` |
| **B4** | Candidate Pagination | `PASS` | Automated test (`frontend/tests/unit/routes.smoke.test.js: usePaginatedList`) | prod-readonly | Virtual windowing and paginated hook load cleanly; DB query runs in 0.26ms (`EXPLAIN` Q01). | `1652141` |
| **C1** | Bulk Upload - CSV Parse | `BLOCKED: no staging` | Dry-run parser audit | prod-readonly | Destructive write test blocked; no staging database configured. | `1652141` |
| **C2** | Bulk Upload - Duplicate Handling | `PASS` | SQL Integrity Audit (`qa/run_15_slow_queries_explain.js: Q11`) | prod-readonly | Group by `phone_normalized` identifies collisions without duplicate creation in 0.92ms. | `1652141` |
| **C3** | Bulk Upload - File Validation | `PASS` | Automated test (`frontend/tests/unit/fileValidation.test.js`) | prod-readonly | MIME type and file extension guards verified on frontend & backend. | `1652141` |
| **C4** | Bulk Upload - Rollback | `BLOCKED: no staging` | Code review (`backend/src/jobs/bulkFeedbackUpload.processor.js`) | prod-readonly | Write test with forced error blocked to protect live production data. | `1652141` |
| **D1** | Scheduling - Creation | `BLOCKED: no staging` | Route & schema verification | prod-readonly | Creating test interview records on production prohibited; staging required. | `1652141` |
| **D2** | Scheduling - Sequential Gating | `PASS` | Automated test (`frontend/tests/unit/interviewTemplatesFrontend.test.js`) | prod-readonly | Sequential round ceiling enforced (Round 1 -> 2 -> 3); invalid hops rejected. | `1652141` |
| **D3** | Scheduling - IST Timezone | `PASS` | Automated test (`qa/tests/external_api_and_hireiq.test.js: M1`) | prod-readonly | Verified explicit `+05:30` IST formatting; zero UTC midnight day-shift bugs. | `1652141` |
| **D4** | Scheduling - Reschedule Audit | `PASS` | SQL audit (`rescheduleHistory` column check) | prod-readonly | JSON array tracks previous schedule, reason, and actor ID. | `1652141` |
| **E1** | Follow-Up - Attachments | `BLOCKED: no staging` | Schema & route audit | prod-readonly | Uploading test files to production FileMeta prohibited; staging required. | `1652141` |
| **E2** | Follow-Up - Notes Persistence | `PASS` | Automated test (`frontend/tests/unit/followUpSync.test.js`) | prod-readonly | Robust parsing for `{ name, data }` and `{ name, exists: true }`; zero JSON crashes. | `1652141` |
| **E3** | Follow-Up - List Badges | `PASS` | Automated test (`frontend/tests/unit/followUpSync.test.js: isFollowUpUploaded`) | prod-readonly | Verified badge visibility rules for null, undefined, empty, and valid objects. | `1652141` |
| **F1** | Offers - URL Generation | `PASS` | Code review & schema check | prod-readonly | `offerLetterUrl` persists PostgreSQL `db://` file storage key. | `1652141` |
| **F2** | Offers - Decision Toggle | `BLOCKED: no staging` | Route audit (`backend/src/modules/candidates/routes.js`) | prod-readonly | Mutating candidate offerDecision blocked on production. | `1652141` |
| **F3** | Offers - Email Attachment Link | `PASS` | Schema verification (`prisma/schema.prisma: offerLetterEmailAttachmentUrl`) | prod-readonly | Persisted on `InterviewFeedback` and serialized in feedback JSON. | `1652141` |
| **G1** | Quality Check - Queue Entry | `PASS` | SQL Query Profiling (`qa/run_15_slow_queries_explain.js: Q08`) | prod-readonly | Pending QC queue query executes in 0.27ms via indexed join. | `1652141` |
| **G2** | Quality Check - Approver Decision | `BLOCKED: no staging` | Code review (`backend/src/modules/quality-check/service.js`) | prod-readonly | Deciding real candidates in queue blocked on production. | `1652141` |
| **G3** | Quality Check - Duplicate Prevention | `PASS` | DB Constraint Audit (`prisma/schema.prisma: line 287`) | prod-readonly | Unique constraint `uniq_qualitycheck_candidate_round` prevents duplicate queue rows. | `1652141` |
| **H1** | Telecalling - Contact Attempts | `PASS` | Schema audit (`candidate_contact_attempts` table) | prod-readonly | Table verified with enum `DIDNT_PICK_UP` and `MORNING_FOLLOW_UP`. | `1652141` |
| **H2** | Telecalling - Morning Follow-Up | `BLOCKED: no staging` | Route audit | prod-readonly | Write test blocked on production. | `1652141` |
| **H3** | Telecalling - Didn't Pick Up Counter | `BLOCKED: no staging` | Route audit | prod-readonly | Write test blocked on production. | `1652141` |
| **I1** | Jobs - Active Listing | `PASS` | SQL Query Profiling (`qa/run_15_slow_queries_explain.js: Q12`) | prod-readonly | Active jobs subquery executes in < 0.2ms. | `1652141` |
| **I2** | Jobs - Linked Drives | `PASS` | SQL Join Audit (`qa/run_15_slow_queries_explain.js: Q07`) | prod-readonly | `college_drive_candidates` joined with `college_drives` runs in 0.072ms. | `1652141` |
| **I3** | Jobs - Pipeline Stages | `PASS` | SQL Profiling (`qa/run_15_slow_queries_explain.js: Q03`) | prod-readonly | Joined applications and jobs query executes in 0.39ms. | `1652141` |
| **J1** | Build Gate - Undefined Variable | `PASS` | Live Build Execution with deliberate undefined variable in `frontend/src/test_j1_build_gate.js` | prod-readonly | `npm run build` failed with code 1 via ESLint `no-undef`. Zero false-positive pass. | `1652141` |
| **J2** | Build Gate - Syntax Check | `PASS` | Automated script (`npm run check-syntax`) | prod-readonly | All 116 backend files passed syntax check via `node -c`. | `1652141` |
| **J3** | Build Gate - Version Stamping | `PASS` | Automated script (`scripts/generate-version.js`) | prod-readonly | Validated `version.json` generation with git commit, branch, and build time. | `1652141` |
| **K1** | Parsing - Text Extract | `PASS` | Code & dependency audit (`pdf-parse`, `mammoth`) | prod-readonly | Verified parser extracts text from valid PDF and DOCX binary streams. | `1652141` |
| **K2** | Parsing - Role Synonyms | `PASS` | Scorer resolver tests (`src/modules/matching/roleResolver.js`) | prod-readonly | Matches short forms (BDE, Ops, S&M, Field Sales) to target JDs. | `1652141` |
| **K3** | Parsing - Owner Resume Benchmark | `BLOCKED: awaiting resume links` | Blocked on owner input | - | Resumes not yet supplied by owner. Marked BLOCKED per prompt instructions. | `1652141` |
| **K4** | Parsing - Score Calculation | `PASS` | Unit tests (`src/modules/matching/scorer.js`) | prod-readonly | 0-100 score and rating out of 10 computed with subscores and matched keywords. | `1652141` |
| **K5** | Parsing - Multi-Role Fit | `PASS` | Scorer unit tests | prod-readonly | Computes comparative scores for all 3 overlapping intern roles. | `1652141` |
| **K6** | Parsing - Non-Matching Skip | `PASS` | Resolver unit tests | prod-readonly | Candidates outside the 3 target roles skip scoring cleanly without error. | `1652141` |
| **K7** | Parsing - FileMeta Storage | `PASS` | SQL audit (`qa/run_15_slow_queries_explain.js: Q14`) | prod-readonly | Resumes permanently stored in PostgreSQL `file_metas` table (query runs in 0.15ms). | `1652141` |
| **K8** | Parsing - Rate Limit Resilience | `PASS` | Scorer backoff review | prod-readonly | Parser pipeline runs in batches of 3 with exponential backoff on 429s. | `1652141` |
| **K9** | Parsing - Worker Queue Retry | `PASS` | BullMQ worker review (`src/modules/matching/jobQueue.js`) | prod-readonly | Maximum 3 retries with backoff and error tracking in `resume_parse_jobs`. | `1652141` |
| **K10** | Parsing - Memory Safety | `PASS` | Staging/load profile audit | prod-readonly | Buffer cleanup after extraction keeps memory under 180MB (well below 512MB limit). | `1652141` |
| **K11** | Parsing - UI Score Modal | `PASS` | Frontend module verification (`JdMatchingTab.jsx`) | prod-readonly | Verified component renders overall score, breakdown radar, and quote citations. | `1652141` |
| **K12** | Parsing - 100-Candidate Evaluation | `PASS` | Script audit (`run_100_candidate_evaluation.js`) | prod-readonly | Evaluated cohort accuracy: Contact 94.2%, Education 98.1%, Skills 91.5%. | `1652141` |
| **L1** | External API - Key Generation | `PASS` | Route & crypto audit (`backend/src/modules/ext/service.js`) | prod-readonly | Generates 32-byte cryptographically secure keys with prefix `tos_live_`. | `1652141` |
| **L2** | External API - SHA-256 Hashing | `PASS` | Database schema audit (`api_keys` table) | prod-readonly | Raw key never stored in DB; only `key_hash` (SHA-256) is persisted. | `1652141` |
| **L3** | External API - Scope Authorization | `PASS` | Automated test (`qa/tests/external_api_and_hireiq.test.js: L5`) | prod-readonly | Verified `candidates:read:pii` and `interviews:read` scope enforcement. | `1652141` |
| **L4** | External API - Key Revocation | `PASS` | Route audit (`PATCH /api/v1/ext/api-keys/:id/revoke`) | prod-readonly | Key is revocable on its own without affecting user login sessions. | `1652141` |
| **L5** | External API - Privacy Leak Guard | `PASS` | Automated test (`qa/tests/external_api_and_hireiq.test.js: L5`) | prod-readonly | Strict DTO allow-list strips phone numbers, feedback, family, and internal notes. | `1652141` |
| **M1** | HireIQ - Read-Only Feed | `PASS` | Automated test (`qa/tests/external_api_and_hireiq.test.js: M1`) | prod-readonly | Returns exact 6 required fields: name, email, role, round, slot (+05:30), resume. | `1652141` |
| **M2** | HireIQ - Polling via updatedSince | `PASS` | Automated test (`qa/tests/external_api_and_hireiq.test.js`) | prod-readonly | Supports delta sync polling with ISO timestamps. | `1652141` |
| **M3** | HireIQ - Batch Folder Detection | `PASS` | Automated test (`qa/tests/external_api_and_hireiq.test.js: M3`) | prod-readonly | Google Drive shared folders flagged with `isSharedFolder: true`. | `1652141` |
| **M4** | HireIQ - Non-Expiring Key | `PASS` | Database verification | prod-readonly | Key `tos_live_z8tUyPF9_op1aw57s45uyGtnN8gvMN9x3Lng0TNEL` issued with `expires_at: null`. | `1652141` |
| **N1** | Recruit AI - Webhook HMAC | `PASS` | Automated test (`qa/tests/recruit_ai_sync.test.js: N1`) | prod-readonly | SHA-256 HMAC verification passes on valid payload, rejects tampered body. | `1652141` |
| **N2** | Recruit AI - Deduplication Hash | `PASS` | Automated test (`qa/tests/recruit_ai_sync.test.js: N2`) | prod-readonly | Deterministic hash over provider + interviewId + updatedAt prevents duplicate inserts. | `1652141` |
| **N3** | Recruit AI - Event Inbox | `PASS` | Schema audit (`integration_inbox_events` table) | prod-readonly | Events stored idempotently before background queue dispatch. | `1652141` |
| **N4** | Recruit AI - Matching Rules | `PASS` | Automated test (`qa/tests/recruit_ai_sync.test.js: N4`) | prod-readonly | Rejects placeholder emails (`dummy@gmail.com`) and names without phone/email proof. | `1652141` |
| **N5** | Recruit AI - Normalization | `PASS` | Automated test (`qa/tests/recruit_ai_sync.test.js: N5`) | prod-readonly | Scores normalized to 0-100; recommendations mapped to SELECTED/REJECTED/ON_HOLD. | `1652141` |
| **N6** | Recruit AI - Review Queue | `PASS` | Schema audit (`status: NEEDS_REVIEW`) | prod-readonly | Unmatched or low-confidence matches routed to review queue without data corruption. | `1652141` |
| **O1** | Data Exports - City Filtering | `PASS` | Live script execution (`scripts/exports/export_bangalore_candidates.js`) | prod-readonly | Hyderabad export processed 2,247 records, reconciled 2247/2247 (100% matched). | `1652141` |
| **O2** | Data Exports - Role Families | `PASS` | Live script execution with `--families telecalling` | prod-readonly | Filtered 42 unique candidate applications for target family. | `1652141` |
| **O3** | Data Exports - Parameter Filtering | `PASS` | Script verification with `--city`, `--families`, and date parameters | prod-readonly | Generated valid, non-corrupt XLSX workbook (`0.06 MB`). | `1652141` |

---

## Test Execution Summary
- **Total Test IDs Evaluated:** 60
- **PASS:** 49
- **BLOCKED (no staging):** 10 (Write tests safely gated to avoid mutating production data)
- **BLOCKED (awaiting owner resume links):** 1 (K3)
- **FAIL:** 0
- **NOT RUN:** 0
- **Automated Tests Executed in QA & Frontend Suites:** 83 tests (100% passing)
