import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildApiUrl, apiGet, apiPost, apiDelete } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { useNavigate } from 'react-router-dom';
import Reveal from './PageMotion';
import { subscribeSSE } from '../lib/sse';
import CreateCandidateModal from './CreateCandidateModal';
import BulkUploadModal from './BulkUpload/BulkUploadModal';
import { DRIVE_DESCRIPTION_MAX_WORDS, countWords, validateDriveDescription } from '../config/driveConstants';

const STATUS_OPTIONS = ['ADDED', 'SCREENED', 'SHORTLISTED', 'INTERVIEWED', 'OFFERED', 'JOINED', 'REJECTED'];
const DRIVE_STATUS_OPTIONS = ['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED'];

const emptyCollegeForm = {
  name: '',
  location: '',
  area: '',
  year: '',
  role: '',
  course: '',
};

const emptyDriveForm = {
  title: '',
  dateFrom: '',
  dateTo: '',
  status: 'PLANNED',
  description: '',
  notes: '',
};

function CollegeDriveWorkspace({ onBanner, onError }) {
  const navigate = useNavigate();
  const { user: currentUser } = useAuthStore();
  const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'RECRUITER'].includes(currentUser?.role);

  const [colleges, setColleges] = useState([]);
  const [drives, setDrives] = useState([]);
  const [driveCandidates, setDriveCandidates] = useState([]);
  const [users, setUsers] = useState([]);
  const [globalJobs, setGlobalJobs] = useState([]);

  const [selectedCollegeId, setSelectedCollegeId] = useState('');
  const [selectedDriveId, setSelectedDriveId] = useState('');

  const [showCollegeModal, setShowCollegeModal] = useState(false);
  const [showDriveModal, setShowDriveModal] = useState(false);
  const [showEditDriveModal, setShowEditDriveModal] = useState(false);
  const [showCandidateModal, setShowCandidateModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);

  const [collegeToDelete, setCollegeToDelete] = useState(null);
  const [deletingCollege, setDeletingCollege] = useState(false);

  const [collegeForm, setCollegeForm] = useState(emptyCollegeForm);
  const [driveForm, setDriveForm] = useState(emptyDriveForm);
  const [editDriveForm, setEditDriveForm] = useState(emptyDriveForm);

  const driveDescWordCount = useMemo(() => countWords(driveForm.description), [driveForm.description]);
  const editDriveDescWordCount = useMemo(() => countWords(editDriveForm.description), [editDriveForm.description]);

  const [selectedRecruiterIds, setSelectedRecruiterIds] = useState([]);
  const [selectedJobToLink, setSelectedJobToLink] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [drivesLoading, setDrivesLoading] = useState(false);
  const activeCollegeIdRef = React.useRef(selectedCollegeId);

  const selectedCollege = useMemo(() => colleges.find(c => c.id === selectedCollegeId), [colleges, selectedCollegeId]);
  const selectedDrive = useMemo(() => drives.find(d => d.id === selectedDriveId), [drives, selectedDriveId]);

  const similarCollege = useMemo(() => {
    if (!collegeForm.name || collegeForm.name.trim().length < 2) return null;
    const norm = collegeForm.name.toLowerCase().replace(/college|institute|university|[^\w\s]/g, '').trim();
    if (!norm) return null;
    return colleges.find(c => {
      const cNorm = c.name.toLowerCase().replace(/college|institute|university|[^\w\s]/g, '').trim();
      return cNorm && (cNorm === norm || cNorm.includes(norm) || norm.includes(cNorm));
    });
  }, [collegeForm.name, colleges]);

  const loadColleges = async () => {
    const res = await apiGet('/college-drives/colleges');
    const cols = res.data || [];
    setColleges(cols);
    if (!selectedCollegeId && cols.length > 0) setSelectedCollegeId(cols[0].id);
  };

  const loadUsers = async () => {
    try {
      const res = await apiGet('/users/interviewers');
      setUsers(res.data || []);
    } catch (err) {
      console.warn('Failed to load interviewers for drives workspace:', err?.message);
      setUsers([]);
    }
  };

  const loadGlobalJobs = async () => {
    try {
      const res = await apiGet('/jobs?limit=100&isActive=true');
      setGlobalJobs(res.data || []);
    } catch (err) {
      console.warn('Failed to load jobs for drives workspace:', err?.message);
      setGlobalJobs([]);
    }
  };

  const loadDrives = async (collegeId) => {
    activeCollegeIdRef.current = collegeId;
    if (!collegeId) {
      setDrives([]);
      setSelectedDriveId('');
      setDriveCandidates([]);
      return;
    }
    setDrivesLoading(true);
    try {
      const res = await apiGet(`/college-drives/drives?collegeId=${collegeId}`);
      if (activeCollegeIdRef.current !== collegeId) return; // Discard outdated response
      const newDrives = res.data || [];
      setDrives(newDrives);
      if (newDrives.length > 0) {
        setSelectedDriveId(prev => (newDrives.some(d => d.id === prev) ? prev : newDrives[0].id));
      } else {
        setSelectedDriveId('');
        setDriveCandidates([]);
      }
    } finally {
      if (activeCollegeIdRef.current === collegeId) {
        setDrivesLoading(false);
      }
    }
  };

  const loadDriveDetails = async (driveId) => {
    if (!driveId) {
      setDriveCandidates([]);
      setSelectedRecruiterIds([]);
      return;
    }
    const candRes = await apiGet(`/college-drives/drives/${driveId}/candidates`);
    setDriveCandidates(candRes.data || []);
    setSelectedRecruiterIds((selectedDrive?.recruiters || []).map(r => r.userId));
  };

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        await Promise.all([loadColleges(), loadUsers(), loadGlobalJobs()]);
      } catch (err) {
        console.error('Error loading colleges:', err);
        onError(err.message || 'Failed to load workspace');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  const handleSelectCollege = (collegeId) => {
    if (collegeId === selectedCollegeId) return;
    activeCollegeIdRef.current = collegeId;
    setSelectedCollegeId(collegeId);
    setDrives([]);
    setSelectedDriveId('');
    setDriveCandidates([]);
  };

  useEffect(() => {
    loadDrives(selectedCollegeId).catch(err => onError(err.message));
  }, [selectedCollegeId]);

  useEffect(() => {
    loadDriveDetails(selectedDriveId).catch(err => onError(err.message));
  }, [selectedDriveId]);

  // Real-time sync listener
  useEffect(() => {
    const unsub = subscribeSSE((d) => {
      // Refresh drive candidates if any relevant candidate or drive event occurs
      if (['CANDIDATE_CREATED', 'CANDIDATE_UPDATED', 'DRIVE_CANDIDATE_ADDED', 'DRIVE_CANDIDATES_ADDED', 'APPLICATION_STATUS_UPDATED'].includes(d.type)) {
        if (selectedDriveId) {
          loadDriveDetails(selectedDriveId);
        }
      }
    });

    return () => unsub();
  }, [selectedDriveId]);

  const handleAddCollege = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      await apiPost('/college-drives/colleges', collegeForm);
      setCollegeForm(emptyCollegeForm);
      setShowCollegeModal(false);
      await loadColleges();
      onBanner('College added successfully');
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCollege = async () => {
    if (!collegeToDelete) return;
    try {
      setDeletingCollege(true);
      await apiDelete(`/college-drives/colleges/${collegeToDelete.id}`);
      onBanner(`College "${collegeToDelete.name}" deleted successfully`);
      const updatedColleges = colleges.filter(c => c.id !== collegeToDelete.id);
      setColleges(updatedColleges);
      if (selectedCollegeId === collegeToDelete.id) {
        const nextCollege = updatedColleges[0];
        setSelectedCollegeId(nextCollege ? nextCollege.id : '');
        if (nextCollege) {
          loadDrives(nextCollege.id);
        } else {
          setDrives([]);
          setSelectedDriveId('');
          setDriveCandidates([]);
        }
      }
      setCollegeToDelete(null);
    } catch (err) {
      onError(err.message || 'Failed to delete college');
    } finally {
      setDeletingCollege(false);
    }
  };

  const handleAddDrive = async (e) => {
    e.preventDefault();
    const validation = validateDriveDescription(driveForm.description);
    if (!validation.valid) {
      onError(validation.error);
      return;
    }
    try {
      setSaving(true);
      await apiPost('/college-drives/drives', { ...driveForm, collegeId: selectedCollegeId });
      setDriveForm(emptyDriveForm);
      setShowDriveModal(false);
      await loadDrives(selectedCollegeId);
      onBanner('Drive created successfully');
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openEditDriveModal = (drive) => {
    if (!drive) return;
    setEditDriveForm({
      id: drive.id,
      title: drive.title || '',
      dateFrom: drive.dateFrom || '',
      dateTo: drive.dateTo || '',
      status: drive.status || 'PLANNED',
      description: drive.description || '',
      notes: drive.notes || '',
    });
    setShowEditDriveModal(true);
  };

  const handleUpdateDrive = async (e) => {
    e.preventDefault();
    const validation = validateDriveDescription(editDriveForm.description);
    if (!validation.valid) {
      onError(validation.error);
      return;
    }
    try {
      setSaving(true);
      const res = await fetch(buildApiUrl(`/college-drives/drives/${editDriveForm.id}`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('ats_token')}`,
        },
        body: JSON.stringify(editDriveForm),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to update drive');
      }
      setShowEditDriveModal(false);
      await loadDrives(selectedCollegeId);
      onBanner('Drive updated successfully');
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateCandidateStatus = async (candId, status) => {
    try {
      await fetch(buildApiUrl(`/college-drives/drives/${selectedDriveId}/candidates/${candId}/status`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('ats_token')}`,
        },
        body: JSON.stringify({ status }),
      });
      await loadDriveDetails(selectedDriveId);
      onBanner('Status updated');
    } catch (err) {
      onError(err.message);
    }
  };

  if (loading) return <div className="p-10 text-center text-slate-400">Loading workspace...</div>;

  return (
    <div className="space-y-6 mt-4">
      {/* HEADER ACTIONS */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button 
            className="h-11 px-6 rounded-2xl bg-[#1f52cc] text-white font-bold shadow-lg shadow-blue-100 hover:bg-[#1844b0] transition-all flex items-center gap-2"
            onClick={() => setShowCollegeModal(true)}
          >
            <span className="material-symbols-outlined text-xl">school</span>
            Add College
          </button>
          {selectedCollegeId && (
            <button 
              className="h-11 px-6 rounded-2xl bg-white border border-slate-200 text-slate-700 font-bold hover:bg-slate-50 transition-all flex items-center gap-2"
              onClick={() => setShowDriveModal(true)}
            >
              <span className="material-symbols-outlined text-xl">campaign</span>
              Add Drive
            </button>
          )}
        </div>

        {/* TWO BUTTONS MATCHING ALL CANDIDATES */}
        <div className="flex items-center gap-2">
          <button 
            className="os-btn-outline flex items-center gap-2 !h-11 bg-white border-[#e4ebf1] text-[#142651] hover:bg-slate-50 shadow-sm"
            onClick={() => setShowBulkModal(true)}
          >
            <span className="material-symbols-outlined text-base">upload_file</span>
            Bulk Upload
          </button>
          <button 
            className="os-btn-primary flex items-center gap-2 !h-11 shadow-lg shadow-blue-100"
            onClick={() => setShowCandidateModal(true)}
          >
            <span className="material-symbols-outlined text-base">person_add</span>
            Add Candidate
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* COLLEGES & DRIVES COLUMN */}
        <div className="col-span-12 lg:col-span-4 space-y-6">
          <div className="os-card p-6">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-lg">apartment</span>
              Select College
            </h3>
            <div className="grid grid-cols-1 gap-2">
              {colleges.map(college => (
                <div
                  key={college.id}
                  className={`group relative w-full rounded-2xl border transition-all ${selectedCollegeId === college.id ? 'bg-blue-50/70 border-blue-200 shadow-sm' : 'border-slate-100 hover:border-slate-300'}`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectCollege(college.id)}
                    className="w-full p-4 text-left pr-10"
                  >
                    <div className="font-bold text-slate-900 leading-snug">{college.name}</div>
                    <div className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                      <span className="material-symbols-outlined text-[14px]">location_on</span>
                      {college.location || 'No location'}
                    </div>
                    {(college.course || college.year) && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {college.course && <span className="px-2 py-0.5 rounded-full bg-white border border-slate-100 text-[10px] font-bold text-slate-500 uppercase">{college.course}</span>}
                        {college.year && <span className="px-2 py-0.5 rounded-full bg-white border border-slate-100 text-[10px] font-bold text-slate-500 uppercase">{college.year}</span>}
                      </div>
                    )}
                  </button>

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCollegeToDelete(college);
                      }}
                      className="absolute top-3.5 right-3.5 w-7 h-7 rounded-lg bg-white/90 border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 shadow-xs"
                      title={`Delete "${college.name}"`}
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                    </button>
                  )}
                </div>
              ))}
              {colleges.length === 0 && <div className="p-8 text-center text-slate-400 text-sm italic">No colleges added yet.</div>}
            </div>
          </div>

          {selectedCollegeId && (
            <Reveal className="os-card p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <span className="material-symbols-outlined text-lg">timeline</span>
                  Available Drives
                </h3>
                <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{drives.length}</span>
              </div>
              {drivesLoading ? (
                <div className="p-8 text-center text-slate-400 text-xs animate-pulse">Loading drives...</div>
              ) : (
                <div className="space-y-2">
                  {drives.map(drive => (
                    <button
                      key={drive.id}
                      onClick={() => setSelectedDriveId(drive.id)}
                      className={`w-full p-4 rounded-2xl border text-left transition-all ${selectedDriveId === drive.id ? 'bg-emerald-50 border-emerald-200 shadow-sm' : 'border-slate-100 hover:border-slate-300'}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-bold text-slate-900">{drive.title}</div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${drive.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{drive.status}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1 uppercase font-bold tracking-tight">
                        {new Date(drive.dateFrom).toLocaleDateString()} — {drive.dateTo ? new Date(drive.dateTo).toLocaleDateString() : 'Ongoing'}
                      </div>
                      {drive.description && (
                        <div className="text-xs text-slate-600 mt-2 line-clamp-2 break-words leading-relaxed font-normal">
                          {drive.description.length > 100 ? `${drive.description.slice(0, 100).trim()}...` : drive.description}
                        </div>
                      )}
                    </button>
                  ))}
                  {drives.length === 0 && (
                    <div className="p-8 text-center text-slate-400 text-sm italic">
                      No drives for {selectedCollege?.name || 'this college'}.
                    </div>
                  )}
                </div>
              )}
            </Reveal>
          )}
        </div>

        {/* DRIVE DETAILS & STUDENTS */}
        <div className="col-span-12 lg:col-span-8">
          {selectedDriveId && selectedDrive ? (
            <Reveal className="os-card p-6 min-h-[600px]">
              <div className="mb-8 pb-6 border-b border-slate-100">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#1f52cc] uppercase tracking-wider mb-1">
                      <span className="material-symbols-outlined text-sm">apartment</span>
                      <span>{selectedCollege?.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-2xl font-bold text-slate-900">{selectedDrive?.title}</h2>
                      <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${selectedDrive?.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                        {selectedDrive?.status}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1 font-medium">
                      <span className="font-semibold text-slate-600">Dates: </span>
                      {selectedDrive?.dateFrom ? new Date(selectedDrive.dateFrom).toLocaleDateString() : ''}
                      {selectedDrive?.dateTo ? ` — ${new Date(selectedDrive.dateTo).toLocaleDateString()}` : ' — Ongoing'}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => openEditDriveModal(selectedDrive)}
                      className="h-9 px-3.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm"
                      title="Edit Drive"
                    >
                      <span className="material-symbols-outlined text-base">edit</span>
                      Edit Drive
                    </button>
                    <div className="text-right pl-3 border-l border-slate-100">
                      <div className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">Students Enrolled</div>
                      <div className="text-3xl font-black text-slate-900 leading-none">{driveCandidates.length}</div>
                    </div>
                  </div>
                </div>

                {/* FULL DESCRIPTION DISPLAY (Preserving Line Breaks) */}
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1.5 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-sm text-slate-400">description</span>
                    Description
                  </div>
                  {selectedDrive?.description ? (
                    <div className="text-sm text-slate-700 whitespace-pre-wrap break-words leading-relaxed bg-slate-50/70 p-4 rounded-2xl border border-slate-100">
                      {selectedDrive.description}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 italic py-1">
                      — No description added —
                    </div>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="pb-4 text-[10px] uppercase font-bold text-slate-400 tracking-wider px-2">Student Name</th>
                      <th className="pb-4 text-[10px] uppercase font-bold text-slate-400 tracking-wider px-2">Contact Details</th>
                      <th className="pb-4 text-[10px] uppercase font-bold text-slate-400 tracking-wider px-2">Resume Status</th>
                      <th className="pb-4 text-[10px] uppercase font-bold text-slate-400 tracking-wider px-2">Date Added</th>
                      <th className="pb-4 text-[10px] uppercase font-bold text-slate-400 tracking-wider px-2">Current Status</th>
                      <th className="pb-4 text-[10px] uppercase font-bold text-slate-400 tracking-wider px-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {driveCandidates.map(cand => (
                      <tr key={cand.id} className="group hover:bg-slate-50/50 transition-colors">
                        <td className="py-4 px-2">
                          <div className="font-bold text-slate-800">{cand.fullName}</div>
                          {cand.preferredRole && (
                            <div className="text-[10px] text-slate-400 font-medium">{cand.preferredRole}</div>
                          )}
                        </td>
                        <td className="py-4 px-2">
                          <div className="text-xs text-slate-600">{cand.email && cand.email !== 'N/A' ? cand.email : '—'}</div>
                          <div className="text-[10px] text-slate-400 font-medium">{cand.phone || '—'}</div>
                        </td>
                        <td className="py-4 px-2">
                          {cand.hasResume ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                              <span className="material-symbols-outlined text-[12px]">description</span>
                              Resume on File
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full" title="No resume uploaded yet">
                              <span className="material-symbols-outlined text-[12px]">warning</span>
                              No Resume
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-2">
                          <div className="text-xs text-slate-600">
                            {cand.createdAt ? new Date(cand.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}
                          </div>
                          <div className="text-[9px] text-slate-400 uppercase font-bold">
                            {cand.email && String(cand.email).includes('bulk') ? 'Bulk Sync' : 'Direct'}
                          </div>
                        </td>
                        <td className="py-4 px-2">
                          <select 
                            className="bg-white border border-slate-200 rounded-lg text-xs font-bold px-2 py-1 outline-none focus:border-blue-500 transition-all"
                            value={cand.status}
                            onChange={(e) => updateCandidateStatus(cand.candidateId, e.target.value)}
                          >
                            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td className="py-4 px-2 text-right">
                          <button
                            onClick={() => {
                              const searchTerm = cand.phone || (cand.email && cand.email !== 'N/A' ? cand.email : '') || cand.fullName;
                              navigate(`/candidates?search=${encodeURIComponent(searchTerm)}`);
                            }}
                            className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-blue-600 hover:border-blue-200 transition-all"
                            title="View in Candidate Matrix"
                          >
                            <span className="material-symbols-outlined text-sm">open_in_new</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                    {driveCandidates.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-slate-400 text-xs italic">
                          No students added to this drive yet. Click "Add Candidate" or "Bulk Upload" to enroll students.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Reveal>
          ) : (
            <div className="os-card p-12 text-center text-slate-400 min-h-[500px] flex flex-col items-center justify-center">
              <span className="material-symbols-outlined text-5xl text-slate-300 mb-3">campaign</span>
              <h3 className="font-bold text-slate-700 text-base mb-1">
                {selectedCollege ? `No Drive Selected for ${selectedCollege.name}` : 'No College Selected'}
              </h3>
              <p className="text-xs text-slate-400 max-w-sm mb-5">
                {selectedCollege
                  ? (drives.length > 0 ? 'Select a drive from the list on the left to view details and enrolled students.' : 'Create a new hiring drive for this college to start tracking candidates.')
                  : 'Select a college from the list to view its hiring drives.'}
              </p>
              {selectedCollegeId && (
                <button 
                  className="h-10 px-5 rounded-xl bg-[#1f52cc] text-white font-bold text-xs shadow-md hover:bg-[#1844b0] transition-all flex items-center gap-2"
                  onClick={() => setShowDriveModal(true)}
                >
                  <span className="material-symbols-outlined text-base">add</span>
                  Create Drive
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* MODALS */}
      <CreateCandidateModal
        isOpen={showCandidateModal}
        onClose={() => setShowCandidateModal(false)}
        onSuccess={() => {
          if (selectedDriveId) loadDriveDetails(selectedDriveId);
          onBanner('Candidate added successfully');
        }}
        driveId={selectedDriveId || null}
        defaultCollege={selectedCollege?.name || ''}
        defaultSource={selectedDrive?.title || selectedCollege?.name || 'College Drive'}
      />

      <React.Suspense fallback={null}>
        <BulkUploadModal
          isOpen={showBulkModal}
          onClose={() => setShowBulkModal(false)}
          onImportComplete={() => {
            if (selectedDriveId) loadDriveDetails(selectedDriveId);
            onBanner('Bulk upload complete');
          }}
          driveId={selectedDriveId || null}
        />
      </React.Suspense>

      {showCollegeModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm modal-overlay-fade" onClick={() => setShowCollegeModal(false)} />
          <div className="bg-white w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-[32px] shadow-2xl relative z-10 modal-scale-up">
            <div className="p-8">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold text-slate-900">Add New College</h2>
                <button className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors" onClick={() => setShowCollegeModal(false)}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              {similarCollege && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2 text-xs text-amber-800">
                  <span className="material-symbols-outlined text-amber-600 text-base mt-0.5">warning</span>
                  <div>
                    <span className="font-bold">A similar college already exists: </span>
                    <span>"{similarCollege.name}" ({similarCollege.location || 'No location'}). Please confirm if you wish to create a separate entry.</span>
                  </div>
                </div>
              )}

              <form className="grid grid-cols-2 gap-4" onSubmit={handleAddCollege}>
                <div className="col-span-2 space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-400 ml-1">College Name</label>
                  <input className="w-full h-12 rounded-xl border border-slate-200 px-4 focus:border-blue-500 outline-none" required value={collegeForm.name} onChange={e => setCollegeForm({...collegeForm, name: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-400 ml-1">Location</label>
                  <input className="w-full h-12 rounded-xl border border-slate-200 px-4 focus:border-blue-500 outline-none" required value={collegeForm.location} onChange={e => setCollegeForm({...collegeForm, location: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-400 ml-1">Area / Region</label>
                  <input className="w-full h-12 rounded-xl border border-slate-200 px-4 focus:border-blue-500 outline-none" value={collegeForm.area} onChange={e => setCollegeForm({...collegeForm, area: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-400 ml-1">Batch Year</label>
                  <input className="w-full h-12 rounded-xl border border-slate-200 px-4 focus:border-blue-500 outline-none" placeholder="e.g. 2026" value={collegeForm.year} onChange={e => setCollegeForm({...collegeForm, year: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-400 ml-1">Target Role</label>
                  <input className="w-full h-12 rounded-xl border border-slate-200 px-4 focus:border-blue-500 outline-none" placeholder="e.g. Trainee" value={collegeForm.role} onChange={e => setCollegeForm({...collegeForm, role: e.target.value})} />
                </div>
                <div className="col-span-2 space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-400 ml-1">Preferred Course</label>
                  <input className="w-full h-12 rounded-xl border border-slate-200 px-4 focus:border-blue-500 outline-none" placeholder="e.g. B.Tech CSE" value={collegeForm.course} onChange={e => setCollegeForm({...collegeForm, course: e.target.value})} />
                </div>
                <button className="col-span-2 h-14 rounded-2xl bg-[#1f52cc] text-white font-bold text-lg mt-4 shadow-xl shadow-blue-100 hover:bg-[#1844b0] transition-all disabled:opacity-50" disabled={saving}>{saving ? 'Adding...' : 'Create College Entry'}</button>
              </form>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showDriveModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm modal-overlay-fade" onClick={() => setShowDriveModal(false)} />
          <div className="bg-white w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-[32px] shadow-2xl relative z-10 modal-scale-up">
            <div className="p-8">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Create Hiring Drive</h2>
                  <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm text-[#1f52cc]">apartment</span>
                    <span>For College: <strong className="text-slate-800">{selectedCollege?.name || 'Selected College'}</strong></span>
                  </div>
                </div>
                <button className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors" onClick={() => setShowDriveModal(false)}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <form className="space-y-4" onSubmit={handleAddDrive}>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-400 ml-1">Drive Title</label>
                  <input className="w-full h-12 rounded-xl border border-slate-200 px-4 focus:border-blue-500 outline-none" required value={driveForm.title} onChange={e => setDriveForm({...driveForm, title: e.target.value})} placeholder="e.g. Campus Recruitment 2026" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-400 ml-1">Start Date</label>
                    <input type="date" className="w-full h-12 rounded-xl border border-slate-200 px-4 focus:border-blue-500 outline-none" required value={driveForm.dateFrom} onChange={e => setDriveForm({...driveForm, dateFrom: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-400 ml-1">End Date (Optional)</label>
                    <input type="date" className="w-full h-12 rounded-xl border border-slate-200 px-4 focus:border-blue-500 outline-none" value={driveForm.dateTo} onChange={e => setDriveForm({...driveForm, dateTo: e.target.value})} />
                  </div>
                </div>

                {/* DESCRIPTION FIELD DIRECTLY ABOVE STATUS */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] uppercase font-bold text-slate-400 ml-1">Description (Optional)</label>
                    <span className={`text-[11px] font-medium transition-colors ${
                      driveDescWordCount > DRIVE_DESCRIPTION_MAX_WORDS
                        ? 'text-red-600 font-bold'
                        : driveDescWordCount >= 180
                        ? 'text-amber-600 font-semibold'
                        : 'text-slate-400'
                    }`}>
                      {driveDescWordCount} / {DRIVE_DESCRIPTION_MAX_WORDS} words
                    </span>
                  </div>
                  <textarea
                    rows={4}
                    className={`w-full rounded-xl border px-4 py-3 focus:outline-none transition-all resize-y text-sm font-normal ${
                      driveDescWordCount > DRIVE_DESCRIPTION_MAX_WORDS
                        ? 'border-red-400 focus:border-red-500 bg-red-50/30 text-slate-900'
                        : 'border-slate-200 focus:border-blue-500 bg-white text-slate-800'
                    }`}
                    placeholder="Brief summary of this drive — colleges, roles, or notes for the team"
                    value={driveForm.description || ''}
                    onChange={e => setDriveForm({ ...driveForm, description: e.target.value })}
                  />
                  {driveDescWordCount > DRIVE_DESCRIPTION_MAX_WORDS && (
                    <div className="text-xs text-red-600 font-medium mt-1 flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">error</span>
                      Description is {driveDescWordCount} words — please shorten to {DRIVE_DESCRIPTION_MAX_WORDS} or fewer
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-400 ml-1">Status</label>
                  <select className="w-full h-12 rounded-xl border border-slate-200 px-4 focus:border-blue-500 outline-none font-bold" value={driveForm.status} onChange={e => setDriveForm({...driveForm, status: e.target.value})}>
                    {DRIVE_STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
                <button
                  type="submit"
                  className="w-full h-14 rounded-2xl bg-[#1f52cc] text-white font-bold text-lg mt-4 shadow-xl shadow-blue-100 hover:bg-[#1844b0] transition-all disabled:opacity-50"
                  disabled={saving || driveDescWordCount > DRIVE_DESCRIPTION_MAX_WORDS}
                >
                  {saving ? 'Creating...' : 'Launch Drive'}
                </button>
              </form>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* EDIT DRIVE MODAL */}
      {showEditDriveModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm modal-overlay-fade" onClick={() => setShowEditDriveModal(false)} />
          <div className="bg-white w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-[32px] shadow-2xl relative z-10 modal-scale-up">
            <div className="p-8">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Edit Hiring Drive</h2>
                  <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm text-[#1f52cc]">apartment</span>
                    <span>College: <strong className="text-slate-800">{selectedCollege?.name || 'Selected College'}</strong></span>
                  </div>
                </div>
                <button className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors" onClick={() => setShowEditDriveModal(false)}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <form className="space-y-4" onSubmit={handleUpdateDrive}>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-400 ml-1">Drive Title</label>
                  <input className="w-full h-12 rounded-xl border border-slate-200 px-4 focus:border-blue-500 outline-none font-semibold" required value={editDriveForm.title} onChange={e => setEditDriveForm({...editDriveForm, title: e.target.value})} placeholder="e.g. Campus Recruitment 2026" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-400 ml-1">Start Date</label>
                    <input type="date" className="w-full h-12 rounded-xl border border-slate-200 px-4 focus:border-blue-500 outline-none" required value={editDriveForm.dateFrom} onChange={e => setEditDriveForm({...editDriveForm, dateFrom: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-400 ml-1">End Date (Optional)</label>
                    <input type="date" className="w-full h-12 rounded-xl border border-slate-200 px-4 focus:border-blue-500 outline-none" value={editDriveForm.dateTo} onChange={e => setEditDriveForm({...editDriveForm, dateTo: e.target.value})} />
                  </div>
                </div>

                {/* DESCRIPTION FIELD DIRECTLY ABOVE STATUS */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] uppercase font-bold text-slate-400 ml-1">Description (Optional)</label>
                    <span className={`text-[11px] font-medium transition-colors ${
                      editDriveDescWordCount > DRIVE_DESCRIPTION_MAX_WORDS
                        ? 'text-red-600 font-bold'
                        : editDriveDescWordCount >= 180
                        ? 'text-amber-600 font-semibold'
                        : 'text-slate-400'
                    }`}>
                      {editDriveDescWordCount} / {DRIVE_DESCRIPTION_MAX_WORDS} words
                    </span>
                  </div>
                  <textarea
                    rows={4}
                    className={`w-full rounded-xl border px-4 py-3 focus:outline-none transition-all resize-y text-sm font-normal ${
                      editDriveDescWordCount > DRIVE_DESCRIPTION_MAX_WORDS
                        ? 'border-red-400 focus:border-red-500 bg-red-50/30 text-slate-900'
                        : 'border-slate-200 focus:border-blue-500 bg-white text-slate-800'
                    }`}
                    placeholder="Brief summary of this drive — colleges, roles, or notes for the team"
                    value={editDriveForm.description || ''}
                    onChange={e => setEditDriveForm({ ...editDriveForm, description: e.target.value })}
                  />
                  {editDriveDescWordCount > DRIVE_DESCRIPTION_MAX_WORDS && (
                    <div className="text-xs text-red-600 font-medium mt-1 flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">error</span>
                      Description is {editDriveDescWordCount} words — please shorten to {DRIVE_DESCRIPTION_MAX_WORDS} or fewer
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-400 ml-1">Status</label>
                  <select className="w-full h-12 rounded-xl border border-slate-200 px-4 focus:border-blue-500 outline-none font-bold" value={editDriveForm.status} onChange={e => setEditDriveForm({...editDriveForm, status: e.target.value})}>
                    {DRIVE_STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
                <button
                  type="submit"
                  className="w-full h-14 rounded-2xl bg-[#1f52cc] text-white font-bold text-lg mt-4 shadow-xl shadow-blue-100 hover:bg-[#1844b0] transition-all disabled:opacity-50"
                  disabled={saving || editDriveDescWordCount > DRIVE_DESCRIPTION_MAX_WORDS}
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </form>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* DELETE COLLEGE CONFIRMATION MODAL */}
      {collegeToDelete && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm modal-overlay-fade" onClick={() => !deletingCollege && setCollegeToDelete(null)} />
          <div className="bg-white w-full max-w-md rounded-[32px] shadow-2xl relative z-10 modal-scale-up overflow-hidden">
            <div className="p-8">
              <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-2xl">delete_forever</span>
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">Delete College Entry?</h2>
              <p className="text-sm text-slate-600 leading-relaxed mb-6">
                Are you sure you want to delete <strong className="text-slate-900">"{collegeToDelete.name}"</strong>?
                This will permanently remove this college and any hiring drives created under it.
              </p>

              <div className="flex gap-3">
                <button
                  type="button"
                  className="flex-1 h-12 rounded-2xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50 transition-all text-sm"
                  onClick={() => setCollegeToDelete(null)}
                  disabled={deletingCollege}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="flex-1 h-12 rounded-2xl bg-red-600 text-white font-bold hover:bg-red-700 transition-all text-sm flex items-center justify-center gap-1.5 shadow-lg shadow-red-200 disabled:opacity-50"
                  onClick={handleDeleteCollege}
                  disabled={deletingCollege}
                >
                  {deletingCollege ? (
                    <>
                      <span className="material-symbols-outlined text-base animate-spin">sync</span>
                      Deleting...
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-base">delete</span>
                      Delete College
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default CollegeDriveWorkspace;
