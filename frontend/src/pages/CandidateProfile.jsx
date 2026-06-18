import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import Loader from '../components/Loader';
import { API_BASE_URL, apiGet, apiPost, apiPatch, getStoredUser } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';

const InterviewItem = React.memo(({ iv, idx, onUpdateLinks, onUploadRecording, navigate, currentUser }) => {
  return (
    <div className="os-card !rounded-2xl p-5 border-l-4 border-l-[#1f52cc] bg-white shadow-sm transition-all hover:shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 text-[#1f52cc] flex flex-col items-center justify-center font-bold">
            <div className="text-xs">R</div>
            <div className="text-lg leading-none">{iv.roundNo || (idx + 1)}</div>
          </div>
          <div>
            <div className="font-bold text-[#10193f] text-lg">{iv.round || `Round ${iv.roundNo || (idx + 1)}`}</div>
            <div className="text-xs text-[#1f52cc] font-bold mt-0.5">{iv.application?.job?.title || 'General Hiring'}</div>
            <div className="text-[10px] text-[#7a88a3] mt-1 flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px]">calendar_today</span>
              {new Date(iv.scheduledStart).toLocaleDateString()} • {iv.mode}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {iv.result === 'PASS' ? (
            <div className="px-3 py-1.5 rounded-xl bg-emerald-100 text-emerald-700 text-xs font-bold flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">check_circle</span> SELECTED
            </div>
          ) : iv.result === 'FAIL' ? (
            <div className="px-3 py-1.5 rounded-xl bg-rose-100 text-rose-700 text-xs font-bold flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">cancel</span> REJECTED
            </div>
          ) : (
            <div className="px-3 py-1.5 rounded-xl bg-amber-100 text-amber-700 text-xs font-bold">PENDING</div>
          )}
        </div>
      </div>

      <div className="mt-5 grid md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400">Interviewer Feedback</label>
            <div className="mt-1.5 text-sm text-[#334155] leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100">
              {iv.feedbackText || "Waiting for feedback submission..."}
            </div>
          </div>
          {iv.interviewerRating && (
            <div className="flex items-center gap-2">
              <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400">Rating:</label>
              <div className="flex gap-0.5">
                {[1,2,3,4,5].map(star => (
                  <span key={star} className={`material-symbols-outlined text-sm ${star <= iv.interviewerRating ? 'text-amber-400 fill-amber-400' : 'text-slate-200'}`}>star</span>
                ))}
              </div>
              <span className="text-xs font-bold text-slate-600">{iv.interviewerRating}/5</span>
            </div>
          )}
        </div>
        <div className="space-y-4">
          <div className="flex flex-col gap-2">
            <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400">Optional Links</label>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-slate-400 text-base">link</span>
              <div className="flex-1 flex items-center gap-2">
                <input 
                  className="flex-1 h-9 rounded-lg border border-[#e4ebf1] px-3 text-xs focus:border-[#1f52cc] outline-none"
                  placeholder="Meeting Link"
                  defaultValue={iv.zohoLink || iv.meetingLink || ''}
                  onBlur={(e) => onUpdateLinks(iv.id, { zohoLink: e.target.value })}
                />
                {(iv.zohoLink || iv.meetingLink) && (
                  <a href={iv.zohoLink || iv.meetingLink} target="_blank" rel="noreferrer" className="h-9 w-9 rounded-lg bg-blue-50 text-[#1f52cc] flex items-center justify-center hover:bg-blue-100 transition-colors">
                    <span className="material-symbols-outlined text-sm">open_in_new</span>
                  </a>
                )}
              </div>
            </div>
            <div className="relative">
              <button className={`os-btn-outline !h-9 w-full !text-[10px] flex items-center justify-center gap-2 ${iv.voiceRecordingFile ? 'text-emerald-600 border-emerald-200 bg-emerald-50' : ''}`} type="button">
                <span className="material-symbols-outlined text-base">{iv.voiceRecordingFile ? 'play_circle' : 'mic'}</span>
                {iv.voiceRecordingFile ? 'Recording Uploaded' : 'Upload Voice Recording'}
                <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept="audio/*" onChange={(e) => onUploadRecording(iv.id, e.target.files?.[0])} />
              </button>
            </div>
            {(!iv.result || iv.result === 'PENDING') && (
              <button className="os-btn-primary w-full !h-9 !text-xs mt-2 shadow-lg shadow-blue-100" onClick={() => navigate(`/schedule?interviewId=${iv.id}&submitFeedback=true`)}>
                Submit Feedback
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

const CandidateProfile = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [candidate, setCandidate] = useState(null);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');
  const [resumeFile, setResumeFile] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [uploadingResume, setUploadingResume] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [customDefinitions, setCustomDefinitions] = useState([]);
  const [customValues, setCustomValues] = useState({});
  const [savingCustomFields, setSavingCustomFields] = useState(false);
  const [interviews, setInterviews] = useState([]);
  const [team, setTeam] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [uploadingRecording, setUploadingRecording] = useState(false);
  const [savingManagement, setSavingManagement] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [loading, setLoading] = useState(true);

  const currentUser = useMemo(() => getStoredUser(), []);
  const canManageCandidate = useMemo(() => ['SUPER_ADMIN', 'RECRUITER'].includes(currentUser?.role), [currentUser]);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      const [candidateRes, definitionRes, teamRes, jobsRes, interviewsRes] = await Promise.all([
        apiGet(`/candidates/${id}`),
        apiGet('/candidates/custom-fields/definitions'),
        apiGet('/users/interviewers'),
        apiGet('/jobs?limit=100&isActive=true'),
        apiGet(`/interviews?candidateId=${id}&limit=50`)
      ]);
      const loadedCandidate = candidateRes.data;
      if (!loadedCandidate) throw new Error('Candidate dossier not found');
      setCandidate(loadedCandidate);
      setCustomDefinitions(definitionRes.data || []);
      setTeam(teamRes.data || []);
      setJobs(jobsRes.data || []);
      
      const allInterviews = interviewsRes.data || [];
      const filteredInterviews = allInterviews.filter(iv => 
        iv.interviewers?.some(u => u.id === currentUser?.id)
      );
      setInterviews(filteredInterviews);
      setCustomValues(loadedCandidate.customFields || {});
      setEditForm({
        fullName: loadedCandidate.fullName || '',
        email: loadedCandidate.email || '',
        phone: loadedCandidate.phone || '',
        currentCompany: loadedCandidate.currentCompany || '',
        totalExperienceYears: loadedCandidate.totalExperienceYears || '',
        location: loadedCandidate.location || '',
        preferredRole: loadedCandidate.preferredRole || '',
        primarySkill: loadedCandidate.primarySkill || '',
        category: loadedCandidate.category || 'Company',
      });
    } catch (err) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [id, currentUser?.id, currentUser?.role]);

  const handleUploadResume = useCallback(async (file) => {
    if (!file) return;
    try {
      setUploadingResume(true);
      const token = localStorage.getItem('ats_token');
      const formData = new FormData();
      formData.append('resume', file);

      const response = await fetch(`${API_BASE_URL}/candidates/${id}/resume`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      if (!response.ok) throw new Error('Resume upload failed');
      setBanner('Resume uploaded successfully.');
      loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadingResume(false);
    }
  }, [id, loadAll]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleUpdateLinks = useCallback(async (interviewId, links) => {
    const previousInterviews = [...interviews];
    
    // Optimistic Update: merge links into local interviews state
    setInterviews(prev => prev.map(iv => 
      iv.id === interviewId 
        ? { ...iv, ...links } 
        : iv
    ));
    setBanner('Interview links updated.');

    try {
      const res = await apiPatch(`/interviews/${interviewId}`, links);
      if (!res.success) throw new Error(res.message || "Failed to update links");
    } catch (err) {
      setError(err.message);
      setBanner('');
      setInterviews(previousInterviews);
    } finally {
      await loadAll();
    }
  }, [interviews, loadAll]);

  const handleUploadRecording = useCallback(async (interviewId, file) => {
    if (!file) return;
    try {
      setUploadingRecording(true);
      const token = localStorage.getItem('ats_token');
      const formData = new FormData();
      formData.append('recording', file);

      const response = await fetch(`${API_BASE_URL}/interviews/${interviewId}/recording`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      if (!response.ok) throw new Error('Upload failed');
      setBanner('Recording uploaded successfully.');
      loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadingRecording(false);
    }
  }, [loadAll]);

  const handleSaveEdit = async () => {
    const previousCandidate = candidate;
    const previousEditForm = { ...editForm };
    
    // Optimistic Update: close edit and merge details into local state immediately
    setCandidate(prev => ({ ...prev, ...editForm }));
    setIsEditing(false);
    setBanner('Profile updated successfully.');

    try {
      const res = await apiPatch(`/candidates/${id}`, editForm);
      if (!res.success) throw new Error(res.message || "Failed to update profile");
    } catch (err) {
      setError(err.message || 'Failed to update profile');
      setBanner('');
      setCandidate(previousCandidate);
      setEditForm(previousEditForm);
      setIsEditing(true);
    } finally {
      await loadAll();
    }
  };

  if (loading) {
    return (
      <EnterpriseLayout
        sidebar={<EnterpriseSidebar active="candidates" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
        topbar={<EnterpriseTopbar searchPlaceholder="Loading profile..." right={<UserChip avatarSeed={id} />} />}
      >
        <Loader message="Synchronizing candidate dossier..." fullPage />
      </EnterpriseLayout>
    );
  }

  if (!candidate && !error) return <div className="p-10 text-center font-bold text-[#1f52cc] animate-pulse">Loading Premium Candidate Dossier...</div>;

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active="candidates" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
      topbar={<EnterpriseTopbar searchPlaceholder="Search..." right={<UserChip avatarSeed="candidate-profile" />} />}
    >
      <PageEnter>
        <div className="mb-4">
          <Link to="/candidates" className="text-sm text-[#1f4bc6] flex items-center gap-1 font-semibold hover:underline">
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            Back to Directory
          </Link>
        </div>

        {error && <div className="os-card p-4 text-red-600 text-sm mb-4 border-red-100 bg-red-50">{error}</div>}
        {banner && <div className="os-card p-4 text-[#2454cf] text-sm mb-4 border-blue-100 bg-blue-50">{banner}</div>}

        {candidate && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 space-y-6">
              <Reveal>
                <div className="os-card p-6 flex flex-wrap items-start gap-6 relative overflow-hidden bg-gradient-to-br from-white to-[#f8fafc]">
                  <div className="absolute top-0 right-0 p-4 opacity-40">
                    <div className="text-[10px] uppercase tracking-widest font-bold text-slate-400">REF: {candidate.id.slice(-8)}</div>
                  </div>
                  <div className="relative group">
                    {candidate.profilePhotoFile?.storageKey ? (
                      <img className="w-28 h-28 rounded-3xl object-cover shadow-xl border-4 border-white" src={candidate.profilePhotoFile.storageKey} alt={candidate.fullName} />
                    ) : (
                      <div className="w-28 h-28 rounded-3xl bg-gradient-to-br from-[#1f52cc] to-[#3a7bd5] text-white flex items-center justify-center font-bold text-4xl shadow-xl border-4 border-white">
                        {(candidate.fullName || 'Candidate').split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        {isEditing ? (
                          <div className="space-y-3 max-w-lg">
                            <div className="flex items-center gap-2">
                              <input className="os-input flex-1 !text-2xl !font-bold !h-12" value={editForm.fullName} onChange={e => setEditForm({ ...editForm, fullName: e.target.value })} placeholder="Full Name" />
                              <select className="os-input !h-12 !w-auto" value={editForm.category} onChange={e => setEditForm({ ...editForm, category: e.target.value })}>
                                <option value="Company">Company</option>
                                <option value="College">College</option>
                                <option value="External">External</option>
                              </select>
                            </div>
                            <input className="os-input w-full" value={editForm.preferredRole} onChange={e => setEditForm({ ...editForm, preferredRole: e.target.value })} placeholder="Role (e.g. Frontend Developer)" />
                            <div className="grid grid-cols-2 gap-3">
                              <input className="os-input w-full" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} placeholder="Email Address" />
                              <input className="os-input w-full" value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} placeholder="Phone Number" />
                              <input className="os-input w-full col-span-2" value={editForm.location} onChange={e => setEditForm({ ...editForm, location: e.target.value })} placeholder="Location" />
                            </div>
                            <div className="flex items-center gap-2 mt-4">
                              <button onClick={handleSaveEdit} disabled={savingEdit} className="os-btn-primary !h-9 !px-4 text-xs">{savingEdit ? 'Saving...' : 'Save Changes'}</button>
                              <button onClick={() => setIsEditing(false)} disabled={savingEdit} className="os-btn-outline !h-9 !px-4 text-xs !border-slate-200">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-3">
                              <h1 className="os-h1 !mb-0 !text-3xl">{candidate.fullName}</h1>
                              <div className="os-tag bg-[#eef3ff] text-[#1f4bc6] uppercase font-bold tracking-wider">{candidate.category || 'Company'}</div>
                            </div>
                            <p className="text-[#1f52cc] mt-1 font-bold text-lg">{candidate.preferredRole || 'Candidate'}</p>
                            <div className="flex flex-wrap gap-6 mt-4 text-sm text-[#5a6881]">
                              <div className="flex items-center gap-2"><span className="material-symbols-outlined text-[#1f52cc] text-base">mail</span>{candidate.email}</div>
                              <div className="flex items-center gap-2"><span className="material-symbols-outlined text-[#1f52cc] text-base">call</span>{candidate.phone}</div>
                              <div className="flex items-center gap-2"><span className="material-symbols-outlined text-[#1f52cc] text-base">location_on</span>{candidate.location || 'N/A'}</div>
                            </div>
                          </>
                        )}
                      </div>
                      
                      {!isEditing && canManageCandidate && (
                        <button onClick={() => setIsEditing(true)} className="ml-4 p-2 text-slate-400 hover:text-[#1f52cc] hover:bg-blue-50 rounded-lg transition-colors flex items-center justify-center">
                          <span className="material-symbols-outlined text-xl">edit_square</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </Reveal>

              <Reveal delay={0.05}>
                <div className="os-card p-6">
                  <h2 className="text-xl font-bold font-[Manrope] mb-6 flex items-center gap-2">
                    <span className="material-symbols-outlined text-blue-600">assessment</span>
                    Technical Assessments & Feedback
                  </h2>
                  <div className="space-y-6">
                    {interviews.length === 0 ? (
                      <div className="py-12 text-center bg-slate-50/50 rounded-3xl border-2 border-dashed border-slate-200">
                        <span className="material-symbols-outlined text-4xl text-slate-300">history_edu</span>
                        <p className="text-sm text-slate-400 mt-2">No assigned interview feedback yet.</p>
                      </div>
                    ) : (
                      interviews.map((iv, idx) => (
                        <InterviewItem 
                          key={iv.id} 
                          iv={iv} 
                          idx={idx} 
                          onUpdateLinks={handleUpdateLinks} 
                          onUploadRecording={handleUploadRecording} 
                          navigate={navigate}
                          currentUser={currentUser}
                        />
                      ))
                    )}
                  </div>
                </div>
              </Reveal>
            </div>

            <div className="space-y-6">
               <Reveal delay={0.1}>
                 <div className="os-card p-5 bg-[#1f52cc] text-white">
                   <h3 className="text-xs uppercase tracking-[.14em] font-bold mb-4 opacity-80">Quick Actions</h3>
                   <div className="grid grid-cols-1 gap-2">
                     <button className="flex items-center gap-3 w-full p-3 bg-white/10 hover:bg-white/20 rounded-xl transition-colors text-sm font-semibold" onClick={() => navigate('/schedule')}>
                       <span className="material-symbols-outlined">event</span> Schedule Round
                     </button>
                     {/* <button className="flex items-center gap-3 w-full p-3 bg-white/10 hover:bg-white/20 rounded-xl transition-colors text-sm font-semibold" onClick={() => navigate(`/pipeline?candidateId=${id}`)}>
                       <span className="material-symbols-outlined">send</span> Send Offer
                     </button> */}
                   </div>
                 </div>
               </Reveal>

               <Reveal delay={0.15}>
                 <div className="os-card p-5">
                   <h3 className="text-xs uppercase tracking-[.14em] font-bold mb-4 text-[#76839f]">Documentation</h3>
                   {candidate.resumeFile?.storageKey ? (
                     <div className="space-y-2">
                       <a 
                         href={candidate.resumeFile.storageKey} 
                         download={candidate.resumeFile.originalName || `${candidate.fullName}-resume`}
                         target="_blank"
                         rel="noreferrer"
                         className="os-btn-primary w-full !h-12 flex items-center justify-center gap-2 shadow-lg shadow-blue-100"
                       >
                         <span className="material-symbols-outlined">download</span>
                         Download Resume
                       </a>
                       <div className="text-[10px] text-slate-400 text-center truncate px-2">{candidate.resumeFile.originalName || 'Resume document'}</div>
                       {canManageCandidate && (
                         <label className="flex items-center justify-center gap-2 w-full h-9 rounded-xl border border-dashed border-slate-200 text-xs text-slate-400 cursor-pointer hover:border-[#1f52cc] hover:text-[#1f52cc] transition-all">
                           <span className="material-symbols-outlined text-sm">upload</span>
                           Replace Resume
                           <input type="file" className="hidden" accept=".pdf,.doc,.docx" onChange={e => e.target.files?.[0] && handleUploadResume(e.target.files[0])} />
                         </label>
                       )}
                     </div>
                   ) : (
                     <label className="flex flex-col items-center justify-center gap-2 w-full h-28 border-2 border-dashed border-slate-200 rounded-2xl cursor-pointer hover:border-[#1f52cc] hover:bg-blue-50/30 transition-all group">
                       <span className="material-symbols-outlined text-3xl text-slate-300 group-hover:text-[#1f52cc] transition-colors">upload_file</span>
                       <span className="text-xs text-slate-400 font-medium group-hover:text-[#1f52cc]">
                         {uploadingResume ? 'Uploading...' : 'Upload Resume'}
                       </span>
                       <span className="text-[10px] text-slate-300">PDF, DOC, DOCX</span>
                       <input type="file" className="hidden" accept=".pdf,.doc,.docx" disabled={uploadingResume} onChange={e => e.target.files?.[0] && handleUploadResume(e.target.files[0])} />
                     </label>
                   )}
                 </div>
               </Reveal>
            </div>
          </div>
        )}
      </PageEnter>
    </EnterpriseLayout>
  );
};

export default CandidateProfile;
