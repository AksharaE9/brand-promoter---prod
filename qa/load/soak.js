// qa/load/soak.js
import { authenticateAdmin, THRESHOLDS } from './config.js';
import { executeWeightedJourney } from './user_journeys.js';

export const options = {
  stages: [
    { duration: '2m', target: 15 },   // Ramp up to 15 VUs
    { duration: '56m', target: 15 },  // Soak for ~60 minutes
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: THRESHOLDS,
};

export function setup() {
  return authenticateAdmin();
}

export default function (data) {
  executeWeightedJourney(data.token);
}
