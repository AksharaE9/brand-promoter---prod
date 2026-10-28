const prisma = require('../backend/src/config/db');

async function main() {
  const zeroFbs = await prisma.interviewFeedback.findMany({
    where: { overallRating: 0 },
    select: {
      id: true,
      candidateId: true,
      round: true,
      selectionStatus: true,
      overallRating: true,
      feedbackData: true,
      createdAt: true,
      updatedAt: true
    }
  });

  console.log(`InterviewFeedbacks with overallRating === 0: ${zeroFbs.length}`);

  zeroFbs.forEach((f, idx) => {
    const data = f.feedbackData || {};
    console.log(`${idx + 1}. [${f.id}] candId: ${f.candidateId} | round: ${f.round} | sel: ${f.selectionStatus} | created: ${f.createdAt.toISOString()} | rawRating: ${data.overallRating || data.rating}`);
  });

  await prisma.$disconnect();
}

main().catch(console.error);
