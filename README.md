# TalentOS Workspace (ATS + Sales CRM)

TalentOS is an Enterprise Applicant Tracking System (ATS) and Sales CRM workspace (deployed under the name `brand-promoter---prod`). It provides full candidate pipeline management, interview scheduling, team management, college recruitment drives, and a dedicated sales tracking module.


## 1) Project Status (E2E)

This project is **working end-to-end** for core ATS flows:

- Authentication + role-based route protection
- User management (Super Admin)
- Candidate CRUD + search + duplicate prevention + bulk upload
- Resume upload + candidate custom fields + candidate history
- Job creation + active/closed management
- Application creation + pipeline stage movement + shortlist
- Interview scheduling + feedback submission + voice recording upload
- Analytics + reports + Excel/PDF export
- In-app notification center (bell, unread badge, mark read)
- CI smoke validation

---

## 2) Tech Stack

- Frontend: React + Vite + Tailwind + Framer Motion
- Backend: Node.js + Express
- Database: PostgreSQL + Prisma ORM
- Uploads: Multer (local disk)
- Exports: XLSX + PDFKit

---

## 3) Stakeholder & Role Mapping

From ATS requirements:

- Super Admin -> `SUPER_ADMIN`
- Internal Users (HR/Recruiters) -> `RECRUITER`
- Hiring Team / Interviewers -> `INTERVIEWER`

---

## 4) Implemented Features (Requirement-wise)

### A) User Management
- Role-based access control
- Create / edit / activate-deactivate users
- Audit logs
- Super Admin only access for full user management and logs

### B) Candidate Management
- Add candidate manually
- Bulk upload candidates via Excel (`.xlsx/.xls`)
- Resume upload/replacement
- Candidate details: name, email, phone, experience, source, skills, education
- Search/filter candidate list
- Duplicate prevention on key identity fields
- Custom field definitions + per-candidate values
- Candidate timeline/history view

### C) Recruitment Pipeline Tracking
- Pipeline stages loaded from backend
- Move candidates between stages
- Stage history tracking
- Application shortlist/unshortlist
- Custom stage creation (global/job-specific)
- Pipeline filtering by job and candidate

### D) Interview Management
- Schedule interviews (multi-round)
- Assign interviewers
- Record date/time/mode/link
- Submit structured mandatory feedback
- Voice recording support:
  - direct file upload
  - in-browser microphone recording and upload

### E) Dashboard / Analytics / Reports
- Dashboard metrics and activity feed
- Pipeline velocity visualization
- Analytics:
  - pass-through efficiency
  - time-to-hire bars
  - source funnel
  - stage timing table
- Reports:
  - recruiter activity
  - hiring progress by job
  - quality/selection metrics
- Export reports to Excel/PDF

### F) Notifications
- Shared notification bell component across enterprise pages
- Unread counter
- Dropdown list with quick navigation
- Mark single / mark all as read
- Notification preferences toggle in Settings (stored in local storage)

---

## 5) Frontend Routes & Pages

Public:
- `/` Landing
- `/login`
- `/signup`
- `/careers`

Protected:
- `/dashboard`
- `/candidates`
- `/candidate/:id`
- `/jobs`
- `/pipeline`
- `/schedule` (interviews)
- `/analytics`
- `/reports` (Super Admin + Recruiter)
- `/settings`
- `/team` (Super Admin + Recruiter)
- `/sourcing`
- `/referrals`

---

## 6) Backend API Modules

- Auth: `/api/auth/*`
- Users: `/api/users/*`
- Candidates: `/api/candidates/*`
- Jobs: `/api/jobs/*`
- Applications: `/api/applications/*`
- Pipeline: `/api/pipeline/*`
- Interviews: `/api/interviews/*`
- Reports: `/api/reports/*`
- Health: `/api/health`
- Uploaded files: `/uploads/*`

---

## 7) Role-wise Functional Access

### Super Admin
- Full system access
- User lifecycle management
- Audit log access
- All ATS modules + report export

### Recruiter
- Candidate, jobs, applications, pipeline, interviews
- Custom fields and resume operations
- Report viewing/export
- No full admin user controls/audit access

### Interviewer
- Candidate/job/application visibility
- Interview panel operations
- Feedback submission
- Recording upload
- No user management, no admin exports

---

## 8) Seed Users (Default)

From `backend/prisma/seed.js` (non-admin accounts):

- `recruiter@ats.local` / `ChangeMe@123` (RECRUITER)
- `recruiter2@ats.local` / `ChangeMe@123` (RECRUITER)
- `interviewer@ats.local` / `ChangeMe@123` (INTERVIEWER)
- `interviewer2@ats.local` / `ChangeMe@123` (INTERVIEWER)

**SUPER_ADMIN:** default `admin@ats.local` is rotated in production/local via:

```bash
node backend/scripts/rotate-admin-credentials.js
```

Credentials are written to `backend/.admin-credentials.local` (gitignored). Do not commit that file.

---

## 9) Local Setup & Run

Project root:

```bash
npm run install:all
npm run dev
```

Backend only:

```bash
cd backend
npm run dev
```

Frontend only:

```bash
cd frontend
npm run dev
```

Prisma setup:

```bash
cd backend
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

---

## 10) QA / Validation Commands

Backend smoke check:

```bash
cd backend
npm run ci:smoke
```

Frontend production build:

```bash
cd frontend
npm run build
```

If smoke test shows `fetch failed`, ensure backend is running on `http://localhost:4000` and check:

```bash
netstat -ano | findstr :4000
```

---

## 11) CI/CD

Workflow files:
- `.github/workflows/ci.yml`
- `.github/workflows/cd.yml`

CI includes:
- frontend install + build
- backend install
- PostgreSQL service
- Prisma migrate + seed
- backend startup + smoke test

CD includes:
- build artifacts
- deployment placeholder pipeline (replace with real target deploy commands)

---

## 12) What Is Completed vs Pending

### Completed
- Core ATS lifecycle from candidate intake to interview and reporting
- Role-aware access and protected frontend routes
- Reporting and export baseline
- In-app notification center
- Security middleware baseline (headers, rate limiting, payload guard)

### Pending / Next Hardening Layer
- Advanced shortlist UX polish across large datasets
- Richer analytics drilldowns (cohort/source/time trend depth)
- Production-grade notification channels (email/SMS/Slack delivery, not just in-app)
- Cloud file storage (S3/GCS/Azure Blob) instead of local uploads
- Comprehensive automated tests (frontend e2e + backend integration suites)
- Deployment hardening (Docker, reverse proxy, TLS, observability)

---

## 13) Notes

- Demo data may include extra records created during smoke/E2E tests.
- For a clean dataset, reset DB and run Prisma migrate + seed.
- Theme consistency is maintained across enterprise pages with shared layout and styles.

---

## 14) Local Development Performance & Production Testing

### Dev Server Expectations (`npm run dev`)
- **Focus**: Fast reloads (HMR) and instant hot module replacement when editing code.
- **Under the hood**: Vite serves files individually to enable rapid updates. When loading the app cold in dev mode, the browser may fire many requests.
- **Initial Load**: First page load in dev mode can take slightly longer due to individual module requests. This does not represent production speed.

### Production Preview (`npm run preview`)
- **Focus**: Testing exact production-mode behavior locally.
- **Under the hood**: Vite runs the compiled, minified, tree-shaken, and chunked bundle.
- **How to run**:
  1. Build the bundle: `npm run build`
  2. Run the preview: `npm run preview`
- **Result**: Navigating locally on `http://localhost:4173` runs the exact production assets. This is the correct environment to measure real user speed before deployment.

### Production Performance
- Measure page speed and load times using Lighthouse or Chrome DevTools against the built preview server (`http://localhost:4173`) or the actual deployed URL.

