// scratch/backfill_alerts.js
const prisma = require('../src/config/db');

async function runBackfill() {
  console.log('--- Starting Alerts Backfill ---');
  
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  try {
    // 1. Update all interviews scheduled before today
    const updatedInterviews = await prisma.interview.updateMany({
      where: {
        scheduledStart: { lt: todayStart }
      },
      data: {
        round1SMSAlertSent: true,
        round2EmailAlertSent: true
      }
    });
    console.log(`Successfully backfilled ${updatedInterviews.count} historical interviews.`);

    // 2. Update all applications created before today
    const updatedApplications = await prisma.application.updateMany({
      where: {
        createdAt: { lt: todayStart }
      },
      data: {
        offerReminderSent: true
      }
    });
    console.log(`Successfully backfilled ${updatedApplications.count} historical applications.`);

  } catch (err) {
    console.error('Backfill failed:', err);
  } finally {
    await prisma.$disconnect();
    console.log('Prisma disconnected.');
  }
}

runBackfill();
