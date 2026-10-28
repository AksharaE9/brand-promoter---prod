'use strict';

/**
 * backend/src/modules/integrations/recruit-ai/outboundDispatcher.js
 *
 * Dispatches scheduled and rescheduled interviews to Recruit AI / HireIQ:
 * Target: POST https://187.127.137.103/api/integrations/talentos/schedule
 * (or configured via RECRUITAI_SCHEDULE_WEBHOOK_URL in .env)
 * Header: x-api-key: hireiq_live_79aF2xK9_mQ8vL4wP1zX3cR6yB0jH5eT2
 *
 * Overriding constraint: Asynchronous, non-blocking. Never aborts TalentOS scheduling.
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

async function dispatchScheduledInterview(interviewData) {
  // Feature flag check
  if (process.env.RECRUITAI_SYNC_ENABLED === 'false') {
    return { skipped: true, reason: 'RECRUITAI_SYNC_ENABLED is false' };
  }

  const apiKey = process.env.RECRUITAI_API_KEY;
  const targetUrl = process.env.RECRUITAI_SCHEDULE_WEBHOOK_URL || 'https://187.127.137.103/api/integrations/talentos/schedule';

  if (!apiKey || !targetUrl) {
    return { skipped: true, reason: 'Missing RECRUITAI_API_KEY or target URL' };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (err) {
    console.warn('[RecruitAI Dispatcher] Invalid webhook URL:', targetUrl);
    return { error: 'INVALID_URL' };
  }

  const payload = {
    event: interviewData.status === 'RESCHEDULED' ? 'interview.rescheduled' : 'interview.scheduled',
    externalReference: interviewData.id,
    interviewId: interviewData.id,
    candidate: {
      id: interviewData.candidateId || interviewData.candidate?.id,
      name: interviewData.candidateName || interviewData.candidate?.fullName,
      email: interviewData.candidateEmail || interviewData.candidate?.email,
      phone: interviewData.candidatePhone || interviewData.candidate?.phone
    },
    role: interviewData.jobTitle || interviewData.candidate?.preferredRole || 'Candidate',
    round: {
      number: interviewData.roundNo || 1,
      label: interviewData.round || `Round ${interviewData.roundNo || 1}`
    },
    schedule: {
      startsAt: interviewData.scheduledStart ? new Date(interviewData.scheduledStart).toISOString() : null,
      durationMinutes: interviewData.durationMinutes || 30,
      mode: interviewData.mode || 'ONLINE',
      meetingLink: interviewData.meetingLink || interviewData.zohoLink || null
    },
    dispatchedAt: new Date().toISOString()
  };

  const dataString = JSON.stringify(payload);
  const isHttps = parsedUrl.protocol === 'https:';
  const transport = isHttps ? https : http;

  return new Promise((resolve) => {
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      timeout: 8000,
      rejectUnauthorized: false, // In case of self-signed test SSL cert
      headers: {
        'x-api-key': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(dataString),
        'User-Agent': 'TalentOS-Integrations/1.0'
      }
    };

    const req = transport.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[RecruitAI Dispatcher] Dispatched interview ${interviewData.id} -> ${res.statusCode}`);
          resolve({ success: true, status: res.statusCode });
        } else {
          console.warn(`[RecruitAI Dispatcher] Remote responded with ${res.statusCode} for interview ${interviewData.id}`);
          resolve({ success: false, status: res.statusCode, body: body.substring(0, 200) });
        }
      });
    });

    req.on('error', (err) => {
      console.warn(`[RecruitAI Dispatcher] Failed to dispatch interview ${interviewData.id}:`, err.message);
      resolve({ success: false, error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      console.warn(`[RecruitAI Dispatcher] Timeout dispatching interview ${interviewData.id}`);
      resolve({ success: false, error: 'TIMEOUT' });
    });

    req.write(dataString);
    req.end();
  });
}

module.exports = {
  dispatchScheduledInterview
};
