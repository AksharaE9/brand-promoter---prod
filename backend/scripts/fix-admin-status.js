/**
 * fix-admin-status.js
 * Fixes the admin@ats.local user in Firestore:
 *   - Sets status = "ACTIVE"
 *   - Sets role = "SUPER_ADMIN"
 *   - Resets passwordHash to "ChangeMe@123"
 * Uses the Web SDK (no serviceAccountKey.json required).
 */

const { initializeApp } = require("firebase/app");
const { getFirestore, collection, query, where, getDocs, updateDoc, addDoc } = require("firebase/firestore");
const bcrypt = require("bcryptjs");

const firebaseConfig = {
  apiKey: "AIzaSyCTNbY9aRSzsEMIOWXQOEoqZP3xote1fN4",
  authDomain: "ats-5acc5.firebaseapp.com",
  databaseURL: "https://ats-5acc5-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ats-5acc5",
  storageBucket: "ats-5acc5.firebasestorage.app",
  messagingSenderId: "272298077380",
  appId: "1:272298077380:web:597e95106877a764be2d91",
};

async function fixAdmin() {
  console.log("🔧 Fixing admin@ats.local user...\n");

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  const email = "admin@ats.local";
  const password = "ChangeMe@123";
  const passwordHash = await bcrypt.hash(password, 12);

  const q = query(collection(db, "users"), where("email", "==", email));
  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    console.log("⚠️  User not found. Creating new admin user...");
    await addDoc(collection(db, "users"), {
      fullName: "System Administrator",
      email,
      passwordHash,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    console.log("✅ Admin user CREATED successfully!");
  } else {
    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();
    console.log(`📄 Found user: ${userDoc.id}`);
    console.log(`   Current status: ${userData.status}`);
    console.log(`   Current role:   ${userData.role}`);

    await updateDoc(userDoc.ref, {
      status: "ACTIVE",
      role: "SUPER_ADMIN",
      passwordHash,
      updatedAt: new Date().toISOString(),
    });
    console.log("✅ Admin user UPDATED successfully!");
  }

  console.log("\n----------------------------------");
  console.log(`Login Email   : ${email}`);
  console.log(`Login Password: ${password}`);
  console.log("----------------------------------\n");
  process.exit(0);
}

fixAdmin().catch((err) => {
  console.error("❌ Fix failed:", err);
  process.exit(1);
});
