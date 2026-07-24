'use strict';

/**
 * Lead Import Schema & Completion Percentage Helper (Frontend)
 */

export const LEAD_IMPORT_SCHEMA = [
  { key: 'name', label: 'Name', required: true },
  { key: 'phone', label: 'Phone Number', required: true },
];

export function computeCompletionPercentage(callsDone, totalLeadsToday) {
  const done = Number(callsDone) || 0;
  const total = Number(totalLeadsToday) || 0;
  if (total <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}
