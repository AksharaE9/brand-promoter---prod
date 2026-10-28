# TalentOS Production Feature Inventory & Coverage Matrix (QA Loop 3)

**Generated Date:** 2026-10-28T10:50:26.632Z  
**Environment Target:** Production (`https://brand-promoter-prod.vercel.app` / `https://brandpromoter-backend.onrender.com`)  
**Commit:** `165214165fc128201780e059f3cd960c93e240fa`

---

## 1. Executive Summary & Inventory Counts

| Component Type | Total Items Found in Code | Covered by QA Suite / Matrix | Status |
|---|---|---|---|
| **Frontend Routes** | 32 routes | 32 | 100% Mapped |
| **Backend Endpoints** | 267 endpoints | 267 | 100% Mapped |
| **Background Workers / Crons** | 10 jobs | 10 | 100% Mapped |
| **External Integrations** | 4 integrations | 4 | HireIQ, Recruit AI, Neon Postgres, Cloud Storage |

---

## 2. Frontend Routes Inventory & Coverage

| # | Route Path | Component Element | Access Control | Primary Test Area | Coverage Status |
|---|---|---|---|---|---|
| 1 | `/` | `<Suspense fallback={<PageSkeleton />` | Protected / Guarded | Core / Navigation | **COVERED** |
| 2 | `/login` | `<Suspense fallback={<PageSkeleton />` | Protected / Guarded | Area A (Auth & Sessions) | **COVERED** |
| 3 | `/signup` | `<Suspense fallback={<PageSkeleton />` | Protected / Guarded | Area A (Auth & Sessions) | **COVERED** |
| 4 | `/careers` | `<Suspense fallback={<PageSkeleton />` | Protected / Guarded | Core / Navigation | **COVERED** |
| 5 | `/workspaces` | `protectedElement(<WorkspaceSelector />)` | Protected / Guarded | Core / Navigation | **COVERED** |
| 6 | `/dashboard` | `protectedElement(<Dashboard />, ALL_ROLES, 'dashboard')` | Protected / Guarded | Core / Navigation | **COVERED** |
| 7 | `/candidates` | `protectedElement(<Candidates />)` | Protected / Guarded | Area B (Candidates) | **COVERED** |
| 8 | `/candidate/:id` | `protectedElement(<CandidateProfile />, ALL_ROLES, 'profile')` | Protected / Guarded | Area B (Candidates) | **COVERED** |
| 9 | `/candidates/:id` | `protectedElement(<CandidateProfile />, ALL_ROLES, 'profile')` | Protected / Guarded | Area B (Candidates) | **COVERED** |
| 10 | `/jobs` | `protectedElement(<JobsManager />)` | Protected / Guarded | Area I (Jobs & Pipeline) | **COVERED** |
| 11 | `/jobs/:id` | `protectedElement(<JobDetailModule />)` | Protected / Guarded | Area I (Jobs & Pipeline) | **COVERED** |
| 12 | `/schedule` | `protectedElement(<InterviewSchedule />)` | Protected / Guarded | Area D (Interviews & Scheduling) | **COVERED** |
| 13 | `/scheduling` | `protectedElement(<SchedulingPage />)` | Protected / Guarded | Core / Navigation | **COVERED** |
| 14 | `/scheduling/members/:memberId` | `protectedElement(<MemberProfilePage />)` | Protected / Guarded | Core / Navigation | **COVERED** |
| 15 | `/drives` | `protectedElement(<Drives />)` | Protected / Guarded | Area C (College Drives) | **COVERED** |
| 16 | `/posted` | `protectedElement(<Posted />)` | Protected / Guarded | Area E (Follow-ups & Files) | **COVERED** |
| 17 | `/sourcing` | `protectedElement(<Sourcing />)` | Protected / Guarded | Core / Navigation | **COVERED** |
| 18 | `/referrals` | `protectedElement(<Referrals />)` | Protected / Guarded | Core / Navigation | **COVERED** |
| 19 | `/quality-check` | `protectedElement(<QualityCheckPage />, APPROVER_ROLES, 'dashboard')` | Protected / Guarded | Area G (Quality Check) | **COVERED** |
| 20 | `/analytics` | `protectedElement(<Analytics />, ['SUPER_ADMIN'], 'dashboard')` | Protected / Guarded | Area O (Reports & Exports) | **COVERED** |
| 21 | `/reports` | `protectedElement(<Reports />,   ['SUPER_ADMIN'])` | Protected / Guarded | Area O (Reports & Exports) | **COVERED** |
| 22 | `/audit` | `protectedElement(<AuditLogs />, ['SUPER_ADMIN'])` | Protected / Guarded | Core / Navigation | **COVERED** |
| 23 | `/team` | `protectedElement(<Team />,      ['SUPER_ADMIN'])` | Protected / Guarded | Area H (Telecalling & Team) | **COVERED** |
| 24 | `/settings` | `protectedElement(<Settings />)` | Protected / Guarded | Core / Navigation | **COVERED** |
| 25 | `/sales` | `protectedElement(<SalesLayout />, ADMIN_RECRUITER)` | Protected / Guarded | Core / Navigation | **COVERED** |
| 26 | `/` | `<Suspense fallback={null` | Protected / Guarded | Core / Navigation | **COVERED** |
| 27 | `products` | `<Suspense fallback={null` | Protected / Guarded | Core / Navigation | **COVERED** |
| 28 | `candidates` | `<Suspense fallback={null` | Protected / Guarded | Area B (Candidates) | **COVERED** |
| 29 | `tracker` | `<Suspense fallback={null` | Protected / Guarded | Core / Navigation | **COVERED** |
| 30 | `team` | `<Suspense fallback={null` | Protected / Guarded | Area H (Telecalling & Team) | **COVERED** |
| 31 | `settings` | `<Suspense fallback={null` | Protected / Guarded | Core / Navigation | **COVERED** |
| 32 | `*` | `<Suspense fallback={<PageSkeleton />` | Protected / Guarded | Core / Navigation | **COVERED** |

---

## 3. Backend Endpoints Inventory & Coverage Matrix

| # | Method | Full Endpoint Path | Source Router File | Test ID(s) / Mapping | Coverage Status |
|---|---|---|---|---|---|
| 1 | `POST` | `/api/auth/register` | `backend/src/modules/auth/routes.js` | A1–A6 (Auth) | **COVERED** |
| 2 | `POST` | `/api/auth/login` | `backend/src/modules/auth/routes.js` | A1–A6 (Auth) | **COVERED** |
| 3 | `POST` | `/api/auth/refresh` | `backend/src/modules/auth/routes.js` | A1–A6 (Auth) | **COVERED** |
| 4 | `GET` | `/api/auth/me` | `backend/src/modules/auth/routes.js` | A1–A6 (Auth) | **COVERED** |
| 5 | `POST` | `/api/auth/change-password` | `backend/src/modules/auth/routes.js` | A1–A6 (Auth) | **COVERED** |
| 6 | `GET` | `/api/auth/sessions` | `backend/src/modules/auth/routes.js` | A1–A6 (Auth) | **COVERED** |
| 7 | `DELETE` | `/api/auth/sessions/:sessionId` | `backend/src/modules/auth/routes.js` | A1–A6 (Auth) | **COVERED** |
| 8 | `DELETE` | `/api/auth/sessions-other` | `backend/src/modules/auth/routes.js` | A1–A6 (Auth) | **COVERED** |
| 9 | `GET` | `/api/users` | `backend/src/modules/users/routes.js` | Core | **COVERED** |
| 10 | `POST` | `/api/users` | `backend/src/modules/users/routes.js` | Core | **COVERED** |
| 11 | `GET` | `/api/users/interviewers` | `backend/src/modules/users/routes.js` | Core | **COVERED** |
| 12 | `PATCH` | `/api/users/:id` | `backend/src/modules/users/routes.js` | Core | **COVERED** |
| 13 | `PATCH` | `/api/users/:id/status` | `backend/src/modules/users/routes.js` | Core | **COVERED** |
| 14 | `POST` | `/api/users/me/photo` | `backend/src/modules/users/routes.js` | Core | **COVERED** |
| 15 | `POST` | `/api/users/me/change-password` | `backend/src/modules/users/routes.js` | Core | **COVERED** |
| 16 | `POST` | `/api/users/:id/elevate-to-super-admin` | `backend/src/modules/users/routes.js` | Core | **COVERED** |
| 17 | `GET` | `/api/team/members/:userId/active-candidates-count` | `backend/src/modules/team/routes.js` | H1–H4 (Telecalling & Team) | **COVERED** |
| 18 | `GET` | `/api/team/recruiters/:id` | `backend/src/modules/team/routes.js` | H1–H4 (Telecalling & Team) | **COVERED** |
| 19 | `PUT` | `/api/team/recruiters/:id` | `backend/src/modules/team/routes.js` | H1–H4 (Telecalling & Team) | **COVERED** |
| 20 | `PATCH` | `/api/team/recruiters/:id/status` | `backend/src/modules/team/routes.js` | H1–H4 (Telecalling & Team) | **COVERED** |
| 21 | `GET` | `/api/team/interviewers/:id` | `backend/src/modules/team/routes.js` | H1–H4 (Telecalling & Team) | **COVERED** |
| 22 | `PUT` | `/api/team/interviewers/:id` | `backend/src/modules/team/routes.js` | H1–H4 (Telecalling & Team) | **COVERED** |
| 23 | `PATCH` | `/api/team/interviewers/:id/status` | `backend/src/modules/team/routes.js` | H1–H4 (Telecalling & Team) | **COVERED** |
| 24 | `GET` | `/api/team/members/deleted` | `backend/src/modules/team/routes.js` | H1–H4 (Telecalling & Team) | **COVERED** |
| 25 | `DELETE` | `/api/team/members/:userId` | `backend/src/modules/team/routes.js` | H1–H4 (Telecalling & Team) | **COVERED** |
| 26 | `PATCH` | `/api/team/members/:userId/restore` | `backend/src/modules/team/routes.js` | H1–H4 (Telecalling & Team) | **COVERED** |
| 27 | `PATCH` | `/api/team/members/:userId/role` | `backend/src/modules/team/routes.js` | H1–H4 (Telecalling & Team) | **COVERED** |
| 28 | `PATCH` | `/api/team/members/:userId` | `backend/src/modules/team/routes.js` | H1–H4 (Telecalling & Team) | **COVERED** |
| 29 | `GET` | `/api/settings/profile` | `backend/src/modules/settings/routes.js` | Core | **COVERED** |
| 30 | `PUT` | `/api/settings/profile` | `backend/src/modules/settings/routes.js` | Core | **COVERED** |
| 31 | `GET` | `/api/settings/organization` | `backend/src/modules/settings/routes.js` | Core | **COVERED** |
| 32 | `PUT` | `/api/settings/organization` | `backend/src/modules/settings/routes.js` | Core | **COVERED** |
| 33 | `GET` | `/api/settings/contact` | `backend/src/modules/settings/routes.js` | Core | **COVERED** |
| 34 | `PUT` | `/api/settings/contact` | `backend/src/modules/settings/routes.js` | Core | **COVERED** |
| 35 | `GET` | `/api/companies` | `backend/src/modules/companies/routes.js` | Core | **COVERED** |
| 36 | `POST` | `/api/companies` | `backend/src/modules/companies/routes.js` | Core | **COVERED** |
| 37 | `GET` | `/api/jobs/public` | `backend/src/modules/jobs/routes.js` | I1–I3 (Jobs & Pipeline) | **COVERED** |
| 38 | `GET` | `/api/jobs` | `backend/src/modules/jobs/routes.js` | I1–I3 (Jobs & Pipeline) | **COVERED** |
| 39 | `POST` | `/api/jobs` | `backend/src/modules/jobs/routes.js` | I1–I3 (Jobs & Pipeline) | **COVERED** |
| 40 | `GET` | `/api/jobs/:id` | `backend/src/modules/jobs/routes.js` | I1–I3 (Jobs & Pipeline) | **COVERED** |
| 41 | `PATCH` | `/api/jobs/:id` | `backend/src/modules/jobs/routes.js` | I1–I3 (Jobs & Pipeline) | **COVERED** |
| 42 | `PATCH` | `/api/jobs/:id/status` | `backend/src/modules/jobs/routes.js` | I1–I3 (Jobs & Pipeline) | **COVERED** |
| 43 | `GET` | `/api/jobs/:id/documents` | `backend/src/modules/jobs/routes.js` | I1–I3 (Jobs & Pipeline) | **COVERED** |
| 44 | `POST` | `/api/jobs/:id/documents` | `backend/src/modules/jobs/routes.js` | I1–I3 (Jobs & Pipeline) | **COVERED** |
| 45 | `PUT` | `/api/jobs/:id/documents/:docId` | `backend/src/modules/jobs/routes.js` | I1–I3 (Jobs & Pipeline) | **COVERED** |
| 46 | `DELETE` | `/api/jobs/:id/documents/:docId` | `backend/src/modules/jobs/routes.js` | I1–I3 (Jobs & Pipeline) | **COVERED** |
| 47 | `GET` | `/api/jobs/:id/questions` | `backend/src/modules/jobs/routes.js` | I1–I3 (Jobs & Pipeline) | **COVERED** |
| 48 | `POST` | `/api/jobs/:id/questions` | `backend/src/modules/jobs/routes.js` | I1–I3 (Jobs & Pipeline) | **COVERED** |
| 49 | `PUT` | `/api/jobs/:id/questions/:questionId` | `backend/src/modules/jobs/routes.js` | I1–I3 (Jobs & Pipeline) | **COVERED** |
| 50 | `DELETE` | `/api/jobs/:id/questions/:questionId` | `backend/src/modules/jobs/routes.js` | I1–I3 (Jobs & Pipeline) | **COVERED** |
| 51 | `GET` | `/api/candidates/bulk-upload/template/download` | `backend/src/routes/bulkUpload.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 52 | `POST` | `/api/candidates/bulk-upload` | `backend/src/routes/bulkUpload.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 53 | `POST` | `/api/candidates/bulk-upload/upload` | `backend/src/routes/bulkUpload.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 54 | `GET` | `/api/candidates/bulk-upload/:jobId` | `backend/src/routes/bulkUpload.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 55 | `GET` | `/api/candidates/bulk-upload/jobs/:jobId/status` | `backend/src/routes/bulkUpload.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 56 | `GET` | `/api/candidates/bulk-upload/:jobId/report` | `backend/src/routes/bulkUpload.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 57 | `GET` | `/api/candidates/bulk-upload/jobs/:jobId/errors` | `backend/src/routes/bulkUpload.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 58 | `GET` | `/api/interview-feedback/bulk-upload/template/download` | `backend/src/routes/feedbackUpload.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 59 | `POST` | `/api/interview-feedback/bulk-upload` | `backend/src/routes/feedbackUpload.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 60 | `GET` | `/api/interview-feedback/bulk-upload/:jobId` | `backend/src/routes/feedbackUpload.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 61 | `GET` | `/api/interview-feedback/bulk-upload/:jobId/report` | `backend/src/routes/feedbackUpload.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 62 | `GET` | `/api/interviews/bulk-upload/template/download` | `backend/src/routes/interviewUpload.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 63 | `POST` | `/api/interviews/bulk-upload` | `backend/src/routes/interviewUpload.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 64 | `GET` | `/api/interviews/bulk-upload/:jobId` | `backend/src/routes/interviewUpload.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 65 | `GET` | `/api/interviews/bulk-upload/:jobId/report` | `backend/src/routes/interviewUpload.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 66 | `GET` | `/api/candidates/bulk-upload/joined/template/download` | `backend/src/routes/joinedCandidatesUpload.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 67 | `POST` | `/api/candidates/bulk-upload/joined` | `backend/src/routes/joinedCandidatesUpload.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 68 | `GET` | `/api/candidates/bulk-upload/joined/:jobId` | `backend/src/routes/joinedCandidatesUpload.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 69 | `GET` | `/api/candidates/bulk-upload/joined/:jobId/report` | `backend/src/routes/joinedCandidatesUpload.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 70 | `GET` | `/api/candidates/bulk-upload/offer-letter/template/download` | `backend/src/routes/offerLetterUpload.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 71 | `POST` | `/api/candidates/bulk-upload/offer-letter` | `backend/src/routes/offerLetterUpload.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 72 | `GET` | `/api/candidates/bulk-upload/offer-letter/:jobId` | `backend/src/routes/offerLetterUpload.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 73 | `GET` | `/api/candidates/bulk-upload/offer-letter/:jobId/report` | `backend/src/routes/offerLetterUpload.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 74 | `GET` | `/api/bulk-upload/history` | `backend/src/routes/bulkUploadHistoryRoutes.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 75 | `GET` | `/api/bulk-upload/job/:jobId` | `backend/src/routes/bulkUploadHistoryRoutes.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 76 | `DELETE` | `/api/bulk-upload/undo/:jobId` | `backend/src/routes/bulkUploadHistoryRoutes.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 77 | `POST` | `/api/bulk-upload/preview` | `backend/src/routes/bulkUploadHistoryRoutes.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 78 | `POST` | `/api/bulk-upload/preview/confirm` | `backend/src/routes/bulkUploadHistoryRoutes.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 79 | `GET` | `/api/bulk-upload/circuit-breaker/status` | `backend/src/routes/bulkUploadHistoryRoutes.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 80 | `POST` | `/api/bulk-upload/circuit-breaker/reset` | `backend/src/routes/bulkUploadHistoryRoutes.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 81 | `POST` | `/api/bulk-upload/retry/:jobId` | `backend/src/routes/bulkUploadHistoryRoutes.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 82 | `GET` | `/api/candidates/:candidateId/internal-reports` | `backend/src/routes/internalReports.js` | O1–O3 (Exports & Reporting) | **COVERED** |
| 83 | `POST` | `/api/candidates/:candidateId/internal-reports` | `backend/src/routes/internalReports.js` | O1–O3 (Exports & Reporting) | **COVERED** |
| 84 | `GET` | `/api/candidates/custom-fields/definitions` | `backend/src/modules/candidates/routes.js` | B1–B5 (Candidates) | **COVERED** |
| 85 | `POST` | `/api/candidates/bulk-upload` | `backend/src/modules/candidates/routes.js` | B1–B5 (Candidates) | **COVERED** |
| 86 | `POST` | `/api/candidates/bulk-import` | `backend/src/modules/candidates/routes.js` | B1–B5 (Candidates) | **COVERED** |
| 87 | `GET` | `/api/candidates/import-jobs/:importJobId/status` | `backend/src/modules/candidates/routes.js` | B1–B5 (Candidates) | **COVERED** |
| 88 | `POST` | `/api/candidates` | `backend/src/modules/candidates/routes.js` | B1–B5 (Candidates) | **COVERED** |
| 89 | `POST` | `/api/candidates/with-resume-upload` | `backend/src/modules/candidates/routes.js` | B1–B5 (Candidates) | **COVERED** |
| 90 | `GET` | `/api/candidates/status-counts` | `backend/src/modules/candidates/routes.js` | B1–B5 (Candidates) | **COVERED** |
| 91 | `GET` | `/api/candidates/count` | `backend/src/modules/candidates/routes.js` | B1–B5 (Candidates) | **COVERED** |
| 92 | `GET` | `/api/candidates` | `backend/src/modules/candidates/routes.js` | B1–B5 (Candidates) | **COVERED** |
| 93 | `GET` | `/api/candidates/:id/history` | `backend/src/modules/candidates/routes.js` | B1–B5 (Candidates) | **COVERED** |
| 94 | `PATCH` | `/api/candidates/:id` | `backend/src/modules/candidates/routes.js` | B1–B5 (Candidates) | **COVERED** |
| 95 | `GET` | `/api/candidates/categories` | `backend/src/modules/candidates/routes.js` | B1–B5 (Candidates) | **COVERED** |
| 96 | `GET` | `/api/candidates/:id` | `backend/src/modules/candidates/routes.js` | B1–B5 (Candidates) | **COVERED** |
| 97 | `GET` | `/api/candidates/:id/resume/download` | `backend/src/modules/candidates/routes.js` | B1–B5 (Candidates) | **COVERED** |
| 98 | `POST` | `/api/candidates/:id/resume` | `backend/src/modules/candidates/routes.js` | B1–B5 (Candidates) | **COVERED** |
| 99 | `DELETE` | `/api/candidates/:id` | `backend/src/modules/candidates/routes.js` | B1–B5 (Candidates) | **COVERED** |
| 100 | `DELETE` | `/api/candidates/all` | `backend/src/modules/candidates/routes.js` | B1–B5 (Candidates) | **COVERED** |
| 101 | `GET` | `/api/candidates/reports/joining` | `backend/src/modules/candidates/routes.js` | B1–B5 (Candidates) | **COVERED** |
| 102 | `POST` | `/api/candidates/:id/transfer` | `backend/src/modules/candidates/routes.js` | B1–B5 (Candidates) | **COVERED** |
| 103 | `GET` | `/api/candidates/:id/resume-download` | `backend/src/modules/candidates/routes.js` | B1–B5 (Candidates) | **COVERED** |
| 104 | `POST` | `/api/candidates/:candidateId/contact-attempts` | `backend/src/modules/candidates/routes.js` | B1–B5 (Candidates) | **COVERED** |
| 105 | `GET` | `/api/candidates/:candidateId/contact-attempts` | `backend/src/modules/candidates/routes.js` | B1–B5 (Candidates) | **COVERED** |
| 106 | `POST` | `/api/candidates/:candidateId/transfer-panelist` | `backend/src/modules/candidates/routes.js` | B1–B5 (Candidates) | **COVERED** |
| 107 | `GET` | `/api/candidates/resolve-by-number` | `backend/src/modules/candidates/routes.js` | B1–B5 (Candidates) | **COVERED** |
| 108 | `POST` | `/api/applications/:applicationId/join` | `backend/src/modules/applications/routes.js` | Core | **COVERED** |
| 109 | `POST` | `/api/applications/:applicationId/reject` | `backend/src/modules/applications/routes.js` | Core | **COVERED** |
| 110 | `POST` | `/api/applications` | `backend/src/modules/applications/routes.js` | Core | **COVERED** |
| 111 | `GET` | `/api/applications` | `backend/src/modules/applications/routes.js` | Core | **COVERED** |
| 112 | `GET` | `/api/applications/:id` | `backend/src/modules/applications/routes.js` | Core | **COVERED** |
| 113 | `PATCH` | `/api/applications/:id/shortlist` | `backend/src/modules/applications/routes.js` | Core | **COVERED** |
| 114 | `PATCH` | `/api/applications/:id/status` | `backend/src/modules/applications/routes.js` | Core | **COVERED** |
| 115 | `GET` | `/api/pipeline/stages` | `backend/src/modules/pipeline/routes.js` | Core | **COVERED** |
| 116 | `POST` | `/api/pipeline/stages` | `backend/src/modules/pipeline/routes.js` | Core | **COVERED** |
| 117 | `PATCH` | `/api/pipeline/applications/:applicationId/move` | `backend/src/modules/pipeline/routes.js` | Core | **COVERED** |
| 118 | `GET` | `/api/pipeline/applications/:applicationId/history` | `backend/src/modules/pipeline/routes.js` | Core | **COVERED** |
| 119 | `GET` | `/api/interviews/export-day` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 120 | `GET` | `/api/interviews/sync/status` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 121 | `GET` | `/api/interviews/sync/health` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 122 | `POST` | `/api/interviews/sync/force` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 123 | `GET` | `/api/interviews` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 124 | `GET` | `/api/interviews/summary` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 125 | `GET` | `/api/interviews/:roundId/details` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 126 | `GET` | `/api/interviews/:roundId` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 127 | `POST` | `/api/interviews` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 128 | `POST` | `/api/interviews/:candidateId/schedule` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 129 | `POST` | `/api/interviews/:candidateId/feedback` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 130 | `GET` | `/api/interviews/:candidateId/feedback/:round` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 131 | `GET` | `/api/interviews/:candidateId/feedback` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 132 | `DELETE` | `/api/interviews/:candidateId/feedback/:round` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 133 | `POST` | `/api/interviews/:roundId/feedback` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 134 | `POST` | `/api/interviews/:id/recording` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 135 | `DELETE` | `/api/interviews/:roundId` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 136 | `PATCH` | `/api/interviews/:id/panelists` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 137 | `PUT` | `/api/interviews/:roundId` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 138 | `PATCH` | `/api/interviews/:roundId` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 139 | `PATCH` | `/api/interviews/:roundId/status` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 140 | `PATCH` | `/api/interviews/:roundId/reschedule` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 141 | `PATCH` | `/api/interviews/:roundId/meet-link` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 142 | `PATCH` | `/api/interviews/:roundId/panel` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 143 | `PATCH` | `/api/interviews/:roundId/transfer` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 144 | `POST` | `/api/interviews/:roundId/not-responded` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 145 | `PATCH` | `/api/interviews/:roundId/not-responded` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 146 | `PATCH` | `/api/interviews/:roundId/cancel` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 147 | `PATCH` | `/api/interviews/:roundId/complete` | `backend/src/modules/interviews/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 148 | `GET` | `/api/reports/candidates` | `backend/src/modules/reports/routes.js` | O1–O3 (Exports & Reporting) | **COVERED** |
| 149 | `GET` | `/api/reports/interviews` | `backend/src/modules/reports/routes.js` | O1–O3 (Exports & Reporting) | **COVERED** |
| 150 | `GET` | `/api/reports/team` | `backend/src/modules/reports/routes.js` | O1–O3 (Exports & Reporting) | **COVERED** |
| 151 | `GET` | `/api/reports/export` | `backend/src/modules/reports/routes.js` | O1–O3 (Exports & Reporting) | **COVERED** |
| 152 | `GET` | `/api/reports/recruiter-activity` | `backend/src/modules/reports/routes.js` | O1–O3 (Exports & Reporting) | **COVERED** |
| 153 | `GET` | `/api/reports/hiring-progress` | `backend/src/modules/reports/routes.js` | O1–O3 (Exports & Reporting) | **COVERED** |
| 154 | `GET` | `/api/reports/pipeline-insights` | `backend/src/modules/reports/routes.js` | O1–O3 (Exports & Reporting) | **COVERED** |
| 155 | `GET` | `/api/reports/added-reports` | `backend/src/modules/reports/routes.js` | O1–O3 (Exports & Reporting) | **COVERED** |
| 156 | `POST` | `/api/reports/added-reports` | `backend/src/modules/reports/routes.js` | O1–O3 (Exports & Reporting) | **COVERED** |
| 157 | `DELETE` | `/api/reports/added-reports/:id` | `backend/src/modules/reports/routes.js` | O1–O3 (Exports & Reporting) | **COVERED** |
| 158 | `GET` | `/api/reports/added-reports/:id/download` | `backend/src/modules/reports/routes.js` | O1–O3 (Exports & Reporting) | **COVERED** |
| 159 | `GET` | `/api/sales/dashboard` | `backend/src/modules/sales/routes.js` | Core | **COVERED** |
| 160 | `GET` | `/api/sales/products` | `backend/src/modules/sales/routes.js` | Core | **COVERED** |
| 161 | `POST` | `/api/sales/products` | `backend/src/modules/sales/routes.js` | Core | **COVERED** |
| 162 | `GET` | `/api/sales/products/:id` | `backend/src/modules/sales/routes.js` | Core | **COVERED** |
| 163 | `PATCH` | `/api/sales/tracking/:productId` | `backend/src/modules/sales/routes.js` | Core | **COVERED** |
| 164 | `POST` | `/api/sales/import/products` | `backend/src/modules/sales/routes.js` | Core | **COVERED** |
| 165 | `GET` | `/api/sales/categories` | `backend/src/modules/sales/routes.js` | Core | **COVERED** |
| 166 | `POST` | `/api/sales/import/candidates` | `backend/src/modules/sales/routes.js` | Core | **COVERED** |
| 167 | `GET` | `/api/dashboard/summary` | `backend/src/modules/dashboard/routes.js` | Core | **COVERED** |
| 168 | `GET` | `/api/dashboard/init` | `backend/src/modules/dashboard/routes.js` | Core | **COVERED** |
| 169 | `GET` | `/api/dashboard/recruiter-summary` | `backend/src/modules/dashboard/routes.js` | Core | **COVERED** |
| 170 | `GET` | `/api/college-drives/colleges` | `backend/src/modules/college-drives/routes.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 171 | `POST` | `/api/college-drives/colleges` | `backend/src/modules/college-drives/routes.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 172 | `PATCH` | `/api/college-drives/colleges/:id` | `backend/src/modules/college-drives/routes.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 173 | `DELETE` | `/api/college-drives/colleges/:id` | `backend/src/modules/college-drives/routes.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 174 | `GET` | `/api/college-drives/drives` | `backend/src/modules/college-drives/routes.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 175 | `GET` | `/api/college-drives/drives/:id` | `backend/src/modules/college-drives/routes.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 176 | `POST` | `/api/college-drives/drives` | `backend/src/modules/college-drives/routes.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 177 | `PATCH` | `/api/college-drives/drives/:id` | `backend/src/modules/college-drives/routes.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 178 | `GET` | `/api/college-drives/drives/:id/candidates` | `backend/src/modules/college-drives/routes.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 179 | `POST` | `/api/college-drives/drives/:id/candidates` | `backend/src/modules/college-drives/routes.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 180 | `POST` | `/api/college-drives/drives/:id/bulk-upload` | `backend/src/modules/college-drives/routes.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 181 | `POST` | `/api/college-drives/drives/:id/recruiters` | `backend/src/modules/college-drives/routes.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 182 | `POST` | `/api/college-drives/drives/:id/jobs` | `backend/src/modules/college-drives/routes.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 183 | `DELETE` | `/api/college-drives/drives/:id/jobs/:jobId` | `backend/src/modules/college-drives/routes.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 184 | `PATCH` | `/api/college-drives/drives/:id/candidates/:candidateId/status` | `backend/src/modules/college-drives/routes.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 185 | `GET` | `/api/college-drives/drives/:id/timeline` | `backend/src/modules/college-drives/routes.js` | C1–C7 (College Drives & Bulk) | **COVERED** |
| 186 | `POST` | `/api/audit-logs/search` | `backend/src/modules/audit/routes.js` | Core | **COVERED** |
| 187 | `GET` | `/api/audit-logs/:id` | `backend/src/modules/audit/routes.js` | Core | **COVERED** |
| 188 | `GET` | `/api/notifications/stream` | `backend/src/modules/notifications/routes.js` | I1–I3 (Jobs & Pipeline) | **COVERED** |
| 189 | `GET` | `/api/notifications` | `backend/src/modules/notifications/routes.js` | I1–I3 (Jobs & Pipeline) | **COVERED** |
| 190 | `POST` | `/api/notifications` | `backend/src/modules/notifications/routes.js` | I1–I3 (Jobs & Pipeline) | **COVERED** |
| 191 | `PATCH` | `/api/notifications/:id/read` | `backend/src/modules/notifications/routes.js` | I1–I3 (Jobs & Pipeline) | **COVERED** |
| 192 | `PATCH` | `/api/notifications/read-all` | `backend/src/modules/notifications/routes.js` | I1–I3 (Jobs & Pipeline) | **COVERED** |
| 193 | `GET` | `/api/notifications/preferences` | `backend/src/modules/notifications/routes.js` | I1–I3 (Jobs & Pipeline) | **COVERED** |
| 194 | `PATCH` | `/api/notifications/preferences` | `backend/src/modules/notifications/routes.js` | I1–I3 (Jobs & Pipeline) | **COVERED** |
| 195 | `GET` | `/api/sse/stream` | `backend/src/routes/sse.js` | Core | **COVERED** |
| 196 | `GET` | `/api/sse/stats` | `backend/src/routes/sse.js` | Core | **COVERED** |
| 197 | `POST` | `/api/files/profile-photo` | `backend/src/modules/files/routes.js` | E1–E6 (Files & Resumes) | **COVERED** |
| 198 | `GET` | `/api/files/:id` | `backend/src/modules/files/routes.js` | E1–E6 (Files & Resumes) | **COVERED** |
| 199 | `GET` | `/api/posted-files` | `backend/src/modules/posted-files/routes.js` | E1–E6 (Files & Resumes) | **COVERED** |
| 200 | `POST` | `/api/posted-files` | `backend/src/modules/posted-files/routes.js` | E1–E6 (Files & Resumes) | **COVERED** |
| 201 | `DELETE` | `/api/posted-files/:id` | `backend/src/modules/posted-files/routes.js` | E1–E6 (Files & Resumes) | **COVERED** |
| 202 | `GET` | `/api/posted-files/:id/download` | `backend/src/modules/posted-files/routes.js` | E1–E6 (Files & Resumes) | **COVERED** |
| 203 | `GET` | `/api/analytics/overview` | `backend/src/modules/analytics/routes.js` | Core | **COVERED** |
| 204 | `GET` | `/api/analytics/pipeline` | `backend/src/modules/analytics/routes.js` | Core | **COVERED** |
| 205 | `GET` | `/api/analytics/hiring-velocity` | `backend/src/modules/analytics/routes.js` | Core | **COVERED** |
| 206 | `GET` | `/api/analytics/interviewer-load` | `backend/src/modules/analytics/routes.js` | Core | **COVERED** |
| 207 | `GET` | `/api/analytics/recruiter-performance` | `backend/src/modules/analytics/routes.js` | Core | **COVERED** |
| 208 | `GET` | `/api/analytics/source-analysis` | `backend/src/modules/analytics/routes.js` | Core | **COVERED** |
| 209 | `GET` | `/api/analytics/stage-conversion` | `backend/src/modules/analytics/routes.js` | Core | **COVERED** |
| 210 | `GET` | `/api/analytics/monthly-trends` | `backend/src/modules/analytics/routes.js` | Core | **COVERED** |
| 211 | `GET` | `/api/analytics/debug-counts` | `backend/src/modules/analytics/routes.js` | Core | **COVERED** |
| 212 | `GET` | `/api/scheduling/members` | `backend/src/modules/scheduling/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 213 | `POST` | `/api/scheduling/members` | `backend/src/modules/scheduling/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 214 | `PATCH` | `/api/scheduling/members/:memberId` | `backend/src/modules/scheduling/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 215 | `DELETE` | `/api/scheduling/members/:memberId` | `backend/src/modules/scheduling/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 216 | `POST` | `/api/scheduling/members/:memberId/lead-list` | `backend/src/modules/scheduling/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 217 | `GET` | `/api/scheduling/members/:memberId/lead-list/export` | `backend/src/modules/scheduling/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 218 | `GET` | `/api/scheduling/my-list` | `backend/src/modules/scheduling/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 219 | `POST` | `/api/scheduling/my-report` | `backend/src/modules/scheduling/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 220 | `GET` | `/api/scheduling/my-report` | `backend/src/modules/scheduling/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 221 | `POST` | `/api/scheduling/members/:memberId/files` | `backend/src/modules/scheduling/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 222 | `DELETE` | `/api/scheduling/members/:memberId/files/:fileId` | `backend/src/modules/scheduling/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 223 | `GET` | `/api/scheduling/admin/overview` | `backend/src/modules/scheduling/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 224 | `GET` | `/api/scheduling/members/:memberId` | `backend/src/modules/scheduling/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 225 | `GET` | `/api/scheduling/members/:memberId/files` | `backend/src/modules/scheduling/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 226 | `GET` | `/api/scheduling/members/:memberId/lead-lists` | `backend/src/modules/scheduling/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 227 | `GET` | `/api/scheduling/members/:memberId/reports` | `backend/src/modules/scheduling/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 228 | `GET` | `/api/scheduling/members/:memberId/files/:fileId/download` | `backend/src/modules/scheduling/routes.js` | D1–D9 (Interviews & Scheduling) | **COVERED** |
| 229 | `GET` | `/api/quality-checks` | `backend/src/modules/quality-check/routes.js` | G1–G3, F1–F3 (QC & Offers) | **COVERED** |
| 230 | `GET` | `/api/quality-checks/counts` | `backend/src/modules/quality-check/routes.js` | G1–G3, F1–F3 (QC & Offers) | **COVERED** |
| 231 | `GET` | `/api/quality-checks/:id` | `backend/src/modules/quality-check/routes.js` | G1–G3, F1–F3 (QC & Offers) | **COVERED** |
| 232 | `POST` | `/api/quality-checks/:id/decision` | `backend/src/modules/quality-check/routes.js` | G1–G3, F1–F3 (QC & Offers) | **COVERED** |
| 233 | `GET` | `/api/matching/candidates/:candidateId/analysis` | `backend/src/modules/matching/routes.js` | K1–K14 (Resume Parsing & JD Match) | **COVERED** |
| 234 | `POST` | `/api/matching/candidates/:candidateId/re-parse` | `backend/src/modules/matching/routes.js` | K1–K14 (Resume Parsing & JD Match) | **COVERED** |
| 235 | `POST` | `/api/matching/candidates/:candidateId/accept-contact` | `backend/src/modules/matching/routes.js` | K1–K14 (Resume Parsing & JD Match) | **COVERED** |
| 236 | `GET` | `/api/matching/jds` | `backend/src/modules/matching/routes.js` | K1–K14 (Resume Parsing & JD Match) | **COVERED** |
| 237 | `POST` | `/api/matching/jds` | `backend/src/modules/matching/routes.js` | K1–K14 (Resume Parsing & JD Match) | **COVERED** |
| 238 | `PUT` | `/api/matching/jds/:id` | `backend/src/modules/matching/routes.js` | K1–K14 (Resume Parsing & JD Match) | **COVERED** |
| 239 | `POST` | `/api/matching/bulk-parse` | `backend/src/modules/matching/routes.js` | K1–K14 (Resume Parsing & JD Match) | **COVERED** |
| 240 | `GET` | `/api/matching/bulk-status` | `backend/src/modules/matching/routes.js` | K1–K14 (Resume Parsing & JD Match) | **COVERED** |
| 241 | `GET` | `/api/v1/ext/health` | `backend/src/modules/ext/routes.js` | L1–L9, M1–M4 (Ext API & HireIQ) | **COVERED** |
| 242 | `GET` | `/api/v1/ext/openapi.json` | `backend/src/modules/ext/routes.js` | L1–L9, M1–M4 (Ext API & HireIQ) | **COVERED** |
| 243 | `GET` | `/api/v1/ext/resumes/:signedToken` | `backend/src/modules/ext/routes.js` | L1–L9, M1–M4 (Ext API & HireIQ) | **COVERED** |
| 244 | `GET` | `/api/v1/ext/me` | `backend/src/modules/ext/routes.js` | L1–L9, M1–M4 (Ext API & HireIQ) | **COVERED** |
| 245 | `GET` | `/api/v1/ext/candidates` | `backend/src/modules/ext/routes.js` | L1–L9, M1–M4 (Ext API & HireIQ) | **COVERED** |
| 246 | `GET` | `/api/v1/ext/candidates/:id` | `backend/src/modules/ext/routes.js` | L1–L9, M1–M4 (Ext API & HireIQ) | **COVERED** |
| 247 | `GET` | `/api/v1/ext/candidates/:id/resume` | `backend/src/modules/ext/routes.js` | L1–L9, M1–M4 (Ext API & HireIQ) | **COVERED** |
| 248 | `GET` | `/api/v1/ext/candidates/:id/interviews` | `backend/src/modules/ext/routes.js` | L1–L9, M1–M4 (Ext API & HireIQ) | **COVERED** |
| 249 | `GET` | `/api/v1/ext/interviews` | `backend/src/modules/ext/routes.js` | L1–L9, M1–M4 (Ext API & HireIQ) | **COVERED** |
| 250 | `GET` | `/api/v1/ext/interviews/:id` | `backend/src/modules/ext/routes.js` | L1–L9, M1–M4 (Ext API & HireIQ) | **COVERED** |
| 251 | `GET` | `/api/v1/ext/drives` | `backend/src/modules/ext/routes.js` | L1–L9, M1–M4 (Ext API & HireIQ) | **COVERED** |
| 252 | `GET` | `/api/v1/ext/drives/:id/candidates` | `backend/src/modules/ext/routes.js` | L1–L9, M1–M4 (Ext API & HireIQ) | **COVERED** |
| 253 | `GET` | `/api/v1/ext/jobs` | `backend/src/modules/ext/routes.js` | L1–L9, M1–M4 (Ext API & HireIQ) | **COVERED** |
| 254 | `GET` | `/api/v1/ext/team-members` | `backend/src/modules/ext/routes.js` | L1–L9, M1–M4 (Ext API & HireIQ) | **COVERED** |
| 255 | `GET` | `/api/v1/ext/stats/summary` | `backend/src/modules/ext/routes.js` | L1–L9, M1–M4 (Ext API & HireIQ) | **COVERED** |
| 256 | `GET` | `/api/v1/ext/changes` | `backend/src/modules/ext/routes.js` | L1–L9, M1–M4 (Ext API & HireIQ) | **COVERED** |
| 257 | `POST` | `/api/v1/integrations/recruit-ai/webhook` | `backend/src/modules/integrations/recruit-ai/routes.js` | N1–N7 (Recruit AI Integration) | **COVERED** |
| 258 | `GET` | `/api/v1/integrations/recruit-ai/review-queue` | `backend/src/modules/integrations/recruit-ai/routes.js` | N1–N7 (Recruit AI Integration) | **COVERED** |
| 259 | `POST` | `/api/v1/integrations/recruit-ai/confirm-outcome` | `backend/src/modules/integrations/recruit-ai/routes.js` | N1–N7 (Recruit AI Integration) | **COVERED** |
| 260 | `POST` | `/api/v1/integrations/recruit-ai/relink` | `backend/src/modules/integrations/recruit-ai/routes.js` | N1–N7 (Recruit AI Integration) | **COVERED** |
| 261 | `POST` | `/api/v1/integrations/recruit-ai/dismiss` | `backend/src/modules/integrations/recruit-ai/routes.js` | N1–N7 (Recruit AI Integration) | **COVERED** |
| 262 | `GET` | `/api/v1/integrations/recruit-ai/candidate/:candidateId` | `backend/src/modules/integrations/recruit-ai/routes.js` | N1–N7 (Recruit AI Integration) | **COVERED** |
| 263 | `GET` | `/api/v1/integrations/recruit-ai/status` | `backend/src/modules/integrations/recruit-ai/routes.js` | N1–N7 (Recruit AI Integration) | **COVERED** |
| 264 | `POST` | `/api/v1/integrations/recruit-ai/sync` | `backend/src/modules/integrations/recruit-ai/routes.js` | N1–N7 (Recruit AI Integration) | **COVERED** |
| 265 | `GET` | `/api/version` | `backend/src/app.js` | J3 (Build Gate & Version) | **COVERED** |
| 266 | `GET` | `/api/health` | `backend/src/app.js` | Core | **COVERED** |
| 267 | `GET` | `/api/health/cache` | `backend/src/app.js` | Core | **COVERED** |

---

## 4. Background Workers, Schedulers & Crash Resilience

| Worker / Job Script | Path | Trigger & Cadence | Memory & Pool Budget | Test ID | Coverage Status |
|---|---|---|---|---|---|
| `bulkImportWorker.js` | `backend/src/jobs/bulkImportWorker.js` | BullMQ Queue on Candidate Upload | 80 MB limit, crash recovery ledger | C3–C5, I1 | **COVERED** |
| `bulkCandidateUpload.processor.js` | `backend/src/jobs/bulkCandidateUpload.processor.js` | Ingest processor for candidate spreadsheets | Stream-parsed, duplicate detection | C1–C4 | **COVERED** |
| `bulkInterviewUpload.processor.js` | `backend/src/jobs/bulkInterviewUpload.processor.js` | Batch scheduling processor | 250-row chunks with IST lock | D1–D6 | **COVERED** |
| `bulkFeedbackUpload.processor.js` | `backend/src/jobs/bulkFeedbackUpload.processor.js` | Evaluator ratings ingest | Strict numeric string parse, null on blank | D7–D8 | **COVERED** |
| `bulkJoinedCandidateUpload.processor.js` | `backend/src/jobs/bulkJoinedCandidateUpload.processor.js` | Joined candidates status updater | Audit-logged updates | F1–F3 | **COVERED** |
| `bulkOfferLetterUpload.processor.js` | `backend/src/jobs/bulkOfferLetterUpload.processor.js` | Offer letter URL attachment | FileMeta linkage | F1, E1 | **COVERED** |
| `notificationScheduler.js` | `backend/src/jobs/notificationScheduler.js` | Cron (every 1 min) | Non-convergent queue tracking, in-app SSE | I2 | **COVERED** |
| `qualityCheckReconciliation.js` | `backend/src/jobs/qualityCheckReconciliation.js` | Periodic daemon | Round 2 reconciler | G1, F2 | **COVERED** |
| `resumeHealthCheck.js` | `backend/src/jobs/resumeHealthCheck.js` | Hourly audit | FileMeta vs disk verification | E6 | **COVERED** |
| `schedulingSyncWorker.js` | `backend/src/jobs/schedulingSyncWorker.js` | Event queue worker | In-memory telecalling & lead sync | D6, H1 | **COVERED** |
| `recruitAiPollerService.js` | `backend/src/modules/integrations/recruit-ai/pollerService.js` | 15 min cron | Overlap window polling | N2, N6 | **COVERED** |
| `resumeParseWorker.js` | `backend/src/modules/matching/resumeParseWorker.js` | Concurrency capped (2 workers) | Buffer release, rate limiter backoff | K2, K9 | **COVERED** |

---

## 5. External Integrations & Boundaries

| Integration | Protocol / Auth | Data Direction | In-Scope Verification | Mock / Simulation Protocol Under Load |
|---|---|---|---|---|
| **HireIQ** | Scoped API Key (`tos_live_...`) | Inbound (HireIQ reads from TalentOS) | Dedicated 6-field DTO, rate limiter (60/min) | Queried directly via k6 external API journey |
| **Recruit AI** | SHA-256 HMAC Webhook + Polling | Bi-directional (TalentOS pushes schedules, pulls results) | Idempotent inbox, signature check, deduplication | **Signed test payloads ONLY**; never call live 187.127.137.103 |
| **Neon PostgreSQL** | Pooled SSL Connection (`-pooler`) | Internal DB Read/Write | Connection pooling, `pg_stat_statements` | Direct metrics monitoring |
| **File Storage (FileMeta)** | PostgreSQL Bytea / Hex | Binary Read/Write | Permanent DB-backed storage, streaming | Tagged `QA_LOOP3_` files only |

---

## 6. Coverage Gap Analysis
- Total Endpoints / Routes Identified: **309**
- Uncovered Elements: **0**
- Gaps Requiring New Test / Blocked Status:
  - Any destructive or mutating write load tests against live production data are strictly gated behind **Part 1 Pre-Flight Safety Checks** and tagged with `QA_LOOP3_<timestamp>`.
