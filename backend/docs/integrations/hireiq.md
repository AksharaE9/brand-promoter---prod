# TalentOS ATS — HireIQ Integration Guide

**Integration Partner:** HireIQ  
**Base URL:** `https://brandpromoter-backend.onrender.com/api/v1/ext`  
**Authentication Header:** `x-api-key: <key>` *(case-insensitive header)* or `Authorization: Bearer <key>`  
**Timezone Standard:** All dates and times are in **Indian Standard Time (IST, UTC+05:30)**  
**Protocol Requirement:** HTTPS only (plain HTTP is rejected)  
**Access Model:** Scoped, read-only, non-expiring/renewable token bucket (60 requests/minute)

---

## 1. Authentication & Security

TalentOS authenticates HireIQ using a dedicated, cryptographically hashed API key.

- Pass the key in either header:
  ```http
  x-api-key: tos_live_...
  ```
  or
  ```http
  Authorization: Bearer tos_live_...
  ```
- **Do not pass API keys in query parameters** (e.g. `?api_key=...` is rejected with `400 INVALID_PARAMETER`).
- Keys are strictly isolated to the `/api/v1/ext/*` namespace. They have no write privileges, cannot access internal user routes, and do not bypass session or role guards.

### Required Scopes for HireIQ
| Scope | Purpose |
|---|---|
| `interviews:read` | Fetch scheduled interview rounds, slots, panelists, and outcomes |
| `candidates:read` | Fetch candidate profile dossier and historical application rounds |
| `candidates:read:pii` | Receive real candidate emails (without this scope, email returns `null`) |
| `resumes:read` | Download or stream original resume files (PDF/DOCX/image) |

---

## 2. Endpoints Reference

### 2.1 — Connectivity Check: `GET /api/v1/ext/me`
Use this endpoint to verify authentication, view granted scopes, and check key expiration.

**Request:**
```bash
curl -s "https://brandpromoter-backend.onrender.com/api/v1/ext/me" \
  -H "x-api-key: $HIREIQ_API_KEY"
```

**Response (200 OK):**
```json
{
  "data": {
    "keyId": "cmv...",
    "name": "HireIQ – production",
    "prefix": "tos_live_f89b...",
    "scopes": [
      "interviews:read",
      "candidates:read",
      "candidates:read:pii",
      "resumes:read"
    ],
    "environment": "live",
    "rateLimitPerMinute": 60,
    "expiresAt": "2027-01-26T08:00:00.000Z"
  },
  "meta": {
    "requestId": "req_be_7fa83d2..."
  }
}
```

---

### 2.2 — Main Feed: `GET /api/v1/ext/interviews`
Fetches all scheduled interview rounds. Supports date filtering, round selection, role filtering, and change polling.

#### Query Parameters
| Parameter | Type | Default | Description |
|---|---|---|---|
| `from` | string | Today (IST) | Scheduled start date range `YYYY-MM-DD` |
| `to` | string | Today + 14d (IST) | Scheduled end date range `YYYY-MM-DD` |
| `status` | string | `scheduled` | Filter: `scheduled` (default), `completed`, `cancelled`, or `all` |
| `round` | integer | (all) | Filter by round number (e.g. `1`, `2`) |
| `role` | string | (all) | Match job ID or free-text role (e.g. `Data Analyst`, `Operations`) |
| `updatedSince` | string (ISO 8601) | (none) | **Recommended for Polling**: Returns interviews created, changed, or cancelled since this timestamp |
| `cursor` | string | (none) | Keyset pagination cursor from previous page |
| `limit` | integer | `50` | Maximum records per page (1 to 100) |

#### Exact Response DTO
```json
{
  "data": [
    {
      "interviewId": "cmvqbje7d005rtbqoy2wvmg7c",
      "candidate": {
        "id": "cmvqbje7d005rtbqoy2wvmg7a",
        "name": "Uzma Parveen",
        "email": "uzma@example.com",
        "emailStatus": "valid"
      },
      "role": {
        "interviewRole": "Data Analyst Intern",
        "appliedRole": "Data Analyst Intern",
        "jobId": "cmvqbje7d005rtbqoy2wvmg7b"
      },
      "round": {
        "number": 1,
        "label": "Round 1"
      },
      "schedule": {
        "date": "2026-10-07",
        "startTime": "14:30",
        "endTime": "15:00",
        "durationMinutes": 30,
        "slot": "Slot 1",
        "timezone": "Asia/Kolkata",
        "startsAt": "2026-10-07T14:30:00+05:30",
        "endsAt": "2026-10-07T15:00:00+05:30",
        "mode": "ONLINE",
        "meetingLink": "https://meet.zoho.in/abc-xyz"
      },
      "interviewers": [
        "Praneel"
      ],
      "status": "scheduled",
      "resume": {
        "status": "available",
        "fileName": "uzma-parveen-resume.pdf",
        "mimeType": "application/pdf",
        "downloadUrl": "https://brandpromoter-backend.onrender.com/api/v1/ext/candidates/cmvqbje7d005rtbqoy2wvmg7a/resume",
        "externalUrl": null,
        "isSharedFolder": false
      },
      "updatedAt": "2026-10-06T18:44:00+05:30"
    }
  ],
  "page": {
    "nextCursor": "MjAyNi0xMC0wNl...",
    "limit": 50
  },
  "meta": {
    "requestId": "req_be_90a72..."
  }
}
```

---

### 2.3 — Single Interview: `GET /api/v1/ext/interviews/{interviewId}`
Fetches a single interview round using the exact same response schema as above.

---

### 2.4 — Candidate Dossier: `GET /api/v1/ext/candidates/{candidateId}`
Fetches the candidate's core profile and all evaluation rounds.

---

### 2.5 — Resume Download: `GET /api/v1/ext/candidates/{candidateId}/resume`
Streams the binary resume file (PDF, DOCX, JPG/PNG) directly from storage.

**Headers returned on success (200 OK):**
```http
Content-Type: application/pdf
Content-Disposition: attachment; filename="Candidate_Name_resume.pdf"
Cache-Control: private, max-age=300
```

**If file is external link (302 Redirect):**
HireIQ is redirected directly to the external cloud URL.

**If file is missing (404 Not Found):**
```json
{
  "success": false,
  "code": "RESUME_FILE_MISSING",
  "message": "The candidate does not have a readable resume file in storage.",
  "error": {
    "code": "RESUME_FILE_MISSING",
    "message": "Resume file not found in storage for this candidate.",
    "requestId": "req_be_..."
  }
}
```

---

## 3. Field Handling & Business Rules

1. **Candidate Name:** Trimmed as stored in ATS.
2. **Candidate Email & Status:**
   - `emailStatus: "valid"`: Genuine, RFC 5322 formatted email address.
   - `emailStatus: "placeholder"`: Dummy emails (e.g. `dummy@gmail.com`, `test@...`). The `email` field will be `null`.
   - `emailStatus: "missing"`: Candidate was registered without an email. The `email` field will be `null`.
   - `emailStatus: "invalid"`: Malformed string without `@`. The `email` field will be `null`.
   *(Note: If the API key does not have `candidates:read:pii` scope, `email` is always `null` with `emailStatus: "valid"`).*
3. **Role:** Both `interviewRole` (role assigned to the round) and `appliedRole` (original role candidate applied for) are provided.
4. **Timezone & Slot:**
   - All `startsAt` and `endsAt` strings contain explicit `+05:30` offsets.
   - Slot numbers represent booking buckets (e.g. `Slot 1`, `Slot 2`).
5. **Interviewers:** Strictly returns display names (e.g. `["Praneel"]`). No internal user emails or internal database IDs are leaked.
6. **Resume Status:**
   - `"available"`: Resume binary exists in storage; use `downloadUrl`.
   - `"external_link"`: Resume is hosted externally (e.g. Google Drive); use `externalUrl`.
   - `"file_missing"`: Record exists but binary data is absent; both URLs are `null`.
   - `"none"`: Candidate has no resume attached; both URLs are `null`.
   - `isSharedFolder`: `true` if the link points to a batch drive folder rather than an individual document.

---

## 4. Polling Best Practices

To keep HireIQ in sync with TalentOS without missing cancellations:
1. Poll every **5 minutes** using:
   ```http
   GET /api/v1/ext/interviews?updatedSince=2026-10-28T12:00:00+05:30
   ```
2. Follow `page.nextCursor` until `data` array is empty or `nextCursor` is `null`.
3. Save the timestamp of the sync request for the subsequent poll.
4. Interviews that were cancelled or rescheduled will be included in the `updatedSince` query with `status: "cancelled"` or `status: "rescheduled"`.

---

## 5. Rate Limits & Error Handling

- **Rate Limit:** 60 requests per minute per API key.
- When exceeded, TalentOS returns `429 RATE_LIMITED` with a `Retry-After: <seconds>` header.
- Standard Error Response format:
  ```json
  {
    "success": false,
    "code": "API_KEY_EXPIRED",
    "message": "API key has expired",
    "error": {
      "code": "API_KEY_EXPIRED",
      "message": "API key has expired",
      "requestId": "req_be_39af8b2..."
    }
  }
  ```

| HTTP Status | Error Code | Meaning |
|---|---|---|
| `401` | `API_KEY_MISSING` | Header missing `x-api-key` or `Authorization` |
| `401` | `API_KEY_INVALID` | Unknown key or invalid format |
| `401` | `API_KEY_REVOKED` | Key was revoked by administrator |
| `401` | `API_KEY_EXPIRED` | 90-day validity period has ended |
| `403` | `API_KEY_INSUFFICIENT_SCOPE` | Missing required permission for endpoint |
| `400` | `INVALID_PARAMETER` | Query parameter error or key in query string |
| `404` | `RESUME_FILE_MISSING` | Candidate has no readable resume file |
| `429` | `RATE_LIMITED` | Exceeded 60 requests/minute |
| `500` | `INTERNAL_ERROR` | Internal server exception |
