const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const j = await prisma.job.count();
  const i = await prisma.interview.count();
  const a = await prisma.application.count();
  console.log({ jobs: j, interviews: i, applications: a });
}
main().finally(() => prisma.$disconnect());
