import * as React from 'react';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { API_BASE_URL, API_ROOT_URL, apiGet, apiGetBlob, apiPost, getStoredUser } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';
import EditInterviewModal from '../components/Interview/EditInterviewModal';
import { subscribeSSE } from '../lib/sse';
import ExcelView from '../components/Interview/ExcelView';
import { groupInterviewsByDate, toDateKey, formatTime12h, getStatusStyle, getCandidateInitials } from '../lib/groupInterviewsByDate';

import { useRoundsList, useCreateRound, useSubmitFeedback, useRescheduleRound, useUpdatePanel, useSaveMeetLink, useTransferCandidate, useDeleteRound } from '../hooks/useScheduling';
import { schedulingApi } from '../services/schedulingApi';
import SyncIndicator from '../components/Interview/SyncIndicator';
import InterviewMemberSkeleton from '../components/Interview/InterviewMemberSkeleton';
import { useDebounce } from '../hooks/useDebounce';

const SSE_RELOAD_DEBOUNCE = 8000; // 8s minimum between SSE-triggered reloads

// File upload/download helpers for follow-ups (base64 storage for performance and zero DB schema breakage)
const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve({ name: file.name, data: reader.result, type: file.type });
    reader.onerror = error => reject(error);
  });
};

const downloadBase64File = (fileName, base64Data) => {
  const link = document.createElement('a');
  link.href = base64Data;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const formatDateTimeIN = (dateStr) => {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day}/${month}/${year}, ${hours}:${minutes}:${seconds} ${ampm}`;
};

const parseNotesSafely = (notesStr) => {
  if (!notesStr) return { phoneFollowUp: null, emailFollowUp: null, nextSchedule: null };
  try {
    const parsed = JSON.parse(notesStr);
    if (parsed && typeof parsed === 'object') {
      return {
        phoneFollowUp: parsed.phoneFollowUp || null,
        emailFollowUp: parsed.emailFollowUp || null,
        nextSchedule: parsed.nextSchedule || null
      };
    }
  } catch (e) {}
  return { phoneFollowUp: null, emailFollowUp: null, nextSchedule: null };
};

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
  slotNo: 1,   // auto-computed slot number for the chosen time
  nextSchedule: '',
};

const emptyFeedbackForm = {
  technicalRating: 4,
  communicationRating: 4,
  cultureFitRating: 4,
  strengths: '',
  weaknesses: '',
  recommendation: 'SELECTED',
  overallComments: '',
  offerPhoneFollowUp: null,
  offerEmailFollowUp: null,
};

/**
 * CalendarCell — renders a single day cell in the Calendar Grid view.
 *
 * @param {object} props
 * @param {Date}     props.date           - The calendar date this cell represents
 * @param {boolean}  props.isCurrentMonth - Whether this date is in the displayed month
 * @param {boolean}  props.isToday        - Whether this date is today
 * @param {Function} props.onSelectDate   - Called when the cell is clicked
 * @param {object[]} props.cellInterviews - Already-filtered interviews for this specific date
 * @param {object[]} props.cellJoinings   - Application joinings for this date
 * @param {Function} props.onChipClick    - Called when an interview chip is clicked: (candidateId, interviewId)
 */
function CalendarCell({ date, isCurrentMonth, isToday, onSelectDate, cellInterviews = [], cellJoinings = [], onChipClick }) {
  // Group by candidate and keep only the latest round
  const uniqueInterviews = React.useMemo(() => {
    const candidateMap = new Map();
    for (const iv of cellInterviews) {
      const cId = iv.application?.candidate?.id || iv.application?.candidateId || iv.candidateId || iv.id;
      const existing = candidateMap.get(cId);
      if (!existing) {
        candidateMap.set(cId, iv);
      } else {
        const currentRound = iv.roundNo === 99 ? 99 : (iv.roundNo || 1);
        const existingRound = existing.roundNo === 99 ? 99 : (existing.roundNo || 1);
        if (currentRound > existingRound) {
          candidateMap.set(cId, iv);
        } else if (currentRound === existingRound) {
          const currentTime = new Date(iv.scheduledStart).getTime();
          const existingTime = new Date(existing.scheduledStart).getTime();
          if (currentTime > existingTime) {
            candidateMap.set(cId, iv);
          }
        }
      }
    }
    // Sort them by scheduledStart to keep chronological order
    return Array.from(candidateMap.values()).sort(
      (a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime()
    );
  }, [cellInterviews]);

  const MAX_CHIPS = 4;
  const visible = uniqueInterviews.slice(0, MAX_CHIPS);
  const overflow = cellInterviews.length - visible.length;

  return (
    <div
      className={`relative min-h-[110px] p-2 border-r border-b border-[#e4ebf1] transition-all hover:bg-[#f8fafc] cursor-pointer group ${
        !isCurrentMonth ? 'bg-[#fcfdfe] opacity-40' : 'bg-white'
      } ${isToday ? 'ring-2 ring-inset ring-[#1f52cc] z-10 shadow-lg' : ''}`}
      onClick={() => onSelectDate(date)}
    >
      {/* Date number + joining badge */}
      <div className="flex justify-between items-start mb-1">
        <span className={`text-sm font-semibold ${isToday ? 'text-[#1f52cc]' : 'text-[#64748b]'}`}>
          {date.getDate()}
        </span>
        {cellJoinings.length > 0 && (
          <div className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[9px] font-bold rounded flex items-center gap-1">
            <span className="material-symbols-outlined text-[10px]">celebration</span>
            {cellJoinings.length}
          </div>
        )}
      </div>

      {/* Interview event chips — up to MAX_CHIPS visible */}
      <div className="flex flex-col gap-[3px]">
        {visible.map((iv) => {
          const name = iv.application?.candidate?.fullName || iv.candidateName || '?';
          const initials = getCandidateInitials(name);
          const roundLabel = iv.roundNo === 99 ? 'F' : `R${iv.roundNo || 1}`;
          const timeLabel = iv.scheduledStart ? formatTime12h(new Date(iv.scheduledStart)) : '';
          const { bg, text, dot } = getStatusStyle(iv.result);
          return (
            <button
              key={iv.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const cId = iv.application?.candidate?.id || iv.application?.candidateId || iv.candidateId;
                onChipClick(cId, iv.id);
              }}
              className={`w-full flex items-center gap-1 px-1.5 py-[2px] rounded text-left transition-all hover:brightness-95 ${bg}`}
              title={`${name} — ${roundLabel} — ${timeLabel}`}
            >
              {/* Status dot */}
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
              {/* Initials avatar */}
              <span className={`text-[8px] font-bold shrink-0 ${text}`}>{initials}</span>
              {/* Name truncated */}
              <span className={`text-[9px] font-semibold truncate flex-1 ${text}`}>
                {name.split(' ')[0]}
              </span>
              {/* Round badge */}
              <span className={`text-[8px] font-bold shrink-0 ${text} opacity-70`}>{roundLabel}</span>
            </button>
          );
        })}

        {/* +N more pill */}
        {overflow > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectDate(date);
            }}
            className="w-full text-center text-[9px] font-bold text-[#1f52cc] bg-blue-50 hover:bg-blue-100 rounded py-[2px] transition-all"
          >
            +{overflow} more
          </button>
        )}
      </div>
    </div>
  );
}

const MemoizedCalendarCell = React.memo(CalendarCell);

/**
 * ScheduleModal — fully extracted & memoized so form-field changes don't
 * re-render the entire InterviewSchedule page. This is the key fix for the
 * "glitching" the user reported.
 */
const ScheduleModal = React.memo(function ScheduleModal({
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
  searchingCandidates,
  searchingJobs,
  savingSchedule,
  onClose,
  onSubmit,
  allInterviews,
}) {
  const currentUser = getStoredUser();
  const isAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'RECRUITER';

  const handleRoundChange = React.useCallback((e) => {
    const val = e.target.value;
    setScheduleForm(prev => ({
      ...prev,
      roundNo: val === 'Final' ? 99 : parseInt(val, 10),
      round: val === 'Final' ? 'Final Round' : `Round ${val}`,
    }));
  }, [setScheduleForm]);

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
    const candInterviews = allInterviews.filter(
      iv => (iv.application?.candidate?.id || iv.application?.candidateId) === c.id && !iv._optimistic
    );
    const nextRound = candInterviews.length + 1;
    setScheduleForm(prev => ({
      ...prev,
      candidateId: c.id,
      roundNo: nextRound,
      round: `Round ${nextRound}`,
    }));
    setCandidateSearch(c.fullName);
    setShowCandidateList(false);
  }, [allInterviews, setScheduleForm, setCandidateSearch, setShowCandidateList]);

  const handleJobSelect = React.useCallback((j) => {
    setScheduleForm(prev => ({ ...prev, jobId: j.id }));
    setJobSearch(j.title);
    setShowJobList(false);
  }, [setScheduleForm, setJobSearch, setShowJobList]);

  const filteredInterviewerList = React.useMemo(() => {
    if (!interviewerSearch) return interviewers;
    const q = interviewerSearch.toLowerCase();
    return interviewers.filter(p =>
      p.fullName.toLowerCase().includes(q) || p.role.toLowerCase().includes(q)
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
    const sameSlotInterviews = allInterviews.filter(iv => {
      if (iv._optimistic) return false;
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
                <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Interview Round</label>
                <select
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-[#1f52cc] outline-none"
                  value={scheduleForm.roundNo === 99 ? 'Final' : scheduleForm.roundNo}
                  onChange={handleRoundChange}
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
                  onChange={handleModeChange}
                >
                  <option value="ONLINE">Online Meeting</option>
                  <option value="IN_PERSON">In Person</option>
                  <option value="PHONE">Phone Call</option>
                  <option value="DRIVE">Drive Meeting</option>
                </select>
              </div>
            </div>

            {/* Interviewers */}
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
                {filteredInterviewerList.map((person) => (
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
                ))}
                {filteredInterviewerList.length === 0 && (
                  <div className="text-xs text-slate-400 text-center py-2 italic">No interviewers match filter</div>
                )}
              </div>
            </div>

            {/* Date/Time + Slot */}
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Start Date &amp; Time</label>
              {/* Split into date + time so the browser always shows DD/MM/YYYY (Indian standard) */}
              <div className="flex items-center gap-2">
                {/* Date picker — guarantees DD/MM/YYYY placeholder and display format */}
                <div className="relative flex-1">
                  {/* Visible text input showing formatted value or placeholder */}
                  <input
                    type="text"
                    className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm focus:border-[#1f52cc] outline-none bg-white text-slate-800 font-medium"
                    placeholder="dd/mm/yyyy"
                    readOnly
                    value={
                      scheduleForm.scheduledStart && scheduleForm.scheduledStart.slice(0, 10)
                        ? (() => {
                            const [y, m, d] = scheduleForm.scheduledStart.slice(0, 10).split('-');
                            return `${d}/${m}/${y}`;
                          })()
                        : ''
                    }
                  />
                  {/* Calendar icon */}
                  <span className="material-symbols-outlined absolute right-3 top-3.5 text-slate-400 pointer-events-none text-base">
                    calendar_month
                  </span>
                  {/* Hidden native input on top that opens native picker on click */}
                  <input
                    type="date"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    required
                    value={scheduleForm.scheduledStart ? scheduleForm.scheduledStart.slice(0, 10) : ''}
                    onChange={handleDatePartChange}
                    style={{ colorScheme: 'light' }}
                  />
                </div>
                {/* Time picker */}
                <input
                  type="time"
                  className="h-11 w-32 rounded-xl border border-slate-200 px-3 text-sm focus:border-[#1f52cc] outline-none"
                  required
                  value={scheduleForm.scheduledStart ? scheduleForm.scheduledStart.slice(11, 16) : ''}
                  onChange={handleTimePartChange}
                  style={{ colorScheme: 'light' }}
                />
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

            {/* Phone & Email Follow-ups */}
            <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4">
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
                          onChange={async (e) => {
                            const file = e.target.files[0];
                            if (file) {
                              const base64 = await fileToBase64(file);
                              setScheduleForm(prev => ({ ...prev, phoneFollowUp: base64 }));
                            }
                          }}
                        />
                        <label
                          htmlFor="phone-followup-upload"
                          className="cursor-pointer text-xs text-blue-600 hover:underline font-semibold flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-sm">add</span> Add phone follow-up
                        </label>
                      </>
                    ) : null}
                    <div className="text-[10px] text-rose-500 font-bold">Didn't upload</div>
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
                          onChange={async (e) => {
                            const file = e.target.files[0];
                            if (file) {
                              const base64 = await fileToBase64(file);
                              setScheduleForm(prev => ({ ...prev, emailFollowUp: base64 }));
                            }
                          }}
                        />
                        <label
                          htmlFor="email-followup-upload"
                          className="cursor-pointer text-xs text-blue-600 hover:underline font-semibold flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-sm">add</span> Add email follow-up
                        </label>
                      </>
                    ) : null}
                    <div className="text-[10px] text-rose-500 font-bold">Didn't upload</div>
                  </div>
                )}
              </div>
            </div>

            {scheduleForm.roundNo > 1 && (
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Next Schedule</label>
                <textarea
                  className="w-full rounded-xl border border-slate-200 p-3 text-xs min-h-[60px] focus:border-[#1f52cc] outline-none transition-all"
                  placeholder="Enter details for the next schedule..."
                  value={scheduleForm.nextSchedule || ''}
                  onChange={(e) => setScheduleForm(prev => ({ ...prev, nextSchedule: e.target.value }))}
                />
              </div>
            )}

            <div className="flex gap-3 pt-6">
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
                disabled={savingSchedule || slotInfo.slotExceeded}
                title={slotInfo.slotExceeded ? 'Slot limit exceeded for this time — choose a different hour' : ''}
              >
                {savingSchedule ? 'Scheduling...' : slotInfo.slotExceeded ? 'Slot Full' : 'Confirm Schedule'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
});

const InterviewSchedule = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const jobIdParam = searchParams.get('jobId');
  const interviewIdParam = searchParams.get('interviewId');
  const shouldSubmitFeedback = searchParams.get('submitFeedback') === 'true';
  const [activeInterviewId, setActiveInterviewId] = useState('');

  // cursor-based load-more state
  const [loadingMore, setLoadingMore] = useState(false);
  const [allInterviews, setAllInterviews] = useState([]);  // accumulates pages
  const [serverHasMore, setServerHasMore] = useState(false);
  const [serverNextCursor, setServerNextCursor] = useState(null);

  const { data: roundsResponse, isLoading: isQueryLoading, refetch: refetchInterviews, error: queryError } = useRoundsList({ limit: 50 });
  const loading = isQueryLoading;
  const createRoundMutation = useCreateRound();
  const submitFeedbackMutation = useSubmitFeedback();
  const rescheduleMutation = useRescheduleRound();
  const updatePanelMutation = useUpdatePanel();
  const saveMeetLinkMutation = useSaveMeetLink();
  const transferCandidateMutation = useTransferCandidate();
  const deleteRoundMutation = useDeleteRound();

  // Base query page 1 seed — handled below in the unified useEffect to avoid TDZ issues.

  useEffect(() => {
    if (queryError) {
      setError(queryError.message || 'Failed to load interviews');
    }
  }, [queryError]);

  const interviews = useMemo(() => {
    const groups = {};
    allInterviews.forEach(iv => {
      if (!iv.scheduledStart || iv._optimistic) return;
      const d = new Date(iv.scheduledStart);
      const key = `${d.toDateString()}_${d.getHours()}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(iv);
    });

    Object.values(groups).forEach(list => {
      list.sort((a, b) => {
        const timeA = new Date(a.scheduledStart).getTime();
        const timeB = new Date(b.scheduledStart).getTime();
        if (timeA !== timeB) return timeA - timeB;
        return String(a.id).localeCompare(String(b.id));
      });
    });

    return allInterviews.map(iv => {
      if (!iv.scheduledStart) return iv;
      const d = new Date(iv.scheduledStart);
      const key = `${d.toDateString()}_${d.getHours()}`;
      const list = groups[key] || [];
      const idx = list.findIndex(item => item.id === iv.id);
      return {
        ...iv,
        slotNo: idx !== -1 ? idx + 1 : iv.slotNo || 1
      };
    });
  }, [allInterviews]);

  const [applications, setApplications] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [interviewers, setInterviewers] = useState([]);
  const [candidateSuggestions, setCandidateSuggestions] = useState([]);
  const [jobSuggestions, setJobSuggestions] = useState([]);
  const [searchingCandidates, setSearchingCandidates] = useState(false);
  const [searchingJobs, setSearchingJobs] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');
  const [scheduleForm, setScheduleForm] = useState(emptyScheduleForm);
  const [feedbackForm, setFeedbackForm] = useState(emptyFeedbackForm);
  const [savingSchedule, setSavingSchedule] = useState(false);
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
  const [calendarData, setCalendarData] = useState(() => new Map());
  // Search: raw typed value (not yet debounced)
  const [interviewListSearch, setInterviewListSearch] = useState('');
  // Debounced version sent to the backend
  const debouncedSearch = useDebounce(interviewListSearch, 300);
  const [jobSearch, setJobSearch] = useState('');
  const [candidateSearch, setCandidateSearch] = useState('');
  const [interviewerSearch, setInterviewerSearch] = useState('');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferringInterview, setTransferringInterview] = useState(null);
  const [editingInterviewId, setEditingInterviewId] = useState(null);
  const [isEditingFeedback, setIsEditingFeedback] = useState(false);
  const [showCandidateList, setShowCandidateList] = useState(false);
  const [showJobList, setShowJobList] = useState(false);
  // Infinite scroll: how many items to show
  const [visibleCount, setVisibleCount] = useState(20);
  const listEndRef = useRef(null);        // sentinel for IntersectionObserver
  const listPanelRef = useRef(null);     // scrollable container ref for IntersectionObserver root
  const lastCandidateJobKeyRef = useRef('');
  const currentUser = getStoredUser();
  const isAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'RECRUITER';
  const [filterMine, setFilterMine] = useState(currentUser?.role === 'INTERVIEWER');
  const [roundFilter, setRoundFilter] = useState('all'); // 'all', '1', '2'
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  // FORCE TRUE FOR VERIFICATION
  const canScheduleInterview = true;
  const recorderSupported = typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined';


  // Load-more: fetch next page using cursor
  const loadMoreInterviews = useCallback(async () => {
    if (!serverHasMore || loadingMore || !serverNextCursor) return;
    setLoadingMore(true);
    try {
      const nextFilters = {
        cursor: serverNextCursor,
        limit: 200,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(filterMine ? { interviewerId: currentUser?.id } : {})
      };
      const res = await schedulingApi.getRounds(nextFilters);
      const nextPage = res?.data || [];
      setAllInterviews(prev => {
        const map = new Map(prev.map(iv => [iv.id, iv]));
        nextPage.forEach(iv => map.set(iv.id, iv));
        return Array.from(map.values());
      });
      setServerHasMore(res?.hasMore || false);
      setServerNextCursor(res?.nextCursor || null);
      setVisibleCount(prev => prev + nextPage.length);
    } catch (err) {
      console.error('[InterviewSchedule] load-more error:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [serverHasMore, loadingMore, serverNextCursor, debouncedSearch, filterMine, currentUser?.id]);

  // Prefetch next page silently when current page is loaded
  useEffect(() => {
    if (serverHasMore && serverNextCursor) {
      const nextFilters = {
        cursor: serverNextCursor,
        limit: 20,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(filterMine ? { interviewerId: currentUser?.id } : {})
      };
      queryClient.prefetchQuery({
        queryKey: ['scheduling', 'rounds', nextFilters],
        queryFn: () => schedulingApi.getRounds(nextFilters),
        staleTime: 30000,
      });
    }
  }, [serverNextCursor, serverHasMore, debouncedSearch, filterMine, currentUser?.id, queryClient]);

  // ── Calendar/Excel bulk-load: when user switches to a non-list view, immediately
  // fetch all remaining pages so every interview is visible in the grid.
  // This prevents the "only 20 interviews shown" problem caused by pagination.
  const bulkLoadAllRef = useRef(false);
  useEffect(() => {
    if (viewMode !== 'calendar' && viewMode !== 'excel') {
      bulkLoadAllRef.current = false; // reset so next calendar visit re-triggers
      return;
    }
    if (bulkLoadAllRef.current) return;   // already triggered for this session
    if (!serverHasMore || !serverNextCursor) return; // nothing more to load

    bulkLoadAllRef.current = true;

    const fetchAllRemaining = async () => {
      let cursor = serverNextCursor;
      let hasMore = serverHasMore;
      while (hasMore && cursor) {
        try {
          // Non-blocking 1s delay to load down pages slowly in the background
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const res = await schedulingApi.getRounds({ cursor, limit: 200 });
          const nextPage = res?.data || [];
          if (nextPage.length > 0) {
            setAllInterviews(prev => {
              // Merge without duplicates using a Map keyed by id
              const map = new Map(prev.map(iv => [iv.id, iv]));
              nextPage.forEach(iv => map.set(iv.id, iv));
              return Array.from(map.values());
            });
          }
          hasMore = res?.hasMore || false;
          cursor  = res?.nextCursor || null;
          setServerHasMore(hasMore);
          setServerNextCursor(cursor);
        } catch (err) {
          console.error('[InterviewSchedule] calendar bulk-load error:', err);
          break;
        }
      }
    };

    fetchAllRemaining();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, serverHasMore, serverNextCursor]);


  const [supportingDataLoaded, setSupportingDataLoaded] = useState(false);

  useEffect(() => {
    if (supportingDataLoaded) return;
    if (viewMode !== 'calendar' && !showScheduleModal) return;

    const loadSupportingData = async () => {
      try {
        const [applicationsRes, jobsRes] = await Promise.all([
          apiGet('/applications?limit=200'),
          apiGet('/jobs?limit=50&isActive=true'),
        ]);
        setApplications(applicationsRes.data || []);
        setJobs(jobsRes.data || []);
        setJobSuggestions(jobsRes.data || []);

        let interviewerList = [];
        try {
          const interviewerRes = await apiGet('/users/interviewers');
          interviewerList = interviewerRes.data || [];
        } catch (_) {
          const seen = new Set();
          interviews.forEach(iv => {
            (iv.interviewers || []).forEach(u => {
              if (u?.id && !seen.has(u.id)) {
                seen.add(u.id);
                interviewerList.push(u);
              }
            });
          });
        }
        setInterviewers(interviewerList);
        setSupportingDataLoaded(true);
      } catch (err) {
        console.error('Failed to load scheduler supporting data:', err);
      }
    };

    loadSupportingData();
  }, [viewMode, showScheduleModal, supportingDataLoaded, interviews]);

  const debouncedCandidateSearch = useDebounce(candidateSearch, 300);
  const debouncedJobSearch = useDebounce(jobSearch, 300);

  useEffect(() => {
    if (!showScheduleModal) return;
    let active = true;

    const fetchCandidates = async () => {
      try {
        setSearchingCandidates(true);
        const res = await apiGet(`/candidates?search=${encodeURIComponent(debouncedCandidateSearch)}&limit=20`);
        if (!active) return;
        setCandidateSuggestions(res.data || res.items || []);
      } catch (err) {
        console.error('Failed to search candidates:', err);
      } finally {
        if (active) setSearchingCandidates(false);
      }
    };

    fetchCandidates();

    return () => {
      active = false;
    };
  }, [debouncedCandidateSearch, showScheduleModal]);

  useEffect(() => {
    if (!showScheduleModal) return;
    let active = true;

    const fetchJobs = async () => {
      try {
        setSearchingJobs(true);
        const res = await apiGet(`/jobs?search=${encodeURIComponent(debouncedJobSearch)}&isActive=true&limit=20`);
        if (!active) return;
        setJobSuggestions(res.data || res.items || []);
      } catch (err) {
        console.error('Failed to search jobs:', err);
      } finally {
        if (active) setSearchingJobs(false);
      }
    };

    fetchJobs();

    return () => {
      active = false;
    };
  }, [debouncedJobSearch, showScheduleModal]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
  }, [recordedUrl]);

  useEffect(() => {
    if (jobIdParam) {
      const interviewWithJob = interviews.find(iv => (iv.application?.job?.id || iv.application?.jobId) === jobIdParam);
      const jobTitle = interviewWithJob?.application?.job?.title;
      if (jobTitle) {
        setInterviewListSearch(jobTitle);
      } else if (jobs.length > 0) {
        const job = jobs.find(j => j.id === jobIdParam);
        if (job) setInterviewListSearch(job.title);
      }
    }
  }, [jobIdParam, interviews, jobs]);

  // Singleton SSE — mark scheduling queries stale on relevant events (no forced reload)
  const lastSSEReloadRef = useRef(0);
  useEffect(() => {
    const RELEVANT = [
      'INTERVIEW_PANELISTS_UPDATED', 'INTERVIEW_FEEDBACK_SUBMITTED',
      'APPLICATION_STATUS_UPDATED', 'INTERVIEW_SCHEDULED',
      'CANDIDATE_UPDATED', 'CANDIDATE_CREATED'
    ];
    const unsub = subscribeSSE((data) => {
      if (!RELEVANT.includes(data.type)) return;
      const now = Date.now();
      if (now - lastSSEReloadRef.current < SSE_RELOAD_DEBOUNCE) return;
      lastSSEReloadRef.current = now;
      // Mark scheduling queries as stale and trigger immediate refetch for real-time sync.
      queryClient.invalidateQueries({
        queryKey: ['scheduling', 'rounds'],
        refetchType: 'active',
      });
      if (data.type === 'INTERVIEW_PANELISTS_UPDATED') setBanner('Interviewer transferred in real-time!');
    }, RELEVANT);
    return () => { unsub(); };
  }, [queryClient]);

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

  // ── Search: re-fetch from server ONLY when there is an active query ──
  // Using `enabled: false` equivalent — only pass filters when debouncedSearch exists.
  // This prevents a second /interviews request on every render when idle.
  const { data: searchResponse, isFetching: isSearching } = useRoundsList(
    debouncedSearch
      ? { search: debouncedSearch, limit: 10000, ...(filterMine ? { interviewerId: currentUser?.id } : {}) }
      : null  // null → hook is disabled (handled in useRoundsList)
  );

  // Unified useEffect to handle page 1 results for both normal and search lists
  useEffect(() => {
    const activeResponse = debouncedSearch ? searchResponse : roundsResponse;
    if (!activeResponse) return;
    const firstPage = activeResponse.data || [];
    setAllInterviews(firstPage);
    setServerHasMore(activeResponse.hasMore || false);
    setServerNextCursor(activeResponse.nextCursor || null);
  }, [roundsResponse, searchResponse, debouncedSearch]);

  const displayInterviews = interviews;

  // ── filteredForViews: single source of truth for Calendar + Excel (respects filterMine + roundFilter) ──
  // This is the same filtering logic used by groupedApplications but returns a flat array.
  const filteredForViews = useMemo(() => {
    let filtered = filterMine
      ? displayInterviews.filter(iv => iv.interviewerIds?.includes(currentUser?.id))
      : displayInterviews;

    if (roundFilter !== 'all') {
      const targetRound = parseInt(roundFilter, 10);
      filtered = filtered.filter(iv => (iv.roundNo || 0) === targetRound);
    }

    return filtered;
  }, [displayInterviews, filterMine, currentUser?.id, roundFilter]);


  // ── groupedApplications: built purely from interviews data, no candidates limit ──
  const groupedApplications = useMemo(() => {
    const map = new Map();

    const filteredInterviews = filterMine
      ? displayInterviews.filter(iv => iv.interviewerIds?.includes(currentUser?.id))
      : displayInterviews;

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
          createdAt: 0,
        });
      }
      const group = map.get(cId);
      // Skip duplicate temp entries that got replaced by server data
      if (!group.interviews.find(iv => iv.id === interview.id)) {
        group.interviews.push(interview);
      }
      // Always keep ascending roundNo order — this is the source of truth for tab rendering
      group.interviews.sort((a, b) => (a.roundNo ?? 0) - (b.roundNo ?? 0));

      // Track latest interview by scheduledStart date for sidebar sorting
      const isCurrent = !group.latestInterview || 
        new Date(interview.scheduledStart) > new Date(group.latestInterview.scheduledStart);
      if (isCurrent) {
        group.latestInterview = interview;
        if (!group.application?.id) {
          group.application = interview.application;
          group.applicationId = interview.applicationId;
        }
      }
    });

    let groupsList = Array.from(map.values());

    if (roundFilter !== 'all') {
      const targetRound = parseInt(roundFilter, 10);
      groupsList = groupsList.filter(group => {
        const activeInterviews = (group.interviews || []).filter(iv => {
          const isCancelled = iv.status === 'CANCELLED';
          const isDeleted = iv.isDeleted;
          return !isCancelled && !isDeleted;
        });
        const maxRoundNo = activeInterviews.reduce((max, iv) => Math.max(max, iv.roundNo || 0), 0);
        return maxRoundNo === targetRound;
      });
    }

    // Sort groups: newest interview first (descending date, highest to lowest)
    return groupsList.sort((a, b) => {
      const dateA = a.latestInterview?.scheduledStart || a.createdAt;
      const dateB = b.latestInterview?.scheduledStart || b.createdAt;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });
  }, [displayInterviews, filterMine, currentUser?.id, roundFilter]);

  // ── Infinite scroll: reset visible count when list changes ──
  useEffect(() => {
    setVisibleCount(20);
  }, [debouncedSearch, filterMine, roundFilter]);

  // ── Live refs — always hold latest values so the observer never uses stale closures ──
  const serverHasMoreRef = useRef(serverHasMore);
  const loadingMoreRef   = useRef(loadingMore);
  const loadMoreRef2     = useRef(loadMoreInterviews);

  serverHasMoreRef.current = serverHasMore;
  loadingMoreRef.current   = loadingMore;
  loadMoreRef2.current     = loadMoreInterviews;

  // ── Sentinel callback ref — attaches observer when node mounts or state changes ──
  const sentinelCallbackRef = useCallback((node) => {
    // Cleanup any previous observer
    if (listEndRef.current?._obs) {
      listEndRef.current._obs.disconnect();
    }
    listEndRef.current = node;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        // Read live values — never stale
        if (serverHasMoreRef.current && !loadingMoreRef.current) {
          loadMoreRef2.current();
        } else if (!serverHasMoreRef.current) {
          setVisibleCount(prev => prev + 20);
        }
      },
      {
        root: listPanelRef.current || null,
        threshold: 0,
        rootMargin: '150px',
      }
    );
    observer.observe(node);
    node._obs = observer; // store for cleanup
  }, [serverHasMore, loadingMore, displayInterviews.length]);


  // Visible slice for lazy rendering
  const visibleGroups = useMemo(
    () => groupedApplications.slice(0, visibleCount),
    [groupedApplications, visibleCount]
  );

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



  // ── scheduleData: unified calendar grouping using filteredForViews ──
  // Uses the same toDateKey() helper (local Date methods, IST-safe) for BOTH
  // the grouping here and the key lookup in the render loop, so they always match.
  const scheduleData = useMemo(() => {
    // Group filtered interviews by 'YYYY-MM-DD' date key
    const interviewsByDate = groupInterviewsByDate(filteredForViews, viewDate);

    // Build the final Map: keys are still toDateKey strings, values have {interviews, joinings}
    const data = new Map();
    interviewsByDate.forEach((ivList, dateKey) => {
      data.set(dateKey, { interviews: ivList, joinings: [] });
    });

    // Add joinings (applications with a doj date) — not affected by interview filters
    applications.forEach(app => {
      if (!app.doj) return;
      const dateKey = toDateKey(new Date(app.doj));
      if (!data.has(dateKey)) data.set(dateKey, { interviews: [], joinings: [] });
      data.get(dateKey).joinings.push(app);
    });

    return data;
  }, [filteredForViews, viewDate, applications]);

  const selectedGroupId = selectedId || groupedApplications[0]?.applicationId || '';
  const selectedGroup = useMemo(
    () => groupedApplications.find((g) => g.applicationId === selectedGroupId || g.candidateId === selectedGroupId) || groupedApplications[0] || null,
    [groupedApplications, selectedGroupId],
  );

  const selectedCandidate = selectedGroup?.application?.candidate;
  const latestInterview = selectedGroup?.latestInterview;

  const loadCandidateInterviews = useCallback(async (candidateId) => {
    if (!candidateId) return;
    try {
      const res = await apiGet(`/interviews?candidateId=${candidateId}&limit=100`);
      const list = res.data || res.items || [];
      setAllInterviews(prev => {
        const map = new Map(prev.map(i => [i.id, i]));
        list.forEach(i => map.set(i.id, i));
        return Array.from(map.values());
      });
    } catch (err) {
      console.error('Failed to load candidate interviews:', err);
    }
  }, []);

  const loadAll = useCallback(async () => {
    // Refresh the queries list
    refetchInterviews();
    if (selectedCandidate?.id) {
      loadCandidateInterviews(selectedCandidate.id);
    }
  }, [refetchInterviews, selectedCandidate?.id, loadCandidateInterviews]);

  // For the individual interview context (e.g. feedback submission), default to latest
  useEffect(() => {
    if (latestInterview) {
      const list = selectedGroup?.interviews || [];
      if (!activeInterviewId || !list.find(i => i.id === activeInterviewId)) {
        setActiveInterviewId(latestInterview.id);
      }
    } else {
      setActiveInterviewId('');
    }
  }, [latestInterview, selectedGroup?.interviews, activeInterviewId]);

  const selectedInterview = useMemo(
    () => {
      const list = selectedGroup?.interviews || [];
      const activeIv = list.find(i => i.id === activeInterviewId);
      if (activeIv) return activeIv;

      const filtered = filterMine ? list.filter(iv => iv.interviewerIds?.includes(currentUser?.id)) : list;
      return filtered.find(i => i.id === latestInterview?.id) || filtered[0] || latestInterview;
    },
    [selectedGroup, activeInterviewId, latestInterview, filterMine, currentUser?.id]
  );

  const selectedFeedbacks = React.useMemo(() => {
    const raw = selectedInterview?.feedback;
    if (!raw) return [];
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch (e) {
        return [];
      }
    }
    return Array.isArray(raw) ? raw : [];
  }, [selectedInterview?.feedback]);

  const myFeedback = React.useMemo(() => {
    const byMe = selectedFeedbacks.find(
      f => (f.submittedById === currentUser?.id || f.submittedBy?.id === currentUser?.id || f.submittedBy === currentUser?.id)
    );
    if (byMe) return byMe;
    return selectedFeedbacks[0] || null;
  }, [selectedFeedbacks, currentUser?.id]);

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
    setIsEditingFeedback(false);
    if (selectedCandidate?.id) {
      loadCandidateHistory(selectedCandidate.id);
      loadCandidateInterviews(selectedCandidate.id);
    } else {
      setCandidateHistory([]);
    }
  }, [selectedCandidate?.id, loadCandidateInterviews]);

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

  // Auto-sync round number based on application history (only defaults once when candidate/job selection changes)
  // NOTE: `interviews` intentionally omitted from deps — we only want this to fire when candidate/job changes,
  // not every time the interviews list updates (which would cause cascading re-renders & glitching).
  useEffect(() => {
    if (!showScheduleModal) {
      lastCandidateJobKeyRef.current = '';
      return;
    }
    const currentKey = `${scheduleForm.candidateId}_${scheduleForm.jobId}`;
    if (scheduleForm.candidateId && scheduleForm.jobId && currentKey !== lastCandidateJobKeyRef.current) {
      lastCandidateJobKeyRef.current = currentKey;
      const app = applications.find(a => a.candidateId === scheduleForm.candidateId && a.jobId === scheduleForm.jobId);
      if (app) {
        // Read interviews from cache to avoid stale closure; fall back to 1
        const appInterviewsCount = allInterviews.filter(iv => iv.applicationId === app.id && !iv._optimistic).length;
        const nextRound = appInterviewsCount + 1;
        setScheduleForm(prev => ({
          ...prev,
          roundNo: nextRound,
          round: `Round ${nextRound}`
        }));
      } else {
        setScheduleForm(prev => ({ ...prev, roundNo: 1, round: 'Round 1' }));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleForm.candidateId, scheduleForm.jobId, showScheduleModal, applications]);

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

    // Resolve application ID synchronously if possible
    let targetApplicationId = '';
    const existingApp = applications.find(
      a => a.candidateId === scheduleForm.candidateId && a.jobId === scheduleForm.jobId
    );

    if (!existingApp) {
      // Must create application first — brief network call before optimistic insert
      try {
        setSavingSchedule(true);
        const newAppRes = await apiPost('/applications', {
          candidateId: scheduleForm.candidateId,
          jobId: scheduleForm.jobId
        });
        targetApplicationId = newAppRes.data.id;
      } catch (err) {
        setError(err.message || 'Failed to create application');
        setSavingSchedule(false);
        return false;
      }
    } else {
      targetApplicationId = existingApp.id;
    }

    // Capture form values before clearing
    const savedForm = { ...scheduleForm };
    const savedRecordingFile = scheduleRecordingFile;
    setSavingSchedule(true);

    let roundNo = typeof savedForm.roundNo === 'number' ? savedForm.roundNo : (parseInt(savedForm.roundNo) || 1);
    if (savedForm.round === 'Final Round' || savedForm.round === 'Final') roundNo = 99;
    const notesPayload = JSON.stringify({
      phoneFollowUp: savedForm.phoneFollowUp || null,
      emailFollowUp: savedForm.emailFollowUp || null,
      nextSchedule: savedForm.nextSchedule || null,
    });

    try {
      const result = await createRoundMutation.mutateAsync({
        applicationId: targetApplicationId,
        roundNo,
        round: savedForm.round,
        interviewerIds: savedForm.interviewerIds,
        scheduledStart: new Date(savedForm.scheduledStart).toISOString(),
        scheduledEnd: savedForm.scheduledEnd ? new Date(savedForm.scheduledEnd).toISOString() : null,
        mode: savedForm.mode,
        meetingLink: savedForm.meetingLink ? savedForm.meetingLink.trim() : null,
        zohoLink: savedForm.zohoLink ? savedForm.zohoLink.trim() : null,
        slotNo: savedForm.slotNo || 1,  // time-slot position (1–7 per hour)
        notes: notesPayload,
      });

      // Upload recording after round is confirmed — non-blocking for UX
      const newRoundId = result?.data?.id || result?.tempId || result?.id;
      if (savedRecordingFile && newRoundId) {
        setUploadingRecording(true);
        const token = localStorage.getItem('ats_token');
        const formData = new FormData();
        formData.append('file', savedRecordingFile);
        await fetch(`${API_BASE_URL}/interviews/${newRoundId}/recording`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        });
        setScheduleRecordingFile(null);
        setUploadingRecording(false);
      }

      setScheduleForm(emptyScheduleForm);
      setBanner('Interview scheduled successfully.');
      return true;
    } catch (err) {
      setBanner('');
      setError(err.message || 'Failed to schedule interview');
      return false;
    } finally {
      setSavingSchedule(false);
    }
  };

  const onFeedbackSubmit = async (event) => {
    event.preventDefault();
    if (!selectedInterview) {
      setError('Select an interview before submitting feedback.');
      return false;
    }
    setError('');
    setBanner('');

    // Capture state before clearing
    const savedFeedback    = { ...feedbackForm };
    const savedOfferFile   = offerLetterFile;
    const savedInterviewId = selectedInterview.id;

    setSavingFeedback(true);

    try {
      let offerFileUrl  = null;
      let offerFileName = null;

      if (savedOfferFile) {
        const formData = new FormData();
        formData.append('offerFile', savedOfferFile);
        const res = await fetch(`${API_BASE_URL}/interviews/${savedInterviewId}/feedback`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${localStorage.getItem('ats_token')}` },
          body: formData,
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.message || 'Failed to upload offer file');
        offerFileUrl  = json.data?.offerFileUrl;
        offerFileName = json.data?.offerFileName;
      }

      const feedbackPayload = {
        technicalRating:     typeof savedFeedback.technicalRating === 'number'     ? savedFeedback.technicalRating     : (parseInt(savedFeedback.technicalRating)     || 0),
        communicationRating: typeof savedFeedback.communicationRating === 'number' ? savedFeedback.communicationRating : (parseInt(savedFeedback.communicationRating) || 0),
        cultureFitRating:    typeof savedFeedback.cultureFitRating === 'number'    ? savedFeedback.cultureFitRating    : (parseInt(savedFeedback.cultureFitRating)    || 0),
        strengths:        savedFeedback.strengths || '',
        weaknesses:       savedFeedback.weaknesses || '',
        overallComments:  savedFeedback.overallComments || '',
        recommendation:   savedFeedback.recommendation || 'PENDING',
        offerPhoneFollowUp: savedFeedback.offerPhoneFollowUp || null,
        offerEmailFollowUp: savedFeedback.offerEmailFollowUp || null,
        ...(offerFileUrl ? { offerFileUrl, offerFileName } : {}),
      };

      await submitFeedbackMutation.mutateAsync({
        roundId:  savedInterviewId,
        feedback: feedbackPayload,
      });

      await loadAll();
      setFeedbackForm(emptyFeedbackForm);
      setOfferLetterFile(null);
      setShowFeedbackModal(false);
      setIsEditingFeedback(false);
      setBanner('Feedback submitted successfully.');
      return true;
    } catch (err) {
      setBanner('');
      setError(err.message || 'Failed to submit feedback');
      return false;
    } finally {
      setSavingFeedback(false);
    }
  };

  const onUpdateStatus = async (applicationId, status) => {
    // Optimistic update via hook — no loading spinner, no refetch
    try {
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
      setTimeout(() => setBanner(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to update application status');
      setTimeout(() => setError(''), 3000);
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

      refetchInterviews();
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
  const onDeleteInterview = (interviewId, roundLabel) => {
    if (!window.confirm(`Are you sure you want to delete "${roundLabel}" and all associated feedback?`)) {
      return;
    }

    setError('');
    deleteRoundMutation.mutate(interviewId, {
      onSuccess: () => {
        setBanner('Interview deleted successfully.');
      },
      onError: (err) => {
        setError(err.message || 'Failed to delete interview');
      }
    });

    if (activeInterviewId === interviewId) {
      const remaining = (selectedGroup?.interviews || []).filter(i => i.id !== interviewId);
      if (remaining.length > 0) {
        setActiveInterviewId(remaining[0].id);
      } else {
        setActiveInterviewId('');
      }
    }
  };

  const onTransferPanelist = (interviewerId) => {
    if (!transferringInterview) return;
    
    setError('');
    updatePanelMutation.mutate({
      roundId: transferringInterview.id,
      panelMembers: [interviewerId]
    }, {
      onSuccess: () => {
        setBanner('Panelist transferred successfully.');
      },
      onError: (err) => {
        setError(err.message || 'Failed to transfer panelist');
      }
    });

    setShowTransferModal(false);
    setTransferringInterview(null);
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

  // NOTE: calendarData useEffect REMOVED — scheduleData useMemo now handles all
  // calendar grouping using filteredForViews + groupInterviewsByDate. The
  // setCalendarData state is no longer updated here; calendarData state is kept
  // for backwards-compat with any code that might reference it but the primary
  // calendar rendering now uses scheduleData directly.

  const handleSelectDate = useCallback((date) => {
    setSelectedCalendarDate(date);
    setShowActivityModal(true);
  }, []);


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
      <div className="flex flex-col md:flex-row md:items-center justify-between px-5 py-3 md:py-0 md:h-14 bg-white border-b border-[#e4ebf1] gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap items-center">
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
          <button
            className={`os-btn-outline !h-9 ${viewMode === 'excel' ? '!bg-[#1f52cc] !text-white' : ''}`}
            onClick={() => setViewMode('excel')}
            type="button"
          >
            <span className="material-symbols-outlined text-sm">table_view</span>
            Excel View
          </button>
          <button className={`p-1 px-4 text-xs font-semibold rounded-lg transition-all ${!filterMine ? 'bg-[#1f52cc] text-white shadow-md' : 'text-[#64748b] hover:bg-slate-100'}`} onClick={() => setFilterMine(false)}>
            All
          </button>
          <button className={`p-1 px-4 text-xs font-semibold rounded-lg transition-all ${filterMine ? 'bg-[#1f52cc] text-white shadow-md' : 'text-[#64748b] hover:bg-slate-100'}`} onClick={() => setFilterMine(true)}>
            My Interviews
          </button>
          <span className="h-4 w-[1px] bg-slate-200 self-center hidden sm:inline-block"></span>
          <button className={`p-1 px-4 text-xs font-semibold rounded-lg transition-all ${roundFilter === 'all' ? 'bg-[#1f52cc] text-white shadow-md' : 'text-[#64748b] hover:bg-slate-100'}`} onClick={() => setRoundFilter('all')}>
            All Rounds
          </button>
          <button className={`p-1 px-4 text-xs font-semibold rounded-lg transition-all ${roundFilter === '1' ? 'bg-[#1f52cc] text-white shadow-md' : 'text-[#64748b] hover:bg-slate-100'}`} onClick={() => setRoundFilter('1')}>
            Round 1
          </button>
          <button className={`p-1 px-4 text-xs font-semibold rounded-lg transition-all ${roundFilter === '2' ? 'bg-[#1f52cc] text-white shadow-md' : 'text-[#64748b] hover:bg-slate-100'}`} onClick={() => setRoundFilter('2')}>
            Round 2
          </button>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-between md:justify-end">
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
        </div>
      </div>

      <PageEnter className={`schedule-page h-[calc(100vh-126px)] overflow-hidden`}>
        {viewMode === 'list' && (
          <Reveal ref={listPanelRef} className="candidate-list-panel bg-white p-4 h-full">
            <div className="pb-4 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-semibold font-[Manrope] px-2">Interviews</h2>
                {loading ? <div className="text-xs text-[#a1acbd] animate-pulse">Syncing...</div> : null}
              </div>
              <div className="px-2">
              <div className="relative group">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-[#1f52cc] transition-colors">search</span>
                  <input 
                    className="w-full h-11 pl-10 pr-10 rounded-xl border border-slate-200 bg-slate-50/50 text-sm focus:border-[#1f52cc] focus:bg-white outline-none transition-all placeholder:text-slate-400"
                    placeholder="Search candidate or job..."
                    value={interviewListSearch}
                    onChange={e => { setInterviewListSearch(e.target.value); }}
                  />
                  {/* Spinner while server is fetching search results */}
                  {isSearching && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2">
                      <svg className="animate-spin h-4 w-4 text-[#1f52cc]" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                    </span>
                  )}
                  {interviewListSearch && !isSearching && (
                    <button
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                      onClick={() => setInterviewListSearch('')}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-base">close</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
            {/* Member count indicator */}
            {groupedApplications.length > 0 && (
              <div className="px-2 pb-1 text-[10px] text-slate-400 font-medium">
                {debouncedSearch
                  ? `${groupedApplications.length} result${groupedApplications.length !== 1 ? 's' : ''} for "${debouncedSearch}"`
                  : `${groupedApplications.length} member${groupedApplications.length !== 1 ? 's' : ''}`
                }
              </div>
            )}
            {visibleGroups.map((group) => {
              const candidate = group.application?.candidate;
              const candidateId = group.candidateId;
              const activeInterviews = (group.interviews || []).filter(iv => {
                const isCancelled = iv.status === 'CANCELLED';
                const isDeleted = iv.isDeleted;
                return !isCancelled && !isDeleted;
              });
              const roundCount = activeInterviews.reduce((max, iv) => Math.max(max, iv.roundNo || 0), 0);
              return (
                <button
                  key={candidateId}
                  className={`w-full text-left flex gap-3 p-3 rounded-xl mb-1 transition-all ${
                    selectedGroupId === candidateId
                      ? 'bg-[#eef3ff] border-l-4 border-[#1f4bc6]'
                      : 'hover:bg-[#f6f9fc]'
                  }`}
                  onClick={() => {
                    setSelectedId(candidateId);
                    // Select the last round (highest roundNo) as active
                    const lastRound = group.interviews[group.interviews.length - 1];
                    if (lastRound?.id) {
                      setActiveInterviewId(lastRound.id);
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
                    <div className="flex items-center gap-2 mt-1">
                      <div className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-semibold inline-block">
                        {roundCount > 0 ? `Round ${roundCount === 99 ? 'Final' : roundCount}` : 'Not Scheduled'}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
            {/* Infinite scroll sentinel & skeletons */}
            {(visibleCount < groupedApplications.length || loadingMore || serverHasMore) && (
              <div ref={sentinelCallbackRef} className="w-full mt-2 h-4">
                {loadingMore && <InterviewMemberSkeleton count={3} />}
              </div>
            )}
            {interviews.length === 0 && !isQueryLoading && (
              <div className="text-sm os-muted px-2 py-4 text-center text-slate-400">No interviews found.</div>
            )}
            {debouncedSearch && groupedApplications.length === 0 && !isSearching && (
              <div className="text-sm os-muted px-2 py-4 text-center text-slate-400">No results for "{debouncedSearch}"</div>
            )}
          </Reveal>
        )}

        {viewMode === 'excel' && (
          <Reveal delay={0.04} className="bg-white w-full h-full flex flex-col overflow-hidden">
            <ExcelView
              interviews={filteredForViews}
              viewDate={viewDate}
              onSelectCandidate={(candidateId, interviewId) => {
                setViewMode('list');
                setSelectedId(candidateId);
                if (interviewId) setActiveInterviewId(interviewId);
              }}
            />
          </Reveal>
        )}

        {viewMode === 'calendar' && (
          <Reveal delay={0.06} className="bg-white p-6 overflow-auto w-full h-full">
            <div className="calendar-grid grid grid-cols-7 border-t border-l border-[#e4ebf1]">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                <div key={day} className="py-2 text-center text-xs font-bold text-[#64748b] bg-[#f8fafc] border-r border-b border-[#e4ebf1]">{day}</div>
              ))}
              {calendarDays.map((cell, idx) => {
                // Use toDateKey() (local-timezone 'YYYY-MM-DD') — same function used
                // when building scheduleData, so the lookup always matches.
                const dateKey = toDateKey(cell.date);
                const cellData = scheduleData.get(dateKey) || { interviews: [], joinings: [] };
                return (
                  <MemoizedCalendarCell
                    key={`${cell.month}-${cell.day}-${idx}`}
                    date={cell.date}
                    isCurrentMonth={cell.month === 'current'}
                    isToday={new Date().toDateString() === cell.date.toDateString()}
                    onSelectDate={handleSelectDate}
                    cellInterviews={cellData.interviews}
                    cellJoinings={cellData.joinings}
                    onChipClick={(candidateId, interviewId) => {
                      // Switch to List View and select the candidate
                      setViewMode('list');
                      setSelectedId(candidateId);
                      if (interviewId) setActiveInterviewId(interviewId);
                    }}
                  />
                );
              })}
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
                      <div className="flex items-center gap-3">
                        <button
                          className="os-btn-primary !h-9 !px-4 !bg-[#1f52cc]"
                          onClick={() => {
                            let dateStr = '';
                            if (selectedCalendarDate) {
                              const yyyy = selectedCalendarDate.getFullYear();
                              const mm = String(selectedCalendarDate.getMonth() + 1).padStart(2, '0');
                              const dd = String(selectedCalendarDate.getDate()).padStart(2, '0');
                              dateStr = `${yyyy}-${mm}-${dd}T09:00`;
                            }
                            setScheduleForm({
                              ...emptyScheduleForm,
                              scheduledStart: dateStr
                            });
                            setCandidateSearch('');
                            setJobSearch('');
                            setShowActivityModal(false);
                            setShowScheduleModal(true);
                          }}
                        >
                          <span className="material-symbols-outlined text-sm">event</span>
                          Schedule Next
                        </button>
                        <button className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors" onClick={() => setShowActivityModal(false)}>
                          <span className="material-symbols-outlined">close</span>
                        </button>
                      </div>
                    </div>

                    <div className="space-y-8 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                      {/* Interviews Section */}
                      {(() => {
                        const dayData = scheduleData.get(toDateKey(selectedCalendarDate)) || { interviews: [], joinings: [] };
                        const dayInterviews = dayData.interviews || [];
                        const dayJoinings = dayData.joinings || [];
                        const hasInterviews = dayInterviews.length > 0;
                        const hasJoinings = dayJoinings.length > 0;

                        return (
                          <>
                            {hasInterviews && (
                              <div>
                                <h3 className="text-[11px] uppercase tracking-[.15em] text-[#1f52cc] font-bold mb-4 flex items-center gap-2">
                                  <span className="material-symbols-outlined text-sm">event</span>
                                  Scheduled Interviews
                                </h3>
                                <div className="grid gap-3">
                                  {[...dayInterviews]
                                    .sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime())
                                    .map((iv, ivIdx, sortedList) => {
                                      const startDate = new Date(iv.scheduledStart);
                                      const hr = startDate.getHours();
                                      const min = startDate.getMinutes();
                                      const isPM = hr >= 12;
                                      const hr12 = hr % 12 || 12;
                                      const minStr = min > 0 ? `:${String(min).padStart(2, '0')}` : '';
                                      const panelists = (iv.interviewers || []).map(u => u.fullName).filter(Boolean);
                                      const jobTitle = iv.application?.job?.title || iv.jobTitle || '';
                                      const resultColor =
                                        iv.result === 'PASS' || iv.result === 'SELECTED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                        iv.result === 'FAIL' || iv.result === 'REJECTED' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                        iv.result === 'ON_HOLD' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                        iv.result === 'OFFER_LETTER' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                        'bg-slate-50 text-slate-500 border-slate-200';
                                      const resultLabel = iv.result === 'DIDNT_JOIN' ? "Didn't Join" : (iv.result || 'Scheduled');
                                      // Compute slot: position among same-hour interviews on this day
                                      const slotNo = iv.slotNo || (sortedList.filter(s =>
                                        new Date(s.scheduledStart).getHours() === hr &&
                                        new Date(s.scheduledStart) <= startDate
                                      ).length);
                                      const slotColor = slotNo >= 6 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-indigo-50 text-indigo-700 border-indigo-200';
                                      return (
                                        <div key={iv.id} className="os-card p-4 border-blue-100 bg-blue-50/20 hover:shadow-md transition-shadow">
                                          <div className="flex items-start justify-between gap-3">
                                            {/* Time block */}
                                            <div className="w-14 h-14 rounded-2xl bg-white border border-[#e2e8f0] flex flex-col items-center justify-center text-[#1f52cc] shrink-0 shadow-sm">
                                              <div className="text-sm font-extrabold leading-none">{hr12}{minStr}</div>
                                              <div className="text-[9px] uppercase font-black tracking-widest mt-0.5">{isPM ? 'PM' : 'AM'}</div>
                                            </div>

                                            {/* Main info */}
                                            <div className="flex-1 min-w-0">
                                              <div className="flex items-center gap-2 flex-wrap">
                                                <div className="text-base font-bold text-[#10193f] truncate">{iv.application?.candidate?.fullName}</div>
                                                <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border ${resultColor}`}>
                                                  {resultLabel}
                                                </span>
                                              </div>

                                              {/* Role */}
                                              {jobTitle && (
                                                <div className="flex items-center gap-1 mt-1">
                                                  <span className="material-symbols-outlined text-[11px] text-[#1f52cc]">work</span>
                                                  <span className="text-[11px] font-semibold text-[#1f52cc] truncate">{jobTitle}</span>
                                                </div>
                                              )}

                                              {/* Round & Mode */}
                                              <div className="text-xs text-[#6f7d98] mt-0.5 flex items-center gap-1.5">
                                                <span className="material-symbols-outlined text-[12px]">layers</span>
                                                <span>{iv.round || `Round ${iv.roundNo}`}</span>
                                                <span className="text-slate-300">•</span>
                                                <span className="material-symbols-outlined text-[12px]">{iv.mode === 'ONLINE' ? 'videocam' : iv.mode === 'PHONE' ? 'phone' : 'location_on'}</span>
                                                <span>{iv.mode === 'ONLINE' ? 'Online' : iv.mode === 'IN_PERSON' ? 'In Person' : iv.mode === 'PHONE' ? 'Phone' : iv.mode}</span>
                                              </div>

                                              {/* Panelists */}
                                              {panelists.length > 0 && (
                                                <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                                                  <span className="material-symbols-outlined text-[11px] text-slate-400">supervisor_account</span>
                                                  {panelists.map((name, idx) => (
                                                    <span key={idx} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">
                                                      {name}
                                                    </span>
                                                  ))}
                                                </div>
                                              )}
                                            </div>

                                            <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                                              <button
                                                className="os-btn-primary !h-8 !px-3 !text-[11px] bg-[#1f52cc] shrink-0"
                                                onClick={() => {
                                                  const candId = iv.application?.candidateId || iv.candidateId;
                                                  const candName = iv.application?.candidate?.fullName || iv.candidateName || '';
                                                  const jobId = iv.application?.jobId || iv.application?.job?.id || iv.jobId || '';
                                                  const jobTitle = iv.application?.job?.title || iv.jobTitle || '';
                                                  
                                                  // Find all interviews for this candidate to calculate the next round number
                                                  const candInterviews = allInterviews.filter(
                                                    x => (x.application?.candidateId || x.candidateId) === candId
                                                  );
                                                  const nextRound = candInterviews.length + 1;

                                                  // Format the selected calendar date to local ISO (YYYY-MM-DDT09:00)
                                                  let dateStr = '';
                                                  if (selectedCalendarDate) {
                                                    const yyyy = selectedCalendarDate.getFullYear();
                                                    const mm = String(selectedCalendarDate.getMonth() + 1).padStart(2, '0');
                                                    const dd = String(selectedCalendarDate.getDate()).padStart(2, '0');
                                                    dateStr = `${yyyy}-${mm}-${dd}T09:00`;
                                                  }

                                                  setScheduleForm({
                                                    ...emptyScheduleForm,
                                                    candidateId: candId,
                                                    jobId: jobId,
                                                    roundNo: nextRound,
                                                    round: `Round ${nextRound}`,
                                                    scheduledStart: dateStr
                                                  });

                                                  setCandidateSearch(candName);
                                                  setJobSearch(jobTitle);
                                                  
                                                  // Select candidate and view List view
                                                  setSelectedId(candId);
                                                  setViewMode('list');
                                                  setShowActivityModal(false);
                                                  setShowScheduleModal(true);
                                                }}
                                              >
                                                Schedule Next
                                              </button>
                                              <button
                                                className="os-btn-outline !h-8 !px-3 !text-[11px] border-blue-500 text-blue-600 hover:bg-blue-50 shrink-0"
                                                onClick={() => {
                                                  setTransferringInterview(iv);
                                                  setShowTransferModal(true);
                                                }}
                                              >
                                                Keep a Transfer Panellist
                                              </button>
                                              <button
                                                className="os-btn-outline !h-8 !px-3 !text-[11px] shrink-0"
                                                onClick={() => navigate(`/candidate/${iv.application?.candidateId}`)}
                                              >
                                                Profile
                                              </button>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                </div>
                              </div>
                            )}

                            {hasJoinings && (
                              <div>
                                <h3 className="text-[11px] uppercase tracking-[.15em] text-[#10b981] font-bold mb-4 flex items-center gap-2">
                                  <span className="material-symbols-outlined text-sm">celebration</span>
                                  New Joinings
                                </h3>
                                <div className="grid gap-3">
                                  {dayJoinings.map(app => (
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

                            {!hasInterviews && !hasJoinings && (
                              <div className="py-16 text-center">
                                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-200 mb-4">
                                  <span className="material-symbols-outlined text-3xl">event_busy</span>
                                </div>
                                <div className="text-lg font-semibold text-[#64748b]">No schedules found</div>
                                <div className="text-sm text-[#94a3b8] mt-1">This day is completely clear from the calendar.</div>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </Reveal>
              </div>
            )}
          </Reveal>
        )}

        {viewMode === 'list' && (
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
                <div className="round-tabs-bar flex flex-row flex-wrap items-center bg-[#f1f5f9] rounded-[20px] p-1.5 gap-1.5 border border-[#e2e8f0]">
                  {(selectedGroup?.interviews || [])
                    .reduce((acc, curr) => {
                      const isCancelled = curr.status === 'CANCELLED';
                      const isDeleted = curr.isDeleted;
                      if (isCancelled || isDeleted) return acc;
                      if (!acc.find(item => item.roundNo === curr.roundNo)) acc.push(curr);
                      return acc;
                    }, [])
                    .sort((a, b) => a.roundNo - b.roundNo)
                    .map((iv) => (
                      <button
                        key={iv.id}
                        className={`round-tab-btn py-2.5 px-4 rounded-[14px] text-xs font-bold uppercase tracking-wider transition-all duration-300 flex flex-col items-center gap-0.5 ${
                          selectedInterview?.roundNo === iv.roundNo
                            ? 'bg-[#1f52cc] text-white shadow-lg shadow-blue-200 translate-y-[-1px]'
                            : 'text-[#64748b] hover:bg-white hover:text-[#1f52cc]'
                        }`}
                        onClick={() => setActiveInterviewId(iv.id)}
                      >
                        <span>Round {iv.roundNo === 99 ? 'Final' : iv.roundNo}</span>
                        {iv.slotNo > 0 && (
                          <span className={`text-[9px] font-semibold tracking-normal normal-case px-1.5 py-0.5 rounded-full ${
                            selectedInterview?.roundNo === iv.roundNo
                              ? 'bg-white/20 text-white'
                              : 'bg-blue-100 text-blue-600'
                          }`}>
                            Slot {iv.slotNo}
                          </span>
                        )}
                      </button>
                    ))}
                </div>

                <div className="os-card p-6 bg-gradient-to-br from-white to-[#f8fafc] border-t-4 border-t-[#1f52cc] text-sm text-[#2a344f]">
                  {/* Header: Title and Actions */}
                  <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <div className="font-bold text-base text-[#142651]">
                        Interview Details ({selectedInterview?.round || `Round ${selectedInterview?.roundNo}`})
                      </div>
                      {selectedInterview && (
                        <SyncIndicator isPending={selectedInterview._pendingSync || selectedInterview._optimistic} />
                      )}
                    </div>
                    
                    {/* Actions */}
                    {canScheduleInterview && selectedInterview && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setTransferringInterview(selectedInterview);
                            setShowTransferModal(true);
                          }}
                          className="px-2 py-1 rounded bg-blue-50 text-[11px] font-semibold text-blue-600 hover:bg-blue-100 flex items-center gap-0.5"
                          title="Transfer Interviewer"
                        >
                          <span className="material-symbols-outlined text-xs">swap_horiz</span>
                          Transfer
                        </button>
                        <button
                          onClick={() => setEditingInterviewId(selectedInterview.id)}
                          className="px-2 py-1 rounded bg-slate-100 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 flex items-center gap-0.5"
                          title="Edit Schedule Details"
                        >
                          <span className="material-symbols-outlined text-xs">edit</span>
                          Change Schedule
                        </button>
                        <button
                          onClick={() => onDeleteInterview(selectedInterview.id, selectedInterview.round || `Round ${selectedInterview.roundNo}`)}
                          className="px-1.5 py-1 rounded bg-red-50 text-[11px] font-semibold text-red-600 hover:bg-red-100 flex items-center"
                          title="Delete this interview"
                        >
                          <span className="material-symbols-outlined text-xs">delete</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Split Columns Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                    
                    {/* Left Column: Schedule Details */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs uppercase font-bold text-slate-400 tracking-wider">Schedule Details</h3>
                        <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            selectedInterview?.result === 'PASS' || selectedInterview?.result === 'SELECTED' ? 'bg-[#e8f5ed] text-[#2ca764]' :
                            selectedInterview?.result === 'OFFER_LETTER' ? 'bg-blue-50 text-blue-600 border border-blue-200' :
                            selectedInterview?.result === 'FAIL' || selectedInterview?.result === 'REJECTED' ? 'bg-[#fbeaea] text-[#cf3a3a]' :
                            selectedInterview?.result === 'ON_HOLD' ? 'bg-amber-50 text-amber-600 border border-amber-200' :
                            selectedInterview?.result === 'DIDNT_JOIN' ? 'bg-slate-100 text-slate-600 border border-slate-200' :
                            'bg-[#fef4e8] text-[#f2994a]'
                          }`}>
                          {selectedInterview?.result === 'DIDNT_JOIN' ? "DIDN'T JOIN" : (selectedInterview?.result || 'PENDING')}
                        </div>
                      </div>
                      
                      <div className="space-y-3 text-sm">
                        <div className="flex border-b border-slate-50 pb-2">
                          <span className="w-28 text-[#6d7893] shrink-0 font-medium">Role:</span>
                          <span className="text-[#142651] font-semibold">{selectedInterview?.application?.job?.title || '-'}</span>
                        </div>
                        <div className="flex border-b border-slate-50 pb-2">
                          <span className="w-28 text-[#6d7893] shrink-0 font-medium">Interviewers:</span>
                          <span className="text-[#142651] font-semibold">{selectedInterview?.interviewers?.map(u => u.fullName).join(', ') || '-'}</span>
                        </div>
                        <div className="flex border-b border-slate-50 pb-2">
                          <span className="w-28 text-[#6d7893] shrink-0 font-medium">Mode:</span>
                          <span className="text-[#142651] font-semibold">{selectedInterview?.mode || '-'}</span>
                        </div>
                        <div className="flex border-b border-slate-50 pb-2">
                          <span className="w-28 text-[#6d7893] shrink-0 font-medium">Date/Time:</span>
                          <span className="text-[#142651] font-semibold">
                            {selectedInterview?.scheduledStart ? formatDateTimeIN(selectedInterview.scheduledStart) : '-'}
                          </span>
                        </div>
                        {/* Slot number row */}
                        <div className="flex border-b border-slate-50 pb-2">
                          <span className="w-28 text-[#6d7893] shrink-0 font-medium">Time Slot:</span>
                          <span className="flex items-center gap-1.5">
                            {selectedInterview?.slotNo > 0 ? (
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                selectedInterview.slotNo >= 6
                                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                                  : 'bg-blue-50 text-blue-700 border-blue-200'
                              }`}>
                                Slot {selectedInterview.slotNo}
                              </span>
                            ) : (
                              <span className="text-[#142651] font-semibold">Slot 1</span>
                            )}
                            {selectedInterview?.slotNo >= 6 && (
                              <span className="text-[10px] text-amber-600 font-medium">(near capacity)</span>
                            )}
                          </span>
                        </div>
                        {/* Phone Follow-up row */}
                        <div className="flex border-b border-slate-50 pb-2">
                          <span className="w-28 text-[#6d7893] shrink-0 font-medium">Phone Follow-up:</span>
                          {(() => {
                            const { phoneFollowUp, emailFollowUp } = parseNotesSafely(selectedInterview?.notes);
                            return phoneFollowUp ? (
                              <div className="flex items-center gap-2 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => downloadBase64File(phoneFollowUp.name, phoneFollowUp.data)}
                                  className="text-blue-600 font-bold hover:underline flex items-center gap-1 text-left text-xs"
                                >
                                  <span className="material-symbols-outlined text-xs">attachment</span>
                                  <span className="truncate max-w-[150px]">{phoneFollowUp.name}</span>
                                </button>
                                {isAdmin && (
                                  <>
                                    <input
                                      type="file"
                                      id={`replace-phone-followup-${selectedInterview?.id}`}
                                      className="hidden"
                                      onChange={async (e) => {
                                        const file = e.target.files[0];
                                        if (!file || !selectedInterview) return;
                                        const base64 = await fileToBase64(file);
                                        const updatedNotes = JSON.stringify({ phoneFollowUp: base64, emailFollowUp });
                                        const interviewerIds = (selectedInterview.interviewers || []).map(u => u.id);
                                        await schedulingApi.updateRound(selectedInterview.id, {
                                          applicationId: selectedInterview.applicationId,
                                          roundNo: selectedInterview.roundNo,
                                          round: selectedInterview.round,
                                          interviewerIds,
                                          scheduledStart: selectedInterview.scheduledStart,
                                          mode: selectedInterview.mode,
                                          meetingLink: selectedInterview.meetingLink,
                                          zohoLink: selectedInterview.zohoLink,
                                          notes: updatedNotes
                                        });
                                        await loadAll();
                                        e.target.value = '';
                                      }}
                                    />
                                    <label
                                      htmlFor={`replace-phone-followup-${selectedInterview?.id}`}
                                      className="cursor-pointer text-[#1f52cc] hover:text-[#163fa3] text-xs font-semibold bg-blue-50 px-2 py-0.5 rounded-md hover:bg-blue-100 transition-colors"
                                    >
                                      Replace File
                                    </label>
                                  </>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="file"
                                  id={`detail-phone-followup-${selectedInterview?.id}`}
                                  className="hidden"
                                  onChange={async (e) => {
                                    const file = e.target.files[0];
                                    if (!file || !selectedInterview) return;
                                    const base64 = await fileToBase64(file);
                                    const updatedNotes = JSON.stringify({ phoneFollowUp: base64, emailFollowUp });
                                    const interviewerIds = (selectedInterview.interviewers || []).map(u => u.id);
                                    await schedulingApi.updateRound(selectedInterview.id, {
                                      applicationId: selectedInterview.applicationId,
                                      roundNo: selectedInterview.roundNo,
                                      round: selectedInterview.round,
                                      interviewerIds,
                                      scheduledStart: selectedInterview.scheduledStart,
                                      mode: selectedInterview.mode,
                                      meetingLink: selectedInterview.meetingLink,
                                      zohoLink: selectedInterview.zohoLink,
                                      notes: updatedNotes
                                    });
                                    await loadAll();
                                    e.target.value = '';
                                  }}
                                />
                                <label
                                  htmlFor={`detail-phone-followup-${selectedInterview?.id}`}
                                  className="cursor-pointer flex items-center gap-1 text-xs text-blue-600 font-semibold hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded-md transition-colors"
                                >
                                  <span className="material-symbols-outlined text-xs">upload</span>
                                  Upload
                                </label>
                                <span className="text-rose-400 text-xs">No file yet</span>
                              </div>
                            );
                          })()}
                        </div>
                        {/* Email Follow-up row */}
                        <div className="flex border-b border-slate-50 pb-2">
                          <span className="w-28 text-[#6d7893] shrink-0 font-medium">Email Follow-up:</span>
                          {(() => {
                            const { phoneFollowUp, emailFollowUp } = parseNotesSafely(selectedInterview?.notes);
                            return emailFollowUp ? (
                              <div className="flex items-center gap-2 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => downloadBase64File(emailFollowUp.name, emailFollowUp.data)}
                                  className="text-blue-600 font-bold hover:underline flex items-center gap-1 text-left text-xs"
                                >
                                  <span className="material-symbols-outlined text-xs">attachment</span>
                                  <span className="truncate max-w-[150px]">{emailFollowUp.name}</span>
                                </button>
                                {isAdmin && (
                                  <>
                                    <input
                                      type="file"
                                      id={`replace-email-followup-${selectedInterview?.id}`}
                                      className="hidden"
                                      onChange={async (e) => {
                                        const file = e.target.files[0];
                                        if (!file || !selectedInterview) return;
                                        const base64 = await fileToBase64(file);
                                        const updatedNotes = JSON.stringify({ phoneFollowUp, emailFollowUp: base64 });
                                        const interviewerIds = (selectedInterview.interviewers || []).map(u => u.id);
                                        await schedulingApi.updateRound(selectedInterview.id, {
                                          applicationId: selectedInterview.applicationId,
                                          roundNo: selectedInterview.roundNo,
                                          round: selectedInterview.round,
                                          interviewerIds,
                                          scheduledStart: selectedInterview.scheduledStart,
                                          mode: selectedInterview.mode,
                                          meetingLink: selectedInterview.meetingLink,
                                          zohoLink: selectedInterview.zohoLink,
                                          notes: updatedNotes
                                        });
                                        await loadAll();
                                        e.target.value = '';
                                      }}
                                    />
                                    <label
                                      htmlFor={`replace-email-followup-${selectedInterview?.id}`}
                                      className="cursor-pointer text-[#1f52cc] hover:text-[#163fa3] text-xs font-semibold bg-blue-50 px-2 py-0.5 rounded-md hover:bg-blue-100 transition-colors"
                                    >
                                      Replace File
                                    </label>
                                  </>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="file"
                                  id={`detail-email-followup-${selectedInterview?.id}`}
                                  className="hidden"
                                  onChange={async (e) => {
                                    const file = e.target.files[0];
                                    if (!file || !selectedInterview) return;
                                    const base64 = await fileToBase64(file);
                                    const updatedNotes = JSON.stringify({ phoneFollowUp, emailFollowUp: base64 });
                                    const interviewerIds = (selectedInterview.interviewers || []).map(u => u.id);
                                    await schedulingApi.updateRound(selectedInterview.id, {
                                      applicationId: selectedInterview.applicationId,
                                      roundNo: selectedInterview.roundNo,
                                      round: selectedInterview.round,
                                      interviewerIds,
                                      scheduledStart: selectedInterview.scheduledStart,
                                      mode: selectedInterview.mode,
                                      meetingLink: selectedInterview.meetingLink,
                                      zohoLink: selectedInterview.zohoLink,
                                      notes: updatedNotes
                                    });
                                    await loadAll();
                                    e.target.value = '';
                                  }}
                                />
                                <label
                                  htmlFor={`detail-email-followup-${selectedInterview?.id}`}
                                  className="cursor-pointer flex items-center gap-1 text-xs text-blue-600 font-semibold hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded-md transition-colors"
                                >
                                  <span className="material-symbols-outlined text-xs">upload</span>
                                  Upload
                                </label>
                                <span className="text-rose-400 text-xs">No file yet</span>
                              </div>
                            );
                          })()}
                        </div>

                        {(() => {
                          const { nextSchedule } = parseNotesSafely(selectedInterview?.notes);
                          return nextSchedule ? (
                            <div className="flex border-b border-slate-50 pb-2">
                              <span className="w-28 text-[#6d7893] shrink-0 font-medium">Next Schedule:</span>
                              <input
                                type="text"
                                readOnly
                                value={nextSchedule}
                                title={nextSchedule}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.target.select();
                                }}
                                className="text-slate-800 text-xs font-semibold focus:outline-none"
                                style={{
                                  border: 'none',
                                  background: 'transparent',
                                  outline: 'none',
                                  cursor: 'text',
                                  width: '100%',
                                }}
                              />
                            </div>
                          ) : null;
                        })()}

                        {selectedInterview?.zohoLink && (
                          <div className="flex pb-2">
                            <span className="w-28 text-[#6d7893] shrink-0 font-medium">Zoho Meet:</span>
                            <span className="truncate text-blue-600 font-bold cursor-pointer hover:underline" onClick={() => window.open(selectedInterview.zohoLink, '_blank')}>
                              Join via Zoho
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right Column: Divider + Form or Details */}
                    <div className="border-t md:border-t-0 md:border-l border-slate-200 pt-6 md:pt-0 md:pl-6">
                      {selectedInterview && (!myFeedback || isEditingFeedback) && !savingFeedback && (
                        <div className="space-y-4">
                          <div>
                            <h3 className="text-xs uppercase font-bold text-slate-400 tracking-wider">
                              {isEditingFeedback ? 'Edit Assessment' : 'Submit Assessment'}
                            </h3>
                            <p className="text-[10px] text-slate-500 mt-0.5">
                              {isEditingFeedback ? 'Update candidate performance details for this round' : `Review candidate performance for Round ${selectedInterview.roundNo === 99 ? 'Final' : selectedInterview.roundNo}`}
                            </p>
                          </div>
                          <form className="space-y-4" onSubmit={onFeedbackSubmit}>
                            <div className="grid grid-cols-3 gap-2">
                              <div className="space-y-0.5 text-center">
                                <label className="text-[9px] uppercase font-bold text-slate-400">Technical</label>
                                <select className="h-8 w-full rounded-lg border border-slate-200 px-1 text-xs text-center focus:border-[#1f52cc] outline-none" value={feedbackForm.technicalRating} onChange={e => setFeedbackForm(prev => ({...prev, technicalRating: parseInt(e.target.value, 10)}))}>
                                  {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}/5</option>)}
                                </select>
                              </div>
                              <div className="space-y-0.5 text-center">
                                <label className="text-[9px] uppercase font-bold text-slate-400">Comm.</label>
                                <select className="h-8 w-full rounded-lg border border-slate-200 px-1 text-xs text-center focus:border-[#1f52cc] outline-none" value={feedbackForm.communicationRating} onChange={e => setFeedbackForm(prev => ({...prev, communicationRating: parseInt(e.target.value, 10)}))}>
                                  {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}/5</option>)}
                                </select>
                              </div>
                              <div className="space-y-0.5 text-center">
                                <label className="text-[9px] uppercase font-bold text-slate-400">Culture</label>
                                <select className="h-8 w-full rounded-lg border border-slate-200 px-1 text-xs text-center focus:border-[#1f52cc] outline-none" value={feedbackForm.cultureFitRating} onChange={e => setFeedbackForm(prev => ({...prev, cultureFitRating: parseInt(e.target.value, 10)}))}>
                                  {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}/5</option>)}
                                </select>
                              </div>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[9px] uppercase font-bold text-slate-400">Recommendation</label>
                              <select className="h-8 w-full rounded-lg border border-slate-200 px-2 text-xs focus:border-[#1f52cc] outline-none font-semibold text-slate-700" value={feedbackForm.recommendation} onChange={e => setFeedbackForm(prev => ({...prev, recommendation: e.target.value}))}>
                                <option value="SELECTED">Selected</option>
                                <option value="OFFER_LETTER">Offer Letter</option>
                                <option value="ON_HOLD">On Hold</option>
                                <option value="DIDNT_JOIN">Didn't Join</option>
                                <option value="REJECTED">Rejected</option>
                              </select>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-0.5">
                                <label className="text-[9px] uppercase font-bold text-slate-400">Strengths</label>
                                <textarea className="w-full rounded-lg border border-slate-200 p-2 text-xs min-h-[50px] focus:border-[#1f52cc] outline-none" placeholder="Key strengths..." value={feedbackForm.strengths} onChange={e => setFeedbackForm(prev => ({...prev, strengths: e.target.value}))} required />
                              </div>
                              <div className="space-y-0.5">
                                <label className="text-[9px] uppercase font-bold text-slate-400">Concerns</label>
                                <textarea className="w-full rounded-lg border border-slate-200 p-2 text-xs min-h-[50px] focus:border-[#1f52cc] outline-none" placeholder="Any red flags..." value={feedbackForm.weaknesses} onChange={e => setFeedbackForm(prev => ({...prev, weaknesses: e.target.value}))} required />
                              </div>
                            </div>

                            <div className="space-y-0.5">
                              <label className="text-[9px] uppercase font-bold text-slate-400">Overall Summary</label>
                              <textarea className="w-full rounded-lg border border-slate-200 p-2 text-xs min-h-[50px] focus:border-[#1f52cc] outline-none" placeholder="Notes..." value={feedbackForm.overallComments} onChange={e => setFeedbackForm(prev => ({...prev, overallComments: e.target.value}))} required />
                            </div>

                            {/* Offer Letter Required Uploads */}
                            {feedbackForm.recommendation === 'OFFER_LETTER' && (
                              <div className="space-y-3 bg-blue-50/50 p-3 rounded-xl border border-blue-100">
                                <div className="text-[10px] font-bold text-[#1f52cc] uppercase tracking-wider">Offer Letter Attachments Required</div>
                                
                                {/* Offer Phone Follow-up File */}
                                <div className="space-y-1">
                                  <label className="text-[10px] font-bold text-slate-500 block">Offer Letter Phone Follow-up</label>
                                  {feedbackForm.offerPhoneFollowUp ? (
                                    <div className="flex items-center justify-between bg-white p-2 rounded-lg border border-slate-200 text-xs">
                                      <span className="truncate max-w-[180px] font-medium text-slate-700">{feedbackForm.offerPhoneFollowUp.name}</span>
                                      {isAdmin && (
                                        <>
                                          <input
                                            type="file"
                                            id="replace-feedback-phone"
                                            className="hidden"
                                            onChange={async (e) => {
                                              const file = e.target.files[0];
                                              if (file) {
                                                const base64 = await fileToBase64(file);
                                                setFeedbackForm(prev => ({ ...prev, offerPhoneFollowUp: base64 }));
                                              }
                                            }}
                                          />
                                          <label
                                            htmlFor="replace-feedback-phone"
                                            className="cursor-pointer text-[#1f52cc] hover:text-[#163fa3] text-xs font-semibold"
                                          >
                                            Replace
                                          </label>
                                        </>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="space-y-1">
                                      {isAdmin ? (
                                        <>
                                          <input
                                            type="file"
                                            id="offer-phone-followup"
                                            className="hidden"
                                            onChange={async (e) => {
                                              const file = e.target.files[0];
                                              if (file) {
                                                const base64 = await fileToBase64(file);
                                                setFeedbackForm(prev => ({ ...prev, offerPhoneFollowUp: base64 }));
                                              }
                                            }}
                                          />
                                          <label
                                            htmlFor="offer-phone-followup"
                                            className="cursor-pointer text-xs text-blue-600 hover:underline font-semibold flex items-center gap-1"
                                          >
                                            <span className="material-symbols-outlined text-sm">add</span> Upload phone follow-up
                                          </label>
                                        </>
                                      ) : null}
                                      <div className="text-[10px] text-rose-500 font-bold">Didn't upload</div>
                                    </div>
                                  )}
                                </div>

                                {/* Offer Email Follow-up File */}
                                <div className="space-y-1">
                                  <label className="text-[10px] font-bold text-slate-500 block">Offer Letter Email Follow-up</label>
                                  {feedbackForm.offerEmailFollowUp ? (
                                    <div className="flex items-center justify-between bg-white p-2 rounded-lg border border-slate-200 text-xs">
                                      <span className="truncate max-w-[180px] font-medium text-slate-700">{feedbackForm.offerEmailFollowUp.name}</span>
                                      {isAdmin && (
                                        <>
                                          <input
                                            type="file"
                                            id="replace-feedback-email"
                                            className="hidden"
                                            onChange={async (e) => {
                                              const file = e.target.files[0];
                                              if (file) {
                                                const base64 = await fileToBase64(file);
                                                setFeedbackForm(prev => ({ ...prev, offerEmailFollowUp: base64 }));
                                              }
                                            }}
                                          />
                                          <label
                                            htmlFor="replace-feedback-email"
                                            className="cursor-pointer text-[#1f52cc] hover:text-[#163fa3] text-xs font-semibold"
                                          >
                                            Replace
                                          </label>
                                        </>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="space-y-1">
                                      {isAdmin ? (
                                        <>
                                          <input
                                            type="file"
                                            id="offer-email-followup"
                                            className="hidden"
                                            onChange={async (e) => {
                                              const file = e.target.files[0];
                                              if (file) {
                                                const base64 = await fileToBase64(file);
                                                setFeedbackForm(prev => ({ ...prev, offerEmailFollowUp: base64 }));
                                              }
                                            }}
                                          />
                                          <label
                                            htmlFor="offer-email-followup"
                                            className="cursor-pointer text-xs text-blue-600 hover:underline font-semibold flex items-center gap-1"
                                          >
                                            <span className="material-symbols-outlined text-sm">add</span> Upload email follow-up
                                          </label>
                                        </>
                                      ) : null}
                                      <div className="text-[10px] text-rose-500 font-bold">Didn't upload</div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}


                            <div className="flex gap-2">
                              {isEditingFeedback && (
                                <button type="button" onClick={() => setIsEditingFeedback(false)} className="flex-1 h-10 rounded-xl bg-slate-100 text-slate-600 font-bold text-xs hover:bg-slate-200 transition-all">
                                  Cancel
                                </button>
                              )}
                              <button
                                type="submit"
                                className="flex-1 h-10 rounded-xl bg-[#2ca764] text-white font-bold text-xs shadow-md shadow-emerald-100 hover:bg-[#258a52] transition-all disabled:opacity-50"
                                disabled={
                                  savingFeedback ||
                                  (feedbackForm.recommendation === 'OFFER_LETTER' && (!feedbackForm.offerPhoneFollowUp || !feedbackForm.offerEmailFollowUp))
                                }
                              >
                                {savingFeedback ? 'Saving...' : (isEditingFeedback ? 'Save Changes' : 'Submit Assessment')}
                              </button>
                            </div>
                          </form>
                        </div>
                      )}

                      {selectedInterview && myFeedback && !savingFeedback && !isEditingFeedback && (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                            <div>
                              <h3 className="text-xs uppercase font-bold text-slate-400 tracking-wider">Assessment Submitted</h3>
                              <p className="text-[10px] text-emerald-600 mt-0.5 font-medium flex items-center gap-1">
                                <span className="material-symbols-outlined text-xs">check_circle</span>
                                Recorded
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setFeedbackForm({
                                  technicalRating: myFeedback.ratings?.technical || myFeedback.technicalRating || 4,
                                  communicationRating: myFeedback.ratings?.communication || myFeedback.communicationRating || 4,
                                  cultureFitRating: myFeedback.ratings?.culture || myFeedback.cultureFitRating || 4,
                                  strengths: myFeedback.strengths || '',
                                  weaknesses: myFeedback.concerns || myFeedback.weaknesses || '',
                                  recommendation: myFeedback.recommendation || 'SELECTED',
                                  overallComments: myFeedback.notes || myFeedback.overallComments || '',
                                  offerPhoneFollowUp: myFeedback.offerPhoneFollowUp || null,
                                  offerEmailFollowUp: myFeedback.offerEmailFollowUp || null,
                                });
                                setIsEditingFeedback(true);
                              }}
                              className="px-2.5 h-7 rounded-lg bg-blue-50 border border-blue-200 text-[10px] font-bold text-blue-600 hover:bg-blue-100 transition-all flex items-center gap-0.5"
                            >
                              <span className="material-symbols-outlined text-xs">edit</span>
                              Change
                            </button>
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                            <div className="bg-[#f8f9fa] p-2 rounded text-center">
                              <div className="text-[9px] text-[#868fa0] uppercase tracking-wider font-bold">Tech</div>
                              <div className="text-xs font-bold text-[#142651]">{(myFeedback.ratings?.technical || myFeedback.technicalRating || 0)} / 5</div>
                            </div>
                            <div className="bg-[#f8f9fa] p-2 rounded text-center">
                              <div className="text-[9px] text-[#868fa0] uppercase tracking-wider font-bold">Comm</div>
                              <div className="text-xs font-bold text-[#142651]">{(myFeedback.ratings?.communication || myFeedback.communicationRating || 0)} / 5</div>
                            </div>
                            <div className="bg-[#f8f9fa] p-2 rounded text-center">
                              <div className="text-[9px] text-[#868fa0] uppercase tracking-wider font-bold">Culture</div>
                              <div className="text-xs font-bold text-[#142651]">{(myFeedback.ratings?.culture || myFeedback.cultureFitRating || 0)} / 5</div>
                            </div>
                          </div>

                          <div className="space-y-2 text-xs text-[#5e6a85]">
                            <div>
                              <span className="font-semibold text-[#142651]">Strengths:</span> {myFeedback.strengths || '-'}
                            </div>
                            <div>
                              <span className="font-semibold text-[#142651]">Concerns:</span> {(myFeedback.concerns || myFeedback.weaknesses || '-')}
                            </div>
                            <div>
                              <span className="font-semibold text-[#142651]">Overall Summary:</span>
                              <p className="text-[#5e6a85] mt-1 italic bg-white border border-slate-100 p-2 rounded-lg text-[11px] leading-relaxed">
                                "{(myFeedback.notes || myFeedback.overallComments || 'No additional comments.')}"
                              </p>
                            </div>

                            {myFeedback.recommendation === 'OFFER_LETTER' && (
                              <div className="space-y-2 p-3 bg-blue-50/50 rounded-xl border border-blue-100 mt-3 text-xs">
                                <div className="font-bold text-[#1f52cc] text-[10px] uppercase tracking-wider">Offer Letter Attachments</div>
                                
                                <div className="flex justify-between items-center py-1 border-b border-blue-50">
                                  <span className="text-slate-500 font-medium">Phone Follow-up:</span>
                                  {myFeedback.offerPhoneFollowUp ? (
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => downloadBase64File(myFeedback.offerPhoneFollowUp.name, myFeedback.offerPhoneFollowUp.data)}
                                        className="text-blue-600 font-bold hover:underline flex items-center gap-1 text-left text-xs"
                                      >
                                        <span className="material-symbols-outlined text-xs">attachment</span>
                                        <span className="truncate max-w-[120px]">{myFeedback.offerPhoneFollowUp.name}</span>
                                      </button>
                                      {isAdmin && (
                                        <>
                                          <input
                                            type="file"
                                            id={`replace-offer-phone-${selectedInterview?.id}`}
                                            className="hidden"
                                            onChange={async (e) => {
                                              const file = e.target.files[0];
                                              if (!file) return;
                                              const base64 = await fileToBase64(file);
                                              const updatedFeedback = { ...myFeedback, offerPhoneFollowUp: base64 };
                                              await schedulingApi.submitFeedback(selectedInterview.id, updatedFeedback);
                                              await loadAll();
                                              e.target.value = '';
                                            }}
                                          />
                                          <label
                                            htmlFor={`replace-offer-phone-${selectedInterview?.id}`}
                                            className="cursor-pointer text-[#1f52cc] hover:text-[#163fa3] text-[10px] font-semibold bg-blue-50 px-1.5 py-0.5 rounded hover:bg-blue-100 transition-colors"
                                          >
                                            Replace
                                          </label>
                                        </>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-rose-500 font-bold text-[10px]">Didn't upload</span>
                                  )}
                                </div>

                                <div className="flex justify-between items-center py-1">
                                  <span className="text-slate-500 font-medium">Email Follow-up:</span>
                                  {myFeedback.offerEmailFollowUp ? (
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => downloadBase64File(myFeedback.offerEmailFollowUp.name, myFeedback.offerEmailFollowUp.data)}
                                        className="text-blue-600 font-bold hover:underline flex items-center gap-1 text-left text-xs"
                                      >
                                        <span className="material-symbols-outlined text-xs">attachment</span>
                                        <span className="truncate max-w-[120px]">{myFeedback.offerEmailFollowUp.name}</span>
                                      </button>
                                      {isAdmin && (
                                        <>
                                          <input
                                            type="file"
                                            id={`replace-offer-email-${selectedInterview?.id}`}
                                            className="hidden"
                                            onChange={async (e) => {
                                              const file = e.target.files[0];
                                              if (!file) return;
                                              const base64 = await fileToBase64(file);
                                              const updatedFeedback = { ...myFeedback, offerEmailFollowUp: base64 };
                                              await schedulingApi.submitFeedback(selectedInterview.id, updatedFeedback);
                                              await loadAll();
                                              e.target.value = '';
                                            }}
                                          />
                                          <label
                                            htmlFor={`replace-offer-email-${selectedInterview?.id}`}
                                            className="cursor-pointer text-[#1f52cc] hover:text-[#163fa3] text-[10px] font-semibold bg-blue-50 px-1.5 py-0.5 rounded hover:bg-blue-100 transition-colors"
                                          >
                                            Replace
                                          </label>
                                        </>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-rose-500 font-bold text-[10px]">Didn't upload</span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                      )}      </div>
                  </div>
                </div>

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



              </div>
            </Reveal>


          </>
        )}
      </PageEnter>

      {/* MODALS */}
      {showScheduleModal && (
        <ScheduleModal
          scheduleForm={scheduleForm}
          setScheduleForm={setScheduleForm}
          candidateSearch={candidateSearch}
          setCandidateSearch={setCandidateSearch}
          jobSearch={jobSearch}
          setJobSearch={setJobSearch}
          interviewerSearch={interviewerSearch}
          setInterviewerSearch={setInterviewerSearch}
          showCandidateList={showCandidateList}
          setShowCandidateList={setShowCandidateList}
          showJobList={showJobList}
          setShowJobList={setShowJobList}
          candidateSuggestions={candidateSuggestions}
          jobSuggestions={jobSuggestions}
          interviewers={interviewers}
          searchingCandidates={searchingCandidates}
          searchingJobs={searchingJobs}
          savingSchedule={savingSchedule}
          allInterviews={allInterviews}
          onClose={() => setShowScheduleModal(false)}
          onSubmit={async (e) => {
            const success = await onScheduleSubmit(e);
            if (success) setShowScheduleModal(false);
          }}
        />
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
                        {(person.fullName || 'I').split(' ').map(n => n[0]).join('').toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <div className="font-bold text-slate-700 text-sm">{person.fullName || 'Interviewer'}</div>
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

      {showFeedbackModal && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setShowFeedbackModal(false)} />
          <Reveal className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden relative z-10 animate-in zoom-in-95 duration-200">
            <div className="p-8 max-h-[90vh] overflow-y-auto custom-scrollbar">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-[#0f1b3d]">Update Assessment (Round {selectedInterview?.roundNo === 99 ? 'Final' : selectedInterview?.roundNo})</h2>
                  <p className="text-xs text-slate-500 mt-1">Modify candidate performance details for this round</p>
                </div>
                <button className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors" onClick={() => setShowFeedbackModal(false)}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <form className="space-y-4" onSubmit={async (e) => {
                const success = await onFeedbackSubmit(e);
                if (success) {
                  setShowFeedbackModal(false);
                }
              }}>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1 text-center">
                    <label className="text-[10px] uppercase font-bold text-slate-500">Technical</label>
                    <select className="h-10 w-full rounded-xl border border-slate-200 px-2 text-sm text-center focus:border-[#1f52cc] outline-none" value={feedbackForm.technicalRating} onChange={e => setFeedbackForm(prev => ({...prev, technicalRating: parseInt(e.target.value, 10)}))}>
                      {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}/5</option>)}
                    </select>
                  </div>
                  <div className="space-y-1 text-center">
                    <label className="text-[10px] uppercase font-bold text-slate-500">Comm.</label>
                    <select className="h-10 w-full rounded-xl border border-slate-200 px-2 text-sm text-center focus:border-[#1f52cc] outline-none" value={feedbackForm.communicationRating} onChange={e => setFeedbackForm(prev => ({...prev, communicationRating: parseInt(e.target.value, 10)}))}>
                      {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}/5</option>)}
                    </select>
                  </div>
                  <div className="space-y-1 text-center">
                    <label className="text-[10px] uppercase font-bold text-slate-500">Culture</label>
                    <select className="h-10 w-full rounded-xl border border-slate-200 px-2 text-sm text-center focus:border-[#1f52cc] outline-none" value={feedbackForm.cultureFitRating} onChange={e => setFeedbackForm(prev => ({...prev, cultureFitRating: parseInt(e.target.value, 10)}))}>
                      {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}/5</option>)}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Overall Recommendation</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                    {['SELECTED', 'OFFER_LETTER', 'ON_HOLD', 'DIDNT_JOIN', 'REJECTED'].map(rec => {
                      const icons = {
                        SELECTED: 'verified',
                        OFFER_LETTER: 'card_membership',
                        ON_HOLD: 'pause_circle',
                        DIDNT_JOIN: 'sentiment_dissatisfied',
                        REJECTED: 'block'
                      };
                      const labels = {
                        SELECTED: 'Selected',
                        OFFER_LETTER: 'Offer Letter',
                        ON_HOLD: 'On Hold',
                        DIDNT_JOIN: "Didn't Join",
                        REJECTED: 'Rejected'
                      };
                      return (
                        <button 
                          key={rec}
                          type="button" 
                          className={`h-12 rounded-2xl border font-bold text-[10px] uppercase flex flex-col items-center justify-center gap-1 transition-all ${
                            feedbackForm.recommendation === rec 
                              ? rec === 'DIDNT_JOIN' 
                                ? 'bg-slate-100 border-slate-400 text-slate-700 shadow-inner'
                                : rec === 'SELECTED'
                                  ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-inner'
                                  : rec === 'OFFER_LETTER'
                                    ? 'bg-emerald-50 border-emerald-500 text-emerald-700 shadow-inner'
                                    : rec === 'ON_HOLD'
                                      ? 'bg-amber-50 border-amber-500 text-amber-700 shadow-inner'
                                      : 'bg-rose-50 border-rose-500 text-rose-700 shadow-inner'
                              : 'border-slate-100 text-slate-400 hover:bg-slate-50'
                          }`}
                          onClick={() => setFeedbackForm(prev => ({ ...prev, recommendation: rec }))}
                        >
                          <span className="material-symbols-outlined text-lg">{icons[rec]}</span>
                          {labels[rec]}
                        </button>
                      );
                    })}
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
                    <div className="text-[10px] uppercase font-bold text-slate-400">Attach Document <span className="normal-case font-normal text-slate-300">(optional)</span></div>
                    {offerLetterFile && (
                      <div className="text-xs text-[#1f52cc] font-semibold mt-0.5 truncate">{offerLetterFile.name}</div>
                    )}
                  </div>
                  <input 
                    type="file" 
                    className="hidden" 
                    id="modal-offer-upload" 
                    onChange={(e) => setOfferLetterFile(e.target.files[0])}
                    accept=".pdf,.doc,.docx"
                  />
                  <label htmlFor="modal-offer-upload" className="shrink-0 px-4 h-8 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600 flex items-center cursor-pointer hover:border-[#1f52cc] hover:text-[#1f52cc] transition-all">
                    {offerLetterFile ? 'Change' : 'Browse'}
                  </label>
                  {offerLetterFile && (
                    <button type="button" onClick={() => setOfferLetterFile(null)} className="w-7 h-7 rounded-lg bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 flex items-center justify-center transition-all">
                      <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                  )}
                </div>

                <div className="flex gap-3 pt-4">
                  <button type="button" className="flex-1 h-12 rounded-xl border border-slate-200 font-bold text-slate-500 hover:bg-slate-50 transition-all" onClick={() => setShowFeedbackModal(false)}>Cancel</button>
                  <button type="submit" className="flex-1 h-12 rounded-xl bg-[#2ca764] text-white font-bold shadow-lg shadow-emerald-200 hover:bg-[#258a52] transition-all disabled:opacity-50" disabled={savingFeedback}>
                    {savingFeedback ? 'Saving...' : 'Save Assessment'}
                  </button>
                </div>
              </form>
            </div>
          </Reveal>
        </div>
      )}

    </EnterpriseLayout>
  );
};

export default InterviewSchedule;
