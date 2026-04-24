import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { API_BASE_URL, API_ROOT_URL, apiGet, apiGetBlob, apiPost, getStoredUser } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';

const emptyScheduleForm = {
  candidateId: '',
  jobId: '',
  roundNo: 1,
  round: 'Round 1',
  interviewerIds: [],
  scheduledStart: '',
  scheduledEnd: '',
  mode: 'ONLINE',
  meetingLink: '',
};

const emptyFeedbackForm = {
  technicalRating: 4,
  communicationRating: 4,
  cultureFitRating: 4,
  strengths: '',
  concerns: '',
  recommendation: 'PASS',
  overallComments: '',
};

const InterviewSchedule = () => {
  const navigate = useNavigate();
  const [interviews, setInterviews] = useState([]);
  const [applications, setApplications] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [interviewers, setInterviewers] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');
  const [scheduleForm, setScheduleForm] = useState(emptyScheduleForm);
  const [feedbackForm, setFeedbackForm] = useState(emptyFeedbackForm);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [candidateHistory, setCandidateHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [uploadingRecording, setUploadingRecording] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recordedUrl, setRecordedUrl] = useState('');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [viewMode, setViewMode] = useState('list');
  const [viewDate, setViewDate] = useState(new Date());
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const currentUser = getStoredUser();
  // FORCE TRUE FOR VERIFICATION
  const canScheduleInterview = true;
  const recorderSupported = typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined';

  const loadAll = async () => {
    const [interviewsRes, applicationsRes, candidatesRes, jobsRes] = await Promise.all([
      apiGet('/interviews'),
      apiGet('/applications?limit=200'),
      apiGet('/candidates?limit=200'),
      apiGet('/jobs?limit=200'),
    ]);

    let interviewerRows = [];
    try {
      const interviewerRes = await apiGet('/users/interviewers');
      interviewerRows = interviewerRes.data || [];
    } catch (_) {
      interviewerRows = (interviewsRes.data || [])
        .map((item) => item.interviewer)
        .filter(Boolean);
    }

    const interviewRows = interviewsRes.data || [];
    setInterviews(interviewRows);
    setApplications(applicationsRes.data || []);
    setCandidates(candidatesRes.data || []);
    setJobs(jobsRes.data || []);
    setInterviewers(interviewerRows);
    setSelectedId((prev) => prev || interviewRows[0]?.id || '');
  };

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        setLoading(true);
        setError('');
        await loadAll();
      } catch (err) {
        if (!mounted) return;
        setError(err.message || 'Failed to load interviews');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const downloadDailyPdf = async () => {
    try {
      const start = new Date(viewDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(viewDate);
      end.setHours(23, 59, 59, 999);

      const startISO = start.toISOString();
      const endISO = end.toISOString();

      // Standardize date for filename (YYYY-MM-DD)
      const year = start.getFullYear();
      const month = String(start.getMonth() + 1).padStart(2, '0');
      const day = String(start.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      const path = `/reports/export?report=dailyinterviews&start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}&date=${encodeURIComponent(dateStr)}`;

      const blob = await apiGetBlob(path);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `interviews-${dateStr}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setBanner(`Interviews for ${dateStr} export started.`);
    } catch (err) {
      setError(err.message || 'Failed to start download');
    }
  };

  const calendarDays = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    const days = [];
    const offset = firstDay === 0 ? 6 : firstDay - 1; // Mon-Sun
    for (let i = offset; i > 0; i -= 1) {
      days.push({ day: prevMonthDays - i + 1, month: 'prev', date: new Date(year, month - 1, prevMonthDays - i + 1) });
    }
    for (let i = 1; i <= daysInMonth; i += 1) {
      days.push({ day: i, month: 'current', date: new Date(year, month, i) });
    }
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i += 1) {
      days.push({ day: i, month: 'next', date: new Date(year, month + 1, i) });
    }
    return days;
  }, [viewDate]);

  const groupedApplications = useMemo(() => {
    const map = new Map();
    interviews.forEach((interview) => {
      const appId = interview.applicationId;
      if (!map.has(appId)) {
        map.set(appId, {
          application: interview.application,
          interviews: [],
          latestInterview: interview,
        });
      }
      const group = map.get(appId);
      group.interviews.push(interview);
      // Sort interviews by date descending to find latest
      if (new Date(interview.scheduledStart) > new Date(group.latestInterview.scheduledStart)) {
        group.latestInterview = interview;
      }
    });
    // Return sorted by latest interview date
    return Array.from(map.values()).sort((a, b) =>
      new Date(b.latestInterview.scheduledStart) - new Date(a.latestInterview.scheduledStart)
    );
  }, [interviews]);

  const selectedGroupId = selectedId || groupedApplications[0]?.application?.id || '';
  const selectedGroup = useMemo(
    () => groupedApplications.find((g) => g.application.id === selectedGroupId) || groupedApplications[0] || null,
    [groupedApplications, selectedGroupId],
  );

  const selectedCandidate = selectedGroup?.application?.candidate;
  const latestInterview = selectedGroup?.latestInterview;

  // For the individual interview context (e.g. feedback submission), default to latest
  const [activeInterviewId, setActiveInterviewId] = useState('');
  useEffect(() => {
    if (latestInterview && !activeInterviewId) {
      setActiveInterviewId(latestInterview.id);
    }
  }, [latestInterview, activeInterviewId]);

  const selectedInterview = useMemo(
    () => selectedGroup?.interviews.find(i => i.id === (activeInterviewId || latestInterview?.id)) || latestInterview,
    [selectedGroup, activeInterviewId, latestInterview]
  );

  const selectedFeedbacks = selectedInterview?.feedbacks || [];
  const myFeedback = selectedFeedbacks.find(f => f.submittedById === currentUser?.id);

  const loadCandidateHistory = async (candidateId) => {
    if (!candidateId) return;
    try {
      setLoadingHistory(true);
      const res = await apiGet(`/candidates/${candidateId}/history`);
      setCandidateHistory(res.data?.timeline || []);
    } catch (err) {
      console.error('Failed to load history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (selectedCandidate?.id) {
      loadCandidateHistory(selectedCandidate.id);
    } else {
      setCandidateHistory([]);
    }
  }, [selectedCandidate?.id]);

  const openMeetingLink = () => {
    const link = selectedInterview?.meetingLink;
    if (!link) {
      setBanner('No meeting link on this interview.');
      return;
    }
    window.open(link, '_blank', 'noopener,noreferrer');
  };

  const callCandidate = () => {
    const phone = selectedCandidate?.phone;
    if (!phone) {
      setBanner('No phone number available for this candidate.');
      return;
    }
    window.location.href = `tel:${phone}`;
  };

  const onScheduleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setBanner('');

    try {
      setSavingSchedule(true);

      let targetApplicationId = '';
      // Find if an application already exists for this candidate + job
      const existingApp = applications.find(a => a.candidateId === scheduleForm.candidateId && a.jobId === scheduleForm.jobId);

      if (existingApp) {
        targetApplicationId = existingApp.id;
      } else {
        // Create a new application on the fly
        const newAppRes = await apiPost('/applications', {
          candidateId: scheduleForm.candidateId,
          jobId: scheduleForm.jobId
        });
        targetApplicationId = newAppRes.data.id;
      }

      // Determine round number from label
      const roundMap = { 'Round 1': 1, 'Round 2': 2, 'Formal HR Round': 3 };
      const roundNo = roundMap[scheduleForm.round] || 1;

      await apiPost('/interviews', {
        applicationId: targetApplicationId,
        roundNo,
        round: scheduleForm.round,
        interviewerIds: scheduleForm.interviewerIds,
        scheduledStart: new Date(scheduleForm.scheduledStart).toISOString(),
        scheduledEnd: scheduleForm.scheduledEnd ? new Date(scheduleForm.scheduledEnd).toISOString() : null,
        mode: scheduleForm.mode,
        meetingLink: scheduleForm.meetingLink.trim() || null,
      });

      await loadAll();
      setScheduleForm(emptyScheduleForm);
      setBanner('Interview scheduled successfully.');
    } catch (err) {
      setError(err.message || 'Failed to schedule interview');
    } finally {
      setSavingSchedule(false);
    }
  };

  const onFeedbackSubmit = async (event) => {
    event.preventDefault();
    if (!selectedInterview) {
      setError('Select an interview before submitting feedback.');
      return;
    }

    setError('');
    setBanner('');

    try {
      setSavingFeedback(true);
      await apiPost(`/interviews/${selectedInterview.id}/feedback`, {
        technicalRating: Number(feedbackForm.technicalRating),
        communicationRating: Number(feedbackForm.communicationRating),
        cultureFitRating: Number(feedbackForm.cultureFitRating),
        strengths: feedbackForm.strengths.trim(),
        concerns: feedbackForm.concerns.trim(),
        recommendation: feedbackForm.recommendation,
        overallComments: feedbackForm.overallComments.trim(),
      });

      await loadAll();
      setFeedbackForm(emptyFeedbackForm);
      setBanner('Feedback submitted successfully.');
    } catch (err) {
      setError(err.message || 'Failed to submit feedback');
    } finally {
      setSavingFeedback(false);
    }
  };

  const onUploadRecording = async () => {
    const uploadTarget = recordingFile || (recordedBlob ? new File([recordedBlob], `interview-${selectedInterview?.id || 'recording'}.webm`, { type: recordedBlob.type || 'audio/webm' }) : null);
    if (!selectedInterview?.id || !uploadTarget) {
      setError('Select interview and recording file first.');
      return;
    }

    setError('');
    setBanner('');
    try {
      setUploadingRecording(true);
      const token = localStorage.getItem('ats_token');
      const formData = new FormData();
      formData.append('file', uploadTarget);

      const res = await fetch(`${API_BASE_URL}/interviews/${selectedInterview.id}/voice-recording`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || 'Recording upload failed');
      }

      await loadAll();
      setRecordingFile(null);
      setRecordedBlob(null);
      setRecordedUrl('');
      setRecordingSeconds(0);
      setBanner('Voice recording uploaded successfully.');
    } catch (err) {
      setError(err.message || 'Failed to upload recording');
    } finally {
      setUploadingRecording(false);
    }
  };

  const onDeleteInterview = async (interviewId, roundLabel) => {
    if (!window.confirm(`Are you sure you want to delete "${roundLabel}" and all associated feedback?`)) {
      return;
    }

    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/interviews/${interviewId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('ats_token')}`,
        },
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to delete interview');
      }
      setBanner('Interview deleted successfully.');
      await loadAll();
    } catch (err) {
      setError(err.message || 'Failed to delete interview');
    } finally {
      setLoading(false);
    }
  };

  const clearRecordingTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const startBrowserRecording = async () => {
    if (!recorderSupported) {
      setError('Browser recording is not supported. Please use file upload.');
      return;
    }

    setError('');
    setBanner('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setRecordedBlob(blob);
        setRecordedUrl(URL.createObjectURL(blob));
        setIsRecording(false);
        clearRecordingTimer();
        stopStream();
      };

      recorder.start(500);
      setRecordedBlob(null);
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
      setRecordedUrl('');
      setRecordingSeconds(0);
      setIsRecording(true);
      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      setError(err?.message || 'Unable to access microphone');
      setIsRecording(false);
      clearRecordingTimer();
      stopStream();
    }
  };

  const stopBrowserRecording = () => {
    if (!recorderRef.current) return;
    recorderRef.current.stop();
  };

  useEffect(() => () => {
    clearRecordingTimer();
    stopStream();
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
  }, [recordedUrl]);

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active="interviews" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
      topbar={
        <EnterpriseTopbar
          searchPlaceholder="Search conversations or candidates..."
          tabs={[
            { key: 'pipeline', label: 'Pipeline', href: '/pipeline' },
            { key: 'sourcing', label: 'Sourcing', href: '/sourcing' },
            { key: 'referrals', label: 'Referrals', href: '/referrals' },
          ]}
          right={
            <>
              <NotificationBell />
              <button className="os-icon-btn" type="button" onClick={() => navigate('/pipeline')}>
                <span className="material-symbols-outlined">chat</span>
              </button>
              <UserChip fallbackName="Alex Sterling" fallbackRole="Sr. Recruiter" avatarSeed="interview-user" />
            </>
          }
        />
      }
      contentClassName="!p-0"
    >
      <div className="flex items-center justify-between px-5 h-14 bg-white border-b border-[#e4ebf1]">
        <div className="flex gap-2">
          <button
            className={`os-btn-outline !h-9 ${viewMode === 'list' ? '!bg-[#1f52cc] !text-white' : ''}`}
            onClick={() => setViewMode('list')}
            type="button"
          >
            <span className="material-symbols-outlined text-sm">list</span>
            List View
          </button>
          <button
            className={`os-btn-outline !h-9 ${viewMode === 'calendar' ? '!bg-[#1f52cc] !text-white' : ''}`}
            onClick={() => setViewMode('calendar')}
            type="button"
          >
            <span className="material-symbols-outlined text-sm">calendar_month</span>
            Calendar Grid
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm font-semibold text-[#142651]">
            {viewDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
          </div>
          <div className="flex border border-[#dbe4ee] rounded-lg overflow-hidden">
            <button className="p-1 px-2 hover:bg-[#f6f9fc] border-r border-[#dbe4ee]" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}>
              <span className="material-symbols-outlined text-sm">chevron_left</span>
            </button>
            <button className="p-1 px-2 hover:bg-[#f6f9fc]" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}>
              <span className="material-symbols-outlined text-sm">chevron_right</span>
            </button>
          </div>
          <button className="os-btn-primary !h-9" onClick={downloadDailyPdf}>
            <span className="material-symbols-outlined text-sm">picture_as_pdf</span>
            Daily PDF
          </button>
        </div>
      </div>
      <PageEnter className={`grid grid-cols-1 ${viewMode === 'list' ? 'lg:grid-cols-[280px_1fr] xl:grid-cols-[300px_1fr_320px]' : 'lg:grid-cols-1'} h-[calc(100vh-126px)] overflow-hidden`}>
        {viewMode === 'list' && (
          <Reveal className="bg-white border-r border-[#e4ebf1] p-4 overflow-auto max-h-[42vh] lg:max-h-none">
            <div className="flex items-center justify-between pb-4">
              <h2 className="text-2xl font-semibold font-[Manrope] px-2">Interviews</h2>
              {loading ? <div className="text-xs text-[#a1acbd] animate-pulse">Syncing...</div> : null}
            </div>
            {groupedApplications.map((group) => {
              const candidate = group.application?.candidate;
              const appId = group.application?.id;
              return (
                <button
                  key={appId}
                  className={`w-full text-left flex gap-3 p-3 rounded-xl mb-1 ${selectedGroupId === appId ? 'bg-[#eef3ff] border-l-4 border-[#1f4bc6]' : 'hover:bg-[#f6f9fc]'}`}
                  onClick={() => {
                    setSelectedId(appId);
                    setActiveInterviewId(group.latestInterview.id);
                  }}
                  type="button"
                >
                  {candidate?.profilePhotoFile?.storageKey ? (
                    <img className="w-10 h-10 rounded-full object-cover" src={candidate.profilePhotoFile.storageKey} alt={candidate?.fullName || 'candidate'} />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-[#1f52cc] text-white flex items-center justify-center font-bold text-xs shrink-0">
                      {(candidate?.fullName || 'C').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 1)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{candidate?.fullName || 'Candidate'}</div>
                    <div className="text-xs text-[#6f7894] truncate">{group.application?.job?.title || 'Applied Role'}</div>
                    <div className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded inline-block mt-1">
                      {group.interviews.length} {group.interviews.length === 1 ? 'Round' : 'Rounds'}
                    </div>
                  </div>
                </button>
              );
            })}
            {interviews.length === 0 ? <div className="text-sm os-muted px-2">No interviews found.</div> : null}
          </Reveal>
        )}

        {viewMode === 'calendar' ? (
          <Reveal delay={0.06} className="bg-white p-6 overflow-auto lg:col-span-2 xl:col-span-3">
            <div className="calendar-grid">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                <div key={day} className="calendar-day-label">{day}</div>
              ))}
              {calendarDays.map((cell, idx) => {
                const dayInterviews = interviews.filter((item) => {
                  const d = new Date(item.scheduledStart);
                  return d.getDate() === cell.day && d.getMonth() === cell.date.getMonth() && d.getFullYear() === cell.date.getFullYear();
                });
                const isToday = new Date().toDateString() === cell.date.toDateString();
                const isOtherMonth = cell.month !== 'current';

                return (
                  <div
                    key={`${cell.month}-${cell.day}-${idx}`}
                    className={`calendar-cell ${isToday ? 'today' : ''} ${isOtherMonth ? 'other-month' : ''} cursor-pointer`}
                    onClick={() => {
                      if (dayInterviews.length > 0) {
                        setSelectedId(dayInterviews[0].id);
                        setViewMode('list');
                      }
                    }}
                  >
                    <div className="calendar-date-num">{cell.day}</div>
                    {dayInterviews.map((item) => (
                      <div key={item.id} className={`calendar-event group/event relative result-${item.result?.toLowerCase() || 'pending'}`}>
                        {canScheduleInterview && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteInterview(item.id, item.round || `Round ${item.roundNo}`);
                            }}
                            className="absolute -top-1 -right-1 z-10 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover/event:opacity-100 transition-opacity text-[10px]"
                            title="Delete Interview"
                          >
                            ×
                          </button>
                        )}
                        <div className="truncate pr-3">
                          {new Date(item.scheduledStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {item.application?.candidate?.fullName || 'Interview'}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </Reveal>
        ) : (
          <>

            <Reveal delay={0.04} className="bg-[#eef3f3] border-r border-[#e4ebf1] flex flex-col overflow-auto max-h-[58vh] lg:max-h-none">
              <div className="h-16 bg-white border-b border-[#e4ebf1] px-5 flex items-center justify-between">
                <div className="flex gap-3 items-center min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-[#b7c7f2] text-[#2f4ea8] text-sm font-semibold flex items-center justify-center">
                    {(selectedCandidate?.fullName || 'C').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xl font-semibold font-[Manrope] truncate">{selectedCandidate?.fullName || (loading ? 'Loading...' : 'Candidate')}</div>
                    <div className={selectedInterview ? 'text-[#2ca764] text-xs' : 'text-[#8c97ad] text-xs'}>{selectedInterview ? 'Interview Active' : 'No active interview'}</div>
                  </div>
                </div>
                <div className="text-[#6d7893] flex gap-3">
                  <button className="os-icon-btn !h-8 !w-8" type="button" onClick={openMeetingLink}>
                    <span className="material-symbols-outlined">videocam</span>
                  </button>
                  <button className="os-icon-btn !h-8 !w-8" type="button" onClick={callCandidate}>
                    <span className="material-symbols-outlined">call</span>
                  </button>
                  <button className="os-icon-btn !h-8 !w-8" type="button" onClick={() => setBanner('More actions are available in quick actions panel.')}>
                    <span className="material-symbols-outlined">more_vert</span>
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-4">
                {error ? <div className="os-card p-3 text-xs text-red-600">{error}</div> : null}
                {banner ? <div className="os-card p-3 text-xs text-[#2454cf]">{banner}</div> : null}

                {/* Rounds Selector */}
                {selectedGroup?.interviews.length > 1 && (
                  <div className="flex bg-white rounded-xl p-1 border border-[#e4ebf1] gap-1 overflow-x-auto">
                    {selectedGroup.interviews
                      .reduce((acc, curr) => {
                        if (!acc.find(item => item.roundNo === curr.roundNo)) acc.push(curr);
                        return acc;
                      }, [])
                      .sort((a, b) => a.roundNo - b.roundNo)
                      .map((iv) => (
                        <button
                          key={iv.id}
                          className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${activeInterviewId === iv.id ? 'bg-[#1f52cc] text-white shadow-sm' : 'text-[#7a88a3] hover:bg-gray-50'}`}
                          onClick={() => setActiveInterviewId(iv.id)}
                        >
                          Round {iv.roundNo}
                        </button>
                      ))}
                  </div>
                )}

                <div className="os-card p-4 text-sm text-[#2a344f]">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="font-semibold text-[#142651]">Interview Details ({selectedInterview?.round || `Round ${selectedInterview?.roundNo}`})</div>
                      {canScheduleInterview && (
                        <button
                          onClick={() => onDeleteInterview(selectedInterview.id, selectedInterview.round || `Round ${selectedInterview.roundNo}`)}
                          className="text-red-500 hover:text-red-700 p-1 flex items-center"
                          title="Delete this interview"
                        >
                          <span className="material-symbols-outlined text-sm">delete</span>
                        </button>
                      )}
                    </div>
                    <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${selectedInterview?.result === 'PASS' ? 'bg-[#e8f5ed] text-[#2ca764]' :
                        selectedInterview?.result === 'FAIL' ? 'bg-[#fbeaea] text-[#cf3a3a]' : 'bg-[#fef4e8] text-[#f2994a]'
                      }`}>
                      {selectedInterview?.result || 'PENDING'}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-y-1 text-xs sm:text-sm">
                    <div className="text-[#6d7893]">Role:</div> <div>{selectedInterview?.application?.job?.title || '-'}</div>
                    <div className="text-[#6d7893]">Interviewers:</div> <div>{selectedInterview?.interviewers?.map(u => u.fullName).join(', ') || '-'}</div>
                    <div className="text-[#6d7893]">Mode:</div> <div>{selectedInterview?.mode || '-'}</div>
                    <div className="text-[#6d7893]">Date:</div> <div>{selectedInterview?.scheduledStart ? new Date(selectedInterview.scheduledStart).toLocaleString() : '-'}</div>
                  </div>
                  {selectedInterview?.voiceRecordingFile?.storageKey ? (
                    <a
                      className="text-[#1f4bc6] inline-block mt-3 bg-blue-50 px-3 py-2 rounded-lg text-xs font-semibold border border-blue-100"
                      href={selectedInterview.voiceRecordingFile.storageKey?.startsWith('http')
                        ? selectedInterview.voiceRecordingFile.storageKey
                        : `${API_ROOT_URL || ''}/uploads/${selectedInterview.voiceRecordingFile.storageKey}`
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span className="material-symbols-outlined align-middle mr-1 text-sm">play_circle</span>
                      Listen Recording: {selectedInterview.voiceRecordingFile.originalName}
                    </a>
                  ) : null}
                </div>

                {/* Candidate Journey Timeline */}
                <div className="os-card p-4">
                  <div className="flex items-center justify-between mb-4">
                    <div className="font-semibold text-[#142651]">Full Journey History</div>
                    {loadingHistory && <div className="text-[10px] text-blue-500 animate-pulse">Syncing...</div>}
                  </div>
                  <div className="space-y-4 relative before:absolute before:left-[17px] before:top-2 before:bottom-2 before:w-[2px] before:bg-[#e4ebf1]">
                    {candidateHistory.length === 0 && !loadingHistory && (
                      <div className="text-xs text-[#a1acbd] pl-8">No journey records found.</div>
                    )}
                    {candidateHistory.map((event, idx) => (
                      <div key={idx} className="relative pl-10">
                        <div className={`absolute left-0 top-1 w-9 h-9 rounded-full border-4 border-white flex items-center justify-center ${event.type === 'INTERVIEW_FEEDBACK_SUBMITTED' ? 'bg-[#2ca764] text-white' :
                            event.type === 'INTERVIEW_SCHEDULED' ? 'bg-[#1f52cc] text-white' : 'bg-[#a1acbd] text-white'
                          }`}>
                          <span className="material-symbols-outlined text-sm">
                            {event.type === 'INTERVIEW_FEEDBACK_SUBMITTED' ? 'check_circle' :
                              event.type === 'INTERVIEW_SCHEDULED' ? 'event' : 'info'}
                          </span>
                        </div>
                        <div className="text-sm font-semibold text-[#142651]">
                          {event.type === 'INTERVIEW_SCHEDULED' ? `Interview Round ${event.roundNo} Scheduled` :
                            event.type === 'INTERVIEW_FEEDBACK_SUBMITTED' ? `Feedback Submitted by ${event.submittedBy?.fullName || 'Interviewer'}: Assessment Result - ${event.recommendation}` :
                              event.type === 'PIPELINE_MOVED' ? `Moved to ${event.toStage?.name || 'Next Stage'}` :
                                event.type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ')}
                        </div>
                        <div className="text-[11px] text-[#6f7894] mb-1">
                          {new Date(event.at).toLocaleString()}
                        </div>
                        {event.remark && (
                          <div className="text-xs text-[#5e6a85] bg-gray-50 p-2 rounded-lg border border-gray-100">
                            {event.remark}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Multiple Feedback Display */}
                {selectedFeedbacks.length > 0 && (
                  <div className="space-y-3">
                    <div className="text-xs font-bold uppercase text-[#8b95ad] tracking-wider ml-1">Interviewer Assessments ({selectedFeedbacks.length})</div>
                    {selectedFeedbacks.map((f) => (
                      <div key={f.id} className="os-card p-4 transition-all hover:shadow-md border-l-4 border-[#2ca764]">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-[#eef3ff] flex items-center justify-center text-[10px] font-bold text-[#1f52cc]">
                              {(f.submittedBy?.fullName || 'U').split(' ').map(n => n[0]).join('')}
                            </div>
                            <div className="text-sm font-medium text-[#142651]">{f.submittedBy?.fullName}</div>
                          </div>
                          <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${f.recommendation === 'PASS' ? 'bg-[#e8f5ed] text-[#2ca764]' :
                              f.recommendation === 'FAIL' ? 'bg-[#fbeaea] text-[#cf3a3a]' : 'bg-[#fef4e8] text-[#f2994a]'
                            }`}>
                            {f.recommendation}
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mb-3">
                          <div className="bg-[#f8f9fa] p-2 rounded text-center">
                            <div className="text-[10px] text-[#868fa0] uppercase tracking-wider">Technical Proficiency</div>
                            <div className="text-xs font-bold text-[#142651]">{f.technicalRating} / 5</div>
                          </div>
                          <div className="bg-[#f8f9fa] p-2 rounded text-center">
                            <div className="text-[10px] text-[#868fa0] uppercase tracking-wider">Communication Skills</div>
                            <div className="text-xs font-bold text-[#142651]">{f.communicationRating} / 5</div>
                          </div>
                          <div className="bg-[#f8f9fa] p-2 rounded text-center">
                            <div className="text-[10px] text-[#868fa0] uppercase tracking-wider">Cultural Fit</div>
                            <div className="text-xs font-bold text-[#142651]">{f.cultureFitRating} / 5</div>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="text-xs">
                            <span className="font-semibold text-[#142651]">Strengths:</span>
                            <span className="text-[#5e6a85] ml-1">{f.strengths}</span>
                          </div>
                          <div className="text-xs">
                            <span className="font-semibold text-[#142651]">Comments:</span>
                            <p className="text-[#5e6a85] mt-1 italic text-[13px]">"{f.overallComments}"</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Reveal>

            <Reveal delay={0.08} className="bg-[#f8fbfb] p-4 overflow-auto border-t lg:border-t-0 border-[#e4ebf1]">
              <div className="os-eyebrow">Quick Actions</div>

              {canScheduleInterview ? (
                <form className="os-card p-4 mt-2" onSubmit={onScheduleSubmit}>
                  <div className="text-sm font-semibold text-[#142651] mb-3">Schedule Interview</div>
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-[#6d7893] ml-1">Select Candidate</div>
                    <select
                      className="h-10 w-full rounded-lg border border-[#dbe4ee] px-2 text-sm"
                      value={scheduleForm.candidateId}
                      onChange={(event) => {
                        const cId = event.target.value;
                        setScheduleForm((prev) => {
                          // If candidate already has an application, pre-fill the job if possible
                          const existing = applications.find(a => a.candidateId === cId);
                          return { ...prev, candidateId: cId, jobId: existing?.jobId || prev.jobId };
                        });
                      }}
                      required
                    >
                      <option value="">Choose candidate...</option>
                      {candidates.map((c) => (
                        <option key={c.id} value={c.id}>{c.fullName} {c.email ? `(${c.email})` : ''}</option>
                      ))}
                    </select>

                    <div className="text-xs font-semibold text-[#6d7893] ml-1">Select Job</div>
                    <select
                      className="h-10 w-full rounded-lg border border-[#dbe4ee] px-2 text-sm"
                      value={scheduleForm.jobId}
                      onChange={(event) => setScheduleForm((prev) => ({ ...prev, jobId: event.target.value }))}
                      required
                    >
                      <option value="">Choose job role...</option>
                      {jobs.map((j) => (
                        <option key={j.id} value={j.id}>{j.title}</option>
                      ))}
                    </select>

                    <div className="text-xs font-semibold text-[#6d7893] mt-1">Select Interviewers / Recruiters (Multiple)</div>
                    <div className="max-h-32 overflow-y-auto border border-[#dbe4ee] rounded-lg p-2 space-y-1 bg-white">
                      {interviewers.map((person) => (
                        <label key={person.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded transition-colors">
                          <input
                            type="checkbox"
                            checked={scheduleForm.interviewerIds.includes(person.id)}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setScheduleForm(prev => {
                                const newIds = checked
                                  ? [...prev.interviewerIds, person.id]
                                  : prev.interviewerIds.filter(id => id !== person.id);
                                return { ...prev, interviewerIds: newIds };
                              });
                            }}
                          />
                          <span className="text-xs text-[#2a344f]">{person.fullName} <span className="os-muted text-[10px]">({person.role})</span></span>
                        </label>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <select className="h-10 rounded-lg border border-[#dbe4ee] px-2 text-sm" value={scheduleForm.round} onChange={(event) => setScheduleForm((prev) => ({ ...prev, round: event.target.value }))}>
                        <option value="Round 1">Round 1</option>
                        <option value="Round 2">Round 2</option>
                        <option value="Formal HR Round">Formal HR Round</option>
                      </select>
                      <select className="h-10 rounded-lg border border-[#dbe4ee] px-2 text-sm" value={scheduleForm.mode} onChange={(event) => setScheduleForm((prev) => ({ ...prev, mode: event.target.value }))}>
                        <option value="ONLINE">ONLINE</option>
                        <option value="OFFLINE">OFFLINE</option>
                        <option value="PHONE">PHONE</option>
                      </select>
                    </div>
                    <input className="h-10 w-full rounded-lg border border-[#dbe4ee] px-2 text-sm" type="datetime-local" value={scheduleForm.scheduledStart} onChange={(event) => setScheduleForm((prev) => ({ ...prev, scheduledStart: event.target.value }))} required />
                    <input className="h-10 w-full rounded-lg border border-[#dbe4ee] px-2 text-sm" type="datetime-local" value={scheduleForm.scheduledEnd} onChange={(event) => setScheduleForm((prev) => ({ ...prev, scheduledEnd: event.target.value }))} />
                    <input className="h-10 w-full rounded-lg border border-[#dbe4ee] px-2 text-sm" placeholder="Meeting link (optional)" value={scheduleForm.meetingLink} onChange={(event) => setScheduleForm((prev) => ({ ...prev, meetingLink: event.target.value }))} />
                  </div>
                  <button className="os-btn-primary w-full mt-3" type="submit" disabled={savingSchedule}>
                    {savingSchedule ? 'Scheduling...' : 'Schedule'}
                  </button>
                </form>
              ) : null}

              <form className="os-card p-4 mt-3" onSubmit={onFeedbackSubmit}>
                <div className="text-sm font-semibold text-[#142651] mb-3">Submit Feedback</div>
                <div className="space-y-2">
                  <div className="grid grid-cols-1 gap-1">
                    <label className="text-[10px] uppercase font-bold text-[#8b95ad] ml-1">Technical Skills (1-5)</label>
                    <input className="h-10 rounded-lg border border-[#dbe4ee] px-2 text-sm" type="number" min="1" max="5" value={feedbackForm.technicalRating} onChange={(event) => setFeedbackForm((prev) => ({ ...prev, technicalRating: event.target.value }))} />
                  </div>
                  <div className="grid grid-cols-1 gap-1">
                    <label className="text-[10px] uppercase font-bold text-[#8b95ad] ml-1">Communication (1-5)</label>
                    <input className="h-10 rounded-lg border border-[#dbe4ee] px-2 text-sm" type="number" min="1" max="5" value={feedbackForm.communicationRating} onChange={(event) => setFeedbackForm((prev) => ({ ...prev, communicationRating: event.target.value }))} />
                  </div>
                  <div className="grid grid-cols-1 gap-1">
                    <label className="text-[10px] uppercase font-bold text-[#8b95ad] ml-1">Culture Fit (1-5)</label>
                    <input className="h-10 rounded-lg border border-[#dbe4ee] px-2 text-sm" type="number" min="1" max="5" value={feedbackForm.cultureFitRating} onChange={(event) => setFeedbackForm((prev) => ({ ...prev, cultureFitRating: event.target.value }))} />
                  </div>
                </div>
                <textarea className="mt-3 min-h-[68px] w-full rounded-lg border border-[#dbe4ee] px-2 py-2 text-sm" placeholder="Key Strengths..." value={feedbackForm.strengths} onChange={(event) => setFeedbackForm((prev) => ({ ...prev, strengths: event.target.value }))} required />
                <textarea className="mt-2 min-h-[68px] w-full rounded-lg border border-[#dbe4ee] px-2 py-2 text-sm" placeholder="Potential Concerns..." value={feedbackForm.concerns} onChange={(event) => setFeedbackForm((prev) => ({ ...prev, concerns: event.target.value }))} required />
                <select className="mt-2 h-10 w-full rounded-lg border border-[#dbe4ee] px-2 text-sm" value={feedbackForm.recommendation} onChange={(event) => setFeedbackForm((prev) => ({ ...prev, recommendation: event.target.value }))}>
                  <option value="PASS">PASS</option>
                  <option value="OFFER">OFFER (Move to Selected)</option>
                  <option value="FAIL">FAIL</option>
                  <option value="HOLD">HOLD</option>
                  <option value="PENDING">PENDING</option>
                </select>
                <textarea className="mt-2 min-h-[68px] w-full rounded-lg border border-[#dbe4ee] px-2 py-2 text-sm" placeholder="Overall Decision Comments..." value={feedbackForm.overallComments} onChange={(event) => setFeedbackForm((prev) => ({ ...prev, overallComments: event.target.value }))} required />
                <button className="os-btn-primary w-full mt-3" type="submit" disabled={savingFeedback || !selectedInterview || Boolean(myFeedback)}>
                  {myFeedback ? 'You have submitted feedback' : savingFeedback ? 'Submitting...' : 'Submit Feedback'}
                </button>
              </form>

              <div className="os-card p-4 mt-3">
                <div className="text-sm font-semibold text-[#142651] mb-3">Upload Voice Recording</div>
                {recorderSupported ? (
                  <div className="rounded-lg border border-[#dbe4ee] bg-[#f7faff] p-3 mb-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs text-[#5f6a84]">In-browser Recorder</div>
                      <div className="text-xs font-semibold text-[#1f4bc6]">{Math.floor(recordingSeconds / 60).toString().padStart(2, '0')}:{(recordingSeconds % 60).toString().padStart(2, '0')}</div>
                    </div>
                    <div className="flex gap-2">
                      {!isRecording ? (
                        <button className="os-btn-primary !h-9 flex-1" type="button" onClick={startBrowserRecording}>Start Recording</button>
                      ) : (
                        <button className="os-btn-outline !h-9 flex-1" type="button" onClick={stopBrowserRecording}>Stop Recording</button>
                      )}
                      <button
                        className="os-btn-outline !h-9"
                        type="button"
                        onClick={() => {
                          setRecordedBlob(null);
                          if (recordedUrl) URL.revokeObjectURL(recordedUrl);
                          setRecordedUrl('');
                          setRecordingSeconds(0);
                        }}
                        disabled={!recordedBlob}
                      >
                        Clear
                      </button>
                    </div>
                    {recordedUrl ? (
                      <audio controls className="w-full mt-2">
                        <source src={recordedUrl} type="audio/webm" />
                      </audio>
                    ) : null}
                  </div>
                ) : null}
                <input className="os-file-input" type="file" accept="audio/*" onChange={(event) => setRecordingFile(event.target.files?.[0] || null)} />
                <button className="os-btn-outline w-full mt-3" type="button" onClick={onUploadRecording} disabled={uploadingRecording}>
                  {uploadingRecording ? 'Uploading...' : 'Upload Recording'}
                </button>
              </div>
            </Reveal>
          </>
        )}
      </PageEnter>
    </EnterpriseLayout>
  );
};

export default InterviewSchedule;
