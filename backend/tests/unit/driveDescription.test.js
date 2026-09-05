'use strict';

const {
  DRIVE_DESCRIPTION_MAX_WORDS,
  countWords,
  validateDriveDescription,
} = require('../../src/config/driveConstants');

describe('Hiring Drive Description Validation & Word Counter Units', () => {
  test('DRIVE_DESCRIPTION_MAX_WORDS is set to 200', () => {
    expect(DRIVE_DESCRIPTION_MAX_WORDS).toBe(200);
  });

  test('countWords handles null, undefined, empty, and whitespace-only strings', () => {
    expect(countWords(null)).toBe(0);
    expect(countWords(undefined)).toBe(0);
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords('\n\t  \r\n')).toBe(0);
  });

  test('countWords normalizes consecutive spaces, tabs, and newlines', () => {
    expect(countWords('Hello   World')).toBe(2);
    expect(countWords('Line 1\nLine 2\n\nLine 3')).toBe(6);
    expect(countWords('  WordA\t\tWordB  \n WordC  ')).toBe(3);
  });

  test('countWords handles emoji and special characters correctly', () => {
    expect(countWords('Campus Drive 2026 🎓')).toBe(4);
    expect(countWords('Role: Engineer & Developer — Bangalore')).toBe(6);
  });

  test('validateDriveDescription accepts empty or missing descriptions', () => {
    expect(validateDriveDescription(null)).toEqual({ valid: true, wordCount: 0 });
    expect(validateDriveDescription('')).toEqual({ valid: true, wordCount: 0 });
    expect(validateDriveDescription(undefined)).toEqual({ valid: true, wordCount: 0 });
  });

  test('validateDriveDescription accepts exactly 200 words', () => {
    const text200 = Array.from({ length: 200 }, (_, i) => `word${i + 1}`).join(' ');
    const result = validateDriveDescription(text200);
    expect(result.valid).toBe(true);
    expect(result.wordCount).toBe(200);
  });

  test('validateDriveDescription rejects 201 words with exact word count message', () => {
    const text201 = Array.from({ length: 201 }, (_, i) => `word${i + 1}`).join(' ');
    const result = validateDriveDescription(text201);
    expect(result.valid).toBe(false);
    expect(result.wordCount).toBe(201);
    expect(result.error).toBe('Description is 201 words — please shorten to 200 or fewer');
  });

  test('validateDriveDescription rejects large texts (e.g. 250 words) with exact count', () => {
    const text250 = Array.from({ length: 250 }, (_, i) => `word${i + 1}`).join(' ');
    const result = validateDriveDescription(text250);
    expect(result.valid).toBe(false);
    expect(result.wordCount).toBe(250);
    expect(result.error).toBe('Description is 250 words — please shorten to 200 or fewer');
  });
});
