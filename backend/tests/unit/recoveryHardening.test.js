'use strict';

const fs = require('fs');
const path = require('path');

// Mock dependencies before requiring importJobManager
jest.mock('../../src/config/db', () => ({
  $executeRawUnsafe: jest.fn().mockResolvedValue(1),
  $queryRawUnsafe: jest.fn().mockResolvedValue([]),
  $disconnect: jest.fn().mockResolvedValue(),
}));

const {
  isRecoveryCircuitBreakerTripped,
  resetRecoveryCircuitBreaker,
  resumeSingleJob,
  runStartupRecoverySweep,
} = require('../../src/lib/importJobManager');

const jobRepo = require('../../src/lib/importJobRepository');

describe('Recovery Hardening & Circuit Breaker Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRecoveryCircuitBreaker();
  });

  test('Circuit breaker initial state is healthy (not tripped)', () => {
    expect(isRecoveryCircuitBreakerTripped()).toBe(false);
  });

  test('Pre-Resume Validation: Missing source file terminates immediately as FAILED_INCOMPLETE without retry', async () => {
    const markJobStatusSpy = jest.spyOn(jobRepo, 'markJobStatus').mockResolvedValue();
    const incrementAttemptsSpy = jest.spyOn(jobRepo, 'incrementResumeAttempts').mockResolvedValue(1);

    const nonExistentJob = {
      id: 'job_missing_file_test',
      flow_type: 'candidates',
      file_path: path.join(__dirname, 'non_existent_file.xlsx'),
      source_filename: 'missing.xlsx',
      resume_attempts: 0,
      last_committed_row: 0,
    };

    const success = await resumeSingleJob(nonExistentJob);
    expect(success).toBe(false);
    expect(markJobStatusSpy).toHaveBeenCalledWith(
      'job_missing_file_test',
      'FAILED_INCOMPLETE',
      expect.objectContaining({
        metrics: expect.objectContaining({
          failureReason: expect.stringContaining('Source file missing or inaccessible on disk'),
        }),
      })
    );
  });

  test('Hard Attempt Cap: Job at attempt cap (3) is immediately marked FAILED_INCOMPLETE and not executed', async () => {
    const markJobStatusSpy = jest.spyOn(jobRepo, 'markJobStatus').mockResolvedValue();
    const incrementAttemptsSpy = jest.spyOn(jobRepo, 'incrementResumeAttempts').mockResolvedValue(3);

    const cappedJob = {
      id: 'job_capped_test',
      flow_type: 'candidates',
      file_path: __filename, // Real file, but attempts already at 3
      source_filename: 'capped.xlsx',
      resume_attempts: 3,
      last_committed_row: 10,
    };

    const success = await resumeSingleJob(cappedJob);
    expect(success).toBe(false);
    expect(markJobStatusSpy).toHaveBeenCalledWith(
      'job_capped_test',
      'FAILED_INCOMPLETE',
      expect.objectContaining({
        metrics: expect.objectContaining({
          failureReason: expect.stringContaining('Max resumption attempts (3) reached'),
        }),
      })
    );
  });

  test('Circuit Breaker trips after consecutive recovery failures', async () => {
    jest.spyOn(jobRepo, 'markJobStatus').mockResolvedValue();
    jest.spyOn(jobRepo, 'incrementResumeAttempts').mockResolvedValue(1);

    // Job 1 fails (missing file)
    await resumeSingleJob({
      id: 'job_fail_1',
      file_path: '/invalid/path/1.xlsx',
      resume_attempts: 0,
    });

    // Job 2 fails (missing file) -> should trip circuit breaker
    await resumeSingleJob({
      id: 'job_fail_2',
      file_path: '/invalid/path/2.xlsx',
      resume_attempts: 0,
    });

    // Circuit breaker is tripped
    expect(isRecoveryCircuitBreakerTripped()).toBe(true);

    // Any subsequent startup recovery sweep must be completely skipped
    const sweepResult = await runStartupRecoverySweep();
    expect(sweepResult).toEqual([]);

    // Admin reset recovers the circuit breaker
    resetRecoveryCircuitBreaker();
    expect(isRecoveryCircuitBreakerTripped()).toBe(false);
  });
});
