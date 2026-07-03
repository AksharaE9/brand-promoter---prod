const prisma = require('./src/config/db');

async function main() {
  try {
    const candidateStatuses = await prisma.candidate.groupBy({
      by: ['status'],
      _count: {
        id: true
      },
      where: { isDeleted: false }
    });
    console.log('Candidates by status field:');
    console.table(candidateStatuses);

    // Let's also check candidates with their applications and see how statuses compare
    const statusComparison = await prisma.candidate.findMany({
      where: { isDeleted: false },
      select: {
        status: true,
        applications: {
          select: {
            status: true
          }
        }
      }
    });

    const comparisonSummary = {};
    for (const c of statusComparison) {
      const appStatuses = c.applications.map(a => a.status).join(', ') || 'no application';
      const key = `Candidate status: ${c.status} | App statuses: [${appStatuses}]`;
      comparisonSummary[key] = (comparisonSummary[key] || 0) + 1;
    }
    console.log('Comparison summary:');
    console.log(JSON.stringify(comparisonSummary, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
