import React, { useEffect, useMemo, useState } from 'react';
import { buildApiUrl, API_ROOT_URL, apiGet, apiPost } from '../lib/api';
import { useNavigate } from 'react-router-dom';
import Reveal from './PageMotion';
import { subscribeSSE } from '../lib/sse';
import { MAX_UPLOAD_BYTES } from '../lib/uploadLimits';


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
  notes: '',
};

const emptyStudentForm = {
  fullName: '',
  email: '',
  phone: '',
};

function CollegeDriveWorkspace({ onBanner, onError }) {
  const navigate = useNavigate();
  const [colleges, setColleges] = useState([]);
  const [drives, setDrives] = useState([]);
  const [driveCandidates, setDriveCandidates] = useState([]);
  const [users, setUsers] = useState([]);
  const [globalJobs, setGlobalJobs] = useState([]);

  const [selectedCollegeId, setSelectedCollegeId] = useState('');
  const [selectedDriveId, setSelectedDriveId] = useState('');

  const [showCollegeModal, setShowCollegeModal] = useState(false);
  const [showStudentModal, setShowStudentModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [showDriveModal, setShowDriveModal] = useState(false);

  const [collegeForm, setCollegeForm] = useState(emptyCollegeForm);
  const [driveForm, setDriveForm] = useState(emptyDriveForm);
  const [studentForm, setStudentForm] = useState(emptyStudentForm);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkResults, setBulkResults] = useState(null);

  const [selectedRecruiterIds, setSelectedRecruiterIds] = useState([]);
  const [selectedJobToLink, setSelectedJobToLink] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selectedCollege = useMemo(() => colleges.find(c => c.id === selectedCollegeId), [colleges, selectedCollegeId]);
  const selectedDrive = useMemo(() => drives.find(d => d.id === selectedDriveId), [drives, selectedDriveId]);

  const loadColleges = async () => {
    const res = await apiGet('/college-drives/colleges');
    setColleges(res.data || []);
    if (!selectedCollegeId && res.data?.length > 0) setSelectedCollegeId(res.data[0].id);
  };

  const loadUsers = async () => {
    const res = await apiGet('/users/interviewers');
    setUsers(res.data || []);
  };

  const loadGlobalJobs = async () => {
    const res = await apiGet('/jobs?limit=100&isActive=true');
    setGlobalJobs(res.data || []);
  };

  const loadDrives = async (collegeId) => {
    if (!collegeId) {
      setDrives([]);
      setSelectedDriveId('');
      return;
    }
    const res = await apiGet(`/college-drives/drives?collegeId=${collegeId}`);
    setDrives(res.data || []);
    if (res.data?.length > 0 && !res.data.some(d => d.id === selectedDriveId)) {
      setSelectedDriveId(res.data[0].id);
    } else if (res.data?.length === 0) {
      setSelectedDriveId('');
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
        onError(err.message || 'Failed to load workspace');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

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
      if (['CANDIDATE_CREATED', 'CANDIDATE_UPDATED', 'DRIVE_CANDIDATE_ADDED', 'APPLICATION_STATUS_UPDATED'].includes(d.type)) {
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

  const downloadTemplate = () => {
    const headers = ["NAME", "CONTACT", "email"];
    const rows = [
      ["Sample Student", "9988776655", "sample@college.edu"],
      ["Example Name", "9123456789", "example@student.com"]
    ];
    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "ats_drive_template.csv");
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleAddDrive = async (e) => {
    e.preventDefault();
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

  const handleAddStudent = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      await apiPost(`/college-drives/drives/${selectedDriveId}/candidates`, studentForm);
      setStudentForm(emptyStudentForm);
      setShowStudentModal(false);
      await loadDriveDetails(selectedDriveId);
      onBanner('Student added successfully');
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleBulkUpload = async (e) => {
    e.preventDefault();
    if (!bulkFile) return;
    try {
      setSaving(true);
      const formData = new FormData();
      formData.append('file', bulkFile);
      const res = await fetch(buildApiUrl(`/college-drives/drives/${selectedDriveId}/bulk-upload`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('ats_token')}` },
        body: formData,
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Upload failed');
      setBulkResults(json.data);
      await loadDriveDetails(selectedDriveId);
      onBanner(`Bulk upload complete: ${json.data.inserted} inserted`);
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

        <div className="flex items-center gap-2">
          {selectedDriveId && (
            <>
              <button 
                className="h-11 px-6 rounded-2xl bg-emerald-600 text-white font-bold shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all flex items-center gap-2"
                onClick={() => setShowStudentModal(true)}
              >
                <span className="material-symbols-outlined text-xl">person_add</span>
                Add Student
              </button>
              <button 
                className="h-11 px-6 rounded-2xl bg-white border border-slate-200 text-slate-700 font-bold hover:bg-slate-50 transition-all flex items-center gap-2"
                onClick={() => setShowBulkModal(true)}
              >
                <span className="material-symbols-outlined text-xl">upload_file</span>
                Bulk Upload
              </button>
            </>
          )}
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
                <button
                  key={college.id}
                  onClick={() => setSelectedCollegeId(college.id)}
                  className={`w-full p-4 rounded-2xl border text-left transition-all ${selectedCollegeId === college.id ? 'bg-blue-50 border-blue-200 shadow-sm' : 'border-slate-100 hover:border-slate-300'}`}
                >
                  <div className="font-bold text-slate-900">{college.name}</div>
                  <div className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                    <span className="material-symbols-outlined text-[14px]">location_on</span>
                    {college.location || 'No location'}
                  </div>
                  {college.course && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      <span className="px-2 py-0.5 rounded-full bg-white border border-slate-100 text-[10px] font-bold text-slate-400 uppercase">{college.course}</span>
                      <span className="px-2 py-0.5 rounded-full bg-white border border-slate-100 text-[10px] font-bold text-slate-400 uppercase">{college.year}</span>
                    </div>
                  )}
                </button>
              ))}
              {colleges.length === 0 && <div className="p-8 text-center text-slate-400 text-sm italic">No colleges added yet.</div>}
            </div>
          </div>

          {selectedCollegeId && (
            <Reveal className="os-card p-6">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-lg">timeline</span>
                Available Drives
              </h3>
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
                  </button>
                ))}
                {drives.length === 0 && <div className="p-8 text-center text-slate-400 text-sm italic">No drives for this college.</div>}
              </div>
            </Reveal>
          )}
        </div>

        {/* DRIVE DETAILS & STUDENTS */}
        <div className="col-span-12 lg:col-span-8">
          {selectedDriveId ? (
            <Reveal className="os-card p-6 min-h-[600px]">
              <div className="flex items-center justify-between mb-8 pb-6 border-b border-slate-100">
                <div>
                  <div className="text-[10px] font-bold text-[#1f52cc] uppercase tracking-widest mb-1">{selectedCollege?.name}</div>
                  <h2 className="text-2xl font-bold text-slate-900">{selectedDrive?.title}</h2>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Students Enrolled</div>
                  <div className="text-3xl font-black text-slate-900 leading-none">{driveCandidates.length}</div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="pb-4 text-[10px] uppercase font-bold text-slate-400 tracking-wider px-2">Student Name</th>
                      <th className="pb-4 text-[10px] uppercase font-bold text-slate-400 tracking-wider px-2">Contact Details</th>
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
                        </td>
                        <td className="py-4 px-2">
                          <div className="text-xs text-slate-600">{cand.email}</div>
                          <div className="text-[10px] text-slate-400 font-medium">{cand.phone}</div>
                        </td>
                        <td className="py-4 px-2">
                          <div className="text-xs text-slate-600">
                            {cand.createdAt ? new Date(cand.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '---'}
                          </div>
                          <div className="text-[9px] text-slate-400 uppercase font-bold">
                            {cand.email?.includes('bulk') ? 'Bulk Sync' : 'Direct'}
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
                            className="w-8 h-8 rounded-full hover:bg-white hover:shadow-sm border border-transparent hover:border-slate-100 text-slate-400 hover:text-blue-600 transition-all flex items-center justify-center"
                            onClick={() => navigate(`/candidate/${cand.candidateId}`)}
                          >
                            <span className="material-symbols-outlined text-lg">visibility</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                    {driveCandidates.length === 0 && (
                      <tr>
                        <td colSpan="4" className="py-20 text-center text-slate-400 italic text-sm">No students added to this drive yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Reveal>
          ) : (
            <div className="os-card p-12 text-center flex flex-col items-center justify-center min-h-[400px]">
              <div className="w-20 h-20 rounded-full bg-slate-50 flex items-center justify-center text-slate-200 mb-6">
                <span className="material-symbols-outlined text-4xl">drive_file_rename_outline</span>
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Drive Workspace</h3>
              <p className="text-slate-500 text-sm max-w-xs">Select a college and then a drive from the left to manage students and recruiters.</p>
            </div>
          )}
        </div>
      </div>

      {/* MODALS */}
      {showCollegeModal && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm modal-overlay-fade" onClick={() => setShowCollegeModal(false)} />
          <div className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl overflow-hidden relative z-10 modal-scale-up">
            <div className="p-8">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold text-slate-900">Add New College</h2>
                <button className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors" onClick={() => setShowCollegeModal(false)}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
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
        </div>
      )}

      {showStudentModal && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm modal-overlay-fade" onClick={() => setShowStudentModal(false)} />
          <div className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl overflow-hidden relative z-10 modal-scale-up">
            <div className="p-8">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Add Student</h2>
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mt-1">{selectedDrive?.title}</p>
                </div>
                <button className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors" onClick={() => setShowStudentModal(false)}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <form className="space-y-4" onSubmit={handleAddStudent}>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-400 ml-1">Full Name</label>
                  <input className="w-full h-12 rounded-xl border border-slate-200 px-4 focus:border-blue-500 outline-none font-medium" required value={studentForm.fullName} onChange={e => setStudentForm({...studentForm, fullName: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-400 ml-1">Email Address</label>
                  <input type="email" className="w-full h-12 rounded-xl border border-slate-200 px-4 focus:border-blue-500 outline-none font-medium" value={studentForm.email} onChange={e => setStudentForm({...studentForm, email: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-400 ml-1">Phone Number (Required)</label>
                  <input className="w-full h-12 rounded-xl border border-slate-200 px-4 focus:border-blue-500 outline-none font-medium" required value={studentForm.phone} onChange={e => setStudentForm({...studentForm, phone: e.target.value})} />
                </div>
                <button className="w-full h-14 rounded-2xl bg-emerald-600 text-white font-bold text-lg mt-4 shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all disabled:opacity-50" disabled={saving}>{saving ? 'Saving...' : 'Add to Drive'}</button>
              </form>
            </div>
          </div>
        </div>
      )}

      {showBulkModal && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm modal-overlay-fade" onClick={() => setShowBulkModal(false)} />
          <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden relative z-10 modal-scale-up">
            <div className="p-8">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Bulk Upload Students</h2>
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mt-1">Excel / CSV Supported</p>
                </div>
                <button className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors" onClick={() => { setShowBulkModal(false); setBulkResults(null); }}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              {!bulkResults ? (
                <form onSubmit={handleBulkUpload} className="space-y-6">
                  <div className="p-10 border-2 border-dashed border-slate-200 rounded-[28px] bg-slate-50/50 flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 rounded-full bg-white shadow-sm flex items-center justify-center text-slate-400 mb-4">
                      <span className="material-symbols-outlined text-3xl">cloud_upload</span>
                    </div>
                    <h4 className="font-bold text-slate-800 mb-1">Select Excel Template</h4>
                    <p className="text-xs text-slate-500 mb-2 max-w-xs">Template columns: <b>NAME, CONTACT, email</b>.</p>
                    <button 
                      type="button" 
                      onClick={downloadTemplate}
                      className="text-[#1f52cc] text-[10px] font-bold uppercase tracking-wider hover:underline mb-6 flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-sm">download</span>
                      Download Sample Template
                    </button>
                    <input 
                      type="file" 
                      accept=".xlsx, .csv" 
                      className="hidden" 
                      id="bulk-file-input" 
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file && file.size > MAX_UPLOAD_BYTES) {
                          alert('File exceeds the 10 MB limit. Split it into smaller files if needed.');
                          e.target.value = '';
                          return;
                        }
                        setBulkFile(file);
                      }}
                    />
                    <label htmlFor="bulk-file-input" className="h-11 px-6 rounded-xl border border-slate-200 bg-white font-bold text-slate-600 hover:bg-slate-100 cursor-pointer transition-all flex items-center gap-2">
                      {bulkFile ? bulkFile.name : 'Choose File'}
                    </label>
                  </div>
                  <button className="w-full h-14 rounded-2xl bg-[#1f52cc] text-white font-bold text-lg shadow-xl shadow-blue-100 hover:bg-[#1844b0] transition-all disabled:opacity-50" disabled={!bulkFile || saving}>{saving ? 'Processing...' : 'Upload & Sync'}</button>
                </form>
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100 text-center">
                      <div className="text-2xl font-black text-emerald-600">{bulkResults.inserted}</div>
                      <div className="text-[10px] font-bold text-emerald-800 uppercase tracking-widest">Inserted</div>
                    </div>
                    <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100 text-center">
                      <div className="text-2xl font-black text-amber-600">{bulkResults.skipped}</div>
                      <div className="text-[10px] font-bold text-amber-800 uppercase tracking-widest">Skipped / Failed</div>
                    </div>
                  </div>

                  {bulkResults.errors?.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[10px] font-bold text-red-500 uppercase tracking-widest ml-1">Detailed Error Report</div>
                      <div className="max-h-48 overflow-y-auto bg-red-50/30 rounded-2xl border border-red-100 p-4 divide-y divide-red-100">
                        {bulkResults.errors.map((err, i) => (
                          <div key={i} className="py-2 text-[11px] text-red-700 font-medium flex items-start gap-2">
                            <span className="material-symbols-outlined text-sm mt-0.5">error</span>
                            {err}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <button className="w-full h-12 rounded-2xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50 transition-all" onClick={() => { setShowBulkModal(false); setBulkResults(null); }}>Done</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showDriveModal && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm modal-overlay-fade" onClick={() => setShowDriveModal(false)} />
          <div className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl overflow-hidden relative z-10 modal-scale-up">
            <div className="p-8">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold text-slate-900">Create Hiring Drive</h2>
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
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-400 ml-1">Status</label>
                  <select className="w-full h-12 rounded-xl border border-slate-200 px-4 focus:border-blue-500 outline-none font-bold" value={driveForm.status} onChange={e => setDriveForm({...driveForm, status: e.target.value})}>
                    {DRIVE_STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
                <button className="w-full h-14 rounded-2xl bg-[#1f52cc] text-white font-bold text-lg mt-4 shadow-xl shadow-blue-100 hover:bg-[#1844b0] transition-all disabled:opacity-50" disabled={saving}>{saving ? 'Creating...' : 'Launch Drive'}</button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CollegeDriveWorkspace;
