'use strict';

/**
 * qa/tests/recruit_ai_sync.test.js
 *
 * Automated QA tests for Recruit AI Synchronization (Part 4.N)
 */

const crypto = require('crypto');
const {
  computePayloadHash,
  normalizeScore,
  normalizeRecommendation,
  normalizeStatus
} = require('../../backend/src/modules/integrations/recruit-ai/normalizer');

const {
  isPlaceholderEmail,
  normalizePhone
} = require('../../backend/src/modules/integrations/recruit-ai/matchingService');

const {
  verifyWebhookSignature
} = require('../../backend/src/modules/integrations/recruit-ai/inboxService');

describe('QA Suite: Recruit AI Results Sync (N)', () => {
  const secret = 'recruitai_test_secret_key_32chars_len_abc';
  const testPayload = JSON.stringify({
    provider: 'recruit_ai',
    providerResultId: 'res_123',
    score: { raw: 85, scaleMax: 100 },
    recommendation: 'strong_hire'
  });

  test('N1: Webhook HMAC signature verification works and rejects tampered bodies', () => {
    const validSig = crypto.createHmac('sha256', secret).update(testPayload).digest('hex');
    expect(verifyWebhookSignature(testPayload, validSig, secret)).toBe(true);
    expect(verifyWebhookSignature(testPayload, `sha256=${validSig}`, secret)).toBe(true);

    const tampered = JSON.stringify({ provider: 'recruit_ai', score: 100 });
    expect(verifyWebhookSignature(tampered, validSig, secret)).toBe(false);
  });

  test('N2: Computes deterministic payload hash for deduplication', () => {
    const p1 = { provider: 'recruit_ai', resultId: 'r1' };
    const p2 = { provider: 'recruit_ai', resultId: 'r1' };
    expect(computePayloadHash(p1)).toBe(computePayloadHash(p2));
  });

  test('N4: Matching rules — rejects placeholders and name-only matching', () => {
    expect(isPlaceholderEmail('dummy@gmail.com')).toBe(true);
    expect(isPlaceholderEmail('test@example.com')).toBe(true);
    expect(isPlaceholderEmail('noemail@domain.com')).toBe(true);
    expect(isPlaceholderEmail('candidate@realcorp.com')).toBe(false);

    expect(normalizePhone('1234567890')).toBeNull();
    expect(normalizePhone('0000000000')).toBeNull();
    expect(normalizePhone('+91 98765 43210')).toBe('9876543210');
  });

  test('N5: Score and recommendation normalisation', () => {
    const score = normalizeScore(88);
    expect(score.scoreRaw).toBe(88);
    expect(score.scoreNormalised100).toBe(88);
    expect(score.ratingOutOf10).toBe(8.8);

    expect(normalizeRecommendation('strong_hire')).toBe('strong_yes');
    expect(normalizeRecommendation('hire')).toBe('yes');
    expect(normalizeRecommendation('reject')).toBe('no');
    expect(normalizeRecommendation('borderline')).toBe('maybe');

    expect(normalizeStatus('did_not_join')).toBe('NO_SHOW');
    expect(normalizeStatus('completed')).toBe('COMPLETED');
  });
});
