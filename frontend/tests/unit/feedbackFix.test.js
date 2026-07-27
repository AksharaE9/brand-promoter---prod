import { describe, it, expect } from 'vitest';
import { resolveFeedbackValue, resolveFeedbackFields, getEffectiveSelectionStatus } from '../../src/lib/interviewTemplates';

describe('resolveFeedbackFields', () => {
  it('returns version 1 fields for template version 1', () => {
    const fields = resolveFeedbackFields(1, 'ROUND_1');
    const keys = fields.map(f => f.key);
    expect(keys).toContain('technical');
    expect(keys).toContain('communication');
    expect(keys).toContain('culture');
    expect(keys).toContain('overallRecommendation');
    expect(keys).not.toContain('overallRating');
    expect(keys).not.toContain('college');
  });

  it('returns version 2 fields for template version 2', () => {
    const fields = resolveFeedbackFields(2, 'ROUND_1');
    const keys = fields.map(f => f.key);
    expect(keys).not.toContain('technical');
    expect(keys).not.toContain('communication');
    expect(keys).not.toContain('culture');
    expect(keys).toContain('overallRating');
    expect(keys).toContain('college');
    expect(keys).toContain('languagesKnown');
  });

  it('throws error for unknown template version', () => {
    expect(() => resolveFeedbackFields(99, 'ROUND_1')).toThrow('Unknown feedback template version: 99');
  });
});

describe('resolveFeedbackValue', () => {
  it('correctly resolves version 2 fields directly', () => {
    const data = {
      overallRecommendation: 'SELECTED',
      attachedDocument: 'resume.pdf',
      technicalRating: '4',
    };
    expect(resolveFeedbackValue(data, 'overallRecommendation', 2)).toBe('SELECTED');
    expect(resolveFeedbackValue(data, 'attachedDocument', 2)).toBe('resume.pdf');
    expect(resolveFeedbackValue(data, 'technicalRating', 2)).toBe('4');
  });

  it('correctly maps legacy v1 rating fields from nested ratings object', () => {
    const data = {
      ratings: {
        technical: 4,
        communication: 5,
        culture: 3,
      },
    };
    expect(resolveFeedbackValue(data, 'technical', 1)).toBe('4/5');
    expect(resolveFeedbackValue(data, 'communication', 1)).toBe('5/5');
    expect(resolveFeedbackValue(data, 'culture', 1)).toBe('3/5');
  });

  it('correctly maps overallRecommendation from recommendation', () => {
    const data = {
      recommendation: 'REJECTED',
    };
    expect(resolveFeedbackValue(data, 'overallRecommendation', 1)).toBe('REJECTED');
  });

  it('correctly maps keyStrengths from strengths', () => {
    const data = {
      strengths: 'Good SQL skills',
    };
    expect(resolveFeedbackValue(data, 'keyStrengths', 1)).toBe('Good SQL skills');
  });

  it('correctly maps overallSummary from notes', () => {
    const data = {
      notes: 'Strong candidate, fast learner',
    };
    expect(resolveFeedbackValue(data, 'overallSummary', 1)).toBe('Strong candidate, fast learner');
  });

  it('correctly maps attachedDocument from offerFileUrl / offerFileName', () => {
    const data = {
      offerFileUrl: 'https://docs.local/offer.pdf',
    };
    expect(resolveFeedbackValue(data, 'attachedDocument', 1)).toBe('https://docs.local/offer.pdf');
  });

  it('returns empty string when field is missing', () => {
    const data = {};
    expect(resolveFeedbackValue(data, 'technical', 1)).toBe('');
    expect(resolveFeedbackValue(data, 'overallRecommendation', 1)).toBe('');
  });
});

describe('getEffectiveSelectionStatus', () => {
  it('correctly resolves root selectionStatus', () => {
    const record = {
      selectionStatus: 'SELECTED',
      templateVersion: 2,
    };
    expect(getEffectiveSelectionStatus(record)).toBe('SELECTED');
  });

  it('correctly resolves nested selectionStatus in feedbackData (v2)', () => {
    const record = {
      feedbackData: {
        selectionStatus: 'REJECTED',
        templateVersion: 2,
      },
    };
    expect(getEffectiveSelectionStatus(record)).toBe('REJECTED');
  });

  it('correctly resolves nested overallRecommendation in feedbackData (v1)', () => {
    const record = {
      feedbackData: {
        recommendation: 'ON_HOLD',
        templateVersion: 1,
      },
    };
    expect(getEffectiveSelectionStatus(record)).toBe('ON_HOLD');
  });

  it('returns null when no status is found', () => {
    const record = {};
    expect(getEffectiveSelectionStatus(record)).toBeNull();
  });
});
