import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { schedulingLeadApi } from '../../services/schedulingLeadApi';
import { apiGet, clearApiCachePattern } from '../../lib/api';

export default function MembersManagementModal({ isOpen, onClose, onMembersUpdated }) {
  const queryClient = useQueryClient();
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');

  const [newName, setNewName] = useState('');
  const [newUserId, setNewUserId] = useState('');

  // Custom modal confirmation state for deletion (no native browser confirm dialog)
  const [memberToDelete, setMemberToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // TanStack Query for members with shared query key prefix 'telecalling-team'
  const {
    data: members = [],
    isLoading: loading,
    error: queryError,
    refetch: refetchMembers,
  } = useQuery({
    queryKey: ['telecalling-team', 'members'],
    queryFn: async () => {
      clearApiCachePattern('/scheduling/members');
      return await schedulingLeadApi.getMembers();
    },
    enabled: Boolean(isOpen),
    staleTime: 5000,
  });

  // Fetch unlinked users when modal opens
  useEffect(() => {
    if (isOpen) {
      setError('');
      setBanner('');
      apiGet('/users')
        .then((res) => setUsers(res?.data || []))
        .catch(() => setUsers([]));
    }
  }, [isOpen]);

  // Combined error display
  const displayError = error || (queryError ? queryError.message : '');

  // Normalized name and duplicate check
  const normalizedNewName = newName.trim().replace(/\s+/g, ' ');
  const isDuplicateName = Boolean(
    normalizedNewName &&
      members.some((m) => m.name.toLowerCase() === normalizedNewName.toLowerCase())
  );

  const invalidateTeamData = async () => {
    clearApiCachePattern('/scheduling');
    await queryClient.invalidateQueries({ queryKey: ['telecalling-team'] });
    if (onMembersUpdated) {
      onMembersUpdated();
    }
  };

  const handleAddMember = async (e) => {
    e.preventDefault();
    if (!normalizedNewName) return;
    setSaving(true);
    setError('');
    setBanner('');
    try {
      await schedulingLeadApi.createMember({
        name: normalizedNewName,
        userId: newUserId || null,
      });
      setBanner(`Member "${normalizedNewName}" added successfully.`);
      setNewName('');
      setNewUserId('');
      await invalidateTeamData();
    } catch (err) {
      setError(err.message || 'Failed to add member');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (memberId, currentActive) => {
    setError('');
    setBanner('');
    try {
      await schedulingLeadApi.updateMember(memberId, { active: !currentActive });
      setBanner(`Member ${!currentActive ? 'activated' : 'deactivated'} successfully.`);
      await invalidateTeamData();
    } catch (err) {
      setError(err.message || 'Failed to update member status');
    }
  };

  const handleLinkUser = async (memberId, targetUserId) => {
    setError('');
    setBanner('');
    try {
      await schedulingLeadApi.updateMember(memberId, { userId: targetUserId || null });
      setBanner('User link updated successfully.');
      await invalidateTeamData();
    } catch (err) {
      setError(err.message || 'Failed to link user');
    }
  };

  const handleConfirmDelete = async () => {
    if (!memberToDelete) return;
    setDeleting(true);
    setError('');
    setBanner('');
    try {
      const res = await schedulingLeadApi.deleteMember(memberToDelete.id);
      setBanner(res?.message || `Member "${memberToDelete.name}" deleted successfully.`);
      setMemberToDelete(null);
      await invalidateTeamData();
    } catch (err) {
      setError(err.message || 'Failed to delete member');
    } finally {
      setDeleting(false);
    }
  };

  if (!isOpen) return null;

  // Breakdown counts for clear self-explanatory header
  const totalCount = members.length;
  const activeCount = members.filter((m) => m.active).length;
  const inactiveCount = totalCount - activeCount;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden relative z-10 animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Telecalling Team Members</h2>
            <p className="text-xs text-slate-500 mt-0.5">Manage team members, link user accounts, or toggle active status</p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center transition-colors"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto custom-scrollbar">
          {displayError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
              {displayError}
            </div>
          )}
          {banner && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 font-medium flex items-center justify-between">
              <span>{banner}</span>
              <button onClick={() => setBanner('')} className="text-emerald-700 font-bold hover:underline text-[10px]">
                Dismiss
              </button>
            </div>
          )}

          {/* Add Member Form */}
          <form onSubmit={handleAddMember} className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 space-y-3">
            <h3 className="text-xs uppercase font-bold text-slate-500 tracking-wider">Add New Member</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <input
                  type="text"
                  required
                  placeholder="Member Name (e.g. Madumathi)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className={`w-full h-10 px-3 rounded-xl border text-sm outline-none bg-white transition-colors ${
                    isDuplicateName ? 'border-amber-400 focus:border-amber-500' : 'border-slate-200 focus:border-blue-500'
                  }`}
                />
                {isDuplicateName && (
                  <p className="text-[11px] text-amber-600 font-medium mt-1 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">warning</span>
                    A member with this name already exists.
                  </p>
                )}
              </div>
              <div>
                <select
                  value={newUserId}
                  onChange={(e) => setNewUserId(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm focus:border-blue-500 outline-none bg-white"
                >
                  <option value="">-- Link User Account (Optional) --</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName} ({u.email})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="submit"
              disabled={saving || !normalizedNewName}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition-all disabled:opacity-50 flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-sm">person_add</span>
              {saving ? 'Adding...' : 'Add Member'}
            </button>
          </form>

          {/* Delete Confirmation Card (in-modal, replacing native browser confirm) */}
          {memberToDelete && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-2xl space-y-3 animate-in fade-in duration-150">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-red-600 text-xl shrink-0 mt-0.5">warning</span>
                <div>
                  <h4 className="text-sm font-bold text-red-900">Delete {memberToDelete.name}?</h4>
                  <p className="text-xs text-red-700 mt-0.5">
                    If this member has past lead lists, calls, or reports, their history will be preserved and the member will be safely archived. Otherwise, the member will be permanently deleted.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setMemberToDelete(null)}
                  className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 font-semibold text-xs rounded-xl hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleConfirmDelete}
                  className="px-3 py-1.5 bg-red-600 text-white font-bold text-xs rounded-xl hover:bg-red-700 shadow-sm transition-colors flex items-center gap-1"
                >
                  {deleting ? 'Deleting...' : 'Confirm Delete'}
                </button>
              </div>
            </div>
          )}

          {/* Existing Members List with Explanatory Counts */}
          <div className="space-y-2">
            <h3 className="text-xs uppercase font-bold text-slate-500 tracking-wider">
              Existing Team Members ({totalCount} total · {activeCount} active · {inactiveCount} inactive)
            </h3>
            {loading ? (
              <div className="p-8 text-center text-slate-400 text-sm animate-pulse">Loading members...</div>
            ) : members.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-sm italic bg-slate-50 rounded-2xl">
                No members found.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden">
                {members.map((m) => (
                  <div key={m.id} className="p-3.5 flex items-center justify-between gap-4 bg-white hover:bg-slate-50/80 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs ${
                        m.active ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'
                      }`}>
                        {m.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-bold text-sm text-slate-800 flex items-center gap-2">
                          {m.name}
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            m.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {m.active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {m.user ? `Linked: ${m.user.fullName} (${m.user.email})` : 'No user account linked'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        value={m.userId || ''}
                        onChange={(e) => handleLinkUser(m.id, e.target.value)}
                        className="h-8 px-2 rounded-lg border border-slate-200 text-xs focus:border-blue-500 outline-none bg-slate-50"
                      >
                        <option value="">Unlinked</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.fullName}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={() => handleToggleActive(m.id, m.active)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                          m.active
                            ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                        }`}
                      >
                        {m.active ? 'Deactivate' : 'Activate'}
                      </button>

                      <button
                        type="button"
                        onClick={() => setMemberToDelete(m)}
                        className="h-8 w-8 rounded-lg text-xs font-semibold border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-colors flex items-center justify-center shrink-0"
                        title="Delete Member"
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
