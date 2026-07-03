const prisma = require('./src/config/db');

async function main() {
  try {
    // Let's count candidates by different categories, sources, statuses, etc.
    const counts = {};

    counts['Total candidates (isDeleted: false)'] = await prisma.candidate.count({
      where: { isDeleted: false }
    });

    counts['Total candidates (isDeleted: true)'] = await prisma.candidate.count({
      where: { isDeleted: true }
    });

    counts['Candidates with null source'] = await prisma.candidate.count({
      where: { isDeleted: false, source: null }
    });

    counts['Candidates with source Manual Entry'] = await prisma.candidate.count({
      where: { isDeleted: false, source: 'Manual Entry' }
    });

    counts['Candidates with source Excel Upload'] = await prisma.candidate.count({
      where: { isDeleted: false, source: 'Excel Upload' }
    });

    counts['Candidates with source Bulk Import Wizard'] = await prisma.candidate.count({
      where: { isDeleted: false, source: 'Bulk Import Wizard' }
    });

    // Check application status counts
    const appStatuses = await prisma.application.groupBy({
      by: ['status'],
      _count: {
        id: true
      },
      where: { isDeleted: false }
    });
    console.log('Applications by status:');
    console.table(appStatuses);

    // Let's find any group of candidates that has size 96
    // E.g., maybe count candidates by preferredRole, location, course, etc.
    const roles = await prisma.candidate.groupBy({
      by: ['preferredRole'],
      _count: { id: true },
      where: { isDeleted: false }
    });
    console.log('Preferred Roles:');
    console.table(roles.filter(r => r._count.id === 96 || r._count.id > 10));

    const locations = await prisma.candidate.groupBy({
      by: ['location'],
      _count: { id: true },
      where: { isDeleted: false }
    });
    console.log('Locations:');
    console.table(locations.filter(l => l._count.id === 96 || l._count.id > 10));

    console.log('Other Counts:', counts);
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
