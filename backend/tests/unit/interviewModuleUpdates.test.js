'use strict';

const { resolveHeader } = require('../../src/lib/headerAliasMap');
const { assertCanScheduleRound } = require('../../src/lib/interviewTemplates');

describe('Interview Module Enhancements Unit Tests', () => {
  describe('Zoho Link Header Aliases', () => {
    test('resolves various Zoho Link headers to "zohoLink"', () => {
      expect(resolveHeader('Zoho Link')).toBe('zohoLink');
      expect(resolveHeader('zoho_link')).toBe('zohoLink');
      expect(resolveHeader('zoholink')).toBe('zohoLink');
      expect(resolveHeader('Zoho Meeting Link')).toBe('zohoLink');
      expect(resolveHeader('zoho meeting')).toBe('zohoLink');
      expect(resolveHeader('Zoho Link *')).toBe('zohoLink');
    });
  });

  describe('Non-Sequential Round Scheduling', () => {
    test('allows scheduling Round 2 directly when candidate has no prior Round 1 feedback', async () => {
      const mockPrisma = {
        interviewFeedback: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        interview: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      };

      // Should resolve without throwing an ApiError
      await expect(assertCanScheduleRound(mockPrisma, 'candidate-123', 'ROUND_2')).resolves.toBeUndefined();
    });

    test('blocks scheduling any round if candidate was REJECTED at a prior round', async () => {
      const mockPrisma = {
        interviewFeedback: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'f1', candidateId: 'candidate-123', round: 'ROUND_1', selectionStatus: 'REJECTED' }
          ]),
        },
        interview: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      };

      await expect(assertCanScheduleRound(mockPrisma, 'candidate-123', 'ROUND_2'))
        .rejects.toThrow('This candidate was rejected at Round 1; further rounds cannot be scheduled.');
    });
  });
});
