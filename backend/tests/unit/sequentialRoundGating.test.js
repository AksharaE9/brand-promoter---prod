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
    expect(mockPrisma.interviewFeedback.findUnique).not.toHaveBeenCalled();
  });

  test('throws 400 ApiError when attempting to schedule Round 2 before Round 1 feedback exists', async () => {
    mockPrisma.interviewFeedback.findMany.mockResolvedValue([]);

    await expect(
      assertCanScheduleRound(mockPrisma, 'cand-123', InterviewRound.ROUND_2)
    ).rejects.toThrow(ApiError);

    await expect(
      assertCanScheduleRound(mockPrisma, 'cand-123', InterviewRound.ROUND_2)
    ).rejects.toThrow('Round 1 feedback must be submitted before scheduling Round 2.');
  });

  test('allows scheduling Round 2 when Round 1 feedback exists', async () => {
    mockPrisma.interviewFeedback.findMany.mockResolvedValue([
      {
        id: 'fb-1',
        candidateId: 'cand-123',
        round: 'ROUND_1',
      }
    ]);

    await expect(
      assertCanScheduleRound(mockPrisma, 'cand-123', InterviewRound.ROUND_2)
    ).resolves.not.toThrow();

    expect(mockPrisma.interviewFeedback.findMany).toHaveBeenCalledWith({
      where: { candidateId: 'cand-123', deletedAt: null },
    });
  });

  test('throws 400 ApiError when attempting to schedule Final Round before Round 2 feedback exists', async () => {
    mockPrisma.interviewFeedback.findMany.mockResolvedValue([]);

    await expect(
      assertCanScheduleRound(mockPrisma, 'cand-123', InterviewRound.FINAL_ROUND)
    ).rejects.toThrow('Round 2 feedback must be submitted before scheduling Final Round.');
  });
});
