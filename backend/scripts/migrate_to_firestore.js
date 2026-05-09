const { Client } = require('pg');
const admin = require("firebase-admin");
const { initializeApp: initializeWeb } = require('firebase/app');
const { doc, setDoc, getFirestore } = require('firebase/firestore');
require('dotenv').config();

const firebaseConfig = {
  apiKey: "AIzaSyCTNbY9aRSzsEMIOWXQOEoqZP3xote1fN4",
  authDomain: "ats-5acc5.firebaseapp.com",
  databaseURL: "https://ats-5acc5-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ats-5acc5",
  storageBucket: "ats-5acc5.firebasestorage.app",
  messagingSenderId: "272298077380",
  appId: "1:272298077380:web:597e95106877a764be2d91",
};

let db;
let usingAdmin = false;

try {
    const fs = require('fs');
    const path = require('path');
    const saPath = path.join(__dirname, '../src/config/serviceAccountKey.json');
    if (fs.existsSync(saPath) || process.env.FIREBASE_SERVICE_ACCOUNT) {
        const sa = fs.existsSync(saPath) ? require(saPath) : JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        if (admin.apps.length === 0) admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: firebaseConfig.databaseURL });
        db = admin.firestore();
        usingAdmin = true;
        console.log("✅ Using Admin SDK");
    } else { throw new Error(); }
} catch (e) {
    console.log("⚠️ Using Web SDK Fallback...");
    const app = initializeWeb(firebaseConfig);
    db = getFirestore(app);
}

const toCamel = (s) => s.startsWith('_') ? s : s.replace(/([-_][a-z])/ig, ($1) => $1.toUpperCase().replace('-', '').replace('_', ''));

function transformRow(row) {
    const newRow = {};
    for (const key in row) {
        let val = row[key];
        if (typeof val === 'bigint') val = val.toString();
        if (val instanceof Date) val = val.toISOString();
        newRow[toCamel(key)] = val;
    }
    return newRow;
}

const pgClient = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function migrate() {
  try {
    await pgClient.connect();
    const tables = [
      "users", "candidates", "jobs", "applications", "pipeline_stages", 
      "audit_logs", "colleges", "college_drives", "college_drive_jobs", 
      "college_drive_candidates", "college_drive_recruiters", "files", 
      "products", "notifications", "user_notification_preferences", 
      "job_documents", "job_questions", "pipeline_events", 
      "interview_feedback", "interviews", "sales_tracking", 
      "sales_activities", "product_candidate_assignments", "candidate_skills", 
      "candidate_education", "custom_field_definitions", "custom_field_values", 
      "_InterviewInterviewer"
    ];

    for (const table of tables) {
      const camelTable = toCamel(table);
      console.log(`📦 Syncing ${table} (and ${camelTable})...`);
      const { rows } = await pgClient.query(`SELECT * FROM "${table}"`);
      for (const row of rows) {
        const data = transformRow(row);
        const docId = row.id ? row.id.toString() : (row.A && row.B ? `${row.A}_${row.B}` : `rec_${Math.random().toString(36).substr(2, 9)}`);
        
        // DOUBLE WRITE STRATEGY: Write to both snake_case and camelCase collections
        // This resolves inconsistencies across the backend modules.
        const collections = [table];
        if (table !== camelTable) collections.push(camelTable);

        for (const collName of collections) {
          if (usingAdmin) {
              await db.collection(collName).doc(docId).set({ ...data, migrated: true }, { merge: true });
          } else {
              await setDoc(doc(db, collName, docId), { ...data, migrated: true }, { merge: true });
          }
        }
      }
      console.log(`   ✨ Done ${rows.length} records.`);
    }
    console.log("\n✅ ALL DATA FULLY STABILIZED WITH DOUBLE-NAMING SAFETY NET!");
  } catch (err) { console.error("❌ Error:", err.message); } finally { await pgClient.end(); }
}

migrate();
