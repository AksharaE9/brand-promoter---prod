'use strict';

const {
  SELECTION_STATUSES,
  validateFeedbackData,
  assertCanScheduleRound,
  getEffectiveSelectionStatus,
} = require('../../src/lib/interviewTemplates');

describe('Not Responded Feature Unit Tests', () => {
  describe('Data Model & Selection Statuses', () => {
    test('SELECTION_STATUSES includes NOT_RESPONDED', () => {
      expect(SELECTION_STATUSES).toContain('NOT_RESPONDED');
    });

    test('validateFeedbackData accepts NOT_RESPONDED for selectionStatus', () => {
      const validPayload = {
        name: 'Test Candidate',
        roundNumber: 'Round 1',
        panelists: 'Interviewer 1',
        role: 'Engineer',
        overallRating: 7,
        doj: '2026-10-01',
        timings: '10:00 AM',
        duration: '45 mins',
        selectionStatus: 'NOT_RESPONDED',
      };

      const result = validateFeedbackData('ROUND_1', validPayload);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('getEffectiveSelectionStatus returns NOT_RESPONDED correctly', () => {
      const fb1 = { selectionStatus: 'NOT_RESPONDED' };
      expect(getEffectiveSelectionStatus(fb1)).toBe('NOT_RESPONDED');

      const fb2 = { feedbackData: { selectionStatus: 'NOT_RESPONDED', templateVersion: 2 } };
      expect(getEffectiveSelectionStatus(fb2)).toBe('NOT_RESPONDED');

      const fb3 = { feedbackData: { overallRecommendation: 'NOT_RESPONDED', templateVersion: 1 } };
      expect(getEffectiveSelectionStatus(fb3)).toBe('NOT_RESPONDED');
    });
  });

  describe('Downstream Gating: Scheduling Next Round', () => {
    test('assertCanScheduleRound does NOT block candidate when prior round is NOT_RESPONDED', async () => {
      const mockPrisma = {
        interviewFeedback: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'fb-1',
              candidateId: 'cand-1',
              round: 'ROUND_1',
              selectionStatus: 'NOT_RESPONDED',
              deletedAt: null,
            }
          ]),
        },
        interview: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'iv-1',
              candidateId: 'cand-1',
              roundNo: 1,
              result: 'NOT_RESPONDED',
              feedback: [{ selectionStatus: 'NOT_RESPONDED' }],
            }
          ]),
        },
      };

      // Should not throw
      await expect(
        assertCanScheduleRound(mockPrisma, 'cand-1', 'ROUND_2')
      ).resolves.not.toThrow();
    });

    test('assertCanScheduleRound still blocks REJECTED candidates', async () => {
      const mockPrisma = {
        interviewFeedback: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'fb-1',
              candidateId: 'cand-1',
              round: 'ROUND_1',
              selectionStatus: 'REJECTED',
              deletedAt: null,
            }
          ]),
        },
        interview: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      };

      await expect(
        assertCanScheduleRound(mockPrisma, 'cand-1', 'ROUND_2')
      ).rejects.toThrow(/rejected/i);
    });
  });
});
