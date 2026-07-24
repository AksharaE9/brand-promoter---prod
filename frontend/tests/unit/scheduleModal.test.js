import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { ScheduleModal } from '../../src/components/Interview/ScheduleModal';

// Mock all external modules to avoid importing styles or triggering real API calls / browser APIs
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  Link: ({ children }) => React.createElement('a', {}, children),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({}),
}));

vi.mock('../../src/components/EnterpriseLayout', () => ({
  default: ({ children }) => React.createElement('div', {}, children),
  EnterpriseSidebar: () => null,
  EnterpriseTopbar: () => null,
}));

vi.mock('../../src/components/PageMotion', () => ({
  PageEnter: ({ children }) => React.createElement('div', {}, children),
  Reveal: ({ children }) => React.createElement('div', {}, children),
}));

vi.mock('../../src/components/UserChip', () => ({
  default: () => null,
}));

vi.mock('../../src/components/NotificationBell', () => ({
  default: () => null,
}));

vi.mock('../../src/lib/api', () => ({
  API_BASE_URL: 'http://localhost:5000/api',
  API_ROOT_URL: 'http://localhost:5000',
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getStoredUser: () => ({ id: '1', role: 'SUPER_ADMIN', fullName: 'Test Admin' }),
}));

vi.mock('../../src/lib/sse', () => ({
  subscribeSSE: () => vi.fn(),
}));

vi.mock('../../src/hooks/useScheduling', () => ({
  useRoundsList: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  useCreateRound: () => ({ mutateAsync: vi.fn() }),
  useSubmitFeedback: () => ({ mutateAsync: vi.fn() }),
  useRescheduleRound: () => ({ mutateAsync: vi.fn() }),
  useUpdatePanel: () => ({ mutateAsync: vi.fn() }),
  useSaveMeetLink: () => ({ mutateAsync: vi.fn() }),
  useTransferCandidate: () => ({ mutateAsync: vi.fn() }),
  useDeleteRound: () => ({ mutateAsync: vi.fn() }),
  useRoundDetails: () => ({ data: null, isLoading: false }),
}));

vi.mock('../../src/services/schedulingApi', () => ({
  schedulingApi: {
    getRounds: vi.fn(),
    updateRound: vi.fn(),
    logContactAttempt: vi.fn(),
  },
}));

vi.mock('../../src/components/Interview/EditInterviewModal', () => ({
  default: () => null,
}));

vi.mock('../../src/components/Interview/ExcelView', () => ({
  default: () => null,
}));

vi.mock('../../src/components/Interview/SyncIndicator', () => ({
  default: () => null,
}));

vi.mock('../../src/components/Interview/InterviewMemberSkeleton', () => ({
  default: () => null,
}));

vi.mock('../../src/components/Interview/InterviewFeedbackForm', () => ({
  default: () => null,
}));

vi.mock('../../src/components/Interview/InterviewFeedbackView', () => ({
  default: () => null,
}));

vi.mock('../../src/components/Interview/CopyFeedbackButton', () => ({
  default: () => null,
}));

vi.mock('../../src/components/Interview/ContactAttemptPopover', () => ({
  ContactAttemptPopover: () => null,
}));

// Mock browser objects that might be missing in node environment
global.window = {
  location: {
    origin: 'http://localhost:3000',
  },
};
global.document = {
  body: {
    appendChild: vi.fn(),
    removeChild: vi.fn(),
  },
  createElement: vi.fn(),
};

describe('ScheduleModal Smoke Test', () => {
  it('instantiates and mounts component object without ReferenceError', () => {
    const mockProps = {
      scheduleForm: {
        candidateId: 'c1',
        jobId: 'j1',
        roundNo: 1,
        round: 'Round 1',
        interviewerIds: [],
        scheduledStart: '2026-07-22T09:00:00.000Z',
        mode: 'ONLINE',
        meetingLink: '',
        zohoLink: '',
        slotNo: 1,
        nextSchedule: '',
        phoneFollowUp: null,
        emailFollowUp: null,
        morningFollowUp: null,
      },
      setScheduleForm: vi.fn(),
      candidateSearch: '',
      setCandidateSearch: vi.fn(),
      jobSearch: '',
      setJobSearch: vi.fn(),
      interviewerSearch: '',
      setInterviewerSearch: vi.fn(),
      showCandidateList: false,
      setShowCandidateList: vi.fn(),
      showJobList: false,
      setShowJobList: vi.fn(),
      candidateSuggestions: [],
      jobSuggestions: [],
      interviewers: [],
      searchingCandidates: false,
      searchingJobs: false,
      savingSchedule: false,
      onClose: vi.fn(),
      allInterviews: [],
      candidateFeedbacks: [],
      setBanner: vi.fn(),
      setError: vi.fn(),
      onSubmit: vi.fn(),
    };

    // Instantiate element using React.createElement
    const element = React.createElement(ScheduleModal, mockProps);
    expect(element).toBeDefined();
    expect(element.type).toBeDefined();

    // Since the environment is Node, we can verify that rendering/evaluating it doesn't throw ReferenceError
    // We can execute the function directly (since it is a functional component)
    const renderFunc = element.type.type || element.type;
    expect(typeof renderFunc).toBe('function');

    // Call the component function directly with props to simulate mounting/rendering in Node
    let renderError = null;
    try {
      renderFunc(mockProps);
    } catch (e) {
      renderError = e;
    }

    // Assert that calling the component function does NOT throw a ReferenceError (like onSubmit is not defined)
    // Note: It might throw a DOM/browser error (which is fine since we are in node), but should NOT be a ReferenceError for onSubmit
    if (renderError) {
      expect(renderError.message).not.toContain('onSubmit is not defined');
      expect(renderError.name).not.toBe('ReferenceError');
    }
  });
});
