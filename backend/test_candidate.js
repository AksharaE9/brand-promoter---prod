const prisma = require('./src/config/db');

async function run() {
  // Test case 1: duplicate phone
  try {
    const existing = await prisma.candidate.findFirst({
      where: { phone: "1234567890" }
    });
    if (!existing) {
      await prisma.candidate.create({
        data: {
          fullName: "Test user",
          phone: "1234567890",
          email: "N/A",
          status: "ACTIVE"
        }
      });
      console.log("Added 1234567890");
    } else {
      console.log("1234567890 already exists");
    }
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}
run().then(() => process.exit(0));
