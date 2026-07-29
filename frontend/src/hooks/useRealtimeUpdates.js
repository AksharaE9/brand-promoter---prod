import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient }  from '@tanstack/react-query';
import { useAuthStore }    from '../stores/authStore';
import { useToastStore }   from '../stores/toastStore';
import { useNotificationStore } from '../stores/notificationStore';
import { subscribeSSE, initSSE }    from '../lib/sse';

const getApiBaseUrl = () => {
  const devUrl = import.meta.env.DEV ? 'http://localhost:4000/api' : '/api';
  const resolved = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || devUrl;
  return resolved.replace(/\/+$/, '');
};

const getSseUrl = () => {
  const base = getApiBaseUrl();
  if (base.endsWith('/api')) {
    return base.slice(0, -4) + '/api/sse/stream';
  }
  return base + '/sse/stream';
};

const SSE_URL = getSseUrl();

// Every SSE event name the backend can emit
const ALL_EVENTS = [
  'CONNECTED', 'SYNC_STATE',
  // Candidates
  'CANDIDATE_CREATED','CANDIDATE_UPDATED','CANDIDATE_DELETED',
  'CANDIDATE_STATUS_CHANGED','CANDIDATE_STAGE_CHANGED',
  'CANDIDATE_RECRUITER_ASSIGNED','CANDIDATE_JOINED','CANDIDATE_REJECTED',
  // Applications
  'APPLICATION_CREATED','APPLICATION_UPDATED','APPLICATION_DELETED',
  'APPLICATION_STAGE_CHANGED','APPLICATION_STATUS_CHANGED','APPLICATION_TRANSFERRED',
  // Scheduling
  'SCHEDULING_UPDATE','SCHEDULING_SYNC_COMPLETE',
  'ROUND_CREATED','ROUND_DELETED',
  'SCHEDULING_LEAD_LIST_UPDATED','SCHEDULING_REPORT_SUBMITTED','SCHEDULING_MEMBER_FILE_ADDED',
  'scheduling:lead-list:updated','scheduling:report:updated','scheduling:member-file:added',
  // Jobs
  'JOB_CREATED','JOB_UPDATED','JOB_DELETED','JOB_STATUS_CHANGED',
  // Team
  'TEAM_MEMBER_INVITED','TEAM_MEMBER_JOINED','TEAM_MEMBER_UPDATED',
  'TEAM_ROLE_CHANGED','TEAM_USERTYPE_CHANGED',
  'TEAM_MEMBER_DELETED','TEAM_MEMBER_RESTORED',
  'YOUR_ROLE_CHANGED','PROFILE_UPDATED','ACCOUNT_DEACTIVATED',
  'YOU_HAVE_BEEN_ASSIGNED_CANDIDATE',
  // Drives
  'DRIVE_CREATED','DRIVE_UPDATED','DRIVE_DELETED',
  'DRIVE_STATUS_CHANGED','DRIVE_CANDIDATES_ADDED',
  'DRIVE_CANDIDATE_REMOVED','DRIVE_BULK_UPLOAD_COMPLETE',
  // Audit
  'AUDIT_LOG_CREATED',
  // Settings
  'ORG_SETTINGS_UPDATED','ORG_CONTACT_UPDATED','ORG_LOGO_UPDATED',
  // Bulk
  'BULK_IMPORT_PROGRESS','BULK_IMPORT_COMPLETE',
  // Notifications
  'NOTIFICATION',
  'VISIBILITY_RECONCILE',
  'interview-feedback:updated',
  'INTERVIEW_FEEDBACK_SUBMITTED',
  'INTERVIEW_PANELISTS_UPDATED',
];

// ── Polling fallback query keys ──
const CRITICAL_QUERY_KEYS = [
  ['candidates'], ['jobs'], ['scheduling', 'rounds'],
  ['dashboard'], ['team'], ['applications'],
];

// ── Cache helpers ──
function updateInfiniteOrFlatList(old, updateFn) {
  if (!old) return old;

  // 1. Infinite query cache: { pages: [ { data: [...], rows: [...] } ], pageParams: [...] }
  if (Array.isArray(old.pages)) {
    return {
      ...old,
      pages: old.pages.map((page) => {
        const currentData = Array.isArray(page.data) ? page.data : [];
        const currentRows = Array.isArray(page.rows) ? page.rows : [];
        
        return {
          ...page,
          data: updateFn(currentData),
          rows: updateFn(currentRows),
        };
      }),
    };
  }

  // 2. Standard flat list object: { data: [...] }
  if (Array.isArray(old.data)) {
    return {
      ...old,
      data: updateFn(old.data),
    };
  }

  // 3. Raw array
  if (Array.isArray(old)) {
    return updateFn(old);
  }

  return old;
}

function updateInList(old, id, changes) {
  return updateInfiniteOrFlatList(old, (list) =>
    list.map((i) => (i.id === id ? { ...i, ...changes } : i))
  );
}

function removeFromList(old, id) {
  return updateInfiniteOrFlatList(old, (list) =>
    list.filter((i) => i.id !== id)
  );
}

export function useRealtimeUpdates() {
  const qc   = useQueryClient();
  const { isAuthenticated, accessToken } = useAuthStore();
  const { addToast }        = useToastStore();
  const { addNotification, incrementUnread } = useNotificationStore();
  const esRef            = useRef(null);
  const reconnectTimer   = useRef(null);
  const reconnectDelay   = useRef(1000);
  const lastEventIdRef   = useRef(null);
  const consecutiveFailures = useRef(0);
  const pollingTimer     = useRef(null);
  const sseRetryTimer    = useRef(null);
  const [isPollingMode, setIsPollingMode] = useState(false);

  // ── Polling fallback ──
  const startPolling = useCallback(() => {
    if (pollingTimer.current) return;
    setIsPollingMode(true);
    console.log('[SSE] Switching to polling fallback (10s interval)');

    pollingTimer.current = setInterval(() => {
      CRITICAL_QUERY_KEYS.forEach(key => {
        qc.invalidateQueries({ queryKey: key });
      });
    }, 10000);

    // Try SSE again every 60s while polling
    sseRetryTimer.current = setInterval(() => {
      console.log('[SSE] Retrying SSE connection from polling mode...');
      initSSE();
    }, 60000);
  }, [qc]);

  const stopPolling = useCallback(() => {
    if (pollingTimer.current) {
      clearInterval(pollingTimer.current);
      pollingTimer.current = null;
    }
    if (sseRetryTimer.current) {
      clearInterval(sseRetryTimer.current);
      sseRetryTimer.current = null;
    }
    setIsPollingMode(false);
  }, []);

  const handle = useCallback((eventName, data) => {
    // Track event ID for replay
    if (data?._eventId) {
      lastEventIdRef.current = data._eventId;
    }

    switch (eventName) {

      case 'VISIBILITY_RECONCILE':
        CRITICAL_QUERY_KEYS.forEach(key => {
          qc.invalidateQueries({ queryKey: key });
        });
        break;

      /* ─── CANDIDATES ─── */
      case 'CANDIDATE_CREATED': {
        const { candidate: newCandidate } = data;
        if (newCandidate?.id) {
          // Surgically prepend to every cached list without a refetch.
          // Dedup check ensures the acting user's optimistic entry is not doubled.
          qc.setQueriesData({ queryKey: ['candidates'] }, (old) =>
            updateInfiniteOrFlatList(old, (list) => {
              if (list.some(c => c.id === newCandidate.id)) return list;
              return [newCandidate, ...list];
            })
          );
        } else {
          // Fallback: no candidate payload — do a soft invalidation (no immediate refetch)
          qc.invalidateQueries({ queryKey: ['candidates'], refetchType: 'none' });
        }
        addToast({ type: 'success', message: `New candidate: ${newCandidate?.fullName || ''}` });
        break;
      }

      case 'CANDIDATE_UPDATED':
        qc.setQueriesData({ queryKey:['candidates'] }, o => updateInList(o, data.candidateId, data.changes));
        qc.invalidateQueries({ queryKey:['candidate', data.candidateId] });
        break;

      case 'CANDIDATE_DELETED':
        qc.setQueriesData({ queryKey:['candidates'] }, o => removeFromList(o, data.candidateId));
        qc.invalidateQueries({ queryKey:['dashboard'] });
        addToast({ type:'warning', message:`Candidate removed by ${data.deletedByName}` });
        break;

      case 'CANDIDATE_STATUS_CHANGED':
        qc.setQueriesData({ queryKey:['candidates'] }, o =>
          updateInList(o, data.candidateId, { status: data.status, currentStage: data.stage })
        );
        qc.invalidateQueries({ queryKey:['candidate', data.candidateId] });
        qc.invalidateQueries({ queryKey:['analytics'] });
        break;

      case 'CANDIDATE_STAGE_CHANGED':
        qc.setQueriesData({ queryKey:['candidates'] }, o =>
          updateInList(o, data.candidateId, { currentStage: data.stage })
        );
        qc.invalidateQueries({ queryKey:['candidate', data.candidateId] });
        break;

      case 'CANDIDATE_RECRUITER_ASSIGNED':
        qc.setQueriesData({ queryKey:['candidates'] }, o =>
          updateInList(o, data.candidateId, {
            assignedRecruiterId: data.recruiterId,
            assignedRecruiterName: data.recruiterName,
          })
        );
        break;

      case 'YOU_HAVE_BEEN_ASSIGNED_CANDIDATE':
        addToast({ type:'info', message:`You have been assigned a candidate by ${data.assignedBy}` });
        qc.invalidateQueries({ queryKey:['candidates'] });
        break;

      case 'CANDIDATE_JOINED':
        qc.invalidateQueries({ queryKey:['candidates'] });
        qc.invalidateQueries({ queryKey:['joined-candidates'] });
        qc.invalidateQueries({ queryKey:['offer-candidates'] });
        qc.invalidateQueries({ queryKey:['analytics'] });
        qc.invalidateQueries({ queryKey:['dashboard'] });
        addToast({ type:'success', message:'Candidate marked as Joined' });
        break;

      case 'CANDIDATE_REJECTED':
        qc.invalidateQueries({ queryKey:['candidates'] });
        qc.invalidateQueries({ queryKey:['rejected-candidates'] });
        qc.invalidateQueries({ queryKey:['offer-candidates'] });
        qc.invalidateQueries({ queryKey:['analytics'] });
        addToast({ type:'info', message:'Offer rejected' });
        break;

      /* ─── APPLICATIONS ─── */
      case 'APPLICATION_CREATED':
        qc.invalidateQueries({ queryKey:['applications'] });
        qc.invalidateQueries({ queryKey:['candidate', data.candidateId] });
        addToast({ type:'info', message:`Application created for ${data.candidateName}` });
        break;

      case 'APPLICATION_UPDATED':
        qc.invalidateQueries({ queryKey:['applications', data.applicationId] });
        qc.invalidateQueries({ queryKey:['candidate', data.candidateId] });
        break;

      case 'APPLICATION_DELETED':
        qc.invalidateQueries({ queryKey:['applications'] });
        addToast({ type:'warning', message:'Application removed' });
        break;

      case 'APPLICATION_STAGE_CHANGED':
        qc.invalidateQueries({ queryKey:['applications', data.applicationId] });
        qc.invalidateQueries({ queryKey:['candidate', data.candidateId] });
        qc.invalidateQueries({ queryKey:['analytics'] });
        addToast({ type:'info', message:`Stage updated: ${data.toStage}` });
        break;

      case 'APPLICATION_STATUS_CHANGED':
        qc.invalidateQueries({ queryKey:['applications', data.applicationId] });
        break;

      case 'APPLICATION_TRANSFERRED':
        qc.invalidateQueries({ queryKey:['applications'] });
        qc.invalidateQueries({ queryKey:['candidate', data.candidateId] });
        addToast({ type:'info', message:`Candidate transferred to ${data.toJobTitle}` });
        break;

      /* ─── SCHEDULING ─── */
      case 'SCHEDULING_UPDATE': {
        const { type: t, subType, roundId, round } = data;
        const sub = subType || t;
        if (sub === 'ROUND_UPDATED') {
          qc.setQueryData(['scheduling','round',roundId], o => ({ ...o, data:{ ...(o?.data??{}), ...round, _optimistic:false }}));
          qc.setQueriesData({ queryKey:['scheduling','rounds'] }, o => updateInList(o, roundId, { ...round, _optimistic:false }));
          qc.invalidateQueries({ queryKey: ['scheduling'] });
          qc.invalidateQueries({ queryKey: ['candidates'] });
          qc.invalidateQueries({ queryKey: ['dashboard'] });
        }
        break;
      }

      case 'SCHEDULING_SYNC_COMPLETE': {
        const { tempIdMap, syncedIds } = data;
        qc.setQueriesData({ queryKey:['scheduling','rounds'] }, o => {
          if (!o?.data) return o;
          return {
            ...o,
            data: o.data.map(r => {
              let updatedRound = { ...r };
              const realId = tempIdMap?.[r.id];
              if (realId) {
                updatedRound.id = realId;
                updatedRound._pendingSync = false;
                updatedRound._optimistic = false;
              }
              const currentId = realId || r.id;
              if (syncedIds?.includes(currentId)) {
                updatedRound._pendingSync = false;
                updatedRound._optimistic = false;
              }
              return updatedRound;
            })
          };
        });
        qc.invalidateQueries({ queryKey:['scheduling'] });
        break;
      }

      case 'ROUND_CREATED': {
        const { round: newRound } = data;
        if (newRound?.id) {
          // Surgically prepend to every cached scheduling list without refetch.
          qc.setQueriesData({ queryKey: ['scheduling', 'rounds'] }, (old) =>
            updateInfiniteOrFlatList(old, (list) => {
              if (list.some(r => r.id === newRound.id)) return list;
              return [newRound, ...list];
            })
          );
        }
        qc.invalidateQueries({ queryKey: ['scheduling'] });
        qc.invalidateQueries({ queryKey: ['candidates'] });
        qc.invalidateQueries({ queryKey: ['dashboard'] });
        if (newRound?.candidateId) {
          qc.invalidateQueries({ queryKey: ['candidate', newRound.candidateId] });
          qc.invalidateQueries({ queryKey: ['interviews', newRound.candidateId] });
          qc.invalidateQueries({ queryKey: ['candidate-feedbacks', newRound.candidateId] });
        }
        addToast({ type: 'success', message: 'Interview scheduled' });
        break;
      }

      case 'ROUND_DELETED':
        qc.setQueriesData({ queryKey:['scheduling','rounds'] }, o => removeFromList(o, data.roundId));
        qc.invalidateQueries({ queryKey: ['scheduling'] });
        qc.invalidateQueries({ queryKey: ['candidates'] });
        qc.invalidateQueries({ queryKey: ['dashboard'] });
        if (data.candidateId) {
          qc.invalidateQueries({ queryKey: ['candidate', data.candidateId] });
          qc.invalidateQueries({ queryKey: ['interviews', data.candidateId] });
          qc.invalidateQueries({ queryKey: ['candidate-feedbacks', data.candidateId] });
        }
        addToast({ type:'info', message:'Interview round removed' });
        break;

      case 'interview-feedback:updated':
        qc.invalidateQueries({ queryKey: ['scheduling'] });
        qc.invalidateQueries({ queryKey: ['candidates'] });
        qc.invalidateQueries({ queryKey: ['dashboard'] });
        qc.invalidateQueries({ queryKey: ['scheduling', 'round-details'], refetchType: 'active' });
        if (data.candidateId) {
          qc.invalidateQueries({ queryKey: ['candidate', data.candidateId] });
          qc.invalidateQueries({ queryKey: ['interviews', data.candidateId] });
          qc.invalidateQueries({ queryKey: ['candidate-feedbacks', data.candidateId] });
        }
        break;

      case 'INTERVIEW_FEEDBACK_SUBMITTED':
        // Always invalidate the broad scheduling & candidates caches
        qc.invalidateQueries({ queryKey: ['scheduling'] });
        qc.invalidateQueries({ queryKey: ['scheduling', 'round-details'], refetchType: 'active' });
        qc.invalidateQueries({ queryKey: ['candidates'] });
        qc.invalidateQueries({ queryKey: ['dashboard'] });
        // Invalidate per-candidate caches when candidateId is available
        if (data.candidateId) {
          qc.invalidateQueries({ queryKey: ['candidate', data.candidateId] });
          qc.invalidateQueries({ queryKey: ['interviews', data.candidateId] });
          qc.invalidateQueries({ queryKey: ['candidate-feedbacks', data.candidateId] });
        }
        addToast({ type: 'info', message: `Feedback submitted${data.candidateName ? ` for ${data.candidateName}` : ''}` });
        break;

      case 'INTERVIEW_PANELISTS_UPDATED':
        qc.invalidateQueries({ queryKey: ['scheduling', 'rounds'] });
        if (data.interviewId) {
          qc.invalidateQueries({ queryKey: ['scheduling', 'round', data.interviewId] });
        }
        break;

      case 'SCHEDULING_LEAD_LIST_UPDATED':
      case 'scheduling:lead-list:updated':
        if (data.memberId) {
          qc.invalidateQueries({ queryKey: ['scheduling', 'member-lead-lists', data.memberId] });
        }
        break;

      case 'SCHEDULING_REPORT_SUBMITTED':
      case 'scheduling:report:updated':
        if (data.memberId) {
          qc.invalidateQueries({ queryKey: ['scheduling', 'member-reports', data.memberId] });
        }
        break;

      case 'SCHEDULING_MEMBER_FILE_ADDED':
      case 'scheduling:member-file:added':
        if (data.memberId) {
          qc.invalidateQueries({ queryKey: ['scheduling', 'member-files', data.memberId] });
        }
        break;

      /* ─── JOBS ─── */
      case 'JOB_CREATED':
        qc.invalidateQueries({ queryKey:['jobs'] });
        addToast({ type:'success', message:`Job created: ${data.title}` });
        break;

      case 'JOB_UPDATED':
        qc.setQueriesData({ queryKey:['jobs'] }, o => updateInList(o, data.jobId, data.changes));
        qc.invalidateQueries({ queryKey:['job', data.jobId] });
        break;

      case 'JOB_DELETED':
        qc.setQueriesData({ queryKey:['jobs'] }, o => removeFromList(o, data.jobId));
        addToast({ type:'warning', message:'A job has been removed' });
        break;

      case 'JOB_STATUS_CHANGED':
        qc.setQueriesData({ queryKey:['jobs'] }, o => updateInList(o, data.jobId, { status:data.status }));
        addToast({ type:'info', message:`Job status: ${data.status}` });
        break;

      /* ─── TEAM ─── */
      case 'TEAM_MEMBER_INVITED':
        qc.invalidateQueries({ queryKey:['team'] });
        addToast({ type:'info', message:`Invitation sent to ${data.email}` });
        break;

      case 'TEAM_MEMBER_JOINED':
        qc.invalidateQueries({ queryKey:['team'] });
        addToast({ type:'success', message:`${data.fullName} joined the team` });
        break;

      case 'TEAM_MEMBER_UPDATED':
        qc.setQueriesData({ queryKey:['team'] }, o => updateInList(o, data.userId, data.changes));
        qc.invalidateQueries({ queryKey:['user', data.userId] });
        break;

      case 'TEAM_ROLE_CHANGED':
        qc.setQueriesData({ queryKey:['team'] }, o => updateInList(o, data.userId, { role:data.newRole }));
        qc.invalidateQueries({ queryKey:['user', data.userId] });
        addToast({ type:'info', message:`Role updated for team member` });
        break;

      case 'YOUR_ROLE_CHANGED':
        qc.invalidateQueries({ queryKey:['profile'] });
        addToast({ type:'warning', message:`Your role changed from ${data.previousRole} to ${data.newRole}` });
        break;

      case 'TEAM_USERTYPE_CHANGED':
        qc.setQueriesData({ queryKey:['team'] }, o => updateInList(o, data.userId, { userType:data.userType }));
        break;

      case 'TEAM_MEMBER_DELETED':
        qc.setQueriesData({ queryKey:['team'] }, o => removeFromList(o, data.userId));
        addToast({ type:'warning', message:`${data.deletedByName || 'Admin'} removed a team member` });
        break;

      case 'TEAM_MEMBER_RESTORED':
        qc.invalidateQueries({ queryKey:['team'] });
        addToast({ type:'success', message:'Team member restored' });
        break;

      case 'PROFILE_UPDATED':
        qc.invalidateQueries({ queryKey:['profile'] });
        break;

      case 'ACCOUNT_DEACTIVATED':
        addToast({ type:'error', message:'Your account has been deactivated' });
        setTimeout(() => window.location.href = '/login', 3000);
        break;

      /* ─── DRIVES ─── */
      case 'DRIVE_CREATED':
        qc.invalidateQueries({ queryKey:['drives'] });
        addToast({ type:'success', message:`Drive created: ${data.collegeName}` });
        break;

      case 'DRIVE_UPDATED':
        qc.setQueriesData({ queryKey:['drives'] }, o => updateInList(o, data.driveId, data.changes));
        qc.invalidateQueries({ queryKey:['drive', data.driveId] });
        break;

      case 'DRIVE_DELETED':
        qc.setQueriesData({ queryKey:['drives'] }, o => removeFromList(o, data.driveId));
        addToast({ type:'warning', message:'College drive removed' });
        break;

      case 'DRIVE_STATUS_CHANGED':
        qc.setQueriesData({ queryKey:['drives'] }, o => updateInList(o, data.driveId, { status:data.status }));
        addToast({ type:'info', message:`Drive ${data.status}: ${data.collegeName}` });
        break;

      case 'DRIVE_CANDIDATES_ADDED':
        qc.invalidateQueries({ queryKey:['drive', data.driveId] });
        addToast({ type:'success', message:`${data.count} candidates added to drive` });
        break;

      case 'DRIVE_CANDIDATE_REMOVED':
        qc.invalidateQueries({ queryKey:['drive', data.driveId] });
        break;

      case 'DRIVE_BULK_UPLOAD_COMPLETE':
        qc.invalidateQueries({ queryKey:['drives'] });
        qc.invalidateQueries({ queryKey:['candidates'] });
        addToast({ type:'success', message:`Drive upload: ${data.imported} imported, ${data.failed} failed` });
        break;

      /* ─── AUDIT ─── */
      case 'AUDIT_LOG_CREATED':
        qc.invalidateQueries({ queryKey:['audit-logs'] });
        break;

      /* ─── SETTINGS ─── */
      case 'ORG_SETTINGS_UPDATED':
        qc.invalidateQueries({ queryKey:['org-settings'] });
        addToast({ type:'info', message:'Organization settings updated' });
        break;

      case 'ORG_CONTACT_UPDATED':
        qc.invalidateQueries({ queryKey:['org-settings'] });
        break;

      case 'ORG_LOGO_UPDATED':
        qc.invalidateQueries({ queryKey:['org-settings'] });
        addToast({ type:'info', message:'Organization logo updated' });
        break;

      /* ─── BULK IMPORT ─── */
      case 'BULK_IMPORT_PROGRESS':
        qc.setQueryData(['bulk-import', data.jobId], o => ({
          ...(o ?? {}),
          progress: data.percent, processed: data.processed,
          total: data.total, imported: data.imported,
          failed: data.failed, skipped: data.skipped,
        }));
        break;

      case 'BULK_IMPORT_COMPLETE':
        qc.setQueryData(['bulk-import', data.jobId], o => ({
          ...(o ?? {}), state:'completed', progress:100, ...data,
        }));
        qc.invalidateQueries({ queryKey:['candidates'] });
        qc.invalidateQueries({ queryKey:['dashboard'] });
        addToast({
          type:'success',
          message:`Import complete: ${data.imported} added, ${data.failed} failed`,
          duration: 6000,
        });
        break;

      /* ─── NOTIFICATIONS ─── */
      case 'NOTIFICATION':
        addNotification(data);
        incrementUnread();
        break;

      default:
        break;
    }
  }, [qc, addToast, addNotification, incrementUnread]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const unsub = subscribeSSE((data) => {
      if (data?.type) {
        handle(data.type, data);
      }
    });

    return () => {
      unsub();
    };
  }, [isAuthenticated, handle]);

  return { isPollingMode: false };
}
