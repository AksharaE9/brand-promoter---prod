const { computeInterviewStatusUpdate, computeInterviewStatusRevert } = require('../../src/lib/interviewTemplates');

describe('Interview Status Transition Unit Tests', () => {
  describe('computeInterviewStatusUpdate', () => {
    test('transitions SCHEDULED, PENDING, or RESCHEDULED status to COMPLETED and sets result/outcome', () => {
      const selectionStatus = 'SELECTED';
      const feedbackList = [{ id: 'fb-1' }];

      const statuses = ['SCHEDULED', 'PENDING', 'RESCHEDULED'];
      for (const status of statuses) {
        const activeInterview = { status };
        const result = computeInterviewStatusUpdate(activeInterview, selectionStatus, feedbackList);

        expect(result.status).toBe('COMPLETED');
        expect(result.result).toBe(selectionStatus);
        expect(result.outcome).toBe(selectionStatus);
        expect(result.outcomeSetAt).toBeDefined();
        expect(result.feedback).toEqual(feedbackList);
      }
    });

    test('retains COMPLETED status but updates result/outcome when editing feedback', () => {
      const selectionStatus = 'REJECTED';
      const feedbackList = [{ id: 'fb-1' }];
      const activeInterview = { status: 'COMPLETED', result: 'SELECTED', outcome: 'SELECTED' };

      const result = computeInterviewStatusUpdate(activeInterview, selectionStatus, feedbackList);

      expect(result.status).toBeUndefined(); // writeRound will keep existing status
      expect(result.result).toBe(selectionStatus);
      expect(result.outcome).toBe(selectionStatus);
      expect(result.feedback).toEqual(feedbackList);
    });
  });

  describe('computeInterviewStatusRevert', () => {
    test('soft-deletes matched feedback by ID and reverts to previousStatus', () => {
      const feedbackList = [
        { id: 'fb-1', selectionStatus: 'SELECTED', previousStatus: 'RESCHEDULED' },
        { id: 'fb-2', selectionStatus: 'DIDNT_JOIN' }
      ];
      const existingFeedback = { id: 'fb-1', selectionStatus: 'SELECTED' };

      const { updatedFeedbackList, targetStatus, updated } = computeInterviewStatusRevert(feedbackList, existingFeedback);

      expect(updated).toBe(true);
      expect(targetStatus).toBe('RESCHEDULED');
      expect(updatedFeedbackList[0].deletedAt).toBeDefined();
      expect(updatedFeedbackList[1].deletedAt).toBeUndefined();
    });

    test('falls back to SCHEDULED status if previousStatus is missing on the deleted feedback', () => {
      const feedbackList = [
        { id: 'fb-1', selectionStatus: 'SELECTED' }
      ];
      const existingFeedback = { id: 'fb-1', selectionStatus: 'SELECTED' };

      const { updatedFeedbackList, targetStatus, updated } = computeInterviewStatusRevert(feedbackList, existingFeedback);

      expect(updated).toBe(true);
      expect(targetStatus).toBe('SCHEDULED');
      expect(updatedFeedbackList[0].deletedAt).toBeDefined();
    });

    test('returns updated=false and targetStatus=SCHEDULED if no matching feedback is found', () => {
      const feedbackList = [
        { id: 'fb-1', selectionStatus: 'SELECTED', deletedAt: '2026-07-30T00:00:00.000Z' }
      ];
      const existingFeedback = { id: 'fb-2', selectionStatus: 'DIDNT_JOIN' };

      const { updatedFeedbackList, targetStatus, updated } = computeInterviewStatusRevert(feedbackList, existingFeedback);

      expect(updated).toBe(false);
      expect(targetStatus).toBe('SCHEDULED');
    });
  });
});
