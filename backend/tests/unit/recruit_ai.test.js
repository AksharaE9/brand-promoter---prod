'use strict';

const crypto = require('crypto');
const {
  computePayloadHash,
  normalizeScore,
  normalizeRecommendation,
  normalizeStatus
} = require('../../src/modules/integrations/recruit-ai/normalizer');

const {
  isPlaceholderEmail,
  normalizePhone
} = require('../../src/modules/integrations/recruit-ai/matchingService');

const {
  verifyWebhookSignature
} = require('../../src/modules/integrations/recruit-ai/inboxService');

describe('Recruit AI / HireIQ Integration Unit Tests', () => {
  describe('Normalizer Tests', () => {
    test('normalizes raw score (84/100) to 84.0 and 8.4 rating', () => {
      const result = normalizeScore(84);
      expect(result.scoreRaw).toBe(84);
      expect(result.scoreScale).toBe(100);
      expect(result.scoreNormalised100).toBe(84);
      expect(result.ratingOutOf10).toBe(8.4);
    });

    test('normalizes non-100 scale score (e.g. 4.2 out of 5) to 84.0 and 8.4', () => {
      const result = normalizeScore({ raw: 4.2, scaleMax: 5 });
      expect(result.scoreRaw).toBe(4.2);
      expect(result.scoreScale).toBe(5);
      expect(result.scoreNormalised100).toBe(84);
      expect(result.ratingOutOf10).toBe(8.4);
    });

    test('handles missing or invalid scores gracefully', () => {
      const result = normalizeScore(null);
      expect(result.scoreRaw).toBeNull();
      expect(result.scoreNormalised100).toBeNull();
      expect(result.ratingOutOf10).toBeNull();
    });

    test('normalizes recommendations to canonical enum values', () => {
      expect(normalizeRecommendation('Strong Hire')).toBe('strong_yes');
      expect(normalizeRecommendation('strongly_hire')).toBe('strong_yes');
      expect(normalizeRecommendation('hire')).toBe('yes');
      expect(normalizeRecommendation('select')).toBe('yes');
      expect(normalizeRecommendation('maybe')).toBe('maybe');
      expect(normalizeRecommendation('borderline')).toBe('maybe');
      expect(normalizeRecommendation('reject')).toBe('no');
      expect(normalizeRecommendation('fail')).toBe('no');
      expect(normalizeRecommendation('unknown_text')).toBe('not_assessed');
      expect(normalizeRecommendation(null)).toBe('not_assessed');
    });

    test('normalizes statuses to canonical lifecycle values', () => {
      expect(normalizeStatus('completed')).toBe('COMPLETED');
      expect(normalizeStatus('did_not_join')).toBe('NO_SHOW');
      expect(normalizeStatus('no_show')).toBe('NO_SHOW');
      expect(normalizeStatus('not_responded')).toBe('NO_SHOW');
      expect(normalizeStatus('cancelled')).toBe('CANCELLED');
      expect(normalizeStatus('expired')).toBe('EXPIRED');
      expect(normalizeStatus('in_progress')).toBe('IN_PROGRESS');
      expect(normalizeStatus('')).toBe('COMPLETED');
    });

    test('computes deterministic SHA-256 payload hash', () => {
      const p1 = { a: 1, b: 'test' };
      const p2 = { a: 1, b: 'test' };
      expect(computePayloadHash(p1)).toBe(computePayloadHash(p2));
      expect(computePayloadHash(p1)).toHaveLength(64);
    });
  });

  describe('Matching Safety Tests', () => {
    test('identifies placeholder and invalid emails', () => {
      expect(isPlaceholderEmail('dummy@gmail.com')).toBe(true);
      expect(isPlaceholderEmail('dummy.user@gmail.com')).toBe(true);
      expect(isPlaceholderEmail('test@example.com')).toBe(true);
      expect(isPlaceholderEmail('noemail@domain.com')).toBe(true);
      expect(isPlaceholderEmail('angelbeulah@college')).toBe(true);
      expect(isPlaceholderEmail('invalidemail')).toBe(true);
      expect(isPlaceholderEmail('')).toBe(true);
      expect(isPlaceholderEmail(null)).toBe(true);

      // Valid genuine emails
      expect(isPlaceholderEmail('priya.rp@gmail.com')).toBe(false);
      expect(isPlaceholderEmail('uzma.parveen@yahoo.co.in')).toBe(false);
      expect(isPlaceholderEmail('candidate123@college.edu.in')).toBe(false);
    });

    test('normalizes phone and rejects placeholder numbers', () => {
      expect(normalizePhone('+91 98765 43210')).toBe('9876543210');
      expect(normalizePhone('09876543210')).toBe('9876543210');
      expect(normalizePhone('9876543210')).toBe('9876543210');

      // Placeholders
      expect(normalizePhone('1234567890')).toBeNull();
      expect(normalizePhone('0000000000')).toBeNull();
      expect(normalizePhone('9999999999')).toBeNull();
      expect(normalizePhone('12345')).toBeNull(); // < 10 digits
      expect(normalizePhone(null)).toBeNull();
    });
  });

  describe('Webhook HMAC Signature Verification', () => {
    const secret = 'test_secret_for_recruit_ai_webhook_signature_32ch';
    const payload = JSON.stringify({ event: 'interview.completed', score: 85 });

    test('verifies valid HMAC signature', () => {
      const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      expect(verifyWebhookSignature(payload, sig, secret)).toBe(true);
      expect(verifyWebhookSignature(payload, `sha256=${sig}`, secret)).toBe(true);
    });

    test('rejects tampered body or invalid signature', () => {
      const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      const tampered = JSON.stringify({ event: 'interview.completed', score: 99 });
      expect(verifyWebhookSignature(tampered, sig, secret)).toBe(false);
      expect(verifyWebhookSignature(payload, 'deadbeef123456', secret)).toBe(false);
    });

    test('bypasses signature check if secret is null/unconfigured', () => {
      expect(verifyWebhookSignature(payload, null, null)).toBe(true);
    });
  });
});
