// qa/load/spike.js
import { authenticateAdmin, THRESHOLDS } from './config.js';
import { executeWeightedJourney } from './user_journeys.js';

export const options = {
  stages: [
    { duration: '1m', target: 10 },   // Baseline 10 VUs
    { duration: '30s', target: 80 },  // Immediate Spike to 80 VUs
    { duration: '2m', target: 80 },   // Hold spike for 2 min
    { duration: '30s', target: 10 },  // Drop back to baseline
    { duration: '3m', target: 10 },   // Observe recovery
    { duration: '1m', target: 0 },    // Cooldown
  ],
  thresholds: THRESHOLDS,
};

export function setup() {
  return authenticateAdmin();
}

export default function (data) {
  executeWeightedJourney(data.token);
}
