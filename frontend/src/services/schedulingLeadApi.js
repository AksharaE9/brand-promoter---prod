import { buildApiUrl, apiGet, apiPost, apiPatch, apiDelete, getStoredToken } from '../lib/api';

/**
 * Service API for Telecalling Scheduling Module
 */
export const schedulingLeadApi = {
  /** Admin: Fetch all members */
  getMembers: async (options = {}) => {
    const res = await apiGet('/scheduling/members', { bypassCache: true, ...options });
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

  /** Admin: Delete member */
  deleteMember: async (memberId) => {
    const res = await apiDelete(`/scheduling/members/${memberId}`);
    return res.data;
  },

  /** Admin: Upload multipart lead list sheet for member + listDate */
  uploadLeadList: async (memberId, file, listDate) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('listDate', listDate);

    return await apiPost(`/scheduling/members/${memberId}/lead-list`, formData);
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
  getAdminOverview: async (date, options = {}) => {
    const params = new URLSearchParams();
    if (date) params.append('date', date);
    if (options.fresh) params.append('fresh', '1');
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await apiGet(`/scheduling/admin/overview${qs}`, { bypassCache: true, ...options });
    return res.data;
  },

  /** Admin/Member: Upload daily member file attachment */
  uploadMemberFile: async (memberId, file, date, note) => {
    const formData = new FormData();
    formData.append('file', file);
    if (date) formData.append('date', date);
    if (note) formData.append('note', note);

    return await apiPost(`/scheduling/members/${memberId}/files`, formData);
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

  /** Admin-only: Delete a file attachment */
  deleteMemberFile: async (memberId, fileId) => {
    const res = await apiDelete(`/scheduling/members/${memberId}/files/${fileId}`);
    return res;
  },
};
