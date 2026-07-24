const {
  LEAD_IMPORT_SCHEMA,
  normalizePhoneText,
  validateLeadRow,
  computeCompletionPercentage,
} = require('../../src/lib/leadImportSchema');

describe('Lead Import Schema & Completion Percentage Unit Tests', () => {
  describe('normalizePhoneText', () => {
    test('preserves leading zeros in phone text', () => {
      expect(normalizePhoneText('09876543210')).toBe('09876543210');
    });

    test('preserves leading + in international phone numbers', () => {
      expect(normalizePhoneText('+919876543210')).toBe('+919876543210');
    });

    test('handles scientific notation string cleanly', () => {
      expect(normalizePhoneText('9.87654321e9')).toBe('9876543210');
    });

    test('returns empty string for null or undefined', () => {
      expect(normalizePhoneText(null)).toBe('');
      expect(normalizePhoneText(undefined)).toBe('');
    });
  });

  describe('validateLeadRow', () => {
    test('validates valid row containing name and phone', () => {
      const result = validateLeadRow({ name: 'Madomati Test', phone: '09876543210', city: 'Bangalore' });
      expect(result.valid).toBe(true);
      expect(result.leadData.name).toBe('Madomati Test');
      expect(result.leadData.phone).toBe('09876543210');
      expect(result.leadData.city).toBe('Bangalore');
      expect(result.errors).toHaveLength(0);
    });

    test('fails validation when required name is missing', () => {
      const result = validateLeadRow({ phone: '9876543210' });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Name');
    });

    test('fails validation when required phone is missing', () => {
      const result = validateLeadRow({ name: 'Madomati Test' });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Phone');
    });
  });

  describe('computeCompletionPercentage', () => {
    test('computes percentage correctly', () => {
      expect(computeCompletionPercentage(50, 100)).toBe(50);
      expect(computeCompletionPercentage(75, 100)).toBe(75);
      expect(computeCompletionPercentage(10, 30)).toBe(33);
    });

    test('caps percentage at 100%', () => {
      expect(computeCompletionPercentage(150, 100)).toBe(100);
    });

    test('returns 0 when totalLeads is 0', () => {
      expect(computeCompletionPercentage(50, 0)).toBe(0);
    });
  });
});
