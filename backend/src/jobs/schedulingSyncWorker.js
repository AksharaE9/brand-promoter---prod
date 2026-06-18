// src/jobs/schedulingSyncWorker.js

const SYNC_QUEUE_NAME = 'scheduling-firebase-sync';

class MockQueue {
  constructor(name) {
    this.name = name;
  }
  async getRepeatableJobs() { return []; }
  async removeRepeatableByKey() { return true; }
  async add() { return { id: 'mock-job' }; }
  async getJob() { return null; }
  async close() { return true; }
}

class MockWorker {
  constructor(name) {
    this.name = name;
  }
  async close() { return true; }
}

let syncQueue = new MockQueue(SYNC_QUEUE_NAME);
let worker = new MockWorker(SYNC_QUEUE_NAME);

const syncProcessor = async (job) => {
  return { synced: 0 };
};

async function scheduleSyncJob() {
  console.log('[SchedulingSync] Synchronous database writes are active, interval-based sync is disabled.');
}

module.exports = {
  worker,
  syncQueue,
  scheduleSyncJob
};
