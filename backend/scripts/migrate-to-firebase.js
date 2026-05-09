const { PrismaClient } = require("@prisma/client");
const admin = require("firebase-admin");
require("dotenv").config();

// Initialize Firebase Admin
// We use minimal config if no service account is found
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
} else {
  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID,
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

const db = admin.firestore();
const prisma = new PrismaClient();

async function migrate() {
  console.log("🚀 Starting migration from Neon (Prisma) to Firebase (Firestore)...");

  try {
    // 1. Users
    console.log("Migrating Users...");
    const users = await prisma.user.findMany();
    for (const user of users) {
      await db.collection("users").doc(user.id).set({
        ...user,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      });
    }
    console.log(`✅ Migrated ${users.length} users.`);

    // 2. Jobs
    console.log("Migrating Jobs...");
    const jobs = await prisma.job.findMany();
    for (const job of jobs) {
      await db.collection("jobs").doc(job.id).set({
        ...job,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      });
    }
    console.log(`✅ Migrated ${jobs.length} jobs.`);

    // 3. Candidates
    console.log("Migrating Candidates...");
    const candidates = await prisma.candidate.findMany();
    for (const candidate of candidates) {
      await db.collection("candidates").doc(candidate.id).set({
        ...candidate,
        createdAt: candidate.createdAt.toISOString(),
        updatedAt: candidate.updatedAt.toISOString(),
        totalExperienceYears: candidate.totalExperienceYears ? Number(candidate.totalExperienceYears) : null,
        currentCtc: candidate.currentCtc ? Number(candidate.currentCtc) : null,
        expectedCtc: candidate.expectedCtc ? Number(candidate.expectedCtc) : null,
        doj: candidate.doj ? candidate.doj.toISOString() : null,
      });
    }
    console.log(`✅ Migrated ${candidates.length} candidates.`);

    // 4. Applications
    console.log("Migrating Applications...");
    const applications = await prisma.application.findMany();
    for (const app of applications) {
      await db.collection("applications").doc(app.id).set({
        ...app,
        createdAt: app.createdAt.toISOString(),
        updatedAt: app.updatedAt.toISOString(),
        joinedOn: app.joinedOn ? app.joinedOn.toISOString() : null,
        doj: app.doj ? app.doj.toISOString() : null,
      });
    }
    console.log(`✅ Migrated ${applications.length} applications.`);

    // 5. Interviews
    console.log("Migrating Interviews...");
    const interviews = await prisma.interview.findMany();
    for (const interview of interviews) {
      await db.collection("interviews").doc(interview.id).set({
        ...interview,
        createdAt: interview.createdAt.toISOString(),
        scheduledStart: interview.scheduledStart.toISOString(),
        scheduledEnd: interview.scheduledEnd ? interview.scheduledEnd.toISOString() : null,
      });
    }
    console.log(`✅ Migrated ${interviews.length} interviews.`);

    // 6. Colleges & Drives
    console.log("Migrating Colleges & Drives...");
    const colleges = await prisma.college.findMany();
    for (const college of colleges) {
      await db.collection("colleges").doc(college.id).set({
        ...college,
        createdAt: college.createdAt.toISOString(),
        updatedAt: college.updatedAt.toISOString(),
      });
    }
    const drives = await prisma.collegeDrive.findMany();
    for (const drive of drives) {
      await db.collection("college_drives").doc(drive.id).set({
        ...drive,
        createdAt: drive.createdAt.toISOString(),
        updatedAt: drive.updatedAt.toISOString(),
        dateFrom: drive.dateFrom.toISOString(),
        dateTo: drive.dateTo ? drive.dateTo.toISOString() : null,
      });
    }
    console.log(`✅ Migrated colleges and drives.`);

    console.log("🏁 Migration finished successfully!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
  } finally {
    await prisma.$disconnect();
  }
}

migrate();
