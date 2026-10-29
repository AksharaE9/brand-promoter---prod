import React, { useState, useEffect } from 'react';
import { apiGet, apiPost } from '../../lib/api';
import { renderItemText } from './MatchScoreChip';

const BAND_COLORS = {
  Strong: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-800' },
  Good: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-800' },
  Partial: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-800' },
  Weak: { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700', badge: 'bg-rose-100 text-rose-800' }
};

export default function ResumeAnalysisTab({ candidate, onContactAccepted }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reparsing, setReparsing] = useState(false);
  const [acceptingContact, setAcceptingContact] = useState(false);
  const [activeEvidence, setActiveEvidence] = useState(null);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const loadAnalysis = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await apiGet(`/matching/candidates/${candidate.id}/analysis`);
      if (res.success) {
        setData(res.data);
      } else {
        setError(res.error || 'Failed to load resume analysis');
      }
    } catch (err) {
      setError(err.message || 'Error fetching resume match analysis');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (candidate?.id) {
      loadAnalysis();
    }
  }, [candidate?.id]);

  const handleReparse = async () => {
    try {
      setReparsing(true);
      setError('');
      setSuccessMsg('');
      const res = await apiPost(`/matching/candidates/${candidate.id}/re-parse`, {});
      if (res.success) {
        setSuccessMsg('Resume re-parsed and re-scored successfully.');
        await loadAnalysis();
      } else {
        setError(res.error || 'Re-parse failed');
      }
    } catch (err) {
      setError(err.message || 'Re-parse encountered an error');
    } finally {
      setReparsing(false);
    }
  };

  const handleAcceptContact = async () => {
    if (!data?.contactDiff?.suggested) return;
    try {
      setAcceptingContact(true);
      const res = await apiPost(`/matching/candidates/${candidate.id}/accept-contact`, {
        name: data.contactDiff.suggested.name,
        email: data.contactDiff.suggested.email,
        phone: data.contactDiff.suggested.phone
      });
      if (res.success) {
        setSuccessMsg('Candidate contact information updated from resume.');
        if (onContactAccepted) onContactAccepted();
        await loadAnalysis();
      } else {
        setError(res.error || 'Failed to accept contact details');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setAcceptingContact(false);
    }
  };

  if (loading) {
    return (
      <div className="os-card p-6 bg-white border border-[#e3eaf0] rounded-2xl animate-pulse space-y-4">
        <div className="h-6 w-1/3 bg-slate-200 rounded"></div>
        <div className="h-24 bg-slate-100 rounded-xl"></div>
        <div className="grid grid-cols-2 gap-4">
          <div className="h-32 bg-slate-50 rounded-xl"></div>
          <div className="h-32 bg-slate-50 rounded-xl"></div>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="os-card p-6 bg-white border border-[#e3eaf0] rounded-2xl">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-rose-600 flex items-center gap-2">
            <span className="material-symbols-outlined text-lg">info</span>
            {error}
          </div>
          <button
            onClick={handleReparse}
            disabled={reparsing}
            className="os-btn-primary !h-8 !px-3 text-xs flex items-center gap-1.5"
          >
            <span className={`material-symbols-outlined text-sm ${reparsing ? 'animate-spin' : ''}`}>sync</span>
            {reparsing ? 'Analyzing...' : 'Parse Resume Now'}
          </button>
        </div>
      </div>
    );
  }

  const primaryScore = data?.primaryScore;
  const colors = BAND_COLORS[primaryScore?.band] || BAND_COLORS.Good;
  const subScores = primaryScore?.subScores || {};
  const crossRoles = data?.crossRoleScores || [];
  const contactDiff = data?.contactDiff;

  return (
    <div className="space-y-6">
      {successMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold rounded-xl flex items-center gap-2">
          <span className="material-symbols-outlined text-sm">check_circle</span>
          {successMsg}
        </div>
      )}

      {/* Main Score Hero Card */}
      <div className={`os-card p-6 bg-white border ${colors.border} rounded-2xl shadow-sm relative overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Target Role</span>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${colors.badge}`}>
                {primaryScore?.band || 'Good'} Fit
              </span>
            </div>
            <h2 className="text-xl font-bold text-[#0f1b3d] mt-1">{primaryScore?.jobTitle || candidate.preferredRole}</h2>
            <p className="text-xs text-slate-500 mt-0.5">Automated parsing & deterministic JD matching engine</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-3xl font-extrabold text-[#1f52cc] leading-none">
                {primaryScore ? primaryScore.overall : '--'}
                <span className="text-base font-normal text-slate-400">/100</span>
              </div>
              <div className="text-xs font-bold text-slate-600 mt-1">
                Rating: {primaryScore ? primaryScore.ratingOutOf10 : '--'}/10
              </div>
            </div>

            <button
              onClick={handleReparse}
              disabled={reparsing}
              title="Re-run parsing and matching"
              className="os-btn-outline !h-9 !px-3 text-xs flex items-center gap-1.5 !border-slate-200 hover:!border-[#1f52cc]"
            >
              <span className={`material-symbols-outlined text-sm ${reparsing ? 'animate-spin' : ''}`}>refresh</span>
              {reparsing ? 'Scoring...' : 'Re-parse'}
            </button>
          </div>
        </div>

        {/* Best-fit cross-role callout banner if another role is significantly stronger */}
        {data?.bestFitRole && (
          <div className="mt-4 p-3 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-indigo-900 font-semibold">
              <span className="material-symbols-outlined text-indigo-600 text-base">stars</span>
              <span>
                Stronger match found: <strong>{data.bestFitRole.jdTitle}</strong> ({data.bestFitRole.overall}/100, +{data.bestFitRole.scoreDiff} pts higher fit)
              </span>
            </div>
            <span className="text-[10px] bg-indigo-200 text-indigo-900 px-2 py-0.5 rounded-md font-bold uppercase">
              Cross-Role Rec
            </span>
          </div>
        )}

        {/* Sub-Score Progress Bars */}
        <div className="mt-6 pt-5 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <div className="flex justify-between text-xs mb-1 font-semibold text-slate-600">
              <span>Education Fit</span>
              <span className="text-[#1f52cc]">{subScores.educationFit ?? 0}/100</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2">
              <div className="bg-[#1f52cc] h-2 rounded-full transition-all" style={{ width: `${subScores.educationFit || 0}%` }}></div>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1 font-semibold text-slate-600">
              <span>Experience Fit</span>
              <span className="text-[#1f52cc]">{subScores.experienceFit ?? 0}/100</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2">
              <div className="bg-[#1f52cc] h-2 rounded-full transition-all" style={{ width: `${subScores.experienceFit || 0}%` }}></div>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1 font-semibold text-slate-600">
              <span>Role Skills</span>
              <span className="text-[#1f52cc]">{subScores.roleSkills ?? 0}/100</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2">
              <div className="bg-[#1f52cc] h-2 rounded-full transition-all" style={{ width: `${subScores.roleSkills || 0}%` }}></div>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1 font-semibold text-slate-600">
              <span>Comm & Leadership</span>
              <span className="text-[#1f52cc]">{subScores.communicationLeadership ?? 0}/100</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2">
              <div className="bg-[#1f52cc] h-2 rounded-full transition-all" style={{ width: `${subScores.communicationLeadership || 0}%` }}></div>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1 font-semibold text-slate-600">
              <span>Semantic Relevance</span>
              <span className="text-[#1f52cc]">{subScores.semanticRelevance ?? 0}/100</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2">
              <div className="bg-[#1f52cc] h-2 rounded-full transition-all" style={{ width: `${subScores.semanticRelevance || 0}%` }}></div>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1 font-semibold text-slate-600">
              <span>Career Interest</span>
              <span className="text-[#1f52cc]">{subScores.careerInterest ?? 0}/100</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2">
              <div className="bg-[#1f52cc] h-2 rounded-full transition-all" style={{ width: `${subScores.careerInterest || 0}%` }}></div>
            </div>
          </div>
        </div>

        {/* Deterministic Explanation */}
        {primaryScore?.explanation && (
          <div className="mt-4 p-3 bg-slate-50 rounded-xl text-xs text-slate-600 italic border border-slate-100">
            "{primaryScore.explanation}"
          </div>
        )}
      </div>

      {/* Cross-Role Comparison Mini-Cards */}
      {crossRoles.length > 0 && (
        <div className="os-card p-5 bg-white border border-[#e3eaf0] rounded-2xl">
          <h3 className="text-xs uppercase tracking-wider font-bold text-slate-500 mb-3 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-sm text-[#1f52cc]">compare_arrows</span>
            Cross-Role Evaluation (Overlap Comparison)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {crossRoles.map(cr => {
              const diff = primaryScore ? cr.overall - primaryScore.overall : 0;
              const diffText = diff > 0 ? `+${diff}` : `${diff}`;
              const crColors = BAND_COLORS[cr.band] || BAND_COLORS.Good;

              return (
                <div key={cr.jdId} className={`p-3.5 rounded-xl border ${cr.isPrimary ? 'border-[#1f52cc] bg-blue-50/30' : 'border-slate-200 bg-slate-50/50'} flex flex-col justify-between`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[#0f1b3d] truncate">{cr.jdTitle}</div>
                      {cr.isPrimary ? (
                        <span className="text-[10px] text-[#1f52cc] font-semibold">Primary Selected Role</span>
                      ) : (
                        <span className="text-[10px] text-slate-500">
                          {diff >= 0 ? `+${diff} vs primary` : `${diff} vs primary`}
                        </span>
                      )}
                    </div>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${crColors.badge}`}>
                      {cr.band}
                    </span>
                  </div>
                  <div className="mt-3 flex items-baseline justify-between">
                    <span className="text-2xl font-extrabold text-[#0f1b3d]">{cr.overall}<span className="text-xs font-normal text-slate-400">/100</span></span>
                    <span className="text-xs font-semibold text-slate-600">{cr.ratingOutOf10}/10</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Matched Requirements & Missing Must-Haves */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Matched Requirements */}
        <div className="os-card p-5 bg-white border border-[#e3eaf0] rounded-2xl">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs uppercase tracking-wider font-bold text-emerald-700 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm">check_circle</span>
              Matched Requirements ({primaryScore?.matchedRequirements?.length || 0})
            </h3>
            <span className="text-[10px] text-slate-400">Click chip to view evidence</span>
          </div>

          {(!primaryScore?.matchedRequirements || primaryScore.matchedRequirements.length === 0) ? (
            <p className="text-xs text-slate-400 py-3">No direct keywords matched in resume text.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {primaryScore.matchedRequirements.map((m, idx) => {
                const label = renderItemText(m, primaryScore?.id);
                if (!label) return null;
                const skillKey = (typeof m === 'object' && (m.skill || m.label)) || label;
                const category = (typeof m === 'object' && m.category) ? m.category : 'Skill';
                const isSelected = activeEvidence && ((activeEvidence.skill || activeEvidence.label) === skillKey);

                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveEvidence(isSelected ? null : (typeof m === 'object' ? m : { skill: label, label, category }))}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border ${
                      isSelected
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                        : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                    }`}
                  >
                    {label}
                    <span className="text-[10px] opacity-75 ml-1">({category})</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Evidence popover quote */}
          {activeEvidence && (
            <div className="mt-4 p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl text-xs text-emerald-900">
              <div className="font-bold mb-1 flex items-center justify-between">
                <span>Resume Quote for "{renderItemText(activeEvidence, primaryScore?.id)}":</span>
                <span className="text-[10px] uppercase font-semibold text-emerald-700">
                  {typeof activeEvidence === 'object' && activeEvidence.strength ? `${activeEvidence.strength} match` : 'match'}
                </span>
              </div>
              <p className="italic bg-white p-2 rounded-lg border border-emerald-100">
                "{((typeof activeEvidence === 'object' && activeEvidence.evidence) || 'Mentioned in resume profile')}"
              </p>
            </div>
          )}
        </div>

        {/* Missing Must-Haves */}
        <div className="os-card p-5 bg-white border border-[#e3eaf0] rounded-2xl">
          <h3 className="text-xs uppercase tracking-wider font-bold text-amber-700 mb-3 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-sm">warning</span>
            Missing Must-Haves ({primaryScore?.missingMustHaves?.length || 0})
          </h3>

          {(!primaryScore?.missingMustHaves || primaryScore.missingMustHaves.length === 0) ? (
            <div className="text-xs text-emerald-600 font-semibold py-3 flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">task_alt</span>
              Candidate meets all required JD criteria!
            </div>
          ) : (
            <div className="space-y-2">
              {primaryScore.missingMustHaves.map((m, idx) => {
                const label = renderItemText(m, primaryScore?.id);
                if (!label) return null;
                const category = (typeof m === 'object' && m.category) ? m.category : 'Must-Have';
                return (
                  <div key={idx} className="p-2.5 bg-amber-50/70 border border-amber-200 rounded-xl flex items-center justify-between text-xs text-amber-900">
                    <span className="font-semibold">{label}</span>
                    <span className="text-[10px] bg-amber-200 text-amber-800 px-2 py-0.5 rounded-md font-bold uppercase">
                      {category}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {primaryScore?.flags && primaryScore.flags.length > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-100">
              <div className="text-[10px] uppercase font-bold tracking-wider text-rose-500 mb-2">Resume Alerts</div>
              {primaryScore.flags.map((flag, idx) => {
                const flagText = renderItemText(flag, primaryScore?.id) || (typeof flag === 'object' ? (flag.label || flag.code || '') : String(flag));
                if (!flagText) return null;
                return (
                  <div key={idx} className="text-xs text-rose-700 bg-rose-50 p-2 rounded-lg border border-rose-100 mb-1 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-sm">flag</span>
                    {flagText}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Contact Details Diff & Accept Suggestion */}
      {contactDiff && contactDiff.hasDifferences && (
        <div className="os-card p-5 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-[#0f1b3d] flex items-center gap-2">
                <span className="material-symbols-outlined text-[#1f52cc]">contact_mail</span>
                Parsed Contact Information Discrepancies
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                The resume contains updated contact info that differs from the candidate profile record.
              </p>
            </div>

            <button
              onClick={handleAcceptContact}
              disabled={acceptingContact}
              className="os-btn-primary !h-8 !px-4 text-xs flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-sm">check</span>
              {acceptingContact ? 'Updating...' : 'Accept Suggested Info'}
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-3 bg-white rounded-xl border border-blue-100 text-xs">
              <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Current Candidate Data</div>
              <div className="space-y-1 text-slate-700">
                <div><strong>Name:</strong> {contactDiff.current.name || 'N/A'}</div>
                <div><strong>Email:</strong> {contactDiff.current.email || 'N/A'}</div>
                <div><strong>Phone:</strong> {contactDiff.current.phone || 'N/A'}</div>
              </div>
            </div>

            <div className="p-3 bg-white rounded-xl border border-indigo-200 text-xs">
              <div className="text-[10px] uppercase font-bold text-[#1f52cc] mb-1">Detected in Resume</div>
              <div className="space-y-1 text-slate-800 font-semibold">
                <div><strong>Name:</strong> {contactDiff.suggested.name || 'N/A'}</div>
                <div><strong>Email:</strong> {contactDiff.suggested.email || 'N/A'}</div>
                <div><strong>Phone:</strong> {contactDiff.suggested.phone || 'N/A'}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
