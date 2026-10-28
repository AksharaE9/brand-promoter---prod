// qa/load/stress.js
import { authenticateAdmin, THRESHOLDS } from './config.js';
import { executeWeightedJourney } from './user_journeys.js';

export const options = {
  stages: [
    { duration: '2m', target: 10 },   // Step 1: 10 VUs
    { duration: '3m', target: 10 },
    { duration: '2m', target: 25 },   // Step 2: 25 VUs
    { duration: '3m', target: 25 },
    { duration: '2m', target: 50 },   // Step 3: 50 VUs
    { duration: '3m', target: 50 },
    { duration: '2m', target: 100 },  // Step 4: 100 VUs
    { duration: '3m', target: 100 },
    { duration: '2m', target: 200 },  // Step 5: 200 VUs
    { duration: '3m', target: 200 },
    { duration: '2m', target: 400 },  // Step 6: 400 VUs
    { duration: '3m', target: 400 },
    { duration: '2m', target: 0 },    // Cooldown
  ],
  thresholds: THRESHOLDS,
};

export function setup() {
  return authenticateAdmin();
}

export default function (data) {
  executeWeightedJourney(data.token);
}
