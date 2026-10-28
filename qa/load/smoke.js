// qa/load/smoke.js
import { authenticateAdmin, THRESHOLDS } from './config.js';
import { executeWeightedJourney } from './user_journeys.js';

export const options = {
  vus: 2,
  duration: '2m',
  thresholds: THRESHOLDS,
};

export function setup() {
  return authenticateAdmin();
}

export default function (data) {
  executeWeightedJourney(data.token);
}
