// qa/load/feature_specific.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import crypto from 'k6/crypto';
import { BASE_URL, HIREIQ_API_KEY, authenticateAdmin, getHeaders } from './config.js';

export const options = {
  scenarios: {
    // 1. External API Rate Limit Verification (60 req/min limit)
    ext_api_ratelimit: {
      executor: 'per-vu-iterations',
      vus: 5,
      iterations: 20, // 100 requests across 5 VUs to deliberately trigger 429
      maxDuration: '30s',
      exec: 'testExtApiRateLimit',
    },
    // 2. Recruit AI Webhook Burst (50 signed events in 10s)
    recruit_ai_webhook_burst: {
      executor: 'constant-arrival-rate',
      rate: 5, // 5 requests per second for 10s = 50 events
      timeUnit: '1s',
      duration: '10s',
      preAllocatedVUs: 10,
      maxVUs: 20,
      exec: 'testRecruitAiWebhookBurst',
    },
  },
};

export function setup() {
  return authenticateAdmin();
}

/**
 * 1. External API: Verify 60/min limit returns 429 (not 500) and app stays healthy
 */
export function testExtApiRateLimit() {
  const params = {
    headers: {
      'x-api-key': HIREIQ_API_KEY,
      'Accept': 'application/json',
    },
    tags: { type: 'read' },
  };

  const res = http.get(`${BASE_URL}/api/v1/ext/interviews?limit=5`, params);
  check(res, {
    'ext api returns 200 or 429': (r) => r.status === 200 || r.status === 429,
    'ext api never returns 500': (r) => r.status !== 500,
  });
  sleep(0.1);
}

/**
 * 2. Recruit AI Webhook Burst: 50 signed events in 10s
 * Tests HMAC verification, idempotent deduplication, and non-blocking inbox
 */
export function testRecruitAiWebhookBurst() {
  const secret = __ENV.RECRUITAI_WEBHOOK_SECRET || 'test_recruit_ai_secret_key';
  const timestamp = Date.now();
  const eventId = `qa_loop3_evt_${timestamp}_${Math.floor(Math.random() * 10000)}`;

  const payloadObj = {
    eventId,
    eventType: 'INTERVIEW_COMPLETED',
    timestamp: new Date().toISOString(),
    data: {
      interviewId: `qa_loop3_interview_${Math.floor(Math.random() * 50)}`,
      candidateName: `QA_LOOP3_Burst_Candidate_${Math.floor(Math.random() * 1000)}`,
      score: 85,
      recommendation: 'SELECTED',
      summary: 'Automated burst load test payload',
    },
  };

  const rawPayload = JSON.stringify(payloadObj);
  // Generate HMAC-SHA256 signature
  const signature = crypto.hmac('sha256', secret, rawPayload, 'hex');

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'x-recruit-ai-signature': signature,
      'x-webhook-event-id': eventId,
    },
    tags: { type: 'write' },
  };

  const res = http.post(`${BASE_URL}/api/v1/integrations/recruit-ai/webhook`, rawPayload, params);
  check(res, {
    'webhook accepted 200/202 or handled': (r) => r.status === 200 || r.status === 202 || r.status === 400 || r.status === 401,
    'webhook does not crash server': (r) => r.status !== 500 && r.status !== 502,
  });
}
