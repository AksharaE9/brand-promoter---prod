'use strict';
/**
 * Unit tests for the session-expiry handling and Excel View follow-up sync
 * changes from the "Fix Session Expiry + Re-Verify Excel View Follow-Up Sync" PR.
 *
 * Tests:
 *  1. listMode notes stripping — base64 data is removed, existence flag preserved
 *  2. listMode notes stripping — malformed notes returns undefined (no crash)
 *  3. listMode notes stripping — null notes stays undefined
 *  4. listMode offer_letter_sent — derived from result field
 *  5. queryBuilder LIST_SELECT_FIELDS — notes field is present
 */

const { populateInterviewRelations } = require('../../src/modules/interviews/relationPopulator');
const { LIST_SELECT_FIELDS } = require('../../src/modules/interviews/queryBuilder');

// ─── Helper: build a minimal round object for listMode tests ─────────────────
function makeRound(overrides = {}) {
  return {
    id: 'round-1',
    applicationId: 'app-1',
    candidateId: 'cand-1',
    candidateName: 'Test Candidate',
    jobId: 'job-1',
    jobTitle: 'Software Engineer',
    roundNo: 1,
    round: 'Round 1',
    scheduledStart: new Date('2026-07-01T09:00:00Z'),
    mode: 'VIRTUAL',
    status: 'COMPLETED',
    result: null,
    organizationId: 'org-1',
    interviewerIds: JSON.stringify(['user-1']),
    interviewerNames: 'Alice Smith',
    createdAt: new Date(),
    updatedAt: new Date(),
    notes: null,
    ...overrides,
  };
}

// ─── Test 1: notes with full base64 data is stripped to { name, exists: true } ──
describe('listMode notes stripping', () => {
  test('strips base64 data from phoneFollowUp, keeps name and exists flag', async () => {
    const notesPayload = JSON.stringify({
      phoneFollowUp: { name: 'phone-call.mp3', data: 'SGVsbG8gV29ybGQ=' }, // base64 "Hello World"
      emailFollowUp: { name: 'email-body.pdf', data: 'UERGZGF0YQ==' },
      morningFollowUp: null,
      nextSchedule: '2026-07-10',
    });

    const round = makeRound({ notes: notesPayload });
    const [result] = await populateInterviewRelations([round], null, { listMode: true });

    // notes should be a JSON string in the response
    expect(result.notes).toBeDefined();
    const parsed = JSON.parse(result.notes);

    // base64 data must be stripped
    expect(parsed.phoneFollowUp.data).toBeUndefined();
    expect(parsed.emailFollowUp.data).toBeUndefined();

    // name and exists flag must be preserved
    expect(parsed.phoneFollowUp.name).toBe('phone-call.mp3');
    expect(parsed.phoneFollowUp.exists).toBe(true);
    expect(parsed.emailFollowUp.name).toBe('email-body.pdf');
    expect(parsed.emailFollowUp.exists).toBe(true);

    // null follow-up stays null
    expect(parsed.morningFollowUp).toBeNull();

    // nextSchedule passes through
    expect(parsed.nextSchedule).toBe('2026-07-10');
  });

  test('returns notes: undefined when notes is null', async () => {
    const round = makeRound({ notes: null });
    const [result] = await populateInterviewRelations([round], null, { listMode: true });
    expect(result.notes).toBeUndefined();
  });

  test('returns notes: undefined when notes is malformed JSON (no crash)', async () => {
    const round = makeRound({ notes: '{invalid json{{' });
    const [result] = await populateInterviewRelations([round], null, { listMode: true });
    expect(result.notes).toBeUndefined();
  });

  test('handles stripped format input (exists flag already set, no data)', async () => {
    // In case a row already went through stripping (e.g., from cache) — idempotent
    const notesPayload = JSON.stringify({
      phoneFollowUp: { name: 'audio.mp3', exists: true },
      emailFollowUp: null,
    });
    const round = makeRound({ notes: notesPayload });
    const [result] = await populateInterviewRelations([round], null, { listMode: true });

    const parsed = JSON.parse(result.notes);
    expect(parsed.phoneFollowUp.exists).toBe(true);
    expect(parsed.phoneFollowUp.name).toBe('audio.mp3');
  });
});

// ─── Test 2: offer_letter_sent derived from result in listMode ───────────────
describe('listMode offer_letter_sent derivation', () => {
  test('returns "Yes" when result is OFFER_LETTER', async () => {
    const round = makeRound({ result: 'OFFER_LETTER' });
    const [result] = await populateInterviewRelations([round], null, { listMode: true });
    expect(result.offer_letter_sent).toBe('Yes');
  });

  test('returns "—" when result is SELECTED', async () => {
    const round = makeRound({ result: 'SELECTED' });
    const [result] = await populateInterviewRelations([round], null, { listMode: true });
    expect(result.offer_letter_sent).toBe('—');
  });

  test('returns "—" when result is null (pending)', async () => {
    const round = makeRound({ result: null });
    const [result] = await populateInterviewRelations([round], null, { listMode: true });
    expect(result.offer_letter_sent).toBe('—');
  });
});

// ─── Test 3: LIST_SELECT_FIELDS includes notes ───────────────────────────────
describe('LIST_SELECT_FIELDS', () => {
  test('includes notes field for Excel View follow-up sync', () => {
    expect(LIST_SELECT_FIELDS).toHaveProperty('notes', true);
  });

  test('still includes all core fields', () => {
    const required = ['id', 'candidateId', 'roundNo', 'scheduledStart', 'mode', 'status', 'result', 'interviewerNames'];
    required.forEach(field => {
      expect(LIST_SELECT_FIELDS).toHaveProperty(field, true);
    });
  });

  test('does NOT include heavy fields (feedback, rescheduleHistory, voiceRecordingUrl)', () => {
    expect(LIST_SELECT_FIELDS.feedback).toBeUndefined();
    expect(LIST_SELECT_FIELDS.rescheduleHistory).toBeUndefined();
    expect(LIST_SELECT_FIELDS.voiceRecordingUrl).toBeUndefined();
    expect(LIST_SELECT_FIELDS.offerLetterUrl).toBeUndefined();
  });
});

// ─── Test 4: listMode does not expose heavy fields ───────────────────────────
describe('listMode lean shape', () => {
  test('does not include feedback, rescheduleHistory, or voiceRecordingUrl', async () => {
    const round = makeRound({
      feedback: JSON.stringify([{ submittedBy: 'user-1', ratings: { technical: 4 } }]),
      rescheduleHistory: JSON.stringify([{ at: '2026-07-01', by: 'admin' }]),
      voiceRecordingUrl: 'https://example.com/recording.mp3',
    });
    const [result] = await populateInterviewRelations([round], null, { listMode: true });

    // feedback is explicitly cleared
    expect(Array.isArray(result.feedback)).toBe(true);
    expect(result.feedback).toHaveLength(0);

    // heavy URL fields are undefined
    expect(result.voiceRecordingUrl).toBeUndefined();
    expect(result.rescheduleHistory).toBeUndefined();
  });

  test('builds interviewers from interviewerNames string', async () => {
    const round = makeRound({ interviewerNames: 'Alice Smith, Bob Jones' });
    const [result] = await populateInterviewRelations([round], null, { listMode: true });

    expect(result.interviewers).toEqual([
      { fullName: 'Alice Smith' },
      { fullName: 'Bob Jones' },
    ]);
  });

  test('builds lean candidate shape from denormalized columns', async () => {
    const round = makeRound({ candidateName: 'Jane Doe', candidateId: 'cand-42' });
    const [result] = await populateInterviewRelations([round], null, { listMode: true });

    expect(result.candidate).toEqual({ id: 'cand-42', fullName: 'Jane Doe' });
  });
});
