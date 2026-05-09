const { db, usingAdmin } = require("../src/config/firebase");

async function verify() {
    console.log("🔍 Verifying Connection...");
    console.log(`Connection Method: ${usingAdmin ? 'Admin SDK' : 'Web SDK Fallback'}`);

    try {
        console.log("📡 Fetching users collection...");
        const snapshot = await db.collection("users").get();
        
        console.log("✅ SUCCESS!");
        console.log(`Found ${snapshot.docs ? snapshot.docs.length : snapshot.size} users.`);
        
        if (snapshot.docs && snapshot.docs.length > 0) {
            console.log("Sample User Email:", snapshot.docs[0].data().email);
        }

        console.log("\n🚀 Your database is fully CONNECTED and accessible!");
    } catch (err) {
        console.error("❌ FAILED!");
        console.error("Error:", err.message);
        if (err.message.includes("permissions")) {
            console.log("💡 TIP: Your Firebase Security Rules are still blocking access. Make sure you clicked 'Publish' after changing them to 'allow read, write: if true;'.");
        }
    } finally {
        process.exit();
    }
}

verify();
