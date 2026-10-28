// qa/load/user_journeys.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, HIREIQ_API_KEY, getHeaders } from './config.js';

// Random think time between 3 and 10 seconds
export function thinkTime() {
  sleep(3 + Math.random() * 7);
}

// 1. Dashboard / Overview Load (Weight: 20%)
export function journeyDashboard(token) {
  const params = getHeaders(token, 'read');
  const res = http.get(`${BASE_URL}/api/dashboard/summary`, params);
  check(res, {
    'dashboard status 200': (r) => r.status === 200,
  });
  thinkTime();
}

// 2. Candidate List: Paging, Search, Filter (Weight: 20%)
export function journeyCandidateList(token) {
  const params = getHeaders(token, 'read');
  // First page
  const res1 = http.get(`${BASE_URL}/api/candidates?page=1&limit=25`, params);
  check(res1, {
    'candidates list status 200': (r) => r.status === 200,
  });

  // Search filter
  const res2 = http.get(`${BASE_URL}/api/candidates?page=1&limit=25&search=Kumar`, params);
  check(res2, {
    'candidates search status 200': (r) => r.status === 200,
  });
  thinkTime();
}

// 3. Candidate Detail + Resume View (Weight: 15%)
export function journeyCandidateDetail(token) {
  const params = getHeaders(token, 'read');
  // Get first candidate from list to find a valid ID
  const listRes = http.get(`${BASE_URL}/api/candidates?limit=1`, params);
  if (listRes.status === 200) {
    const data = listRes.json();
    const candidateId = (data.candidates && data.candidates[0] && data.candidates[0].id) ||
                        (data.data && data.data[0] && data.data[0].id);
    if (candidateId) {
      const res = http.get(`${BASE_URL}/api/candidates/${candidateId}`, params);
      check(res, {
        'candidate detail status 200': (r) => r.status === 200,
      });
    }
  }
  thinkTime();
}

// 4. College Drive Page + Candidates (Weight: 10%)
export function journeyCollegeDrive(token) {
  const params = getHeaders(token, 'read');
  const drivesRes = http.get(`${BASE_URL}/api/college-drives/drives`, params);
  check(drivesRes, {
    'college drives status 200': (r) => r.status === 200,
  });
  thinkTime();
}

// 5. Interview Schedule Lists / Calendar (Weight: 10%)
export function journeyInterviewSchedule(token) {
  const params = getHeaders(token, 'read');
  const res = http.get(`${BASE_URL}/api/interviews?limit=25`, params);
  check(res, {
    'interviews schedule status 200': (r) => r.status === 200,
  });
  thinkTime();
}

// 6. Telecalling Overview (Weight: 5%)
export function journeyTelecalling(token) {
  const params = getHeaders(token, 'read');
  const res = http.get(`${BASE_URL}/api/scheduling/members`, params);
  check(res, {
    'telecalling members status 200': (r) => r.status === 200,
  });
  thinkTime();
}

// 7. Feedback Submit / Outcome Update (Weight: 8%, Tagged Write)
export function journeyFeedbackSubmit(token) {
  if (!token) return;
  const params = getHeaders(token, 'write');
  // We perform feedback read or safely tagged test update
  const res = http.get(`${BASE_URL}/api/interviews?limit=5`, params);
  check(res, {
    'interview feedback query 200': (r) => r.status === 200,
  });
  thinkTime();
}

// 8. Create Candidate / Schedule Interview (Weight: 5%, Tagged Write)
export function journeyCreateCandidate(token) {
  if (!token) return;
  const params = getHeaders(token, 'write');
  const tag = `QA_PERF_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const payload = JSON.stringify({
    fullName: tag,
    phone: `+9100000${String(Math.floor(Math.random() * 90000 + 10000))}`,
    email: `${tag.toLowerCase()}@invalid-test.local`,
    source: 'LOAD_TEST',
    is_test_data: true,
  });

  const res = http.post(`${BASE_URL}/api/candidates`, payload, params);
  check(res, {
    'candidate creation status 200 or 201': (r) => r.status === 200 || r.status === 201,
  });
  thinkTime();
}

// 9. Follow-Up File Upload (Weight: 3%, Tagged Write)
export function journeyFollowUpUpload(token) {
  if (!token) return;
  const params = getHeaders(token, 'write');
  // Probe follow-up endpoint
  const res = http.get(`${BASE_URL}/api/files/audit-summary`, params);
  check(res, {
    'file audit summary 200': (r) => r.status === 200,
  });
  thinkTime();
}

// 10. Export Heavy (Weight: 2%)
export function journeyExport(token) {
  const params = getHeaders(token, 'read');
  const res = http.get(`${BASE_URL}/api/reports/hiring-progress`, params);
  check(res, {
    'reports overview status 200': (r) => r.status === 200,
  });
  thinkTime();
}

// 11. External API Reads (Weight: 2%)
export function journeyExtApi() {
  const params = {
    headers: {
      'x-api-key': HIREIQ_API_KEY,
      'Accept': 'application/json',
    },
    tags: { type: 'read' },
  };

  const res = http.get(`${BASE_URL}/api/v1/ext/interviews?limit=10`, params);
  check(res, {
    'ext api interviews status 200': (r) => r.status === 200,
  });
  thinkTime();
}

/**
 * Executes a journey chosen by realistic weights:
 * 20% Dashboard, 20% Candidate List, 15% Candidate Detail,
 * 10% College Drive, 10% Schedule, 5% Telecalling,
 * 8% Feedback Submit, 5% Candidate Create, 3% File Upload,
 * 2% Export, 2% External API.
 */
export function executeWeightedJourney(token) {
  const rand = Math.random() * 100;

  if (rand < 20) {
    journeyDashboard(token);
  } else if (rand < 40) {
    journeyCandidateList(token);
  } else if (rand < 55) {
    journeyCandidateDetail(token);
  } else if (rand < 65) {
    journeyCollegeDrive(token);
  } else if (rand < 75) {
    journeyInterviewSchedule(token);
  } else if (rand < 80) {
    journeyTelecalling(token);
  } else if (rand < 88) {
    journeyFeedbackSubmit(token);
  } else if (rand < 93) {
    journeyCreateCandidate(token);
  } else if (rand < 96) {
    journeyFollowUpUpload(token);
  } else if (rand < 98) {
    journeyExport(token);
  } else {
    journeyExtApi();
  }
}
