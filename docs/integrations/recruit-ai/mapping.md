# TalentOS &rarr; Recruit AI / HireIQ Field Mapping & Normalization Specification

**Specification Version:** 2.0  
**Compliance Standards:** QA-002, QA-003, QA-004, Master QA Catalogue Area N

---

## 1. Field Mapping Table (Recruit AI &rarr; TalentOS)

| Recruit AI Field (Exact Path) | TalentOS Model Field | Data Type | Transformation / Normalisation Rule | Example Value |
|---|---|---|---|---|
| `providerResultId` | `ExternalAssessmentResult.providerResultId` | String | Trimmed string. Unique per provider (`recruit_ai`). | `"rec_res_948210"` |
| `externalInterviewId` | `ExternalAssessmentResult.externalReference` | String | Maps to TalentOS `Interview.id`. Primary match key. | `"cmvqbje7d005rtbqoy2wvmg7c"` |
| `externalCandidateId` | `ExternalAssessmentResult.externalCandidateId` | String | Maps to TalentOS `Candidate.id`. | `"cmvqbje7d005rtbqoy2wvmg7a"` |
| `candidate.email` | `ExternalAssessmentResult.matchedCandidate` | String | Trimmed, lowercased. Secondary match key. Placeholder contacts rejected. | `"candidate@example.com"` |
| `candidate.phone` | `ExternalAssessmentResult.matchedCandidate` | String | Cleaned to E.164 `+91XXXXXXXXXX`. Tertiary match key. | `"+919876543210"` |
| `status` | `ExternalAssessmentResult.status` | Enum | `completed`, `no_show`, `in_progress`, `expired`, `cancelled`. Unseen &rarr; `unknown`. | `"completed"` |
| `score.raw` | `ExternalAssessmentResult.scoreRaw` | Float / Int | Raw numeric score. **Blank &rarr; NULL, never 0 (QA-003).** | `85` |
| `score.scaleMax` | `ExternalAssessmentResult.scoreScaleMax` | Float / Int | Scale maximum (default: 100). | `100` |
| Calculated | `ExternalAssessmentResult.scoreNormalised100` | Float | `(scoreRaw / scaleMax) * 100`. Round to 1 decimal. | `85.0` |
| Calculated | `ExternalAssessmentResult.ratingOutOf10` | Float | `(scoreRaw / scaleMax) * 10`. Formatted to 1 decimal. | `8.5` |
| `recommendation` | `ExternalAssessmentResult.recommendationNormalised` | Enum | `strong_hire` &rarr; `strong_yes`<br>`hire` &rarr; `yes`<br>`maybe` &rarr; `maybe`<br>`no_hire` &rarr; `no` | `"yes"` |
| `competencyScores` | `ExternalAssessmentResult.competencyScores` | JSON | Stored as structured key-value object. | `{"communication": 8.5}` |
| `summary` | `ExternalAssessmentResult.summary` | Text | Qualitative evaluator commentary. Empty &rarr; NULL. | `"Strong technical knowledge"` |
| `integrityFlags` | `ExternalAssessmentResult.integrityFlags` | JSON | Array of flagged proctoring events. | `[{"type": "tab_switch", "count": 1}]` |
| `recordingUrl` | `ExternalAssessmentResult.recordingUrl` | String | Permanent/expiring MP4 URL link only. | `"https://storage.recruitai.com/..."` |
| `completedAt` | `ExternalAssessmentResult.completedAt` | DateTime (UTC) | Parsed to UTC DateTime; rendered in **IST (+05:30)** in UI. | `2026-10-28T09:15:00.000Z` |
| `payload` (Full) | `ExternalAssessmentResult.rawPayload` | JSON | Stored in raw payload column for auditability. | `{...}` |

---

## 2. Normalisation Rules & Edge-Case Guards

### 2.1 — Blank to NULL Guard (QA-003 Compliance)
- If `score.raw` is missing, `""`, `null`, `"NA"`, or `"-"`, it MUST resolve to database `NULL`.
- It MUST NEVER be converted to `0`, which would falsely represent a total failure rating.

### 2.2 — Matching Precedence (Never Match by Name)
1. **External Reference (`externalInterviewId` / `externalCandidateId`):** Exact reference match.
2. **Email Match:** Valid if exactly one candidate has this email, and it is not a placeholder (`dummy@`, `test@`, `na@`).
3. **Phone Match:** Valid if exactly one candidate has this normalized phone, and not in placeholder range (`0000000000`, `9999999999`).
4. **Conflicting Match:** If email points to Candidate A and phone points to Candidate B &rarr; **Route to UNMATCHED Queue** with reason `conflicting_identity`.
5. **No Blind Creation:** An incoming assessment result NEVER creates a new Candidate.

### 2.3 — Outcome Decoupling (AI Informs; Humans Decide)
- Results are saved with `reviewStatus: "pending_review"`.
- The ATS interview outcome remains unchanged until an authorized recruiter clicks **Confirm Outcome** or executes **Bulk Confirm** in the review queue.
- Human evaluator scores and feedback are preserved in separate columns and NEVER overwritten by AI results.

### 2.4 — IST Timezone Boundary Protection
- Timestamps without explicit timezone offsets are parsed with UTC assumptions or logged with warnings.
- An interview completed at `23:30 IST` on October 28 MUST display as October 28 in all recruiter views, avoiding UTC midnight day-shift bugs.
