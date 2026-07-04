const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const data = [
  {
    // Ravi A. Banuse
    applicationId: 'cmr4m01x0003wqt2sdk45h9r5',
    roundNo: 1,
    round: 'Round 1',
    scheduledStart: new Date('2026-06-30T15:00:00+05:30'),
    durationMinutes: 60,
    mode: 'IN_PERSON',
    meetingLink: '',
    zohoLink: '',
    status: 'SCHEDULED',
    organizationId: 'defaultOrg',
    createdById: '73783a2b-0045-431c-9b71-75aeab0b6840', // Super Admin
    interviewerIds: ['cYEZblWdN7gubrQvLgYj'], // Vinay Shetty
  },
  {
    // Aishwarya p. Tattimath
    applicationId: 'cmr4ipn4l001dqt2sf5t1w4f4',
    roundNo: 1,
    round: 'Round 1',
    scheduledStart: new Date('2026-06-30T14:30:00+05:30'),
    durationMinutes: 60,
    mode: 'IN_PERSON',
    meetingLink: '',
    zohoLink: '',
    status: 'SCHEDULED',
    organizationId: 'defaultOrg',
    createdById: '73783a2b-0045-431c-9b71-75aeab0b6840', // Super Admin
    interviewerIds: ['73783a2b-0045-431c-9b71-75aeab0b6840'], // Super Admin (Shreesha/Gouthami)
  },
  {
    // Ranjita Horaddi
    applicationId: 'cmr4lo6pa0039qt2sz9q1oin7',
    roundNo: 1,
    round: 'Round 1',
    scheduledStart: new Date('2026-06-30T15:00:00+05:30'),
    durationMinutes: 60,
    mode: 'IN_PERSON',
    meetingLink: '',
    zohoLink: '',
    status: 'SCHEDULED',
    organizationId: 'defaultOrg',
    createdById: '73783a2b-0045-431c-9b71-75aeab0b6840', // Super Admin
    interviewerIds: ['73783a2b-0045-431c-9b71-75aeab0b6840'], // Super Admin (Shreesha/Gouthami)
  },
  {
    // Amit B Koti
    applicationId: 'cmr4l29fl002kqt2sv7ad9w31',
    roundNo: 1,
    round: 'Round 1',
    scheduledStart: new Date('2026-06-30T15:00:00+05:30'),
    durationMinutes: 60,
    mode: 'IN_PERSON',
    meetingLink: '',
    zohoLink: '',
    status: 'SCHEDULED',
    organizationId: 'defaultOrg',
    createdById: '73783a2b-0045-431c-9b71-75aeab0b6840', // Super Admin
    interviewerIds: ['XPf8glsE3KJOIbSPnhTw'], // Jagriti Sarda
  }
];

async function main() {
  console.log('Inserting missing Round 1 interviews into CockroachDB...');
  for (const item of data) {
    // Check if duplicate already exists first
    const dup = await prisma.interview.findFirst({
      where: {
        applicationId: item.applicationId,
        roundNo: item.roundNo,
        status: { not: 'CANCELLED' }
      }
    });

    if (dup) {
      console.log(`Round ${item.roundNo} for application ${item.applicationId} already exists. Skipping.`);
      continue;
    }

    const created = await prisma.interview.create({
      data: item
    });
    console.log(`Successfully created Round 1 interview with ID: ${created.id}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
