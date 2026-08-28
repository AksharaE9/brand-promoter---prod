# TalentOS (ATS + CRM) HR Operations & Scheduling Guide

> [!TIP]
> **Microsoft Word Version Available:** A professionally styled Word document has been compiled for download: [docs/HR_ATS_Guide.docx](file:///d:/ats%20new/docs/HR_ATS_Guide.docx)

Welcome to the **TalentOS Enterprise ATS** operational guide. This document serves as the standard operating procedure for Human Resources (HR), recruiters, and talent acquisition teams to manage the candidate pipeline, schedule interviews, handle feedback, and coordinate sourcing drives.

---

## 1. System Access & Roles
Access level within TalentOS is governed by roles:
*   **Recruiter (HR):** Primary user for candidate sourcing, job postings, application movement, interview scheduling, and report generation/export.
*   **Super Admin:** Has all Recruiter permissions plus user management (creating/activating team accounts) and viewing system audit logs.
*   **Interviewer (Panel):** Has a read-mostly view of assigned candidate profiles, jobs, and applications. Primarily used to log interview feedback, capture live voice recordings, or upload assessment documents.

---

## 2. Candidate Intake & Database Management

### Adding Candidates Manually
1. Navigate to the **Candidates** page.
2. Click on **Add Candidate** to open the creation modal.
3. Fill out the core information:
   *   **Full Name, Email, Phone:** Essential contact details. (The system runs automatic duplicate checks to prevent importing existing candidates).
   *   **Education & Course details:** (e.g. B.Tech, MBA).
   *   **Preferred Role & Current Company/Experience:** Helps screen for target vacancies.
   *   **Source:** (e.g. LinkedIn, Referral, College Drive).
   *   **Resume Upload:** Supports uploading `.pdf`, `.docx`, and `.doc` files (Max 15MB).
4. Click **Create** to save. The candidate will receive a system dossier page containing their lifetime timeline and event history.

### Bulk Uploading Candidates
When importing candidates from college placement drives or sourcing vendors:
1. Navigate to the **Candidates** page.
2. Open the **Bulk Upload** modal.
3. Download the standard Excel upload template.
4. Fill in the candidate columns and upload the file (`.xlsx` or `.xls`). The backend processes the entries, automatically filtering out duplicates and attaching them to the selected workspace.

> [!WARNING]
> **Duplicate Prevention:** The system matches candidates using Email and Phone. If a match is found, the system will update/append data to the existing record instead of creating a duplicate candidate dossier.

---

## 3. Recruitment Pipeline & Job Openings
1. **Jobs Manager:** Recruiters can create new job openings (Title, Location, Experience required, Department) and toggle their status between `ACTIVE` and `CLOSED`.
2. **Visual Pipeline:** Accessible via the **Pipeline** tab. Candidates are shown as cards categorized by recruitment stages.
3. **Stage Transitions:** Move candidate cards across stages (e.g., *Applied*, *Screened*, *Scheduled*, *Offered*, *Joined*). The system tracks the date, time, and recruiter responsible for each stage transition in the candidate's history feed.

---

## 4. Scheduling Interviews (The Step-by-Step Process)

Scheduling is handled through the **Interview Schedule** page (`/schedule`). Recruiters can choose between single scheduling and bulk uploading.

### A. Scheduling a Single Interview Round
To book a round for a candidate:
1. Click **Schedule Interview** to open the scheduling modal.
2. **Search and Select Candidate:** Start typing the candidate's name. Select their profile from the suggestion dropdown. The candidate's contact phone number will display for reference.
3. **Select Job Role:** Search and link the interview to an active job opening.
4. **Determine the Round (Auto-Derived):**
   *   The system dynamically tracks completed rounds. It will automatically populate the field with the **Next Schedulable Round** (e.g. *Round 1*, *Round 2*, or *Final Round*).
5. **Set Meeting Mode:** Choose from `Online Meeting`, `In Person`, `Phone Call`, `Drive Meeting`, or `Walk-in Drive`.
6. **Assign Interviewers (Multiple Panelists):** Filter and select one or more interviewers from the active team directory list.
7. **Start Date & Time:** Input the date and time of the interview.
8. **Conferencing Links:** Insert the **Meeting Link** (Google Meet/Zoom) and/or the **Zoho Link** for communication.

> [!IMPORTANT]
> **Overbooking & Time-Slot Management:**
> *   The system tracks the number of interviews booked for every hour slot.
> *   **Slot 1:** First booking in that hour.
> *   **Slots 2–7:** Warns recruiters that other interviews are scheduled concurrently.
> *   **Over 7 bookings (Slot Exceeded):** Displays a red alert indicating the hour is fully loaded. HR is recommended to select a different date or time to avoid panel resource strain.

9. **Logging Follow-Ups (Optional):**
   Recruiters can attach follow-up documents (touchpoint records, preliminary evaluation drafts) under:
   *   **Phone Follow-up**
   *   **Email Follow-up**
   *   **Morning Follow-up**
   *   *File Requirements:* Supported formats are `.jpg`, `.jpeg`, `.png`, `.webp`, `.heic`, `.heif`, and `.pdf` up to **15 MB** each. Files are stored as Base64 format securely.

### B. Bulk Interview Scheduling
For drive days or bulk scheduling:
1. In the **Interview Schedule** page, open the **Bulk Interview Upload** modal.
2. Select your default parameters (e.g., default Round or default Mode).
3. Click **Download Template** to get the spreadsheet (`.xlsx`).
4. Enter the candidates, jobs, date-times, and panelist emails in the template.
5. Drop/select the file and click **Upload**. The system runs the jobs in the background. You can track progress directly in the modal. If errors occur, download the generated **Error Report** to fix and re-upload.

---

## 5. Capturing Interviewer Feedback & Outcomes

Interviews are only complete when feedback is submitted. Recruiters can view feedback status directly on the scheduling board.

### Feedback Templates (Schema Version 2)
Feedback inputs depend on the interview round to ensure structured data collection:

| Round Type | Template Fields | Key Required Data |
| :--- | :--- | :--- |
| **Round 1** | 19 Fields | Name, Number, Round Number, Panelists, Role, College/Course, Languages Known, Prior Experience, Projects, Overall Rating (Scale 1-10), Date of Joining (DOJ), Selection Status, Comments. |
| **Round 2 & Final** | 13 Fields | Name, Number, Round Number, Panelists, Mock Rating, Overall Rating (Scale 1-10), Location, DOJ, Status, Comments. |

> [!IMPORTANT]
> **Offer Letters:**
> When the selection status is marked as `OFFER_LETTER` in any template, the system requires the panelist or HR to upload:
> 1.  **Offer Letter Document** (Official PDF agreement).
> 2.  **Offer Letter Email Attachment** (Record of mail sent to the candidate).

### Actionable Feedback Features
*   **Voice Recording:** Interviewers can upload an audio file (`.mp3`/`.wav`) or use the in-browser microphone to record verbal impressions. This is saved directly into the candidate's feedback profile.
*   **Copy to Clipboard:** HR can copy structured feedback values to clipboard in a clean format to forward on Slack or WhatsApp.
*   **Bulk Feedback Upload:** If interviewers fill out feedback in Excel tables, HR can import them in bulk using the **Bulk Feedback Upload Modal** matching candidate phone numbers.

---

## 6. Daily Telecalling & Sourcing Drives
For high-volume candidate calling (e.g., initial sourcing drives):
1. Navigate to the **Telecalling & Lead Scheduling** page (`/sourcing` / `/scheduling`).
2. **Admin/HR View:**
   *   Import daily CSV/Excel spreadsheets containing cold/warm leads.
   *   Assign these lead lists to specific recruiters or telecallers.
   *   Monitor real-time stats: *Active Members*, *Lists Uploaded*, *Total Calls Done*, and *Daily Report Status*.
   *   Export and download lead progress reports.
3. **Recruiter/Telecaller View:**
   *   View the assigned lead list for today.
   *   Log outcomes of calls and candidate notes.
   *   Submit the daily **Work-Done Report** at the end of the shift.

---

## 7. Reports, Analytics & Off-boarding

### Dashboard & Metrics
Recruiters have access to real-time analytics to measure hiring efficiency:
*   **Pipeline Velocity:** How long candidates remain in each stage.
*   **Pass-through Efficiency:** The percentage of candidates moving from Round 1 -> Round 2 -> Final Round.
*   **Source Funnel:** Metrics showing which candidate source (referrals, job boards, drives) yields the highest selection rate.

### Exporting Reports
Navigate to the **Reports** page. HR can filter reports by recruiter activity, date range, or job. Click **Export** to download the clean data as:
*   **Excel (`.xlsx`) Spreadsheets** (Ideal for deep sorting and data archiving).
*   **PDF Reports** (Formatted summary decks for stakeholder review).

---

## 8. HR Best Practices Checklist
*   [ ] **Prevent Duplicates:** Always run a quick global search by Phone or Email before manually adding a new candidate.
*   [ ] **Check Slot capacity:** When scheduling interviews, look at the auto-computed slot alerts. Do not book more than 7 concurrent sessions in the same hour.
*   [ ] **Review Required Fields:** Ensure interviewers fill out the required overall rating and DOJ fields. If they select `OFFER_LETTER`, ensure they attach the two mandatory documents.
*   [ ] **Submit Daily Reports:** If participating in sourcing drives, ensure the recruiter completes and submits their work-done reports daily before logging out.
