const admin = require("firebase-admin");
require("dotenv").config();

admin.initializeApp({
  projectId: process.env.FIREBASE_PROJECT_ID,
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.firestore();

async function test() {
  try {
    await db.collection("test").add({ msg: "hello", at: new Date().toISOString() });
    console.log("✅ Firestore write successful!");
  } catch (err) {
    console.error("❌ Firestore write failed:", err.message);
  }
}

test();
