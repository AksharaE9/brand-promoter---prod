# Firestore Performance Optimization: Required Indexes

To ensure low latency and prevent query failures in production, please add the following composite indexes in your Firebase Console (Project Settings -> Firestore Database -> Indexes).

### 1. Candidates Collection
- **Field 1**: `category` (Ascending)
- **Field 2**: `createdAt` (Descending)
- **Scope**: Collection

- **Field 1**: `status` (Ascending)
- **Field 2**: `createdAt` (Descending)
- **Scope**: Collection

- **Field 1**: `mentorId` (Ascending)
- **Field 2**: `createdAt` (Descending)
- **Scope**: Collection

### 2. Applications Collection
- **Field 1**: `candidateId` (Ascending)
- **Field 2**: `createdAt` (Descending)
- **Scope**: Collection

- **Field 1**: `jobId` (Ascending)
- **Field 2**: `status` (Ascending)
- **Field 3**: `createdAt` (Descending)
- **Scope**: Collection

### 3. Interviews Collection
- **Field 1**: `applicationId` (Ascending)
- **Field 2**: `scheduledStart` (Descending)
- **Scope**: Collection

- **Field 1**: `interviewerIds` (Array-Contains)
- **Field 2**: `scheduledStart` (Descending)
- **Scope**: Collection

### 4. Audit Logs Collection
- **Field 1**: `action` (Ascending)
- **Field 2**: `timestamp` (Descending)
- **Scope**: Collection

---

## Why these are needed:
Without these indexes, Firestore will fail complex queries with an error containing a link to generate the index. Pre-emptively adding them prevents production downtime and ensures the new optimized backend routes function at peak speed.
