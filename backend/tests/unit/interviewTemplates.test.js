'use strict';

const {
  InterviewRound,
  ROUND_SEQUENCE,
  ROUND_DISPLAY_LABEL,
  ROUND_1_TEMPLATE,
  ROUND_2_PLUS_TEMPLATE,
  getNextSchedulableRound,
  validateFeedbackData,
  formatFeedbackForClipboard,
} = require('../../src/lib/interviewTemplates');

describe('Interview Templates & Round Capping Logic', () => {
  describe('getNextSchedulableRound', () => {
    test('returns ROUND_1 when 0 rounds completed', () => {
      expect(getNextSchedulableRound([])).toBe(InterviewRound.ROUND_1);
    });

    test('returns ROUND_2 when 1 round completed', () => {
      expect(getNextSchedulableRound(['ROUND_1'])).toBe(InterviewRound.ROUND_2);
    });

    test('returns FINAL_ROUND when 2 rounds completed', () => {
      expect(getNextSchedulableRound(['ROUND_1', 'ROUND_2'])).toBe(InterviewRound.FINAL_ROUND);
    });

    test('returns null when 3 rounds completed (capped at 3)', () => {
      expect(getNextSchedulableRound(['ROUND_1', 'ROUND_2', 'FINAL_ROUND'])).toBeNull();
    });
  });

  describe('validateFeedbackData', () => {
    test('validates Round 1 template required fields correctly', () => {
      const validData = {
        name: 'Jane Doe',
        number: '+919876543210',
        roundNumber: 'Round 1',
        panelists: 'Alex & Sam',
        role: 'Senior Developer',
        overallRating: 8,
        doj: '2026-08-01',
        selectionStatus: 'SELECTED',
      };
      const res = validateFeedbackData(InterviewRound.ROUND_1, validData);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    test('rejects missing required fields in Round 1', () => {
      const invalidData = {
        name: 'Jane Doe',
        // missing number, panelists, role, overallRating, doj, selectionStatus
      };
      const res = validateFeedbackData(InterviewRound.ROUND_1, invalidData);
      expect(res.valid).toBe(false);
      expect(res.errors.length).toBeGreaterThan(0);
    });

    test('rejects ratings outside 0 to 10', () => {
      const invalidData = {
        name: 'Jane Doe',
        number: '+919876543210',
        roundNumber: 'Round 1',
        panelists: 'Alex',
        role: 'Developer',
        overallRating: 15, // Out of bounds
        doj: '2026-08-01',
        selectionStatus: 'SELECTED',
      };
      const res = validateFeedbackData(InterviewRound.ROUND_1, invalidData);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('must be a number between 0 and 10'))).toBe(true);
    });

    test('rejects invalid selection status', () => {
      const invalidData = {
        name: 'Jane Doe',
        number: '+919876543210',
        roundNumber: 'Round 1',
        panelists: 'Alex',
        role: 'Developer',
        overallRating: 7,
        doj: '2026-08-01',
        selectionStatus: 'INVALID_STATUS',
      };
      const res = validateFeedbackData(InterviewRound.ROUND_1, invalidData);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('must be one of'))).toBe(true);
    });

    test('validates Round 2 plus template correctly', () => {
      const validData = {
        name: 'Jane Doe',
        number: '+919876543210',
        roundNumber: 'Round 2',
        panelists: 'Tech Panel',
        overallRating: 9,
        status: 'SELECTED',
      };
      const res = validateFeedbackData(InterviewRound.ROUND_2, validData);
      expect(res.valid).toBe(true);
    });
  });

  describe('formatFeedbackForClipboard', () => {
    test('formats feedback key values correctly', () => {
      const data = {
        name: 'Jane Doe',
        number: '+919876543210',
        roundNumber: 'Round 1',
        panelists: 'Alex',
        role: 'Engineer',
        overallRating: 9,
        selectionStatus: 'SELECTED',
      };
      const formatted = formatFeedbackForClipboard(InterviewRound.ROUND_1, data);
      expect(formatted).toContain('Name: Jane Doe');
      expect(formatted).toContain('Number: +919876543210');
      expect(formatted).toContain('Overall Rating: 9/10');
    });
  });
});
