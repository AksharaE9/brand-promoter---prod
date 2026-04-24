import React, { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL, apiGet, apiPost } from '../lib/api';

const STATUS_OPTIONS = ['ADDED', 'SCREENED', 'SHORTLISTED', 'INTERVIEWED', 'OFFERED', 'JOINED', 'REJECTED'];
const DRIVE_STATUS_OPTIONS = ['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED'];

const emptyDriveForm = {
  title: '',
  dateFrom: '',
  dateTo: '',
  status: 'PLANNED',
  notes: '',
};

const emptyCandidateForm = {
  fullName: '',
  email: '',
  phone: '',
};

function CollegeDriveWorkspace({ onBanner, onError }) {
  const [colleges, setColleges] = useState([]);
  const [drives, setDrives] = useState([]);
  const [driveCandidates, setDriveCandidates] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [users, setUsers] = useState([]);

  const [selectedCollegeId, setSelectedCollegeId] = useState('');
  const [selectedDriveId, setSelectedDriveId] = useState('');

  const [collegeForm, setCollegeForm] = useState({ name: '', location: '' });
  const [driveForm, setDriveForm] = useState(emptyDriveForm);
  const [candidateForm, setCandidateForm] = useState(emptyCandidateForm);
  const [bulkFile, setBulkFile] = useState(null);

  const [selectedRecruiterIds, setSelectedRecruiterIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selectedDrive = useMemo(
    () => drives.find((d) => d.id === selectedDriveId) || null,
    [drives, selectedDriveId],
  );

  const loadColleges = async () => {
    const res = await apiGet('/college-drives/colleges');
    const rows = res.data || [];
    setColleges(rows);

    if (!selectedCollegeId && rows.length > 0) {
      setSelectedCollegeId(rows[0].id);
    }
  };

  const loadUsers = async () => {
    const res = await apiGet('/users/interviewers');
    setUsers(res.data || []);
  };

  const loadDrives = async (collegeId) => {
    if (!collegeId) {
      setDrives([]);
      setSelectedDriveId('');
      return;
    }

    const res = await apiGet(`/college-drives/drives?collegeId=${collegeId}`);
    const rows = res.data || [];
    setDrives(rows);

    if (rows.length === 0) {
      setSelectedDriveId('');
      return;
    }

    if (!rows.some((item) => item.id === selectedDriveId)) {
      setSelectedDriveId(rows[0].id);
    }
  };

  const loadDriveDetails = async (driveId) => {
    if (!driveId) {
      setDriveCandidates([]);
      setTimeline([]);
      setSelectedRecruiterIds([]);
      return;
    }

    const [candRes, timelineRes, drivesRes] = await Promise.all([
      apiGet(`/college-drives/drives/${driveId}/candidates`),
      apiGet(`/college-drives/drives/${driveId}/timeline`),
      apiGet(`/college-drives/drives?collegeId=${selectedCollegeId}`),
    ]);

    setDriveCandidates(candRes.data || []);
    setTimeline(timelineRes.data || []);

    const drive = (drivesRes.data || []).find((item) => item.id === driveId);
    setSelectedRecruiterIds((drive?.recruiters || []).map((item) => item.userId));
  };

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      try {
        setLoading(true);
        await Promise.all([loadColleges(), loadUsers()]);
      } catch (err) {
        if (mounted) onError(err.message || 'Failed to load college workspace');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    run();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    loadDrives(selectedCollegeId).catch((err) => onError(err.message || 'Failed to load drives'));
  }, [selectedCollegeId]);

  useEffect(() => {
    loadDriveDetails(selectedDriveId).catch((err) => onError(err.message || 'Failed to load drive details'));
  }, [selectedDriveId]);

  const createCollege = async (event) => {
    event.preventDefault();
    if (!collegeForm.name.trim()) return;

    try {
      setSaving(true);
      await apiPost('/college-drives/colleges', {
        name: collegeForm.name.trim(),
        location: collegeForm.location.trim() || null,
      });
      setCollegeForm({ name: '', location: '' });
      await loadColleges();
      onBanner('College added successfully.');
    } catch (err) {
      onError(err.message || 'Failed to create college');
    } finally {
      setSaving(false);
    }
  };

  const createDrive = async (event) => {
    event.preventDefault();
    if (!selectedCollegeId || !driveForm.title.trim() || !driveForm.dateFrom) {
      onError('Drive title and start date are required.');
      return;
    }

    try {
      setSaving(true);
      await apiPost('/college-drives/drives', {
        collegeId: selectedCollegeId,
        title: driveForm.title.trim(),
        dateFrom: driveForm.dateFrom,
        dateTo: driveForm.dateTo || null,
        notes: driveForm.notes || null,
        status: driveForm.status,
      });
      setDriveForm(emptyDriveForm);
      await loadDrives(selectedCollegeId);
      onBanner('College drive created.');
    } catch (err) {
      onError(err.message || 'Failed to create drive');
    } finally {
      setSaving(false);
    }
  };

  const saveRecruiters = async () => {
    if (!selectedDriveId) return;
    try {
      setSaving(true);
      await apiPost(`/college-drives/drives/${selectedDriveId}/recruiters`, {
        recruiterIds: selectedRecruiterIds,
      });
      await loadDrives(selectedCollegeId);
      onBanner('Drive recruiter assignments updated.');
    } catch (err) {
      onError(err.message || 'Failed to update recruiters');
    } finally {
      setSaving(false);
    }
  };

  const addCandidate = async (event) => {
    event.preventDefault();
    if (!selectedDriveId) {
      onError('Select a drive first.');
      return;
    }

    try {
      setSaving(true);
      await apiPost(`/college-drives/drives/${selectedDriveId}/candidates`, {
        fullName: candidateForm.fullName.trim(),
        email: candidateForm.email.trim() || null,
        phone: candidateForm.phone.trim() || null,
      });
      setCandidateForm(emptyCandidateForm);
      await loadDriveDetails(selectedDriveId);
      onBanner('Candidate added to college drive.');
    } catch (err) {
      onError(err.message || 'Failed to add candidate');
    } finally {
      setSaving(false);
    }
  };

  const uploadBulk = async (event) => {
    event.preventDefault();
    if (!selectedDriveId || !bulkFile) {
      onError('Select drive and upload file.');
      return;
    }

    try {
      setSaving(true);
      const token = localStorage.getItem('ats_token');
      const formData = new FormData();
      formData.append('file', bulkFile);

      const response = await fetch(`${API_BASE_URL}/college-drives/drives/${selectedDriveId}/bulk-upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message || 'Bulk upload failed');
      }

      await loadDriveDetails(selectedDriveId);
      setBulkFile(null);
      onBanner(`Bulk upload complete. Inserted: ${payload.data.inserted}, Skipped: ${payload.data.skipped}`);
    } catch (err) {
      onError(err.message || 'Failed bulk upload');
    } finally {
      setSaving(false);
    }
  };

  const updateDriveCandidateStatus = async (candidateId, status) => {
    if (!selectedDriveId || !candidateId) return;

    try {
      await fetch(`${API_BASE_URL}/college-drives/drives/${selectedDriveId}/candidates/${candidateId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('ats_token')}`,
        },
        body: JSON.stringify({ status }),
      });

      await loadDriveDetails(selectedDriveId);
      onBanner('Candidate drive status updated.');
    } catch (err) {
      onError(err.message || 'Failed to update status');
    }
  };

  if (loading) {
    return <div className="os-card mt-4 p-5 text-sm text-[#6f7d98]">Loading college drive workspace...</div>;
  }

  return (
    <div className="grid xl:grid-cols-[1fr_1fr] gap-4 mt-4">
      <div className="space-y-4">
        <div className="os-card p-5">
          <h3 className="text-lg font-semibold text-[#0f1b3d]">Colleges</h3>
          <form className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3" onSubmit={createCollege}>
            <input
              className="h-10 rounded-lg border border-[#dbe4ee] px-3 text-sm"
              placeholder="College Name"
              value={collegeForm.name}
              onChange={(event) => setCollegeForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
            <input
              className="h-10 rounded-lg border border-[#dbe4ee] px-3 text-sm"
              placeholder="Location"
              value={collegeForm.location}
              onChange={(event) => setCollegeForm((prev) => ({ ...prev, location: event.target.value }))}
            />
            <button className="os-btn-primary" type="submit" disabled={saving}>Add College</button>
          </form>

          <div className="mt-3 flex flex-wrap gap-2">
            {colleges.map((college) => (
              <button
                key={college.id}
                className={`os-btn-outline !h-9 ${college.id === selectedCollegeId ? '!border-[#1f52cc] !text-[#1f52cc]' : ''}`}
                type="button"
                onClick={() => setSelectedCollegeId(college.id)}
              >
                {college.name}
              </button>
            ))}
            {colleges.length === 0 ? <div className="text-xs text-[#6f7d98]">No colleges added yet.</div> : null}
          </div>
        </div>

        <div className="os-card p-5">
          <h3 className="text-lg font-semibold text-[#0f1b3d]">College Drives</h3>
          <form className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3" onSubmit={createDrive}>
            <input
              className="h-10 rounded-lg border border-[#dbe4ee] px-3 text-sm md:col-span-2"
              placeholder="Drive Title (e.g., CSE Final Year 2026)"
              value={driveForm.title}
              onChange={(event) => setDriveForm((prev) => ({ ...prev, title: event.target.value }))}
              required
            />
            <input
              type="date"
              className="h-10 rounded-lg border border-[#dbe4ee] px-3 text-sm"
              value={driveForm.dateFrom}
              onChange={(event) => setDriveForm((prev) => ({ ...prev, dateFrom: event.target.value }))}
              required
            />
            <input
              type="date"
              className="h-10 rounded-lg border border-[#dbe4ee] px-3 text-sm"
              value={driveForm.dateTo}
              onChange={(event) => setDriveForm((prev) => ({ ...prev, dateTo: event.target.value }))}
            />
            <select
              className="h-10 rounded-lg border border-[#dbe4ee] px-3 text-sm"
              value={driveForm.status}
              onChange={(event) => setDriveForm((prev) => ({ ...prev, status: event.target.value }))}
            >
              {DRIVE_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <button className="os-btn-primary" type="submit" disabled={saving}>Create Drive</button>
          </form>

          <div className="mt-3 space-y-2">
            {drives.map((drive) => (
              <button
                key={drive.id}
                className={`w-full text-left rounded-lg border px-3 py-2 text-sm ${selectedDriveId === drive.id ? 'border-[#1f52cc] bg-blue-50 text-[#1f52cc]' : 'border-[#dbe4ee]'}`}
                onClick={() => setSelectedDriveId(drive.id)}
                type="button"
              >
                <div className="font-semibold">{drive.title}</div>
                <div className="text-[11px] text-[#6f7d98]">{drive.status} | {new Date(drive.dateFrom).toLocaleDateString()}</div>
              </button>
            ))}
            {drives.length === 0 ? <div className="text-xs text-[#6f7d98]">No drives for selected college.</div> : null}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="os-card p-5">
          <h3 className="text-lg font-semibold text-[#0f1b3d]">Recruiters/Interviewers in Drive</h3>
          {selectedDrive ? (
            <>
              <div className="mt-3 max-h-40 overflow-y-auto border border-[#dbe4ee] rounded-lg p-2 space-y-1">
                {users.map((user) => (
                  <label key={user.id} className="flex items-center gap-2 text-sm text-[#213152]">
                    <input
                      type="checkbox"
                      checked={selectedRecruiterIds.includes(user.id)}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setSelectedRecruiterIds((prev) => checked ? [...prev, user.id] : prev.filter((item) => item !== user.id));
                      }}
                    />
                    {user.fullName} ({user.role})
                  </label>
                ))}
              </div>
              <button className="os-btn-primary mt-3" type="button" onClick={saveRecruiters} disabled={saving}>Save Assignments</button>
            </>
          ) : (
            <div className="mt-2 text-sm text-[#6f7d98]">Select a drive to assign recruiters/interviewers.</div>
          )}
        </div>

        <div className="os-card p-5">
          <h3 className="text-lg font-semibold text-[#0f1b3d]">Add Candidates to Drive</h3>
          <form className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3" onSubmit={addCandidate}>
            <input
              className="h-10 rounded-lg border border-[#dbe4ee] px-3 text-sm"
              placeholder="Full Name"
              value={candidateForm.fullName}
              onChange={(event) => setCandidateForm((prev) => ({ ...prev, fullName: event.target.value }))}
              required
            />
            <input
              className="h-10 rounded-lg border border-[#dbe4ee] px-3 text-sm"
              placeholder="Email"
              value={candidateForm.email}
              onChange={(event) => setCandidateForm((prev) => ({ ...prev, email: event.target.value }))}
            />
            <input
              className="h-10 rounded-lg border border-[#dbe4ee] px-3 text-sm"
              placeholder="Phone"
              value={candidateForm.phone}
              onChange={(event) => setCandidateForm((prev) => ({ ...prev, phone: event.target.value }))}
            />
            <button className="os-btn-primary md:col-span-3" type="submit" disabled={saving}>Add Candidate</button>
          </form>

          <form className="mt-3 flex flex-wrap gap-2" onSubmit={uploadBulk}>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="h-10 text-sm"
              onChange={(event) => setBulkFile(event.target.files?.[0] || null)}
            />
            <button className="os-btn-outline" type="submit" disabled={saving || !bulkFile}>Bulk Upload Excel</button>
          </form>
        </div>

        <div className="os-card p-5">
          <h3 className="text-lg font-semibold text-[#0f1b3d]">Drive Candidate Tracking</h3>
          <div className="mt-3 space-y-2 max-h-52 overflow-y-auto">
            {driveCandidates.map((row) => (
              <div key={row.candidate.id} className="border border-[#dbe4ee] rounded-lg p-2 text-sm">
                <div className="font-semibold text-[#12244b]">{row.candidate.fullName}</div>
                <div className="text-[11px] text-[#6f7d98]">{row.candidate.email || row.candidate.phone || 'No contact'}</div>
                <div className="mt-2 flex gap-2 items-center">
                  <select
                    className="h-8 rounded border border-[#dbe4ee] px-2 text-xs"
                    value={row.status}
                    onChange={(event) => updateDriveCandidateStatus(row.candidate.id, event.target.value)}
                  >
                    {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                  <span className="text-[10px] text-[#6f7d98]">Apps: {row.candidate._count?.applications || 0}</span>
                </div>
              </div>
            ))}
            {driveCandidates.length === 0 ? <div className="text-xs text-[#6f7d98]">No candidates in selected drive.</div> : null}
          </div>
        </div>

        <div className="os-card p-5">
          <h3 className="text-lg font-semibold text-[#0f1b3d]">Drive Timeline</h3>
          <div className="mt-3 space-y-2 max-h-52 overflow-y-auto">
            {timeline.slice(0, 25).map((item, idx) => (
              <div key={`${item.type}-${item.at}-${idx}`} className="border border-[#e7edf4] rounded-lg p-2 text-xs">
                <div className="font-semibold text-[#12244b]">{item.candidate?.fullName || 'Candidate'}</div>
                <div className="text-[#6f7d98]">{item.type.replaceAll('_', ' ')}</div>
                <div className="text-[#1f52cc]">{item.status || item.applicationStatus || '-'}</div>
                <div className="text-[#9aa3b8]">{new Date(item.at).toLocaleString()}</div>
              </div>
            ))}
            {timeline.length === 0 ? <div className="text-xs text-[#6f7d98]">No timeline events yet.</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CollegeDriveWorkspace;
