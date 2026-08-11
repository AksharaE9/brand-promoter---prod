import React, { useState, useRef, useEffect } from 'react';
import { getStoredToken, buildApiUrl, downloadAuthenticatedFile } from '../../lib/api';
import { MAX_UPLOAD_BYTES } from '../../lib/uploadLimits';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import api from '../../services/api';

export default function BulkFeedbackUploadModal({ isOpen, onClose, onSuccess }) {
  const [file, setFile] = useState(null);
  const [defaultRound, setDefaultRound] = useState('');
  const [uploading, setUploading] = useState(false);
  const [jobStatus, setJobStatus] = useState(null); // { state, progress, processed, succeeded, failed, errorReportUrl, error }
  const [errorMsg, setErrorMsg] = useState(null);
  const fileInputRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const isOnline = useOnlineStatus();

  useEffect(() => {
    if (!isOpen) {
      setFile(null);
      setDefaultRound('');
      setUploading(false);
      setJobStatus(null);
      setErrorMsg(null);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOnline && uploading) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      setUploading(false);
      setFile(null);
      setErrorMsg("Connection lost. Your upload was interrupted. You'll need to re-select the file and try again once you're back online.");
    }
  }, [isOnline, uploading]);

  if (!isOpen) return null;

  const handleFileChange = (e) => {
    if (uploading || !isOnline) return;
    const selected = e.target.files?.[0];
    if (selected) {
      if (selected.size > MAX_UPLOAD_BYTES) {
        setErrorMsg('File exceeds the 10 MB limit. Split it into smaller files if needed.');
        setFile(null);
        return;
      }
      setFile(selected);
      setErrorMsg(null);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (uploading || !isOnline) return;
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) {
      if (dropped.size > MAX_UPLOAD_BYTES) {
        setErrorMsg('File exceeds the 10 MB limit. Split it into smaller files if needed.');
        setFile(null);
        return;
      }
      setFile(dropped);
      setErrorMsg(null);
    }
  };

  const downloadTemplate = async () => {
    try {
      setErrorMsg(null);
      // If defaultRound is selected, request template for that specific round, otherwise combined
      const roundQuery = defaultRound ? `&round=${defaultRound}` : '';
      await downloadAuthenticatedFile(`/interview-feedback/bulk-upload/template/download?format=xlsx${roundQuery}`, 'interview_feedback_bulk_template.xlsx');
    } catch (err) {
      setErrorMsg('Failed to download template: ' + err.message);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setErrorMsg('Please select a CSV or Excel file to upload');
      return;
    }
    if (!isOnline) {
      setErrorMsg("You're offline. Please connect to the internet to upload files.");
      return;
    }

    setUploading(true);
    setErrorMsg(null);

    const formData = new FormData();
    formData.append('file', file);
    if (defaultRound) {
      formData.append('defaultRound', defaultRound);
    }

    try {
      const { data } = await api.post('/interview-feedback/bulk-upload', formData);
      if (!data || !data.success) {
        throw new Error(data?.error || 'Failed to submit bulk upload');
      }

      const { jobId } = data;
      pollJobStatus(jobId);
    } catch (err) {
      setErrorMsg(err.message || 'An error occurred during upload');
      setUploading(false);
    }
  };

  const pollJobStatus = (jobId) => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }

    pollIntervalRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/interview-feedback/bulk-upload/${jobId}`);
        if (data && data.success && data.data) {
          const status = data.data;
          setJobStatus(status);
          if (status.state === 'completed' || status.state === 'failed') {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
            setUploading(false);
            if (status.state === 'completed' && onSuccess) {
              onSuccess(status);
            }
          }
        }
      } catch (_) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
        setUploading(false);
      }
    }, 1000);
  };

  const downloadReport = async () => {
    if (!jobStatus?.jobId) return;
    try {
      await downloadAuthenticatedFile(`/interview-feedback/bulk-upload/${jobStatus.jobId}/report`, `feedback-upload-report-${jobStatus.jobId}.xlsx`);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to download report');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div>
            <h3 className="text-base font-bold text-slate-900">Bulk Interview Feedback Upload</h3>
            <p className="text-xs text-slate-500">Submit multi-round feedback for multiple candidates via spreadsheet</p>
          </div>
          <button
            onClick={onClose}
            disabled={uploading}
            className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-lg text-lg"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {!isOnline && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 font-semibold flex items-center gap-2">
              <span className="text-sm">⚠️</span>
              You're offline. Your upload will be paused until your connection returns.
            </div>
          )}

          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
              {errorMsg}
            </div>
          )}

          {!jobStatus ? (
            <>
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700">Default Round (Optional)</label>
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="text-xs font-semibold text-[#1f52cc] hover:underline flex items-center gap-1"
                >
                  📥 Download Excel Template
                </button>
              </div>

              <select
                value={defaultRound}
                onChange={(e) => setDefaultRound(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 focus:border-[#1f52cc] focus:ring-1 focus:ring-[#1f52cc] outline-none transition-all bg-white"
              >
                <option value="">Auto-detect from "Round" column in file</option>
                <option value="ROUND_1">Round 1</option>
                <option value="ROUND_2">Round 2</option>
                <option value="FINAL_ROUND">Final Round</option>
              </select>

              {/* Drag & Drop */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => !uploading && isOnline && fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
                  !isOnline ? 'border-slate-200 bg-slate-100/50 cursor-not-allowed' :
                  file ? 'border-[#1f52cc] bg-blue-50/30 cursor-pointer' :
                  'border-slate-300 hover:border-slate-400 bg-slate-50/50 cursor-pointer'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv, .xlsx, .xls"
                  onChange={handleFileChange}
                  disabled={uploading || !isOnline}
                  className="hidden"
                />
                <div className="space-y-2">
                  <div className="text-3xl">📊</div>
                  {file ? (
                    <div>
                      <p className="text-xs font-bold text-slate-800">{file.name}</p>
                      <p className="text-[11px] text-slate-500">{(file.size / 1024).toFixed(1)} KB — Ready to process</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs font-semibold text-slate-700">
                        Drag and drop your feedback CSV/XLSX file here
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">Supports CSV, XLSX, XLS up to 10MB</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            /* Progress & Results View */
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                <span>Status: {jobStatus.state.toUpperCase()}</span>
                <span>{jobStatus.progress || 0}%</span>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-[#1f52cc] h-full transition-all duration-300 rounded-full"
                  style={{ width: `${jobStatus.progress || 0}%` }}
                />
              </div>

              <div className="grid grid-cols-4 gap-2 pt-2 text-center">
                <div className="p-2 bg-slate-50 rounded-xl border border-slate-100">
                  <p className="text-[10px] text-slate-500 font-medium">Processed</p>
                  <p className="text-base font-bold text-slate-800">{jobStatus.processed || 0}</p>
                </div>
                <div className="p-2 bg-emerald-50 rounded-xl border border-emerald-100">
                  <p className="text-[10px] text-emerald-600 font-medium">Succeeded</p>
                  <p className="text-base font-bold text-emerald-700">{jobStatus.succeeded || 0}</p>
                </div>
                <div className="p-2 bg-amber-50 rounded-xl border border-amber-100">
                  <p className="text-[10px] text-amber-600 font-medium">Duplicates</p>
                  <p className="text-base font-bold text-amber-700">{jobStatus.duplicates || 0}</p>
                </div>
                <div className="p-2 bg-rose-50 rounded-xl border border-rose-100">
                  <p className="text-[10px] text-rose-600 font-medium">Failed / Warn</p>
                  <p className="text-base font-bold text-rose-700">{jobStatus.failed || 0}</p>
                </div>
              </div>

              {jobStatus.errorReportUrl && (
                <div className="pt-2 flex justify-center">
                  <button
                    type="button"
                    onClick={downloadReport}
                    className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors flex items-center gap-1.5"
                  >
                    📄 Download Error / Warning Report
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            {jobStatus?.state === 'completed' ? 'Close' : 'Cancel'}
          </button>

          {!jobStatus && (
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading || !file || !isOnline}
              className="px-5 py-2 text-xs font-semibold text-white bg-[#1f52cc] rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 shadow-xs"
            >
              {uploading ? 'Processing File...' : 'Start Bulk Upload'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
