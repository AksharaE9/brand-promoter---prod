'use strict';

function validatePasswordStrength(pw) {
  const issues = [];
  if (!pw || pw.length < 12) issues.push('Must be at least 12 characters.');
  if (!/[A-Z]/.test(pw)) issues.push('Must include an uppercase letter.');
  if (!/[a-z]/.test(pw)) issues.push('Must include a lowercase letter.');
  if (!/\d/.test(pw)) issues.push('Must include a number.');
  if (!/[^A-Za-z0-9]/.test(pw)) issues.push('Must include a symbol.');
  if (/(.)\1{2,}/.test(pw)) issues.push('Avoid three or more repeated characters in a row.');
  return { ok: issues.length === 0, issues };
}

module.exports = {
  validatePasswordStrength,
};
