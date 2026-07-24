'use strict';
const { validatePasswordStrength } = require('../../src/lib/passwordValidation');

describe('Password validation strength helper', () => {
  test('Accepts valid password meeting all requirements', () => {
    const res = validatePasswordStrength('StrongPass@1234');
    expect(res.ok).toBe(true);
    expect(res.issues.length).toBe(0);
  });

  test('Rejects short passwords', () => {
    const res = validatePasswordStrength('Short1!');
    expect(res.ok).toBe(false);
    expect(res.issues).toContain('Must be at least 12 characters.');
  });

  test('Rejects passwords missing uppercase letters', () => {
    const res = validatePasswordStrength('lowercase1234!');
    expect(res.ok).toBe(false);
    expect(res.issues).toContain('Must include an uppercase letter.');
  });

  test('Rejects passwords missing lowercase letters', () => {
    const res = validatePasswordStrength('UPPERCASE1234!');
    expect(res.ok).toBe(false);
    expect(res.issues).toContain('Must include a lowercase letter.');
  });

  test('Rejects passwords missing numbers', () => {
    const res = validatePasswordStrength('NoNumberPass!');
    expect(res.ok).toBe(false);
    expect(res.issues).toContain('Must include a number.');
  });

  test('Rejects passwords missing symbols', () => {
    const res = validatePasswordStrength('NoSymbol1234');
    expect(res.ok).toBe(false);
    expect(res.issues).toContain('Must include a symbol.');
  });

  test('Rejects passwords with 3 or more repeated characters', () => {
    const res = validatePasswordStrength('RepeatttPass1!');
    expect(res.ok).toBe(false);
    expect(res.issues).toContain('Avoid three or more repeated characters in a row.');
  });
});
