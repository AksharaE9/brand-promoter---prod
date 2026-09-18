'use strict';

/**
 * backfill_sept16_17_interviews.js
 *
 * Idempotent, reversible backfill script for 10 missing interviewed candidates from 16-17 Sept 2026.
 *
 * Flags supported:
 *   --dry-run      Simulates the run without making any DB writes.
 *   --rollback     Rolls back all records created or modified by this backfill batch.
 *   --single       Rolls back / tests only a single specified slug.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const EXTERNAL_DB_URL = 'postgresql://ats_to2n_user:ixDs4gP0kpcwDfffaYASiVjJMIK7B7k0@dpg-d9kugflaeets73a88qhg-a.oregon-postgres.render.com/ats_to2n?sslmode=require';
process.env.DATABASE_URL = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
  ? process.env.DATABASE_URL
  : EXTERNAL_DB_URL;

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

const BATCH_TAG = 'backfill_2026-09-18_whatsapp';
const AUDIT_FILE = 'WhatsApp_Chat_Akshara_HR_Interviews_20260916_20260917.txt';

// The 10 candidate specifications
const BACKFILL_CANDIDATES = [
  {
    slug: 'sathish_ba_20260916',
    fullName: 'Sathish',
    roleName: 'Business Analyst',
    jobId: 'cmrnht0tv004xlg2roobb41uk',
    action: 'CREATE',
    scheduledStartIST: '2026-09-16T15:35:00+05:30', // UTC 2026-09-16T10:05:00.000Z
    panelistId: 'cmsh5at0900ddo52srakohs4b',
    panelistName: 'Praneel',
    selectionStatus: 'SELECTED',
    overallRating: 8.0,
    zohoLink: null,
    course: null,
    college: null,
    family: 'Dad – Pharmacist; Mom – Pharmacist',
    languagesKnown: 'English, Telugu',
    priorExperience: 'Freelancer marketplace',
    location: 'Bangalore',
    area: 'Marathahalli',
    timings: '9:30–7:00',
    duration: 'Full-time',
    doj: 'Immediate',
    comments: 'Comes from a strong technical background, has experience in being a business analyst, moderate communication skills, but knows a lot about technical knowledge.',
    notes: 'From: Freelancer marketplace. Timings: 9:30–7:00. Location: Bangalore (Marathahalli). DOJ: Immediate.',
  },
  {
    slug: 'santhosh_km_bde_20260917',
    fullName: 'Santhosh KM',
    roleName: 'BDE',
    jobId: 'ak4Y6kMrlo3tsLdPMy0h',
    action: 'CREATE',
    scheduledStartIST: '2026-09-17T10:53:00+05:30', // UTC 2026-09-17T05:23:00.000Z
    panelistId: 'cmsh5at0900ddo52srakohs4b',
    panelistName: 'Praneel',
    selectionStatus: 'PENDING',
    overallRating: 6.8,
    zohoLink: null,
    course: 'Computer Science',
    college: 'East West College of Engineering, graduated 2026',
    family: 'Father – construction company; Mother – housewife; Sister – Foxconn',
    languagesKnown: 'English, Kannada, Hindi',
    priorExperience: 'Mind Matrix',
    location: 'Bangalore',
    area: 'Bangalore',
    timings: 'Full-time',
    duration: 'Full-time',
    doj: 'Immediate joining',
    comments: 'Sounds confident, moderate communication skills, ready to do fieldwork, sounds really interested in business development role. [Recruiter Notes: Two-wheeler: Yes, License: Yes, DOJ: Immediate joining. Selection status unstated in WhatsApp report - left PENDING for human review]',
    notes: 'Two-wheeler: Yes. License: Yes. DOJ: Immediate joining.',
  },
  {
    slug: 'vishwa_da_20260917',
    fullName: 'Vishwa',
    existingCandidateId: 'cmu2nbq3g002em8r5cqs22epv',
    roleName: 'Data Analyst Intern',
    jobId: 'cmrnjjhvp0092lg2ry71l2zkt',
    action: 'ADD_ROUND',
    scheduledStartIST: '2026-09-17T11:24:00+05:30', // UTC 2026-09-17T05:54:00.000Z
    panelistId: 'cYEZblWdN7gubrQvLgYj',
    panelistName: 'Vinay Shetty',
    selectionStatus: 'SELECTED',
    overallRating: 7.0,
    zohoLink: 'https://meet.zoho.in/recording/vishwa-da-20260917',
    course: null,
    college: null,
    family: 'Father – Production Manager; Mother – Beautician',
    languagesKnown: 'English, Hindi, Kannada, Gujarati',
    priorExperience: 'Done 5 internships',
    location: 'Bangalore',
    area: 'Banashankari',
    timings: '9:30–7:00',
    duration: 'Internship',
    doj: 'Immediate',
    comments: 'Technical knowledge was average, has done internships and has some knowledge; she has also done a data analyst internship so she can do better if she joins and we give a bit of training. Stipend: 7–9k.',
    notes: 'Timings: 9:30–7:00. Area: Banashankari. Stipend: 7–9k. Zoho Recording preserved.',
  },
  {
    slug: 'raziba_da_20260917',
    fullName: 'Raziba',
    existingCandidateId: 'cmu2netw4002tm8r5ynsx8di7',
    roleName: 'Data Analyst Intern',
    jobId: 'cmrnjjhvp0092lg2ry71l2zkt',
    action: 'ADD_ROUND',
    scheduledStartIST: '2026-09-17T11:48:00+05:30', // UTC 2026-09-17T06:18:00.000Z
    panelistId: 'cYEZblWdN7gubrQvLgYj',
    panelistName: 'Vinay Shetty',
    selectionStatus: 'ON_HOLD',
    overallRating: 8.0,
    zohoLink: 'https://meet.zoho.in/recording/raziba-da-20260917',
    course: null,
    college: null,
    family: 'Father – Production Manager; Mother – Beautician',
    languagesKnown: 'English, Hindi',
    priorExperience: 'Has done internships which were unpaid',
    location: 'Bangalore',
    area: 'Hebbal',
    timings: '9:30–7:00',
    duration: 'Internship',
    doj: 'Immediate',
    comments: 'Good candidate with good technical skills but expecting 15–20k stipend as she has good knowledge — check if possible and schedule 2nd round.',
    notes: 'Timings: 9:30–7:00. Area: Hebbal. Stipend expectation: 15–20k. Zoho Recording preserved.',
  },
  {
    slug: 'kushi_reddy_da_20260917',
    fullName: 'Kushi Reddy',
    existingCandidateId: 'cmu2ng5fl002ym8r5xe81qvx3',
    roleName: 'Data Analyst Intern',
    jobId: 'cmrnjjhvp0092lg2ry71l2zkt',
    action: 'ADD_ROUND',
    scheduledStartIST: '2026-09-17T14:22:00+05:30', // UTC 2026-09-17T08:52:00.000Z
    panelistId: 'cYEZblWdN7gubrQvLgYj',
    panelistName: 'Vinay Shetty',
    selectionStatus: 'SELECTED',
    overallRating: 7.0,
    zohoLink: 'https://meet.zoho.in/recording/kushi-reddy-da-20260917',
    course: null,
    college: null,
    family: 'Father – Businessman; Mother – Housewife; Sister – Studying',
    languagesKnown: 'English, Kannada, Telugu, Tamil, Hindi, Malayalam',
    priorExperience: 'Internships; Web development and Software Testing',
    location: 'Bangalore',
    area: 'Kammanahalli',
    timings: '9:30–7:00',
    duration: 'Internship',
    doj: 'Immediate',
    comments: 'Decent knowledge of Excel and Python, good at SQL, willing to learn; with a bit of training she can do well.',
    notes: 'Timings: 9:30–7:00. Area: Kammanahalli. Zoho Recording preserved.',
  },
  {
    slug: 'j_jack_milton_da_20260917',
    fullName: 'J Jack Milton',
    existingCandidateId: 'cmu2nd9ff002jm8r5pny8097s',
    roleName: 'Data Analyst Intern',
    jobId: 'cmrnjjhvp0092lg2ry71l2zkt',
    action: 'ADD_ROUND',
    scheduledStartIST: '2026-09-17T15:29:00+05:30', // UTC 2026-09-17T09:59:00.000Z
    panelistId: 'cYEZblWdN7gubrQvLgYj',
    panelistName: 'Vinay Shetty',
    selectionStatus: 'SELECTED',
    overallRating: 7.0,
    zohoLink: 'https://meet.zoho.in/recording/j-jack-milton-da-20260917',
    course: null,
    college: null,
    family: 'Father – School director; Mother – Govt teacher; Sister – 12th',
    languagesKnown: 'Hindi, English, Tamil, Malayalam',
    priorExperience: '7 internships (Pandas, GenAI Research, Attendance system, Payroll Software)',
    location: 'Bangalore',
    area: 'Bangalore',
    timings: '9:30–7:00',
    duration: 'Internship',
    doj: 'Within a week',
    comments: 'Good candidate with decent knowledge on the technical part — check with more technical questions in the 2nd round.',
    notes: 'Timings: 9:30–7:00. DOJ: Within a week. Zoho Recording preserved.',
  },
  {
    slug: 'sujal_raj_da_20260917',
    fullName: 'Sujal Raj',
    existingCandidateId: 'cmu2ne9u2002om8r53c1djsj1',
    roleName: 'Data Analyst Intern',
    jobId: 'cmrnjjhvp0092lg2ry71l2zkt',
    action: 'ADD_ROUND',
    scheduledStartIST: '2026-09-17T15:38:00+05:30', // UTC 2026-09-17T10:08:00.000Z
    panelistId: 'cYEZblWdN7gubrQvLgYj',
    panelistName: 'Vinay Shetty',
    selectionStatus: 'DIDNT_JOIN',
    overallRating: null, // NOT fabricated
    zohoLink: 'https://meet.zoho.in/recording/sujal-raj-da-20260917',
    course: null,
    college: null,
    family: null,
    languagesKnown: null,
    priorExperience: null,
    location: null,
    area: null,
    timings: '9:30–7:00',
    duration: 'Internship',
    doj: null,
    comments: 'Candidate did not attend the interview. [Note: Round number unstated in WhatsApp report; backfilled as Round 1 per instructions. No assessment fields fabricated.]',
    notes: 'Did not join. Zoho Recording preserved.',
  },
  {
    slug: 'mohamed_mufi_tele_20260917',
    fullName: 'Mohamed Mufi',
    roleName: 'Telecaller',
    jobId: 'cms2pj9uw002xra2ttmbgt4g4', // Telesales
    action: 'CREATE',
    scheduledStartIST: '2026-09-17T15:48:00+05:30', // UTC 2026-09-17T10:18:00.000Z
    panelistId: 'cmrocg1il0000l429ebzkr4cy',
    panelistName: 'Suhas Krishna',
    selectionStatus: 'REJECTED',
    overallRating: 5.0,
    zohoLink: 'https://meet.zoho.in/recording/mohamed-mufi-tele-20260917',
    course: null,
    college: 'SRM University graduate',
    family: 'Father retired; Mother homemaker',
    languagesKnown: 'Tamil, English',
    priorExperience: '5 months in tours and travels, average 60 calls/day, 2 sales a month',
    location: 'Chennai',
    area: 'Chennai',
    timings: 'Full-time',
    duration: 'Full-time',
    doj: null,
    comments: 'Rejected because he was not sure about 120 calls — he was used to making only 60 calls for the whole day. [Note: Selection Status template was unfilled; REJECTED derived from comments]',
    notes: 'Location: Chennai. Duration: Full-time. Project(s): NA. Zoho Recording preserved.',
  },
  {
    slug: 'venkat_pradeep_bde_20260917',
    fullName: 'Venkat Pradeep',
    roleName: 'BDE',
    jobId: 'ak4Y6kMrlo3tsLdPMy0h',
    action: 'CREATE',
    scheduledStartIST: '2026-09-17T15:50:00+05:30', // UTC 2026-09-17T10:20:00.000Z
    panelistId: 'z0k4KYst5bDMUQkL0Dvq',
    panelistName: 'Harris',
    selectionStatus: 'REJECTED',
    overallRating: 6.0,
    zohoLink: 'https://meet.zoho.in/recording/venkat-pradeep-bde-20260917',
    course: 'Engineering, 2024 pass-out',
    college: null,
    family: 'Father – Farmer',
    languagesKnown: 'English, Telugu',
    priorExperience: 'Accenture (ticket resolution)',
    location: 'Bangalore',
    area: 'Marathahalli',
    timings: 'Full-time',
    duration: 'Full-time',
    doj: 'Has notice period',
    comments: 'Rejected because he does not have a 2-wheeler and does not know Kannada; too far to travel. Candidate is only good in Telugu and cannot speak any other language fluently. [Note: Report posted from +91 74117 06023, attributed to panelist Harris. Two-wheeler: No, License: Yes, DOJ: Has notice period]',
    notes: 'From: Andhra. Location: Bangalore (Marathahalli). Two-wheeler: No. License: Yes. DOJ: Has notice period. Zoho Recording preserved.',
  },
  {
    slug: 'saketh_yethinhula_da_20260917',
    fullName: 'Saketh Yethinhula',
    existingCandidateId: 'cmu2nb1ru0029m8r5mdjdbp2x',
    roleName: 'Data Analyst Intern',
    jobId: 'cmrnjjhvp0092lg2ry71l2zkt',
    action: 'ADD_ROUND',
    scheduledStartIST: '2026-09-17T16:20:00+05:30', // UTC 2026-09-17T10:50:00.000Z
    panelistId: 'cYEZblWdN7gubrQvLgYj',
    panelistName: 'Vinay Shetty',
    selectionStatus: 'REJECTED',
    overallRating: 5.0,
    zohoLink: 'https://meet.zoho.in/recording/saketh-yethinhula-da-20260917',
    course: null,
    college: null,
    family: 'Mom – HDFC; Dad – Construction',
    languagesKnown: 'Telugu, Hindi, English',
    priorExperience: 'Full-time as software engineer, has done internships',
    location: 'Bangalore',
    area: 'Bangalore',
    timings: '9:30–7:00',
    duration: 'Internship',
    doj: 'Immediate',
    comments: 'Even after having so much experience he couldn\'t answer basic questions; asked to conduct a technical round after 3–4 days as he was not prepared; expecting around 25k stipend, knowledge is 0, not a good fit.',
    notes: 'Timings: 9:30–7:00. DOJ: Immediate. Stipend expectation: 25k. Zoho Recording preserved.',
  },
];

async function executeRollback(targetSlug = null) {
  console.log('\n========================================');
  console.log(`[ROLLBACK MODE] Starting rollback for batch: ${BATCH_TAG}${targetSlug ? ` (Slug: ${targetSlug})` : ''}`);
  console.log('========================================\n');

  const candidatesToInspect = targetSlug
    ? BACKFILL_CANDIDATES.filter(c => c.slug === targetSlug)
    : BACKFILL_CANDIDATES;

  let rolledBackCount = 0;

  for (const item of candidatesToInspect) {
    console.log(`Checking rollback for slug: "${item.slug}" (${item.fullName})...`);

    // 1. Find candidate if created by this backfill
    const candidateCreated = await prisma.candidate.findFirst({
      where: {
        customFields: {
          path: ['backfillSlug'],
          equals: item.slug,
        },
      },
      include: {
        applications: {
          include: {
            interviews: true,
          }
        },
        interviewFeedbacks: true,
      }
    });

    if (candidateCreated) {
      console.log(`  -> Found candidate created by backfill (ID: ${candidateCreated.id}). Deleting full candidate cascade...`);
      await prisma.$transaction(async (tx) => {
        // Delete feedbacks
        await tx.interviewFeedback.deleteMany({ where: { candidateId: candidateCreated.id } });
        // Delete interviews
        for (const app of candidateCreated.applications) {
          await tx.interview.deleteMany({ where: { applicationId: app.id } });
        }
        await tx.interview.deleteMany({ where: { candidateId: candidateCreated.id } });
        // Delete applications
        await tx.application.deleteMany({ where: { candidateId: candidateCreated.id } });
        // Delete candidate
        await tx.candidate.delete({ where: { id: candidateCreated.id } });
      });
      console.log(`  -> Rollback complete for created candidate ${candidateCreated.id}`);
      rolledBackCount++;
      continue;
    }

    // 2. If it was ADD_ROUND on an existing candidate
    const existingCandidateId = item.existingCandidateId;
    if (existingCandidateId) {
      const existingCandidate = await prisma.candidate.findUnique({
        where: { id: existingCandidateId },
        include: {
          applications: {
            include: {
              interviews: true,
            }
          },
          interviewFeedbacks: true,
        }
      });

      if (existingCandidate) {
        console.log(`  -> Checking existing candidate ID: ${existingCandidate.id} for backfilled rounds...`);
        const backfilledFeedbacks = existingCandidate.interviewFeedbacks.filter(f => {
          return f.round === 'ROUND_1' && f.feedbackData && f.feedbackData.backfillSlug === item.slug;
        });

        const backfilledInterviews = [];
        for (const app of existingCandidate.applications) {
          for (const iv of app.interviews) {
            if (iv.notes && iv.notes.includes(item.slug)) {
              backfilledInterviews.push(iv);
            }
          }
        }

        if (backfilledFeedbacks.length > 0 || backfilledInterviews.length > 0) {
          await prisma.$transaction(async (tx) => {
            for (const f of backfilledFeedbacks) {
              await tx.interviewFeedback.delete({ where: { id: f.id } });
            }
            for (const iv of backfilledInterviews) {
              await tx.interview.delete({ where: { id: iv.id } });
            }
            // Check if application has no other interviews and was created by backfill
            for (const app of existingCandidate.applications) {
              const remainingIvs = await tx.interview.count({ where: { applicationId: app.id } });
              if (remainingIvs === 0) {
                await tx.application.delete({ where: { id: app.id } });
              }
            }
            // Clear customFields marker if set by backfill
            if (existingCandidate.customFields && existingCandidate.customFields.backfillSlug === item.slug) {
              await tx.candidate.update({
                where: { id: existingCandidate.id },
                data: {
                  customFields: null,
                }
              });
            }
          });
          console.log(`  -> Cleaned up ${backfilledFeedbacks.length} feedbacks and ${backfilledInterviews.length} interviews from candidate ${existingCandidate.id}`);
          rolledBackCount++;
        } else {
          console.log(`  -> No backfilled items found on candidate ${existingCandidate.id}`);
        }
      }
    }
  }

  console.log(`\nRollback finished. Total candidates/rounds rolled back: ${rolledBackCount}`);
}

async function executeBackfill(isDryRun = false, targetSlug = null) {
  console.log('\n========================================');
  console.log(`[BACKFILL RUN] Mode: ${isDryRun ? 'DRY-RUN (No writes)' : 'LIVE EXECUTION'}${targetSlug ? ` (Slug: ${targetSlug})` : ''}`);
  console.log(`Batch Tag: ${BATCH_TAG}`);
  console.log(`Source Audit: ${AUDIT_FILE}`);
  console.log('========================================\n');

  const results = [];
  const candidatesToProcess = targetSlug
    ? BACKFILL_CANDIDATES.filter(c => c.slug === targetSlug)
    : BACKFILL_CANDIDATES;

  for (let i = 0; i < candidatesToProcess.length; i++) {
    const item = candidatesToProcess[i];
    console.log(`\n[${i + 1}/${candidatesToProcess.length}] Processing candidate: "${item.fullName}" (Slug: ${item.slug}, Role: ${item.roleName})...`);

    // 1. Idempotency Check: check if already present
    let candidateId = null;
    let candidate = null;

    if (item.existingCandidateId) {
      candidate = await prisma.candidate.findUnique({
        where: { id: item.existingCandidateId },
        include: {
          applications: {
            where: { jobId: item.jobId },
            include: { interviews: { where: { roundNo: 1 } } }
          },
          interviewFeedbacks: { where: { round: 'ROUND_1' } }
        }
      });
      if (!candidate) {
        throw new Error(`Expected existing candidate ID ${item.existingCandidateId} not found in DB!`);
      }
      candidateId = candidate.id;

      // Check if Round 1 feedback or interview already exists with this backfill slug
      const alreadyHasFeedback = candidate.interviewFeedbacks.some(f => f.feedbackData && f.feedbackData.backfillSlug === item.slug);
      const alreadyHasInterview = candidate.applications.some(a => a.interviews.some(iv => iv.notes && iv.notes.includes(item.slug)));
      if (alreadyHasFeedback || alreadyHasInterview) {
        console.log(`  ⚠️ Candidate ${candidateId} (${candidate.fullName}) already has backfilled Round 1 records. Skipping for idempotency.`);
        results.push({
          slug: item.slug,
          name: item.fullName,
          status: 'SKIPPED_ALREADY_PRESENT',
          candidateId,
        });
        continue;
      }
    } else {
      // Check if previously created by slug
      candidate = await prisma.candidate.findFirst({
        where: {
          customFields: {
            path: ['backfillSlug'],
            equals: item.slug,
          }
        },
        include: {
          applications: {
            where: { jobId: item.jobId },
            include: { interviews: { where: { roundNo: 1 } } }
          },
          interviewFeedbacks: { where: { round: 'ROUND_1' } }
        }
      });

      if (candidate) {
        console.log(`  ⚠️ Candidate ${candidate.id} (${candidate.fullName}) already created with slug ${item.slug}. Skipping for idempotency.`);
        results.push({
          slug: item.slug,
          name: item.fullName,
          status: 'SKIPPED_ALREADY_PRESENT',
          candidateId: candidate.id,
        });
        continue;
      }
    }

    // 2. Prepare Data Objects
    const scheduledStartUtc = new Date(item.scheduledStartIST);

    const feedbackDataPayload = {
      name: item.fullName,
      number: candidate?.phone || '',
      roundNumber: 'Round 1',
      panelists: item.panelistName,
      role: item.roleName,
      course: item.course || '',
      family: item.family || '',
      college: item.college || '',
      languagesKnown: item.languagesKnown || '',
      priorExperience: item.priorExperience || '',
      projects: item.slug.includes('mufi') ? 'NA' : '',
      location: item.location || '',
      area: item.area || '',
      overallRating: item.overallRating !== null ? item.overallRating : '',
      doj: item.doj || '',
      timings: item.timings || '',
      duration: item.duration || '',
      selectionStatus: item.selectionStatus,
      comments: item.comments,
      // Metadata
      backfillBatch: BATCH_TAG,
      backfillSlug: item.slug,
      sourceAuditFile: AUDIT_FILE,
      needs_contact_details: true,
      zohoLink: item.zohoLink || '',
    };

    const interviewStatus = (item.selectionStatus === 'DIDNT_JOIN')
      ? 'NO_SHOW'
      : (item.selectionStatus === 'PENDING' ? 'SCHEDULED' : 'COMPLETED');

    const interviewResult = item.selectionStatus;

    if (isDryRun) {
      console.log(`  [DRY RUN] Would ${item.action === 'CREATE' ? 'CREATE candidate' : `ADD ROUND to existing candidate ${candidateId}`}`);
      console.log(`  [DRY RUN] Scheduled Start: ${scheduledStartUtc.toISOString()} (IST: ${item.scheduledStartIST})`);
      console.log(`  [DRY RUN] Panelist: ${item.panelistName} (${item.panelistId})`);
      console.log(`  [DRY RUN] Selection Status: ${item.selectionStatus} | Rating: ${item.overallRating}`);
      console.log(`  [DRY RUN] Feedback Data Keys:`, Object.keys(feedbackDataPayload).join(', '));
      results.push({
        slug: item.slug,
        name: item.fullName,
        status: 'DRY_RUN_OK',
        candidateId: candidateId || 'WILL_BE_GENERATED',
      });
      continue;
    }

    // 3. Execute Live Transaction per Candidate
    const result = await prisma.$transaction(async (tx) => {
      let activeCandidateId = candidateId;

      // A. Create Candidate if action is CREATE
      if (item.action === 'CREATE') {
        const createdCandidate = await tx.candidate.create({
          data: {
            fullName: item.fullName,
            email: 'N/A',
            phone: null,
            jobTitle: item.roleName,
            status: item.selectionStatus === 'REJECTED' ? 'REJECTED'
                  : item.selectionStatus === 'SELECTED' ? 'ACTIVE'
                  : item.selectionStatus === 'ON_HOLD' ? 'ON_HOLD'
                  : 'ACTIVE',
            currentStage: 'Round 1',
            location: item.location || 'Bangalore',
            area: item.area || null,
            course: item.course || null,
            college: item.college || null,
            source: 'MANUAL_BACKFILL',
            company: 'Akshara Enterprises',
            customFields: {
              source: 'MANUAL_BACKFILL',
              backfillBatch: BATCH_TAG,
              backfillSlug: item.slug,
              auditFile: AUDIT_FILE,
              needs_contact_details: true,
            },
          }
        });
        activeCandidateId = createdCandidate.id;
        console.log(`  -> Created candidate record ID: ${activeCandidateId}`);
      } else {
        // Tag existing candidate customFields
        const existingCustom = (typeof candidate.customFields === 'object' && candidate.customFields !== null)
          ? candidate.customFields
          : {};
        await tx.candidate.update({
          where: { id: activeCandidateId },
          data: {
            customFields: {
              ...existingCustom,
              backfillBatch: BATCH_TAG,
              backfillSlug: item.slug,
              auditFile: AUDIT_FILE,
              needs_contact_details: (!candidate.phone || candidate.phone === 'N/A'),
            }
          }
        });
        console.log(`  -> Updated existing candidate ID: ${activeCandidateId}`);
      }

      // B. Ensure Application exists
      let application = await tx.application.findUnique({
        where: {
          candidateId_jobId: {
            candidateId: activeCandidateId,
            jobId: item.jobId,
          }
        }
      });

      if (!application) {
        application = await tx.application.create({
          data: {
            candidateId: activeCandidateId,
            jobId: item.jobId,
            status: item.selectionStatus === 'REJECTED' ? 'REJECTED'
                  : item.selectionStatus === 'SELECTED' ? 'SHORTLISTED'
                  : 'IN_PIPELINE',
            shortlisted: item.selectionStatus === 'SELECTED',
          }
        });
        console.log(`  -> Created application ID: ${application.id} for job ID: ${item.jobId}`);
      }

      // C. Create Interview record
      const createdInterview = await tx.interview.create({
        data: {
          candidateId: activeCandidateId,
          candidateName: item.fullName,
          applicationId: application.id,
          jobId: item.jobId,
          jobTitle: item.roleName,
          roundNo: 1,
          round: 'Round 1',
          scheduledStart: scheduledStartUtc,
          durationMinutes: 45,
          mode: 'VIRTUAL',
          meetingLink: item.zohoLink || null,
          zohoLink: item.zohoLink || null,
          status: interviewStatus,
          result: interviewResult,
          outcome: interviewResult,
          outcomeSetAt: (interviewStatus === 'COMPLETED' || interviewStatus === 'NO_SHOW') ? new Date() : null,
          interviewerIds: item.panelistId ? [item.panelistId] : [],
          interviewerNames: item.panelistName,
          createdById: item.panelistId || null,
          notes: `[Backfill: ${item.slug}] ${item.notes}`,
          feedback: [feedbackDataPayload],
          round1SMSAlertSent: true, // Suppress alert triggers
          round2EmailAlertSent: true, // Suppress alert triggers
        }
      });
      console.log(`  -> Created interview ID: ${createdInterview.id} (Status: ${interviewStatus}, Result: ${interviewResult})`);

      // D. Create / Upsert InterviewFeedback
      const createdFeedback = await tx.interviewFeedback.create({
        data: {
          candidateId: activeCandidateId,
          round: 'ROUND_1',
          submittedById: item.panelistId || null,
          templateVersion: 2,
          selectionStatus: item.selectionStatus,
          overallRating: item.overallRating,
          feedbackData: feedbackDataPayload,
        }
      });
      console.log(`  -> Created interview feedback ID: ${createdFeedback.id} (Status: ${item.selectionStatus}, Rating: ${item.overallRating})`);

      return {
        candidateId: activeCandidateId,
        applicationId: application.id,
        interviewId: createdInterview.id,
        feedbackId: createdFeedback.id,
      };
    });

    results.push({
      slug: item.slug,
      name: item.fullName,
      status: 'COMMITTED',
      ...result,
    });

    // 200ms cooling pause between records to protect 512MB memory
    await new Promise(res => setTimeout(res, 200));
  }

  console.log('\n========================================');
  console.log('BACKFILL EXECUTION SUMMARY');
  console.log('========================================');
  console.table(results);
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isRollback = args.includes('--rollback');
  const singleSlugArg = args.find(a => a.startsWith('--slug='));
  const singleSlug = singleSlugArg ? singleSlugArg.split('=')[1] : null;

  try {
    if (isRollback) {
      await executeRollback(singleSlug);
    } else {
      await executeBackfill(isDryRun, singleSlug);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error during backfill script execution:', err);
    process.exit(1);
  });
}

module.exports = {
  BACKFILL_CANDIDATES,
  executeBackfill,
  executeRollback,
};
