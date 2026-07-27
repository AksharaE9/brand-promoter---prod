'use strict';

const { populateInterviewRelations } = require('../../src/modules/interviews/relationPopulator');
const prisma = require('../../src/config/db');

describe('relationPopulator candidateId and jobId lookup', () => {
  let createdCandidate;
  let createdJob;
  let createdApplication;
  let createdUser;

  beforeAll(async () => {
    // Clean up or create mock objects in DB
    createdUser = await prisma.user.create({
      data: {
        fullName: 'Test Interviewer',
        email: `interviewer_${Date.now()}@example.com`,
        passwordHash: 'dummyhash',
        role: 'RECRUITER'
      }
    });

    createdCandidate = await prisma.candidate.create({
      data: {
        fullName: 'Resolve Target Candidate',
        email: `candidate_${Date.now()}@example.com`
      }
    });

    createdJob = await prisma.job.create({
      data: {
        title: 'Software Engineer',
        description: 'Test Job'
      }
    });

    createdApplication = await prisma.application.create({
      data: {
        candidateId: createdCandidate.id,
        jobId: createdJob.id
      }
    });
  });

  afterAll(async () => {
    // Cleanup created records defensively
    if (createdApplication?.id) {
      await prisma.application.deleteMany({
        where: { id: createdApplication.id }
      });
    }
    if (createdCandidate?.id) {
      await prisma.candidate.deleteMany({
        where: { id: createdCandidate.id }
      });
    }
    if (createdJob?.id) {
      await prisma.job.deleteMany({
        where: { id: createdJob.id }
      });
    }
    if (createdUser?.id) {
      await prisma.user.deleteMany({
        where: { id: createdUser.id }
      });
    }
  });

  test('resolves candidateId and jobId from Application table if they are null on the Interview record', async () => {
    // Minimal round representation, simulating candidateId and jobId as null
    const round = {
      id: 'round-resolve-test',
      applicationId: createdApplication.id,
      candidateId: null,
      jobId: null,
      roundNo: 1,
      round: 'Round 1',
      scheduledStart: new Date(),
      mode: 'VIRTUAL',
      status: 'SCHEDULED',
      result: null,
      organizationId: 'defaultOrg',
      interviewerIds: JSON.stringify([createdUser.id]),
      interviewerNames: 'Test Interviewer',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const populated = await populateInterviewRelations([round], createdUser);
    const result = populated[0];

    // Assert that the returned round object has resolved candidateId and jobId correctly
    expect(result.candidateId).toBe(createdCandidate.id);
    expect(result.jobId).toBe(createdJob.id);

    // Assert nested application mapping is populated correctly
    expect(result.application).toBeDefined();
    expect(result.application.candidateId).toBe(createdCandidate.id);
    expect(result.application.candidate.fullName).toBe('Resolve Target Candidate');
    expect(result.application.job.title).toBe('Software Engineer');
  });
});
