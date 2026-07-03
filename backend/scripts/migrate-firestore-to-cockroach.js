/**
 * scripts/migrate-firestore-to-cockroach.js
 * One-time data migration: Firestore → CockroachDB (via Prisma)
 *
 * SAFE: Read-only on Firestore. Never deletes Firestore data.
 * Run with: node scripts/migrate-firestore-to-cockroach.js
 *
 * Optional env flags:
 *   MIGRATE_BATCH_SIZE=100  (default: 100)
 *   MIGRATE_DRY_RUN=true    (default: false)
 */

require('dotenv').config();

const { initializeApp: initWeb } = require('firebase/app');
const {
  getFirestore,
  collection,
  getDocs,
  query,
  limit,
  startAfter,
} = require('firebase/firestore');
const { PrismaClient } = require('@prisma/client');

const firebaseConfig = {
  apiKey: 'AIzaSyCTNbY9aRSzsEMIOWXQOEoqZP3xote1fN4',
  authDomain: 'ats-5acc5.firebaseapp.com',
  databaseURL: 'https://ats-5acc5-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'ats-5acc5',
  storageBucket: 'ats-5acc5.firebasestorage.app',
  messagingSenderId: '272298077380',
  appId: '1:272298077380:web:597e95106877a764be2d91',
};

const BATCH_SIZE = parseInt(process.env.MIGRATE_BATCH_SIZE || '100', 10);
const DRY_RUN = process.env.MIGRATE_DRY_RUN === 'true';

const webApp = initWeb(firebaseConfig);
const firestoreDb = getFirestore(webApp);
const prisma = new PrismaClient({ log: ['error'] });

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchAllFromCollection(collectionName) {
  const docs = [];
  let lastDoc = null;
  let page = 0;

  while (true) {
    page++;
    let q;
    if (lastDoc) {
      q = query(collection(firestoreDb, collectionName), startAfter(lastDoc), limit(BATCH_SIZE));
    } else {
      q = query(collection(firestoreDb, collectionName), limit(BATCH_SIZE));
    }

    const snap = await getDocs(q).catch(() => ({ empty: true, docs: [] }));
    if (snap.empty) break;

    snap.docs.forEach(doc => docs.push({ id: doc.id, ...doc.data() }));
    lastDoc = snap.docs[snap.docs.length - 1];

    process.stdout.write(`\r  📄 ${collectionName}: fetched ${docs.length} docs (page ${page})...`);

    if (snap.docs.length < BATCH_SIZE) break;
  }

  process.stdout.write('\n');
  return docs;
}

function toDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'object' && val._seconds) {
    return new Date(val._seconds * 1000);
  }
  return null;
}

function toInt(val) {
  if (val === null || val === undefined) return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

function toFloat(val) {
  if (val === null || val === undefined) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function toBool(val, def = false) {
  if (val === null || val === undefined) return def;
  return Boolean(val);
}

function safeJson(val) {
  if (val === null || val === undefined) return undefined;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return val; }
  }
  return val;
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration Functions
// ─────────────────────────────────────────────────────────────────────────────

async function migrateUsers(docs, userIds) {
  console.log(`\n👥 Migrating ${docs.length} users...`);
  let ok = 0, skip = 0;

  for (const doc of docs) {
    try {
      const role = ['SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER'].includes(doc.role) ? doc.role : 'RECRUITER';
      const status = ['ACTIVE', 'INACTIVE', 'PENDING'].includes(doc.status) ? doc.status : 'PENDING';

      if (!DRY_RUN) {
        await prisma.user.upsert({
          where: { id: doc.id },
          update: {},
          create: {
            id: doc.id,
            fullName: String(doc.fullName || 'Unknown'),
            email: String(doc.email || `${doc.id}@placeholder.com`).toLowerCase(),
            phone: doc.phone || null,
            passwordHash: doc.passwordHash || doc.password || null,
            role,
            status,
            organizationId: doc.organizationId || 'defaultOrg',
            isActive: toBool(doc.isActive, true),
            isDeleted: toBool(doc.isDeleted, false),
            deletedAt: toDate(doc.deletedAt),
            deletedBy: doc.deletedBy || null,
            userType: doc.userType || null,
            department: doc.department || null,
            designation: doc.designation || null,
            employeeId: doc.employeeId || null,
            reportingTo: doc.reportingTo || null,
            maxActiveCandidates: toInt(doc.maxActiveCandidates),
            profilePhotoUrl: doc.profilePhotoUrl || null,
            createdAt: toDate(doc.createdAt) || new Date(),
            updatedAt: toDate(doc.updatedAt) || new Date(),
          },
        });
      }
      userIds.add(doc.id);
      ok++;
    } catch (err) {
      console.error(`  ❌ User ${doc.id}: ${err.message}`);
      skip++;
    }
  }
  console.log(`  ✅ Users: ${ok} migrated, ${skip} skipped`);
}

async function migrateSessions(docs, userIds) {
  console.log(`\n🔐 Migrating ${docs.length} sessions...`);
  let ok = 0, skip = 0;

  for (const doc of docs) {
    try {
      if (!userIds.has(doc.userId)) {
        skip++;
        continue;
      }
      
      if (!DRY_RUN) {
        await prisma.session.upsert({
          where: { id: doc.id },
          update: {},
          create: {
            id: doc.id,
            userId: doc.userId,
            device: doc.device || null,
            ipAddress: doc.ipAddress || null,
            location: doc.location || null,
            lastActive: toDate(doc.lastActive) || new Date(),
            createdAt: toDate(doc.createdAt) || new Date(),
          },
        });
      }
      ok++;
    } catch (err) {
      skip++;
    }
  }
  console.log(`  ✅ Sessions: ${ok} migrated, ${skip} skipped`);
}

async function migrateFileMetas(docs, fileMetaIds) {
  console.log(`\n📁 Migrating ${docs.length} fileMetas...`);
  let ok = 0, skip = 0;

  for (const doc of docs) {
    try {
      if (!DRY_RUN) {
        await prisma.fileMeta.upsert({
          where: { id: doc.id },
          update: {},
          create: {
            id: doc.id,
            storageKey: String(doc.storageKey || ''),
            originalName: doc.originalName || null,
            mimeType: doc.mimeType || null,
            sizeBytes: toInt(doc.sizeBytes),
            uploadedById: doc.uploadedById || null,
            createdAt: toDate(doc.createdAt) || new Date(),
          },
        });
      }
      fileMetaIds.add(doc.id);
      ok++;
    } catch (err) {
      console.error(`  ❌ FileMeta ${doc.id}: ${err.message}`);
      skip++;
    }
  }
  console.log(`  ✅ FileMetas: ${ok} migrated, ${skip} skipped`);
}

async function migrateCandidates(docs, candidateIds, userIds, fileMetaIds) {
  console.log(`\n🧑 Migrating ${docs.length} candidates...`);
  let ok = 0, skip = 0;
  const CONCURRENCY = 50;

  for (let i = 0; i < docs.length; i += CONCURRENCY) {
    const chunk = docs.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (doc) => {
      try {
        const createdById = userIds.has(doc.createdById) ? doc.createdById : null;
        const assignedRecruiterId = userIds.has(doc.assignedRecruiterId) ? doc.assignedRecruiterId : null;
        const mentorId = userIds.has(doc.mentorId) ? doc.mentorId : null;
        const resumeFileId = fileMetaIds.has(doc.resumeFileId) ? doc.resumeFileId : null;
        const profilePhotoFileId = fileMetaIds.has(doc.profilePhotoFileId) ? doc.profilePhotoFileId : null;

        if (!DRY_RUN) {
          await prisma.candidate.upsert({
            where: { id: doc.id },
            update: {},
            create: {
              id: doc.id,
              fullName: String(doc.fullName || 'Unknown'),
              email: String(doc.email || 'N/A'),
              phone: doc.phone || null,
              currentCompany: doc.currentCompany || null,
              totalExperienceYears: toFloat(doc.totalExperienceYears),
              location: doc.location || null,
              area: doc.area || null,
              course: doc.course || null,
              graduationYear: doc.graduationYear ? String(doc.graduationYear) : null,
              preferredRole: doc.preferredRole || null,
              source: doc.source || null,
              jobTitle: doc.jobTitle || null,
              category: doc.category || null,
              status: doc.status || 'ACTIVE',
              currentStage: doc.currentStage || null,
              organizationId: doc.organizationId || 'defaultOrg',
              isDeleted: toBool(doc.isDeleted, false),
              deletedAt: toDate(doc.deletedAt),
              resumeFileId,
              profilePhotoFileId,
              createdById,
              assignedRecruiterId,
              assignedRecruiterName: doc.assignedRecruiterName || null,
              mentorId,
              offerDecision: doc.offerDecision || null,
              doj: doc.doj || null,
              customFields: safeJson(doc.customFields) || undefined,
              createdAt: toDate(doc.createdAt) || new Date(),
              updatedAt: toDate(doc.updatedAt) || new Date(),
            },
          });
        }
        candidateIds.add(doc.id);
        ok++;
      } catch (err) {
        console.error(`  ❌ Candidate ${doc.id}: ${err.message}`);
        skip++;
      }
    }));
    process.stdout.write(`\r  Progress: ${ok + skip}/${docs.length}...`);
  }
  process.stdout.write('\n');
  console.log(`  ✅ Candidates: ${ok} migrated, ${skip} skipped`);
}

async function migrateJobs(docs, jobIds, userIds) {
  console.log(`\n💼 Migrating ${docs.length} jobs...`);
  let ok = 0, skip = 0;

  for (const doc of docs) {
    try {
      const createdById = userIds.has(doc.createdById) ? doc.createdById : null;

      if (!DRY_RUN) {
        await prisma.job.upsert({
          where: { id: doc.id },
          update: {},
          create: {
            id: doc.id,
            title: String(doc.title || 'Untitled'),
            department: doc.department || null,
            location: doc.location || null,
            employmentType: doc.employmentType || null,
            experienceMin: toFloat(doc.experienceMin),
            experienceMax: toFloat(doc.experienceMax),
            openingsCount: toInt(doc.openingsCount) || 1,
            description: doc.description || null,
            isActive: toBool(doc.isActive, true),
            organizationId: doc.organizationId || 'defaultOrg',
            createdById,
            createdAt: toDate(doc.createdAt) || new Date(),
            updatedAt: toDate(doc.updatedAt) || new Date(),
          },
        });
      }
      jobIds.add(doc.id);
      ok++;
    } catch (err) {
      console.error(`  ❌ Job ${doc.id}: ${err.message}`);
      skip++;
    }
  }
  console.log(`  ✅ Jobs: ${ok} migrated, ${skip} skipped`);
}

async function migratePipelineStages(docs, stageIds, jobIds) {
  console.log(`\n🔄 Migrating ${docs.length} pipeline_stages...`);
  let ok = 0, skip = 0;

  for (const doc of docs) {
    try {
      const jobId = jobIds.has(doc.jobId) ? doc.jobId : null;

      if (!DRY_RUN) {
        await prisma.pipelineStage.upsert({
          where: { id: doc.id },
          update: {},
          create: {
            id: doc.id,
            jobId,
            name: String(doc.name || 'Stage'),
            sortOrder: toInt(doc.sortOrder) || 0,
            color: doc.color || null,
            description: doc.description || null,
            createdAt: toDate(doc.createdAt) || new Date(),
            updatedAt: toDate(doc.updatedAt) || new Date(),
          },
        });
      }
      stageIds.add(doc.id);
      ok++;
    } catch (err) {
      console.error(`  ❌ PipelineStage ${doc.id}: ${err.message}`);
      skip++;
    }
  }
  console.log(`  ✅ PipelineStages: ${ok} migrated, ${skip} skipped`);
}

async function migrateApplications(docs, applicationIds, candidateIds, jobIds, stageIds) {
  console.log(`\n📝 Migrating ${docs.length} applications...`);
  let ok = 0, skip = 0;
  const CONCURRENCY = 50;

  for (let i = 0; i < docs.length; i += CONCURRENCY) {
    const chunk = docs.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (doc) => {
      try {
        if (!candidateIds.has(doc.candidateId) || !jobIds.has(doc.jobId)) {
          skip++;
          return;
        }
        const currentStageId = stageIds.has(doc.currentStageId) ? doc.currentStageId : null;

        if (!DRY_RUN) {
          await prisma.application.upsert({
            where: { id: doc.id },
            update: {},
            create: {
              id: doc.id,
              candidateId: doc.candidateId,
              jobId: doc.jobId,
              currentStageId,
              shortlisted: toBool(doc.shortlisted, false),
              status: doc.status || 'IN_PIPELINE',
              joiningDate: doc.joiningDate || null,
              organizationId: doc.organizationId || 'defaultOrg',
              isDeleted: toBool(doc.isDeleted, false),
              createdAt: toDate(doc.createdAt) || new Date(),
              updatedAt: toDate(doc.updatedAt) || new Date(),
            },
          });
        }
        applicationIds.add(doc.id);
        ok++;
      } catch (err) {
        skip++;
      }
    }));
    process.stdout.write(`\r  Progress: ${ok + skip}/${docs.length}...`);
  }
  process.stdout.write('\n');
  console.log(`  ✅ Applications: ${ok} migrated, ${skip} skipped`);
}

async function migratePipelineEvents(docs, applicationIds, stageIds) {
  console.log(`\n📌 Migrating ${docs.length} pipeline_events...`);
  let ok = 0, skip = 0;

  for (const doc of docs) {
    try {
      if (!applicationIds.has(doc.applicationId)) {
        skip++;
        continue;
      }
      const fromStageId = stageIds.has(doc.fromStageId) ? doc.fromStageId : null;
      const toStageId = stageIds.has(doc.toStageId) ? doc.toStageId : null;

      if (!DRY_RUN) {
        await prisma.pipelineEvent.upsert({
          where: { id: doc.id },
          update: {},
          create: {
            id: doc.id,
            applicationId: doc.applicationId,
            fromStageId,
            toStageId,
            remark: doc.remark || null,
            movedById: doc.movedById || null,
            movedByName: doc.movedByName || null,
            movedAt: toDate(doc.movedAt) || new Date(),
          },
        });
      }
      ok++;
    } catch (err) {
      skip++;
    }
  }
  console.log(`  ✅ PipelineEvents: ${ok} migrated, ${skip} skipped`);
}

async function migrateInterviews(docs, applicationIds) {
  console.log(`\n🎤 Migrating ${docs.length} interviews...`);
  let ok = 0, skip = 0;
  const CONCURRENCY = 50;

  for (let i = 0; i < docs.length; i += CONCURRENCY) {
    const chunk = docs.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (doc) => {
      try {
        const applicationId = applicationIds.has(doc.applicationId) ? doc.applicationId : null;

        if (!DRY_RUN) {
          await prisma.interview.upsert({
            where: { id: doc.id },
            update: {},
            create: {
              id: doc.id,
              applicationId,
              candidateId: doc.candidateId || null,
              candidateName: doc.candidateName || null,
              jobId: doc.jobId || null,
              jobTitle: doc.jobTitle || null,
              roundNo: toInt(doc.roundNo) || 1,
              round: doc.round || null,
              scheduledStart: toDate(doc.scheduledStart),
              durationMinutes: toInt(doc.durationMinutes) || 60,
              mode: doc.mode || 'VIRTUAL',
              meetingLink: doc.meetingLink || null,
              zohoLink: doc.zohoLink || null,
              status: doc.status || 'SCHEDULED',
              result: doc.result || null,
              outcome: doc.outcome || null,
              outcomeSetAt: toDate(doc.outcomeSetAt),
              notes: doc.notes || null,
              organizationId: doc.organizationId || 'defaultOrg',
              createdById: doc.createdById || null,
              interviewerIds: Array.isArray(doc.interviewerIds) ? doc.interviewerIds : [],
              interviewerNames: doc.interviewerNames || null,
              feedback: Array.isArray(doc.feedback) ? doc.feedback : (Array.isArray(doc.feedbacks) ? doc.feedbacks : []),
              rescheduleHistory: Array.isArray(doc.rescheduleHistory) ? doc.rescheduleHistory : [],
              transferHistory: Array.isArray(doc.transferHistory) ? doc.transferHistory : [],
              offerLetterUrl: doc.offerLetterUrl || null,
              voiceRecordingFileId: doc.voiceRecordingFileId || null,
              voiceRecordingUrl: doc.voiceRecordingUrl || null,
              createdAt: toDate(doc.createdAt) || new Date(),
              updatedAt: toDate(doc.updatedAt) || new Date(),
            },
          });
        }
        ok++;
      } catch (err) {
        console.error(`  ❌ Interview ${doc.id}: ${err.message}`);
        skip++;
      }
    }));
    process.stdout.write(`\r  Progress: ${ok + skip}/${docs.length}...`);
  }
  process.stdout.write('\n');
  console.log(`  ✅ Interviews: ${ok} migrated, ${skip} skipped`);
}

async function migrateNotifications(docs, userIds) {
  console.log(`\n🔔 Migrating ${docs.length} notifications...`);
  let ok = 0, skip = 0;
  const CONCURRENCY = 50;

  for (let i = 0; i < docs.length; i += CONCURRENCY) {
    const chunk = docs.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (doc) => {
      try {
        if (!userIds.has(doc.userId)) {
          skip++;
          return;
        }

        if (!DRY_RUN) {
          await prisma.notification.upsert({
            where: { id: doc.id },
            update: {},
            create: {
              id: doc.id,
              userId: doc.userId,
              title: String(doc.title || ''),
              message: String(doc.message || ''),
              link: doc.link || null,
              type: doc.type || 'INFO',
              isRead: toBool(doc.isRead, false),
              createdAt: toDate(doc.createdAt) || new Date(),
            },
          });
        }
        ok++;
      } catch (err) {
        skip++;
      }
    }));
    process.stdout.write(`\r  Progress: ${ok + skip}/${docs.length}...`);
  }
  process.stdout.write('\n');
  console.log(`  ✅ Notifications: ${ok} migrated, ${skip} skipped`);
}

async function migrateAuditLogs(docs, userIds) {
  console.log(`\n📋 Migrating ${docs.length} auditLogs...`);
  let ok = 0, skip = 0;
  const CONCURRENCY = 50;

  for (let i = 0; i < docs.length; i += CONCURRENCY) {
    const chunk = docs.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (doc) => {
      try {
        const actorUserId = userIds.has(doc.actorUserId) ? doc.actorUserId : null;

        if (!DRY_RUN) {
          await prisma.auditLog.upsert({
            where: { id: doc.id },
            update: {},
            create: {
              id: doc.id,
              actorUserId,
              actorName: doc.actorName || null,
              actorEmail: doc.actorEmail || null,
              actorRole: doc.actorRole || null,
              action: String(doc.action || 'UNKNOWN'),
              entityType: String(doc.entityType || 'UNKNOWN'),
              entityId: doc.entityId || null,
              entityName: doc.entityName || null,
              oldData: safeJson(doc.oldData) || undefined,
              newData: safeJson(doc.newData) || undefined,
              metadata: safeJson(doc.metadata) || undefined,
              ipAddress: doc.ipAddress || null,
              userAgent: doc.userAgent || null,
              organizationId: doc.organizationId || 'defaultOrg',
              isDeleted: toBool(doc.isDeleted, false),
              createdAt: toDate(doc.createdAt) || new Date(),
            },
          });
        }
        ok++;
      } catch (err) {
        skip++;
      }
    }));
    process.stdout.write(`\r  Progress: ${ok + skip}/${docs.length}...`);
  }
  process.stdout.write('\n');
  console.log(`  ✅ AuditLogs: ${ok} migrated, ${skip} skipped`);
}

async function migrateJobDocuments(docs, jobIds) {
  console.log(`\n📄 Migrating ${docs.length} job_documents...`);
  let ok = 0, skip = 0;

  for (const doc of docs) {
    try {
      if (!jobIds.has(doc.jobId)) {
        skip++;
        continue;
      }

      if (!DRY_RUN) {
        await prisma.jobDocument.upsert({
          where: { id: doc.id },
          update: {},
          create: {
            id: doc.id,
            jobId: doc.jobId,
            type: String(doc.type || 'DOCUMENT'),
            googleDriveLink: doc.googleDriveLink || null,
            uploadedById: doc.uploadedById || null,
            uploadedByName: doc.uploadedByName || null,
            uploadedAt: toDate(doc.uploadedAt) || new Date(),
            updatedAt: toDate(doc.updatedAt) || new Date(),
          },
        });
      }
      ok++;
    } catch (err) {
      skip++;
    }
  }
  console.log(`  ✅ JobDocuments: ${ok} migrated, ${skip} skipped`);
}

async function migrateJobQuestions(docs, jobIds) {
  console.log(`\n❓ Migrating ${docs.length} job_questions...`);
  let ok = 0, skip = 0;

  for (const doc of docs) {
    try {
      if (!jobIds.has(doc.jobId)) {
        skip++;
        continue;
      }

      if (!DRY_RUN) {
        await prisma.jobQuestion.upsert({
          where: { id: doc.id },
          update: {},
          create: {
            id: doc.id,
            jobId: doc.jobId,
            question: String(doc.question || ''),
            competency: doc.competency || null,
            difficulty: doc.difficulty || null,
            addedById: doc.addedById || null,
            addedByName: doc.addedByName || null,
            createdAt: toDate(doc.createdAt) || new Date(),
            updatedAt: toDate(doc.updatedAt) || new Date(),
          },
        });
      }
      ok++;
    } catch (err) {
      skip++;
    }
  }
  console.log(`  ✅ JobQuestions: ${ok} migrated, ${skip} skipped`);
}

async function migrateColleges(docs, collegeIds) {
  console.log(`\n🏫 Migrating ${docs.length} colleges...`);
  let ok = 0, skip = 0;

  for (const doc of docs) {
    try {
      if (!DRY_RUN) {
        await prisma.college.upsert({
          where: { id: doc.id },
          update: {},
          create: {
            id: doc.id,
            name: String(doc.name || 'Unknown'),
            location: doc.location || null,
            area: doc.area || null,
            year: doc.year || null,
            role: doc.role || null,
            course: doc.course || null,
            createdById: doc.createdById || null,
            createdAt: toDate(doc.createdAt) || new Date(),
            updatedAt: toDate(doc.updatedAt) || new Date(),
          },
        });
      }
      collegeIds.add(doc.id);
      ok++;
    } catch (err) {
      console.error(`  ❌ College ${doc.id}: ${err.message}`);
      skip++;
    }
  }
  console.log(`  ✅ Colleges: ${ok} migrated, ${skip} skipped`);
}

async function migrateCollegeDrives(docs, driveIds, collegeIds) {
  console.log(`\n🎓 Migrating ${docs.length} college_drives...`);
  let ok = 0, skip = 0;

  for (const doc of docs) {
    try {
      const collegeId = collegeIds.has(doc.collegeId) ? doc.collegeId : 'unknownCollege';

      if (!DRY_RUN) {
        await prisma.collegeDrive.upsert({
          where: { id: doc.id },
          update: {},
          create: {
            id: doc.id,
            title: String(doc.title || doc.name || 'College Drive'),
            collegeId,
            dateFrom: doc.dateFrom || doc.driveDate || doc.date || new Date().toISOString(),
            dateTo: doc.dateTo || null,
            status: doc.status || 'PLANNED',
            notes: doc.notes || doc.location || doc.description || null,
            ownerId: doc.ownerId || doc.createdById || null,
            organizationId: doc.organizationId || 'defaultOrg',
            recruiters: doc.recruiters || [],
            linkedJobs: doc.linkedJobs || [],
            isDeleted: toBool(doc.isDeleted, false),
            createdAt: toDate(doc.createdAt) || new Date(),
            updatedAt: toDate(doc.updatedAt) || new Date(),
          },
        });
      }
      driveIds.add(doc.id);
      ok++;
    } catch (err) {
      console.error(`  ❌ CollegeDrive ${doc.id}: ${err.message}`);
      skip++;
    }
  }
  console.log(`  ✅ CollegeDrives: ${ok} migrated, ${skip} skipped`);
}

async function migrateCollegeDriveCandidates(docs, driveIds, candidateIds) {
  console.log(`\n🧑‍🎓 Migrating ${docs.length} college_drive_candidates...`);
  let ok = 0, skip = 0;

  for (const doc of docs) {
    try {
      const driveId = driveIds.has(doc.driveId) ? doc.driveId : null;
      const candidateId = candidateIds.has(doc.candidateId) ? doc.candidateId : null;
      
      if (!driveId || !candidateId) {
        skip++;
        continue;
      }

      if (!DRY_RUN) {
        await prisma.collegeDriveCandidate.upsert({
          where: { id: doc.id },
          update: {},
          create: {
            id: doc.id,
            driveId,
            candidateId,
            fullName: doc.fullName || 'Unknown',
            email: doc.email || null,
            phone: doc.phone || 'N/A',
            status: doc.status || 'ADDED',
            createdAt: toDate(doc.createdAt) || new Date(),
            updatedAt: toDate(doc.updatedAt) || new Date(),
          },
        });
      }
      ok++;
    } catch (err) {
      console.error(`  ❌ CollegeDriveCandidate ${doc.id}: ${err.message}`);
      skip++;
    }
  }
  console.log(`  ✅ CollegeDriveCandidates: ${ok} migrated, ${skip} skipped`);
}

async function migrateProducts(docs, productIds) {
  console.log(`\n🛍 Migrating ${docs.length} products...`);
  let ok = 0, skip = 0;

  for (const doc of docs) {
    try {
      if (!DRY_RUN) {
        await prisma.product.upsert({
          where: { id: doc.id },
          update: {},
          create: {
            id: doc.id,
            name: String(doc.name || 'Unknown'),
            category: String(doc.category || 'Unknown'),
            location: doc.location || null,
            description: doc.description || null,
            price: toFloat(doc.price),
            tags: doc.tags || [],
            coordinatorId: doc.coordinatorId || null,
            createdById: doc.createdById || null,
            createdAt: toDate(doc.createdAt) || new Date(),
            updatedAt: toDate(doc.updatedAt) || new Date(),
          },
        });
      }
      productIds.add(doc.id);
      ok++;
    } catch (err) {
      console.error(`  ❌ Product ${doc.id}: ${err.message}`);
      skip++;
    }
  }
  console.log(`  ✅ Products: ${ok} migrated, ${skip} skipped`);
}

async function migrateSalesTracking(docs, productIds) {
  console.log(`\n📈 Migrating ${docs.length} sales tracking...`);
  let ok = 0, skip = 0;

  for (const doc of docs) {
    try {
      if (!productIds.has(doc.productId)) {
        skip++;
        continue;
      }

      if (!DRY_RUN) {
        await prisma.salesTracking.upsert({
          where: { productId: doc.productId }, // upsert uses unique keys, productId is unique here
          update: {},
          create: {
            id: doc.id,
            productId: doc.productId,
            status: doc.status || 'LEAD',
            notes: doc.notes || null,
            followUpDate: doc.followUpDate || null,
            createdAt: toDate(doc.createdAt) || new Date(),
            updatedAt: toDate(doc.updatedAt) || new Date(),
          },
        });
      }
      ok++;
    } catch (err) {
      console.error(`  ❌ SalesTracking ${doc.id}: ${err.message}`);
      skip++;
    }
  }
  console.log(`  ✅ SalesTracking: ${ok} migrated, ${skip} skipped`);
}

async function migrateSalesActivities(docs, productIds) {
  console.log(`\n🗣 Migrating ${docs.length} sales activities...`);
  let ok = 0, skip = 0;

  for (const doc of docs) {
    try {
      if (!productIds.has(doc.productId)) {
        skip++;
        continue;
      }

      if (!DRY_RUN) {
        await prisma.salesActivity.upsert({
          where: { id: doc.id },
          update: {},
          create: {
            id: doc.id,
            productId: doc.productId,
            action: doc.action || 'UNKNOWN',
            details: doc.details || null,
            actorId: doc.actorId || null,
            createdAt: toDate(doc.createdAt) || new Date(),
          },
        });
      }
      ok++;
    } catch (err) {
      console.error(`  ❌ SalesActivity ${doc.id}: ${err.message}`);
      skip++;
    }
  }
  console.log(`  ✅ SalesActivities: ${ok} migrated, ${skip} skipped`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  Firestore → CockroachDB Migration');
  console.log('══════════════════════════════════════════════════');

  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN MODE — No data will be written\n');
  }

  console.log('\n📥 Fetching data from Firestore...');
  const startFetch = Date.now();

  const [
    users, sessions, fileMetas, candidates, jobs,
    pipelineStages, applications, pipelineEvents,
    interviews, notifications, auditLogs,
    jobDocuments, jobQuestions, collegeDrives,
    colleges, collegeDriveCandidates, products,
    salesTracking, salesActivities
  ] = await Promise.all([
    fetchAllFromCollection('users'),
    fetchAllFromCollection('sessions'),
    fetchAllFromCollection('fileMetas'),
    fetchAllFromCollection('candidates'),
    fetchAllFromCollection('jobs'),
    fetchAllFromCollection('pipeline_stages'),
    fetchAllFromCollection('applications'),
    fetchAllFromCollection('pipeline_events'),
    fetchAllFromCollection('interviews'),
    fetchAllFromCollection('notifications'),
    fetchAllFromCollection('auditLogs'),
    fetchAllFromCollection('job_documents'),
    fetchAllFromCollection('job_questions'),
    fetchAllFromCollection('collegeDrives').catch(() => []),
    fetchAllFromCollection('colleges').catch(() => []),
    fetchAllFromCollection('collegeDriveCandidates').catch(() => []),
    fetchAllFromCollection('products').catch(() => []),
    fetchAllFromCollection('sales_tracking').catch(() => []),
    fetchAllFromCollection('sales_activities').catch(() => []),
  ]);

  const fetchMs = Date.now() - startFetch;
  const totalDocs = users.length + sessions.length + fileMetas.length + candidates.length +
    jobs.length + pipelineStages.length + applications.length + pipelineEvents.length +
    interviews.length + notifications.length + auditLogs.length +
    jobDocuments.length + jobQuestions.length + collegeDrives.length +
    colleges.length + collegeDriveCandidates.length + products.length +
    salesTracking.length + salesActivities.length;

  console.log(`\n✅ Fetched ${totalDocs.toLocaleString()} total documents in ${(fetchMs / 1000).toFixed(1)}s`);

  console.log('\n📤 Writing to CockroachDB...');
  const startWrite = Date.now();

  // Keep track of migrated IDs to enforce referential integrity
  const userIds = new Set();
  const fileMetaIds = new Set();
  const candidateIds = new Set();
  const jobIds = new Set();
  const stageIds = new Set();
  const applicationIds = new Set();
  const collegeIds = new Set();
  const driveIds = new Set();
  const productIds = new Set();

  // ORDER MATTERS — respect foreign key dependencies
  await migrateUsers(users, userIds);
  await migrateSessions(sessions, userIds);
  await migrateFileMetas(fileMetas, fileMetaIds);
  await migrateJobs(jobs, jobIds, userIds);
  await migratePipelineStages(pipelineStages, stageIds, jobIds);
  await migrateCandidates(candidates, candidateIds, userIds, fileMetaIds);
  await migrateApplications(applications, applicationIds, candidateIds, jobIds, stageIds);
  await migratePipelineEvents(pipelineEvents, applicationIds, stageIds);
  await migrateInterviews(interviews, applicationIds);
  await migrateNotifications(notifications, userIds);
  await migrateAuditLogs(auditLogs, userIds);
  await migrateJobDocuments(jobDocuments, jobIds);
  await migrateJobQuestions(jobQuestions, jobIds);
  
  await migrateColleges(colleges, collegeIds);
  await migrateCollegeDrives(collegeDrives, driveIds, collegeIds);
  await migrateCollegeDriveCandidates(collegeDriveCandidates, driveIds, candidateIds);
  
  await migrateProducts(products, productIds);
  await migrateSalesTracking(salesTracking, productIds);
  await migrateSalesActivities(salesActivities, productIds);

  const writeMs = Date.now() - startWrite;
  console.log(`\n⏱  Migration completed in ${(writeMs / 1000).toFixed(1)}s`);
  console.log('\n══════════════════════════════════════════════════');
  console.log('  ✅ Migration COMPLETE!');
  console.log('  Run: node scripts/test-cockroach.js to verify');
  console.log('══════════════════════════════════════════════════\n');
}

main()
  .catch(err => {
    console.error('\n❌ Migration FAILED:', err.message);
    console.error(err.stack);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
