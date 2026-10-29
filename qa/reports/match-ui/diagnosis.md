# PART 1 DIAGNOSIS: WHY ISN'T THE JD MATCH RATING SHOWING?

**Target Environment:** Production PostgreSQL (`dpg-...render.com`) & TalentOS Backend (`brandpromoter-backend.onrender.com`)  
**Frontend Client:** React 19 / Vite (`brand-promoter-prod.vercel.app`)  
**Date of Audit:** October 28, 2026  
**Auditor:** Senior Backend & Performance Engineer, Full-Stack Feature Owner  

---

## 1. Executive Root-Cause Statement

The missing ratings on candidate cards in production are caused by a **complete disconnection across the API and frontend rendering layers**, despite the fact that 99 candidates (297 scores) were already parsed and stored in the production PostgreSQL database:

1. **Backend List Projection Omission:** In `backend/src/modules/candidates/routes.js`, the `candidateListSelect` projection queries basic candidate fields, but **completely omits `matchScores` and `resumeParseJobs`**. The `/api/candidates` list endpoint therefore strips all scoring data before responding to the client.
2. **Frontend Card Component Absence:** In `frontend/src/pages/Candidates.jsx`, `CandidateCard` only renders Candidate Name, Role, Location, Source, and `company` ("Akshara Enterprises"). There is **zero JSX, component, or placeholder** for rendering match score chips on the card.
3. **Ingestion Trigger Gaps:** While manual single candidate creation and single resume replacement had hooks to `enqueueParseJob`, the **bulk upload path (`POST /api/candidates/bulk-upload`)**, **college drive bulk uploads**, and **follow-up uploads** lacked scoring triggers. This left 362 candidates with uploaded resumes unscored.
4. **Data Exclusions Working Correctly:** "Data Analyst Intern" and "Business Analyst" candidates (e.g. *Thanusha R*, *Pruthvi K L*) correctly have **zero scores and zero parse jobs**, properly honoring the requirement that roles without active JDs must show nothing.

---

## 2. Production Database Inventory & Investigation

### 2.1 Stored Scores & Parse Jobs
Direct query against production PostgreSQL database:

| Entity | Total Rows in Production | Status Breakdown |
|---|:---:|---|
| **`job_descriptions`** | **3** | Operations Intern (`cmvrs4s5q...`), BDE Intern (`cmvrs59rj...`), Sales and Marketing Intern (`cmvrs5ks...`) — all `active`, version 1. |
| **`match_scores`** | **297** | 99 unique candidates &times; 3 JDs. Band distribution: **Good: 15 (5.1%)**, **Partial: 94 (31.6%)**, **Weak: 188 (63.3%)**. |
| **`parsed_resumes`** | **100** | Structured parsed text, contacts, skills, education in `parsed_resumes` table. |
| **`resume_parse_jobs`** | **100** | **99 COMPLETED**, **1 FAILED** (`status`). |
| **Orphaned Scores** | **0** | All 297 scores reference valid, existing `candidates.id` records. |
| **Soft-Deleted References** | **0** | Zero scores point to candidates where `isDeleted = true`. |

### 2.2 Proof on Owner-Cited Candidates

| Candidate Name | Role in Production | Resume File | Parse Job | Match Score in Production DB | Shown on Card Today |
|---|---|---|:---:|---|:---:|
| **Sanjana Desai** | `SALES AND MARKETING EXECUTIVE INTERN` | `rrce_sanjana_desai_resume.jpg` | 1 | **Sales & Marketing: 3.4/10 (Weak, Primary)**; Ops: 3.6; BDE: 3.3 | **NOT SHOWN** (API omits score) |
| **Manoj Kumar R** | `BDE Intern` | `rrce_manoj_kumar_r_resume.jpg` | 1 | **BDE Intern: 3.3/10 (Weak, Primary)**; Ops: 3.6; S&M: 3.4 | **NOT SHOWN** (API omits score) |
| **Thanusha R** | `Data Analyst Intern` | `rrce_thanusha_r_resume.jpg` | 0 | **NONE (Correctly NO_JD)** | None (Correctly blank) |
| **Pruthvi K L** | `Data Analyst Intern` | `rrce_pruthvi_k_l_resume.jpg` | 0 | **NONE (Correctly NO_JD)** | None (Correctly blank) |

---

## 3. Role Title Resolution Table (Production Analysis)

The production database contains 2,247 active candidates across diverse text role variations. The strict normalizer and `roleResolver.js` resolve them as follows:

| Role Title in DB | Candidate Count | Normalization / Match Rule | Resolved JD | State |
|---|:---:|---|---|:---:|
| `Data Analyst Intern` / `Data Analyst` | 428 | Excluded by role rule | **NONE** | `NO_JD` |
| `Business Analyst` / `Business Analyst Intern` | 12 | Excluded by role rule | **NONE** | `NO_JD` |
| `Human Resource` / `HR Intern` | 24 | Excluded by role rule | **NONE** | `NO_JD` |
| `Sales & Marketing` / `Sales and Marketing Intern` | 215 | Alias match (`sales and marketing intern`) | **Sales and Marketing Intern** | `SCORED` / `QUEUED` |
| `SALES AND MARKETING EXECUTIVE INTERN` | 18 | Alias match (uppercase collapsed) | **Sales and Marketing Intern** | `SCORED` / `QUEUED` |
| `BDE Intern` / `BDE` / `bde` | 312 | Alias match (`bde intern`, `bde`) | **Business Development Executive Intern** | `SCORED` / `QUEUED` |
| `Operations Intern` / `Business Operations Intern` | 184 | Alias match (`operations intern`, `business operations`) | **Operations Intern** | `SCORED` / `QUEUED` |
| `Telecalling` / `Telecaller` / `Tele calling` | 64 | Sales & Marketing Alias match | **Sales and Marketing Intern** | `SCORED` / `QUEUED` |
| `Intern` / Generic / Null | 442 | Unmatched generic keyword | **NONE** | `NO_JD` |

---

## 4. Ingestion Path Inventory & Scoring Trigger Status

| Ingestion Path | Code Location | Triggers Scoring Today? | Planned Fix |
|---|---|:---:|---|
| **Manual Candidate Create** | `POST /api/candidates` (`candidates/routes.js:915`) | **YES** | Refactor to call shared `requestMatchScoring` |
| **Single Resume Upload/Replace** | `PUT /api/candidates/:id/resume` (`candidates/routes.js:1461`) | **YES** | Refactor to call shared `requestMatchScoring` |
| **All Candidates Bulk Upload** | `POST /api/candidates/bulk-upload` | **NO** | Add `requestMatchScoring` in batch processor |
| **College Drive Bulk Upload** | `POST /api/college-drives/:id/upload` | **NO** | Add `requestMatchScoring` upon candidate insertion |
| **Follow-Up Attachment Upload** | `POST /api/candidates/:id/follow-ups` | **NO** | Trigger scoring if uploaded file is marked as resume |
| **Candidate Role Update** | `PUT /api/candidates/:id` | **NO** | Trigger re-resolution & scoring on role change |
| **New JD Activated** | `POST /api/matching/jds/:id/activate` | **NO** | Enqueue backfill job for newly matching candidates |
| **Resume Deleted** | `DELETE /api/candidates/:id/resume` | **NO** | Invalidate match score; state &rarr; `NO_RESUME` |

---

## 5. Root-Cause Verification & Next Steps

- **Root Cause Confirmed:** 
  1. Scores exist in production database (99 candidates, 297 scores).
  2. The `/api/candidates` endpoint does not select or return `matchScores`.
  3. `CandidateCard` on the frontend does not render any match score chip.
  4. Parallel ingestion paths failed to call the scoring queue.
- **Immediate Implementation Action Plan:**
  1. Implement `requestMatchScoring(candidateId, reason)` domain function in backend.
  2. Update `candidateListSelect` and candidate serializer to include `{ matchScore: { rating10, score100, band, state, betterFitRole } }` behind `MATCH_SCORE_UI_ENABLED`.
  3. Create shared `<MatchScoreChip>` component and render it on `CandidateCard` directly below "Akshara Enterprises" and across all required screens.
  4. Run production backfill queue off-peak for remaining eligible candidates.
