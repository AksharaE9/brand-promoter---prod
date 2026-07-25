import React, { useState } from 'react';
import { schedulingLeadApi } from '../../services/schedulingLeadApi';
import { getTodayString } from '../../lib/datetime';
import { MAX_UPLOAD_BYTES } from '../../lib/uploadLimits';

export default function LeadListImportModal({ isOpen, onClose, member, selectedDate, onUploadSuccess }) {
  const [file, setFile] = useState(null);
  const [listDate, setListDate] = useState(selectedDate || getTodayString());
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);

  if (!isOpen || !member) return null;

  const handleFileChange = (e) => {
    if (uploading) return;
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (selectedFile.size > MAX_UPLOAD_BYTES) {
        setError('File exceeds the 10 MB limit. Split it into smaller files if needed.');
        setFile(null);
        return;
      }
      setFile(selectedFile);
      setError('');
      setSummary(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a CSV or XLSX sheet file to upload');
      return;
    }
    if (!listDate) {
      setError('Please select a valid date for this lead list');
      return;
    }

    setUploading(true);
    setError('');
    setSummary(null);

    try {
      const res = await schedulingLeadApi.uploadLeadList(member.id, file, listDate);
      setSummary(res.data || { totalLeads: 0 });
      if (onUploadSuccess) onUploadSuccess();
    } catch (err) {
      setError(err.message || 'Failed to upload lead list');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden relative z-10 animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Import Daily Lead List</h2>
            <p className="text-xs text-slate-500 mt-0.5">Assign lead list for <span className="font-bold text-blue-600">{member.name}</span></p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center transition-colors"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
              {error}
            </div>
          )}

          {summary && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl space-y-1">
              <div className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm">check_circle</span>
                Import Successful!
              </div>
              <div className="text-xs text-emerald-700">
                Uploaded <strong>{summary.totalLeads} leads</strong> for {member.name} on {listDate}.
              </div>
              {summary.skippedCount > 0 && (
                <div className="text-[11px] text-amber-700 mt-1">
                  Note: {summary.skippedCount} rows were skipped due to missing required fields.
                </div>
              )}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Assignment Date</label>
            <input
              type="date"
              required
              value={listDate}
              onChange={(e) => setListDate(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-blue-500 outline-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Select Lead Sheet (CSV / XLSX)</label>
            <div className="border-2 border-dashed border-slate-200 hover:border-blue-400 rounded-2xl p-6 text-center transition-colors bg-slate-50/50 relative">
              <input
                type="file"
                accept=".csv, .xlsx, .xls"
                onChange={handleFileChange}
                disabled={uploading}
                className={`absolute inset-0 w-full h-full opacity-0 ${uploading ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              />
              <span className="material-symbols-outlined text-3xl text-slate-400">upload_file</span>
              <p className="text-xs font-bold text-slate-700 mt-1">
                {file ? file.name : 'Click to select CSV or XLSX file'}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">Minimum required headers: Name, Phone Number</p>
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
              disabled={uploading || !file}
              className="flex-1 h-11 rounded-xl bg-blue-600 text-white font-bold text-xs shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center justify-center gap-1"
            >
              <span className="material-symbols-outlined text-sm">cloud_upload</span>
              {uploading ? 'Importing...' : 'Upload & Assign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
