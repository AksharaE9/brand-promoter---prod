import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import CompanyDropdownInput from './CompanyDropdownInput';
import { validateUploadFile } from '../lib/fileValidation';
import { MAX_UPLOAD_BYTES } from '../lib/uploadLimits';
import { buildApiUrl } from '../lib/api';
import { useAddCandidate } from '../hooks/useCandidateMutations';
import { search as apiSearch } from '../lib/searchClient';

const emptyCreateForm = {
  fullName: '',
  email: '',
  phone: '',
  course: '',
  location: '',
  preferredRole: '',
  company: '',
  source: '',
  resume: null,
};

export default function CreateCandidateModal({
  isOpen,
  onClose,
  onSuccess,
  driveId = null,
  defaultCollege = '',
  defaultSource = '',
  defaultCompany = 'Akshara Enterprises',
  statusFilter = null,
}) {
  const [createForm, setCreateForm] = useState({
    ...emptyCreateForm,
    company: defaultCompany || 'Akshara Enterprises',
    source: defaultSource || '',
  });
  const [creating, setCreating] = useState(false);
  const [modalError, setModalError] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [nameSuggestions, setNameSuggestions] = useState([]);
  const [isSearchingNames, setIsSearchingNames] = useState(false);

  const createSubmitInFlight = useRef(false);
  const searchDebounceRef = useRef(null);

  const { addCandidate, isAdding } = useAddCandidate({
    onSuccess: (candidate) => {
      if (onSuccess) onSuccess(candidate);
    },
    onError: (err) => {
      setModalError(err.message || 'Failed to create candidate');
    },
  });

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setCreateForm({
        ...emptyCreateForm,
        company: defaultCompany || 'Akshara Enterprises',
        source: defaultSource || '',
      });
      setModalError('');
      setSelectedCandidate(null);
      setNameSuggestions([]);
    }
  }, [isOpen, defaultCompany, defaultSource]);

  // Live autocomplete / duplicate detection by full name
  useEffect(() => {
    const term = createForm.fullName.trim();
    if (term.length < 2 || selectedCandidate) {
      setNameSuggestions([]);
      return;
    }

    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    searchDebounceRef.current = setTimeout(async () => {
      setIsSearchingNames(true);
      try {
        const searchResults = await apiSearch(term);
        const candidates = searchResults.candidates || [];
        setNameSuggestions(candidates.slice(0, 5));
      } catch (_) {
        setNameSuggestions([]);
      } finally {
        setIsSearchingNames(false);
      }
    }, 300);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [createForm.fullName, selectedCandidate]);

  if (!isOpen) return null;

  const isJoinedStatus = statusFilter === 'JOINED';
  const hasExistingResume = Boolean(selectedCandidate?.resumeFileId || selectedCandidate?.resumeLinkOriginal || selectedCandidate?.resumeLinkDownload);
  const isResumeRequired = !isJoinedStatus && !hasExistingResume;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isAdding || creating || createSubmitInFlight.current) return;

    if (isResumeRequired && !createForm.resume) {
      setModalError('Resume is required. Upload a PDF or Word document.');
      return;
    }

    createSubmitInFlight.current = true;
    setCreating(true);
    setModalError('');

    if (selectedCandidate) {
      try {
        // 1. If user uploaded a new resume, upload it first
        if (createForm.resume) {
          const resumeFormData = new FormData();
          resumeFormData.append('resume', createForm.resume);
          const res = await fetch(buildApiUrl(`/candidates/${selectedCandidate.id}/resume`), {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${localStorage.getItem('ats_token')}`,
            },
            body: resumeFormData,
          });
          if (!res.ok) {
            const errJson = await res.json();
            throw new Error(errJson.message || 'Failed to upload new resume.');
          }
        }

        // 2. Patch candidate details and link to drive if applicable
        const updatePayload = {
          fullName: createForm.fullName,
          email: createForm.email,
          phone: createForm.phone,
          course: createForm.course,
          location: createForm.location,
          preferredRole: createForm.preferredRole,
          company: createForm.company?.trim() || defaultCompany || 'Akshara Enterprises',
          source: createForm.source || defaultSource || 'Manual Entry',
          college: defaultCollege || undefined,
          status: statusFilter && statusFilter !== 'All' ? statusFilter : 'ACTIVE',
        };
        if (updatePayload.status === 'JOINED') {
          updatePayload.doj = new Date().toISOString();
        }

        const res = await fetch(buildApiUrl(`/candidates/${selectedCandidate.id}`), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('ats_token')}`,
          },
          body: JSON.stringify(updatePayload),
        });
        if (!res.ok) {
          const errJson = await res.json();
          throw new Error(errJson.message || 'Failed to update candidate details.');
        }

        // If in a drive context, ensure drive candidate relation exists
        if (driveId) {
          try {
            await fetch(buildApiUrl(`/college-drives/drives/${driveId}/candidates`), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('ats_token')}`,
              },
              body: JSON.stringify({
                fullName: createForm.fullName,
                email: createForm.email,
                phone: createForm.phone,
                course: createForm.course,
                location: createForm.location,
                preferredRole: createForm.preferredRole,
                company: createForm.company?.trim() || defaultCompany || 'Akshara Enterprises',
                source: createForm.source || defaultSource || 'College Drive',
                college: defaultCollege || undefined,
              }),
            });
          } catch (_) {}
        }

        onClose();
        if (onSuccess) onSuccess(selectedCandidate);
      } catch (err) {
        setModalError(err.message || 'Failed to update candidate');
      } finally {
        setCreating(false);
        createSubmitInFlight.current = false;
      }
    } else {
      // Creating completely new candidate
      try {
        const formData = new FormData();
        formData.append('fullName', createForm.fullName);
        formData.append('email', createForm.email);
        formData.append('phone', createForm.phone);
        formData.append('course', createForm.course);
        formData.append('location', createForm.location);
        formData.append('preferredRole', createForm.preferredRole);
        formData.append('company', createForm.company?.trim() || defaultCompany || 'Akshara Enterprises');
        formData.append('source', createForm.source || defaultSource || 'Manual Entry');
        if (defaultCollege) {
          formData.append('college', defaultCollege);
        }
        if (driveId) {
          formData.append('driveId', driveId);
        }
        if (statusFilter && statusFilter !== 'All') {
          formData.append('status', statusFilter);
        }
        formData.append('resume', createForm.resume);

        onClose();
        setCreateForm(emptyCreateForm);

        await addCandidate(formData, {
          fullName: createForm.fullName,
          email: createForm.email,
          phone: createForm.phone,
          course: createForm.course,
          location: createForm.location,
          preferredRole: createForm.preferredRole,
          company: createForm.company?.trim() || defaultCompany || 'Akshara Enterprises',
          source: createForm.source || defaultSource || 'Manual Entry',
          college: defaultCollege || '',
          status: statusFilter && statusFilter !== 'All' ? statusFilter : 'ACTIVE',
        });
      } catch (err) {
        console.error('Error adding candidate:', err);
        setModalError(err.message || 'Failed to create candidate');
      } finally {
        setCreating(false);
        createSubmitInFlight.current = false;
      }
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={onClose} />
      <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden relative z-10 animate-in zoom-in-95 duration-200">
        <div className="p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold text-[#0f1b3d] font-[Manrope]">Create New Candidate</h2>
              <p className="text-sm text-slate-500 mt-1">Enter candidate details and upload their profile</p>
            </div>
            <button
              type="button"
              className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors"
              onClick={onClose}
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          {modalError && (
            <div className="bg-red-50 border border-red-100 text-red-600 px-5 py-3 rounded-2xl flex items-center gap-2 text-sm font-medium animate-in fade-in duration-300 mb-4">
              <span className="material-symbols-outlined text-lg">error_outline</span>
              <span>{modalError}</span>
            </div>
          )}

          <form className="space-y-5" onSubmit={handleSubmit}>
            {selectedCandidate && (
              <div className="bg-blue-50 border border-blue-100 text-[#1f52cc] px-5 py-3 rounded-2xl flex justify-between items-center text-sm font-medium animate-in fade-in duration-300">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-lg">info</span>
                  <span>Editing existing candidate: <strong>{selectedCandidate.fullName}</strong></span>
                </div>
                <button
                  type="button"
                  className="text-xs font-bold bg-[#1f52cc]/10 hover:bg-[#1f52cc]/20 px-3 py-1.5 rounded-xl transition-colors"
                  onClick={() => {
                    setSelectedCandidate(null);
                    setCreateForm({
                      ...emptyCreateForm,
                      company: defaultCompany || 'Akshara Enterprises',
                      source: defaultSource || '',
                    });
                  }}
                >
                  Create New Instead
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-5">
              <div className="space-y-1 relative">
                <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Full Name *</label>
                <input
                  className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm focus:border-[#1f52cc] outline-none transition-all"
                  placeholder="e.g. John Doe"
                  required
                  value={createForm.fullName}
                  onChange={e => {
                    const newName = e.target.value;
                    setCreateForm(prev => ({ ...prev, fullName: newName }));
                    if (selectedCandidate && newName !== selectedCandidate.fullName) {
                      setSelectedCandidate(null);
                    }
                  }}
                />
                {isSearchingNames && (
                  <div className="absolute right-3 bottom-3 flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-[#1f52cc] border-t-transparent" />
                  </div>
                )}
                {nameSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-[68px] bg-white border border-slate-200 rounded-2xl shadow-xl z-[1200] max-h-60 overflow-y-auto divide-y divide-slate-100 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="p-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50/50">Existing Profiles Found</div>
                    {nameSuggestions.map(cand => (
                      <button
                        key={cand.id}
                        type="button"
                        className="w-full px-4 py-2.5 text-left hover:bg-slate-50 flex flex-col transition-colors border-none bg-transparent outline-none"
                        onClick={() => {
                          setSelectedCandidate(cand);
                          setCreateForm({
                            fullName: cand.fullName,
                            email: cand.email && cand.email !== 'N/A' ? cand.email : '',
                            phone: cand.phone || '',
                            course: cand.course || '',
                            location: cand.location || '',
                            preferredRole: cand.preferredRole || '',
                            company: cand.company || defaultCompany || '',
                            source: cand.source || defaultSource || '',
                            resume: null,
                          });
                          setNameSuggestions([]);
                        }}
                      >
                        <span className="font-semibold text-slate-800 text-sm">{cand.fullName}</span>
                        <span className="text-xs text-slate-500 mt-0.5">
                          {cand.phone ? `${cand.phone} • ` : ''}{cand.email && cand.email !== 'N/A' ? cand.email : 'No email'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Email Address</label>
                <input
                  type="email"
                  className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm focus:border-[#1f52cc] outline-none transition-all"
                  placeholder="e.g. john@example.com"
                  value={createForm.email}
                  onChange={e => setCreateForm(prev => ({ ...prev, email: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-5">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Phone Number *</label>
                <input
                  className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm focus:border-[#1f52cc] outline-none transition-all"
                  placeholder="e.g. +91 98765 43210"
                  required
                  value={createForm.phone}
                  onChange={e => setCreateForm(prev => ({ ...prev, phone: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Current Course</label>
                <input
                  className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm focus:border-[#1f52cc] outline-none transition-all"
                  placeholder="e.g. B.Tech CSE"
                  value={createForm.course}
                  onChange={e => setCreateForm(prev => ({ ...prev, course: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-5">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Location</label>
                <input
                  className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm focus:border-[#1f52cc] outline-none transition-all"
                  placeholder="e.g. Bangalore, KA"
                  value={createForm.location}
                  onChange={e => setCreateForm(prev => ({ ...prev, location: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Preferred Role</label>
                <input
                  className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm focus:border-[#1f52cc] outline-none transition-all"
                  placeholder="e.g. Frontend Developer"
                  value={createForm.preferredRole}
                  onChange={e => setCreateForm(prev => ({ ...prev, preferredRole: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-5">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Company</label>
                <CompanyDropdownInput
                  value={createForm.company}
                  onChange={val => setCreateForm(prev => ({ ...prev, company: val }))}
                  placeholder="e.g. Akshara Enterprises"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Source</label>
                <input
                  className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm focus:border-[#1f52cc] outline-none transition-all"
                  placeholder="e.g. LinkedIn, Referral, Direct"
                  value={createForm.source}
                  onChange={e => setCreateForm(prev => ({ ...prev, source: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">
                Resume / Profile Document {isResumeRequired ? <span className="text-red-500">*</span> : <span className="text-slate-400 font-normal">(Optional)</span>}
              </label>
              <div className="relative group">
                <input
                  type="file"
                  className="hidden"
                  id="create-modal-resume-upload"
                  accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  required={isResumeRequired}
                  onChange={async e => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const res = await validateUploadFile(file, 'candidate');
                      if (!res.valid) {
                        alert(res.error);
                        e.target.value = '';
                        setCreateForm(prev => ({ ...prev, resume: null }));
                        return;
                      }
                    }
                    setCreateForm(prev => ({ ...prev, resume: file || null }));
                  }}
                />
                <label
                  htmlFor="create-modal-resume-upload"
                  className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-[24px] cursor-pointer transition-all ${
                    createForm.resume
                      ? 'border-[#1f52cc] bg-blue-50/40'
                      : hasExistingResume
                        ? 'border-emerald-500 bg-emerald-50/20 hover:bg-emerald-50/40'
                        : 'border-slate-200 hover:border-[#1f52cc] hover:bg-blue-50/30'
                  }`}
                >
                  <span
                    className={`material-symbols-outlined text-3xl transition-all ${
                      createForm.resume
                        ? 'text-[#1f52cc]'
                        : hasExistingResume
                          ? 'text-emerald-500'
                          : 'text-slate-400 group-hover:text-[#1f52cc] group-hover:scale-110'
                    }`}
                  >
                    {createForm.resume ? 'description' : hasExistingResume ? 'task_alt' : 'upload_file'}
                  </span>
                  <span className="text-xs text-slate-500 mt-2 font-medium px-4 text-center">
                    {createForm.resume
                      ? createForm.resume.name
                      : hasExistingResume
                        ? 'Resume already uploaded (Click to replace with new document)'
                        : isJoinedStatus
                          ? 'Click to upload PDF or Word document (optional)'
                          : 'Click to upload PDF or Word document (required)'}
                  </span>
                </label>
              </div>
              {isResumeRequired && !createForm.resume && (
                <p className="text-[11px] text-slate-400 ml-1">A resume is required before HR can create the candidate.</p>
              )}
            </div>

            <div className="flex gap-4 pt-4">
              <button
                type="button"
                className="flex-1 h-12 rounded-2xl border border-slate-200 font-bold text-slate-500 hover:bg-slate-50 transition-all"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 h-12 rounded-2xl bg-[#1f52cc] text-white font-bold shadow-lg shadow-blue-200 hover:bg-[#1844b0] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isAdding || creating || (isResumeRequired && !createForm.resume)}
                title={isResumeRequired && !createForm.resume ? 'Upload a resume to create the candidate' : undefined}
              >
                {isAdding || creating ? 'Processing...' : selectedCandidate ? 'Save & Join' : 'Create Candidate'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}
