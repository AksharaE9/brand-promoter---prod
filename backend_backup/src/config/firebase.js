const admin = require("firebase-admin");
require("dotenv").config();

// If we have a service account JSON in .env, we use it
// Otherwise, we initialize with minimal config and hope for the best (or expect GOOGLE_APPLICATION_CREDENTIALS)
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) 
  : null;

if (serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET
  });
} else {
  // Minimal initialization for non-admin tasks or if credentials provided via env
  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET
  });
}

const db = admin.firestore();
const rtdb = admin.database();
const storage = admin.storage();
const auth = admin.auth();

module.exports = { db, rtdb, storage, auth, admin };
