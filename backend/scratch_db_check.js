const prisma = require('./src/config/db');

async function main() {
  try {
    const total = await prisma.candidate.count({
      where: { isDeleted: false }
    });
    console.log('Total non-deleted candidates:', total);

    const sources = await prisma.candidate.groupBy({
      by: ['source'],
      _count: {
        id: true
      },
      where: { isDeleted: false }
    });
    console.log('Candidates by source:');
    console.table(sources);

    const categories = await prisma.candidate.groupBy({
      by: ['category'],
      _count: {
        id: true
      },
      where: { isDeleted: false }
    });
    console.log('Candidates by category:');
    console.table(categories);

    // Let's print the first 10 candidates
    const firstTen = await prisma.candidate.findMany({
      where: { isDeleted: false },
      take: 10,
      select: {
        id: true,
        fullName: true,
        source: true,
        category: true,
        createdAt: true
      }
    });
    console.log('First 10 candidates:');
    console.table(firstTen);
  } catch (err) {
    console.error('Prisma query failed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
