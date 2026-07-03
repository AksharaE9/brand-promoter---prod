const prisma = require('./src/config/db');

async function check() {
  try {
    const totalInterviews = await prisma.interview.count();
    
    // Fetch all interviews with their application relation to find orphans
    const allInterviews = await prisma.interview.findMany({
      select: {
        id: true,
        applicationId: true,
        application: {
          select: {
            id: true,
            candidateId: true
          }
        }
      }
    });

    let orphaned = 0;
    let valid = 0;
    let nullAppId = 0;

    allInterviews.forEach(i => {
      if (!i.applicationId) {
        nullAppId++;
      } else if (!i.application) {
        orphaned++;
      } else {
        valid++;
      }
    });

    console.log(`Total interviews: ${totalInterviews}`);
    console.log(`Valid interviews (application exists): ${valid}`);
    console.log(`Orphaned interviews (applicationId exists but application record is missing): ${orphaned}`);
    console.log(`Interviews with null applicationId: ${nullAppId}`);

  } catch (err) {
    console.error('Error querying database:', err);
  } finally {
    await prisma.$disconnect();
  }
}

check();
