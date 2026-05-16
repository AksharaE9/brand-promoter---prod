// This is a MongoDB migration script as requested.
// Usage: node src/scripts/addIndexes.js

const mongoose = require("mongoose");
require("dotenv").config();

async function addIndexes() {
  try {
    const uri = process.env.MONGO_URI || "mongodb://localhost:27017/ats";
    await mongoose.connect(uri);
    console.log("Connected to MongoDB for indexing");

    const db = mongoose.connection.db;

    // Candidates collection
    await db.collection("candidates").createIndex({ organizationId: 1, isDeleted: 1 });
    await db.collection("candidates").createIndex({ organizationId: 1, email: 1 });
    await db.collection("candidates").createIndex({ organizationId: 1, status: 1, createdAt: -1 });
    await db.collection("candidates").createIndex({ organizationId: 1, fullName: 'text', email: 'text' });

    // JobApplications collection
    await db.collection("jobapplications").createIndex({ organizationId: 1, candidateId: 1 });
    await db.collection("jobapplications").createIndex({ organizationId: 1, jobId: 1, status: 1 });
    await db.collection("jobapplications").createIndex({ organizationId: 1, status: 1, createdAt: -1 });

    // InterviewRounds collection
    await db.collection("interviewrounds").createIndex({ organizationId: 1, candidateId: 1 });
    await db.collection("interviewrounds").createIndex({ organizationId: 1, scheduledDate: 1, status: 1 });
    await db.collection("interviewrounds").createIndex({ 'panelMembers.userId': 1, scheduledDate: 1 });

    // Notifications collection
    await db.collection("notifications").createIndex({ userId: 1, isRead: 1, createdAt: -1 });

    console.log("Successfully created MongoDB indexes");
    process.exit(0);
  } catch (err) {
    console.error("Failed to add indexes:", err);
    process.exit(1);
  }
}

addIndexes();
