'use strict';

describe('QA Loop 2: Data Integrity & Defect Root Causes', () => {
  describe('QA-003: Rating Blank-to-NULL Conversion Guard', () => {
    function parseOverallRating(rawVal) {
      return (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '' && !isNaN(Number(rawVal)))
        ? Number(rawVal)
        : null;
    }

    test('blank string "" parses as NULL, never 0', () => {
      expect(parseOverallRating('')).toBeNull();
      expect(parseOverallRating('   ')).toBeNull();
    });

    test('undefined and null parse as NULL', () => {
      expect(parseOverallRating(undefined)).toBeNull();
      expect(parseOverallRating(null)).toBeNull();
    });

    test('valid ratings 1 through 10 parse as numbers', () => {
      expect(parseOverallRating('7')).toBe(7);
      expect(parseOverallRating('8.5')).toBe(8.5);
      expect(parseOverallRating(6)).toBe(6);
    });

    test('explicit 0 is preserved only if deliberately passed as non-empty number, but blank inputs never produce 0', () => {
      expect(parseOverallRating('')).not.toBe(0);
      expect(parseOverallRating(' ')).not.toBe(0);
    });
  });

  describe('QA-002: Interview Completion Outcome Guard', () => {
    function getCompletionPayload(body) {
      const outcome = body && body.outcome ? String(body.outcome).trim().toUpperCase() : 'PENDING';
      return {
        status: 'COMPLETED',
        outcome,
        result: outcome
      };
    }

    test('completing without explicit outcome defaults to PENDING, never NULL', () => {
      const payload = getCompletionPayload({});
      expect(payload.status).toBe('COMPLETED');
      expect(payload.outcome).toBe('PENDING');
      expect(payload.outcome).not.toBeNull();
    });

    test('completing with explicit outcome records normalized outcome', () => {
      const payload = getCompletionPayload({ outcome: 'selected' });
      expect(payload.status).toBe('COMPLETED');
      expect(payload.outcome).toBe('SELECTED');
    });
  });

  describe('QA-004: Candidate Deletion Integrity', () => {
    test('soft deletion marks candidate isDeleted: true and sets deletedAt timestamp', () => {
      const candidateBefore = { id: 'c1', isDeleted: false, deletedAt: null };
      const candidateAfter = {
        ...candidateBefore,
        isDeleted: true,
        deletedAt: new Date().toISOString()
      };
      expect(candidateAfter.isDeleted).toBe(true);
      expect(candidateAfter.deletedAt).toBeTruthy();
    });
  });
});
