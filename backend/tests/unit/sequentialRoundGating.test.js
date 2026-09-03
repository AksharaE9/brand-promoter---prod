const { assertCanScheduleRound, InterviewRound } = require('../../src/lib/interviewTemplates');
const { ApiError } = require('../../src/utils/errors');

describe('Sequential Round Gating Unit Tests', () => {
  let mockPrisma;

  beforeEach(() => {
    mockPrisma = {
      interviewFeedback: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      interview: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
  });

  test('allows scheduling Round 1 without prior feedback requirement', async () => {
    await expect(
      assertCanScheduleRound(mockPrisma, 'cand-123', InterviewRound.ROUND_1)
    ).resolves.not.toThrow();
  });

  test('allows scheduling Round 2 even when Round 1 feedback is missing', async () => {
    mockPrisma.interviewFeedback.findMany.mockResolvedValue([]);

    await expect(
      assertCanScheduleRound(mockPrisma, 'cand-123', InterviewRound.ROUND_2)
    ).resolves.not.toThrow();
  });

  test('allows scheduling Final Round even when Round 2 feedback is missing', async () => {
    mockPrisma.interviewFeedback.findMany.mockResolvedValue([]);

    await expect(
      assertCanScheduleRound(mockPrisma, 'cand-123', InterviewRound.FINAL_ROUND)
    ).resolves.not.toThrow();
  });

  test('blocks scheduling when prior round outcome is REJECTED', async () => {
    mockPrisma.interviewFeedback.findMany.mockResolvedValue([
      {
        id: 'fb-1',
        candidateId: 'cand-123',
        round: 'ROUND_1',
        selectionStatus: 'REJECTED',
      }
    ]);

    await expect(
      assertCanScheduleRound(mockPrisma, 'cand-123', InterviewRound.ROUND_2)
    ).rejects.toThrow('This candidate was rejected at Round 1; further rounds cannot be scheduled.');
  });
});
