# TalentOS (ATS) User Guide

Welcome to the TalentOS Applicant Tracking System (ATS) User Guide. This manual is designed for recruiters, interviewers, schedulers, and hiring managers. It provides step-by-step instructions for performing all core talent acquisition operations, along with clear success indicators and troubleshooting guidance.

---

## 1. Purpose and Who This Guide Is For

This guide serves as an operational manual alongside our Recruitment Operations Standard Operating Procedures (SOP). It covers daily recruitment workflows within TalentOS:

- **Recruiters**: Managing candidates, sourcing, tracking applications, and issuing offer letters.
- **Schedulers / Talent Operations**: Booking interview slots, assigning interview panels, and managing calendar availability.
- **Interviewers / Hiring Managers**: Reviewing candidate profiles, recording interview assessments, and providing selection feedback.

All step-by-step instructions utilize exact screen names, field labels, and button text directly from the TalentOS software.

---

## 2. Getting In and Finding Your Way Around

### Logging In & Navigation
1. Open your web browser and navigate to the ATS application URL (e.g. `https://your-ats-domain.vercel.app/login`).
2. Enter your credentials on the `LoginPage` and click `Sign In`.
3. Upon successful login, you will land on the primary navigation interface. The left navigation bar allows access to key modules:
   - `Dashboard` (`/dashboard`): High-level overview of daily interviews, pending feedback, and hiring statistics.
   - `Candidates` (`/candidates`): Master database of all candidate profiles, resumes, and contact info.
   - `Interview Schedule` (`/schedule` or `/scheduling`): Calendar grid and timetable for booking and tracking interviews.
   - `Jobs` (`/jobs`): Active job openings, requisitions, and pipeline stages.
   - `Drives` (`/drives`): College campus drives and walk-in hiring event management.
   - `Posted` (`/posted`): Posted job files and bulk candidate uploads.
   - `Sourcing` (`/sourcing`) & `Referrals` (`/referrals`): Candidate sourcing channels.

### Roles & Permissions (In Plain English)
TalentOS uses role-based access control to protect data security while enabling collaboration:

| Role | Permissions & Access |
| :--- | :--- |
| `SUPER_ADMIN` | Complete access across all modules, analytics, system reports, audit logs, team user management, and workspace settings. |
| `RECRUITER` | Full operational access to create candidate profiles, schedule interviews, submit feedback, issue offer letters, and manage job requisitions. |
| `INTERVIEWER` | Focused access to view assigned candidates, conduct interview sessions, and submit evaluation feedback forms. |
| `USER` | Standard operational access to view candidate pipelines and participate in assigned recruitment tasks. |

---

## 3. Core Recruitment Workflows

---

### Workflow A: Create a Candidate Profile

How to reach the screen, enter candidate details, detect duplicates, attach documents, and save the record.

#### Step-by-Step Instructions:
1. Navigate to the `Candidates` page (`/candidates`) from the left navigation bar. (You can also perform candidate entry inside `College Drives` at `/drives`).
2. Click the blue button labeled `+ Add Candidate` (or `Create Candidate`) in the top right header.
3. The `Create New Candidate` modal window will appear on screen.
4. Fill out candidate details:
   - **`Full Name *`** *(Required)*: Type the candidate's full legal name (e.g., `John Doe`).
     > **Duplicate Check Feature**: As you type 2 or more characters into `Full Name *`, TalentOS performs a live search across existing candidates. If matches are found, a dropdown labeled `Existing Profiles Found` will pop up. Click any match to view or edit their existing profile (a blue notice `Editing existing candidate: [Name]` will appear with a `Create New Instead` button if you wish to un-link).
   - **`Phone Number *`** *(Required)*: Enter the candidate's primary phone number (e.g., `+91 98765 43210`). The backend checks phone uniqueness across the organization.
   - **`Resume / Profile Document`** *(Required for new candidates)*: Click the upload box labeled `Click to upload PDF or Word document (required)`. Select a file from your computer (`.pdf`, `.doc`, or `.docx` formats allowed, up to 10MB).
   - **`Email Address`** *(Optional)*: Enter the candidate's e-mail (e.g., `john@example.com`).
   - **`Current Course`** *(Optional)*: Enter degree/course (e.g., `B.Tech CSE`).
   - **`Location`** *(Optional)*: Enter city/state (e.g., `Bangalore, KA`).
   - **`Preferred Role`** *(Optional)*: Enter target job title (e.g., `Frontend Developer`).
   - **`Company`** *(Optional)*: Select or type the target company (defaults to `Akshara Enterprises`).
   - **`Source`** *(Optional)*: Enter sourcing origin (e.g., `LinkedIn`, `Referral`, `Direct`).
5. Click the primary button labeled `Create Candidate` (or `Save & Join` if updating an existing record).
6. To exit without saving, click `Cancel` or the close icon `close` at the top right.

#### You'll know it worked when…
The modal window automatically closes, a success notification toast appears, and the new candidate immediately appears at the top of the candidate table on `/candidates`. You can click their name link to open their dedicated profile page (`/candidate/:id`).

#### If it goes wrong:
If submission fails with the message `A candidate with this phone number already exists`, a candidate profile already exists with that phone number. Search for the candidate's phone number on the `/candidates` page or select them from the `Existing Profiles Found` autocomplete list.

---

### Workflow B: Schedule an Interview

How to select a candidate, assign a job requisition, select date and time, allocate panel interviewers, and manage slot limits.

#### Step-by-Step Instructions:
1. Navigate to the `Interview Schedule` page (`/schedule` or `/scheduling`) from the navigation sidebar.
2. Click the primary action button labeled `Schedule Interview`.
3. The `Schedule Interview` modal window will open.
4. Complete the required scheduling fields:
   - **`Candidate`** *(Required)*: Click `Select or search candidate...` and type candidate name or phone. Select the candidate from the suggestions list. (The candidate's phone number will display underneath as `Phone: ...`).
   - **`Job Role`** *(Required)*: Click `Select or search job...` and select the target job requisition.
   - **`Interview Round`**: Select round from dropdown: `Round 1`, `Round 2`, or `Final Round`. (TalentOS automatically auto-populates the next logical round based on completed evaluations).
   - **`Meeting Mode`** *(Required)*: Choose meeting type from dropdown: `Online Meeting`, `In Person`, `Phone Call`, `Drive Meeting`, or `Walk-in Drive`.
   - **`Interviewers (Multiple)`** *(Required for non-walk-in modes)*: Scroll through the interviewer checklist (or use the `Filter...` box) and check the box next to each panelist assigned to conduct the round (e.g. `Jane Doe (INTERVIEWER)`).
   - **`Start Date & Time`** *(Required)*:
     - Use the date input picker (`DD/MM/YYYY`) to set the interview date.
     - Use the time input picker (`HH:mm`) to set the interview start time.
     > **Slot Limit Check**: TalentOS automatically checks hourly capacity (max 7 interviews per hour). Below the time picker, a slot badge displays e.g., `Slot 1 — first booking for this time slot` or `Slot 2 — 1 other interview already in this hour`.
   - **`Meeting Link`** *(Optional)*: Paste meeting URL (e.g. Google Meet or Zoom link).
   - **`Zoho Link`** *(Optional)*: Paste Zoho Meeting URL if applicable.
   - **Follow-up Attachments** *(Optional)*: Recruiters/admins can attach `.pdf`, `.png`, or `.jpg` documents under `Add phone`, `Add email`, or `Add morning` follow-up fields.
5. Review any warning banners:
   - If prior round feedback has not been recorded, an amber notice will appear: `Round 1 feedback hasn't been submitted yet. You can still schedule Round 2.` (You may dismiss this notice by clicking `close`).
6. Click the button labeled `Confirm Schedule`.

#### You'll know it worked when…
The modal window closes and the newly scheduled interview session appears on the calendar grid under `/schedule`, reflecting the assigned candidate, round, time slot, and interviewer panel.

#### If it goes wrong:
If the `Confirm Schedule` button is disabled and displays `Slot Full` alongside a red message `Slot limit exceeded — 7 interviews already booked for this hour (max 7)`, the chosen hour has reached capacity. Change the `Start Date & Time` to a different time slot or date.

---

### Workflow C: Record Interview Feedback

Where evaluation forms live, mandatory fields for Round 1 vs Round 2/Final Round, setting decisions, and verifying submission.

#### Step-by-Step Instructions:
1. Access the feedback evaluation form using either of two methods:
   - **Method 1**: On `/schedule`, locate the interview card and click `Feedback`.
   - **Method 2**: Go to `/candidate/:id` for the candidate and select the `Feedback` tab.
2. The `Interview Assessment Form` header will display for the target round (e.g. `Interview Assessment Form — Round 1`).
3. Complete the required evaluation fields marked with a red asterisk (`*`):

   **For Round 1 Assessments:**
   - **`Name *`**: Pre-filled candidate full name.
   - **`Round Number *`**: Read-only indicator (`Round 1`).
   - **`Panelists *`**: Enter panel interviewer names.
   - **`Role *`**: Target job role.
   - **`Overall Rating *`**: Enter rating between `0` and `10` (e.g. `8.5`).
   - **`DOJ *`**: Select expected Date of Joining using date picker.
   - **`Timings *`**: Work shift / timing preferences (e.g. `9 AM - 6 PM`).
   - **`Duration *`**: Interview duration (e.g. `45 mins`).
   - **`Selection Status *`**: Choose evaluation outcome from dropdown:
     - `SELECTED` — Candidate passed round.
     - `OFFER_LETTER` — Candidate selected & ready for offer letter.
     - `ON_HOLD` — Candidate placed on hold.
     - `DIDNT_JOIN` — Candidate declined / did not join.
     - `REJECTED` — Candidate rejected.
   - **`Comments (Reason for Selection/Reject)`**: Text details on strengths/concerns.
   - *Optional Fields*: `Number` (phone lookup), `Course`, `Family`, `College`, `Languages Known`, `Prior Experience / About It`, `Project(s)`, `Location`, `Area`.

   **For Round 2 & Final Round Assessments:**
   - **`Name *`**, **`Panelists *`**, **`Overall Rating *`** (`/10`), **`Timings *`**, **`Duration *`**, **`Status *`** (dropdown selection status), and optional **`Mock Rating`** (`/10`) or **`Comments`**.

4. Optional Helper Tool: Click `Copy Feedback` at top right or bottom to copy a clean plain-text summary of all responses to your clipboard for external sharing.
5. Click the primary button labeled `Submit Feedback`.

#### You'll know it worked when…
The form header updates to `Editing Submitted Assessment — [Round]`, a green badge labeled `Submitted ✓` appears next to the title, and the feedback submission is saved on the profile under the Feedback tab.

#### If it goes wrong:
If validation fails, an amber error box will appear above the form stating `Please correct the following fields:` followed by specific missing requirements (e.g., `"Overall Rating" is required.` or `"Overall Rating" must be between 0 and 10.`). Fill out all highlighted fields and click `Submit Feedback` again.

---

### Workflow D: Issue an Offer Letter

How to enter offer details (role, compensation/timings, joining date, conditions), issue the letter, attach documents, and verify profile recording.

#### Step-by-Step Instructions:

**Method 1: Individual Offer Issuance (via Assessment Form)**
1. Open the Candidate Assessment Form on `/schedule` or `/candidate/:id`.
2. In the status dropdown (`Selection Status *` or `Status *`), select **`OFFER_LETTER`**.
3. Selecting `OFFER_LETTER` automatically expands two mandatory file attachment fields at the bottom of the form:
   - **`Offer Letter Document *`**: Click `Add Offer Letter Document` and attach the formal signed offer document (`.pdf`, `.docx`, `.png`, `.jpg`).
   - **`Offer Letter Email Attachment *`**: Click `Add Offer Letter Email Attachment` and attach the email confirmation artifact (`.pdf`, `.png`, `.jpg`).
4. Ensure all offer terms are entered in the form:
   - **`Role *`**: Agreed job title.
   - **`DOJ *`**: Confirmed Date of Joining.
   - **`Timings *`** & **`Duration *`**: Working hours and contract duration.
   - **`Comments`**: Salary/compensation notes and onboarding conditions.
5. Click `Submit Feedback`.

**Method 2: Bulk Offer Letter Import**
1. Navigate to `Posted` (`/posted`) or `Sourcing` (`/sourcing`).
2. Click `Download Template` to obtain the official `offer_letter_bulk_upload_template.xlsx` spreadsheet.
3. Fill in candidate offer columns: `Name *`, `Phone Number *`, `E-Mail`, `Role`, `Offer Date`, `Offer Decision`, `College`, `Location`, `Course`, `Source`, `Company`.
4. Upload the spreadsheet using the Bulk Upload file launcher.

#### You'll know it worked when…
The candidate's status pill across TalentOS updates to **`OFFER_SENT`**, and both the offer letter document and email attachment appear in the candidate's profile document list.

#### If it goes wrong:
If submission is rejected with the message `Offer letter document is required when status is OFFER_LETTER`, ensure you attached both required file upload fields (`Offer Letter Document` and `Offer Letter Email Attachment`) before clicking `Submit Feedback`.

---

## 4. Confirming Your Work Saved (Edge Case Verification)

### 1. File Uploads & Attachment Persistence
- **Current Behavior**: Resumes, offer letters, and follow-up attachments are stored directly in our Neon Postgres Database (`FileMeta` binary storage `db://<id>`).
- **User Guidance**: Uploaded files do **NOT** live on temporary server disk space. Server restarts or Render redeployments will **never** wipe candidate resumes or offer documents. To confirm an attachment persisted:
  1. Open the Candidate Profile (`/candidate/:id`).
  2. Click the document preview/download icon next to the resume or offer letter.
  3. If a file ever fails to open due to browser network timeout, re-click the link or re-upload the document directly on the profile card.

### 2. Preventing "Hollow Submissions" (Blank Feedback)
- **Current Behavior**: TalentOS uses automatic template versioning (`v1` legacy rating-based assessments vs `v2` schema-driven 3-round templates). The system dynamically translates older legacy field names (`technical`, `overallRecommendation`, `keyStrengths`) so past records never display blank.
- **User Guidance**: To confirm your evaluation saved completely and is not hollow:
  1. Look for the green `Submitted ✓` badge in the form header after submitting.
  2. Click the `Copy Feedback` button to preview the formatted plain-text output of your entries.
  3. Verify that your feedback summary displays under the candidate's `Feedback` tab.

### 3. Handling Stale Data (Cache Management)
- **Current Behavior**: TalentOS utilizes client-side data caching (TanStack Query) and server-side cache invalidation to maintain fast page load speeds.
- **User Guidance**: If you schedule an interview or create a candidate profile and it does not immediately appear on your screen:
  1. Click the manual refresh button/icon located on the table header or calendar bar.
  2. Re-open the candidate profile or interview modal (which triggers an immediate cache refresh).
  3. If state remains unchanged, press `F5` (or `Ctrl + R`) to force a fresh browser reload.

---

## 5. Glossary of ATS Terms

| ATS Term | What the Recruiter / Hiring Team Calls It |
| :--- | :--- |
| **Candidate Profile** | Candidate Resume Record / Contact Dossier |
| **Requisition / Job Role** | Active Job Opening / Vacancy |
| **Application** | Candidate's Submission / Application for a Specific Job |
| **Round (Round 1, 2, Final)** | Interview Stage / Evaluation Phase |
| **Selection Status / Offer Decision** | Interview Result (Selected, Offer Letter, On Hold, Didn't Join, Rejected) |
| **Panel / Panelists** | Assigned Interviewers / Evaluation Committee |
| **Slot** | Hourly Interview Booking Window (Max 7 candidates per hour) |
| **Drive / College Drive** | Campus Recruitment Event / Offline Hiring Drive |
| **DOJ** | Date of Joining (Target Start Date) |

---

## 6. Unverified — Needs Confirmation

> **Status**: **None** — all flows, screens, field names, button text, API endpoints, database persistence schemas, and edge case mitigations documented in this guide have been fully verified directly against the TalentOS codebase.
