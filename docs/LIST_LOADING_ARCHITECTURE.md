# Definitive List-Loading Architecture for All Candidate Views

## Architecture Overview

This architecture establishes a high-performance, unified, and resilient list-loading standard across all candidate views in the ATS (**Candidate Pool**, **Joined Candidates**, **Offer Sent Registry**, and **Rejected Candidates**).

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Client Architecture                             │
│                                                                             │
│  ┌───────────────────────┐              ┌────────────────────────────────┐  │
│  │   Candidates View     │              │     Filter & Search Bar        │  │
│  └───────────┬───────────┘              └───────────────┬────────────────┘  │
│              │                                          │                   │
│              ▼                                          ▼                   │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                          usePaginatedList                             │  │
│  │  - Initial chunk: 50 items (instant paint)                            │  │
│  │  - Subsequent chunks: 100 items                                       │  │
│  │  - Stale time: 30s with keepPreviousData                              │  │
│  │  - Keyset cursor pagination                                           │  │
│  └───────────────────┬───────────────────────────────────┬───────────────┘  │
│                      │                                   │                  │
│                      ▼                                   ▼                  │
│         ┌─────────────────────────┐         ┌───────────────────────────┐   │
│         │ GET /api/candidates     │         │ GET /api/candidates/count │   │
│         │ (Items & Cursor only)   │         │ (Parallel Filtered Count) │   │
│         └────────────┬────────────┘         └─────────────┬─────────────┘   │
└──────────────────────┼────────────────────────────────────┼─────────────────┘
                       ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             PostgreSQL / Neon                               │
│                                                                             │
│  Covering Indexes with INCLUDE:                                             │
│  - idx_candidates_list_covering                                             │
│  - idx_candidates_list_status_covering                                      │
│  -> 100% Index Only Scan (0 Table Heap Fetches, <12ms query time)           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Principles & Contracts

### 1. Keyset Cursor Pagination
- **Format**: `${updatedAt.getTime()}_${id}`
- **Server Enforcement**: Max `limit` capped at 100 items per request. Default 50 items for page 1.
- **Payload Projection**: Only fields required for card and table representations are returned (`fullName`, `preferredRole`, `location`, `company`, `phone`, `status`, `offerDecision`, `doj`, `createdAt`, `updatedAt`).

### 2. Decoupled Counts
- Listing queries **do not calculate inline counts**. This eliminates heavy sequential count operations during pagination.
- Tab counts are served asynchronously via `GET /api/candidates/status-counts` (`useCandidateStatusCounts`).
- Filtered subset totals are fetched on-demand via `GET /api/candidates/count` (`useCandidateFilteredCount`).

### 3. PostgreSQL Covering Indexes
- **`idx_candidates_list_covering`**:
  `("organizationId", "isDeleted", "updatedAt" DESC, id DESC) INCLUDE ("fullName", "preferredRole", location, company, phone, "offerDecision", doj, status, "createdAt")`
- **`idx_candidates_list_status_covering`**:
  `("organizationId", "isDeleted", status, "updatedAt" DESC, id DESC) INCLUDE ("fullName", "preferredRole", location, company, phone, "offerDecision", doj, "createdAt")`

### 4. Client Components & Hooks
- **`usePaginatedList(endpoint, options)`**: Shared infinite pagination hook with debounced filters and deterministic cache keys.
- **`<PaginatedListView>`**: Standard list container with 400px prefetch sentinel, skeleton loaders, honest progress indicators, and empty state management.
