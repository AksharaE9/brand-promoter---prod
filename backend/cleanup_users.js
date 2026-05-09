const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Cleaning up users and related data...');
  
  const keptEmails = ['admin@ats.local', 'recruiter2@ats.local', 'interviewer@ats.local'];
  
  const admin = await prisma.user.findFirst({ where: { email: 'admin@ats.local' } });
  if (!admin) {
    console.error('Super Admin not found!');
    return;
  }

  const usersToDelete = await prisma.user.findMany({
    where: { email: { notIn: keptEmails } },
    select: { id: true }
  });
  
  const ids = usersToDelete.map(u => u.id);
  if (ids.length === 0) {
    console.log('No users to delete.');
    return;
  }

  console.log(`Processing deletion for ${ids.length} users...`);

  await prisma.candidate.updateMany({
    where: { createdById: { in: ids } },
    data: { createdById: admin.id }
  });
  
  await prisma.candidate.updateMany({
    where: { OR: [{ mentorId: { in: ids } }, { coordinatorId: { in: ids } }] },
    data: { mentorId: null, coordinatorId: null }
  });

  await prisma.interviewFeedback.deleteMany({ where: { submittedById: { in: ids } } });

  await prisma.interview.deleteMany({
    where: {
      OR: [
        { createdById: { in: ids } },
        { interviewers: { some: { id: { in: ids } } } }
      ]
    }
  });

  await prisma.pipelineEvent.deleteMany({ where: { movedById: { in: ids } } });
  await prisma.job.deleteMany({ where: { createdById: { in: ids } } });
  await prisma.collegeDrive.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  
  const deleted = await prisma.user.deleteMany({
    where: { id: { in: ids } }
  });
  
  console.log(`Deleted ${deleted.count} users successfully.`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
