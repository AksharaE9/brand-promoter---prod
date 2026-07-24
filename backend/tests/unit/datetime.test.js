const { formatTime24h, formatDateTime24h } = require('../../src/lib/datetimeServer');

describe('24-Hour Datetime Formatting Utility Units', () => {
  describe('formatTime24h', () => {
    test('formats morning ISO timestamp into 24-hour time', () => {
      const result = formatTime24h('2026-07-22T09:40:00.000Z', 'UTC');
      expect(result).toBe('09:40');
    });

    test('formats afternoon ISO timestamp into 24-hour time (no AM/PM)', () => {
      const result = formatTime24h('2026-07-22T15:30:00.000Z', 'UTC');
      expect(result).toBe('15:30');
    });

    test('handles midnight correctly (00:00)', () => {
      const result = formatTime24h('2026-07-22T00:00:00.000Z', 'UTC');
      expect(result).toBe('00:00');
    });

    test('returns empty string for null or invalid inputs', () => {
      expect(formatTime24h(null)).toBe('');
      expect(formatTime24h('')).toBe('');
      expect(formatTime24h('invalid-date')).toBe('');
    });
  });

  describe('formatDateTime24h', () => {
    test('formats full date and 24-hour time string', () => {
      const result = formatDateTime24h('2026-07-22T14:45:00.000Z', 'UTC');
      expect(result).toContain('22 Jul 2026');
      expect(result).toContain('14:45');
    });
  });
});
