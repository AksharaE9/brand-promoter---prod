/**
 * 3 Fixed Interview Rounds & Schema-Driven Feedback Templates Definition (Frontend).
 */

export const InterviewRound = {
  ROUND_1: 'ROUND_1',
  ROUND_2: 'ROUND_2',
  FINAL_ROUND: 'FINAL_ROUND',
};

export const ROUND_SEQUENCE = [
  InterviewRound.ROUND_1,
  InterviewRound.ROUND_2,
  InterviewRound.FINAL_ROUND,
];

export const ROUND_DISPLAY_LABEL = {
  ROUND_1: 'Round 1',
  ROUND_2: 'Round 2',
  FINAL_ROUND: 'Final Round',
};

export const SELECTION_STATUSES = ['SELECTED', 'OFFER_LETTER', 'ON_HOLD', 'DIDNT_JOIN', 'REJECTED'];

// Round 1 — Updated 19-field template
export const ROUND_1_TEMPLATE = [
  { key: 'name',            label: 'Name',                                    type: 'text',     required: true },
  { key: 'number',          label: 'Number',                                  type: 'text',     required: true },
  { key: 'roundNumber',     label: 'Round Number',                            type: 'text',     required: true },
  { key: 'panelists',       label: 'Panelists',                               type: 'text',     required: true },
  { key: 'role',            label: 'Role',                                    type: 'text',     required: true },
  { key: 'course',          label: 'Course',                                  type: 'text',     required: false },
  { key: 'family',          label: 'Family',                                  type: 'text',     required: false },
  { key: 'college',         label: 'College',                                 type: 'text',     required: false },
  { key: 'languagesKnown',  label: 'Languages Known',                         type: 'text',     required: false },
  { key: 'priorExperience', label: 'Prior Experience / About It',             type: 'textarea', required: false },
  { key: 'projects',        label: 'Project(s)',                              type: 'textarea', required: false },
  { key: 'location',        label: 'Location',                                type: 'text',     required: false },
  { key: 'area',            label: 'Area',                                    type: 'text',     required: false },
  { key: 'overallRating',   label: 'Overall Rating',                          type: 'number',   required: true,  suffix: '/10' },
  { key: 'doj',             label: 'DOJ',                                     type: 'date',     required: true },
  { key: 'timings',         label: 'Timings',                                 type: 'text',     required: false },
  { key: 'duration',        label: 'Duration',                                type: 'text',     required: false },
  { key: 'selectionStatus', label: 'Selection Status',                        type: 'select',   required: true,  options: SELECTION_STATUSES },
  { key: 'comments',        label: 'Comments (Reason for Selection/Reject)',  type: 'textarea', required: false },
  {
    key: 'offerLetterDocument',
    label: 'Offer Letter Document',
    type: 'file',
    required: true,
    showWhen: (v) => (v.selectionStatus === 'OFFER_LETTER' || v.status === 'OFFER_LETTER'),
  },
  {
    key: 'offerLetterEmailAttachment',
    label: 'Offer Letter Email Attachment',
    type: 'file',
    required: true,
    showWhen: (v) => (v.selectionStatus === 'OFFER_LETTER' || v.status === 'OFFER_LETTER'),
  },
];

// Round 2 / Final Round — Updated 13-field template
export const ROUND_2_PLUS_TEMPLATE = [
  { key: 'name',          label: 'Name',           type: 'text',     required: true },
  { key: 'number',        label: 'Number',         type: 'text',     required: true },
  { key: 'roundNumber',   label: 'Round Number',   type: 'text',     required: true },
  { key: 'panelists',     label: 'Panelists',      type: 'text',     required: true },
  { key: 'role',          label: 'Role',           type: 'text',     required: false },
  { key: 'mockRating',    label: 'Mock Rating',    type: 'number',   required: false, suffix: '/10' },
  { key: 'overallRating', label: 'Overall Rating', type: 'number',   required: true,  suffix: '/10' },
  { key: 'location',      label: 'Location',       type: 'text',     required: false },
  { key: 'doj',           label: 'DOJ',            type: 'date',     required: false },
  { key: 'timings',       label: 'Timings',        type: 'text',     required: false },
  { key: 'duration',      label: 'Duration',       type: 'text',     required: false },
  { key: 'status',        label: 'Status',         type: 'select',   required: true,  options: SELECTION_STATUSES },
  { key: 'comments',      label: 'Comments',       type: 'textarea', required: false },
  {
    key: 'offerLetterDocument',
    label: 'Offer Letter Document',
    type: 'file',
    required: true,
    showWhen: (v) => (v.selectionStatus === 'OFFER_LETTER' || v.status === 'OFFER_LETTER'),
  },
  {
    key: 'offerLetterEmailAttachment',
    label: 'Offer Letter Email Attachment',
    type: 'file',
    required: true,
    showWhen: (v) => (v.selectionStatus === 'OFFER_LETTER' || v.status === 'OFFER_LETTER'),
  },
];

export const FEEDBACK_TEMPLATE_BY_ROUND = {
  ROUND_1: ROUND_1_TEMPLATE,
  ROUND_2: ROUND_2_PLUS_TEMPLATE,
  FINAL_ROUND: ROUND_2_PLUS_TEMPLATE,
};

export const LEGACY_ASSESSMENT_FIELDS = [
  { key: 'technical', label: 'Technical', type: 'select', required: false, options: ['1/5','2/5','3/5','4/5','5/5'] },
  { key: 'communication', label: 'Comm.', type: 'select', required: false, options: ['1/5','2/5','3/5','4/5','5/5'] },
  { key: 'culture', label: 'Culture', type: 'select', required: false, options: ['1/5','2/5','3/5','4/5','5/5'] },
  { key: 'overallRecommendation', label: 'Overall Recommendation', type: 'select', required: true, options: ['SELECTED', 'OFFER_LETTER', 'ON_HOLD', 'DIDNT_JOIN', 'REJECTED'] },
  { key: 'keyStrengths', label: 'Key Strengths', type: 'textarea', required: false },
  { key: 'concerns', label: 'Concerns / Weaknesses', type: 'textarea', required: false },
  { key: 'overallSummary', label: 'Overall Summary', type: 'textarea', required: false },
  { key: 'attachedDocument', label: 'Attached Document', type: 'file', required: false },
];

export const FEEDBACK_TEMPLATE_VERSIONS = [
  {
    version: 1,
    label: 'Legacy rating-based assessment',
    getFields: () => LEGACY_ASSESSMENT_FIELDS,
  },
  {
    version: 2,
    label: 'Schema-driven 3-round template',
    getFields: (round) => FEEDBACK_TEMPLATE_BY_ROUND[round] || ROUND_2_PLUS_TEMPLATE,
  }
];

export const CURRENT_FEEDBACK_TEMPLATE_VERSION = 2;

/**
 * resolveFeedbackValue - Dynamically resolves the value of a feedback field
 * based on whether it is version 1 (legacy rating-based) or version 2 (schema-driven).
 */
export function resolveFeedbackValue(feedbackData, key, templateVersion = 1) {
  if (!feedbackData) return '';
  if (Number(templateVersion) === 2) return feedbackData[key] ?? '';

  // Direct match
  if (feedbackData[key] !== undefined && feedbackData[key] !== null) return feedbackData[key];

  // Legacy mappings (ratings nesting)
  if (['technical', 'communication', 'culture'].includes(key)) {
    const val = feedbackData.ratings?.[key];
    return val !== undefined && val !== null ? (typeof val === 'number' ? `${val}/5` : val) : '';
  }

  if (key === 'overallRecommendation') return feedbackData.recommendation || '';
  if (key === 'keyStrengths') return feedbackData.strengths || '';
  if (key === 'overallSummary') return feedbackData.notes || '';
  if (key === 'attachedDocument') {
    return feedbackData.offerFileUrl || feedbackData.offerFileName || feedbackData.attachedDocument || '';
  }
  return '';
}

/**
 * Derives the next schedulable round enum from array of completed round enums.
 */
export function getNextSchedulableRound(completedRounds) {
  const list = Array.isArray(completedRounds) ? completedRounds : [];
  const nextIndex = list.length;
  return nextIndex < ROUND_SEQUENCE.length ? ROUND_SEQUENCE[nextIndex] : null;
}

/**
 * Formats template feedback values into clean plain text for copying to clipboard.
 */
export function formatFeedbackForClipboard(round, values, templateVersion = CURRENT_FEEDBACK_TEMPLATE_VERSION) {
  const versionDef = FEEDBACK_TEMPLATE_VERSIONS.find(v => v.version === templateVersion) || FEEDBACK_TEMPLATE_VERSIONS[1];
  const template = versionDef.getFields(round);
  const vals = values || {};
  return template
    .map((field) => {
      const raw = resolveFeedbackValue(vals, field.key, templateVersion);
      const isEmpty = raw === null || raw === undefined || raw === '';
      const display = isEmpty ? '—' : raw;
      const suffix = field.suffix && !isEmpty ? field.suffix : '';
      return `${field.label}: ${display}${suffix}`;
    })
    .join('\n');
}
