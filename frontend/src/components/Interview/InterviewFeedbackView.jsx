import * as React from 'react';
import {
  ROUND_DISPLAY_LABEL,
  InterviewRound,
  FEEDBACK_TEMPLATE_VERSIONS,
} from '../../lib/interviewTemplates';
import CopyFeedbackButton from './CopyFeedbackButton';

export default function InterviewFeedbackView({
  round = InterviewRound.ROUND_1,
  feedbackData = {},
  candidateName = '',
  onEdit,
}) {
  const ver = feedbackData.templateVersion || feedbackData.template_version || 1;
  const versionDef = FEEDBACK_TEMPLATE_VERSIONS.find(v => v.version === ver) || FEEDBACK_TEMPLATE_VERSIONS[0];
  const template = versionDef.getFields(round);
  const roundLabel = ROUND_DISPLAY_LABEL[round] || 'Round 1';

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5 border-b border-slate-100 pb-3.5">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-900">
              Submitted Assessment — {roundLabel}
            </h3>
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800 uppercase tracking-wider">
              Submitted ✓
            </span>
          </div>
          <p className="text-xs text-slate-500">Candidate: {candidateName || feedbackData.name || 'Candidate'}</p>
        </div>

        <div className="flex items-center gap-2">
          <CopyFeedbackButton round={round} values={feedbackData} templateVersion={ver} />
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
            >
              Edit Feedback
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {template.map((field) => {
          const raw = feedbackData[field.key];
          const isEmpty = raw === null || raw === undefined || String(raw).trim() === '';
          const display = isEmpty ? '—' : raw;
          const suffix = field.suffix && !isEmpty ? field.suffix : '';

          return (
            <div
              key={field.key}
              className={`p-3 bg-slate-50/60 rounded-lg border border-slate-100 ${
                field.type === 'textarea' ? 'md:col-span-2' : ''
              }`}
            >
              <span className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                {field.label}
              </span>
              <div className="text-xs font-medium text-slate-800 whitespace-pre-wrap">
                {field.key === 'selectionStatus' || field.key === 'status' ? (
                  <span
                    className={`inline-block px-2 py-0.5 text-[11px] font-bold rounded ${
                      display === 'SELECTED'
                        ? 'bg-emerald-100 text-emerald-800'
                        : display === 'REJECTED'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {display}
                  </span>
                ) : (
                  <span>
                    {display}
                    {suffix}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
