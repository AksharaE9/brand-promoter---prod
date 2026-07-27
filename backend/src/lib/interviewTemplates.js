'use strict';

/**
 * 3 Fixed Interview Rounds & Schema-Driven Feedback Templates Definition.
 */

const InterviewRound = {
  ROUND_1: 'ROUND_1',
  ROUND_2: 'ROUND_2',
  FINAL_ROUND: 'FINAL_ROUND',
};

const ROUND_SEQUENCE = [
  InterviewRound.ROUND_1,
  InterviewRound.ROUND_2,
  InterviewRound.FINAL_ROUND,
];

const ROUND_DISPLAY_LABEL = {
  ROUND_1: 'Round 1',
  ROUND_2: 'Round 2',
  FINAL_ROUND: 'Final Round',
};

const SELECTION_STATUSES = ['SELECTED', 'OFFER_LETTER', 'ON_HOLD', 'DIDNT_JOIN', 'REJECTED'];

// Round 1 — Updated 19-field template
const ROUND_1_TEMPLATE = [
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
const ROUND_2_PLUS_TEMPLATE = [
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

const FEEDBACK_TEMPLATE_BY_ROUND = {
  ROUND_1: ROUND_1_TEMPLATE,
  ROUND_2: ROUND_2_PLUS_TEMPLATE,
  FINAL_ROUND: ROUND_2_PLUS_TEMPLATE,
};

const LEGACY_ASSESSMENT_FIELDS = [
  { key: 'technical', label: 'Technical', type: 'select', required: false, options: ['1/5','2/5','3/5','4/5','5/5'] },
  { key: 'communication', label: 'Comm.', type: 'select', required: false, options: ['1/5','2/5','3/5','4/5','5/5'] },
  { key: 'culture', label: 'Culture', type: 'select', required: false, options: ['1/5','2/5','3/5','4/5','5/5'] },
  { key: 'overallRecommendation', label: 'Overall Recommendation', type: 'select', required: true, options: ['SELECTED', 'OFFER_LETTER', 'ON_HOLD', 'DIDNT_JOIN', 'REJECTED'] },
  { key: 'keyStrengths', label: 'Key Strengths', type: 'textarea', required: false },
  { key: 'concerns', label: 'Concerns / Weaknesses', type: 'textarea', required: false },
  { key: 'overallSummary', label: 'Overall Summary', type: 'textarea', required: false },
  { key: 'attachedDocument', label: 'Attached Document', type: 'file', required: false },
];

const FEEDBACK_TEMPLATE_VERSIONS = [
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

const CURRENT_FEEDBACK_TEMPLATE_VERSION = 2;

/**
 * resolveFeedbackFields - Consolidates template field resolution for both read-only and editable forms.
 */
function resolveFeedbackFields(templateVersion, round) {
  const ver = Number(templateVersion) || 1;
  const versionDef = FEEDBACK_TEMPLATE_VERSIONS.find(v => v.version === ver);
  if (!versionDef) {
    throw new Error(`Unknown feedback template version: ${ver}`);
  }
  return versionDef.getFields(round);
}

/**
 * resolveFeedbackValue - Dynamically resolves the value of a feedback field
 * based on whether it is version 1 (legacy rating-based) or version 2 (schema-driven).
 */
function resolveFeedbackValue(feedbackData, key, templateVersion = 1) {
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
 * Returns the next schedulable round in sequence based on completed rounds array.
 * @param {string[]} completedRounds 
 * @returns {string|null}
 */
function getNextSchedulableRound(completedRounds) {
  const list = Array.isArray(completedRounds) ? completedRounds : [];
  const nextIndex = list.length;
  return nextIndex < ROUND_SEQUENCE.length ? ROUND_SEQUENCE[nextIndex] : null;
}

/**
 * Validates feedback data against the template schema for the specified round.
 * @param {string} round 
 * @param {Record<string, any>} data 
 * @returns {object} { valid: boolean, errors: string[] }
 */
function validateFeedbackData(round, data, options = {}) {
  const ver = options.templateVersion || CURRENT_FEEDBACK_TEMPLATE_VERSION;
  const versionDef = FEEDBACK_TEMPLATE_VERSIONS.find(v => v.version === ver) || FEEDBACK_TEMPLATE_VERSIONS[1];
  const template = versionDef.getFields(round);

  if (!template) {
    return { valid: false, errors: [`Invalid interview round or template: "${round}"`] };
  }

  const errors = [];
  const payload = data || {};

  template.forEach((field) => {
    if (typeof field.showWhen === 'function') {
      if (!field.showWhen(payload)) {
        return;
      }
    }

    const val = payload[field.key];
    const isEmpty = val === undefined || val === null || String(val).trim() === '';

    if (field.required && isEmpty) {
      if (field.type === 'file' && options.isBulkUpload) {
        return;
      }
      if (field.key === 'offerLetterDocument') {
        errors.push("Offer letter document is required when status is OFFER_LETTER");
      } else if (field.key === 'offerLetterEmailAttachment') {
        errors.push("Offer letter email attachment is required when status is OFFER_LETTER");
      } else {
        errors.push(`Field "${field.label}" is required`);
      }
    } else if (!isEmpty) {
      if (field.type === 'number') {
        const num = Number(val);
        if (isNaN(num) || num < 0 || num > 10) {
          errors.push(`Field "${field.label}" must be a number between 0 and 10`);
        }
      } else if (field.type === 'select' && field.options) {
        if (!field.options.includes(val)) {
          errors.push(`Field "${field.label}" must be one of: ${field.options.join(', ')}`);
        }
      } else if (field.type === 'file') {
        const isInvalidFile = !val || typeof val !== 'object' || !val.name || !val.data || typeof val.data !== 'string' || val.data.trim() === '';
        if (isInvalidFile) {
          errors.push(`Field "${field.label}" must be a valid file attachment`);
        }
      }
    }
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Formats template feedback values into plain text for copying.
 * @param {string} round 
 * @param {Record<string, any>} values 
 * @returns {string}
 */
function formatFeedbackForClipboard(round, values, templateVersion = CURRENT_FEEDBACK_TEMPLATE_VERSION) {
  const versionDef = FEEDBACK_TEMPLATE_VERSIONS.find(v => v.version === templateVersion) || FEEDBACK_TEMPLATE_VERSIONS[1];
  const template = versionDef.getFields(round);
  const vals = values || {};
  return template
    .map((field) => {
      const raw = vals[field.key];
      const isEmpty = raw === null || raw === undefined || raw === '';
      const display = isEmpty ? '—' : raw;
      const suffix = field.suffix && !isEmpty ? field.suffix : '';
      return `${field.label}: ${display}${suffix}`;
    })
    .join('\n');
}

/**
 * HISTORICAL CONSTRAINT RULE:
 * ---------------------------
 * Legacy template version 1 records and current version 2 records represent fundamentally
 * different questionnaires. Version 2 captures logistical candidate background fields (course,
 * family, college, languagesKnown, priorExperience, projects, location, area, timings, duration,
 * panelists, number) which have no source value in legacy (v1) records.
 *
 * DO NOT FABRICATE OR DEFAULT these fields to empty/blank/N/A values for historical v1 records
 * during display or migrations. They should simply remain unrendered or explicitly marked as
 * "Not collected under this assessment's format" (the default behavior of template-driven views).
 */

/**
 * getEffectiveSelectionStatus - Resolves the selection status (outcome) of a feedback record
 * across both template version 1 (legacy) and version 2 (current).
 * Bridges overallRecommendation (v1) and selectionStatus (v2).
 */
function getEffectiveSelectionStatus(record) {
  if (!record) return null;
  if (record.selectionStatus) return record.selectionStatus;
  const data = record.feedbackData || record;
  const templateVersion = record.templateVersion || record.template_version || (data && (data.templateVersion || data.template_version)) || 1;
  if (Number(templateVersion) === 2) {
    return data.selectionStatus || data.status || record.selectionStatus || null;
  }
  if (Number(templateVersion) === 1) {
    return data.overallRecommendation || data.recommendation || record.overallRecommendation || record.recommendation || null;
  }
  return record.selectionStatus || null;
}

/**
 * Asserts that the prior round's feedback exists before scheduling requestedRound.
 * @param {object} prisma
 * @param {string} candidateId
 * @param {string} requestedRound
 */
async function assertCanScheduleRound(prisma, candidateId, requestedRound) {
  // Check for prior rejections first
  const allFeedbacks = await prisma.interviewFeedback.findMany({
    where: { candidateId },
  });
  
  const blockingFeedback = allFeedbacks.find(
    (f) => ['REJECTED', 'DIDNT_JOIN', 'OFFER_LETTER'].includes(getEffectiveSelectionStatus(f))
  );
  if (blockingFeedback) {
    const ApiError = require('../utils/errors').ApiError;
    const roundLabel = ROUND_DISPLAY_LABEL[blockingFeedback.round] || blockingFeedback.round;
    
    let reasonMsg = `This candidate was rejected at ${roundLabel}; further rounds cannot be scheduled.`;
    if (blockingFeedback.selectionStatus === 'DIDNT_JOIN') {
      reasonMsg = `This candidate has withdrawn (Didn't Join) at ${roundLabel}; further rounds cannot be scheduled.`;
    } else if (blockingFeedback.selectionStatus === 'OFFER_LETTER') {
      reasonMsg = `This candidate has already reached Offer Letter stage at ${roundLabel}; further rounds cannot be scheduled.`;
    }
    
    throw new ApiError(400, reasonMsg);
  }

  const requestedIndex = ROUND_SEQUENCE.indexOf(requestedRound);
  if (requestedIndex <= 0) return; // Round 1 has no prior feedback dependency

  const priorRound = ROUND_SEQUENCE[requestedIndex - 1];
  const priorFeedback = allFeedbacks.find((f) => f.round === priorRound);

  if (!priorFeedback) {
    const ApiError = require('../utils/errors').ApiError;
    throw new ApiError(
      400,
      `${ROUND_DISPLAY_LABEL[priorRound]} feedback must be submitted before scheduling ${ROUND_DISPLAY_LABEL[requestedRound]}.`
    );
  }
}

const INTERVIEW_SCHEDULE_IMPORT_SCHEMA = [
  { key: 'candidateName', label: 'Name',            required: true },
  { key: 'phone',         label: 'Phone Number',    required: true },
  { key: 'jobRole',       label: 'Job Role',        required: true },
  { key: 'round',         label: 'Round',           required: true },
  { key: 'meetingMode',   label: 'Meeting Mode',    required: true },
  { key: 'startDateTime', label: 'Start Date & Time', required: true },
  { key: 'interviewers',  label: 'Interviewers',    required: false },
  { key: 'meetingLink',   label: 'Meeting Link',    required: false },
  { key: 'zohoLink',      label: 'Zoho Link',       required: false },
];

const COMBINED_FEEDBACK_TEMPLATE = [
  { key: 'round',           label: 'Round',                                   required: true },
  { key: 'name',            label: 'Name',                                    required: true },
  { key: 'number',          label: 'Number',                                  required: true },
  { key: 'panelists',       label: 'Panelists',                               required: true },
  { key: 'role',            label: 'Role',                                    required: true },
  { key: 'course',          label: 'Course',                                  required: false },
  { key: 'family',          label: 'Family',                                  required: false },
  { key: 'college',         label: 'College',                                 required: false },
  { key: 'languagesKnown',  label: 'Languages Known',                         required: false },
  { key: 'priorExperience', label: 'Prior Experience / About It',             required: false },
  { key: 'projects',        label: 'Project(s)',                              required: false },
  { key: 'location',        label: 'Location',                                required: false },
  { key: 'area',            label: 'Area',                                    required: false },
  { key: 'mockRating',      label: 'Mock Rating',                             required: false },
  { key: 'overallRating',   label: 'Overall Rating',                          required: true },
  { key: 'doj',             label: 'DOJ',                                     required: true },
  { key: 'timings',         label: 'Timings',                                 required: false },
  { key: 'duration',        label: 'Duration',                                required: false },
  { key: 'selectionStatus', label: 'Selection Status',                        required: true },
  { key: 'comments',        label: 'Comments (Reason for Selection/Reject)',  required: false }
];

async function generateTemplate(schema, format) {
  const filteredSchema = schema.filter(f => f.type !== 'file');
  const headers = filteredSchema.map(f => f.required ? `${f.label} *` : f.label);

  if (format === 'csv') {
    // UTF-8 BOM so Excel opens the CSV with correct character encoding.
    const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
    const body = Buffer.from(headers.join(',') + '\n', 'utf8');
    return Buffer.concat([bom, body]);
  }

  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Template');
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

function verifyBufferSignature(buffer, format) {
  if (!buffer || buffer.length === 0) {
    throw new Error('Generated template buffer is empty');
  }

  if (format === 'xlsx') {
    // XLSX = ZIP archive; must start with 'PK\x03\x04' (0x50 0x4B 0x03 0x04)
    const sig = buffer.subarray(0, 4);
    if (sig[0] !== 0x50 || sig[1] !== 0x4B || sig[2] !== 0x03 || sig[3] !== 0x04) {
      throw new Error(
        `Invalid XLSX signature: expected 50 4B 03 04, got ${sig.toString('hex')}`
      );
    }
  }

  if (format === 'csv') {
    // Reasonable sanity: starts with BOM or a printable ASCII header character.
    const first = buffer[0];
    const isPrintableAscii = first >= 0x20 && first < 0x7F;
    const isBomStart = first === 0xEF;
    if (!isPrintableAscii && !isBomStart) {
      throw new Error(`CSV buffer starts with unexpected byte: 0x${first.toString(16)}`);
    }
  }
}

module.exports = {
  InterviewRound,
  ROUND_SEQUENCE,
  ROUND_DISPLAY_LABEL,
  SELECTION_STATUSES,
  ROUND_1_TEMPLATE,
  ROUND_2_PLUS_TEMPLATE,
  FEEDBACK_TEMPLATE_BY_ROUND,
  LEGACY_ASSESSMENT_FIELDS,
  FEEDBACK_TEMPLATE_VERSIONS,
  CURRENT_FEEDBACK_TEMPLATE_VERSION,
  resolveFeedbackFields,
  resolveFeedbackValue,
  getEffectiveSelectionStatus,
  getNextSchedulableRound,
  validateFeedbackData,
  formatFeedbackForClipboard,
  assertCanScheduleRound,
  INTERVIEW_SCHEDULE_IMPORT_SCHEMA,
  COMBINED_FEEDBACK_TEMPLATE,
  generateTemplate,
  verifyBufferSignature,
};

