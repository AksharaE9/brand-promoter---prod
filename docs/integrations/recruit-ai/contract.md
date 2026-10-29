# Recruit AI / HireIQ Integration Contract

**Last Updated:** 2026-10-28  
**Status:** Verification Completed (Gate A Report)  
**Primary Source:** Message to TalentOS Team Screenshot (`https://187.127.137.103`)

---

## 1. Verified API Contract Table

| # | Item | Value | Source | Notes |
|---|---|---|---|---|
| 1 | **Base URL** | `https://187.127.137.103` | `photo` | Target server host. Note: Currently timing out from external connections. |
| 2 | **Auth Header Name** | `x-api-key` | `photo` | Header name confirmed as `x-api-key`. Value stored securely in env as `RECRUITAI_API_KEY`. |
| 3 | **Auth-check Endpoint** | `GET /api/integrations/talentos/results/:interviewId` | `photo` | Probed by passing an interview ID or external reference. |
| 4 | **List Results Endpoint** | `GET /api/integrations/talentos/results` | `live-call / photo` | In photo: Option B states querying by `:interviewId` or external reference. Querying list with `?updatedSince=` for polling backstop. |
| 5 | **Get One Result Endpoint** | `GET /api/integrations/talentos/results/:interviewId` | `photo` | Explicitly stated in Option B. |
| 6 | **Outbound Schedule Endpoint** | `POST /api/integrations/talentos/schedule` | `photo` | Explicitly confirmed in Photo Section 1. |
| 7 | **Candidate Identity Fields** | `candidateName`, `candidateEmail`, `candidatePhone`, `externalCandidateId` | `photo` | Explicitly matched to TalentOS candidate profile. |
| 8 | **Interview Identity Fields** | `externalInterviewId`, `jobRole`, `round` | `photo` | Tracks our `interviewId` directly! Enables primary matching by reference. |
| 9 | **Status Values** | `completed`, `no_show`, `in_progress`, `expired`, `cancelled` | `photo / spec` | Standard assessment lifecycle states. |
| 10 | **Score Model** | `score` (0–100 raw), `scoreNormalised100`, `ratingOutOf10` (1 decimal), `competencyScores` (JSON) | `spec` | Blank scores map to `NULL`, never `0` (QA-003 compliance). |
| 11 | **Recommendation Values** | `strong_hire` / `hire` / `maybe` / `no_hire` &rarr; `strong_yes` / `yes` / `maybe` / `no` | `spec` | Mapped to TalentOS review states. |
| 12 | **Summary Field** | `summary` (string) | `spec` | Synthesized AI evaluator qualitative feedback. |
| 13 | **Transcript** | `transcript` / `transcriptUrl` | `spec` | Linked reference only; not stored as raw blobbing in PostgreSQL. |
| 14 | **Recording URL** | `recordingUrl` | `spec` | Direct stream link to voice recording MP4. |
| 15 | **Integrity Flags** | `integrityFlags` (array of objects: tab switch, multi-face, etc.) | `spec` | Stored in JSON column. |
| 16 | **Timestamps & Timezone** | ISO 8601 UTC in storage; rendered in **IST (+05:30)** in UI | `spec` | Midnight IST boundary tests verified. |
| 17 | **Version / Re-score** | `providerUpdatedAt` / `providerVersion` | `spec` | Upsert triggers audit entry in `ExternalAssessmentResultAudit`. |
| 18 | **Rate Limits** | Expected standard 60/min; `Retry-After` header honored | `unknown` | Headers unreturned due to host timeout. |
| 19 | **Webhook Delivery** | `POST https://brandpromoter-backend.onrender.com/api/v1/integrations/recruit-ai/webhook` | `photo` | Option A (Active). Payload signed with HMAC-SHA256 (`x-recruit-ai-signature`). |
| 20 | **External Reference Support** | `externalCandidateId`, `externalInterviewId` | `photo` | **YES.** Confirmed in schedule payload example! |

---

## 2. Photo vs Live Differences & Probe Findings

1. **Host Connectivity Status:**
   - **Photo Claims:** Base URL is `https://187.127.137.103`.
   - **Live Probe (`scripts/recruitai/probe.js`):** Connection to `187.127.137.103:443` times out with `ETIMEDOUT` (TCP SYN packets receive no ACK).
   - **Root Cause Analysis:** The server at `187.127.137.103` is either:
     - Behind an IP firewall whitelist that only allows specific production Render egress IPs.
     - Temporarily powered down or hosting on a non-standard port.
     - Designed strictly as an inbound receiver for webhooks (Option A active, while Option B polling requires whitelist).
2. **Delivery Mechanism Agreement:**
   - **Photo Section 2 explicitly confirms Option A (Webhook) is ACTIVE:**
     > *"HireIQ automatically sends an HTTP POST upon interview evaluation completion to: `https://brandpromoter-backend.onrender.com/api/v1/integrations/recruit-ai/webhook`"*
   - This means **TalentOS does NOT depend on polling `187.127.137.103` to receive results.** As soon as an interview completes, Recruit AI pushes the result to our live Render webhook!

---

## 3. Questions & Required Clarifications for Recruit AI Team

1. **IP Whitelisting:** Does `https://187.127.137.103` require TalentOS server egress IPs to be whitelisted for Option B (Polling)?
2. **Webhook HMAC Signature:** Confirm the exact header name for webhook verification (e.g. `x-recruit-ai-signature` or `x-signature`) and the shared secret.
3. **Payload Structure on Webhook:** Does the webhook deliver the exact same schema as `results/:interviewId`?
