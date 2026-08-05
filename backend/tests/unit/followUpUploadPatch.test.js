'use strict';
/**
 * Unit tests for follow-up attachment upload fix.
 *
 * Verifies the PATCH /interviews/:roundId route logic that determines
 * whether meetingLink validation is triggered. The root cause of the
 * Morning/Phone/Email follow-up upload failure was that `handleUpload`
 * used PUT (which always enforces meetingLink for VIRTUAL/ONLINE) instead
 * of PATCH (which only validates meetingLink when those fields are in req.body).
 *
 * These tests exercise the exact conditional that gates the validation,
 * extracted from src/modules/interviews/routes.js (PATCH handler, ~line 1519).
 */

/**
 * Reproduces the exact guard from the PATCH route handler:
 *
 *   const isUpdatingModeOrLink = ('mode' in req.body) || ('meetingLink' in req.body);
 *   if (isUpdatingModeOrLink && (mergedData.mode === 'VIRTUAL' || mergedData.mode === 'ONLINE') && !mergedData.meetingLink) {
 *     throw new ApiError(422, 'Meeting link is required for virtual/online interviews');
 *   }
 */
function wouldThrowMeetingLinkError(reqBody, currentData) {
  const mergedData = { ...currentData, ...reqBody };
  const isUpdatingModeOrLink = ('mode' in reqBody) || ('meetingLink' in reqBody);
  return (
    isUpdatingModeOrLink &&
    (mergedData.mode === 'VIRTUAL' || mergedData.mode === 'ONLINE') &&
    !mergedData.meetingLink
  );
}

// ─── Baseline: confirm what PUT behaviour looks like (the broken path) ─────────
describe('Follow-up upload: PATCH meetingLink validation gate', () => {

  const virtualInterviewNoLink = {
    id: 'iv-1',
    mode: 'VIRTUAL',
    meetingLink: '',       // empty — common after creation
    interviewerIds: ['user-1'],
    scheduledStart: '2026-08-05T09:00:00.000Z',
    notes: JSON.stringify({ phoneFollowUp: null, emailFollowUp: null, morningFollowUp: null }),
  };

  const onlineInterviewNoLink = {
    ...virtualInterviewNoLink,
    mode: 'ONLINE',
  };

  const phoneInterviewNoLink = {
    ...virtualInterviewNoLink,
    mode: 'PHONE',
    meetingLink: '',
  };

  // ── The old broken behaviour (PUT sends mode + meetingLink) ─────────────────
  test('[OLD PUT behaviour] triggers 422 for VIRTUAL interview with empty meetingLink', () => {
    const putBody = {
      mode: virtualInterviewNoLink.mode,
      meetingLink: virtualInterviewNoLink.meetingLink, // '' — falsy
      interviewerIds: ['user-1'],
      scheduledStart: virtualInterviewNoLink.scheduledStart,
      notes: JSON.stringify({ morningFollowUp: { name: 'proof.png', data: 'abc' } }),
    };
    expect(wouldThrowMeetingLinkError(putBody, virtualInterviewNoLink)).toBe(true);
  });

  test('[OLD PUT behaviour] triggers 422 for ONLINE interview with empty meetingLink', () => {
    const putBody = {
      mode: onlineInterviewNoLink.mode,
      meetingLink: onlineInterviewNoLink.meetingLink,
      interviewerIds: ['user-1'],
      scheduledStart: onlineInterviewNoLink.scheduledStart,
      notes: JSON.stringify({ phoneFollowUp: { name: 'call.pdf', data: 'xyz' } }),
    };
    expect(wouldThrowMeetingLinkError(putBody, onlineInterviewNoLink)).toBe(true);
  });

  // ── The new fixed behaviour (PATCH sends only { notes }) ────────────────────
  test('[FIXED PATCH notes-only] does NOT trigger 422 for VIRTUAL interview — mode/meetingLink not in body', () => {
    const patchBody = {
      notes: JSON.stringify({
        phoneFollowUp: null,
        emailFollowUp: null,
        morningFollowUp: { name: 'proof.png', data: 'data:image/png;base64,abc123' },
      }),
    };
    expect(wouldThrowMeetingLinkError(patchBody, virtualInterviewNoLink)).toBe(false);
  });

  test('[FIXED PATCH notes-only] does NOT trigger 422 for ONLINE interview — mode/meetingLink not in body', () => {
    const patchBody = {
      notes: JSON.stringify({
        phoneFollowUp: { name: 'call.pdf', data: 'data:application/pdf;base64,xyz' },
        emailFollowUp: null,
        morningFollowUp: null,
      }),
    };
    expect(wouldThrowMeetingLinkError(patchBody, onlineInterviewNoLink)).toBe(false);
  });

  test('[FIXED PATCH notes-only] does NOT trigger 422 for PHONE interview — PHONE mode never needs meetingLink', () => {
    const patchBody = {
      notes: JSON.stringify({
        emailFollowUp: { name: 'email.eml', data: 'data:message/rfc822;base64,eml' },
      }),
    };
    expect(wouldThrowMeetingLinkError(patchBody, phoneInterviewNoLink)).toBe(false);
  });

  // ── Edge cases ───────────────────────────────────────────────────────────────
  test('PATCH that explicitly includes meetingLink="" for VIRTUAL still triggers 422 (correct guard)', () => {
    // A caller that wrongly sends meetingLink: '' via PATCH should still be rejected
    const patchBody = {
      meetingLink: '',
      notes: JSON.stringify({ morningFollowUp: { name: 'x.png', data: 'abc' } }),
    };
    expect(wouldThrowMeetingLinkError(patchBody, virtualInterviewNoLink)).toBe(true);
  });

  test('PATCH with a valid meetingLink for VIRTUAL does NOT trigger 422', () => {
    const patchBody = {
      meetingLink: 'https://meet.google.com/abc-def',
      notes: JSON.stringify({ phoneFollowUp: { name: 'doc.pdf', data: 'base64' } }),
    };
    expect(wouldThrowMeetingLinkError(patchBody, virtualInterviewNoLink)).toBe(false);
  });
});

// ─── Notes merge: the content stored is the full object, not just the changed key ──
describe('Follow-up upload: notes JSON merge correctness', () => {
  /**
   * Simulates what handleUpload does client-side before calling patchNotes:
   *   const nextNotesObj = { ...currentNotes, [type]: base64 };
   */
  function mergeFollowUp(currentNotesJson, type, fileObj) {
    const current = currentNotesJson ? JSON.parse(currentNotesJson) : {};
    return JSON.stringify({ ...current, [type]: fileObj });
  }

  test('merging morningFollowUp preserves existing phoneFollowUp and emailFollowUp', () => {
    const existingNotes = JSON.stringify({
      phoneFollowUp: { name: 'call.mp3', data: 'audio-base64' },
      emailFollowUp: { name: 'email.pdf', data: 'pdf-base64' },
      morningFollowUp: null,
      nextSchedule: '2026-08-10',
    });

    const newFile = { name: 'proof.png', data: 'data:image/png;base64,abc', type: 'image/png' };
    const merged = JSON.parse(mergeFollowUp(existingNotes, 'morningFollowUp', newFile));

    expect(merged.phoneFollowUp.name).toBe('call.mp3');
    expect(merged.emailFollowUp.name).toBe('email.pdf');
    expect(merged.morningFollowUp.name).toBe('proof.png');
    expect(merged.morningFollowUp.data).toBe('data:image/png;base64,abc');
    expect(merged.nextSchedule).toBe('2026-08-10');
  });

  test('merging phoneFollowUp does not touch morningFollowUp', () => {
    const existingNotes = JSON.stringify({
      phoneFollowUp: null,
      emailFollowUp: null,
      morningFollowUp: { name: 'morning.jpg', data: 'image-base64' },
    });

    const newFile = { name: 'call-recording.mp3', data: 'data:audio/mpeg;base64,mp3', type: 'audio/mpeg' };
    const merged = JSON.parse(mergeFollowUp(existingNotes, 'phoneFollowUp', newFile));

    expect(merged.phoneFollowUp.name).toBe('call-recording.mp3');
    expect(merged.morningFollowUp.name).toBe('morning.jpg');   // unchanged
    expect(merged.emailFollowUp).toBeNull();
  });

  test('Replace File: re-uploading morningFollowUp overwrites only that field', () => {
    const existingNotes = JSON.stringify({
      phoneFollowUp: { name: 'call.mp3', data: 'v1-audio' },
      emailFollowUp: null,
      morningFollowUp: { name: 'old-proof.png', data: 'v1-image' },
    });

    const newFile = { name: 'new-proof.png', data: 'v2-image', type: 'image/png' };
    const merged = JSON.parse(mergeFollowUp(existingNotes, 'morningFollowUp', newFile));

    expect(merged.morningFollowUp.name).toBe('new-proof.png');
    expect(merged.morningFollowUp.data).toBe('v2-image');
    expect(merged.phoneFollowUp.name).toBe('call.mp3');        // untouched
    expect(merged.phoneFollowUp.data).toBe('v1-audio');        // untouched
  });

  test('uploading to an interview with no prior notes initialises the field correctly', () => {
    const merged = JSON.parse(mergeFollowUp(null, 'morningFollowUp', {
      name: 'first-upload.png', data: 'data:image/png;base64,aaa', type: 'image/png',
    }));

    expect(merged.morningFollowUp.name).toBe('first-upload.png');
    expect(merged.phoneFollowUp).toBeUndefined();   // not set — that's fine
    expect(merged.emailFollowUp).toBeUndefined();
  });
});
