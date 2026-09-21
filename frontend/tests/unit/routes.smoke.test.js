import { describe, it, expect, beforeAll } from 'vitest';

/**
 * Route & Module Smoke Tests
 * Ensures all critical page modules (Candidates, Interviews, Dashboard, Settings, etc.)
 * can be imported and initialized without any ReferenceErrors, undefined identifiers, or syntax crashes.
 */
beforeAll(() => {
  if (typeof globalThis.localStorage === 'undefined') {
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    };
  }
  if (typeof globalThis.sessionStorage === 'undefined') {
    globalThis.sessionStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    };
  }
});

describe('Critical Routes & Modules Smoke Test', () => {
  it('Candidates view module loads cleanly without ReferenceError', async () => {
    const module = await import('../../src/pages/Candidates.jsx');
    expect(module.default).toBeDefined();
  });

  it('InterviewSchedule view module loads cleanly without ReferenceError', async () => {
    const module = await import('../../src/pages/InterviewSchedule.jsx');
    expect(module.default).toBeDefined();
  });

  it('Dashboard view module loads cleanly without ReferenceError', async () => {
    const module = await import('../../src/pages/Dashboard.jsx');
    expect(module.default).toBeDefined();
  });

  it('PaginatedListView component loads cleanly', async () => {
    const module = await import('../../src/components/PaginatedListView.jsx');
    expect(module.default).toBeDefined();
  });

  it('usePaginatedList hook loads cleanly', async () => {
    const module = await import('../../src/hooks/usePaginatedList.js');
    expect(module.usePaginatedList).toBeDefined();
  });

  it('useCandidateCounts hook loads cleanly', async () => {
    const module = await import('../../src/hooks/useCandidateCounts.js');
    expect(module.useCandidateStatusCounts).toBeDefined();
    expect(module.useCandidateFilteredCount).toBeDefined();
  });
});
