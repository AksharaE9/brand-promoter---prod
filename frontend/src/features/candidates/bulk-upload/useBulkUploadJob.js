import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../../services/api';
import { subscribeSSE } from '../../../lib/sse';

const ACTIVE_JOB_KEY = 'ats_active_bulk_upload_job_id';
const POLL_INTERVAL_MS = 3000;

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
  const terminalRef = useRef(false);

  const fetchStatus = useCallback(async (idToFetch) => {
    if (!idToFetch || terminalRef.current) return;
    try {
      const { data } = await api.get(`/candidates/bulk-upload/${idToFetch}`);
      if (data && data.data) {
        const d = data.data;
        const nextState = d.state || 'active';
        setJobState({
          state: nextState,
          progress: d.progress || 0,
          processed: d.processed || 0,
          succeeded: d.succeeded || 0,
          duplicates: d.duplicates || 0,
          failed: d.failed || 0,
          totalRows: d.totalRows || 0,
          errorReportUrl: d.errorReportUrl || null,
          error: d.error || null,
        });

        if (nextState === 'completed' || nextState === 'failed') {
          terminalRef.current = true;
          setActiveJobId(null);
        }
      }
    } catch (err) {
      if (err.response?.status === 404 || err.status === 404) {
        terminalRef.current = true;
        setActiveJobId(null);
        setJobId(null);
      }
      // On 429, skip this tick — next poll retries after cooldown
    }
  }, []);

  const startJob = useCallback((newJobId) => {
    terminalRef.current = false;
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
    terminalRef.current = true;
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

  // Poll only while job is active; stop once completed/failed
  useEffect(() => {
    if (!jobId) return;
    if (jobState.state === 'completed' || jobState.state === 'failed') return;

    terminalRef.current = false;
    fetchStatus(jobId);

    const interval = setInterval(() => {
      if (terminalRef.current) return;
      fetchStatus(jobId);
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [jobId, jobState.state, fetchStatus]);

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
          progress: payload.totalRows
            ? Math.min(99, Math.round((payload.processed / payload.totalRows) * 100))
            : prev.progress,
        }));
      } else if (payload.type === 'bulk-upload:completed' && payload.jobId === jobId) {
        terminalRef.current = true;
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
