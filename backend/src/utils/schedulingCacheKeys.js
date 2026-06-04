// src/utils/schedulingCacheKeys.js
const SCHEDULING_KEYS = {
  // List of all interview rounds for an org
  roundsList: (orgId, filters = '') => 
    `scheduling:rounds:list:${orgId}:${filters}`,
  
  // Single round detail
  round: (roundId) => 
    `scheduling:round:${roundId}`,
  
  // All rounds for a specific candidate
  candidateRounds: (candidateId) => 
    `scheduling:candidate:${candidateId}:rounds`,
  
  // All rounds for a specific interviewer
  interviewerRounds: (userId, date = '') => 
    `scheduling:interviewer:${userId}:rounds:${date}`,
  
  // Dirty write queue — rounds pending Firebase sync
  dirtyQueue: () => 
    `scheduling:dirty:queue`,
  
  // Individual dirty round payload
  dirtyRound: (roundId) => 
    `scheduling:dirty:round:${roundId}`,
  
  // Lock key to prevent concurrent syncs
  syncLock: () => 
    `scheduling:sync:lock`,
  
  // Last sync timestamp
  lastSync: (orgId) => 
    `scheduling:sync:last:${orgId}`,
  
  // Optimistic write log for conflict detection
  writeLog: (roundId) => 
    `scheduling:writelog:${roundId}`,
};

module.exports = SCHEDULING_KEYS;
