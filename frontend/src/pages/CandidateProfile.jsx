import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { API_BASE_URL, API_ROOT_URL, apiGet, apiPatch, getStoredUser } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';

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
  const [historyItems, setHistoryItems] = useState([]);
  const currentUser = getStoredUser();
  const canUploadResume = ['SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER'].includes(currentUser?.role);
  const canEditCustomFields = ['SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER'].includes(currentUser?.role);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const [candidateRes, definitionRes] = await Promise.all([
          apiGet(`/candidates/${id}`),
          apiGet('/candidates/custom-fields/definitions'),
        ]);
        if (!mounted) return;
        const loadedCandidate = candidateRes.data;
        setCandidate(loadedCandidate);
        setCustomDefinitions(definitionRes.data || []);

        const mappedValues = {};
        (loadedCandidate?.customFieldValues || []).forEach((item) => {
          const key = item?.fieldDefinition?.fieldKey;
          if (!key) return;
          mappedValues[key] = item.valueText || '';
        });
        setCustomValues(mappedValues);

        try {
          const historyRes = await apiGet(`/candidates/${id}/history`);
          setHistoryItems(historyRes?.data?.timeline || []);
        } catch (_) {
          setHistoryItems([]);
        }
      } catch (err) {
        if (!mounted) return;
        setError(err.message || 'Failed to load candidate details');
      }
    };

    if (id) load();
    return () => {
      mounted = false;
    };
  }, [id]);

  const uploadResume = async () => {
    if (!id || !resumeFile) {
      setError('Please select a resume file.');
      return;
    }

    setError('');
    setBanner('');
    try {
      setUploadingResume(true);
      const token = localStorage.getItem('ats_token');
      const formData = new FormData();
      formData.append('file', resumeFile);

      const res = await fetch(`${API_BASE_URL}/candidates/${id}/resume`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || 'Resume upload failed');
      }

      const refreshed = await apiGet(`/candidates/${id}`);
      setCandidate(refreshed.data);
      setBanner('Resume uploaded successfully.');
      setResumeFile(null);
    } catch (err) {
      setError(err.message || 'Failed to upload resume');
    } finally {
      setUploadingResume(false);
    }
  };

  const uploadPhoto = async () => {
    if (!id || !photoFile) return;
    setError('');
    const token = localStorage.getItem('ats_token');
    const formData = new FormData();
    formData.append('file', photoFile);

    try {
      setUploadingPhoto(true);
      const res = await fetch(`${API_BASE_URL}/candidates/${id}/photo`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Photo upload failed');

      const refreshed = await apiGet(`/candidates/${id}`);
      setCandidate(refreshed.data);
      setPhotoFile(null);
      setBanner('Profile photo updated.');
    } catch (err) {
      setError(err.message || 'Failed to upload photo');
    } finally {
      setUploadingPhoto(false);
    }
  };

  useEffect(() => {
    if (photoFile) uploadPhoto();
  }, [photoFile]);

  const saveCustomFields = async () => {
    if (!id) return;
    setError('');
    setBanner('');

    try {
      setSavingCustomFields(true);
      const res = await apiPatch(`/candidates/${id}/custom-fields`, {
        customFields: customValues,
      });
      setCandidate(res.data);
      setBanner('Custom fields updated successfully.');
    } catch (err) {
      setError(err.message || 'Failed to update custom fields');
    } finally {
      setSavingCustomFields(false);
    }
  };

  const skills = useMemo(() => {
    if (!candidate?.skills?.length) {
      return [
        { label: 'Communication', value: 86 },
        { label: 'Technical Depth', value: 90 },
      ];
    }

    return candidate.skills.map((s, idx) => ({
      label: s.skillName,
      value: s.proficiency || 70 + ((idx * 8) % 25),
    }));
  }, [candidate]);

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active="candidates" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
      topbar={
        <EnterpriseTopbar
          searchPlaceholder="Search candidate profile..."
          tabs={[
            { key: 'overview', label: 'Overview', href: `/candidate/${id}#overview`, active: true },
            { key: 'resume', label: 'Resume', href: `/candidate/${id}#resume` },
            { key: 'interviews', label: 'Interviews', href: `/candidate/${id}#interviews` },
            { key: 'notes', label: 'Notes', href: `/candidate/${id}#notes` },
          ]}
          right={
            <>
              <NotificationBell />
              <Link className="os-btn-outline" to="/candidates">Back to Search</Link>
              <UserChip fallbackName="Alex Rivera" fallbackRole="Recruiting Lead" avatarSeed="profile-user" />
            </>
          }
        />
      }
    >
      <PageEnter>
        {error ? <div className="os-card p-4 text-sm text-red-600">{error}</div> : null}
        {banner ? <div className="os-card p-4 text-sm text-[#2454cf] mt-2">{banner}</div> : null}
        {!candidate && !error ? <div className="os-card p-4 text-sm text-[#6f7d98]">Loading candidate...</div> : null}

        {candidate ? (
          <div className="grid lg:grid-cols-[1.7fr_.9fr] gap-4">
            <div className="space-y-4">
              <Reveal>
                <div className="os-card p-6" id="overview">
                  <div className="flex items-start gap-4">
                    <div className="relative group">
                      {candidate.profilePhotoFile?.storageKey ? (
                        <img className="w-20 h-20 rounded-2xl object-cover" src={candidate.profilePhotoFile.storageKey} alt={candidate.fullName} />
                      ) : (
                        <div className="w-20 h-20 rounded-2xl bg-[#1f52cc] text-white flex items-center justify-center font-bold text-2xl">
                          {candidate.fullName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                        </div>
                      )}
                      {canUploadResume ? (
                        <label className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl cursor-pointer">
                          <span className="material-symbols-outlined text-white">photo_camera</span>
                          <input type="file" className="hidden" accept="image/*" onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              setPhotoFile(file);
                              // We use a useEffect or a separate upload button. 
                              // Let's make it auto-upload for better UX.
                            }
                          }} />
                        </label>
                      ) : null}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h1 className="text-3xl font-bold font-[Manrope]">{candidate.fullName}</h1>
                          <p className="text-[#1f4bc6] text-lg mt-1">{candidate.currentCompany || 'Candidate'}</p>
                        </div>
                        <span className="px-3 py-1 rounded-full bg-[#d9e4ff] text-[#4560bd] text-[11px] uppercase tracking-[.12em] font-semibold">Verified Talent</span>
                      </div>
                      <div className="mt-4 text-sm text-[#5f6c88] flex flex-wrap gap-4">
                        <span>{candidate.email || '-'}</span>
                        <span>{candidate.phone || '-'}</span>
                        <span>{candidate.source || 'Direct'}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-5 border-t border-[#e6edf4] pt-5">
                    <div className="text-xs uppercase tracking-[.14em] font-semibold">Professional Summary</div>
                    <p className="mt-3 text-[#44516f] leading-relaxed">
                      Experienced profile with structured ATS data. Track interviews, feedback, and hiring decision from this card.
                    </p>
                  </div>
                </div>
              </Reveal>

              <Reveal delay={0.05}>
                <div className="os-card p-6" id="notes">
                  <h3 className="text-xs uppercase tracking-[.14em] font-semibold mb-5">Education</h3>
                  <div className="space-y-3 text-sm">
                    {(candidate.education?.length ? candidate.education : [{ institution: 'No education records yet', degree: '-' }]).map((edu, idx) => (
                      <div key={`${edu.institution}-${idx}`} className="border border-[#e8eef5] rounded-xl p-3">
                        <div className="font-semibold text-[#1d2b4f]">{edu.degree || '-'}</div>
                        <div className="text-[#6b7895] mt-1">{edu.institution || '-'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </Reveal>

              <Reveal delay={0.07}>
                <div className="os-card p-6">
                  <h3 className="text-xs uppercase tracking-[.14em] font-semibold mb-4">Candidate History</h3>
                  <div className="space-y-3">
                    {historyItems.length === 0 ? (
                      <div className="text-sm text-[#6f7d98]">No timeline events yet.</div>
                    ) : (
                      historyItems.slice(0, 14).map((item, idx) => (
                        <div key={`${item.type}-${item.at}-${idx}`} className="border border-[#e8eef5] rounded-xl p-3">
                          <div className="text-[11px] uppercase tracking-[.12em] text-[#6f7d98]">{item.type.replaceAll('_', ' ')}</div>
                          <div className="text-sm text-[#1d2b4f] mt-1">
                            {item.toStage?.name ? `Moved to ${item.toStage.name}` : null}
                            {item.recommendation ? `Feedback assessment: ${item.recommendation}` : null}
                            {item.job?.title ? `Job: ${item.job.title}` : null}
                            {!item.toStage?.name && !item.recommendation && !item.job?.title ? 'Candidate activity updated' : null}
                          </div>
                          {item.remark && (
                            <div className="text-xs text-[#5e6a85] bg-[#f8f9fb] p-2 mt-2 rounded-lg border border-[#e8ecf0] italic">
                              "{item.remark}"
                            </div>
                          )}
                          {item.feedback && (
                            <div className="text-xs text-[#5e6a85] mt-1 opacity-80">
                              Note: {item.feedback}
                            </div>
                          )}
                          <div className="text-xs text-[#7a86a0] mt-1">{new Date(item.at).toLocaleString()}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </Reveal>
            </div>

            <div className="space-y-4">
              <Reveal>
                <div className="os-card p-5" id="interviews">
                  <h3 className="text-xs uppercase tracking-[.14em] font-semibold mb-4">Core Expertise</h3>
                  <div className="space-y-4">
                    {skills.map((s) => (
                      <div key={s.label}>
                        <div className="flex justify-between text-sm mb-1"><span>{s.label}</span><span className="font-semibold text-[#1f4bc6]">{s.value}%</span></div>
                        <div className="h-1.5 rounded-full bg-[#e8edf4]"><div className="h-full rounded-full bg-[#1f4bc6]" style={{ width: `${Math.min(100, s.value)}%` }} /></div>
                      </div>
                    ))}
                  </div>
                </div>
              </Reveal>

              <Reveal delay={0.06}>
                <div className="os-card p-5">
                  <h3 className="text-xs uppercase tracking-[.14em] font-semibold">Candidate Fit</h3>
                  <div className="grid grid-cols-2 gap-3 mt-3 text-center">
                    <div><div className="text-2xl font-bold text-[#1f4bc6]">A</div><div className="text-[10px] uppercase tracking-[.12em] text-[#7a86a0]">Technical</div></div>
                    <div><div className="text-2xl font-bold text-[#1f4bc6]">91%</div><div className="text-[10px] uppercase tracking-[.12em] text-[#7a86a0]">Culture</div></div>
                  </div>
                </div>
              </Reveal>

              <Reveal delay={0.08}>
                <div className="os-card p-5">
                  <h3 className="text-xs uppercase tracking-[.14em] font-semibold mb-3">Actions</h3>
                  <div className="grid gap-2">
                    <button className="os-btn-primary" type="button" onClick={() => navigate('/schedule')}>
                      Schedule Interview
                    </button>
                    <button className="os-btn-outline" type="button" onClick={() => navigate(`/pipeline?candidateId=${id}`)}>
                      Send Offer
                    </button>
                    <button className="os-btn-outline" type="button" onClick={() => setBanner('Candidate marked for rejection review. Move stage in pipeline to finalize.')}>
                      Reject
                    </button>
                  </div>
                  <div className="mt-4 border-t border-[#e6edf4] pt-4" id="resume">
                    <div className="text-xs uppercase tracking-[.12em] text-[#76839f] mb-2">Resume</div>
                    {canUploadResume ? (
                      <>
                        <input className="os-file-input" type="file" accept=".pdf,.doc,.docx" onChange={(event) => setResumeFile(event.target.files?.[0] || null)} />
                        <button className="os-btn-outline w-full mt-2" type="button" onClick={uploadResume} disabled={uploadingResume}>
                          {uploadingResume ? 'Uploading...' : 'Upload Resume'}
                        </button>
                      </>
                    ) : (
                      <div className="text-xs text-[#7b88a3]">Read only for your role.</div>
                    )}
                    {candidate.resumeFile?.storageKey ? (
                      <a
                        className="text-sm text-[#1f4bc6] mt-2 inline-block"
                        href={candidate.resumeFile.storageKey?.startsWith('http')
                          ? candidate.resumeFile.storageKey
                          : `${API_ROOT_URL || ''}/uploads/${candidate.resumeFile.storageKey}`
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        View Current Resume: {candidate.resumeFile.originalName}
                      </a>
                    ) : null}
                  </div>
                </div>
              </Reveal>

              <Reveal delay={0.1}>
                <div className="os-card p-5">
                  <h3 className="text-xs uppercase tracking-[.14em] font-semibold mb-3">Custom Attributes</h3>
                  <div className="space-y-2">
                    {customDefinitions.length === 0 ? (
                      <div className="text-xs text-[#7b88a3]">No custom fields configured.</div>
                    ) : (
                      customDefinitions.map((definition) => (
                        <div key={definition.id}>
                          <label className="text-[11px] uppercase tracking-[.12em] text-[#7b86a0]">
                            {definition.fieldLabel}
                            {definition.isRequired ? ' *' : ''}
                          </label>
                          <input
                            className="mt-1 h-10 w-full rounded-lg border border-[#dbe4ee] px-3 text-sm"
                            value={customValues?.[definition.fieldKey] || ''}
                            onChange={(event) =>
                              setCustomValues((prev) => ({
                                ...prev,
                                [definition.fieldKey]: event.target.value,
                              }))
                            }
                            disabled={!canEditCustomFields}
                          />
                        </div>
                      ))
                    )}
                  </div>
                  {canEditCustomFields ? (
                    <button className="os-btn-outline w-full mt-3" type="button" onClick={saveCustomFields} disabled={savingCustomFields}>
                      {savingCustomFields ? 'Saving...' : 'Save Custom Attributes'}
                    </button>
                  ) : null}
                </div>
              </Reveal>
            </div>
          </div>
        ) : null}
      </PageEnter>
    </EnterpriseLayout>
  );
};

export default CandidateProfile;

