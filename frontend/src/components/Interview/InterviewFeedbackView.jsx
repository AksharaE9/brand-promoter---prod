import * as React from 'react';
import {
  ROUND_DISPLAY_LABEL,
  InterviewRound,
  resolveFeedbackValue,
  resolveFeedbackFields,
} from '../../lib/interviewTemplates';
import CopyFeedbackButton from './CopyFeedbackButton';
import { getStoredUser, apiViewFile } from '../../lib/api';

const downloadBase64File = (fileName, base64Data) => {
  try {
    let blob;
    if (base64Data.startsWith('data:')) {
      const parts = base64Data.split(',');
      const mime = parts[0].match(/:(.*?);/)[1];
      const bstr = atob(parts[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      blob = new Blob([u8arr], { type: mime });
    } else {
      const bstr = atob(base64Data);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      blob = new Blob([u8arr], { type: 'application/octet-stream' });
    }
    
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    console.error('Failed to download base64 file:', err);
  }
};

export default function InterviewFeedbackView({
  round = InterviewRound.ROUND_1,
  feedbackData = {},
  templateVersion,
  candidateName = '',
  onEdit,
  onDelete,
}) {
  const ver = React.useMemo(() => {
    if (templateVersion !== undefined && templateVersion !== null) {
      return Number(templateVersion);
    }
    if (feedbackData.templateVersion || feedbackData.template_version) {
      return Number(feedbackData.templateVersion || feedbackData.template_version);
    }
    const keys = Object.keys(feedbackData || {});
    // Detect legacy v1 records: may use 'technical'/'overallRecommendation'/'keyStrengths' (v1 flat keys)
    // OR the raw shape stored in interviews.feedback JSON: 'ratings' (nested obj), 'recommendation', 'strengths', 'concerns', 'notes'
    const v1Keys = ['technical', 'overallRecommendation', 'keyStrengths', 'ratings', 'recommendation', 'strengths', 'concerns'];
    if (v1Keys.some(k => keys.includes(k))) {
      return 1;
    }
    return 2;
  }, [templateVersion, feedbackData]);

  const template = React.useMemo(() => {
    return resolveFeedbackFields(ver, round);
  }, [ver, round]);

  const roundLabel = ROUND_DISPLAY_LABEL[round] || 'Round 1';

  const currentUser = getStoredUser();
  const isAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'ADMIN';

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
          {isAdmin && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="px-3 py-1.5 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 hover:text-red-700 rounded-lg transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {template.map((field) => {
          const raw = resolveFeedbackValue(feedbackData, field.key, ver);
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
                {field.type === 'file' ? (
                  !isEmpty ? (
                    typeof raw === 'object' && raw.data ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadBase64File(raw.name || 'document', raw.data);
                        }}
                        className="inline-flex items-center gap-1 text-[#1f52cc] hover:underline font-semibold bg-transparent border-none cursor-pointer p-0"
                      >
                        <span className="material-symbols-outlined text-xs">download</span>
                        {raw.name || 'Download Attachment'}
                      </button>
                    ) : (
                      typeof raw === 'string' && raw.startsWith('/uploads') ? (
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await apiViewFile(raw);
                            } catch (err) {
                              console.error('Failed to view attachment:', err);
                            }
                          }}
                          className="inline-flex items-center gap-1 text-[#1f52cc] hover:underline font-semibold bg-transparent border-none cursor-pointer p-0"
                        >
                          <span className="material-symbols-outlined text-xs">open_in_new</span>
                          Open Attachment
                        </button>
                      ) : (
                        <a
                          href={raw}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[#1f52cc] hover:underline font-semibold"
                        >
                          <span className="material-symbols-outlined text-xs">open_in_new</span>
                          Open Attachment
                        </a>
                      )
                    )
                  ) : (
                    <span>—</span>
                  )
                ) : field.key === 'selectionStatus' || field.key === 'status' || field.key === 'overallRecommendation' ? (
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
