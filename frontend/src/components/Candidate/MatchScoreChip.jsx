import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Band color presets adhering to TalentOS Design System
 */
const BAND_CONFIG = {
  Strong: {
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-700',
    badge: 'bg-emerald-100 text-emerald-800',
    dot: 'bg-emerald-500',
    label: 'Strong match'
  },
  Good: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-[#1f52cc]',
    badge: 'bg-blue-100 text-blue-800',
    dot: 'bg-blue-500',
    label: 'Good match'
  },
  Partial: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    badge: 'bg-amber-100 text-amber-800',
    dot: 'bg-amber-500',
    label: 'Partial match'
  },
  Weak: {
    bg: 'bg-rose-50',
    border: 'border-rose-200',
    text: 'text-rose-700',
    badge: 'bg-rose-100 text-rose-800',
    dot: 'bg-rose-500',
    label: 'Weak match'
  }
};

/**
 * Shared MatchScoreChip Component
 *
 * @param {object} props
 * @param {object} [props.matchScore] - The match score object { rating10, score100, band, state, betterFitRole, jdTitle, topStrengths, topMissing }
 * @param {string} [props.candidateId] - Candidate ID
 * @param {boolean} [props.compact=false] - Render compact variant for tables / lists
 * @param {boolean} [props.isAdmin=false] - Whether current user is admin (shows retry on FAILED, unmapped hint)
 * @param {function} [props.onRetry] - Callback when retry is clicked
 * @param {string} [props.className=''] - Extra classes
 */
export default function MatchScoreChip({
  matchScore,
  candidateId,
  compact = false,
  isAdmin = false,
  onRetry = null,
  className = ''
}) {
  const navigate = useNavigate();
  const [showTooltip, setShowTooltip] = useState(false);

  // If matchScore is missing or state is NO_JD: render consistent spacer or null
  if (!matchScore || matchScore.state === 'NO_JD') {
    return <div className={`match-score-spacer h-[22px] ${className}`} aria-hidden="true" />;
  }

  const {
    state = 'NO_JD',
    rating10,
    score100,
    band = 'Weak',
    betterFitRole,
    jdTitle,
    topStrengths = [],
    topMissing = []
  } = matchScore;

  const handleClick = (e) => {
    e.stopPropagation();
    if (candidateId) {
      navigate(`/candidates/${candidateId}?tab=resume-analysis`);
    }
  };

  // State: UNMAPPED_ROLE
  if (state === 'UNMAPPED_ROLE') {
    if (!isAdmin) {
      return <div className={`match-score-spacer h-[22px] ${className}`} aria-hidden="true" />;
    }
    return (
      <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-semibold bg-slate-100 text-slate-500 border border-slate-200 ${className}`}>
        <span className="material-symbols-outlined text-[11px] text-slate-400">help_outline</span>
        <span>Role not mapped</span>
      </div>
    );
  }

  // State: QUEUED / PARSING
  if (state === 'QUEUED' || state === 'PARSING') {
    return (
      <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200 animate-pulse ${className}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" />
        <span>Scoring…</span>
      </div>
    );
  }

  // State: FAILED
  if (state === 'FAILED') {
    return (
      <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200 ${className}`}>
        <span className="material-symbols-outlined text-[12px] text-rose-500">error</span>
        <span>Couldn't read resume</span>
        {isAdmin && onRetry && (
          <button
            onClick={(e) => { e.stopPropagation(); onRetry(); }}
            className="ml-1 text-[9px] font-bold text-blue-600 hover:underline cursor-pointer"
            title="Retry resume scoring"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  // State: NO_RESUME
  if (state === 'NO_RESUME') {
    return (
      <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-50 text-slate-400 border border-slate-200/60 ${className}`}>
        <span className="material-symbols-outlined text-[12px] text-slate-400">description</span>
        <span>No resume</span>
      </div>
    );
  }

  // State: UNSUPPORTED_FILE
  if (state === 'UNSUPPORTED_FILE') {
    return (
      <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-50 text-slate-500 border border-slate-200/60 ${className}`}>
        <span className="material-symbols-outlined text-[12px] text-amber-500">folder_zip</span>
        <span>Resume not readable</span>
      </div>
    );
  }

  // State: SCORED
  if (state === 'SCORED') {
    const config = BAND_CONFIG[band] || BAND_CONFIG.Weak;
    // Explicitly format rating10, correctly rendering 0.0
    const ratingDisplay = rating10 !== null && rating10 !== undefined ? Number(rating10).toFixed(1) : '—';
    const score100Display = score100 !== null && score100 !== undefined ? Math.round(Number(score100)) : '—';

    return (
      <div className="relative inline-flex items-center gap-1.5 flex-wrap">
        <div
          onClick={handleClick}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          className={`group inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg border text-[11px] font-bold tracking-tight cursor-pointer transition-all hover:shadow-sm select-none ${config.bg} ${config.border} ${config.text} ${className}`}
          role="button"
          tabIndex={0}
          aria-label={`Match score: ${ratingDisplay} out of 10, ${config.label}`}
        >
          <span className="text-[12px] text-amber-500 font-bold leading-none">★</span>
          <span>{ratingDisplay}/10</span>
          <span className="text-[10px] font-medium opacity-80">· {config.label}</span>
          <span className="material-symbols-outlined text-[12px] opacity-0 group-hover:opacity-100 transition-opacity ml-0.5">
            open_in_new
          </span>
        </div>

        {/* Better fit badge if another role scored >= 1.0 higher */}
        {betterFitRole && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-extrabold bg-purple-50 text-purple-700 border border-purple-200 shadow-2xs">
            <span className="material-symbols-outlined text-[10px] text-purple-600">swap_calls</span>
            Better fit: {betterFitRole}
          </span>
        )}

        {/* Detailed Tooltip on Hover */}
        {showTooltip && (
          <div
            className="absolute bottom-full left-0 mb-2 z-50 w-72 p-3 bg-slate-900 text-white rounded-xl shadow-xl text-left pointer-events-none animate-in fade-in zoom-in-95 duration-150"
            style={{ fontSize: '11px', lineHeight: '1.4' }}
          >
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-700">
              <span className="font-bold text-white flex items-center gap-1">
                <span className="text-amber-400">★</span> Score: {score100Display}/100 ({ratingDisplay}/10)
              </span>
              <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${config.badge}`}>
                {band}
              </span>
            </div>

            {jdTitle && (
              <div className="mt-1.5 text-slate-300 text-[10px]">
                <span className="text-slate-400 font-medium">JD Target:</span> {jdTitle}
              </div>
            )}

            {topStrengths.length > 0 && (
              <div className="mt-2">
                <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-400">Matched Strengths</div>
                <ul className="mt-0.5 space-y-0.5 text-[10px] text-slate-200">
                  {topStrengths.map((s, idx) => (
                    <li key={idx} className="flex items-start gap-1">
                      <span className="text-emerald-400 font-bold leading-none">•</span>
                      <span className="truncate">{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {topMissing.length > 0 && (
              <div className="mt-1.5">
                <div className="text-[9px] font-bold uppercase tracking-wider text-rose-400">Missing Key Areas</div>
                <ul className="mt-0.5 space-y-0.5 text-[10px] text-slate-200">
                  {topMissing.map((m, idx) => (
                    <li key={idx} className="flex items-start gap-1">
                      <span className="text-rose-400 font-bold leading-none">•</span>
                      <span className="truncate">{m}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-2 pt-1.5 border-t border-slate-800 text-[9px] text-slate-400 italic">
              Match score is a recommendation based on the resume and the JD. It does not measure communication or interview performance.
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}
