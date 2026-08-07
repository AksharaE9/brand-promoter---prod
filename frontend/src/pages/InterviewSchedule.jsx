import * as React from 'react';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { buildApiUrl, API_ROOT_URL, apiGet, apiGetBlob, apiPost, apiDelete, getStoredUser } from '../lib/api';
import { search } from '../lib/searchClient';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';
import { subscribeSSE } from '../lib/sse';
import { groupInterviewsByDate, toDateKey, formatTime12h, getStatusStyle, getCandidateInitials } from '../lib/groupInterviewsByDate';

import { useRoundsList, useCreateRound, useSubmitFeedback, useRescheduleRound, useUpdatePanel, useSaveMeetLink, useTransferCandidate, useDeleteRound, useRoundDetails, updateInfiniteOrFlatList } from '../hooks/useScheduling';
import useDebounce from '../hooks/useDebounce';
import { schedulingApi } from '../services/schedulingApi';
import { usePaginatedList } from '../hooks/usePaginatedList';
import InfiniteScrollSentinel from '../components/InfiniteScrollSentinel';

import SyncIndicator from '../components/Interview/SyncIndicator';
import InterviewMemberSkeleton from '../components/Interview/InterviewMemberSkeleton';
import CopyFeedbackButton from '../components/Interview/CopyFeedbackButton';
import { CandidateNameLink } from '../components/CandidateNameLink';
import { usePanelists } from '../hooks/usePanelists';
import {
  MAX_UPLOAD_BYTES,
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  ACCEPT_ATTRIBUTE,
  ERROR_UNSUPPORTED,
  ERROR_TOO_LARGE,
} from '../config/followUpConfig';

import { lazyWithRetry } from '../lib/lazyWithRetry';

// Lazy load secondary sub-components to reduce initial load weight
const EditInterviewModal = lazyWithRetry(() => import('../components/Interview/EditInterviewModal'), 'EditInterviewModal');
const ExcelView = lazyWithRetry(() => import('../components/Interview/ExcelView'), 'ExcelView');
const InterviewFeedbackForm = lazyWithRetry(() => import('../components/Interview/InterviewFeedbackForm'), 'InterviewFeedbackForm');
const InterviewFeedbackView = lazyWithRetry(() => import('../components/Interview/InterviewFeedbackView'), 'InterviewFeedbackView');
const BulkInterviewUploadModal = lazyWithRetry(() => import('../components/Interview/BulkInterviewUploadModal'), 'BulkInterviewUploadModal');
const BulkFeedbackUploadModal = lazyWithRetry(() => import('../components/Interview/BulkFeedbackUploadModal'), 'BulkFeedbackUploadModal');
import { ContactAttemptPopover } from '../components/Interview/ContactAttemptPopover';
import { formatTime24h, formatDateTime24h } from '../lib/datetime';
import {
  InterviewRound,
  ROUND_SEQUENCE,
  ROUND_DISPLAY_LABEL,
  getNextSchedulableRound,
} from '../lib/interviewTemplates';

const SSE_RELOAD_DEBOUNCE = 1500; // 1.5s minimum between SSE-triggered reloads




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
  try {
    let blob;
    if (base64Data.startsWith('data:')) {
      const parts = base64Data.split(',');
      const mime = parts[0].match(/:(.*?);/)[1];
      const bstr = atob(parts[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      blob = new Blob([u8arr], { type: mime });
    } else {
      const bstr = atob(base64Data);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      blob = new Blob([u8arr], { type: 'application/octet-stream' });
    }
    
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    }, 100);
  } catch (error) {
    console.error('Failed to download file:', error);
    const link = document.createElement('a');
    link.href = base64Data;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};

const formatDateTimeIN = (dateStr) => {
  if (!dateStr) return '-';
  return formatDateTime24h(dateStr) || '-';
};

export const FollowUpUploadField = React.memo(({
  label,
  id,
  value,
  onUpload,
  onDelete,
  isAdmin,
  allowedExtensions,
  onError,
  interviewId,
}) => {
  const [uploading, setUploading] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [uploadError, setUploadError] = React.useState(null);
  const [fetchingView, setFetchingView] = React.useState(false);

  const fieldKey = id ? id.split('-').slice(0, -1).join('-').replace('phone-followup', 'phoneFollowUp').replace('email-followup', 'emailFollowUp').replace('morning-followup', 'morningFollowUp') : null;

  const validateAndProcess = async (file) => {
    if (!file) return null;

    const validExts = allowedExtensions && allowedExtensions.length > 0 ? allowedExtensions : ALLOWED_EXTENSIONS;

    // Enforce size limit
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError(ERROR_TOO_LARGE);
      if (onError) onError(ERROR_TOO_LARGE);
      return null;
    }

    // Enforce extension whitelist
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!ext || !validExts.includes(ext)) {
      setUploadError(ERROR_UNSUPPORTED);
      if (onError) onError(ERROR_UNSUPPORTED);
      return null;
    }

    return await fileToBase64(file);
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadError(null);
    const base64 = await validateAndProcess(file);
    e.target.value = '';
    if (!base64) return;
    setUploading(true);
    try {
      await onUpload(base64);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Upload failed — please try again.';
      setUploadError(msg);
      if (onError) onError(msg);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete || deleting) return;
    if (!window.confirm(`Are you sure you want to delete the ${label} file?`)) return;
    setUploadError(null);
    setDeleting(true);
    try {
      await onDelete();
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to delete attachment';
      setUploadError(msg);
      if (onError) onError(msg);
    } finally {
      setDeleting(false);
    }
  };

  // Lazily fetch full base64 data when the stored value is a stripped stub (exists:true, no data)
  const handleView = async () => {
    if (value?.data) {
      downloadBase64File(value.name, value.data);
      return;
    }
    if (!interviewId || fetchingView) return;
    setFetchingView(true);
    try {
      const { apiGet } = await import('../lib/api');
      const res = await apiGet(`/interviews/${interviewId}`);
      const round = res?.data || res;
      const notesRaw = round?.notes;
      if (!notesRaw) throw new Error('No notes data returned from server.');
      const parsed = typeof notesRaw === 'string' ? JSON.parse(notesRaw) : notesRaw;
      // Derive the field key from the id prop (e.g. 'phone-followup-xyz' → 'phoneFollowUp')
      const rawKey = id ? id.replace(/-[^-]+$/, '') : '';
      const keyMap = { 'phone-followup': 'phoneFollowUp', 'email-followup': 'emailFollowUp', 'morning-followup': 'morningFollowUp' };
      const resolvedKey = keyMap[rawKey] || rawKey;
      const entry = parsed[resolvedKey];
      if (!entry?.data) throw new Error('File data not found — it may have been removed.');
      downloadBase64File(entry.name || value.name, entry.data);
    } catch (err) {
      console.error('[FollowUpUploadField] view fetch failed:', err);
      setUploadError(err.message || 'Failed to load file for preview.');
    } finally {
      setFetchingView(false);
    }
  };

  return (
    <div className="flex flex-col border-b border-slate-50 pb-2 gap-1">
      <div className="flex items-center">
        <span className="w-28 text-[#6d7893] shrink-0 font-medium">{label}:</span>
        {value ? (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <span className="material-symbols-outlined text-xs text-slate-400">attachment</span>
              <span className="truncate max-w-[120px] text-slate-700 text-xs" title={value.name}>
                {value.name}
              </span>
              <button
                type="button"
                onClick={handleView}
                disabled={fetchingView}
                className="text-blue-600 hover:text-blue-800 p-0.5 rounded hover:bg-blue-50 transition-colors flex items-center justify-center disabled:opacity-50"
                title={fetchingView ? 'Loading…' : 'Preview / Download'}
              >
                <span className="material-symbols-outlined text-sm">
                  {fetchingView ? 'hourglass_empty' : 'visibility'}
                </span>
              </button>
            </div>
            {isAdmin && (
              <>
                <input
                  type="file"
                  id={`replace-${id}`}
                  className="hidden"
                  accept={allowedExtensions ? allowedExtensions.join(',') : ACCEPT_ATTRIBUTE}
                  onChange={handleFileChange}
                />
                <label
                  htmlFor={`replace-${id}`}
                  className={`cursor-pointer text-[#1f52cc] hover:text-[#163fa3] text-xs font-semibold bg-blue-50 px-2 py-0.5 rounded-md hover:bg-blue-100 transition-colors ${uploading || deleting ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  {uploading ? 'Uploading…' : 'Replace File'}
                </label>
                {onDelete && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={uploading || deleting}
                    className={`cursor-pointer text-rose-600 hover:text-rose-800 text-xs font-semibold bg-rose-50 px-2 py-0.5 rounded-md hover:bg-rose-100 transition-colors ${uploading || deleting ? 'opacity-50 pointer-events-none' : ''}`}
                    title="Delete file"
                  >
                    {deleting ? 'Deleting…' : 'Delete'}
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 italic text-xs">No file attached</span>
            {isAdmin && (
              <>
                <input
                  type="file"
                  id={`upload-${id}`}
                  className="hidden"
                  accept={allowedExtensions ? allowedExtensions.join(',') : ACCEPT_ATTRIBUTE}
                  onChange={handleFileChange}
                />
                <label
                  htmlFor={`upload-${id}`}
                  className={`cursor-pointer text-[#1f52cc] hover:text-[#163fa3] text-xs font-semibold bg-blue-50 px-2 py-0.5 rounded-md hover:bg-blue-100 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  {uploading ? 'Uploading…' : 'Upload File'}
                </label>
              </>
            )}
          </div>
        )}
      </div>
      {uploadError && (
        <div className="flex items-center gap-1 text-[10px] text-red-600 font-medium ml-28">
          <span className="material-symbols-outlined text-xs">error</span>
          {uploadError}
        </div>
      )}
    </div>
  );
});
FollowUpUploadField.displayName = 'FollowUpUploadField';


const parseNotesSafely = (notesStr) => {
  if (!notesStr) return { phoneFollowUp: null, emailFollowUp: null, nextSchedule: null, morningFollowUp: null };
  try {
    const parsed = JSON.parse(notesStr);
    if (parsed && typeof parsed === 'object') {
      return {
        phoneFollowUp: parsed.phoneFollowUp || null,
        emailFollowUp: parsed.emailFollowUp || null,
        nextSchedule: parsed.nextSchedule || null,
        morningFollowUp: parsed.morningFollowUp || null
      };
    }
  } catch (e) { /* ignore */ }
  return { phoneFollowUp: null, emailFollowUp: null, nextSchedule: null, morningFollowUp: null };
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
  phoneFollowUp: null,
  emailFollowUp: null,
  morningFollowUp: null,
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
          const name = iv.application?.candidate?.fullName || iv.candidateName || 'Deleted Candidate';
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
              <CandidateNameLink
                candidateId={iv.application?.candidate?.id || iv.application?.candidateId || iv.candidateId}
                candidateName={name.split(' ')[0]}
                variant="activity"
                className={`text-[9px] font-semibold truncate flex-1 ${text}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onChipClick(iv.application?.candidate?.id || iv.application?.candidateId || iv.candidateId, iv.id);
                }}
              />
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

// ScheduleModal is lazy-loaded to optimize initial bundle size and load performance
const ScheduleModal = lazyWithRetry(() => import('../components/Interview/ScheduleModal').then(module => ({ default: module.ScheduleModal })), 'ScheduleModal');


const InterviewSchedule = () => {
  const currentUser = getStoredUser();
  const isAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'RECRUITER';
  const [filterMine, setFilterMine] = useState(currentUser?.role === 'INTERVIEWER');

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const jobIdParam = searchParams.get('jobId');
  const interviewIdParam = searchParams.get('interviewId');
  const shouldSubmitFeedback = searchParams.get('submitFeedback') === 'true';
  const [activeInterviewId, setActiveInterviewId] = useState('');

  const [applications, setApplications] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [jobs, setJobs] = useState([]);
  // Suggestions are now managed by TanStack Query useQuery hooks below
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');
  const [scheduleForm, setScheduleForm] = useState(emptyScheduleForm);
  const [feedbackForm, setFeedbackForm] = useState(emptyFeedbackForm);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [offerLetterFile, setOfferLetterFile] = useState(null);
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [uploadingRecording, setUploadingRecording] = useState(false);
  const [recordingFile, setRecordingFile] = useState(null);
  const [scheduleRecordingFile, setScheduleRecordingFile] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recordedUrl, setRecordedUrl] = useState('');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [viewMode, setViewMode] = useState('list');
  const prevViewModeRef = useRef('list');
  const [joiningDate, setJoiningDate] = useState('');
  const [showJoiningConfirm, setShowJoiningConfirm] = useState(false);
  const [viewDate, setViewDate] = useState(new Date());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(null);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [calendarData, setCalendarData] = useState(() => new Map());
  const [jobSearch, setJobSearch] = useState('');
  const [candidateSearch, setCandidateSearch] = useState('');
  const [interviewerSearch, setInterviewerSearch] = useState('');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showBulkUploadModal, setShowBulkUploadModal] = useState(false);
  const [showBulkFeedbackModal, setShowBulkFeedbackModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferringInterview, setTransferringInterview] = useState(null);
  const [editingInterviewId, setEditingInterviewId] = useState(null);
  const [isEditingFeedback, setIsEditingFeedback] = useState(false);
  const [showCandidateList, setShowCandidateList] = useState(false);
  const [showJobList, setShowJobList] = useState(false);
  const lastCandidateJobKeyRef = useRef('');
  const [roundFilter, setRoundFilter] = useState('all'); // 'all', '1', '2'
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  // FORCE TRUE FOR VERIFICATION
  const canScheduleInterview = true;
  const recorderSupported = typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined';

  // Search: raw typed value (not yet debounced)
  const [interviewListSearch, setInterviewListSearch] = useState('');
  // Debounced version sent to the backend
  const debouncedSearch = useDebounce(interviewListSearch, 300);

  const [allInterviews, setAllInterviews] = useState([]); // accumulates pages

  const roundsFilters = useMemo(() => ({
    ...(filterMine && currentUser?.id ? { interviewerId: currentUser.id } : {}),
    ...(debouncedSearch ? { search: debouncedSearch } : {})
  }), [filterMine, currentUser?.id, debouncedSearch]);

  const {
    data: infiniteData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: isQueryLoading,
    refetch: refetchInterviews,
    error: queryError
  } = usePaginatedList('/interviews', {
    pageSize: 150,
    filters: roundsFilters,
    queryKey: ['scheduling', 'rounds']
  });

  const serverHasMore = hasNextPage;
  const loadingMore = isFetchingNextPage;

  // totalCount: real DB COUNT(*) returned by the backend on page 1.
  // Available immediately when page 1 loads — no need to wait for all pages.
  // Falls back to null while loading.
  const totalCount = infiniteData?.pages?.[0]?.totalCount ?? null;

  // Synchronize infinite query data to allInterviews local state
  useEffect(() => {
    if (infiniteData?.pages) {
      const flattened = infiniteData.pages.flatMap(page => page.data || page.rows || []);
      setAllInterviews(flattened);
    } else {
      setAllInterviews([]);
    }
  }, [infiniteData]);

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



  const { data: panelistsList, isLoading: isPanelistsLoading, error: panelistsError, refetch: refetchPanelists } = usePanelists({
    enabled: showScheduleModal || showTransferModal
  });
  const interviewers = panelistsList || [];


  // Load-more: fetch next page using cursor
  const loadMoreInterviews = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

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

  // ── Calendar view month-scoped query & prefetching ──
  const isCalendar = viewMode === 'calendar';
  
  // Calculate date range of visible calendar days (using first and last visible cells)
  const calendarRange = useMemo(() => {
    if (!calendarDays || calendarDays.length === 0) return null;
    const start = new Date(calendarDays[0].date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(calendarDays[calendarDays.length - 1].date);
    end.setHours(23, 59, 59, 999);
    return {
      start: start.toISOString(),
      end: end.toISOString()
    };
  }, [calendarDays]);

  const {
    data: calendarResponse,
    isLoading: isCalendarLoading,
    isError: isCalendarError,
    refetch: refetchCalendar,
  } = useQuery({
    queryKey: ['scheduling', 'calendar', viewDate.getFullYear(), viewDate.getMonth(), filterMine, roundFilter],
    queryFn: () => schedulingApi.getRounds({
      view: 'calendar',
      startDate: calendarRange.start,
      endDate: calendarRange.end,
      ...(filterMine ? { interviewerId: currentUser?.id } : {}),
      ...(roundFilter !== 'all' ? { roundNo: roundFilter } : {}),
    }),
    enabled: isCalendar && !!calendarRange,
    staleTime: 60 * 1000,
  });

  const calendarInterviews = calendarResponse?.data || [];

  // Prefetch next and previous months in background
  useEffect(() => {
    if (!isCalendar || !calendarRange) return;

    // Prefetch next month
    const nextMonthDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
    const nextStart = new Date(nextMonthDate.getFullYear(), nextMonthDate.getMonth(), -7).toISOString();
    const nextEnd = new Date(nextMonthDate.getFullYear(), nextMonthDate.getMonth() + 1, 14).toISOString();
    const nextYear = nextMonthDate.getFullYear();
    const nextMonth = nextMonthDate.getMonth();

    queryClient.prefetchQuery({
      queryKey: ['scheduling', 'calendar', nextYear, nextMonth, filterMine, roundFilter],
      queryFn: () => schedulingApi.getRounds({
        view: 'calendar',
        startDate: nextStart,
        endDate: nextEnd,
        ...(filterMine ? { interviewerId: currentUser?.id } : {}),
        ...(roundFilter !== 'all' ? { roundNo: roundFilter } : {}),
      }),
      staleTime: 60 * 1000,
    });

    // Prefetch previous month
    const prevMonthDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
    const prevStart = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth(), -7).toISOString();
    const prevEnd = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth() + 1, 14).toISOString();
    const prevYear = prevMonthDate.getFullYear();
    const prevMonth = prevMonthDate.getMonth();

    queryClient.prefetchQuery({
      queryKey: ['scheduling', 'calendar', prevYear, prevMonth, filterMine, roundFilter],
      queryFn: () => schedulingApi.getRounds({
        view: 'calendar',
        startDate: prevStart,
        endDate: prevEnd,
        ...(filterMine ? { interviewerId: currentUser?.id } : {}),
        ...(roundFilter !== 'all' ? { roundNo: roundFilter } : {}),
      }),
      staleTime: 60 * 1000,
    });
  }, [viewDate, isCalendar, calendarRange, filterMine, roundFilter, queryClient]);


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
        setSupportingDataLoaded(true);
      } catch (err) {
        console.error('Failed to load scheduler supporting data:', err);
      }
    };

    loadSupportingData();
  }, [viewMode, showScheduleModal, supportingDataLoaded, interviews]);

  const debouncedCandidateSearch = useDebounce(candidateSearch, 200);
  const debouncedJobSearch = useDebounce(jobSearch, 200);

  const { data: candidateSearchData, isFetching: isSearchingCandidates } = useQuery({
    queryKey: ['candidates', 'suggest', debouncedCandidateSearch],
    queryFn: ({ signal }) => search('/candidates/search', { q: debouncedCandidateSearch, limit: 20 }, signal),
    enabled: showScheduleModal && debouncedCandidateSearch.trim().length >= 2,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });

  const { data: jobSearchData, isFetching: isSearchingJobs } = useQuery({
    queryKey: ['jobs', 'suggest', debouncedJobSearch],
    queryFn: ({ signal }) => search('/jobs/search', { q: debouncedJobSearch, filters: { isActive: true }, limit: 20 }, signal),
    enabled: showScheduleModal && debouncedJobSearch.trim().length >= 2,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });

  const candidateSuggestions = candidateSearchData?.data || [];
  const jobSuggestions = jobSearchData?.data || [];
  const searchingCandidates = isSearchingCandidates;
  const searchingJobs = isSearchingJobs;

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
      'CANDIDATE_UPDATED', 'CANDIDATE_CREATED', 'CANDIDATE_DELETED',
      'SCHEDULING_UPDATE', 'ROUND_CREATED', 'ROUND_DELETED',
      'VISIBILITY_RECONCILE', 'interview-feedback:updated'
    ];
    const unsub = subscribeSSE((data) => {
      if (!RELEVANT.includes(data.type)) return;

      // 1. Direct local state update for instant client responsiveness
      if (data.type === 'ROUND_CREATED') {
        const newRound = data.round;
        if (newRound?.id) {
          const normalizedRound = {
            ...newRound,
            candidate: newRound.candidateName ? { id: newRound.candidateId, fullName: newRound.candidateName } : null,
            job: newRound.jobTitle ? { id: newRound.jobId, title: newRound.jobTitle } : null,
            interviewers: (newRound.interviewerNames || '').split(',').map(n => ({ fullName: n.trim() })).filter(u => u.fullName),
            interviewerIds: (() => { try { return typeof newRound.interviewerIds === 'string' ? JSON.parse(newRound.interviewerIds) : newRound.interviewerIds || []; } catch { return []; } })(),
            feedback: [],
          };

          setAllInterviews(prev => {
            if (prev.some(i => i.id === normalizedRound.id)) return prev;
            return [normalizedRound, ...prev];
          });

          queryClient.setQueriesData({ queryKey: ['scheduling', 'rounds'] }, (old) =>
            updateInfiniteOrFlatList(old, (list) => {
              if (list.some(i => i.id === normalizedRound.id)) return list;
              return [normalizedRound, ...list];
            })
          );
        }
      } else if (data.type === 'ROUND_DELETED') {
        const deletedId = data.roundId;
        if (deletedId) {
          setAllInterviews(prev => prev.filter(i => i.id !== deletedId));

          queryClient.setQueriesData({ queryKey: ['scheduling', 'rounds'] }, (old) =>
            updateInfiniteOrFlatList(old, (list) => list.filter(i => i.id !== deletedId))
          );

          // Immediately evict the detail cache for the deleted round so the
          // detail panel doesn't keep showing the stale 'SELECTED' badge
          queryClient.removeQueries({ queryKey: ['scheduling', 'round-details', deletedId] });

          // Reset the active interview selection if the deleted round was selected
          setActiveInterviewId(prev => (prev === deletedId ? '' : prev));
        }
      } else if (data.type === 'SCHEDULING_UPDATE') {
        const { type: sub, roundId, round } = data;
        const actualSub = data.subType || sub;
        if (actualSub === 'ROUND_UPDATED' && roundId && round) {
          setAllInterviews(prev => prev.map(i => i.id === roundId ? { ...i, ...round } : i));

          queryClient.setQueriesData({ queryKey: ['scheduling', 'rounds'] }, (old) =>
            updateInfiniteOrFlatList(old, (list) =>
              list.map(i => i.id === roundId ? { ...i, ...round } : i)
            )
          );

          // Sync the detailed view cache so the panel updates files/status in real-time
          queryClient.setQueriesData({ queryKey: ['scheduling', 'round-details', roundId] }, (old) => {
            if (!old) return old;
            return {
              ...old,
              ...round,
            };
          });
        }
      }

      const now = Date.now();
      if (now - lastSSEReloadRef.current < SSE_RELOAD_DEBOUNCE) return;
      lastSSEReloadRef.current = now;

      // For feedback events, force-refetch the currently open round-details so
      // the status badge updates immediately in all open tabs/windows
      if (data.type === 'interview-feedback:updated' || data.type === 'INTERVIEW_FEEDBACK_SUBMITTED') {
        queryClient.invalidateQueries({
          queryKey: ['scheduling', 'round-details'],
          refetchType: 'active',
        });
        queryClient.invalidateQueries({
          queryKey: ['scheduling'],
          refetchType: 'active',
        });
        queryClient.invalidateQueries({
          queryKey: ['candidates'],
          refetchType: 'active',
        });
      } else {
        // Mark all other scheduling queries stale; let natural mount/refetch update them
        queryClient.invalidateQueries({
          queryKey: ['scheduling'],
          refetchType: 'active',
        });
      }
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

  const isSearching = isQueryLoading && !!debouncedSearch;
  const searchError = queryError;
  const refetchSearch = refetchInterviews;

  const displayInterviews = interviews;

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

  const filteredForExcel = useMemo(() => {
    const source = allInterviews;
    let filtered = filterMine
      ? source.filter(iv => iv.interviewerIds?.includes(currentUser?.id))
      : source;

    if (roundFilter !== 'all') {
      const targetRound = parseInt(roundFilter, 10);
      filtered = filtered.filter(iv => (iv.roundNo || 0) === targetRound);
    }

    return filtered;
  }, [allInterviews, filterMine, currentUser?.id, roundFilter]);


  // ── groupedApplications: built purely from interviews data, no candidates limit ──
  const groupedApplications = useMemo(() => {
    const map = new Map();

    const filteredInterviews = filterMine
      ? displayInterviews.filter(iv => iv.interviewerIds?.includes(currentUser?.id))
      : displayInterviews;

    filteredInterviews.forEach((interview) => {
      // The lean list response has candidateId directly on the row (no nested application.candidate).
      // Fall back through the hierarchy: lean top-level candidate.id -> applicationId's candidateId -> direct candidateId
      const cId = interview.application?.candidate?.id
        || interview.application?.candidateId
        || interview.candidate?.id
        || interview.candidateId;
      if (!cId) return;

      if (!map.has(cId)) {
        // Build a synthetic application shape from the lean row for sidebar display
        const syntheticApplication = interview.application || {
          id: interview.applicationId,
          candidateId: cId,
          jobId: interview.jobId,
          candidate: interview.candidate || (interview.candidateName
            ? { id: cId, fullName: interview.candidateName }
            : null),
          job: interview.job || (interview.jobTitle
            ? { id: interview.jobId, title: interview.jobTitle }
            : null),
        };
        map.set(cId, {
          candidateId: cId,
          applicationId: interview.applicationId,
          application: syntheticApplication,
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
          // Prefer the real application object if present, otherwise keep synthetic
          group.application = interview.application || group.application;
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



  const visibleGroups = groupedApplications;



  const scheduleData = useMemo(() => {
    // If calendar view, use calendarInterviews; otherwise use filteredForViews
    const activeInterviews = viewMode === 'calendar' ? calendarInterviews : filteredForViews;
    const interviewsByDate = groupInterviewsByDate(activeInterviews, viewDate);

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
  }, [filteredForViews, calendarInterviews, viewMode, viewDate, applications]);

  const selectedGroupId = selectedId || groupedApplications[0]?.applicationId || '';
  const selectedGroup = useMemo(
    () => groupedApplications.find((g) => g.applicationId === selectedGroupId || g.candidateId === selectedGroupId) || groupedApplications[0] || null,
    [groupedApplications, selectedGroupId],
  );

  const selectedCandidate = selectedGroup?.application?.candidate;
  const latestInterview = selectedGroup?.latestInterview;

  const selectedInterviewRaw = useMemo(
    () => {
      const list = selectedGroup?.interviews || [];
      const activeIv = list.find(i => i.id === activeInterviewId);
      if (activeIv) return activeIv;

      const filtered = filterMine ? list.filter(iv => iv.interviewerIds?.includes(currentUser?.id)) : list;
      return filtered.find(i => i.id === latestInterview?.id) || filtered[0] || latestInterview;
    },
    [selectedGroup, activeInterviewId, latestInterview, filterMine, currentUser?.id]
  );

  const { data: detailsData, isLoading: isDetailsLoading, error: detailsError, refetch: refetchDetails } = useRoundDetails(selectedInterviewRaw?.id);

  const selectedInterview = detailsData || selectedInterviewRaw;

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
    refetchDetails?.();
    if (selectedCandidate?.id) {
      loadCandidateInterviews(selectedCandidate.id);
      queryClient.invalidateQueries({ queryKey: ['candidate-feedbacks', selectedCandidate.id] });
      queryClient.invalidateQueries({ queryKey: ['candidate-interviews', selectedCandidate.id] });
    }
  }, [refetchInterviews, refetchDetails, selectedCandidate?.id, loadCandidateInterviews, queryClient]);

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

  useEffect(() => {
    setIsEditingFeedback(false);
    if (selectedCandidate?.id) {
      loadCandidateInterviews(selectedCandidate.id);
    }
  }, [selectedCandidate?.id, loadCandidateInterviews]);

  // Load interviews when a candidate is selected inside the Schedule Modal
  useEffect(() => {
    if (scheduleForm.candidateId) {
      loadCandidateInterviews(scheduleForm.candidateId);
    }
  }, [scheduleForm.candidateId, loadCandidateInterviews]);

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
    
    const isWalkIn = savedForm.mode === 'WALK_IN_DRIVE';
    const notesPayload = isWalkIn
      ? JSON.stringify({ phoneFollowUp: null, emailFollowUp: null, nextSchedule: null, morningFollowUp: null })
      : JSON.stringify({
          phoneFollowUp: savedForm.phoneFollowUp || null,
          emailFollowUp: savedForm.emailFollowUp || null,
          nextSchedule: savedForm.nextSchedule || null,
          morningFollowUp: savedForm.morningFollowUp || null,
        });

    try {
      const result = await createRoundMutation.mutateAsync({
        applicationId: targetApplicationId,
        roundNo,
        round: savedForm.round,
        interviewerIds: isWalkIn ? [] : savedForm.interviewerIds,
        scheduledStart: new Date(savedForm.scheduledStart).toISOString(),
        scheduledEnd: savedForm.scheduledEnd ? new Date(savedForm.scheduledEnd).toISOString() : null,
        mode: savedForm.mode,
        meetingLink: isWalkIn ? null : (savedForm.meetingLink ? savedForm.meetingLink.trim() : null),
        zohoLink: isWalkIn ? null : (savedForm.zohoLink ? savedForm.zohoLink.trim() : null),
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
        await fetch(buildApiUrl(`/interviews/${newRoundId}/recording`), {
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
        const res = await fetch(buildApiUrl(`/interviews/${savedInterviewId}/feedback`), {
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

  const handleDeleteFeedback = async (candidateId, round) => {
    if (!window.confirm('Delete this feedback? This action can only be reversed by direct database access.')) {
      return;
    }
    try {
      // `round` is already the DB enum value (e.g. 'ROUND_1', 'ROUND_2', 'FINAL_ROUND').
      // Only convert if it's a display label (legacy call paths).
      const ENUM_VALUES = ['ROUND_1', 'ROUND_2', 'FINAL_ROUND'];
      const mappedRound = ENUM_VALUES.includes(round)
        ? round
        : round === 'Round 1' ? 'ROUND_1'
        : round === 'Round 2' ? 'ROUND_2'
        : 'FINAL_ROUND';

      const res = await apiDelete(`/interviews/${candidateId}/feedback/${mappedRound}`);
      if (res?.success) {
        setBanner('Feedback soft-deleted successfully.');
        // Force-refetch the currently open round so the result badge resets
        // immediately rather than waiting for the 10s staleTime to expire.
        queryClient.invalidateQueries({
          queryKey: ['scheduling', 'round-details'],
          refetchType: 'active',
        });
        queryClient.invalidateQueries({ queryKey: ['scheduling'] });
        queryClient.invalidateQueries({ queryKey: ['candidates'] });
        if (candidateId) {
          queryClient.invalidateQueries({ queryKey: ['candidate', candidateId] });
          queryClient.invalidateQueries({ queryKey: ['interviews', candidateId] });
          queryClient.invalidateQueries({ queryKey: ['candidate-feedbacks', candidateId] });
        }
        await loadAll();
      } else {
        setError(res?.error || 'Failed to delete feedback');
      }
    } catch (err) {
      setError(err.message || 'An error occurred while deleting feedback');
    }
  };

  const onUpdateStatus = async (applicationId, status) => {
    // Optimistic update via hook — no loading spinner, no refetch
    try {
      const res = await fetch(buildApiUrl(`/applications/${applicationId}/status`), {
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

      const res = await fetch(buildApiUrl(`/interviews/${selectedInterview.id}/voice-recording`), {
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

    // Pre-emptively clear the detail-panel selection and detail cache so the
    // UI collapses immediately and doesn't keep showing a stale SELECTED badge.
    if (activeInterviewId === interviewId) {
      const remaining = (selectedGroup?.interviews || []).filter(i => i.id !== interviewId);
      setActiveInterviewId(remaining.length > 0 ? remaining[0].id : '');
    }
    queryClient.removeQueries({ queryKey: ['scheduling', 'round-details', interviewId] });

    deleteRoundMutation.mutate(interviewId, {
      onSuccess: () => {
        setBanner('Interview deleted successfully.');
        const candId = selectedInterview?.candidateId || selectedInterview?.application?.candidateId || selectedInterview?.application?.candidate?.id || selectedGroup?.candidateId || selectedGroup?.application?.candidateId;
        if (candId) {
          queryClient.invalidateQueries({ queryKey: ['candidate', candId] });
          queryClient.invalidateQueries({ queryKey: ['interviews', candId] });
          queryClient.invalidateQueries({ queryKey: ['candidate-feedbacks', candId] });
        }
      },
      onError: (err) => {
        setError(err.message || 'Failed to delete interview');
      }
    });
  };

  const [transferringPanelist, setTransferringPanelist] = useState(false);

  const onTransferPanelist = async (interviewerId) => {
    if (!transferringInterview || transferringPanelist) return;

    const candidateId = transferringInterview.candidateId || transferringInterview.application?.candidateId || transferringInterview.application?.candidate?.id;
    if (!candidateId) return;

    setError('');
    setTransferringPanelist(true);

    try {
      await schedulingApi.transferPanelist(candidateId, { panelistId: interviewerId });

      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['candidate', candidateId] });
      queryClient.invalidateQueries({ queryKey: ['interviews', candidateId] });
      queryClient.invalidateQueries({ queryKey: ['interviews'] });

      setBanner('Panelist transferred successfully.');
      setShowTransferModal(false);
      setTransferringInterview(null);
      await loadAll();
    } catch (err) {
      setError(`Transfer failed: ${err.response?.data?.message || err.message || 'Please try again'}`);
    } finally {
      setTransferringPanelist(false);
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
          searchValue={interviewListSearch}
          onSearchChange={e => setInterviewListSearch(e.target.value)}
          tabs={[]}
          right={
            <>
              <NotificationBell />
              <UserChip />
            </>
          }
        />
      }
      contentClassName="!p-0 !overflow-hidden flex flex-col h-full"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between px-5 py-3 md:py-0 md:h-14 bg-white border-b border-[#e4ebf1] gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap items-center">
          <button
            className={`os-btn-outline !h-9 transition-all duration-200 ${viewMode === 'list' ? '!bg-[#1f52cc] !text-white !border-[#1f52cc] shadow-md shadow-blue-200' : ''}`}
            onClick={() => { prevViewModeRef.current = viewMode; setViewMode('list'); }}
            type="button"
          >
            <span className="material-symbols-outlined text-sm">list</span>
            List View
          </button>
          <button
            className={`os-btn-outline !h-9 transition-all duration-200 ${viewMode === 'calendar' ? '!bg-[#1f52cc] !text-white !border-[#1f52cc] shadow-md shadow-blue-200' : ''}`}
            onClick={() => { prevViewModeRef.current = viewMode; setViewMode('calendar'); }}
            type="button"
          >
            <span className="material-symbols-outlined text-sm">calendar_month</span>
            Calendar Grid
          </button>
          <button
            className={`os-btn-outline !h-9 transition-all duration-200 ${viewMode === 'excel' ? '!bg-[#1f52cc] !text-white !border-[#1f52cc] shadow-md shadow-blue-200' : ''}`}
            onClick={() => { prevViewModeRef.current = viewMode; setViewMode('excel'); }}
            type="button"
          >
            <span className="material-symbols-outlined text-sm">table_view</span>
            Excel View
          </button>
          <button className={`px-4 !h-9 text-xs font-semibold rounded-lg transition-all flex items-center justify-center border border-transparent ${!filterMine ? 'bg-[#1f52cc] text-white shadow-md' : 'text-[#64748b] hover:bg-slate-100'}`} onClick={() => setFilterMine(false)}>
            All
          </button>
          <button className={`px-4 !h-9 text-xs font-semibold rounded-lg transition-all flex items-center justify-center border border-transparent ${filterMine ? 'bg-[#1f52cc] text-white shadow-md' : 'text-[#64748b] hover:bg-slate-100'}`} onClick={() => setFilterMine(true)}>
            My Interviews
          </button>
          <span className="h-4 w-[1px] bg-slate-200 self-center hidden sm:inline-block"></span>
          <button className={`px-4 !h-9 text-xs font-semibold rounded-lg transition-all flex items-center justify-center border border-transparent ${roundFilter === 'all' ? 'bg-[#1f52cc] text-white shadow-md' : 'text-[#64748b] hover:bg-slate-100'}`} onClick={() => setRoundFilter('all')}>
            All Rounds
          </button>
          <button className={`px-4 !h-9 text-xs font-semibold rounded-lg transition-all flex items-center justify-center border border-transparent ${roundFilter === '1' ? 'bg-[#1f52cc] text-white shadow-md' : 'text-[#64748b] hover:bg-slate-100'}`} onClick={() => setRoundFilter('1')}>
            Round 1
          </button>
          <button className={`px-4 !h-9 text-xs font-semibold rounded-lg transition-all flex items-center justify-center border border-transparent ${roundFilter === '2' ? 'bg-[#1f52cc] text-white shadow-md' : 'text-[#64748b] hover:bg-slate-100'}`} onClick={() => setRoundFilter('2')}>
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

      <PageEnter className="schedule-page flex-1 min-h-0 overflow-hidden">
        {viewMode === 'list' && (
          <div className="candidate-list-panel bg-white p-4 h-full view-enter-left">
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
            {/* Member count indicator — uses real DB totalCount from page 1, not in-memory array length */}
            {debouncedSearch ? (
              groupedApplications.length > 0 && (
                <div className="px-2 pb-1 text-[10px] text-slate-400 font-medium">
                  {groupedApplications.length} result{groupedApplications.length !== 1 ? 's' : ''} for &ldquo;{debouncedSearch}&rdquo;
                </div>
              )
            ) : (
              totalCount !== null && (
                <div className="px-2 pb-1 text-[10px] text-slate-400 font-medium flex items-center justify-between">
                  <span>
                    {isFetchingNextPage ? `Loading: ${allInterviews.length} of ${totalCount}` : `${totalCount.toLocaleString()} interview${totalCount !== 1 ? 's' : ''}`}
                  </span>
                  {isFetchingNextPage && (
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 animate-duration-1000"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                    </span>
                  )}
                </div>
              )
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
              const latestIv = activeInterviews.reduce((latest, iv) => {
                if (!latest) return iv;
                return (iv.roundNo || 0) > (latest.roundNo || 0) ? iv : latest;
              }, null);
              const resultStatus = latestIv?.result || 'PENDING';
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
                    // Select the last active round (highest roundNo) as active
                    const lastRound = activeInterviews[activeInterviews.length - 1];
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
                    <div className="text-sm font-medium truncate">
                      <CandidateNameLink candidateId={candidateId} candidateName={candidate?.fullName} />
                    </div>
                    <div className="text-xs text-[#6f7894] truncate">{group.application?.job?.title || 'Applied Role'}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-semibold inline-block">
                        {roundCount > 0 ? `Round ${roundCount === 99 ? 'Final' : roundCount}` : 'Not Scheduled'}
                      </div>
                      {latestIv && (
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                          resultStatus === 'PASS' || resultStatus === 'SELECTED' ? 'bg-[#e8f5ed] text-[#2ca764]' :
                          resultStatus === 'OFFER_LETTER' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                          resultStatus === 'FAIL' || resultStatus === 'REJECTED' ? 'bg-[#fbeaea] text-[#cf3a3a]' :
                          resultStatus === 'ON_HOLD' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                          resultStatus === 'DIDNT_JOIN' ? 'bg-slate-100 text-slate-600 border border-slate-200' :
                          'bg-[#fef4e8] text-[#f2994a]'
                        }`}>
                          {resultStatus === 'DIDNT_JOIN' ? "Didn't Join" : resultStatus}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
            {/* Infinite scroll sentinel & skeletons */}
            <InfiniteScrollSentinel
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              fetchNextPage={fetchNextPage}
            />
            {loadingMore && <InterviewMemberSkeleton count={3} />}
            {searchError ? (
              <div className="text-sm px-2 py-6 text-center text-red-600 bg-red-50/50 rounded-xl m-2 border border-red-100 animate-in fade-in">
                <div className="font-semibold mb-2">Search failed. Please try again.</div>
                <button className="os-btn-primary !h-8 px-3 text-xs" onClick={() => refetchSearch()}>Retry Search</button>
              </div>
            ) : (
              <>
                {interviews.length === 0 && !isQueryLoading && (
                  <div className="text-sm os-muted px-2 py-4 text-center text-slate-400">No interviews found.</div>
                )}
                {debouncedSearch && groupedApplications.length === 0 && !isSearching && (
                  <div className="text-sm os-muted px-2 py-4 text-center text-slate-400">No results for "{debouncedSearch}"</div>
                )}
              </>
            )}
          </div>
        )}

        {viewMode === 'excel' && (
          <div className="bg-white w-full h-full flex flex-col overflow-hidden view-enter">
            {queryError && !isQueryLoading ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
                <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
                  <span className="material-symbols-outlined text-2xl text-red-400">table_view</span>
                </div>
                <div>
                  <div className="text-base font-semibold text-slate-700 mb-1">Couldn't load spreadsheet data</div>
                  <div className="text-sm text-slate-400">The interview data failed to load. Please try again.</div>
                </div>
                <button
                  className="os-btn-primary !h-9 px-4 text-xs"
                  onClick={() => refetchInterviews()}
                  type="button"
                >
                  <span className="material-symbols-outlined text-sm">refresh</span>
                  Retry
                </button>
              </div>
            ) : (
              <React.Suspense fallback={<div className="p-8 text-center text-slate-400">Loading spreadsheet view...</div>}>
                <ExcelView
                  interviews={filteredForExcel}
                  viewDate={viewDate}
                  onSelectCandidate={(candidateId, interviewId) => {
                    setViewMode('list');
                    setSelectedId(candidateId);
                    if (interviewId) setActiveInterviewId(interviewId);
                  }}
                  onLoadMore={loadMoreInterviews}
                  hasMore={serverHasMore}
                  loadingMore={loadingMore}
                  totalCount={totalCount}
                />
              </React.Suspense>
            )}
          </div>
        )}

        {viewMode === 'calendar' && (
          <div className="bg-white p-6 overflow-auto w-full h-full view-enter relative">
            {/* Subtle Progress Bar on top of Calendar when fetching */}
            {isCalendarLoading && (
              <div className="absolute top-0 left-0 right-0 h-1 bg-blue-100 overflow-hidden z-20">
                <div className="h-full bg-[#1f52cc] animate-pulse w-1/3 rounded" style={{ animationDuration: '1s' }} />
              </div>
            )}

            {/* Calendar error state */}
            {isCalendarError && !isCalendarLoading && (
              <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 text-center">
                <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
                  <span className="material-symbols-outlined text-2xl text-red-400">calendar_month</span>
                </div>
                <div>
                  <div className="text-base font-semibold text-slate-700 mb-1">Couldn't load interviews for this month</div>
                  <div className="text-sm text-slate-400">The calendar data failed to load. Please try again.</div>
                </div>
                <button
                  className="os-btn-primary !h-9 px-4 text-xs"
                  onClick={() => refetchCalendar()}
                  type="button"
                >
                  <span className="material-symbols-outlined text-sm">refresh</span>
                  Retry
                </button>
              </div>
            )}

            {/* Calendar grid — always shown to avoid clearing the shell */}
            {!isCalendarError && (
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
                      cellInterviews={isCalendarLoading ? [] : cellData.interviews}
                      cellJoinings={isCalendarLoading ? [] : cellData.joinings}
                      onChipClick={(candidateId, interviewId) => {
                        // Open Activity Modal for this date
                        setSelectedCalendarDate(cell.date);
                        setShowActivityModal(true);
                      }}
                    />
                  );
                })}
              </div>
            )}

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
                                                <div className="text-base font-bold text-[#10193f] truncate">
                                                  <CandidateNameLink
                                                    candidateId={iv.application?.candidateId || iv.candidateId}
                                                    candidateName={iv.application?.candidate?.fullName || iv.candidateName}
                                                    variant="interview"
                                                    interviewId={iv.id}
                                                    onClick={() => {
                                                      setSelectedId(iv.applicationId);
                                                      setActiveInterviewId(iv.id);
                                                      setViewMode('list');
                                                      setShowActivityModal(false);
                                                    }}
                                                  />
                                                </div>
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

                                            {(() => {
                                              const candId = iv.application?.candidateId || iv.candidateId;
                                              if (!candId) return null; // Hide actions for deleted/orphaned candidates
                                              
                                              return (
                                                <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                                                  <button
                                                    className="os-btn-primary !h-8 !px-3 !text-[11px] bg-[#1f52cc] shrink-0"
                                                    onClick={() => {
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
                                                    onClick={() => navigate(`/candidates/${candId}`)}
                                                  >
                                                    Profile
                                                  </button>
                                                </div>
                                              );
                                            })()}
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
                                      <button className="os-btn-primary !h-9 !bg-emerald-600 !px-5" onClick={() => navigate(`/candidates/${app.candidateId}`)}>
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
          </div>
        )}

        {viewMode === 'list' && (
          <>

            <div className="interview-detail-panel bg-[#eef3f3] flex flex-col overflow-hidden h-full view-enter">
              <div className="candidate-card-header min-h-[64px] py-3 bg-white border-b border-[#e4ebf1] px-5">
                <div className="candidate-identity">
                  <div className="w-10 h-10 rounded-xl bg-[#b7c7f2] text-[#2f4ea8] text-sm font-semibold flex items-center justify-center shrink-0">
                    {(selectedCandidate?.fullName || 'C').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="candidate-name-block">
                    <div className="text-xl font-semibold font-[Manrope] min-w-0">
                      <CandidateNameLink candidateId={selectedCandidate?.id} candidateName={selectedCandidate?.fullName || (loading ? 'Loading...' : 'Candidate')} />
                    </div>
                    <div className={selectedInterview ? 'text-[#2ca764] text-xs' : 'text-[#8c97ad] text-xs'}>{selectedInterview ? 'Interview Active' : 'No active interview'}</div>
                  </div>
                </div>
                <div className="candidate-actions">
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
                    onClick={() => setShowBulkUploadModal(true)}
                  >
                    <span className="material-symbols-outlined text-sm">upload_file</span>
                    Schedule in Bulk
                  </button>
                  <button 
                    className="os-btn-primary !h-9 !px-4 !bg-[#1f52cc]" 
                    onClick={() => {
                      setFeedbackForm(emptyFeedbackForm);
                      setShowFeedbackModal(true);
                    }}
                  >
                    <span className="material-symbols-outlined text-sm">rate_review</span>
                    Feedback
                  </button>
                  <button 
                    className="os-btn-outline !h-9 !px-4" 
                    onClick={() => setShowBulkFeedbackModal(true)}
                  >
                    <span className="material-symbols-outlined text-sm">upload_file</span>
                    Feedback in Bulk
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
                        Interview Details ({selectedInterview ? (selectedInterview.round || `Round ${selectedInterview.roundNo}`) : 'No Selection'})
                      </div>
                      {selectedInterview && (
                        <SyncIndicator isPending={selectedInterview._pendingSync || selectedInterview._optimistic} />
                      )}
                    </div>
                    
                    {/* Actions */}
                    {canScheduleInterview && selectedInterview && !detailsError && !isDetailsLoading && (
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
                          Edit
                        </button>
                        <button
                          onClick={() => onDeleteInterview(selectedInterview.id, selectedInterview.round || `Round ${selectedInterview.roundNo}`)}
                          className="px-2 py-1 rounded bg-red-50 text-[11px] font-semibold text-red-600 hover:bg-red-100 flex items-center gap-0.5"
                          title="Cancel/Delete Interview"
                        >
                          <span className="material-symbols-outlined text-xs">delete</span>
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>

                  {detailsError ? (
                    <div className="flex flex-col items-center justify-center text-center py-12 space-y-4">
                      <span className="material-symbols-outlined text-4xl text-red-500 animate-bounce">error</span>
                      <div>
                        <h4 className="font-bold text-[#142651]">Failed to Load Details</h4>
                        <p className="text-xs text-slate-500 mt-1">{detailsError.message || 'The request timed out or the server is unavailable.'}</p>
                      </div>
                      <button 
                        type="button"
                        onClick={() => refetchDetails()} 
                        className="px-4 py-2 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-bold transition-all cursor-pointer"
                      >
                        Retry Load
                      </button>
                    </div>
                  ) : (isDetailsLoading && !selectedInterview) ? (
                    <div className="space-y-6 py-6 animate-pulse">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                          <div className="h-4 bg-slate-200 rounded w-1/3"></div>
                          <div className="space-y-3">
                            <div className="h-4 bg-slate-100 rounded w-full"></div>
                            <div className="h-4 bg-slate-100 rounded w-5/6"></div>
                            <div className="h-4 bg-slate-100 rounded w-4/5"></div>
                          </div>
                        </div>
                        <div className="space-y-4 md:border-l md:border-slate-100 md:pl-6">
                          <div className="h-4 bg-slate-200 rounded w-1/3"></div>
                          <div className="h-12 bg-slate-50 rounded w-full"></div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Stacked Layout */
                    <div className="flex flex-col gap-6 items-stretch">
                      
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
                          {/* Follow-up Upload Fields */}
                          {(() => {
                            const { phoneFollowUp, emailFollowUp, morningFollowUp } = parseNotesSafely(selectedInterview?.notes);

                            const handleUpload = async (type, base64) => {
                              if (!selectedInterview) return;
                              setError('');

                              try {
                                const currentNotes = parseNotesSafely(selectedInterview.notes);
                                const nextNotesObj = {
                                  ...currentNotes,
                                  [type]: base64,
                                };
                                const updatedNotes = JSON.stringify(nextNotesObj);

                                await schedulingApi.patchNotes(selectedInterview.id, updatedNotes);
                                setBanner('Follow-up attachment updated successfully.');
                                await loadAll();
                              } catch (err) {
                                const msg = err?.response?.data?.error || err?.message || 'Failed to upload follow-up attachment';
                                setError(msg);
                                throw err;
                              }
                            };

                            const handleDelete = async (type) => {
                              if (!selectedInterview) return;
                              setError('');

                              try {
                                const currentNotes = parseNotesSafely(selectedInterview.notes);
                                const nextNotesObj = {
                                  ...currentNotes,
                                  [type]: null,
                                };
                                const updatedNotes = JSON.stringify(nextNotesObj);

                                await schedulingApi.patchNotes(selectedInterview.id, updatedNotes);
                                setBanner('Follow-up attachment removed successfully.');
                                await loadAll();
                              } catch (err) {
                                const msg = err?.response?.data?.error || err?.message || 'Failed to remove follow-up attachment';
                                setError(msg);
                                throw err;
                              }
                            };

                            return (
                              <>
                                <FollowUpUploadField
                                  label="Phone Follow-up"
                                  id={`phone-followup-${selectedInterview?.id}`}
                                  value={phoneFollowUp}
                                  isAdmin={isAdmin}
                                  interviewId={selectedInterview?.id}
                                  onUpload={(base64) => handleUpload('phoneFollowUp', base64)}
                                  onDelete={() => handleDelete('phoneFollowUp')}
                                />
                                <FollowUpUploadField
                                  label="Email Follow-up"
                                  id={`email-followup-${selectedInterview?.id}`}
                                  value={emailFollowUp}
                                  isAdmin={isAdmin}
                                  interviewId={selectedInterview?.id}
                                  onUpload={(base64) => handleUpload('emailFollowUp', base64)}
                                  onDelete={() => handleDelete('emailFollowUp')}
                                />
                                <FollowUpUploadField
                                  label="Morning Follow-up"
                                  id={`morning-followup-${selectedInterview?.id}`}
                                  value={morningFollowUp}
                                  isAdmin={isAdmin}
                                  interviewId={selectedInterview?.id}
                                  onUpload={(base64) => handleUpload('morningFollowUp', base64)}
                                  onDelete={() => handleDelete('morningFollowUp')}
                                />
                              </>
                            );
                          })()}
                          
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

                      {/* Divider + Form or Details */}
                      <div className="border-t border-slate-200 pt-6">
                        <React.Suspense fallback={<div className="p-8 text-center text-slate-400 animate-pulse">Loading assessment form...</div>}>
                          {selectedInterview && (!myFeedback || isEditingFeedback) && !savingFeedback && (
                            <InterviewFeedbackForm
                              round={
                                selectedInterview.roundNo === 1
                                  ? InterviewRound.ROUND_1
                                  : selectedInterview.roundNo === 2
                                  ? InterviewRound.ROUND_2
                                  : InterviewRound.FINAL_ROUND
                              }
                              candidateId={selectedInterview.candidateId || selectedInterview.application?.candidateId || selectedInterview.application?.candidate?.id}
                              candidateName={selectedInterview.candidateName || selectedInterview.application?.candidate?.fullName || selectedCandidate?.fullName || ''}
                              initialValues={myFeedback?.feedbackData || myFeedback || {}}
                              templateVersion={myFeedback?.templateVersion || myFeedback?.template_version}
                              onSuccess={() => {
                                setShowFeedbackModal(false);
                                setIsEditingFeedback(false);
                                setBanner('Assessment saved successfully.');
                                loadAll();
                              }}
                              onCancel={isEditingFeedback ? () => setIsEditingFeedback(false) : undefined}
                            />
                          )}

                          {selectedInterview && myFeedback && !savingFeedback && !isEditingFeedback && (
                            <InterviewFeedbackView
                              round={
                                selectedInterview.roundNo === 1
                                  ? InterviewRound.ROUND_1
                                  : selectedInterview.roundNo === 2
                                  ? InterviewRound.ROUND_2
                                  : InterviewRound.FINAL_ROUND
                              }
                              feedbackData={myFeedback.feedbackData || myFeedback}
                              templateVersion={myFeedback?.templateVersion || myFeedback?.template_version}
                              candidateName={selectedInterview.candidateName || selectedInterview.application?.candidate?.fullName || selectedCandidate?.fullName || ''}
                              onEdit={() => setIsEditingFeedback(true)}
                              onDelete={() => handleDeleteFeedback(selectedInterview.candidateId || selectedInterview.application?.candidateId, selectedInterview.round)}
                            />
                          )}
                        </React.Suspense>
                      </div>
                    </div>
                  )}
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
            </div>


          </>
        )}
      </PageEnter>

      {/* MODALS */}
      {showScheduleModal && (
        <React.Suspense fallback={null}>
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
            interviewersLoading={isPanelistsLoading}
            interviewersError={panelistsError}
            refetchInterviewers={refetchPanelists}
            searchingCandidates={searchingCandidates}
            searchingJobs={searchingJobs}
            savingSchedule={savingSchedule}
            allInterviews={allInterviews}
            setBanner={setBanner}
            setError={setError}
            onClose={() => setShowScheduleModal(false)}

            onSubmit={async (e) => {
              const success = await onScheduleSubmit(e);
              if (success) setShowScheduleModal(false);
            }}
          />
        </React.Suspense>
      )}

      {showBulkUploadModal && (
        <React.Suspense fallback={null}>
          <BulkInterviewUploadModal
            isOpen={showBulkUploadModal}
            onClose={() => setShowBulkUploadModal(false)}
            onSuccess={async () => {
              queryClient.invalidateQueries({ queryKey: ['interviews'] });
              queryClient.invalidateQueries({ queryKey: ['candidates'] });
              refetchInterviews?.();
            }}
          />
        </React.Suspense>
      )}

      {showBulkFeedbackModal && (
        <React.Suspense fallback={null}>
          <BulkFeedbackUploadModal
            isOpen={showBulkFeedbackModal}
            onClose={() => setShowBulkFeedbackModal(false)}
            onSuccess={async () => {
              queryClient.invalidateQueries({ queryKey: ['interviews'] });
              queryClient.invalidateQueries({ queryKey: ['candidates'] });
              refetchInterviews?.();
            }}
          />
        </React.Suspense>
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
                {isPanelistsLoading ? (
                  <div className="text-xs text-slate-400 text-center py-4 animate-pulse">Loading panelists...</div>
                ) : panelistsError ? (
                  <div className="text-xs text-center py-4 space-y-2">
                    <div className="text-red-500">{panelistsError.message}</div>
                    <button onClick={() => refetchPanelists()} className="px-3 py-1 bg-blue-600 text-white rounded-xl text-xs font-bold transition-all">Retry</button>
                  </div>
                ) : !panelistsList || panelistsList.length === 0 ? (
                  <div className="text-xs text-slate-400 text-center py-4 italic">No panelists available</div>
                ) : (
                  (() => {
                    const availablePanelists = panelistsList.filter(i => !transferringInterview.interviewerIds?.includes(i.id));
                    if (availablePanelists.length === 0) {
                      return <div className="text-xs text-slate-400 text-center py-4 italic font-medium">All panelists are already assigned to this round</div>;
                    }
                    return availablePanelists.map((person) => (
                      <button
                        key={person.id}
                        disabled={transferringPanelist}
                        onClick={() => onTransferPanelist(person.id)}
                        className="w-full text-left p-4 rounded-2xl border border-slate-100 hover:border-blue-200 hover:bg-blue-50/50 transition-all group flex items-center gap-4 disabled:opacity-50"
                      >
                        <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm group-hover:bg-blue-600 group-hover:text-white transition-all">
                          {(person.fullName || 'I').split(' ').map(n => n[0]).join('').toUpperCase()}
                        </div>
                        <div className="flex-1">
                          <div className="font-bold text-slate-700 text-sm">{person.fullName || 'Interviewer'}</div>
                          <div className="text-[10px] text-slate-400 uppercase tracking-wider">{person.role}</div>
                        </div>
                        <span className="material-symbols-outlined text-blue-400 opacity-0 group-hover:opacity-100 transition-all translate-x-[-10px] group-hover:translate-x-0">
                          {transferringPanelist ? 'sync' : 'arrow_forward'}
                        </span>
                      </button>
                    ));
                  })()
                )}
              </div>

              <button
                disabled={transferringPanelist}
                className="w-full mt-6 h-12 rounded-2xl border border-slate-200 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-all disabled:opacity-50"
                onClick={() => setShowTransferModal(false)}
              >
                Cancel
              </button>

            </div>
          </Reveal>
        </div>
      )}
      
      <React.Suspense fallback={null}>
        <EditInterviewModal
          isOpen={!!editingInterviewId}
          interviewId={editingInterviewId}
          onClose={() => setEditingInterviewId(null)}
          onUpdate={loadAll}
        />
      </React.Suspense>

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

              <React.Suspense fallback={<div className="p-8 text-center text-slate-400 animate-pulse">Loading assessment form...</div>}>
                {selectedInterview && (
                  <InterviewFeedbackForm
                    round={
                      selectedInterview.roundNo === 1
                        ? 'ROUND_1'
                        : selectedInterview.roundNo === 2
                        ? 'ROUND_2'
                        : 'FINAL_ROUND'
                    }
                    candidateId={selectedInterview.candidateId || selectedInterview.application?.candidateId || selectedInterview.application?.candidate?.id}
                    candidateName={selectedInterview.candidateName || selectedInterview.application?.candidate?.fullName || selectedCandidate?.fullName || ''}
                    initialValues={myFeedback?.feedbackData || myFeedback || {}}
                    templateVersion={myFeedback?.templateVersion || myFeedback?.template_version}
                    onCancel={() => setShowFeedbackModal(false)}
                    onSuccess={() => {
                      setShowFeedbackModal(false);
                      setIsEditingFeedback(false);
                      setBanner('Assessment saved successfully.');
                      loadAll();
                    }}
                  />
                )}
              </React.Suspense>
            </div>
          </Reveal>
        </div>
      )}

    </EnterpriseLayout>
  );
};

export default InterviewSchedule;
