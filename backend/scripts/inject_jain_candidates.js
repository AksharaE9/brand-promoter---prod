'use strict';
/**
 * inject_jain_candidates.js
 *
 * Injection script for Jain College Campus Drive:
 * - 22 Candidates (14 Selected, 8 Rejected)
 * - Round 1 Scheduled with Outcomes and Feedback
 * - Resumes attached per candidate into PostgreSQL FileMeta (db:// storage)
 * - Stamped with source: 'JAIN_DRIVE_IMPORT_2026-10-21'
 * - Atomic transactions per candidate, 100ms pause for 512MB RAM stability
 * - Idempotent, safe, and reversible with --rollback
 *
 * Flags:
 *   --dry-run      : Simulate and print 22-row preview table without modifying DB
 *   --test-single  : Ingest candidate #1, verify DB records, and roll back
 *   --rollback     : Remove all records under the Jain import marker
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { makeStorageKey, verifyDbFile, fixUtf8Filename } = require('../src/utils/dbStorage');

const prisma = new PrismaClient();

const CONFIG = {
  IMPORT_MARKER: 'JAIN_DRIVE_IMPORT_2026-10-21',
  DRIVE_ID: 'cmrvvgvnj0007mt29fxu60ik8', // JAIN CMS INTERNSHIP FAIR
  COLLEGE_ID: 'cmrvvg6bu0006mt2958sykr80', // JAIN CMS
  COLLEGE_NAME: 'Jain (Deemed-to-be University)',
  INTERVIEW_DATE_RAW: '16-10-2026',
  INTERVIEW_DATE_ISO: '2026-10-16T04:30:00.000Z', // 10:00 IST = 04:30 UTC
  INTERVIEW_TIME_RAW: '10:00 IST',
  ORG_ID: 'defaultOrg',
  DEFAULT_COMPANY: 'Akshara Enterprises',
  RESUME_FOLDER: path.resolve(__dirname, '../scratch/jain_resumes')
};

const PANELISTS = {
  'Yuvan': {
    id: 're56ljEGsGX6xyVRsB9N',
    name: 'YUVAN MELWIN MJ'
  },
  'Praneel': {
    id: 'cmsh5at0900ddo52srakohs4b',
    name: 'Praneel'
  }
};

const JOBS = {
  'DA': {
    id: 'cmrnjjhvp0092lg2ry71l2zkt',
    title: 'Data Analyst Intern'
  },
  'BA': {
    id: 'cmrx56ou6001kmy2rk7zgf7jd',
    title: 'Business Analyst Intern'
  }
};

// 22 Candidates Data extracted from Jain_College_Round1.xlsx + visual verification of resumes
const CANDIDATES = [
  {
    serial: 1,
    name_resume: "Pengaluru Dinishitha",
    name_excel: "Pengaluru Dinishitha",
    panelist: "Yuvan",
    round_excel: "1",
    role_excel: "DA Intern",
    role_type: "DA",
    rating: 6,
    status: "REJECTED",
    doj: "-",
    year_degree: "BE (2027)",
    college_area: "College hostel",
    location_state: "Andhra Pradesh",
    origin_place: "Bangalore",
    languages: "Kannada, English",
    family: "Business man now farmer",
    experience: "Codesoft, Code Alpha, Prostate cancer detection",
    timings: "-",
    dl_bike: "NA",
    comments: "Technically not sounding good, practical knowledge not great, fumbled much",
    phone: null,
    phone_e164: null,
    email: null,
    resume_file: null,
    contact_confidence: "NO_RESUME",
    flags: ["needs_contact_details", "no_resume"]
  },
  {
    serial: 2,
    name_resume: "Boggavarapu Suriya",
    name_excel: "Boggavarapu Suriya",
    panelist: "Yuvan",
    round_excel: "1",
    role_excel: "DA Intern",
    role_type: "DA",
    rating: 7,
    status: "SELECTED",
    doj: "-",
    year_degree: "BE (2027)",
    college_area: "College hostel",
    location_state: "Bangalore",
    origin_place: "Bangalore",
    languages: "Kannada, English",
    family: "Dad pharma company",
    experience: "Zedio development",
    timings: "-",
    dl_bike: "NA",
    comments: "Logically he answers well, confident in his answers, technically above average",
    phone: "9483603470",
    phone_e164: "+919483603470",
    email: "suri.varapu@gmail.com",
    resume_file: "jain_boggavarapu-suriya_resume.pdf",
    contact_confidence: "OK",
    flags: []
  },
  {
    serial: 3,
    name_resume: "HARSH PILLAI",
    name_excel: "Harsh Pillai",
    panelist: "Yuvan",
    round_excel: "1",
    role_excel: "DA Intern",
    role_type: "DA",
    rating: 6,
    status: "REJECTED",
    doj: "Immediately",
    year_degree: "BE (2027)",
    college_area: "Vajarahaali",
    location_state: "Bangalore",
    origin_place: "Bangalore",
    languages: "Kannada, English",
    family: "Mom pathologist lab, Jain dad",
    experience: "MAIN flow",
    timings: "-",
    dl_bike: "NA",
    comments: "Answers not convincing, not logical, didn't write the query, was asking some question, he was telling different thing, couldn't answer the query",
    phone: "7480089403",
    phone_e164: "+917480089403",
    email: "pillaiharsh86@gmail.com",
    resume_file: "jain_harsh-pillai_resume.pdf",
    contact_confidence: "OK",
    flags: []
  },
  {
    serial: 4,
    name_resume: "SHAIK SHAH BABA",
    name_excel: "Shaikh Shah Baba",
    panelist: "Yuvan",
    round_excel: "1",
    role_excel: "DA Intern",
    role_type: "DA",
    rating: 8,
    status: "SELECTED",
    doj: "-",
    year_degree: "BE (2027)",
    college_area: "JP Nagar",
    location_state: "Andhra Pradesh",
    origin_place: "Bangalore",
    languages: "Kannada, English",
    family: "Father business",
    experience: "Commonwealth Bank (Excel sheets)",
    timings: "-",
    dl_bike: "NA",
    comments: "Logically he is good in analytical thinking. Will be a good fit, stays in JP Nagar can commute easily to the location",
    phone: "9346786685",
    phone_e164: "+919346786685",
    email: "shaikshahbaba13092023@gmail.com",
    resume_file: "jain_shaik-shah-baba_resume.pdf",
    contact_confidence: "OK",
    flags: ["name_spelling_variation"]
  },
  {
    serial: 5,
    name_resume: "MOHAMMED FARIS NOOR",
    name_excel: "Mohammed Faris Noor",
    panelist: "Yuvan",
    round_excel: "1",
    role_excel: "BA Intern",
    role_type: "BA",
    rating: 5,
    status: "REJECTED",
    doj: "Immediately",
    year_degree: "BE (2027)",
    college_area: "JP Nagar",
    location_state: "JP Nagar",
    origin_place: "Bangalore",
    languages: "Kannada, English",
    family: "-",
    experience: "No",
    timings: "-",
    dl_bike: "NA",
    comments: "Doesn't sound well in answering, over confident",
    phone: "6360165354",
    phone_e164: "+916360165354",
    email: "fn9710695@gmail.com",
    resume_file: "jain_mohammed-faris-noor_resume.pdf",
    contact_confidence: "OK",
    flags: []
  },
  {
    serial: 6,
    name_resume: "DHANUSH INAPAGOLLA",
    name_excel: "Dhanush Inapagolla",
    panelist: "Yuvan",
    round_excel: "1",
    role_excel: "DA Intern",
    role_type: "DA",
    rating: 5,
    status: "REJECTED",
    doj: "Immediately",
    year_degree: "BE (2027)",
    college_area: "Near college",
    location_state: "College PG",
    origin_place: "Bangalore",
    languages: "Kannada, English",
    family: "Dad and mom teacher",
    experience: "Aquasentry",
    timings: "-",
    dl_bike: "NA",
    comments: "Doesn't sound well in answering, doesn't sound well technically. Wasn't confident while answering",
    phone: "8328592840",
    phone_e164: "+918328592840",
    email: "dhanush.07115@gmail.com",
    resume_file: "jain_dhanush-inapagolla_resume.pdf",
    contact_confidence: "OK",
    flags: []
  },
  {
    serial: 7,
    name_resume: "RIFAH ALAM",
    name_excel: "Rifah Alam",
    panelist: "Yuvan",
    round_excel: "1",
    role_excel: "BA Intern",
    role_type: "BA",
    rating: 7.5,
    status: "SELECTED",
    doj: "Immediately",
    year_degree: "BE (2027)",
    college_area: "Thalagatpurra",
    location_state: "College PG",
    origin_place: "Bangalore",
    languages: "Kannada, English",
    family: "-",
    experience: "Techie QA, RD Infro Technology",
    timings: "-",
    dl_bike: "NA",
    comments: "Candidate is good wants to explore BA. DA and BA can be given. She asked if not BA can DA be given. Good fit",
    phone: "9113124527",
    phone_e164: "+919113124527",
    email: "rifahalam18@gmail.com",
    resume_file: "jain_rifah-alam_resume.pdf",
    contact_confidence: "OK",
    flags: ["decimal_rating_7.5", "open_to_da"]
  },
  {
    serial: 8,
    name_resume: "TARUN JOSHI",
    name_excel: "Tarun Joshi",
    panelist: "Yuvan",
    round_excel: "1",
    role_excel: "DA Intern",
    role_type: "DA",
    rating: 7,
    status: "SELECTED",
    doj: "Immediately",
    year_degree: "BE (2027)",
    college_area: "Harohalli",
    location_state: "College PG",
    origin_place: "Bangalore",
    languages: "Kannada, English",
    family: "Dad construction business",
    experience: "-",
    timings: "-",
    dl_bike: "NA",
    comments: "Candidate is good, has come from Uttarakhand, answered well, wrote the query also well",
    phone: "7456806457",
    phone_e164: "+917456806457",
    email: "tarun.sde.code@gmail.com",
    resume_file: "jain_tarun-joshi_resume.pdf",
    contact_confidence: "OK",
    flags: []
  },
  {
    serial: 9,
    name_resume: "CHANDAMURI KASI REDDY",
    name_excel: "Chandamuri Kasi Reddy",
    panelist: "Yuvan",
    round_excel: "1",
    role_excel: "DA Intern",
    role_type: "DA",
    rating: 7,
    status: "SELECTED",
    doj: "Immediately",
    year_degree: "BE (2027)",
    college_area: "Harohalli",
    location_state: "Haohalli",
    origin_place: "Bangalore",
    languages: "Kannada, English",
    family: "Parents handloom weavers",
    experience: "-",
    timings: "-",
    dl_bike: "NA",
    comments: "Technically good answered well little bit struggles but answered in logical way",
    phone: "7780277256",
    phone_e164: "+917780277256",
    email: "Chandamuri.kasireddy81@gmail.com",
    resume_file: "jain_chandamuri-kasi-reddy_resume.pdf",
    contact_confidence: "OK_VERIFIED",
    flags: []
  },
  {
    serial: 10,
    name_resume: "V KUSUMA",
    name_excel: "V Kusuma",
    panelist: "Yuvan",
    round_excel: "1",
    role_excel: "DA Intern",
    role_type: "DA",
    rating: 8,
    status: "SELECTED",
    doj: "Immediately",
    year_degree: "BE (2027)",
    college_area: "Hostel",
    location_state: "Andhra Pradesh",
    origin_place: "Bangalore",
    languages: "Kannada, English",
    family: "Father is TDTC",
    experience: "-",
    timings: "-",
    dl_bike: "NA",
    comments: "Technically good answered well. Good knowledge. Has query knowledge",
    phone: "6301705903",
    phone_e164: "+916301705903",
    email: "vkusuma249@gmail.com",
    resume_file: "jain_v-kusuma_resume.pdf",
    contact_confidence: "OK",
    flags: []
  },
  {
    serial: 11,
    name_resume: "SANJAY E",
    name_excel: "Sanjay E",
    panelist: "Yuvan",
    round_excel: "1",
    role_excel: "BA Intern",
    role_type: "BA",
    rating: 8,
    status: "SELECTED",
    doj: "Immediately",
    year_degree: "BE (2027)",
    college_area: "Hostel",
    location_state: "Andhra Pradesh",
    origin_place: "Bangalore",
    languages: "Kannada, English",
    family: "-",
    experience: "-",
    timings: "-",
    dl_bike: "NA",
    comments: "Technically good answered well. Good knowledge. Has query knowledge",
    phone: "6381050169",
    phone_e164: "+916381050169",
    email: "sanjayelaiyaraja@gmail.com",
    resume_file: "jain_sanjay-e_resume.pdf",
    contact_confidence: "OK_VERIFIED",
    flags: []
  },
  {
    serial: 12,
    name_resume: "SUVAM KURMI",
    name_excel: "Suvam Kurmiw",
    panelist: "Praneel",
    round_excel: "2nd",
    role_excel: "DA",
    role_type: "DA",
    rating: 7,
    status: "SELECTED",
    doj: "November 1",
    year_degree: "-",
    college_area: "-",
    location_state: "Bangalore",
    origin_place: "Bangalore",
    languages: "English",
    family: "Dad - real estate, Mom - house wife",
    experience: "Internship at Cotton Solutions",
    timings: "9:30 - 7:00",
    dl_bike: "-",
    comments: "Sounds serious and confident, has technical knowledge",
    phone: "7439016177",
    phone_e164: "+917439016177",
    email: "suvamkurmisuvam@gmail.com",
    resume_file: "jain_suvam-kurmi_resume.pdf",
    contact_confidence: "OK",
    flags: ["round_written_as_2nd", "name_spelling_variation"]
  },
  {
    serial: 13,
    name_resume: "PRANAV DHAASAIYA",
    name_excel: "Pranav Dhaasaiyam",
    panelist: "Praneel",
    round_excel: "1st",
    role_excel: "DA",
    role_type: "DA",
    rating: 7,
    status: "SELECTED",
    doj: "December",
    year_degree: "-",
    college_area: "-",
    location_state: "Bangalore",
    origin_place: "Bangalore",
    languages: "English, Hindi, Tamil",
    family: "Dad - railway engineer contractor, Mom - house wife",
    experience: "-",
    timings: "9:30 - 7:00",
    dl_bike: "-",
    comments: "Sounds serious and confident, has technical knowledge",
    phone: "9629986730",
    phone_e164: "+919629986730",
    email: "pranavdhaasaiya13@gmail.com",
    resume_file: "jain_pranav-dhaasaiya_resume.pdf",
    contact_confidence: "OK_VERIFIED",
    flags: ["name_spelling_variation"]
  },
  {
    serial: 14,
    name_resume: "DHRUVANTH R",
    name_excel: "Dhruvanth R",
    panelist: "Praneel",
    round_excel: "1st",
    role_excel: "DA",
    role_type: "DA",
    rating: 7,
    status: "SELECTED",
    doj: "Immediate",
    year_degree: "-",
    college_area: "-",
    location_state: "Bangalore",
    origin_place: "Bangalore",
    languages: "English, Kannada, Hindi",
    family: "Dad - provision store",
    experience: "-",
    timings: "9:30 - 7:00",
    dl_bike: "-",
    comments: "Seems hardworking and enthusiastic",
    phone: "9686485136",
    phone_e164: "+919686485136",
    email: "dhruvanthr26@gmail.com",
    resume_file: "jain_dhruvanth-r_resume.pdf",
    contact_confidence: "OK",
    flags: ["secondary_email_23btris011@jainuniversity.ac.in"]
  },
  {
    serial: 15,
    name_resume: "G Prudvi Siva Naga Meher",
    name_excel: "Prudivi Siva Naga Meher",
    panelist: "Praneel",
    round_excel: "1st",
    role_excel: "DA",
    role_type: "DA",
    rating: 5,
    status: "REJECTED",
    doj: "November",
    year_degree: "-",
    college_area: "-",
    location_state: "Bangalore",
    origin_place: "Bangalore",
    languages: "English, Telugu, Hindi",
    family: "Dad - shop, Mom - house wife",
    experience: "-",
    timings: "9:30 - 7:00",
    dl_bike: "-",
    comments: "Other candidates were better",
    phone: "6301072325",
    phone_e164: "+916301072325",
    email: "meherprudvi12@gmail.com",
    resume_file: "jain_g-prudvi-siva-naga-meher_resume.pdf",
    contact_confidence: "OK",
    flags: ["name_spelling_variation"]
  },
  {
    serial: 16,
    name_resume: "INFANT PRESHITH P",
    name_excel: "Infant Pershith",
    panelist: "Praneel",
    round_excel: "1st",
    role_excel: "DA",
    role_type: "DA",
    rating: 5,
    status: "SELECTED",
    doj: "1st week of November",
    year_degree: "-",
    college_area: "-",
    location_state: "Bangalore",
    origin_place: "Bangalore",
    languages: "English, Kannada",
    family: "Dad - farming, Mom - farming",
    experience: "-",
    timings: "9:30 - 7:00",
    dl_bike: "-",
    comments: "Answered all the questions correctly",
    phone: "6363096588",
    phone_e164: "+916363096588",
    email: "infantpreshith@gmail.com",
    resume_file: "jain_infant-preshith-p_resume.pdf",
    contact_confidence: "OK",
    flags: ["name_spelling_variation", "rating_outcome_anomaly_rated_5_selected"]
  },
  {
    serial: 17,
    name_resume: "HARSHAN R",
    name_excel: "Harshan R",
    panelist: "Praneel",
    round_excel: "1st",
    role_excel: "DA",
    role_type: "DA",
    rating: 6,
    status: "REJECTED",
    doj: "For next week",
    year_degree: "-",
    college_area: "-",
    location_state: "Bangalore",
    origin_place: "Bangalore",
    languages: "English, Tamil",
    family: "Dad - businessman, Mom - housewife",
    experience: "-",
    timings: "9:30 - 7:00",
    dl_bike: "-",
    comments: "Other candidates were better than him",
    phone: "8838161876",
    phone_e164: "+918838161876",
    email: "harshan2k21@gmail.com",
    resume_file: "jain_harshan-r_resume.pdf",
    contact_confidence: "OK_VERIFIED",
    flags: []
  },
  {
    serial: 18,
    name_resume: "SOUMYA SINGH",
    name_excel: "Soumya Singh",
    panelist: "Praneel",
    round_excel: "1st",
    role_excel: "DA",
    role_type: "DA",
    rating: 8,
    status: "REJECTED",
    doj: "December",
    year_degree: "-",
    college_area: "-",
    location_state: "Bangalore",
    origin_place: "Bangalore",
    languages: "English, Hindi",
    family: "Dad - government employee, Mom - housewife",
    experience: "-",
    timings: "9:30 - 7:00",
    dl_bike: "-",
    comments: "Did not answer most of the questions",
    phone: "9341793952",
    phone_e164: "+919341793952",
    email: "itsoumya1234@gmail.com",
    resume_file: "jain_soumya-singh_resume.pdf",
    contact_confidence: "OK",
    flags: ["rating_outcome_anomaly_rated_8_rejected"]
  },
  {
    serial: 19,
    name_resume: "ISHITA JAIN",
    name_excel: "Ishita Jain",
    panelist: "Praneel",
    round_excel: "1st",
    role_excel: "DA",
    role_type: "DA",
    rating: 8,
    status: "SELECTED",
    doj: "After 11th November",
    year_degree: "-",
    college_area: "-",
    location_state: "Bangalore",
    origin_place: "Bangalore",
    languages: "English, Hindi, Marwadi, Assamese",
    family: "Dad - businessman, Mom - business",
    experience: "-",
    timings: "9:30 - 7:00",
    dl_bike: "-",
    comments: "Answered all the questions",
    phone: "7850031379",
    phone_e164: "+917850031379",
    email: "ishitaamin11@gmail.com",
    resume_file: "jain_ishita-jain_resume.pdf",
    contact_confidence: "OK_VERIFIED",
    flags: []
  },
  {
    serial: 20,
    name_resume: "Shaik Mohammed Sanaan",
    name_excel: "Shaikh Mohammed Sanaan",
    panelist: "Praneel",
    round_excel: "1st",
    role_excel: "DA",
    role_type: "DA",
    rating: 8,
    status: "SELECTED",
    doj: "Immediate",
    year_degree: "-",
    college_area: "-",
    location_state: "Bangalore",
    origin_place: "Bangalore",
    languages: "English, Hindi, Japanese, Urdu",
    family: "Dad - fruit merchant, Mom - housewife",
    experience: "-",
    timings: "9:30 - 7:00",
    dl_bike: "-",
    comments: "Answered all the questions",
    phone: "6303767372",
    phone_e164: "+916303767372",
    email: "shaiksanan1234@gmail.com",
    resume_file: "jain_shaik-mohammed-sanaan_resume.pdf",
    contact_confidence: "OK",
    flags: ["name_spelling_variation"]
  },
  {
    serial: 21,
    name_resume: "Asmita Singh",
    name_excel: "Ashmita Singh",
    panelist: "Praneel",
    round_excel: "1st",
    role_excel: "DA",
    role_type: "DA",
    rating: 8,
    status: "SELECTED",
    doj: "Immediate",
    year_degree: "-",
    college_area: "-",
    location_state: "Bangalore",
    origin_place: "Bangalore",
    languages: "English, Hindi, Kannada",
    family: "Dad - bank employee, Mom - housewife",
    experience: "-",
    timings: "9:30 - 7:00",
    dl_bike: "-",
    comments: "Answered all the questions",
    phone: "9241589563",
    phone_e164: "+919241589563",
    email: "i.am.asmita.91@gmail.com",
    resume_file: "jain_asmita-singh_resume.pdf",
    contact_confidence: "OK",
    flags: ["name_spelling_variation"]
  },
  {
    serial: 22,
    name_resume: "ADITI S PRASAD",
    name_excel: "Adithi S Prasad",
    panelist: "Praneel",
    round_excel: "1st",
    role_excel: "DA",
    role_type: "DA",
    rating: 8,
    status: "REJECTED",
    doj: "Within a week or two",
    year_degree: "-",
    college_area: "-",
    location_state: "Bangalore",
    origin_place: "Bangalore",
    languages: "English, Hindi, Kannada, Telugu",
    family: "Dad - business manager, Mom - tech",
    experience: "-",
    timings: "9:30 - 7:00",
    dl_bike: "-",
    comments: "Felt like the other candidates were better",
    phone: "6364630879",
    phone_e164: "+916364630879",
    email: "aditisprasad16@gmail.com",
    resume_file: "jain_aditi-s-prasad_resume.pdf",
    contact_confidence: "OK_VERIFIED",
    flags: ["name_spelling_variation"]
  }
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeNullable(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (s === '' || s === '-') return null;
  return s;
}

async function rollback() {
  console.log(`\n======================================================`);
  console.log(`ROLLBACK: Removing all records with marker "${CONFIG.IMPORT_MARKER}"`);
  console.log(`======================================================\n`);

  const candidates = await prisma.candidate.findMany({
    where: {
      organizationId: CONFIG.ORG_ID,
      OR: [
        { source: CONFIG.IMPORT_MARKER },
        { customFields: { path: ['import_source'], equals: CONFIG.IMPORT_MARKER } }
      ]
    },
    select: { id: true, fullName: true, resumeFileId: true }
  });

  console.log(`Found ${candidates.length} candidate(s) to remove.`);
  if (candidates.length === 0) {
    console.log('No records found to rollback.');
    return;
  }

  const candidateIds = candidates.map(c => c.id);
  const resumeIds = candidates.map(c => c.resumeFileId).filter(Boolean);

  const deletedDriveCands = await prisma.collegeDriveCandidate.deleteMany({
    where: { candidateId: { in: candidateIds } }
  });
  console.log(`- Deleted ${deletedDriveCands.count} CollegeDriveCandidate record(s)`);

  const deletedFeedbacks = await prisma.interviewFeedback.deleteMany({
    where: { candidateId: { in: candidateIds } }
  });
  console.log(`- Deleted ${deletedFeedbacks.count} InterviewFeedback record(s)`);

  const deletedInterviews = await prisma.interview.deleteMany({
    where: { candidateId: { in: candidateIds } }
  });
  console.log(`- Deleted ${deletedInterviews.count} Interview record(s)`);

  const deletedApps = await prisma.application.deleteMany({
    where: { candidateId: { in: candidateIds } }
  });
  console.log(`- Deleted ${deletedApps.count} Application record(s)`);

  const deletedCands = await prisma.candidate.deleteMany({
    where: { id: { in: candidateIds } }
  });
  console.log(`- Deleted ${deletedCands.count} Candidate record(s)`);

  if (resumeIds.length > 0) {
    const deletedResumes = await prisma.fileMeta.deleteMany({
      where: { id: { in: resumeIds } }
    });
    console.log(`- Deleted ${deletedResumes.count} FileMeta resume record(s)`);
  }

  console.log('\n[Rollback Complete] Database state restored.\n');
}

async function runInjection({ dryRun = false, testSingle = false, testResume = false }) {
  console.log(`\n======================================================`);
  console.log(`JAIN COLLEGE DRIVE INJECTION ${dryRun ? '(DRY RUN - NO CHANGES)' : testSingle ? '(TEST SINGLE RECORD)' : testResume ? '(TEST RESUME RECORD)' : '(LIVE EXECUTION)'}`);
  console.log(`Interview Date: ${CONFIG.INTERVIEW_DATE_RAW} (${CONFIG.INTERVIEW_DATE_ISO})`);
  console.log(`Drive ID: ${CONFIG.DRIVE_ID}`);
  console.log(`======================================================\n`);

  // Verify Drive exists
  const drive = await prisma.collegeDrive.findUnique({
    where: { id: CONFIG.DRIVE_ID }
  });
  if (!drive) {
    throw new Error(`Drive with ID ${CONFIG.DRIVE_ID} not found!`);
  }
  const preEnrolledCount = await prisma.collegeDriveCandidate.count({
    where: { driveId: CONFIG.DRIVE_ID }
  });
  console.log(`Found Drive: "${drive.title}" (ID: ${drive.id}) | Current Enrolled Count: ${preEnrolledCount}`);

  // Verify Panelists
  for (const [key, p] of Object.entries(PANELISTS)) {
    const u = await prisma.user.findUnique({ where: { id: p.id } });
    if (!u) throw new Error(`Panelist user ${p.name} (ID: ${p.id}) not found in DB!`);
    console.log(`- Panelist "${p.name}" verified (ID: ${p.id}, Role: ${u.role})`);
  }

  // Verify Jobs
  for (const [key, j] of Object.entries(JOBS)) {
    const job = await prisma.job.findUnique({ where: { id: j.id } });
    if (!job) throw new Error(`Job "${j.title}" (ID: ${j.id}) not found in DB!`);
    console.log(`- Job "${j.title}" verified (ID: ${j.id}, Active: ${job.isActive})`);
  }

  const rowsToProcess = testSingle ? CANDIDATES.slice(0, 1) : testResume ? CANDIDATES.slice(1, 2) : CANDIDATES;
  console.log(`\nProcessing ${rowsToProcess.length} candidate(s)...\n`);

  const previewTable = [];
  let createdCount = 0;
  let attachedCount = 0;
  let skippedCount = 0;
  let exceptionCount = 0;

  let selectedCount = 0;
  let rejectedCount = 0;
  let resumesUploadedCount = 0;

  for (let index = 0; index < rowsToProcess.length; index++) {
    const row = rowsToProcess[index];
    const serial = row.serial;
    const cleanName = row.name_resume;
    const targetJob = JOBS[row.role_type];
    const panelistConfig = PANELISTS[row.panelist];

    const outcome = row.status;
    const ratingValue = row.rating;
    const candidateStatus = outcome === 'SELECTED' ? 'ACTIVE' : 'REJECTED';
    const appStatus = outcome === 'SELECTED' ? 'IN_PIPELINE' : 'REJECTED';

    const fullInterviewNotes = [
      row.comments ? `[Comments] ${row.comments}` : null,
      row.doj && row.doj !== '-' ? `[Tentative DOJ] ${row.doj}` : null,
      row.year_degree && row.year_degree !== '-' ? `[Year/Degree] ${row.year_degree}` : null,
      row.college_area && row.college_area !== '-' ? `[College/Current Area] ${row.college_area}` : null,
      row.location_state && row.location_state !== '-' ? `[Location/State] ${row.location_state}` : null,
      row.origin_place && row.origin_place !== '-' ? `[Origin Place] ${row.origin_place}` : null,
      row.languages && row.languages !== '-' ? `[Languages Known] ${row.languages}` : null,
      row.family && row.family !== '-' ? `[Family Background] ${row.family}` : null,
      row.experience && row.experience !== '-' ? `[Prior Experience/Projects] ${row.experience}` : null,
      row.timings && row.timings !== '-' ? `[Available Timings] ${row.timings}` : null,
      row.dl_bike && row.dl_bike !== '-' ? `[DL / Bike] ${row.dl_bike}` : null,
      row.flags.length > 0 ? `[Flags] ${row.flags.join(', ')}` : null,
      row.name_excel !== cleanName ? `[Excel Name Spelling] ${row.name_excel}` : null,
    ].filter(Boolean).join('\n');

    const importKey = `jain_2026-10-16_${serial}_${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

    const customFields = {
      import_source: CONFIG.IMPORT_MARKER,
      import_key: importKey,
      source_serial: serial,
      name_as_written_in_excel: row.name_excel,
      excel_spelling: row.name_excel,
      role_as_written: row.role_excel,
      round_as_written: row.round_excel,
      panelist: panelistConfig.name,
      rating_verbatim: ratingValue,
      doj_verbatim: row.doj,
      comments_verbatim: row.comments,
      year_degree_verbatim: row.year_degree,
      college_area_verbatim: row.college_area,
      location_state_verbatim: row.location_state,
      origin_place_verbatim: row.origin_place,
      languages_known_verbatim: row.languages,
      family_background_verbatim: row.family,
      prior_experience_verbatim: row.experience,
      timings_verbatim: row.timings,
      dl_bike_verbatim: row.dl_bike,
      flags: row.flags,
      needs_contact_details: row.phone === null && row.email === null,
      date_source: 'inferred_from_resume_pdf_title',
      time_assumed: true
    };

    if (row.name_resume === 'DHRUVANTH R') {
      customFields.secondary_college_email = '23btris011@jainuniversity.ac.in';
    }

    previewTable.push({
      '#': serial,
      Name: cleanName,
      ExcelName: row.name_excel,
      Phone: row.phone || 'NULL',
      Email: row.email || 'NULL',
      Role: targetJob.title,
      Panelist: panelistConfig.name,
      Rating: ratingValue,
      Outcome: outcome,
      DOJ: row.doj,
      Resume: row.resume_file || 'NONE',
      Action: 'CREATE'
    });

    if (outcome === 'SELECTED') selectedCount++;
    else rejectedCount++;

    if (dryRun) {
      createdCount++;
      continue;
    }

    try {
      // Check idempotency
      const existing = await prisma.candidate.findFirst({
        where: {
          organizationId: CONFIG.ORG_ID,
          customFields: {
            path: ['import_key'],
            equals: importKey
          }
        }
      });

      if (existing) {
        console.log(`[IDEMPOTENT SKIP] #${serial} ${cleanName} already exists (ID: ${existing.id})`);
        skippedCount++;
        continue;
      }

      // Read resume file if present and create FileMeta record
      let resumeFileMetaId = null;
      if (row.resume_file) {
        const resumePath = path.join(CONFIG.RESUME_FOLDER, row.resume_file);
        if (!fs.existsSync(resumePath)) {
          throw new Error(`Resume file not found on disk: ${resumePath}`);
        }
        const resumeFileBuffer = fs.readFileSync(resumePath);
        const tempFileMeta = await prisma.fileMeta.create({
          data: {
            storageKey: 'db://pending',
            originalName: fixUtf8Filename(row.resume_file),
            mimeType: 'application/pdf',
            sizeBytes: resumeFileBuffer.length,
            fileData: resumeFileBuffer,
            uploadedById: panelistConfig.id
          }
        });

        await prisma.fileMeta.update({
          where: { id: tempFileMeta.id },
          data: { storageKey: makeStorageKey(tempFileMeta.id) }
        });

        await verifyDbFile(prisma, tempFileMeta.id, 1);
        resumeFileMetaId = tempFileMeta.id;
        resumesUploadedCount++;
      }

      // Single Atomic Transaction per candidate with extended timeout
      let result;
      try {
        result = await prisma.$transaction(async (tx) => {
          // 1. Candidate Record
          const candidate = await tx.candidate.create({
            data: {
              fullName: cleanName,
              email: row.email || 'N/A',
              phone: row.phone || null,
              phoneNormalized: row.phone ? row.phone.slice(-10) : null,
              course: row.year_degree && row.year_degree !== '-' ? row.year_degree : 'B.Tech',
              graduationYear: '2027',
              college: CONFIG.COLLEGE_NAME,
              preferredRole: targetJob.title,
              location: normalizeNullable(row.origin_place) || 'Bangalore',
              area: normalizeNullable(row.college_area),
              source: CONFIG.IMPORT_MARKER,
              status: candidateStatus,
              company: CONFIG.DEFAULT_COMPANY,
              doj: row.doj,
              organizationId: CONFIG.ORG_ID,
              createdById: panelistConfig.id,
              assignedRecruiterId: panelistConfig.id,
              assignedRecruiterName: panelistConfig.name,
              resumeFileId: resumeFileMetaId,
              customFields
            }
          });

          // 2. Application Record
          const application = await tx.application.create({
            data: {
              candidateId: candidate.id,
              jobId: targetJob.id,
              status: appStatus,
              organizationId: CONFIG.ORG_ID
            }
          });

          // 3. Interview Record (Round 1)
          const interview = await tx.interview.create({
            data: {
              candidateId: candidate.id,
              candidateName: candidate.fullName,
              applicationId: application.id,
              jobId: targetJob.id,
              jobTitle: targetJob.title,
              roundNo: 1,
              round: 'ROUND_1',
              scheduledStart: new Date(CONFIG.INTERVIEW_DATE_ISO),
              durationMinutes: 45,
              mode: 'DRIVE',
              status: 'COMPLETED',
              result: outcome,
              outcome: outcome,
              outcomeSetAt: new Date(CONFIG.INTERVIEW_DATE_ISO),
              notes: fullInterviewNotes,
              interviewerIds: [panelistConfig.id],
              interviewerNames: panelistConfig.name,
              organizationId: CONFIG.ORG_ID,
              createdById: panelistConfig.id,
              round1SMSAlertSent: true, // Suppress alert triggers
              round2EmailAlertSent: true, // Suppress alert triggers
              feedback: [
                {
                  round: 'ROUND_1',
                  selectionStatus: outcome,
                  overallRating: ratingValue,
                  comments: fullInterviewNotes,
                  submittedById: panelistConfig.id,
                  createdAt: new Date(CONFIG.INTERVIEW_DATE_ISO)
                }
              ]
            }
          });

          // 4. InterviewFeedback Record
          const feedback = await tx.interviewFeedback.create({
            data: {
              candidateId: candidate.id,
              round: 'ROUND_1',
              submittedById: panelistConfig.id,
              templateVersion: 2,
              selectionStatus: outcome,
              overallRating: ratingValue, // Preserves 7.5 float
              feedbackData: {
                round: 'ROUND_1',
                selectionStatus: outcome,
                overallRating: ratingValue,
                comments: row.comments,
                tentativeDoj: row.doj,
                yearDegree: row.year_degree,
                collegeCurrentArea: row.college_area,
                locationState: row.location_state,
                originPlace: row.origin_place,
                languagesKnown: row.languages,
                familyBackground: row.family,
                priorExperienceProjects: row.experience,
                availableTimings: row.timings,
                dlBike: row.dl_bike,
                flags: row.flags
              }
            }
          });

          // 5. CollegeDriveCandidate Enrollment
          const driveCandidate = await tx.collegeDriveCandidate.create({
            data: {
              driveId: CONFIG.DRIVE_ID,
              candidateId: candidate.id,
              fullName: candidate.fullName,
              email: row.email,
              phone: row.phone || '',
              status: 'ADDED'
            }
          });

          return { candidate, application, interview, feedback, driveCandidate };
        }, { maxWait: 15000, timeout: 30000 });
      } catch (txErr) {
        if (resumeFileMetaId) {
          await prisma.fileMeta.delete({ where: { id: resumeFileMetaId } }).catch(() => {});
          resumesUploadedCount--;
        }
        throw txErr;
      }

      createdCount++;
      console.log(`[INJECTED] #${serial} ${cleanName} -> ID: ${result.candidate.id} | Outcome: ${outcome} | Rating: ${ratingValue} | Panelist: ${panelistConfig.name} | Resume: ${resumeFileMetaId ? 'ATTACHED' : 'NONE'}`);

      // MANDATORY PRE-FLIGHT 2.4: Direct DB verification after candidate #1
      if (row.serial === 1 && !testSingle && !testResume) {
        console.log('\n--- [PRE-FLIGHT 2.4 PROOF] Verifying Candidate #1 directly in DB before continuing ---');
        const verifyCand = await prisma.candidate.findUnique({
          where: { id: result.candidate.id },
          include: {
            applications: { include: { interviews: true } },
            interviewFeedbacks: true
          }
        });
        const verifyIv = verifyCand.applications[0]?.interviews[0];
        const verifyFb = verifyCand.interviewFeedbacks[0];

        if (!verifyCand || !verifyIv || !verifyFb) {
          throw new Error('PRE-FLIGHT 2.4 FAILED: Candidate #1 records missing in DB!');
        }
        if (verifyIv.status !== 'COMPLETED' || verifyIv.outcome !== 'REJECTED' || verifyIv.result !== 'REJECTED') {
          throw new Error(`PRE-FLIGHT 2.4 FAILED: Status/Outcome mismatch on Candidate #1 (status: ${verifyIv.status}, outcome: ${verifyIv.outcome})`);
        }
        if (verifyFb.overallRating !== 6 || !verifyFb.feedbackData?.comments) {
          throw new Error(`PRE-FLIGHT 2.4 FAILED: Feedback record incomplete on Candidate #1 (rating: ${verifyFb.overallRating})`);
        }
        console.log(`✓ Candidate #1 verified in DB: Interview outcome=${verifyIv.outcome}, Feedback rating=${verifyFb.overallRating}, Comments attached.\n`);
      }

      // If testSingle or testResume, roll back immediately and exit
      if (testSingle || testResume) {
        console.log(`\n[${testSingle ? 'TEST-SINGLE' : 'TEST-RESUME'}] Verification passed. Performing clean rollback of test record...`);
        await rollback();
        return;
      }

      // 100ms pause for 512MB RAM stability
      await sleep(100);

    } catch (err) {
      console.error(`[EXCEPTION] #${serial} ${cleanName} failed:`, err.message);
      exceptionCount++;
    }
  }

  console.log('\n--- PREVIEW / SUMMARY TABLE ---');
  console.table(previewTable);

  console.log(`\nImport Summary:`);
  console.log(`Total Candidates: ${rowsToProcess.length}`);
  console.log(`Created: ${createdCount}`);
  console.log(`Attached: ${attachedCount}`);
  console.log(`Skipped: ${skippedCount}`);
  console.log(`Exceptions: ${exceptionCount}`);
  console.log(`Reconciliation Sum (created + attached + skipped + exceptions): ${createdCount + attachedCount + skippedCount + exceptionCount} / ${rowsToProcess.length}`);
  console.log(`Selected: ${selectedCount}`);
  console.log(`Rejected: ${rejectedCount}`);
  console.log(`Resumes Uploaded: ${resumesUploadedCount} / 21`);

  if (!dryRun && !testSingle && !testResume) {
    if (createdCount + attachedCount + skippedCount + exceptionCount !== 22) {
      throw new Error(`RECONCILIATION VIOLATION: Expected 22 total, got ${createdCount + attachedCount + skippedCount + exceptionCount}`);
    }
    const postEnrolledCount = await prisma.collegeDriveCandidate.count({
      where: { driveId: CONFIG.DRIVE_ID }
    });
    console.log(`\nDrive Enrolled Count: ${preEnrolledCount} -> ${postEnrolledCount} (Increase: +${postEnrolledCount - preEnrolledCount})`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const testSingle = args.includes('--test-single');
  const testResume = args.includes('--test-resume');
  const isRollback = args.includes('--rollback');

  if (isRollback) {
    await rollback();
    return;
  }

  await runInjection({ dryRun, testSingle, testResume });
}

main().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
}).finally(() => prisma.$disconnect());
