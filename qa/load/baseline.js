// qa/load/baseline.js
import { authenticateAdmin, THRESHOLDS } from './config.js';
import { executeWeightedJourney } from './user_journeys.js';

export const options = {
  stages: [
    { duration: '1m', target: 10 },  // Ramp up to 10 VUs (1xP)
    { duration: '8m', target: 10 },  // Steady at 1xP for 8 min
    { duration: '1m', target: 0 },   // Ramp down
  ],
  thresholds: THRESHOLDS,
};

export function setup() {
  return authenticateAdmin();
}

export default function (data) {
  executeWeightedJourney(data.token);
}
