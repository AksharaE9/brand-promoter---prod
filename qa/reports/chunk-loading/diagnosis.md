# Chunked Loading Diagnosis Report (`qa/reports/chunk-loading/diagnosis.md`)

**Date:** October 29, 2026  
**Auditor:** Senior Full-Stack Engineer & QA Lead  
**Scope:** Akshara Enterprises ATS — All Candidates Infinite Scroll & Cursor Pagination

---

## 1. Executive Summary

Chunked loading on the All Candidates page was diagnosed using API crawler scripts and DOM inspection. The database contains **2,246 active candidates**, but infinite scrolling in production halted after the first page (or stalled intermittently), preventing users from reaching the remaining ~2,200 candidates.

---

## 2. Ranked Root Causes (with Evidence)

### Rank 1: Misconfigured IntersectionObserver Scroll Root (Frontend)
- **File:** `frontend/src/components/PaginatedListView.jsx`
- **Defect:** Line 49 specified `root: null`.
- **Evidence:** The application layout in `EnterpriseLayout.jsx` wraps the candidate grid in a scrollable frame `<div className="os-content">` which has CSS `overflow-y: auto`. When `root: null` is passed to `IntersectionObserver`, the browser checks intersection against the window viewport instead of `.os-content`. When `.os-content` scrolls, intersection events fail to trigger reliably.
- **Impact:** Scrolling down the container did not trigger `fetchNextPage()`, stranding the user on the first chunk of 50 candidates.

### Rank 2: Aggressive Client-Side 5-Minute Cache on Candidate List (Frontend)
- **File:** `frontend/src/lib/api.js`
- **Defect:** `LONG_CACHE_ROUTES` included `/candidates` with a 5-minute TTL (`LONG_CACHE_TTL = 300,000 ms`).
- **Evidence:** When `usePaginatedList` requested `/candidates?limit=50&cursor=...`, `apiGet` intercepted the call and served stale in-memory cached results across filter changes and scrolling sessions.
- **Impact:** Users who applied filters or scrolled received stale cached pages or repeated chunk 1 data.

### Rank 3: In-Memory Sorting for Match Score (`sortBy: 'matchScore'`) (Backend)
- **File:** `backend/src/modules/candidates/routes.js`
- **Defect:** In `routes.js` (lines 415–421 and 1195–1200):
  ```javascript
  let items = rawItems.map(attachMatchScoreToCandidate);
  if (req.query.sortBy === 'matchScore') {
    items.sort((a, b) => (b.matchScore?.score100 ?? -1) - (a.matchScore?.score100 ?? -1));
  }
  ```
- **Evidence:** `findMany` fetched 50 rows ordered by `updatedAt: 'desc'`, and Node.js sorted only those 50 rows in memory. When the user sorted by "Match score (high $\rightarrow$ low)", chunk 1 contained the top 50 recently updated candidates sorted among themselves, and chunk 2 contained the next 50 recently updated candidates sorted among themselves. The global database was never ordered by match score in SQL.
- **Impact:** Sorting by match score did not bring the highest-scoring candidates across the database to page 1.

### Rank 4: Incomplete React Query Key in Candidates Page (Frontend)
- **File:** `frontend/src/pages/Candidates.jsx`
- **Defect:** Line 436 passed `queryKey: ['candidates', statusFilter]`.
- **Evidence:** It omitted `companyFilter`, `roleFilter`, `locationFilter`, `matchBandFilter`, `matchStateFilter`, `sortBy`, `dateRange`, and `debouncedSearch`.
- **Impact:** Switching filters or sorting did not reset the cursor or re-initiate infinite loading cleanly.

### Rank 5: Lack of Virtualization and DOM Bloat
- **File:** `frontend/src/components/PaginatedListView.jsx`
- **Defect:** Cards were appended directly to the DOM without virtualization.
- **Evidence:** As chunks accumulate towards 2,000+ cards, the DOM reaches > 10,000 nodes, triggering frame drops and scrolling lag.
- **Impact:** Slowness and long tasks > 200 ms during scrolling.

---

## 3. Targeted Remediation Plan

1. **Backend Keyset Cursor & SQL Ordering:**
   - Implement base64 opaque cursor `{ sortKey, id }`.
   - Implement server-side SQL sorting for `sortBy: 'matchScore'` using a `LEFT JOIN` on `match_scores` with `NULLS LAST`.
   - Page size 48 (divides evenly into 1, 2, 3, and 4 columns).
2. **Frontend Scroll Root & Observer:**
   - Bind `IntersectionObserver` directly to the `.os-content` scroll container.
   - Set `rootMargin: '800px'` to prefetch before the user reaches the bottom.
   - If the sentinel remains visible after a chunk load (e.g., large monitors), immediately fetch the next chunk until the screen is filled.
3. **Bypass In-Memory Cache for Paginated Queries:**
   - Ensure `usePaginatedList` passes `useCache: false` to `apiGet` so pagination cursors always fetch live data from the server.
4. **Card Height Uniformity:**
   - Fix card height with standardized spacers for company, rating chip, and joining badge.
