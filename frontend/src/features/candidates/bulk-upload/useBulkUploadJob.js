import { useState, useEffect, useCallback } from 'react';
import api from '../../../services/api';
import { subscribeSSE } from '../../../lib/sse';

const ACTIVE_JOB_KEY = 'ats_active_bulk_upload_job_id';

export function getActiveJobId() {
  return localStorage.getItem(ACTIVE_JOB_KEY) || null;
}

export function setActiveJobId(jobId) {
  if (jobId) {
    localStorage.setItem(ACTIVE_JOB_KEY, jobId);
  } else {
    localStorage.removeItem(ACTIVE_JOB_KEY);
  }
}

export function useBulkUploadJob(initialJobId = null) {
  const [jobId, setJobId] = useState(() => initialJobId || getActiveJobId());
  const [jobState, setJobState] = useState({
    state: 'idle', // 'idle' | 'active' | 'completed' | 'failed'
    progress: 0,
    processed: 0,
    succeeded: 0,
    duplicates: 0,
    failed: 0,
    totalRows: 0,
    errorReportUrl: null,
    error: null,
  });

  const fetchStatus = useCallback(async (idToFetch) => {
    if (!idToFetch) return;
    try {
      const { data } = await api.get(`/candidates/bulk-upload/${idToFetch}`);
      if (data && data.data) {
        const d = data.data;
        setJobState({
          state: d.state || 'active',
          progress: d.progress || 0,
          processed: d.processed || 0,
          succeeded: d.succeeded || 0,
          duplicates: d.duplicates || 0,
          failed: d.failed || 0,
          totalRows: d.totalRows || 0,
          errorReportUrl: d.errorReportUrl || null,
          error: d.error || null,
        });

        if (d.state === 'completed' || d.state === 'failed') {
          setActiveJobId(null);
        }
      }
    } catch (err) {
      if (err.response?.status === 404) {
        setActiveJobId(null);
        setJobId(null);
      }
    }
  }, []);

  const startJob = useCallback((newJobId) => {
    setActiveJobId(newJobId);
    setJobId(newJobId);
    setJobState({
      state: 'active',
      progress: 0,
      processed: 0,
      succeeded: 0,
      duplicates: 0,
      failed: 0,
      totalRows: 0,
      errorReportUrl: null,
      error: null,
    });
  }, []);

  const resetJob = useCallback(() => {
    setActiveJobId(null);
    setJobId(null);
    setJobState({
      state: 'idle',
      progress: 0,
      processed: 0,
      succeeded: 0,
      duplicates: 0,
      failed: 0,
      totalRows: 0,
      errorReportUrl: null,
      error: null,
    });
  }, []);

  // Poll status interval while job is active
  useEffect(() => {
    if (!jobId) return;

    fetchStatus(jobId);

    const interval = setInterval(() => {
      fetchStatus(jobId);
    }, 1500);

    return () => clearInterval(interval);
  }, [jobId, fetchStatus]);

  // SSE subscription setup
  useEffect(() => {
    if (!jobId) return;

    const unsub = subscribeSSE((payload) => {
      if (payload.type === 'bulk-upload:progress' && payload.jobId === jobId) {
        setJobState((prev) => ({
          ...prev,
          state: 'active',
          processed: payload.processed,
          succeeded: payload.succeeded,
          duplicates: payload.duplicates || 0,
          failed: payload.failed,
          totalRows: payload.totalRows || prev.totalRows,
          progress: payload.totalRows ? Math.min(99, Math.round((payload.processed / payload.totalRows) * 100)) : prev.progress,
        }));
      } else if (payload.type === 'bulk-upload:completed' && payload.jobId === jobId) {
        setJobState({
          state: 'completed',
          progress: 100,
          processed: payload.processed,
          succeeded: payload.succeeded,
          duplicates: payload.duplicates || 0,
          failed: payload.failed,
          totalRows: payload.processed,
          errorReportUrl: payload.errorReportUrl || null,
          error: null,
        });
        setActiveJobId(null);
      }
    });

    return () => {
      unsub();
    };
  }, [jobId]);

  return {
    jobId,
    jobState,
    startJob,
    resetJob,
    fetchStatus,
  };
}
