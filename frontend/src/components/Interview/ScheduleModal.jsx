import * as React from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getStoredUser, apiGet } from '../../lib/api';
import { 
  getNextSchedulableRound, 
  ROUND_DISPLAY_LABEL, 
  InterviewRound 
} from '../../lib/interviewTemplates';
import { ContactAttemptPopover } from './ContactAttemptPopover';
import { schedulingApi } from '../../services/schedulingApi';
import { 
  MAX_UPLOAD_BYTES,
  ALLOWED_EXTENSIONS,
  ACCEPT_ATTRIBUTE,
  ERROR_UNSUPPORTED,
  ERROR_TOO_LARGE,
} from '../../config/followUpConfig';

const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve({ name: file.name, data: reader.result, type: file.type });
    reader.onerror = error => reject(error);
  });
};

export const ScheduleModal = React.memo(function ScheduleModal({
  scheduleForm,
  setScheduleForm,
  candidateSearch,
  setCandidateSearch,
  jobSearch,
  setJobSearch,
  interviewerSearch,
  setInterviewerSearch,
  showCandidateList,
  setShowCandidateList,
  showJobList,
  setShowJobList,
  candidateSuggestions,
  jobSuggestions,
  interviewers,
  interviewersLoading,
  interviewersError,
  refetchInterviewers,
  searchingCandidates,
  searchingJobs,
  savingSchedule,
  onClose,
  allInterviews,
  candidateFeedbacks: propCandidateFeedbacks,
  setBanner,
  setError,
  onSubmit,
}) {
  const currentUser = getStoredUser();
  const isAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'RECRUITER';
  const [contactAttemptType, setContactAttemptType] = useState(null);
  const [loggingAttempt, setLoggingAttempt] = useState(false);

  const { data: fetchedFeedbacks = [] } = useQuery({
    queryKey: ['candidate-feedbacks', scheduleForm.candidateId],
    queryFn: async () => {
      if (!scheduleForm.candidateId) return [];
      const res = await apiGet(`/interviews/${scheduleForm.candidateId}/feedback`);
      return res.data || [];
    },
    enabled: !!scheduleForm.candidateId,
    staleTime: 30_000,
  });
  const candidateFeedbacks = propCandidateFeedbacks || fetchedFeedbacks;

  const { data: fetchedInterviews = [] } = useQuery({
    queryKey: ['candidate-interviews', scheduleForm.candidateId],
    queryFn: async () => {
      if (!scheduleForm.candidateId) return [];
      const res = await apiGet(`/interviews?candidateId=${scheduleForm.candidateId}&limit=100`);
      return res.data || [];
    },
    enabled: !!scheduleForm.candidateId,
    staleTime: 30_000,
  });

  const localToday = React.useMemo(() => {
    const d = new Date();
    const offset = d.getTimezoneOffset();
    const localDate = new Date(d.getTime() - (offset * 60 * 1000));
    return localDate.toISOString().split('T')[0];
  }, []);

  const selectedCandidatePhone = React.useMemo(() => {
    if (!scheduleForm.candidateId) return '';
    const suggestion = candidateSuggestions.find(c => c.id === scheduleForm.candidateId);
    if (suggestion?.phone) return suggestion.phone;

    const matchIv = [...(allInterviews || []), ...fetchedInterviews].find(
      iv => (iv.application?.candidate?.id || iv.application?.candidateId || iv.candidateId || iv.candidate?.id) === scheduleForm.candidateId
    );
    if (matchIv?.application?.candidate?.phone) {
      return matchIv.application.candidate.phone;
    }
    return '';
  }, [scheduleForm.candidateId, candidateSuggestions, allInterviews, fetchedInterviews]);

  const handleRoundChange = React.useCallback((e) => {
    const val = e.target.value;
    setScheduleForm(prev => ({
      ...prev,
      roundNo: val === 'Final' ? 99 : parseInt(val, 10),
      round: val === 'Final' ? 'Final Round' : `Round ${val}`,
    }));
  }, [setScheduleForm]);

  const candidateCompletedRounds = React.useMemo(() => {
    if (!scheduleForm.candidateId) return [];
    const feedbackRounds = (candidateFeedbacks || [])
      .filter((f) => (f.candidateId || f.candidate?.id) === scheduleForm.candidateId)
      .map((f) => f.round);

    const mergedInterviews = [...(allInterviews || []), ...fetchedInterviews];

    const candInterviews = mergedInterviews.filter(
      (i) => (i.application?.candidate?.id || i.application?.candidateId || i.candidateId || i.candidate?.id) === scheduleForm.candidateId &&
             !i.isDeleted &&
             i.status !== 'CANCELLED'
    );
    const interviewRounds = candInterviews.map((i) => {
      if (i.roundNo === 1) return InterviewRound.ROUND_1;
      if (i.roundNo === 2) return InterviewRound.ROUND_2;
      return InterviewRound.FINAL_ROUND;
    });

    return Array.from(new Set([...feedbackRounds, ...interviewRounds]));
  }, [scheduleForm.candidateId, allInterviews, fetchedInterviews, candidateFeedbacks]);

  const nextDerivedRound = getNextSchedulableRound(candidateCompletedRounds);
  const nextDerivedLabel = nextDerivedRound ? ROUND_DISPLAY_LABEL[nextDerivedRound] : 'All 3 Rounds Completed';

  const priorRound = nextDerivedRound === 'ROUND_2' ? 'ROUND_1' : nextDerivedRound === 'FINAL_ROUND' ? 'ROUND_2' : null;
  const priorRoundLabel = priorRound ? ROUND_DISPLAY_LABEL[priorRound] : '';
  const priorRoundFeedbackMissing = priorRound ? !candidateCompletedRounds.includes(priorRound) : false;

  // Auto-synchronize the round details in the schedule form whenever the derived round changes
  React.useEffect(() => {
    if (nextDerivedRound) {
      const nextRoundNo = nextDerivedRound === 'ROUND_1' ? 1
                        : nextDerivedRound === 'ROUND_2' ? 2
                        : nextDerivedRound === 'FINAL_ROUND' ? 99
                        : 1;
      const roundLabel = nextRoundNo === 99 ? 'Final Round' : `Round ${nextRoundNo}`;
      
      setScheduleForm(prev => {
        if (prev.roundNo === nextRoundNo && prev.round === roundLabel) return prev;
        return {
          ...prev,
          roundNo: nextRoundNo,
          round: roundLabel,
        };
      });
    }
  }, [nextDerivedRound, setScheduleForm]);


  const handleModeChange = React.useCallback((e) => {
    setScheduleForm(prev => ({ ...prev, mode: e.target.value }));
  }, [setScheduleForm]);


  const handleStartChange = React.useCallback((e) => {
    setScheduleForm(prev => ({ ...prev, scheduledStart: e.target.value }));
  }, [setScheduleForm]);

  // Split date (yyyy-MM-dd) + time (HH:mm) → combine to ISO datetime-local string
  const handleDatePartChange = React.useCallback((e) => {
    const datePart = e.target.value; // yyyy-MM-dd
    setScheduleForm(prev => {
      const timePart = prev.scheduledStart ? prev.scheduledStart.slice(11, 16) : '09:00';
      return { ...prev, scheduledStart: datePart ? `${datePart}T${timePart}` : '' };
    });
  }, [setScheduleForm]);

  const handleTimePartChange = React.useCallback((e) => {
    const timePart = e.target.value; // HH:mm
    setScheduleForm(prev => {
      const datePart = prev.scheduledStart ? prev.scheduledStart.slice(0, 10) : '';
      return { ...prev, scheduledStart: datePart ? `${datePart}T${timePart}` : '' };
    });
  }, [setScheduleForm]);

  const handleMeetingLinkChange = React.useCallback((e) => {
    setScheduleForm(prev => ({ ...prev, meetingLink: e.target.value }));
  }, [setScheduleForm]);

  const handleZohoLinkChange = React.useCallback((e) => {
    setScheduleForm(prev => ({ ...prev, zohoLink: e.target.value }));
  }, [setScheduleForm]);

  const handleCandidateSearchChange = React.useCallback((e) => {
    setCandidateSearch(e.target.value);
  }, [setCandidateSearch]);

  const handleJobSearchChange = React.useCallback((e) => {
    setJobSearch(e.target.value);
  }, [setJobSearch]);

  const handleInterviewerSearchChange = React.useCallback((e) => {
    setInterviewerSearch(e.target.value);
  }, [setInterviewerSearch]);

  const handleInterviewerToggle = React.useCallback((personId, checked) => {
    setScheduleForm(prev => {
      const ids = checked
        ? [...prev.interviewerIds, personId]
        : prev.interviewerIds.filter(id => id !== personId);
      return { ...prev, interviewerIds: ids };
    });
  }, [setScheduleForm]);

  const handleCandidateSelect = React.useCallback((c) => {
    const feedbackRounds = (candidateFeedbacks || [])
      .filter((f) => f.candidateId === c.id)
      .map((f) => f.round);

    const candInterviews = (allInterviews || []).filter(
      (iv) => (iv.application?.candidate?.id || iv.application?.candidateId || iv.candidateId) === c.id &&
              !iv._optimistic &&
              !iv.isDeleted &&
              iv.status !== 'CANCELLED'
    );
    const interviewRounds = candInterviews.map((i) => {
      if (i.roundNo === 1) return InterviewRound.ROUND_1;
      if (i.roundNo === 2) return InterviewRound.ROUND_2;
      return InterviewRound.FINAL_ROUND;
    });

    const completed = Array.from(new Set([...feedbackRounds, ...interviewRounds]));
    const nextDerived = getNextSchedulableRound(completed);
    
    const nextRoundNo = nextDerived === 'ROUND_1' ? 1
                      : nextDerived === 'ROUND_2' ? 2
                      : nextDerived === 'FINAL_ROUND' ? 99
                      : 1;

    const roundLabel = nextRoundNo === 99 ? 'Final Round' : `Round ${nextRoundNo}`;

    setScheduleForm(prev => ({
      ...prev,
      candidateId: c.id,
      roundNo: nextRoundNo,
      round: roundLabel,
    }));
    setCandidateSearch(c.fullName);
    setShowCandidateList(false);
  }, [allInterviews, candidateFeedbacks, setScheduleForm, setCandidateSearch, setShowCandidateList]);

  const handleJobSelect = React.useCallback((j) => {
    setScheduleForm(prev => ({ ...prev, jobId: j.id }));
    setJobSearch(j.title);
    setShowJobList(false);
  }, [setScheduleForm, setJobSearch, setShowJobList]);

  const filteredInterviewerList = React.useMemo(() => {
    if (!interviewers) return [];
    if (!interviewerSearch) return interviewers;
    const q = interviewerSearch.toLowerCase();
    return interviewers.filter(p =>
      (p.fullName || '').toLowerCase().includes(q) || (p.role || '').toLowerCase().includes(q)
    );
  }, [interviewers, interviewerSearch]);

  // ── Slot computation: same-hour bookings ──
  // Returns { slotNo, slotCount, slotExceeded } based on scheduledStart + existing interviews
  const slotInfo = React.useMemo(() => {
    if (!scheduleForm.scheduledStart) return { slotNo: 1, slotCount: 0, slotExceeded: false };
    const chosenDate = new Date(scheduleForm.scheduledStart);
    const chosenDateKey = chosenDate.toDateString();
    const chosenHour   = chosenDate.getHours();

    // Count real (non-optimistic) interviews already in the same date+hour bucket
    const sameSlotInterviews = (allInterviews || []).filter(iv => {
      if (iv?._optimistic) return false;
      if (!iv?.scheduledStart) return false;
      const d = new Date(iv.scheduledStart);
      return d.toDateString() === chosenDateKey && d.getHours() === chosenHour;
    });
    const slotCount = sameSlotInterviews.length;
    const slotNo    = slotCount + 1;
    return { slotNo, slotCount, slotExceeded: slotNo > 7 };
  }, [scheduleForm.scheduledStart, allInterviews]);

  // Keep scheduleForm.slotNo in sync with computed slotInfo (only when scheduledStart is set)
  React.useEffect(() => {
    if (!scheduleForm.scheduledStart) return;
    setScheduleForm(prev => ({ ...prev, slotNo: slotInfo.slotNo }));
  }, [slotInfo.slotNo, scheduleForm.scheduledStart]);

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={onClose} />
      <div className="bg-white w-full max-w-xl rounded-[32px] shadow-2xl overflow-hidden relative z-10 animate-in zoom-in-95 duration-200">
        <div className="p-8 max-h-[90vh] overflow-y-auto custom-scrollbar">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-[#0f1b3d]">Schedule Interview</h2>
              <p className="text-xs text-slate-500 mt-1">Book a new session for this candidate</p>
            </div>
            <button
              className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors"
              onClick={onClose}
              type="button"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="grid grid-cols-2 gap-4">
              {/* Candidate */}
              <div className="space-y-1 relative">
                <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Candidate</label>
                <div className="relative">
                  <input
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-[#1f52cc] outline-none pr-10"
                    placeholder="Select or search candidate..."
                    value={candidateSearch}
                    onChange={handleCandidateSearchChange}
                    onFocus={() => setShowCandidateList(true)}
                    onBlur={() => setTimeout(() => setShowCandidateList(false), 200)}
                    autoComplete="off"
                  />
                  <span className="material-symbols-outlined absolute right-3 top-2.5 text-slate-400 pointer-events-none">expand_more</span>
                </div>
                {selectedCandidatePhone && (
                  <div className="text-[10px] text-blue-600 font-bold ml-1 mt-1 flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs">call</span>
                    Phone: {selectedCandidatePhone}
                  </div>
                )}
                {showCandidateList && (
                  <div className="absolute z-[1200] left-0 right-0 top-[64px] bg-white border border-slate-200 rounded-2xl shadow-2xl max-h-48 overflow-y-auto">
                    {searchingCandidates ? (
                      <div className="p-4 text-center text-xs text-[#a1acbd] animate-pulse">Searching...</div>
                    ) : (
                      candidateSuggestions.map(c => (
                        <div
                          key={c.id}
                          className="p-3 hover:bg-blue-50 cursor-pointer text-sm border-b border-slate-50 last:border-0 transition-colors"
                          onMouseDown={(e) => { e.preventDefault(); handleCandidateSelect(c); }}
                        >
                          <div className="font-medium text-slate-700">{c.fullName}</div>
                          <div className="text-[10px] text-slate-400">{c.email || 'No Email'}</div>
                        </div>
                      ))
                    )}
                    {!searchingCandidates && candidateSuggestions.length === 0 && (
                      <div className="p-4 text-center text-xs text-slate-400 italic">No candidates found</div>
                    )}
                  </div>
                )}
              </div>

              {/* Job Role */}
              <div className="space-y-1 relative">
                <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Job Role</label>
                <div className="relative">
                  <input
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-[#1f52cc] outline-none pr-10"
                    placeholder="Select or search job..."
                    value={jobSearch}
                    onChange={handleJobSearchChange}
                    onFocus={() => setShowJobList(true)}
                    onBlur={() => setTimeout(() => setShowJobList(false), 200)}
                    autoComplete="off"
                  />
                  <span className="material-symbols-outlined absolute right-3 top-2.5 text-slate-400 pointer-events-none">expand_more</span>
                </div>
                {showJobList && (
                  <div className="absolute z-[1200] left-0 right-0 top-[64px] bg-white border border-slate-200 rounded-2xl shadow-2xl max-h-48 overflow-y-auto">
                    {searchingJobs ? (
                      <div className="p-4 text-center text-xs text-[#a1acbd] animate-pulse">Searching...</div>
                    ) : (
                      jobSuggestions.map(j => (
                        <div
                          key={j.id}
                          className="p-3 hover:bg-blue-50 cursor-pointer text-sm border-b border-slate-50 last:border-0 transition-colors"
                          onMouseDown={(e) => { e.preventDefault(); handleJobSelect(j); }}
                        >
                          <div className="font-medium text-slate-700">{j.title}</div>
                          <div className="text-[10px] text-slate-400">{j.location || 'Remote'}</div>
                        </div>
                      ))
                    )}
                    {!searchingJobs && jobSuggestions.length === 0 && (
                      <div className="p-4 text-center text-xs text-slate-400 italic">No jobs found</div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Round & Mode */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Next Schedulable Round (Derived)</label>
                <div className={`h-10 w-full rounded-xl border border-slate-200 px-3 flex items-center text-sm font-semibold ${
                  nextDerivedRound ? 'bg-slate-50 text-[#1f52cc]' : 'bg-red-50 text-red-700'
                }`}>
                  {nextDerivedLabel}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Meeting Mode</label>

                <select
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-[#1f52cc] outline-none"
                  value={scheduleForm.mode}
                  onChange={handleModeChange}
                >
                  <option value="ONLINE">Online Meeting</option>
                  <option value="IN_PERSON">In Person</option>
                  <option value="PHONE">Phone Call</option>
                  <option value="DRIVE">Drive Meeting</option>
                  <option value="WALK_IN_DRIVE">Walk-in Drive</option>
                </select>
              </div>
            </div>

            {/* Interviewers */}
            {scheduleForm.mode !== 'WALK_IN_DRIVE' && (
              <div className="space-y-1">
                <div className="flex items-center justify-between ml-1">
                  <label className="text-[10px] uppercase font-bold text-slate-500">Interviewers (Multiple)</label>
                  <input
                    className="text-[10px] border-b border-slate-200 focus:border-blue-400 outline-none w-24"
                    placeholder="Filter..."
                    value={interviewerSearch}
                    onChange={handleInterviewerSearchChange}
                  />
                </div>
                <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-xl p-3 space-y-2 bg-slate-50/50 custom-scrollbar">
                  {interviewersLoading ? (
                    <div className="text-xs text-slate-400 text-center py-2 animate-pulse">Loading interviewers...</div>
                  ) : interviewersError ? (
                    <div className="text-xs text-center py-2 space-y-1">
                      <div className="text-red-500">{interviewersError.message}</div>
                      <button onClick={refetchInterviewers} className="text-[10px] text-blue-600 hover:underline">Retry</button>
                    </div>
                  ) : !interviewers || interviewers.length === 0 ? (
                    <div className="text-xs text-slate-400 text-center py-2 italic">No interviewers available</div>
                  ) : filteredInterviewerList.length === 0 ? (
                    <div className="text-xs text-slate-400 text-center py-2 italic">No interviewers match filter</div>
                  ) : (
                    filteredInterviewerList.map((person) => (
                      <label key={person.id} className="flex items-center gap-2 cursor-pointer hover:bg-white p-1 rounded-lg transition-colors">
                        <input
                          type="checkbox"
                          checked={scheduleForm.interviewerIds.includes(person.id)}
                          onChange={(e) => handleInterviewerToggle(person.id, e.target.checked)}
                          className="rounded-md h-4 w-4 text-[#1f52cc] border-slate-300 focus:ring-[#1f52cc]"
                        />
                        <span className="text-sm font-medium text-slate-700">
                          {person.fullName} <span className="text-[10px] text-slate-400 font-normal">({person.role})</span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Date/Time + Slot */}
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Start Date &amp; Time</label>
              {/* Split into date + time so the browser always shows DD/MM/YYYY (Indian standard) */}
              <div className="flex items-center gap-2">
                {/* Date picker */}
                <div className="relative flex-1 date-input-container">
                  <input
                    type="date"
                    required
                    value={scheduleForm.scheduledStart ? scheduleForm.scheduledStart.slice(0, 10) : ''}
                    onChange={handleDatePartChange}
                    min={localToday}
                    style={{ colorScheme: 'light' }}
                    aria-label="Start date"
                  />
                  {/* Calendar icon */}
                  <span className="material-symbols-outlined absolute right-3 top-2.5 text-slate-400 pointer-events-none text-base">
                    calendar_month
                  </span>
                </div>
                {/* Time picker */}
                <div className="relative w-32 date-input-container">
                  <input
                    type="time"
                    required
                    value={scheduleForm.scheduledStart ? scheduleForm.scheduledStart.slice(11, 16) : ''}
                    onChange={handleTimePartChange}
                    style={{ colorScheme: 'light' }}
                    aria-label="Start time"
                  />
                  {/* Clock icon */}
                  <span className="material-symbols-outlined absolute right-3 top-2.5 text-slate-400 pointer-events-none text-base">
                    schedule
                  </span>
                </div>
              </div>

              {/* Auto-computed slot indicator */}
              {scheduleForm.scheduledStart && (
                <div className={`flex items-center gap-2 mt-2 px-3 py-2 rounded-xl border text-xs font-semibold ${
                  slotInfo.slotExceeded
                    ? 'bg-rose-50 border-rose-200 text-rose-700'
                    : slotInfo.slotNo >= 5
                      ? 'bg-amber-50 border-amber-200 text-amber-700'
                      : 'bg-blue-50 border-blue-200 text-blue-700'
                }`}>
                  <span className="material-symbols-outlined text-sm">
                    {slotInfo.slotExceeded ? 'block' : 'confirmation_number'}
                  </span>
                  {slotInfo.slotExceeded
                    ? `Slot limit exceeded — ${slotInfo.slotCount} interviews already booked for this hour (max 7). Please choose a different time.`
                    : slotInfo.slotNo === 1
                      ? 'Slot 1 — first booking for this time slot'
                      : `Slot ${slotInfo.slotNo} — ${slotInfo.slotCount} other interview${slotInfo.slotCount !== 1 ? 's' : ''} already in this hour`
                  }
                </div>
              )}
            </div>

            {/* Links */}
            {scheduleForm.mode !== 'WALK_IN_DRIVE' && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Meeting Link</label>
                  <input
                    type="url"
                    className="h-10 w-full rounded-xl border border-slate-200 px-4 text-xs focus:border-[#1f52cc] outline-none"
                    placeholder="e.g. Google Meet / Zoom"
                    value={scheduleForm.meetingLink}
                    onChange={handleMeetingLinkChange}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Zoho Link</label>
                  <input
                    type="url"
                    className="h-10 w-full rounded-xl border border-slate-200 px-4 text-xs focus:border-[#1f52cc] outline-none"
                    placeholder="e.g. Zoho Meeting URL"
                    value={scheduleForm.zohoLink}
                    onChange={handleZohoLinkChange}
                  />
                </div>
              </div>
            )}

            {/* Phone, Email & Morning Follow-ups */}
            {scheduleForm.mode !== 'WALK_IN_DRIVE' && (
              <div className="grid grid-cols-3 gap-4 border-t border-slate-100 pt-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-500 ml-1 block">Phone Follow-up</label>
                  {scheduleForm.phoneFollowUp ? (
                    <div className="flex items-center justify-between bg-slate-50 p-2 rounded-xl border border-slate-200 text-xs">
                      <span className="truncate max-w-[120px] font-medium text-slate-700">{scheduleForm.phoneFollowUp.name}</span>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => setScheduleForm(prev => ({ ...prev, phoneFollowUp: null }))}
                          className="text-red-500 hover:text-red-700 flex items-center justify-center"
                        >
                          <span className="material-symbols-outlined text-sm">delete</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {isAdmin ? (
                        <>
                          <input
                            type="file"
                            id="phone-followup-upload"
                            className="hidden"
                            accept={ACCEPT_ATTRIBUTE}
                            onChange={async (e) => {
                              const file = e.target.files[0];
                              if (file) {
                                const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
                                if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
                                  alert(ERROR_UNSUPPORTED);
                                  return;
                                }
                                if (file.size > MAX_UPLOAD_BYTES) {
                                  alert(ERROR_TOO_LARGE);
                                  return;
                                }
                                const base64 = await fileToBase64(file);
                                setScheduleForm(prev => ({ ...prev, phoneFollowUp: base64 }));
                              }
                            }}
                          />
                          <label
                            htmlFor="phone-followup-upload"
                            className="cursor-pointer text-[10px] text-blue-600 hover:underline font-semibold flex items-center gap-1"
                          >
                            <span className="material-symbols-outlined text-xs">add</span> Add phone
                          </label>
                        </>
                      ) : null}
                      <div className="text-[9px] text-rose-500 font-bold">Didn't upload</div>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-500 ml-1 block">Email Follow-up</label>
                  {scheduleForm.emailFollowUp ? (
                    <div className="flex items-center justify-between bg-slate-50 p-2 rounded-xl border border-slate-200 text-xs">
                      <span className="truncate max-w-[120px] font-medium text-slate-700">{scheduleForm.emailFollowUp.name}</span>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => setScheduleForm(prev => ({ ...prev, emailFollowUp: null }))}
                          className="text-red-500 hover:text-red-700 flex items-center justify-center"
                        >
                          <span className="material-symbols-outlined text-sm">delete</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {isAdmin ? (
                        <>
                          <input
                            type="file"
                            id="email-followup-upload"
                            className="hidden"
                            accept={ACCEPT_ATTRIBUTE}
                            onChange={async (e) => {
                              const file = e.target.files[0];
                              if (file) {
                                const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
                                if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
                                  alert(ERROR_UNSUPPORTED);
                                  return;
                                }
                                if (file.size > MAX_UPLOAD_BYTES) {
                                  alert(ERROR_TOO_LARGE);
                                  return;
                                }
                                const base64 = await fileToBase64(file);
                                setScheduleForm(prev => ({ ...prev, emailFollowUp: base64 }));
                              }
                            }}
                          />
                          <label
                            htmlFor="email-followup-upload"
                            className="cursor-pointer text-[10px] text-blue-600 hover:underline font-semibold flex items-center gap-1"
                          >
                            <span className="material-symbols-outlined text-xs">add</span> Add email
                          </label>
                        </>
                      ) : null}
                      <div className="text-[9px] text-rose-500 font-bold">Didn't upload</div>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-500 ml-1 block">Morning Follow-up</label>
                  {scheduleForm.morningFollowUp ? (
                    <div className="flex items-center justify-between bg-slate-50 p-2 rounded-xl border border-slate-200 text-xs">
                      <span className="truncate max-w-[120px] font-medium text-slate-700">{scheduleForm.morningFollowUp.name}</span>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => setScheduleForm(prev => ({ ...prev, morningFollowUp: null }))}
                          className="text-red-500 hover:text-red-700 flex items-center justify-center"
                        >
                          <span className="material-symbols-outlined text-sm">delete</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {isAdmin ? (
                        <>
                          <input
                            type="file"
                            id="morning-followup-upload"
                            className="hidden"
                            accept={ACCEPT_ATTRIBUTE}
                            onChange={async (e) => {
                              const file = e.target.files[0];
                              if (file) {
                                const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
                                if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
                                  alert(ERROR_UNSUPPORTED);
                                  return;
                                }
                                if (file.size > MAX_UPLOAD_BYTES) {
                                  alert(ERROR_TOO_LARGE);
                                  return;
                                }
                                const base64 = await fileToBase64(file);
                                setScheduleForm(prev => ({ ...prev, morningFollowUp: base64 }));
                              }
                            }}
                          />
                          <label
                            htmlFor="morning-followup-upload"
                            className="cursor-pointer text-[10px] text-blue-600 hover:underline font-semibold flex items-center gap-1"
                          >
                            <span className="material-symbols-outlined text-xs">add</span> Add morning
                          </label>
                        </>
                      ) : null}
                      <div className="text-[9px] text-rose-500 font-bold">Didn't upload</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Contact Attempts Buttons */}
            {scheduleForm.candidateId && scheduleForm.mode !== 'WALK_IN_DRIVE' && (
              <div className="flex items-center justify-between bg-slate-50 p-3 rounded-2xl border border-slate-200 mt-3">
                <span className="text-[11px] font-bold text-slate-600">Contact Actions:</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setContactAttemptType('DIDNT_PICK_UP')}
                    className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 text-xs font-semibold flex items-center gap-1 border border-amber-200 transition-colors cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-xs">phone_missed</span>
                    Didn't Pick Up
                  </button>
                </div>
              </div>
            )}

            {contactAttemptType && scheduleForm.candidateId && (
              <ContactAttemptPopover
                attemptType={contactAttemptType}
                label={contactAttemptType === 'DIDNT_PICK_UP' ? "Didn't Pick Up" : 'Morning Follow-up'}
                submitting={loggingAttempt}
                onCancel={() => setContactAttemptType(null)}
                onSubmit={async ({ photoUrl, note }) => {
                  setLoggingAttempt(true);
                  try {
                    await schedulingApi.logContactAttempt(scheduleForm.candidateId, {
                      attemptType: contactAttemptType,
                      photoUrl,
                      note,
                    });
                    setContactAttemptType(null);
                  } catch (err) {
                    setError(err.message || 'Failed to log contact attempt');
                  } finally {
                    setLoggingAttempt(false);
                  }
                }}
              />
            )}

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                className="flex-1 h-11 rounded-xl border border-slate-200 font-bold text-slate-500 hover:bg-slate-50 transition-all"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 h-11 rounded-xl bg-[#1f52cc] text-white font-bold shadow-lg shadow-blue-200 hover:bg-[#1844b0] transition-all disabled:opacity-50"
                disabled={savingSchedule || slotInfo.slotExceeded || nextDerivedRound === null || priorRoundFeedbackMissing}
                title={
                  nextDerivedRound === null
                    ? 'All 4 rounds completed'
                    : priorRoundFeedbackMissing
                    ? `Submit ${priorRoundLabel} feedback first`
                    : slotInfo.slotExceeded
                    ? 'Slot limit exceeded for this time'
                    : ''
                }
              >
                {savingSchedule
                  ? 'Scheduling...'
                  : nextDerivedRound === null
                  ? 'All 4 Rounds Completed'
                  : priorRoundFeedbackMissing
                  ? `Submit ${priorRoundLabel} Feedback First`
                  : slotInfo.slotExceeded
                  ? 'Slot Full'
                  : 'Confirm Schedule'}
              </button>
            </div>

          </form>
        </div>
      </div>
    </div>
  );
});
ScheduleModal.displayName = 'ScheduleModal';
