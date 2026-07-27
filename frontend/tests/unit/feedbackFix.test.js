import { describe, it, expect } from 'vitest';
import { resolveFeedbackValue } from '../../src/lib/interviewTemplates';

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
