/**
 * useCandidateMutations.js
 * ──────────────────────────────────────────────────────────────────────────
 * Optimistic add and delete for the Candidates page.
 *
 * The page uses local useState (not TanStack Query) for its candidate list,
 * so these hooks operate against that local array via callbacks — not the
 * QueryClient cache. This keeps the implementation lightweight and avoids
 * a full migration of Candidates.jsx to TanStack Query.
 *
 * Usage:
 *   const { deleteCandidate, isDeleting } = useDeleteCandidate({
 *     onOptimisticRemove: (id) => setItems(prev => prev.filter(c => c.id !== id)),
 *     onRollback: (id, snapshot) => setItems(snapshot),
 *     onSuccess: () => {},       // optional: e.g. show toast
 *     onError:   (err) => {},    // optional: e.g. show error
 *   });
 *
 *   const { addCandidate, isAdding } = useAddCandidate({
 *     onOptimisticAdd: (tempCandidate) => setItems(prev => [tempCandidate, ...prev]),
 *     onReplace: (tempId, realCandidate) => setItems(prev =>
 *       prev.map(c => c.id === tempId ? realCandidate : c)
 *     ),
 *     onRollback: (tempId) => setItems(prev => prev.filter(c => c.id !== tempId)),
 *     onSuccess: (realCandidate) => {},
 *     onError:   (err) => {},
 *   });
 * ──────────────────────────────────────────────────────────────────────────
 */
import { useRef, useCallback, useState } from 'react';
import { buildApiUrl, getStoredToken } from '../lib/api';

// ── Shared fetch helper ────────────────────────────────────────────────────
async function authFetch(path, options = {}) {
  const token = getStoredToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const isFormData = options.body instanceof FormData;
  if (!isFormData && options.body && typeof options.body === 'object') {
    headers['Content-Type'] = 'application/json';
    options = { ...options, body: JSON.stringify(options.body) };
  }

  const res = await fetch(buildApiUrl(path), { ...options, headers });
  let data = null;
  try { data = await res.json(); } catch (_) { /* no body */ }

  if (!res.ok) {
    const err = new Error(data?.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

// ─────────────────────────────────────────────────────────────────────────
// useDeleteCandidate
// Instantly removes the candidate from the list, rolls back on failure.
// ─────────────────────────────────────────────────────────────────────────
export function useDeleteCandidate({ onOptimisticRemove, onRollback, onSuccess, onError } = {}) {
  const [deletingIds, setDeletingIds] = useState(new Set());
  const snapshotRef = useRef(null);

  const deleteCandidate = useCallback(async (id) => {
    if (deletingIds.has(id)) return; // prevent double-click

    // Capture snapshot BEFORE removing
    snapshotRef.current = null;

    // Optimistic remove — runs synchronously before any await
    setDeletingIds(prev => new Set([...prev, id]));
    onOptimisticRemove?.(id);

    try {
      await authFetch(`/candidates/${id}`, { method: 'DELETE' });
      setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
      onSuccess?.(id);
    } catch (err) {
      setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
      // Roll back: caller must restore their list from their own snapshot
      onRollback?.(id);
      onError?.(err);
    }
  }, [deletingIds, onOptimisticRemove, onRollback, onSuccess, onError]);

  return {
    deleteCandidate,
    isDeleting: deletingIds.size > 0,
    isDeletingId: (id) => deletingIds.has(id),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// useAddCandidate
// Instantly shows the candidate (with temp ID) then replaces with real data.
// ─────────────────────────────────────────────────────────────────────────
export function useAddCandidate({ onOptimisticAdd, onReplace, onRollback, onSuccess, onError } = {}) {
  const [isAdding, setIsAdding] = useState(false);

  /**
   * @param {FormData} formData - ready-to-send FormData with all candidate fields
   * @param {object} localPreview - the local candidate object for optimistic display
   *   Shape: { fullName, email, phone, course, location, preferredRole, ... }
   */
  const addCandidate = useCallback(async (formData, localPreview = {}) => {
    if (isAdding) return;
    setIsAdding(true);

    const tempId = `temp_${Date.now()}`;
    const tempCandidate = {
      id: tempId,
      fullName: localPreview.fullName || '',
      email: localPreview.email || '',
      phone: localPreview.phone || '',
      course: localPreview.course || '',
      location: localPreview.location || '',
      preferredRole: localPreview.preferredRole || '',
      status: 'ACTIVE',
      source: localPreview.source || '',
      _optimistic: true,
      createdAt: new Date().toISOString(),
      applications: [],
    };

    // Optimistic prepend — runs synchronously before any await
    onOptimisticAdd?.(tempCandidate);

    try {
      const data = await authFetch('/candidates/with-resume-upload', {
        method: 'POST',
        body: formData, // FormData — authFetch won't JSON.stringify it
      });
      const realCandidate = data?.data ?? data;
      setIsAdding(false);
      // Replace the temp entry with the real server data
      onReplace?.(tempId, { ...realCandidate, _optimistic: false });
      onSuccess?.(realCandidate);
    } catch (err) {
      setIsAdding(false);
      // Roll back the optimistic insert
      onRollback?.(tempId);
      onError?.(err);
    }
  }, [isAdding, onOptimisticAdd, onReplace, onRollback, onSuccess, onError]);

  return { addCandidate, isAdding };
}
