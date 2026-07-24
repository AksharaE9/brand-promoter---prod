import { describe, test, expect } from 'vitest';
import {
  InterviewRound,
  ROUND_SEQUENCE,
  ROUND_DISPLAY_LABEL,
  ROUND_1_TEMPLATE,
  ROUND_2_PLUS_TEMPLATE,
  getNextSchedulableRound,
  formatFeedbackForClipboard,
} from '../../src/lib/interviewTemplates';

describe('Frontend Interview Templates & Clipboard Formatter', () => {
  describe('getNextSchedulableRound', () => {
    test('derives sequential round enum up to 3 rounds ceiling', () => {
      expect(getNextSchedulableRound([])).toBe(InterviewRound.ROUND_1);
      expect(getNextSchedulableRound(['ROUND_1'])).toBe(InterviewRound.ROUND_2);
      expect(getNextSchedulableRound(['ROUND_1', 'ROUND_2'])).toBe(InterviewRound.FINAL_ROUND);
      expect(getNextSchedulableRound(['ROUND_1', 'ROUND_2', 'FINAL_ROUND'])).toBeNull();
    });
  });

  describe('formatFeedbackForClipboard', () => {
    test('formats Round 1 feedback into clean plain text for clipboard pasting', () => {
      const values = {
        name: 'Alice Johnson',
        roundNumber: 'Round 1',
        panelists: 'Tech Lead & PM',
        overallRating: 9,
        selectionStatus: 'SELECTED',
        comments: 'Strong system design skills and experience.',
      };

      const result = formatFeedbackForClipboard(InterviewRound.ROUND_1, values);

      expect(result).toContain('Name: Alice Johnson');
      expect(result).toContain('Round Number: Round 1');
      expect(result).toContain('Panelists: Tech Lead & PM');
      expect(result).toContain('Overall Rating: 9/10');
      expect(result).toContain('Selection Status: SELECTED');
      expect(result).toContain('Comments (Reason for Selection/Reject): Strong system design skills and experience.');
      expect(result).toContain('Role: —');
    });

    test('formats Round 2+ feedback with Mock Rating and Status fields', () => {
      const values = {
        name: 'Alice Johnson',
        roundNumber: 'Round 2',
        panelists: 'VP Engineering',
        mockRating: 8.5,
        overallRating: 9,
        status: 'SELECTED',
        comments: 'Excellent mock session performance.',
      };

      const result = formatFeedbackForClipboard(InterviewRound.ROUND_2, values);

      expect(result).toContain('Name: Alice Johnson');
      expect(result).toContain('Round Number: Round 2');
      expect(result).toContain('Panelists: VP Engineering');
      expect(result).toContain('Mock Rating: 8.5/10');
      expect(result).toContain('Overall Rating: 9/10');
      expect(result).toContain('Status: SELECTED');
      expect(result).toContain('Comments: Excellent mock session performance.');
    });
  });
});
