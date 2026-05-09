const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  try {
    const count = await prisma.application.count();
    console.log("SUCCESS: Connection to DB works. Application count:", count);
  } catch (err) {
    console.error("FAILURE: Cannot connect to DB:", err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
