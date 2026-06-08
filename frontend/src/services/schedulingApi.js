import api from './api';

export const schedulingApi = {
  getRounds: async (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') {
        params.append(key, val);
      }
    });
    if (!params.has('limit')) params.set('limit', '50'); // default 50 per page
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await api.get(`/interviews${qs}`);
    return res.data;
  },
  
  getRound: async (roundId) => {
    const res = await api.get(`/interviews/${roundId}`);
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
  
  updateRound: async (roundId, payload) => {
    const res = await api.put(`/interviews/${roundId}`, payload);
    return res.data;
  },
  
  deleteRound: async (roundId) => {
    const res = await api.delete(`/interviews/${roundId}`);
    return res.data;
  }
};
