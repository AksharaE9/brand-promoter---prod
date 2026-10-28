# TalentOS ATS — Recruit AI / HireIQ Integration Guide

**Integration Platform:** Recruit AI / HireIQ Voice Interviewer  
**Inbound Webhook Endpoint:** `POST https://brandpromoter-backend.onrender.com/api/v1/integrations/recruit-ai/webhook`  
**Outbound Schedule Endpoint:** `POST https://187.127.137.103/api/integrations/talentos/schedule`  
**Authentication Header:** `x-api-key: <RECRUITAI_API_KEY>`  
**Security Standard:** HMAC-SHA256 Signatures, Timing-safe verification, Idempotent deduplication

---

## 1. Integration Architecture

The integration between **TalentOS** and **Recruit AI / HireIQ** functions in two bidirectional workflows:

1. **Outbound Schedule Dispatch (TalentOS &rarr; Recruit AI):**  
   When a recruiter books or reschedules an interview in TalentOS, TalentOS dispatches the candidate profile, role, round, and scheduled slot to Recruit AI's schedule endpoint.

2. **Inbound Assessment Results (Recruit AI &rarr; TalentOS):**  
   Once the candidate completes their voice interview on Recruit AI, Recruit AI delivers the AI assessment result (scores, rating out of 10, recommendation, competencies, summary, and recording URL) to TalentOS via webhook.

3. **Reconciliation Polling Backstop:**  
   TalentOS runs a background reconciliation job every 15 minutes with a 10-minute overlap window to automatically pull any results if a webhook delivery was interrupted.

4. **Human Decision Gate (Review Queue):**  
   AI results inform; humans decide. Results arrive in the review queue with `reviewStatus: "pending_review"`. Recruiters review the AI card and confirm the outcome (*Selected*, *Rejected*, *On Hold*).

---

## 2. Outbound Schedule Dispatch (TalentOS &rarr; Recruit AI)

**Endpoint:** `POST https://187.127.137.103/api/integrations/talentos/schedule`  
*(Or local test: `POST http://localhost:5000/api/integrations/talentos/schedule`)*  
**Header:** `x-api-key: <RECRUITAI_API_KEY>`

### Payload Schema:
```json
{
  "event": "interview.scheduled",
  "externalReference": "cmvqbje7d005rtbqoy2wvmg7c",
  "interviewId": "cmvqbje7d005rtbqoy2wvmg7c",
  "candidate": {
    "id": "cmvqbje7d005rtbqoy2wvmg7a",
    "name": "Uzma Parveen",
    "email": "uzma@example.com",
    "phone": "+919876543210"
  },
  "role": "Data Analyst Intern",
  "round": {
    "number": 1,
    "label": "Round 1"
  },
  "schedule": {
    "startsAt": "2026-10-28T14:30:00.000Z",
    "durationMinutes": 30,
    "mode": "ONLINE",
    "meetingLink": "https://meet.zoho.in/abc-xyz"
  },
  "dispatchedAt": "2026-10-28T09:00:00.000Z"
}
```

---

## 3. Inbound Results Webhook (Recruit AI &rarr; TalentOS)

**Endpoint:** `POST https://brandpromoter-backend.onrender.com/api/v1/integrations/recruit-ai/webhook`  
**Headers:**
- `Content-Type: application/json`
- `X-RecruitAI-Signature: sha256=<HMAC-SHA256>` *(optional, verified if `RECRUITAI_WEBHOOK_SECRET` is set)*
- `X-Event-ID: evt_...` *(optional, for deduplication)*

### Payload Schema:
```json
{
  "provider": "recruit_ai",
  "providerResultId": "rec_res_100234",
  "externalReference": "cmvqbje7d005rtbqoy2wvmg7c",
  "candidate": {
    "name": "Uzma Parveen",
    "email": "uzma@example.com",
    "phone": "+919876543210"
  },
  "status": "completed",
  "score": {
    "raw": 84,
    "scaleMax": 100
  },
  "recommendation": "strong_hire",
  "competencyScores": {
    "communication": 8.5,
    "analyticalThinking": 8.2,
    "roleKnowledge": 8.8
  },
  "summary": "Candidate demonstrated exceptional domain understanding and articulate problem-solving.",
  "integrityFlags": [
    { "type": "tab_switch", "count": 1 }
  ],
  "recordingUrl": "https://187.127.137.103/recordings/int_100234.mp4",
  "completedAt": "2026-10-28T14:45:00+05:30"
}
```

### Success Response (200 OK):
```json
{
  "success": true,
  "eventId": "rec_res_100234",
  "action": "created",
  "resultId": "cmvrwzef50001tblkh0whjmil",
  "matched": true
}
```

---

## 4. Candidate Matching Hierarchy

TalentOS resolves candidate identity through a strict 4-tier hierarchy:

1. **Tier 1: `externalReference`** (TalentOS `interviewId` or `candidateId`). Direct exact match.
2. **Tier 2: Genuine Email**. Normalised, non-placeholder (`dummy@...`, `test@...` rejected), matching exactly one active candidate.
3. **Tier 3: Verified Phone**. Normalised 10-digit number, non-placeholder, matching exactly one active candidate.
4. **Tier 4: Unmatched Queue**. If unresolved or ambiguous, the result is placed in the Unmatched Queue for recruiter review. **Names are never used for automated matching.**

---

## 5. Recruiter Review & Decision Workflow

1. **Review Queue**: `GET /api/v1/integrations/recruit-ai/review-queue`
2. **Confirm Outcome**:
   ```http
   POST /api/v1/integrations/recruit-ai/confirm-outcome
   Content-Type: application/json
   
   {
     "resultId": "cmvrwzef50001tblkh0whjmil",
     "outcome": "SELECTED",
     "notes": "Strong technical foundation verified by AI interview."
   }
   ```
3. **Relink Unmatched Result**:
   ```http
   POST /api/v1/integrations/recruit-ai/relink
   Content-Type: application/json
   
   {
     "resultId": "cmvrwzfmv0003tblk7kq341lv",
     "candidateId": "cand_xyz",
     "interviewRoundId": "int_abc"
   }
   ```
