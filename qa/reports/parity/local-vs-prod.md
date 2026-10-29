# Production vs Localhost Parity Diagnosis (`qa/reports/parity/local-vs-prod.md`)

**Date:** October 29, 2026  
**Auditor:** Senior Full-Stack Engineer & QA Lead  
**Scope:** Akshara Enterprises ATS — All Candidates View  
**Target Environments:**
- Local: Frontend `http://localhost:5173`, Backend `http://localhost:4000`
- Production: Frontend `https://brand-promoter-prod.vercel.app`, Backend `https://brandpromoter-backend.onrender.com`

---

## 1. Parity Matrix Summary

| Area | Localhost | Production (Render / Vercel) | Parity Status | Evidence & Explanation |
|---|---|---|---|---|
| **1.1 Backend Code Commit** | `ab21cc2` | `ab21cc2e28192cf4fab812db2656a6134a9bceed` | `SAME` | Verified via `GET /api/version` on both. Render successfully deployed commit `ab21cc2` at `2026-10-29T05:01:54Z`. |
| **1.1 Frontend Code Bundle** | `ab21cc2` (Vite dev) | `ab21cc2` (Vercel) | `SAME` | Asset inspection of Vercel production bundle confirmed `MatchScoreChip` component is present and wired to `candidate.matchScore`. |
| **1.2 Database Host & DB** | Render PostgreSQL `dpg-d9kugflaeets73a88qhg-a` / `ats_to2n` | Render PostgreSQL `dpg-d9kugflaeets73a88qhg-a` / `ats_to2n` | `SAME` | Both local backend and Render production backend connect to the exact same database cluster. |
| **1.2 MatchScore Row Count** | 297 rows (99 unique candidates) | 297 rows (99 unique candidates) | `SAME` | Scored rows exist in the live database: 99 primary scores (Ops: 20, BDE: 29, S&M: 15, preserved historical: 35). |
| **1.3 Database Schema** | Synced Prisma Schema | Synced Prisma Schema | `SAME` | Tables `match_scores`, `resume_parse_jobs`, `job_descriptions`, `job_description_versions` are fully migrated. Zero silent catches. |
| **1.4 Environment Flags** | `MATCH_SCORE_UI_ENABLED=true` | `MATCH_SCORE_UI_ENABLED` (defaults true) | `SAME` | Feature flag is enabled in both environments. |
| **1.5 API Data Shape** | `{ success: true, data: [...], matchScore: {...} }` | `{ success: true, data: [...], matchScore: {...} }` | `SAME` | Live endpoint test for Sanjana Desai and Manoj Kumar R returned identical JSON shape with `matchScore.state: 'SCORED'`. |
| **1.6 Ingestion Worker** | In-process queue active | In-process queue active (Render) | `SAME` | 99 completed parse jobs, 1 failed job in production. Low-concurrency worker initialized. |
| **1.7 Role Resolution** | Resolver logic matches 3 JDs; Data Analyst excluded | Resolver logic matches 3 JDs; Data Analyst excluded | `SAME` | Strict alias matching active. Data Analyst and Business Analyst evaluate to `NO_JD`. |
| **1.8 Screen Composition & Scrolling** | Loaded specific candidates | Chunked loading stopped at chunk 1 | `DIFFERENT` (ROOT CAUSE) | On localhost, developers test with direct candidate IDs or role filters. In production All Candidates grid, the top candidates updated in late October were Data Analysts (BS, VK) and Megha (Ops with no resume). Because chunked loading stopped after chunk 1, the 97 scored candidates from September never scrolled into view. |

---

## 2. Root Cause Statement: Why Ratings Appeared "Missing" in Production

The diagnosis proves that **match ratings are NOT missing from the production backend or database**:
1. `GET https://brandpromoter-backend.onrender.com/api/candidates?limit=24` returns:
   - Position 1: `Sanjana Desai` $\rightarrow$ `matchScore: { state: 'SCORED', rating10: 3.4, band: 'Weak' }`
   - Position 2: `Manoj Kumar R` $\rightarrow$ `matchScore: { state: 'SCORED', rating10: 3.3, band: 'Weak' }`
   - Positions 3 to 24: `Data Analyst Intern` $\rightarrow$ `matchScore: null` (`NO_JD`, by design).
2. The user screenshot captured **BS** (*Boggavarapu Suriya*) and **VK** (*Vinayak g sanamani*), both *Data Analyst Interns*, and **Megha** (*Operations Intern* with a Google Drive folder link, no readable resume file).
3. **By design, Data Analyst Interns show NO rating chip.**
4. **Megha correctly showed the `"No resume"` chip.**
5. When the user attempted to scroll down to view other candidates, **chunked loading failed to load chunk 2 and subsequent pages**. Because the remaining 97 scored candidates had `updatedAt` timestamps in September, they were trapped in subsequent chunks and could never be viewed in the grid.
6. The combination of (a) broken infinite scroll sentinel, (b) client-side 5-minute cache in `lib/api.js`, and (c) in-memory sorting on `sortBy: 'matchScore'` created the false appearance that ratings only worked on localhost.

---

## 3. Prevention & Hardening Plan

1. **Fix Infinite Scroll & Keyset Pagination:** Complete Part 2 so that all 2,246 candidates load seamlessly in chunks of 48.
2. **Server-Side Match Score Sorting:** Implement SQL-level sorting (`ORDER BY match_scores.ratingOutOf10 DESC NULLS LAST, candidates.id DESC`) so clicking "Match score (high $\rightarrow$ low)" immediately surfaces all scored candidates on page 1.
3. **Joining Date Repair:** Fix the unparseable text values in `doj` and restrict the "Joining" badge strictly to candidates with `offerDecision: 'JOINED'` or valid ISO calendar dates.
