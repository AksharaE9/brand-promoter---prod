import React, { useState, useEffect } from 'react';
import { schedulingLeadApi } from '../../services/schedulingLeadApi';
import { computeCompletionPercentage } from '../../lib/leadImportSchema';

export default function WorkDoneReportModal({
  isOpen,
  onClose,
  totalLeadsToday = 0,
  initialData = null,
  selectedDate,
  memberId,
  onReportSubmitted,
}) {
  const [callsDone, setCallsDone] = useState(0);
  const [callsDidntPick, setCallsDidntPick] = useState(0);
  const [callsPicked, setCallsPicked] = useState(0);
  const [scheduledEntries, setScheduledEntries] = useState(0);
  const [updatedInAts, setUpdatedInAts] = useState(0);
  const [updatedInMail, setUpdatedInMail] = useState(0);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  useEffect(() => {
    if (initialData) {
      setCallsDone(initialData.callsDone || 0);
      setCallsDidntPick(initialData.callsDidntPick || 0);
      setCallsPicked(initialData.callsPicked || 0);
      setScheduledEntries(initialData.scheduledEntries || 0);
      setUpdatedInAts(initialData.updatedInAts || 0);
      setUpdatedInMail(initialData.updatedInMail || 0);
    } else {
      setCallsDone(0);
      setCallsDidntPick(0);
      setCallsPicked(0);
      setScheduledEntries(0);
      setUpdatedInAts(0);
      setUpdatedInMail(0);
    }
    setError('');
    setWarning('');
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  const currentPercentage = computeCompletionPercentage(callsDone, totalLeadsToday);
  const pickedSum = Number(callsPicked || 0) + Number(callsDidntPick || 0);
  const showReconciliationWarning = callsDone > 0 && pickedSum !== Number(callsDone || 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setWarning('');

    try {
      const res = await schedulingLeadApi.submitMyReport({
        callsDone: Number(callsDone) || 0,
        callsDidntPick: Number(callsDidntPick) || 0,
        callsPicked: Number(callsPicked) || 0,
        scheduledEntries: Number(scheduledEntries) || 0,
        updatedInAts: Number(updatedInAts) || 0,
        updatedInMail: Number(updatedInMail) || 0,
        date: selectedDate,
        memberId,
      });

      if (res.warning) {
        setWarning(res.warning);
      }

      if (onReportSubmitted) onReportSubmitted(res.data);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to submit work done report');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden relative z-10 animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Daily Work Done Report</h2>
            <p className="text-xs text-slate-500 mt-0.5">Submit telecalling activity metrics for today</p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center transition-colors"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
              {error}
            </div>
          )}

          {/* Completion Percentage Banner */}
          <div className="bg-blue-50 border border-blue-200 p-4 rounded-2xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-blue-900">Today's Progress</span>
              <span className="text-sm font-extrabold text-blue-700">{currentPercentage}% Complete</span>
            </div>
            <div className="w-full bg-blue-200 h-2.5 rounded-full overflow-hidden">
              <div
                className="bg-blue-600 h-full transition-all duration-300 rounded-full"
                style={{ width: `${currentPercentage}%` }}
              />
            </div>
            <div className="text-[11px] text-blue-700 flex justify-between font-medium">
              <span>Calls Done: {callsDone}</span>
              <span>Total Assigned Leads: {totalLeadsToday}</span>
            </div>
          </div>

          {showReconciliationWarning && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 font-medium flex items-center gap-1.5">
              <span className="material-symbols-outlined text-amber-600 text-base">warning</span>
              Notice: Calls Picked ({callsPicked}) + Didn't Pick ({callsDidntPick}) = {pickedSum}, which differs from Total Calls Done ({callsDone}).
            </div>
          )}

          {/* 6 Report Fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Total Calls Done</label>
              <input
                type="number"
                min="0"
                required
                value={callsDone}
                onChange={(e) => setCallsDone(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-blue-500 outline-none font-bold"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Didn't Pick Up</label>
              <input
                type="number"
                min="0"
                required
                value={callsDidntPick}
                onChange={(e) => setCallsDidntPick(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-blue-500 outline-none font-bold"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Calls Picked Up</label>
              <input
                type="number"
                min="0"
                required
                value={callsPicked}
                onChange={(e) => setCallsPicked(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-blue-500 outline-none font-bold"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Scheduled Entries</label>
              <input
                type="number"
                min="0"
                required
                value={scheduledEntries}
                onChange={(e) => setScheduledEntries(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-blue-500 outline-none font-bold"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Updated in ATS</label>
              <input
                type="number"
                min="0"
                required
                value={updatedInAts}
                onChange={(e) => setUpdatedInAts(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-blue-500 outline-none font-bold"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Updated in Mail</label>
              <input
                type="number"
                min="0"
                required
                value={updatedInMail}
                onChange={(e) => setUpdatedInMail(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-blue-500 outline-none font-bold"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-11 rounded-xl border border-slate-200 font-bold text-slate-500 hover:bg-slate-50 text-xs transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 h-11 rounded-xl bg-blue-600 text-white font-bold text-xs shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center justify-center gap-1"
            >
              <span className="material-symbols-outlined text-sm">send</span>
              {saving ? 'Submitting...' : 'Submit Work Done'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
