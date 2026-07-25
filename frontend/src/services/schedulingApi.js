import api from './api';
import { search } from '../lib/searchClient';

export const schedulingApi = {
  getRounds: async (filters = {}, signal) => {
    if (filters.search && filters.search.trim()) {
      return await search('/interviews/search', {
        q: filters.search.trim(),
        filters: {
          status: filters.status,
          jobId: filters.jobId,
          candidateId: filters.candidateId,
          applicationId: filters.applicationId,
          interviewerId: filters.interviewerId,
          date: filters.date,
        },
        cursor: filters.cursor,
        limit: filters.limit
      }, signal);
    }

    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') {
        params.append(key, val);
      }
    });
    // Note: do NOT add a default limit here. The calendar view (view=calendar)
    // fetches all interviews in the date range and does not use limit.
    // The list endpoint (usePaginatedList) always supplies an explicit limit.
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await api.get(`/interviews${qs}`, { signal });
    return res.data;
  },
  
  getRound: async (roundId) => {
    const res = await api.get(`/interviews/${roundId}`);
    return res.data;
  },

  getRoundDetails: async (roundId) => {
    const res = await api.get(`/interviews/${roundId}/details`);
    return res.data;
  },
  
  createRound: async (roundData) => {
    const res = await api.post(`/interviews`, roundData);
    return res.data;
  },
  
  updateStatus: async (roundId, { status, notes }) => {
    const res = await api.patch(`/interviews/${roundId}/status`, { status, notes });
    return res.data;
  },
  
  reschedule: async (roundId, { scheduledDate, durationMinutes, reason }) => {
    const res = await api.patch(`/interviews/${roundId}/reschedule`, {
      scheduledStart: scheduledDate,
      durationMinutes,
      rescheduleReason: reason
    });
    return res.data;
  },
  
  updateMeetLink: async (roundId, { meetLink }) => {
    const res = await api.patch(`/interviews/${roundId}/meet-link`, { meetLink });
    return res.data;
  },
  
  updatePanel: async (roundId, { panelMembers }) => {
    const interviewerIds = panelMembers.map(p => p.userId || p.id || p);
    const res = await api.patch(`/interviews/${roundId}/panel`, { interviewerIds });
    return res.data;
  },
  
  transfer: async (roundId, { toJobId, toJobTitle, reason }) => {
    const res = await api.patch(`/interviews/${roundId}/transfer`, { toJobId, toJobTitle, reason });
    return res.data;
  },
  
  submitFeedback: async (roundId, feedback) => {
    const res = await api.post(`/interviews/${roundId}/feedback`, feedback);
    return res.data;
  },

  scheduleDerivedRound: async (candidateId, payload) => {
    const res = await api.post(`/interviews/${candidateId}/schedule`, payload);
    return res.data;
  },

  submitSchemaFeedback: async (candidateId, round, data) => {
    const res = await api.post(`/interviews/${candidateId}/feedback`, { round, data });
    return res.data;
  },

  getSchemaFeedback: async (candidateId, round) => {
    const res = await api.get(`/interviews/${candidateId}/feedback/${round}`);
    return res.data;
  },

  
  logContactAttempt: async (candidateId, payload) => {
    const res = await api.post(`/candidates/${candidateId}/contact-attempts`, payload);
    return res.data;
  },

  getContactAttempts: async (candidateId) => {
    const res = await api.get(`/candidates/${candidateId}/contact-attempts`);
    return res.data;
  },

  transferPanelist: async (candidateId, { panelistId }) => {
    const res = await api.post(`/candidates/${candidateId}/transfer-panelist`, { panelistId });
    return res.data;
  },

  updateRound: async (roundId, payload) => {
    const res = await api.put(`/interviews/${roundId}`, payload);
    return res.data;
  },
  
  deleteRound: async (roundId) => {
    const res = await api.delete(`/interviews/${roundId}`);
    return res.data;
  }
};

