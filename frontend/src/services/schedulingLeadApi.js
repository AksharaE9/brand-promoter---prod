import { buildApiUrl, apiGet, apiPost, apiPatch, getStoredToken } from '../lib/api';

/**
 * Service API for Telecalling Scheduling Module
 */
export const schedulingLeadApi = {
  /** Admin: Fetch all members */
  getMembers: async () => {
    const res = await apiGet('/scheduling/members');
    return res.data;
  },

  /** Admin: Add new member */
  createMember: async (data) => {
    const res = await apiPost('/scheduling/members', data);
    return res.data;
  },

  /** Admin: Update member (name, userId, active) */
  updateMember: async (memberId, data) => {
    const res = await apiPatch(`/scheduling/members/${memberId}`, data);
    return res.data;
  },

  /** Admin: Upload multipart lead list sheet for member + listDate */
  uploadLeadList: async (memberId, file, listDate) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('listDate', listDate);

    const token = getStoredToken();
    const response = await fetch(buildApiUrl(`/scheduling/members/${memberId}/lead-list`), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Failed to upload lead list');
    }
    return data;
  },

  /** Admin: Export lead list as CSV download */
  exportLeadListUrl: (memberId, date) => {
    const token = getStoredToken();
    return buildApiUrl(`/scheduling/members/${memberId}/lead-list/export?date=${date}&token=${token}`);
  },

  /** Member/Admin: Fetch today's read-only lead list */
  getMyList: async (params = {}) => {
    const query = new URLSearchParams(params).toString();
    const res = await apiGet(`/scheduling/my-list${query ? `?${query}` : ''}`);
    return res.data;
  },

  /** Member/Admin: Submit or edit work-done report */
  submitMyReport: async (data) => {
    const res = await apiPost('/scheduling/my-report', data);
    return res;
  },

  /** Member/Admin: Fetch work-done report for date */
  getMyReport: async (params = {}) => {
    const query = new URLSearchParams(params).toString();
    const res = await apiGet(`/scheduling/my-report${query ? `?${query}` : ''}`);
    return res.data;
  },

  /** Admin: Overview across all members for date */
  getAdminOverview: async (date) => {
    const query = date ? `?date=${date}` : '';
    const res = await apiGet(`/scheduling/admin/overview${query}`);
    return res.data;
  },

  /** Admin/Member: Upload daily member file attachment */
  uploadMemberFile: async (memberId, file, date, note) => {
    const formData = new FormData();
    formData.append('file', file);
    if (date) formData.append('date', date);
    if (note) formData.append('note', note);

    const token = getStoredToken();
    const response = await fetch(buildApiUrl(`/scheduling/members/${memberId}/files`), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Failed to upload attachment');
    }
    return data;
  },

  /** Admin/Member: Get member profile details */
  getMemberProfile: async (memberId) => {
    const res = await apiGet(`/scheduling/members/${memberId}`);
    return res.data;
  },

  /** Admin/Member: Fetch member uploaded files */
  getMemberFiles: async (memberId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    const res = await apiGet(`/scheduling/members/${memberId}/files${query ? `?${query}` : ''}`);
    return res;
  },

  /** Admin/Member: Fetch member assigned lead lists */
  getMemberLeadLists: async (memberId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    const res = await apiGet(`/scheduling/members/${memberId}/lead-lists${query ? `?${query}` : ''}`);
    return res;
  },

  /** Admin/Member: Fetch member daily reports */
  getMemberReports: async (memberId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    const res = await apiGet(`/scheduling/members/${memberId}/reports${query ? `?${query}` : ''}`);
    return res;
  },
};
