import * as React from 'react';
import { useState, useEffect } from 'react';
import {
  FEEDBACK_TEMPLATE_BY_ROUND,
  ROUND_DISPLAY_LABEL,
  InterviewRound,
  formatFeedbackForClipboard,
  CURRENT_FEEDBACK_TEMPLATE_VERSION,
  resolveFeedbackFields,
} from '../../lib/interviewTemplates';
import CopyFeedbackButton from './CopyFeedbackButton';
import { apiPost, apiGet } from '../../lib/api';
import { FollowUpUploadField } from '../../pages/InterviewSchedule';

function FeedbackFieldInput({ def, value, onChange, readOnly }) {
  const isReadOnly = readOnly || def.key === 'roundNumber';
  const val = value ?? '';

  switch (def.type) {
    case 'textarea':
      return (
        <textarea
          rows={3}
          value={val}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Enter ${def.label.toLowerCase()}...`}
          readOnly={isReadOnly}
          className="w-full rounded-lg border border-slate-200 p-2.5 text-xs text-slate-800 focus:border-[#1f52cc] focus:ring-1 focus:ring-[#1f52cc] outline-none transition-all disabled:bg-slate-50"
        />
      );

    case 'number':
      return (
        <div className="relative flex items-center">
          <input
            type="number"
            min={0}
            max={10}
            step={0.5}
            value={val}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0 - 10"
            readOnly={isReadOnly}
            className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-800 focus:border-[#1f52cc] focus:ring-1 focus:ring-[#1f52cc] outline-none transition-all pr-10"
          />
          {def.suffix && (
            <span className="absolute right-3 text-xs font-semibold text-slate-400 pointer-events-none">
              {def.suffix}
            </span>
          )}
        </div>
      );

    case 'date':
      return (
        <input
          type="date"
          value={val}
          onChange={(e) => onChange(e.target.value)}
          readOnly={isReadOnly}
          className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-800 focus:border-[#1f52cc] focus:ring-1 focus:ring-[#1f52cc] outline-none transition-all"
        />
      );

    case 'select':
      return (
        <select
          value={val}
          onChange={(e) => onChange(e.target.value)}
          disabled={isReadOnly}
          className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 focus:border-[#1f52cc] focus:ring-1 focus:ring-[#1f52cc] outline-none transition-all bg-white"
        >
          <option value="" disabled>
            Select status...
          </option>
          {def.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );

    case 'file':
      return (
        <FollowUpUploadField
          label={def.label}
          id={`${def.key}-${value?.name || 'new'}`}
          value={value}
          isAdmin={true}
          allowedExtensions={
            def.key === 'offerLetterDocument'
              ? ['.pdf', '.png', '.jpg', '.jpeg', '.docx']
              : ['.png', '.jpg', '.jpeg', '.pdf']
          }
          onUpload={(base64) => onChange(base64)}
          onDelete={() => onChange(null)}
        />
      );

    case 'text':
    default:
      return (
        <input
          type="text"
          value={val}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Enter ${def.label.toLowerCase()}...`}
          readOnly={isReadOnly}
          className={`w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-800 focus:border-[#1f52cc] focus:ring-1 focus:ring-[#1f52cc] outline-none transition-all ${
            isReadOnly ? 'bg-slate-50 text-slate-500 font-medium cursor-not-allowed' : ''
          }`}
        />
      );
  }
}

export default function InterviewFeedbackForm({
  round = InterviewRound.ROUND_1,
  candidateId: initialCandidateId,
  candidateName = '',
  initialValues = {},
  templateVersion: propTemplateVersion,
  onSuccess,
  onCancel,
}) {
  const templateVersion = React.useMemo(() => {
    if (propTemplateVersion !== undefined && propTemplateVersion !== null) {
      return Number(propTemplateVersion);
    }
    if (initialValues?.templateVersion || initialValues?.template_version) {
      return Number(initialValues.templateVersion || initialValues.template_version);
    }
    const keys = Object.keys(initialValues || {});
    // Detect legacy v1 records: may use 'technical'/'overallRecommendation'/'keyStrengths' (v1 flat keys)
    // OR the raw shape stored in interviews.feedback JSON: 'ratings' (nested obj), 'recommendation', 'strengths', 'concerns'
    const v1Keys = ['technical', 'overallRecommendation', 'keyStrengths', 'ratings', 'recommendation', 'strengths', 'concerns'];
    if (v1Keys.some(k => keys.includes(k))) {
      return 1;
    }
    return CURRENT_FEEDBACK_TEMPLATE_VERSION;
  }, [propTemplateVersion, initialValues]);

  const template = React.useMemo(() => {
    return resolveFeedbackFields(templateVersion, round);
  }, [templateVersion, round]);

  const roundLabel = ROUND_DISPLAY_LABEL[round] || 'Round 1';

  const isEdit = React.useMemo(() => {
    return !!(
      initialValues?.selectionStatus ||
      initialValues?.status ||
      initialValues?.overallRecommendation ||
      initialValues?.ratings
    );
  }, [initialValues]);

  const [values, setValues] = useState(() => {
    const initial = {};
    let flattened = { ...initialValues };
    if (Number(templateVersion) === 1) {
      if (initialValues?.ratings) {
        flattened.technical = typeof initialValues.ratings.technical === 'number'
          ? `${initialValues.ratings.technical}/5`
          : initialValues.ratings.technical;
        flattened.communication = typeof initialValues.ratings.communication === 'number'
          ? `${initialValues.ratings.communication}/5`
          : initialValues.ratings.communication;
        flattened.culture = typeof initialValues.ratings.culture === 'number'
          ? `${initialValues.ratings.culture}/5`
          : initialValues.ratings.culture;
      }
      if (initialValues?.recommendation) {
        flattened.overallRecommendation = initialValues.recommendation;
      }
      if (initialValues?.strengths) {
        flattened.keyStrengths = initialValues.strengths;
      }
      if (initialValues?.notes) {
        flattened.overallSummary = initialValues.notes;
      }
      if (initialValues?.offerFileUrl || initialValues?.offerFileName || initialValues?.attachedDocument) {
        flattened.attachedDocument = initialValues.offerFileUrl || initialValues.offerFileName || initialValues.attachedDocument;
      }
    }

    template.forEach((field) => {
      if (field.key === 'name') {
        initial.name = flattened.name || candidateName || '';
      } else if (field.key === 'roundNumber') {
        initial.roundNumber = flattened.roundNumber || roundLabel || '';
      } else {
        initial[field.key] = flattened[field.key] ?? '';
      }
    });

    return initial;
  });

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [fieldErrors, setFieldErrors] = useState([]);
  const [linkedCandidate, setLinkedCandidate] = useState(null);
  const [lookingUpNumber, setLookingUpNumber] = useState(false);

  useEffect(() => {
    let flattened = { ...initialValues };
    if (Number(templateVersion) === 1) {
      if (initialValues?.ratings) {
        flattened.technical = typeof initialValues.ratings.technical === 'number'
          ? `${initialValues.ratings.technical}/5`
          : initialValues.ratings.technical;
        flattened.communication = typeof initialValues.ratings.communication === 'number'
          ? `${initialValues.ratings.communication}/5`
          : initialValues.ratings.communication;
        flattened.culture = typeof initialValues.ratings.culture === 'number'
          ? `${initialValues.ratings.culture}/5`
          : initialValues.ratings.culture;
      }
      if (initialValues?.recommendation) {
        flattened.overallRecommendation = initialValues.recommendation;
      }
      if (initialValues?.strengths) {
        flattened.keyStrengths = initialValues.strengths;
      }
      if (initialValues?.notes) {
        flattened.overallSummary = initialValues.notes;
      }
      if (initialValues?.offerFileUrl || initialValues?.offerFileName || initialValues?.attachedDocument) {
        flattened.attachedDocument = initialValues.offerFileUrl || initialValues.offerFileName || initialValues.attachedDocument;
      }
    }

    setValues((prev) => {
      const nextValues = { ...prev };
      template.forEach((field) => {
        if (field.key === 'name') {
          nextValues.name = flattened.name || candidateName || prev.name || '';
        } else if (field.key === 'roundNumber') {
          nextValues.roundNumber = flattened.roundNumber || roundLabel || prev.roundNumber || '';
        } else {
          if (flattened[field.key] !== undefined) {
            nextValues[field.key] = flattened[field.key];
          } else if (nextValues[field.key] === undefined) {
            nextValues[field.key] = '';
          }
        }
      });
      return nextValues;
    });
  }, [initialValues, templateVersion, candidateName, roundLabel, template]);

  // Live lookup candidate by phone number
  useEffect(() => {
    const rawNumber = values.number;
    if (!rawNumber || String(rawNumber).replace(/[^\d+]/g, '').length < 7) {
      setLinkedCandidate(null);
      return;
    }

    const timer = setTimeout(async () => {
      setLookingUpNumber(true);
      try {
        const res = await apiGet(`/candidates/resolve-by-number?number=${encodeURIComponent(rawNumber)}`);
        if (res?.success && res?.data) {
          const cand = res.data;
          setLinkedCandidate(cand);
          setValues((prev) => ({
            ...prev,
            name: prev.name || cand.fullName || '',
            role: prev.role || cand.preferredRole || '',
          }));
        } else {
          setLinkedCandidate(null);
        }
      } catch (_) {
        setLinkedCandidate(null);
      } finally {
        setLookingUpNumber(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [values.number]);

  const setField = (key, val) => {
    setValues((prev) => ({ ...prev, [key]: val }));
    setErrorMsg(null);
    setFieldErrors([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    setFieldErrors([]);

    // Client-side quick check
    const errors = [];
    template.forEach((field) => {
      if (typeof field.showWhen === 'function') {
        if (!field.showWhen(values)) {
          return;
        }
      }

      const v = values[field.key];
      const isEmpty = v === undefined || v === null || String(v).trim() === '';
      if (field.required && isEmpty) {
        if (field.key === 'offerLetterDocument') {
          errors.push("Offer letter document is required when status is OFFER_LETTER");
        } else if (field.key === 'offerLetterEmailAttachment') {
          errors.push("Offer letter email attachment is required when status is OFFER_LETTER");
        } else {
          errors.push(`"${field.label}" is required.`);
        }
      }
      if (!isEmpty && field.type === 'number') {
        const num = Number(v);
        if (isNaN(num) || num < 0 || num > 10) {
          errors.push(`"${field.label}" must be between 0 and 10.`);
        }
      }
    });

    if (errors.length > 0) {
      setSubmitting(false);
      setFieldErrors(errors);
      return;
    }

    const targetCandidateId = initialCandidateId || linkedCandidate?.id || 'unlinked';

    try {
      const res = await apiPost(`/interviews/${targetCandidateId}/feedback`, {
        round,
        templateVersion,
        data: values,
      });

      if (res?.success) {
        if (onSuccess) onSuccess(res.data);
      } else {
        setErrorMsg(res?.error || res?.message || 'Failed to submit feedback');
        if (Array.isArray(res?.errors)) setFieldErrors(res.errors);
      }
    } catch (err) {
      const payload = err.payload || err.response?.data;
      const backendErrors = Array.isArray(err.errors)
        ? err.errors
        : (Array.isArray(payload?.errors) ? payload.errors : null);

      if (backendErrors && backendErrors.length > 0) {
        setFieldErrors(backendErrors);
        setErrorMsg(payload?.error || payload?.message || err.message || 'Please correct the validation errors below.');
      } else {
        setErrorMsg(payload?.error || payload?.message || err.message || 'An error occurred while saving feedback');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5 border-b border-slate-100 pb-3.5">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-900">
              {isEdit ? `Editing Submitted Assessment — ${roundLabel}` : `Interview Assessment Form — ${roundLabel}`}
            </h3>
            {isEdit && (
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800 uppercase tracking-wider">
                Submitted ✓
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">
            {isEdit
              ? `Modify candidate performance details for ${candidateName || values.name || 'Candidate'}`
              : `Complete candidate feedback metrics for ${candidateName || values.name || 'Candidate'}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <CopyFeedbackButton round={round} values={values} templateVersion={templateVersion} />
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 font-medium">
          {errorMsg}
        </div>
      )}

      {fieldErrors.length > 0 && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          <p className="font-semibold mb-1">Please correct the following fields:</p>
          <ul className="list-disc list-inside space-y-0.5">
            {fieldErrors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {template
            .filter((field) => {
              if (typeof field.showWhen === 'function') {
                return field.showWhen(values);
              }
              return true;
            })
            .map((field) => (
              <div
                key={field.key}
                className={field.type === 'textarea' || field.type === 'file' ? 'md:col-span-2 space-y-1' : 'space-y-1'}
              >
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-slate-700">
                    {field.label}
                    {field.required && <span className="text-red-500 ml-0.5">*</span>}
                  </label>
                  {field.key === 'number' && lookingUpNumber && (
                    <span className="text-[11px] text-blue-600 animate-pulse font-medium">
                      Searching candidate...
                    </span>
                  )}
                </div>

                <FeedbackFieldInput
                  def={field}
                  value={values[field.key]}
                  onChange={(val) => setField(field.key, val)}
                  readOnly={field.key === 'roundNumber'}
                />

                {field.key === 'number' && linkedCandidate && (
                  <p className="text-[11px] font-semibold text-emerald-600 mt-1 flex items-center gap-1">
                    <span>→</span> linked to {linkedCandidate.fullName}, candidate #{linkedCandidate.id.slice(-4)}
                  </p>
                )}
              </div>
            ))}
        </div>

        <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
           <CopyFeedbackButton round={round} values={values} templateVersion={templateVersion} />
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2 text-xs font-semibold text-white bg-[#1f52cc] rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 shadow-xs"
          >
            {submitting ? 'Saving Assessment...' : 'Submit Feedback'}
          </button>
        </div>
      </form>
    </div>
  );
}
