const { db } = require('./src/config/firebase');

async function run() {
  // Test case 1: duplicate phone
  try {
    const existing = await db.collection("candidates").where("phone", "==", "1234567890").get();
    if (existing.empty) {
      await db.collection("candidates").add({
        fullName: "Test user",
        phone: "1234567890",
        email: "N/A"
      });
      console.log("Added 1234567890");
    } else {
      console.log("1234567890 already exists");
    }
  } catch (err) {
    console.error(err);
  }
}
run().then(() => process.exit(0));
