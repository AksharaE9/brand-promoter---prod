const prisma = require('../src/config/db');

async function main() {
  try {
    const candidates = await prisma.candidate.findMany({
      where: {
        isDeleted: false,
        OR: [
          { fullName: { contains: 'Arjun', mode: 'insensitive' } },
          { fullName: { contains: 'Harshith', mode: 'insensitive' } },
          { fullName: { contains: 'Gowda', mode: 'insensitive' } },
          { fullName: { contains: 'Biraj', mode: 'insensitive' } },
          { fullName: { contains: 'Lal', mode: 'insensitive' } }
        ]
      },
      select: {
        id: true,
        fullName: true,
        organizationId: true
      }
    });
    console.log('Matches:', candidates);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
