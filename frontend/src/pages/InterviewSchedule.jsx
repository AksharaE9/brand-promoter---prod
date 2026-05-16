import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { API_BASE_URL, API_ROOT_URL, apiGet, apiGetBlob, apiPost, getStoredUser } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';
import EditInterviewModal from '../components/Interview/EditInterviewModal';

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
  zohoLink: '',
};

const emptyFeedbackForm = {
  technicalRating: 4,
  communicationRating: 4,
  cultureFitRating: 4,
  strengths: '',
  weaknesses: '',
  recommendation: 'SELECTED',
  overallComments: '',
};

const InterviewSchedule = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const jobIdParam = searchParams.get('jobId');
  const interviewIdParam = searchParams.get('interviewId');
  const shouldSubmitFeedback = searchParams.get('submitFeedback') === 'true';
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
  const [offerLetterFile, setOfferLetterFile] = useState(null);
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [candidateHistory, setCandidateHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [uploadingRecording, setUploadingRecording] = useState(false);
  const [recordingFile, setRecordingFile] = useState(null);
  const [scheduleRecordingFile, setScheduleRecordingFile] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recordedUrl, setRecordedUrl] = useState('');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [viewMode, setViewMode] = useState('list');
  const [joiningDate, setJoiningDate] = useState('');
  const [showJoiningConfirm, setShowJoiningConfirm] = useState(false);
  const [viewDate, setViewDate] = useState(new Date());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(null);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [calendarData, setCalendarData] = useState({}); // New: Pre-calculated calendar data
  const [candidateSearch, setCandidateSearch] = useState('');
  const [jobSearch, setJobSearch] = useState('');
  const [interviewerSearch, setInterviewerSearch] = useState('');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferringInterview, setTransferringInterview] = useState(null);
  const [editingInterviewId, setEditingInterviewId] = useState(null);
  const [showCandidateList, setShowCandidateList] = useState(false);
  const [showJobList, setShowJobList] = useState(false);
  const currentUser = getStoredUser();
  const [interviewListSearch, setInterviewListSearch] = useState('');
  const [filterMine, setFilterMine] = useState(currentUser?.role === 'INTERVIEWER');
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  // FORCE TRUE FOR VERIFICATION
  const canScheduleInterview = true;
  const recorderSupported = typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined';

  const loadAll = async () => {
    const [interviewsRes, applicationsRes, candidatesRes, jobsRes] = await Promise.all([
      apiGet('/interviews?limit=10000'),
      apiGet('/applications?limit=10000'),
      apiGet('/candidates?limit=10000'),
      apiGet('/jobs?limit=10000'),
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
    
    // Fix: Ensure selectedId is a candidateId for grouping
    const firstGroup = Array.from(
      interviewsRes.data.reduce((map, iv) => {
        const cId = iv.application?.candidate?.id || iv.application?.candidateId;
        if (cId && !map.has(cId)) map.set(cId, iv);
        return map;
      }, new Map()).values()
    ).sort((a, b) => new Date(b.scheduledStart) - new Date(a.scheduledStart))[0];

    setSelectedId((prev) => prev || firstGroup?.applicationId || '');
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
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
  }, []);

  useEffect(() => {
    if (jobIdParam && jobs.length > 0) {
      const job = jobs.find(j => j.id === jobIdParam);
      if (job) setInterviewListSearch(job.title);
    }
  }, [jobIdParam, jobs]);

  // REAL-TIME UPDATE LISTENER
  useEffect(() => {
    const token = localStorage.getItem('ats_token');
    if (!token) return;

    // Use API base URL for SSE stream (with /api prefix)
    const eventSource = new EventSource(`${API_BASE_URL}/notifications/stream?token=${token}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'ping') return;
        
        // Refresh if any relevant event happens
        const relevantTypes = [
          'INTERVIEW_PANELISTS_UPDATED',
          'INTERVIEW_FEEDBACK_SUBMITTED',
          'APPLICATION_STATUS_UPDATED',
          'INTERVIEW_SCHEDULED',
          'CANDIDATE_UPDATED',
          'CANDIDATE_CREATED'
        ];

        if (relevantTypes.includes(data.type)) {
          console.log('[SSE] Real-time update received:', data.type);
          loadAll();
          if (data.type === 'INTERVIEW_PANELISTS_UPDATED') {
            setBanner('Interviewer transferred in real-time!');
          }
        }
      } catch (err) {
        console.error('[SSE] Failed to parse message:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('[SSE] Connection error:', err);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, []);

  useEffect(() => {
    if (interviewIdParam && interviews.length > 0) {
      const targetInterview = interviews.find(i => i.id === interviewIdParam);
      if (targetInterview) {
        setSelectedId(targetInterview.applicationId);
        setActiveInterviewId(targetInterview.id);
        // If it's a feedback link, we might want to scroll to the feedback form
        if (shouldSubmitFeedback) {
          setBanner('Submitting feedback for ' + targetInterview.application?.candidate?.fullName);
        }
      }
    }
  }, [interviewIdParam, interviews, shouldSubmitFeedback]);

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
    
    // If not strictly filtering by "My Interviews", show all candidates in the pool
    if (!filterMine) {
      candidates.forEach(candidate => {
        map.set(candidate.id, {
          candidateId: candidate.id,
          applicationId: candidate.applications?.[0]?.id || null,
          application: { ...(candidate.applications?.[0] || {}), candidate },
          interviews: [],
          latestInterview: null,
          createdAt: candidate.createdAt || 0
        });
      });
    }

    const filteredInterviews = filterMine 
      ? interviews.filter(iv => iv.interviewerIds?.includes(currentUser?.id))
      : interviews;

    filteredInterviews.forEach((interview) => {
      const cId = interview.application?.candidate?.id || interview.application?.candidateId;
      if (!cId) return;

      if (!map.has(cId)) {
        map.set(cId, {
          candidateId: cId,
          applicationId: interview.applicationId,
          application: interview.application,
          interviews: [],
          latestInterview: null,
          createdAt: 0
        });
      }
      const group = map.get(cId);
      group.interviews.push(interview);
      if (!group.latestInterview || new Date(interview.scheduledStart) > new Date(group.latestInterview.scheduledStart)) {
        group.latestInterview = interview;
        if (!group.application?.id) {
          group.application = interview.application;
          group.applicationId = interview.applicationId;
        }
      }
    });
    
    let results = Array.from(map.values());

    if (interviewListSearch) {
      const q = interviewListSearch.toLowerCase();
      results = results.filter(g => 
        g.application?.candidate?.fullName?.toLowerCase().includes(q) ||
        g.application?.job?.title?.toLowerCase().includes(q)
      );
    }

    return results.sort((a, b) => {
      const dateA = a.latestInterview?.scheduledStart || a.createdAt;
      const dateB = b.latestInterview?.scheduledStart || b.createdAt;
      return new Date(dateB) - new Date(dateA);
    });
  }, [interviews, candidates, filterMine, currentUser?.id, interviewListSearch]);

  // Optimization: Pre-calculate schedules per date to avoid filtering in render
  const scheduleData = useMemo(() => {
    const data = {};
    interviews.forEach(iv => {
      const dateKey = new Date(iv.scheduledStart).toDateString();
      if (!data[dateKey]) data[dateKey] = { interviews: [], joinings: [] };
      data[dateKey].interviews.push(iv);
    });
    applications.forEach(app => {
      if (app.doj) {
        const dateKey = new Date(app.doj).toDateString();
        if (!data[dateKey]) data[dateKey] = { interviews: [], joinings: [] };
        data[dateKey].joinings.push(app);
      }
    });
    return data;
  }, [interviews, applications]);

  const selectedGroupId = selectedId || groupedApplications[0]?.applicationId || '';
  const selectedGroup = useMemo(
    () => groupedApplications.find((g) => g.applicationId === selectedGroupId || g.candidateId === selectedGroupId) || groupedApplications[0] || null,
    [groupedApplications, selectedGroupId],
  );

  const selectedCandidate = selectedGroup?.application?.candidate;
  const latestInterview = selectedGroup?.latestInterview;

  // For the individual interview context (e.g. feedback submission), default to latest
  const [activeInterviewId, setActiveInterviewId] = useState('');
  useEffect(() => {
    if (latestInterview) {
      setActiveInterviewId(latestInterview.id);
    }
  }, [latestInterview]);

  const selectedInterview = useMemo(
    () => {
      const list = selectedGroup?.interviews || [];
      const filtered = filterMine ? list.filter(iv => iv.interviewerIds?.includes(currentUser?.id)) : list;
      return filtered.find(i => i.id === (activeInterviewId || latestInterview?.id)) || filtered[0] || latestInterview;
    },
    [selectedGroup, activeInterviewId, latestInterview, filterMine, currentUser?.id]
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

  const filteredCandidates = useMemo(() => {
    if (!candidateSearch) return candidates;
    return candidates.filter(c => 
      c.fullName.toLowerCase().includes(candidateSearch.toLowerCase()) || 
      c.email?.toLowerCase().includes(candidateSearch.toLowerCase())
    );
  }, [candidates, candidateSearch]);

  const filteredJobs = useMemo(() => {
    if (!jobSearch) return jobs;
    return jobs.filter(j => 
      j.title.toLowerCase().includes(jobSearch.toLowerCase())
    );
  }, [jobs, jobSearch]);

  // Auto-sync round number based on application history
  useEffect(() => {
    if (showScheduleModal && scheduleForm.candidateId && scheduleForm.jobId) {
       const app = applications.find(a => a.candidateId === scheduleForm.candidateId && a.jobId === scheduleForm.jobId);
       if (app) {
         const appInterviews = interviews.filter(iv => iv.applicationId === app.id);
         const nextRound = appInterviews.length + 1;
         if (scheduleForm.roundNo !== nextRound && scheduleForm.roundNo !== 99) { // 99 is Final
            setScheduleForm(prev => ({ 
              ...prev, 
              roundNo: nextRound,
              round: `Round ${nextRound}`
            }));
         }
       } else {
         // No application found (e.g. fresh candidate not in pipeline yet for this job)
         if (scheduleForm.roundNo !== 1 && scheduleForm.roundNo !== 99) {
            setScheduleForm(prev => ({ ...prev, roundNo: 1, round: 'Round 1' }));
         }
       }
    }
  }, [scheduleForm.candidateId, scheduleForm.jobId, showScheduleModal, applications, interviews]);

  const filteredInterviewersList = useMemo(() => {
    if (!interviewerSearch) return interviewers;
    return interviewers.filter(i => 
      i.fullName.toLowerCase().includes(interviewerSearch.toLowerCase()) || 
      i.role.toLowerCase().includes(interviewerSearch.toLowerCase())
    );
  }, [interviewers, interviewerSearch]);

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
      // Determine round number dynamically
      let roundNo = parseInt(scheduleForm.roundNo) || 1;
      if (scheduleForm.round === 'Final Round' || scheduleForm.round === 'Final') roundNo = 99;

      const createdInterview = await apiPost('/interviews', {
        applicationId: targetApplicationId,
        roundNo,
        round: scheduleForm.round,
        interviewerIds: scheduleForm.interviewerIds,
        scheduledStart: new Date(scheduleForm.scheduledStart).toISOString(),
        scheduledEnd: scheduleForm.scheduledEnd ? new Date(scheduleForm.scheduledEnd).toISOString() : null,
        mode: scheduleForm.mode,
        meetingLink: scheduleForm.meetingLink.trim() || null,
        zohoLink: scheduleForm.zohoLink.trim() || null,
      });

      // Handle optional recording file upload during scheduling
      if (scheduleRecordingFile && createdInterview.data?.id) {
        setUploadingRecording(true);
        const token = localStorage.getItem('ats_token');
        const formData = new FormData();
        formData.append('file', scheduleRecordingFile);

        await fetch(`${API_BASE_URL}/interviews/${createdInterview.data.id}/voice-recording`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        });
        setScheduleRecordingFile(null);
      }

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
      
      // CALL THE FEEDBACK API (Was missing!)
      const formData = new FormData();
      Object.keys(feedbackForm).forEach(key => {
        formData.append(key, feedbackForm[key]);
      });
      if (offerLetterFile) {
        formData.append('offerFile', offerLetterFile);
      }

      const res = await fetch(`${API_BASE_URL}/interviews/${selectedInterview.id}/feedback`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('ats_token')}`,
        },
        body: formData,
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Failed to submit feedback');

      // Update application status based on recommendation
      if (feedbackForm.recommendation === 'REJECTED') {
        await onUpdateStatus(selectedInterview.applicationId, 'REJECTED');
      } else if (feedbackForm.recommendation === 'OFFER_LETTER' || feedbackForm.recommendation === 'SELECTED' || feedbackForm.recommendation === 'OFFER_SENT') {
        await onUpdateStatus(selectedInterview.applicationId, 'OFFER_SENT');
      }

      setFeedbackForm(emptyFeedbackForm);
      setOfferLetterFile(null);
      setBanner('Feedback submitted successfully.');
      await loadAll();
    } catch (err) {
      setError(err.message || 'Failed to submit feedback');
    } finally {
      setSavingFeedback(false);
    }
  };

  const onUpdateStatus = async (applicationId, status) => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/applications/${applicationId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('ats_token')}`,
        },
        body: JSON.stringify({ status, joiningDate }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Failed to update status');
      setBanner(`Application status updated to ${status}.`);
      await loadAll();
    } catch (err) {
      setError(err.message || 'Failed to update application status');
    } finally {
      setLoading(false);
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

  const onTransferPanelist = async (interviewerId) => {
    if (!transferringInterview) return;
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/interviews/${transferringInterview.id}/panelists`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('ats_token')}`,
        },
        body: JSON.stringify({ interviewerIds: [interviewerId] }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Failed to transfer panelist');
      
      setBanner('Panelist transferred successfully.');
      setShowTransferModal(false);
      setTransferringInterview(null);
      await loadAll();
    } catch (err) {
      setError(err.message || 'Failed to transfer panelist');
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

  // Optimization: Pre-calculate calendar counts to avoid filtering in render loop
  useEffect(() => {
    const counts = {};
    interviews.forEach(item => {
      const d = new Date(item.scheduledStart);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!counts[key]) counts[key] = { r1: 0, r2: 0, pass: 0, doj: 0 };
      if (item.roundNo === 1) counts[key].r1++;
      if (item.roundNo === 2) counts[key].r2++;
      if (item.result === 'PASS') counts[key].pass++;
    });
    applications.forEach(app => {
      if (!app.doj) return;
      const d = new Date(app.doj);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!counts[key]) counts[key] = { r1: 0, r2: 0, pass: 0, doj: 0 };
      counts[key].doj++;
    });
    setCalendarData(counts);
  }, [interviews, applications]);

  const handleSelectDate = useCallback((date) => {
    setSelectedCalendarDate(date);
    setShowActivityModal(true);
  }, []);

  const CalendarCell = React.memo(({ date, isCurrentMonth, isToday, onSelectDate, data }) => {
    const { interviews: cellInterviews = [], joinings: cellJoinings = [] } = data || {};

    return (
      <div
        className={`relative min-h-[110px] p-2 border-r border-b border-[#e4ebf1] transition-all hover:bg-[#f8fafc] cursor-pointer group ${
          !isCurrentMonth ? 'bg-[#fcfdfe] opacity-40' : 'bg-white'
        } ${isToday ? 'ring-2 ring-inset ring-[#1f52cc] z-10 shadow-lg' : ''}`}
        onClick={() => onSelectDate(date)}
      >
        <div className="flex justify-between items-start">
          <span className={`text-sm font-semibold ${isToday ? 'text-[#1f52cc]' : 'text-[#64748b]'}`}>
            {date.getDate()}
          </span>
          <div className="flex flex-col gap-1">
            {cellInterviews.length > 0 && (
              <div className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[9px] font-bold rounded flex items-center gap-1">
                <span className="material-symbols-outlined text-[10px]">event</span>
                {cellInterviews.length}
              </div>
            )}
            {cellJoinings.length > 0 && (
              <div className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[9px] font-bold rounded flex items-center gap-1">
                <span className="material-symbols-outlined text-[10px]">celebration</span>
                {cellJoinings.length}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  });

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active="interviews" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
      topbar={
        <EnterpriseTopbar
          searchPlaceholder="Search candidates or interviews..."
          tabs={[]}
          right={
            <>
              <NotificationBell />
              <UserChip />
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
          <button className={`p-1 px-4 text-xs font-semibold rounded-lg transition-all ${!filterMine ? 'bg-[#1f52cc] text-white shadow-md' : 'text-[#64748b] hover:bg-slate-100'}`} onClick={() => setFilterMine(false)}>
            All
          </button>
          <button className={`p-1 px-4 text-xs font-semibold rounded-lg transition-all ${filterMine ? 'bg-[#1f52cc] text-white shadow-md' : 'text-[#64748b] hover:bg-slate-100'}`} onClick={() => setFilterMine(true)}>
            My Interviews
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
      <PageEnter className={`schedule-page h-[calc(100vh-126px)] overflow-hidden`}>
        {viewMode === 'list' && (
          <Reveal className="candidate-list-panel bg-white p-4 h-full">
            <div className="pb-4 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-semibold font-[Manrope] px-2">Interviews</h2>
                {loading ? <div className="text-xs text-[#a1acbd] animate-pulse">Syncing...</div> : null}
              </div>
              <div className="px-2">
                <div className="relative group">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-[#1f52cc] transition-colors">search</span>
                  <input 
                    className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-200 bg-slate-50/50 text-sm focus:border-[#1f52cc] focus:bg-white outline-none transition-all placeholder:text-slate-400"
                    placeholder="Search candidate or job..."
                    value={interviewListSearch}
                    onChange={e => setInterviewListSearch(e.target.value)}
                  />
                </div>
              </div>
            </div>
            {groupedApplications.map((group) => {
              const candidate = group.application?.candidate;
              const candidateId = group.candidateId;
              return (
                <button
                  key={candidateId}
                  className={`w-full text-left flex gap-3 p-3 rounded-xl mb-1 ${selectedGroupId === candidateId ? 'bg-[#eef3ff] border-l-4 border-[#1f4bc6]' : 'hover:bg-[#f6f9fc]'}`}
                  onClick={() => {
                    setSelectedId(candidateId);
                    if (group.latestInterview?.id) {
                      setActiveInterviewId(group.latestInterview.id);
                    }
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
          <Reveal delay={0.06} className="bg-white p-6 overflow-auto w-full h-full">
            <div className="calendar-grid grid grid-cols-7 border-t border-l border-[#e4ebf1]">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                <div key={day} className="py-2 text-center text-xs font-bold text-[#64748b] bg-[#f8fafc] border-r border-b border-[#e4ebf1]">{day}</div>
              ))}
              {calendarDays.map((cell, idx) => (
                <CalendarCell 
                  key={`${cell.month}-${cell.day}-${idx}`}
                  date={cell.date}
                  isCurrentMonth={cell.month === 'current'}
                  isToday={new Date().toDateString() === cell.date.toDateString()}
                  onSelectDate={handleSelectDate}
                  data={scheduleData[cell.date.toDateString()]}
                />
              ))}
            </div>

            {/* Activity Modal Pop-up */}
            {showActivityModal && selectedCalendarDate && (
              <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowActivityModal(false)} />
                <Reveal className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden relative z-10 animate-in zoom-in-95 duration-200">
                  <div className="h-2 w-full bg-gradient-to-r from-[#1f52cc] to-[#35b577]" />
                  <div className="p-8">

        <div className="flex items-center justify-between mb-8">
                      <div>
                        <div className="os-eyebrow !text-[#1f52cc]">Activity for</div>
                        <h2 className="text-3xl font-bold text-[#0f1b3d] font-[Manrope]">
                          {selectedCalendarDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                        </h2>
                      </div>
                      <button className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors" onClick={() => setShowActivityModal(false)}>
                        <span className="material-symbols-outlined">close</span>
                      </button>
                    </div>

                    <div className="space-y-8 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                      {/* Interviews Section */}
                      {(scheduleData[selectedCalendarDate.toDateString()]?.interviews || []).length > 0 && (
                        <div>
                          <h3 className="text-[11px] uppercase tracking-[.15em] text-[#1f52cc] font-bold mb-4 flex items-center gap-2">
                            <span className="material-symbols-outlined text-sm">event</span>
                            Scheduled Interviews
                          </h3>
                          <div className="grid gap-3">
                            {(scheduleData[selectedCalendarDate.toDateString()]?.interviews || [])
                              .sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart))
                              .map((iv) => (
                                <div key={iv.id} className="os-card p-5 flex items-center justify-between border-blue-100 bg-blue-50/20">
                                  <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-2xl bg-white border border-[#e2e8f0] flex flex-col items-center justify-center text-[#1f52cc]">
                                      <div className="text-[10px] font-bold leading-none">{new Date(iv.scheduledStart).getHours() % 12 || 12}</div>
                                      <div className="text-[9px] uppercase font-black">{new Date(iv.scheduledStart).getHours() >= 12 ? 'PM' : 'AM'}</div>
                                    </div>
                                    <div>
                                      <div className="text-base font-bold text-[#10193f]">{iv.application?.candidate?.fullName}</div>
                                      <div className="text-xs text-[#6f7d98] mt-0.5">{iv.round} • {iv.mode}</div>
                                    </div>
                                  </div>
                                  <button className="os-btn-outline !h-9 !px-5" onClick={() => navigate(`/candidate/${iv.application?.candidateId}`)}>
                                    Profile
                                  </button>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}

                      {/* Joinings Section */}
                      {(scheduleData[selectedCalendarDate.toDateString()]?.joinings || []).length > 0 && (
                        <div>
                          <h3 className="text-[11px] uppercase tracking-[.15em] text-[#10b981] font-bold mb-4 flex items-center gap-2">
                            <span className="material-symbols-outlined text-sm">celebration</span>
                            New Joinings
                          </h3>
                          <div className="grid gap-3">
                            {(scheduleData[selectedCalendarDate.toDateString()]?.joinings || [])
                              .map(app => (
                                <div key={app.id} className="os-card p-5 flex items-center justify-between border-emerald-100 bg-emerald-50/20">
                                  <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                                      <span className="material-symbols-outlined text-2xl">person_add</span>
                                    </div>
                                    <div>
                                      <div className="text-base font-bold text-[#10193f]">{app.candidate?.fullName}</div>
                                      <div className="text-xs text-emerald-600 font-medium mt-0.5">Joining as {app.job?.title}</div>
                                    </div>
                                  </div>
                                  <button className="os-btn-primary !h-9 !bg-emerald-600 !px-5" onClick={() => navigate(`/candidate/${app.candidateId}`)}>
                                    Onboard
                                  </button>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}

                      {!(scheduleData[selectedCalendarDate.toDateString()]?.interviews?.length > 0) && 
                       !(scheduleData[selectedCalendarDate.toDateString()]?.joinings?.length > 0) && (
                        <div className="py-16 text-center">
                          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-200 mb-4">
                            <span className="material-symbols-outlined text-3xl">event_busy</span>
                          </div>
                          <div className="text-lg font-semibold text-[#64748b]">No schedules found</div>
                          <div className="text-sm text-[#94a3b8] mt-1">This day is completely clear from the calendar.</div>
                        </div>
                      )}
                    </div>
                  </div>
                </Reveal>
              </div>
            )}
          </Reveal>
        ) : (
          <>

            <Reveal delay={0.04} className="interview-detail-panel bg-[#eef3f3] flex flex-col overflow-hidden h-full">
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
                <div className="flex items-center gap-2">
                  <button 
                    className="os-btn-primary !h-9 !px-4 !bg-[#1f52cc]" 
                    onClick={() => {
                      const candidateName = selectedCandidate?.fullName || '';
                      const resolvedJobId = selectedGroup?.application?.jobId
                        || selectedGroup?.application?.job?.id
                        || '';
                      const resolvedJobTitle = selectedGroup?.application?.job?.title || '';
                      const nextRound = (selectedGroup?.interviews?.length || 0) + 1;

                      setScheduleForm({
                        ...emptyScheduleForm,
                        candidateId: selectedCandidate?.id || '',
                        jobId: resolvedJobId,
                        roundNo: nextRound,
                        round: `Round ${nextRound}`
                      });
                      // Pre-fill display fields so the user sees what's already selected
                      setCandidateSearch(candidateName);
                      setJobSearch(resolvedJobTitle);
                      setShowScheduleModal(true);
                    }}
                  >
                    <span className="material-symbols-outlined text-sm">event</span>
                    Schedule Next
                  </button>
                  <button 
                    className="os-btn-outline !h-9 !px-4" 
                    onClick={() => {
                      setFeedbackForm(emptyFeedbackForm);
                      setShowFeedbackModal(true);
                    }}
                  >
                    <span className="material-symbols-outlined text-sm">rate_review</span>
                    Feedback
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-slate-200">
                {error ? <div className="os-card p-3 text-xs text-red-600">{error}</div> : null}
                {banner ? <div className="os-card p-3 text-xs text-[#2454cf]">{banner}</div> : null}

                {/* Rounds Tab Bar */}
                <div className="round-tabs-bar bg-[#f1f5f9] rounded-[20px] p-1.5 gap-1.5 border border-[#e2e8f0]">
                  {(selectedGroup?.interviews || [])
                    .reduce((acc, curr) => {
                      if (!acc.find(item => item.roundNo === curr.roundNo)) acc.push(curr);
                      return acc;
                    }, [])
                    .sort((a, b) => a.roundNo - b.roundNo)
                    .map((iv) => (
                      <button
                        key={iv.id}
                        className={`round-tab-btn py-3 px-4 rounded-[14px] text-xs font-bold uppercase tracking-wider transition-all duration-300 ${activeInterviewId === iv.id ? 'bg-[#1f52cc] text-white shadow-lg shadow-blue-200 translate-y-[-1px]' : 'text-[#64748b] hover:bg-white hover:text-[#1f52cc]'}`}
                        onClick={() => setActiveInterviewId(iv.id)}
                      >
                        Round {iv.roundNo === 99 ? 'Final' : iv.roundNo}
                      </button>
                    ))}
                </div>

                <div className="interview-detail-card os-card p-4 text-sm text-[#2a344f]">
                  <div className="interview-detail-card-inner">
                    <div className="flex-0 flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-[#142651]">Interview Details ({selectedInterview?.round || `Round ${selectedInterview?.roundNo}`})</div>
                        {canScheduleInterview && (
                          <>
                            <button
                              onClick={() => {
                                setTransferringInterview(selectedInterview);
                                setShowTransferModal(true);
                              }}
                              className="text-blue-500 hover:text-blue-700 p-1 flex items-center ml-2"
                              title="Transfer Interviewer"
                            >
                              <span className="material-symbols-outlined text-sm">swap_horiz</span>
                              <span className="text-[10px] ml-1 font-bold">Transfer</span>
                            </button>
                            <button
                              onClick={() => setEditingInterviewId(selectedInterview.id)}
                              className="text-slate-500 hover:text-slate-700 p-1 flex items-center"
                              title="Edit Interview"
                            >
                              <span className="material-symbols-outlined text-sm">edit</span>
                            </button>
                            <button
                              onClick={() => onDeleteInterview(selectedInterview.id, selectedInterview.round || `Round ${selectedInterview.roundNo}`)}
                              className="text-red-500 hover:text-red-700 p-1 flex items-center"
                              title="Delete this interview"
                            >
                              <span className="material-symbols-outlined text-sm">delete</span>
                            </button>
                          </>
                        )}
                      </div>
                      <div className={`w-fit px-2 py-0.5 rounded text-[10px] font-bold ${selectedInterview?.result === 'PASS' ? 'bg-[#e8f5ed] text-[#2ca764]' :
                          selectedInterview?.result === 'FAIL' ? 'bg-[#fbeaea] text-[#cf3a3a]' : 'bg-[#fef4e8] text-[#f2994a]'
                        }`}>
                        {selectedInterview?.result || 'PENDING'}
                      </div>
                    </div>
                    <div className="interview-meta-grid text-xs sm:text-sm">
                      <div className="text-[#6d7893]">Role:</div> <div>{selectedInterview?.application?.job?.title || '-'}</div>
                      <div className="text-[#6d7893]">Interviewers:</div> <div>{selectedInterview?.interviewers?.map(u => u.fullName).join(', ') || '-'}</div>
                      <div className="text-[#6d7893]">Mode:</div> <div>{selectedInterview?.mode || '-'}</div>
                      <div className="text-[#6d7893]">Date:</div> <div>{selectedInterview?.scheduledStart ? new Date(selectedInterview.scheduledStart).toLocaleString() : '-'}</div>
                      {selectedInterview?.zohoLink && (
                        <>
                          <div className="text-[#6d7893]">Zoho Meet:</div> 
                          <div className="truncate text-blue-600 font-bold cursor-pointer" onClick={() => window.open(selectedInterview.zohoLink, '_blank')}>
                            Join via Zoho
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Inline Assessment Form (If No Feedback Exists yet) */}
                {selectedFeedbacks.length === 0 && selectedInterview && !savingFeedback && (
                  <div className="submit-assessment-card os-card p-6 bg-gradient-to-br from-white to-[#f8fafc] border-l-4 border-l-[#1f52cc]">
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <h3 className="text-lg font-bold text-[#142651]">Submit Assessment (Round {selectedInterview.roundNo === 99 ? 'Final' : selectedInterview.roundNo})</h3>
                        <p className="text-xs text-slate-500 mt-1">Review candidate performance for this specific round</p>
                      </div>
                    </div>
                    <form className="space-y-4" onSubmit={onFeedbackSubmit}>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-1 text-center">
                          <label className="text-[10px] uppercase font-bold text-slate-500">Technical</label>
                          <select className="h-10 w-full rounded-xl border border-slate-200 px-2 text-sm text-center focus:border-[#1f52cc] outline-none" value={feedbackForm.technicalRating} onChange={e => setFeedbackForm(prev => ({...prev, technicalRating: e.target.value}))}>
                            {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}/5</option>)}
                          </select>
                        </div>
                        <div className="space-y-1 text-center">
                          <label className="text-[10px] uppercase font-bold text-slate-500">Comm.</label>
                          <select className="h-10 w-full rounded-xl border border-slate-200 px-2 text-sm text-center focus:border-[#1f52cc] outline-none" value={feedbackForm.communicationRating} onChange={e => setFeedbackForm(prev => ({...prev, communicationRating: e.target.value}))}>
                            {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}/5</option>)}
                          </select>
                        </div>
                        <div className="space-y-1 text-center">
                          <label className="text-[10px] uppercase font-bold text-slate-500">Culture</label>
                          <select className="h-10 w-full rounded-xl border border-slate-200 px-2 text-sm text-center focus:border-[#1f52cc] outline-none" value={feedbackForm.cultureFitRating} onChange={e => setFeedbackForm(prev => ({...prev, cultureFitRating: e.target.value}))}>
                            {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}/5</option>)}
                          </select>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Overall Recommendation</label>
                        <div className="grid grid-cols-3 gap-3">
                          <button 
                            type="button" 
                            className={`h-12 rounded-2xl border font-bold text-[10px] uppercase flex flex-col items-center justify-center gap-1 transition-all ${feedbackForm.recommendation === 'SELECTED' ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-inner' : 'border-slate-100 text-slate-400 hover:bg-slate-50'}`}
                            onClick={() => setFeedbackForm(prev => ({ ...prev, recommendation: 'SELECTED' }))}
                          >
                            <span className="material-symbols-outlined text-lg">verified</span>
                            Selected
                          </button>
                          <button 
                            type="button" 
                            className={`h-12 rounded-2xl border font-bold text-[10px] uppercase flex flex-col items-center justify-center gap-1 transition-all ${feedbackForm.recommendation === 'OFFER_LETTER' ? 'bg-emerald-50 border-emerald-500 text-emerald-700 shadow-inner' : 'border-slate-100 text-slate-400 hover:bg-slate-50'}`}
                            onClick={() => setFeedbackForm(prev => ({ ...prev, recommendation: 'OFFER_LETTER' }))}
                          >
                            <span className="material-symbols-outlined text-lg">card_membership</span>
                            Offer Letter
                          </button>
                          <button 
                            type="button" 
                            className={`h-12 rounded-2xl border font-bold text-[10px] uppercase flex flex-col items-center justify-center gap-1 transition-all ${feedbackForm.recommendation === 'REJECTED' ? 'bg-rose-50 border-rose-500 text-rose-700 shadow-inner' : 'border-slate-100 text-slate-400 hover:bg-slate-50'}`}
                            onClick={() => setFeedbackForm(prev => ({ ...prev, recommendation: 'REJECTED' }))}
                          >
                            <span className="material-symbols-outlined text-lg">block</span>
                            Rejected
                          </button>
                        </div>
                      </div>

                      <div className="grid md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Key Strengths</label>
                          <textarea 
                            className="w-full rounded-xl border border-slate-200 p-3 text-xs min-h-[80px] focus:border-[#1f52cc] outline-none transition-all" 
                            placeholder="What did they do well?"
                            value={feedbackForm.strengths}
                            onChange={e => setFeedbackForm(prev => ({...prev, strengths: e.target.value}))}
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Concerns / Weaknesses</label>
                          <textarea 
                            className="w-full rounded-xl border border-slate-200 p-3 text-xs min-h-[80px] focus:border-[#1f52cc] outline-none transition-all" 
                            placeholder="Any red flags?"
                            value={feedbackForm.weaknesses}
                            onChange={e => setFeedbackForm(prev => ({...prev, weaknesses: e.target.value}))}
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Overall Summary</label>
                        <textarea 
                          className="w-full rounded-2xl border border-slate-200 p-4 text-sm min-h-[80px] focus:border-[#1f52cc] outline-none transition-all" 
                          placeholder="Final verdict and detailed notes..."
                          value={feedbackForm.overallComments}
                          onChange={e => setFeedbackForm(prev => ({...prev, overallComments: e.target.value}))}
                          required
                        />
                      </div>

                      {/* Optional Offer Letter Attachment */}
                      <div className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 hover:border-[#1f52cc]/40 hover:bg-blue-50/20 transition-all">
                        <span className="material-symbols-outlined text-slate-400 text-xl">attach_file</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] uppercase font-bold text-slate-400">Attach Document <span className="normal-case font-normal text-slate-300">(optional — offer letter, assessment sheet, etc.)</span></div>
                          {offerLetterFile && (
                            <div className="text-xs text-[#1f52cc] font-semibold mt-0.5 truncate">{offerLetterFile.name}</div>
                          )}
                        </div>
                        <input 
                          type="file" 
                          className="hidden" 
                          id="offer-upload" 
                          onChange={(e) => setOfferLetterFile(e.target.files[0])}
                          accept=".pdf,.doc,.docx"
                        />
                        <label htmlFor="offer-upload" className="shrink-0 px-4 h-8 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600 flex items-center cursor-pointer hover:border-[#1f52cc] hover:text-[#1f52cc] transition-all">
                          {offerLetterFile ? 'Change' : 'Browse'}
                        </label>
                        {offerLetterFile && (
                          <button type="button" onClick={() => setOfferLetterFile(null)} className="w-7 h-7 rounded-lg bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 flex items-center justify-center transition-all">
                            <span className="material-symbols-outlined text-sm">close</span>
                          </button>
                        )}
                      </div>

                      <div className="pt-2">
                        <button type="submit" className="w-full h-12 rounded-xl bg-[#2ca764] text-white font-bold shadow-lg shadow-emerald-200 hover:bg-[#258a52] transition-all disabled:opacity-50" disabled={savingFeedback}>
                          {savingFeedback ? 'Submitting...' : 'Submit ASSESSMENT For This Round'}
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {selectedInterview?.voiceRecordingFile?.storageKey ? (
                    <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Attached Media Recording</div>
                      {selectedInterview.voiceRecordingFile.mimeType?.startsWith('video/') ? (
                        <video controls className="w-full rounded-lg shadow-sm bg-black max-h-[240px]">
                          <source src={selectedInterview.voiceRecordingFile.storageKey} type={selectedInterview.voiceRecordingFile.mimeType} />
                          Your browser does not support the video tag.
                        </video>
                      ) : (
                        <audio controls className="w-full">
                          <source src={selectedInterview.voiceRecordingFile.storageKey} type={selectedInterview.voiceRecordingFile.mimeType} />
                          Your browser does not support the audio element.
                        </audio>
                      )}
                      <div className="mt-2 text-[10px] text-slate-500 flex justify-between items-center">
                        <span className="truncate">{selectedInterview.voiceRecordingFile.originalName}</span>
                        <a 
                          href={selectedInterview.voiceRecordingFile.storageKey} 
                          target="_blank" 
                          rel="noreferrer"
                          className="text-blue-600 hover:underline font-bold"
                        >
                          Download
                        </a>
                      </div>
                    </div>
                  ) : null}
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
                          <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              ['PASS', 'SELECTED', 'OFFER_SENT'].includes(f.recommendation) ? 'bg-[#e8f5ed] text-[#2ca764]' :
                              f.recommendation === 'FAIL' || f.recommendation === 'REJECTED' ? 'bg-[#fbeaea] text-[#cf3a3a]' : 'bg-[#fef4e8] text-[#f2994a]'
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
                            <span className="text-[#5e6a85] ml-1">{f.strengths || '-'}</span>
                          </div>
                          <div className="text-xs">
                            <span className="font-semibold text-[#142651]">Concerns:</span>
                            <span className="text-[#5e6a85] ml-1">{f.weaknesses || '-'}</span>
                          </div>
                          <div className="text-xs">
                            <span className="font-semibold text-[#142651]">Comments:</span>
                            <p className="text-[#5e6a85] mt-1 italic text-[13px]">"{f.overallComments || 'No additional comments provided.'}"</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}


              </div>
            </Reveal>


          </>
        )}
      </PageEnter>

      {/* MODALS */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setShowScheduleModal(false)} />
          <Reveal className="bg-white w-full max-w-xl rounded-[32px] shadow-2xl overflow-hidden relative z-10 animate-in zoom-in-95 duration-200">
            <div className="p-8 max-h-[90vh] overflow-y-auto custom-scrollbar">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-[#0f1b3d]">Schedule Interview</h2>
                  <p className="text-xs text-slate-500 mt-1">Book a new session for this candidate</p>
                </div>
                <button className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors" onClick={() => setShowScheduleModal(false)}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <form className="space-y-4" onSubmit={async (e) => {
                await onScheduleSubmit(e);
                setShowScheduleModal(false);
              }}>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1 relative">
                    <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Candidate</label>
                    <div className="relative">
                      <input 
                        className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-[#1f52cc] outline-none pr-10"
                        placeholder="Select or search candidate..."
                        value={candidateSearch}
                        onChange={(e) => setCandidateSearch(e.target.value)}
                        onFocus={() => setShowCandidateList(true)}
                        onBlur={() => setTimeout(() => setShowCandidateList(false), 200)}
                      />
                      <span className="material-symbols-outlined absolute right-3 top-2.5 text-slate-400 pointer-events-none">expand_more</span>
                    </div>
                    {showCandidateList && (
                      <div className="absolute z-[1200] left-0 right-0 top-[64px] bg-white border border-slate-200 rounded-2xl shadow-2xl max-h-48 overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
                        {candidates
                          .filter(c => c.fullName.toLowerCase().includes(candidateSearch.toLowerCase()))
                          .map(c => (
                            <div 
                              key={c.id} 
                              className="p-3 hover:bg-blue-50 cursor-pointer text-sm border-b border-slate-50 last:border-0 transition-colors"
                              onClick={() => {
                                const candInterviews = interviews.filter(iv => (iv.application?.candidate?.id || iv.application?.candidateId) === c.id);
                                const nextRound = candInterviews.length + 1;
                                setScheduleForm(prev => ({ 
                                  ...prev, 
                                  candidateId: c.id,
                                  roundNo: nextRound,
                                  round: `Round ${nextRound}`
                                }));
                                setCandidateSearch(c.fullName);
                                setShowCandidateList(false);
                              }}
                            >
                              <div className="font-medium text-slate-700">{c.fullName}</div>
                              <div className="text-[10px] text-slate-400">{c.email || 'No Email'}</div>
                            </div>
                          ))}
                        {candidates.filter(c => c.fullName.toLowerCase().includes(candidateSearch.toLowerCase())).length === 0 && (
                          <div className="p-4 text-center text-xs text-slate-400 italic">No candidates found</div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="space-y-1 relative">
                    <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Job Role</label>
                    <div className="relative">
                      <input 
                        className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-[#1f52cc] outline-none pr-10"
                        placeholder="Select or search job..."
                        value={jobSearch}
                        onChange={(e) => setJobSearch(e.target.value)}
                        onFocus={() => setShowJobList(true)}
                        onBlur={() => setTimeout(() => setShowJobList(false), 200)}
                      />
                      <span className="material-symbols-outlined absolute right-3 top-2.5 text-slate-400 pointer-events-none">expand_more</span>
                    </div>
                    {showJobList && (
                      <div className="absolute z-[1200] left-0 right-0 top-[64px] bg-white border border-slate-200 rounded-2xl shadow-2xl max-h-48 overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
                        {jobs
                          .filter(j => j.title.toLowerCase().includes(jobSearch.toLowerCase()))
                          .map(j => (
                            <div 
                              key={j.id} 
                              className="p-3 hover:bg-blue-50 cursor-pointer text-sm border-b border-slate-50 last:border-0 transition-colors"
                              onClick={() => {
                                setScheduleForm(prev => ({ ...prev, jobId: j.id }));
                                setJobSearch(j.title);
                                setShowJobList(false);
                              }}
                            >
                              <div className="font-medium text-slate-700">{j.title}</div>
                              <div className="text-[10px] text-slate-400">{j.location || 'Remote'}</div>
                            </div>
                          ))}
                        {jobs.filter(j => j.title.toLowerCase().includes(jobSearch.toLowerCase())).length === 0 && (
                          <div className="p-4 text-center text-xs text-slate-400 italic">No jobs found</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Interview Round</label>
                    <select 
                      className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-[#1f52cc] outline-none"
                      value={scheduleForm.roundNo}
                      onChange={(e) => {
                        const val = e.target.value;
                        setScheduleForm(prev => ({ 
                          ...prev, 
                          roundNo: val === 'Final' ? 99 : parseInt(val), 
                          round: val === 'Final' ? 'Final Round' : `Round ${val}` 
                        }));
                      }}
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                        <option key={n} value={n}>Round {n}</option>
                      ))}
                      <option value="Final">Final Round</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Meeting Mode</label>
                    <select 
                      className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-[#1f52cc] outline-none"
                      value={scheduleForm.mode}
                      onChange={(e) => setScheduleForm(prev => ({ ...prev, mode: e.target.value }))}
                    >
                      <option value="ONLINE">Online Meeting</option>
                      <option value="IN_PERSON">In Person</option>
                      <option value="PHONE">Phone Call</option>
                      <option value="DRIVE">Drive Meeting</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between ml-1">
                    <label className="text-[10px] uppercase font-bold text-slate-500">Interviewers (Multiple)</label>
                    <input 
                      className="text-[10px] border-b border-slate-200 focus:border-blue-400 outline-none w-24"
                      placeholder="Filter..."
                      value={interviewerSearch}
                      onChange={(e) => setInterviewerSearch(e.target.value)}
                    />
                  </div>
                  <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-xl p-3 space-y-2 bg-slate-50/50 custom-scrollbar">
                    {interviewers
                      .filter(p => p.fullName.toLowerCase().includes(interviewerSearch.toLowerCase()))
                      .map((person) => (
                      <label key={person.id} className="flex items-center gap-2 cursor-pointer hover:bg-white p-1 rounded-lg transition-colors">
                        <input
                          type="checkbox"
                          checked={scheduleForm.interviewerIds.includes(person.id)}
                          onChange={(e) => {
                            const ids = e.target.checked
                              ? [...scheduleForm.interviewerIds, person.id]
                              : scheduleForm.interviewerIds.filter(id => id !== person.id);
                            setScheduleForm(prev => ({ ...prev, interviewerIds: ids }));
                          }}
                          className="rounded-md h-4 w-4 text-[#1f52cc] border-slate-300 focus:ring-[#1f52cc]"
                        />
                        <span className="text-sm font-medium text-slate-700">{person.fullName} <span className="text-[10px] text-slate-400 font-normal">({person.role})</span></span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Start Date & Time</label>
                  <input 
                    type="datetime-local" 
                    className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm focus:border-[#1f52cc] outline-none" 
                    required
                    value={scheduleForm.scheduledStart}
                    onChange={(e) => setScheduleForm(prev => ({ ...prev, scheduledStart: e.target.value }))}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Meeting Link (Optional)</label>
                    <input 
                      type="url" 
                      className="h-10 w-full rounded-xl border border-slate-200 px-4 text-xs focus:border-[#1f52cc] outline-none" 
                      placeholder="e.g. Google Meet / Zoom"
                      value={scheduleForm.meetingLink}
                      onChange={(e) => setScheduleForm(prev => ({ ...prev, meetingLink: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Zoho Link (Optional)</label>
                    <input 
                      type="url" 
                      className="h-10 w-full rounded-xl border border-slate-200 px-4 text-xs focus:border-[#1f52cc] outline-none" 
                      placeholder="e.g. Zoho Meeting URL"
                      value={scheduleForm.zohoLink}
                      onChange={(e) => setScheduleForm(prev => ({ ...prev, zohoLink: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-6">
                  <button type="button" className="flex-1 h-11 rounded-xl border border-slate-200 font-bold text-slate-500 hover:bg-slate-50 transition-all" onClick={() => setShowScheduleModal(false)}>Cancel</button>
                  <button type="submit" className="flex-1 h-11 rounded-xl bg-[#1f52cc] text-white font-bold shadow-lg shadow-blue-200 hover:bg-[#1844b0] transition-all disabled:opacity-50" disabled={savingSchedule}>
                    {savingSchedule ? 'Scheduling...' : 'Confirm Schedule'}
                  </button>
                </div>
              </form>
            </div>
          </Reveal>
        </div>
      )}


      {/* Transfer Panelist Modal */}
      {showTransferModal && transferringInterview && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setShowTransferModal(false)} />
          <Reveal className="bg-white w-full max-w-md rounded-[32px] shadow-2xl overflow-hidden relative z-10">
            <div className="p-8">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-xl font-bold text-[#142651]">Transfer Panelist</h3>
                  <p className="text-xs text-slate-500 mt-1">Select a new interviewer for this round</p>
                </div>
                <button onClick={() => setShowTransferModal(false)} className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-all">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {interviewers
                  .filter(i => !transferringInterview.interviewerIds?.includes(i.id))
                  .map((person) => (
                    <button
                      key={person.id}
                      onClick={() => onTransferPanelist(person.id)}
                      className="w-full text-left p-4 rounded-2xl border border-slate-100 hover:border-blue-200 hover:bg-blue-50/50 transition-all group flex items-center gap-4"
                    >
                      <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm group-hover:bg-blue-600 group-hover:text-white transition-all">
                        {person.fullName.split(' ').map(n => n[0]).join('').toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <div className="font-bold text-slate-700 text-sm">{person.fullName}</div>
                        <div className="text-[10px] text-slate-400 uppercase tracking-wider">{person.role}</div>
                      </div>
                      <span className="material-symbols-outlined text-blue-400 opacity-0 group-hover:opacity-100 transition-all translate-x-[-10px] group-hover:translate-x-0">
                        arrow_forward
                      </span>
                    </button>
                  ))}
              </div>

              <button
                className="w-full mt-6 h-12 rounded-2xl border border-slate-200 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-all"
                onClick={() => setShowTransferModal(false)}
              >
                Cancel
              </button>
            </div>
          </Reveal>
        </div>
      )}
      
      <EditInterviewModal
        isOpen={!!editingInterviewId}
        interviewId={editingInterviewId}
        onClose={() => setEditingInterviewId(null)}
        onUpdate={loadAll}
      />

    </EnterpriseLayout>
  );
};

export default InterviewSchedule;
