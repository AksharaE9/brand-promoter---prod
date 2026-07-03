// scratch/test_scheduler.js
const prisma = require('../src/config/db');
const { processAlerts } = require('../src/jobs/notificationScheduler');

async function testScheduler() {
  console.log('--- Starting Scheduler Integration Verification ---');

  // 1. Create a mock recruiter/interviewer user
  let mockUser;
  try {
    mockUser = await prisma.user.findFirst({
      where: { email: 'test_recruiter@example.com' }
    });
    if (!mockUser) {
      mockUser = await prisma.user.create({
        data: {
          fullName: 'Test Recruiter',
          email: 'test_recruiter@example.com',
          phone: '+919999999999', // Valid phone format
          role: 'RECRUITER',
          status: 'ACTIVE',
        }
      });
    }
  } catch (err) {
    console.error('Error creating mock user:', err);
    return;
  }

  console.log('Using Mock User:', mockUser.fullName);

  // 2. Create mock candidates & applications
  let mockCand1, mockCand2, mockCand3;
  let mockApp1, mockApp2, mockApp3;
  let mockJob;

  try {
    // We need a job first
    mockJob = await prisma.job.findFirst({
      where: { title: 'Test Software Engineer' }
    });
    if (!mockJob) {
      mockJob = await prisma.job.create({
        data: {
          title: 'Test Software Engineer',
          department: 'Engineering',
          location: 'Remote',
          createdById: mockUser.id,
        }
      });
    }

    // Candidate 1: Round 1 alert test case
    mockCand1 = await prisma.candidate.create({
      data: {
        fullName: 'John Round1 Test',
        email: 'john_r1@example.com',
        phone: '+919876543210',
        status: 'INTERVIEWING',
        createdById: mockUser.id,
        assignedRecruiterId: mockUser.id,
      }
    });
    mockApp1 = await prisma.application.create({
      data: {
        candidateId: mockCand1.id,
        jobId: mockJob.id,
        status: 'IN_PIPELINE',
      }
    });

    // Candidate 2: Round 2 alert test case
    mockCand2 = await prisma.candidate.create({
      data: {
        fullName: 'Jane Round2 Test',
        email: 'jane_r2@example.com',
        phone: '+918765432109',
        status: 'INTERVIEWING',
        createdById: mockUser.id,
        assignedRecruiterId: mockUser.id,
      }
    });
    mockApp2 = await prisma.application.create({
      data: {
        candidateId: mockCand2.id,
        jobId: mockJob.id,
        status: 'IN_PIPELINE',
      }
    });

    // Candidate 3: Offer Letter alert test case (2 days ago)
    mockCand3 = await prisma.candidate.create({
      data: {
        fullName: 'Bob Offer Test',
        email: 'b0ad0c001@smtp-brevo.com', // Sending to our active test email address!
        phone: '+917654321098',
        status: 'OFFER_SENT',
        createdById: mockUser.id,
        assignedRecruiterId: mockUser.id,
      }
    });
    
    // We create application directly with OFFER_SENT and updatedAt 2.5 days ago
    const twoAndHalfDaysAgo = new Date(Date.now() - 2.5 * 24 * 60 * 60 * 1000);
    mockApp3 = await prisma.application.create({
      data: {
        candidateId: mockCand3.id,
        jobId: mockJob.id,
        status: 'OFFER_SENT',
        createdAt: twoAndHalfDaysAgo,
        updatedAt: twoAndHalfDaysAgo,
      }
    });

    // Update the application's updatedAt via raw sql or standard prisma update
    // CockroachDB handles standard prisma update but prisma might overwrite updatedAt to now,
    // so let's update it and force updatedAt to stay in the past if possible.
    // Wait, in schema.prisma, updatedAt has @updatedAt.
    // To set updatedAt in the past, we can run a raw CockroachDB query!
    await prisma.$executeRawUnsafe(
      `UPDATE applications SET "updatedAt" = $1 WHERE id = $2`,
      twoAndHalfDaysAgo,
      mockApp3.id
    );

    console.log('Mock candidates and applications created successfully.');

    // 3. Create mock interviews
    // Interview 1: Round 1, scheduled 2 hours ago
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const mockInterview1 = await prisma.interview.create({
      data: {
        applicationId: mockApp1.id,
        candidateId: mockCand1.id,
        candidateName: mockCand1.fullName,
        jobId: mockJob.id,
        jobTitle: mockJob.title,
        roundNo: 1,
        round: 'Round 1',
        scheduledStart: twoHoursAgo,
        createdById: mockUser.id,
        interviewerIds: JSON.stringify([mockUser.id]),
        status: 'SCHEDULED',
      }
    });

    // Interview 2: Round 2, scheduled 30 minutes ago
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
    const mockInterview2 = await prisma.interview.create({
      data: {
        applicationId: mockApp2.id,
        candidateId: mockCand2.id,
        candidateName: mockCand2.fullName,
        jobId: mockJob.id,
        jobTitle: mockJob.title,
        roundNo: 2,
        round: 'Round 2',
        scheduledStart: thirtyMinsAgo,
        createdById: mockUser.id,
        interviewerIds: JSON.stringify([mockUser.id]),
        status: 'SCHEDULED',
      }
    });

    console.log('Mock interviews scheduled successfully.');

    // 4. Run the alert processing job
    console.log('\n--- Running processAlerts() ---');
    await processAlerts();
    console.log('--- processAlerts() completed ---\n');

    // 5. Verify database flags were set to true
    const updatedInt1 = await prisma.interview.findUnique({ where: { id: mockInterview1.id } });
    const updatedInt2 = await prisma.interview.findUnique({ where: { id: mockInterview2.id } });
    const updatedApp3 = await prisma.application.findUnique({ where: { id: mockApp3.id } });

    console.log('Verification Results:');
    console.log(`- Round 1 Alert Sent (Expected true):`, updatedInt1.round1SMSAlertSent);
    console.log(`- Round 2 Alert Sent (Expected true):`, updatedInt2.round2EmailAlertSent);
    console.log(`- Offer Reminder Sent (Expected true):`, updatedApp3.offerReminderSent);

  } catch (error) {
    console.error('Error during testing:', error);
  } finally {
    // 6. Cleanup
    console.log('\nCleaning up mock records...');
    try {
      if (mockApp1) {
        await prisma.interview.deleteMany({ where: { applicationId: { in: [mockApp1.id, mockApp2.id] } } });
        await prisma.application.deleteMany({ where: { id: { in: [mockApp1.id, mockApp2.id, mockApp3.id] } } });
        await prisma.candidate.deleteMany({ where: { id: { in: [mockCand1.id, mockCand2.id, mockCand3.id] } } });
      }
      console.log('Cleanup completed successfully.');
    } catch (cleanupErr) {
      console.error('Cleanup failed:', cleanupErr.message);
    } finally {
      await prisma.$disconnect();
      process.exit(0);
    }
  }
}

testScheduler();
