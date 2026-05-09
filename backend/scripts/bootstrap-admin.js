const admin = require("firebase-admin");
const bcrypt = require("bcryptjs");
require("dotenv").config();

/**
 * Bootstraps a Super Admin user directly into Firestore.
 * Run this if your migration didn't include an admin or if you're starting fresh.
 */
async function bootstrap() {
  console.log("🚀 Bootstrapping Super Admin user...");

  // Initialize Firebase
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
  } else {
    console.error("❌ Missing FIREBASE_SERVICE_ACCOUNT in .env");
    process.exit(1);
  }

  const db = admin.firestore();
  const email = "admin@ats.local";
  const password = "ChangeMe@123";
  const passwordHash = await bcrypt.hash(password, 12);

  const userData = {
    fullName: "System Administrator",
    email: email,
    passwordHash: passwordHash,
    role: "SUPER_ADMIN",
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  try {
    // Check if user exists
    const snapshot = await db.collection("users").where("email", "==", email).get();
    
    if (!snapshot.empty) {
      console.log("⚠️ User already exists. Updating password...");
      const docId = snapshot.docs[0].id;
      await db.collection("users").doc(docId).update({
        passwordHash,
        status: "ACTIVE",
        role: "SUPER_ADMIN"
      });
    } else {
      await db.collection("users").add(userData);
      console.log("✅ New Admin User Created.");
    }

    console.log("\n----------------------------------");
    console.log(`Login Email: ${email}`);
    console.log(`Login Password: ${password}`);
    console.log("----------------------------------\n");
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Bootstrap failed:", error);
    process.exit(1);
  }
}

bootstrap();
