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

const warnedScoreIds = new Set();

/**
 * Defensive item text renderer.
 * Returns a string for: a string, {label}, {skill}, {requirement}, a number, or null.
 * Anything else -> '', plus a console.warn with the score ID once.
 */
export function renderItemText(item, scoreId = null) {
  if (item == null) return '';
  if (typeof item === 'string') return item.trim();
  if (typeof item === 'number') return String(item);
  if (typeof item === 'object') {
    if (typeof item.label === 'string' && item.label) return item.label.trim();
    if (typeof item.skill === 'string' && item.skill) return item.skill.trim();
    if (typeof item.requirement === 'string' && item.requirement) return item.requirement.trim();
    if (typeof item.name === 'string' && item.name) return item.name.trim();
    if (typeof item.text === 'string' && item.text) return item.text.trim();
    if (typeof item.code === 'string' && item.code) return item.code.trim();
  }
  const warnKey = `${scoreId || 'unknown'}:${typeof item}`;
  if (!warnedScoreIds.has(warnKey)) {
    warnedScoreIds.add(warnKey);
    console.warn(`[renderItemText] Unhandled item shape for score ${scoreId || 'N/A'}:`, item);
  }
  return '';
}

/**
 * Tiny boundary that ensures an unexpected chip render error only hides the chip,
 * not the surrounding card or page.
 */
class ChipErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err) {
    console.warn('[ChipErrorBoundary] Suppressed MatchScoreChip error:', err);
  }
  render() {
    if (this.state.hasError) {
      return <div className={`match-score-spacer h-[22px] ${this.props.className || ''}`} aria-hidden="true" />;
    }
    return this.props.children;
  }
}

/**
 * Internal MatchScoreChip component implementation
 */
function MatchScoreChipInner({
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
    id: scoreId,
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
      <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[9px] font-medium bg-blue-50 text-[#1f52cc] border border-blue-100 animate-pulse ${className}`}>
        <span className="material-symbols-outlined text-[11px] animate-spin">sync</span>
        <span>Scoring…</span>
      </div>
    );
  }

  // State: UNSUPPORTED_FORMAT
  if (state === 'UNSUPPORTED_FORMAT') {
    return (
      <div
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-medium bg-slate-100 text-slate-500 border border-slate-200 cursor-help ${className}`}
        title="Resume format could not be parsed for automated matching (e.g. image-only or corrupt file)."
      >
        <span className="material-symbols-outlined text-[11px] text-slate-400">description</span>
        <span>Resume unreadable</span>
      </div>
    );
  }

  // State: FAILED
  if (state === 'FAILED') {
    return (
      <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-semibold bg-rose-50 text-rose-600 border border-rose-200 ${className}`}>
        <span className="material-symbols-outlined text-[11px] text-rose-500">error_outline</span>
        <span>Scoring failed</span>
        {isAdmin && onRetry && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRetry();
            }}
            className="ml-1 text-[9px] font-bold underline hover:text-rose-800"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  // State: SCORED
  if (state === 'SCORED') {
    const config = BAND_CONFIG[band] || BAND_CONFIG.Weak;
    const ratingDisplay = typeof rating10 === 'number' ? rating10.toFixed(1) : (rating10 || '--');
    const score100Display = typeof score100 === 'number' ? Math.round(score100) : (score100 || '--');

    return (
      <div
        className="relative inline-block"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <button
          type="button"
          onClick={handleClick}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border transition-all cursor-pointer select-none ${config.bg} ${config.border} ${config.text} hover:shadow-xs hover:brightness-95 ${className}`}
          title="Click to view detailed JD match analysis"
          aria-label={`Match rating: ${ratingDisplay}/10 (${config.label})`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
          <span className="font-extrabold">{ratingDisplay}</span>
          <span className="text-[9px] opacity-75">/10</span>
          {!compact && (
            <span className="ml-0.5 font-semibold text-[9px] uppercase tracking-wide opacity-90">
              · {band}
            </span>
          )}
          {betterFitRole && (
            <span
              className="material-symbols-outlined text-[11px] text-indigo-500 ml-0.5"
              title={`Stronger match found for ${betterFitRole}`}
            >
              swap_horiz
            </span>
          )}
        </button>

        {/* Hover Tooltip Breakdown */}
        {showTooltip && (
          <div
            className="absolute left-0 bottom-full mb-1.5 z-50 w-64 p-3 bg-slate-900 text-white rounded-xl shadow-xl border border-slate-700 text-xs pointer-events-none animate-in fade-in duration-150"
            role="tooltip"
          >
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
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

            {Array.isArray(topStrengths) && topStrengths.length > 0 && (
              <div className="mt-2">
                <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-400">Matched Strengths</div>
                <ul className="mt-0.5 space-y-0.5 text-[10px] text-slate-200">
                  {topStrengths.map((s, idx) => {
                    const text = renderItemText(s, scoreId);
                    if (!text) return null;
                    return (
                      <li key={idx} className="flex items-start gap-1">
                        <span className="text-emerald-400 font-bold leading-none">•</span>
                        <span className="truncate">{text}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {Array.isArray(topMissing) && topMissing.length > 0 && (
              <div className="mt-1.5">
                <div className="text-[9px] font-bold uppercase tracking-wider text-rose-400">Missing Key Areas</div>
                <ul className="mt-0.5 space-y-0.5 text-[10px] text-slate-200">
                  {topMissing.map((m, idx) => {
                    const text = renderItemText(m, scoreId);
                    if (!text) return null;
                    return (
                      <li key={idx} className="flex items-start gap-1">
                        <span className="text-rose-400 font-bold leading-none">•</span>
                        <span className="truncate">{text}</span>
                      </li>
                    );
                  })}
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

/**
 * Shared MatchScoreChip Component wrapped in defensive ChipErrorBoundary
 */
export default function MatchScoreChip(props) {
  return (
    <ChipErrorBoundary className={props.className}>
      <MatchScoreChipInner {...props} />
    </ChipErrorBoundary>
  );
}
